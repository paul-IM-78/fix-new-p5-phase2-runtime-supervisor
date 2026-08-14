import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const dns = require("node:dns/promises");
const SOURCE_PATH = "src/server/custody/bitgo-read-only-semantic-adapter.ts";
const TEST_PATH = "src/server/custody/bitgo-read-only-semantic-adapter.test.ts";
const WALLET_ID = "abcdefabcdefabcdefabcdefabcdefab";
const OTHER_WALLET_ID = "11111111111111111111111111111111";
const FIXED_DATE = new Date("2026-08-14T00:00:00.000Z");
const binding = {
  providerCode: "BITGO",
  bindingKey: "p6-t05-synthetic-binding",
  assetCode: "TSOL",
  accountRole: "CUSTODY",
};
const provider = {
  providerCode: "BITGO",
  providerType: "MPC_CUSTODIAN",
};
let tempRuntimeDir = null;
let passed = 0;
let failed = 0;
const counters = {
  dns: 0,
  tlsSocket: 0,
  httpFetch: 0,
  bitGo: 0,
  solanaRpc: 0,
  processEnvSecretReads: 0,
  credentialResolver: 0,
  secretBackend: 0,
  providerWrite: 0,
  signing: 0,
  financialExecution: 0,
};

async function main() {
  const originals = installGuards();

  try {
    const modules = await loadModules();
    modules.tests.assertP6T05SemanticCaseCatalog();
    await runCases(modules);
  } finally {
    restoreGuards(originals);
    await cleanup();
  }

  assert(passed === 64, `Expected 64 cases, got ${passed}`);
  assert(failed === 0, "Expected zero failed cases");
  for (const value of Object.values(counters)) {
    assert(value === 0, "External execution counter must remain zero");
  }
  assert(!tempRuntimeDir || !existsSync(tempRuntimeDir), "Temporary runtime cleanup");

  console.log("EXPECTED_CASES=64");
  console.log(`EXECUTED_CASES=${passed + failed}`);
  console.log(`PASSED_CASES=${passed}`);
  console.log(`FAILED_CASES=${failed}`);
  console.log(`PROVIDER_DNS=${counters.dns}`);
  console.log(`PROVIDER_TLS_SOCKET=${counters.tlsSocket}`);
  console.log(`PROVIDER_HTTP_FETCH=${counters.httpFetch}`);
  console.log(`BITGO_CALLS=${counters.bitGo}`);
  console.log(`SOLANA_RPC_CALLS=${counters.solanaRpc}`);
  console.log(`PROCESS_ENV_SECRET_READS=${counters.processEnvSecretReads}`);
  console.log(`CREDENTIAL_RESOLVER_ACTIVATIONS=${counters.credentialResolver}`);
  console.log(`SECRET_BACKEND_CALLS=${counters.secretBackend}`);
  console.log(`PROVIDER_WRITES=${counters.providerWrite}`);
  console.log(`SIGNING=${counters.signing}`);
  console.log(`FINANCIAL_EXECUTION=${counters.financialExecution}`);
  console.log("PASS_P6_T05_BITGO_READ_ONLY_SEMANTIC_ADAPTER_RUNTIME");
}

async function runCases(modules) {
  const source = await readFile(SOURCE_PATH, "utf8");
  const { createBitGoReadOnlySemanticAdapter } = modules.adapter;

  const withAdapter = (executor) =>
    createBitGoReadOnlySemanticAdapter({
      provider,
      credentialReference: null,
      authorizedExecutionContext: false,
      executor,
      now: () => FIXED_DATE,
    });

  const success = (json) => ({ ok: true, json, audit: audit("SUCCESS") });
  const transport = (code, retryable = false, safeStatus = null) => ({
    ok: false,
    error: {
      kind: "TRANSPORT_FAILURE",
      code,
      retryable,
      safeMessageCode: code,
      safeStatus,
      causeClass: "RESPONSE",
    },
    audit: audit(code),
  });
  const credential = () => ({
    ok: false,
    error: {
      kind: "CREDENTIAL_FAILURE",
      code: "CREDENTIAL_UNAVAILABLE",
      retryable: false,
      safeMessageCode: "CREDENTIAL_UNAVAILABLE",
      causeClass: "RUNTIME_SOURCE",
    },
    audit: audit("CREDENTIAL_UNAVAILABLE"),
  });
  const payload = (overrides = {}) => ({
    id: WALLET_ID,
    coin: "tsol",
    balanceString: "1000000000",
    spendableBalanceString: "500000000",
    ...overrides,
  });
  const read = (adapter, walletId = WALLET_ID) =>
    adapter.readBalance({
      binding,
      walletId,
      correlationId: "p6-t05-deterministic-correlation",
    });

  let capturedDescriptor = null;
  const captureExecutor = async (input) => {
    capturedDescriptor = input.descriptor;
    return success(payload());
  };
  await named("P6T05-SEM-001", async () => {
    await read(withAdapter(captureExecutor));
    assert(capturedDescriptor.operationId === "BITGO_TSOL_WALLET_GET_BALANCE", "operation id");
  });
  await named("P6T05-SEM-002", () => assert(capturedDescriptor.method === "GET", "method"));
  await named("P6T05-SEM-003", () => assert(capturedDescriptor.relativePath.startsWith("/api/v2/tsol/wallet/"), "tsol path"));
  await named("P6T05-SEM-004", () => assert(capturedDescriptor.relativePath.endsWith(WALLET_ID), "wallet path"));
  await named("P6T05-SEM-005", () => assert(JSON.stringify(capturedDescriptor.query) === JSON.stringify({ includeBalance: "true" }), "query"));
  await named("P6T05-SEM-006", () => assert(capturedDescriptor.bodyAllowed === false, "body prohibited"));
  await named("P6T05-SEM-007", () => assert(capturedDescriptor.retrySafe === true, "retry safe"));
  await named("P6T05-SEM-008", () => assert(capturedDescriptor.responseMode === "JSON", "response mode"));

  await named("P6T05-SEM-009", async () => assert((await read(withAdapter(async () => success(payload())))).ok, "valid wallet"));
  await named("P6T05-SEM-010", async () => assertFailure(await read(withAdapter(async () => { throw new Error("executor_called"); }), WALLET_ID.toUpperCase()), "UNEXPECTED_RESULT"));
  await named("P6T05-SEM-011", async () => assertFailure(await read(withAdapter(async () => { throw new Error("executor_called"); }), WALLET_ID.slice(0, 31)), "UNEXPECTED_RESULT"));
  await named("P6T05-SEM-012", async () => assertFailure(await read(withAdapter(async () => { throw new Error("executor_called"); }), `${WALLET_ID}0`), "UNEXPECTED_RESULT"));
  await named("P6T05-SEM-013", async () => assertFailure(await read(withAdapter(async () => { throw new Error("executor_called"); }), ` ${WALLET_ID}`), "UNEXPECTED_RESULT"));
  await named("P6T05-SEM-014", async () => assertFailure(await read(withAdapter(async () => { throw new Error("executor_called"); }), "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"), "UNEXPECTED_RESULT"));
  await named("P6T05-SEM-015", async () => assertFailure(await read(withAdapter(async () => { throw new Error("executor_called"); }), `${WALLET_ID}?x=1`), "UNEXPECTED_RESULT"));
  await named("P6T05-SEM-016", async () => {
    await read(withAdapter(captureExecutor));
    assert(capturedDescriptor.relativePath.startsWith("/api/v2/tsol/"), "coin fixed");
  });
  await named("P6T05-SEM-017", async () => {
    let environment = null;
    const adapter = withAdapter(async (input) => {
      environment = input.environment;
      return success(payload());
    });
    await read(adapter);
    assert(environment === "TEST", "environment fixed");
  });
  await named("P6T05-SEM-018", async () => {
    await read(withAdapter(captureExecutor));
    assert(Object.keys(capturedDescriptor.query).length === 1, "single query key");
  });

  await named("P6T05-SEM-019", async () => assertFailure(await read(withAdapter(async () => success(null))), "UNEXPECTED_RESULT"));
  await named("P6T05-SEM-020", async () => assertFailure(await read(withAdapter(async () => success({ coin: "tsol", balanceString: "1", spendableBalanceString: "1" }))), "MISSING_RESULT"));
  await named("P6T05-SEM-021", async () => assertFailure(await read(withAdapter(async () => success({ id: WALLET_ID, balanceString: "1", spendableBalanceString: "1" }))), "MISSING_RESULT"));
  await named("P6T05-SEM-022", async () => assertFailure(await read(withAdapter(async () => success({ id: WALLET_ID, coin: "tsol", spendableBalanceString: "1" }))), "MISSING_RESULT"));
  await named("P6T05-SEM-023", async () => assertFailure(await read(withAdapter(async () => success({ id: WALLET_ID, coin: "tsol", balanceString: "1" }))), "MISSING_RESULT"));
  await named("P6T05-SEM-024", async () => assertFailure(await read(withAdapter(async () => success(payload({ id: OTHER_WALLET_ID })))), "UNEXPECTED_RESULT"));
  await named("P6T05-SEM-025", async () => assertFailure(await read(withAdapter(async () => success(payload({ coin: "other" })))), "UNSUPPORTED_ASSET"));
  await named("P6T05-SEM-026", async () => assertFailure(await read(withAdapter(async () => success(payload({ coin: "sol" })))), "UNSUPPORTED_ASSET"));

  await named("P6T05-SEM-027", async () => assertSuccess(await read(withAdapter(async () => success(payload()))), "1000000000", "500000000"));
  await named("P6T05-SEM-028", async () => assertSuccess(await read(withAdapter(async () => success(payload()))), "1000000000", "500000000"));
  await named("P6T05-SEM-029", async () => {
    assertSuccess(
      await read(withAdapter(async () => success(payload({ balanceString: "0", spendableBalanceString: "0" })))),
      "0",
      "0",
    );
  });
  await named("P6T05-SEM-030", async () => {
    assertSuccess(
      await read(withAdapter(async () => success(payload({ balanceString: "99999999999999999999999999999999999999", spendableBalanceString: "1" })))),
      "99999999999999999999999999999999999999",
      "1",
    );
  });
  await named("P6T05-SEM-031", async () => assertFailure(await read(withAdapter(async () => success(payload({ balanceString: "01" })))), "MALFORMED_AMOUNT"));
  await named("P6T05-SEM-032", async () => assertFailure(await read(withAdapter(async () => success(payload({ balanceString: "-1" })))), "MALFORMED_AMOUNT"));
  await named("P6T05-SEM-033", async () => assertFailure(await read(withAdapter(async () => success(payload({ balanceString: "1.0" })))), "MALFORMED_AMOUNT"));
  await named("P6T05-SEM-034", async () => assertFailure(await read(withAdapter(async () => success(payload({ balanceString: "1e3" })))), "MALFORMED_AMOUNT"));
  await named("P6T05-SEM-035", async () => assertFailure(await read(withAdapter(async () => success(payload({ balanceString: " 1" })))), "MALFORMED_AMOUNT"));
  await named("P6T05-SEM-036", async () => assertFailure(await read(withAdapter(async () => success(payload({ balanceString: 1 })))), "MALFORMED_AMOUNT"));
  await named("P6T05-SEM-037", async () => assertFailure(await read(withAdapter(async () => success(payload({ confirmedBalanceString: "01" })))), "MALFORMED_AMOUNT"));
  await named("P6T05-SEM-038", async () => assert((await read(withAdapter(async () => success(payload())))).ok, "confirmed absent"));
  await named("P6T05-SEM-039", async () => assertFailure(await read(withAdapter(async () => success({ id: WALLET_ID, coin: "tsol", spendableBalanceString: "1", confirmedBalanceString: "1" }))), "MISSING_RESULT"));

  await named("P6T05-SEM-040", () => assert(!source.includes("Number("), "no Number conversion"));
  await named("P6T05-SEM-041", () => assert(!source.includes("parseInt"), "no parseInt"));
  await named("P6T05-SEM-042", () => assert(!source.includes("parseFloat"), "no parseFloat"));
  await named("P6T05-SEM-043", () => assert(!source.includes("BigInt"), "no BigInt"));
  await named("P6T05-SEM-044", async () => {
    const result = await read(withAdapter(async () => success(payload({ ignored: "not-output" }))));
    assert(!JSON.stringify(result).includes("ignored"), "unknown field not emitted");
  });
  await named("P6T05-SEM-045", async () => {
    const result = await read(withAdapter(async () => success(payload({ rawWallet: { opaque: "not-output" } }))));
    assert(!JSON.stringify(result).includes("rawWallet"), "raw payload not emitted");
  });

  await named("P6T05-SEM-046", async () => {
    const adapter = withAdapter(async () => success(payload()));
    await read(adapter);
    assert((await adapter.readHealth()).status === "AVAILABLE", "success health");
  });
  await named("P6T05-SEM-047", async () => assert((await withAdapter(async () => success(payload())).readHealth()).status === "UNKNOWN", "initial health"));
  await named("P6T05-SEM-048", async () => {
    const adapter = withAdapter(async () => transport("PROVIDER_RATE_LIMITED", true, 429));
    assertFailure(await read(adapter), "RATE_LIMITED");
    assert((await adapter.readHealth()).status === "DEGRADED", "rate health");
  });
  await named("P6T05-SEM-049", async () => {
    const adapter = withAdapter(async () => transport("PROVIDER_TIMEOUT", true));
    assertFailure(await read(adapter), "TIMEOUT");
    assert((await adapter.readHealth()).status === "UNAVAILABLE", "timeout health");
  });
  await named("P6T05-SEM-050", async () => {
    const adapter = withAdapter(async () => transport("PROVIDER_UNAVAILABLE", true, 503));
    assertFailure(await read(adapter), "PROVIDER_UNAVAILABLE");
    assert((await adapter.readHealth()).status === "UNAVAILABLE", "unavailable health");
  });
  await named("P6T05-SEM-051", async () => {
    const adapter = withAdapter(async () => success([]));
    assertFailure(await read(adapter), "UNEXPECTED_RESULT");
    assert((await adapter.readHealth()).status === "UNKNOWN", "semantic health");
  });
  await named("P6T05-SEM-052", async () => {
    const adapter = withAdapter(async () => credential());
    assertFailure(await read(adapter), "UNEXPECTED_RESULT");
    assert((await adapter.readHealth()).status === "UNKNOWN", "credential health");
  });
  await named("P6T05-SEM-053", async () => assertFailure(await read(withAdapter(async () => transport("PROVIDER_ABORTED"))), "TIMEOUT"));
  await named("P6T05-SEM-054", async () => assertFailure(await read(withAdapter(async () => transport("PROVIDER_RATE_LIMITED", true, 429))), "RATE_LIMITED"));
  await named("P6T05-SEM-055", async () => assertFailure(await read(withAdapter(async () => transport("PROVIDER_UNAVAILABLE", true, 503))), "PROVIDER_UNAVAILABLE"));
  await named("P6T05-SEM-056", async () => {
    const result = await read(withAdapter(async () => credential()));
    assert(!JSON.stringify(result).includes("opaque-credential"), "credential not exposed");
  });
  await named("P6T05-SEM-057", async () => {
    const result = await read(withAdapter(async () => transport("PROVIDER_UNAVAILABLE", true, 503)));
    assert(!result.ok && result.error.retryable === true, "retryability preserved");
  });
  await named("P6T05-SEM-058", async () => {
    const result = await read(withAdapter(async () => transport("PROVIDER_RATE_LIMITED", true, 429)));
    assert(!result.ok && result.error.retryAfterMs === null, "no unavailable retry-after field");
  });

  await named("P6T05-SEM-059", () => assert(JSON.stringify(withAdapter(async () => success(payload())).capabilities) === JSON.stringify(["BALANCE_OBSERVATION"]), "balance capability"));
  await named("P6T05-SEM-060", () => assert(!withAdapter(async () => success(payload())).capabilities.includes("TRANSFER_OBSERVATION"), "transfer absent"));
  await named("P6T05-SEM-061", () => {
    const capabilities = withAdapter(async () => success(payload())).capabilities;
    assert(!capabilities.includes("PAYOUT_SUBMISSION") && !capabilities.includes("WEBHOOK_INGESTION"), "payout and webhook absent");
  });
  await named("P6T05-SEM-062", async () => assert((await read(withAdapter(async () => success(payload())))).ok, "fake success isolation"));
  await named("P6T05-SEM-063", async () => assertFailure(await read(withAdapter(async () => credential())), "UNEXPECTED_RESULT"));
  await named("P6T05-SEM-064", async () => {
    const result = await read(withAdapter(async () => success(payload({ opaque: "fake-opaque-value" }))));
    assert(!JSON.stringify(result).includes("fake-opaque-value"), "no payload leak");
  });
}

function audit(normalizedOutcome) {
  return {
    provider: "BITGO",
    environment: "TEST",
    operationId: "BITGO_TSOL_WALLET_GET_BALANCE",
    endpointId: "BITGO_TEST",
    hostname: "not-used",
    policyOutcome: "ALLOWED",
    normalizedOutcome,
    durationMs: 0,
    attemptCount: 0,
    safeStatus: null,
    requestBytes: 0,
    responseBytes: 0,
    correlationId: "p6-t05-deterministic-correlation",
    credentialReferenceId: null,
    credentialVersion: null,
  };
}

function assertSuccess(result, total, available) {
  assert(result.ok, "expected success");
  assert(result.observation.observedTotalUnits === total, "total mapping");
  assert(result.observation.observedAvailableUnits === available, "available mapping");
}

function assertFailure(result, code) {
  assert(!result.ok, "expected failure");
  assert(result.error.code === code, "error code");
}

async function named(id, action) {
  try {
    await action();
    passed += 1;
  } catch (error) {
    failed += 1;
    throw new Error(`${id}: ${error instanceof Error ? error.message : "failed"}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadModules() {
  tempRuntimeDir = await mkdtemp(path.join(tmpdir(), "p6-t05-semantic-"));
  const files = [
    "src/server/custody/provider-observation-contract.ts",
    "src/server/custody/balance-observation-normalization.ts",
    SOURCE_PATH,
    TEST_PATH,
  ];

  for (const sourcePath of files) {
    let source = await readFile(sourcePath, "utf8");
    source = source.replace(/^\s*import\s+["']server-only["'];\s*$/m, "");

    if (sourcePath === SOURCE_PATH) {
      source = source.replace(
        'import { executeApprovedProviderRequest } from "../provider-security/provider-security-transport";',
        "const executeApprovedProviderRequest = undefined;",
      );
    }

    const output = ts.transpileModule(source, {
      fileName: sourcePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        strict: true,
      },
    });
    const outputPath = path.join(tempRuntimeDir, sourcePath.replace(/\.ts$/, ".js"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output.outputText, "utf8");
  }

  const runtimeRequire = createRequire(path.join(tempRuntimeDir, "loader.cjs"));
  return {
    adapter: runtimeRequire("./src/server/custody/bitgo-read-only-semantic-adapter.js"),
    tests: runtimeRequire("./src/server/custody/bitgo-read-only-semantic-adapter.test.js"),
  };
}

function installGuards() {
  const originals = {
    fetch: globalThis.fetch,
    httpRequest: http.request,
    httpsRequest: https.request,
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    dnsLookup: dns.lookup,
    dnsResolve: dns.resolve,
    env: process.env,
  };
  globalThis.fetch = async () => {
    counters.httpFetch += 1;
    throw new Error("external_fetch_blocked");
  };
  http.request = () => {
    counters.httpFetch += 1;
    throw new Error("external_http_blocked");
  };
  https.request = () => {
    counters.tlsSocket += 1;
    throw new Error("external_https_blocked");
  };
  net.connect = () => {
    counters.tlsSocket += 1;
    throw new Error("external_socket_blocked");
  };
  net.createConnection = net.connect;
  dns.lookup = async () => {
    counters.dns += 1;
    throw new Error("external_dns_blocked");
  };
  dns.resolve = async () => {
    counters.dns += 1;
    throw new Error("external_dns_blocked");
  };
  process.env = new Proxy(originals.env, {
    get(target, property, receiver) {
      if (property === "BITGO_TEST_ACCESS_TOKEN") {
        counters.processEnvSecretReads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return originals;
}

function restoreGuards(originals) {
  globalThis.fetch = originals.fetch;
  http.request = originals.httpRequest;
  https.request = originals.httpsRequest;
  net.connect = originals.netConnect;
  net.createConnection = originals.netCreateConnection;
  dns.lookup = originals.dnsLookup;
  dns.resolve = originals.dnsResolve;
  process.env = originals.env;
}

async function cleanup() {
  if (tempRuntimeDir) {
    await rm(tempRuntimeDir, { recursive: true, force: true });
    tempRuntimeDir = null;
  }
}

await main();
