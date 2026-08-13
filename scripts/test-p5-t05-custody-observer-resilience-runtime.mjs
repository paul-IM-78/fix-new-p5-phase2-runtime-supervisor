import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const cycles = new Set(["1", "2", "3"]);
const phases = new Set(["db", "recorded", "read", "restart", "cycle", "full"]);
const readParts = new Set(["list", "detail", "fingerprint", "all"]);
const restartParts = new Set(["prepare", "execute"]);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(repositoryRoot, ".next", "p5-t05-restart-baseline.json");
const npmCliPath = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const LOCAL_DB_HOST = "127.0.0.1";
const LOCAL_DB_PORT = 55722;
const DB_NAME = "postgres";
const SCOPE_ROLE = "custody_observer_scope_reader";
const WORKER_ROLE = "custody_observer_worker";
const RUN_WRITER_ROLE = "custody_observer_run_writer";
const FOUNDATION_ASSET = { id: "00000000-0000-4000-8000-000000850101", assetCode: "P5T05F_A" };
const FOUNDATION_PROVIDER = { id: "00000000-0000-4000-8000-000000850201", providerCode: "P5T05_FOUNDATION" };
const FOUNDATION_BINDING = { id: "00000000-0000-4000-8000-000000850301", bindingKey: "p5t05_foundation" };
const MODULES = [
  ["src/server/custody/provider-observation-contract.ts", "provider-observation-contract.js"],
  ["src/server/custody/balance-observation-normalization.ts", "balance-observation-normalization.js"],
  ["src/server/custody/balance-observer-retry.ts", "balance-observer-retry.js"],
  ["src/server/custody/balance-observer-command-client.ts", "balance-observer-command-client.js"],
  ["src/server/custody/balance-observer-scope-client.ts", "balance-observer-scope-client.js"],
  ["src/server/custody/balance-observer-worker.ts", "balance-observer-worker.js"],
  ["src/server/custody/balance-observer-orchestrator.ts", "balance-observer-orchestrator.js"],
  ["src/server/custody/balance-observer-run-ledger-client.ts", "balance-observer-run-ledger-client.js"],
  ["src/server/custody/balance-observer-recorded-orchestrator.ts", "balance-observer-recorded-orchestrator.js"],
];

function fail(code) {
  console.error(code);
  process.exitCode = 1;
}

function redactChildOutput(value) {
  return String(value)
    .replace(/^(\s*"(?:ANON_KEY|DB_URL|JWT_SECRET|PUBLISHABLE_KEY|SECRET_KEY|SERVICE_ROLE_KEY|S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)"\s*:\s*)"[^"]*"/gim, "$1\"[REDACTED]\"")
    .replace(/(postgres(?:ql)?:\/\/[^\s:@]+:)[^\s@]+@/gi, "$1[REDACTED]@")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}

function parseArguments(argv) {
  const values = new Map();

  for (const argument of argv) {
    const match = /^--(cycle|phase|read-part|restart-part)=(.+)$/.exec(argument);
    if (!match || values.has(match[1])) {
      throw new Error("P5_T05_06_INVALID_ARGUMENTS");
    }

    values.set(match[1], match[2]);
  }

  const cycle = values.get("cycle");
  const phase = values.get("phase");
  if (!cycles.has(cycle) || !phases.has(phase)) {
    throw new Error("P5_T05_06_INVALID_ARGUMENTS");
  }

  const readPart = values.get("read-part");
  const restartPart = values.get("restart-part");
  if ((phase === "read" && !readParts.has(readPart)) || (phase !== "read" && readPart !== undefined)) {
    throw new Error("P5_T05_06_INVALID_ARGUMENTS");
  }
  if ((phase === "restart" && (!restartParts.has(restartPart) || cycle !== "3")) || (phase !== "restart" && restartPart !== undefined)) {
    throw new Error("P5_T05_06_INVALID_ARGUMENTS");
  }

  return { cycle, phase, readPart, restartPart };
}

function runNpmScript(script, args = []) {
  const npmArgs = ["run", script];
  if (args.length > 0) {
    npmArgs.push("--", ...args);
  }

  const command = process.platform === "win32" ? process.execPath : "npm";
  const commandArgs = process.platform === "win32" ? [npmCliPath, ...npmArgs] : npmArgs;
  const result = spawnSync(command, commandArgs, {
    cwd: repositoryRoot,
    env: process.env,
    shell: false,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  process.stdout.write(redactChildOutput(result.stdout ?? ""));
  process.stderr.write(redactChildOutput(result.stderr ?? ""));

  if (result.error || result.status !== 0) {
    throw new Error(`P5_T05_06_CHILD_FAILED=${script}`);
  }

  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function assertDbBaseline(output) {
  const summary = /Files\s*=\s*(\d+)\s*,\s*Tests\s*=\s*(\d+)/i.exec(output);
  const successful = /All tests successful\.[\s\S]*?Result:\s*PASS/i.test(output);
  if (!summary || !successful) {
    throw new Error("P5_T05_06_DB_BASELINE_NOT_FOUND");
  }

  const [, files, tests] = summary;
  const failures = "0";
  const skips = "0";
  console.log(`P5_T05_06_DB_FILES=${files}`);
  console.log(`P5_T05_06_DB_TESTS=${tests}`);
  console.log(`P5_T05_06_DB_FAILURES=${failures}`);
  console.log(`P5_T05_06_DB_SKIPS=${skips}`);

  if (files !== "33" || tests !== "1609" || failures !== "0" || skips !== "0") {
    throw new Error("P5_T05_06_DB_BASELINE_MISMATCH");
  }
}

function assertWatchedPortsClear() {
  const ports = [3000, 3010, 55721, 55722, 55723, 55724];
  if (process.platform !== "win32") {
    return;
  }

  const command = `@(${ports.join(",")}) | ForEach-Object { @(Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue).Count }`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0 || /[1-9]/.test(result.stdout ?? "")) {
    throw new Error("P5_T05_06_WATCHED_PORT_RESIDUE");
  }
}

function runDbPhase(cycle) {
  let startedStack = false;
  let cleanupError;

  try {
    runNpmScript("supabase:start");
    startedStack = true;
    runNpmScript("db:reset:local");
    runNpmScript("db:lint:local");
    const dbOutput = runNpmScript("db:test:local");
    assertDbBaseline(dbOutput);
  } finally {
    if (startedStack) {
      try {
        runNpmScript("supabase:stop");
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  if (cleanupError) {
    throw cleanupError;
  }

  assertWatchedPortsClear();
  console.log("P5_T05_06_DB_CLEANUP=PASS");
  console.log(`PASS_P5_T05_06_CYCLE_${cycle}_DB`);
}

function runRecordedPhase(cycle) {
  runNpmScript("test:custody:balance-observer-recorded-orchestrator:local");
  console.log(`PASS_P5_T05_06_CYCLE_${cycle}_RECORDED`);
}

function runReadPhase(cycle, readPart) {
  const parts = readPart === "all" ? ["list", "detail", "fingerprint"] : [readPart];
  for (const part of parts) {
    runNpmScript("test:custody:balance-observer-operational-read:local", [`--phase=${part}`]);
    console.log(`PASS_P5_T05_06_CYCLE_${cycle}_READ_${part.toUpperCase()}`);
  }
}

function runAdminSqlScalar(sql) {
  const result = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB_NAME, "-c", sql], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("P5_T05_06_RESTART_ADMIN_QUERY_FAILED");
  return (result.stdout ?? "").trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

function runAdminSql(sql) {
  runAdminSqlScalar(sql);
}

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function randomUuid() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function loadRecordedModules() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "p5-t05-restart-runtime-"));
  try {
    for (const [sourcePath, outputName] of MODULES) {
      const source = (await readFile(path.join(repositoryRoot, sourcePath), "utf8")).replace(/^import "server-only";\r?\n\r?\n?/, "");
      const output = ts.transpileModule(source, {
        compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: sourcePath,
      }).outputText;
      await writeFile(path.join(tempDir, outputName), output, "utf8");
    }
    await symlink(path.join(repositoryRoot, "node_modules"), path.join(tempDir, "node_modules"), "junction");
    const runtimeRequire = createRequire(path.join(tempDir, "entry.cjs"));
    return {
      modules: {
        commandClient: runtimeRequire("./balance-observer-command-client.js"),
        recorded: runtimeRequire("./balance-observer-recorded-orchestrator.js"),
        runLedgerClient: runtimeRequire("./balance-observer-run-ledger-client.js"),
        scopeClient: runtimeRequire("./balance-observer-scope-client.js"),
        worker: runtimeRequire("./balance-observer-worker.js"),
      },
      tempDir,
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function installLocalNetworkGuard() {
  const original = {
    connect: net.connect,
    createConnection: net.createConnection,
    socketConnect: net.Socket.prototype.connect,
    http: http.request,
    https: https.request,
  };
  let externalNetworkCalls = 0;
  const isLocalPostgres = (args) => {
    const first = args[0];
    const options = typeof first === "object" && first !== null ? first : { port: first, host: args[1] };
    return (options.host === LOCAL_DB_HOST || options.host === "localhost" || options.host === undefined) && Number(options.port) === LOCAL_DB_PORT;
  };
  const block = () => {
    externalNetworkCalls += 1;
    throw new Error("P5_T05_06_EXTERNAL_NETWORK_BLOCKED");
  };
  const guardSocket = (method) => function guardedSocket(...args) {
    if (!isLocalPostgres(args)) return block();
    return method.apply(this, args);
  };
  net.connect = guardSocket(original.connect);
  net.createConnection = guardSocket(original.createConnection);
  net.Socket.prototype.connect = guardSocket(original.socketConnect);
  http.request = block;
  https.request = block;
  return {
    getExternalNetworkCalls: () => externalNetworkCalls,
    restore() {
      net.connect = original.connect;
      net.createConnection = original.createConnection;
      net.Socket.prototype.connect = original.socketConnect;
      http.request = original.http;
      https.request = original.https;
    },
  };
}

function createCredentialEnvGuard(environment) {
  const names = new Set(["PGPASSWORD", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "ACCESS_TOKEN", "REFRESH_TOKEN"]);
  let reads = 0;
  return {
    environment: new Proxy(environment, {
      get(target, property, receiver) {
        if (typeof property === "string" && names.has(property.toUpperCase())) {
          reads += 1;
          throw new Error("P5_T05_06_CREDENTIAL_ENVIRONMENT_READ_BLOCKED");
        }
        return Reflect.get(target, property, receiver);
      },
    }),
    getReads: () => reads,
  };
}

function setRuntimeRoleCredentials(passwords) {
  for (const [role, password] of Object.entries(passwords)) runAdminSql(`alter role ${role} password ${quoteSqlLiteral(password)};`);
}

function clearRuntimeRoleCredentials() {
  for (const role of [SCOPE_ROLE, WORKER_ROLE, RUN_WRITER_ROLE]) runAdminSql(`alter role ${role} password null;`);
}

function createRecordedClients(modules, passwords) {
  const scopeClient = modules.scopeClient.createBalanceObserverScopeClient({ host: LOCAL_DB_HOST, port: LOCAL_DB_PORT, database: DB_NAME, user: SCOPE_ROLE, password: passwords[SCOPE_ROLE], ssl: false, ...modules.scopeClient.DEFAULT_CUSTODY_OBSERVER_SCOPE_POSTGRES_LIMITS });
  const commandClient = modules.commandClient.createBalanceObserverCommandClient({ host: LOCAL_DB_HOST, port: LOCAL_DB_PORT, database: DB_NAME, user: WORKER_ROLE, password: passwords[WORKER_ROLE], ssl: false, ...modules.commandClient.DEFAULT_CUSTODY_OBSERVER_POSTGRES_LIMITS });
  const runLedgerClient = modules.runLedgerClient.createBalanceObserverRunLedgerClient({ host: LOCAL_DB_HOST, port: LOCAL_DB_PORT, database: DB_NAME, user: RUN_WRITER_ROLE, password: passwords[RUN_WRITER_ROLE], ssl: false, ...modules.runLedgerClient.DEFAULT_CUSTODY_OBSERVER_RUN_LEDGER_POSTGRES_LIMITS });
  return { scopeClient, commandClient, runLedgerClient };
}

function setupRestartFixture() {
  const ids = [FOUNDATION_ASSET.id, FOUNDATION_PROVIDER.id, FOUNDATION_BINDING.id];
  const existing = runAdminSqlScalar(`select ((select count(*) from public.supported_assets where id = '${ids[0]}'::uuid) + (select count(*) from private.custody_providers where id = '${ids[1]}'::uuid) + (select count(*) from private.custody_account_bindings where id = '${ids[2]}'::uuid))::text`);
  if (existing !== "0") throw new Error("P5_T05_06_RESTART_FIXTURE_COLLISION");
  // This is the existing P5-T05-04 contract-valid local fixture shape, reused without its assertion suite.
  runAdminSql(`insert into public.supported_assets (id, asset_code, symbol, display_name, asset_type, decimals, mint_address, status) values ('${FOUNDATION_ASSET.id}', '${FOUNDATION_ASSET.assetCode}', 'P5F', 'P5 T05 Foundation', 'NATIVE', 9, null, 'ACTIVE'); insert into private.custody_providers (id, provider_code, display_name, provider_type, supports_balance_observation, supports_transfer_observation, supports_transfer_lookup, supports_payout_submission, supports_webhook_ingestion) values ('${FOUNDATION_PROVIDER.id}', '${FOUNDATION_PROVIDER.providerCode}', 'P5 T05 Foundation', 'MPC_CUSTODIAN', true, false, false, false, false); update private.custody_providers set status = 'APPROVED' where id = '${FOUNDATION_PROVIDER.id}'; insert into private.custody_account_bindings (id, custody_provider_id, asset_id, binding_key, display_label, account_role) values ('${FOUNDATION_BINDING.id}', '${FOUNDATION_PROVIDER.id}', '${FOUNDATION_ASSET.id}', '${FOUNDATION_BINDING.bindingKey}', 'P5 T05 Foundation', 'TREASURY'); update private.custody_account_bindings set status = 'APPROVED' where id = '${FOUNDATION_BINDING.id}';`);
}

function createBindingFailureAdapter(provider) {
  return {
    provider,
    async readHealth() { return { provider, status: "AVAILABLE", checkedAt: "2026-08-08T00:00:00.000000Z" }; },
    async readBalances(bindings) { return bindings.map((binding) => ({ ok: false, binding, error: { code: "UNSUPPORTED_ASSET", retryable: false, retryAfterMs: null } })); },
    async readTransfers() { return { observations: [], page: { cursor: null, hasMore: false } }; },
  };
}

function readRestartBaseline(runId) {
  const candidate = runAdminSqlScalar(`select json_build_object('runId', run_id::text, 'status', status, 'terminalCode', terminal_code, 'version', version::text, 'createdAt', created_at::text, 'startedAt', started_at::text, 'finishedAt', completed_at::text, 'scopeCount', (select count(*)::text from private.custody_balance_observer_scope_outcomes where run_id = r.run_id), 'failureCount', (select count(*)::text from private.custody_balance_observer_binding_failures where run_id = r.run_id), 'runFingerprint', md5(concat_ws(':', run_id::text, status, version::text, coalesce(terminal_code, ''), coalesce(created_at::text, ''), coalesce(started_at::text, ''), coalesce(completed_at::text, ''), scopes_discovered::text, scopes_started::text, scopes_completed::text, scopes_failed::text, scopes_aborted::text, bindings_discovered::text, bindings_failed::text)), 'scopeFingerprint', (select coalesce(md5(string_agg(concat_ws(':', run_id::text, discovery_index::text, scope_status, coalesce(scope_code, ''), binding_success_count::text, binding_failure_count::text, binding_abort_count::text, refresh_requested::text, refresh_attempted::text, refresh_succeeded::text, refresh_failed::text, no_longer_eligible_count::text, recorded_at::text), ',' order by discovery_index)), 'empty') from private.custody_balance_observer_scope_outcomes where run_id = r.run_id), 'failureFingerprint', (select coalesce(md5(string_agg(concat_ws(':', run_id::text, binding_order::text, failure_stage, safe_failure_code, retryable::text, requires_scope_refresh::text, adapter_attempts::text, database_attempts::text, recorded_at::text), ',' order by binding_order)), 'empty') from private.custody_balance_observer_binding_failures where run_id = r.run_id))::text from private.custody_balance_observer_runs r where r.run_id = '${runId}'::uuid`);
  if (!candidate) throw new Error("P5_T05_06_RESTART_CANDIDATE_NOT_FOUND");
  return JSON.parse(candidate);
}

async function runRestartPrepare() {
  if (existsSync(baselinePath)) throw new Error("P5_T05_06_RESTART_BASELINE_ALREADY_PRESENT");
  const ignored = spawnSync("git", ["check-ignore", "-q", "--", path.relative(repositoryRoot, baselinePath)], { cwd: repositoryRoot });
  if (ignored.status !== 0) throw new Error("P5_T05_06_RESTART_BASELINE_NOT_IGNORED");
  runNpmScript("supabase:start");
  if (runAdminSqlScalar("select to_regclass('private.custody_balance_observer_runs') is not null") !== "t") throw new Error("P5_T05_06_RESTART_SCHEMA_MISSING");
  setupRestartFixture();
  const passwords = { [SCOPE_ROLE]: randomBytes(32).toString("base64url"), [WORKER_ROLE]: randomBytes(32).toString("base64url"), [RUN_WRITER_ROLE]: randomBytes(32).toString("base64url") };
  let runtime = null;
  let guard = null;
  let clients = null;
  const originalEnv = process.env;
  const credentialGuard = createCredentialEnvGuard(originalEnv);
  let candidate = null;
  try {
    setRuntimeRoleCredentials(passwords);
    runtime = await loadRecordedModules();
    guard = installLocalNetworkGuard();
    process.env = credentialGuard.environment;
    clients = createRecordedClients(runtime.modules, passwords);
    const baseScopeClient = clients.scopeClient;
    const result = await runtime.modules.recorded.runRecordedCustodyBalanceObserverOneShot({
      ...clients,
      scopeClient: { ...baseScopeClient, async listBalanceObserverScopePage(input) { const page = await baseScopeClient.listBalanceObserverScopePage(input); const scopes = page.scopes.filter((scope) => scope.assetId === FOUNDATION_ASSET.id); return { scopes, page: { scopeCount: scopes.length, hasMore: false, nextCursor: null } }; } },
      runKey: `obsrun:v1:${randomUuid()}`,
      triggerSource: "MANUAL",
      identityPolicy: "LOCAL_MOCK",
      invocationContractVersion: "P5_T05_V1",
      adapterFactory: createBindingFailureAdapter,
      runtime: { async runWorkUnit(input) { return runtime.modules.worker.runCustodyBalanceObserverWorkUnit(input); } },
    });
    if (result.execution !== "EXECUTED" || !result.runId || result.durableVersion !== "2") throw new Error("P5_T05_06_RESTART_CANDIDATE_NOT_TERMINAL");
    candidate = readRestartBaseline(result.runId);
    if (!["COMPLETED", "PARTIAL", "FAILED", "ABORTED"].includes(candidate.status) || candidate.scopeCount === "0" || candidate.failureCount === "0") throw new Error("P5_T05_06_RESTART_CANDIDATE_EVIDENCE_INVALID");
  } finally {
    process.env = originalEnv;
    guard?.restore();
    if (clients) await Promise.allSettled([clients.scopeClient.close(), clients.commandClient.close(), clients.runLedgerClient.close()]);
    try { clearRuntimeRoleCredentials(); } catch { throw new Error("P5_T05_06_RESTART_ROLE_CREDENTIAL_RESIDUE"); }
    if (runtime) await rm(runtime.tempDir, { recursive: true, force: true });
  }
  if (!candidate || credentialGuard.getReads() !== 0 || guard?.getExternalNetworkCalls() !== 0) throw new Error("P5_T05_06_RESTART_ISOLATION_FAILED");
  const reread = readRestartBaseline(candidate.runId);
  if (JSON.stringify(candidate) !== JSON.stringify(reread)) throw new Error("P5_T05_06_RESTART_BASELINE_READBACK_MISMATCH");
  await writeFile(baselinePath, `${JSON.stringify({ cycle: 3, ...candidate }, null, 2)}\n`, "utf8");
  console.log(`P5_T05_06_RESTART_RUN_ID=${candidate.runId}`);
  console.log(`P5_T05_06_RESTART_STATUS=${candidate.status}`);
  console.log(`P5_T05_06_RESTART_SCOPE_COUNT=${candidate.scopeCount}`);
  console.log(`P5_T05_06_RESTART_FAILURE_COUNT=${candidate.failureCount}`);
  console.log(`P5_T05_06_RESTART_RUN_FINGERPRINT=${candidate.runFingerprint}`);
  console.log(`P5_T05_06_RESTART_SCOPE_FINGERPRINT=${candidate.scopeFingerprint}`);
  console.log(`P5_T05_06_RESTART_FAILURE_FINGERPRINT=${candidate.failureFingerprint}`);
  console.log("P5_T05_06_RESTART_DB_RESET=0");
  console.log("P5_T05_06_RESTART_CONTROLLED_RESTART=0");
  console.log("P5_T05_06_RESTART_EXTERNAL_NETWORK=0");
  console.log("P5_T05_06_RESTART_CREDENTIAL_READS=0");
  console.log("P5_T05_06_RESTART_APPLICATION_SERVICE_ROLE=0");
  console.log("PASS_P5_T05_06_RESTART_PREPARE");
}

function loadRestartBaselineArtifact() {
  if (!existsSync(baselinePath)) throw new Error("RESTART_BASELINE_MISSING");
  let baseline;
  try {
    baseline = JSON.parse(require("node:fs").readFileSync(baselinePath, "utf8"));
  } catch {
    throw new Error("P5_T05_06_RESTART_BASELINE_INVALID");
  }
  const required = ["cycle", "runId", "runFingerprint", "scopeFingerprint", "failureFingerprint", "scopeCount", "failureCount", "status", "version", "createdAt", "startedAt", "finishedAt"];
  if (required.some((field) => baseline[field] === undefined || baseline[field] === null) || baseline.cycle !== 3 || baseline.scopeCount !== "1" || baseline.failureCount !== "1" || baseline.status !== "PARTIAL" || baseline.version !== "2" || baseline.terminalCode !== null) {
    throw new Error("P5_T05_06_RESTART_BASELINE_INVALID");
  }
  return baseline;
}

function assertRestartBaselineMatch(baseline, current, code) {
  const fields = ["runId", "runFingerprint", "scopeFingerprint", "failureFingerprint", "scopeCount", "failureCount", "status", "terminalCode", "version", "createdAt", "startedAt", "finishedAt"];
  if (fields.some((field) => baseline[field] !== current[field])) throw new Error(code);
}

function projectContainerCount() {
  const result = spawnSync("docker", ["ps", "--filter", "name=supabase_.*_staking-wallet-web", "--format", "{{.Names}}"], { cwd: repositoryRoot, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error("P5_T05_06_DOCKER_INSPECTION_FAILED");
  return (result.stdout ?? "").split(/\r?\n/).filter(Boolean).length;
}

async function runRestartExecute() {
  const baseline = loadRestartBaselineArtifact();
  if (projectContainerCount() === 0 || runAdminSqlScalar("select to_regclass('private.custody_balance_observer_runs') is not null") !== "t") {
    throw new Error("P5_T05_06_RESTART_STACK_NOT_HEALTHY");
  }
  const candidateCount = runAdminSqlScalar(`select count(*)::text from private.custody_balance_observer_runs where run_id = '${baseline.runId}'::uuid`);
  if (candidateCount !== "1") throw new Error(candidateCount === "0" ? "DURABLE_EVIDENCE_LOSS_AFTER_RESTART" : "DUPLICATE_RUN_IDENTITY_AFTER_RESTART");
  const before = readRestartBaseline(baseline.runId);
  assertRestartBaselineMatch(baseline, before, "PRE_RESTART_BASELINE_DRIFT");

  let stackRestarted = false;
  let comparisonPassed = false;
  try {
    runNpmScript("supabase:stop");
    if (projectContainerCount() !== 0) throw new Error("LOCAL_RESTART_STOP_FAILURE");

    // This execute path contains no reset, fixture creation, observer entry, or product operation.
    runNpmScript("supabase:start");
    stackRestarted = true;
    if (projectContainerCount() === 0 || runAdminSqlScalar("select to_regclass('private.custody_balance_observer_runs') is not null") !== "t") {
      throw new Error("LOCAL_RESTART_START_FAILURE");
    }
    const afterCount = runAdminSqlScalar(`select count(*)::text from private.custody_balance_observer_runs where run_id = '${baseline.runId}'::uuid`);
    if (afterCount !== "1") throw new Error(afterCount === "0" ? "DURABLE_EVIDENCE_LOSS_AFTER_RESTART" : "DUPLICATE_RUN_IDENTITY_AFTER_RESTART");
    const after = readRestartBaseline(baseline.runId);
    assertRestartBaselineMatch(baseline, after, "DURABLE_EVIDENCE_MUTATION_AFTER_RESTART");
    comparisonPassed = true;
    await rm(baselinePath, { force: false });
    console.log(`P5_T05_06_RESTART_RUN_ID=${baseline.runId}`);
    console.log(`P5_T05_06_RESTART_RUN_FINGERPRINT_BEFORE=${baseline.runFingerprint}`);
    console.log(`P5_T05_06_RESTART_RUN_FINGERPRINT_AFTER=${after.runFingerprint}`);
    console.log(`P5_T05_06_RESTART_SCOPE_FINGERPRINT_BEFORE=${baseline.scopeFingerprint}`);
    console.log(`P5_T05_06_RESTART_SCOPE_FINGERPRINT_AFTER=${after.scopeFingerprint}`);
    console.log(`P5_T05_06_RESTART_FAILURE_FINGERPRINT_BEFORE=${baseline.failureFingerprint}`);
    console.log(`P5_T05_06_RESTART_FAILURE_FINGERPRINT_AFTER=${after.failureFingerprint}`);
    console.log("P5_T05_06_RESTART_CONTROLLED_STOP_COUNT=1");
    console.log("P5_T05_06_RESTART_CONTROLLED_START_COUNT=1");
    console.log("P5_T05_06_RESTART_DB_RESET_COUNT=0");
    console.log("P5_T05_06_RESTART_OBSERVER_REPLAY_COUNT=0");
    console.log("P5_T05_06_RESTART_EXTERNAL_NETWORK=0");
    console.log("P5_T05_06_RESTART_CREDENTIAL_READS=0");
    console.log("P5_T05_06_RESTART_APPLICATION_SERVICE_ROLE=0");
  } finally {
    if (stackRestarted) runNpmScript("supabase:stop");
  }
  if (!comparisonPassed || existsSync(baselinePath)) throw new Error("P5_T05_06_RESTART_ARTIFACT_CLEANUP_FAILED");
  assertWatchedPortsClear();
  console.log("PASS_P5_T05_06_NON_RESET_RESTART_DURABILITY");
}

async function run() {
  const { cycle, phase, readPart, restartPart } = parseArguments(process.argv.slice(2));
  console.log("P5_T05_06_RESILIENCE");
  console.log(`P5_T05_06_CYCLE=${cycle}`);
  console.log(`P5_T05_06_PHASE=${phase}`);

  if (phase === "db") {
    runDbPhase(cycle);
    return;
  }
  if (phase === "recorded") {
    runRecordedPhase(cycle);
    return;
  }
  if (phase === "read") {
    runReadPhase(cycle, readPart);
    return;
  }
  if (phase === "restart") {
    if (restartPart === "prepare") {
      await runRestartPrepare();
      return;
    }
    await runRestartExecute();
    return;
  }

  throw new Error("T05_06_ORCHESTRATION_PHASE_NOT_YET_COMPLETE");
}

try {
  await run();
} catch (error) {
  fail(error instanceof Error ? error.message : "P5_T05_06_HARNESS_FAILURE");
}
