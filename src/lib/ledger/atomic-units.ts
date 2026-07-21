const CANONICAL_NON_NEGATIVE_ATOMIC_UNITS_PATTERN =
  /^(0|[1-9][0-9]{0,37})$/;
const POSITIVE_ATOMIC_UNITS_PATTERN = /^[1-9][0-9]{0,37}$/;

export function isCanonicalNonNegativeAtomicUnits(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CANONICAL_NON_NEGATIVE_ATOMIC_UNITS_PATTERN.test(value)
  );
}

export function isPositiveAtomicUnits(value: unknown): value is string {
  return typeof value === "string" && POSITIVE_ATOMIC_UNITS_PATTERN.test(value);
}

export function addAtomicUnitStrings(
  left: string,
  right: string,
): string | null {
  if (
    !isCanonicalNonNegativeAtomicUnits(left) ||
    !isCanonicalNonNegativeAtomicUnits(right)
  ) {
    return null;
  }

  const result = (BigInt(left) + BigInt(right)).toString();

  return isCanonicalNonNegativeAtomicUnits(result) ? result : null;
}

export function compareAtomicUnitStrings(
  left: string,
  right: string,
): -1 | 0 | 1 | null {
  if (
    !isCanonicalNonNegativeAtomicUnits(left) ||
    !isCanonicalNonNegativeAtomicUnits(right)
  ) {
    return null;
  }

  if (left.length < right.length) {
    return -1;
  }

  if (left.length > right.length) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function formatAtomicUnitsForDisplay(value: string): string {
  if (!isCanonicalNonNegativeAtomicUnits(value)) {
    return "Unavailable atomic units";
  }

  return `${groupDecimalDigits(value)} atomic units`;
}

function groupDecimalDigits(value: string): string {
  let remaining = value;
  const groups: string[] = [];

  while (remaining.length > 3) {
    groups.unshift(remaining.slice(-3));
    remaining = remaining.slice(0, -3);
  }

  groups.unshift(remaining);

  return groups.join(",");
}
