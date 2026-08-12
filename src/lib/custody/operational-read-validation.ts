const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const CANONICAL_POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export const CUSTODY_OBSERVER_RUN_STATUSES = [
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "ABORTED",
  "FAILED_DISCOVERY",
  "FAILED_CLEANUP",
] as const;

export const CUSTODY_OBSERVER_SEVERITIES = [
  "INFO",
  "WARNING",
  "CRITICAL",
] as const;

export type CustodyObserverRunStatus =
  (typeof CUSTODY_OBSERVER_RUN_STATUSES)[number];
export type CustodyObserverSeverity =
  (typeof CUSTODY_OBSERVER_SEVERITIES)[number];

export type CustodyObserverListCursor = {
  createdAt: string;
  runId: string;
};

export type AdminCustodyObserverListQuery = {
  limit: number;
  cursor: CustodyObserverListCursor | null;
  status: CustodyObserverRunStatus | null;
  stale: boolean | null;
  severity: CustodyObserverSeverity | null;
  alertEligible: boolean | null;
};

export type CustodyObserverValidationErrorCode =
  | "invalid_query"
  | "invalid_status"
  | "invalid_severity"
  | "invalid_stale"
  | "invalid_alert_eligible"
  | "invalid_limit"
  | "invalid_cursor"
  | "invalid_run_id";

export type CustodyObserverValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CustodyObserverValidationErrorCode };

const LIST_QUERY_KEYS = new Set([
  "status",
  "stale",
  "severity",
  "alertEligible",
  "cursor",
  "limit",
]);

export function parseAdminCustodyObserverListQuery(
  searchParams: URLSearchParams,
): CustodyObserverValidationResult<AdminCustodyObserverListQuery> {
  for (const key of searchParams.keys()) {
    if (!LIST_QUERY_KEYS.has(key) || searchParams.getAll(key).length !== 1) {
      return { ok: false, error: "invalid_query" };
    }
  }

  const status = parseOptionalStatus(searchParams, "status");
  if (!status.ok) return status;
  const stale = parseOptionalBoolean(searchParams, "stale", "invalid_stale");
  if (!stale.ok) return stale;
  const severity = parseOptionalSeverity(searchParams, "severity");
  if (!severity.ok) return severity;
  const alertEligible = parseOptionalBoolean(
    searchParams,
    "alertEligible",
    "invalid_alert_eligible",
  );
  if (!alertEligible.ok) return alertEligible;
  const limit = parseLimit(searchParams);
  if (!limit.ok) return limit;
  const cursor = parseOptionalCursor(searchParams);
  if (!cursor.ok) return cursor;

  return {
    ok: true,
    value: {
      status: status.value,
      stale: stale.value,
      severity: severity.value,
      alertEligible: alertEligible.value,
      limit: limit.value,
      cursor: cursor.value,
    },
  };
}

export function parseCustodyObserverRunId(
  value: unknown,
): CustodyObserverValidationResult<string> {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? { ok: true, value }
    : { ok: false, error: "invalid_run_id" };
}

export function encodeCustodyObserverListCursor(
  cursor: CustodyObserverListCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function parseOptionalStatus(
  searchParams: URLSearchParams,
  key: "status",
): CustodyObserverValidationResult<CustodyObserverRunStatus | null> {
  if (!searchParams.has(key)) return { ok: true, value: null };
  const value = searchParams.get(key);
  return value !== null && CUSTODY_OBSERVER_RUN_STATUSES.includes(value as CustodyObserverRunStatus)
    ? { ok: true, value: value as CustodyObserverRunStatus }
    : { ok: false, error: "invalid_status" };
}

function parseOptionalSeverity(
  searchParams: URLSearchParams,
  key: "severity",
): CustodyObserverValidationResult<CustodyObserverSeverity | null> {
  if (!searchParams.has(key)) return { ok: true, value: null };
  const value = searchParams.get(key);
  return value !== null && CUSTODY_OBSERVER_SEVERITIES.includes(value as CustodyObserverSeverity)
    ? { ok: true, value: value as CustodyObserverSeverity }
    : { ok: false, error: "invalid_severity" };
}

function parseOptionalBoolean(
  searchParams: URLSearchParams,
  key: "stale" | "alertEligible",
  error: "invalid_stale" | "invalid_alert_eligible",
): CustodyObserverValidationResult<boolean | null> {
  if (!searchParams.has(key)) return { ok: true, value: null };
  const value = searchParams.get(key);
  return value === "true"
    ? { ok: true, value: true }
    : value === "false"
      ? { ok: true, value: false }
      : { ok: false, error };
}

function parseLimit(
  searchParams: URLSearchParams,
): CustodyObserverValidationResult<number> {
  if (!searchParams.has("limit")) return { ok: true, value: 25 };
  const value = searchParams.get("limit");
  if (value === null || !CANONICAL_POSITIVE_INTEGER_PATTERN.test(value)) {
    return { ok: false, error: "invalid_limit" };
  }
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit <= 100
    ? { ok: true, value: limit }
    : { ok: false, error: "invalid_limit" };
}

function parseOptionalCursor(
  searchParams: URLSearchParams,
): CustodyObserverValidationResult<CustodyObserverListCursor | null> {
  if (!searchParams.has("cursor")) return { ok: true, value: null };
  const value = searchParams.get("cursor");
  if (!value || value.length > 512 || !BASE64URL_PATTERN.test(value)) {
    return { ok: false, error: "invalid_cursor" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "invalid_cursor" };
  }

  if (!isExactRecord(payload, ["createdAt", "runId"])) {
    return { ok: false, error: "invalid_cursor" };
  }

  const createdAt = payload.createdAt;
  const runId = parseCustodyObserverRunId(payload.runId);
  if (
    typeof createdAt !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !runId.ok
  ) {
    return { ok: false, error: "invalid_cursor" };
  }

  return { ok: true, value: { createdAt, runId: runId.value } };
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
