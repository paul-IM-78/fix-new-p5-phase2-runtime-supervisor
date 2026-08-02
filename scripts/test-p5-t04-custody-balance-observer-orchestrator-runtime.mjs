import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const DB_CONTAINER = "supabase_db_staking-wallet-web";
const LOCAL_DB_HOST = "127.0.0.1";
const LOCAL_DB_PORT = 55722;
const DB_NAME = "postgres";
const SCOPE_ROLE = "custody_observer_scope_reader";
const WORKER_ROLE = "custody_observer_worker";

const SOURCE_MODULES = [
  {
    sourcePath: "src/server/custody/provider-observation-contract.ts",
    outputName: "provider-observation-contract.js",
  },
  {
    sourcePath: "src/server/custody/balance-observation-normalization.ts",
    outputName: "balance-observation-normalization.js",
  },
  {
    sourcePath: "src/server/custody/balance-observer-retry.ts",
    outputName: "balance-observer-retry.js",
  },
  {
    sourcePath: "src/server/custody/balance-observer-command-client.ts",
    outputName: "balance-observer-command-client.js",
  },
  {
    sourcePath: "src/server/custody/balance-observer-scope-client.ts",
    outputName: "balance-observer-scope-client.js",
  },
  {
    sourcePath: "src/server/custody/balance-observer-worker.ts",
    outputName: "balance-observer-worker.js",
  },
  {
    sourcePath: "src/server/custody/mock-balance-observation-adapter.ts",
    outputName: "mock-balance-observation-adapter.js",
  },
  {
    sourcePath: "src/server/custody/balance-observer-orchestrator.ts",
    outputName: "balance-observer-orchestrator.js",
  },
];

const PROVIDERS = {
  a: provider("P5T04_ORCH_PROVIDER_A"),
  b: provider("P5T04_ORCH_PROVIDER_B", "QUALIFIED_CUSTODIAN"),
  c: provider("P5T04_ORCH_PROVIDER_C", "EXCHANGE_CUSTODY"),
  d: provider("P5T04_ORCH_PROVIDER_D", "INTERNAL_HSM"),
};

const ASSETS = {
  a: asset("00000000-0000-4000-8000-000000770101", "P5T04_ORCH_A"),
  b: asset("00000000-0000-4000-8000-000000770102", "P5T04_ORCH_B"),
  c: asset("00000000-0000-4000-8000-000000770103", "P5T04_ORCH_C"),
  d: asset("00000000-0000-4000-8000-000000770104", "P5T04_ORCH_D"),
};

const BINDINGS = {
  a1: binding("00000000-0000-4000-8000-000000770301", PROVIDERS.a, ASSETS.a, "p5t04_orch_a1"),
  a2: binding("00000000-0000-4000-8000-000000770302", PROVIDERS.a, ASSETS.a, "p5t04_orch_a2", "TREASURY"),
  b1: binding("00000000-0000-4000-8000-000000770303", PROVIDERS.a, ASSETS.b, "p5t04_orch_b1"),
  c1: binding("00000000-0000-4000-8000-000000770304", PROVIDERS.b, ASSETS.a, "p5t04_orch_c1"),
  d1: binding("00000000-0000-4000-8000-000000770305", PROVIDERS.c, ASSETS.c, "p5t04_orch_d1"),
  e1: binding("00000000-0000-4000-8000-000000770306", PROVIDERS.c, ASSETS.d, "p5t04_orch_e1"),
  f1: binding("00000000-0000-4000-8000-000000770307", PROVIDERS.d, ASSETS.d, "p5t04_orch_f1"),
};

let runtimeCaseCount = 0;
let externalNetworkCalls = 0;
let providerNetworkCalls = 0;
let localPostgresConnections = 0;
let credentialEnvReads = 0;
let serviceRoleUsage = 0;
let realDbOneShotRunCount = 0;
let realDbExactReplayRunCount = 0;
let replayObservationRowDelta = 0;
let replayDuplicateObservationDelta = 0;
let replayCheckpointRowDelta = 0;
let replayCheckpointVersionDelta = 0;
let replayUnrelatedDurableTableDelta = 0;
let maxCrossProviderConcurrency = 0;
let maxSameProviderConcurrency = 0;
let scopeReaderPassword = null;
let workerPassword = null;
let tempRuntimeDir = null;
let networkGuard = null;
const clientsToClose = new Set();
const emittedLines = [];

async function main() {
  const originalEnv = process.env;
  let localSupabaseStarted = false;

  try {
    await assertSourceBoundaries();
    const modules = await loadRuntimeModules();
    await runNpmScript("supabase:start", "Supabase start", 120_000);
    localSupabaseStarted = true;
    await runNpmScript("db:reset:local", "Initial DB reset", 180_000);
    await setupDatabaseFixtures();
    scopeReaderPassword = createEphemeralPassword();
    workerPassword = createEphemeralPassword();
    await setScopeReaderCredential(scopeReaderPassword);
    await setWorkerPassword(workerPassword);
    networkGuard = installLocalNetworkGuard();
    process.env = createCredentialEnvGuard(originalEnv);

    await assertDirectRolePrivileges(modules);
    await assertRealDatabaseOneShot(modules);
    await assertInputValidationScenarios(modules.orchestrator);
    await assertDiscoveryScenarios(modules);
    await assertExecutionScenarios(modules);
    await assertRefreshScenarios(modules);
    await assertAbortAndCleanupScenarios(modules);
    await assertRealWorkerIntegration(modules);

    assert(externalNetworkCalls === 0, "External network calls zero");
    pass("External network guard");
    assert(providerNetworkCalls === 0, "Provider network calls zero");
    pass("Provider network guard");
    assert(localPostgresConnections >= 2, "Local PostgreSQL connection count");
    pass("Local PostgreSQL network allowlist");
    assert(credentialEnvReads === 0, "Credential environment reads zero");
    pass("Credential environment read guard");
    assert(serviceRoleUsage === 0, "Service-role usage zero");
    pass("Service-role usage guard");
  } finally {
    process.env = originalEnv;
    restoreLocalNetworkGuard();
    await closeClients();
    await clearScopeReaderCredential();
    await clearWorkerPassword();
    if (localSupabaseStarted) {
      await runCleanupResetAndStop();
    }
    await cleanupRuntimeModules();
  }

  assert(!tempRuntimeDir || !existsSync(tempRuntimeDir), "Temp runtime cleanup");
  pass("Temp runtime cleanup");
  assertSafeOutput();

  console.log(`ORCHESTRATOR_RUNTIME_CASE_COUNT=${runtimeCaseCount}`);
  console.log(`REAL_DB_ONE_SHOT_RUN_COUNT=${realDbOneShotRunCount}`);
  console.log(`REAL_DB_EXACT_REPLAY_RUN_COUNT=${realDbExactReplayRunCount}`);
  console.log(`REPLAY_OBSERVATION_ROW_DELTA=${replayObservationRowDelta}`);
  console.log(`REPLAY_DUPLICATE_OBSERVATION_DELTA=${replayDuplicateObservationDelta}`);
  console.log(`REPLAY_CHECKPOINT_ROW_DELTA=${replayCheckpointRowDelta}`);
  console.log(`REPLAY_CHECKPOINT_VERSION_DELTA=${replayCheckpointVersionDelta}`);
  console.log(`REPLAY_UNRELATED_DURABLE_TABLE_DELTA=${replayUnrelatedDurableTableDelta}`);
  console.log(`SERVICE_ROLE_USAGE=${serviceRoleUsage}`);
  console.log(`MAX_CROSS_PROVIDER_CONCURRENCY=${maxCrossProviderConcurrency}`);
  console.log(`MAX_SAME_PROVIDER_CONCURRENCY=${maxSameProviderConcurrency}`);
  console.log(`LOCAL_POSTGRES_CONNECTIONS=${localPostgresConnections}`);
  console.log(`EXTERNAL_NETWORK_CALLS=${externalNetworkCalls}`);
  console.log(`PROVIDER_NETWORK_CALLS=${providerNetworkCalls}`);
  console.log(`CREDENTIAL_ENV_READS=${credentialEnvReads}`);
  console.log("CUSTODY_BALANCE_OBSERVER_ORCHESTRATOR_RUNTIME_PASS");
}

async function assertSourceBoundaries() {
  const source = await readFile(
    "src/server/custody/balance-observer-orchestrator.ts",
    "utf8",
  );
  const forbiddenSourceMarkers = [
    "new Pool",
    "createPool",
    "process.env",
    "connectionString",
    "DATABASE_URL",
    "SUPABASE_URL",
    "service_role",
    "createClient(",
    "fetch(",
    "axios",
    "http.request",
    "https.request",
    "setInterval(",
    "setTimeout(",
    "process.exit",
    "cron",
    "daemon",
    "scheduler",
  ];

  assert(
    source.startsWith('import "server-only";'),
    "Orchestrator is server-only",
  );

  for (const marker of forbiddenSourceMarkers) {
    assert(!source.includes(marker), `Source boundary excludes ${marker}`);
  }

  assert(
    source.includes("runCustodyBalanceObserverWorkUnit"),
    "Source uses worker integration",
  );
  pass("Source boundary scan");
}

async function loadRuntimeModules() {
  tempRuntimeDir = await mkdtemp(
    path.join(tmpdir(), "p5-t04-orchestrator-runtime-"),
  );

  for (const moduleInfo of SOURCE_MODULES) {
    const source = await readFile(moduleInfo.sourcePath, "utf8");
    const strippedSource = source.replace(/^import "server-only";\r?\n\r?\n?/, "");
    const transpiled = ts.transpileModule(strippedSource, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: moduleInfo.sourcePath,
    });

    await writeFile(
      path.join(tempRuntimeDir, moduleInfo.outputName),
      transpiled.outputText,
      "utf8",
    );
  }

  await linkNodeModules(tempRuntimeDir);
  const runtimeRequire = createRequire(
    path.join(tempRuntimeDir, "runtime-entry.cjs"),
  );

  return {
    commandClient: runtimeRequire("./balance-observer-command-client.js"),
    mockAdapter: runtimeRequire("./mock-balance-observation-adapter.js"),
    orchestrator: runtimeRequire("./balance-observer-orchestrator.js"),
    scopeClient: runtimeRequire("./balance-observer-scope-client.js"),
    worker: runtimeRequire("./balance-observer-worker.js"),
  };
}

async function linkNodeModules(targetDir) {
  const source = path.resolve("node_modules");
  const destination = path.join(targetDir, "node_modules");

  if (!existsSync(source) || existsSync(destination)) {
    return;
  }

  await symlink(source, destination, "junction");
}

async function assertDirectRolePrivileges(modules) {
  const { Pool } = require("pg");
  const scopePool = new Pool({
    host: LOCAL_DB_HOST,
    port: LOCAL_DB_PORT,
    database: DB_NAME,
    user: SCOPE_ROLE,
    password: scopeReaderPassword,
    ssl: false,
    application_name:
      modules.scopeClient.BALANCE_OBSERVER_SCOPE_POSTGRES_APPLICATION_NAME,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 5_000,
    max: 1,
  });
  const workerPool = new Pool({
    host: LOCAL_DB_HOST,
    port: LOCAL_DB_PORT,
    database: DB_NAME,
    user: WORKER_ROLE,
    password: workerPassword,
    ssl: false,
    application_name:
      modules.commandClient.BALANCE_OBSERVER_POSTGRES_APPLICATION_NAME,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 5_000,
    max: 1,
  });

  try {
    const scopeUser = await scopePool.query("select current_user::text as role_name");
    assert(scopeUser.rows[0]?.role_name === SCOPE_ROLE, "Scope reader direct login");
    pass("Scope reader direct login");

    const workerUser = await workerPool.query("select current_user::text as role_name");
    assert(workerUser.rows[0]?.role_name === WORKER_ROLE, "Worker direct login");
    pass("Worker direct login");

    await assertPgRejects(
      () => scopePool.query("select count(*) from private.custody_providers"),
      "Scope reader direct table read rejected",
    );
    await assertPgRejects(
      () =>
        workerPool.query(
          "select * from private.list_balance_observer_scope_page(null, null, 1)",
        ),
      "Worker scope list execute rejected",
    );
  } finally {
    await scopePool.end().catch(() => undefined);
    await workerPool.end().catch(() => undefined);
  }
}

async function assertRealDatabaseOneShot(modules) {
  const beforeFirstRun = await readDurableSnapshot();
  const firstFactoryCalls = [];
  const firstScopeClient = modules.scopeClient.createBalanceObserverScopeClient(
    createScopePostgresConfig(modules.scopeClient),
  );
  const firstCommandClient =
    modules.commandClient.createBalanceObserverCommandClient(
      createWorkerPostgresConfig(modules.commandClient),
    );
  clientsToClose.add(firstScopeClient);
  clientsToClose.add(firstCommandClient);

  const firstResult = await modules.orchestrator.runCustodyBalanceObserverOneShot({
    scopeClient: firstScopeClient,
    commandClient: firstCommandClient,
    adapterFactory: createRealDbAdapterFactory(modules, firstFactoryCalls),
    identityPolicy: "PRODUCTION",
    pageLimit: 10,
  });
  realDbOneShotRunCount += 1;
  clientsToClose.delete(firstScopeClient);
  clientsToClose.delete(firstCommandClient);

  const afterFirstRun = await readDurableSnapshot();
  const firstCheckpointRows = await readFixtureCheckpointRows();

  assert(firstResult.status === "COMPLETED", "Real DB first run completed");
  pass("Real DB first run completed");
  assert(firstResult.summary.pagesRead === 1, "Real DB first run pages read");
  pass("Real DB first run pages read");
  assert(firstResult.summary.scopesDiscovered === 1, "Real DB first run scope discovered");
  pass("Real DB first run scope discovered");
  assert(firstResult.summary.bindingsDiscovered === 2, "Real DB first run bindings discovered");
  pass("Real DB first run bindings discovered");
  assert(firstResult.summary.workerDatabaseAttempts === 2, "Real DB first run command attempts");
  pass("Real DB first run command attempts");
  assert(firstFactoryCalls.length === 1, "Real DB first run adapter factory once");
  pass("Real DB first run adapter factory once");
  assert(
    afterFirstRun.externalBalanceObservations - beforeFirstRun.externalBalanceObservations === 2,
    "First run observation row delta",
  );
  pass("First run observation row delta");
  assert(
    afterFirstRun.observerCheckpoints - beforeFirstRun.observerCheckpoints === 1,
    "First run checkpoint row delta",
  );
  pass("First run checkpoint row delta");
  assert(firstCheckpointRows.a1?.version === "1", "First run checkpoint created version");
  pass("First run checkpoint created version");
  assert(firstCheckpointRows.a2?.version === "2", "First run checkpoint advanced version");
  pass("First run checkpoint advanced version");
  assert(
    firstCheckpointRows.a2?.observedAt === "2026-08-02 00:00:00.000002+00",
    "First run checkpoint timestamp advanced",
  );
  pass("First run checkpoint timestamp advanced");
  assert(
    (await readDuplicateObservationGroupCount()) === 0,
    "First run duplicate observation groups zero",
  );
  pass("First run duplicate observation groups zero");
  assert(
    unrelatedDurableDelta(beforeFirstRun, afterFirstRun) === 0,
    "First run unrelated durable delta zero",
  );
  pass("First run unrelated durable delta zero");
  assert(
    configurationSnapshotEqual(beforeFirstRun, afterFirstRun),
    "First run configuration mutation zero",
  );
  pass("First run configuration mutation zero");
  assertRealDbSuccessFlags(firstResult, {
    [BINDINGS.a1.id]: {
      checkpointCreated: true,
      checkpointAdvanced: false,
      checkpointVersion: "1",
    },
    [BINDINGS.a2.id]: {
      checkpointCreated: false,
      checkpointAdvanced: true,
      checkpointVersion: "2",
    },
  });

  const beforeReplay = await readDurableSnapshot();
  const replayFactoryCalls = [];
  const replayScopeClient = modules.scopeClient.createBalanceObserverScopeClient(
    createScopePostgresConfig(modules.scopeClient),
  );
  const replayCommandClient =
    modules.commandClient.createBalanceObserverCommandClient(
      createWorkerPostgresConfig(modules.commandClient),
    );
  clientsToClose.add(replayScopeClient);
  clientsToClose.add(replayCommandClient);

  assert(replayScopeClient !== firstScopeClient, "Fresh replay scope client");
  pass("Fresh replay scope client");
  assert(replayCommandClient !== firstCommandClient, "Fresh replay command client");
  pass("Fresh replay command client");

  const replayResult = await modules.orchestrator.runCustodyBalanceObserverOneShot({
    scopeClient: replayScopeClient,
    commandClient: replayCommandClient,
    adapterFactory: createRealDbAdapterFactory(modules, replayFactoryCalls),
    identityPolicy: "PRODUCTION",
    pageLimit: 10,
  });
  realDbOneShotRunCount += 1;
  realDbExactReplayRunCount += 1;
  clientsToClose.delete(replayScopeClient);
  clientsToClose.delete(replayCommandClient);

  const afterReplay = await readDurableSnapshot();
  const replayCheckpointRows = await readFixtureCheckpointRows();

  replayObservationRowDelta =
    afterReplay.externalBalanceObservations - beforeReplay.externalBalanceObservations;
  replayDuplicateObservationDelta = await readDuplicateObservationGroupCount();
  replayCheckpointRowDelta =
    afterReplay.observerCheckpoints - beforeReplay.observerCheckpoints;
  replayCheckpointVersionDelta =
    checkpointVersionSum(replayCheckpointRows) - checkpointVersionSum(firstCheckpointRows);
  replayUnrelatedDurableTableDelta = unrelatedDurableDelta(beforeReplay, afterReplay);

  assert(replayResult.status === "COMPLETED", "Real DB exact replay completed");
  pass("Real DB exact replay completed");
  assert(replayFactoryCalls.length === 1, "Real DB replay adapter factory once");
  pass("Real DB replay adapter factory once");
  assert(replayObservationRowDelta === 0, "Replay observation row delta zero");
  pass("Replay observation row delta zero");
  assert(replayDuplicateObservationDelta === 0, "Replay duplicate observation groups zero");
  pass("Replay duplicate observation groups zero");
  assert(replayCheckpointRowDelta === 0, "Replay checkpoint row delta zero");
  pass("Replay checkpoint row delta zero");
  assert(replayCheckpointVersionDelta === 0, "Replay checkpoint version delta zero");
  pass("Replay checkpoint version delta zero");
  assert(
    replayCheckpointRows.a1?.observedAt === firstCheckpointRows.a1?.observedAt &&
      replayCheckpointRows.a2?.observedAt === firstCheckpointRows.a2?.observedAt,
    "Replay checkpoint timestamp delta zero",
  );
  pass("Replay checkpoint timestamp delta zero");
  assert(replayUnrelatedDurableTableDelta === 0, "Replay unrelated durable delta zero");
  pass("Replay unrelated durable delta zero");
  assert(
    configurationSnapshotEqual(beforeReplay, afterReplay),
    "Replay configuration mutation zero",
  );
  pass("Replay configuration mutation zero");
  assertRealDbSuccessFlags(replayResult, {
    [BINDINGS.a1.id]: {
      checkpointCreated: false,
      checkpointAdvanced: false,
      checkpointVersion: "1",
    },
    [BINDINGS.a2.id]: {
      checkpointCreated: false,
      checkpointAdvanced: false,
      checkpointVersion: "2",
    },
  });
}

function createRealDbAdapterFactory(modules, calls) {
  return (providerRef) => {
    calls.push(providerRef.providerCode);

    return modules.mockAdapter.createMockCustodyObservationAdapter({
      provider: providerRef,
      health: {
        status: "AVAILABLE",
        checkedAt: "2026-08-02T00:00:00.000000Z",
      },
      balances: [
        {
          kind: "SUCCESS",
          binding: BINDINGS.a1.binding,
          identity: {
            kind: "NATIVE",
            value: "p5t04-orchestrator-native-a1",
          },
          observedAvailableUnits: "100",
          observedTotalUnits: "100",
          observedAt: "2026-08-02T00:00:00.000001Z",
          finalizedAt: "2026-08-02T00:00:00.000001Z",
        },
        {
          kind: "SUCCESS",
          binding: BINDINGS.a2.binding,
          identity: {
            kind: "CHECKPOINT",
            value: "p5t04-orchestrator-checkpoint-a2",
          },
          observedAvailableUnits: "250",
          observedTotalUnits: "250",
          observedAt: "2026-08-02T00:00:00.000002Z",
          finalizedAt: "2026-08-02T00:00:00.000002Z",
        },
      ],
    });
  };
}

async function readDurableSnapshot() {
  const raw = await adminSqlScalar(`
    select jsonb_build_object(
      'externalBalanceObservations', (select count(*) from private.external_balance_observations),
      'observerCheckpoints', (select count(*) from private.observer_checkpoints),
      'externalTransactionObservations', (select count(*) from private.external_transaction_observations),
      'reconciliationRuns', (select count(*) from private.reconciliation_runs),
      'reconciliationItems', (select count(*) from private.reconciliation_items),
      'reconciliationItemBindingObservations', (select count(*) from private.reconciliation_item_binding_observations),
      'reconciliationReviewCases', (select count(*) from private.reconciliation_review_cases),
      'reconciliationReviewCaseEvents', (select count(*) from private.reconciliation_review_case_events),
      'custodyConfigAuditEvents', (select count(*) from private.custody_config_audit_events),
      'ledgerAccounts', (select count(*) from private.ledger_accounts),
      'ledgerJournals', (select count(*) from private.ledger_journals),
      'ledgerEntries', (select count(*) from private.ledger_entries),
      'fixtureAssetActiveCount', (
        select count(*)
        from public.supported_assets
        where id = '${ASSETS.a.id}'::uuid
          and status = 'ACTIVE'
      ),
      'fixtureProviderVersionSum', (
        select coalesce(sum(version), 0)
        from private.custody_providers
        where id = '${PROVIDERS.a.id}'::uuid
      ),
      'fixtureBindingVersionSum', (
        select coalesce(sum(version), 0)
        from private.custody_account_bindings
        where id in ('${BINDINGS.a1.id}'::uuid, '${BINDINGS.a2.id}'::uuid)
      )
    )::text;
  `);

  return JSON.parse(raw);
}

async function readFixtureCheckpointRows() {
  const raw = await adminSqlScalar(`
    select jsonb_object_agg(
      case
        when custody_account_binding_id = '${BINDINGS.a1.id}'::uuid then 'a1'
        when custody_account_binding_id = '${BINDINGS.a2.id}'::uuid then 'a2'
      end,
      jsonb_build_object(
        'version', version::text,
        'observedAt', checkpoint_observed_at::text
      )
    )::text
    from private.observer_checkpoints
    where observer_kind = 'BALANCE_OBSERVER_V1'
      and custody_account_binding_id in (
        '${BINDINGS.a1.id}'::uuid,
        '${BINDINGS.a2.id}'::uuid
      );
  `);

  return raw.length === 0 ? {} : JSON.parse(raw);
}

async function readDuplicateObservationGroupCount() {
  return Number(
    await adminSqlScalar(`
      select count(*)::text
      from (
        select custody_account_binding_id, observer_kind, observation_key
        from private.external_balance_observations
        group by custody_account_binding_id, observer_kind, observation_key
        having count(*) > 1
      ) as duplicate_groups;
    `),
  );
}

function unrelatedDurableDelta(before, after) {
  const fields = [
    "externalTransactionObservations",
    "reconciliationRuns",
    "reconciliationItems",
    "reconciliationItemBindingObservations",
    "reconciliationReviewCases",
    "reconciliationReviewCaseEvents",
    "custodyConfigAuditEvents",
    "ledgerAccounts",
    "ledgerJournals",
    "ledgerEntries",
  ];

  return fields.reduce(
    (sum, field) => sum + Math.abs(Number(after[field]) - Number(before[field])),
    0,
  );
}

function configurationSnapshotEqual(before, after) {
  return (
    before.fixtureAssetActiveCount === after.fixtureAssetActiveCount &&
    before.fixtureProviderVersionSum === after.fixtureProviderVersionSum &&
    before.fixtureBindingVersionSum === after.fixtureBindingVersionSum
  );
}

function checkpointVersionSum(rows) {
  return Number(rows.a1?.version ?? 0) + Number(rows.a2?.version ?? 0);
}

function assertRealDbSuccessFlags(result, expectedByBindingId) {
  const outcomes = new Map();

  for (const scopeOutcome of result.outcomes) {
    for (const bindingOutcome of scopeOutcome.bindings) {
      outcomes.set(bindingOutcome.bindingId, bindingOutcome);
    }
  }

  for (const [bindingId, expected] of Object.entries(expectedByBindingId)) {
    const outcome = outcomes.get(bindingId);

    assert(outcome?.ok === true, `Real DB binding ${bindingId} success`);
    pass(`Real DB binding ${bindingId} success`);
    assert(
      outcome.checkpointCreated === expected.checkpointCreated,
      `Real DB binding ${bindingId} checkpointCreated`,
    );
    pass(`Real DB binding ${bindingId} checkpointCreated`);
    assert(
      outcome.checkpointAdvanced === expected.checkpointAdvanced,
      `Real DB binding ${bindingId} checkpointAdvanced`,
    );
    pass(`Real DB binding ${bindingId} checkpointAdvanced`);
    assert(
      outcome.checkpointVersion === expected.checkpointVersion,
      `Real DB binding ${bindingId} checkpointVersion`,
    );
    pass(`Real DB binding ${bindingId} checkpointVersion`);
  }
}

async function assertInputValidationScenarios(orchestrator) {
  const validScope = createFakeScopeClient([page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])]);
  const validCommand = createFakeCommandClient();
  const combinedClient = createCombinedClient();

  await assertRejectsOrchestratorError(
    () => orchestrator.runCustodyBalanceObserverOneShot(null),
    "ORCHESTRATOR_INPUT_INVALID",
    "Input object required",
  );
  await assertRejectsOrchestratorError(
    () =>
      orchestrator.runCustodyBalanceObserverOneShot({
        scopeClient: {},
        commandClient: validCommand,
        adapterFactory: createAdapterFactory(),
        identityPolicy: "PRODUCTION",
      }),
    "ORCHESTRATOR_INPUT_INVALID",
    "Scope client interface required",
  );
  await assertRejectsOrchestratorError(
    () =>
      orchestrator.runCustodyBalanceObserverOneShot({
        scopeClient: validScope,
        commandClient: {},
        adapterFactory: createAdapterFactory(),
        identityPolicy: "PRODUCTION",
      }),
    "ORCHESTRATOR_INPUT_INVALID",
    "Command client interface required",
  );
  await assertRejectsOrchestratorError(
    () =>
      orchestrator.runCustodyBalanceObserverOneShot({
        scopeClient: combinedClient,
        commandClient: combinedClient,
        adapterFactory: createAdapterFactory(),
        identityPolicy: "PRODUCTION",
      }),
    "ORCHESTRATOR_INPUT_INVALID",
    "Same client object rejected",
  );
  await assertRejectsOrchestratorError(
    () =>
      orchestrator.runCustodyBalanceObserverOneShot({
        scopeClient: validScope,
        commandClient: validCommand,
        adapterFactory: null,
        identityPolicy: "PRODUCTION",
      }),
    "ORCHESTRATOR_INPUT_INVALID",
    "Adapter factory function required",
  );
  await assertRejectsOrchestratorError(
    () =>
      orchestrator.runCustodyBalanceObserverOneShot({
        scopeClient: validScope,
        commandClient: validCommand,
        adapterFactory: createAdapterFactory(),
        identityPolicy: "CONTENT",
      }),
    "ORCHESTRATOR_INPUT_INVALID",
    "Identity policy allowlist",
  );

  for (const [label, patch] of [
    ["Page limit minimum", { pageLimit: 0 }],
    ["Page limit maximum", { pageLimit: 201 }],
    ["Discovery pages minimum", { maxDiscoveryPages: 0 }],
    ["Discovery pages maximum", { maxDiscoveryPages: 1001 }],
    ["Provider concurrency minimum", { concurrencyPolicy: { providerConcurrency: 0 } }],
    ["Provider concurrency negative", { concurrencyPolicy: { providerConcurrency: -1 } }],
    ["Provider concurrency fractional", { concurrencyPolicy: { providerConcurrency: 1.5 } }],
    ["Provider concurrency string", { concurrencyPolicy: { providerConcurrency: "2" } }],
    ["Provider concurrency maximum", { concurrencyPolicy: { providerConcurrency: 5 } }],
    ["Scope retry mode", { scopeReadRetryPolicy: { mode: "ALWAYS" } }],
    [
      "Scope retry attempts",
      {
        scopeReadRetryPolicy: {
          mode: "BOUNDED_V1",
          maxAttempts: 4,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0,
        },
      },
    ],
    [
      "Scope retry jitter",
      {
        scopeReadRetryPolicy: {
          mode: "BOUNDED_V1",
          maxAttempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0.75,
        },
      },
    ],
    ["Runtime shape", { runtime: { runWorkUnit: "nope" } }],
  ]) {
    await assertRejectsOrchestratorError(
      () =>
        orchestrator.runCustodyBalanceObserverOneShot({
          scopeClient: createFakeScopeClient([]),
          commandClient: createFakeCommandClient(),
          adapterFactory: createAdapterFactory(),
          identityPolicy: "PRODUCTION",
          ...patch,
        }),
      "ORCHESTRATOR_INPUT_INVALID",
      label,
    );
  }

  for (const [label, providerConcurrency] of [
    ["Invalid concurrency zero side effects", 0],
    ["Invalid concurrency negative side effects", -1],
    ["Invalid concurrency fractional side effects", 1.5],
    ["Invalid concurrency string side effects", "2"],
    ["Invalid concurrency high side effects", 5],
  ]) {
    await assertInvalidConcurrencyNoSideEffects(
      orchestrator,
      providerConcurrency,
      label,
    );
  }

  pass("Invalid inputs perform no run side effects");
}

async function assertInvalidConcurrencyNoSideEffects(
  orchestrator,
  providerConcurrency,
  label,
) {
  const scopeClient = createFakeScopeClient([
    page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])]),
  ]);
  const commandClient = createFakeCommandClient();
  const factoryCalls = [];
  const workerCalls = [];

  await assertRejectsOrchestratorError(
    () =>
      orchestrator.runCustodyBalanceObserverOneShot({
        scopeClient,
        commandClient,
        adapterFactory: createAdapterFactory({ calls: factoryCalls }),
        identityPolicy: "PRODUCTION",
        concurrencyPolicy: { providerConcurrency },
        runtime: { runWorkUnit: successRunner({ calls: workerCalls }) },
      }),
    "ORCHESTRATOR_INPUT_INVALID",
    label,
  );
  assert(scopeClient.listCalls.length === 0, `${label} scope reads zero`);
  pass(`${label} scope reads zero`);
  assert(factoryCalls.length === 0, `${label} factory calls zero`);
  pass(`${label} factory calls zero`);
  assert(workerCalls.length === 0, `${label} worker calls zero`);
  pass(`${label} worker calls zero`);
  assert(commandClient.recordCalls.length === 0, `${label} command calls zero`);
  pass(`${label} command calls zero`);
}

async function assertDiscoveryScenarios(modules) {
  const { orchestrator, scopeClient } = modules;

  {
    const calls = [];
    const fakeScopeClient = createFakeScopeClient(
      [
        page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])], {
          hasMore: true,
          nextCursor: cursorFor(PROVIDERS.a.id, ASSETS.a.id),
        }),
        page([scope(PROVIDERS.a, ASSETS.b, [BINDINGS.b1])]),
      ],
      { onList: (input) => calls.push(input) },
    );
    const factoryCalls = [];
    const result = await runOneShot(orchestrator, {
      scopeClient: fakeScopeClient,
      adapterFactory: createAdapterFactory({ calls: factoryCalls }),
      runtime: { runWorkUnit: successRunner() },
      pageLimit: 1,
    });

    assert(result.status === "COMPLETED", "Multi-page discovery completed");
    pass("Multi-page discovery completed");
    assert(calls[0]?.after === null, "First page starts after null");
    pass("First page starts after null");
    assert(calls[1]?.after?.assetId === ASSETS.a.id, "Second page uses previous cursor");
    pass("Cursor passed to next discovery page");
    assert(factoryCalls.length === 1, "Factory called after discovery");
    pass("Discovery-first factory call");
    assert(result.summary.pagesRead === 2, "Pages read summary");
    pass("Pages read summary");
  }

  await assertDiscoveryFailure(
    orchestrator,
    createFakeScopeClient([{ scopes: [], page: { scopeCount: 1, hasMore: false, nextCursor: null } }]),
    "ORCHESTRATOR_SCOPE_PAGE_INVALID",
    "Invalid page metadata rejected",
  );

  await assertDiscoveryFailure(
    orchestrator,
    createFakeScopeClient([
      page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])], {
        hasMore: true,
        nextCursor: cursorFor(PROVIDERS.a.id, ASSETS.a.id),
      }),
      page([scope(PROVIDERS.a, ASSETS.b, [BINDINGS.b1])], {
        hasMore: true,
        nextCursor: cursorFor(PROVIDERS.a.id, ASSETS.a.id),
      }),
    ]),
    "ORCHESTRATOR_SCOPE_CURSOR_LOOP",
    "Cursor loop rejected",
  );

  await assertDiscoveryFailure(
    orchestrator,
    createFakeScopeClient([
      page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])], {
        hasMore: true,
        nextCursor: cursorFor(PROVIDERS.a.id, ASSETS.a.id),
      }),
    ]),
    "ORCHESTRATOR_DISCOVERY_LIMIT_EXCEEDED",
    "Discovery page limit enforced",
    { maxDiscoveryPages: 1 },
  );

  await assertDiscoveryFailure(
    orchestrator,
    createFakeScopeClient([
      page([
        scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]),
        scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]),
      ]),
    ]),
    "ORCHESTRATOR_SCOPE_DUPLICATE",
    "Duplicate scope rejected",
  );

  await assertDiscoveryFailure(
    orchestrator,
    createFakeScopeClient([
      page([
        scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]),
        scope({ ...PROVIDERS.a, providerType: "INTERNAL_HSM" }, ASSETS.b, [BINDINGS.b1]),
      ]),
    ]),
    "ORCHESTRATOR_PROVIDER_REF_INVALID",
    "Provider ref conflict rejected",
  );

  {
    const fakeScopeClient = createFakeScopeClient(
      [page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])],
      {
        listErrors: [
          new scopeClient.CustodyBalanceObserverScopeClientError(
            "SCOPE_DB_UNAVAILABLE",
            true,
          ),
        ],
      },
    );
    const result = await runOneShot(orchestrator, {
      scopeClient: fakeScopeClient,
      runtime: { runWorkUnit: successRunner() },
      scopeReadRetryPolicy: retryPolicy(),
      scopeReadRetryRuntime: immediateRetryRuntime(),
    });

    assert(result.status === "COMPLETED", "Retryable discovery read succeeds");
    pass("Retryable discovery read succeeds");
    assert(result.summary.scopeReadRetryAttempts === 1, "Discovery retry counted");
    pass("Discovery retry counted");
  }

  {
    const fakeScopeClient = createFakeScopeClient([], {
      listErrors: [
        new scopeClient.CustodyBalanceObserverScopeClientError(
          "SCOPE_COMMAND_REJECTED",
          false,
        ),
      ],
    });
    const result = await runOneShot(orchestrator, {
      scopeClient: fakeScopeClient,
      runtime: { runWorkUnit: successRunner() },
      scopeReadRetryPolicy: retryPolicy(),
      scopeReadRetryRuntime: immediateRetryRuntime(),
    });

    assert(result.status === "FAILED_DISCOVERY", "Non-retryable discovery failure");
    pass("Non-retryable discovery failure");
    assert(result.summary.scopeReadRetryAttempts === 0, "Non-retryable discovery no retry");
    pass("Non-retryable discovery no retry");
  }
}

async function assertExecutionScenarios(modules) {
  const { orchestrator } = modules;

  {
    const factoryCalls = [];
    const runCalls = [];
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient([
        page([
          scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]),
          scope(PROVIDERS.a, ASSETS.b, [BINDINGS.b1]),
          scope(PROVIDERS.b, ASSETS.a, [BINDINGS.c1]),
        ]),
      ]),
      adapterFactory: createAdapterFactory({ calls: factoryCalls }),
      runtime: { runWorkUnit: successRunner({ calls: runCalls }) },
    });

    assert(result.status === "COMPLETED", "Provider execution completed");
    pass("Provider execution completed");
    assert(factoryCalls.length === 2, "One adapter per provider");
    pass("One adapter per provider");
    assert(runCalls.length === 3, "One worker call per scope");
    pass("One worker call per scope");
    assert(
      result.outcomes.map((outcome) => outcome.discoveryIndex).join(",") === "0,1,2",
      "Outcomes remain discovery ordered",
    );
    pass("Deterministic outcome order");
  }

  {
    const sameProviderOrder = [];
    await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient([
        page([
          scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]),
          scope(PROVIDERS.a, ASSETS.b, [BINDINGS.b1]),
        ]),
      ]),
      runtime: {
        runWorkUnit: async ({ workUnit }) => {
          sameProviderOrder.push(`start:${workUnit.assetId}`);
          await sleep(1);
          sameProviderOrder.push(`end:${workUnit.assetId}`);
          return workerResult(workUnit.bindings, "SUCCESS");
        },
      },
    });

    assert(
      sameProviderOrder.join("|") ===
        `start:${ASSETS.a.id}|end:${ASSETS.a.id}|start:${ASSETS.b.id}|end:${ASSETS.b.id}`,
      "Same provider scopes run sequentially",
    );
    pass("Same provider scopes sequential");
  }

  {
    let active = 0;
    let maxActive = 0;
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient([
        page([
          scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]),
          scope(PROVIDERS.b, ASSETS.a, [BINDINGS.c1]),
          scope(PROVIDERS.c, ASSETS.c, [BINDINGS.d1]),
        ]),
      ]),
      concurrencyPolicy: { providerConcurrency: 2 },
      runtime: {
        runWorkUnit: async ({ workUnit }) => {
          void workUnit;
          active += 1;
          maxActive = Math.max(maxActive, active);
          await sleep(5);
          active -= 1;
          return workerResult(workUnit.bindings, "SUCCESS");
        },
      },
    });

    assert(result.status === "COMPLETED", "Bounded provider concurrency completes");
    pass("Bounded provider concurrency completes");
    assert(maxActive > 1 && maxActive <= 2, "Provider concurrency bounded");
    pass("Provider concurrency bounded");
  }

  {
    let active = 0;
    const activeByProvider = new Map();
    const sameProviderMaxByProvider = new Map();
    let barrierResolve;
    const allProvidersStarted = new Promise((resolve) => {
      barrierResolve = resolve;
    });
    const factoryCalls = [];
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient([
        page([
          scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]),
          scope(PROVIDERS.a, ASSETS.b, [BINDINGS.b1]),
          scope(PROVIDERS.b, ASSETS.a, [BINDINGS.c1]),
          scope(PROVIDERS.c, ASSETS.c, [BINDINGS.d1]),
          scope(PROVIDERS.d, ASSETS.d, [BINDINGS.f1]),
        ]),
      ]),
      adapterFactory: createAdapterFactory({ calls: factoryCalls }),
      concurrencyPolicy: { providerConcurrency: 4 },
      runtime: {
        runWorkUnit: async ({ workUnit }) => {
          active += 1;
          maxCrossProviderConcurrency = Math.max(
            maxCrossProviderConcurrency,
            active,
          );
          const providerCode = workUnit.provider.providerCode;
          const providerActive = (activeByProvider.get(providerCode) ?? 0) + 1;
          activeByProvider.set(providerCode, providerActive);
          sameProviderMaxByProvider.set(
            providerCode,
            Math.max(
              sameProviderMaxByProvider.get(providerCode) ?? 0,
              providerActive,
            ),
          );

          if (maxCrossProviderConcurrency === 4) {
            barrierResolve();
          }

          await allProvidersStarted;

          activeByProvider.set(providerCode, providerActive - 1);
          active -= 1;

          return workerResult(workUnit.bindings, "SUCCESS");
        },
      },
    });

    maxSameProviderConcurrency = Math.max(
      ...sameProviderMaxByProvider.values(),
    );

    assert(result.status === "COMPLETED", "Provider concurrency four completed");
    pass("Provider concurrency four completed");
    assert(maxCrossProviderConcurrency === 4, "Provider concurrency four observed");
    pass("Provider concurrency four observed");
    assert(maxSameProviderConcurrency === 1, "Same provider concurrency remains one");
    pass("Same provider concurrency remains one");
    assert(factoryCalls.length === 4, "Provider concurrency four factory calls");
    pass("Provider concurrency four factory calls");
    assert(
      result.outcomes.map((outcome) => outcome.discoveryIndex).join(",") ===
        "0,1,2,3,4",
      "Provider concurrency four discovery order",
    );
    pass("Provider concurrency four discovery order");
  }

  {
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient([
        page([
          scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]),
          scope(PROVIDERS.b, ASSETS.a, [BINDINGS.c1]),
        ]),
      ]),
      adapterFactory: (providerRef) => {
        if (providerRef.providerCode === PROVIDERS.a.providerCode) {
          throw new Error("factory_failed");
        }

        return createAdapter(providerRef);
      },
      runtime: { runWorkUnit: successRunner() },
    });

    assert(result.status === "PARTIAL", "Adapter factory failure is provider scoped");
    pass("Adapter factory failure is provider scoped");
    assert(result.summary.adapterFactoryFailures === 1, "Adapter factory failure counted");
    pass("Adapter factory failure counted");
  }

  {
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient([
        page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])]),
      ]),
      adapterFactory: () => createAdapter(PROVIDERS.b),
      runtime: { runWorkUnit: successRunner() },
    });

    assert(result.status === "PARTIAL", "Adapter provider mismatch fails scope");
    pass("Adapter provider mismatch rejected");
    assert(
      result.outcomes[0]?.bindings[0]?.code === "ADAPTER_FACTORY_RESULT_INVALID",
      "Adapter result invalid code",
    );
    pass("Adapter result invalid code");
  }

  {
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient([
        page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])]),
      ]),
      runtime: { runWorkUnit: async () => ({ outcomes: [], summary: {} }) },
    });

    assert(result.status === "PARTIAL", "Malformed worker result is safe failure");
    pass("Malformed worker result safe failure");
    assert(result.outcomes[0]?.bindings[0]?.code === "WORKER_RESULT_INVALID", "Worker invalid code");
    pass("Worker invalid code");
  }

  {
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient([
        page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])]),
      ]),
      runtime: { runWorkUnit: async () => { throw new Error("raw database detail"); } },
    });

    assert(result.status === "PARTIAL", "Worker throw is safe failure");
    pass("Worker throw safe failure");
    assert(result.outcomes[0]?.bindings[0]?.code === "WORKER_EXECUTION_FAILED", "Worker execution code");
    pass("Worker execution code");
  }
}

async function assertRefreshScenarios(modules) {
  const { orchestrator, scopeClient } = modules;

  {
    const runCalls = [];
    const refreshed = scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1, BINDINGS.a2]);
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient(
        [page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1, BINDINGS.a2])])],
        { refreshScopes: new Map([[scopeKey(PROVIDERS.a.id, ASSETS.a.id), refreshed]]) },
      ),
      runtime: {
        runWorkUnit: async ({ workUnit }) => {
          runCalls.push(workUnit.bindings.map((item) => item.bindingId).join(","));
          if (runCalls.length === 1) {
            return workerResult(workUnit.bindings, (item) =>
              item.bindingId === BINDINGS.a1.id ? "REFRESH" : "SUCCESS",
            );
          }

          return workerResult(workUnit.bindings, "SUCCESS");
        },
      },
    });

    assert(result.status === "COMPLETED", "Refresh rerun completes");
    pass("Refresh rerun completes");
    assert(runCalls.length === 2, "Refresh reruns once");
    pass("Refresh reruns once");
    assert(runCalls[1] === BINDINGS.a1.id, "Refresh reruns affected binding only");
    pass("Refresh reruns affected binding only");
    assert(result.summary.scopeRefreshSucceeded === 1, "Refresh success counted");
    pass("Refresh success counted");
  }

  {
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient(
        [page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])],
        { refreshScopes: new Map([[scopeKey(PROVIDERS.a.id, ASSETS.a.id), null]]) },
      ),
      runtime: { runWorkUnit: refreshRequiredRunner() },
    });

    assert(result.status === "PARTIAL", "Refresh null becomes no longer eligible");
    pass("Refresh no longer eligible");
    assert(result.outcomes[0]?.bindings[0]?.code === "SCOPE_NO_LONGER_ELIGIBLE", "No longer eligible code");
    pass("No longer eligible code");
    assert(result.summary.scopeNoLongerEligible === 1, "No longer eligible counted");
    pass("No longer eligible counted");
  }

  {
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient(
        [page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])],
        {
          refreshErrors: [
            new scopeClient.CustodyBalanceObserverScopeClientError(
              "SCOPE_DB_UNAVAILABLE",
              false,
            ),
          ],
        },
      ),
      runtime: { runWorkUnit: refreshRequiredRunner() },
    });

    assert(result.status === "PARTIAL", "Refresh read failure is partial");
    pass("Refresh read failure partial");
    assert(result.outcomes[0]?.bindings[0]?.code === "SCOPE_REFRESH_FAILED", "Refresh failure code");
    pass("Refresh failure code");
    assert(result.summary.scopeRefreshFailed === 1, "Refresh failure counted");
    pass("Refresh failure counted");
  }

  {
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient(
        [page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])],
        {
          refreshErrors: [
            new scopeClient.CustodyBalanceObserverScopeClientError(
              "SCOPE_DB_UNAVAILABLE",
              true,
            ),
          ],
          refreshScopes: new Map([
            [scopeKey(PROVIDERS.a.id, ASSETS.a.id), scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])],
          ]),
        },
      ),
      runtime: {
        runWorkUnit: (() => {
          let calls = 0;

          return async ({ workUnit }) => {
            calls += 1;
            return calls === 1
              ? workerResult(workUnit.bindings, "REFRESH")
              : workerResult(workUnit.bindings, "SUCCESS");
          };
        })(),
      },
      scopeReadRetryPolicy: retryPolicy(),
      scopeReadRetryRuntime: immediateRetryRuntime(),
    });

    assert(result.status === "COMPLETED", "Retryable refresh read succeeds");
    pass("Retryable refresh read succeeds");
    assert(result.summary.scopeReadRetryAttempts === 1, "Refresh retry counted");
    pass("Refresh retry counted");
  }

  {
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient(
        [page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])],
        {
          refreshScopes: new Map([
            [scopeKey(PROVIDERS.a.id, ASSETS.a.id), scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])],
          ]),
        },
      ),
      runtime: {
        runWorkUnit: async ({ workUnit }) => workerResult(workUnit.bindings, "REFRESH"),
      },
    });

    assert(result.status === "PARTIAL", "Second refresh conflict fails closed");
    pass("Second refresh conflict fails closed");
    assert(result.summary.scopeRefreshFailed === 1, "Second conflict refresh failure counted");
    pass("Second conflict counted");
  }
}

async function assertAbortAndCleanupScenarios(modules) {
  const { orchestrator, scopeClient: scopeClientModule } = modules;

  {
    const controller = new AbortController();
    controller.abort();
    const scopeClient = createFakeScopeClient([page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])]);
    const commandClient = createFakeCommandClient();
    const result = await orchestrator.runCustodyBalanceObserverOneShot({
      scopeClient,
      commandClient,
      adapterFactory: createAdapterFactory(),
      identityPolicy: "PRODUCTION",
      runtime: { runWorkUnit: successRunner() },
      signal: controller.signal,
    });

    assert(result.status === "ABORTED", "Pre-abort returns aborted");
    pass("Pre-abort returns aborted");
    assert(scopeClient.listCalls.length === 0, "Pre-abort no scope read");
    pass("Pre-abort no scope read");
    assert(commandClient.recordCalls.length === 0, "Pre-abort no DB write");
    pass("Pre-abort no DB write");
  }

  {
    const controller = new AbortController();
    const scopeClient = createFakeScopeClient(
      [page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])],
      {
        onList: () => controller.abort(),
      },
    );
    const result = await runOneShot(orchestrator, {
      scopeClient,
      runtime: { runWorkUnit: successRunner() },
      signal: controller.signal,
    });

    assert(result.status === "ABORTED", "Discovery abort returns aborted");
    pass("Discovery abort returns aborted");
    assert(result.summary.scopesStarted === 0, "Discovery abort no worker scopes");
    pass("Discovery abort no worker scopes");
  }

  {
    const controller = new AbortController();
    const factoryCalls = [];
    const workerCalls = [];
    let sleepCalls = 0;
    const scopeClient = createFakeScopeClient([], {
      listErrors: [
        new scopeClientModule.CustodyBalanceObserverScopeClientError(
          "SCOPE_DB_UNAVAILABLE",
          true,
        ),
      ],
    });
    const result = await runOneShot(orchestrator, {
      scopeClient,
      adapterFactory: createAdapterFactory({ calls: factoryCalls }),
      runtime: { runWorkUnit: successRunner({ calls: workerCalls }) },
      scopeReadRetryPolicy: retryPolicy(),
      scopeReadRetryRuntime: {
        randomInteger: () => 0,
        sleep: async (_milliseconds, signal) => {
          sleepCalls += 1;
          controller.abort();
          assert(signal?.aborted === true, "Retry delay receives abort signal");
          pass("Retry delay receives abort signal");
        },
      },
      signal: controller.signal,
    });

    assert(result.status === "ABORTED", "Retry delay abort status");
    pass("Retry delay abort status");
    assert(scopeClient.listCalls.length === 1, "Retry delay abort one scope attempt");
    pass("Retry delay abort one scope attempt");
    assert(result.summary.scopeReadRetryAttempts === 1, "Retry delay abort retry counted");
    pass("Retry delay abort retry counted");
    assert(sleepCalls === 1, "Retry delay abort sleep once");
    pass("Retry delay abort sleep once");
    assert(factoryCalls.length === 0, "Retry delay abort factory zero");
    pass("Retry delay abort factory zero");
    assert(workerCalls.length === 0, "Retry delay abort worker zero");
    pass("Retry delay abort worker zero");
  }

  {
    const controller = new AbortController();
    const factoryCalls = [];
    const workerCalls = [];
    const result = await runOneShot(orchestrator, {
      scopeClient: createFakeScopeClient([
        page([
          scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]),
          scope(PROVIDERS.a, ASSETS.b, [BINDINGS.b1]),
          scope(PROVIDERS.b, ASSETS.a, [BINDINGS.c1]),
        ]),
      ]),
      adapterFactory: createAdapterFactory({ calls: factoryCalls }),
      runtime: {
        runWorkUnit: async ({ workUnit, signal }) => {
          workerCalls.push(workUnit.assetId);
          controller.abort();
          assert(signal?.aborted === true, "Execution abort signal forwarded");
          pass("Execution abort signal forwarded");
          return workerResult(workUnit.bindings, "ABORTED");
        },
      },
      signal: controller.signal,
    });

    assert(result.status === "ABORTED", "Execution abort status");
    pass("Execution abort status");
    assert(workerCalls.length === 1, "Execution abort stops further workers");
    pass("Execution abort stops further workers");
    assert(factoryCalls.length === 1, "Execution abort stops next provider factory");
    pass("Execution abort stops next provider factory");
    assert(
      result.outcomes.every((outcome) => outcome.status === "ABORTED"),
      "Execution abort marks pending scopes",
    );
    pass("Execution abort marks pending scopes");
    assert(
      result.outcomes.map((outcome) => outcome.discoveryIndex).join(",") ===
        "0,1,2",
      "Execution abort preserves discovery order",
    );
    pass("Execution abort preserves discovery order");
  }

  {
    const controller = new AbortController();
    const runCalls = [];
    const refreshedScope = scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1]);
    const scopeClient = createFakeScopeClient(
      [page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])],
      {
        refreshScopes: new Map([
          [scopeKey(PROVIDERS.a.id, ASSETS.a.id), refreshedScope],
        ]),
        onRead: () => controller.abort(),
      },
    );
    const result = await runOneShot(orchestrator, {
      scopeClient,
      runtime: {
        runWorkUnit: async ({ workUnit }) => {
          runCalls.push(workUnit.bindings.map((item) => item.bindingId).join(","));
          return workerResult(workUnit.bindings, "REFRESH");
        },
      },
      signal: controller.signal,
    });

    assert(result.status === "ABORTED", "Refresh abort status");
    pass("Refresh abort status");
    assert(scopeClient.readCalls.length === 1, "Refresh abort exact read once");
    pass("Refresh abort exact read once");
    assert(runCalls.length === 1, "Refresh abort rerun zero");
    pass("Refresh abort rerun zero");
    assert(result.outcomes[0]?.bindings[0]?.status === "ABORTED", "Refresh abort binding aborted");
    pass("Refresh abort binding aborted");
  }

  await assertCloseCombination(orchestrator, {
    label: "Close combination success success",
    scopeCloseThrows: false,
    commandCloseThrows: false,
    expectedStatus: "COMPLETED",
    expectedFailures: 0,
  });
  await assertCloseCombination(orchestrator, {
    label: "Close combination scope failure",
    scopeCloseThrows: true,
    commandCloseThrows: false,
    expectedStatus: "FAILED_CLEANUP",
    expectedFailures: 1,
  });
  await assertCloseCombination(orchestrator, {
    label: "Close combination command failure",
    scopeCloseThrows: false,
    commandCloseThrows: true,
    expectedStatus: "FAILED_CLEANUP",
    expectedFailures: 1,
  });
  await assertCloseCombination(orchestrator, {
    label: "Close combination both failures",
    scopeCloseThrows: true,
    commandCloseThrows: true,
    expectedStatus: "FAILED_CLEANUP",
    expectedFailures: 2,
  });
  await assertCloseCombination(orchestrator, {
    label: "Close combination discovery failure both close failures",
    scopeCloseThrows: true,
    commandCloseThrows: true,
    discoveryFailure: true,
    expectedStatus: "FAILED_CLEANUP",
    expectedFailures: 2,
  });

  {
    const scopeClient = createFakeScopeClient([page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])], {
      closeThrows: true,
    });
    const commandClient = createFakeCommandClient();
    const result = await orchestrator.runCustodyBalanceObserverOneShot({
      scopeClient,
      commandClient,
      adapterFactory: createAdapterFactory(),
      identityPolicy: "PRODUCTION",
      runtime: { runWorkUnit: successRunner() },
    });

    assert(result.status === "FAILED_CLEANUP", "Close failure overrides status");
    pass("Close failure status");
    assert(result.summary.clientCloseAttempts === 2, "Both clients close attempted");
    pass("Both clients close attempted");
    assert(result.summary.clientCloseFailures === 1, "Close failure counted");
    pass("Close failure counted");
    assert(commandClient.closeCalls === 1, "Second client closes after first failure");
    pass("Second client closes after first failure");
  }
}

async function assertCloseCombination(
  orchestrator,
  {
    label,
    scopeCloseThrows,
    commandCloseThrows,
    discoveryFailure = false,
    expectedStatus,
    expectedFailures,
  },
) {
  const scopeClient = createFakeScopeClient(
    discoveryFailure
      ? [{ scopes: [], page: { scopeCount: 1, hasMore: false, nextCursor: null } }]
      : [page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])])],
    {
      closeThrows: scopeCloseThrows,
      closeError: new Error("credential marker close failure"),
    },
  );
  const commandClient = createFakeCommandClient({
    closeThrows: commandCloseThrows,
    closeError: new Error("credential marker command close failure"),
  });
  const result = await orchestrator.runCustodyBalanceObserverOneShot({
    scopeClient,
    commandClient,
    adapterFactory: createAdapterFactory(),
    identityPolicy: "PRODUCTION",
    runtime: { runWorkUnit: successRunner() },
  });

  assert(result.status === expectedStatus, `${label} status`);
  pass(`${label} status`);
  assert(result.summary.clientCloseAttempts === 2, `${label} close attempts`);
  pass(`${label} close attempts`);
  assert(
    result.summary.clientCloseFailures === expectedFailures,
    `${label} close failures`,
  );
  pass(`${label} close failures`);
  assert(scopeClient.closeCalls === 1, `${label} scope close once`);
  pass(`${label} scope close once`);
  assert(commandClient.closeCalls === 1, `${label} command close once`);
  pass(`${label} command close once`);

  if (discoveryFailure) {
    assert(result.outcomes.length === 0, `${label} discovery outcomes preserved`);
    pass(`${label} discovery outcomes preserved`);
  } else {
    assert(result.outcomes.length === 1, `${label} execution outcomes preserved`);
    pass(`${label} execution outcomes preserved`);
  }
}

async function assertRealWorkerIntegration(modules) {
  const { mockAdapter, orchestrator } = modules;
  const commandClient = createFakeCommandClient();
  const observedCommandInputs = commandClient.recordCalls;
  const scopeClient = createFakeScopeClient([
    page([scope(PROVIDERS.a, ASSETS.a, [BINDINGS.a1])]),
  ]);
  const adapterFactory = mockAdapter.createMockCustodyObservationAdapterFactory({
    provider: PROVIDERS.a,
    health: {
      status: "AVAILABLE",
      checkedAt: "2026-01-01T00:00:00.000000Z",
    },
    balances: [
      {
        kind: "SUCCESS",
        binding: BINDINGS.a1.binding,
        identity: {
          kind: "CHECKPOINT",
          value: "checkpoint_identity_p5t04_orchestrator",
        },
        observedAvailableUnits: "100",
        observedTotalUnits: "100",
        observedAt: "2026-01-01T00:00:00.000001Z",
        finalizedAt: "2026-01-01T00:00:00.000001Z",
      },
    ],
  });
  const result = await orchestrator.runCustodyBalanceObserverOneShot({
    scopeClient,
    commandClient,
    adapterFactory,
    identityPolicy: "PRODUCTION",
  });

  assert(result.status === "COMPLETED", "Default worker integration completed");
  pass("Default worker integration completed");
  assert(observedCommandInputs.length === 1, "Real worker calls command once");
  pass("Real worker command call");
  assert(
    observedCommandInputs[0]?.observationKey?.startsWith("balobs:v1:k:"),
    "Checkpoint observation key mode",
  );
  pass("Checkpoint observation key mode");
  assert(
    observedCommandInputs[0]?.observedTotalUnits === "100",
    "Observed total passed to command",
  );
  pass("Observed total passed to command");
}

async function assertDiscoveryFailure(
  orchestrator,
  scopeClient,
  expectedCode,
  label,
  patch = {},
) {
  const result = await runOneShot(orchestrator, {
    scopeClient,
    runtime: { runWorkUnit: successRunner() },
    ...patch,
  });

  assert(result.status === "FAILED_DISCOVERY", label);
  pass(label);
  assert(result.code === expectedCode, `${label} code`);
  pass(`${label} code`);
}

async function runOneShot(orchestrator, patch) {
  return orchestrator.runCustodyBalanceObserverOneShot({
    scopeClient: patch.scopeClient ?? createFakeScopeClient([page([])]),
    commandClient: patch.commandClient ?? createFakeCommandClient(),
    adapterFactory: patch.adapterFactory ?? createAdapterFactory(),
    identityPolicy: patch.identityPolicy ?? "PRODUCTION",
    ...patch,
  });
}

function createFakeScopeClient(pages, options = {}) {
  let listIndex = 0;
  let refreshIndex = 0;

  return {
    listCalls: [],
    readCalls: [],
    closeCalls: 0,
    async listBalanceObserverScopePage(input = {}) {
      const normalized = {
        after: input.after ?? null,
        limit: input.limit ?? null,
      };
      this.listCalls.push(normalized);
      options.onList?.(normalized);

      const error = options.listErrors?.[listIndex];
      if (error) {
        listIndex += 1;
        throw error;
      }

      const current = pages[listIndex] ?? page([]);
      listIndex += 1;
      return current;
    },
    async readBalanceObserverScope(input) {
      this.readCalls.push({ ...input });
      options.onRead?.(input);

      const error = options.refreshErrors?.[refreshIndex];
      if (error) {
        refreshIndex += 1;
        throw error;
      }

      refreshIndex += 1;
      return options.refreshScopes?.get(scopeKey(input.providerId, input.assetId)) ?? null;
    },
    async close() {
      this.closeCalls += 1;

      if (options.closeThrows) {
        throw options.closeError ?? new Error("close_failed");
      }
    },
  };
}

function createFakeCommandClient(options = {}) {
  return {
    recordCalls: [],
    closeCalls: 0,
    async recordBalanceObservationAndAdvanceCheckpoint(input) {
      this.recordCalls.push({ ...input });

      if (options.recordThrows) {
        throw options.recordThrows;
      }

      return {
        externalBalanceObservationId: "00000000-0000-4000-8000-000000779001",
        observationCreated: true,
        observerCheckpointId: "00000000-0000-4000-8000-000000779002",
        checkpointCreated: false,
        checkpointAdvanced: true,
        checkpointVersion: "2",
      };
    },
    async close() {
      this.closeCalls += 1;

      if (options.closeThrows) {
        throw options.closeError ?? new Error("command_close_failed");
      }
    },
  };
}

function createCombinedClient() {
  return {
    async listBalanceObserverScopePage() {
      return page([]);
    },
    async readBalanceObserverScope() {
      return null;
    },
    async recordBalanceObservationAndAdvanceCheckpoint() {
      return {
        externalBalanceObservationId: "00000000-0000-4000-8000-000000779003",
        observationCreated: true,
        observerCheckpointId: "00000000-0000-4000-8000-000000779004",
        checkpointCreated: false,
        checkpointAdvanced: true,
        checkpointVersion: "2",
      };
    },
    async close() {},
  };
}

async function setupDatabaseFixtures() {
  await adminSql(`
    insert into public.supported_assets (
      id,
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals,
      mint_address,
      status
    )
    values (
      '${ASSETS.a.id}',
      '${ASSETS.a.assetCode}',
      'P4OA',
      'P5 T04 Orchestrator Asset A',
      'NATIVE',
      9,
      null,
      'ACTIVE'
    );

    insert into private.custody_providers (
      id,
      provider_code,
      display_name,
      provider_type,
      supports_balance_observation,
      supports_transfer_observation,
      supports_transfer_lookup,
      supports_payout_submission,
      supports_webhook_ingestion
    )
    values (
      '${PROVIDERS.a.id}',
      '${PROVIDERS.a.providerCode}',
      'P5 T04 Orchestrator Provider A',
      '${PROVIDERS.a.providerType}',
      true,
      false,
      false,
      false,
      false
    );

    update private.custody_providers
    set status = 'APPROVED'
    where id = '${PROVIDERS.a.id}';

    insert into private.custody_account_bindings (
      id,
      custody_provider_id,
      asset_id,
      binding_key,
      display_label,
      account_role
    )
    values
      (
        '${BINDINGS.a1.id}',
        '${PROVIDERS.a.id}',
        '${ASSETS.a.id}',
        '${BINDINGS.a1.binding.bindingKey}',
        '${BINDINGS.a1.binding.bindingKey}',
        '${BINDINGS.a1.binding.accountRole}'
      ),
      (
        '${BINDINGS.a2.id}',
        '${PROVIDERS.a.id}',
        '${ASSETS.a.id}',
        '${BINDINGS.a2.binding.bindingKey}',
        '${BINDINGS.a2.binding.bindingKey}',
        '${BINDINGS.a2.binding.accountRole}'
      );

    update private.custody_account_bindings
    set status = 'APPROVED'
    where id in (
      '${BINDINGS.a1.id}',
      '${BINDINGS.a2.id}'
    );

    insert into private.observer_checkpoints (
      custody_account_binding_id,
      observer_kind,
      checkpoint_value,
      checkpoint_observed_at,
      version
    )
    values (
      '${BINDINGS.a2.id}',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:k:' || repeat('0', 64),
      '2026-08-01 00:00:00+00'::timestamptz,
      1
    );
  `);
  pass("Synthetic DB fixtures");
}

async function setScopeReaderCredential(value) {
  await adminSql(`alter role ${SCOPE_ROLE} password ${quoteSqlLiteral(value)};`);
  pass("Ephemeral scope credential set");
}

async function clearScopeReaderCredential() {
  if (scopeReaderPassword === null) {
    return;
  }

  try {
    await adminSql(`alter role ${SCOPE_ROLE} password null;`);
    pass("Ephemeral scope credential cleared");
  } catch {
    console.error("WARN_SCOPE_CREDENTIAL_CLEAR_RETRY_REQUIRED");
  } finally {
    scopeReaderPassword = null;
  }
}

async function setWorkerPassword(value) {
  await adminSql(`alter role ${WORKER_ROLE} password ${quoteSqlLiteral(value)};`);
  pass("Ephemeral worker credential set");
}

async function clearWorkerPassword() {
  if (workerPassword === null) {
    return;
  }

  try {
    await adminSql(`alter role ${WORKER_ROLE} password null;`);
    pass("Ephemeral worker credential cleared");
  } catch {
    console.error("WARN_WORKER_CREDENTIAL_CLEAR_RETRY_REQUIRED");
  } finally {
    workerPassword = null;
  }
}

async function runCleanupResetAndStop() {
  try {
    await runNpmScript("db:reset:local", "Final DB reset", 180_000);
    const residue = await adminSqlScalar(`
      select (
        (select count(*) from public.supported_assets where asset_code like 'P5T04_ORCH_%') +
        (select count(*) from private.custody_providers where provider_code like 'P5T04_ORCH_%') +
        (select count(*) from private.custody_account_bindings where binding_key like 'p5t04_orch_%')
      )::text;
    `);

    assert(residue === "0", "Fixture residue zero");
    pass("Fixture cleanup");
  } finally {
    await runNpmScript("supabase:stop", "Supabase stop", 120_000);
  }
}

function createScopePostgresConfig(scopeClientModule) {
  return {
    host: LOCAL_DB_HOST,
    port: LOCAL_DB_PORT,
    database: DB_NAME,
    user: SCOPE_ROLE,
    password: scopeReaderPassword,
    ssl: false,
    ...scopeClientModule.DEFAULT_CUSTODY_OBSERVER_SCOPE_POSTGRES_LIMITS,
  };
}

function createWorkerPostgresConfig(commandClientModule) {
  return {
    host: LOCAL_DB_HOST,
    port: LOCAL_DB_PORT,
    database: DB_NAME,
    user: WORKER_ROLE,
    password: workerPassword,
    ssl: false,
    ...commandClientModule.DEFAULT_CUSTODY_OBSERVER_POSTGRES_LIMITS,
  };
}

function createAdapterFactory(options = {}) {
  return (providerRef) => {
    options.calls?.push(providerRef);
    return createAdapter(providerRef);
  };
}

function createAdapter(providerRef) {
  return {
    provider: providerRef,
    async readBalances() {
      providerNetworkCalls += 1;
      return [];
    },
  };
}

function successRunner(options = {}) {
  return async ({ workUnit }) => {
    options.calls?.push({
      providerCode: workUnit.provider.providerCode,
      assetId: workUnit.assetId,
      bindings: workUnit.bindings.map((item) => item.bindingId),
    });

    return workerResult(workUnit.bindings, "SUCCESS");
  };
}

function refreshRequiredRunner() {
  return async ({ workUnit }) => workerResult(workUnit.bindings, "REFRESH");
}

function workerResult(bindings, mode) {
  const outcomes = bindings.map((item) => {
    const resolved = typeof mode === "function" ? mode(item) : mode;

    if (resolved === "SUCCESS") {
      return successOutcome(item.bindingId);
    }

    if (resolved === "ABORTED") {
      return failureOutcome(item.bindingId, "ABORTED", "ORCHESTRATOR_ABORTED", true, false);
    }

    return failureOutcome(
      item.bindingId,
      "DATABASE",
      "CHECKPOINT_VERSION_CONFLICT",
      true,
      true,
    );
  });

  return {
    outcomes,
    summary: workerSummary(outcomes),
  };
}

function successOutcome(bindingId) {
  return {
    ok: true,
    bindingId,
    observationCreated: true,
    checkpointCreated: false,
    checkpointAdvanced: true,
    checkpointVersion: "2",
    adapterAttempts: 1,
    databaseAttempts: 1,
  };
}

function failureOutcome(
  bindingId,
  stage,
  code,
  retryable,
  requiresScopeRefresh,
) {
  return {
    ok: false,
    bindingId,
    stage,
    code,
    retryable,
    adapterAttempts: 1,
    databaseAttempts: stage === "DATABASE" ? 1 : 0,
    retryExhausted: false,
    retryDeferred: false,
    retryAfterMs: null,
    requiresScopeRefresh,
  };
}

function workerSummary(outcomes) {
  return {
    requestedBindings: outcomes.length,
    adapterSuccesses: outcomes.length,
    adapterFailures: 0,
    databaseAttempts: outcomes.reduce((sum, outcome) => sum + outcome.databaseAttempts, 0),
    persistedObservations: outcomes.filter((outcome) => outcome.ok).length,
    replayedObservations: 0,
    checkpointsCreated: outcomes.filter((outcome) => outcome.ok && outcome.checkpointCreated).length,
    checkpointsAdvanced: outcomes.filter((outcome) => outcome.ok && outcome.checkpointAdvanced).length,
    checkpointNoops: 0,
    failedBindings: outcomes.filter((outcome) => !outcome.ok && outcome.stage !== "ABORTED").length,
    abortedBindings: outcomes.filter((outcome) => !outcome.ok && outcome.stage === "ABORTED").length,
    adapterAttempts: outcomes.reduce((sum, outcome) => sum + outcome.adapterAttempts, 0),
    adapterRetryAttempts: 0,
    databaseRetryAttempts: 0,
    retryExhaustedBindings: 0,
    retryDeferredBindings: 0,
    scopeRefreshRequiredBindings: outcomes.filter(
      (outcome) => !outcome.ok && outcome.requiresScopeRefresh,
    ).length,
    timeoutFailures: 0,
    lockTimeoutFailures: 0,
    unavailableFailures: 0,
  };
}

function page(scopes, metadata = {}) {
  return {
    scopes,
    page: {
      scopeCount: scopes.length,
      hasMore: metadata.hasMore ?? false,
      nextCursor: metadata.nextCursor ?? null,
    },
  };
}

function scope(providerRef, assetRef, discoveredBindings) {
  return {
    providerId: providerRef.id,
    provider: {
      providerCode: providerRef.providerCode,
      providerType: providerRef.providerType,
      capabilities: providerRef.capabilities,
    },
    assetId: assetRef.id,
    assetCode: assetRef.assetCode,
    bindings: discoveredBindings.map((item) => ({
      bindingId: item.id,
      assetId: assetRef.id,
      binding: item.binding,
      expectedCheckpointVersion: "1",
    })),
  };
}

function provider(idOrCode, providerType = "MPC_CUSTODIAN") {
  const providerCode = idOrCode.startsWith("00000000-")
    ? "P5T04_ORCH_PROVIDER"
    : idOrCode;

  return {
    id: idOrCode.startsWith("00000000-")
      ? idOrCode
      : providerIdForCode(providerCode),
    providerCode,
    providerType,
    capabilities: ["BALANCE_OBSERVATION"],
  };
}

function asset(id, assetCode) {
  return { id, assetCode };
}

function binding(id, providerRef, assetRef, bindingKey, accountRole = "COLLECTION") {
  return {
    id,
    binding: {
      providerCode: providerRef.providerCode,
      bindingKey,
      assetCode: assetRef.assetCode,
      accountRole,
    },
  };
}

function providerIdForCode(providerCode) {
  if (providerCode.endsWith("_A")) {
    return "00000000-0000-4000-8000-000000770201";
  }

  if (providerCode.endsWith("_B")) {
    return "00000000-0000-4000-8000-000000770202";
  }

  if (providerCode.endsWith("_C")) {
    return "00000000-0000-4000-8000-000000770203";
  }

  return "00000000-0000-4000-8000-000000770204";
}

function cursorFor(providerId, assetId) {
  return { providerId, assetId };
}

function scopeKey(providerId, assetId) {
  return `${providerId}:${assetId}`;
}

function retryPolicy() {
  return {
    mode: "BOUNDED_V1",
    maxAttempts: 2,
    baseDelayMs: 1,
    maxDelayMs: 1,
    jitterRatio: 0,
  };
}

function immediateRetryRuntime() {
  return {
    randomInteger: () => 0,
    sleep: async () => {},
  };
}

function createCredentialEnvGuard(originalEnv) {
  return new Proxy(originalEnv, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && isCredentialEnvName(prop)) {
        credentialEnvReads += 1;
        throw new Error("credential_env_read_blocked");
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

function installLocalNetworkGuard() {
  const originals = {
    fetch: globalThis.fetch,
    httpRequest: http.request,
    httpsRequest: https.request,
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    netSocketConnect: net.Socket.prototype.connect,
  };

  globalThis.fetch = guardedExternalNetwork("fetch", originals.fetch);
  http.request = guardedExternalNetwork("http.request", originals.httpRequest);
  https.request = guardedExternalNetwork("https.request", originals.httpsRequest);
  net.connect = guardedSocketFactory("net.connect", originals.netConnect);
  net.createConnection = guardedSocketFactory(
    "net.createConnection",
    originals.netCreateConnection,
  );
  net.Socket.prototype.connect = function guardedSocketConnect(...args) {
    const target = normalizeSocketTarget(args);

    if (isAllowedPostgresTarget(target)) {
      localPostgresConnections += 1;
      return originals.netSocketConnect.apply(this, args);
    }

    externalNetworkCalls += 1;
    throw new Error("net.Socket.connect_blocked");
  };

  return originals;
}

function restoreLocalNetworkGuard() {
  if (!networkGuard) {
    return;
  }

  globalThis.fetch = networkGuard.fetch;
  http.request = networkGuard.httpRequest;
  https.request = networkGuard.httpsRequest;
  net.connect = networkGuard.netConnect;
  net.createConnection = networkGuard.netCreateConnection;
  net.Socket.prototype.connect = networkGuard.netSocketConnect;
  networkGuard = null;
}

function guardedExternalNetwork(label, original) {
  return function guardedNetworkCall() {
    externalNetworkCalls += 1;
    throw new Error(`${label}_blocked`);
  }.bind(original);
}

function guardedSocketFactory(label, original) {
  return function guardedSocketFactoryCall(...args) {
    const target = normalizeSocketTarget(args);

    if (isAllowedPostgresTarget(target)) {
      localPostgresConnections += 1;
      return original.apply(this, args);
    }

    externalNetworkCalls += 1;
    throw new Error(`${label}_blocked`);
  };
}

function normalizeSocketTarget(args) {
  const first = args[0];

  if (typeof first === "object" && first !== null) {
    return {
      host: first.host ?? first.hostname ?? "localhost",
      port: first.port,
    };
  }

  if (typeof first === "number") {
    return {
      host: typeof args[1] === "string" ? args[1] : "localhost",
      port: first,
    };
  }

  return {
    host: "localhost",
    port: null,
  };
}

function isAllowedPostgresTarget(target) {
  return (
    Number(target.port) === LOCAL_DB_PORT &&
    (target.host === LOCAL_DB_HOST || target.host === "localhost")
  );
}

async function closeClients() {
  for (const client of clientsToClose) {
    try {
      await client.close();
    } catch {
      console.error("WARN_ORCHESTRATOR_CLIENT_CLOSE_RETRY_REQUIRED");
    }
  }

  clientsToClose.clear();
}

async function adminSqlScalar(sql) {
  const stdout = await adminSql(sql);

  return stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

async function adminSql(sql) {
  const result = await execFileWithInput(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    `${sql}\n`,
    20_000,
  );

  assertSafeText(result.stdout, "SQL stdout");
  assertSafeText(result.stderr, "SQL stderr");

  return result.stdout;
}

async function runNpmScript(scriptName, label, timeoutMs) {
  const command =
    process.platform === "win32"
      ? {
          file: "cmd.exe",
          args: ["/c", "npm", "--silent", "run", scriptName],
        }
      : {
          file: "npm",
          args: ["--silent", "run", scriptName],
        };

  await execFileWithInput(command.file, command.args, null, timeoutMs);
  pass(label);
}

function execFileWithInput(file, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("child_process_timeout"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (code !== 0) {
        reject(new Error(`child_process_failed ${redactDiagnostic(stderr || stdout)}`));
        return;
      }

      resolve({ stdout, stderr });
    });

    if (input === null) {
      child.stdin.end();
    } else {
      child.stdin.end(input);
    }
  });
}

async function assertPgRejects(callback, label) {
  try {
    await callback();
  } catch {
    pass(label);
    return;
  }

  throw new Error(`ASSERTION_FAILED: ${label}`);
}

function quoteSqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function createEphemeralPassword() {
  return randomBytes(32).toString("base64url");
}

async function cleanupRuntimeModules() {
  if (!tempRuntimeDir) {
    return;
  }

  const dir = tempRuntimeDir;
  tempRuntimeDir = null;
  await rm(dir, { recursive: true, force: true });
}

async function assertRejectsOrchestratorError(action, expectedCode, label) {
  try {
    await action();
  } catch (error) {
    assert(
      error?.name === "CustodyBalanceObserverOrchestratorError",
      `${label} throws orchestrator error`,
    );
    pass(`${label} throws orchestrator error`);
    assert(error?.code === expectedCode, `${label} error code`);
    pass(`${label} error code`);
    assert(
      error?.message === "custody_balance_observer_orchestrator_failed",
      `${label} safe error message`,
    );
    pass(`${label} safe error message`);
    return;
  }

  throw new Error(`${label}: expected orchestrator error`);
}

function assertSafeOutput() {
  const output = emittedLines.join("\n");
  const forbidden = [
    /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
    /anon[_-]?key/i,
    /database[_-]?url/i,
    /password=/i,
    /cookie/i,
    /mnemonic/i,
    /private[_-]?key/i,
    /checkpoint_identity_p5t04_orchestrator/,
  ];

  for (const pattern of forbidden) {
    assert(!pattern.test(output), `Safe output excludes ${pattern.source}`);
  }

  pass("Safe output scan");
}

function assertSafeText(text, label) {
  assert(
    !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text),
    `${label} has no JWT`,
  );
  assert(!/postgres(?:ql)?:\/\/\S+/i.test(text), `${label} has no DB URL`);
  assert(
    !/sb_(secret|publishable)_[A-Za-z0-9_-]{20,}/.test(text),
    `${label} has no Supabase key`,
  );
}

function redactDiagnostic(value) {
  return value
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]")
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
}

function isCredentialEnvName(name) {
  return /(SUPABASE|SERVICE|DATABASE|PASSWORD|TOKEN|JWT|COOKIE|SECRET|KEY|MNEMONIC|SEED|PRIVATE)/i.test(
    name,
  );
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`ASSERTION_FAILED: ${label}`);
  }
}

function pass(label) {
  runtimeCaseCount += 1;
  emittedLines.push(`PASS ${label}`);
  console.log(`PASS ${label}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(redactDiagnostic(message));
  process.exitCode = 1;
});
