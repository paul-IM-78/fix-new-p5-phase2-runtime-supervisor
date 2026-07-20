import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

type WalletRow = Database["public"]["Tables"]["wallet_accounts"]["Row"];
type AssetRow = Database["public"]["Tables"]["supported_assets"]["Row"];
type BalanceRow =
  Database["public"]["Functions"]["list_current_user_ledger_balances"]["Returns"][number];
type WithdrawalRequestRow =
  Database["public"]["Functions"]["list_current_user_withdrawal_requests"]["Returns"][number];

type ActiveAssetRow = Pick<
  AssetRow,
  | "id"
  | "asset_code"
  | "symbol"
  | "display_name"
  | "asset_type"
  | "decimals"
  | "status"
  | "version"
>;
type CurrentWalletRow = Pick<
  WalletRow,
  "id" | "user_id" | "status" | "version" | "created_at" | "updated_at"
>;

export type CurrentWithdrawalAsset = {
  assetId: string;
  assetCode: string;
  symbol: string;
  displayName: string;
  assetType: string;
  decimals: number;
  status: string;
  version: number;
  availableUnits: string;
  pendingWithdrawalUnits: string;
  totalLiabilityUnits: string;
};

export type CurrentWithdrawalWallet = {
  walletAccountId: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CurrentWithdrawalRequest = {
  withdrawalRequestId: string;
  walletAccountId: string;
  assetId: string;
  assetCode: string;
  symbol: string;
  decimals: number;
  requestedUnits: string;
  status: string;
  reservationJournalId: string | null;
  approvalJournalId: string | null;
  cancellationJournalId: string | null;
  cancellationActorType: string | null;
  canceledFromStatus: string | null;
  requestedAt: string;
  reservedAt: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  version: number;
};

export type CurrentWithdrawalsResult =
  | {
      status: "ready";
      wallet: CurrentWithdrawalWallet;
      assets: CurrentWithdrawalAsset[];
      withdrawalRequests: CurrentWithdrawalRequest[];
    }
  | { status: "anonymous" }
  | { status: "inactive_profile" }
  | { status: "missing_profile" }
  | { status: "missing_wallet" }
  | { status: "unavailable" };

export async function getCurrentWithdrawals(): Promise<CurrentWithdrawalsResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAccountAccess(supabase);

  switch (access.status) {
    case "active":
      break;
    case "anonymous":
      return { status: "anonymous" };
    case "inactive":
      return { status: "inactive_profile" };
    case "missing_profile":
      return { status: "missing_profile" };
    case "unavailable":
      return { status: "unavailable" };
  }

  const [wallets, assets, balances, withdrawalRequests] = await Promise.all([
    supabase
      .from("wallet_accounts")
      .select("id, user_id, status, version, created_at, updated_at")
      .eq("user_id", access.userId)
      .limit(2),
    supabase
      .from("supported_assets")
      .select(
        "id, asset_code, symbol, display_name, asset_type, decimals, status, version",
      )
      .eq("status", "ACTIVE")
      .order("asset_code", { ascending: true })
      .limit(100),
    supabase.rpc("list_current_user_ledger_balances"),
    supabase.rpc("list_current_user_withdrawal_requests", {
      p_limit: 50,
    }),
  ]);

  if (
    wallets.error ||
    assets.error ||
    balances.error ||
    withdrawalRequests.error
  ) {
    return { status: "unavailable" };
  }

  const walletRows = wallets.data ?? [];

  if (walletRows.length === 0) {
    return { status: "missing_wallet" };
  }

  if (walletRows.length !== 1) {
    return { status: "unavailable" };
  }

  const balanceByAssetId = new Map(
    (balances.data ?? []).map((balance) => [balance.asset_id, balance]),
  );

  return {
    status: "ready",
    wallet: normalizeWallet(walletRows[0]),
    assets: (assets.data ?? []).map((asset) =>
      normalizeAsset(asset, balanceByAssetId.get(asset.id) ?? null),
    ),
    withdrawalRequests: (withdrawalRequests.data ?? []).map(normalizeRequest),
  };
}

function normalizeWallet(row: CurrentWalletRow): CurrentWithdrawalWallet {
  return {
    walletAccountId: row.id,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAsset(
  row: ActiveAssetRow,
  balance: BalanceRow | null,
): CurrentWithdrawalAsset {
  return {
    assetId: row.id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    displayName: row.display_name,
    assetType: row.asset_type,
    decimals: row.decimals,
    status: row.status,
    version: row.version,
    availableUnits: normalizeUnsignedUnits(balance?.available_units ?? "0"),
    pendingWithdrawalUnits: normalizeUnsignedUnits(
      balance?.pending_withdrawal_units ?? "0",
    ),
    totalLiabilityUnits: normalizeUnsignedUnits(
      balance?.total_liability_units ?? "0",
    ),
  };
}

function normalizeRequest(
  row: WithdrawalRequestRow,
): CurrentWithdrawalRequest {
  return {
    withdrawalRequestId: row.withdrawal_request_id,
    walletAccountId: row.wallet_account_id,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    decimals: row.decimals,
    requestedUnits: normalizePositiveUnits(row.requested_units),
    status: row.status,
    reservationJournalId: row.reservation_journal_id ?? null,
    approvalJournalId: row.approval_journal_id ?? null,
    cancellationJournalId: row.cancellation_journal_id ?? null,
    cancellationActorType: row.cancellation_actor_type ?? null,
    canceledFromStatus: row.canceled_from_status ?? null,
    requestedAt: row.requested_at,
    reservedAt: row.reserved_at ?? null,
    approvedAt: row.approved_at ?? null,
    canceledAt: row.canceled_at ?? null,
    version: row.version,
  };
}

function normalizePositiveUnits(value: string): string {
  return /^[1-9][0-9]{0,37}$/.test(value) ? value : "1";
}

function normalizeUnsignedUnits(value: string): string {
  return /^(0|[1-9][0-9]{0,37})$/.test(value) ? value : "0";
}
