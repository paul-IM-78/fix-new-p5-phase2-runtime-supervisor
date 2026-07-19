import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

export type AdminRoleCommandAction = "grant" | "revoke";

export type AdminRoleCommandResultCode =
  | "APPLIED"
  | "NOOP"
  | "INVALID_INPUT"
  | "TARGET_NOT_FOUND"
  | "TARGET_INACTIVE"
  | "COMMAND_ID_CONFLICT"
  | "SELF_REVOKE_FORBIDDEN";

export type AdminRoleCommandInput = {
  targetUserId: string;
  commandId: string;
  reason: string;
};

export type AdminRoleCommandResult = {
  resultCode: AdminRoleCommandResultCode;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  targetUserId: string | null;
  roleRecordId: string | null;
  occurredAt: string | null;
};

export type AdminRoleCommandExecution =
  | { ok: true; result: AdminRoleCommandResult }
  | { ok: false; error: PublicAuthErrorCode };

type AdminRoleCommandRow =
  Database["public"]["Functions"]["grant_admin_role"]["Returns"][number];

type AdminRoleAuditRow =
  Database["public"]["Functions"]["list_admin_role_audit_events"]["Returns"][number];

export type AdminRoleAuditEvent = {
  eventId: string;
  commandId: string;
  action: string;
  outcome: string;
  actorUserId: string;
  targetUserId: string;
  role: string;
  roleRecordId: string | null;
  reason: string;
  targetAccountStatus: string;
  previouslyActive: boolean;
  resultingActive: boolean;
  roleVersion: number | null;
  occurredAt: string;
};

export type AdminRoleAuditListResult =
  | { ok: true; events: AdminRoleAuditEvent[] }
  | { ok: false; error: PublicAuthErrorCode };

export async function executeAdminRoleCommand(
  action: AdminRoleCommandAction,
  input: AdminRoleCommandInput,
): Promise<AdminRoleCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const args = {
    p_target_user_id: input.targetUserId,
    p_command_id: input.commandId,
    p_reason: input.reason,
  };

  const response =
    action === "grant"
      ? await supabase.rpc("grant_admin_role", args)
      : await supabase.rpc("revoke_admin_role", args);

  if (response.error) {
    return { ok: false, error: mapRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;

  if (!row || !isAdminRoleCommandResultCode(row.result_code)) {
    return { ok: false, error: "admin_role_unavailable" };
  }

  return { ok: true, result: normalizeAdminRoleCommandRow(row) };
}

export async function listAdminRoleAuditEvents(
  limit = 25,
): Promise<AdminRoleAuditListResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const { data, error } = await supabase.rpc(
    "list_admin_role_audit_events",
    {
      p_limit: limit,
    },
  );

  if (error) {
    return { ok: false, error: mapRpcError(error) };
  }

  return {
    ok: true,
    events: (data ?? []).map(normalizeAdminRoleAuditRow),
  };
}

function normalizeAdminRoleCommandRow(
  row: AdminRoleCommandRow,
): AdminRoleCommandResult {
  return {
    resultCode: row.result_code as AdminRoleCommandResultCode,
    replayed: row.replayed === true,
    eventId: row.event_id ?? null,
    commandId: row.command_id ?? null,
    targetUserId: row.target_user_id ?? null,
    roleRecordId: row.role_record_id ?? null,
    occurredAt: row.occurred_at ?? null,
  };
}

function normalizeAdminRoleAuditRow(
  row: AdminRoleAuditRow,
): AdminRoleAuditEvent {
  return {
    eventId: row.event_id,
    commandId: row.command_id,
    action: row.action,
    outcome: row.outcome,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id,
    role: row.role,
    roleRecordId: row.role_record_id ?? null,
    reason: row.reason,
    targetAccountStatus: row.target_account_status,
    previouslyActive: row.previously_active,
    resultingActive: row.resulting_active,
    roleVersion: row.role_version ?? null,
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

function mapRpcError(error: { code?: string }): PublicAuthErrorCode {
  return error.code === "42501" ? "admin_forbidden" : "admin_role_unavailable";
}

function isAdminRoleCommandResultCode(
  value: string,
): value is AdminRoleCommandResultCode {
  return (
    value === "APPLIED" ||
    value === "NOOP" ||
    value === "INVALID_INPUT" ||
    value === "TARGET_NOT_FOUND" ||
    value === "TARGET_INACTIVE" ||
    value === "COMMAND_ID_CONFLICT" ||
    value === "SELF_REVOKE_FORBIDDEN"
  );
}
