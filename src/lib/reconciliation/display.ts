import { formatAtomicUnitsForDisplay } from "@/lib/ledger/atomic-units";

export const EMPTY_RECONCILIATION_DISPLAY = "--";

export function formatOptionalTimestamp(value: string | null): string {
  if (!value) {
    return EMPTY_RECONCILIATION_DISPLAY;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? EMPTY_RECONCILIATION_DISPLAY
    : date.toISOString();
}

export function formatOptionalAtomicUnits(value: string | null): string {
  return value === null
    ? EMPTY_RECONCILIATION_DISPLAY
    : formatAtomicUnitsForDisplay(value);
}

export function formatSignedAtomicUnits(value: string | null): string {
  if (value === null) {
    return EMPTY_RECONCILIATION_DISPLAY;
  }

  if (!value.startsWith("-")) {
    return formatAtomicUnitsForDisplay(value);
  }

  const unsignedValue = value.slice(1);
  const formatted = formatAtomicUnitsForDisplay(unsignedValue);

  return formatted === "Unavailable atomic units" ? formatted : `-${formatted}`;
}

export function formatOptionalText(value: string | null): string {
  return value ?? EMPTY_RECONCILIATION_DISPLAY;
}

export function shortIdentifier(value: string | null): string {
  if (!value) {
    return EMPTY_RECONCILIATION_DISPLAY;
  }

  return value.length > 18
    ? `${value.slice(0, 8)}...${value.slice(-6)}`
    : value;
}
