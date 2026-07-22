const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const PROVIDER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const BINDING_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const FORBIDDEN_BINDING_MARKER_PATTERN =
  /(https?:\/\/|bearer|begin[\s_-]*private[\s_-]*key|private[\s_-]*key|mnemonic|seed[\s_-]*phrase|api[\s_-]*key|api[\s_-]*secret|address|signature|transaction|tx[\s_-]*(id|hash)|provider[\s_-]*account)/i;
const FORBIDDEN_REASON_MARKER_PATTERN =
  /(api[\s_-]*key|api[\s_-]*secret|private[\s_-]*key|mnemonic|seed[\s_-]*phrase|bearer|access[\s_-]*token|refresh[\s_-]*token|service[\s_-]*role|database[\s_-]*url|https?:\/\/)/i;

export type CustodyProviderType =
  | "MPC_CUSTODIAN"
  | "QUALIFIED_CUSTODIAN"
  | "EXCHANGE_CUSTODY"
  | "INTERNAL_HSM";

export type CustodyStatus = "DRAFT" | "APPROVED" | "SUSPENDED" | "RETIRED";

export type CustodyAccountRole =
  | "COLLECTION"
  | "PAYOUT"
  | "TREASURY"
  | "FEE";

export function validateCustodyEntityId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateCustodyCommandId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateCustodyExpectedVersion(
  value: unknown,
): number | null {
  const normalized = normalizeInteger(value);

  return normalized !== null && normalized >= 1 ? normalized : null;
}

export function validateCustodyProviderCode(value: unknown): string | null {
  return validatePatternText(value, PROVIDER_CODE_PATTERN, 32);
}

export function normalizeCustodyDisplayName(
  value: unknown,
): string | null {
  return normalizeBoundedText(value, 1, 100);
}

export function normalizeCustodyDisplayLabel(
  value: unknown,
): string | null {
  return normalizeBoundedText(value, 1, 100);
}

export function validateCustodyProviderType(
  value: unknown,
): CustodyProviderType | null {
  const normalized = normalizeToken(value);

  return isCustodyProviderType(normalized) ? normalized : null;
}

export function validateCustodyStatus(value: unknown): CustodyStatus | null {
  const normalized = normalizeToken(value);

  return isCustodyStatus(normalized) ? normalized : null;
}

export function validateCustodyAccountRole(
  value: unknown,
): CustodyAccountRole | null {
  const normalized = normalizeToken(value);

  return isCustodyAccountRole(normalized) ? normalized : null;
}

export function validateCustodyBindingKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    !BINDING_KEY_PATTERN.test(normalized) ||
    /[\s/\\:@]/.test(normalized) ||
    CONTROL_CHARACTER_PATTERN.test(normalized) ||
    FORBIDDEN_BINDING_MARKER_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function normalizeCustodyCommandReason(
  value: unknown,
): string | null {
  const normalized = normalizeBoundedText(value, 1, 500);

  return normalized && !FORBIDDEN_REASON_MARKER_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function parseCustodyBoolean(value: unknown): boolean {
  return value === "on" || value === "true" || value === true;
}

export function isBlankCustodyValue(value: unknown): boolean {
  return value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "");
}

function validatePatternText(
  value: unknown,
  pattern: RegExp,
  maxLength: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized.length < 1 ||
    normalized.length > maxLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized) ||
    !pattern.test(normalized)
  ) {
    return null;
  }

  return normalized;
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

  return normalized.length >= minLength &&
    normalized.length <= maxLength &&
    !CONTROL_CHARACTER_PATTERN.test(normalized)
    ? normalized
    : null;
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

function normalizeInteger(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized =
    typeof value === "number" ? value : Number(value.trim());

  return Number.isSafeInteger(normalized) ? normalized : null;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return CONTROL_CHARACTER_PATTERN.test(normalized) ? null : normalized;
}

function isCustodyProviderType(
  value: string | null,
): value is CustodyProviderType {
  return (
    value === "MPC_CUSTODIAN" ||
    value === "QUALIFIED_CUSTODIAN" ||
    value === "EXCHANGE_CUSTODY" ||
    value === "INTERNAL_HSM"
  );
}

function isCustodyStatus(value: string | null): value is CustodyStatus {
  return (
    value === "DRAFT" ||
    value === "APPROVED" ||
    value === "SUSPENDED" ||
    value === "RETIRED"
  );
}

function isCustodyAccountRole(
  value: string | null,
): value is CustodyAccountRole {
  return (
    value === "COLLECTION" ||
    value === "PAYOUT" ||
    value === "TREASURY" ||
    value === "FEE"
  );
}
