import "server-only";

import { Pool } from "pg";
import type { PoolConfig, QueryResult, QueryResultRow } from "pg";
import type {
  CustodyAccountBindingRef,
  CustodyObservationCapability,
  CustodyProviderRef,
} from "./provider-observation-contract";

export const BALANCE_OBSERVER_SCOPE_POSTGRES_APPLICATION_NAME =
  "staking-wallet-balance-observer-scope-v1";

export const DEFAULT_CUSTODY_OBSERVER_SCOPE_POSTGRES_LIMITS = {
  connectionTimeoutMillis: 5_000,
  statementTimeoutMillis: 15_000,
  queryTimeoutMillis: 20_000,
  lockTimeoutMillis: 5_000,
  idleInTransactionSessionTimeoutMillis: 5_000,
  poolMax: 4,
  idleTimeoutMillis: 10_000,
  maxLifetimeSeconds: 300,
} as const;

export type CustodyObserverScopePostgresConfig = {
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

export type CustodyBalanceObserverScopeCursor = {
  providerId: string;
  assetId: string;
};

export type CustodyBalanceObserverDiscoveredBinding = {
  bindingId: string;
  assetId: string;
  binding: CustodyAccountBindingRef;
  expectedCheckpointVersion: string;
};

export type CustodyBalanceObserverDiscoveredScope = {
  providerId: string;
  provider: CustodyProviderRef;
  assetId: string;
  assetCode: string;
  bindings: readonly CustodyBalanceObserverDiscoveredBinding[];
};

export type CustodyBalanceObserverScopePage = {
  scopes: readonly CustodyBalanceObserverDiscoveredScope[];
  page: {
    scopeCount: number;
    hasMore: boolean;
    nextCursor: CustodyBalanceObserverScopeCursor | null;
  };
};

export type CustodyBalanceObserverScopeClientErrorCode =
  | "SCOPE_CURSOR_INVALID"
  | "SCOPE_LIMIT_INVALID"
  | "SCOPE_IDENTITY_INVALID"
  | "SCOPE_DB_CONNECTION_FAILED"
  | "SCOPE_DB_TIMEOUT"
  | "SCOPE_DB_UNAVAILABLE"
  | "SCOPE_COMMAND_REJECTED"
  | "SCOPE_RESULT_SHAPE_INVALID"
  | "SCOPE_RESULT_ORDER_INVALID"
  | "SCOPE_DUPLICATE_SCOPE"
  | "SCOPE_DUPLICATE_BINDING"
  | "SCOPE_PROVIDER_REF_INVALID"
  | "SCOPE_BINDING_REF_INVALID"
  | "SCOPE_CHECKPOINT_VERSION_INVALID"
  | "SCOPE_PAGE_METADATA_INVALID"
  | "SCOPE_CLIENT_CLOSED";

export class CustodyBalanceObserverScopeClientError extends Error {
  readonly code: CustodyBalanceObserverScopeClientErrorCode;
  readonly retryable: boolean;

  constructor(
    code: CustodyBalanceObserverScopeClientErrorCode,
    retryable: boolean,
  ) {
    super("custody_balance_observer_scope_client_failed");
    this.name = "CustodyBalanceObserverScopeClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type CustodyBalanceObserverScopeClient = {
  listBalanceObserverScopePage(input?: {
    after?: CustodyBalanceObserverScopeCursor | null;
    limit?: number;
  }): Promise<CustodyBalanceObserverScopePage>;
  readBalanceObserverScope(input: {
    providerId: string;
    assetId: string;
  }): Promise<CustodyBalanceObserverDiscoveredScope | null>;
  close(): Promise<void>;
};

export type CustodyBalanceObserverScopePool = {
  query<T extends QueryResultRow = QueryResultRow>(query: {
    text: string;
    values?: readonly unknown[];
  }): Promise<QueryResult<T>>;
  end(): Promise<void>;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

export type CustodyBalanceObserverScopeClientRuntime = {
  createPool?: (config: PoolConfig) => CustodyBalanceObserverScopePool;
};

type ScopeBaseRow = QueryResultRow & {
  provider_id: unknown;
  provider_code: unknown;
  provider_type: unknown;
  supports_balance_observation: unknown;
  supports_transfer_observation: unknown;
  supports_transfer_lookup: unknown;
  supports_payout_submission: unknown;
  supports_webhook_ingestion: unknown;
  asset_id: unknown;
  asset_code: unknown;
  binding_id: unknown;
  binding_key: unknown;
  account_role: unknown;
  expected_checkpoint_version: unknown;
};

type ScopePageRow = ScopeBaseRow & {
  page_scope_count: unknown;
  has_more: unknown;
  next_provider_id: unknown;
  next_asset_id: unknown;
};

type NormalizedScopeRow = {
  providerId: string;
  provider: CustodyProviderRef;
  assetId: string;
  assetCode: string;
  bindingId: string;
  binding: CustodyAccountBindingRef;
  expectedCheckpointVersion: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROVIDER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const ASSET_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,31}$/;
const BINDING_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const CHECKPOINT_VERSION_PATTERN = /^(0|[1-9][0-9]{0,18})$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const BIGINT_MAX = BigInt("9223372036854775807");

const PROVIDER_TYPES = new Set([
  "MPC_CUSTODIAN",
  "QUALIFIED_CUSTODIAN",
  "EXCHANGE_CUSTODY",
  "INTERNAL_HSM",
]);

const ACCOUNT_ROLES = new Set(["COLLECTION", "PAYOUT", "TREASURY", "FEE"]);

const LIST_SCOPE_SQL = `
select
  scope.provider_id::text as provider_id,
  scope.provider_code,
  scope.provider_type,
  scope.supports_balance_observation,
  scope.supports_transfer_observation,
  scope.supports_transfer_lookup,
  scope.supports_payout_submission,
  scope.supports_webhook_ingestion,
  scope.asset_id::text as asset_id,
  scope.asset_code,
  scope.binding_id::text as binding_id,
  scope.binding_key,
  scope.account_role,
  scope.expected_checkpoint_version::text as expected_checkpoint_version,
  scope.page_scope_count,
  scope.has_more,
  scope.next_provider_id::text as next_provider_id,
  scope.next_asset_id::text as next_asset_id
from private.list_balance_observer_scope_page(
  $1::uuid,
  $2::uuid,
  $3::integer
) as scope
`;

const READ_SCOPE_SQL = `
select
  scope.provider_id::text as provider_id,
  scope.provider_code,
  scope.provider_type,
  scope.supports_balance_observation,
  scope.supports_transfer_observation,
  scope.supports_transfer_lookup,
  scope.supports_payout_submission,
  scope.supports_webhook_ingestion,
  scope.asset_id::text as asset_id,
  scope.asset_code,
  scope.binding_id::text as binding_id,
  scope.binding_key,
  scope.account_role,
  scope.expected_checkpoint_version::text as expected_checkpoint_version
from private.read_balance_observer_scope(
  $1::uuid,
  $2::uuid
) as scope
`;

export function createBalanceObserverScopeClient(
  config: CustodyObserverScopePostgresConfig,
  runtime: CustodyBalanceObserverScopeClientRuntime = {},
): CustodyBalanceObserverScopeClient {
  const safeConfig = validatePostgresConfig(config);
  const poolConfig: PoolConfig = {
    host: safeConfig.host,
    port: safeConfig.port,
    database: safeConfig.database,
    user: safeConfig.user,
    password: safeConfig.password,
    ssl: safeConfig.ssl,
    application_name: BALANCE_OBSERVER_SCOPE_POSTGRES_APPLICATION_NAME,
    connectionTimeoutMillis: safeConfig.connectionTimeoutMillis,
    statement_timeout: safeConfig.statementTimeoutMillis,
    query_timeout: safeConfig.queryTimeoutMillis,
    lock_timeout: safeConfig.lockTimeoutMillis,
    idle_in_transaction_session_timeout:
      safeConfig.idleInTransactionSessionTimeoutMillis,
    max: safeConfig.poolMax,
    idleTimeoutMillis: safeConfig.idleTimeoutMillis,
    maxLifetimeSeconds: safeConfig.maxLifetimeSeconds,
  };
  const pool: CustodyBalanceObserverScopePool =
    runtime.createPool?.(poolConfig) ??
    (new Pool(poolConfig) as CustodyBalanceObserverScopePool);
  let closed = false;
  let idleErrorCode: CustodyBalanceObserverScopeClientErrorCode | null = null;

  pool.on("error", (error: unknown) => {
    idleErrorCode = mapPostgresError(error).code;
  });

  return {
    async listBalanceObserverScopePage(input = {}) {
      void idleErrorCode;
      ensureOpen(closed);

      const { providerId, assetId } = validateCursor(input.after ?? null);
      const limit = validateLimit(input.limit ?? 50);

      try {
        const result = await pool.query<ScopePageRow>({
          text: LIST_SCOPE_SQL,
          values: [providerId, assetId, limit],
        });

        return validateScopePageResult(result, limit);
      } catch (error) {
        throw mapPostgresError(error);
      }
    },
    async readBalanceObserverScope(input) {
      void idleErrorCode;
      ensureOpen(closed);

      const identity = validateScopeIdentity(input);

      try {
        const result = await pool.query<ScopeBaseRow>({
          text: READ_SCOPE_SQL,
          values: [identity.providerId, identity.assetId],
        });

        return validateExactScopeResult(result, identity);
      } catch (error) {
        throw mapPostgresError(error);
      }
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;

      try {
        await pool.end();
      } catch (error) {
        throw mapPostgresError(error);
      }
    },
  };
}

function ensureOpen(closed: boolean) {
  if (closed) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_CLIENT_CLOSED",
      false,
    );
  }
}

function validatePostgresConfig(
  config: CustodyObserverScopePostgresConfig,
): CustodyObserverScopePostgresConfig {
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
    poolMax: validateBoundedInteger(config.poolMax, 4, "postgres_pool_invalid"),
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

function validateCursor(after: unknown): {
  providerId: string | null;
  assetId: string | null;
} {
  if (after === null) {
    return { providerId: null, assetId: null };
  }

  if (!isRecord(after)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_CURSOR_INVALID",
      false,
    );
  }

  const providerId = validateUuidText(
    after.providerId,
    "SCOPE_CURSOR_INVALID",
  );
  const assetId = validateUuidText(after.assetId, "SCOPE_CURSOR_INVALID");

  return { providerId, assetId };
}

function validateLimit(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 200
  ) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_LIMIT_INVALID",
      false,
    );
  }

  return value;
}

function validateScopeIdentity(input: unknown): CustodyBalanceObserverScopeCursor {
  if (!isRecord(input)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_IDENTITY_INVALID",
      false,
    );
  }

  return {
    providerId: validateUuidText(input.providerId, "SCOPE_IDENTITY_INVALID"),
    assetId: validateUuidText(input.assetId, "SCOPE_IDENTITY_INVALID"),
  };
}

function validateScopePageResult(
  result: unknown,
  limit: number,
): CustodyBalanceObserverScopePage {
  const rows = readResultRows<ScopePageRow>(result);

  if (rows.length === 0) {
    return {
      scopes: [],
      page: { scopeCount: 0, hasMore: false, nextCursor: null },
    };
  }

  const metadata = readPageMetadata(rows[0], limit);
  const scopeBuilder = createScopeBuilder();

  for (const row of rows) {
    const rowMetadata = readPageMetadata(row, limit);

    if (
      rowMetadata.scopeCount !== metadata.scopeCount ||
      rowMetadata.hasMore !== metadata.hasMore ||
      rowMetadata.nextCursor?.providerId !== metadata.nextCursor?.providerId ||
      rowMetadata.nextCursor?.assetId !== metadata.nextCursor?.assetId
    ) {
      throw new CustodyBalanceObserverScopeClientError(
        "SCOPE_PAGE_METADATA_INVALID",
        false,
      );
    }

    scopeBuilder.add(normalizeBaseRow(row));
  }

  const scopes = scopeBuilder.finish();

  if (
    metadata.scopeCount !== scopes.length ||
    metadata.scopeCount < 1 ||
    metadata.scopeCount > limit
  ) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_PAGE_METADATA_INVALID",
      false,
    );
  }

  const lastScope = scopes.at(-1);

  if (!lastScope) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_PAGE_METADATA_INVALID",
      false,
    );
  }

  if (metadata.hasMore) {
    if (
      !metadata.nextCursor ||
      metadata.nextCursor.providerId !== lastScope.providerId ||
      metadata.nextCursor.assetId !== lastScope.assetId
    ) {
      throw new CustodyBalanceObserverScopeClientError(
        "SCOPE_PAGE_METADATA_INVALID",
        false,
      );
    }
  } else if (metadata.nextCursor !== null) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_PAGE_METADATA_INVALID",
      false,
    );
  }

  return {
    scopes,
    page: metadata,
  };
}

function validateExactScopeResult(
  result: unknown,
  identity: CustodyBalanceObserverScopeCursor,
): CustodyBalanceObserverDiscoveredScope | null {
  const rows = readResultRows<ScopeBaseRow>(result);

  if (rows.length === 0) {
    return null;
  }

  const scopeBuilder = createScopeBuilder();

  for (const row of rows) {
    rejectPageMetadata(row);
    const normalized = normalizeBaseRow(row);

    if (
      normalized.providerId !== identity.providerId ||
      normalized.assetId !== identity.assetId
    ) {
      throw new CustodyBalanceObserverScopeClientError(
        "SCOPE_RESULT_SHAPE_INVALID",
        false,
      );
    }

    scopeBuilder.add(normalized);
  }

  const scopes = scopeBuilder.finish();

  if (scopes.length !== 1) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_RESULT_SHAPE_INVALID",
      false,
    );
  }

  return scopes[0] ?? null;
}

function readResultRows<TRow extends QueryResultRow>(result: unknown): TRow[] {
  if (!isRecord(result) || !Array.isArray(result.rows)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_RESULT_SHAPE_INVALID",
      false,
    );
  }

  return result.rows as TRow[];
}

function readPageMetadata(
  row: ScopePageRow | undefined,
  limit: number,
): CustodyBalanceObserverScopePage["page"] {
  if (!isRecord(row)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_RESULT_SHAPE_INVALID",
      false,
    );
  }

  const scopeCount = row.page_scope_count;
  const hasMore = row.has_more;
  const nextProviderId = row.next_provider_id;
  const nextAssetId = row.next_asset_id;

  if (
    typeof scopeCount !== "number" ||
    !Number.isSafeInteger(scopeCount) ||
    scopeCount < 1 ||
    scopeCount > limit ||
    typeof hasMore !== "boolean"
  ) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_PAGE_METADATA_INVALID",
      false,
    );
  }

  if (hasMore) {
    return {
      scopeCount,
      hasMore,
      nextCursor: {
        providerId: validateUuidText(
          nextProviderId,
          "SCOPE_PAGE_METADATA_INVALID",
        ),
        assetId: validateUuidText(nextAssetId, "SCOPE_PAGE_METADATA_INVALID"),
      },
    };
  }

  if (nextProviderId !== null || nextAssetId !== null) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_PAGE_METADATA_INVALID",
      false,
    );
  }

  return { scopeCount, hasMore, nextCursor: null };
}

function rejectPageMetadata(row: QueryResultRow) {
  if (
    "page_scope_count" in row ||
    "has_more" in row ||
    "next_provider_id" in row ||
    "next_asset_id" in row
  ) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_RESULT_SHAPE_INVALID",
      false,
    );
  }
}

function normalizeBaseRow(row: ScopeBaseRow): NormalizedScopeRow {
  if (!isRecord(row)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_RESULT_SHAPE_INVALID",
      false,
    );
  }

  const providerId = validateUuidText(
    row.provider_id,
    "SCOPE_RESULT_SHAPE_INVALID",
  );
  const assetId = validateUuidText(row.asset_id, "SCOPE_RESULT_SHAPE_INVALID");
  const bindingId = validateUuidText(
    row.binding_id,
    "SCOPE_RESULT_SHAPE_INVALID",
  );
  const providerCode = validateProviderCode(row.provider_code);
  const providerType = validateProviderType(row.provider_type);
  const assetCode = validateAssetCode(row.asset_code);
  const bindingKey = validateBindingKey(row.binding_key);
  const accountRole = validateAccountRole(row.account_role);
  const capabilities = readCapabilities(row);

  return {
    providerId,
    provider: {
      providerCode,
      providerType,
      capabilities,
    },
    assetId,
    assetCode,
    bindingId,
    binding: {
      providerCode,
      bindingKey,
      assetCode,
      accountRole,
    },
    expectedCheckpointVersion: validateCheckpointVersion(
      row.expected_checkpoint_version,
    ),
  };
}

function createScopeBuilder() {
  const scopes: CustodyBalanceObserverDiscoveredScope[] = [];
  const bindingIds = new Set<string>();
  const scopeKeys = new Set<string>();
  const providerRefs = new Map<string, string>();
  const assetCodes = new Map<string, string>();
  let previousTuple: [string, string, string] | null = null;
  let currentScopeKey: string | null = null;
  let currentScope:
    | {
        scope: CustodyBalanceObserverDiscoveredScope;
        bindings: CustodyBalanceObserverDiscoveredBinding[];
      }
    | null = null;

  return {
    add(row: NormalizedScopeRow) {
      const tuple: [string, string, string] = [
        row.providerId,
        row.assetId,
        row.bindingId,
      ];
      const ordering = compareTuple(tuple, previousTuple);

      if (ordering <= 0) {
        if (ordering === 0) {
          throw new CustodyBalanceObserverScopeClientError(
            "SCOPE_DUPLICATE_BINDING",
            false,
          );
        }

        throw new CustodyBalanceObserverScopeClientError(
          "SCOPE_RESULT_ORDER_INVALID",
          false,
        );
      }

      previousTuple = tuple;

      if (bindingIds.has(row.bindingId)) {
        throw new CustodyBalanceObserverScopeClientError(
          "SCOPE_DUPLICATE_BINDING",
          false,
        );
      }

      bindingIds.add(row.bindingId);

      const providerRefKey = JSON.stringify(row.provider);
      const priorProviderRefKey = providerRefs.get(row.providerId);

      if (priorProviderRefKey && priorProviderRefKey !== providerRefKey) {
        throw new CustodyBalanceObserverScopeClientError(
          "SCOPE_PROVIDER_REF_INVALID",
          false,
        );
      }

      providerRefs.set(row.providerId, providerRefKey);

      const priorAssetCode = assetCodes.get(row.assetId);

      if (priorAssetCode && priorAssetCode !== row.assetCode) {
        throw new CustodyBalanceObserverScopeClientError(
          "SCOPE_BINDING_REF_INVALID",
          false,
        );
      }

      assetCodes.set(row.assetId, row.assetCode);

      const nextScopeKey = `${row.providerId}:${row.assetId}`;

      if (nextScopeKey !== currentScopeKey) {
        if (scopeKeys.has(nextScopeKey)) {
          throw new CustodyBalanceObserverScopeClientError(
            "SCOPE_DUPLICATE_SCOPE",
            false,
          );
        }

        scopeKeys.add(nextScopeKey);
        currentScopeKey = nextScopeKey;
        currentScope = {
          scope: {
            providerId: row.providerId,
            provider: row.provider,
            assetId: row.assetId,
            assetCode: row.assetCode,
            bindings: [],
          },
          bindings: [],
        };
        scopes.push(currentScope.scope);
      }

      if (!currentScope) {
        throw new CustodyBalanceObserverScopeClientError(
          "SCOPE_RESULT_SHAPE_INVALID",
          false,
        );
      }

      if (
        currentScope.scope.provider.providerCode !== row.binding.providerCode ||
        currentScope.scope.assetCode !== row.binding.assetCode ||
        currentScope.scope.assetId !== row.assetId
      ) {
        throw new CustodyBalanceObserverScopeClientError(
          "SCOPE_BINDING_REF_INVALID",
          false,
        );
      }

      currentScope.bindings.push({
        bindingId: row.bindingId,
        assetId: row.assetId,
        binding: row.binding,
        expectedCheckpointVersion: row.expectedCheckpointVersion,
      });
      currentScope.scope.bindings = currentScope.bindings;
    },
    finish() {
      if (scopes.some((scope) => scope.bindings.length === 0)) {
        throw new CustodyBalanceObserverScopeClientError(
          "SCOPE_RESULT_SHAPE_INVALID",
          false,
        );
      }

      return scopes;
    },
  };
}

function compareTuple(
  tuple: readonly [string, string, string],
  previousTuple: readonly [string, string, string] | null,
): number {
  if (!previousTuple) {
    return 1;
  }

  for (let index = 0; index < tuple.length; index += 1) {
    if (tuple[index] > previousTuple[index]) {
      return 1;
    }

    if (tuple[index] < previousTuple[index]) {
      return -1;
    }
  }

  return 0;
}

function validateUuidText(
  value: unknown,
  code: CustodyBalanceObserverScopeClientErrorCode,
): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new CustodyBalanceObserverScopeClientError(code, false);
  }

  return value;
}

function validateProviderCode(value: unknown): string {
  if (typeof value !== "string" || !PROVIDER_CODE_PATTERN.test(value)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_PROVIDER_REF_INVALID",
      false,
    );
  }

  return value;
}

function validateProviderType(value: unknown): string {
  if (typeof value !== "string" || !PROVIDER_TYPES.has(value)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_PROVIDER_REF_INVALID",
      false,
    );
  }

  return value;
}

function validateAssetCode(value: unknown): string {
  if (typeof value !== "string" || !ASSET_CODE_PATTERN.test(value)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_BINDING_REF_INVALID",
      false,
    );
  }

  return value;
}

function validateBindingKey(value: unknown): string {
  if (typeof value !== "string" || !BINDING_KEY_PATTERN.test(value)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_BINDING_REF_INVALID",
      false,
    );
  }

  return value;
}

function validateAccountRole(value: unknown): string {
  if (typeof value !== "string" || !ACCOUNT_ROLES.has(value)) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_BINDING_REF_INVALID",
      false,
    );
  }

  return value;
}

function validateCheckpointVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !CHECKPOINT_VERSION_PATTERN.test(value) ||
    BigInt(value) > BIGINT_MAX
  ) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_CHECKPOINT_VERSION_INVALID",
      false,
    );
  }

  return value;
}

function readCapabilities(
  row: ScopeBaseRow,
): readonly CustodyObservationCapability[] {
  const entries: readonly [
    keyof ScopeBaseRow,
    CustodyObservationCapability,
  ][] = [
    ["supports_balance_observation", "BALANCE_OBSERVATION"],
    ["supports_transfer_observation", "TRANSFER_OBSERVATION"],
    ["supports_transfer_lookup", "TRANSFER_LOOKUP"],
    ["supports_payout_submission", "PAYOUT_SUBMISSION"],
    ["supports_webhook_ingestion", "WEBHOOK_INGESTION"],
  ];

  const capabilities: CustodyObservationCapability[] = [];

  for (const [field, capability] of entries) {
    const value = row[field];

    if (typeof value !== "boolean") {
      throw new CustodyBalanceObserverScopeClientError(
        "SCOPE_PROVIDER_REF_INVALID",
        false,
      );
    }

    if (value) {
      capabilities.push(capability);
    }
  }

  if (row.supports_balance_observation !== true) {
    throw new CustodyBalanceObserverScopeClientError(
      "SCOPE_PROVIDER_REF_INVALID",
      false,
    );
  }

  return capabilities;
}

function mapPostgresError(error: unknown): CustodyBalanceObserverScopeClientError {
  if (error instanceof CustodyBalanceObserverScopeClientError) {
    return error;
  }

  const code = readErrorString(error, "code");
  const message = readErrorString(error, "message");

  if (code === "22023" && message === "scope_cursor_invalid") {
    return new CustodyBalanceObserverScopeClientError(
      "SCOPE_CURSOR_INVALID",
      false,
    );
  }

  if (code === "22023" && message === "scope_limit_invalid") {
    return new CustodyBalanceObserverScopeClientError(
      "SCOPE_LIMIT_INVALID",
      false,
    );
  }

  if (code === "22023" && message === "scope_identity_invalid") {
    return new CustodyBalanceObserverScopeClientError(
      "SCOPE_IDENTITY_INVALID",
      false,
    );
  }

  if (code === "57014" || message === "Query read timeout") {
    return new CustodyBalanceObserverScopeClientError(
      "SCOPE_DB_TIMEOUT",
      true,
    );
  }

  if (code === "ETIMEDOUT") {
    return new CustodyBalanceObserverScopeClientError(
      "SCOPE_DB_CONNECTION_FAILED",
      true,
    );
  }

  if (message === "Connection terminated due to connection timeout") {
    return new CustodyBalanceObserverScopeClientError(
      "SCOPE_DB_CONNECTION_FAILED",
      true,
    );
  }

  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code?.startsWith("08") ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03"
  ) {
    return new CustodyBalanceObserverScopeClientError(
      "SCOPE_DB_UNAVAILABLE",
      true,
    );
  }

  return new CustodyBalanceObserverScopeClientError(
    "SCOPE_COMMAND_REJECTED",
    false,
  );
}

function readErrorString(error: unknown, key: string): string | null {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return null;
  }

  const value = (error as Record<string, unknown>)[key];

  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
