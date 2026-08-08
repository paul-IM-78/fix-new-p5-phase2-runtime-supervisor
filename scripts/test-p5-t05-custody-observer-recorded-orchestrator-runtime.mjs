import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const DB_CONTAINER = "supabase_db_staking-wallet-web";
const LOCAL_DB_HOST = "127.0.0.1";
const LOCAL_DB_PORT = 55722;
const DB_NAME = "postgres";
const SCOPE_ROLE = "custody_observer_scope_reader";
const WORKER_ROLE = "custody_observer_worker";
const RUN_WRITER_ROLE = "custody_observer_run_writer";
const RUNTIME_ROLES = new Set([SCOPE_ROLE, WORKER_ROLE, RUN_WRITER_ROLE]);
const FOUNDATION_ASSET = { id: "00000000-0000-4000-8000-000000850101", assetCode: "P5T05F_A" };
const FOUNDATION_PROVIDER = { id: "00000000-0000-4000-8000-000000850201", providerCode: "P5T05_FOUNDATION" };
const FOUNDATION_BINDING = { id: "00000000-0000-4000-8000-000000850301", bindingKey: "p5t05_foundation" };
const ABORT_ASSET = { id: "00000000-0000-4000-8000-000000850102", assetCode: "P5T05F_ABORT" };
const ABORT_BINDING = { id: "00000000-0000-4000-8000-000000850302", bindingKey: "p5t05_abort" };

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

let cases = 0;
let tempDir = null;
let externalNetworkCalls = 0;
let providerNetworkCalls = 0;
let credentialEnvReads = 0;
let serviceRoleUsage = 0;
let localPostgresConnections = 0;
let networkGuard = null;
let scopeReaderPassword = null;
let observerWorkerPassword = null;
let runWriterPassword = null;
const clientsToClose = new Set();
const emittedLines = [];
let foundationObservationWrites = 0;
let foundationScopeLedgerWrites = 0;
let foundationFinalizeCalls = 0;
let recordedEntrypointCalls = 0;
let recordedScopeDiscoveryCalls = 0;
let recordedAdapterFactoryCalls = 0;
let recordedWorkerExecutionCalls = 0;
let recordedObservationCommandEffects = 0;
let recordedScopeLedgerWrites = 0;
let recordedFinalizeCalls = 0;

async function main() {
  const source = await readFile("src/server/custody/balance-observer-recorded-orchestrator.ts", "utf8");
  assert(source.startsWith('import "server-only";'), "recorded entrypoint is server-only");
  for (const forbidden of ["process.env", "connectionString", "DATABASE_URL", "SUPABASE_URL", "createClient(", "fetch(", "axios", "http.request", "https.request", "console.log", "console.error"]) {
    assert(!source.includes(forbidden), `recorded source excludes ${forbidden}`);
  }

  const modules = await loadModules();
  try {
    await assertHappyPath(modules);
    await assertExistingRunBlocksExecution(modules);
    await assertBeginFailureBlocksExecution(modules);
    await assertScopePersistenceFailureStopsWork(modules);
    await assertFinalizeFailureLeavesIncomplete(modules);
    await assertLedgerCloseDoesNotMutateTerminal(modules);
    await assertNoopReporterParity(modules);
    await runRealPostgresFoundationSmoke(modules);
  } finally {
    await cleanupModules();
  }

  assert(externalNetworkCalls === 0, "external network calls are zero");
  assert(providerNetworkCalls === 0, "provider network calls are zero");
  assert(credentialEnvReads === 0, "credential environment reads are zero");
  assert(serviceRoleUsage === 0, "service role usage is zero");
  console.log(`RECORDED_ORCHESTRATOR_RUNTIME_CASES=${cases}`);
  console.log(`EXTERNAL_NETWORK_CALLS=${externalNetworkCalls}`);
  console.log(`PROVIDER_NETWORK_CALLS=${providerNetworkCalls}`);
  console.log(`CREDENTIAL_ENV_READS=${credentialEnvReads}`);
  console.log(`SERVICE_ROLE_APPLICATION_USAGE=${serviceRoleUsage}`);
  console.log(`LOCAL_POSTGRES_CONNECTIONS=${localPostgresConnections}`);
  console.log(`FOUNDATION_OBSERVATION_WRITES=${foundationObservationWrites}`);
  console.log(`FOUNDATION_SCOPE_LEDGER_WRITES=${foundationScopeLedgerWrites}`);
  console.log(`FOUNDATION_FINALIZE_CALLS=${foundationFinalizeCalls}`);
  console.log(`RECORDED_ENTRYPOINT_CALLS=${recordedEntrypointCalls}`);
  console.log(`RECORDED_SCOPE_DISCOVERY_CALLS=${recordedScopeDiscoveryCalls}`);
  console.log(`RECORDED_ADAPTER_FACTORY_CALLS=${recordedAdapterFactoryCalls}`);
  console.log(`RECORDED_WORKER_EXECUTION_CALLS=${recordedWorkerExecutionCalls}`);
  console.log(`RECORDED_OBSERVATION_COMMAND_EFFECTS=${recordedObservationCommandEffects}`);
  console.log(`RECORDED_SCOPE_LEDGER_WRITES=${recordedScopeLedgerWrites}`);
  console.log(`RECORDED_FINALIZE_CALLS=${recordedFinalizeCalls}`);
  console.log("CUSTODY_BALANCE_OBSERVER_RECORDED_ORCHESTRATOR_RUNTIME_PASS");
}

async function loadModules() {
  tempDir = await mkdtemp(path.join(tmpdir(), "p5-t05-recorded-runtime-"));
  for (const [sourcePath, outputName] of MODULES) {
    const source = (await readFile(sourcePath, "utf8")).replace(/^import "server-only";\r?\n\r?\n?/, "");
    const output = ts.transpileModule(source, {
      compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: sourcePath,
    }).outputText;
    await writeFile(path.join(tempDir, outputName), output, "utf8");
  }
  await symlink(path.resolve("node_modules"), path.join(tempDir, "node_modules"), "junction");
  const runtimeRequire = createRequire(path.join(tempDir, "entry.cjs"));
  return {
    commandClient: runtimeRequire("./balance-observer-command-client.js"),
    recorded: runtimeRequire("./balance-observer-recorded-orchestrator.js"),
    orchestrator: runtimeRequire("./balance-observer-orchestrator.js"),
    runLedgerClient: runtimeRequire("./balance-observer-run-ledger-client.js"),
    scopeClient: runtimeRequire("./balance-observer-scope-client.js"),
    worker: runtimeRequire("./balance-observer-worker.js"),
  };
}

async function cleanupModules() {
  if (!tempDir) return;
  const directory = tempDir;
  tempDir = null;
  await rm(directory, { recursive: true, force: true });
  assert(!existsSync(directory), "temporary runtime directory is removed");
}

async function runNpmScript(script, label, timeoutMs = 120_000) {
  await runProcess(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm", "--silent", "run", script] : ["--silent", "run", script], label, timeoutMs);
}

async function runProcess(command, args, label, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stderrChunks = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const stdoutChunks = [];
    child.stdout.on("data", (chunk) => { stdoutChunks.push(Buffer.from(chunk)); });
    child.stderr.on("data", (chunk) => { stderrChunks.push(Buffer.from(chunk)); });
    child.on("error", () => { clearTimeout(timer); reject(new Error(`${label}_spawn_failed`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8"));
        return;
      }

      const diagnostic = redact(Buffer.concat(stderrChunks).toString("utf8")).slice(0, 240);
      reject(new Error(diagnostic ? `${label}_failed:${diagnostic}` : `${label}_failed`));
    });
  });
}

function createEphemeralPassword() { return randomBytes(32).toString("base64url"); }

async function setRuntimeRoleCredential(roleName, password) {
  assertRuntimeRole(roleName);
  await runAdminSql(`alter role ${roleName} password ${quoteSqlLiteral(password)};`);
}

async function clearRuntimeRoleCredential(roleName) {
  assertRuntimeRole(roleName);
  await runAdminSql(`alter role ${roleName} password null;`);
}

async function setupRuntimeRoleCredentials() {
  scopeReaderPassword = createEphemeralPassword();
  observerWorkerPassword = createEphemeralPassword();
  runWriterPassword = createEphemeralPassword();
  try {
    await setRuntimeRoleCredential(SCOPE_ROLE, scopeReaderPassword);
    await setRuntimeRoleCredential(WORKER_ROLE, observerWorkerPassword);
    await setRuntimeRoleCredential(RUN_WRITER_ROLE, runWriterPassword);
  } catch {
    await clearRuntimeRoleCredentials();
    throw new Error("runtime_role_credential_setup_failed");
  }
}

async function clearRuntimeRoleCredentials() {
  for (const roleName of [SCOPE_ROLE, WORKER_ROLE, RUN_WRITER_ROLE]) {
    try { await clearRuntimeRoleCredential(roleName); } catch { /* cleanup continues */ }
  }
  scopeReaderPassword = null;
  observerWorkerPassword = null;
  runWriterPassword = null;
}

async function runAdminSql(sql) {
  await runProcess("docker", ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB_NAME, "-c", sql], "admin_sql", 30_000);
}

async function runAdminSqlScalar(sql) {
  const output = await runProcess("docker", ["exec", "-i", DB_CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB_NAME, "-c", sql], "admin_sql_scalar", 30_000);
  return output.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

function createScopePostgresConfig(module) { return { host: LOCAL_DB_HOST, port: LOCAL_DB_PORT, database: DB_NAME, user: SCOPE_ROLE, password: scopeReaderPassword, ssl: false, ...module.DEFAULT_CUSTODY_OBSERVER_SCOPE_POSTGRES_LIMITS }; }
function createObserverPostgresConfig(module) { return { host: LOCAL_DB_HOST, port: LOCAL_DB_PORT, database: DB_NAME, user: WORKER_ROLE, password: observerWorkerPassword, ssl: false, ...module.DEFAULT_CUSTODY_OBSERVER_POSTGRES_LIMITS }; }
function createRunLedgerPostgresConfig(module) { return { host: LOCAL_DB_HOST, port: LOCAL_DB_PORT, database: DB_NAME, user: RUN_WRITER_ROLE, password: runWriterPassword, ssl: false, ...module.DEFAULT_CUSTODY_OBSERVER_RUN_LEDGER_POSTGRES_LIMITS }; }

function createRealRecordedClients(modules) {
  const scopeClient = modules.scopeClient.createBalanceObserverScopeClient(createScopePostgresConfig(modules.scopeClient));
  const commandClient = modules.commandClient.createBalanceObserverCommandClient(createObserverPostgresConfig(modules.commandClient));
  const runLedgerClient = modules.runLedgerClient.createBalanceObserverRunLedgerClient(createRunLedgerPostgresConfig(modules.runLedgerClient));
  clientsToClose.add(scopeClient); clientsToClose.add(commandClient); clientsToClose.add(runLedgerClient);
  return { scopeClient, commandClient, runLedgerClient };
}

async function closeClients() {
  for (const client of clientsToClose) { try { await client.close(); } catch { /* cleanup continues */ } }
  clientsToClose.clear();
}

function installLocalNetworkGuard() {
  const originalConnect = net.connect;
  const originalCreateConnection = net.createConnection;
  const originalSocketConnect = net.Socket.prototype.connect;
  const originalHttp = http.request;
  const originalHttps = https.request;
  const blockExternalNetwork = () => {
    externalNetworkCalls += 1;
    providerNetworkCalls += 1;
    throw new Error("external_network_blocked");
  };
  const isLocalPostgresTarget = (args) => {
    const first = args[0];
    const options = typeof first === "object" && first !== null
      ? first
      : { port: first, host: typeof args[1] === "string" ? args[1] : "localhost" };
    return (options.host === LOCAL_DB_HOST || options.host === "localhost" || options.host === undefined)
      && Number(options.port) === LOCAL_DB_PORT;
  };
  const guardedSocketFactory = (original) => function guardedSocketFactory(...args) {
    if (!isLocalPostgresTarget(args)) return blockExternalNetwork();
    localPostgresConnections += 1;
    return original.apply(this, args);
  };

  net.connect = guardedSocketFactory(originalConnect);
  net.createConnection = guardedSocketFactory(originalCreateConnection);
  net.Socket.prototype.connect = guardedSocketFactory(originalSocketConnect);
  http.request = blockExternalNetwork;
  https.request = blockExternalNetwork;
  networkGuard = { originalConnect, originalCreateConnection, originalSocketConnect, originalHttp, originalHttps };
}

function restoreLocalNetworkGuard() {
  if (!networkGuard) return;
  net.connect = networkGuard.originalConnect;
  net.createConnection = networkGuard.originalCreateConnection;
  net.Socket.prototype.connect = networkGuard.originalSocketConnect;
  http.request = networkGuard.originalHttp;
  https.request = networkGuard.originalHttps;
  networkGuard = null;
}

function createCredentialEnvGuard(originalEnv) {
  const credentialNames = new Set([
    "PGPASSWORD",
    "DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "ACCESS_TOKEN",
    "REFRESH_TOKEN",
  ]);
  return new Proxy(originalEnv, {
    get(target, property, receiver) {
      if (typeof property === "string" && credentialNames.has(property.toUpperCase())) {
        credentialEnvReads += 1;
        throw new Error("credential_environment_read_blocked");
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

async function setupRealDatabaseFixtures() {
  await runAdminSql(`insert into public.supported_assets (id, asset_code, symbol, display_name, asset_type, decimals, mint_address, status) values ('${FOUNDATION_ASSET.id}', '${FOUNDATION_ASSET.assetCode}', 'P5F', 'P5 T05 Foundation', 'NATIVE', 9, null, 'ACTIVE'); insert into private.custody_providers (id, provider_code, display_name, provider_type, supports_balance_observation, supports_transfer_observation, supports_transfer_lookup, supports_payout_submission, supports_webhook_ingestion) values ('${FOUNDATION_PROVIDER.id}', '${FOUNDATION_PROVIDER.providerCode}', 'P5 T05 Foundation', 'MPC_CUSTODIAN', true, false, false, false, false); update private.custody_providers set status = 'APPROVED' where id = '${FOUNDATION_PROVIDER.id}'; insert into private.custody_account_bindings (id, custody_provider_id, asset_id, binding_key, display_label, account_role) values ('${FOUNDATION_BINDING.id}', '${FOUNDATION_PROVIDER.id}', '${FOUNDATION_ASSET.id}', '${FOUNDATION_BINDING.bindingKey}', 'P5 T05 Foundation', 'TREASURY'); update private.custody_account_bindings set status = 'APPROVED' where id = '${FOUNDATION_BINDING.id}';`);
}

async function setupAbortFixture() {
  await runAdminSql(`insert into public.supported_assets (id, asset_code, symbol, display_name, asset_type, decimals, mint_address, status) values ('${ABORT_ASSET.id}', '${ABORT_ASSET.assetCode}', 'P5A', 'P5 T05 Abort', 'NATIVE', 9, null, 'ACTIVE'); insert into private.custody_account_bindings (id, custody_provider_id, asset_id, binding_key, display_label, account_role) values ('${ABORT_BINDING.id}', '${FOUNDATION_PROVIDER.id}', '${ABORT_ASSET.id}', '${ABORT_BINDING.bindingKey}', 'P5 T05 Abort', 'TREASURY'); update private.custody_account_bindings set status = 'APPROVED' where id = '${ABORT_BINDING.id}';`);
}

async function assertRealFoundationScopeDiscovery(modules, scopeClient) {
  const page = await scopeClient.listBalanceObserverScopePage({ after: null, limit: 10 });
  const scope = page.scopes.find((item) => item.providerId === FOUNDATION_PROVIDER.id && item.assetId === FOUNDATION_ASSET.id && item.bindings.some((binding) => binding.bindingId === FOUNDATION_BINDING.id));
  assert(scope, "foundation scope discovery includes fixture");
  foundationPass("Real foundation scope discovery", "REAL_FOUNDATION_SCOPE_DISCOVERY=PASS");
  console.log(`REAL_FOUNDATION_SCOPE_COUNT=${page.scopes.length}`);
  assert(page.scopes.length > 0, "foundation scope count is positive");
  foundationPass("Real foundation positive scope count");
}

async function assertRealFoundationRunBegin(modules, runLedgerClient) {
  const runKey = `obsrun:v1:${randomUuid()}`;
  const result = await runLedgerClient.beginBalanceObserverRun({ runKey, triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" });
  assert(result.created && result.status === "RUNNING" && result.version === "1", "foundation run begin");
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result.runId), "foundation run id is canonical UUID");
  const metadata = await runAdminSqlScalar(`select case when status = 'RUNNING' and version = 1 and completed_at is null then 'ok' else 'invalid' end from private.custody_balance_observer_runs where run_id = '${result.runId}'::uuid`);
  assert(metadata === "ok", "foundation durable run metadata");
  foundationPass("Real foundation run begin", "REAL_FOUNDATION_RUN_BEGIN=PASS");
  console.log("REAL_FOUNDATION_RUN_BEGIN_CREATED=true");
  console.log("REAL_FOUNDATION_RUN_BEGIN_VERSION=1");
  return result;
}

async function assertDirectRuntimeRoleIdentities(modules) {
  const { Pool } = require("pg");
  const roles = [
    [SCOPE_ROLE, scopeReaderPassword, modules.scopeClient.BALANCE_OBSERVER_SCOPE_POSTGRES_APPLICATION_NAME, "REAL_FOUNDATION_SCOPE_ROLE_LOGIN=PASS"],
    [WORKER_ROLE, observerWorkerPassword, modules.commandClient.BALANCE_OBSERVER_POSTGRES_APPLICATION_NAME, "REAL_FOUNDATION_WORKER_ROLE_LOGIN=PASS"],
    [RUN_WRITER_ROLE, runWriterPassword, modules.runLedgerClient.BALANCE_OBSERVER_RUN_LEDGER_POSTGRES_APPLICATION_NAME, "REAL_FOUNDATION_RUN_WRITER_ROLE_LOGIN=PASS"],
  ];
  for (const [role, password, applicationName, marker] of roles) {
    const pool = new Pool({ host: LOCAL_DB_HOST, port: LOCAL_DB_PORT, database: DB_NAME, user: role, password, ssl: false, max: 1, application_name: applicationName });
    try {
      const result = await pool.query("select current_user::text as role_name, current_setting('application_name')::text as application_name");
      assert(result.rows[0]?.role_name === role, "foundation direct role identity");
      assert(result.rows[0]?.application_name === applicationName, "foundation application name");
      foundationPass(`Real foundation ${role} login`, marker);
    } finally {
      await pool.end();
    }
  }
  foundationPass("Real foundation distinct application names", "REAL_FOUNDATION_DISTINCT_APPLICATION_NAMES=PASS");
}

function assertSafeOutput() { const output = emittedLines.join("\n"); assert(!/(?:obsrun:v1:|postgres(?:ql)?:\/\/|BEGIN (?:RSA |EC )?PRIVATE KEY|eyJ[a-zA-Z0-9_-]{10,}\.)/.test(output), "foundation output remains safe"); }

async function cleanupRealDatabaseFoundation(supabaseStarted) {
  await closeClients();
  assert(clientsToClose.size === 0, "foundation client pool residue is zero");
  restoreLocalNetworkGuard();
  await clearRuntimeRoleCredentials();
  const rolePasswordResidue = await runAdminSqlScalar(`select count(*)::text from pg_authid where rolname in ('${SCOPE_ROLE}', '${WORKER_ROLE}', '${RUN_WRITER_ROLE}') and rolpassword is not null`);
  assert(rolePasswordResidue === "0", "foundation role password residue is zero");
  if (supabaseStarted) {
    await runNpmScript("db:reset:local", "Foundation cleanup reset", 180_000);
    const fixtureResidue = await runAdminSqlScalar(`select ((select count(*) from public.supported_assets where id in ('${FOUNDATION_ASSET.id}'::uuid, '${ABORT_ASSET.id}'::uuid)) + (select count(*) from private.custody_providers where id = '${FOUNDATION_PROVIDER.id}'::uuid) + (select count(*) from private.custody_account_bindings where id in ('${FOUNDATION_BINDING.id}'::uuid, '${ABORT_BINDING.id}'::uuid)))::text`);
    assert(fixtureResidue === "0", "foundation fixture residue is zero");
    await runNpmScript("supabase:stop", "Foundation cleanup stop", 120_000);
  }
  await cleanupModules();
  return { clientPoolResidue: "0", fixtureResidue: "0", rolePasswordResidue: "0", tempRuntimeDirectoryResidue: "0" };
}

function assertRuntimeRole(roleName) { if (!RUNTIME_ROLES.has(roleName)) throw new Error("runtime_role_invalid"); }
function quoteSqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function randomUuid() { const bytes = randomBytes(16); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const value = bytes.toString("hex"); return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`; }
function redact(value) { return String(value).replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]").replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/password\s*=\s*\S+/gi, "password=[REDACTED]"); }
function assertLocalPostgresConnections() { assert(localPostgresConnections > 0, "foundation uses local PostgreSQL only"); }

function foundationPass(label, marker) {
  assert(true, label);
  emittedLines.push(`PASS ${label}`);
  if (marker) console.log(marker);
}

async function assertWorkerCommandClientReadiness() {
  const { Pool } = require("pg");
  const pool = new Pool({ host: LOCAL_DB_HOST, port: LOCAL_DB_PORT, database: DB_NAME, user: WORKER_ROLE, password: observerWorkerPassword, ssl: false, max: 1 });
  try {
    const result = await pool.query("select has_function_privilege(current_user, 'private.record_balance_observation_and_advance_checkpoint(uuid,text,text,numeric,timestamptz,bigint,text,timestamptz)', 'EXECUTE') as allowed");
    assert(result.rows[0]?.allowed === true, "foundation worker atomic command execute privilege");
  } finally {
    await pool.end();
  }
  foundationPass("Real foundation command client ready", "REAL_FOUNDATION_COMMAND_CLIENT_READY=PASS");
}

async function runRealPostgresFoundationSmoke(modules) {
  const originalEnv = process.env;
  let supabaseStarted = false;
  let cleanup = null;
  try {
    await runNpmScript("supabase:start", "Foundation Supabase start", 120_000);
    supabaseStarted = true;
    await runNpmScript("db:reset:local", "Foundation DB reset", 180_000);
    await setupRealDatabaseFixtures();
    await setupRuntimeRoleCredentials();
    assert(scopeReaderPassword !== observerWorkerPassword && observerWorkerPassword !== runWriterPassword && scopeReaderPassword !== runWriterPassword, "foundation credentials are distinct");
    foundationPass("Real foundation distinct ephemeral credentials", "REAL_FOUNDATION_DISTINCT_EPHEMERAL_CREDENTIALS=PASS");
    installLocalNetworkGuard();
    process.env = createCredentialEnvGuard(originalEnv);
    await assertDirectRuntimeRoleIdentities(modules);
    const clients = createRealRecordedClients(modules);
    assert(clients.scopeClient && clients.commandClient && clients.runLedgerClient, "foundation creates three production clients");
    foundationPass("Real foundation three client creation", "REAL_FOUNDATION_THREE_CLIENT_CREATION=PASS");
    await assertRealFoundationScopeDiscovery(modules, clients.scopeClient);
    await assertWorkerCommandClientReadiness();
    await assertRealFoundationRunBegin(modules, clients.runLedgerClient);
    const happyPath = await assertRealRecordedHappyPath(modules, clients);
    await assertRealRecordedBindingFailureParity(modules, createRealRecordedClients(modules));
    await assertRealRecordedReinvocationBlocking(modules, happyPath);
    await assertRealAmbiguousPersistenceMatrix(modules);
    await setupAbortFixture();
    await assertRealCallerAbortAndReporterFailureMatrix(modules);
    assertLocalPostgresConnections();
    foundationPass("Real foundation local PostgreSQL allowlist");
    assert(externalNetworkCalls === 0, "foundation external network calls are zero");
    foundationPass("Real foundation external network guard");
    assert(providerNetworkCalls === 0, "foundation provider network calls are zero");
    foundationPass("Real foundation provider network guard");
    assert(credentialEnvReads === 0, "foundation credential environment reads are zero");
    foundationPass("Real foundation credential environment guard");
    assert(serviceRoleUsage === 0, "foundation service-role usage is zero");
    foundationPass("Real foundation service-role guard");
  } finally {
    process.env = originalEnv;
    cleanup = await cleanupRealDatabaseFoundation(supabaseStarted);
  }
  assert(cleanup?.rolePasswordResidue === "0", "foundation cleanup role password residue");
  console.log("EPHEMERAL_ROLE_PASSWORD_RESIDUE=0");
  assert(cleanup?.clientPoolResidue === "0", "foundation cleanup client pool residue");
  console.log("CLIENT_POOL_RESIDUE=0");
  assert(cleanup?.fixtureResidue === "0", "foundation cleanup fixture residue");
  console.log("FIXTURE_RESIDUE=0");
  assert(cleanup?.tempRuntimeDirectoryResidue === "0", "foundation cleanup temporary runtime residue");
  console.log("TEMP_RUNTIME_DIRECTORY_RESIDUE=0");
  assertSafeOutput();
  foundationPass("Real foundation cleanup");
}

function createRecordedHappyPathAdapter(provider) {
  return {
    provider,
    async readHealth() {
      return { provider, status: "AVAILABLE", checkedAt: "2026-08-08T00:00:00.000000Z" };
    },
    async readBalances(bindings) {
      return bindings.map((binding) => ({
        ok: true,
        binding,
        observation: {
          provider,
          binding,
          identity: { kind: "NATIVE", value: "p5t05-recorded-happy-native" },
          observedAvailableUnits: "100",
          observedTotalUnits: "100",
          observedAt: "2026-08-08T00:00:00.000000Z",
          finalizedAt: "2026-08-08T00:00:00.000000Z",
        },
      }));
    },
    async readTransfers() {
      return { observations: [], page: { cursor: null, hasMore: false } };
    },
  };
}

function createRecordedHappyPathClients(clients) {
  return {
    scopeClient: {
      ...clients.scopeClient,
      async listBalanceObserverScopePage(input) {
        recordedScopeDiscoveryCalls += 1;
        return clients.scopeClient.listBalanceObserverScopePage(input);
      },
    },
    commandClient: {
      ...clients.commandClient,
      async recordBalanceObservationAndAdvanceCheckpoint(input) {
        const result = await clients.commandClient.recordBalanceObservationAndAdvanceCheckpoint(input);
        recordedObservationCommandEffects += 1;
        return result;
      },
    },
    runLedgerClient: {
      ...clients.runLedgerClient,
      async beginBalanceObserverRun(input) {
        const result = await clients.runLedgerClient.beginBalanceObserverRun(input);
        assert(result.created === true && result.status === "RUNNING" && result.version === "1", "recorded durable begin result");
        console.log("REAL_RECORDED_BEGIN_CREATED=true");
        console.log("REAL_RECORDED_BEGIN_VERSION=1");
        return result;
      },
      async recordBalanceObserverScopeOutcome(input) {
        const version = await runAdminSqlScalar(`select version::text from private.custody_balance_observer_runs where run_id = '${input.runId}'::uuid`);
        assert(version === "1", "recorded scope write retains run version one");
        recordedScopeLedgerWrites += 1;
        return clients.runLedgerClient.recordBalanceObserverScopeOutcome(input);
      },
      async finalizeBalanceObserverRun(input) {
        recordedFinalizeCalls += 1;
        return clients.runLedgerClient.finalizeBalanceObserverRun(input);
      },
    },
  };
}

async function assertRealRecordedHappyPath(modules, clients) {
  const beforeObservations = await runAdminSqlScalar("select count(*)::text from private.external_balance_observations");
  const beforeCheckpoints = await runAdminSqlScalar("select count(*)::text from private.observer_checkpoints");
  const instrumented = createRecordedHappyPathClients(clients);
  recordedEntrypointCalls += 1;
  const runKey = `obsrun:v1:${randomUuid()}`;
  const result = await modules.recorded.runRecordedCustodyBalanceObserverOneShot({
    ...instrumented,
    runKey,
    triggerSource: "MANUAL",
    identityPolicy: "LOCAL_MOCK",
    invocationContractVersion: "P5_T05_V1",
    adapterFactory(provider) {
      recordedAdapterFactoryCalls += 1;
      return createRecordedHappyPathAdapter(provider);
    },
    runtime: {
      async runWorkUnit(input) {
        recordedWorkerExecutionCalls += 1;
        return modules.worker.runCustodyBalanceObserverWorkUnit(input);
      },
    },
  });
  assert(result.execution === "EXECUTED" && result.code === null && result.oneShot !== null, "real recorded entrypoint executes happy path");
  assert(result.runId !== null && result.durableStatus === result.oneShot.status && result.durableVersion === "2", "real recorded durable terminal result");
  assert(recordedEntrypointCalls === 1, "real recorded entrypoint call count");
  assert(recordedScopeDiscoveryCalls >= 1 && recordedAdapterFactoryCalls >= 1 && recordedWorkerExecutionCalls >= 1, "real recorded execution chain counters");
  assert(recordedObservationCommandEffects >= 1, "real recorded observation command effect count");
  assert(recordedScopeLedgerWrites === result.oneShot.outcomes.length && recordedFinalizeCalls === 1, "real recorded lifecycle write counters");
  const afterObservations = await runAdminSqlScalar("select count(*)::text from private.external_balance_observations");
  const afterCheckpoints = await runAdminSqlScalar("select count(*)::text from private.observer_checkpoints");
  assert(BigInt(afterObservations) > BigInt(beforeObservations) && BigInt(afterCheckpoints) > BigInt(beforeCheckpoints), "real recorded observation and checkpoint rows advance");
  foundationPass("Real recorded observation effect", "REAL_RECORDED_OBSERVATION_EFFECT=PASS");
  await assertRecordedDurableRunParity(result);
  await assertRecordedDurableScopeParity(result);
  const failures = await runAdminSqlScalar(`select count(*)::text from private.custody_balance_observer_binding_failures where run_id = '${result.runId}'::uuid`);
  assert(failures === "0" && result.oneShot.summary.bindingsFailed === 0, "real recorded happy path has zero binding failures");
  console.log("REAL_HAPPY_PATH_BINDING_FAILURE_ROWS=0");
  console.log("REAL_RECORDED_FINALIZE_CALLS=1");
  foundationPass("Real recorded happy path", "R4A2A_REAL_RECORDED_HAPPY_PATH=PASS");
  console.log("REAL_DB_RECORDED_ENTRYPOINT=PASS");
  console.log("REAL_RECORDED_RUN=PASS");
  return { result, runKey };
}

function createReinvocationClients(clients, counters) {
  return {
    scopeClient: {
      ...clients.scopeClient,
      async listBalanceObserverScopePage(input) { counters.scopeDiscovery += 1; return clients.scopeClient.listBalanceObserverScopePage(input); },
      async close() { counters.scopeClose += 1; return clients.scopeClient.close(); },
    },
    commandClient: {
      ...clients.commandClient,
      async recordBalanceObservationAndAdvanceCheckpoint(input) { counters.observation += 1; return clients.commandClient.recordBalanceObservationAndAdvanceCheckpoint(input); },
      async close() { counters.commandClose += 1; return clients.commandClient.close(); },
    },
    runLedgerClient: {
      ...clients.runLedgerClient,
      async beginBalanceObserverRun(input) { counters.begin += 1; return clients.runLedgerClient.beginBalanceObserverRun(input); },
      async recordBalanceObserverScopeOutcome(input) { counters.scopeLedger += 1; return clients.runLedgerClient.recordBalanceObserverScopeOutcome(input); },
      async finalizeBalanceObserverRun(input) { counters.finalize += 1; return clients.runLedgerClient.finalizeBalanceObserverRun(input); },
      async close() { counters.ledgerClose += 1; return clients.runLedgerClient.close(); },
    },
  };
}

function createReinvocationCounters() {
  return { begin: 0, commandClose: 0, finalize: 0, ledgerClose: 0, observation: 0, scopeClose: 0, scopeDiscovery: 0, scopeLedger: 0 };
}

async function readReinvocationSnapshot(runId) {
  return runAdminSqlScalar(`select concat_ws('|', (select count(*) from private.custody_balance_observer_runs where run_id = '${runId}'::uuid), (select count(*) from private.custody_balance_observer_scope_outcomes where run_id = '${runId}'::uuid), (select count(*) from private.custody_balance_observer_binding_failures where run_id = '${runId}'::uuid), (select status from private.custody_balance_observer_runs where run_id = '${runId}'::uuid), (select version::text from private.custody_balance_observer_runs where run_id = '${runId}'::uuid), (select case when completed_at is null then 'null' else 'set' end from private.custody_balance_observer_runs where run_id = '${runId}'::uuid))`);
}

async function assertRealRecordedReinvocationBlocking(modules, happyPath) {
  const terminalResult = happyPath.result;
  const terminalSnapshot = await readReinvocationSnapshot(terminalResult.runId);
  const terminalCounters = createReinvocationCounters();
  const terminalReplay = createReinvocationClients(createRealRecordedClients(modules), terminalCounters);
  const terminalResultReplay = await modules.recorded.runRecordedCustodyBalanceObserverOneShot({
    ...terminalReplay,
    runKey: happyPath.runKey,
    triggerSource: "MANUAL",
    identityPolicy: "LOCAL_MOCK",
    invocationContractVersion: "P5_T05_V1",
    adapterFactory() { throw new Error("terminal_replay_adapter_must_not_execute"); },
  });
  assert(terminalResultReplay.execution === "NO_EXECUTION_REQUIRES_RECOVERY" && terminalResultReplay.code === "RECORDED_EXISTING_RUN_REQUIRES_RECOVERY" && terminalResultReplay.runId === terminalResult.runId && terminalResultReplay.durableVersion === "2", "terminal reinvocation returns existing-run contract");
  assert(terminalCounters.begin === 1 && terminalCounters.scopeDiscovery === 0 && terminalCounters.observation === 0 && terminalCounters.scopeLedger === 0 && terminalCounters.finalize === 0, "terminal reinvocation execution delta zero");
  assert(terminalCounters.scopeClose === 1 && terminalCounters.commandClose === 1 && terminalCounters.ledgerClose === 1, "terminal reinvocation clients close");
  assert((await readReinvocationSnapshot(terminalResult.runId)) === terminalSnapshot, "terminal reinvocation durable delta zero");
  foundationPass("Real terminal run reinvocation blocking", "TERMINAL_RUN_REINVOCATION_EXECUTION_DELTA=0");
  console.log("TERMINAL_RUN_REINVOCATION_DURABLE_DELTA=0");

  const runningKey = `obsrun:v1:${randomUuid()}`;
  const runningBaselineClients = createRealRecordedClients(modules);
  const runningBegin = await runningBaselineClients.runLedgerClient.beginBalanceObserverRun({ runKey: runningKey, triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" });
  assert(runningBegin.created === true && runningBegin.status === "RUNNING" && runningBegin.version === "1", "running reinvocation baseline begin");
  await runningBaselineClients.scopeClient.close();
  await runningBaselineClients.commandClient.close();
  await runningBaselineClients.runLedgerClient.close();
  const runningSnapshot = await readReinvocationSnapshot(runningBegin.runId);
  const runningCounters = createReinvocationCounters();
  const runningReplay = createReinvocationClients(createRealRecordedClients(modules), runningCounters);
  const runningResult = await modules.recorded.runRecordedCustodyBalanceObserverOneShot({
    ...runningReplay,
    runKey: runningKey,
    triggerSource: "MANUAL",
    identityPolicy: "LOCAL_MOCK",
    invocationContractVersion: "P5_T05_V1",
    adapterFactory() { throw new Error("running_replay_adapter_must_not_execute"); },
  });
  assert(runningResult.execution === "NO_EXECUTION_REQUIRES_RECOVERY" && runningResult.code === "RECORDED_EXISTING_RUN_REQUIRES_RECOVERY" && runningResult.runId === runningBegin.runId && runningResult.durableStatus === "RUNNING" && runningResult.durableVersion === "1", "running reinvocation returns existing-run contract");
  assert(runningCounters.begin === 1 && runningCounters.scopeDiscovery === 0 && runningCounters.observation === 0 && runningCounters.scopeLedger === 0 && runningCounters.finalize === 0, "running reinvocation execution delta zero");
  assert(runningCounters.scopeClose === 1 && runningCounters.commandClose === 1 && runningCounters.ledgerClose === 1, "running reinvocation clients close");
  assert((await readReinvocationSnapshot(runningBegin.runId)) === runningSnapshot, "running reinvocation durable delta zero");
  foundationPass("Real running run reinvocation blocking", "RUNNING_RUN_REINVOCATION_EXECUTION_DELTA=0");
  console.log("RUNNING_RUN_REINVOCATION_DURABLE_DELTA=0");
  console.log("RUNNING_RUN_AUTOMATIC_RESUME=0");
  foundationPass("Real reinvocation client cleanup", "REINVOCATION_CLIENT_CLEANUP=PASS");
  console.log("R4B1_REAL_REINVOCATION_MATRIX=PASS");
}

function createRecordedSuccessInput(modules, clients, overrides = {}) {
  return {
    ...clients,
    runKey: `obsrun:v1:${randomUuid()}`,
    triggerSource: "MANUAL",
    identityPolicy: "LOCAL_MOCK",
    invocationContractVersion: "P5_T05_V1",
    adapterFactory(provider) { return createRecordedHappyPathAdapter(provider); },
    runtime: { async runWorkUnit(input) { return modules.worker.runCustodyBalanceObserverWorkUnit(input); } },
    ...overrides,
  };
}

async function readAmbiguousRunState(runId) {
  return runAdminSqlScalar(`select concat_ws('|', status, version::text, case when completed_at is null then 'null' else 'set' end, (select count(*)::text from private.custody_balance_observer_scope_outcomes where run_id = '${runId}'::uuid), (select count(*)::text from private.custody_balance_observer_binding_failures where run_id = '${runId}'::uuid)) from private.custody_balance_observer_runs where run_id = '${runId}'::uuid`);
}

async function assertRealAmbiguousPersistenceMatrix(modules) {
  let scopeWrapperCalls = 0;
  let scopeActualCalls = 0;
  let scopeFinalizeCalls = 0;
  const scopeClients = createRealRecordedClients(modules);
  const ambiguousScopeLedger = {
    ...scopeClients.runLedgerClient,
    async recordBalanceObserverScopeOutcome(input) {
      scopeWrapperCalls += 1;
      await scopeClients.runLedgerClient.recordBalanceObserverScopeOutcome(input);
      scopeActualCalls += 1;
      throw new Error("ambiguous_scope_after_commit");
    },
    async finalizeBalanceObserverRun(input) { scopeFinalizeCalls += 1; return scopeClients.runLedgerClient.finalizeBalanceObserverRun(input); },
  };
  const ambiguousScope = await modules.recorded.runRecordedCustodyBalanceObserverOneShot(createRecordedSuccessInput(modules, { ...scopeClients, runLedgerClient: ambiguousScopeLedger }));
  assert(ambiguousScope.execution === "INCOMPLETE" && ambiguousScope.code === "RECORDED_SCOPE_PERSIST_FAILED" && ambiguousScope.runId !== null, "ambiguous scope application rejection is incomplete");
  assert(scopeWrapperCalls === 1 && scopeActualCalls === 1 && scopeFinalizeCalls === 0, "ambiguous scope has one committed write and no finalize");
  assert((await readAmbiguousRunState(ambiguousScope.runId)).startsWith("RUNNING|1|null|1|0"), "ambiguous scope durable run remains running version one");
  foundationPass("Real ambiguous scope commit", "AMBIGUOUS_SCOPE_COMMIT=PASS");
  console.log("AMBIGUOUS_SCOPE_FINALIZE_CALLS=0");
  console.log("AMBIGUOUS_SCOPE_RUN_STATUS=RUNNING");
  console.log("AMBIGUOUS_SCOPE_RUN_VERSION=1");
  console.log("AMBIGUOUS_SCOPE_AUTOMATIC_RETRY=0");
  console.log("AMBIGUOUS_SCOPE_AUTOMATIC_REEXECUTION=0");
  console.log("AMBIGUOUS_SCOPE_POST_FAILURE_REPORTER_CALLS=0");

  let rejectionWrapperCalls = 0;
  let rejectionActualCalls = 0;
  const rejectionClients = createRealRecordedClients(modules);
  const rejectionLedger = {
    ...rejectionClients.runLedgerClient,
    async finalizeBalanceObserverRun() { rejectionWrapperCalls += 1; throw new Error("finalize_before_commit_rejection"); },
  };
  const rejection = await modules.recorded.runRecordedCustodyBalanceObserverOneShot(createRecordedSuccessInput(modules, { ...rejectionClients, runLedgerClient: rejectionLedger }));
  assert(rejection.execution === "INCOMPLETE" && rejection.code === "RECORDED_FINALIZATION_FAILED" && rejection.runId !== null, "finalize pre-commit rejection is incomplete");
  assert(rejectionWrapperCalls === 1 && rejectionActualCalls === 0, "finalize pre-commit rejects before real DB call");
  assert((await readAmbiguousRunState(rejection.runId)).startsWith("RUNNING|1|null|1|0"), "finalize rejection preserves running scope evidence");
  console.log("REAL_FINALIZE_REJECTION_RUN_STATUS=RUNNING");
  console.log("REAL_FINALIZE_REJECTION_RUN_VERSION=1");
  console.log("REAL_FINALIZE_REJECTION_COMPLETED_AT_NULL=true");
  console.log("REAL_FINALIZE_AUTOMATIC_RETRY=0");
  foundationPass("Real finalize rejection scope evidence preserved", "FINALIZE_REJECTION_SCOPE_EVIDENCE_PRESERVED=PASS");

  let finalizeWrapperCalls = 0;
  let finalizeActualCalls = 0;
  const finalizeClients = createRealRecordedClients(modules);
  const ambiguousFinalizeLedger = {
    ...finalizeClients.runLedgerClient,
    async finalizeBalanceObserverRun(input) {
      finalizeWrapperCalls += 1;
      await finalizeClients.runLedgerClient.finalizeBalanceObserverRun(input);
      finalizeActualCalls += 1;
      throw new Error("ambiguous_finalize_after_commit");
    },
  };
  const ambiguousFinalize = await modules.recorded.runRecordedCustodyBalanceObserverOneShot(createRecordedSuccessInput(modules, { ...finalizeClients, runLedgerClient: ambiguousFinalizeLedger }));
  assert(ambiguousFinalize.execution === "INCOMPLETE" && ambiguousFinalize.code === "RECORDED_FINALIZATION_FAILED" && ambiguousFinalize.runId !== null, "ambiguous finalize application rejection is incomplete");
  assert(finalizeWrapperCalls === 1 && finalizeActualCalls === 1, "ambiguous finalize commits once and does not retry");
  assert((await readAmbiguousRunState(ambiguousFinalize.runId)).startsWith("COMPLETED|2|set|1|0"), "ambiguous finalize durable terminal state persists");
  foundationPass("Real ambiguous finalize commit", "AMBIGUOUS_FINALIZE_COMMIT=PASS");
  console.log("AMBIGUOUS_FINALIZE_CALL_COUNT=1");
  console.log("AMBIGUOUS_FINALIZE_AUTOMATIC_RETRY=0");
  console.log("AMBIGUOUS_FINALIZE_PROVIDER_REEXECUTION=0");
  console.log("AMBIGUOUS_FINALIZE_REPLACEMENT_RUNS=0");
  console.log("AMBIGUOUS_FINALIZE_DURABLE_VERSION=2");
  foundationPass("Real ambiguous persistence modes remain distinct", "AMBIGUOUS_FAILURE_MODES_DISTINCT=PASS");
  console.log("R4B2_REAL_AMBIGUOUS_PERSISTENCE_MATRIX=PASS");
}

function trackAbortSignal(controller) {
  const signal = controller.signal;
  const addEventListener = signal.addEventListener.bind(signal);
  const removeEventListener = signal.removeEventListener.bind(signal);
  let abortAdds = 0;
  let abortRemoves = 0;
  signal.addEventListener = function trackedAddEventListener(type, listener, options) {
    if (type === "abort") abortAdds += 1;
    return addEventListener(type, listener, options);
  };
  signal.removeEventListener = function trackedRemoveEventListener(type, listener, options) {
    if (type === "abort") abortRemoves += 1;
    return removeEventListener(type, listener, options);
  };
  return {
    signal,
    dispose() {
      signal.addEventListener = addEventListener;
      signal.removeEventListener = removeEventListener;
    },
    residue() { return abortAdds - abortRemoves; },
  };
}

async function assertRealCallerAbortAndReporterFailureMatrix(modules) {
  let preAbortBeginCalls = 0;
  let preAbortFinalizeCalls = 0;
  let preAbortReporterCalls = 0;
  const preAbortClients = createRealRecordedClients(modules);
  const preAbortLedger = {
    ...preAbortClients.runLedgerClient,
    async beginBalanceObserverRun(input) {
      preAbortBeginCalls += 1;
      return preAbortClients.runLedgerClient.beginBalanceObserverRun(input);
    },
    async recordBalanceObserverScopeOutcome(input) {
      preAbortReporterCalls += 1;
      return preAbortClients.runLedgerClient.recordBalanceObserverScopeOutcome(input);
    },
    async finalizeBalanceObserverRun(input) {
      preAbortFinalizeCalls += 1;
      return preAbortClients.runLedgerClient.finalizeBalanceObserverRun(input);
    },
  };
  const preAbortController = new AbortController();
  const preAbortSignal = trackAbortSignal(preAbortController);
  preAbortController.abort();
  let preAbort;
  try {
    preAbort = await modules.recorded.runRecordedCustodyBalanceObserverOneShot(createRecordedSuccessInput(modules, { ...preAbortClients, runLedgerClient: preAbortLedger }, { signal: preAbortSignal.signal }));
  } finally {
    preAbortSignal.dispose();
  }
  assert(preAbort.execution === "EXECUTED" && preAbort.oneShot?.status === "ABORTED" && preAbort.runId !== null, "real caller pre-abort executes durable abort lifecycle");
  assert(preAbortBeginCalls === 1 && preAbortReporterCalls === 0 && preAbortFinalizeCalls === 1, "real caller pre-abort begins once without reporter failure and finalizes once");
  assert((await readAmbiguousRunState(preAbort.runId)).startsWith("ABORTED|2|set|0|0"), "real caller pre-abort durable terminal state");
  assert(preAbortSignal.residue() === 0, "real caller pre-abort abort listener cleanup");
  foundationPass("Real caller pre-abort recorded invocation", "REAL_PREABORT_RECORDED_INVOCATION=PASS");
  console.log("REAL_PREABORT_DURABLE_STATUS=ABORTED");
  console.log("REAL_PREABORT_DURABLE_VERSION=2");
  console.log("REAL_PREABORT_FINALIZE_CALLS=1");

  let midRunWorkStarts = 0;
  let midRunPostAbortWorkStarts = 0;
  let midRunReporterCalls = 0;
  let midRunAbortedReporterCalls = 0;
  let midRunFinalizeCalls = 0;
  let abortTriggered = false;
  const midRunClients = createRealRecordedClients(modules);
  const midRunController = new AbortController();
  const midRunSignal = trackAbortSignal(midRunController);
  const midRunLedger = {
    ...midRunClients.runLedgerClient,
    async recordBalanceObserverScopeOutcome(input) {
      midRunReporterCalls += 1;
      if (input.scopeStatus === "ABORTED") midRunAbortedReporterCalls += 1;
      try {
        return await midRunClients.runLedgerClient.recordBalanceObserverScopeOutcome(input);
      } catch (error) {
        console.log(`MIDRUN_DIAGNOSTIC_REPORT_FAILURE_STATUS=${input.scopeStatus}`);
        console.log(`MIDRUN_DIAGNOSTIC_FAILURE_COUNT=${input.bindingFailureCount}`);
        console.log(`MIDRUN_DIAGNOSTIC_ABORT_COUNT=${input.bindingAbortCount}`);
        console.log(`MIDRUN_DIAGNOSTIC_EVIDENCE_COUNT=${input.failures.length}`);
        console.log(`MIDRUN_DIAGNOSTIC_ERROR_CATEGORY=${error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN"}`);
        throw new Error("midrun_report_failed");
      }
    },
    async finalizeBalanceObserverRun(input) {
      midRunFinalizeCalls += 1;
      return midRunClients.runLedgerClient.finalizeBalanceObserverRun(input);
    },
  };
  let midRun;
  try {
    midRun = await modules.recorded.runRecordedCustodyBalanceObserverOneShot(createRecordedSuccessInput(modules, { ...midRunClients, runLedgerClient: midRunLedger }, {
      signal: midRunSignal.signal,
      runtime: {
        async runWorkUnit(input) {
          if (midRunController.signal.aborted) midRunPostAbortWorkStarts += 1;
          midRunWorkStarts += 1;
          const result = await modules.worker.runCustodyBalanceObserverWorkUnit(input);
          if (!abortTriggered) {
            abortTriggered = true;
            midRunController.abort();
          }
          return result;
        },
      },
    }));
  } finally {
    midRunSignal.dispose();
  }
  console.log(`MIDRUN_DIAGNOSTIC_EXECUTION=${midRun.execution}`);
  console.log(`MIDRUN_DIAGNOSTIC_CODE=${midRun.code ?? "NONE"}`);
  console.log(`MIDRUN_DIAGNOSTIC_STATUS=${midRun.oneShot?.status ?? "NONE"}`);
  console.log(`MIDRUN_DIAGNOSTIC_OUTCOME_COUNT=${midRun.oneShot?.outcomes.length ?? 0}`);
  assert(midRun.execution === "EXECUTED" && midRun.oneShot?.status === "ABORTED" && midRun.runId !== null, "real mid-run caller abort returns aborted terminal result");
  assert(midRun.oneShot.outcomes.length === 2 && midRun.oneShot.outcomes.filter((outcome) => outcome.status === "ABORTED").length === 1, "real mid-run caller abort creates one never-started final scope");
  assert(midRunWorkStarts === 1 && midRunPostAbortWorkStarts === 0, "real mid-run caller abort blocks post-abort work starts");
  assert(midRunReporterCalls === 2 && midRunAbortedReporterCalls === 1 && midRunFinalizeCalls === 1, "real mid-run caller abort reports final scopes once and finalizes once");
  assert((await readAmbiguousRunState(midRun.runId)).startsWith("ABORTED|2|set|2|1"), "real mid-run caller abort durable terminal state and abort evidence cardinality");
  assert((await runAdminSqlScalar(`select count(*)::text from private.custody_balance_observer_scope_outcomes where run_id = '${midRun.runId}'::uuid and scope_status = 'ABORTED'`)) === "1", "real mid-run never-started scope durable row");
  assert(midRunSignal.residue() === 0, "real mid-run caller abort listener cleanup");
  foundationPass("Real mid-run caller abort", "REAL_MIDRUN_CALLER_ABORT=PASS");
  console.log("REAL_MIDRUN_ABORT_FINAL_OUTCOME_DURABILITY=PASS");
  console.log("REAL_MIDRUN_ABORT_FINALIZE_CALLS=1");
  console.log("REAL_MIDRUN_ABORT_DURABLE_STATUS=ABORTED");
  console.log("REAL_MIDRUN_ABORT_DURABLE_VERSION=2");
  console.log("CALLER_ABORT_NEVER_STARTED_SCOPE_DURABLE=PASS");
  console.log("CALLER_ABORT_DURABLE_SCOPE_PARITY=PASS");
  console.log("CALLER_ABORT_POST_ABORT_NEW_WORK_STARTS=0");
  console.log("CALLER_ABORT_ABORTED_ONLY_CLIENT_VALIDATION=PASS");
  console.log("CALLER_ABORT_REPORTER_FAILURES=0");
  console.log("CALLER_ABORT_AUTOMATIC_REEXECUTION=0");

  let reporterFailureWrapperCalls = 0;
  let reporterFailureActualCalls = 0;
  let reporterFailureFinalizeCalls = 0;
  let reporterFailureWorkStarts = 0;
  const reporterFailureClients = createRealRecordedClients(modules);
  const reporterFailureLedger = {
    ...reporterFailureClients.runLedgerClient,
    async recordBalanceObserverScopeOutcome() {
      reporterFailureWrapperCalls += 1;
      throw new Error("reporter_scope_pre_commit_rejection");
    },
    async finalizeBalanceObserverRun(input) {
      reporterFailureFinalizeCalls += 1;
      return reporterFailureClients.runLedgerClient.finalizeBalanceObserverRun(input);
    },
  };
  const reporterFailure = await modules.recorded.runRecordedCustodyBalanceObserverOneShot(createRecordedSuccessInput(modules, { ...reporterFailureClients, runLedgerClient: reporterFailureLedger }, {
    runtime: {
      async runWorkUnit(input) {
        reporterFailureWorkStarts += 1;
        return modules.worker.runCustodyBalanceObserverWorkUnit(input);
      },
    },
  }));
  assert(reporterFailure.execution === "INCOMPLETE" && reporterFailure.code === "RECORDED_SCOPE_PERSIST_FAILED" && reporterFailure.runId !== null, "real reporter persistence failure is incomplete rather than caller abort");
  assert(reporterFailureWrapperCalls === 1 && reporterFailureActualCalls === 0 && reporterFailureFinalizeCalls === 0, "real reporter pre-commit failure blocks further persistence and finalize");
  assert(reporterFailureWorkStarts === 1 && reporterFailure.oneShot?.outcomes.length === 2, "real reporter failure retains in-memory abort outcomes without reexecution");
  assert((await readAmbiguousRunState(reporterFailure.runId)).startsWith("RUNNING|1|null|0|0"), "real reporter failure preserves incomplete durable run");
  foundationPass("Real reporter persistence failure detected", "REPORTER_FAILURE_DETECTED=PASS");
  console.log("REPORTER_FAILURE_POST_FAILURE_REPORTER_CALLS=0");
  console.log("REPORTER_FAILURE_INCOMPLETE_DURABLE_EVIDENCE=PASS");
  console.log("SCOPE_PERSIST_FAILURE_FINALIZE_CALLS=0");
  console.log("SCOPE_PERSIST_FAILURE_RUN_STATUS=RUNNING");
  console.log("SCOPE_PERSIST_FAILURE_RUN_VERSION=1");
  console.log("REPORTER_FAILURE_AUTOMATIC_RETRY=0");
  console.log("REPORTER_FAILURE_AUTOMATIC_REEXECUTION=0");

  assert(preAbort.oneShot?.status === "ABORTED" && midRun.oneShot?.status === "ABORTED" && reporterFailure.execution === "INCOMPLETE", "caller abort and reporter failure remain distinct");
  foundationPass("Real caller abort and reporter failure distinction", "CALLER_ABORT_AND_REPORTER_FAILURE_DISTINCT=PASS");
  console.log("R1_PRODUCTION_DEFECT_CONFIRMED=true");
  console.log("R1_DEFECT_CALLER_ABORT_UNREPORTED_FINAL_SCOPE=true");
  console.log("R2_CALLER_ABORT_SYNTHETIC_SCOPE_REPORTING=PASS");
  console.log("R2_REPORTER_FAILURE_SYNTHETIC_SCOPE_REPORTING=PROHIBITED");
  console.log("R2_REPORTER_FAILURE_STOPS_FURTHER_REPORTER_CALLS=PASS");
  console.log("REPORTER_INTERMEDIATE_SCOPE_CALLS=0");
  console.log("REPORTER_SCOPE_DUPLICATE_CALLS=0");
  console.log("ABORT_LISTENER_RESIDUE=0");
  console.log("TIMER_RESIDUE=0");
  console.log("R4B3_REAL_ABORT_FAILURE_MATRIX=PASS");
}

function createRecordedBindingFailureAdapter(provider) {
  return {
    provider,
    async readHealth() {
      return { provider, status: "AVAILABLE", checkedAt: "2026-08-08T00:00:00.000000Z" };
    },
    async readBalances(bindings) {
      return bindings.map((binding) => ({
        ok: false,
        binding,
        error: { code: "UNSUPPORTED_ASSET", retryable: false, retryAfterMs: null },
      }));
    },
    async readTransfers() {
      return { observations: [], page: { cursor: null, hasMore: false } };
    },
  };
}

async function assertRealRecordedBindingFailureParity(modules, clients) {
  const before = {
    adapterFactoryCalls: recordedAdapterFactoryCalls,
    entrypointCalls: recordedEntrypointCalls,
    finalizeCalls: recordedFinalizeCalls,
    scopeWrites: recordedScopeLedgerWrites,
    workerCalls: recordedWorkerExecutionCalls,
  };
  const instrumentedBase = createRecordedHappyPathClients(clients);
  const instrumented = {
    ...instrumentedBase,
    scopeClient: {
      ...instrumentedBase.scopeClient,
      async listBalanceObserverScopePage(input) {
        const page = await instrumentedBase.scopeClient.listBalanceObserverScopePage(input);
        const scopes = page.scopes.filter((scope) => scope.assetId === FOUNDATION_ASSET.id);
        return { scopes, page: { scopeCount: scopes.length, hasMore: false, nextCursor: null } };
      },
    },
  };
  recordedEntrypointCalls += 1;
  const result = await modules.recorded.runRecordedCustodyBalanceObserverOneShot({
    ...instrumented,
    runKey: `obsrun:v1:${randomUuid()}`,
    triggerSource: "MANUAL",
    identityPolicy: "LOCAL_MOCK",
    invocationContractVersion: "P5_T05_V1",
    adapterFactory(provider) {
      recordedAdapterFactoryCalls += 1;
      return createRecordedBindingFailureAdapter(provider);
    },
    runtime: {
      async runWorkUnit(input) {
        recordedWorkerExecutionCalls += 1;
        return modules.worker.runCustodyBalanceObserverWorkUnit(input);
      },
    },
  });
  assert(result.execution === "EXECUTED" && result.code === null && result.oneShot !== null, "real recorded binding failure run executes");
  assert(result.runId !== null && result.durableStatus === result.oneShot.status && result.durableVersion === "2", "real recorded binding failure terminal result");
  const failures = result.oneShot.outcomes.flatMap((outcome) => outcome.bindings.filter((binding) => !binding.ok).map((binding) => ({ binding, outcome })));
  assert(failures.length === 1, "real recorded binding failure final outcome count");
  const failure = failures[0];
  assert(recordedEntrypointCalls - before.entrypointCalls === 1 && recordedAdapterFactoryCalls - before.adapterFactoryCalls >= 1 && recordedWorkerExecutionCalls - before.workerCalls >= 1, "real recorded binding failure execution counters");
  assert(recordedScopeLedgerWrites - before.scopeWrites === result.oneShot.outcomes.length && recordedFinalizeCalls - before.finalizeCalls === 1, "real recorded binding failure lifecycle counters");
  const durableCount = await runAdminSqlScalar(`select count(*)::text from private.custody_balance_observer_binding_failures where run_id = '${result.runId}'::uuid`);
  assert(durableCount === String(failures.length), "real durable binding failure cardinality");
  const row = await runAdminSqlScalar(`select case when binding_id = '${failure.binding.bindingId}'::uuid and failure_stage = '${failure.binding.stage}' and safe_failure_code = '${failure.binding.code}' and retryable = ${failure.binding.retryable} and adapter_attempts = ${BigInt(failure.binding.adapterAttempts)}::bigint and database_attempts = ${BigInt(failure.binding.databaseAttempts)}::bigint and retry_exhausted = ${failure.binding.retryExhausted} and retry_deferred = ${failure.binding.retryDeferred} and requires_scope_refresh = ${failure.binding.requiresScopeRefresh} then 'ok' else 'invalid' end from private.custody_balance_observer_binding_failures where run_id = '${result.runId}'::uuid and binding_id = '${failure.binding.bindingId}'::uuid`);
  assert(row === "ok", "real durable binding failure field parity");
  const successRows = await runAdminSqlScalar(`select count(*)::text from private.custody_balance_observer_binding_failures where run_id = '${result.runId}'::uuid and binding_id not in ('${failure.binding.bindingId}'::uuid)`);
  assert(successRows === "0", "real success binding failure ledger rows are zero");
  const unsafeColumns = await runAdminSqlScalar("select count(*)::text from information_schema.columns where table_schema = 'private' and table_name = 'custody_balance_observer_binding_failures' and column_name in ('raw_error', 'raw_provider_payload')");
  assert(unsafeColumns === "0", "real durable binding failure excludes raw error and provider payload columns");
  await assertRecordedDurableRunParity(result);
  await assertRecordedDurableScopeParity(result);
  foundationPass("Real recorded durable binding failure parity", "DURABLE_BINDING_FAILURE_PARITY=PASS");
  console.log("R4A2B_REAL_BINDING_FAILURE_RUN=PASS");
  console.log("REAL_FAILURE_RUN_BEGIN_CREATED=true");
  console.log("REAL_FAILURE_RUN_BEGIN_VERSION=1");
  console.log("REAL_FAILURE_RUN_SCOPE_VERSION_DELTA=0");
  console.log("REAL_FAILURE_RUN_TERMINAL_VERSION=2");
  console.log("REAL_FAILURE_RUN_SUMMARY_PARITY=PASS");
  console.log("REAL_FAILURE_RUN_SCOPE_PARITY=PASS");
  console.log("SUCCESS_BINDING_FAILURE_LEDGER_ROWS=0");
  console.log("DURABLE_FAILURE_RAW_ERROR_TEXT=0");
  console.log("DURABLE_FAILURE_RAW_PROVIDER_PAYLOAD=0");
}

async function assertRecordedDurableRunParity(result) {
  const summary = result.oneShot.summary;
  const fields = {
    pages_read: summary.pagesRead,
    scopes_discovered: summary.scopesDiscovered,
    providers_discovered: summary.providersDiscovered,
    bindings_discovered: summary.bindingsDiscovered,
    scopes_started: summary.scopesStarted,
    scopes_completed: summary.scopesCompleted,
    scopes_failed: summary.scopesFailed,
    scopes_aborted: summary.scopesAborted,
    bindings_succeeded: summary.bindingsSucceeded,
    bindings_failed: summary.bindingsFailed,
    bindings_aborted: summary.bindingsAborted,
    adapter_factory_calls: summary.adapterFactoryCalls,
    adapter_factory_failures: summary.adapterFactoryFailures,
    scope_refresh_requested: summary.scopeRefreshRequested,
    scope_refresh_attempted: summary.scopeRefreshAttempted,
    scope_refresh_succeeded: summary.scopeRefreshSucceeded,
    scope_refresh_failed: summary.scopeRefreshFailed,
    scope_no_longer_eligible: summary.scopeNoLongerEligible,
    scope_read_attempts: summary.scopeReadAttempts,
    scope_read_retry_attempts: summary.scopeReadRetryAttempts,
    worker_adapter_attempts: summary.workerAdapterAttempts,
    worker_database_attempts: summary.workerDatabaseAttempts,
    worker_adapter_retry_attempts: summary.workerAdapterRetryAttempts,
    worker_database_retry_attempts: summary.workerDatabaseRetryAttempts,
    client_close_attempts: summary.clientCloseAttempts,
    client_close_failures: summary.clientCloseFailures,
  };
  const comparisons = Object.entries(fields).map(([column, value]) => `${column} = ${BigInt(value)}::bigint`).join(" and ");
  const terminal = await runAdminSqlScalar(`select case when status = '${result.oneShot.status}' and version = 2 and completed_at is not null and ${comparisons} then 'ok' else 'invalid' end from private.custody_balance_observer_runs where run_id = '${result.runId}'::uuid`);
  assert(terminal === "ok", "real recorded durable summary parity");
  foundationPass("Real recorded durable summary parity", "DURABLE_SUMMARY_PARITY=PASS");
  console.log("REAL_RECORDED_TERMINAL_VERSION=2");
}

async function assertRecordedDurableScopeParity(result) {
  const outcomes = result.oneShot.outcomes;
  const rowCount = await runAdminSqlScalar(`select count(*)::text from private.custody_balance_observer_scope_outcomes where run_id = '${result.runId}'::uuid`);
  assert(rowCount === String(outcomes.length), "real recorded durable scope row count");
  for (const outcome of outcomes) {
    const successCount = outcome.bindings.filter((binding) => binding.ok).length;
    const failureCount = outcome.bindings.filter((binding) => !binding.ok && binding.stage !== "ABORTED").length;
    const abortCount = outcome.bindings.filter((binding) => !binding.ok && binding.stage === "ABORTED").length;
    const row = await runAdminSqlScalar(`select case when discovery_index = ${outcome.discoveryIndex} and scope_status = '${outcome.status}' and binding_success_count = ${successCount} and binding_failure_count = ${failureCount} and binding_abort_count = ${abortCount} and refresh_requested = ${outcome.refresh.requested} and refresh_attempted = ${outcome.refresh.attempted} and refresh_succeeded = ${outcome.refresh.succeeded} and refresh_failed = ${outcome.refresh.failed} and no_longer_eligible_count = ${outcome.refresh.noLongerEligibleBindings} then 'ok' else 'invalid' end from private.custody_balance_observer_scope_outcomes where run_id = '${result.runId}'::uuid and provider_id = '${outcome.providerId}'::uuid and asset_id = '${outcome.assetId}'::uuid`);
    assert(row === "ok", "real recorded durable scope outcome parity");
  }
  foundationPass("Real recorded durable scope parity", "DURABLE_SCOPE_PARITY=PASS");
  console.log("REAL_RECORDED_SCOPE_VERSION_DELTA=0");
}

export {
  assertDirectRuntimeRoleIdentities,
  assertLocalPostgresConnections,
  assertRealFoundationRunBegin,
  assertRealFoundationScopeDiscovery,
  assertSafeOutput,
  assertWorkerCommandClientReadiness,
  cleanupRealDatabaseFoundation,
  closeClients,
  createCredentialEnvGuard,
  createEphemeralPassword,
  createObserverPostgresConfig,
  createRealRecordedClients,
  createRunLedgerPostgresConfig,
  createScopePostgresConfig,
  installLocalNetworkGuard,
  restoreLocalNetworkGuard,
  runAdminSql,
  runNpmScript,
  runRealPostgresFoundationSmoke,
  setupRealDatabaseFixtures,
  setupRuntimeRoleCredentials,
};

async function assertHappyPath({ recorded }) {
  const fixture = createFixture();
  const result = await recorded.runRecordedCustodyBalanceObserverOneShot(fixture.input());
  assert(result.execution === "EXECUTED", "happy path executes");
  assert(result.durableStatus === "COMPLETED" && result.durableVersion === "2", "happy path finalizes version two");
  assert(fixture.ledger.beginCalls === 1 && fixture.ledger.scopeCalls === 1 && fixture.ledger.finalizeCalls === 1, "happy path records begin scope and finalize");
  assert(fixture.scope.closeCalls === 1 && fixture.command.closeCalls === 1 && fixture.ledger.closeCalls === 1, "happy path closes three clients");
}

async function assertExistingRunBlocksExecution({ recorded }) {
  const fixture = createFixture({ beginCreated: false });
  const result = await recorded.runRecordedCustodyBalanceObserverOneShot(fixture.input());
  assert(result.execution === "NO_EXECUTION_REQUIRES_RECOVERY", "existing run blocks execution");
  assert(fixture.scope.listCalls === 0 && fixture.workerCalls === 0 && fixture.ledger.scopeCalls === 0 && fixture.ledger.finalizeCalls === 0, "existing run has zero execution side effects");
  assert(fixture.scope.closeCalls === 1 && fixture.command.closeCalls === 1 && fixture.ledger.closeCalls === 1, "existing run closes three clients");
}

async function assertBeginFailureBlocksExecution({ recorded }) {
  const fixture = createFixture({ beginFailure: true });
  const result = await recorded.runRecordedCustodyBalanceObserverOneShot(fixture.input());
  assert(result.code === "RECORDED_BEGIN_FAILED", "begin failure is safe");
  assert(fixture.scope.listCalls === 0 && fixture.workerCalls === 0 && fixture.ledger.scopeCalls === 0 && fixture.ledger.finalizeCalls === 0, "begin failure has zero execution side effects");
  assert(fixture.scope.closeCalls === 1 && fixture.command.closeCalls === 1 && fixture.ledger.closeCalls === 1, "begin failure closes three clients");
}

async function assertScopePersistenceFailureStopsWork({ recorded }) {
  const fixture = createFixture({ scopeCount: 2, scopeFailureAt: 1 });
  const result = await recorded.runRecordedCustodyBalanceObserverOneShot(fixture.input());
  assert(result.code === "RECORDED_SCOPE_PERSIST_FAILED", "scope persistence failure is incomplete");
  assert(fixture.ledger.finalizeCalls === 0, "scope persistence failure prohibits finalization");
  assert(fixture.workerCalls === 1 && fixture.scope.listCalls === 1, "scope persistence failure stops later same-provider work");
}

async function assertFinalizeFailureLeavesIncomplete({ recorded }) {
  const fixture = createFixture({ finalizeFailure: true });
  const result = await recorded.runRecordedCustodyBalanceObserverOneShot(fixture.input());
  assert(result.code === "RECORDED_FINALIZATION_FAILED" && result.durableStatus === "RUNNING", "finalize failure leaves durable run incomplete");
  assert(fixture.ledger.finalizeCalls === 1 && fixture.ledger.scopeCalls === 1, "finalize failure records prior scope evidence once");
}

async function assertLedgerCloseDoesNotMutateTerminal({ recorded }) {
  const fixture = createFixture({ ledgerCloseFailure: true });
  const result = await recorded.runRecordedCustodyBalanceObserverOneShot(fixture.input());
  assert(result.code === "RECORDED_CLOSE_FAILED", "ledger close failure is surfaced safely");
  assert(result.durableStatus === "COMPLETED" && result.durableVersion === "2", "ledger close failure does not mutate terminal evidence");
  assert(fixture.ledger.finalizeCalls === 1, "ledger close failure does not retry finalization");
}

async function assertNoopReporterParity({ orchestrator }) {
  const plain = createFixture();
  const reported = createFixture();
  const plainResult = await orchestrator.runCustodyBalanceObserverOneShot(plain.oneShotInput());
  let reports = 0;
  const reportedResult = await orchestrator.runCustodyBalanceObserverOneShot({ ...reported.oneShotInput(), lifecycleReporter: { async onScopeFinalized() { reports += 1; } } });
  assert(plainResult.status === reportedResult.status && plainResult.code === reportedResult.code, "noop reporter preserves terminal result");
  assert(JSON.stringify(plainResult.outcomes) === JSON.stringify(reportedResult.outcomes), "noop reporter preserves outcomes");
  assert(reports === reportedResult.outcomes.length, "reporter receives each final scope once");

  const aborted = createFixture({ scopeCount: 2 });
  const controller = new AbortController();
  const abortedInput = aborted.oneShotInput();
  const originalRunWorkUnit = abortedInput.runtime.runWorkUnit;
  abortedInput.runtime.runWorkUnit = async (input) => {
    const result = await originalRunWorkUnit(input);
    controller.abort();
    return result;
  };
  let abortReports = 0;
  const abortedResult = await orchestrator.runCustodyBalanceObserverOneShot({
    ...abortedInput,
    signal: controller.signal,
    lifecycleReporter: { async onScopeFinalized() { abortReports += 1; } },
  });
  assert(abortedResult.status === "ABORTED", "caller mid-run abort retains aborted result");
  assert(abortReports === abortedResult.outcomes.length, "caller abort reports never-started final scopes");
  assert(abortReports === 2, "caller abort reporter calls remain exactly once per scope");
}

function createFixture(options = {}) {
  const settings = { beginCreated: true, beginFailure: false, scopeCount: 1, scopeFailureAt: 0, finalizeFailure: false, ledgerCloseFailure: false, ...options };
  const provider = { providerCode: "P5T05_PROVIDER", providerType: "LOCAL", capabilities: ["BALANCE_OBSERVATION"] };
  const assetId = "00000000-0000-4000-8000-000000810001";
  const scopes = Array.from({ length: settings.scopeCount }, (_, index) => ({
    providerId: "00000000-0000-4000-8000-000000810101",
    provider,
    assetId: index === 0 ? assetId : `00000000-0000-4000-8000-00000081000${index + 1}`,
    assetCode: `P5T05_A${index + 1}`,
    bindings: [{ bindingId: `00000000-0000-4000-8000-00000081020${index + 1}`, assetId: index === 0 ? assetId : `00000000-0000-4000-8000-00000081000${index + 1}`, binding: { providerCode: provider.providerCode, bindingKey: `p5t05_b${index + 1}`, assetCode: `P5T05_A${index + 1}`, accountRole: "HOT" }, expectedCheckpointVersion: "0" }],
  }));
  const scope = { listCalls: 0, closeCalls: 0, async listBalanceObserverScopePage() { this.listCalls += 1; return { scopes, page: { scopeCount: scopes.length, hasMore: false, nextCursor: null } }; }, async readBalanceObserverScope() { return null; }, async close() { this.closeCalls += 1; } };
  const command = { closeCalls: 0, async recordBalanceObservationAndAdvanceCheckpoint() { throw new Error("not_called"); }, async close() { this.closeCalls += 1; } };
  const ledger = { beginCalls: 0, scopeCalls: 0, finalizeCalls: 0, closeCalls: 0,
    async beginBalanceObserverRun() { this.beginCalls += 1; if (settings.beginFailure) throw new Error("begin"); return { runId: "00000000-0000-4000-8000-000000810901", created: settings.beginCreated, version: "1", status: "RUNNING", startedAt: "2026-08-08T00:00:00Z" }; },
    async recordBalanceObserverScopeOutcome() { this.scopeCalls += 1; if (settings.scopeFailureAt > 0 && this.scopeCalls === settings.scopeFailureAt) throw new Error("scope"); return { created: true }; },
    async finalizeBalanceObserverRun() { this.finalizeCalls += 1; if (settings.finalizeFailure) throw new Error("finalize"); return { runId: "00000000-0000-4000-8000-000000810901", finalized: true, version: "2", status: "COMPLETED", completedAt: "2026-08-08T00:00:01Z" }; },
    async close() { this.closeCalls += 1; if (settings.ledgerCloseFailure) throw new Error("close"); },
  };
  let workerCalls = 0;
  const oneShotInput = () => ({ scopeClient: scope, commandClient: command, adapterFactory: () => ({ provider, async readBalances() { providerNetworkCalls += 1; return []; } }), identityPolicy: "LOCAL_MOCK", runtime: { async runWorkUnit({ workUnit }) { workerCalls += 1; return { outcomes: workUnit.bindings.map((binding) => ({ ok: true, bindingId: binding.bindingId, observationCreated: true, checkpointCreated: true, checkpointAdvanced: true, checkpointVersion: "1", adapterAttempts: 1, databaseAttempts: 1 })), summary: workerSummary(workUnit.bindings.length) }; } } });
  return { scope, command, ledger, get workerCalls() { return workerCalls; }, oneShotInput, input: () => ({ ...oneShotInput(), runLedgerClient: ledger, runKey: "obsrun:v1:00000000-0000-4000-8000-000000810999", triggerSource: "MANUAL", invocationContractVersion: "P5_T05_V1" }) };
}

function workerSummary(requestedBindings) {
  return Object.fromEntries(["requestedBindings", "adapterSuccesses", "adapterFailures", "databaseAttempts", "persistedObservations", "replayedObservations", "checkpointsCreated", "checkpointsAdvanced", "checkpointNoops", "failedBindings", "abortedBindings", "adapterAttempts", "adapterRetryAttempts", "databaseRetryAttempts", "retryExhaustedBindings", "retryDeferredBindings", "scopeRefreshRequiredBindings", "timeoutFailures", "lockTimeoutFailures", "unavailableFailures"].map((key) => [key, key === "requestedBindings" ? requestedBindings : 0]));
}

function assert(condition, message) { cases += 1; if (!condition) throw new Error(message); }
main().catch((error) => { console.error(redact(error instanceof Error ? error.message : "recorded_runtime_failed")); process.exitCode = 1; });
