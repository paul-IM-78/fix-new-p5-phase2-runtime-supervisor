import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { StakingPublicResultCode } from "@/lib/staking/public-results";
import {
  validateStakingMaturityState,
  validateStakingPositionStatus,
  validateStakingPrincipalUnits,
  validateStakingRewardSettlementOutcome,
  validateStakingRewardState,
  validateStakingRewardUnits,
} from "@/lib/staking/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

export type AdminUnlockStakingPositionInput = {
  stakingPositionId: string;
  positionExpectedVersion: number;
  commandId: string;
  reason: string;
};

export type AdminSettleStakingRewardInput = {
  stakingPositionId: string;
  positionExpectedVersion: number;
  commandId: string;
  reason: string;
};

export type AdminStakingPositionUnlockResult = {
  resultCode: string;
  replayed: boolean;
  stakingPositionId: string | null;
  positionVersion: number | null;
  positionStatus: "LOCKED" | "UNLOCKED" | null;
  maturityState: "LOCKED" | "MATURED" | "UNLOCKED" | null;
  principalUnits: string | null;
  unlockedAt: string | null;
};

export type AdminStakingRewardSettlementResult = {
  resultCode: string;
  replayed: boolean;
  stakingPositionId: string | null;
  rewardSettlementId: string | null;
  rewardState: "NOT_ELIGIBLE" | "CLAIMABLE" | "PAID" | "ZERO" | null;
  settlementOutcome: "PAID" | "ZERO" | null;
  rewardUnits: string | null;
  settledAt: string | null;
};

export type AdminStakingPositionCommandExecution =
  | { ok: true; result: AdminStakingPositionUnlockResult }
  | { ok: false; error: StakingPublicResultCode | PublicAuthErrorCode };

export type AdminStakingRewardSettlementExecution =
  | { ok: true; result: AdminStakingRewardSettlementResult }
  | { ok: false; error: StakingPublicResultCode | PublicAuthErrorCode };

type AdminUnlockRow =
  Database["public"]["Functions"]["unlock_staking_position_as_admin"]["Returns"][number];
type AdminRewardSettlementRow =
  Database["public"]["Functions"]["settle_staking_reward_as_admin"]["Returns"][number];

export async function unlockStakingPositionAsAdmin(
  input: AdminUnlockStakingPositionInput,
): Promise<AdminStakingPositionCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("unlock_staking_position_as_admin", {
    p_staking_position_id: input.stakingPositionId,
    p_position_expected_version: input.positionExpectedVersion,
    p_command_id: input.commandId,
    p_reason: input.reason,
  });

  if (response.error) {
    return { ok: false, error: mapUnlockRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;
  const result = row ? normalizeUnlockRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "staking_position_unavailable" };
}

export async function settleStakingRewardAsAdmin(
  input: AdminSettleStakingRewardInput,
): Promise<AdminStakingRewardSettlementExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("settle_staking_reward_as_admin", {
    p_staking_position_id: input.stakingPositionId,
    p_position_expected_version: input.positionExpectedVersion,
    p_command_id: input.commandId,
    p_reason: input.reason,
  });

  if (response.error) {
    return { ok: false, error: mapRewardRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;
  const result = row ? normalizeRewardSettlementRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "staking_reward_unavailable" };
}

function normalizeUnlockRow(
  row: AdminUnlockRow,
): AdminStakingPositionUnlockResult | null {
  if (typeof row.result_code !== "string") {
    return null;
  }

  const status =
    row.position_status === null
      ? null
      : validateStakingPositionStatus(row.position_status);
  const maturityState =
    row.maturity_state === null
      ? null
      : validateStakingMaturityState(row.maturity_state);

  if (
    (row.position_status !== null && !status) ||
    (row.maturity_state !== null && !maturityState) ||
    (row.principal_units !== null &&
      !validateStakingPrincipalUnits(row.principal_units))
  ) {
    return null;
  }

  return {
    resultCode: row.result_code,
    replayed: row.replayed === true,
    stakingPositionId: row.staking_position_id ?? null,
    positionVersion: row.position_version ?? null,
    positionStatus: status,
    maturityState,
    principalUnits: row.principal_units ?? null,
    unlockedAt: row.unlocked_at ?? null,
  };
}

function normalizeRewardSettlementRow(
  row: AdminRewardSettlementRow,
): AdminStakingRewardSettlementResult | null {
  if (typeof row.result_code !== "string") {
    return null;
  }

  const rewardState =
    row.reward_state === null
      ? null
      : validateStakingRewardState(row.reward_state);
  const settlementOutcome =
    row.settlement_outcome === null
      ? null
      : validateStakingRewardSettlementOutcome(row.settlement_outcome);
  const rewardUnits =
    row.reward_units === null
      ? null
      : validateStakingRewardUnits(row.reward_units);

  if (
    (row.reward_state !== null && !rewardState) ||
    (row.settlement_outcome !== null && !settlementOutcome) ||
    (row.reward_units !== null && !rewardUnits) ||
    (row.settled_at !== null && Number.isNaN(Date.parse(row.settled_at)))
  ) {
    return null;
  }

  return {
    resultCode: row.result_code,
    replayed: row.replayed === true,
    stakingPositionId: row.staking_position_id ?? null,
    rewardSettlementId: row.reward_settlement_id ?? null,
    rewardState,
    settlementOutcome,
    rewardUnits,
    settledAt: row.settled_at ?? null,
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

function mapUnlockRpcError(error: { code?: string }): StakingPublicResultCode {
  return error.code === "42501"
    ? "staking_command_forbidden"
    : "staking_position_unavailable";
}

function mapRewardRpcError(error: { code?: string }): StakingPublicResultCode {
  return error.code === "42501"
    ? "staking_reward_forbidden"
    : "staking_reward_unavailable";
}
