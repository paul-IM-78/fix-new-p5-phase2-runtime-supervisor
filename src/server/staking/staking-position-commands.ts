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
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

export type CreateStakingPositionInput = {
  stakingProductId: string;
  productExpectedVersion: number;
  walletAccountId: string;
  walletExpectedVersion: number;
  principalUnits: string;
  positionId: string;
  commandId: string;
};

export type UnlockStakingPositionInput = {
  stakingPositionId: string;
  positionExpectedVersion: number;
  walletExpectedVersion: number;
  commandId: string;
};

export type SettleCurrentUserStakingRewardInput = {
  stakingPositionId: string;
  positionExpectedVersion: number;
  walletExpectedVersion: number;
  commandId: string;
};

export type StakingPositionCommandResult = {
  resultCode: string;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  stakingPositionId: string | null;
  lockJournalId: string | null;
  walletAccountId: string | null;
  stakingProductId: string | null;
  projectId: string | null;
  assetId: string | null;
  principalUnits: string | null;
  resultingStatus: string | null;
  entityVersion: number | null;
  lockedAt: string | null;
  maturesAt: string | null;
};

export type StakingPositionUnlockCommandResult = {
  resultCode: string;
  replayed: boolean;
  stakingPositionId: string | null;
  positionVersion: number | null;
  positionStatus: "LOCKED" | "UNLOCKED" | null;
  maturityState: "LOCKED" | "MATURED" | "UNLOCKED" | null;
  principalUnits: string | null;
  unlockedAt: string | null;
};

export type StakingRewardSettlementCommandResult = {
  resultCode: string;
  replayed: boolean;
  stakingPositionId: string | null;
  rewardSettlementId: string | null;
  rewardState: "NOT_ELIGIBLE" | "CLAIMABLE" | "PAID" | "ZERO" | null;
  settlementOutcome: "PAID" | "ZERO" | null;
  rewardUnits: string | null;
  settledAt: string | null;
};

export type StakingPositionCommandExecution =
  | { ok: true; result: StakingPositionCommandResult }
  | { ok: false; error: StakingPublicResultCode | PublicAuthErrorCode };

export type StakingPositionUnlockCommandExecution =
  | { ok: true; result: StakingPositionUnlockCommandResult }
  | { ok: false; error: StakingPublicResultCode | PublicAuthErrorCode };

export type StakingRewardSettlementCommandExecution =
  | { ok: true; result: StakingRewardSettlementCommandResult }
  | { ok: false; error: StakingPublicResultCode | PublicAuthErrorCode };

type CreatePositionRow =
  Database["public"]["Functions"]["create_user_staking_position"]["Returns"][number];
type UnlockPositionRow =
  Database["public"]["Functions"]["unlock_current_user_staking_position"]["Returns"][number];
type RewardSettlementRow =
  Database["public"]["Functions"]["settle_current_user_staking_reward"]["Returns"][number];

export async function createUserStakingPosition(
  input: CreateStakingPositionInput,
): Promise<StakingPositionCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAccountAccess(supabase);

  if (access.status !== "active") {
    return { ok: false, error: mapAccountAccessError(access.status) };
  }

  const response = await supabase.rpc("create_user_staking_position", {
    p_staking_product_id: input.stakingProductId,
    p_product_expected_version: input.productExpectedVersion,
    p_wallet_account_id: input.walletAccountId,
    p_wallet_expected_version: input.walletExpectedVersion,
    p_principal_units: input.principalUnits,
    p_position_id: input.positionId,
    p_command_id: input.commandId,
  });

  if (response.error) {
    return { ok: false, error: mapCommandRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;
  const result = row ? normalizeCommandRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "staking_command_unavailable" };
}

export async function unlockCurrentUserStakingPosition(
  input: UnlockStakingPositionInput,
): Promise<StakingPositionUnlockCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAccountAccess(supabase);

  if (access.status !== "active") {
    return { ok: false, error: mapAccountAccessError(access.status) };
  }

  const response = await supabase.rpc("unlock_current_user_staking_position", {
    p_staking_position_id: input.stakingPositionId,
    p_position_expected_version: input.positionExpectedVersion,
    p_wallet_expected_version: input.walletExpectedVersion,
    p_command_id: input.commandId,
  });

  if (response.error) {
    return { ok: false, error: mapCommandRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;
  const result = row ? normalizeUnlockCommandRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "staking_position_unavailable" };
}

export async function settleCurrentUserStakingReward(
  input: SettleCurrentUserStakingRewardInput,
): Promise<StakingRewardSettlementCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAccountAccess(supabase);

  if (access.status !== "active") {
    return { ok: false, error: mapAccountAccessError(access.status) };
  }

  const response = await supabase.rpc("settle_current_user_staking_reward", {
    p_staking_position_id: input.stakingPositionId,
    p_position_expected_version: input.positionExpectedVersion,
    p_wallet_expected_version: input.walletExpectedVersion,
    p_command_id: input.commandId,
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

function normalizeCommandRow(
  row: CreatePositionRow,
): StakingPositionCommandResult | null {
  if (typeof row.result_code !== "string") {
    return null;
  }

  if (
    row.principal_units !== null &&
    !validateStakingPrincipalUnits(row.principal_units)
  ) {
    return null;
  }

  return {
    resultCode: row.result_code,
    replayed: row.replayed === true,
    eventId: row.event_id ?? null,
    commandId: row.command_id ?? null,
    stakingPositionId: row.staking_position_id ?? null,
    lockJournalId: row.lock_journal_id ?? null,
    walletAccountId: row.wallet_account_id ?? null,
    stakingProductId: row.staking_product_id ?? null,
    projectId: row.project_id ?? null,
    assetId: row.asset_id ?? null,
    principalUnits: row.principal_units ?? null,
    resultingStatus: row.resulting_status ?? null,
    entityVersion: row.entity_version ?? null,
    lockedAt: row.locked_at ?? null,
    maturesAt: row.matures_at ?? null,
  };
}

function normalizeUnlockCommandRow(
  row: UnlockPositionRow,
): StakingPositionUnlockCommandResult | null {
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
  row: RewardSettlementRow,
): StakingRewardSettlementCommandResult | null {
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

function mapAccountAccessError(
  status: Exclude<
    Awaited<ReturnType<typeof inspectAccountAccess>>["status"],
    "active"
  >,
): PublicAuthErrorCode {
  switch (status) {
    case "anonymous":
      return "invalid_credentials";
    case "inactive":
      return "account_restricted";
    case "missing_profile":
      return "account_unavailable";
    case "unavailable":
      return "auth_unavailable";
  }
}

function mapCommandRpcError(error: {
  code?: string;
}): StakingPublicResultCode {
  return error.code === "42501"
    ? "staking_command_forbidden"
    : "staking_command_unavailable";
}

function mapRewardRpcError(error: {
  code?: string;
}): StakingPublicResultCode {
  return error.code === "42501"
    ? "staking_reward_forbidden"
    : "staking_reward_unavailable";
}
