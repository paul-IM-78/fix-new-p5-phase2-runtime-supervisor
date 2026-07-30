const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const FORBIDDEN_IDEMPOTENCY_MARKER_PATTERN =
  /(api[\s_-]*key|api[\s_-]*secret|private[\s_-]*key|mnemonic|seed[\s_-]*phrase|bearer|access[\s_-]*token|refresh[\s_-]*token|service[\s_-]*role|database[\s_-]*url|password|cookie|jwt|signature|address|https?:\/\/|rpc)/i;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
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
