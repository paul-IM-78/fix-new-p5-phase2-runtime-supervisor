import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { DepositPublicResultCode } from "@/lib/deposit/public-results";
import { validateDepositUnitsString } from "@/lib/deposit/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

export type CreateDepositRequestInput = {
  walletAccountId: string;
  walletExpectedVersion: number;
  assetId: string;
  assetExpectedVersion: number;
  units: string;
  commandId: string;
};

export type CancelCurrentUserDepositInput = {
  depositRequestId: string;
  requestExpectedVersion: number;
  commandId: string;
};

export type DepositCommandResult = {
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

export type DepositCommandExecution =
  | { ok: true; result: DepositCommandResult }
  | { ok: false; error: DepositPublicResultCode | PublicAuthErrorCode };

type CreateDepositRequestRow =
  Database["public"]["Functions"]["create_user_funding_request"]["Returns"][number];
type CancelCurrentUserDepositRow =
  Database["public"]["Functions"]["cancel_current_user_funding_request"]["Returns"][number];

export async function createDepositRequest(
  input: CreateDepositRequestInput,
): Promise<DepositCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAccountAccess(supabase);

  if (access.status !== "active") {
    return { ok: false, error: mapAccountAccessError(access.status) };
  }

  const response = await supabase.rpc("create_user_funding_request", {
    p_wallet_account_id: input.walletAccountId,
    p_wallet_expected_version: input.walletExpectedVersion,
    p_asset_id: input.assetId,
    p_asset_expected_version: input.assetExpectedVersion,
    p_units: input.units,
    p_command_id: input.commandId,
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

export async function cancelCurrentUserDepositRequest(
  input: CancelCurrentUserDepositInput,
): Promise<DepositCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAccountAccess(supabase);

  if (access.status !== "active") {
    return { ok: false, error: mapAccountAccessError(access.status) };
  }

  const response = await supabase.rpc(
    "cancel_current_user_funding_request",
    {
      p_deposit_request_id: input.depositRequestId,
      p_request_expected_version: input.requestExpectedVersion,
      p_command_id: input.commandId,
    },
  );

  if (response.error) {
    return { ok: false, error: mapCommandRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;
  const result = row ? normalizeCommandRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "deposit_command_unavailable" };
}

function normalizeCommandRow(
  row: CreateDepositRequestRow | CancelCurrentUserDepositRow,
): DepositCommandResult | null {
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
}): DepositPublicResultCode {
  return error.code === "42501"
    ? "deposit_command_forbidden"
    : "deposit_command_unavailable";
}
