const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const FORBIDDEN_IDEMPOTENCY_MARKER_PATTERN =
  /(api[\s_-]*key|api[\s_-]*secret|private[\s_-]*key|mnemonic|seed[\s_-]*phrase|bearer|access[\s_-]*token|refresh[\s_-]*token|service[\s_-]*role|database[\s_-]*url|password|cookie|jwt|signature|address|https?:\/\/|rpc)/i;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
const OBSERVER_KIND_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,63}$/;
const SPOOFED_ACTOR_FIELD_NAMES = new Set([
  "actorProfileId",
  "actor_profile_id",
  "openedByProfileId",
  "opened_by_profile_id",
  "lastActorProfileId",
  "last_actor_profile_id",
  "userId",
  "user_id",
  "role",
  "aal",
  "isAdmin",
  "is_admin",
]);

export type ReconciliationReviewTargetStatus =
  | "IN_REVIEW"
  | "RESOLVED"
  | "IGNORED";

export type ReconciliationRunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED";

export type ReconciliationItemClassification =
  | "MATCHED"
  | "WITHIN_TOLERANCE"
  | "MISMATCH"
  | "OBSERVATION_FAILED"
  | "REVIEW_REQUIRED";

export type ReconciliationReviewState =
  | "NONE"
  | "OPEN"
  | "IN_REVIEW"
  | "RESOLVED"
  | "IGNORED";

export type AdminReconciliationListQuery = {
  limit: number;
  cursor: ReconciliationListCursor | null;
  assetId: string | null;
  runStatus: ReconciliationRunStatus | null;
  classification: ReconciliationItemClassification | null;
  reviewState: ReconciliationReviewState | null;
  observerKind: string | null;
  cutoffFrom: string | null;
  cutoffTo: string | null;
};

export type ReconciliationListCursor = {
  createdAt: string;
  itemId: string;
};

export type ReconciliationReviewOpenDto = {
  reconciliationItemId: string;
  idempotencyKey: string;
  reasonCode: string;
};

export type ReconciliationReviewTransitionDto = {
  reviewCaseId: string;
  expectedVersion: number;
  targetStatus: ReconciliationReviewTargetStatus;
  idempotencyKey: string;
  reasonCode: string;
};

const ADMIN_RECONCILIATION_LIST_QUERY_KEYS = [
  "limit",
  "cursor",
  "assetId",
  "runStatus",
  "classification",
  "reviewState",
  "observerKind",
  "cutoffFrom",
  "cutoffTo",
] as const;

export function isPlainJsonObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function parseReconciliationReviewOpenDto(
  value: Record<string, unknown>,
): ReconciliationReviewOpenDto | null {
  if (
    !hasOnlyAllowedKeys(value, [
      "reconciliationItemId",
      "idempotencyKey",
      "reasonCode",
    ])
  ) {
    return null;
  }

  const reconciliationItemId = validateUuid(value.reconciliationItemId);
  const idempotencyKey = normalizeIdempotencyKey(value.idempotencyKey);
  const reasonCode = normalizeReasonCode(value.reasonCode);

  return reconciliationItemId && idempotencyKey && reasonCode
    ? { reconciliationItemId, idempotencyKey, reasonCode }
    : null;
}

export function parseReconciliationReviewTransitionDto(
  value: Record<string, unknown>,
): ReconciliationReviewTransitionDto | null {
  if (
    !hasOnlyAllowedKeys(value, [
      "reviewCaseId",
      "expectedVersion",
      "targetStatus",
      "idempotencyKey",
      "reasonCode",
    ])
  ) {
    return null;
  }

  const reviewCaseId = validateUuid(value.reviewCaseId);
  const expectedVersion = validateExpectedVersion(value.expectedVersion);
  const targetStatus = validateTargetStatus(value.targetStatus);
  const idempotencyKey = normalizeIdempotencyKey(value.idempotencyKey);
  const reasonCode = normalizeReasonCode(value.reasonCode);

  return reviewCaseId &&
    expectedVersion !== null &&
    targetStatus &&
    idempotencyKey &&
    reasonCode
    ? { reviewCaseId, expectedVersion, targetStatus, idempotencyKey, reasonCode }
    : null;
}

export function parseAdminReconciliationListQuery(
  searchParams: URLSearchParams,
): AdminReconciliationListQuery | null {
  if (!hasOnlyAllowedQueryKeys(searchParams)) {
    return null;
  }

  const limit = parseOptionalLimit(readOptionalScalar(searchParams, "limit"));
  const cursor = parseOptionalCursor(readOptionalScalar(searchParams, "cursor"));
  const assetId = parseOptionalUuid(readOptionalScalar(searchParams, "assetId"));
  const runStatus = parseOptionalRunStatus(
    readOptionalScalar(searchParams, "runStatus"),
  );
  const classification = parseOptionalClassification(
    readOptionalScalar(searchParams, "classification"),
  );
  const reviewState = parseOptionalReviewState(
    readOptionalScalar(searchParams, "reviewState"),
  );
  const observerKind = parseOptionalObserverKind(
    readOptionalScalar(searchParams, "observerKind"),
  );
  const cutoffFrom = parseOptionalTimestamp(
    readOptionalScalar(searchParams, "cutoffFrom"),
  );
  const cutoffTo = parseOptionalTimestamp(
    readOptionalScalar(searchParams, "cutoffTo"),
  );

  if (
    limit === "invalid" ||
    cursor === "invalid" ||
    assetId === "invalid" ||
    runStatus === "invalid" ||
    classification === "invalid" ||
    reviewState === "invalid" ||
    observerKind === "invalid" ||
    cutoffFrom === "invalid" ||
    cutoffTo === "invalid"
  ) {
    return null;
  }

  if (cutoffFrom !== null && cutoffTo !== null) {
    if (!isTimestampRangeAscending(cutoffFrom, cutoffTo)) {
      return null;
    }
  }

  return {
    limit,
    cursor,
    assetId,
    runStatus,
    classification,
    reviewState,
    observerKind,
    cutoffFrom,
    cutoffTo,
  };
}

export function parseReconciliationItemId(value: unknown): string | null {
  return validateUuid(value);
}

export function encodeReconciliationListCursor(
  cursor: ReconciliationListCursor,
): string {
  const payload = JSON.stringify({
    createdAt: cursor.createdAt,
    itemId: cursor.itemId,
  });

  return Buffer.from(payload, "utf8").toString("base64url");
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);

  for (const key of Object.keys(value)) {
    if (SPOOFED_ACTOR_FIELD_NAMES.has(key) || !allowed.has(key)) {
      return false;
    }
  }

  return true;
}

function hasOnlyAllowedQueryKeys(searchParams: URLSearchParams): boolean {
  const allowed = new Set<string>(ADMIN_RECONCILIATION_LIST_QUERY_KEYS);

  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      return false;
    }
  }

  return true;
}

function readOptionalScalar(
  searchParams: URLSearchParams,
  key: (typeof ADMIN_RECONCILIATION_LIST_QUERY_KEYS)[number],
): string | null {
  return searchParams.has(key) ? searchParams.get(key) : null;
}

function parseOptionalLimit(value: string | null): number | "invalid" {
  if (value === null) {
    return 50;
  }

  const normalized = value.trim();

  if (normalized === "" || !/^[0-9]{1,3}$/.test(normalized)) {
    return "invalid";
  }

  const limit = Number(normalized);

  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 100
    ? limit
    : "invalid";
}

function parseOptionalCursor(
  value: string | null,
): ReconciliationListCursor | null | "invalid" {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized === "" ||
    normalized.length > 512 ||
    !BASE64URL_PATTERN.test(normalized)
  ) {
    return "invalid";
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(normalized, "base64url").toString("utf8"));
  } catch {
    return "invalid";
  }

  if (!isPlainJsonObject(parsed)) {
    return "invalid";
  }

  if (!hasOnlyAllowedKeys(parsed, ["createdAt", "itemId"])) {
    return "invalid";
  }

  const createdAt = parseOptionalTimestamp(readString(parsed.createdAt));
  const itemId = validateUuid(parsed.itemId);

  return createdAt && createdAt !== "invalid" && itemId
    ? { createdAt, itemId }
    : "invalid";
}

function parseOptionalUuid(value: string | null): string | null | "invalid" {
  if (value === null) {
    return null;
  }

  const parsed = validateUuid(value);

  return parsed ?? "invalid";
}

function parseOptionalRunStatus(
  value: string | null,
): ReconciliationRunStatus | null | "invalid" {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  switch (normalized) {
    case "PENDING":
    case "RUNNING":
    case "COMPLETED":
    case "PARTIAL":
    case "FAILED":
      return normalized;
    default:
      return "invalid";
  }
}

function parseOptionalClassification(
  value: string | null,
): ReconciliationItemClassification | null | "invalid" {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  switch (normalized) {
    case "MATCHED":
    case "WITHIN_TOLERANCE":
    case "MISMATCH":
    case "OBSERVATION_FAILED":
    case "REVIEW_REQUIRED":
      return normalized;
    default:
      return "invalid";
  }
}

function parseOptionalReviewState(
  value: string | null,
): ReconciliationReviewState | null | "invalid" {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  switch (normalized) {
    case "NONE":
    case "OPEN":
    case "IN_REVIEW":
    case "RESOLVED":
    case "IGNORED":
      return normalized;
    default:
      return "invalid";
  }
}

function parseOptionalObserverKind(
  value: string | null,
): string | null | "invalid" {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  return normalized !== "" && OBSERVER_KIND_PATTERN.test(normalized)
    ? normalized
    : "invalid";
}

function parseOptionalTimestamp(
  value: string | null,
): string | null | "invalid" {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized === "" ||
    normalized.length > 64 ||
    !ISO_TIMESTAMP_PATTERN.test(normalized)
  ) {
    return "invalid";
  }

  const time = Date.parse(normalized);

  return Number.isFinite(time) ? normalized : "invalid";
}

function isTimestampRangeAscending(from: string, to: string): boolean {
  const fromMicros = parseTimestampToEpochMicros(from);
  const toMicros = parseTimestampToEpochMicros(to);

  return fromMicros !== null && toMicros !== null && fromMicros < toMicros;
}

function parseTimestampToEpochMicros(value: string): bigint | null {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const [, date, time, fraction = "", timezone] = match;
  const wholeSecondMilliseconds = Date.parse(`${date}T${time}${timezone}`);

  if (!Number.isSafeInteger(wholeSecondMilliseconds)) {
    return null;
  }

  const micros =
    fraction === "" ? BigInt(0) : BigInt(fraction.padEnd(6, "0"));

  return BigInt(wholeSecondMilliseconds) * BigInt(1000) + micros;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function validateUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length <= 64 &&
    !CONTROL_CHARACTER_PATTERN.test(normalized) &&
    UUID_PATTERN.test(normalized)
    ? normalized
    : null;
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return IDEMPOTENCY_KEY_PATTERN.test(normalized) &&
    !CONTROL_CHARACTER_PATTERN.test(normalized) &&
    !FORBIDDEN_IDEMPOTENCY_MARKER_PATTERN.test(normalized)
    ? normalized
    : null;
}

function normalizeReasonCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return REASON_CODE_PATTERN.test(normalized) &&
    !CONTROL_CHARACTER_PATTERN.test(normalized)
    ? normalized
    : null;
}

function validateExpectedVersion(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized =
    typeof value === "number" ? value : Number(value.trim());

  return Number.isSafeInteger(normalized) && normalized >= 1
    ? normalized
    : null;
}

function validateTargetStatus(
  value: unknown,
): ReconciliationReviewTargetStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized === "IN_REVIEW" ||
    normalized === "RESOLVED" ||
    normalized === "IGNORED"
    ? normalized
    : null;
}
