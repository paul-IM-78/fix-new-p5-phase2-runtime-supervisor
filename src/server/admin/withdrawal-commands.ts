import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { WithdrawalPublicResultCode } from "@/lib/withdrawal/public-results";
import { validateWithdrawalUnitsString } from "@/lib/withdrawal/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

export type AdminWithdrawalCommandInput = {
  withdrawalRequestId: string;
  requestExpectedVersion: number;
  commandId: string;
  reason: string;
};

export type AdminWithdrawalExecutionStartInput =
  AdminWithdrawalCommandInput & {
    evidenceReference: string;
  };

export type AdminWithdrawalExecutionAttemptInput =
  AdminWithdrawalCommandInput & {
    executionAttemptId: string;
    attemptExpectedVersion: number;
  };

export type AdminWithdrawalExecutionFailInput =
  AdminWithdrawalExecutionAttemptInput & {
    failureCode: string;
    failureReason: string;
  };

export type AdminWithdrawalCommandResult = {
  resultCode: string;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  withdrawalRequestId: string | null;
  executionAttemptId: string | null;
  journalId: string | null;
  walletAccountId: string | null;
  assetId: string | null;
  units: string | null;
  status: string | null;
  requestVersion: number | null;
  attemptVersion: number | null;
  occurredAt: string | null;
};

export type AdminWithdrawalCommandExecution =
  | { ok: true; result: AdminWithdrawalCommandResult }
  | { ok: false; error: WithdrawalPublicResultCode | PublicAuthErrorCode };

export type AdminWithdrawalRequest = {
  withdrawalRequestId: string;
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
  reservationJournalId: string | null;
  approvalJournalId: string | null;
  cancellationJournalId: string | null;
  settlementJournalId: string | null;
  latestExecutionAttemptId: string | null;
  latestExecutionStatus: string | null;
  latestExecutionAttemptNo: number | null;
  latestExecutionAttemptVersion: number | null;
  executionCompletedAt: string | null;
  reservedBy: string | null;
  approvedBy: string | null;
  canceledBy: string | null;
  cancellationActorType: string | null;
  canceledFromStatus: string | null;
  requestedAt: string;
  reservedAt: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  version: number;
};

export type WithdrawalAuditEvent = {
  eventId: string;
  commandId: string;
  action: string;
  outcome: string;
  actorUserId: string;
  actorType: string;
  targetUserId: string;
  walletAccountId: string;
  assetId: string;
  withdrawalRequestId: string;
  executionAttemptId: string | null;
  resultingJournalId: string | null;
  reason: string;
  previousStatus: string | null;
  resultingStatus: string;
  unitsText: string;
  occurredAt: string;
};

export type WithdrawalExecutionAttempt = {
  executionAttemptId: string;
  withdrawalRequestId: string;
  attemptNo: number;
  status: string;
  settlementJournalId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  startedAt: string;
  completedAt: string | null;
  version: number;
};

export type AdminWithdrawalOverviewResult =
  | {
      ok: true;
      withdrawalRequests: AdminWithdrawalRequest[];
      auditEvents: WithdrawalAuditEvent[];
      executionAttempts: WithdrawalExecutionAttempt[];
    }
  | { ok: false; error: WithdrawalPublicResultCode | PublicAuthErrorCode };

type ReserveWithdrawalRow =
  Database["public"]["Functions"]["reserve_user_payout_request"]["Returns"][number];
type ApproveWithdrawalRow =
  Database["public"]["Functions"]["approve_user_payout_request"]["Returns"][number];
type AdminCancelWithdrawalRow =
  Database["public"]["Functions"]["admin_cancel_user_payout_request"]["Returns"][number];
type StartWithdrawalExecutionRow =
  Database["public"]["Functions"]["start_user_payout_execution"]["Returns"][number];
type FailWithdrawalExecutionRow =
  Database["public"]["Functions"]["fail_user_payout_execution"]["Returns"][number];
type SettleWithdrawalExecutionRow =
  Database["public"]["Functions"]["settle_user_payout_execution"]["Returns"][number];
type AdminWithdrawalRequestRow =
  Database["public"]["Functions"]["list_admin_withdrawal_requests"]["Returns"][number];
type WithdrawalAuditRow =
  Database["public"]["Functions"]["list_withdrawal_command_audit_events"]["Returns"][number];
type WithdrawalExecutionAttemptRow =
  Database["public"]["Functions"]["list_withdrawal_execution_attempts"]["Returns"][number];
type AdminWithdrawalCommandRow =
  | ReserveWithdrawalRow
  | ApproveWithdrawalRow
  | AdminCancelWithdrawalRow
  | StartWithdrawalExecutionRow
  | FailWithdrawalExecutionRow
  | SettleWithdrawalExecutionRow;

export async function reserveWithdrawalRequest(
  input: AdminWithdrawalCommandInput,
): Promise<AdminWithdrawalCommandExecution> {
  return executeAdminWithdrawalCommand("reserve_user_payout_request", input);
}

export async function approveWithdrawalRequest(
  input: AdminWithdrawalCommandInput,
): Promise<AdminWithdrawalCommandExecution> {
  return executeAdminWithdrawalCommand("approve_user_payout_request", input);
}

export async function adminCancelWithdrawalRequest(
  input: AdminWithdrawalCommandInput,
): Promise<AdminWithdrawalCommandExecution> {
  return executeAdminWithdrawalCommand("admin_cancel_user_payout_request", input);
}

export async function startWithdrawalExecution(
  input: AdminWithdrawalExecutionStartInput,
): Promise<AdminWithdrawalCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("start_user_payout_execution", {
    p_withdrawal_request_id: input.withdrawalRequestId,
    p_request_expected_version: input.requestExpectedVersion,
    p_command_id: input.commandId,
    p_reason: input.reason,
    p_evidence_reference: input.evidenceReference,
  });

  return normalizeCommandResponse(response.data, response.error);
}

export async function failWithdrawalExecution(
  input: AdminWithdrawalExecutionFailInput,
): Promise<AdminWithdrawalCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("fail_user_payout_execution", {
    p_withdrawal_request_id: input.withdrawalRequestId,
    p_request_expected_version: input.requestExpectedVersion,
    p_execution_attempt_id: input.executionAttemptId,
    p_attempt_expected_version: input.attemptExpectedVersion,
    p_command_id: input.commandId,
    p_failure_code: input.failureCode,
    p_failure_reason: input.failureReason,
  });

  return normalizeCommandResponse(response.data, response.error);
}

export async function settleWithdrawalExecution(
  input: AdminWithdrawalExecutionAttemptInput,
): Promise<AdminWithdrawalCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("settle_user_payout_execution", {
    p_withdrawal_request_id: input.withdrawalRequestId,
    p_request_expected_version: input.requestExpectedVersion,
    p_execution_attempt_id: input.executionAttemptId,
    p_attempt_expected_version: input.attemptExpectedVersion,
    p_command_id: input.commandId,
    p_reason: input.reason,
  });

  return normalizeCommandResponse(response.data, response.error);
}

export async function listAdminWithdrawalOverview(): Promise<AdminWithdrawalOverviewResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const [withdrawalRequests, auditEvents, executionAttempts] =
    await Promise.all([
      supabase.rpc("list_admin_withdrawal_requests", {
        p_limit: 100,
      }),
      supabase.rpc("list_withdrawal_command_audit_events", {
        p_limit: 50,
      }),
      supabase.rpc("list_withdrawal_execution_attempts", {
        p_limit: 100,
      }),
    ]);

  if (
    withdrawalRequests.error ||
    auditEvents.error ||
    executionAttempts.error
  ) {
    return { ok: false, error: "withdrawal_read_unavailable" };
  }

  return {
    ok: true,
    withdrawalRequests: (withdrawalRequests.data ?? []).map(
      normalizeAdminWithdrawalRequest,
    ),
    auditEvents: (auditEvents.data ?? []).map(normalizeAuditEvent),
    executionAttempts: (executionAttempts.data ?? []).map(
      normalizeExecutionAttempt,
    ),
  };
}

async function executeAdminWithdrawalCommand(
  rpc:
    | "reserve_user_payout_request"
    | "approve_user_payout_request"
    | "admin_cancel_user_payout_request",
  input: AdminWithdrawalCommandInput,
): Promise<AdminWithdrawalCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc(rpc, {
    p_withdrawal_request_id: input.withdrawalRequestId,
    p_request_expected_version: input.requestExpectedVersion,
    p_command_id: input.commandId,
    p_reason: input.reason,
  });

  return normalizeCommandResponse(response.data, response.error);
}

function normalizeCommandResponse(
  data: AdminWithdrawalCommandRow[] | null,
  error: { code?: string } | null,
): AdminWithdrawalCommandExecution {
  if (error) {
    return { ok: false, error: mapCommandRpcError(error) };
  }

  const row = data?.[0] ?? null;
  const result = row ? normalizeCommandRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "withdrawal_command_unavailable" };
}

function normalizeCommandRow(
  row: AdminWithdrawalCommandRow,
): AdminWithdrawalCommandResult | null {
  if (typeof row.result_code !== "string") {
    return null;
  }

  if (row.units !== null && !validateWithdrawalUnitsString(row.units)) {
    return null;
  }

  return {
    resultCode: row.result_code,
    replayed: row.replayed === true,
    eventId: row.event_id ?? null,
    commandId: row.command_id ?? null,
    withdrawalRequestId: row.withdrawal_request_id ?? null,
    executionAttemptId:
      "execution_attempt_id" in row ? row.execution_attempt_id ?? null : null,
    journalId: row.journal_id ?? null,
    walletAccountId: row.wallet_account_id ?? null,
    assetId: row.asset_id ?? null,
    units: row.units ?? null,
    status: row.status ?? null,
    requestVersion: row.request_version ?? null,
    attemptVersion: "attempt_version" in row ? row.attempt_version ?? null : null,
    occurredAt: row.occurred_at ?? null,
  };
}

function normalizeAdminWithdrawalRequest(
  row: AdminWithdrawalRequestRow,
): AdminWithdrawalRequest {
  return {
    withdrawalRequestId: row.withdrawal_request_id,
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
    reservationJournalId: row.reservation_journal_id ?? null,
    approvalJournalId: row.approval_journal_id ?? null,
    cancellationJournalId: row.cancellation_journal_id ?? null,
    settlementJournalId: row.settlement_journal_id ?? null,
    latestExecutionAttemptId: row.latest_execution_attempt_id ?? null,
    latestExecutionStatus: row.latest_execution_status ?? null,
    latestExecutionAttemptNo: row.latest_execution_attempt_no ?? null,
    latestExecutionAttemptVersion: row.latest_execution_attempt_version ?? null,
    executionCompletedAt: row.execution_completed_at ?? null,
    reservedBy: row.reserved_by ?? null,
    approvedBy: row.approved_by ?? null,
    canceledBy: row.canceled_by ?? null,
    cancellationActorType: row.cancellation_actor_type ?? null,
    canceledFromStatus: row.canceled_from_status ?? null,
    requestedAt: row.requested_at,
    reservedAt: row.reserved_at ?? null,
    approvedAt: row.approved_at ?? null,
    canceledAt: row.canceled_at ?? null,
    version: row.version,
  };
}

function normalizeAuditEvent(row: WithdrawalAuditRow): WithdrawalAuditEvent {
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
    withdrawalRequestId: row.withdrawal_request_id,
    executionAttemptId: row.execution_attempt_id ?? null,
    resultingJournalId: row.resulting_journal_id ?? null,
    reason: row.reason,
    previousStatus: row.previous_status ?? null,
    resultingStatus: row.resulting_status,
    unitsText: normalizePositiveUnits(row.units_text),
    occurredAt: row.occurred_at,
  };
}

function normalizeExecutionAttempt(
  row: WithdrawalExecutionAttemptRow,
): WithdrawalExecutionAttempt {
  return {
    executionAttemptId: row.execution_attempt_id,
    withdrawalRequestId: row.withdrawal_request_id,
    attemptNo: row.attempt_no,
    status: row.status,
    settlementJournalId: row.settlement_journal_id ?? null,
    failureCode: row.failure_code ?? null,
    failureReason: row.failure_reason ?? null,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
    version: row.version,
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
}): WithdrawalPublicResultCode {
  return error.code === "42501"
    ? "withdrawal_command_forbidden"
    : "withdrawal_command_unavailable";
}
