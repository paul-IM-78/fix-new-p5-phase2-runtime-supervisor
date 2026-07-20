const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATOMIC_UNITS_PATTERN = /^[1-9][0-9]{0,37}$/;
const CREDENTIAL_REASON_PATTERN =
  /(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)/i;

export function validateLedgerWalletAccountId(
  value: unknown,
): string | null {
  return validateUuid(value);
}

export function validateLedgerAssetId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateLedgerJournalId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateLedgerCommandId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateLedgerExpectedVersion(
  value: unknown,
): number | null {
  if (typeof value !== "string") {
    return null;
  }

  if (
    value.length > 16 ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    !/^[1-9][0-9]*$/.test(value)
  ) {
    return null;
  }

  const normalized = Number(value);

  return Number.isSafeInteger(normalized) && normalized >= 1
    ? normalized
    : null;
}

export function validateAtomicUnitsString(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return ATOMIC_UNITS_PATTERN.test(value) ? value : null;
}

export function normalizeFinancialAdminReason(
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
