const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATOMIC_UNITS_PATTERN = /^[1-9][0-9]{0,37}$/;
const CREDENTIAL_REASON_PATTERN =
  /(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret|transaction[_ ]?id|signature|blockchain[_ ]?address|wallet[_ ]?address|withdrawal[_ ]?address)/i;

export function validateWithdrawalWalletAccountId(
  value: unknown,
): string | null {
  return validateUuid(value);
}

export function validateWithdrawalAssetId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateWithdrawalRequestId(
  value: unknown,
): string | null {
  return validateUuid(value);
}

export function validateWithdrawalCommandId(
  value: unknown,
): string | null {
  return validateUuid(value);
}

export function validateWithdrawalExpectedVersion(
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

export function validateWithdrawalUnitsString(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return ATOMIC_UNITS_PATTERN.test(value) ? value : null;
}

export function normalizeWithdrawalReason(value: unknown): string | null {
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
