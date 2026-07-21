import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { StakingPublicResultCode } from "@/lib/staking/public-results";
import { validateStakingPrincipalUnits } from "@/lib/staking/validation";
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

export type StakingPositionCommandExecution =
  | { ok: true; result: StakingPositionCommandResult }
  | { ok: false; error: StakingPublicResultCode | PublicAuthErrorCode };

type CreatePositionRow =
  Database["public"]["Functions"]["create_user_staking_position"]["Returns"][number];

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
