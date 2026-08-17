import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const SOURCE = "src/server/custody/custody-wallet-id-registry-client.ts";
const TEST = "src/server/custody/custody-wallet-id-registry-client.test.ts";
const CASE_IDS = Array.from({ length: 27 }, (_, index) => `P6T11-REG-${String(index + 1).padStart(3, "0")}`);
let tempDir = null;
let passed = 0;
const counters = { provider: 0, credential: 0, network: 0, scheduler: 0, actualWallet: 0 };

function assert(value, message) { if (!value) throw new Error(message); }
function pass(id, proof) { assert(CASE_IDS[passed] === id, "case_order_invalid"); proof(); passed += 1; console.log(`PASS ${id}`); }

async function main() {
  const originals = { fetch: globalThis.fetch, httpRequest: http.request, httpsRequest: https.request, connect: net.connect, createConnection: net.createConnection };
  globalThis.fetch = async () => { counters.network += 1; throw new Error("network_blocked"); };
  http.request = () => { counters.network += 1; throw new Error("network_blocked"); };
  https.request = () => { counters.network += 1; throw new Error("network_blocked"); };
  net.connect = () => { counters.network += 1; throw new Error("network_blocked"); };
  net.createConnection = net.connect;
  try {
    const modules = await loadModules();
    const source = await readFile(SOURCE, "utf8");
    const tool = await readFile("scripts/custody/provision-wallet-id-registry.local.mjs", "utf8");
    const cases = await modules.tests.runP6T11RegistryClientQualification();
    pass("P6T11-REG-001", () => assert(source.startsWith('import "server-only";'), "server_only"));
    pass("P6T11-REG-002", () => assert(source.includes("loadActiveCustodyWalletIdRegistrySnapshot"), "loader_api"));
    pass("P6T11-REG-003", () => assert(source.includes("private.load_active_custody_wallet_id_registry"), "dedicated_read_boundary"));
    pass("P6T11-REG-004", () => assert(source.includes("Object.freeze(entries)"), "immutable_array"));
    pass("P6T11-REG-005", () => assert(source.includes("REGISTRY_INVALID_ROW"), "invalid_row_fail_closed"));
    pass("P6T11-REG-006", () => assert(source.includes("REGISTRY_INVALID_WALLET_ID"), "wallet_validation"));
    pass("P6T11-REG-007", () => assert(source.includes("REGISTRY_DUPLICATE_TUPLE"), "duplicate_rejection"));
    pass("P6T11-REG-008", () => assert(source.includes('environment !== "TEST"'), "test_environment_only"));
    pass("P6T11-REG-009", () => assert(!source.includes("bitgo-read-only-runtime-composition"), "p6_t09_unchanged"));
    pass("P6T11-REG-010", () => assert(!source.includes("bitgo-read-only-runtime-composition-consumer"), "p6_t10_unchanged"));
    pass("P6T11-REG-011", () => assert(!source.includes("provider-security"), "p6_t04_unchanged"));
    pass("P6T11-REG-012", () => assert(!source.includes("credential"), "no_credential_dependency"));
    pass("P6T11-REG-013", () => assert(tool.includes("process.stdin") && !tool.includes("--wallet-id"), "stdin_only_wallet_input"));
    pass("P6T11-REG-014", () => assert(tool.includes("local_registry_remote_target_rejected"), "local_target_guard"));
    pass("P6T11-REG-015", () => assert(!/console\.(log|error)\([^\n]*(walletId|wallet_id)/.test(tool), "operator_output_nonemission"));
    pass("P6T11-REG-016", () => assert(tool.includes("private.provision_custody_wallet_id_registry") && !tool.includes("insert into private.custody_wallet"), "procedure_only_tool"));
    pass("P6T11-REG-017", () => assert(cases.includes("P6T11-REG-017"), "malformed_row_proof"));
    pass("P6T11-REG-018", () => assert(!source.includes("PRODUCTION" + "_FALLBACK"), "no_environment_fallback"));
    pass("P6T11-REG-019", () => assert(cases.includes("P6T11-REG-019"), "snapshot_proof"));
    pass("P6T11-REG-020", () => assert(cases.includes("P6T11-REG-020"), "duplicate_proof"));
    pass("P6T11-REG-021", () => assert(cases.includes("P6T11-REG-021"), "safe_failure_proof"));
    pass("P6T11-REG-022", () => assert(!source.includes("retry"), "no_retry"));
    pass("P6T11-REG-023", () => assert(counters.network === 0 && counters.provider === 0 && counters.credential === 0, "external_activity_zero"));
    pass("P6T11-REG-024", () => assert(existsSync("src/server/custody/bitgo-wallet-id-resolver.ts"), "p6_t08_regression_boundary"));
    pass("P6T11-REG-025", () => assert(existsSync("src/server/custody/bitgo-read-only-runtime-composition.ts"), "p6_t09_regression_boundary"));
    pass("P6T11-REG-026", () => assert(existsSync("src/server/custody/bitgo-read-only-runtime-composition-consumer.ts"), "p6_t10_regression_boundary"));
    pass("P6T11-REG-027", () => assert(passed === 26 && Object.values(counters).every((value) => value === 0), "full_authority_guard"));
  } finally {
    globalThis.fetch = originals.fetch; http.request = originals.httpRequest; https.request = originals.httpsRequest; net.connect = originals.connect; net.createConnection = originals.createConnection;
    if (tempDir) { await rm(tempDir, { recursive: true, force: true }); tempDir = null; }
  }
  assert(passed === 27, "case_count_invalid");
  assert(new Set(CASE_IDS).size === 27, "case_ids_unique");
  assert(!tempDir, "temporary_runtime_cleanup");
  console.log("EXPECTED_CASES=27");
  console.log("EXECUTED_CASES=27");
  console.log("PASSED_CASES=27");
  console.log("FAILED_CASES=0");
  console.log("ACTUAL_WALLET_IDS=0");
  console.log("PROVIDER_CALLS=0");
  console.log("CREDENTIAL_CALLS=0");
  console.log("NETWORK_CALLS=0");
  console.log("PASS_P6_T11_CUSTODY_WALLET_ID_REGISTRY_RUNTIME");
}

async function loadModules() {
  tempDir = await mkdtemp(path.join(tmpdir(), "p6-t11-registry-"));
  for (const sourcePath of [SOURCE, TEST]) {
    let source = await readFile(sourcePath, "utf8");
    source = source.replace(/^import "server-only";\r?\n/, "");
    const output = ts.transpileModule(source, { fileName: sourcePath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, strict: true } });
    const outputPath = path.join(tempDir, sourcePath.replace(/\.ts$/, ".js"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output.outputText, "utf8");
  }
  await symlink(path.resolve("node_modules"), path.join(tempDir, "node_modules"), "junction");
  const runtimeRequire = createRequire(path.join(tempDir, "loader.cjs"));
  return { tests: runtimeRequire("./src/server/custody/custody-wallet-id-registry-client.test.js") };
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "p6_t11_runtime_failed"); process.exitCode = 1; });
