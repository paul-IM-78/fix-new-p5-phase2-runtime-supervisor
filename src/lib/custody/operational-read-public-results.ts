import type { Json } from "@/types/database.types";
import {
  CUSTODY_OBSERVER_RUN_STATUSES,
  CUSTODY_OBSERVER_SEVERITIES,
  type CustodyObserverRunStatus,
  type CustodyObserverSeverity,
} from "@/lib/custody/operational-read-validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_STRING_PATTERN = /^(0|[1-9][0-9]*)$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export type CustodyObserverReadErrorCode =
  | "authentication_required"
  | "admin_access_required"
  | "admin_aal2_required"
  | "custody_observer_run_not_found"
  | "custody_observer_read_failed";

export type CustodyObserverRunSummary = {
  runId: string;
  status: CustodyObserverRunStatus;
  version: string;
  terminalCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  scopeCount: string;
  successCount: string;
  failedCount: string;
  abortedCount: string;
  bindingFailureCount: string;
  stale: boolean;
  severity: CustodyObserverSeverity;
  alertEligible: boolean;
};

export type CustodyObserverListResult = {
  items: CustodyObserverRunSummary[];
  totalCount: string;
  nextCursor: string | null;
};

export type CustodyObserverScopeOutcome = {
  scopeStatus: string;
  scopeCode: string | null;
  bindingSuccessCount: string;
  bindingFailureCount: string;
  bindingAbortCount: string;
  refreshRequested: boolean;
  refreshAttempted: boolean;
  refreshSucceeded: boolean;
  refreshFailed: boolean;
  noLongerEligibleCount: string;
  recordedAt: string;
  providerName: string | null;
  assetSymbol: string | null;
};

export type CustodyObserverBindingFailure = {
  failureStage: string;
  failureCode: string;
  retryable: boolean;
  requiresScopeRefresh: boolean;
  adapterAttempts: string;
  databaseAttempts: string;
  recordedAt: string;
  providerName: string | null;
  assetSymbol: string | null;
};

export type CustodyObserverRunDetail = CustodyObserverRunSummary & {
  scopeOutcomes: CustodyObserverScopeOutcome[];
  bindingFailures: CustodyObserverBindingFailure[];
};

export type CustodyObserverDetailResult = { item: CustodyObserverRunDetail };

export type ValidatedCustodyObserverListPayload = {
  items: CustodyObserverRunSummary[];
  totalCount: string;
  nextCursorCreatedAt: string | null;
  nextCursorRunId: string | null;
};

export function normalizeCustodyObserverListPayload(
  value: Json,
): ValidatedCustodyObserverListPayload | null {
  if (!isExactRecord(value, ["items", "total_count", "next_cursor_created_at", "next_cursor_run_id"])) {
    return null;
  }
  if (!Array.isArray(value.items)) return null;
  const items = value.items.map(normalizeRunSummary);
  const totalCount = decimalString(value.total_count);
  const nextCursorCreatedAt = nullableTimestamp(value.next_cursor_created_at);
  const nextCursorRunId = nullableUuid(value.next_cursor_run_id);
  if (!items.every(isPresent) || !totalCount || nextCursorCreatedAt === undefined || nextCursorRunId === undefined) {
    return null;
  }
  if ((nextCursorCreatedAt === null) !== (nextCursorRunId === null)) return null;
  return { items, totalCount, nextCursorCreatedAt, nextCursorRunId };
}

export function normalizeCustodyObserverDetailPayload(
  value: Json,
): CustodyObserverDetailResult | null {
  if (!isExactRecord(value, [...RUN_KEYS, "scope_outcomes", "binding_failures"])) return null;
  const { scope_outcomes, binding_failures, ...runValue } = value;
  const run = normalizeRunSummary(runValue);
  if (!run || !Array.isArray(scope_outcomes) || !Array.isArray(binding_failures)) return null;
  const scopeOutcomes = scope_outcomes.map(normalizeScopeOutcome);
  const bindingFailures = binding_failures.map(normalizeBindingFailure);
  return scopeOutcomes.every(isPresent) && bindingFailures.every(isPresent)
    ? { item: { ...run, scopeOutcomes, bindingFailures } }
    : null;
}

const RUN_KEYS = [
  "run_id", "status", "version", "terminal_code", "created_at", "started_at", "completed_at",
  "scope_count", "success_count", "failed_count", "aborted_count", "binding_failure_count",
  "stale", "severity", "alert_eligible",
] as const;

function normalizeRunSummary(value: unknown): CustodyObserverRunSummary | null {
  if (!isExactRecord(value, RUN_KEYS)) return null;
  const runId = uuid(value.run_id);
  const status = runStatus(value.status);
  const version = decimalString(value.version);
  const terminalCode = nullableText(value.terminal_code);
  const createdAt = timestamp(value.created_at);
  const startedAt = nullableTimestamp(value.started_at);
  const completedAt = nullableTimestamp(value.completed_at);
  const counts = [value.scope_count, value.success_count, value.failed_count, value.aborted_count, value.binding_failure_count].map(decimalString);
  const severity = severityValue(value.severity);
  if (!runId || !status || !version || terminalCode === undefined || !createdAt || startedAt === undefined || completedAt === undefined || counts.some((count) => !count) || typeof value.stale !== "boolean" || !severity || typeof value.alert_eligible !== "boolean") return null;
  return { runId, status, version, terminalCode, createdAt, startedAt, completedAt, scopeCount: counts[0]!, successCount: counts[1]!, failedCount: counts[2]!, abortedCount: counts[3]!, bindingFailureCount: counts[4]!, stale: value.stale, severity, alertEligible: value.alert_eligible };
}

function normalizeScopeOutcome(value: unknown): CustodyObserverScopeOutcome | null {
  const keys = ["scope_status", "scope_code", "binding_success_count", "binding_failure_count", "binding_abort_count", "refresh_requested", "refresh_attempted", "refresh_succeeded", "refresh_failed", "no_longer_eligible_count", "recorded_at", "provider_name", "asset_symbol"];
  if (!isExactRecord(value, keys)) return null;
  const scopeStatus = text(value.scope_status); const scopeCode = nullableText(value.scope_code); const counts = [value.binding_success_count, value.binding_failure_count, value.binding_abort_count, value.no_longer_eligible_count].map(decimalString); const recordedAt = timestamp(value.recorded_at); const providerName = nullableText(value.provider_name); const assetSymbol = nullableText(value.asset_symbol);
  if (!scopeStatus || scopeCode === undefined || counts.some((count) => !count) || !recordedAt || providerName === undefined || assetSymbol === undefined || typeof value.refresh_requested !== "boolean" || typeof value.refresh_attempted !== "boolean" || typeof value.refresh_succeeded !== "boolean" || typeof value.refresh_failed !== "boolean") return null;
  return { scopeStatus, scopeCode, bindingSuccessCount: counts[0]!, bindingFailureCount: counts[1]!, bindingAbortCount: counts[2]!, refreshRequested: value.refresh_requested, refreshAttempted: value.refresh_attempted, refreshSucceeded: value.refresh_succeeded, refreshFailed: value.refresh_failed, noLongerEligibleCount: counts[3]!, recordedAt, providerName, assetSymbol };
}

function normalizeBindingFailure(value: unknown): CustodyObserverBindingFailure | null {
  const keys = ["failure_stage", "failure_code", "retryable", "requires_scope_refresh", "adapter_attempts", "database_attempts", "recorded_at", "provider_name", "asset_symbol"];
  if (!isExactRecord(value, keys)) return null;
  const failureStage = text(value.failure_stage); const failureCode = text(value.failure_code); const adapterAttempts = decimalString(value.adapter_attempts); const databaseAttempts = decimalString(value.database_attempts); const recordedAt = timestamp(value.recorded_at); const providerName = nullableText(value.provider_name); const assetSymbol = nullableText(value.asset_symbol);
  if (!failureStage || !failureCode || !adapterAttempts || !databaseAttempts || !recordedAt || providerName === undefined || assetSymbol === undefined || typeof value.retryable !== "boolean" || typeof value.requires_scope_refresh !== "boolean") return null;
  return { failureStage, failureCode, retryable: value.retryable, requiresScopeRefresh: value.requires_scope_refresh, adapterAttempts, databaseAttempts, recordedAt, providerName, assetSymbol };
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function isPresent<T>(value: T | null): value is T { return value !== null; }
function uuid(value: unknown): string | null { return typeof value === "string" && UUID_PATTERN.test(value) ? value : null; }
function nullableUuid(value: unknown): string | null | undefined { return value === null ? null : uuid(value) ?? undefined; }
function text(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function nullableText(value: unknown): string | null | undefined { return value === null ? null : text(value) ?? undefined; }
function decimalString(value: unknown): string | null { return typeof value === "string" && DECIMAL_STRING_PATTERN.test(value) ? value : null; }
function timestamp(value: unknown): string | null { if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) return null; return new Date(value).toISOString(); }
function nullableTimestamp(value: unknown): string | null | undefined { return value === null ? null : timestamp(value) ?? undefined; }
function runStatus(value: unknown): CustodyObserverRunStatus | null { return typeof value === "string" && CUSTODY_OBSERVER_RUN_STATUSES.includes(value as CustodyObserverRunStatus) ? value as CustodyObserverRunStatus : null; }
function severityValue(value: unknown): CustodyObserverSeverity | null { return typeof value === "string" && CUSTODY_OBSERVER_SEVERITIES.includes(value as CustodyObserverSeverity) ? value as CustodyObserverSeverity : null; }
