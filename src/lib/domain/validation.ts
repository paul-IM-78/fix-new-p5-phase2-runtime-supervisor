const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,31}$/;
const ASSET_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,31}$/;
const ASSET_SYMBOL_PATTERN = /^[A-Z0-9]{1,16}$/;
const BASE58_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type ProjectStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type AssetStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type AssetType = "NATIVE" | "SPL_TOKEN";

export function validateProjectCode(value: unknown): string | null {
  return validatePatternText(value, PROJECT_CODE_PATTERN, 32);
}

export function normalizeProjectDisplayName(value: unknown): string | null {
  return normalizeBoundedText(value, 1, 100);
}

export function normalizeProjectDescription(value: unknown): string | null {
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

  return isBoundedText(normalized, 1, 2000) ? normalized : null;
}

export function validateAssetCode(value: unknown): string | null {
  return validatePatternText(value, ASSET_CODE_PATTERN, 32);
}

export function validateAssetSymbol(value: unknown): string | null {
  return validatePatternText(value, ASSET_SYMBOL_PATTERN, 16);
}

export function normalizeAssetDisplayName(value: unknown): string | null {
  return normalizeBoundedText(value, 1, 100);
}

export function validateAssetType(value: unknown): AssetType | null {
  const normalized = normalizeToken(value);

  return normalized === "NATIVE" || normalized === "SPL_TOKEN"
    ? normalized
    : null;
}

export function validateAssetDecimals(value: unknown): number | null {
  const normalized = normalizeInteger(value);

  return normalized !== null && normalized >= 0 && normalized <= 18
    ? normalized
    : null;
}

export function normalizeAssetMintAddress(
  value: unknown,
  assetType: AssetType,
): string | null {
  if (assetType === "NATIVE") {
    return isBlankDomainValue(value) ? null : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return BASE58_MINT_PATTERN.test(normalized) ? normalized : null;
}

export function validateDomainEntityId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateDomainCommandId(value: unknown): string | null {
  return validateUuid(value);
}

export function validateExpectedVersion(value: unknown): number | null {
  const normalized = normalizeInteger(value);

  return normalized !== null && normalized >= 1 ? normalized : null;
}

export function normalizeDomainCommandReason(value: unknown): string | null {
  return normalizeBoundedText(value, 1, 500);
}

export function isBlankDomainValue(value: unknown): boolean {
  return isBlank(value);
}

export function validateProjectStatus(value: unknown): ProjectStatus | null {
  const normalized = normalizeToken(value);

  return isProjectStatus(normalized) ? normalized : null;
}

export function validateAssetStatus(value: unknown): AssetStatus | null {
  const normalized = normalizeToken(value);

  return isAssetStatus(normalized) ? normalized : null;
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

function isBlank(value: unknown): boolean {
  return value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "");
}

function isProjectStatus(value: string | null): value is ProjectStatus {
  return (
    value === "DRAFT" ||
    value === "ACTIVE" ||
    value === "SUSPENDED" ||
    value === "ARCHIVED"
  );
}

function isAssetStatus(value: string | null): value is AssetStatus {
  return (
    value === "DRAFT" ||
    value === "ACTIVE" ||
    value === "SUSPENDED" ||
    value === "ARCHIVED"
  );
}
