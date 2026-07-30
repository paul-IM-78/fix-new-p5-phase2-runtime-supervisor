import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import type { ReconciliationReadErrorCode } from "@/lib/reconciliation/public-results";
import {
  encodeReconciliationListCursor,
  type AdminReconciliationListQuery,
} from "@/lib/reconciliation/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database, Json } from "@/types/database.types";

type ListRow =
  Database["public"]["Functions"]["list_admin_reconciliation_items"]["Returns"][number];
type DetailRow =
  Database["public"]["Functions"]["get_admin_reconciliation_item_detail"]["Returns"][number];

type ReconciliationReadError = {
  code: ReconciliationReadErrorCode;
  httpStatus: number;
};

export type AdminReconciliationItemSummary = {
  reconciliationItemId: string;
  reconciliationRunId: string;
  assetId: string;
  asset: {
    assetCode: string;
    symbol: string;
    displayName: string;
    decimals: number;
  };
  scopeKind: string;
  runStatus: string;
  triggerSource: string;
  observerKind: string | null;
  observationCutoffAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  runCreatedAt: string;
  itemCreatedAt: string;
  failureCode: string | null;
  classification: string;
  reviewStatus: string | null;
  reviewVersion: number | null;
  expectedUnits: string;
  observedUnits: string | null;
  differenceUnits: string | null;
  toleranceUnits: string;
  targetBindingCount: number;
  observedBindingCount: number;
  missingBindingCount: number;
  failedBindingCount: number;
};

export type AdminReconciliationItemsResult = {
  items: AdminReconciliationItemSummary[];
  nextCursor: string | null;
};

export type AdminReconciliationRunDetail = {
  id: string;
  status: string;
  triggerSource: string;
  observerKind: string | null;
  observationCutoffAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  failureCode: string | null;
};

export type AdminReconciliationItemDetailBody = {
  id: string;
  scopeKind: string;
  asset: {
    id: string;
    assetCode: string;
    symbol: string;
    displayName: string;
    decimals: number;
  };
  expectedUnits: string;
  observedUnits: string | null;
  differenceUnits: string | null;
  toleranceUnits: string;
  classification: string;
  createdAt: string;
};

export type AdminReconciliationProvenance = {
  custodyAccountBindingId: string;
  providerCode: string;
  providerDisplayName: string;
  bindingLabel: string;
  bindingRole: string;
  membershipStatus: string;
  externalBalanceObservationId: string | null;
  observedUnits: string | null;
  observedAt: string | null;
  createdAt: string;
};

export type AdminReconciliationReviewCase = {
  id: string;
  status: string;
  version: number;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type AdminReconciliationReviewEvent = {
  eventVersion: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  reasonCode: string;
  createdAt: string;
};

export type AdminReconciliationItemDetail = {
  run: AdminReconciliationRunDetail;
  item: AdminReconciliationItemDetailBody;
  provenance: AdminReconciliationProvenance[];
  reviewCase: AdminReconciliationReviewCase | null;
  reviewEvents: AdminReconciliationReviewEvent[];
};

export type ReconciliationReadExecution<T> =
  | { ok: true; result: T }
  | { ok: false; error: ReconciliationReadError };

const INVALID = Symbol("invalid");
const UNSIGNED_ATOMIC_UNITS_PATTERN = /^(0|[1-9][0-9]{0,37})$/;
const SIGNED_ATOMIC_UNITS_PATTERN = /^-?(0|[1-9][0-9]{0,37})$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function listAdminReconciliationItems(
  input: AdminReconciliationListQuery,
): Promise<ReconciliationReadExecution<AdminReconciliationItemsResult>> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const rpcLimit = Math.min(input.limit + 1, 100);
  const response = await supabase.rpc("list_admin_reconciliation_items", {
    p_limit: rpcLimit,
    p_before_created_at: input.cursor?.createdAt,
    p_before_item_id: input.cursor?.itemId,
    p_asset_id: input.assetId ?? undefined,
    p_run_status: input.runStatus ?? undefined,
    p_classification: input.classification ?? undefined,
    p_review_state: input.reviewState ?? undefined,
    p_observer_kind: input.observerKind ?? undefined,
    p_cutoff_from: input.cutoffFrom ?? undefined,
    p_cutoff_to: input.cutoffTo ?? undefined,
  });

  if (response.error) {
    return { ok: false, error: mapReadRpcError(response.error) };
  }

  const normalizedItems = normalizeListRows(response.data ?? []);

  if (!normalizedItems) {
    return {
      ok: false,
      error: {
        code: "reconciliation_read_unavailable",
        httpStatus: 500,
      },
    };
  }

  const hasNextPage = normalizedItems.length > input.limit;
  const items = normalizedItems.slice(0, input.limit);
  const lastItem = items.at(-1) ?? null;

  return {
    ok: true,
    result: {
      items,
      nextCursor:
        hasNextPage && lastItem
          ? encodeReconciliationListCursor({
              createdAt: lastItem.itemCreatedAt,
              itemId: lastItem.reconciliationItemId,
            })
          : null,
    },
  };
}

export async function getAdminReconciliationItemDetail(
  reconciliationItemId: string,
): Promise<ReconciliationReadExecution<AdminReconciliationItemDetail>> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("get_admin_reconciliation_item_detail", {
    p_reconciliation_item_id: reconciliationItemId,
  });

  if (response.error) {
    return { ok: false, error: mapReadRpcError(response.error) };
  }

  const row = readSingleDetailRow(response.data ?? []);

  if (!row || row.payload === null) {
    return {
      ok: false,
      error: {
        code: "reconciliation_item_not_found",
        httpStatus: 404,
      },
    };
  }

  const detail = normalizeDetailPayload(row.payload);

  return detail
    ? { ok: true, result: detail }
    : {
        ok: false,
        error: {
          code: "reconciliation_read_unavailable",
          httpStatus: 500,
        },
      };
}

function normalizeListRows(
  rows: readonly ListRow[],
): AdminReconciliationItemSummary[] | null {
  const normalized: AdminReconciliationItemSummary[] = [];

  for (const row of rows) {
    const item = normalizeListRow(row);

    if (!item) {
      return null;
    }

    normalized.push(item);
  }

  return normalized;
}

function normalizeListRow(row: ListRow): AdminReconciliationItemSummary | null {
  const reconciliationItemId = normalizeUuid(row.reconciliation_item_id);
  const reconciliationRunId = normalizeUuid(row.reconciliation_run_id);
  const assetId = normalizeUuid(row.asset_id);
  const assetCode = normalizeText(row.asset_code);
  const assetSymbol = normalizeText(row.asset_symbol);
  const assetDisplayName = normalizeText(row.asset_display_name);
  const assetDecimals = normalizeNonnegativeInteger(row.asset_decimals);
  const scopeKind = normalizeText(row.scope_kind);
  const runStatus = normalizeText(row.run_status);
  const triggerSource = normalizeText(row.trigger_source);
  const runCreatedAt = normalizeText(row.run_created_at);
  const itemCreatedAt = normalizeText(row.item_created_at);
  const classification = normalizeText(row.classification);
  const reviewVersion = normalizeNullablePositiveInteger(row.review_version);
  const expectedUnits = normalizeUnsignedUnits(row.expected_units);
  const observedUnits = normalizeNullableUnsignedUnits(row.observed_units);
  const differenceUnits = normalizeNullableSignedUnits(row.difference_units);
  const toleranceUnits = normalizeUnsignedUnits(row.tolerance_units);
  const targetBindingCount = normalizeNonnegativeInteger(
    row.target_binding_count,
  );
  const observedBindingCount = normalizeNonnegativeInteger(
    row.observed_binding_count,
  );
  const missingBindingCount = normalizeNonnegativeInteger(
    row.missing_binding_count,
  );
  const failedBindingCount = normalizeNonnegativeInteger(
    row.failed_binding_count,
  );

  if (
    !reconciliationItemId ||
    !reconciliationRunId ||
    !assetId ||
    !assetCode ||
    !assetSymbol ||
    !assetDisplayName ||
    assetDecimals === null ||
    !scopeKind ||
    !runStatus ||
    !triggerSource ||
    !runCreatedAt ||
    !itemCreatedAt ||
    !classification ||
    reviewVersion === INVALID ||
    !expectedUnits ||
    observedUnits === INVALID ||
    differenceUnits === INVALID ||
    !toleranceUnits ||
    targetBindingCount === null ||
    observedBindingCount === null ||
    missingBindingCount === null ||
    failedBindingCount === null
  ) {
    return null;
  }

  return {
    reconciliationItemId,
    reconciliationRunId,
    assetId,
    asset: {
      assetCode,
      symbol: assetSymbol,
      displayName: assetDisplayName,
      decimals: assetDecimals,
    },
    scopeKind,
    runStatus,
    triggerSource,
    observerKind: normalizeNullableText(row.observer_kind),
    observationCutoffAt: normalizeNullableText(row.observation_cutoff_at),
    startedAt: normalizeNullableText(row.started_at),
    completedAt: normalizeNullableText(row.completed_at),
    runCreatedAt,
    itemCreatedAt,
    failureCode: normalizeNullableText(row.failure_code),
    classification,
    reviewStatus: normalizeNullableText(row.review_status),
    reviewVersion,
    expectedUnits,
    observedUnits,
    differenceUnits,
    toleranceUnits,
    targetBindingCount,
    observedBindingCount,
    missingBindingCount,
    failedBindingCount,
  };
}

function readSingleDetailRow(rows: readonly DetailRow[]): DetailRow | null {
  return rows.length === 1 ? rows[0] : null;
}

function normalizeDetailPayload(
  payload: Json,
): AdminReconciliationItemDetail | null {
  if (!isRecord(payload) || !hasOnlyKeys(payload, [
    "run",
    "item",
    "provenance",
    "reviewCase",
    "reviewEvents",
  ])) {
    return null;
  }

  const run = normalizeRunDetail(payload.run);
  const item = normalizeItemDetail(payload.item);
  const provenance = normalizeProvenance(payload.provenance);
  const reviewCase = normalizeReviewCase(payload.reviewCase);
  const reviewEvents = normalizeReviewEvents(payload.reviewEvents);

  if (
    !run ||
    !item ||
    !provenance ||
    reviewCase === INVALID ||
    !reviewEvents
  ) {
    return null;
  }

  return {
    run,
    item,
    provenance,
    reviewCase,
    reviewEvents,
  };
}

function normalizeRunDetail(value: unknown): AdminReconciliationRunDetail | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id",
    "status",
    "triggerSource",
    "observerKind",
    "observationCutoffAt",
    "startedAt",
    "completedAt",
    "createdAt",
    "failureCode",
  ])) {
    return null;
  }

  const id = normalizeUuid(value.id);
  const status = normalizeText(value.status);
  const triggerSource = normalizeText(value.triggerSource);
  const observerKind = normalizeNullableText(value.observerKind);
  const observationCutoffAt = normalizeNullableText(value.observationCutoffAt);
  const startedAt = normalizeNullableText(value.startedAt);
  const completedAt = normalizeNullableText(value.completedAt);
  const createdAt = normalizeText(value.createdAt);
  const failureCode = normalizeNullableText(value.failureCode);

  return id && status && triggerSource && createdAt
    ? {
        id,
        status,
        triggerSource,
        observerKind,
        observationCutoffAt,
        startedAt,
        completedAt,
        createdAt,
        failureCode,
      }
    : null;
}

function normalizeItemDetail(
  value: unknown,
): AdminReconciliationItemDetailBody | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id",
    "scopeKind",
    "asset",
    "expectedUnits",
    "observedUnits",
    "differenceUnits",
    "toleranceUnits",
    "classification",
    "createdAt",
  ])) {
    return null;
  }

  const asset = normalizeDetailAsset(value.asset);
  const id = normalizeUuid(value.id);
  const scopeKind = normalizeText(value.scopeKind);
  const expectedUnits = normalizeUnsignedUnits(value.expectedUnits);
  const observedUnits = normalizeNullableUnsignedUnits(value.observedUnits);
  const differenceUnits = normalizeNullableSignedUnits(value.differenceUnits);
  const toleranceUnits = normalizeUnsignedUnits(value.toleranceUnits);
  const classification = normalizeText(value.classification);
  const createdAt = normalizeText(value.createdAt);

  if (
    !id ||
    !scopeKind ||
    !asset ||
    !expectedUnits ||
    observedUnits === INVALID ||
    differenceUnits === INVALID ||
    !toleranceUnits ||
    !classification ||
    !createdAt
  ) {
    return null;
  }

  return {
    id,
    scopeKind,
    asset,
    expectedUnits,
    observedUnits,
    differenceUnits,
    toleranceUnits,
    classification,
    createdAt,
  };
}

function normalizeDetailAsset(
  value: unknown,
): AdminReconciliationItemDetailBody["asset"] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id",
    "assetCode",
    "symbol",
    "displayName",
    "decimals",
  ])) {
    return null;
  }

  const id = normalizeUuid(value.id);
  const assetCode = normalizeText(value.assetCode);
  const symbol = normalizeText(value.symbol);
  const displayName = normalizeText(value.displayName);
  const decimals = normalizeNonnegativeInteger(value.decimals);

  return id && assetCode && symbol && displayName && decimals !== null
    ? {
        id,
        assetCode,
        symbol,
        displayName,
        decimals,
      }
    : null;
}

function normalizeProvenance(
  value: unknown,
): AdminReconciliationProvenance[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const rows: AdminReconciliationProvenance[] = [];

  for (const entry of value) {
    const row = normalizeProvenanceEntry(entry);

    if (!row) {
      return null;
    }

    rows.push(row);
  }

  return rows;
}

function normalizeProvenanceEntry(
  value: unknown,
): AdminReconciliationProvenance | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "custodyAccountBindingId",
    "providerCode",
    "providerDisplayName",
    "bindingLabel",
    "bindingRole",
    "membershipStatus",
    "externalBalanceObservationId",
    "observedUnits",
    "observedAt",
    "createdAt",
  ])) {
    return null;
  }

  const custodyAccountBindingId = normalizeUuid(value.custodyAccountBindingId);
  const providerCode = normalizeText(value.providerCode);
  const providerDisplayName = normalizeText(value.providerDisplayName);
  const bindingLabel = normalizeText(value.bindingLabel);
  const bindingRole = normalizeText(value.bindingRole);
  const membershipStatus = normalizeText(value.membershipStatus);
  const externalBalanceObservationId = normalizeNullableUuid(
    value.externalBalanceObservationId,
  );
  const observedUnits = normalizeNullableUnsignedUnits(value.observedUnits);
  const observedAt = normalizeNullableText(value.observedAt);
  const createdAt = normalizeText(value.createdAt);

  if (
    !custodyAccountBindingId ||
    !providerCode ||
    !providerDisplayName ||
    !bindingLabel ||
    !bindingRole ||
    !membershipStatus ||
    externalBalanceObservationId === INVALID ||
    observedUnits === INVALID ||
    !createdAt
  ) {
    return null;
  }

  return {
    custodyAccountBindingId,
    providerCode,
    providerDisplayName,
    bindingLabel,
    bindingRole,
    membershipStatus,
    externalBalanceObservationId,
    observedUnits,
    observedAt,
    createdAt,
  };
}

function normalizeReviewCase(
  value: unknown,
): AdminReconciliationReviewCase | null | typeof INVALID {
  if (value === null) {
    return null;
  }

  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id",
    "status",
    "version",
    "openedAt",
    "updatedAt",
    "resolvedAt",
  ])) {
    return INVALID;
  }

  const id = normalizeUuid(value.id);
  const status = normalizeText(value.status);
  const version = normalizePositiveInteger(value.version);
  const openedAt = normalizeText(value.openedAt);
  const updatedAt = normalizeText(value.updatedAt);
  const resolvedAt = normalizeNullableText(value.resolvedAt);

  return id && status && version !== null && openedAt && updatedAt
    ? {
        id,
        status,
        version,
        openedAt,
        updatedAt,
        resolvedAt,
      }
    : INVALID;
}

function normalizeReviewEvents(
  value: unknown,
): AdminReconciliationReviewEvent[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const events: AdminReconciliationReviewEvent[] = [];

  for (const entry of value) {
    const event = normalizeReviewEvent(entry);

    if (!event) {
      return null;
    }

    events.push(event);
  }

  return events;
}

function normalizeReviewEvent(
  value: unknown,
): AdminReconciliationReviewEvent | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "eventVersion",
    "eventType",
    "fromStatus",
    "toStatus",
    "reasonCode",
    "createdAt",
  ])) {
    return null;
  }

  const eventVersion = normalizePositiveInteger(value.eventVersion);
  const eventType = normalizeText(value.eventType);
  const fromStatus = normalizeNullableText(value.fromStatus);
  const toStatus = normalizeText(value.toStatus);
  const reasonCode = normalizeText(value.reasonCode);
  const createdAt = normalizeText(value.createdAt);

  return eventVersion !== null && eventType && toStatus && reasonCode && createdAt
    ? {
        eventVersion,
        eventType,
        fromStatus,
        toStatus,
        reasonCode,
        createdAt,
      }
    : null;
}

function mapAdminAccessError(
  status: Exclude<
    Awaited<ReturnType<typeof inspectAdminAccess>>["status"],
    "ready"
  >,
): ReconciliationReadError {
  switch (status) {
    case "anonymous":
      return {
        code: "admin_authentication_required",
        httpStatus: 401,
      };
    case "inactive":
    case "missing_profile":
    case "not_admin":
      return {
        code: "admin_role_required",
        httpStatus: 403,
      };
    case "mfa_enrollment_required":
    case "mfa_challenge_required":
      return {
        code: "admin_aal2_required",
        httpStatus: 403,
      };
    case "unavailable":
      return {
        code: "admin_authentication_unavailable",
        httpStatus: 503,
      };
  }
}

function mapReadRpcError(error: PostgrestError): ReconciliationReadError {
  if (error.code === "42501" && error.message === "ADMIN_AAL2_REQUIRED") {
    return { code: "admin_aal2_required", httpStatus: 403 };
  }

  if (error.code === "22023" && error.message === "INVALID_INPUT") {
    return { code: "invalid_request", httpStatus: 400 };
  }

  return {
    code: "reconciliation_read_unavailable",
    httpStatus: 500,
  };
}

function normalizeUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function normalizeNullableUuid(
  value: unknown,
): string | null | typeof INVALID {
  if (value === null) {
    return null;
  }

  return normalizeUuid(value) ?? INVALID;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeNullableText(value: unknown): string | null {
  return value === null ? null : normalizeText(value);
}

function normalizeUnsignedUnits(value: unknown): string | null {
  return typeof value === "string" && UNSIGNED_ATOMIC_UNITS_PATTERN.test(value)
    ? value
    : null;
}

function normalizeNullableUnsignedUnits(
  value: unknown,
): string | null | typeof INVALID {
  if (value === null) {
    return null;
  }

  return normalizeUnsignedUnits(value) ?? INVALID;
}

function normalizeNullableSignedUnits(
  value: unknown,
): string | null | typeof INVALID {
  if (value === null) {
    return null;
  }

  return typeof value === "string" && SIGNED_ATOMIC_UNITS_PATTERN.test(value)
    ? value
    : INVALID;
}

function normalizeNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
    ? value
    : null;
}

function normalizeNullablePositiveInteger(
  value: unknown,
): number | null | typeof INVALID {
  if (value === null) {
    return null;
  }

  return normalizePositiveInteger(value) ?? INVALID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);

  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}
