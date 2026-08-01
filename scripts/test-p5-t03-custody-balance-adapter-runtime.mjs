import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const http = require("node:http");
const https = require("node:https");

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
];

const EXPECTED_NATIVE_VECTOR = {
  canonicalJson:
    '["BALANCE_OBSERVATION","v1","native","P5T03_PROVIDER","00000000-0000-4000-8000-000000530201","00000000-0000-4000-8000-000000530101","BALANCE_OBSERVER_V1","p5t03-native-snapshot-0001"]',
  digest: "09e8f2178790cbdd58b5c31aab28537173342056c1b7e5d9e1a2fa1ba6477021",
  key: "balobs:v1:n:09e8f2178790cbdd58b5c31aab28537173342056c1b7e5d9e1a2fa1ba6477021",
};
const EXPECTED_CHECKPOINT_VECTOR = {
  canonicalJson:
    '["BALANCE_OBSERVATION","v1","checkpoint","P5T03_PROVIDER","00000000-0000-4000-8000-000000530202","00000000-0000-4000-8000-000000530101","BALANCE_OBSERVER_V1","p5t03-checkpoint-0001"]',
  digest: "c4d5ba541c08dfb7984ba9edab4811cc7a680ee4957d91ceab0bf3333a5e57c5",
  key: "balobs:v1:k:c4d5ba541c08dfb7984ba9edab4811cc7a680ee4957d91ceab0bf3333a5e57c5",
};
const EXPECTED_CONTENT_VECTOR = {
  canonicalJson:
    '["BALANCE_OBSERVATION","v1","content","P5T03_PROVIDER","00000000-0000-4000-8000-000000530203","00000000-0000-4000-8000-000000530101","BALANCE_OBSERVER_V1","12345678901234567890123456789012345678","2026-08-01T01:02:03.123456Z"]',
  digest: "3f8ac3e562de4dd955289b05a76ac8a00f26e701991d39364af81cf9277b5288",
  key: "balobs:v1:c:3f8ac3e562de4dd955289b05a76ac8a00f26e701991d39364af81cf9277b5288",
};

const PROVIDER = {
  providerCode: "P5T03_PROVIDER",
  providerType: "MPC_CUSTODIAN",
  capabilities: ["BALANCE_OBSERVATION"],
};
const ASSET_ID = "00000000-0000-4000-8000-000000530101";
const NATIVE_BINDING_ID = "00000000-0000-4000-8000-000000530201";
const CHECKPOINT_BINDING_ID = "00000000-0000-4000-8000-000000530202";
const CONTENT_BINDING_ID = "00000000-0000-4000-8000-000000530203";

let runtimeCaseCount = 0;
let externalNetworkCalls = 0;
let environmentReads = 0;
let tempRuntimeDir = null;
const emittedLines = [];

async function main() {
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalEnv = process.env;

  try {
    await assertSourceBoundaries();
    const modules = await loadRuntimeModules();

    installNetworkGuard(originalFetch, originalHttpRequest, originalHttpsRequest);
    environmentReads = 0;
    process.env = new Proxy(originalEnv, {
      get(target, property, receiver) {
        environmentReads += 1;

        return Reflect.get(target, property, receiver);
      },
    });

    await assertAmountNormalization(modules.normalization);
    await assertTimestampNormalization(modules.normalization);
    await assertIdentityAndKeys(modules.normalization);
    await assertMockAdapter(modules.normalization, modules.mockAdapter);
    await assertSafetyBoundaries(modules.mockAdapter);

    assert(externalNetworkCalls === 0, "External network calls zero");
    pass("External network guard");
    assert(environmentReads === 0, "Environment reads zero");
    pass("Environment read guard");
  } finally {
    process.env = originalEnv;
    restoreNetworkGuard(originalFetch, originalHttpRequest, originalHttpsRequest);
    await cleanupRuntimeModules();
  }

  assert(!tempRuntimeDir || !existsSync(tempRuntimeDir), "Temp runtime cleanup");
  pass("Temp runtime cleanup");
  assertSafeOutput();

  console.log(`RUNTIME_CASE_COUNT=${runtimeCaseCount}`);
  console.log(`EXTERNAL_NETWORK_CALLS=${externalNetworkCalls}`);
  console.log(`CREDENTIAL_ENV_READS=${environmentReads}`);
  console.log("CUSTODY_BALANCE_ADAPTER_RUNTIME_PASS");
}

async function assertAmountNormalization(normalization) {
  const { normalizeAtomicUnits } = normalization;

  assert(normalizeAtomicUnits("0") === "0", "Zero amount");
  pass("Amount zero");
  assert(normalizeAtomicUnits("1") === "1", "Positive amount");
  pass("Amount positive");
  assert(
    normalizeAtomicUnits("99999999999999999999999999999999999999") ===
      "99999999999999999999999999999999999999",
    "Safe max amount",
  );
  pass("Amount safe max");

  assertThrows(() => normalizeAtomicUnits("01"), "Leading zero amount");
  pass("Amount leading zero reject");
  assertThrows(() => normalizeAtomicUnits("-1"), "Negative amount");
  pass("Amount negative reject");
  assertThrows(() => normalizeAtomicUnits("1.0"), "Fraction amount");
  pass("Amount fraction reject");
  assertThrows(() => normalizeAtomicUnits("1e3"), "Scientific amount");
  pass("Amount scientific notation reject");
  assertThrows(() => normalizeAtomicUnits(" 1"), "Whitespace amount");
  pass("Amount whitespace reject");
  assertThrows(
    () => normalizeAtomicUnits("100000000000000000000000000000000000000"),
    "39 digit amount",
  );
  pass("Amount 39 digit reject");
  assertThrows(() => normalizeAtomicUnits(1), "Non-string amount");
  pass("Amount non-string reject");
}

async function assertTimestampNormalization(normalization) {
  const { normalizeUtcMicrosecondTimestamp } = normalization;

  assert(
    normalizeUtcMicrosecondTimestamp("2026-08-01T01:02:03Z") ===
      "2026-08-01T01:02:03.000000Z",
    "Z timestamp",
  );
  pass("Timestamp Z normalization");
  assert(
    normalizeUtcMicrosecondTimestamp("2026-08-01T10:02:03.123+09:00") ===
      "2026-08-01T01:02:03.123000Z",
    "Offset timestamp",
  );
  pass("Timestamp offset normalization");
  assert(
    normalizeUtcMicrosecondTimestamp("2026-08-01T01:02:03.1Z") ===
      "2026-08-01T01:02:03.100000Z",
    "One fractional timestamp digit",
  );
  pass("Timestamp fractional padding");
  assert(
    normalizeUtcMicrosecondTimestamp("2026-08-01T01:02:03.123456Z") ===
      "2026-08-01T01:02:03.123456Z",
    "Microsecond preservation",
  );
  pass("Timestamp microsecond preservation");

  assertThrows(
    () => normalizeUtcMicrosecondTimestamp("2026-08-01T01:02:03.1234567Z"),
    "Too precise timestamp",
  );
  pass("Timestamp >6 fractional reject");
  assertThrows(
    () => normalizeUtcMicrosecondTimestamp("2026-08-01T01:02:03"),
    "Timezone missing timestamp",
  );
  pass("Timestamp timezone missing reject");
  assertThrows(
    () => normalizeUtcMicrosecondTimestamp("2026-02-30T01:02:03Z"),
    "Invalid date timestamp",
  );
  pass("Timestamp invalid date reject");
  assertThrows(
    () => normalizeUtcMicrosecondTimestamp("2026-08-01T01:02:60Z"),
    "Leap second timestamp",
  );
  pass("Timestamp leap second reject");
  assertThrows(
    () => normalizeUtcMicrosecondTimestamp("2026-08-01T01:02:03Z "),
    "Whitespace timestamp",
  );
  pass("Timestamp whitespace reject");
}

async function assertIdentityAndKeys(normalization) {
  const {
    CUSTODY_BALANCE_OBSERVER_KIND_V1,
    createBalanceObservationKeyDetailsV1,
    createBalanceObservationKeyV1,
    normalizeCanonicalUuid,
    normalizeObservationIdentityValue,
  } = normalization;

  assert(
    CUSTODY_BALANCE_OBSERVER_KIND_V1 === "BALANCE_OBSERVER_V1",
    "Observer kind v1",
  );
  pass("Observer kind v1");
  assert(
    normalizeCanonicalUuid(NATIVE_BINDING_ID) === NATIVE_BINDING_ID,
    "Canonical uuid",
  );
  pass("UUID canonical");
  assertThrows(
    () => normalizeCanonicalUuid("aaaaaaaa-0000-4000-8000-000000530201".toUpperCase()),
    "Uppercase uuid",
  );
  pass("UUID uppercase reject");
  assertThrows(
    () => normalizeCanonicalUuid(NATIVE_BINDING_ID.replaceAll("-", "")),
    "Compact uuid",
  );
  pass("UUID compact reject");
  assert(
    normalizeObservationIdentityValue("p5t03-cafe\u0301") === "p5t03-café",
    "Identity NFC",
  );
  pass("Identity NFC normalization");
  assertThrows(() => normalizeObservationIdentityValue(""), "Identity empty");
  pass("Identity empty reject");
  assertThrows(
    () => normalizeObservationIdentityValue("p5t03\nidentity"),
    "Identity control",
  );
  pass("Identity control reject");
  assertThrows(
    () => normalizeObservationIdentityValue("https://example.invalid/x"),
    "Identity URL",
  );
  pass("Identity URL reject");
  assertThrows(
    () => normalizeObservationIdentityValue("api-key-fixture"),
    "Identity credential marker",
  );
  pass("Identity restricted marker reject");

  const native = createBalanceObservationKeyDetailsV1(nativeKeyInput());
  assert(native.canonicalJson === EXPECTED_NATIVE_VECTOR.canonicalJson, "Native canonical JSON");
  assert(native.digest === EXPECTED_NATIVE_VECTOR.digest, "Native digest");
  assert(native.key === EXPECTED_NATIVE_VECTOR.key, "Native key");
  assert(native.mode === "n", "Native mode");
  pass("Native deterministic vector");

  const checkpoint = createBalanceObservationKeyDetailsV1(checkpointKeyInput());
  assert(
    checkpoint.canonicalJson === EXPECTED_CHECKPOINT_VECTOR.canonicalJson,
    "Checkpoint canonical JSON",
  );
  assert(checkpoint.digest === EXPECTED_CHECKPOINT_VECTOR.digest, "Checkpoint digest");
  assert(checkpoint.key === EXPECTED_CHECKPOINT_VECTOR.key, "Checkpoint key");
  assert(checkpoint.mode === "k", "Checkpoint mode");
  pass("Checkpoint deterministic vector");

  const content = createBalanceObservationKeyDetailsV1(contentKeyInput());
  assert(content.canonicalJson === EXPECTED_CONTENT_VECTOR.canonicalJson, "Content canonical JSON");
  assert(content.digest === EXPECTED_CONTENT_VECTOR.digest, "Content digest");
  assert(content.key === EXPECTED_CONTENT_VECTOR.key, "Content key");
  assert(content.mode === "c", "Content mode");
  pass("Content deterministic vector");

  assert(
    createBalanceObservationKeyV1(nativeKeyInput()) ===
      createBalanceObservationKeyV1(nativeKeyInput()),
    "Same input deterministic",
  );
  pass("Same input same key");
  assert(
    createBalanceObservationKeyV1({
      ...nativeKeyInput(),
      providerCode: "P5T03_PROVIDER_ALT",
    }) !== native.key,
    "Provider changes key",
  );
  pass("Provider changes key");
  assert(
    createBalanceObservationKeyV1({
      ...nativeKeyInput(),
      bindingId: "00000000-0000-4000-8000-000000530299",
    }) !== native.key,
    "Binding changes key",
  );
  pass("Binding changes key");
  assert(
    createBalanceObservationKeyV1({
      ...nativeKeyInput(),
      assetId: "00000000-0000-4000-8000-000000530199",
    }) !== native.key,
    "Asset changes key",
  );
  pass("Asset changes key");
  assert(
    createBalanceObservationKeyV1({
      ...nativeKeyInput(),
      observerKind: "BALANCE_OBSERVER_ALT",
    }) !== native.key,
    "Observer kind changes key",
  );
  pass("Observer kind changes key");
  assert(
    !native.key.includes("p5t03-native-snapshot-0001"),
    "Raw identity absent",
  );
  pass("Raw identity absent from key");
  assert(/^balobs:v1:[nkc]:[0-9a-f]{64}$/.test(native.key), "Key shape");
  assert(native.key.length === 76, "Key length");
  pass("Key shape and length");

  assert(
    createBalanceObservationKeyV1({
      ...nativeKeyInput(),
      observedTotalUnits: "1",
      observedAt: "2026-08-01T02:02:03Z",
    }) === native.key,
    "Native ignores payload changes",
  );
  pass("Native conflict same key");
  assert(
    createBalanceObservationKeyV1({
      ...checkpointKeyInput(),
      observedTotalUnits: "1",
      observedAt: "2026-08-01T02:02:03Z",
    }) === checkpoint.key,
    "Checkpoint ignores payload changes",
  );
  pass("Checkpoint conflict same key");
  assert(
    createBalanceObservationKeyV1(contentKeyInput()) === content.key,
    "Content same payload",
  );
  pass("Content same total and timestamp same key");
  assert(
    createBalanceObservationKeyV1({
      ...contentKeyInput(),
      observedTotalUnits: "12345678901234567890123456789012345679",
    }) !== content.key,
    "Content total changes key",
  );
  pass("Content total change different key");
  assert(
    createBalanceObservationKeyV1({
      ...contentKeyInput(),
      observedAt: "2026-08-01T10:02:04.123456+09:00",
    }) !== content.key,
    "Content timestamp changes key",
  );
  pass("Content timestamp change different key");
  assert(
    createBalanceObservationKeyV1(contentKeyInput()) === content.key,
    "Available not in content key",
  );
  pass("Available-only change same key");
}

async function assertMockAdapter(normalization, mockAdapter) {
  const { CUSTODY_BALANCE_OBSERVER_KIND_V1, createBalanceObservationKeyV1 } =
    normalization;
  const { createMockCustodyObservationAdapter } = mockAdapter;
  const bindings = createBindings();
  const adapter = createMockCustodyObservationAdapter({
    provider: PROVIDER,
    health: {
      status: "AVAILABLE",
      checkedAt: "2026-08-01T01:00:00.123456Z",
    },
    balances: [
      success(bindings.native, {
        kind: "NATIVE",
        value: "p5t03-native-snapshot-0001",
      }),
      success(bindings.checkpoint, {
        kind: "CHECKPOINT",
        value: "p5t03-checkpoint-0001",
      }),
      success(bindings.content, { kind: "CONTENT" }),
      success(bindings.zero, { kind: "CONTENT" }, "0", "0"),
      success(
        bindings.large,
        { kind: "CONTENT" },
        "99999999999999999999999999999999999999",
        "99999999999999999999999999999999999999",
      ),
      success(bindings.availableDiffers, { kind: "CONTENT" }, "2", "3"),
      errorFixture(bindings.timeout, "TIMEOUT"),
      errorFixture(bindings.rateLimited, "RATE_LIMITED", 2500),
      errorFixture(bindings.unavailable, "PROVIDER_UNAVAILABLE"),
      errorFixture(bindings.unsupportedAsset, "UNSUPPORTED_ASSET"),
    ],
  });

  const requestedBindings = [
    bindings.native,
    bindings.checkpoint,
    bindings.content,
    bindings.zero,
    bindings.large,
    bindings.availableDiffers,
    bindings.timeout,
    bindings.rateLimited,
    bindings.unavailable,
    bindings.unsupportedAsset,
  ];
  const results = await adapter.readBalances(requestedBindings);

  assert(results.length === requestedBindings.length, "One result per binding");
  pass("Mock one result per binding");
  assert(
    results.every((result, index) => result.binding === requestedBindings[index]),
    "Request order preserved",
  );
  pass("Mock request order result");
  assert(results[0]?.ok === true && results[0].observation.identity.kind === "NATIVE", "Native success");
  pass("Mock native success");
  assert(
    results[1]?.ok === true && results[1].observation.identity.kind === "CHECKPOINT",
    "Checkpoint success",
  );
  pass("Mock checkpoint success");
  assert(results[2]?.ok === true && results[2].observation.identity.kind === "CONTENT", "Content success");
  pass("Mock content success");
  assert(results[3]?.ok === true && results[3].observation.observedTotalUnits === "0", "Zero balance");
  pass("Mock zero balance");
  assert(
    results[4]?.ok === true &&
      results[4].observation.observedTotalUnits ===
        "99999999999999999999999999999999999999",
    "Large balance",
  );
  pass("Mock large balance");
  assert(
    results[5]?.ok === true &&
      results[5].observation.observedAvailableUnits === "2" &&
      results[5].observation.observedTotalUnits === "3",
    "Available differs from total",
  );
  pass("Mock available differs from total");
  assert(
    results.slice(6).every((result) => result.ok === false),
    "Partial failures",
  );
  pass("Mock partial failures");
  assert(
    results[6]?.ok === false &&
      results[6].error.code === "TIMEOUT" &&
      results[6].error.retryable,
    "Timeout error",
  );
  pass("Mock timeout error");
  assert(
    results[7]?.ok === false &&
      results[7].error.code === "RATE_LIMITED" &&
      results[7].error.retryAfterMs === 2500,
    "Rate limit error",
  );
  pass("Mock rate limit error");
  assert(
    results[8]?.ok === false && results[8].error.code === "PROVIDER_UNAVAILABLE",
    "Provider unavailable error",
  );
  pass("Mock provider unavailable error");
  assert(
    results[9]?.ok === false && results[9].error.code === "UNSUPPORTED_ASSET",
    "Unsupported asset error",
  );
  pass("Mock unsupported asset error");

  const missing = await adapter.readBalances([bindings.missing]);
  assert(missing[0]?.ok === false && missing[0].error.code === "MISSING_RESULT", "Missing result");
  pass("Mock missing result");

  const duplicateAdapter = createMockCustodyObservationAdapter({
    provider: PROVIDER,
    health: {
      status: "DEGRADED",
      checkedAt: "2026-08-01T01:00:00Z",
    },
    balances: [
      success(bindings.native, { kind: "CONTENT" }),
      success(bindings.native, { kind: "CONTENT" }),
    ],
  });
  const duplicate = await duplicateAdapter.readBalances([bindings.native]);
  assert(
    duplicate[0]?.ok === false && duplicate[0].error.code === "DUPLICATE_RESULT",
    "Duplicate result",
  );
  pass("Mock duplicate result");

  const malformedAmountAdapter = createMockCustodyObservationAdapter({
    provider: PROVIDER,
    health: {
      status: "AVAILABLE",
      checkedAt: "2026-08-01T01:00:00Z",
    },
    balances: [success(bindings.native, { kind: "CONTENT" }, "1.1", "1.1")],
  });
  const malformedAmount = await malformedAmountAdapter.readBalances([
    bindings.native,
  ]);
  assert(
    malformedAmount[0]?.ok === false &&
      malformedAmount[0].error.code === "MALFORMED_AMOUNT",
    "Malformed amount",
  );
  pass("Mock malformed amount");

  const malformedTimestampAdapter = createMockCustodyObservationAdapter({
    provider: PROVIDER,
    health: {
      status: "AVAILABLE",
      checkedAt: "2026-08-01T01:00:00Z",
    },
    balances: [
      {
        ...success(bindings.native, { kind: "CONTENT" }),
        observedAt: "2026-08-01T01:00:00.1234567Z",
      },
    ],
  });
  const malformedTimestamp = await malformedTimestampAdapter.readBalances([
    bindings.native,
  ]);
  assert(
    malformedTimestamp[0]?.ok === false &&
      malformedTimestamp[0].error.code === "MALFORMED_TIMESTAMP",
    "Malformed timestamp",
  );
  pass("Mock malformed timestamp");

  const health = await adapter.readHealth();
  const replayedHealth = await adapter.readHealth();
  assert(health.status === "AVAILABLE", "Health status");
  assert(health.checkedAt === "2026-08-01T01:00:00.123456Z", "Health checked at");
  assert(JSON.stringify(health) === JSON.stringify(replayedHealth), "Health replay");
  pass("Mock deterministic health");

  const replayedResults = await adapter.readBalances(requestedBindings);
  assert(JSON.stringify(results) === JSON.stringify(replayedResults), "Replay deterministic");
  pass("Mock deterministic replay");
  assert(
    await resolves(adapter.readBalances([bindings.timeout, bindings.native])),
    "Batch does not reject",
  );
  pass("Mock no whole batch rejection");

  const transfers = await adapter.readTransfers({
    bindings: requestedBindings,
    sinceObservedAt: null,
    cursor: null,
    limit: 10,
  });
  assert(
    transfers.observations.length === 0 &&
      transfers.page.cursor === null &&
      transfers.page.hasMore === false,
    "Transfer empty page",
  );
  pass("Mock transfer empty page");

  assert(
    createBalanceObservationKeyV1({
      providerCode: PROVIDER.providerCode,
      bindingId: NATIVE_BINDING_ID,
      assetId: ASSET_ID,
      observerKind: CUSTODY_BALANCE_OBSERVER_KIND_V1,
      identity: results[0].ok ? results[0].observation.identity : { kind: "CONTENT" },
      observedTotalUnits: results[0].ok
        ? results[0].observation.observedTotalUnits
        : undefined,
      observedAt: results[0].ok ? results[0].observation.observedAt : undefined,
    }) === EXPECTED_NATIVE_VECTOR.key,
    "Adapter identity feeds key helper",
  );
  pass("Mock adapter identity feeds key helper");
}

async function assertSafetyBoundaries(mockAdapter) {
  const { createMockCustodyObservationAdapter } = mockAdapter;
  const bindings = createBindings();
  const adapter = createMockCustodyObservationAdapter({
    provider: PROVIDER,
    health: {
      status: "UNAVAILABLE",
      checkedAt: "2026-08-01T01:00:00Z",
    },
    balances: [errorFixture(bindings.timeout, "TIMEOUT")],
  });
  const [failure] = await adapter.readBalances([bindings.timeout]);

  assert(failure?.ok === false, "Failure result");
  assert(!("stack" in failure.error), "Failure has no stack");
  assert(!("message" in failure.error), "Failure has no message");
  pass("Safety no raw Error object");

  const failureJson = JSON.stringify(failure);
  assert(!/https?:\/\//i.test(failureJson), "Failure no endpoint");
  assert(!/credential|api[_ -]*key|token|cookie|jwt/i.test(failureJson), "Failure no credential marker");
  pass("Safety failure payload safe");
}

async function assertSourceBoundaries() {
  const mockSource = await readFile(
    "src/server/custody/mock-balance-observation-adapter.ts",
    "utf8",
  );
  const helperSource = await readFile(
    "src/server/custody/balance-observation-normalization.ts",
    "utf8",
  );

  assert(!mockSource.includes("fetch("), "Mock source no fetch");
  assert(!mockSource.includes("process.env"), "Mock source no env");
  assert(!mockSource.includes("@solana"), "Mock source no provider SDK");
  assert(!helperSource.includes("process.env"), "Helper source no env");
  pass("Source production separation");
}

async function loadRuntimeModules() {
  tempRuntimeDir = await mkdtemp(
    path.join(tmpdir(), "p5-t03-balance-adapter-"),
  );

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
    normalization: runtimeRequire("./balance-observation-normalization.js"),
    mockAdapter: runtimeRequire("./mock-balance-observation-adapter.js"),
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

async function cleanupRuntimeModules() {
  if (!tempRuntimeDir) {
    return;
  }

  const dir = tempRuntimeDir;

  await rm(dir, {
    force: true,
    recursive: true,
  });
}

function nativeKeyInput() {
  return {
    providerCode: PROVIDER.providerCode,
    bindingId: NATIVE_BINDING_ID,
    assetId: ASSET_ID,
    observerKind: "BALANCE_OBSERVER_V1",
    identity: {
      kind: "NATIVE",
      value: "p5t03-native-snapshot-0001",
    },
  };
}

function checkpointKeyInput() {
  return {
    providerCode: PROVIDER.providerCode,
    bindingId: CHECKPOINT_BINDING_ID,
    assetId: ASSET_ID,
    observerKind: "BALANCE_OBSERVER_V1",
    identity: {
      kind: "CHECKPOINT",
      value: "p5t03-checkpoint-0001",
    },
  };
}

function contentKeyInput() {
  return {
    providerCode: PROVIDER.providerCode,
    bindingId: CONTENT_BINDING_ID,
    assetId: ASSET_ID,
    observerKind: "BALANCE_OBSERVER_V1",
    identity: {
      kind: "CONTENT",
    },
    observedTotalUnits: "12345678901234567890123456789012345678",
    observedAt: "2026-08-01T10:02:03.123456+09:00",
  };
}

function createBindings() {
  return {
    native: binding("p5t03_native_binding", "P5T03_ASSET_A", "COLLECTION"),
    checkpoint: binding(
      "p5t03_checkpoint_binding",
      "P5T03_ASSET_A",
      "TREASURY",
    ),
    content: binding("p5t03_content_binding", "P5T03_ASSET_A", "PAYOUT"),
    zero: binding("p5t03_zero_binding", "P5T03_ASSET_A", "FEE"),
    large: binding("p5t03_large_binding", "P5T03_ASSET_A", "COLLECTION"),
    availableDiffers: binding(
      "p5t03_available_differs_binding",
      "P5T03_ASSET_A",
      "TREASURY",
    ),
    timeout: binding("p5t03_timeout_binding", "P5T03_ASSET_A", "COLLECTION"),
    rateLimited: binding(
      "p5t03_rate_limited_binding",
      "P5T03_ASSET_A",
      "COLLECTION",
    ),
    unavailable: binding(
      "p5t03_unavailable_binding",
      "P5T03_ASSET_A",
      "COLLECTION",
    ),
    unsupportedAsset: binding(
      "p5t03_unsupported_asset_binding",
      "P5T03_ASSET_B",
      "COLLECTION",
    ),
    missing: binding("p5t03_missing_binding", "P5T03_ASSET_A", "COLLECTION"),
  };
}

function binding(bindingKey, assetCode, accountRole) {
  return {
    providerCode: PROVIDER.providerCode,
    bindingKey,
    assetCode,
    accountRole,
  };
}

function success(
  fixtureBinding,
  identity,
  observedAvailableUnits = "12345678901234567890123456789012345678",
  observedTotalUnits = "12345678901234567890123456789012345678",
) {
  return {
    kind: "SUCCESS",
    binding: fixtureBinding,
    identity,
    observedAvailableUnits,
    observedTotalUnits,
    observedAt: "2026-08-01T10:02:03.123456+09:00",
    finalizedAt: null,
  };
}

function errorFixture(fixtureBinding, code, retryAfterMs = null) {
  return {
    kind: "ERROR",
    binding: fixtureBinding,
    code,
    retryAfterMs,
  };
}

async function resolves(promise) {
  try {
    await promise;

    return true;
  } catch {
    return false;
  }
}

function installNetworkGuard(
  originalFetch,
  originalHttpRequest,
  originalHttpsRequest,
) {
  globalThis.fetch = async () => {
    externalNetworkCalls += 1;
    throw new Error("FAIL external fetch blocked");
  };
  http.request = (...args) => {
    externalNetworkCalls += 1;

    return originalHttpRequest(...args);
  };
  https.request = (...args) => {
    externalNetworkCalls += 1;

    return originalHttpsRequest(...args);
  };
}

function restoreNetworkGuard(
  originalFetch,
  originalHttpRequest,
  originalHttpsRequest,
) {
  globalThis.fetch = originalFetch;
  http.request = originalHttpRequest;
  https.request = originalHttpsRequest;
}

function assertThrows(callback, label) {
  try {
    callback();
  } catch {
    return;
  }

  throw new Error(`FAIL ${label}`);
}

function assertSafeOutput() {
  const output = emittedLines.join("\n");

  assert(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(output), "Output no JWT");
  assert(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(output), "Output no email");
  assert(
    !/(access_token|refresh_token|service_role|database_url|private_key|mnemonic|seed_phrase|cookie|credential)/i.test(
      output,
    ),
    "Output no credential marker",
  );
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
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED]");
}
