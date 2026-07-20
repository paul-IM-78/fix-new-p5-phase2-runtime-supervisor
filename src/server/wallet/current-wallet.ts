import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

type WalletRow = Database["public"]["Tables"]["wallet_accounts"]["Row"];

export type CurrentWalletAccount = {
  walletAccountId: string;
  userId: string;
  custodyModel: string;
  status: string;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CurrentWalletResult =
  | { status: "ready"; walletAccount: CurrentWalletAccount }
  | { status: "anonymous" }
  | { status: "inactive_profile" }
  | { status: "missing_profile" }
  | { status: "missing_wallet" }
  | { status: "unavailable" };

export async function getCurrentWallet(): Promise<CurrentWalletResult> {
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

  const { data, error } = await supabase
    .from("wallet_accounts")
    .select(
      "id, user_id, custody_model, status, closed_at, version, created_at, updated_at",
    )
    .eq("user_id", access.userId)
    .maybeSingle();

  if (error) {
    return { status: "unavailable" };
  }

  if (!data) {
    return { status: "missing_wallet" };
  }

  return {
    status: "ready",
    walletAccount: normalizeWallet(data),
  };
}

function normalizeWallet(row: WalletRow): CurrentWalletAccount {
  return {
    walletAccountId: row.id,
    userId: row.user_id,
    custodyModel: row.custody_model,
    status: row.status,
    closedAt: row.closed_at ?? null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
