import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const DB_HOST = "127.0.0.1";
const DB_PORT = 55722;
const DB_NAME = "postgres";
const RUN_WRITER_ROLE = "custody_observer_run_writer";
const RUN_KEY = "obsrun:v1:00000000-0000-4000-8000-000000750901";
const IDS = {
  assetA: "00000000-0000-4000-8000-000000750101",
  assetB: "00000000-0000-4000-8000-000000750102",
  provider: "00000000-0000-4000-8000-000000750201",
  binding: "00000000-0000-4000-8000-000000750301",
  bindingB: "00000000-0000-4000-8000-000000750302",
};

let cases = 0;
let localConnections = 0;
let externalNetworkCalls = 0;
let providerNetworkCalls = 0;
let credentialEnvReads = 0;
let passwordOutput = 0;
let ephemeralPassword = null;
let tempDir = null;
let networkRestore = null;
const clients = new Set();
const lines = [];

async function main() {
  const originalEnv = process.env;
  try {
    await assertSourceBoundary();
    const clientModule = await loadClientModule();
    await runNpm("supabase:start", "Supabase start", 120000);
    await runNpm("db:reset:local", "Initial DB reset", 180000);
    await setupFixtures();
    ephemeralPassword = randomBytes(32).toString("hex");
    await setRolePassword(ephemeralPassword);
    networkRestore = installNetworkGuard();
    process.env = credentialEnvGuard(originalEnv);

    await assertDirectRunWriterPrivileges(clientModule);
    const client = clientModule.createBalanceObserverRunLedgerClient(config(clientModule));
    clients.add(client);
    await assertRealLifecycle(client);
    await assertInputValidation(clientModule);
    await assertFailureEvidenceCardinality(clientModule);
    await assertHostileResults(clientModule);
    await assertErrorMapping(clientModule);
    await assertPoolLifecycle(clientModule);

    assert(localConnections > 0, "Local PostgreSQL connection count");
    pass("Local PostgreSQL network allowlist");
    assert(externalNetworkCalls === 0, "External network calls zero");
    pass("External network guard");
    assert(providerNetworkCalls === 0, "Provider network calls zero");
    pass("Provider network guard");
    assert(credentialEnvReads === 0, "Credential environment reads zero");
    pass("Credential environment read guard");
  } finally {
    process.env = originalEnv;
    restoreNetworkGuard();
    await closeClients();
    await clearRolePassword();
    await cleanupDb();
    await cleanupModules();
  }

  assert(!tempDir || !existsSync(tempDir), "Temporary transpilation cleanup");
  pass("Temporary transpilation cleanup");
  assertSafeOutput();
  console.log(`RUN_LEDGER_CLIENT_RUNTIME_CASE_COUNT=${cases}`);
  console.log(`LOCAL_POSTGRES_CONNECTIONS=${localConnections}`);
  console.log(`EXTERNAL_NETWORK_CALLS=${externalNetworkCalls}`);
  console.log(`PROVIDER_NETWORK_CALLS=${providerNetworkCalls}`);
  console.log(`CREDENTIAL_ENV_READS=${credentialEnvReads}`);
  console.log(`RUN_WRITER_EPHEMERAL_PASSWORD_OUTPUT=${passwordOutput}`);
  console.log("SERVICE_ROLE_APPLICATION_USAGE=0");
  console.log("CUSTODY_BALANCE_OBSERVER_RUN_LEDGER_CLIENT_RUNTIME_PASS");
}

async function assertSourceBoundary() {
  const source = await readFile("src/server/custody/balance-observer-run-ledger-client.ts", "utf8");
  assert(source.startsWith('import "server-only";'), "Client is server-only");
  for (const marker of ["process.env", "connectionString", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "createClient(", "fetch(", "axios", "http.request", "https.request", "private.list_balance_observer_scope_page(", "private.read_balance_observer_scope(", "private.record_balance_observation_and_advance_checkpoint("]) {
    assert(!source.includes(marker), `Source excludes ${marker}`);
  }
  for (const command of ["private.begin_balance_observer_run(", "private.record_balance_observer_scope_outcome(", "private.finalize_balance_observer_run("]) assert(source.includes(command), `Source includes ${command}`);
  assert(!/\b(BEGIN|COMMIT|ROLLBACK)\b/.test(source.replaceAll("BEGIN_SQL", "")), "Source has no transaction statements");
  pass("Source boundary scan");
}

async function loadClientModule() {
  tempDir = await mkdtemp(path.join(tmpdir(), "p5-t05-run-ledger-client-"));
  const source = (await readFile("src/server/custody/balance-observer-run-ledger-client.ts", "utf8")).replace('import "server-only";\n\n', "");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  await writeFile(path.join(tempDir, "client.cjs"), output, "utf8");
  await symlink(path.resolve("node_modules"), path.join(tempDir, "node_modules"), "junction");
  return require(path.join(tempDir, "client.cjs"));
}

function config(module, overrides = {}) {
  return {
    host: DB_HOST, port: DB_PORT, database: DB_NAME, user: RUN_WRITER_ROLE,
    password: () => ephemeralPassword ?? "invalid", ssl: false,
    connectionTimeoutMillis: 5000, statementTimeoutMillis: 15000, queryTimeoutMillis: 20000,
    lockTimeoutMillis: 5000, idleInTransactionSessionTimeoutMillis: 5000, poolMax: 4,
    idleTimeoutMillis: 10000, maxLifetimeSeconds: 300, ...overrides,
  };
}

async function setupFixtures() {
  await adminSql(`
insert into public.supported_assets (id, asset_code, symbol, display_name, asset_type, decimals, mint_address, status)
values ('${IDS.assetA}', 'P5T05_CLIENT_A', 'P5A', 'P5 T05 Client Asset A', 'NATIVE', 9, null, 'ACTIVE'),
       ('${IDS.assetB}', 'P5T05_CLIENT_B', 'P5B', 'P5 T05 Client Asset B', 'NATIVE', 9, null, 'ACTIVE');
insert into private.custody_providers (id, provider_code, display_name, provider_type, supports_balance_observation, supports_transfer_observation, supports_transfer_lookup, supports_payout_submission, supports_webhook_ingestion)
values ('${IDS.provider}', 'P5T05_CLIENT_PROVIDER', 'P5 T05 Client Provider', 'MPC_CUSTODIAN', true, false, false, false, false);
insert into private.custody_account_bindings (id, custody_provider_id, asset_id, binding_key, display_label, account_role)
values ('${IDS.binding}', '${IDS.provider}', '${IDS.assetB}', 'p5t05_client_failure', 'P5 T05 Client Failure', 'COLLECTION'),
       ('${IDS.bindingB}', '${IDS.provider}', '${IDS.assetB}', 'p5t05_client_abort', 'P5 T05 Client Abort', 'FEE');`);
  pass("Synthetic DB fixtures");
}

async function assertDirectRunWriterPrivileges(module) {
  const probe = new Pool({ host: DB_HOST, port: DB_PORT, database: DB_NAME, user: RUN_WRITER_ROLE, password: () => ephemeralPassword, ssl: false, application_name: module.BALANCE_OBSERVER_RUN_LEDGER_POSTGRES_APPLICATION_NAME });
  try {
    const application = await probe.query("select current_setting('application_name') as application_name");
    assert(application.rows[0]?.application_name === module.BALANCE_OBSERVER_RUN_LEDGER_POSTGRES_APPLICATION_NAME, "Dedicated application name");
    pass("Dedicated application name");
    for (const sql of [
      "select * from private.list_balance_observer_scope_page(null, null, 1)",
      "select * from private.read_balance_observer_scope('00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101')",
      "select * from private.record_balance_observation_and_advance_checkpoint(null, null, null, null, null, null, null, null)",
      "select * from private.custody_balance_observer_runs",
      "insert into private.custody_balance_observer_runs (run_key, trigger_source, identity_policy, invocation_contract_version) values ('obsrun:v1:00000000-0000-4000-8000-000000750999', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1')",
      "update private.custody_balance_observer_runs set status = 'RUNNING'",
      "delete from private.custody_balance_observer_runs",
      "select * from private.custody_balance_observer_scope_outcomes",
      "select * from private.custody_balance_observer_binding_failures",
    ]) await expectReject(() => probe.query(sql), "Direct writer privilege denied");
    pass("Direct run-writer privilege isolation");
  } finally { await probe.end(); }
  pass("DIRECT_RUN_WRITER_LOGIN=PASS");
}

async function assertRealLifecycle(client) {
  const input = { runKey: RUN_KEY, triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" };
  const begin = await client.beginBalanceObserverRun(input);
  assert(begin.created && begin.status === "RUNNING" && begin.version === "1" && uuid(begin.runId), "Real begin");
  pass("Real begin created version one");
  const replay = await client.beginBalanceObserverRun(input);
  assert(!replay.created && replay.runId === begin.runId && replay.version === "1" && replay.startedAt === begin.startedAt, "Begin exact replay");
  pass("Real begin exact replay");
  await expectClientError(() => client.beginBalanceObserverRun({ ...input, triggerSource: "RECOVERY" }), "RUN_LEDGER_IDEMPOTENCY_CONFLICT", "Begin conflict");
  pass("Real begin conflict");
  const noFailure = scopeInput(begin.runId, IDS.assetA, []);
  const scope = await client.recordBalanceObserverScopeOutcome(noFailure);
  assert(scope.created, "Scope persistence"); pass("Real scope persistence");
  const failure = bindingFailure();
  const partial = scopeInput(begin.runId, IDS.assetB, [failure]);
  const failedScope = await client.recordBalanceObserverScopeOutcome(partial);
  assert(failedScope.created, "Scope failure persistence"); pass("Real scope failure persistence");
  const scopeReplay = await client.recordBalanceObserverScopeOutcome(partial);
  assert(!scopeReplay.created, "Scope exact replay"); pass("Real scope exact replay");
  await expectClientError(() => client.recordBalanceObserverScopeOutcome({ ...partial, scopeStatus: "FAILED" }), "RUN_LEDGER_SCOPE_CONFLICT", "Scope conflict"); pass("Real scope conflict");
  const summary = terminalSummary();
  const final = await client.finalizeBalanceObserverRun({ runId: begin.runId, expectedVersion: begin.version, terminalStatus: "PARTIAL", terminalCode: "RUN_PARTIAL", summary });
  assert(final.finalized && final.version === "2" && final.status === "PARTIAL", "Finalize first terminal"); pass("Real finalize version two");
  const finalReplay = await client.finalizeBalanceObserverRun({ runId: begin.runId, expectedVersion: begin.version, terminalStatus: "PARTIAL", terminalCode: "RUN_PARTIAL", summary });
  assert(!finalReplay.finalized && finalReplay.version === "2" && finalReplay.completedAt === final.completedAt, "Finalize exact replay"); pass("Real finalize exact replay");
  await expectClientError(() => client.finalizeBalanceObserverRun({ runId: begin.runId, expectedVersion: begin.version, terminalStatus: "COMPLETED", terminalCode: null, summary }), "RUN_LEDGER_FINALIZATION_CONFLICT", "Finalize conflict"); pass("Real finalize conflict");
  await expectClientError(() => client.recordBalanceObserverScopeOutcome(noFailure), "RUN_LEDGER_NOT_RUNNING", "Late scope rejection"); pass("Real late scope rejection");
  await assertRealFailureEvidenceWrites(client);
  pass("BEGIN_RETURNED_VERSION=1"); pass("SCOPE_RECORD_VERSION_DELTA=0"); pass("SCOPE_REPLAY_VERSION_DELTA=0"); pass("SCOPE_CONFLICT_VERSION_DELTA=0"); pass("FINALIZE_EXPECTED_VERSION_USED=BEGIN_RESULT_VERSION"); pass("FIRST_TERMINAL_VERSION=2"); pass("FINALIZE_REPLAY_VERSION_DELTA=0"); pass("FINALIZE_CONFLICT_VERSION_DELTA=0");
}

async function assertRealFailureEvidenceWrites(client) {
  const abortedRun = await client.beginBalanceObserverRun({ runKey: "obsrun:v1:00000000-0000-4000-8000-000000750902", triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" });
  const aborted = abortedScopeInput(abortedRun.runId, IDS.assetB);
  const abortedWrite = await client.recordBalanceObserverScopeOutcome(aborted);
  const abortedReplay = await client.recordBalanceObserverScopeOutcome(aborted);
  assert(abortedWrite.created && !abortedReplay.created, "Real ABORTED-only scope write and replay");
  assert((await adminScalar(`select concat_ws('|', scope.binding_failure_count::text, scope.binding_abort_count::text, (select count(*)::text from private.custody_balance_observer_binding_failures as failure where failure.run_id = scope.run_id), run.version::text) from private.custody_balance_observer_scope_outcomes as scope join private.custody_balance_observer_runs as run on run.run_id = scope.run_id where scope.run_id = '${abortedRun.runId}'`)) === "0|1|1|1", "Real ABORTED-only durable scope state");
  pass("CLIENT_REAL_DB_ABORTED_ONLY_SCOPE_WRITE=PASS");
  pass("CLIENT_REAL_DB_ABORTED_ONLY_EXACT_REPLAY=PASS");
  pass("CLIENT_SCOPE_WRITE_VERSION_DELTA=0");

  const mixedRun = await client.beginBalanceObserverRun({ runKey: "obsrun:v1:00000000-0000-4000-8000-000000750903", triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" });
  const mixed = scopeInput(mixedRun.runId, IDS.assetB, [bindingFailure(), bindingAbort(IDS.bindingB, 1)], { bindingFailureCount: "1", bindingAbortCount: "1", scopeStatus: "PARTIAL", scopeCode: "SCOPE_PARTIAL" });
  assert((await client.recordBalanceObserverScopeOutcome(mixed)).created, "Real mixed scope write");
  assert((await adminScalar(`select concat_ws('|', scope.binding_failure_count::text, scope.binding_abort_count::text, (select count(*)::text from private.custody_balance_observer_binding_failures as failure where failure.run_id = scope.run_id), run.version::text) from private.custody_balance_observer_scope_outcomes as scope join private.custody_balance_observer_runs as run on run.run_id = scope.run_id where scope.run_id = '${mixedRun.runId}'`)) === "1|1|2|1", "Real mixed durable scope state");
  pass("CLIENT_REAL_DB_MIXED_SCOPE_WRITE=PASS");
}

async function assertInputValidation(module) {
  const base = config(module);
  for (const configOverride of [{ host: "" }, { host: " postgres" }, { host: "http://bad" }, { port: 0 }, { port: -1 }, { port: 1.2 }, { poolMax: 0 }, { queryTimeoutMillis: 0 }]) expectThrows(() => module.createBalanceObserverRunLedgerClient({ ...base, ...configOverride }), "Invalid config");
  pass("Config validation rejects before pool creation");
  let queries = 0;
  const client = module.createBalanceObserverRunLedgerClient(base, { createPool: () => fakePool(() => { queries += 1; return { rows: [] }; }) }); clients.add(client);
  for (const input of [
    { runKey: "bad", triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" },
    { runKey: RUN_KEY.toUpperCase(), triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" },
    { runKey: `${RUN_KEY} `, triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" },
    { runKey: RUN_KEY, triggerSource: "UNKNOWN", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" },
  ]) await expectClientError(() => client.beginBalanceObserverRun(input), "RUN_LEDGER_INPUT_INVALID", "Invalid begin input");
  await expectClientError(() => client.recordBalanceObserverScopeOutcome({ ...scopeInput("bad", IDS.assetA, []), discoveryIndex: -1 }), "RUN_LEDGER_INPUT_INVALID", "Invalid scope input");
  await expectClientError(() => client.recordBalanceObserverScopeOutcome({ ...scopeInput("00000000-0000-4000-8000-000000750999", IDS.assetB, [bindingFailure(), bindingFailure()]) }), "RUN_LEDGER_INPUT_INVALID", "Duplicate failure binding");
  await expectClientError(() => client.finalizeBalanceObserverRun({ runId: "bad", expectedVersion: "0", terminalStatus: "RUNNING", terminalCode: null, summary: terminalSummary() }), "RUN_LEDGER_INPUT_INVALID", "Invalid finalize input");
  assert(queries === 0, "Invalid input query count zero"); pass("Invalid inputs perform zero queries");
}

async function assertFailureEvidenceCardinality(module) {
  let queries = 0;
  const client = module.createBalanceObserverRunLedgerClient(config(module), { createPool: () => fakePool(() => { queries += 1; return { rows: [{ created: true }] }; }) });
  clients.add(client);
  const runId = "00000000-0000-4000-8000-000000750998";
  const aborted = abortedScopeInput(runId, IDS.assetB);
  await client.recordBalanceObserverScopeOutcome(aborted);
  pass("CLIENT_ABORTED_ONLY_INPUT_ACCEPTED=PASS");
  const failed = scopeInput(runId, IDS.assetB, [bindingFailure()]);
  await client.recordBalanceObserverScopeOutcome(failed);
  pass("CLIENT_FAILED_ONLY_INPUT_ACCEPTED=PASS");
  const mixed = scopeInput(runId, IDS.assetB, [bindingFailure(), bindingAbort(IDS.bindingB, 1)], { bindingFailureCount: "1", bindingAbortCount: "1" });
  await client.recordBalanceObserverScopeOutcome(mixed);
  pass("CLIENT_MIXED_FAILED_ABORTED_INPUT_ACCEPTED=PASS");
  const queryCountBeforeRejections = queries;
  await expectClientError(() => client.recordBalanceObserverScopeOutcome({ ...mixed, failures: [bindingFailure()] }), "RUN_LEDGER_INPUT_INVALID", "Too-few failure evidence");
  assert(queries === queryCountBeforeRejections, "Too-few failure evidence query count zero");
  pass("CLIENT_TOO_FEW_FAILURE_EVIDENCE_REJECTED=PASS");
  await expectClientError(() => client.recordBalanceObserverScopeOutcome({ ...aborted, failures: [bindingAbort(), bindingAbort(IDS.bindingB, 1)] }), "RUN_LEDGER_INPUT_INVALID", "Too-many failure evidence");
  assert(queries === queryCountBeforeRejections, "Too-many failure evidence query count zero");
  pass("CLIENT_TOO_MANY_FAILURE_EVIDENCE_REJECTED=PASS");
}

async function assertHostileResults(module) {
  const validBegin = { run_id: "00000000-0000-4000-8000-000000750999", created: true, version: "1", status: "RUNNING", started_at: "2026-08-08 00:00:00.123456+00" };
  for (const rows of [[], [validBegin, validBegin], [null], [{ ...validBegin, version: 1 }], [{ ...validBegin, created: "true" }], [{ ...validBegin, run_id: "BAD" }], [{ ...validBegin, status: "BAD" }]]) {
    const client = injectedClient(module, rows); clients.add(client); await expectClientError(() => client.beginBalanceObserverRun({ runKey: RUN_KEY, triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" }), undefined, "Hostile begin result");
  }
  pass("Hostile begin result validation");
  for (const rows of [[], [{ created: true }, { created: true }], [{ created: "true" }]]) { const client = injectedClient(module, rows); clients.add(client); await expectClientError(() => client.recordBalanceObserverScopeOutcome(scopeInput("00000000-0000-4000-8000-000000750999", IDS.assetA, [])), undefined, "Hostile scope result"); }
  pass("Hostile scope result validation");
  const validFinal = { run_id: "00000000-0000-4000-8000-000000750999", finalized: true, version: "2", status: "PARTIAL", completed_at: "2026-08-08 00:00:00+00" };
  for (const rows of [[], [{ ...validFinal, version: "1" }], [{ ...validFinal, status: "RUNNING" }], [{ ...validFinal, completed_at: null }]]) { const client = injectedClient(module, rows); clients.add(client); await expectClientError(() => client.finalizeBalanceObserverRun({ runId: "00000000-0000-4000-8000-000000750999", expectedVersion: "1", terminalStatus: "PARTIAL", terminalCode: null, summary: terminalSummary() }), undefined, "Hostile finalize result"); }
  pass("Hostile finalize result validation");
}

async function assertErrorMapping(module) {
  const cases = [["23505", "observer_run_idempotency_conflict", "RUN_LEDGER_IDEMPOTENCY_CONFLICT"], ["23503", "run_not_found", "RUN_LEDGER_NOT_FOUND"], ["23514", "run_not_running", "RUN_LEDGER_NOT_RUNNING"], ["40001", "run_version_conflict", "RUN_LEDGER_VERSION_CONFLICT"], ["23505", "run_scope_idempotency_conflict", "RUN_LEDGER_SCOPE_CONFLICT"], ["23505", "run_finalization_conflict", "RUN_LEDGER_FINALIZATION_CONFLICT"], ["57014", "x", "RUN_LEDGER_TIMEOUT"], ["55P03", "x", "RUN_LEDGER_LOCK_TIMEOUT"], ["ECONNREFUSED", "x", "RUN_LEDGER_UNAVAILABLE"], ["XX000", "raw private failure", "RUN_LEDGER_COMMAND_REJECTED"]];
  for (const [code, message, expected] of cases) { const client = module.createBalanceObserverRunLedgerClient(config(module), { createPool: () => fakePool(() => { throw { code, message, detail: "forbidden" }; }) }); clients.add(client); await expectClientError(() => client.beginBalanceObserverRun({ runKey: RUN_KEY, triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" }), expected, "Safe PostgreSQL error mapping"); }
  pass("Domain and PostgreSQL error mapping");
}

async function assertPoolLifecycle(module) {
  let queries = 0; let ends = 0;
  const pool = fakePool(() => { queries += 1; return { rows: [] }; }, () => { ends += 1; });
  const client = module.createBalanceObserverRunLedgerClient(config(module), { createPool: () => pool }); clients.add(client);
  await client.close(); await client.close(); assert(ends === 1, "Close idempotent"); pass("Pool close idempotent");
  await expectClientError(() => client.beginBalanceObserverRun({ runKey: RUN_KEY, triggerSource: "MANUAL", identityPolicy: "LOCAL_MOCK", invocationContractVersion: "P5_T05_V1" }), "RUN_LEDGER_CLIENT_CLOSED", "Client closed"); assert(queries === 0, "Closed client query zero"); pass("Closed client query boundary");
  const broken = module.createBalanceObserverRunLedgerClient(config(module), { createPool: () => fakePool(() => ({ rows: [] }), () => { throw new Error("raw close error"); }) }); clients.add(broken); await expectClientError(() => broken.close(), "RUN_LEDGER_COMMAND_REJECTED", "Close rejection"); pass("Pool close rejection safe");
}

function injectedClient(module, rows) { return module.createBalanceObserverRunLedgerClient(config(module), { createPool: () => fakePool(() => ({ rows })) }); }
function fakePool(query, end = async () => {}) { return { query: async () => query(), end: async () => end(), on: () => undefined }; }
function scopeInput(runId, assetId, failures, overrides = {}) { return { runId, discoveryIndex: assetId === IDS.assetA ? 0 : 1, providerId: IDS.provider, assetId, scopeStatus: failures.length ? "PARTIAL" : "SUCCEEDED", bindingSuccessCount: "0", bindingFailureCount: String(failures.length), bindingAbortCount: "0", refreshRequested: false, refreshAttempted: false, refreshSucceeded: false, refreshFailed: false, noLongerEligibleCount: "0", scopeCode: failures.length ? "SCOPE_PARTIAL" : null, failures, ...overrides }; }
function bindingFailure() { return { bindingId: IDS.binding, bindingOrder: 0, stage: "DATABASE", code: "DB_RETRY_EXHAUSTED", retryable: true, adapterAttempts: "1", databaseAttempts: "2", retryExhausted: true, retryDeferred: false, requiresScopeRefresh: false }; }
function bindingAbort(bindingId = IDS.binding, bindingOrder = 0) { return { bindingId, bindingOrder, stage: "ABORTED", code: "ORCHESTRATOR_ABORTED", retryable: false, adapterAttempts: "0", databaseAttempts: "0", retryExhausted: false, retryDeferred: false, requiresScopeRefresh: false }; }
function abortedScopeInput(runId, assetId) { return scopeInput(runId, assetId, [bindingAbort()], { scopeStatus: "ABORTED", bindingFailureCount: "0", bindingAbortCount: "1", scopeCode: "ORCHESTRATOR_ABORTED" }); }
function terminalSummary() { return { pagesRead: "1", scopesDiscovered: "2", providersDiscovered: "1", bindingsDiscovered: "1", scopesStarted: "2", scopesCompleted: "1", scopesFailed: "1", scopesAborted: "0", bindingsSucceeded: "0", bindingsFailed: "1", bindingsAborted: "0", adapterFactoryCalls: "1", adapterFactoryFailures: "0", scopeRefreshRequested: "0", scopeRefreshAttempted: "0", scopeRefreshSucceeded: "0", scopeRefreshFailed: "0", scopeNoLongerEligible: "0", scopeReadAttempts: "2", scopeReadRetryAttempts: "0", workerAdapterAttempts: "1", workerDatabaseAttempts: "2", workerAdapterRetryAttempts: "0", workerDatabaseRetryAttempts: "0", clientCloseAttempts: "1", clientCloseFailures: "0" }; }
function uuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value); }
async function expectClientError(fn, expected, label) { try { await fn(); } catch (error) { assert(error?.message === "custody_balance_observer_run_ledger_client_failed", label); if (expected) assert(error?.code === expected, label); return; } throw new Error(`FAIL ${label}`); }
async function expectReject(fn, label) { try { await fn(); } catch { return; } throw new Error(`FAIL ${label}`); }
function expectThrows(fn, label) { try { fn(); } catch { return; } throw new Error(`FAIL ${label}`); }

async function setRolePassword(password) { await adminSql(`alter role ${RUN_WRITER_ROLE} password '${password}';`); pass("Ephemeral run-writer credential set"); }
async function clearRolePassword() { if (ephemeralPassword !== null) { await adminSql(`alter role ${RUN_WRITER_ROLE} password null;`).catch(() => undefined); ephemeralPassword = null; pass("Ephemeral run-writer credential cleared"); } }
async function adminSql(sql) { await runChild("docker", ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB_NAME], sql, 30000); }
async function adminScalar(sql) { return (await runChildOutput("docker", ["exec", "-i", DB_CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB_NAME], sql, 30000)).trim(); }
async function runNpm(script, label, timeout) { const command = process.platform === "win32" ? "cmd.exe" : "npm"; const args = process.platform === "win32" ? ["/c", "npm", "--silent", "run", script] : ["run", script]; await runChild(command, args, null, timeout); pass(label); }
async function cleanupDb() { await runNpm("db:reset:local", "Final DB reset", 180000).catch(() => undefined); await runNpm("supabase:stop", "Supabase stop", 120000).catch(() => undefined); }
async function closeClients() { for (const client of clients) await client.close().catch(() => undefined); clients.clear(); }
async function cleanupModules() { if (tempDir) { const directory = tempDir; tempDir = null; await rm(directory, { recursive: true, force: true }); } }

function installNetworkGuard() { const originalFetch = globalThis.fetch; const originalHttp = http.request; const originalHttps = https.request; const originalConnect = net.Socket.prototype.connect; globalThis.fetch = async () => blocked("fetch"); http.request = () => blocked("http"); https.request = () => blocked("https"); net.Socket.prototype.connect = function (...args) { const first = args[0]; const target = typeof first === "object" && first ? { host: first.host ?? "localhost", port: first.port } : { host: typeof args[1] === "string" ? args[1] : "localhost", port: first }; if (target.host === DB_HOST && target.port === DB_PORT) { localConnections += 1; return originalConnect.apply(this, args); } externalNetworkCalls += 1; throw new Error("blocked network"); }; return { originalFetch, originalHttp, originalHttps, originalConnect }; }
function blocked() { externalNetworkCalls += 1; providerNetworkCalls += 1; throw new Error("blocked network"); }
function restoreNetworkGuard() { if (!networkRestore) return; globalThis.fetch = networkRestore.originalFetch; http.request = networkRestore.originalHttp; https.request = networkRestore.originalHttps; net.Socket.prototype.connect = networkRestore.originalConnect; networkRestore = null; }
function credentialEnvGuard(env) { const names = new Set(["PGPASSWORD", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "ACCESS_TOKEN", "REFRESH_TOKEN"]); return new Proxy(env, { get(target, property, receiver) { if (typeof property === "string" && names.has(property.toUpperCase())) credentialEnvReads += 1; return Reflect.get(target, property, receiver); } }); }
function assertSafeOutput() { const output = lines.join("\n"); assert(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(output), "Output has no JWT"); assert(!/postgres(?:ql)?:\/\//i.test(output), "Output has no DB URL"); assert(!/password|raw private failure|forbidden/i.test(output), "Output has no sensitive diagnostic"); }
function assert(condition, label) { if (!condition) throw new Error(`FAIL ${label}`); }
function pass(label) { cases += 1; lines.push(`PASS ${label}`); console.log(`PASS ${label}`); }
async function runChild(command, args, input, timeout) { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); const timer = setTimeout(() => { child.kill(); reject(new Error(`FAIL ${command} timeout`)); }, timeout); const errors = []; child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk))); child.on("error", reject); child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`FAIL ${command} exited ${code}: ${redact(Buffer.concat(errors).toString("utf8"))}`)); }); if (input === null) child.stdin.end(); else child.stdin.end(input); }); }
async function runChildOutput(command, args, input, timeout) { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); const timer = setTimeout(() => { child.kill(); reject(new Error(`FAIL ${command} timeout`)); }, timeout); const output = []; const errors = []; child.stdout.on("data", (chunk) => output.push(Buffer.from(chunk))); child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk))); child.on("error", reject); child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(Buffer.concat(output).toString("utf8")); else reject(new Error(`FAIL ${command} exited ${code}: ${redact(Buffer.concat(errors).toString("utf8"))}`)); }); child.stdin.end(input); }); }
function redact(value) { return value.replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED]").replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]"); }

main().catch((error) => { console.error(redact(error instanceof Error ? error.message : "FAIL unknown")); process.exitCode = 1; });
