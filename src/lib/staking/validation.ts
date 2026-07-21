const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const PRODUCT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const POSITIVE_ATOMIC_UNITS_PATTERN = /^[1-9][0-9]{0,37}$/;
const ISO_DATETIME_WITH_ZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const CREDENTIAL_REASON_PATTERN =
  /(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)/i;

export type StakingProductStatus =
  | "DRAFT"
  | "ACTIVE"
  | "SUSPENDED"
  | "ARCHIVED";

export function validateStakingEntityId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateStakingCommandId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateStakingExpectedVersion(
  value: unknown,
): number | null {
  return validateSafeInteger(value, 1, Number.MAX_SAFE_INTEGER);
}

export function validateStakingProductCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length <= 32 &&
    !CONTROL_CHARACTER_PATTERN.test(normalized) &&
    PRODUCT_CODE_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function normalizeStakingDisplayName(value: unknown): string | null {
  return normalizeBoundedText(value, 1, 100);
}

export function normalizeStakingDescription(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return isBoundedText(normalized, 1, 1000) ? normalized : null;
}

export function validateLockDurationDays(value: unknown): number | null {
  return validateSafeInteger(value, 1, 3650);
}

export function validatePositiveAtomicUnits(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return POSITIVE_ATOMIC_UNITS_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function normalizeOptionalPositiveAtomicUnits(
  value: unknown,
): string | null | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  return POSITIVE_ATOMIC_UNITS_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function validateTermRewardRatePpm(value: unknown): number | null {
  return validateSafeInteger(value, 1, 1000000);
}

export function validateIsoDateTime(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized.length > 64 ||
    CONTROL_CHARACTER_PATTERN.test(normalized) ||
    !ISO_DATETIME_WITH_ZONE_PATTERN.test(normalized) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    return null;
  }

  return normalized;
}

export function validateStakingProductStatus(
  value: unknown,
): StakingProductStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized === "DRAFT" ||
    normalized === "ACTIVE" ||
    normalized === "SUSPENDED" ||
    normalized === "ARCHIVED"
    ? normalized
    : null;
}

export function normalizeStakingCommandReason(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length >= 1 &&
    normalized.length <= 500 &&
    !CONTROL_CHARACTER_PATTERN.test(normalized) &&
    !CREDENTIAL_REASON_PATTERN.test(normalized)
    ? normalized
    : null;
}

function validateUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return value.length <= 64 &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    UUID_PATTERN.test(normalized)
    ? normalized
    : null;
}

function normalizeBoundedText(
  value: unknown,
  minLength: number,
  maxLength: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return isBoundedText(normalized, minLength, maxLength)
    ? normalized
    : null;
}

function isBoundedText(
  value: string,
  minLength: number,
  maxLength: number,
): boolean {
  return (
    value.length >= minLength &&
    value.length <= maxLength &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function validateSafeInteger(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const rawValue = typeof value === "number" ? String(value) : value.trim();

  if (!/^[1-9][0-9]*$/.test(rawValue)) {
    return null;
  }

  const normalized = Number(rawValue);

  return Number.isSafeInteger(normalized) &&
    normalized >= min &&
    normalized <= max
    ? normalized
    : null;
}
