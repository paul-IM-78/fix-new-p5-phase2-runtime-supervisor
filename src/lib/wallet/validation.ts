const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WalletAccountStatus = "ACTIVE" | "FROZEN" | "CLOSED";

export function validateWalletAccountId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateWalletCommandId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateWalletExpectedVersion(
  value: unknown,
): number | null {
  const normalized = normalizeInteger(value);

  return normalized !== null && normalized >= 1 ? normalized : null;
}

export function validateWalletAccountStatus(
  value: unknown,
): WalletAccountStatus | null {
  const normalized = normalizeToken(value);

  return isWalletAccountStatus(normalized) ? normalized : null;
}

export function normalizeWalletCommandReason(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length >= 1 &&
    normalized.length <= 500 &&
    !CONTROL_CHARACTER_PATTERN.test(normalized)
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

function isWalletAccountStatus(
  value: string | null,
): value is WalletAccountStatus {
  return value === "ACTIVE" || value === "FROZEN" || value === "CLOSED";
}
