const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const WHITESPACE_PATTERN = /\s/;
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOTP_CODE_PATTERN = /^\d{6}$/;
const SAFE_AUTH_NEXT_PATHS = new Set([
  "/",
  "/account",
  "/dashboard",
  "/catalog",
  "/wallet",
  "/deposits",
  "/withdrawals",
  "/admin",
  "/admin/deposits",
  "/admin/withdrawals",
]);

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    CONTROL_CHARACTER_PATTERN.test(normalized) ||
    WHITESPACE_PATTERN.test(normalized) ||
    !BASIC_EMAIL_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (
    value.length < 12 ||
    value.length > 128 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }

  return value;
}

export function validateRecoveryTokenHash(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (
    value.length < 16 ||
    value.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    WHITESPACE_PATTERN.test(value)
  ) {
    return null;
  }

  return value;
}

export function validateTotpCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized.length !== 6 ||
    CONTROL_CHARACTER_PATTERN.test(normalized) ||
    !TOTP_CODE_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function validateMfaFactorId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateAuthUserId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateCommandId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateAdminRoleReason(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    normalized.length < 1 ||
    normalized.length > 500 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function validateUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (
    value.length > 64 ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    !UUID_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function normalizeDisplayName(
  value: unknown,
): string | undefined | null {
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

  if (
    normalized.length > 80 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function getSafeAuthNextPath(
  value: unknown,
  fallback = "/account",
): string {
  const safeFallback = SAFE_AUTH_NEXT_PATHS.has(fallback)
    ? fallback
    : "/account";

  if (typeof value !== "string") {
    return safeFallback;
  }

  const candidate = value.trim();

  if (
    !candidate ||
    CONTROL_CHARACTER_PATTERN.test(candidate) ||
    candidate.includes("\\") ||
    candidate.includes(":") ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    !SAFE_AUTH_NEXT_PATHS.has(candidate)
  ) {
    return safeFallback;
  }

  return candidate;
}
