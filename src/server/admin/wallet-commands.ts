import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { WalletPublicResultCode } from "@/lib/wallet/public-results";
import {
  type WalletAccountStatus,
} from "@/lib/wallet/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

export type WalletStatusCommandInput = {
  walletAccountId: string;
  expectedVersion: number;
  newStatus: WalletAccountStatus;
  commandId: string;
  reason: string;
};

export type WalletStatusCommandResult = {
  resultCode: string;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  walletAccountId: string | null;
  targetUserId: string | null;
  entityVersion: number | null;
  occurredAt: string | null;
};

export type WalletStatusCommandExecution =
  | { ok: true; result: WalletStatusCommandResult }
  | { ok: false; error: WalletPublicResultCode | PublicAuthErrorCode };

type WalletStatusCommandRow =
  Database["public"]["Functions"]["transition_wallet_account_status"]["Returns"][number];
type AdminWalletAccountRow =
  Database["public"]["Functions"]["list_admin_wallet_accounts"]["Returns"][number];
type WalletAuditEventRow =
  Database["public"]["Functions"]["list_wallet_account_admin_audit_events"]["Returns"][number];

export type AdminWalletAccount = {
  walletAccountId: string;
  userId: string;
  custodyModel: string;
  walletStatus: string;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  profileAccountStatus: string;
};

export type WalletAuditEvent = {
  eventId: string;
  commandId: string;
  action: string;
  outcome: string;
  actorUserId: string;
  targetUserId: string;
  walletAccountId: string;
  reason: string;
  targetProfileStatus: string;
  previousStatus: string;
  resultingStatus: string;
  entityVersion: number;
  occurredAt: string;
};

export type AdminWalletManagementResult =
  | {
      ok: true;
      walletAccounts: AdminWalletAccount[];
      auditEvents: WalletAuditEvent[];
    }
  | { ok: false; error: WalletPublicResultCode | PublicAuthErrorCode };

export async function executeWalletStatusCommand(
  input: WalletStatusCommandInput,
): Promise<WalletStatusCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("transition_wallet_account_status", {
    p_wallet_account_id: input.walletAccountId,
    p_expected_version: input.expectedVersion,
    p_new_status: input.newStatus,
    p_command_id: input.commandId,
    p_reason: input.reason,
  });

  if (response.error) {
    return { ok: false, error: mapRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;

  if (!row || typeof row.result_code !== "string") {
    return { ok: false, error: "wallet_command_unavailable" };
  }

  return { ok: true, result: normalizeWalletStatusCommandRow(row) };
}

export async function listAdminWalletManagement(
  limit = 100,
): Promise<AdminWalletManagementResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const [walletAccounts, auditEvents] = await Promise.all([
    supabase.rpc("list_admin_wallet_accounts", { p_limit: limit }),
    supabase.rpc("list_wallet_account_admin_audit_events", {
      p_limit: 25,
    }),
  ]);

  if (walletAccounts.error) {
    return { ok: false, error: "wallet_command_unavailable" };
  }

  if (auditEvents.error) {
    return { ok: false, error: "wallet_audit_unavailable" };
  }

  return {
    ok: true,
    walletAccounts: (walletAccounts.data ?? []).map(normalizeWalletRow),
    auditEvents: (auditEvents.data ?? []).map(normalizeAuditRow),
  };
}

function normalizeWalletStatusCommandRow(
  row: WalletStatusCommandRow,
): WalletStatusCommandResult {
  return {
    resultCode: row.result_code,
    replayed: row.replayed === true,
    eventId: row.event_id ?? null,
    commandId: row.command_id ?? null,
    walletAccountId: row.wallet_account_id ?? null,
    targetUserId: row.target_user_id ?? null,
    entityVersion: row.entity_version ?? null,
    occurredAt: row.occurred_at ?? null,
  };
}

function normalizeWalletRow(row: AdminWalletAccountRow): AdminWalletAccount {
  return {
    walletAccountId: row.wallet_account_id,
    userId: row.user_id,
    custodyModel: row.custody_model,
    walletStatus: row.wallet_status,
    closedAt: row.closed_at ?? null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    profileAccountStatus: row.profile_account_status,
  };
}

function normalizeAuditRow(row: WalletAuditEventRow): WalletAuditEvent {
  return {
    eventId: row.event_id,
    commandId: row.command_id,
    action: row.action,
    outcome: row.outcome,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id,
    walletAccountId: row.wallet_account_id,
    reason: row.reason,
    targetProfileStatus: row.target_profile_status,
    previousStatus: row.previous_status,
    resultingStatus: row.resulting_status,
    entityVersion: row.entity_version,
    occurredAt: row.occurred_at,
  };
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

function mapRpcError(error: { code?: string }): WalletPublicResultCode {
  return error.code === "42501"
    ? "wallet_command_forbidden"
    : "wallet_command_unavailable";
}
