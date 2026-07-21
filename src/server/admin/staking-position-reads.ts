import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { StakingPublicResultCode } from "@/lib/staking/public-results";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

type AdminPositionRow =
  Database["public"]["Functions"]["list_admin_staking_positions"]["Returns"][number];
type PositionAuditRow =
  Database["public"]["Functions"]["list_staking_position_command_audit_events"]["Returns"][number];

export type AdminStakingPosition = {
  stakingPositionId: string;
  stakingProductId: string;
  productCode: string;
  projectId: string;
  projectCode: string;
  assetId: string;
  assetCode: string;
  assetSymbol: string;
  assetDecimals: number;
  walletAccountId: string;
  userId: string;
  principalUnits: string;
  status: "LOCKED";
  productVersionSnapshot: number;
  lockDurationDaysSnapshot: number;
  termRewardRatePpmSnapshot: number;
  rewardRoundingModeSnapshot: "FLOOR";
  lockedAt: string;
  maturesAt: string;
  positionVersion: number;
  walletStatus: string;
  profileStatus: string;
};

export type StakingPositionAuditEvent = {
  eventId: string;
  commandId: string;
  action: string;
  outcome: string;
  actorUserId: string;
  walletAccountId: string;
  stakingProductId: string;
  stakingPositionId: string;
  projectId: string;
  assetId: string;
  reason: string;
  principalUnits: string;
  resultingStatus: string;
  entityVersion: number;
  occurredAt: string;
};

export type AdminStakingPositionReadResult =
  | {
      ok: true;
      positions: AdminStakingPosition[];
      auditEvents: StakingPositionAuditEvent[];
    }
  | { ok: false; error: StakingPublicResultCode | PublicAuthErrorCode };

export async function listAdminStakingPositionCatalog(): Promise<AdminStakingPositionReadResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const [positions, auditEvents] = await Promise.all([
    supabase.rpc("list_admin_staking_positions", { p_limit: 100 }),
    supabase.rpc("list_staking_position_command_audit_events", {
      p_limit: 50,
    }),
  ]);

  if (positions.error) {
    return { ok: false, error: "staking_command_unavailable" };
  }

  if (auditEvents.error) {
    return { ok: false, error: "staking_audit_unavailable" };
  }

  return {
    ok: true,
    positions: (positions.data ?? []).map(normalizePositionRow),
    auditEvents: (auditEvents.data ?? []).map(normalizeAuditRow),
  };
}

function normalizePositionRow(row: AdminPositionRow): AdminStakingPosition {
  return {
    stakingPositionId: row.staking_position_id,
    stakingProductId: row.staking_product_id,
    productCode: row.product_code,
    projectId: row.project_id,
    projectCode: row.project_code,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetSymbol: row.asset_symbol,
    assetDecimals: row.asset_decimals,
    walletAccountId: row.wallet_account_id,
    userId: row.user_id,
    principalUnits: row.principal_units,
    status: row.status === "LOCKED" ? row.status : "LOCKED",
    productVersionSnapshot: row.product_version_snapshot,
    lockDurationDaysSnapshot: row.lock_duration_days_snapshot,
    termRewardRatePpmSnapshot: row.term_reward_rate_ppm_snapshot,
    rewardRoundingModeSnapshot:
      row.reward_rounding_mode_snapshot === "FLOOR"
        ? row.reward_rounding_mode_snapshot
        : "FLOOR",
    lockedAt: row.locked_at,
    maturesAt: row.matures_at,
    positionVersion: row.position_version,
    walletStatus: row.wallet_status,
    profileStatus: row.profile_status,
  };
}

function normalizeAuditRow(row: PositionAuditRow): StakingPositionAuditEvent {
  return {
    eventId: row.event_id,
    commandId: row.command_id,
    action: row.action,
    outcome: row.outcome,
    actorUserId: row.actor_user_id,
    walletAccountId: row.wallet_account_id,
    stakingProductId: row.staking_product_id,
    stakingPositionId: row.staking_position_id,
    projectId: row.project_id,
    assetId: row.asset_id,
    reason: row.reason,
    principalUnits: row.principal_units,
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
