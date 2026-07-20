import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

type WalletRow = Database["public"]["Tables"]["wallet_accounts"]["Row"];
type AssetRow = Database["public"]["Tables"]["supported_assets"]["Row"];
type DepositRequestRow =
  Database["public"]["Functions"]["list_current_user_deposit_requests"]["Returns"][number];

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

export type CurrentDepositAsset = {
  assetId: string;
  assetCode: string;
  symbol: string;
  displayName: string;
  assetType: string;
  decimals: number;
  status: string;
  version: number;
};

export type CurrentDepositWallet = {
  walletAccountId: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CurrentDepositRequest = {
  depositRequestId: string;
  walletAccountId: string;
  assetId: string;
  assetCode: string;
  symbol: string;
  decimals: number;
  requestedUnits: string;
  status: string;
  requestJournalId: string;
  confirmationJournalId: string | null;
  cancellationJournalId: string | null;
  cancellationActorType: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
  version: number;
};

export type CurrentDepositsResult =
  | {
      status: "ready";
      wallet: CurrentDepositWallet;
      assets: CurrentDepositAsset[];
      depositRequests: CurrentDepositRequest[];
    }
  | { status: "anonymous" }
  | { status: "inactive_profile" }
  | { status: "missing_profile" }
  | { status: "missing_wallet" }
  | { status: "unavailable" };

export async function getCurrentDeposits(): Promise<CurrentDepositsResult> {
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

  const [wallets, assets, depositRequests] = await Promise.all([
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
    supabase.rpc("list_current_user_deposit_requests", {
      p_limit: 50,
    }),
  ]);

  if (wallets.error || assets.error || depositRequests.error) {
    return { status: "unavailable" };
  }

  const walletRows = wallets.data ?? [];

  if (walletRows.length === 0) {
    return { status: "missing_wallet" };
  }

  if (walletRows.length !== 1) {
    return { status: "unavailable" };
  }

  return {
    status: "ready",
    wallet: normalizeWallet(walletRows[0]),
    assets: (assets.data ?? []).map(normalizeAsset),
    depositRequests: (depositRequests.data ?? []).map(normalizeRequest),
  };
}

function normalizeWallet(row: CurrentWalletRow): CurrentDepositWallet {
  return {
    walletAccountId: row.id,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAsset(row: ActiveAssetRow): CurrentDepositAsset {
  return {
    assetId: row.id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    displayName: row.display_name,
    assetType: row.asset_type,
    decimals: row.decimals,
    status: row.status,
    version: row.version,
  };
}

function normalizeRequest(row: DepositRequestRow): CurrentDepositRequest {
  return {
    depositRequestId: row.deposit_request_id,
    walletAccountId: row.wallet_account_id,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    decimals: row.decimals,
    requestedUnits: normalizePositiveUnits(row.requested_units),
    status: row.status,
    requestJournalId: row.request_journal_id,
    confirmationJournalId: row.confirmation_journal_id ?? null,
    cancellationJournalId: row.cancellation_journal_id ?? null,
    cancellationActorType: row.cancellation_actor_type ?? null,
    requestedAt: row.requested_at,
    confirmedAt: row.confirmed_at ?? null,
    canceledAt: row.canceled_at ?? null,
    version: row.version,
  };
}

function normalizePositiveUnits(value: string): string {
  return /^[1-9][0-9]{0,37}$/.test(value) ? value : "1";
}
