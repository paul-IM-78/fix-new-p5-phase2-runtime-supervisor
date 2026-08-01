import "server-only";

import { Pool } from "pg";
import type { PoolConfig, QueryResultRow } from "pg";

export const BALANCE_OBSERVER_POSTGRES_APPLICATION_NAME =
  "staking-wallet-balance-observer-v1";

export const DEFAULT_CUSTODY_OBSERVER_POSTGRES_LIMITS = {
  connectionTimeoutMillis: 5_000,
  statementTimeoutMillis: 15_000,
  queryTimeoutMillis: 20_000,
  lockTimeoutMillis: 5_000,
  idleInTransactionSessionTimeoutMillis: 5_000,
  poolMax: 4,
  idleTimeoutMillis: 10_000,
  maxLifetimeSeconds: 300,
} as const;

export type CustodyObserverPostgresConfig = {
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

export type RecordBalanceObservationCommandInput = {
  bindingId: string;
  observerKind: string;
  observationKey: string;
  observedTotalUnits: string;
  observedAt: string;
  expectedCheckpointVersion: string;
};

export type RecordBalanceObservationCommandResult = {
  externalBalanceObservationId: string;
  observationCreated: boolean;
  observerCheckpointId: string;
  checkpointCreated: boolean;
  checkpointAdvanced: boolean;
  checkpointVersion: string;
};

export type CustodyBalanceObserverCommandErrorCode =
  | "CHECKPOINT_VERSION_CONFLICT"
  | "CHECKPOINT_REGRESSION"
  | "CHECKPOINT_POSITION_CONFLICT"
  | "OBSERVATION_IDEMPOTENCY_CONFLICT"
  | "BINDING_NOT_FOUND"
  | "BINDING_NOT_OBSERVABLE"
  | "INPUT_CONTRACT_INVALID"
  | "DB_CONNECTION_FAILED"
  | "DB_TIMEOUT"
  | "DB_UNAVAILABLE"
  | "DB_COMMAND_REJECTED"
  | "DB_COMMAND_RESULT_COUNT_INVALID"
  | "DB_COMMAND_RESULT_SHAPE_INVALID"
  | "DB_COMMAND_FLAG_CONTRACT_INVALID"
  | "DB_COMMAND_RESULT_INVALID";

export class CustodyBalanceObserverCommandError extends Error {
  readonly code: CustodyBalanceObserverCommandErrorCode;
  readonly retryable: boolean;

  constructor(
    code: CustodyBalanceObserverCommandErrorCode,
    retryable: boolean,
  ) {
    super("custody_balance_observer_command_failed");
    this.name = "CustodyBalanceObserverCommandError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type CustodyBalanceObserverCommandClient = {
  recordBalanceObservationAndAdvanceCheckpoint(
    input: RecordBalanceObservationCommandInput,
  ): Promise<RecordBalanceObservationCommandResult>;
  close(): Promise<void>;
};

type AtomicCommandRow = QueryResultRow & {
  external_balance_observation_id: unknown;
  observation_created: unknown;
  observer_checkpoint_id: unknown;
  checkpoint_created: unknown;
  checkpoint_advanced: unknown;
  checkpoint_version: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9][0-9]{0,18}$/;
const BIGINT_MAX = BigInt("9223372036854775807");
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const ATOMIC_COMMAND_SQL = `
select
  command.external_balance_observation_id::text,
  command.observation_created,
  command.observer_checkpoint_id::text,
  command.checkpoint_created,
  command.checkpoint_advanced,
  command.checkpoint_version::text
from private.record_balance_observation_and_advance_checkpoint(
  $1::uuid,
  $2::text,
  $3::text,
  $4::numeric,
  $5::timestamptz,
  $6::bigint,
  $7::text,
  $8::timestamptz
) as command
`;

export function createBalanceObserverCommandClient(
  config: CustodyObserverPostgresConfig,
): CustodyBalanceObserverCommandClient {
  const safeConfig = validatePostgresConfig(config);
  const pool = new Pool({
    host: safeConfig.host,
    port: safeConfig.port,
    database: safeConfig.database,
    user: safeConfig.user,
    password: safeConfig.password,
    ssl: safeConfig.ssl,
    application_name: BALANCE_OBSERVER_POSTGRES_APPLICATION_NAME,
    connectionTimeoutMillis: safeConfig.connectionTimeoutMillis,
    statement_timeout: safeConfig.statementTimeoutMillis,
    query_timeout: safeConfig.queryTimeoutMillis,
    lock_timeout: safeConfig.lockTimeoutMillis,
    idle_in_transaction_session_timeout:
      safeConfig.idleInTransactionSessionTimeoutMillis,
    max: safeConfig.poolMax,
    idleTimeoutMillis: safeConfig.idleTimeoutMillis,
    maxLifetimeSeconds: safeConfig.maxLifetimeSeconds,
  });
  let closed = false;
  let idleErrorCode: CustodyBalanceObserverCommandErrorCode | null = null;

  pool.on("error", (error: unknown) => {
    idleErrorCode = mapPostgresError(error).code;
  });

  return {
    async recordBalanceObservationAndAdvanceCheckpoint(input) {
      void idleErrorCode;

      try {
        const result = await pool.query<AtomicCommandRow>({
          text: ATOMIC_COMMAND_SQL,
          values: [
            input.bindingId,
            input.observerKind,
            input.observationKey,
            input.observedTotalUnits,
            input.observedAt,
            input.expectedCheckpointVersion,
            input.observationKey,
            input.observedAt,
          ],
        });

        return validateCommandResult(result.rows);
      } catch (error) {
        throw mapPostgresError(error);
      }
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      await pool.end();
    },
  };
}

function validatePostgresConfig(
  config: CustodyObserverPostgresConfig,
): CustodyObserverPostgresConfig {
  return {
    host: validateSafeText(config.host, "postgres_host_invalid"),
    port: validatePort(config.port),
    database: validateSafeText(config.database, "postgres_database_invalid"),
    user: validateSafeText(config.user, "postgres_user_invalid"),
    password: validatePassword(config.password),
    ssl: validateSsl(config.ssl),
    connectionTimeoutMillis: validateBoundedInteger(
      config.connectionTimeoutMillis,
      60_000,
      "postgres_connection_timeout_invalid",
    ),
    statementTimeoutMillis: validateBoundedInteger(
      config.statementTimeoutMillis,
      120_000,
      "postgres_statement_timeout_invalid",
    ),
    queryTimeoutMillis: validateBoundedInteger(
      config.queryTimeoutMillis,
      120_000,
      "postgres_query_timeout_invalid",
    ),
    lockTimeoutMillis: validateBoundedInteger(
      config.lockTimeoutMillis,
      60_000,
      "postgres_lock_timeout_invalid",
    ),
    idleInTransactionSessionTimeoutMillis: validateBoundedInteger(
      config.idleInTransactionSessionTimeoutMillis,
      60_000,
      "postgres_idle_transaction_timeout_invalid",
    ),
    poolMax: validateBoundedInteger(config.poolMax, 16, "postgres_pool_invalid"),
    idleTimeoutMillis: validateBoundedInteger(
      config.idleTimeoutMillis,
      60_000,
      "postgres_idle_timeout_invalid",
    ),
    maxLifetimeSeconds: validateBoundedInteger(
      config.maxLifetimeSeconds,
      3_600,
      "postgres_lifetime_invalid",
    ),
  };
}

function validateSafeText(value: unknown, errorCode: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.length > 255 ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    value.includes("://")
  ) {
    throw new RangeError(errorCode);
  }

  return value;
}

function validatePort(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    throw new RangeError("postgres_port_invalid");
  }

  return value;
}

function validatePassword(
  value: unknown,
): string | (() => string | Promise<string>) {
  if (typeof value === "function") {
    return value as () => string | Promise<string>;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError("postgres_password_invalid");
  }

  return value;
}

function validateSsl(value: unknown): false | PoolConfig["ssl"] {
  if (value === false) {
    return false;
  }

  if (typeof value === "object" && value !== null) {
    return value as PoolConfig["ssl"];
  }

  throw new RangeError("postgres_ssl_invalid");
}

function validateBoundedInteger(
  value: unknown,
  max: number,
  errorCode: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new RangeError(errorCode);
  }

  return value;
}

function validateCommandResult(
  rows: readonly AtomicCommandRow[],
): RecordBalanceObservationCommandResult {
  if (rows.length !== 1) {
    throw new CustodyBalanceObserverCommandError(
      "DB_COMMAND_RESULT_COUNT_INVALID",
      false,
    );
  }

  const row = rows[0];

  if (!row) {
    throw new CustodyBalanceObserverCommandError(
      "DB_COMMAND_RESULT_COUNT_INVALID",
      false,
    );
  }

  const observationId = validateUuidText(row.external_balance_observation_id);
  const checkpointId = validateUuidText(row.observer_checkpoint_id);
  const checkpointVersion = validatePositiveBigintText(row.checkpoint_version);
  const observationCreated = validateBoolean(row.observation_created);
  const checkpointCreated = validateBoolean(row.checkpoint_created);
  const checkpointAdvanced = validateBoolean(row.checkpoint_advanced);

  if (checkpointCreated && checkpointAdvanced) {
    throw new CustodyBalanceObserverCommandError(
      "DB_COMMAND_FLAG_CONTRACT_INVALID",
      false,
    );
  }

  return {
    externalBalanceObservationId: observationId,
    observationCreated,
    observerCheckpointId: checkpointId,
    checkpointCreated,
    checkpointAdvanced,
    checkpointVersion,
  };
}

function validateUuidText(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new CustodyBalanceObserverCommandError(
      "DB_COMMAND_RESULT_SHAPE_INVALID",
      false,
    );
  }

  return value;
}

function validateBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new CustodyBalanceObserverCommandError(
      "DB_COMMAND_RESULT_SHAPE_INVALID",
      false,
    );
  }

  return value;
}

function validatePositiveBigintText(value: unknown): string {
  if (
    typeof value !== "string" ||
    !POSITIVE_BIGINT_PATTERN.test(value) ||
    BigInt(value) > BIGINT_MAX
  ) {
    throw new CustodyBalanceObserverCommandError(
      "DB_COMMAND_RESULT_SHAPE_INVALID",
      false,
    );
  }

  return value;
}

function mapPostgresError(error: unknown): CustodyBalanceObserverCommandError {
  if (error instanceof CustodyBalanceObserverCommandError) {
    return error;
  }

  const code = readErrorString(error, "code");
  const message = readErrorString(error, "message");

  if (code === "40001" && message === "observer_checkpoint_version_conflict") {
    return new CustodyBalanceObserverCommandError(
      "CHECKPOINT_VERSION_CONFLICT",
      true,
    );
  }

  if (code === "22023" && message === "observer_checkpoint_regression") {
    return new CustodyBalanceObserverCommandError(
      "CHECKPOINT_REGRESSION",
      false,
    );
  }

  if (code === "23505" && message === "observer_checkpoint_position_conflict") {
    return new CustodyBalanceObserverCommandError(
      "CHECKPOINT_POSITION_CONFLICT",
      false,
    );
  }

  if (code === "23505" && message === "observation_idempotency_conflict") {
    return new CustodyBalanceObserverCommandError(
      "OBSERVATION_IDEMPOTENCY_CONFLICT",
      false,
    );
  }

  if (code === "23503" && message === "binding_not_found") {
    return new CustodyBalanceObserverCommandError("BINDING_NOT_FOUND", false);
  }

  if (code === "23514" && message === "binding_not_observable") {
    return new CustodyBalanceObserverCommandError(
      "BINDING_NOT_OBSERVABLE",
      false,
    );
  }

  if (
    code === "22023" &&
    (message === "observer_kind_invalid" ||
      message === "observation_key_invalid" ||
      message === "observation_amount_invalid" ||
      message === "observation_timestamp_invalid" ||
      message === "observer_checkpoint_version_invalid" ||
      message === "observer_checkpoint_value_invalid" ||
      message === "observer_checkpoint_timestamp_invalid" ||
      message === "observer_checkpoint_timestamp_mismatch")
  ) {
    return new CustodyBalanceObserverCommandError(
      "INPUT_CONTRACT_INVALID",
      false,
    );
  }

  if (code === "57014" || code === "55P03") {
    return new CustodyBalanceObserverCommandError("DB_TIMEOUT", true);
  }

  if (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  ) {
    return new CustodyBalanceObserverCommandError(
      "DB_CONNECTION_FAILED",
      true,
    );
  }

  if (code === "57P01" || code === "57P02" || code === "57P03") {
    return new CustodyBalanceObserverCommandError("DB_UNAVAILABLE", true);
  }

  return new CustodyBalanceObserverCommandError("DB_COMMAND_REJECTED", false);
}

function readErrorString(error: unknown, key: string): string | null {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return null;
  }

  const value = (error as Record<string, unknown>)[key];

  return typeof value === "string" ? value : null;
}
