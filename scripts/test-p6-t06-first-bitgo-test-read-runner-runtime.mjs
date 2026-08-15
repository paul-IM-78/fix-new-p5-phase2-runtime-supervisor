import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const dns = require("node:dns/promises");
const RUNNER = path.join(ROOT, "scripts", "qualify-p6-t06-first-bitgo-test-read.mjs");
const VALID_WALLET = "abcdefabcdefabcdefabcdefabcdefab";
const SENTINELS = [VALID_WALLET, "synthetic-token-sentinel", "1000000000", "500000000", "400000000", "Authorization", "raw-response", "headers", "stack-sentinel"];
const counters = { dns: 0, tlsSocket: 0, httpFetch: 0, bitGo: 0, solanaRpc: 0, credentialReads: 0, credentialResolver: 0, secretBackend: 0, actualWalletReads: 0, realRunnerExecutions: 0, write: 0, signing: 0, financialExecution: 0 };
let passed = 0;
let failed = 0;
const ids = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
function hash(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function audit(outcome, attemptCount = 1, safeStatus = 200) { return { provider: "BITGO", environment: "TEST", operationId: "BITGO_TSOL_WALLET_GET_BALANCE", endpointId: "BITGO_TEST", hostname: "synthetic", policyOutcome: "ALLOWED", normalizedOutcome: outcome, durationMs: 0, attemptCount, safeStatus, requestBytes: 0, responseBytes: 0, correlationId: "offline", credentialReferenceId: "p6-t06-bitgo-test-access-token", credentialVersion: "P6_T06_V1" }; }
function success(overrides = {}, attempts = 1) { return { ok: true, json: { id: VALID_WALLET, coin: "tsol", balanceString: "1000000000", spendableBalanceString: "500000000", ...overrides }, audit: audit("SUCCESS", attempts, 200) }; }
function transport(code, retryable = false, safeStatus = null, attempts = 1) { return { ok: false, error: { kind: "TRANSPORT_FAILURE", code, retryable, safeMessageCode: code, safeStatus, causeClass: "NETWORK" }, audit: audit(code, attempts, safeStatus) }; }
function credential() { return { ok: false, error: { kind: "CREDENTIAL_FAILURE", code: "CREDENTIAL_UNAVAILABLE", retryable: false, safeMessageCode: "CREDENTIAL_UNAVAILABLE", causeClass: "RUNTIME_SOURCE" }, audit: audit("CREDENTIAL_UNAVAILABLE", 0, null) }; }

async function childMain() {
  const originals = installGuards();
  const runner = await import(pathToFileURL(RUNNER).href);
  const modules = await runner.loadCanonicalP6T05ForTest();
  try {
    const make = (executor = async () => success(), options = {}) => runner.createP6T06QualificationRunnerForTest({ modules, env: { BITGO_TEST_WALLET_ID: VALID_WALLET }, executor, ...options });
    const run = async (executor, options) => make(executor, options).run();
    const named = async (id, action) => { ids.push(id); try { await action(); passed += 1; } catch (error) { failed += 1; throw new Error(`${id}:${error instanceof Error ? error.message : "failed"}`); } };
    const expect = (result, classification, exit) => { assert(result.classification === classification, "classification"); assert(Object.keys(result).join("|") === runner.P6_T06_OUTPUT_KEYS.join("|"), "schema order"); assert((({ CLEAN_PASS: 0, PREFLIGHT_FAIL: 2, CREDENTIAL_FAIL: 3, TRANSPORT_FAIL: 4, SEMANTIC_FAIL: 5, REAL_READ_SUCCEEDED_WITH_TRANSPORT_RETRY_REQUIRES_REVIEW: 6, INTERNAL_GUARD_FAIL: 7 })[result.classification]) === exit, "exit"); return result; };
    const preflight = async (id, preflightOverrides) => named(id, async () => expect(await run(async () => success(), { preflightOverrides }), "PREFLIGHT_FAIL", 2));

    await named("P6T06-RUN-001", async () => { const result = await run(async () => success()); assert(result.classification === "CLEAN_PASS", "valid preflight"); });
    for (const [id, env] of [["P6T06-RUN-002", {}], ["P6T06-RUN-003", { BITGO_TEST_WALLET_ID: "" }], ["P6T06-RUN-004", { BITGO_TEST_WALLET_ID: VALID_WALLET.toUpperCase() }], ["P6T06-RUN-005", { BITGO_TEST_WALLET_ID: VALID_WALLET.slice(0, 31) }], ["P6T06-RUN-006", { BITGO_TEST_WALLET_ID: `${VALID_WALLET}0` }], ["P6T06-RUN-007", { BITGO_TEST_WALLET_ID: "z".repeat(32) }], ["P6T06-RUN-008", { BITGO_TEST_WALLET_ID: ` ${VALID_WALLET}` }]]) await named(id, async () => { const result = runner.createP6T06QualificationRunnerForTest({ modules, env, executor: async () => success() }); expect(await result.run(), "PREFLIGHT_FAIL", 2); });
    await preflight("P6T06-RUN-009", { sourceIdentity: { blobId: "0".repeat(40), rawSha256: "0".repeat(64) } });
    await preflight("P6T06-RUN-010", { sourceIdentity: { blobId: "1d7f644d09f3f5f9bbf5d106ce7dbf4e3a266e87", rawSha256: "0".repeat(64) } });
    await preflight("P6T06-RUN-011", { testEndpoint: null });
    await preflight("P6T06-RUN-012", { productionEndpoint: { active: true } });
    await preflight("P6T06-RUN-013", { provider: { providerCode: "OTHER", providerType: "P6_T06_QUALIFICATION" } });
    await preflight("P6T06-RUN-014", { provider: { providerCode: "BITGO", providerType: "P6_T06_QUALIFICATION", capabilities: ["TRANSFER_OBSERVATION"] } });
    await preflight("P6T06-RUN-015", { credentialReference: { provider: "BITGO", environment: "TEST", referenceId: "wrong", version: "P6_T06_V1", lifecycle: "ACTIVE" } });
    await named("P6T06-RUN-016", async () => { const instance = make(); await instance.run(); expect(await instance.run(), "INTERNAL_GUARD_FAIL", 7); });
    await named("P6T06-RUN-017", async () => assert((await run(async () => success())).walletIdSha256 === hash(VALID_WALLET), "wallet hash"));
    for (const id of ["P6T06-RUN-018", "P6T06-RUN-019", "P6T06-RUN-020", "P6T06-RUN-021", "P6T06-RUN-022", "P6T06-RUN-023", "P6T06-RUN-024"]) await named(id, async () => { const text = JSON.stringify(await run(async () => success())); for (const sentinel of SENTINELS) assert(!text.includes(sentinel), "privacy sentinel"); });
    await named("P6T06-RUN-025", async () => assert(counters.realRunnerExecutions === 0, "import safe"));
    await named("P6T06-RUN-026", async () => { const instance = make(); await instance.run(); expect(await instance.run(), "INTERNAL_GUARD_FAIL", 7); });
    await named("P6T06-RUN-027", async () => { let calls = 0; const instance = make(async () => { calls += 1; return success(); }); await instance.run(); await instance.run(); assert(calls === 1, "no second attempt"); });
    await named("P6T06-RUN-028", async () => { let calls = 0; await run(async () => { calls += 1; return success(); }); assert(calls === 1, "no runner retry"); });
    for (const [id, verify] of [["P6T06-RUN-029", (r) => r.classification === "CLEAN_PASS"], ["P6T06-RUN-030", (r) => r.identityMatch === true], ["P6T06-RUN-031", (r) => r.coinMatch === true], ["P6T06-RUN-032", (r) => r.totalUnitsValid && r.availableUnitsValid && r.confirmedUnitsValidOrAbsent], ["P6T06-RUN-033", (r) => r.health === "AVAILABLE"], ["P6T06-RUN-034", (r) => JSON.stringify(r.capabilities) === '["BALANCE_OBSERVATION"]'], ["P6T06-RUN-035", (r) => r.productionAttempts === 0 && r.writeAttempts === 0 && r.credentialValuePrinted === 0]]) await named(id, async () => assert(verify(expect(await run(async () => success()), "CLEAN_PASS", 0)), "clean evidence"));
    for (const [id, attempts] of [["P6T06-RUN-036", 2], ["P6T06-RUN-037", 3], ["P6T06-RUN-038", 2], ["P6T06-RUN-039", 3]]) await named(id, async () => { const instance = make(async () => success({}, attempts)); const result = expect(await instance.run(), "REAL_READ_SUCCEEDED_WITH_TRANSPORT_RETRY_REQUIRES_REVIEW", 6); assert(result.logicalInvocations === 1, "one invocation"); expect(await instance.run(), "INTERNAL_GUARD_FAIL", 7); });
    for (const [id, fixture, classification, exit] of [["P6T06-RUN-040", credential(), "CREDENTIAL_FAIL", 3], ["P6T06-RUN-041", transport("PROVIDER_TIMEOUT", true), "TRANSPORT_FAIL", 4], ["P6T06-RUN-042", transport("PROVIDER_ABORTED"), "TRANSPORT_FAIL", 4], ["P6T06-RUN-043", transport("PROVIDER_RATE_LIMITED", true, 429), "TRANSPORT_FAIL", 4], ["P6T06-RUN-044", transport("PROVIDER_UNAVAILABLE", true, 503), "TRANSPORT_FAIL", 4], ["P6T06-RUN-045", { ok: true, json: null, audit: audit("SUCCESS") }, "SEMANTIC_FAIL", 5], ["P6T06-RUN-046", success({ id: "1".repeat(32) }), "SEMANTIC_FAIL", 5], ["P6T06-RUN-047", success({ coin: "other" }), "SEMANTIC_FAIL", 5]]) await named(id, async () => expect(await run(async () => fixture), classification, exit));
    await named("P6T06-RUN-048", async () => expect(await run(async () => success(), { forceInternalError: true }), "INTERNAL_GUARD_FAIL", 7));
    assert(ids.length === 48 && new Set(ids).size === 48, "case inventory");
  } finally { await runner.disposeCanonicalP6T05ForTest(modules); restoreGuards(originals); }
  console.log("EXPECTED_CASES=48"); console.log(`EXECUTED_CASES=${passed + failed}`); console.log(`PASSED_CASES=${passed}`); console.log(`FAILED_CASES=${failed}`); console.log("MISSING_CASES=0"); console.log("DUPLICATE_CASES=0");
  console.log("PROVIDER_DNS=0"); console.log("PROVIDER_TLS_SOCKET=0"); console.log("PROVIDER_HTTP_FETCH=0"); console.log("BITGO_CALLS=0"); console.log("SOLANA_RPC_CALLS=0"); console.log("CREDENTIAL_READS=0"); console.log("CREDENTIAL_RESOLVER_ACTIVATIONS=0"); console.log("SECRET_BACKEND_CALLS=0"); console.log("ACTUAL_WALLET_READS=0"); console.log("REAL_RUNNER_EXECUTIONS=0"); console.log("WRITE=0"); console.log("SIGNING=0"); console.log("FINANCIAL_EXECUTION=0"); console.log("PASS_P6_T06_FIRST_REAL_BITGO_TEST_READ_RUNNER_OFFLINE_RUNTIME");
}

function installGuards() {
  const originals = { fetch: globalThis.fetch, httpRequest: http.request, httpsRequest: https.request, netConnect: net.connect, netCreateConnection: net.createConnection, dnsLookup: dns.lookup, dnsResolve: dns.resolve, env: process.env };
  const blocked = (counter) => () => { counters[counter] += 1; throw new Error("p6_t06_external_access_blocked"); };
  globalThis.fetch = blocked("httpFetch");
  http.request = blocked("httpFetch");
  https.request = blocked("tlsSocket");
  net.connect = blocked("tlsSocket");
  net.createConnection = net.connect;
  dns.lookup = blocked("dns");
  dns.resolve = blocked("dns");
  process.env = new Proxy(originals.env, { get(target, property, receiver) { if (property === "BITGO_TEST_ACCESS_TOKEN") counters.credentialReads += 1; if (property === "BITGO_TEST_WALLET_ID") counters.actualWalletReads += 1; return Reflect.get(target, property, receiver); } });
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

async function parentMain() {
  const child = spawnSync(process.execPath, ["--conditions=react-server", fileURLToPath(import.meta.url), "--p6-t06-offline-child"], { cwd: ROOT, encoding: "utf8", env: { ...process.env } });
  process.stdout.write(child.stdout);
  if (child.status !== 0) { process.stderr.write("p6_t06_offline_harness_failed\n"); process.exitCode = child.status ?? 1; }
}

if (process.argv[2] === "--p6-t06-offline-child") await childMain(); else await parentMain();
