import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = "src/server/custody/bitgo-read-only-semantic-adapter.ts";
const EXPECTED_BLOB_ID = "1d7f644d09f3f5f9bbf5d106ce7dbf4e3a266e87";
const EXPECTED_SOURCE_SHA256 = "3584573C032544546C10514FF40B6044EE014B0B8D459F2960C3D8CFDD5B5AFC";
const WALLET_PATTERN = /^[0-9a-f]{32}$/;
const CAPABILITIES = Object.freeze(["BALANCE_OBSERVATION"]);
const CREDENTIAL_REFERENCE = Object.freeze({
  provider: "BITGO",
  environment: "TEST",
  referenceId: "p6-t06-bitgo-test-access-token",
  version: "P6_T06_V1",
  lifecycle: "ACTIVE",
});
const PROVIDER = Object.freeze({ providerCode: "BITGO", providerType: "P6_T06_QUALIFICATION" });
const BINDING = Object.freeze({
  providerCode: "BITGO",
  bindingKey: "P6_T06_FIRST_REAL_READ_QUALIFICATION",
  assetCode: "TSOL",
  accountRole: "QUALIFICATION",
});

export const P6_T06_OUTPUT_KEYS = Object.freeze([
  "schemaVersion", "task", "qualification", "classification", "environment", "coin",
  "operationId", "logicalInvocations", "transportAttempts", "walletIdSha256",
  "semanticResult", "custodyErrorCode", "identityMatch", "coinMatch", "totalUnitsValid",
  "availableUnitsValid", "confirmedUnitsValidOrAbsent", "health", "capabilities",
  "safeHttpStatus", "retryable", "retryAfterMs", "productionAttempts", "writeAttempts",
  "credentialValuePrinted",
]);

const EXIT_CODES = Object.freeze({
  CLEAN_PASS: 0,
  PREFLIGHT_FAIL: 2,
  CREDENTIAL_FAIL: 3,
  TRANSPORT_FAIL: 4,
  SEMANTIC_FAIL: 5,
  REAL_READ_SUCCEEDED_WITH_TRANSPORT_RETRY_REQUIRES_REVIEW: 6,
  INTERNAL_GUARD_FAIL: 7,
});

function baseResult(overrides = {}) {
  return {
    schemaVersion: 1,
    task: "P6-T06",
    qualification: "FIRST_REAL_BITGO_TEST_READ",
    classification: "INTERNAL_GUARD_FAIL",
    environment: "BITGO_TEST",
    coin: "tsol",
    operationId: "BITGO_TSOL_WALLET_GET_BALANCE",
    logicalInvocations: 0,
    transportAttempts: 0,
    walletIdSha256: null,
    semanticResult: "NOT_RUN",
    custodyErrorCode: null,
    identityMatch: null,
    coinMatch: null,
    totalUnitsValid: null,
    availableUnitsValid: null,
    confirmedUnitsValidOrAbsent: null,
    health: "UNKNOWN",
    capabilities: [],
    safeHttpStatus: null,
    retryable: false,
    retryAfterMs: null,
    productionAttempts: 0,
    writeAttempts: 0,
    credentialValuePrinted: 0,
    ...overrides,
  };
}

function assertOutput(result) {
  const keys = Object.keys(result);
  if (keys.length !== P6_T06_OUTPUT_KEYS.length || keys.some((key, index) => key !== P6_T06_OUTPUT_KEYS[index])) {
    throw new Error("p6_t06_output_schema_invalid");
  }
  return result;
}

function exitCodeFor(classification) {
  return EXIT_CODES[classification] ?? EXIT_CODES.INTERNAL_GUARD_FAIL;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function gitBuffer(args) {
  return execFileSync("git", args, { cwd: REPOSITORY_ROOT, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] });
}

function gitText(args) {
  return gitBuffer(args).toString("utf8").trim();
}

function currentSourceIdentity() {
  const blobId = gitText(["rev-parse", `HEAD:${SOURCE_PATH}`]);
  const rawBytes = gitBuffer(["cat-file", "blob", blobId]);
  return { blobId, rawSha256: sha256(rawBytes) };
}

function localTypeScript() {
  const ts = require("typescript");
  if (ts.version !== "5.9.3") throw new Error("p6_t06_typescript_version_invalid");
  return ts;
}

function relativeSourcePaths(program) {
  return program.getSourceFiles()
    .map((source) => path.relative(REPOSITORY_ROOT, source.fileName).split(path.sep).join("/"))
    .filter((file) => file.startsWith("src/") && file.endsWith(".ts"));
}

function ensureTrackedPathsClean(paths) {
  for (const relativePath of paths) {
    try {
      execFileSync("git", ["diff", "--quiet", "HEAD", "--", relativePath], { cwd: REPOSITORY_ROOT });
      execFileSync("git", ["diff", "--cached", "--quiet", "--", relativePath], { cwd: REPOSITORY_ROOT });
    } catch {
      throw new Error("p6_t06_tracked_dependency_dirty");
    }
  }
}

export async function loadCanonicalP6T05ForTest() {
  if (!process.execArgv.includes("--conditions=react-server")) {
    throw new Error("p6_t06_react_server_condition_required");
  }
  const ts = localTypeScript();
  const tempDir = await mkdtemp(path.join(tmpdir(), "p6-t06-runner-"));
  try {
    const rootFile = path.join(REPOSITORY_ROOT, SOURCE_PATH);
    const options = {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      rootDir: REPOSITORY_ROOT,
      outDir: tempDir,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmitOnError: false,
    };
    const program = ts.createProgram([rootFile], options);
    const sourcePaths = relativeSourcePaths(program);
    ensureTrackedPathsClean(sourcePaths);
    if (program.emit().emitSkipped) throw new Error("p6_t06_typescript_emit_failed");

    const serverOnlyTarget = path.join(REPOSITORY_ROOT, "node_modules", "next", "dist", "compiled", "server-only");
    const serverOnlyLink = path.join(tempDir, "node_modules", "server-only");
    if (!existsSync(serverOnlyTarget)) throw new Error("p6_t06_server_only_runtime_missing");
    await mkdir(path.dirname(serverOnlyLink), { recursive: true });
    await symlink(serverOnlyTarget, serverOnlyLink, "junction");

    const runtimeRequire = createRequire(path.join(tempDir, "loader.cjs"));
    const adapter = runtimeRequire(`./${SOURCE_PATH.replace(/\.ts$/, ".js")}`);
    const endpoints = runtimeRequire("./src/server/provider-security/provider-security-endpoint-registry.js");
    const transport = runtimeRequire("./src/server/provider-security/provider-security-transport.js");
    return { adapter, endpoints, transport, sourcePaths, tempDir };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function withCanonicalP6T05ForTest(action) {
  const modules = await loadCanonicalP6T05ForTest();
  try {
    return await action(modules);
  } finally {
    await rm(modules.tempDir, { recursive: true, force: true });
  }
}

export async function disposeCanonicalP6T05ForTest(modules) {
  await rm(modules.tempDir, { recursive: true, force: true });
}

function validatePreflight({ modules, env, preflightOverrides = {} }) {
  const walletId = env.BITGO_TEST_WALLET_ID;
  if (typeof walletId !== "string" || !WALLET_PATTERN.test(walletId)) return { ok: false, walletId: null, hash: null };
  const identity = preflightOverrides.sourceIdentity ?? currentSourceIdentity();
  if (identity.blobId !== EXPECTED_BLOB_ID || identity.rawSha256 !== EXPECTED_SOURCE_SHA256) return { ok: false, walletId, hash: sha256(Buffer.from(walletId, "utf8")) };
  const testEndpoint = Object.hasOwn(preflightOverrides, "testEndpoint")
    ? preflightOverrides.testEndpoint
    : modules.endpoints.getProviderEndpoint("BITGO", "TEST");
  const productionEndpoint = Object.hasOwn(preflightOverrides, "productionEndpoint")
    ? preflightOverrides.productionEndpoint
    : modules.endpoints.getProviderEndpoint("BITGO", "PRODUCTION");
  if (!testEndpoint || productionEndpoint) return { ok: false, walletId, hash: sha256(Buffer.from(walletId, "utf8")) };
  const provider = preflightOverrides.provider ?? PROVIDER;
  const credentialReference = preflightOverrides.credentialReference ?? CREDENTIAL_REFERENCE;
  if (
    provider.providerCode !== "BITGO" ||
    (provider.capabilities && JSON.stringify(provider.capabilities) !== JSON.stringify(CAPABILITIES)) ||
    JSON.stringify(credentialReference) !== JSON.stringify(CREDENTIAL_REFERENCE)
  ) {
    return { ok: false, walletId, hash: sha256(Buffer.from(walletId, "utf8")) };
  }
  const adapter = modules.adapter.createBitGoReadOnlySemanticAdapter({
    provider,
    credentialReference,
    authorizedExecutionContext: true,
    executor: preflightOverrides.executor,
    now: () => new Date("2026-08-15T00:00:00.000Z"),
  });
  if (
    JSON.stringify(adapter.capabilities) !== JSON.stringify(CAPABILITIES)
  ) {
    return { ok: false, walletId, hash: sha256(Buffer.from(walletId, "utf8")) };
  }
  return { ok: true, walletId, hash: sha256(Buffer.from(walletId, "utf8")), adapter };
}

export function classifyP6T06OutcomeForTest({ securityResult, semanticResult, health, logicalInvocations, walletIdSha256, capabilities = CAPABILITIES }) {
  const metadata = securityResult?.audit ?? { attemptCount: 0, safeStatus: null };
  const common = {
    logicalInvocations,
    transportAttempts: metadata.attemptCount,
    walletIdSha256,
    semanticResult: semanticResult?.ok ? "PASS" : "FAIL",
    custodyErrorCode: semanticResult?.ok ? null : semanticResult?.error?.code ?? null,
    health,
    capabilities: [...capabilities],
    safeHttpStatus: metadata.safeStatus ?? null,
    retryable: securityResult?.ok ? false : Boolean(securityResult?.error?.retryable),
    retryAfterMs: semanticResult?.ok ? null : semanticResult?.error?.retryAfterMs ?? null,
  };
  if (semanticResult?.ok && metadata.attemptCount === 1 && health === "AVAILABLE") {
    return baseResult({ ...common, classification: "CLEAN_PASS", identityMatch: true, coinMatch: true, totalUnitsValid: true, availableUnitsValid: true, confirmedUnitsValidOrAbsent: true });
  }
  if (semanticResult?.ok && metadata.attemptCount > 1) {
    return baseResult({ ...common, classification: "REAL_READ_SUCCEEDED_WITH_TRANSPORT_RETRY_REQUIRES_REVIEW", identityMatch: true, coinMatch: true, totalUnitsValid: true, availableUnitsValid: true, confirmedUnitsValidOrAbsent: true });
  }
  if (securityResult?.ok === false && securityResult.error.kind === "CREDENTIAL_FAILURE") return baseResult({ ...common, classification: "CREDENTIAL_FAIL" });
  if (securityResult?.ok === false) return baseResult({ ...common, classification: "TRANSPORT_FAIL" });
  return baseResult({ ...common, classification: "SEMANTIC_FAIL" });
}

export function createP6T06QualificationRunnerForTest({ modules, env, executor, preflightOverrides, correlationId = "p6-t06-offline-correlation", forceInternalError = false }) {
  let logicalInvocationsStarted = 0;
  return Object.freeze({
    async run() {
      if (logicalInvocationsStarted !== 0) return assertOutput(baseResult({ classification: "INTERNAL_GUARD_FAIL", logicalInvocations: 1 }));
      try {
        if (forceInternalError) throw new Error("p6_t06_forced_internal");
        const preflight = validatePreflight({ modules, env, preflightOverrides: { ...preflightOverrides, executor } });
        if (!preflight.ok) return assertOutput(baseResult({ classification: "PREFLIGHT_FAIL", walletIdSha256: preflight.hash }));
        logicalInvocationsStarted = 1;
        let observed = null;
        const observer = async (input) => {
          const result = await executor(input);
          observed = result;
          return result;
        };
        const adapter = modules.adapter.createBitGoReadOnlySemanticAdapter({ provider: PROVIDER, credentialReference: CREDENTIAL_REFERENCE, authorizedExecutionContext: true, executor: observer, now: () => new Date("2026-08-15T00:00:00.000Z") });
        const semanticResult = await adapter.readBalance({ binding: BINDING, walletId: preflight.walletId, correlationId });
        const health = (await adapter.readHealth()).status;
        return assertOutput(classifyP6T06OutcomeForTest({ securityResult: observed, semanticResult, health, logicalInvocations: logicalInvocationsStarted, walletIdSha256: preflight.hash }));
      } catch {
        return assertOutput(baseResult({ classification: "INTERNAL_GUARD_FAIL", logicalInvocations: logicalInvocationsStarted }));
      }
    },
  });
}

async function main() {
  let modules = null;
  try {
    modules = await loadCanonicalP6T05ForTest();
    const executor = async (input) => modules.transport.executeApprovedProviderRequest(input);
    const runner = createP6T06QualificationRunnerForTest({ modules, env: { BITGO_TEST_WALLET_ID: process.env.BITGO_TEST_WALLET_ID }, executor, correlationId: randomUUID() });
    const result = await runner.run();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = exitCodeFor(result.classification);
  } catch {
    const result = assertOutput(baseResult({ classification: "INTERNAL_GUARD_FAIL" }));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = EXIT_CODES.INTERNAL_GUARD_FAIL;
  } finally {
    if (modules?.tempDir) await rm(modules.tempDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();
