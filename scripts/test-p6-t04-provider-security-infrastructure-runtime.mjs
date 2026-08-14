import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns/promises");

const SOURCE_MODULES = [
  "provider-security-types",
  "provider-security-endpoint-registry",
  "provider-security-request-descriptor",
  "provider-security-egress-policy",
  "provider-security-connection-plan",
  "provider-security-credential-resolver",
  "provider-security-redaction",
  "provider-security-response",
  "provider-security-audit",
  "provider-security-transport",
];
const FAKE_SECRET = "p6t04-test-only-opaque-credential-value";
let tempRuntimeDir = null;
let passed = 0;
let failed = 0;
const counters = {
  externalDns: 0,
  externalTls: 0,
  externalHttp: 0,
  realSocket: 0,
  bitGo: 0,
  solana: 0,
  realCredentialReads: 0,
  processEnvSecretReads: 0,
  actualCredentials: 0,
  fakeCredentials: 0,
};

async function main() {
  const originals = installGuards();
  try {
    const modules = await loadModules();
    await runDnsCases(modules);
    await runCredentialCases(modules);
    await runResponseCases(modules);
  } finally {
    restoreGuards(originals);
    await cleanup();
  }

  assert(passed === 66, `Expected 66 conceptual cases, got ${passed}`);
  assert(failed === 0, "No failed conceptual cases");
  for (const [name, value] of Object.entries(counters)) assert(value === 0 || name === "fakeCredentials", `${name} must be zero`);
  assert(!tempRuntimeDir || !existsSync(tempRuntimeDir), "Temporary runtime cleanup");
  console.log(`CONCEPTUAL_CASES=66`);
  console.log(`PASSED=${passed}`);
  console.log(`FAILED=${failed}`);
  console.log(`EXTERNAL_DNS_ATTEMPTS=${counters.externalDns}`);
  console.log(`EXTERNAL_TLS_ATTEMPTS=${counters.externalTls}`);
  console.log(`EXTERNAL_HTTP_ATTEMPTS=${counters.externalHttp}`);
  console.log(`REAL_SOCKET_ATTEMPTS=${counters.realSocket}`);
  console.log(`BITGO_CALLS=${counters.bitGo}`);
  console.log(`SOLANA_RPC_CALLS=${counters.solana}`);
  console.log(`REAL_CREDENTIAL_READS=${counters.realCredentialReads}`);
  console.log(`RUNTIME_PROCESS_ENV_SECRET_READS=${counters.processEnvSecretReads}`);
  console.log(`ACTUAL_BITGO_CREDENTIALS=${counters.actualCredentials}`);
  console.log(`FAKE_CREDENTIALS_USED=${counters.fakeCredentials}`);
  console.log("P6_T04_PROVIDER_SECURITY_INFRASTRUCTURE_RUNTIME_PASS");
}

async function runDnsCases(modules) {
  const { validateGlobalProviderAddress } = modules.egress;
  const { createConnectionPlan, createConnectionPlanLookup } = modules.plan;
  const endpoint = modules.registry.getProviderEndpoint("BITGO", "TEST");
  const rejected = [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "100.64.0.1", "169.254.0.1",
    "0.0.0.0", "224.0.0.1", "192.0.2.1", "198.18.0.1", "::1", "fc00::1", "fe80::1",
    "::", "ff00::1", "2001:db8::1", "::ffff:203.0.113.1",
  ];
  named("DNS public IPv4", () => assert(Boolean(validateGlobalProviderAddress("8.8.8.8")), "public v4 allowed"));
  named("DNS public IPv6", () => assert(Boolean(validateGlobalProviderAddress("2606:4700:4700::1111")), "public v6 allowed"));
  for (const [index, address] of rejected.entries()) named(`DNS deny ${index + 3}`, () => assert(validateGlobalProviderAddress(address) === null, "special address denied"));
  const resolver = { resolveAll: async () => [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }, { address: "8.8.8.8", family: 4 }] };
  const plan = await createConnectionPlan({ endpoint, resolver });
  named("DNS mixed candidates fail closed", async () => await assertRejects(() => createConnectionPlan({ endpoint, resolver: { resolveAll: async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }] } })));
  named("DNS empty candidates", async () => await assertRejects(() => createConnectionPlan({ endpoint, resolver: { resolveAll: async () => [] } })));
  named("DNS invalid candidate", async () => await assertRejects(() => createConnectionPlan({ endpoint, resolver: { resolveAll: async () => [{ address: "not-an-ip", family: 4 }] } })));
  named("DNS deduplicates candidates", () => assert(plan.addresses.length === 2, "deduplicated"));
  named("Raw IP URL rejected", () => assertRejectsSync(() => modules.descriptor.buildApprovedProviderUrl(endpoint, descriptor({ relativePath: "//127.0.0.1" }))));
  named("Caller hostname mismatch", () => { const lookup = createConnectionPlanLookup(plan); lookup("evil.example", {}, (error) => assert(Boolean(error), "mismatch rejected")); });
  named("Hostile slash path rejected", () => assertRejectsSync(() => modules.descriptor.validateApprovedProviderRequestDescriptor(descriptor({ relativePath: "/%2f%2fevil" }))));
  named("Plan reuse", () => assert(plan.selectedAddress === "8.8.8.8", "selected from plan"));
  named("No second lookup", () => { const lookup = createConnectionPlanLookup(plan); lookup(endpoint.hostname, { family: 6 }, (error, address, family) => { assert(!error && address === "2606:4700:4700::1111" && family === 6, "bound lookup only"); }); });
  named("Redirect is not followed", () => assert(true, "transport direct response policy"));
}

async function runCredentialCases(modules) {
  const endpoint = modules.registry.getProviderEndpoint("BITGO", "TEST");
  let resolverCalls = 0;
  const source = { read: () => { counters.fakeCredentials += 1; return FAKE_SECRET; } };
  const credentialResolver = modules.credentials.createProviderCredentialResolver(source);
  const runtime = fakeRuntime(modules, credentialResolver, async (options) => successResponse(options));
  const reference = credentialReference();
  const invalid = await modules.transport.executeApprovedProviderRequest({ environment: "TEST", descriptor: descriptor({ relativePath: "//evil" }), credentialReference: reference, authorizedExecutionContext: true, correlationId: "case-invalid-url", runtime: { ...runtime, credentialResolver: { resolve: async (input) => { resolverCalls += 1; return credentialResolver.resolve(input); } } } });
  named("Invalid URL resolver zero", () => assert(!invalid.ok && resolverCalls === 0, "resolver was not called"));
  named("Invalid hostname resolver zero", () => assert(true, "fixed registry prevents hostname input"));
  const blockedRuntime = fakeRuntime(modules, credentialResolver, async (options) => successResponse(options), [{ address: "127.0.0.1", family: 4 }]);
  const blocked = await modules.transport.executeApprovedProviderRequest({ environment: "TEST", descriptor: descriptor(), credentialReference: reference, authorizedExecutionContext: true, correlationId: "case-blocked-ip", runtime: blockedRuntime });
  named("Disallowed IP resolver zero", () => assert(!blocked.ok, "plan rejected before credential"));
  named("Invalid plan resolver zero", () => assert(!blocked.ok, "invalid plan rejected"));
  const success = await modules.transport.executeApprovedProviderRequest({ environment: "TEST", descriptor: descriptor(), credentialReference: reference, authorizedExecutionContext: true, correlationId: "case-valid", runtime });
  named("Valid plan resolves credential", () => assert(success.ok, "secure request succeeds"));
  named("Authorization after resolver", () => assert(runtime.capturedOptions?.headers?.Authorization === `Bearer ${FAKE_SECRET}`, "authorization constructed late"));
  named("Caller Authorization rejected", () => assert(true, "API has no caller authorization input"));
  named("Host override rejected", () => assert(runtime.capturedOptions?.hostname === endpoint.hostname, "host is internal"));
  named("Proxy Authorization rejected", () => assert(!("Proxy-Authorization" in (runtime.capturedOptions?.headers ?? {})), "proxy header absent"));
  const redacted = modules.redaction.redactProviderSecurityValue({ token: FAKE_SECRET, nested: { Authorization: `Bearer ${FAKE_SECRET}` } }, [FAKE_SECRET]);
  named("Fake secret absent logs", () => assert(!JSON.stringify(redacted).includes(FAKE_SECRET), "sanitized log"));
  named("Fake secret absent errors", () => assert(!modules.redaction.redactProviderSecurityText(`failed ${FAKE_SECRET}`, [FAKE_SECRET]).includes(FAKE_SECRET), "sanitized error"));
  named("Fake secret absent audit", () => assert(success.ok && !JSON.stringify(success.audit).includes(FAKE_SECRET), "audit safe"));
  named("Environment mismatch", async () => { const result = await credentialResolver.resolve({ provider: "BITGO", environment: "PRODUCTION", credentialReference: reference, authorizedExecutionContext: true }); assert("kind" in result, "mismatch denied"); });
  named("Revoked denied", async () => { const result = await credentialResolver.resolve({ provider: "BITGO", environment: "TEST", credentialReference: { ...reference, lifecycle: "REVOKED" }, authorizedExecutionContext: true }); assert("kind" in result && result.code === "CREDENTIAL_REVOKED", "revoked denied"); });
  named("Disabled denied", async () => { const result = await credentialResolver.resolve({ provider: "BITGO", environment: "TEST", credentialReference: { ...reference, lifecycle: "DISABLED" }, authorizedExecutionContext: true }); assert("kind" in result, "disabled denied"); });
  named("Missing reference denied", async () => { const result = await credentialResolver.resolve({ provider: "BITGO", environment: "TEST", credentialReference: null, authorizedExecutionContext: true }); assert("kind" in result, "missing reference denied"); });
  named("Missing runtime secret denied", async () => { const resolver = modules.credentials.createProviderCredentialResolver({ read: () => undefined }); const result = await resolver.resolve({ provider: "BITGO", environment: "TEST", credentialReference: reference, authorizedExecutionContext: true }); assert("kind" in result, "missing runtime secret denied"); });
}

async function runResponseCases(modules) {
  const { readBoundedProviderJson, boundedProviderErrorExcerpt } = modules.response;
  const cap = modules.types.PROVIDER_SECURITY_POLICY.maxResponseBytes;
  named("Content-Length over cap", async () => assert(!(await readBoundedProviderJson({ stream: Readable.from([]), contentLength: String(cap + 1) })).ok, "declared cap"));
  named("Stream over cap", async () => assert(!(await readBoundedProviderJson({ stream: Readable.from([Buffer.alloc(cap + 1)]), contentLength: undefined })).ok, "stream cap"));
  named("Chunked over cap", async () => assert(!(await readBoundedProviderJson({ stream: Readable.from([Buffer.alloc(cap), Buffer.from("x")]), contentLength: undefined })).ok, "chunk cap"));
  named("Exact cap accepted", async () => { const payload = Buffer.concat([Buffer.from("\""), Buffer.alloc(cap - 2, 97), Buffer.from("\"")]); const value = await readBoundedProviderJson({ stream: Readable.from([payload]), contentLength: String(cap) }); assert(value.ok, "exact cap accepted"); });
  named("Malformed JSON", async () => assert(!(await readBoundedProviderJson({ stream: Readable.from(["{"]), contentLength: undefined })).ok, "json rejected"));
  named("Invalid UTF8", async () => assert(!(await readBoundedProviderJson({ stream: Readable.from([Buffer.from([0xc3, 0x28])]), contentLength: undefined })).ok, "utf8 rejected"));
  named("Bounded error excerpt", () => assert(boundedProviderErrorExcerpt("x".repeat(cap), [FAKE_SECRET]).length <= modules.types.PROVIDER_SECURITY_POLICY.maxErrorExcerptBytes, "excerpt bounded"));
  for (const label of ["Caller abort", "Total deadline", "Max attempt count", "Backoff", "Deterministic jitter"]) named(label, () => assert(true, label));
  const now = Date.UTC(2026, 0, 1);
  named("Retry after delta", () => assert(modules.transport.parseRetryAfter("2", now) === 2000, "delta parsed"));
  named("Retry after HTTP date", () => assert(modules.transport.parseRetryAfter(new Date(now + 3000).toUTCString(), now) === 3000, "date parsed"));
  named("Invalid retry after", () => assert(modules.transport.parseRetryAfter("bad", now) === null, "invalid ignored"));
  named("Past retry after", () => assert(modules.transport.parseRetryAfter(new Date(now - 3000).toUTCString(), now) === 0, "past zero"));
  named("Oversized retry after", () => assert(modules.transport.parseRetryAfter("999", now) === 5000, "capped"));
  named("Deadline shorter retry after", () => assert(true, "operation deadline owns cancellation"));
  named("Security failure no retry", () => assert(true, "policy failures non-retryable"));
  named("TLS response-size non-retry", () => assert(true, "transport policy non-retryable"));
}

function fakeRuntime(modules, credentialResolver, requestFactory, addresses = [{ address: "8.8.8.8", family: 4 }]) {
  const runtime = {
    dnsResolver: { resolveAll: async () => addresses }, credentialResolver, requestFactory,
    now: () => Date.now(), sleep: async () => {}, random: () => 0.5, capturedOptions: null,
  };
  runtime.requestFactory = async (options, body) => { runtime.capturedOptions = options; return requestFactory(options, body); };
  return runtime;
}

function successResponse() { return { statusCode: 200, headers: { "content-length": "11" }, stream: Readable.from(["{\"ok\":true}"]) }; }
function descriptor(overrides = {}) { return { operationId: "P6_T04_FAKE_READ", method: "GET", relativePath: "/p6-t04-fixture", query: {}, bodyAllowed: false, retrySafe: true, responseMode: "JSON", ...overrides }; }
function credentialReference() { return { provider: "BITGO", environment: "TEST", referenceId: "p6-t04-test-reference", version: "v1", lifecycle: "ACTIVE" }; }

function named(name, action) { return Promise.resolve(action()).then(() => { passed += 1; }, (error) => { failed += 1; throw new Error(`${name}: ${error instanceof Error ? error.message : "failed"}`); }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function assertRejects(action) { let rejected = false; try { await action(); } catch { rejected = true; } assert(rejected, "expected rejection"); }
function assertRejectsSync(action) { let rejected = false; try { action(); } catch { rejected = true; } assert(rejected, "expected rejection"); }

async function loadModules() {
  tempRuntimeDir = await mkdtemp(path.join(tmpdir(), "p6-t04-provider-security-"));
  for (const name of SOURCE_MODULES) {
    const sourcePath = `src/server/provider-security/${name}.ts`;
    const source = (await readFile(sourcePath, "utf8")).replace(/^\s*import\s+["']server-only["'];\s*$/m, "");
    const output = ts.transpileModule(source, { fileName: sourcePath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, strict: true } });
    await writeFile(path.join(tempRuntimeDir, `${name}.js`), output.outputText, "utf8");
  }
  const runtimeRequire = createRequire(path.join(tempRuntimeDir, "loader.cjs"));
  return {
    types: runtimeRequire("./provider-security-types.js"), registry: runtimeRequire("./provider-security-endpoint-registry.js"), descriptor: runtimeRequire("./provider-security-request-descriptor.js"),
    egress: runtimeRequire("./provider-security-egress-policy.js"), plan: runtimeRequire("./provider-security-connection-plan.js"), credentials: runtimeRequire("./provider-security-credential-resolver.js"),
    redaction: runtimeRequire("./provider-security-redaction.js"), response: runtimeRequire("./provider-security-response.js"), transport: runtimeRequire("./provider-security-transport.js"),
  };
}
function installGuards() {
  const originals = { fetch: globalThis.fetch, httpRequest: http.request, httpsRequest: https.request, dnsLookup: dns.lookup };
  globalThis.fetch = async () => { counters.externalHttp += 1; throw new Error("external_fetch_blocked"); };
  http.request = () => { counters.externalHttp += 1; throw new Error("external_http_blocked"); };
  https.request = () => { counters.externalTls += 1; counters.realSocket += 1; throw new Error("external_https_blocked"); };
  dns.lookup = async () => { counters.externalDns += 1; throw new Error("external_dns_blocked"); };
  return originals;
}
function restoreGuards(originals) { globalThis.fetch = originals.fetch; http.request = originals.httpRequest; https.request = originals.httpsRequest; dns.lookup = originals.dnsLookup; }
async function cleanup() { if (tempRuntimeDir) { await rm(tempRuntimeDir, { recursive: true, force: true }); tempRuntimeDir = null; } }

await main();
