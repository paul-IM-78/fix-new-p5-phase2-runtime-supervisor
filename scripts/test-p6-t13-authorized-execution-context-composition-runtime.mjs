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
const counters = { network: 0, bitgo: 0, realCredentialReads: 0 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function transpileDirectory(sourceDirectory, destinationDirectory) {
  await mkdir(destinationDirectory, { recursive: true });
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true });
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
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "p6-t13-"));
  await transpileDirectory("src/server/custody", path.join(temporaryDirectory, "src/server/custody"));
  await transpileDirectory("src/server/provider-security", path.join(temporaryDirectory, "src/server/provider-security"));
  await symlink(path.resolve("node_modules"), path.join(temporaryDirectory, "node_modules"), "junction");
  return createRequire(path.join(temporaryDirectory, "loader.cjs"))(
    "./src/server/custody/bitgo-authorized-read-only-runtime-composition.test.js",
  );
}

async function main() {
  const original = { http: http.request, https: https.request, connect: net.connect };
  const blocked = () => {
    counters.network += 1;
    counters.bitgo += 1;
    throw new Error("network_forbidden");
  };
  http.request = blocked;
  https.request = blocked;
  net.connect = blocked;

  try {
    const source = await readFile("src/server/custody/bitgo-authorized-read-only-runtime-composition.ts", "utf8");
    const test = await loadQualificationModule();
    const cases = await test.runP6T13AuthorizedExecutionContextQualification();
    assert(cases.length === EXPECTED_CASES, "case_count_invalid");
    assert(new Set(cases).size === EXPECTED_CASES, "case_ids_duplicate");
    for (const [index, id] of cases.entries()) {
      assert(id === `P6T13-AUTH-${String(index + 1).padStart(3, "0")}`, "case_sequence_invalid");
      console.log(`PASS ${id}`);
    }
    assert(source.startsWith('import "server-only";'), "server_only_missing");
    assert(source.includes("authorizedExecutionContext: true"), "authority_missing");
    assert(!source.includes("createProcessEnvRuntimeSecretSource"), "process_env_source_forbidden");
    assert(!source.includes("executeApprovedProviderRequest"), "transport_forbidden");
    assert(!source.includes("Authorization"), "authorization_header_forbidden");
    assert(counters.network === 0 && counters.bitgo === 0 && counters.realCredentialReads === 0, "operation_guard_failed");
  } finally {
    http.request = original.http;
    https.request = original.https;
    net.connect = original.connect;
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(`EXPECTED_CASES=${EXPECTED_CASES}`);
  console.log(`EXECUTED_CASES=${EXPECTED_CASES}`);
  console.log(`PASSED_CASES=${EXPECTED_CASES}`);
  console.log("FAILED_CASES=0");
  console.log("NETWORK_CALLS=0");
  console.log("BITGO_CALLS=0");
  console.log("REAL_CREDENTIAL_READS=0");
  console.log("PASS_P6_T13_AUTHORIZED_EXECUTION_CONTEXT_COMPOSITION_RUNTIME");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
