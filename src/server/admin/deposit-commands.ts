import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { DepositPublicResultCode } from "@/lib/deposit/public-results";
import { validateDepositUnitsString } from "@/lib/deposit/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

export type AdminConfirmDepositInput = {
  depositRequestId: string;
  requestExpectedVersion: number;
  commandId: string;
  reason: string;
};

export type AdminCancelDepositInput = AdminConfirmDepositInput;

export type AdminDepositCommandResult = {
  resultCode: string;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  depositRequestId: string | null;
  journalId: string | null;
  walletAccountId: string | null;
  assetId: string | null;
  units: string | null;
  status: string | null;
  requestVersion: number | null;
  occurredAt: string | null;
};

export type AdminDepositCommandExecution =
  | { ok: true; result: AdminDepositCommandResult }
  | { ok: false; error: DepositPublicResultCode | PublicAuthErrorCode };

export type AdminDepositRequest = {
  depositRequestId: string;
  targetUserId: string;
  profileStatus: string;
  walletAccountId: string;
  walletStatus: string;
  assetId: string;
  assetCode: string;
  symbol: string;
  decimals: number;
  requestedUnits: string;
  status: string;
  requestJournalId: string;
  confirmationJournalId: string | null;
  cancellationJournalId: string | null;
  confirmedBy: string | null;
  canceledBy: string | null;
  cancellationActorType: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
  version: number;
};

export type DepositAuditEvent = {
  eventId: string;
  commandId: string;
  action: string;
  outcome: string;
  actorUserId: string;
  actorType: string;
  targetUserId: string;
  walletAccountId: string;
  assetId: string;
  depositRequestId: string;
  resultingJournalId: string;
  reason: string;
  previousStatus: string | null;
  resultingStatus: string;
  unitsText: string;
  occurredAt: string;
};

export type AdminDepositOverviewResult =
  | {
      ok: true;
      depositRequests: AdminDepositRequest[];
      auditEvents: DepositAuditEvent[];
    }
  | { ok: false; error: DepositPublicResultCode | PublicAuthErrorCode };

type ConfirmDepositRow =
  Database["public"]["Functions"]["confirm_user_funding_request"]["Returns"][number];
type AdminCancelDepositRow =
  Database["public"]["Functions"]["admin_cancel_user_funding_request"]["Returns"][number];
type AdminDepositRequestRow =
  Database["public"]["Functions"]["list_admin_deposit_requests"]["Returns"][number];
type DepositAuditRow =
  Database["public"]["Functions"]["list_deposit_command_audit_events"]["Returns"][number];

export async function confirmDepositRequest(
  input: AdminConfirmDepositInput,
): Promise<AdminDepositCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("confirm_user_funding_request", {
    p_deposit_request_id: input.depositRequestId,
    p_request_expected_version: input.requestExpectedVersion,
    p_command_id: input.commandId,
    p_reason: input.reason,
  });

  if (response.error) {
    return { ok: false, error: mapCommandRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;
  const result = row ? normalizeCommandRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "deposit_command_unavailable" };
}

export async function adminCancelDepositRequest(
  input: AdminCancelDepositInput,
): Promise<AdminDepositCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("admin_cancel_user_funding_request", {
    p_deposit_request_id: input.depositRequestId,
    p_request_expected_version: input.requestExpectedVersion,
    p_command_id: input.commandId,
    p_reason: input.reason,
  });

  if (response.error) {
    return { ok: false, error: mapCommandRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;
  const result = row ? normalizeCommandRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "deposit_command_unavailable" };
}

export async function listAdminDepositOverview(): Promise<AdminDepositOverviewResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const [depositRequests, auditEvents] = await Promise.all([
    supabase.rpc("list_admin_deposit_requests", {
      p_limit: 100,
    }),
    supabase.rpc("list_deposit_command_audit_events", {
      p_limit: 50,
    }),
  ]);

  if (depositRequests.error) {
    return { ok: false, error: "deposit_read_unavailable" };
  }

  if (auditEvents.error) {
    return { ok: false, error: "deposit_read_unavailable" };
  }

  return {
    ok: true,
    depositRequests: (depositRequests.data ?? []).map(
      normalizeAdminDepositRequest,
    ),
    auditEvents: (auditEvents.data ?? []).map(normalizeAuditEvent),
  };
}

function normalizeCommandRow(
  row: ConfirmDepositRow | AdminCancelDepositRow,
): AdminDepositCommandResult | null {
  if (typeof row.result_code !== "string") {
    return null;
  }

  if (row.units !== null && !validateDepositUnitsString(row.units)) {
    return null;
  }

  return {
    resultCode: row.result_code,
    replayed: row.replayed === true,
    eventId: row.event_id ?? null,
    commandId: row.command_id ?? null,
    depositRequestId: row.deposit_request_id ?? null,
    journalId: row.journal_id ?? null,
    walletAccountId: row.wallet_account_id ?? null,
    assetId: row.asset_id ?? null,
    units: row.units ?? null,
    status: row.status ?? null,
    requestVersion: row.request_version ?? null,
    occurredAt: row.occurred_at ?? null,
  };
}

function normalizeAdminDepositRequest(
  row: AdminDepositRequestRow,
): AdminDepositRequest {
  return {
    depositRequestId: row.deposit_request_id,
    targetUserId: row.target_user_id,
    profileStatus: row.profile_status,
    walletAccountId: row.wallet_account_id,
    walletStatus: row.wallet_status,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    decimals: row.decimals,
    requestedUnits: normalizePositiveUnits(row.requested_units),
    status: row.status,
    requestJournalId: row.request_journal_id,
    confirmationJournalId: row.confirmation_journal_id ?? null,
    cancellationJournalId: row.cancellation_journal_id ?? null,
    confirmedBy: row.confirmed_by ?? null,
    canceledBy: row.canceled_by ?? null,
    cancellationActorType: row.cancellation_actor_type ?? null,
    requestedAt: row.requested_at,
    confirmedAt: row.confirmed_at ?? null,
    canceledAt: row.canceled_at ?? null,
    version: row.version,
  };
}

function normalizeAuditEvent(row: DepositAuditRow): DepositAuditEvent {
  return {
    eventId: row.event_id,
    commandId: row.command_id,
    action: row.action,
    outcome: row.outcome,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    targetUserId: row.target_user_id,
    walletAccountId: row.wallet_account_id,
    assetId: row.asset_id,
    depositRequestId: row.deposit_request_id,
    resultingJournalId: row.resulting_journal_id,
    reason: row.reason,
    previousStatus: row.previous_status ?? null,
    resultingStatus: row.resulting_status,
    unitsText: normalizePositiveUnits(row.units_text),
    occurredAt: row.occurred_at,
  };
}

function normalizePositiveUnits(value: string): string {
  return /^[1-9][0-9]{0,37}$/.test(value) ? value : "1";
}

function mapAdminAccessError(
  status: Exclude<
    Awaited<ReturnType<typeof inspectAdminAccess>>["status"],
    "ready"
  >,
): PublicAuthErrorCode {
  switch (status) {
    case "anonymous":
      return "invalid_credentials";
    case "inactive":
      return "account_restricted";
    case "missing_profile":
      return "account_unavailable";
    case "not_admin":
      return "admin_forbidden";
    case "mfa_enrollment_required":
      return "mfa_enrollment_required";
    case "mfa_challenge_required":
      return "mfa_challenge_required";
    case "unavailable":
      return "mfa_unavailable";
  }
}

function mapCommandRpcError(error: {
  code?: string;
}): DepositPublicResultCode {
  return error.code === "42501"
    ? "deposit_command_forbidden"
    : "deposit_command_unavailable";
}
