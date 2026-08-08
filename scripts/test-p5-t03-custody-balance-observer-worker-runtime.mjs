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
  providerCode: "P5T03_WORKER_PROVIDER",
  providerType: "MPC_CUSTODIAN",
  capabilities: ["BALANCE_OBSERVATION"],
};

const ASSETS = {
  primary: asset("00000000-0000-4000-8000-000000590101", "P5T03_WORKER_ASSET_A"),
  localContent: asset(
    "00000000-0000-4000-8000-000000590102",
    "P5T03_WORKER_ASSET_B",
  ),
  productionContent: asset(
    "00000000-0000-4000-8000-000000590103",
    "P5T03_WORKER_ASSET_C",
  ),
  availableOnly: asset(
    "00000000-0000-4000-8000-000000590104",
    "P5T03_WORKER_ASSET_D",
  ),
  partial: asset("00000000-0000-4000-8000-000000590105", "P5T03_WORKER_ASSET_E"),
  abort: asset("00000000-0000-4000-8000-000000590106", "P5T03_WORKER_ASSET_F"),
};

const BINDINGS = {
  primary: binding(
    "00000000-0000-4000-8000-000000590301",
    ASSETS.primary,
    "p5t03_worker_primary",
    "COLLECTION",
  ),
  localContent: binding(
    "00000000-0000-4000-8000-000000590302",
    ASSETS.localContent,
    "p5t03_worker_local_content",
    "COLLECTION",
  ),
  productionContent: binding(
    "00000000-0000-4000-8000-000000590303",
    ASSETS.productionContent,
    "p5t03_worker_production_content",
    "COLLECTION",
  ),
  availableOnly: binding(
    "00000000-0000-4000-8000-000000590304",
    ASSETS.availableOnly,
    "p5t03_worker_available_only",
    "COLLECTION",
  ),
  partialSuccess: binding(
    "00000000-0000-4000-8000-000000590305",
    ASSETS.partial,
    "p5t03_worker_partial_success",
    "COLLECTION",
  ),
  partialFailure: binding(
    "00000000-0000-4000-8000-000000590306",
    ASSETS.partial,
    "p5t03_worker_partial_failure",
    "TREASURY",
  ),
  abortFirst: binding(
    "00000000-0000-4000-8000-000000590307",
    ASSETS.abort,
    "p5t03_worker_abort_first",
    "COLLECTION",
  ),
  abortSecond: binding(
    "00000000-0000-4000-8000-000000590308",
    ASSETS.abort,
    "p5t03_worker_abort_second",
    "TREASURY",
  ),
};

let runtimeCaseCount = 0;
let externalNetworkCalls = 0;
let providerNetworkCalls = 0;
let localPostgresConnections = 0;
let credentialEnvReads = 0;
let serviceRoleUsage = 0;
let tempRuntimeDir = null;
let workerPassword = null;
let commandClient = null;
let networkGuard = null;
const emittedLines = [];

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

    await assertDirectWorkerPrivileges(modules);
    commandClient = modules.commandClient.createBalanceObserverCommandClient(
      createWorkerPostgresConfig(modules.commandClient),
    );

    await assertWorkerSuccessScenarios(modules, commandClient);
    await assertAdapterResultValidationScenarios(modules, commandClient);
    await assertAbortScenarios(modules, commandClient);
    await assertPoolLifecycle(modules, commandClient);

    assert(localPostgresConnections >= 1, "Local PostgreSQL connection count");
    pass("Local PostgreSQL network allowlist");
    assert(externalNetworkCalls === 0, "External network calls zero");
    pass("External network guard");
    assert(providerNetworkCalls === 0, "Provider network calls zero");
    pass("Provider network guard");
    assert(credentialEnvReads === 0, "Credential environment reads zero");
    pass("Credential environment read guard");
    assert(serviceRoleUsage === 0, "Service role usage zero");
    pass("Service-role usage guard");
  } finally {
    process.env = originalEnv;
    restoreLocalNetworkGuard();
    await closeCommandClient();
    await clearWorkerPassword();
    await runCleanupResetAndStop();
    await cleanupRuntimeModules();
  }

  assert(!tempRuntimeDir || !existsSync(tempRuntimeDir), "Temp runtime cleanup");
  pass("Temp runtime cleanup");
  assertSafeOutput();

  console.log(`WORKER_RUNTIME_CASE_COUNT=${runtimeCaseCount}`);
  console.log(`LOCAL_POSTGRES_CONNECTIONS=${localPostgresConnections}`);
  console.log(`EXTERNAL_NETWORK_CALLS=${externalNetworkCalls}`);
  console.log(`PROVIDER_NETWORK_CALLS=${providerNetworkCalls}`);
  console.log(`CREDENTIAL_ENV_READS=${credentialEnvReads}`);
  console.log("CUSTODY_BALANCE_OBSERVER_WORKER_RUNTIME_PASS");
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
  pass("Source boundary scan");
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

    const appName = await pool.query(
      "select application_name from pg_stat_activity where pid = pg_backend_pid()",
    );

    assert(
      appName.rows[0]?.application_name ===
        modules.commandClient.BALANCE_OBSERVER_POSTGRES_APPLICATION_NAME,
      "Application name fixed",
    );
    pass("Fixed application_name");

    await assertPgRejects(
      () => pool.query("select count(*) from private.custody_providers"),
      "Direct private table SELECT rejected",
    );
    await assertPgRejects(
      () =>
        pool.query(
          `
          select *
          from private.record_external_balance_observation(
            $1::uuid,
            $2::text,
            $3::text,
            $4::numeric,
            $5::timestamptz,
            $6::text
          )
          `,
          [
            BINDINGS.primary.id,
            "BALANCE_OBSERVER_V1",
            syntheticObservationKey("0"),
            "1",
            "2026-08-01T00:00:00.000000Z",
            syntheticObservationKey("0"),
          ],
        ),
      "Lower-level primitive execute rejected",
    );
  } finally {
    await pool.end();
  }
}

async function assertWorkerSuccessScenarios(modules, client) {
  const { createMockCustodyObservationAdapter } = modules.mockAdapter;
  const { runCustodyBalanceObserverWorkUnit } = modules.worker;
  const nativeIdentityValue = "p5t03-worker-native-0001";
  const checkpointIdentityValue = "p5t03-worker-checkpoint-0002";
  const nativeRecorder = createRecordingCommandClient(client);

  const primaryInitial = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("PRODUCTION", ASSETS.primary, [
      workItem(BINDINGS.primary, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.primary,
          { kind: "NATIVE", value: nativeIdentityValue },
          "100",
          "100",
          "2026-08-01T01:00:00.000000Z",
        ),
      ],
    }),
    commandClient: nativeRecorder.client,
  });

  assertSingleSuccess(primaryInitial, {
    observationCreated: true,
    checkpointCreated: true,
    checkpointAdvanced: false,
    checkpointVersion: "1",
  });
  assert(nativeRecorder.calls.length === 1, "Production native DB command count");
  assert(
    /^balobs:v1:n:[0-9a-f]{64}$/.test(nativeRecorder.calls[0]?.observationKey ?? ""),
    "Production native key mode",
  );
  pass("Initial NATIVE success");
  pass("Production NATIVE DB command");

  const primaryReplay = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("PRODUCTION", ASSETS.primary, [
      workItem(BINDINGS.primary, "1"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.primary,
          { kind: "NATIVE", value: nativeIdentityValue },
          "100",
          "100",
          "2026-08-01T01:00:00.000000Z",
        ),
      ],
    }),
    commandClient: client,
  });

  assertSingleSuccess(primaryReplay, {
    observationCreated: false,
    checkpointCreated: false,
    checkpointAdvanced: false,
    checkpointVersion: "1",
  });
  pass("Exact replay no-op");

  const checkpointRecorder = createRecordingCommandClient(client);
  const primaryAdvance = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("PRODUCTION", ASSETS.primary, [
      workItem(BINDINGS.primary, "1"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.primary,
          { kind: "CHECKPOINT", value: checkpointIdentityValue },
          "150",
          "150",
          "2026-08-01T02:00:00.000000Z",
        ),
      ],
    }),
    commandClient: checkpointRecorder.client,
  });

  assertSingleSuccess(primaryAdvance, {
    observationCreated: true,
    checkpointCreated: false,
    checkpointAdvanced: true,
    checkpointVersion: "2",
  });
  const checkpointCall = checkpointRecorder.calls[0];

  assert(checkpointRecorder.calls.length === 1, "Production checkpoint DB command count");
  assert(
    /^balobs:v1:k:[0-9a-f]{64}$/.test(checkpointCall?.observationKey ?? ""),
    "Production checkpoint key mode",
  );
  assert(
    checkpointCall?.observationKey !== checkpointIdentityValue &&
      !(checkpointCall?.observationKey ?? "").includes(checkpointIdentityValue),
    "Production checkpoint raw identity not exposed",
  );
  assert(checkpointCall?.observedTotalUnits === "150", "Production checkpoint total amount");
  assert(
    checkpointCall?.observedAt === "2026-08-01T02:00:00.000000Z",
    "Production checkpoint timestamp",
  );
  pass("CHECKPOINT advance");
  pass("Production CHECKPOINT DB command");
  pass("Production CHECKPOINT key mode");

  const localContent = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.localContent, [
      workItem(BINDINGS.localContent, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.localContent,
          { kind: "CONTENT" },
          "200",
          "200",
          "2026-08-01T03:00:00.000000Z",
        ),
      ],
    }),
    commandClient: client,
  });

  assertSingleSuccess(localContent, {
    observationCreated: true,
    checkpointCreated: true,
    checkpointAdvanced: false,
    checkpointVersion: "1",
  });
  pass("LOCAL_MOCK CONTENT success");

  const beforeProductionContent = await observerCounts();
  const productionContentRecorder = createRecordingCommandClient(client);
  const productionContent = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("PRODUCTION", ASSETS.productionContent, [
      workItem(BINDINGS.productionContent, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.productionContent,
          { kind: "CONTENT" },
          "210",
          "210",
          "2026-08-01T03:10:00.000000Z",
        ),
      ],
    }),
    commandClient: productionContentRecorder.client,
  });

  assertFailure(
    productionContent.outcomes[0],
    "IDENTITY",
    "CONTENT_IDENTITY_NOT_ALLOWED",
  );
  assert(productionContent.summary.databaseAttempts === 0, "Production content DB attempt zero");
  assert(
    productionContentRecorder.calls.length === 0,
    "Production content DB command count zero",
  );
  assertCountsEqual(beforeProductionContent, await observerCounts(), "Production content side effect zero");
  pass("Production CONTENT rejection");
  pass("Production CONTENT DB command zero");

  const availableFirst = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.availableOnly, [
      workItem(BINDINGS.availableOnly, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.availableOnly,
          { kind: "CONTENT" },
          "1",
          "777",
          "2026-08-01T04:00:00.000000Z",
        ),
      ],
    }),
    commandClient: client,
  });

  assertSingleSuccess(availableFirst, {
    observationCreated: true,
    checkpointCreated: true,
    checkpointAdvanced: false,
    checkpointVersion: "1",
  });

  const beforeAvailableReplay = await observerCounts();
  const availableReplay = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.availableOnly, [
      workItem(BINDINGS.availableOnly, "1"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.availableOnly,
          { kind: "CONTENT" },
          "2",
          "777",
          "2026-08-01T04:00:00.000000Z",
        ),
      ],
    }),
    commandClient: client,
  });

  assertSingleSuccess(availableReplay, {
    observationCreated: false,
    checkpointCreated: false,
    checkpointAdvanced: false,
    checkpointVersion: "1",
  });
  assertCountsEqual(beforeAvailableReplay, await observerCounts(), "Available-only replay side effect zero");
  pass("Available-only difference replay");

  const partial = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.partial, [
      workItem(BINDINGS.partialSuccess, "0"),
      workItem(BINDINGS.partialFailure, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.partialSuccess,
          { kind: "CONTENT" },
          "300",
          "300",
          "2026-08-01T05:00:00.000000Z",
        ),
        errorFixture(BINDINGS.partialFailure, "TIMEOUT"),
      ],
    }),
    commandClient: client,
  });

  assert(partial.outcomes.length === 2, "Partial outcome count");
  assert(partial.outcomes[0]?.ok === true, "Partial success committed");
  assertFailure(partial.outcomes[1], "ADAPTER", "TIMEOUT");
  assert(partial.summary.databaseAttempts === 1, "Partial DB attempt count");
  pass("Partial adapter failure");

  const beforeStale = await observerCounts();
  const stale = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("PRODUCTION", ASSETS.primary, [
      workItem(BINDINGS.primary, "1"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.primary,
          { kind: "NATIVE", value: "p5t03-worker-native-0003" },
          "175",
          "175",
          "2026-08-01T03:00:00.000000Z",
        ),
      ],
    }),
    commandClient: client,
  });

  assertFailure(stale.outcomes[0], "DATABASE", "CHECKPOINT_VERSION_CONFLICT");
  assert(stale.summary.databaseAttempts === 1, "Stale version DB attempt one");
  assertCountsEqual(beforeStale, await observerCounts(), "Stale conflict side effect zero");
  pass("Stale version conflict");
}

async function assertAdapterResultValidationScenarios(modules, client) {
  const { runCustodyBalanceObserverWorkUnit } = modules.worker;
  const unit = workUnit("LOCAL_MOCK", ASSETS.partial, [
    workItem(BINDINGS.partialSuccess, "1"),
    workItem(BINDINGS.partialFailure, "0"),
  ]);
  const requested = unit.bindings.map((item) => item.binding);
  const baseResults = [
    successResult(requested[0], PROVIDER),
    successResult(requested[1], PROVIDER),
  ];

  await assertValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    client,
    unit,
    [baseResults[0], baseResults[1], successResult(requested[0], PROVIDER)],
    "ADAPTER_RESULT_COUNT_MISMATCH",
    "Result count mismatch",
  );
  await assertValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    client,
    unit,
    [baseResults[1], baseResults[0]],
    "ADAPTER_RESULT_ORDER_MISMATCH",
    "Result order mismatch",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      {
        ...baseResults[0],
        observation: {
          ...baseResults[0].observation,
          binding: requested[1],
        },
      },
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Binding mismatch isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      {
        ...baseResults[0],
        observation: {
          ...baseResults[0].observation,
          provider: {
            ...PROVIDER,
            providerCode: "P5T03_WORKER_PROVIDER_ALT",
          },
        },
      },
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Provider mismatch isolated",
    ["P5T03_WORKER_PROVIDER_ALT"],
  );
  await assertValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    client,
    unit,
    [baseResults[0], baseResults[0]],
    "ADAPTER_DUPLICATE_BINDING",
    "Result duplicate binding",
  );
  await assertValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    client,
    unit,
    [baseResults[0]],
    "ADAPTER_MISSING_RESULT",
    "Result missing binding",
  );
  await assertValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    client,
    unit,
    [
      baseResults[0],
      successResult(
        {
          providerCode: PROVIDER.providerCode,
          bindingKey: "p5t03_worker_unexpected",
          assetCode: ASSETS.partial.assetCode,
          accountRole: "FEE",
        },
        PROVIDER,
      ),
    ],
    "ADAPTER_UNEXPECTED_RESULT",
    "Result unexpected binding",
  );

  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      errorResult(requested[0], {
        code: "UNKNOWN_PROVIDER_CODE",
        retryable: true,
        retryAfterMs: null,
      }),
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Unknown error code isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      errorResult(requested[0], {
        code: "TIMEOUT",
        retryable: "true",
        retryAfterMs: null,
      }),
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Retryable string isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      errorResult(requested[0], {
        code: "TIMEOUT",
        retryable: null,
        retryAfterMs: null,
      }),
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Retryable null isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      errorResult(requested[0], {
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterMs: -1,
      }),
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Retry-After negative isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      errorResult(requested[0], {
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterMs: Number.NaN,
      }),
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Retry-After NaN isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      errorResult(requested[0], {
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterMs: Number.POSITIVE_INFINITY,
      }),
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Retry-After infinity isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      errorResult(requested[0], {
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterMs: "1",
      }),
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Retry-After string isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      errorResult(requested[0], {
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterMs: 300_001,
      }),
      baseResults[1],
    ],
    "VALIDATION",
    "ADAPTER_RESULT_INVALID",
    "Retry-After max isolated",
  );
  await assertRetryableFalseNoRetry(runCustodyBalanceObserverWorkUnit, unit);
  await assertNonRetryableCatalogNoRetry(runCustodyBalanceObserverWorkUnit, unit);
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      successResult(requested[0], PROVIDER, {
        kind: "UNKNOWN",
        value: "p5t03-worker-unknown-identity",
      }),
      baseResults[1],
    ],
    "IDENTITY",
    "ADAPTER_IDENTITY_INVALID",
    "Unknown identity isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      successResult(requested[0], PROVIDER, {
        kind: "NATIVE",
      }),
      baseResults[1],
    ],
    "IDENTITY",
    "ADAPTER_IDENTITY_INVALID",
    "Native identity value missing isolated",
  );
  await assertPerBindingAdapterValidationFailure(
    runCustodyBalanceObserverWorkUnit,
    unit,
    [
      successResult(requested[0], PROVIDER, {
        kind: "CHECKPOINT",
        value: 1,
      }),
      baseResults[1],
    ],
    "IDENTITY",
    "ADAPTER_IDENTITY_INVALID",
    "Checkpoint identity value invalid isolated",
  );
  await assertMalformedRetryResultValidation(runCustodyBalanceObserverWorkUnit, unit);
  await assertRetryNonArrayResultValidation(
    runCustodyBalanceObserverWorkUnit,
    unit,
    null,
    "Retry non-array null invalid",
  );
  await assertRetryNonArrayResultValidation(
    runCustodyBalanceObserverWorkUnit,
    unit,
    undefined,
    "Retry non-array undefined invalid",
  );
  await assertRetryNonArrayResultValidation(
    runCustodyBalanceObserverWorkUnit,
    unit,
    { raw: "p5t03 retry object should stay hidden" },
    "Retry non-array object invalid",
    ["p5t03 retry object should stay hidden"],
  );
  await assertRetryNonArrayResultValidation(
    runCustodyBalanceObserverWorkUnit,
    unit,
    "p5t03 retry string should stay hidden",
    "Retry non-array string invalid",
    ["p5t03 retry string should stay hidden"],
  );
}

async function assertAbortScenarios(modules, client) {
  const { createMockCustodyObservationAdapter } = modules.mockAdapter;
  const { runCustodyBalanceObserverWorkUnit } = modules.worker;
  let adapterCalls = 0;
  const controller = new AbortController();

  controller.abort();

  const beforeAdapterAbort = await observerCounts();
  const beforeAdapter = {
    provider: PROVIDER,
    async readHealth() {
      return {
        provider: PROVIDER,
        status: "AVAILABLE",
        checkedAt: "2026-08-01T01:00:00.000000Z",
      };
    },
    async readBalances() {
      adapterCalls += 1;

      return [];
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
  const abortBeforeAdapter = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.abort, [
      workItem(BINDINGS.abortFirst, "0"),
      workItem(BINDINGS.abortSecond, "0"),
    ]),
    adapter: beforeAdapter,
    commandClient: client,
    signal: controller.signal,
  });

  assert(adapterCalls === 0, "Abort before adapter call count");
  assert(abortBeforeAdapter.summary.abortedBindings === 2, "Abort before adapter summary");
  assert(abortBeforeAdapter.summary.databaseAttempts === 0, "Abort before adapter DB zero");
  assertCountsEqual(beforeAdapterAbort, await observerCounts(), "Abort before adapter side effect zero");
  pass("Abort before adapter");

  const abortAfterFirstController = new AbortController();
  let commandCalls = 0;
  const abortAfterFirstClient = {
    async recordBalanceObservationAndAdvanceCheckpoint(input) {
      const result =
        await client.recordBalanceObservationAndAdvanceCheckpoint(input);

      commandCalls += 1;

      if (commandCalls === 1) {
        abortAfterFirstController.abort();
      }

      return result;
    },
    async close() {},
  };
  const abortAfterFirst = await runCustodyBalanceObserverWorkUnit({
    workUnit: workUnit("LOCAL_MOCK", ASSETS.abort, [
      workItem(BINDINGS.abortFirst, "0"),
      workItem(BINDINGS.abortSecond, "0"),
    ]),
    adapter: createMockCustodyObservationAdapter({
      provider: PROVIDER,
      health: healthFixture(),
      balances: [
        successFixture(
          BINDINGS.abortFirst,
          { kind: "CONTENT" },
          "400",
          "400",
          "2026-08-01T06:00:00.000000Z",
        ),
        successFixture(
          BINDINGS.abortSecond,
          { kind: "CONTENT" },
          "500",
          "500",
          "2026-08-01T06:10:00.000000Z",
        ),
      ],
    }),
    commandClient: abortAfterFirstClient,
    signal: abortAfterFirstController.signal,
  });

  assert(commandCalls === 1, "Abort after first DB calls");
  assert(abortAfterFirst.outcomes[0]?.ok === true, "Abort first binding persisted");
  assertFailure(abortAfterFirst.outcomes[1], "ABORTED", "ABORTED");
  assert(abortAfterFirst.summary.databaseAttempts === 1, "Abort after first DB attempts");
  pass("Abort after first binding");
}

async function assertPoolLifecycle(modules, client) {
  await client.close();
  pass("Pool normal close");
  await client.close();
  pass("Pool repeated close safe");
  commandClient = null;

  const failureClient = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient),
  );

  try {
    await assertRejects(
      () =>
        failureClient.recordBalanceObservationAndAdvanceCheckpoint({
          bindingId: "00000000-0000-4000-8000-000000599999",
          observerKind: "BALANCE_OBSERVER_V1",
          observationKey: syntheticObservationKey("1"),
          observedTotalUnits: "1",
          observedAt: "2026-08-01T07:00:00.000000Z",
          expectedCheckpointVersion: "0",
        }),
      "Failure client safe rejection",
    );
    pass("Pool failure close");
  } finally {
    await failureClient.close();
  }

  const abortClient = modules.commandClient.createBalanceObserverCommandClient(
    createWorkerPostgresConfig(modules.commandClient),
  );

  await abortClient.close();
  pass("Pool abort close");
}

async function assertValidationFailure(
  runCustodyBalanceObserverWorkUnit,
  client,
  unit,
  results,
  code,
  label,
) {
  const before = await observerCounts();
  const result = await runCustodyBalanceObserverWorkUnit({
    workUnit: unit,
    adapter: controlledAdapter(results),
    commandClient: client,
  });

  assert(
    result.outcomes.every(
      (outcome) =>
        !outcome.ok &&
        outcome.stage === "VALIDATION" &&
        outcome.code === code,
    ),
    label,
  );
  assert(result.summary.databaseAttempts === 0, `${label} DB attempts`);
  assertCountsEqual(before, await observerCounts(), `${label} side effects`);
  pass(label);
}

async function assertPerBindingAdapterValidationFailure(
  runCustodyBalanceObserverWorkUnit,
  unit,
  results,
  stage,
  code,
  label,
  hiddenValues = ["UNKNOWN_PROVIDER_CODE"],
) {
  const commandClient = recordingNoopCommandClient();
  const result = await runCustodyBalanceObserverWorkUnit({
    workUnit: unit,
    adapter: controlledAdapter(results),
    commandClient,
  });

  assert(result.outcomes.length === 2, `${label} outcome count`);
  assertFailure(result.outcomes[0], stage, code);
  assert(result.outcomes[0].databaseAttempts === 0, `${label} failed DB zero`);
  assert(result.outcomes[1]?.ok === true, `${label} next binding continued`);
  assert(commandClient.calls.length === 1, `${label} next binding DB only`);
  assert(result.summary.databaseAttempts === 1, `${label} summary DB count`);
  assert(result.summary.failedBindings === 1, `${label} failed binding count`);
  const serializedFailure = JSON.stringify(result.outcomes[0]);
  for (const hiddenValue of hiddenValues) {
    assert(!serializedFailure.includes(hiddenValue), `${label} raw value hidden`);
  }
  pass(label);
}

async function assertRetryableFalseNoRetry(runCustodyBalanceObserverWorkUnit, unit) {
  const commandClient = recordingNoopCommandClient();
  let adapterCalls = 0;
  const result = await runCustodyBalanceObserverWorkUnit({
    workUnit: {
      ...unit,
      bindings: [unit.bindings[0]],
    },
    adapter: scriptedAdapter(() => {
      adapterCalls += 1;

      return [
        errorResult(unit.bindings[0].binding, {
          code: "TIMEOUT",
          retryable: false,
          retryAfterMs: null,
        }),
      ];
    }),
    commandClient,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: immediateRetryRuntime(),
  });

  assertFailure(result.outcomes[0], "ADAPTER", "TIMEOUT");
  assert(result.outcomes[0].adapterAttempts === 1, "Retryable false attempts one");
  assert(adapterCalls === 1, "Retryable false adapter calls one");
  assert(commandClient.calls.length === 0, "Retryable false DB zero");
  assert(!result.outcomes[0].retryExhausted, "Retryable false not exhausted");
  pass("Retryable false no retry");
}

async function assertNonRetryableCatalogNoRetry(
  runCustodyBalanceObserverWorkUnit,
  unit,
) {
  const commandClient = recordingNoopCommandClient();
  let adapterCalls = 0;
  const result = await runCustodyBalanceObserverWorkUnit({
    workUnit: {
      ...unit,
      bindings: [unit.bindings[0]],
    },
    adapter: scriptedAdapter(() => {
      adapterCalls += 1;

      return [
        errorResult(unit.bindings[0].binding, {
          code: "UNSUPPORTED_ASSET",
          retryable: true,
          retryAfterMs: null,
        }),
      ];
    }),
    commandClient,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: immediateRetryRuntime(),
  });

  assertFailure(result.outcomes[0], "ADAPTER", "UNSUPPORTED_ASSET");
  assert(result.outcomes[0].adapterAttempts === 1, "Non-retryable attempts one");
  assert(adapterCalls === 1, "Non-retryable adapter calls one");
  assert(commandClient.calls.length === 0, "Non-retryable DB zero");
  assert(!result.outcomes[0].retryable, "Non-retryable catalog wins");
  pass("Non-retryable catalog no retry");
}

async function assertMalformedRetryResultValidation(
  runCustodyBalanceObserverWorkUnit,
  unit,
) {
  const commandClient = recordingNoopCommandClient();
  let adapterCalls = 0;
  const result = await runCustodyBalanceObserverWorkUnit({
    workUnit: {
      ...unit,
      bindings: [unit.bindings[0]],
    },
    adapter: scriptedAdapter(() => {
      adapterCalls += 1;

      if (adapterCalls === 1) {
        return [
          errorResult(unit.bindings[0].binding, {
            code: "TIMEOUT",
            retryable: true,
            retryAfterMs: null,
          }),
        ];
      }

      return [
        errorResult(unit.bindings[0].binding, {
          code: "UNKNOWN_RETRY_CODE",
          retryable: true,
          retryAfterMs: null,
        }),
      ];
    }),
    commandClient,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: immediateRetryRuntime(),
  });

  assertFailure(result.outcomes[0], "VALIDATION", "ADAPTER_RETRY_RESULT_INVALID");
  assert(result.outcomes[0].adapterAttempts === 2, "Malformed retry attempts two");
  assert(adapterCalls === 2, "Malformed retry adapter calls two");
  assert(commandClient.calls.length === 0, "Malformed retry DB zero");
  assert(!JSON.stringify(result.outcomes[0]).includes("UNKNOWN_RETRY_CODE"), "Malformed retry raw code hidden");
  pass("Malformed retry result invalid");
}

async function assertRetryNonArrayResultValidation(
  runCustodyBalanceObserverWorkUnit,
  unit,
  retryResult,
  label,
  hiddenValues = [],
) {
  const commandClient = recordingNoopCommandClient();
  let adapterCalls = 0;
  const result = await runCustodyBalanceObserverWorkUnit({
    workUnit: {
      ...unit,
      bindings: [unit.bindings[0]],
    },
    adapter: scriptedAdapter(() => {
      adapterCalls += 1;

      if (adapterCalls === 1) {
        return [
          errorResult(unit.bindings[0].binding, {
            code: "TIMEOUT",
            retryable: true,
            retryAfterMs: null,
          }),
        ];
      }

      return retryResult;
    }),
    commandClient,
    retryPolicy: shortRetryPolicy(),
    retryRuntime: immediateRetryRuntime(),
  });

  assertFailure(result.outcomes[0], "VALIDATION", "ADAPTER_RETRY_RESULT_INVALID");
  assert(result.outcomes[0].adapterAttempts === 2, `${label} attempts two`);
  assert(adapterCalls === 2, `${label} adapter calls two`);
  assert(commandClient.calls.length === 0, `${label} DB zero`);
  assert(result.summary.databaseAttempts === 0, `${label} summary DB zero`);
  assert(!result.outcomes[0].retryExhausted, `${label} not exhausted`);
  const serializedFailure = JSON.stringify(result.outcomes[0]);
  for (const hiddenValue of hiddenValues) {
    assert(!serializedFailure.includes(hiddenValue), `${label} raw value hidden`);
  }
  pass(label);
}

async function loadRuntimeModules() {
  tempRuntimeDir = await mkdtemp(
    path.join(tmpdir(), "p5-t03-balance-observer-worker-"),
  );

  try {
    await symlink(
      path.join(process.cwd(), "node_modules"),
      path.join(tempRuntimeDir, "node_modules"),
      "junction",
    );
  } catch {
    // Node global resolution can still find repository packages on most hosts.
  }

  for (const moduleInfo of SOURCE_MODULES) {
    const sourceText = await readFile(moduleInfo.sourcePath, "utf8");
    const transpiled = transpileTypeScript(
      sourceText.replace(/^\s*import\s+["']server-only["'];\s*$/m, ""),
      moduleInfo.sourcePath,
    );

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
    worker: runtimeRequire("./balance-observer-worker.js"),
  };
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
      ('${ASSETS.primary.id}', '${ASSETS.primary.assetCode}', 'P5WA', 'P5 T03 Worker Asset A', 'NATIVE', 9, null, 'ACTIVE'),
      ('${ASSETS.localContent.id}', '${ASSETS.localContent.assetCode}', 'P5WB', 'P5 T03 Worker Asset B', 'NATIVE', 9, null, 'ACTIVE'),
      ('${ASSETS.productionContent.id}', '${ASSETS.productionContent.assetCode}', 'P5WC', 'P5 T03 Worker Asset C', 'NATIVE', 9, null, 'ACTIVE'),
      ('${ASSETS.availableOnly.id}', '${ASSETS.availableOnly.assetCode}', 'P5WD', 'P5 T03 Worker Asset D', 'NATIVE', 9, null, 'ACTIVE'),
      ('${ASSETS.partial.id}', '${ASSETS.partial.assetCode}', 'P5WE', 'P5 T03 Worker Asset E', 'NATIVE', 9, null, 'ACTIVE'),
      ('${ASSETS.abort.id}', '${ASSETS.abort.assetCode}', 'P5WF', 'P5 T03 Worker Asset F', 'NATIVE', 9, null, 'ACTIVE');

    insert into private.custody_providers (
      id,
      provider_code,
      display_name,
      provider_type,
      supports_balance_observation,
      supports_transfer_observation
    )
    values (
      '00000000-0000-4000-8000-000000590201',
      '${PROVIDER.providerCode}',
      'P5 T03 Worker Provider',
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
            `('${item.id}', '00000000-0000-4000-8000-000000590201', '${item.asset.id}', '${item.binding.bindingKey}', '${item.binding.bindingKey}', '${item.binding.accountRole}')`,
        )
        .join(",\n      ")};

    update private.custody_account_bindings
    set status = 'APPROVED'
    where custody_provider_id = '00000000-0000-4000-8000-000000590201';
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
        (select count(*) from public.supported_assets where asset_code like 'P5T03_WORKER_%') +
        (select count(*) from private.custody_providers where provider_code like 'P5T03_WORKER_%') +
        (select count(*) from private.custody_account_bindings where binding_key like 'p5t03_worker_%')
      )::text;
    `);

    assert(residue === "0", "Fixture residue zero");
    pass("Fixture cleanup");
  } finally {
    await runNpmScript("supabase:stop", "Supabase stop", 120_000);
  }
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

function createEphemeralPassword() {
  return randomBytes(32).toString("base64url");
}

function workUnit(identityPolicy, assetRef, bindings) {
  return {
    provider: PROVIDER,
    assetId: assetRef.id,
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

function controlledAdapter(results) {
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
      return results;
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

function scriptedAdapter(readBalances) {
  return {
    provider: PROVIDER,
    async readHealth() {
      return {
        provider: PROVIDER,
        status: "AVAILABLE",
        checkedAt: "2026-08-01T01:00:00.000000Z",
      };
    },
    async readBalances(bindings) {
      return readBalances(bindings);
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

function createRecordingCommandClient(delegate) {
  const calls = [];

  return {
    calls,
    client: {
      async recordBalanceObservationAndAdvanceCheckpoint(input) {
        calls.push({
          observationKey: input.observationKey,
          observedTotalUnits: input.observedTotalUnits,
          observedAt: input.observedAt,
          expectedCheckpointVersion: input.expectedCheckpointVersion,
        });

        return delegate.recordBalanceObservationAndAdvanceCheckpoint(input);
      },
      close() {
        return delegate.close();
      },
    },
  };
}

function recordingNoopCommandClient() {
  const calls = [];

  return {
    calls,
    async recordBalanceObservationAndAdvanceCheckpoint(input) {
      calls.push(input);

      return {
        observationCreated: true,
        checkpointCreated: true,
        checkpointAdvanced: false,
        checkpointVersion: "1",
      };
    },
    async close() {},
  };
}

function shortRetryPolicy() {
  return {
    mode: "BOUNDED_V1",
    maxAttempts: 3,
    baseDelayMs: 1,
    maxDelayMs: 1,
    jitterRatio: 0,
    maxRetryAfterMs: 100,
  };
}

function immediateRetryRuntime() {
  return {
    sleep() {
      return "COMPLETED";
    },
    randomInteger() {
      return 0;
    },
  };
}

function successResult(bindingRef, provider, identity = { kind: "CONTENT" }) {
  return {
    ok: true,
    binding: bindingRef,
    observation: {
      provider,
      binding: bindingRef,
      identity,
      observedAvailableUnits: "1",
      observedTotalUnits: "1",
      observedAt: "2026-08-01T08:00:00.000000Z",
      finalizedAt: null,
    },
  };
}

function errorResult(bindingRef, error) {
  return {
    ok: false,
    binding: bindingRef,
    error,
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

function errorFixture(bindingRef, code) {
  return {
    kind: "ERROR",
    binding: bindingRef.binding,
    code,
  };
}

function syntheticObservationKey(character) {
  return `balobs:v1:c:${character.repeat(64)}`;
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
  return {
    id,
    asset: assetRef,
    binding: {
      providerCode: PROVIDER.providerCode,
      bindingKey,
      assetCode: assetRef.assetCode,
      accountRole,
    },
  };
}

function assertSingleSuccess(result, expected) {
  assert(result.outcomes.length === 1, "Single outcome");
  const outcome = result.outcomes[0];

  assert(outcome?.ok === true, "Outcome success");
  assert(outcome.observationCreated === expected.observationCreated, "Observation flag");
  assert(outcome.checkpointCreated === expected.checkpointCreated, "Checkpoint create flag");
  assert(outcome.checkpointAdvanced === expected.checkpointAdvanced, "Checkpoint advance flag");
  assert(outcome.checkpointVersion === expected.checkpointVersion, "Checkpoint version");
  assert(result.summary.databaseAttempts === 1, "Single DB attempt");
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

async function assertPgRejects(callback, label) {
  await assertRejects(callback, label);
  pass(label);
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
  assert(!/p5t03-worker-(native|checkpoint)-[0-9]+/i.test(output), "Output no raw identity");
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
