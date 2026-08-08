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

const SOURCE_MODULES = [
  {
    sourcePath: "src/server/custody/provider-observation-contract.ts",
    outputName: "provider-observation-contract.js",
  },
  {
    sourcePath: "src/server/custody/balance-observer-scope-client.ts",
    outputName: "balance-observer-scope-client.js",
  },
];

const ASSETS = {
  a: asset("00000000-0000-4000-8000-000000760101", "P5T04_CLIENT_A"),
  b: asset("00000000-0000-4000-8000-000000760102", "P5T04_CLIENT_B"),
  c: asset("00000000-0000-4000-8000-000000760103", "P5T04_CLIENT_C"),
  d: asset("00000000-0000-4000-8000-000000760104", "P5T04_CLIENT_D"),
};

const PROVIDERS = {
  a: provider("00000000-0000-4000-8000-000000760201", "P5T04_CLIENT_PROVIDER_A"),
  b: provider(
    "00000000-0000-4000-8000-000000760202",
    "P5T04_CLIENT_PROVIDER_B",
    "QUALIFIED_CUSTODIAN",
  ),
  noBalance: provider(
    "00000000-0000-4000-8000-000000760203",
    "P5T04_CLIENT_PROVIDER_NB",
  ),
};

const BINDINGS = {
  aCollection: binding(
    "00000000-0000-4000-8000-000000760301",
    PROVIDERS.a,
    ASSETS.a,
    "p5t04_client_a_collection",
    "COLLECTION",
  ),
  aTreasury: binding(
    "00000000-0000-4000-8000-000000760302",
    PROVIDERS.a,
    ASSETS.a,
    "p5t04_client_a_treasury",
    "TREASURY",
  ),
  bCollection: binding(
    "00000000-0000-4000-8000-000000760303",
    PROVIDERS.a,
    ASSETS.b,
    "p5t04_client_b_collection",
    "COLLECTION",
  ),
  cCollection: binding(
    "00000000-0000-4000-8000-000000760304",
    PROVIDERS.b,
    ASSETS.a,
    "p5t04_client_c_collection",
    "COLLECTION",
  ),
  noBalance: binding(
    "00000000-0000-4000-8000-000000760305",
    PROVIDERS.noBalance,
    ASSETS.a,
    "p5t04_client_no_balance",
    "COLLECTION",
  ),
  suspendedAsset: binding(
    "00000000-0000-4000-8000-000000760306",
    PROVIDERS.a,
    ASSETS.d,
    "p5t04_client_suspended_asset",
    "PAYOUT",
  ),
};

const CHECKPOINTS = {
  aCollection: {
    id: "00000000-0000-4000-8000-000000760401",
    bindingId: BINDINGS.aCollection.id,
    version: "7",
  },
  aTreasuryTransfer: {
    id: "00000000-0000-4000-8000-000000760402",
    bindingId: BINDINGS.aTreasury.id,
    version: "11",
  },
};

let runtimeCaseCount = 0;
let externalNetworkCalls = 0;
let providerNetworkCalls = 0;
let localPostgresConnections = 0;
let credentialEnvReads = 0;
let scopeReaderPassword = null;
let tempRuntimeDir = null;
let networkGuard = null;
const clientsToClose = new Set();
const emittedLines = [];

async function main() {
  const originalEnv = process.env;

  try {
    await assertSourceBoundaries();
    const modules = await loadRuntimeModules();
    await runNpmScript("supabase:start", "Supabase start", 120_000);
    await runNpmScript("db:reset:local", "Initial DB reset", 180_000);
    await setupDatabaseFixtures();
    scopeReaderPassword = createEphemeralPassword();
    await setScopeReaderCredential(scopeReaderPassword);
    networkGuard = installLocalNetworkGuard();
    process.env = createCredentialEnvGuard(originalEnv);

    await assertDirectScopeReaderPrivileges(modules.scopeClient);

    const client = modules.scopeClient.createBalanceObserverScopeClient(
      createScopePostgresConfig(modules.scopeClient),
    );
    clientsToClose.add(client);

    await assertRealListScenarios(client);
    await assertRealExactScenarios(client);
    await assertInputValidationScenarios(modules.scopeClient);
    await assertHostilePageResultScenarios(modules.scopeClient);
    await assertHostileExactResultScenarios(modules.scopeClient);
    await assertErrorMappingScenarios(modules.scopeClient);
    await assertPoolLifecycleScenarios(modules.scopeClient);

    assert(localPostgresConnections >= 1, "Local PostgreSQL connection count");
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
    await closeClients();
    await clearScopeReaderCredential();
    await runCleanupResetAndStop();
    await cleanupRuntimeModules();
  }

  assert(!tempRuntimeDir || !existsSync(tempRuntimeDir), "Temp runtime cleanup");
  pass("Temp runtime cleanup");
  assertSafeOutput();

  console.log(`SCOPE_CLIENT_RUNTIME_CASE_COUNT=${runtimeCaseCount}`);
  console.log(`LOCAL_POSTGRES_CONNECTIONS=${localPostgresConnections}`);
  console.log(`EXTERNAL_NETWORK_CALLS=${externalNetworkCalls}`);
  console.log(`PROVIDER_NETWORK_CALLS=${providerNetworkCalls}`);
  console.log(`CREDENTIAL_ENV_READS=${credentialEnvReads}`);
  console.log("CUSTODY_BALANCE_OBSERVER_SCOPE_CLIENT_RUNTIME_PASS");
}

async function assertSourceBoundaries() {
  const source = await readFile(
    "src/server/custody/balance-observer-scope-client.ts",
    "utf8",
  );
  const forbiddenSourceMarkers = [
    "process.env",
    "connectionString",
    "DATABASE_URL",
    "SUPABASE_URL",
    "createClient(",
    "fetch(",
    "axios",
    "http.request",
    "https.request",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "pg_advisory",
    "record_balance_observation_and_advance_checkpoint(",
  ];

  assert(
    source.startsWith('import "server-only";'),
    "Scope client is server-only",
  );

  for (const marker of forbiddenSourceMarkers) {
    assert(!source.includes(marker), `Source boundary excludes ${marker}`);
  }

  assert(
    source.includes("private.list_balance_observer_scope_page(") &&
      source.includes("private.read_balance_observer_scope("),
    "Source calls only approved scope commands",
  );
  pass("Source boundary scan");
}

async function loadRuntimeModules() {
  tempRuntimeDir = await mkdtemp(
    path.join(tmpdir(), "p5-t04-scope-client-runtime-"),
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
    scopeClient: runtimeRequire("./balance-observer-scope-client.js"),
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

async function assertDirectScopeReaderPrivileges(scopeClientModule) {
  const { Pool } = require("pg");
  const pool = new Pool({
    host: LOCAL_DB_HOST,
    port: LOCAL_DB_PORT,
    database: DB_NAME,
    user: SCOPE_ROLE,
    password: scopeReaderPassword,
    ssl: false,
    application_name:
      scopeClientModule.BALANCE_OBSERVER_SCOPE_POSTGRES_APPLICATION_NAME,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 5_000,
    max: 1,
  });

  try {
    const currentUser = await pool.query("select current_user::text as role_name");

    assert(currentUser.rows[0]?.role_name === SCOPE_ROLE, "Scope role login");
    pass("Scope reader direct login");

    const appName = await pool.query(
      "select application_name from pg_stat_activity where pid = pg_backend_pid()",
    );

    assert(
      appName.rows[0]?.application_name ===
        scopeClientModule.BALANCE_OBSERVER_SCOPE_POSTGRES_APPLICATION_NAME,
      "Scope application name fixed",
    );
    pass("Scope fixed application_name");

    const listResult = await pool.query(
      "select count(*)::int as row_count from private.list_balance_observer_scope_page(null, null, 200)",
    );

    assert(listResult.rows[0]?.row_count === 4, "Direct list command execute");
    pass("Scope reader list command execute");

    const readResult = await pool.query(
      "select count(*)::int as row_count from private.read_balance_observer_scope($1::uuid, $2::uuid)",
      [PROVIDERS.a.id, ASSETS.a.id],
    );

    assert(readResult.rows[0]?.row_count === 2, "Direct read command execute");
    pass("Scope reader exact command execute");

    await assertPgRejects(
      () => pool.query("select count(*) from private.custody_account_bindings"),
      "Scope reader direct private table read rejected",
    );
    await assertPgRejects(
      () => pool.query("select count(*) from public.supported_assets"),
      "Scope reader direct public table read rejected",
    );
    await assertPgRejects(
      () =>
        pool.query(
          "select * from private.record_balance_observation_and_advance_checkpoint($1::uuid, $2::text, $3::text, $4::numeric, $5::timestamptz, $6::bigint, $7::text, $8::timestamptz)",
          [
            BINDINGS.aCollection.id,
            "BALANCE_OBSERVER_V1",
            "scope-runtime-blocked-write",
            "1",
            "2026-08-02T00:00:00.000000Z",
            "7",
            "scope-runtime-blocked-write",
            "2026-08-02T00:00:00.000000Z",
          ],
        ),
      "Scope reader write command rejected",
    );
    await assertPgRejects(
      () =>
        pool.query(
          "select private.assert_custody_observer_scope_reader_role_contract()",
        ),
      "Scope reader unrelated private function rejected",
    );
  } finally {
    await pool.end();
  }
}

async function assertRealListScenarios(client) {
  const firstPage = await client.listBalanceObserverScopePage({ limit: 1 });

  assert(firstPage.scopes.length === 1, "First page scope count");
  assert(firstPage.page.scopeCount === 1, "First page metadata count");
  assert(firstPage.page.hasMore, "First page has more");
  assert(
    firstPage.page.nextCursor?.providerId === PROVIDERS.a.id &&
      firstPage.page.nextCursor.assetId === ASSETS.a.id,
    "First page next cursor",
  );
  assert(
    firstPage.scopes[0]?.provider.providerCode === PROVIDERS.a.providerCode,
    "First page provider",
  );
  assert(firstPage.scopes[0]?.bindings.length === 2, "First page binding count");
  assert(
    firstPage.scopes[0]?.provider.capabilities.join(",") ===
      "BALANCE_OBSERVATION,TRANSFER_OBSERVATION,WEBHOOK_INGESTION",
    "First page capabilities",
  );
  assert(
    firstPage.scopes[0]?.bindings
      .map((item) => `${item.bindingId}:${item.expectedCheckpointVersion}`)
      .join(",") ===
      `${BINDINGS.aCollection.id}:7,${BINDINGS.aTreasury.id}:0`,
    "First page checkpoint versions",
  );
  pass("Real list first page");

  const secondPage = await client.listBalanceObserverScopePage({
    after: firstPage.page.nextCursor,
    limit: 1,
  });

  assert(secondPage.scopes.length === 1, "Second page scope count");
  assert(secondPage.page.hasMore, "Second page has more");
  assert(secondPage.scopes[0]?.assetId === ASSETS.b.id, "Second page asset");
  assert(
    secondPage.scopes[0]?.bindings[0]?.bindingId === BINDINGS.bCollection.id,
    "Second page binding",
  );
  pass("Real list second page");

  const finalPage = await client.listBalanceObserverScopePage({
    after: secondPage.page.nextCursor,
    limit: 1,
  });

  assert(finalPage.scopes.length === 1, "Final page scope count");
  assert(!finalPage.page.hasMore, "Final page terminal");
  assert(finalPage.page.nextCursor === null, "Final page cursor cleared");
  assert(finalPage.scopes[0]?.providerId === PROVIDERS.b.id, "Final page provider");
  pass("Real list final page");

  const terminalPage = await client.listBalanceObserverScopePage({
    after: { providerId: PROVIDERS.b.id, assetId: ASSETS.a.id },
    limit: 1,
  });

  assert(terminalPage.scopes.length === 0, "Terminal page empty scopes");
  assert(terminalPage.page.scopeCount === 0, "Terminal page metadata count");
  assert(!terminalPage.page.hasMore, "Terminal page hasMore false");
  assert(terminalPage.page.nextCursor === null, "Terminal page cursor null");
  pass("Real list terminal page");

  const allPage = await client.listBalanceObserverScopePage({ limit: 200 });

  assert(allPage.scopes.length === 3, "Large page scope count");
  assert(
    allPage.scopes.flatMap((scope) => scope.bindings).length === 4,
    "Large page binding count",
  );
  assert(!allPage.page.hasMore, "Large page terminal");
  pass("Real list large page");
}

async function assertRealExactScenarios(client) {
  const scope = await client.readBalanceObserverScope({
    providerId: PROVIDERS.a.id,
    assetId: ASSETS.a.id,
  });

  assert(scope !== null, "Exact scope exists");
  assert(scope.providerId === PROVIDERS.a.id, "Exact provider id");
  assert(scope.assetId === ASSETS.a.id, "Exact asset id");
  assert(scope.bindings.length === 2, "Exact binding count");
  assert(
    scope.bindings
      .map((item) => `${item.binding.bindingKey}:${item.expectedCheckpointVersion}`)
      .join(",") === "p5t04_client_a_collection:7,p5t04_client_a_treasury:0",
    "Exact checkpoint versions",
  );
  pass("Real exact scope");

  const missing = await client.readBalanceObserverScope({
    providerId: PROVIDERS.b.id,
    assetId: ASSETS.b.id,
  });

  assert(missing === null, "Exact missing scope null");
  pass("Real exact missing scope");

  await adminSql(`
    update private.custody_account_bindings
    set status = 'SUSPENDED'
    where id = '${BINDINGS.aTreasury.id}';
  `);

  const refreshed = await client.readBalanceObserverScope({
    providerId: PROVIDERS.a.id,
    assetId: ASSETS.a.id,
  });

  assert(refreshed !== null, "Exact refreshed scope exists");
  assert(refreshed.bindings.length === 1, "Exact refresh excludes suspended binding");
  assert(
    refreshed.bindings[0]?.bindingId === BINDINGS.aCollection.id,
    "Exact refresh remaining binding",
  );
  pass("Real exact refresh after binding status change");

  await adminSql(`
    update private.custody_account_bindings
    set status = 'APPROVED'
    where id = '${BINDINGS.aTreasury.id}';
  `);
}

async function assertInputValidationScenarios(scopeClientModule) {
  const cases = [
    {
      label: "List cursor primitive rejected before DB",
      call: (client) => client.listBalanceObserverScopePage({ after: "bad" }),
      code: "SCOPE_CURSOR_INVALID",
    },
    {
      label: "List cursor provider rejected before DB",
      call: (client) =>
        client.listBalanceObserverScopePage({
          after: {
            providerId: "AAAAAAAA-0000-4000-8000-000000760201",
            assetId: ASSETS.a.id,
          },
        }),
      code: "SCOPE_CURSOR_INVALID",
    },
    {
      label: "List cursor asset rejected before DB",
      call: (client) =>
        client.listBalanceObserverScopePage({
          after: { providerId: PROVIDERS.a.id, assetId: "not-a-uuid" },
        }),
      code: "SCOPE_CURSOR_INVALID",
    },
    {
      label: "List zero limit rejected before DB",
      call: (client) => client.listBalanceObserverScopePage({ limit: 0 }),
      code: "SCOPE_LIMIT_INVALID",
    },
    {
      label: "List fractional limit rejected before DB",
      call: (client) => client.listBalanceObserverScopePage({ limit: 1.5 }),
      code: "SCOPE_LIMIT_INVALID",
    },
    {
      label: "List high limit rejected before DB",
      call: (client) => client.listBalanceObserverScopePage({ limit: 201 }),
      code: "SCOPE_LIMIT_INVALID",
    },
    {
      label: "Exact input primitive rejected before DB",
      call: (client) => client.readBalanceObserverScope("bad"),
      code: "SCOPE_IDENTITY_INVALID",
    },
    {
      label: "Exact provider rejected before DB",
      call: (client) =>
        client.readBalanceObserverScope({
          providerId: "00000000-0000-4000-8000-000000760201 ",
          assetId: ASSETS.a.id,
        }),
      code: "SCOPE_IDENTITY_INVALID",
    },
    {
      label: "Exact asset rejected before DB",
      call: (client) =>
        client.readBalanceObserverScope({
          providerId: PROVIDERS.a.id,
          assetId: null,
        }),
      code: "SCOPE_IDENTITY_INVALID",
    },
  ];

  for (const scenario of cases) {
    const fakePool = createStaticFakePool({ rows: [] });
    const client = createFakeClient(scopeClientModule, fakePool);

    await assertScopeClientRejects(
      () => scenario.call(client),
      scenario.code,
      false,
      scenario.label,
    );
    assert(fakePool.queryCount === 0, `${scenario.label} DB attempt zero`);
    pass(scenario.label);
  }
}

async function assertHostilePageResultScenarios(scopeClientModule) {
  const validRows = basePageRows();
  const cases = [
    {
      label: "Page result object rejected",
      result: null,
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
    {
      label: "Page rows array rejected",
      result: { rows: "bad" },
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
    {
      label: "Page null row rejected",
      result: { rows: [null] },
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
    {
      label: "Page missing provider id rejected",
      rows: mutateRow(validRows, 0, { provider_id: undefined }),
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
    {
      label: "Page uppercase uuid rejected",
      rows: mutateRow(validRows, 0, {
        provider_id: "AAAAAAAA-0000-4000-8000-000000760201",
      }),
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
    {
      label: "Page provider code rejected",
      rows: mutateRow(validRows, 0, { provider_code: "bad" }),
      code: "SCOPE_PROVIDER_REF_INVALID",
    },
    {
      label: "Page provider type rejected",
      rows: mutateRow(validRows, 0, { provider_type: "UNKNOWN" }),
      code: "SCOPE_PROVIDER_REF_INVALID",
    },
    {
      label: "Page balance capability rejected",
      rows: mutateRow(validRows, 0, { supports_balance_observation: false }),
      code: "SCOPE_PROVIDER_REF_INVALID",
    },
    {
      label: "Page capability type rejected",
      rows: mutateRow(validRows, 0, { supports_transfer_lookup: "false" }),
      code: "SCOPE_PROVIDER_REF_INVALID",
    },
    {
      label: "Page asset code rejected",
      rows: mutateRow(validRows, 0, { asset_code: "bad asset" }),
      code: "SCOPE_BINDING_REF_INVALID",
    },
    {
      label: "Page binding key rejected",
      rows: mutateRow(validRows, 0, { binding_key: "bad:key" }),
      code: "SCOPE_BINDING_REF_INVALID",
    },
    {
      label: "Page account role rejected",
      rows: mutateRow(validRows, 0, { account_role: "HOT" }),
      code: "SCOPE_BINDING_REF_INVALID",
    },
    {
      label: "Page checkpoint number rejected",
      rows: mutateRow(validRows, 0, { expected_checkpoint_version: 7 }),
      code: "SCOPE_CHECKPOINT_VERSION_INVALID",
    },
    {
      label: "Page checkpoint leading zero rejected",
      rows: mutateRow(validRows, 0, { expected_checkpoint_version: "07" }),
      code: "SCOPE_CHECKPOINT_VERSION_INVALID",
    },
    {
      label: "Page checkpoint max rejected",
      rows: mutateRow(validRows, 0, {
        expected_checkpoint_version: "9223372036854775808",
      }),
      code: "SCOPE_CHECKPOINT_VERSION_INVALID",
    },
    {
      label: "Page metadata count type rejected",
      rows: mutateRow(validRows, 0, { page_scope_count: "1" }),
      code: "SCOPE_PAGE_METADATA_INVALID",
    },
    {
      label: "Page metadata count mismatch rejected",
      rows: mutateRow(validRows, 0, { page_scope_count: 2 }),
      code: "SCOPE_PAGE_METADATA_INVALID",
    },
    {
      label: "Page metadata hasMore type rejected",
      rows: mutateRow(validRows, 0, { has_more: "true" }),
      code: "SCOPE_PAGE_METADATA_INVALID",
    },
    {
      label: "Page metadata row mismatch rejected",
      rows: mutateRow(validRows, 1, { has_more: false }),
      code: "SCOPE_PAGE_METADATA_INVALID",
    },
    {
      label: "Page metadata missing next cursor rejected",
      rows: mutateRow(validRows, 0, { next_provider_id: null }),
      code: "SCOPE_PAGE_METADATA_INVALID",
    },
    {
      label: "Page metadata false cursor rejected",
      rows: mutateAllRows(validRows, { has_more: false, next_provider_id: PROVIDERS.a.id }),
      code: "SCOPE_PAGE_METADATA_INVALID",
    },
    {
      label: "Page metadata cursor mismatch rejected",
      rows: mutateAllRows(validRows, {
        next_provider_id: PROVIDERS.a.id,
        next_asset_id: ASSETS.b.id,
      }),
      code: "SCOPE_PAGE_METADATA_INVALID",
    },
    {
      label: "Page duplicate binding rejected",
      rows: [
        validRows[0],
        {
          ...validRows[1],
          binding_id: BINDINGS.aCollection.id,
        },
      ],
      code: "SCOPE_DUPLICATE_BINDING",
    },
    {
      label: "Page row order rejected",
      rows: [validRows[1], validRows[0]],
      code: "SCOPE_RESULT_ORDER_INVALID",
    },
    {
      label: "Page provider ref conflict rejected",
      rows: mutateRow(validRows, 1, { provider_type: "INTERNAL_HSM" }),
      code: "SCOPE_PROVIDER_REF_INVALID",
    },
    {
      label: "Page asset ref conflict rejected",
      rows: mutateRow(validRows, 1, { asset_code: ASSETS.b.assetCode }),
      code: "SCOPE_BINDING_REF_INVALID",
    },
  ];

  for (const scenario of cases) {
    await assertFakePageFailure(scopeClientModule, scenario);
  }

  const terminalClient = createFakeClient(scopeClientModule, createStaticFakePool({ rows: [] }));
  const terminalPage = await terminalClient.listBalanceObserverScopePage({ limit: 50 });

  assert(terminalPage.scopes.length === 0, "Fake terminal page scopes");
  assert(terminalPage.page.nextCursor === null, "Fake terminal page cursor");
  pass("Fake terminal page accepted");
}

async function assertHostileExactResultScenarios(scopeClientModule) {
  const validRows = baseExactRows();
  const cases = [
    {
      label: "Exact result object rejected",
      result: undefined,
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
    {
      label: "Exact page metadata rejected",
      rows: [{ ...validRows[0], page_scope_count: 1 }],
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
    {
      label: "Exact wrong provider rejected",
      rows: mutateRow(validRows, 0, { provider_id: PROVIDERS.b.id }),
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
    {
      label: "Exact wrong asset rejected",
      rows: mutateRow(validRows, 0, { asset_id: ASSETS.b.id }),
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
    {
      label: "Exact duplicate binding rejected",
      rows: [
        validRows[0],
        {
          ...validRows[1],
          binding_id: BINDINGS.aCollection.id,
        },
      ],
      code: "SCOPE_DUPLICATE_BINDING",
    },
    {
      label: "Exact row order rejected",
      rows: [validRows[1], validRows[0]],
      code: "SCOPE_RESULT_ORDER_INVALID",
    },
    {
      label: "Exact second scope rejected",
      rows: [
        validRows[0],
        {
          ...basePageRows({ provider: PROVIDERS.a, asset: ASSETS.b })[0],
          binding_id: BINDINGS.bCollection.id,
        },
      ],
      code: "SCOPE_RESULT_SHAPE_INVALID",
    },
  ];

  for (const scenario of cases) {
    await assertFakeExactFailure(scopeClientModule, scenario);
  }

  const emptyClient = createFakeClient(scopeClientModule, createStaticFakePool({ rows: [] }));
  const missing = await emptyClient.readBalanceObserverScope({
    providerId: PROVIDERS.a.id,
    assetId: ASSETS.a.id,
  });

  assert(missing === null, "Fake exact empty result null");
  pass("Fake exact empty accepted");
}

async function assertErrorMappingScenarios(scopeClientModule) {
  const cases = [
    {
      label: "DB cursor invalid mapped",
      error: { code: "22023", message: "scope_cursor_invalid" },
      code: "SCOPE_CURSOR_INVALID",
      retryable: false,
    },
    {
      label: "DB limit invalid mapped",
      error: { code: "22023", message: "scope_limit_invalid" },
      code: "SCOPE_LIMIT_INVALID",
      retryable: false,
    },
    {
      label: "DB identity invalid mapped",
      error: { code: "22023", message: "scope_identity_invalid" },
      code: "SCOPE_IDENTITY_INVALID",
      retryable: false,
    },
    {
      label: "DB statement timeout mapped",
      error: { code: "57014", message: "canceling statement due to timeout" },
      code: "SCOPE_DB_TIMEOUT",
      retryable: true,
    },
    {
      label: "DB query timeout mapped",
      error: { code: "XX000", message: "Query read timeout" },
      code: "SCOPE_DB_TIMEOUT",
      retryable: true,
    },
    {
      label: "DB connection timeout mapped",
      error: {
        code: "ETIMEDOUT",
        message: "Connection terminated due to connection timeout",
      },
      code: "SCOPE_DB_CONNECTION_FAILED",
      retryable: true,
    },
    {
      label: "DB unavailable mapped",
      error: { code: "ECONNREFUSED", message: "connect failed" },
      code: "SCOPE_DB_UNAVAILABLE",
      retryable: true,
    },
    {
      label: "DB SQLSTATE unavailable mapped",
      error: { code: "08006", message: "server unavailable" },
      code: "SCOPE_DB_UNAVAILABLE",
      retryable: true,
    },
    {
      label: "DB rejected mapped",
      error: { code: "42501", message: "permission denied" },
      code: "SCOPE_COMMAND_REJECTED",
      retryable: false,
    },
    {
      label: "DB unknown mapped",
      error: { code: "99999", message: "unsafe diagnostic" },
      code: "SCOPE_COMMAND_REJECTED",
      retryable: false,
    },
  ];

  for (const scenario of cases) {
    const client = createFakeClient(
      scopeClientModule,
      createThrowingFakePool(scenario.error),
    );

    await assertScopeClientRejects(
      () => client.listBalanceObserverScopePage(),
      scenario.code,
      scenario.retryable,
      scenario.label,
    );
    pass(scenario.label);
  }
}

async function assertPoolLifecycleScenarios(scopeClientModule) {
  let endCount = 0;
  let errorListener = null;
  const fakePool = {
    queryCount: 0,
    async query() {
      this.queryCount += 1;
      return { rows: [] };
    },
    async end() {
      endCount += 1;
    },
    on(event, listener) {
      if (event === "error") {
        errorListener = listener;
      }
    },
  };
  const client = createFakeClient(scopeClientModule, fakePool);

  assert(typeof errorListener === "function", "Idle error listener installed");
  errorListener({ code: "57014", message: "Query read timeout" });
  const page = await client.listBalanceObserverScopePage();

  assert(page.scopes.length === 0, "Idle error does not poison next read");
  pass("Pool idle error sanitized");

  await Promise.all([client.close(), client.close()]);
  assert(endCount === 1, "Pool close idempotent");
  pass("Pool close idempotent");

  await assertScopeClientRejects(
    () => client.listBalanceObserverScopePage(),
    "SCOPE_CLIENT_CLOSED",
    false,
    "Closed client read rejected",
  );
  pass("Closed client read rejected");

  const closingClient = createFakeClient(
    scopeClientModule,
    createClosingFailureFakePool({ code: "42501", message: "unsafe diagnostic" }),
  );

  await assertScopeClientRejects(
    () => closingClient.close(),
    "SCOPE_COMMAND_REJECTED",
    false,
    "Pool close failure sanitized",
  );
  pass("Pool close failure sanitized");
}

async function assertFakePageFailure(scopeClientModule, scenario) {
  const result = scenario.result ?? { rows: scenario.rows };
  const client = createFakeClient(scopeClientModule, createStaticFakePool(result));

  await assertScopeClientRejects(
    () => client.listBalanceObserverScopePage({ limit: 50 }),
    scenario.code,
    false,
    scenario.label,
  );
  pass(scenario.label);
}

async function assertFakeExactFailure(scopeClientModule, scenario) {
  const result = scenario.result ?? { rows: scenario.rows };
  const client = createFakeClient(scopeClientModule, createStaticFakePool(result));

  await assertScopeClientRejects(
    () =>
      client.readBalanceObserverScope({
        providerId: PROVIDERS.a.id,
        assetId: ASSETS.a.id,
      }),
    scenario.code,
    false,
    scenario.label,
  );
  pass(scenario.label);
}

function createFakeClient(scopeClientModule, fakePool) {
  return scopeClientModule.createBalanceObserverScopeClient(
    createFakePostgresConfig(scopeClientModule),
    {
      createPool(config) {
        assert(
          config.application_name ===
            scopeClientModule.BALANCE_OBSERVER_SCOPE_POSTGRES_APPLICATION_NAME,
          "Fake pool application_name fixed",
        );
        assert(config.max <= 4, "Fake pool max bounded");
        assert(!("connectionString" in config), "Fake pool no connection string");

        return fakePool;
      },
    },
  );
}

function createStaticFakePool(result) {
  return {
    queryCount: 0,
    async query() {
      this.queryCount += 1;

      return result;
    },
    async end() {},
    on() {},
  };
}

function createThrowingFakePool(error) {
  return {
    queryCount: 0,
    async query() {
      this.queryCount += 1;
      throw error;
    },
    async end() {},
    on() {},
  };
}

function createClosingFailureFakePool(error) {
  return {
    queryCount: 0,
    async query() {
      this.queryCount += 1;

      return { rows: [] };
    },
    async end() {
      throw error;
    },
    on() {},
  };
}

function basePageRows(options = {}) {
  const providerRef = options.provider ?? PROVIDERS.a;
  const assetRef = options.asset ?? ASSETS.a;
  const firstBinding = options.firstBinding ?? BINDINGS.aCollection;
  const secondBinding = options.secondBinding ?? BINDINGS.aTreasury;

  return [
    scopeRow({
      provider: providerRef,
      asset: assetRef,
      bindingRef: firstBinding,
      expectedCheckpointVersion: "7",
      pageScopeCount: 1,
      hasMore: true,
      nextProviderId: providerRef.id,
      nextAssetId: assetRef.id,
    }),
    scopeRow({
      provider: providerRef,
      asset: assetRef,
      bindingRef: secondBinding,
      expectedCheckpointVersion: "0",
      pageScopeCount: 1,
      hasMore: true,
      nextProviderId: providerRef.id,
      nextAssetId: assetRef.id,
    }),
  ];
}

function baseExactRows() {
  return basePageRows().map((row) => {
    const exactRow = { ...row };

    delete exactRow.page_scope_count;
    delete exactRow.has_more;
    delete exactRow.next_provider_id;
    delete exactRow.next_asset_id;

    return exactRow;
  });
}

function scopeRow({
  provider,
  asset: assetRef,
  bindingRef,
  expectedCheckpointVersion,
  pageScopeCount,
  hasMore,
  nextProviderId,
  nextAssetId,
}) {
  return {
    provider_id: provider.id,
    provider_code: provider.providerCode,
    provider_type: provider.providerType,
    supports_balance_observation: provider.supportsBalanceObservation,
    supports_transfer_observation: provider.supportsTransferObservation,
    supports_transfer_lookup: provider.supportsTransferLookup,
    supports_payout_submission: provider.supportsPayoutSubmission,
    supports_webhook_ingestion: provider.supportsWebhookIngestion,
    asset_id: assetRef.id,
    asset_code: assetRef.assetCode,
    binding_id: bindingRef.id,
    binding_key: bindingRef.bindingKey,
    account_role: bindingRef.accountRole,
    expected_checkpoint_version: expectedCheckpointVersion,
    page_scope_count: pageScopeCount,
    has_more: hasMore,
    next_provider_id: nextProviderId,
    next_asset_id: nextAssetId,
  };
}

function mutateRow(rows, index, patch) {
  return rows.map((row, rowIndex) =>
    rowIndex === index
      ? {
          ...row,
          ...patch,
        }
      : row,
  );
}

function mutateAllRows(rows, patch) {
  return rows.map((row) => ({
    ...row,
    ...patch,
  }));
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
      ('${ASSETS.a.id}', '${ASSETS.a.assetCode}', 'P4CA', 'P5 T04 Client Asset A', 'NATIVE', 9, null, 'ACTIVE'),
      ('${ASSETS.b.id}', '${ASSETS.b.assetCode}', 'P4CB', 'P5 T04 Client Asset B', 'NATIVE', 9, null, 'ACTIVE'),
      ('${ASSETS.c.id}', '${ASSETS.c.assetCode}', 'P4CC', 'P5 T04 Client Asset C', 'NATIVE', 9, null, 'ACTIVE'),
      ('${ASSETS.d.id}', '${ASSETS.d.assetCode}', 'P4CD', 'P5 T04 Client Asset D', 'NATIVE', 9, null, 'ACTIVE');

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
    values
      (
        '${PROVIDERS.a.id}',
        '${PROVIDERS.a.providerCode}',
        'P5 T04 Client Provider A',
        '${PROVIDERS.a.providerType}',
        true,
        true,
        false,
        false,
        true
      ),
      (
        '${PROVIDERS.b.id}',
        '${PROVIDERS.b.providerCode}',
        'P5 T04 Client Provider B',
        '${PROVIDERS.b.providerType}',
        true,
        false,
        true,
        false,
        false
      ),
      (
        '${PROVIDERS.noBalance.id}',
        '${PROVIDERS.noBalance.providerCode}',
        'P5 T04 Client Provider No Balance',
        '${PROVIDERS.noBalance.providerType}',
        false,
        true,
        false,
        false,
        false
      );

    update private.custody_providers
    set status = 'APPROVED'
    where id in (
      '${PROVIDERS.a.id}',
      '${PROVIDERS.b.id}',
      '${PROVIDERS.noBalance.id}'
    );

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
            `('${item.id}', '${item.provider.id}', '${item.asset.id}', '${item.bindingKey}', '${item.bindingKey}', '${item.accountRole}')`,
        )
        .join(",\n      ")};

    update private.custody_account_bindings
    set status = 'APPROVED'
    where id in (
      '${BINDINGS.aCollection.id}',
      '${BINDINGS.aTreasury.id}',
      '${BINDINGS.bCollection.id}',
      '${BINDINGS.cCollection.id}',
      '${BINDINGS.noBalance.id}',
      '${BINDINGS.suspendedAsset.id}'
    );

    update public.supported_assets
    set status = 'SUSPENDED'
    where id = '${ASSETS.d.id}';

    insert into private.observer_checkpoints (
      id,
      custody_account_binding_id,
      observer_kind,
      checkpoint_value,
      checkpoint_observed_at,
      version
    )
    values
      (
        '${CHECKPOINTS.aCollection.id}',
        '${CHECKPOINTS.aCollection.bindingId}',
        'BALANCE_OBSERVER_V1',
        'p5t04-client-checkpoint-a',
        '2026-08-02 00:00:00+00'::timestamptz,
        ${CHECKPOINTS.aCollection.version}
      ),
      (
        '${CHECKPOINTS.aTreasuryTransfer.id}',
        '${CHECKPOINTS.aTreasuryTransfer.bindingId}',
        'TRANSFER_OBSERVER_V1',
        'p5t04-client-transfer-checkpoint',
        '2026-08-02 00:00:00+00'::timestamptz,
        ${CHECKPOINTS.aTreasuryTransfer.version}
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

async function runCleanupResetAndStop() {
  try {
    await runNpmScript("db:reset:local", "Final DB reset", 180_000);
    const residue = await adminSqlScalar(`
      select (
        (select count(*) from public.supported_assets where asset_code like 'P5T04_CLIENT_%') +
        (select count(*) from private.custody_providers where provider_code like 'P5T04_CLIENT_%') +
        (select count(*) from private.custody_account_bindings where binding_key like 'p5t04_client_%')
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

function createFakePostgresConfig(scopeClientModule) {
  return {
    host: LOCAL_DB_HOST,
    port: LOCAL_DB_PORT,
    database: DB_NAME,
    user: SCOPE_ROLE,
    password: () => "runtime-fake-credential",
    ssl: false,
    ...scopeClientModule.DEFAULT_CUSTODY_OBSERVER_SCOPE_POSTGRES_LIMITS,
  };
}

function asset(id, assetCode) {
  return {
    id,
    assetCode,
  };
}

function provider(id, providerCode, providerType = "MPC_CUSTODIAN") {
  return {
    id,
    providerCode,
    providerType,
    supportsBalanceObservation: true,
    supportsTransferObservation: providerCode.endsWith("_A"),
    supportsTransferLookup: providerCode.endsWith("_B"),
    supportsPayoutSubmission: false,
    supportsWebhookIngestion: providerCode.endsWith("_A"),
  };
}

function binding(id, providerRef, assetRef, bindingKey, accountRole) {
  return {
    id,
    provider: providerRef,
    asset: assetRef,
    bindingKey,
    accountRole,
  };
}

function createEphemeralPassword() {
  return randomBytes(32).toString("base64url");
}

async function assertPgRejects(callback, label) {
  try {
    await callback();
  } catch {
    pass(label);
    return;
  }

  throw new Error(`FAIL ${label}`);
}

async function assertScopeClientRejects(callback, expectedCode, retryable, label) {
  try {
    await callback();
  } catch (error) {
    assert(
      error instanceof Error &&
        error.name === "CustodyBalanceObserverScopeClientError",
      `${label} error class`,
    );
    assert(error.message === "custody_balance_observer_scope_client_failed", `${label} safe message`);
    assert(error.code === expectedCode, `${label} code`);
    assert(error.retryable === retryable, `${label} retryable`);
    assert(!("detail" in error), `${label} no raw detail`);

    return;
  }

  throw new Error(`FAIL ${label}`);
}

async function closeClients() {
  for (const client of clientsToClose) {
    try {
      await client.close();
    } catch {
      console.error("WARN_SCOPE_CLIENT_CLOSE_RETRY_REQUIRED");
    }
  }

  clientsToClose.clear();
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
        reject(new Error(`FAIL child process exited ${redactDiagnostic(stderr || stdout)}`));
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

  globalThis.fetch = async () => {
    externalNetworkCalls += 1;
    providerNetworkCalls += 1;
    throw new Error("FAIL external fetch blocked");
  };
  http.request = () => {
    externalNetworkCalls += 1;
    providerNetworkCalls += 1;
    throw new Error("FAIL external http blocked");
  };
  https.request = () => {
    externalNetworkCalls += 1;
    providerNetworkCalls += 1;
    throw new Error("FAIL external https blocked");
  };
  net.Socket.prototype.connect = function connectWithGuard(...args) {
    const target = normalizeSocketTarget(args);

    if (target.port === LOCAL_DB_PORT && target.host === LOCAL_DB_HOST) {
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
  };
}

function restoreLocalNetworkGuard() {
  if (!networkGuard) {
    return;
  }

  globalThis.fetch = networkGuard.originalFetch;
  http.request = networkGuard.originalHttpRequest;
  https.request = networkGuard.originalHttpsRequest;
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

function quoteSqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
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

function assertSafeOutput() {
  const output = emittedLines.join("\n");

  assertSafeText(output, "Runtime output");
  assert(!/balobs:v1:[nkc]:[0-9a-f]{64}/.test(output), "Output no observation key");
  assert(!/p5t04-client-(checkpoint|transfer)/i.test(output), "Output no raw checkpoint");
  assert(!/password|connection string|stack|sql parameter/i.test(output), "Output no sensitive diagnostic");
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
