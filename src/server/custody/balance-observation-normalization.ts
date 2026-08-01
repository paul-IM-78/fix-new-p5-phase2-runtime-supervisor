import "server-only";

import { createHash } from "node:crypto";

import type { CustodyBalanceObservationIdentity } from "./provider-observation-contract";

export const CUSTODY_BALANCE_OBSERVER_KIND_V1 = "BALANCE_OBSERVER_V1";

export type BalanceObservationKeyModeV1 = "n" | "k" | "c";

export type BalanceObservationKeyV1Input = {
  providerCode: string;
  bindingId: string;
  assetId: string;
  observerKind: string;
  identity: CustodyBalanceObservationIdentity;
  observedTotalUnits?: string;
  observedAt?: string;
};

export type BalanceObservationKeyV1Details = {
  key: string;
  mode: BalanceObservationKeyModeV1;
  digest: string;
  canonicalFields: readonly string[];
  canonicalJson: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ATOMIC_UNITS_PATTERN = /^(0|[1-9][0-9]{0,37})$/;
const OBSERVER_KIND_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,63}$/;
const PROVIDER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,63}$/;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const CREDENTIAL_MARKER_PATTERN =
  /(api[ _-]*key|api[ _-]*secret|private[ _-]*key|mnemonic|seed[ _-]*phrase|bearer|access[ _-]*token|refresh[ _-]*token|service[ _-]*role|database[ _-]*url|password|cookie|jwt|credential)/i;
const URL_LIKE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const WALLET_ADDRESS_LIKE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TRANSACTION_SIGNATURE_LIKE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const MAX_IDENTITY_LENGTH = 128;

export function normalizeAtomicUnits(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("atomic_units_must_be_string");
  }

  if (!ATOMIC_UNITS_PATTERN.test(value)) {
    throw new RangeError("atomic_units_invalid");
  }

  return value;
}

export function normalizeUtcMicrosecondTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("timestamp_must_be_string");
  }

  if (value !== value.trim() || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new RangeError("timestamp_invalid");
  }

  const match = value.match(TIMESTAMP_PATTERN);

  if (!match) {
    throw new RangeError("timestamp_invalid");
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const fractionText = match[7] ?? "";
  const zoneText = match[8] ?? "";
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new RangeError("timestamp_invalid");
  }

  const localEpochMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const localDate = new Date(localEpochMs);

  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hour ||
    localDate.getUTCMinutes() !== minute ||
    localDate.getUTCSeconds() !== second
  ) {
    throw new RangeError("timestamp_invalid");
  }

  const offsetMinutes = parseOffsetMinutes(zoneText);
  const utcDate = new Date(localEpochMs - offsetMinutes * 60_000);
  const isoWithoutFraction = utcDate.toISOString().slice(0, 19);
  const microseconds = fractionText.padEnd(6, "0");

  return `${isoWithoutFraction}.${microseconds}Z`;
}

export function normalizeCanonicalUuid(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("uuid_must_be_string");
  }

  if (!UUID_PATTERN.test(value)) {
    throw new RangeError("uuid_invalid");
  }

  return value;
}

export function normalizeObservationIdentityValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("observation_identity_must_be_string");
  }

  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > MAX_IDENTITY_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    CREDENTIAL_MARKER_PATTERN.test(value) ||
    URL_LIKE_PATTERN.test(value) ||
    WALLET_ADDRESS_LIKE_PATTERN.test(value) ||
    TRANSACTION_SIGNATURE_LIKE_PATTERN.test(value)
  ) {
    throw new RangeError("observation_identity_invalid");
  }

  return value.normalize("NFC");
}

export function createBalanceObservationKeyV1(
  input: BalanceObservationKeyV1Input,
): string {
  return createBalanceObservationKeyDetailsV1(input).key;
}

export function createBalanceObservationKeyDetailsV1(
  input: BalanceObservationKeyV1Input,
): BalanceObservationKeyV1Details {
  const canonicalFields = createCanonicalFields(input);
  const canonicalJson = JSON.stringify(canonicalFields);
  const digest = createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  const mode = modeForIdentity(input.identity);

  return {
    key: `balobs:v1:${mode}:${digest}`,
    mode,
    digest,
    canonicalFields,
    canonicalJson,
  };
}

function createCanonicalFields(
  input: BalanceObservationKeyV1Input,
): readonly string[] {
  const providerCode = normalizeProviderCode(input.providerCode);
  const bindingId = normalizeCanonicalUuid(input.bindingId);
  const assetId = normalizeCanonicalUuid(input.assetId);
  const observerKind = normalizeObserverKind(input.observerKind);

  if (input.identity.kind === "NATIVE") {
    return [
      "BALANCE_OBSERVATION",
      "v1",
      "native",
      providerCode,
      bindingId,
      assetId,
      observerKind,
      normalizeObservationIdentityValue(input.identity.value),
    ];
  }

  if (input.identity.kind === "CHECKPOINT") {
    return [
      "BALANCE_OBSERVATION",
      "v1",
      "checkpoint",
      providerCode,
      bindingId,
      assetId,
      observerKind,
      normalizeObservationIdentityValue(input.identity.value),
    ];
  }

  return [
    "BALANCE_OBSERVATION",
    "v1",
    "content",
    providerCode,
    bindingId,
    assetId,
    observerKind,
    normalizeAtomicUnits(input.observedTotalUnits),
    normalizeUtcMicrosecondTimestamp(input.observedAt),
  ];
}

function normalizeProviderCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("provider_code_must_be_string");
  }

  if (!PROVIDER_CODE_PATTERN.test(value)) {
    throw new RangeError("provider_code_invalid");
  }

  return value;
}

function normalizeObserverKind(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("observer_kind_must_be_string");
  }

  if (!OBSERVER_KIND_PATTERN.test(value)) {
    throw new RangeError("observer_kind_invalid");
  }

  return value;
}

function modeForIdentity(
  identity: CustodyBalanceObservationIdentity,
): BalanceObservationKeyModeV1 {
  if (identity.kind === "NATIVE") {
    return "n";
  }

  if (identity.kind === "CHECKPOINT") {
    return "k";
  }

  return "c";
}

function parseOffsetMinutes(zoneText: string): number {
  if (zoneText === "Z") {
    return 0;
  }

  const sign = zoneText[0] === "-" ? -1 : 1;
  const hours = Number(zoneText.slice(1, 3));
  const minutes = Number(zoneText.slice(4, 6));

  if (hours > 23 || minutes > 59) {
    throw new RangeError("timestamp_invalid");
  }

  return sign * (hours * 60 + minutes);
}
