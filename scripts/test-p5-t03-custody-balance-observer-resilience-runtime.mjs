import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import tls from "node:tls";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const ts = require("typescript");

const DB_CONTAINER = "supabase_db_staking-wallet-web";
const LOCAL_DB_HOST = "127.0.0.1";
const LOCAL_DB_PORT = 55722;
const DB_NAME = "postgres";
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
    sourcePath: "src/server/custody/mock-balance-observation-adapter.ts",
    outputName: "mock-balance-observation-adapter.js",
  },
  {
    sourcePath: "src/server/custody/balance-observer-command-client.ts",
    outputName: "balance-observer-command-client.js",
  },
  {
    sourcePath: "src/server/custody/balance-observer-retry.ts",
    outputName: "balance-observer-retry.js",
  },
  {
    sourcePath: "src/server/custody/balance-observer-worker.ts",
    outputName: "balance-observer-worker.js",
  },
];

const PROVIDER = {
  providerCode: "P5T03_RESILIENCE_PROVIDER",
  providerType: "MPC_CUSTODIAN",
  capabilities: ["BALANCE_OBSERVATION"],
};

const ASSETS = {
  primary: asset("00000000-0000-4000-8000-0000005a0101", "P5T03_RES_ASSET_A"),
  secondary: asset("00000000-0000-4000-8000-0000005a0102", "P5T03_RES_ASSET_B"),
};

let nextBindingAssetOrdinal = 1;

const BINDINGS = {
  providerTimeout: binding(
    "00000000-0000-4000-8000-0000005a0301",
    ASSETS.primary,
    "p5t03_res_provider_timeout",
    "COLLECTION",
  ),
  rateLimited: binding(
    "00000000-0000-4000-8000-0000005a0302",
    ASSETS.primary,
    "p5t03_res_rate_limited",
    "TREASURY",
  ),
  retryDeferred: binding(
    "00000000-0000-4000-8000-0000005a0303",
    ASSETS.primary,
    "p5t03_res_retry_deferred",
    "COLLECTION",
  ),
  unavailableExhausted: binding(
    "00000000-0000-4000-8000-0000005a0304",
    ASSETS.primary,
    "p5t03_res_unavailable_exhausted",
    "TREASURY",
  ),
  unsupported: binding(
    "00000000-0000-4000-8000-0000005a0305",
    ASSETS.primary,
    "p5t03_res_unsupported",
    "PAYOUT",
  ),
  malformedAmount: binding(
    "00000000-0000-4000-8000-0000005a0306",
    ASSETS.primary,
    "p5t03_res_malformed_amount",
    "FEE",
  ),
  dbTransient: binding(
    "00000000-0000-4000-8000-0000005a0307",
    ASSETS.primary,
    "p5t03_res_db_transient",
    "COLLECTION",
  ),
  ambiguousCommit: binding(
    "00000000-0000-4000-8000-0000005a0308",
    ASSETS.primary,
    "p5t03_res_ambiguous_commit",
    "TREASURY",
  ),
  sameObservation: binding(
    "00000000-0000-4000-8000-0000005a0309",
    ASSETS.primary,
    "p5t03_res_same_observation",
    "COLLECTION",
  ),
  competingObservation: binding(
    "00000000-0000-4000-8000-0000005a0310",
    ASSETS.primary,
    "p5t03_res_competing_observation",
    "TREASURY",
  ),
  differentA: binding(
    "00000000-0000-4000-8000-0000005a0311",
    ASSETS.primary,
    "p5t03_res_different_a",
    "COLLECTION",
  ),
  differentB: binding(
    "00000000-0000-4000-8000-0000005a0312",
    ASSETS.primary,
    "p5t03_res_different_b",
    "TREASURY",
  ),
  lockTimeout: binding(
    "00000000-0000-4000-8000-0000005a0313",
    ASSETS.primary,
    "p5t03_res_lock_timeout",
    "COLLECTION",
  ),
  statementTimeout: binding(
    "00000000-0000-4000-8000-0000005a0314",
    ASSETS.primary,
    "p5t03_res_statement_timeout",
    "TREASURY",
  ),
  queryTimeout: binding(
    "00000000-0000-4000-8000-0000005a0315",
    ASSETS.primary,
    "p5t03_res_query_timeout",
    "COLLECTION",
  ),
  abortAdapter: binding(
    "00000000-0000-4000-8000-0000005a0316",
    ASSETS.primary,
    "p5t03_res_abort_adapter",
    "TREASURY",
  ),
  abortBackoff: binding(
    "00000000-0000-4000-8000-0000005a0317",
    ASSETS.primary,
    "p5t03_res_abort_backoff",
    "COLLECTION",
  ),
  abortDbRetry: binding(
    "00000000-0000-4000-8000-0000005a0318",
    ASSETS.primary,
    "p5t03_res_abort_db_retry",
    "TREASURY",
  ),
  invalidPolicy: binding(
    "00000000-0000-4000-8000-0000005a0319",
    ASSETS.secondary,
    "p5t03_res_invalid_policy",
    "COLLECTION",
  ),
};

let runtimeCaseCount = 0;
let externalNetworkCalls = 0;
let providerNetworkCalls = 0;
let localPostgresConnections = 0;
let credentialEnvReads = 0;
let tempRuntimeDir = null;
let workerPassword = null;
let commandClient = null;
let networkGuard = null;
let moduleLoadGuard = null;
const emittedLines = [];
const allowedLocalPorts = new Set([LOCAL_DB_PORT]);

async function main() {
  const originalEnv = process.env;

  try {
    await assertSourceBoundaries();
    const modules = await loadRuntimeModules();
    await runNpmScript("supabase:start", "Supabase start", 120_000);
    await runNpmScript("db:reset:local", "Initial DB reset", 180_000);
    await setupDatabaseFixtures();
    workerPassword = createEphemeralPassword();
    await setWorkerPassword(workerPassword);
    networkGuard = installLocalNetworkGuard();
    process.env = createCredentialEnvGuard(originalEnv);

    await assertRetryHelper(modules.retry);
    await assertDirectWorkerPrivileges(modules);
    commandClient = modules.commandClient.createBalanceObserverCommandClient(
      createWorkerPostgresConfig(modules.commandClient),
    );

    await assertProviderRetryScenarios(modules, commandClient);
    await assertDatabaseRetryScenarios(modules, commandClient);
    await assertConcurrencyScenarios(modules);
    await assertTimeoutScenarios(modules);
    await assertConnectionFailure(modules);
    await assertAbortRetryScenarios(modules, commandClient);

    assert(localPostgresConnections >= 2, "Local PostgreSQL connection count");
    pass("Local PostgreSQL network allowlist");
    assert(externalNetworkCalls === 0, "External network calls zero");
    pass("External network guard");
    assert(providerNetworkCalls === 0, "Provider network calls zero");
    pass("Provider network guard");
    assert(credentialEnvReads === 0, "Credential environment reads zero");
    pass("Credential environment read guard");
  } finally {
    process.env = originalEnv;
    restoreLocalNetworkGuard();
    await closeCommandClient();
    await clearWorkerPassword();
    await runCleanupResetAndStop();
    restoreModuleLoadGuard();
    await cleanupRuntimeModules();
  }

  assert(!tempRuntimeDir || !existsSync(tempRuntimeDir), "Temp runtime cleanup");
  pass("Temp runtime cleanup");
  assertSafeOutput();

  console.log(`RESILIENCE_RUNTIME_CASE_COUNT=${runtimeCaseCount}`);
  console.log(`LOCAL_POSTGRES_CONNECTIONS=${localPostgresConnections}`);
  console.log(`EXTERNAL_NETWORK_CALLS=${externalNetworkCalls}`);
  console.log(`PROVIDER_NETWORK_CALLS=${providerNetworkCalls}`);
  console.log(`CREDENTIAL_ENV_READS=${credentialEnvReads}`);
  console.log("CUSTODY_BALANCE_OBSERVER_RESILIENCE_RUNTIME_PASS");
}

async function assertRetryHelper(retry) {
  const policy = retry.DEFAULT_CUSTODY_BALANCE_OBSERVER_RETRY_POLICY;

  assert(policy.mode === "BOUNDED_V1", "Retry default mode");
  pass("Retry policy default mode");
  assert(policy.maxAttempts === 3, "Retry default attempts");
  pass("Retry policy default attempts");
  assert(policy.baseDelayMs === 250 && policy.maxDelayMs === 4000, "Retry default delays");
  pass("Retry policy default delays");
  assert(policy.jitterRatio === 0.2 && policy.maxRetryAfterMs === 30000, "Retry default jitter");
  pass("Retry policy default jitter");

  const normalized = retry.normalizeCustodyBalanceObserverRetryPolicy({
    mode: "BOUNDED_V1",
    maxAttempts: 3,
    baseDelayMs: 10,
    maxDelayMs: 100,
    jitterRatio: 0.2,
    maxRetryAfterMs: 200,
  });
  const delay = retry.calculateRetryDelayDecision({
    policy: normalized,
    retryIndex: 2,
    retryAfterMs: 25,
    randomInteger: () => 0,
  });

  assert(delay.delayMs >= 25 && !delay.retryDeferred, "Retry-After max delay");
  pass("Retry-After effective delay");
  const deferred = retry.calculateRetryDelayDecision({
    policy: normalized,
    retryIndex: 1,
    retryAfterMs: 201,
    randomInteger: () => 0,
  });

  assert(deferred.retryDeferred && deferred.delayMs === 0, "Retry-After deferred");
  pass("Retry-After deferred decision");
  await assertRetryPolicyInvalid(retry, { mode: "BOUNDED_V1", maxAttempts: 0 });
  await assertRetryPolicyInvalid(retry, { mode: "BOUNDED_V1", maxAttempts: 3, baseDelayMs: "1" });
  await assertRetryPolicyInvalid(retry, { mode: "BOUNDED_V1", maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 0 });
  await assertRetryPolicyInvalid(retry, { mode: "BOUNDED_V1", maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterRatio: Number.NaN });
  pass("Retry policy invalid rejection");
}

async function assertRetryPolicyInvalid(retry, policy) {
  try {
    retry.normalizeCustodyBalanceObserverRetryPolicy(policy);
  } catch {
    return;
  }

  throw new Error("FAIL retry policy invalid");
}

async function assertDirectWorkerPrivileges(modules) {
  const { Pool } = require("pg");
  const pool = new Pool({
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
    const currentUser = await pool.query("select current_user::text as role_name");

    assert(currentUser.rows[0]?.role_name === WORKER_ROLE, "Worker direct login");
    pass("Worker role direct login");
    await assertRejects(
      () => pool.query("select count(*) from private.custody_providers"),
      "Direct private table SELECT rejected",
    );
    pass("Direct private table SELECT rejected");
  } finally {
    await pool.end();
  }
}

async function assertProviderRetryScenarios(modules, client) {
  const { createMockCustodyObservationAdapter } = modules.mockAdapter;
  const { runCustodyBalanceObserverWorkUnit } = modules.worker;

  const timeoutRuntime = deterministicRetryRuntime();
  const timeoutResult = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.providerTimeout, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [],
      balanceAttemptSequences: [
        {
          binding: BINDINGS.providerTimeout.binding,
          attempts: [
            errorFixture(BINDINGS.providerTimeout, "TIMEOUT"),
            successFixture(BINDINGS.providerTimeout, { kind: "CONTENT" }, "10", "10", "2026-08-01T01:00:00.000000Z"),
          ],
        },
      ],
    }),
    commandClient: client,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: timeoutRuntime.runtime,
  });

  assertSingleSuccess(timeoutResult, { adapterAttempts: 2, databaseAttempts: 1 });
  assert(timeoutResult.summary.adapterRetryAttempts === 1, "Provider timeout retry count");
  pass("Provider TIMEOUT retry success");
  pass("Adapter retry granularity binding");

  const rateRuntime = deterministicRetryRuntime();
  const rateResult = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.rateLimited, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [],
      balanceAttemptSequences: [
        {
          binding: BINDINGS.rateLimited.binding,
          attempts: [
            errorFixture(BINDINGS.rateLimited, "RATE_LIMITED", 25),
            successFixture(BINDINGS.rateLimited, { kind: "CHECKPOINT", value: "p5t03-res-rate-checkpoint" }, "20", "20", "2026-08-01T01:10:00.000000Z"),
          ],
        },
      ],
    }),
    commandClient: client,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: rateRuntime.runtime,
  });

  assertSingleSuccess(rateResult, { adapterAttempts: 2, databaseAttempts: 1 });
  assert(rateRuntime.delays[0] >= 25, "Rate limited retry delay");
  pass("Provider RATE_LIMITED retry-after success");
  pass("Retry-After delay selected");

  const deferred = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.retryDeferred, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [errorFixture(BINDINGS.retryDeferred, "RATE_LIMITED", 31)],
    }),
    commandClient: client,
    retryPolicy: {
      ...shortRetryPolicy(),
      maxRetryAfterMs: 30,
    },
    retryRuntime: deterministicRetryRuntime().runtime,
  });

  assertFailure(deferred.outcomes[0], "ADAPTER", "RATE_LIMITED");
  assert(deferred.outcomes[0]?.ok === false && deferred.outcomes[0].retryDeferred, "Rate limited deferred");
  assert(deferred.summary.databaseAttempts === 0, "Rate limited deferred DB zero");
  pass("Provider RATE_LIMITED deferred");
  pass("Retry deferred DB attempt zero");

  const exhausted = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.unavailableExhausted, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [],
      balanceAttemptSequences: [
        {
          binding: BINDINGS.unavailableExhausted.binding,
          attempts: [
            errorFixture(BINDINGS.unavailableExhausted, "PROVIDER_UNAVAILABLE"),
            errorFixture(BINDINGS.unavailableExhausted, "PROVIDER_UNAVAILABLE"),
            errorFixture(BINDINGS.unavailableExhausted, "PROVIDER_UNAVAILABLE"),
          ],
        },
      ],
    }),
    commandClient: client,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: deterministicRetryRuntime().runtime,
  });

  assertFailure(exhausted.outcomes[0], "ADAPTER", "PROVIDER_UNAVAILABLE");
  assert(exhausted.outcomes[0]?.ok === false && exhausted.outcomes[0].retryExhausted, "Unavailable exhausted");
  assert(exhausted.outcomes[0]?.ok === false && exhausted.outcomes[0].adapterAttempts === 3, "Unavailable attempts");
  pass("Provider unavailable exhaustion");
  pass("Provider retry exhaustion metadata");

  const unsupported = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.unsupported, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [errorFixture(BINDINGS.unsupported, "UNSUPPORTED_ASSET")],
    }),
    commandClient: client,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: deterministicRetryRuntime().runtime,
  });

  assertFailure(unsupported.outcomes[0], "ADAPTER", "UNSUPPORTED_ASSET");
  assert(unsupported.outcomes[0]?.ok === false && unsupported.outcomes[0].adapterAttempts === 1, "Unsupported no retry");
  pass("Provider unsupported no retry");
  pass("Provider non-retryable attempt one");

  const malformed = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.malformedAmount, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        {
          ...successFixture(BINDINGS.malformedAmount, { kind: "CONTENT" }, "1.1", "1.1", "2026-08-01T01:20:00.000000Z"),
        },
      ],
    }),
    commandClient: client,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: deterministicRetryRuntime().runtime,
  });

  assertFailure(malformed.outcomes[0], "ADAPTER", "MALFORMED_AMOUNT");
  assert(malformed.summary.databaseAttempts === 0, "Malformed DB zero");
  pass("Provider malformed amount no retry");
  pass("Malformed provider result DB zero");
}

async function assertDatabaseRetryScenarios(modules, client) {
  const { createMockCustodyObservationAdapter } = modules.mockAdapter;
  const { runCustodyBalanceObserverWorkUnit } = modules.worker;
  const { CustodyBalanceObserverCommandError } = modules.commandClient;
  const transientClient = failThenDelegateClient(
    client,
    new CustodyBalanceObserverCommandError("DB_UNAVAILABLE", true),
    1,
  );
  const transient = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.dbTransient, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [successFixture(BINDINGS.dbTransient, { kind: "CONTENT" }, "30", "30", "2026-08-01T02:00:00.000000Z")],
    }),
    commandClient: transientClient,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: deterministicRetryRuntime().runtime,
  });

  assertSingleSuccess(transient, { adapterAttempts: 1, databaseAttempts: 2 });
  assert(transient.summary.databaseRetryAttempts === 1, "DB transient retry count");
  pass("Controlled transient DB recovery");
  pass("DB retry summary metadata");

  const beforeAmbiguous = await observerCounts();
  const ambiguousClient = ambiguousCommitClient(
    client,
    new CustodyBalanceObserverCommandError("DB_UNAVAILABLE", true),
  );
  const ambiguous = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.ambiguousCommit, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [successFixture(BINDINGS.ambiguousCommit, { kind: "CONTENT" }, "40", "40", "2026-08-01T02:10:00.000000Z")],
    }),
    commandClient: ambiguousClient,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: deterministicRetryRuntime().runtime,
  });
  const afterAmbiguous = await observerCounts();

  assertSingleSuccess(ambiguous, { adapterAttempts: 1, databaseAttempts: 2 });
  assert(ambiguous.outcomes[0]?.ok === true && !ambiguous.outcomes[0].observationCreated, "Ambiguous replay no-op");
  assert(afterAmbiguous.observations - beforeAmbiguous.observations === 1, "Ambiguous observation one");
  assert(afterAmbiguous.checkpoints - beforeAmbiguous.checkpoints === 1, "Ambiguous checkpoint one");
  pass("Ambiguous commit replay recovery");
  pass("Ambiguous commit side effect bounded");

  const stale = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.ambiguousCommit, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [successFixture(BINDINGS.ambiguousCommit, { kind: "CONTENT" }, "41", "41", "2026-08-01T02:20:00.000000Z")],
    }),
    commandClient: client,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: deterministicRetryRuntime().runtime,
  });

  assertFailure(stale.outcomes[0], "DATABASE", "CHECKPOINT_VERSION_CONFLICT");
  assert(stale.outcomes[0]?.ok === false && stale.outcomes[0].requiresScopeRefresh, "Stale requires refresh");
  assert(stale.outcomes[0]?.ok === false && !stale.outcomes[0].retryExhausted, "Stale no auto retry");
  pass("Checkpoint conflict requires scope refresh");
  pass("Checkpoint conflict auto retry disabled");
}

async function assertConcurrencyScenarios(modules) {
  const { createMockCustodyObservationAdapter } = modules.mockAdapter;
  const { runCustodyBalanceObserverWorkUnit } = modules.worker;
  const beforeSame = await observerCounts();
  const firstClient = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient),
  );
  const secondClient = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient),
  );

  try {
    const sameInput = {
      workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
        workItem(BINDINGS.sameObservation, "0"),
      ]),
      adapter: createMockCustodyObservationAdapter({
        provider: PROVIDER,
        health: healthFixture(),
        balances: [successFixture(BINDINGS.sameObservation, { kind: "CONTENT" }, "50", "50", "2026-08-01T03:00:00.000000Z")],
      }),
      retryPolicy: shortRetryPolicy(),
      retryRuntime: deterministicRetryRuntime().runtime,
    };
    const [sameA, sameB] = await Promise.all([
      runCustodyBalanceObserverWorkUnit({ ...sameInput, commandClient: firstClient }),
      runCustodyBalanceObserverWorkUnit({ ...sameInput, commandClient: secondClient }),
    ]);
    const afterSame = await observerCounts();
    const sameSuccesses = [sameA, sameB].filter((result) => result.outcomes[0]?.ok === true);
    const sameCreated = [sameA, sameB].filter(
      (result) => result.outcomes[0]?.ok === true && result.outcomes[0].observationCreated,
    );

    assert(sameSuccesses.length === 2, "Same observation both safe");
    assert(sameCreated.length === 1, "Same observation one creator");
    assert(afterSame.observations - beforeSame.observations === 1, "Same observation count");
    assert(afterSame.checkpoints - beforeSame.checkpoints === 1, "Same checkpoint count");
    pass("Same-observation concurrency");
    pass("Same-observation duplicate side effect zero");
  } finally {
    await Promise.all([firstClient.close(), secondClient.close()]);
  }

  const beforeCompeting = await observerCounts();
  const holder = await acquireBindingLock(BINDINGS.competingObservation.id);
  const competingAClient = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient),
  );
  const competingBClient = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient),
  );

  try {
    const competingA = runCustodyBalanceObserverWorkUnit({
      workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
        workItem(BINDINGS.competingObservation, "0"),
      ]),
      adapter: createMockCustodyObservationAdapter({
        provider: PROVIDER,
        health: healthFixture(),
        balances: [successFixture(BINDINGS.competingObservation, { kind: "CONTENT" }, "60", "60", "2026-08-01T03:10:00.000000Z")],
      }),
      commandClient: competingAClient,
      retryPolicy: shortRetryPolicy(),
      retryRuntime: deterministicRetryRuntime().runtime,
    });

    await sleep(50);

    const competingB = runCustodyBalanceObserverWorkUnit({
      workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
        workItem(BINDINGS.competingObservation, "0"),
      ]),
      adapter: createMockCustodyObservationAdapter({
        provider: PROVIDER,
        health: healthFixture(),
        balances: [successFixture(BINDINGS.competingObservation, { kind: "CONTENT" }, "61", "61", "2026-08-01T03:11:00.000000Z")],
      }),
      commandClient: competingBClient,
      retryPolicy: shortRetryPolicy(),
      retryRuntime: deterministicRetryRuntime().runtime,
    });

    await sleep(50);
    await holder.release();

    const results = await Promise.all([competingA, competingB]);
    const afterCompeting = await observerCounts();
    const successCount = results.filter((result) => result.outcomes[0]?.ok === true).length;
    const conflictCount = results.filter(
      (result) =>
        result.outcomes[0]?.ok === false &&
        result.outcomes[0].stage === "DATABASE" &&
        (result.outcomes[0].code === "CHECKPOINT_VERSION_CONFLICT" ||
          result.outcomes[0].code === "CHECKPOINT_POSITION_CONFLICT" ||
          result.outcomes[0].code === "CHECKPOINT_REGRESSION"),
    ).length;

    assert(successCount === 1 && conflictCount === 1, "Competing one success one conflict");
    assert(afterCompeting.observations - beforeCompeting.observations === 1, "Competing observation count");
    assert(afterCompeting.checkpoints - beforeCompeting.checkpoints === 1, "Competing checkpoint count");
    pass("Competing-observation concurrency");
    pass("Competing-observation partial insert zero");
  } finally {
    await holder.release();
    await Promise.all([competingAClient.close(), competingBClient.close()]);
  }

  const beforeDifferent = await observerCounts();
  const differentAClient = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient),
  );
  const differentBClient = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient),
  );

  try {
    const [differentA, differentB] = await Promise.all([
      runCustodyBalanceObserverWorkUnit({
        workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
          workItem(BINDINGS.differentA, "0"),
        ]),
        adapter: createMockCustodyObservationAdapter({
          provider: PROVIDER,
          health: healthFixture(),
          balances: [successFixture(BINDINGS.differentA, { kind: "CONTENT" }, "70", "70", "2026-08-01T03:20:00.000000Z")],
        }),
        commandClient: differentAClient,
        retryPolicy: shortRetryPolicy(),
        retryRuntime: deterministicRetryRuntime().runtime,
      }),
      runCustodyBalanceObserverWorkUnit({
        workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
          workItem(BINDINGS.differentB, "0"),
        ]),
        adapter: createMockCustodyObservationAdapter({
          provider: PROVIDER,
          health: healthFixture(),
          balances: [successFixture(BINDINGS.differentB, { kind: "CONTENT" }, "80", "80", "2026-08-01T03:21:00.000000Z")],
        }),
        commandClient: differentBClient,
        retryPolicy: shortRetryPolicy(),
        retryRuntime: deterministicRetryRuntime().runtime,
      }),
    ]);
    const afterDifferent = await observerCounts();

    assert(differentA.outcomes[0]?.ok === true && differentB.outcomes[0]?.ok === true, "Different bindings both success");
    assert(afterDifferent.observations - beforeDifferent.observations === 2, "Different observations count");
    assert(afterDifferent.checkpoints - beforeDifferent.checkpoints === 2, "Different checkpoints count");
    pass("Different-binding concurrency");
    pass("Different-binding data isolation");
  } finally {
    await Promise.all([differentAClient.close(), differentBClient.close()]);
  }
}

async function assertTimeoutScenarios(modules) {
  await assertBlockingTimeoutScenario({
    modules,
    bindingRef: BINDINGS.lockTimeout,
    label: "Lock timeout",
    expectedCode: "DB_LOCK_TIMEOUT",
    configOverrides: {
      lockTimeoutMillis: 200,
      statementTimeoutMillis: 2_000,
      queryTimeoutMillis: 4_000,
    },
    amount: "90",
    observedAt: "2026-08-01T04:00:00.000000Z",
  });
  await assertBlockingTimeoutScenario({
    modules,
    bindingRef: BINDINGS.statementTimeout,
    label: "Statement timeout",
    expectedCode: "DB_TIMEOUT",
    configOverrides: {
      lockTimeoutMillis: 5_000,
      statementTimeoutMillis: 200,
      queryTimeoutMillis: 4_000,
    },
    amount: "91",
    observedAt: "2026-08-01T04:10:00.000000Z",
  });
  await assertBlockingTimeoutScenario({
    modules,
    bindingRef: BINDINGS.queryTimeout,
    label: "Query timeout",
    expectedCode: "DB_TIMEOUT",
    configOverrides: {
      lockTimeoutMillis: 5_000,
      statementTimeoutMillis: 4_000,
      queryTimeoutMillis: 200,
    },
    amount: "92",
    observedAt: "2026-08-01T04:20:00.000000Z",
  });
}

async function assertBlockingTimeoutScenario({
  modules,
  bindingRef,
  label,
  expectedCode,
  configOverrides,
  amount,
  observedAt,
}) {
  const { createMockCustodyObservationAdapter } = modules.mockAdapter;
  const { runCustodyBalanceObserverWorkUnit } = modules.worker;
  const before = await observerCounts();
  const holder = await acquireBindingLock(bindingRef.id);
  let released = false;
  const baseClient = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient, configOverrides),
  );
  const retryRuntime = deterministicRetryRuntime({
    async onSleep() {
      const duringLock = await observerCounts();

      assertCountsEqual(before, duringLock, `${label} partial zero`);

      if (!released) {
        released = true;
        await holder.release();
      }
    },
  });
  const client = observeCommandErrorsClient(
    baseClient,
    retryRuntime.observedFailureCodes,
  );

  try {
    const result = await runCustodyBalanceObserverWorkUnit({
      workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
        workItem(bindingRef, "0"),
      ]),
      adapter: createMockCustodyObservationAdapter({
        provider: PROVIDER,
        health: healthFixture(),
        balances: [successFixture(bindingRef, { kind: "CONTENT" }, amount, amount, observedAt)],
      }),
      commandClient: client,
      retryPolicy: shortRetryPolicy(),
      retryRuntime: retryRuntime.runtime,
    });
    const after = await observerCounts();

    assertSingleSuccess(result, { adapterAttempts: 1, databaseAttempts: 2 });
    assert(result.summary.databaseRetryAttempts === 1, `${label} retry summary`);
    assert(after.observations - before.observations === 1, `${label} observation count`);
    assert(after.checkpoints - before.checkpoints === 1, `${label} checkpoint count`);
    assert(retryRuntime.observedFailureCodes.has(expectedCode), `${label} safe code observed`);
    pass(`${label} safe mapping`);
    pass(`${label} retry recovery`);
  } finally {
    await holder.release();
    await baseClient.close();
  }
}

async function assertConnectionFailure(modules) {
  const { createMockCustodyObservationAdapter } = modules.mockAdapter;
  const { runCustodyBalanceObserverWorkUnit } = modules.worker;
  const unusedPort = await reserveUnusedLocalPort();
  allowedLocalPorts.add(unusedPort);
  const client = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient, {
      port: unusedPort,
      connectionTimeoutMillis: 300,
      statementTimeoutMillis: 1_000,
      queryTimeoutMillis: 1_000,
    }),
  );

  try {
    const result = await runCustodyBalanceObserverWorkUnit({
      workUnit: workUnit("LOCAL_MOCK", ASSETS.secondary, [
        workItem(BINDINGS.invalidPolicy, "0"),
      ]),
      adapter: createMockCustodyObservationAdapter({
        provider: PROVIDER,
        health: healthFixture(),
        balances: [successFixture(BINDINGS.invalidPolicy, { kind: "CONTENT" }, "93", "93", "2026-08-01T04:30:00.000000Z")],
      }),
      commandClient: client,
      retryPolicy: {
        ...shortRetryPolicy(),
        maxAttempts: 2,
      },
      retryRuntime: deterministicRetryRuntime().runtime,
    });

    assert(result.outcomes[0]?.ok === false, "Connection failure outcome");
    assert(
      result.outcomes[0].code === "DB_UNAVAILABLE" ||
        result.outcomes[0].code === "DB_CONNECTION_FAILED",
      "Connection failure safe code",
    );
    assert(result.outcomes[0].retryExhausted, "Connection failure exhausted");
    assert(result.summary.databaseAttempts === 2, "Connection failure attempts");
    pass("Connection failure bounded retry");
    pass("Connection failure safe mapping");
  } finally {
    await client.close();
    allowedLocalPorts.delete(unusedPort);
  }
}

async function assertAbortRetryScenarios(modules, client) {
  const { createMockCustodyObservationAdapter } = modules.mockAdapter;
  const { runCustodyBalanceObserverWorkUnit } = modules.worker;
  const { CustodyBalanceObserverCommandError } = modules.commandClient;

  const beforeDelayController = new AbortController();
  const beforeDelay = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.abortAdapter, "0"),
    ]),
    adapter: abortingAdapter(
      beforeDelayController,
      errorResult(BINDINGS.abortAdapter, "TIMEOUT"),
    ),
    commandClient: client,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: deterministicRetryRuntime({
      onSleep() {
        throw new Error("FAIL abort before delay slept");
      },
    }).runtime,
    signal: beforeDelayController.signal,
  });

  assertFailure(beforeDelay.outcomes[0], "ABORTED", "ABORTED");
  assert(beforeDelay.summary.databaseAttempts === 0, "Abort before retry DB zero");
  pass("Abort before retry delay");

  const duringController = new AbortController();
  const duringRuntime = deterministicRetryRuntime({
    onSleep({ signal }) {
      duringController.abort();
      assert(signal?.aborted, "Abort during backoff signal");

      return "ABORTED";
    },
  });
  const during = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.abortBackoff, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [errorFixture(BINDINGS.abortBackoff, "TIMEOUT")],
    }),
    commandClient: client,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: duringRuntime.runtime,
    signal: duringController.signal,
  });

  assertFailure(during.outcomes[0], "ABORTED", "ABORTED");
  assert(duringRuntime.delays.length === 1, "Abort during backoff delay count");
  pass("Abort during backoff");

  const dbAbortController = new AbortController();
  const dbAbortClient = failThenDelegateClient(
    client,
    new CustodyBalanceObserverCommandError("DB_UNAVAILABLE", true),
    1,
  );
  const dbAbortRuntime = deterministicRetryRuntime({
    onSleep() {
      dbAbortController.abort();

      return "ABORTED";
    },
  });
  const dbAbort = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.primary, [
      workItem(BINDINGS.abortDbRetry, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [successFixture(BINDINGS.abortDbRetry, { kind: "CONTENT" }, "94", "94", "2026-08-01T04:40:00.000000Z")],
    }),
    commandClient: dbAbortClient,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: dbAbortRuntime.runtime,
    signal: dbAbortController.signal,
  });

  assertFailure(dbAbort.outcomes[0], "ABORTED", "ABORTED");
  assert(dbAbort.outcomes[0]?.ok === false && dbAbort.outcomes[0].databaseAttempts === 1, "Abort DB retry attempts");
  pass("Abort after DB transient failure");
  pass("Abort prevents next DB retry");

  const invalidPolicy = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.secondary, [
      workItem(BINDINGS.invalidPolicy, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [successFixture(BINDINGS.invalidPolicy, { kind: "CONTENT" }, "95", "95", "2026-08-01T04:50:00.000000Z")],
    }),
    commandClient: client,
    retryPolicy: {
      mode: "BOUNDED_V1",
      maxAttempts: 6,
      baseDelayMs: 1,
      maxDelayMs: 1,
      jitterRatio: 0,
      maxRetryAfterMs: 1,
    },
  });

  assertFailure(invalidPolicy.outcomes[0], "VALIDATION", "RETRY_POLICY_INVALID");
  assert(invalidPolicy.summary.adapterAttempts === 0, "Invalid policy adapter zero");
  pass("Worker invalid retry policy safe failure");
}

async function loadRuntimeModules() {
  tempRuntimeDir = await mkdtemp(
    path.join(tmpdir(), "p5-t03-balance-observer-resilience-"),
  );

  try {
    await symlink(
      path.join(process.cwd(), "node_modules"),
      path.join(tempRuntimeDir, "node_modules"),
      "junction",
    );
  } catch {
    await mkdir(path.join(tempRuntimeDir, "node_modules"), {
      recursive: true,
    });
  }

  installModuleLoadGuard();

  for (const moduleInfo of SOURCE_MODULES) {
    const sourceText = await readFile(moduleInfo.sourcePath, "utf8");
    const transpiled = transpileTypeScript(sourceText, moduleInfo.sourcePath);

    await writeFile(
      path.join(tempRuntimeDir, moduleInfo.outputName),
      transpiled,
      "utf8",
    );
  }

  const runtimeRequire = createRequire(
    path.join(tempRuntimeDir, "runtime-loader.cjs"),
  );

  return {
    providerContract: runtimeRequire("./provider-observation-contract.js"),
    normalization: runtimeRequire("./balance-observation-normalization.js"),
    mockAdapter: runtimeRequire("./mock-balance-observation-adapter.js"),
    commandClient: runtimeRequire("./balance-observer-command-client.js"),
    retry: runtimeRequire("./balance-observer-retry.js"),
    worker: runtimeRequire("./balance-observer-worker.js"),
  };
}

function installModuleLoadGuard() {
  if (moduleLoadGuard) {
    return;
  }

  const originalLoad = Module._load;

  Module._load = function loadWithServerOnlyBoundary(request, parent, isMain) {
    if (request === "server-only") {
      return {};
    }

    return originalLoad.call(this, request, parent, isMain);
  };
  moduleLoadGuard = {
    originalLoad,
  };
}

function restoreModuleLoadGuard() {
  if (!moduleLoadGuard) {
    return;
  }

  Module._load = moduleLoadGuard.originalLoad;
  moduleLoadGuard = null;
}

function transpileTypeScript(sourceText, sourcePath) {
  const result = ts.transpileModule(sourceText, {
    fileName: sourcePath,
    reportDiagnostics: true,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  if (errors.length > 0) {
    const message = errors
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      )
      .join("; ");

    throw new Error(`FAIL TS transpile ${message}`);
  }

  return result.outputText;
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
    values
      ${uniqueBindingAssets()
        .map(
          (item, index) =>
            `('${item.id}', '${item.assetCode}', 'R${String(index + 1).padStart(3, "0")}', 'P5 T03 Resilience Asset ${index + 1}', 'NATIVE', 9, null, 'ACTIVE')`,
        )
        .join(",\n      ")};

    insert into private.custody_providers (
      id,
      provider_code,
      display_name,
      provider_type,
      supports_balance_observation,
      supports_transfer_observation
    )
    values (
      '00000000-0000-4000-8000-0000005a0201',
      '${PROVIDER.providerCode}',
      'P5 T03 Resilience Provider',
      '${PROVIDER.providerType}',
      true,
      false
    );

    update private.custody_providers
    set status = 'APPROVED'
    where provider_code = '${PROVIDER.providerCode}';

    insert into private.custody_account_bindings (
      id,
      custody_provider_id,
      asset_id,
      binding_key,
      display_label,
      account_role
    )
    values
      ${Object.values(BINDINGS)
        .map(
          (item) =>
            `('${item.id}', '00000000-0000-4000-8000-0000005a0201', '${item.asset.id}', '${item.binding.bindingKey}', '${item.binding.bindingKey}', '${item.binding.accountRole}')`,
        )
        .join(",\n      ")};

    update private.custody_account_bindings
    set status = 'APPROVED'
    where custody_provider_id = '00000000-0000-4000-8000-0000005a0201';
  `);
  pass("Synthetic DB fixtures");
}

async function setWorkerPassword(password) {
  await adminSql(`alter role ${WORKER_ROLE} password ${quoteSqlLiteral(password)};`);
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
        (select count(*) from public.supported_assets where asset_code like 'P5T03_RES_%') +
        (select count(*) from private.custody_providers where provider_code like 'P5T03_RESILIENCE_%') +
        (select count(*) from private.custody_account_bindings where binding_key like 'p5t03_res_%')
      )::text;
    `);

    assert(residue === "0", "Fixture residue zero");
    pass("Fixture cleanup");
  } finally {
    await runNpmScript("supabase:stop", "Supabase stop", 120_000);
  }
}

function createWorkerPostgresConfig(commandClientModule, overrides = {}) {
  return {
    host: LOCAL_DB_HOST,
    port: LOCAL_DB_PORT,
    database: DB_NAME,
    user: WORKER_ROLE,
    password: workerPassword,
    ssl: false,
    ...commandClientModule.DEFAULT_CUSTODY_OBSERVER_POSTGRES_LIMITS,
    ...overrides,
  };
}

async function acquireBindingLock(bindingId) {
  const { Pool } = require("pg");
  const pool = new Pool({
    host: LOCAL_DB_HOST,
    port: LOCAL_DB_PORT,
    database: DB_NAME,
    user: WORKER_ROLE,
    password: workerPassword,
    ssl: false,
    application_name: "staking-wallet-balance-observer-v1",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 5_000,
    max: 1,
  });
  const client = await pool.connect();
  let released = false;

  await client.query("begin");
  await client.query(
    "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))",
    [lockLabel(bindingId)],
  );

  return {
    async release() {
      if (released) {
        return;
      }

      released = true;

      try {
        await client.query("rollback");
      } finally {
        client.release();
        await pool.end();
      }
    },
  };
}

function failThenDelegateClient(delegate, error, failures) {
  let attempts = 0;

  return {
    async recordBalanceObservationAndAdvanceCheckpoint(input) {
      attempts += 1;

      if (attempts <= failures) {
        throw error;
      }

      return delegate.recordBalanceObservationAndAdvanceCheckpoint(input);
    },
    async close() {},
  };
}

function ambiguousCommitClient(delegate, error) {
  let first = true;

  return {
    async recordBalanceObservationAndAdvanceCheckpoint(input) {
      const result =
        await delegate.recordBalanceObservationAndAdvanceCheckpoint(input);

      if (first) {
        first = false;
        throw error;
      }

      return result;
    },
    async close() {},
  };
}

function observeCommandErrorsClient(delegate, observedCodes) {
  return {
    async recordBalanceObservationAndAdvanceCheckpoint(input) {
      try {
        return await delegate.recordBalanceObservationAndAdvanceCheckpoint(input);
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error) {
          const code = error.code;

          if (typeof code === "string") {
            observedCodes.add(code);
          }
        }

        throw error;
      }
    },
    async close() {},
  };
}

function deterministicRetryRuntime(options = {}) {
  const delays = [];
  const observedFailureCodes = new Set();

  return {
    delays,
    observedFailureCodes,
    runtime: {
      randomInteger(maxExclusive) {
        return maxExclusive > 1 ? 0 : 0;
      },
      async sleep(delayMs, signal) {
        delays.push(delayMs);

        if (options.onSleep) {
          const result = await options.onSleep({
            delayMs,
            signal,
          });

          if (result === "ABORTED") {
            return "ABORTED";
          }
        }

        return signal?.aborted ? "ABORTED" : "COMPLETED";
      },
    },
  };
}

function shortRetryPolicy() {
  return {
    mode: "BOUNDED_V1",
    maxAttempts: 3,
    baseDelayMs: 10,
    maxDelayMs: 50,
    jitterRatio: 0,
    maxRetryAfterMs: 100,
  };
}

function createEphemeralPassword() {
  return randomBytes(32).toString("base64url");
}

function workUnit(identityPolicy, assetRef, bindings) {
  const firstBinding = bindings[0];

  return {
    provider: PROVIDER,
    assetId: firstBinding?.assetId ?? assetRef.id,
    bindings,
    identityPolicy,
  };
}

function workItem(bindingRef, expectedCheckpointVersion) {
  return {
    bindingId: bindingRef.id,
    assetId: bindingRef.asset.id,
    binding: bindingRef.binding,
    expectedCheckpointVersion,
  };
}

function abortingAdapter(controller, result) {
  return {
    provider: PROVIDER,
    async readHealth() {
      return {
        provider: PROVIDER,
        status: "AVAILABLE",
        checkedAt: "2026-08-01T01:00:00.000000Z",
      };
    },
    async readBalances() {
      controller.abort();

      return [result];
    },
    async readTransfers() {
      return {
        observations: [],
        page: {
          cursor: null,
          hasMore: false,
        },
      };
    },
  };
}

function errorResult(bindingRef, code) {
  return {
    ok: false,
    binding: bindingRef.binding,
    error: {
      code,
      retryable: true,
      retryAfterMs: null,
    },
  };
}

function successFixture(
  bindingRef,
  identity,
  observedAvailableUnits,
  observedTotalUnits,
  observedAt,
) {
  return {
    kind: "SUCCESS",
    binding: bindingRef.binding,
    identity,
    observedAvailableUnits,
    observedTotalUnits,
    observedAt,
    finalizedAt: null,
  };
}

function errorFixture(bindingRef, code, retryAfterMs = null) {
  return {
    kind: "ERROR",
    binding: bindingRef.binding,
    code,
    retryAfterMs,
  };
}

function healthFixture() {
  return {
    status: "AVAILABLE",
    checkedAt: "2026-08-01T00:00:00.000000Z",
  };
}

function asset(id, assetCode) {
  return {
    id,
    assetCode,
  };
}

function binding(id, assetRef, bindingKey, accountRole) {
  const bindingAsset =
    bindingKey === "p5t03_res_different_a" ||
    bindingKey === "p5t03_res_different_b"
      ? assetRef
      : nextBindingAsset(assetRef);

  return {
    id,
    asset: bindingAsset,
    binding: {
      providerCode: PROVIDER.providerCode,
      bindingKey,
      assetCode: bindingAsset.assetCode,
      accountRole,
    },
  };
}

function nextBindingAsset(assetRef) {
  const ordinal = nextBindingAssetOrdinal;
  nextBindingAssetOrdinal += 1;

  return asset(
    `00000000-0000-4000-8000-0000005a1${ordinal.toString(16).padStart(3, "0")}`,
    `${assetRef.assetCode}_${String(ordinal).padStart(3, "0")}`,
  );
}

function uniqueBindingAssets() {
  const assetsById = new Map();

  for (const item of Object.values(BINDINGS)) {
    assetsById.set(item.asset.id, item.asset);
  }

  return [...assetsById.values()];
}

function lockLabel(bindingId) {
  return `custody-balance-observer-v1:${bindingId}:BALANCE_OBSERVER_V1`;
}

function assertSingleSuccess(result, expected) {
  assert(result.outcomes.length === 1, "Single outcome");
  const outcome = result.outcomes[0];

  assert(outcome?.ok === true, "Outcome success");
  assert(outcome.adapterAttempts === expected.adapterAttempts, "Adapter attempts");
  assert(outcome.databaseAttempts === expected.databaseAttempts, "Database attempts");
}

function assertFailure(outcome, stage, code) {
  assert(outcome?.ok === false, "Outcome failure");
  assert(outcome.stage === stage, "Failure stage");
  assert(outcome.code === code, "Failure code");
}

async function observerCounts() {
  const text = await adminSqlScalar(`
    select
      (select count(*) from private.external_balance_observations)::text || ',' ||
      (select count(*) from private.observer_checkpoints)::text;
  `);
  const [observations, checkpoints] = text.split(",").map(Number);

  return {
    observations,
    checkpoints,
  };
}

function assertCountsEqual(before, after, label) {
  assert(
    before.observations === after.observations &&
      before.checkpoints === after.checkpoints,
    label,
  );
}

async function reserveUnusedLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on("error", reject);
    server.listen(0, LOCAL_DB_HOST, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("FAIL local port reservation")));
        return;
      }

      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertRejects(callback, label) {
  try {
    await callback();
  } catch {
    return;
  }

  throw new Error(`FAIL ${label}`);
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
      reject(new Error("FAIL child process timeout"));
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
        reject(new Error("FAIL child process exited"));
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

function installLocalNetworkGuard() {
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalNetConnect = net.Socket.prototype.connect;
  const originalTlsConnect = tls.connect;
  const originalDnsLookup = dns.lookup;

  globalThis.fetch = async () => {
    externalNetworkCalls += 1;
    providerNetworkCalls += 1;
    throw new Error("FAIL external fetch blocked");
  };
  http.request = (...args) => {
    externalNetworkCalls += 1;
    providerNetworkCalls += 1;

    return originalHttpRequest(...args);
  };
  https.request = (...args) => {
    externalNetworkCalls += 1;
    providerNetworkCalls += 1;

    return originalHttpsRequest(...args);
  };
  tls.connect = () => {
    externalNetworkCalls += 1;
    throw new Error("FAIL tls socket blocked");
  };
  dns.lookup = (...args) => {
    const hostname = args[0];

    if (hostname === LOCAL_DB_HOST || hostname === "localhost") {
      return originalDnsLookup(...args);
    }

    externalNetworkCalls += 1;
    throw new Error("FAIL dns lookup blocked");
  };
  net.Socket.prototype.connect = function connectWithGuard(...args) {
    const target = normalizeSocketTarget(args);

    if (
      allowedLocalPorts.has(Number(target.port)) &&
      (target.host === LOCAL_DB_HOST || target.host === "localhost")
    ) {
      localPostgresConnections += 1;

      return originalNetConnect.apply(this, args);
    }

    externalNetworkCalls += 1;
    throw new Error("FAIL non-local socket blocked");
  };

  return {
    originalFetch,
    originalHttpRequest,
    originalHttpsRequest,
    originalNetConnect,
    originalTlsConnect,
    originalDnsLookup,
  };
}

function restoreLocalNetworkGuard() {
  if (!networkGuard) {
    return;
  }

  globalThis.fetch = networkGuard.originalFetch;
  http.request = networkGuard.originalHttpRequest;
  https.request = networkGuard.originalHttpsRequest;
  tls.connect = networkGuard.originalTlsConnect;
  dns.lookup = networkGuard.originalDnsLookup;
  net.Socket.prototype.connect = networkGuard.originalNetConnect;
  networkGuard = null;
}

function normalizeSocketTarget(args) {
  const first = args[0];

  if (typeof first === "object" && first !== null) {
    return {
      host: first.host ?? "localhost",
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

function createCredentialEnvGuard(originalEnv) {
  const credentialEnvNames = new Set([
    "PGPASSWORD",
    "DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "SERVICE_ROLE_KEY",
    "PROVIDER_API_KEY",
    "PROVIDER_SECRET",
    "ACCESS_TOKEN",
    "REFRESH_TOKEN",
  ]);

  return new Proxy(originalEnv, {
    get(target, property, receiver) {
      if (
        typeof property === "string" &&
        credentialEnvNames.has(property.toUpperCase())
      ) {
        credentialEnvReads += 1;
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

async function closeCommandClient() {
  if (!commandClient) {
    return;
  }

  await commandClient.close();
  commandClient = null;
}

async function cleanupRuntimeModules() {
  if (!tempRuntimeDir) {
    return;
  }

  const dir = tempRuntimeDir;
  tempRuntimeDir = null;
  await rm(dir, {
    force: true,
    recursive: true,
  });
}

async function assertSourceBoundaries() {
  const sourceFiles = await Promise.all(
    SOURCE_MODULES.map((moduleInfo) => readFile(moduleInfo.sourcePath, "utf8")),
  );
  const joined = sourceFiles.join("\n");

  assert(!joined.includes("process.env"), "Production source has no env fallback");
  assert(!joined.includes("connectionString"), "Production source has no connection string");
  assert(!joined.includes("DATABASE_URL"), "Production source has no database URL fallback");
  assert(!joined.includes("service_role"), "Production source has no service-role key use");
  assert(!joined.includes("fetch("), "Production source has no provider fetch");
  assert(!joined.includes("Math.random"), "Production source has no Math.random");
  pass("Source boundary scan");
}

function quoteSqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertSafeText(text, label) {
  assert(
    !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text),
    `${label} has no JWT`,
  );
  assert(!/postgres(?:ql)?:\/\/\S+/i.test(text), `${label} has no DB URL`);
  assert(!/sb_(secret|publishable)_[A-Za-z0-9_-]{20,}/.test(text), `${label} has no Supabase key`);
}

function assertSafeOutput() {
  const output = emittedLines.join("\n");

  assertSafeText(output, "Runtime output");
  assert(!/balobs:v1:[nkc]:[0-9a-f]{64}/.test(output), "Output no observation key");
  assert(!/p5t03-res-[a-z0-9_-]+/i.test(output), "Output no raw provider identity");
  assert(!/password|connection string|stack|sql parameter|retry-after header/i.test(output), "Output no sensitive diagnostic");
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`FAIL ${label}`);
  }
}

function pass(label) {
  runtimeCaseCount += 1;
  emittedLines.push(`PASS ${label}`);
  console.log(`PASS ${label}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "FAIL unknown";

  console.error(redactDiagnostic(message));
  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]")
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
}
