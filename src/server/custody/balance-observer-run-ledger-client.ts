import "server-only";

import { Pool } from "pg";
import type { PoolConfig, QueryResult, QueryResultRow } from "pg";

export const BALANCE_OBSERVER_RUN_LEDGER_POSTGRES_APPLICATION_NAME =
  "staking-wallet-balance-observer-run-ledger-v1";

export const DEFAULT_CUSTODY_OBSERVER_RUN_LEDGER_POSTGRES_LIMITS = {
  connectionTimeoutMillis: 5_000,
  statementTimeoutMillis: 15_000,
  queryTimeoutMillis: 20_000,
  lockTimeoutMillis: 5_000,
  idleInTransactionSessionTimeoutMillis: 5_000,
  poolMax: 4,
  idleTimeoutMillis: 10_000,
  maxLifetimeSeconds: 300,
} as const;

export type CustodyObserverRunLedgerPostgresConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string | (() => string | Promise<string>);
  ssl: false | PoolConfig["ssl"];
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
  queryTimeoutMillis: number;
  lockTimeoutMillis: number;
  idleInTransactionSessionTimeoutMillis: number;
  poolMax: number;
  idleTimeoutMillis: number;
  maxLifetimeSeconds: number;
};

export type BeginBalanceObserverRunInput = {
  runKey: string;
  triggerSource: "MANUAL" | "SCHEDULED" | "BACKFILL" | "RECOVERY";
  identityPolicy: "PRODUCTION" | "LOCAL_MOCK";
  invocationContractVersion: "P5_T05_V1";
};

export type BeginBalanceObserverRunResult = {
  runId: string;
  created: boolean;
  version: string;
  status: "RUNNING" | "COMPLETED" | "PARTIAL" | "ABORTED" | "FAILED_DISCOVERY" | "FAILED_CLEANUP";
  startedAt: string;
};

export type CustodyBalanceObserverBindingFailure = {
  bindingId: string;
  bindingOrder: number;
  stage:
    | "DISCOVERY"
    | "FACTORY"
    | "ADAPTER"
    | "VALIDATION"
    | "IDENTITY"
    | "DATABASE"
    | "REFRESH"
    | "WORKER"
    | "CLEANUP"
    | "ABORTED";
  code: string;
  retryable: boolean;
  adapterAttempts: BigintInput;
  databaseAttempts: BigintInput;
  retryExhausted: boolean;
  retryDeferred: boolean;
  requiresScopeRefresh: boolean;
};

export type RecordBalanceObserverScopeOutcomeInput = {
  runId: string;
  discoveryIndex: number;
  providerId: string;
  assetId: string;
  scopeStatus: "SUCCEEDED" | "PARTIAL" | "FAILED" | "ABORTED";
  bindingSuccessCount: BigintInput;
  bindingFailureCount: BigintInput;
  bindingAbortCount: BigintInput;
  refreshRequested: boolean;
  refreshAttempted: boolean;
  refreshSucceeded: boolean;
  refreshFailed: boolean;
  noLongerEligibleCount: BigintInput;
  scopeCode: string | null;
  failures: readonly CustodyBalanceObserverBindingFailure[];
};

export type RecordBalanceObserverScopeOutcomeResult = { created: boolean };

export type CustodyBalanceObserverDurableRunSummary = {
  pagesRead: BigintInput;
  scopesDiscovered: BigintInput;
  providersDiscovered: BigintInput;
  bindingsDiscovered: BigintInput;
  scopesStarted: BigintInput;
  scopesCompleted: BigintInput;
  scopesFailed: BigintInput;
  scopesAborted: BigintInput;
  bindingsSucceeded: BigintInput;
  bindingsFailed: BigintInput;
  bindingsAborted: BigintInput;
  adapterFactoryCalls: BigintInput;
  adapterFactoryFailures: BigintInput;
  scopeRefreshRequested: BigintInput;
  scopeRefreshAttempted: BigintInput;
  scopeRefreshSucceeded: BigintInput;
  scopeRefreshFailed: BigintInput;
  scopeNoLongerEligible: BigintInput;
  scopeReadAttempts: BigintInput;
  scopeReadRetryAttempts: BigintInput;
  workerAdapterAttempts: BigintInput;
  workerDatabaseAttempts: BigintInput;
  workerAdapterRetryAttempts: BigintInput;
  workerDatabaseRetryAttempts: BigintInput;
  clientCloseAttempts: BigintInput;
  clientCloseFailures: BigintInput;
};

export type FinalizeBalanceObserverRunInput = {
  runId: string;
  expectedVersion: BigintInput;
  terminalStatus: "COMPLETED" | "PARTIAL" | "ABORTED" | "FAILED_DISCOVERY" | "FAILED_CLEANUP";
  terminalCode: string | null;
  summary: CustodyBalanceObserverDurableRunSummary;
};

export type FinalizeBalanceObserverRunResult = {
  runId: string;
  finalized: boolean;
  version: string;
  status: "COMPLETED" | "PARTIAL" | "ABORTED" | "FAILED_DISCOVERY" | "FAILED_CLEANUP";
  completedAt: string;
};

export type BigintInput = string | number;

export type CustodyBalanceObserverRunLedgerClientErrorCode =
  | "RUN_LEDGER_INPUT_INVALID"
  | "RUN_LEDGER_IDEMPOTENCY_CONFLICT"
  | "RUN_LEDGER_NOT_FOUND"
  | "RUN_LEDGER_NOT_RUNNING"
  | "RUN_LEDGER_VERSION_CONFLICT"
  | "RUN_LEDGER_SCOPE_CONFLICT"
  | "RUN_LEDGER_FINALIZATION_CONFLICT"
  | "RUN_LEDGER_CONNECTION_FAILED"
  | "RUN_LEDGER_TIMEOUT"
  | "RUN_LEDGER_LOCK_TIMEOUT"
  | "RUN_LEDGER_UNAVAILABLE"
  | "RUN_LEDGER_COMMAND_REJECTED"
  | "RUN_LEDGER_RESULT_COUNT_INVALID"
  | "RUN_LEDGER_RESULT_SHAPE_INVALID"
  | "RUN_LEDGER_RESULT_INVALID"
  | "RUN_LEDGER_CLIENT_CLOSED";

export class CustodyBalanceObserverRunLedgerClientError extends Error {
  readonly code: CustodyBalanceObserverRunLedgerClientErrorCode;
  readonly retryable: boolean;

  constructor(code: CustodyBalanceObserverRunLedgerClientErrorCode, retryable: boolean) {
    super("custody_balance_observer_run_ledger_client_failed");
    this.name = "CustodyBalanceObserverRunLedgerClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type CustodyBalanceObserverRunLedgerPool = {
  query<T extends QueryResultRow = QueryResultRow>(query: { text: string; values?: readonly unknown[] }): Promise<QueryResult<T>>;
  end(): Promise<void>;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

export type CustodyBalanceObserverRunLedgerClientRuntime = {
  createPool?: (config: PoolConfig) => CustodyBalanceObserverRunLedgerPool;
};

export type CustodyBalanceObserverRunLedgerClient = {
  beginBalanceObserverRun(input: BeginBalanceObserverRunInput): Promise<BeginBalanceObserverRunResult>;
  recordBalanceObserverScopeOutcome(input: RecordBalanceObserverScopeOutcomeInput): Promise<RecordBalanceObserverScopeOutcomeResult>;
  finalizeBalanceObserverRun(input: FinalizeBalanceObserverRunInput): Promise<FinalizeBalanceObserverRunResult>;
  close(): Promise<void>;
};

type BeginRow = QueryResultRow & { run_id: unknown; created: unknown; version: unknown; status: unknown; started_at: unknown };
type ScopeRow = QueryResultRow & { created: unknown };
type FinalizeRow = QueryResultRow & { run_id: unknown; finalized: unknown; version: unknown; status: unknown; completed_at: unknown };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN_KEY_PATTERN = /^obsrun:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BIGINT_PATTERN = /^(0|[1-9][0-9]{0,18})$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,63}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const BIGINT_MAX = BigInt("9223372036854775807");
const RUN_STATUSES = new Set(["RUNNING", "COMPLETED", "PARTIAL", "ABORTED", "FAILED_DISCOVERY", "FAILED_CLEANUP"]);
const TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIAL", "ABORTED", "FAILED_DISCOVERY", "FAILED_CLEANUP"]);
const SCOPE_STATUSES = new Set(["SUCCEEDED", "PARTIAL", "FAILED", "ABORTED"]);
const FAILURE_STAGES = new Set(["DISCOVERY", "FACTORY", "ADAPTER", "VALIDATION", "IDENTITY", "DATABASE", "REFRESH", "WORKER", "CLEANUP", "ABORTED"]);

const BEGIN_SQL = `
select command.run_id::text as run_id, command.created, command.version::text as version,
  command.status, command.started_at::text as started_at
from private.begin_balance_observer_run($1::text, $2::text, $3::text, $4::text) as command
`;
const SCOPE_SQL = `
select command.created
from private.record_balance_observer_scope_outcome(
  $1::uuid, $2::integer, $3::uuid, $4::uuid, $5::text, $6::bigint, $7::bigint, $8::bigint,
  $9::boolean, $10::boolean, $11::boolean, $12::boolean, $13::bigint, $14::text,
  $15::uuid[], $16::integer[], $17::text[], $18::text[], $19::boolean[], $20::bigint[],
  $21::bigint[], $22::boolean[], $23::boolean[], $24::boolean[]
) as command
`;
const FINALIZE_SQL = `
select command.run_id::text as run_id, command.finalized, command.version::text as version,
  command.status, command.completed_at::text as completed_at
from private.finalize_balance_observer_run(
  $1::uuid, $2::bigint, $3::text, $4::text, $5::bigint, $6::bigint, $7::bigint, $8::bigint,
  $9::bigint, $10::bigint, $11::bigint, $12::bigint, $13::bigint, $14::bigint, $15::bigint,
  $16::bigint, $17::bigint, $18::bigint, $19::bigint, $20::bigint, $21::bigint, $22::bigint,
  $23::bigint, $24::bigint, $25::bigint, $26::bigint, $27::bigint, $28::bigint, $29::bigint, $30::bigint
) as command
`;

export function createBalanceObserverRunLedgerClient(
  config: CustodyObserverRunLedgerPostgresConfig,
  runtime: CustodyBalanceObserverRunLedgerClientRuntime = {},
): CustodyBalanceObserverRunLedgerClient {
  const safeConfig = validatePostgresConfig(config);
  const poolConfig: PoolConfig = {
    host: safeConfig.host, port: safeConfig.port, database: safeConfig.database, user: safeConfig.user,
    password: safeConfig.password, ssl: safeConfig.ssl,
    application_name: BALANCE_OBSERVER_RUN_LEDGER_POSTGRES_APPLICATION_NAME,
    connectionTimeoutMillis: safeConfig.connectionTimeoutMillis,
    statement_timeout: safeConfig.statementTimeoutMillis, query_timeout: safeConfig.queryTimeoutMillis,
    lock_timeout: safeConfig.lockTimeoutMillis,
    idle_in_transaction_session_timeout: safeConfig.idleInTransactionSessionTimeoutMillis,
    max: safeConfig.poolMax, idleTimeoutMillis: safeConfig.idleTimeoutMillis,
    maxLifetimeSeconds: safeConfig.maxLifetimeSeconds,
  };
  const pool: CustodyBalanceObserverRunLedgerPool =
    runtime.createPool?.(poolConfig) ??
    (new Pool(poolConfig) as CustodyBalanceObserverRunLedgerPool);
  let closed = false;
  let idleError: CustodyBalanceObserverRunLedgerClientErrorCode | null = null;
  pool.on("error", (error: unknown) => { idleError = mapPostgresError(error).code; });

  const assertOpen = () => {
    if (closed) throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_CLIENT_CLOSED", false);
    void idleError;
  };

  return {
    async beginBalanceObserverRun(input) {
      assertOpen();
      const value = validateBeginInput(input);
      try { return validateBeginResult((await pool.query<BeginRow>({ text: BEGIN_SQL, values: value })).rows); }
      catch (error) { throw mapPostgresError(error); }
    },
    async recordBalanceObserverScopeOutcome(input) {
      assertOpen();
      const value = validateScopeInput(input);
      try { return validateScopeResult((await pool.query<ScopeRow>({ text: SCOPE_SQL, values: value })).rows); }
      catch (error) { throw mapPostgresError(error); }
    },
    async finalizeBalanceObserverRun(input) {
      assertOpen();
      const value = validateFinalizeInput(input);
      try { return validateFinalizeResult((await pool.query<FinalizeRow>({ text: FINALIZE_SQL, values: value })).rows); }
      catch (error) { throw mapPostgresError(error); }
    },
    async close() {
      if (closed) return;
      closed = true;
      try { await pool.end(); }
      catch { throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_COMMAND_REJECTED", false); }
    },
  };
}

function validatePostgresConfig(config: CustodyObserverRunLedgerPostgresConfig): CustodyObserverRunLedgerPostgresConfig {
  return {
    host: validateSafeText(config.host), port: validatePort(config.port), database: validateSafeText(config.database),
    user: validateSafeText(config.user), password: validatePassword(config.password), ssl: validateSsl(config.ssl),
    connectionTimeoutMillis: validateBoundedInteger(config.connectionTimeoutMillis, 60_000),
    statementTimeoutMillis: validateBoundedInteger(config.statementTimeoutMillis, 120_000),
    queryTimeoutMillis: validateBoundedInteger(config.queryTimeoutMillis, 120_000),
    lockTimeoutMillis: validateBoundedInteger(config.lockTimeoutMillis, 60_000),
    idleInTransactionSessionTimeoutMillis: validateBoundedInteger(config.idleInTransactionSessionTimeoutMillis, 60_000),
    poolMax: validateBoundedInteger(config.poolMax, 16), idleTimeoutMillis: validateBoundedInteger(config.idleTimeoutMillis, 60_000),
    maxLifetimeSeconds: validateBoundedInteger(config.maxLifetimeSeconds, 3_600),
  };
}
function validateSafeText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > 255 || CONTROL_CHARACTER_PATTERN.test(value) || value.includes("://")) throw new RangeError("run_ledger_postgres_config_invalid");
  return value;
}
function validatePort(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 65_535) throw new RangeError("run_ledger_postgres_config_invalid");
  return value;
}
function validatePassword(value: unknown): string | (() => string | Promise<string>) {
  if (typeof value === "function") return value as () => string | Promise<string>;
  if (typeof value !== "string" || value.length === 0) throw new RangeError("run_ledger_postgres_config_invalid");
  return value;
}
function validateSsl(value: unknown): false | PoolConfig["ssl"] {
  if (value === false) return false;
  if (typeof value === "object" && value !== null) return value as PoolConfig["ssl"];
  throw new RangeError("run_ledger_postgres_config_invalid");
}
function validateBoundedInteger(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError("run_ledger_postgres_config_invalid");
  return value;
}
function invalidInput(): never { throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_INPUT_INVALID", false); }
function validateUuid(value: unknown): string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) return invalidInput(); return value; }
function validateBigint(value: unknown, positive = false): string {
  const text = typeof value === "number" ? (Number.isSafeInteger(value) ? String(value) : "") : value;
  if (typeof text !== "string" || !BIGINT_PATTERN.test(text) || BigInt(text) > BIGINT_MAX || (positive && text === "0")) return invalidInput();
  return text;
}
function validateCode(value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !CODE_PATTERN.test(value)) return invalidInput();
  return value;
}
function validateBoolean(value: unknown): boolean { if (typeof value !== "boolean") return invalidInput(); return value; }
function validateBeginInput(input: BeginBalanceObserverRunInput): readonly unknown[] {
  if (!input || !RUN_KEY_PATTERN.test(input.runKey) || !["MANUAL", "SCHEDULED", "BACKFILL", "RECOVERY"].includes(input.triggerSource) || !["PRODUCTION", "LOCAL_MOCK"].includes(input.identityPolicy) || input.invocationContractVersion !== "P5_T05_V1") return invalidInput();
  return [input.runKey, input.triggerSource, input.identityPolicy, input.invocationContractVersion];
}
function validateScopeInput(input: RecordBalanceObserverScopeOutcomeInput): readonly unknown[] {
  if (!input || !Number.isSafeInteger(input.discoveryIndex) || input.discoveryIndex < 0 || !SCOPE_STATUSES.has(input.scopeStatus) || !Array.isArray(input.failures)) return invalidInput();
  const failures = input.failures.map((failure) => {
    if (!failure || !Number.isSafeInteger(failure.bindingOrder) || failure.bindingOrder < 0 || !FAILURE_STAGES.has(failure.stage)) return invalidInput();
    return { bindingId: validateUuid(failure.bindingId), bindingOrder: failure.bindingOrder, stage: failure.stage, code: validateCode(failure.code, false)!, retryable: validateBoolean(failure.retryable), adapterAttempts: validateBigint(failure.adapterAttempts), databaseAttempts: validateBigint(failure.databaseAttempts), retryExhausted: validateBoolean(failure.retryExhausted), retryDeferred: validateBoolean(failure.retryDeferred), requiresScopeRefresh: validateBoolean(failure.requiresScopeRefresh) };
  });
  const bindingFailureCount = validateBigint(input.bindingFailureCount);
  const bindingAbortCount = validateBigint(input.bindingAbortCount);
  if (new Set(failures.map((failure) => failure.bindingId)).size !== failures.length || new Set(failures.map((failure) => failure.bindingOrder)).size !== failures.length || BigInt(bindingFailureCount) + BigInt(bindingAbortCount) !== BigInt(failures.length)) return invalidInput();
  const refreshRequested = validateBoolean(input.refreshRequested); const refreshAttempted = validateBoolean(input.refreshAttempted); const refreshSucceeded = validateBoolean(input.refreshSucceeded); const refreshFailed = validateBoolean(input.refreshFailed);
  if ((refreshSucceeded && !refreshAttempted) || (refreshFailed && !refreshAttempted) || (refreshAttempted && !refreshRequested) || (refreshSucceeded && refreshFailed)) return invalidInput();
  return [validateUuid(input.runId), input.discoveryIndex, validateUuid(input.providerId), validateUuid(input.assetId), input.scopeStatus, validateBigint(input.bindingSuccessCount), bindingFailureCount, bindingAbortCount, refreshRequested, refreshAttempted, refreshSucceeded, refreshFailed, validateBigint(input.noLongerEligibleCount), validateCode(input.scopeCode, true), failures.map((f) => f.bindingId), failures.map((f) => f.bindingOrder), failures.map((f) => f.stage), failures.map((f) => f.code), failures.map((f) => f.retryable), failures.map((f) => f.adapterAttempts), failures.map((f) => f.databaseAttempts), failures.map((f) => f.retryExhausted), failures.map((f) => f.retryDeferred), failures.map((f) => f.requiresScopeRefresh)];
}
function validateFinalizeInput(input: FinalizeBalanceObserverRunInput): readonly unknown[] {
  if (!input || !TERMINAL_STATUSES.has(input.terminalStatus)) return invalidInput();
  const s = input.summary;
  const values = [s?.pagesRead, s?.scopesDiscovered, s?.providersDiscovered, s?.bindingsDiscovered, s?.scopesStarted, s?.scopesCompleted, s?.scopesFailed, s?.scopesAborted, s?.bindingsSucceeded, s?.bindingsFailed, s?.bindingsAborted, s?.adapterFactoryCalls, s?.adapterFactoryFailures, s?.scopeRefreshRequested, s?.scopeRefreshAttempted, s?.scopeRefreshSucceeded, s?.scopeRefreshFailed, s?.scopeNoLongerEligible, s?.scopeReadAttempts, s?.scopeReadRetryAttempts, s?.workerAdapterAttempts, s?.workerDatabaseAttempts, s?.workerAdapterRetryAttempts, s?.workerDatabaseRetryAttempts, s?.clientCloseAttempts, s?.clientCloseFailures].map((value) => validateBigint(value));
  const n = values.map((value) => BigInt(value));
  if (n[5] + n[6] + n[7] > n[4] || n[4] > n[1] || n[8] + n[9] + n[10] > n[3] || n[15] + n[16] > n[14] || n[14] > n[13] || n[22] > n[20] || n[23] > n[21] || n[12] > n[11] || n[25] > n[24]) return invalidInput();
  return [validateUuid(input.runId), validateBigint(input.expectedVersion, true), input.terminalStatus, validateCode(input.terminalCode, true), ...values];
}
function validateRowCount<T extends QueryResultRow>(rows: readonly T[]): T { if (rows.length !== 1 || !rows[0]) throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_RESULT_COUNT_INVALID", false); return rows[0]; }
function validateResultUuid(value: unknown): string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_RESULT_SHAPE_INVALID", false); return value; }
function validateResultBoolean(value: unknown): boolean { if (typeof value !== "boolean") throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_RESULT_SHAPE_INVALID", false); return value; }
function validateResultBigint(value: unknown): string { if (typeof value !== "string" || !BIGINT_PATTERN.test(value) || BigInt(value) > BIGINT_MAX || value === "0") throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_RESULT_SHAPE_INVALID", false); return value; }
function validateTimestamp(value: unknown): string { if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value) || CONTROL_CHARACTER_PATTERN.test(value)) throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_RESULT_SHAPE_INVALID", false); return value; }
function validateBeginResult(rows: readonly BeginRow[]): BeginBalanceObserverRunResult { const row = validateRowCount(rows); const result = { runId: validateResultUuid(row.run_id), created: validateResultBoolean(row.created), version: validateResultBigint(row.version), status: validateRunStatus(row.status), startedAt: validateTimestamp(row.started_at) }; if (result.created && (result.status !== "RUNNING" || result.version !== "1")) throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_RESULT_INVALID", false); return result; }
function validateScopeResult(rows: readonly ScopeRow[]): RecordBalanceObserverScopeOutcomeResult { return { created: validateResultBoolean(validateRowCount(rows).created) }; }
function validateFinalizeResult(rows: readonly FinalizeRow[]): FinalizeBalanceObserverRunResult { const row = validateRowCount(rows); const result = { runId: validateResultUuid(row.run_id), finalized: validateResultBoolean(row.finalized), version: validateResultBigint(row.version), status: validateTerminalStatus(row.status), completedAt: validateTimestamp(row.completed_at) }; if (result.finalized && result.version !== "2") throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_RESULT_INVALID", false); return result; }
function validateRunStatus(value: unknown): BeginBalanceObserverRunResult["status"] { if (typeof value !== "string" || !RUN_STATUSES.has(value)) throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_RESULT_SHAPE_INVALID", false); return value as BeginBalanceObserverRunResult["status"]; }
function validateTerminalStatus(value: unknown): FinalizeBalanceObserverRunResult["status"] { if (typeof value !== "string" || !TERMINAL_STATUSES.has(value)) throw new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_RESULT_SHAPE_INVALID", false); return value as FinalizeBalanceObserverRunResult["status"]; }
function mapPostgresError(error: unknown): CustodyBalanceObserverRunLedgerClientError {
  if (error instanceof CustodyBalanceObserverRunLedgerClientError) return error;
  const code = readErrorString(error, "code"); const message = readErrorString(error, "message");
  const domain: Record<string, CustodyBalanceObserverRunLedgerClientErrorCode> = { observer_run_idempotency_conflict: "RUN_LEDGER_IDEMPOTENCY_CONFLICT", run_not_found: "RUN_LEDGER_NOT_FOUND", run_not_running: "RUN_LEDGER_NOT_RUNNING", run_version_conflict: "RUN_LEDGER_VERSION_CONFLICT", run_scope_idempotency_conflict: "RUN_LEDGER_SCOPE_CONFLICT", run_finalization_conflict: "RUN_LEDGER_FINALIZATION_CONFLICT", run_ledger_input_invalid: "RUN_LEDGER_INPUT_INVALID", run_scope_summary_invalid: "RUN_LEDGER_INPUT_INVALID", run_binding_failure_invalid: "RUN_LEDGER_INPUT_INVALID", run_final_summary_invalid: "RUN_LEDGER_INPUT_INVALID", run_scope_provider_asset_invalid: "RUN_LEDGER_INPUT_INVALID" };
  if (message && domain[message]) return new CustodyBalanceObserverRunLedgerClientError(domain[message], message === "run_version_conflict" && code === "40001");
  if (code === "57014" || message === "Query read timeout") return new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_TIMEOUT", true);
  if (code === "55P03") return new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_LOCK_TIMEOUT", true);
  if (code === "ETIMEDOUT" || message === "Connection terminated due to connection timeout") return new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_CONNECTION_FAILED", true);
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EPIPE" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code?.startsWith("08") || code === "57P01" || code === "57P02" || code === "57P03") return new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_UNAVAILABLE", true);
  return new CustodyBalanceObserverRunLedgerClientError("RUN_LEDGER_COMMAND_REJECTED", false);
}
function readErrorString(error: unknown, key: string): string | null { if (typeof error !== "object" || error === null || !(key in error)) return null; const value = (error as Record<string, unknown>)[key]; return typeof value === "string" ? value : null; }
