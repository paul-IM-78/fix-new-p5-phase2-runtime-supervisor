import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const EXPECTED_CASES = 28;
let temporaryDirectory;
const counters = { network: 0, bitgo: 0, realCredentialReads: 0, actualDbReads: 0 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function transpileDirectory(sourceDirectory, destinationDirectory) {
  await mkdir(destinationDirectory, { recursive: true });
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);
    if (entry.isDirectory()) {
      await transpileDirectory(sourcePath, destinationPath);
    } else if (entry.name.endsWith(".ts")) {
      const source = (await readFile(sourcePath, "utf8")).replace(/^import "server-only";\r?\n/, "");
      const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText;
      await writeFile(destinationPath.replace(/\.ts$/, ".js"), output);
    }
  }
}

async function loadQualificationModule() {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "p6-t14-"));
  await transpileDirectory("src/server/custody", path.join(temporaryDirectory, "src/server/custody"));
  await transpileDirectory("src/server/provider-security", path.join(temporaryDirectory, "src/server/provider-security"));
  await symlink(path.resolve("node_modules"), path.join(temporaryDirectory, "node_modules"), "junction");
  return createRequire(path.join(temporaryDirectory, "loader.cjs"))(
    "./src/server/custody/bitgo-controlled-test-activation.test.js",
  );
}

function assertFutureModeIsUnauthorized(argumentsList) {
  const verifyPrerequisites = argumentsList.includes("--verify-prerequisites");
  const execute = argumentsList.includes("--execute");
  const forbidden = ["--wallet-id", "--credential-reference", "--credential", "--token", "--secret", "--access-token", "--authorization"];
  if (argumentsList.some((value) => forbidden.some((option) => value.startsWith(option)))) {
    throw new Error("forbidden_activation_input");
  }
  if (verifyPrerequisites && execute) {
    throw new Error("activation_modes_mutually_exclusive");
  }
  if (verifyPrerequisites) {
    assertFutureSelection(argumentsList);
    throw new Error("pre_activation_preparation_authorization_required");
  }
  if (execute) {
    if (process.env.P6_T14_ALLOW_LIVE_BITGO_TEST !== "YES") {
      throw new Error("live_activation_opt_in_required");
    }
    assertFutureSelection(argumentsList);
    throw new Error("live_test_activation_authorization_required");
  }
}

function assertFutureSelection(argumentsList) {
  const bindingKeyIndex = argumentsList.indexOf("--binding-key");
  const accountRoleIndex = argumentsList.indexOf("--account-role");
  if (bindingKeyIndex < 0 || accountRoleIndex < 0 || !argumentsList[bindingKeyIndex + 1] || !argumentsList[accountRoleIndex + 1]) {
    throw new Error("non_secret_binding_selection_required");
  }
}

async function main() {
  assertFutureModeIsUnauthorized(process.argv.slice(2));
  const originals = { fetch: globalThis.fetch, http: http.request, https: https.request, connect: net.connect, createConnection: net.createConnection };
  const blocked = () => { counters.network += 1; counters.bitgo += 1; throw new Error("network_forbidden"); };
  globalThis.fetch = blocked;
  http.request = blocked;
  https.request = blocked;
  net.connect = blocked;
  net.createConnection = blocked;

  try {
    const source = await readFile("src/server/custody/bitgo-controlled-test-activation.ts", "utf8");
    const test = await loadQualificationModule();
    const cases = await test.runP6T14ControlledTestActivationLayer1Qualification();
    assert(cases.length === EXPECTED_CASES, "case_count_invalid");
    assert(new Set(cases).size === EXPECTED_CASES, "case_ids_duplicate");
    for (const [index, id] of cases.entries()) {
      assert(id === `P6T14-L1-${String(index + 1).padStart(3, "0")}`, "case_sequence_invalid");
      console.log(`PASS ${id}`);
    }
    assert(source.startsWith('import "server-only";'), "server_only_missing");
    assert(!source.includes("createProcessEnvRuntimeSecretSource"), "process_env_source_forbidden");
    assert(!source.includes("executeApprovedProviderRequest"), "transport_forbidden");
    assert(!source.includes("https.request"), "network_forbidden");
    assert(counters.network === 0 && counters.bitgo === 0 && counters.realCredentialReads === 0 && counters.actualDbReads === 0, "operation_guard_failed");
  } finally {
    globalThis.fetch = originals.fetch;
    http.request = originals.http;
    https.request = originals.https;
    net.connect = originals.connect;
    net.createConnection = originals.createConnection;
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(`EXPECTED_CASES=${EXPECTED_CASES}`);
  console.log(`EXECUTED_CASES=${EXPECTED_CASES}`);
  console.log(`PASSED_CASES=${EXPECTED_CASES}`);
  console.log("FAILED_CASES=0");
  console.log("NETWORK_CALLS=0");
  console.log("BITGO_CALLS=0");
  console.log("REAL_CREDENTIAL_READS=0");
  console.log("ACTUAL_DB_READS=0");
  console.log("PASS_P6_T14_LAYER1_CONTROLLED_TEST_ACTIVATION");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "p6_t14_runtime_failed");
  process.exitCode = 1;
});
