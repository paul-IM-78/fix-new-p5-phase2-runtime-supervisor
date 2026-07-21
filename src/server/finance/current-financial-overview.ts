import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  addAtomicUnitStrings,
  isCanonicalNonNegativeAtomicUnits,
  isPositiveAtomicUnits,
} from "@/lib/ledger/atomic-units";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

type WalletRow = Database["public"]["Tables"]["wallet_accounts"]["Row"];
type BalanceRow =
  Database["public"]["Functions"]["list_current_user_ledger_balances"]["Returns"][number];
type DepositRow =
  Database["public"]["Functions"]["list_current_user_deposit_requests"]["Returns"][number];
type WithdrawalRow =
  Database["public"]["Functions"]["list_current_user_withdrawal_requests"]["Returns"][number];

type WalletAccountStatus = "ACTIVE" | "FROZEN" | "CLOSED";
type DepositStatus = "REQUESTED" | "CONFIRMED" | "CANCELED";
type WithdrawalStatus =
  | "REQUESTED"
  | "RESERVED"
  | "APPROVED"
  | "EXECUTING"
  | "FAILED"
  | "SETTLED"
  | "CANCELED";

type CurrentWalletRow = Pick<
  WalletRow,
  "id" | "user_id" | "custody_model" | "status" | "closed_at" | "version"
>;

export type UserAssetLedgerBalance = {
  assetId: string;
  assetCode: string;
  symbol: string;
  decimals: number;
  availableUnits: string;
  lockedUnits: string;
  pendingDepositUnits: string;
  pendingWithdrawalUnits: string;
  totalLiabilityUnits: string;
};

export type UserDepositSummary = {
  depositRequestId: string;
  assetCode: string;
  symbol: string;
  requestedUnits: string;
  status: DepositStatus;
  version: number;
  requestedAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
  cancellationActorType: string | null;
};

export type UserWithdrawalSummary = {
  withdrawalRequestId: string;
  assetCode: string;
  symbol: string;
  requestedUnits: string;
  status: WithdrawalStatus;
  version: number;
  requestedAt: string;
  reservedAt: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  cancellationActorType: string | null;
  canceledFromStatus: string | null;
};

export type CurrentFinancialOverviewResult =
  | { status: "anonymous" }
  | { status: "inactive_profile" }
  | { status: "missing_wallet" }
  | { status: "unavailable" }
  | {
      status: "ready";
      wallet: {
        custodyModel: "MANAGED";
        accountStatus: WalletAccountStatus;
        version: number;
        closedAt: string | null;
      };
      balances: UserAssetLedgerBalance[];
      deposits: {
        pendingCount: number;
        requests: UserDepositSummary[];
      };
      withdrawals: {
        openCount: number;
        settledCount: number;
        requests: UserWithdrawalSummary[];
      };
    };

export async function getCurrentFinancialOverview(): Promise<CurrentFinancialOverviewResult> {
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
    case "unavailable":
      return { status: "unavailable" };
  }

  const [wallets, balances, deposits, withdrawals] = await Promise.all([
    supabase
      .from("wallet_accounts")
      .select("id, user_id, custody_model, status, closed_at, version")
      .eq("user_id", access.userId)
      .limit(2),
    supabase.rpc("list_current_user_ledger_balances"),
    supabase.rpc("list_current_user_deposit_requests", { p_limit: 20 }),
    supabase.rpc("list_current_user_withdrawal_requests", { p_limit: 20 }),
  ]);

  if (wallets.error || balances.error || deposits.error || withdrawals.error) {
    return { status: "unavailable" };
  }

  const walletRows = wallets.data ?? [];

  if (walletRows.length === 0) {
    return { status: "missing_wallet" };
  }

  if (walletRows.length !== 1) {
    return { status: "unavailable" };
  }

  const wallet = normalizeWallet(walletRows[0]);
  const balanceRows = normalizeBalances(balances.data ?? []);
  const depositRows = normalizeDeposits(deposits.data ?? []);
  const withdrawalRows = normalizeWithdrawals(withdrawals.data ?? []);

  if (!wallet || !balanceRows || !depositRows || !withdrawalRows) {
    return { status: "unavailable" };
  }

  return {
    status: "ready",
    wallet,
    balances: balanceRows,
    deposits: {
      pendingCount: depositRows.filter(
        (request) => request.status === "REQUESTED",
      ).length,
      requests: depositRows,
    },
    withdrawals: {
      openCount: withdrawalRows.filter((request) =>
        isOpenWithdrawalStatus(request.status),
      ).length,
      settledCount: withdrawalRows.filter(
        (request) => request.status === "SETTLED",
      ).length,
      requests: withdrawalRows,
    },
  };
}

function normalizeWallet(
  row: CurrentWalletRow,
): Extract<CurrentFinancialOverviewResult, { status: "ready" }>["wallet"] | null {
  if (
    row.custody_model !== "MANAGED" ||
    !isWalletAccountStatus(row.status) ||
    row.user_id.length === 0
  ) {
    return null;
  }

  return {
    custodyModel: row.custody_model,
    accountStatus: row.status,
    version: row.version,
    closedAt: row.closed_at ?? null,
  };
}

function normalizeBalances(
  rows: BalanceRow[],
): UserAssetLedgerBalance[] | null {
  const seenAssetIds = new Set<string>();
  const balances: UserAssetLedgerBalance[] = [];

  for (const row of rows) {
    if (seenAssetIds.has(row.asset_id) || !isSafeAssetText(row.asset_code)) {
      return null;
    }

    const balance = normalizeBalance(row);

    if (!balance) {
      return null;
    }

    seenAssetIds.add(balance.assetId);
    balances.push(balance);
  }

  return balances;
}

function normalizeBalance(row: BalanceRow): UserAssetLedgerBalance | null {
  if (
    !isSafeAssetText(row.asset_code) ||
    !isSafeAssetText(row.symbol) ||
    !isSafeDecimals(row.decimals)
  ) {
    return null;
  }

  const units = [
    row.available_units,
    row.locked_units,
    row.pending_deposit_units,
    row.pending_withdrawal_units,
    row.total_liability_units,
  ];

  if (!units.every(isCanonicalNonNegativeAtomicUnits)) {
    return null;
  }

  const first = addAtomicUnitStrings(row.available_units, row.locked_units);
  const second = first
    ? addAtomicUnitStrings(first, row.pending_deposit_units)
    : null;
  const total = second
    ? addAtomicUnitStrings(second, row.pending_withdrawal_units)
    : null;

  if (total !== row.total_liability_units) {
    return null;
  }

  return {
    assetId: row.asset_id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    decimals: row.decimals,
    availableUnits: row.available_units,
    lockedUnits: row.locked_units,
    pendingDepositUnits: row.pending_deposit_units,
    pendingWithdrawalUnits: row.pending_withdrawal_units,
    totalLiabilityUnits: row.total_liability_units,
  };
}

function normalizeDeposits(rows: DepositRow[]): UserDepositSummary[] | null {
  const results: UserDepositSummary[] = [];

  for (const row of rows) {
    if (
      !isDepositStatus(row.status) ||
      !isSafeAssetText(row.asset_code) ||
      !isSafeAssetText(row.symbol) ||
      !isPositiveAtomicUnits(row.requested_units)
    ) {
      return null;
    }

    results.push({
      depositRequestId: row.deposit_request_id,
      assetCode: row.asset_code,
      symbol: row.symbol,
      requestedUnits: row.requested_units,
      status: row.status,
      version: row.version,
      requestedAt: row.requested_at,
      confirmedAt: row.confirmed_at ?? null,
      canceledAt: row.canceled_at ?? null,
      cancellationActorType: row.cancellation_actor_type ?? null,
    });
  }

  return results;
}

function normalizeWithdrawals(
  rows: WithdrawalRow[],
): UserWithdrawalSummary[] | null {
  const results: UserWithdrawalSummary[] = [];

  for (const row of rows) {
    if (
      !isWithdrawalStatus(row.status) ||
      !isSafeAssetText(row.asset_code) ||
      !isSafeAssetText(row.symbol) ||
      !isPositiveAtomicUnits(row.requested_units)
    ) {
      return null;
    }

    results.push({
      withdrawalRequestId: row.withdrawal_request_id,
      assetCode: row.asset_code,
      symbol: row.symbol,
      requestedUnits: row.requested_units,
      status: row.status,
      version: row.version,
      requestedAt: row.requested_at,
      reservedAt: row.reserved_at ?? null,
      approvedAt: row.approved_at ?? null,
      canceledAt: row.canceled_at ?? null,
      cancellationActorType: row.cancellation_actor_type ?? null,
      canceledFromStatus: row.canceled_from_status ?? null,
    });
  }

  return results;
}

function isSafeAssetText(value: string): boolean {
  return value.length > 0 && value.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeDecimals(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 38;
}

function isWalletAccountStatus(value: string): value is WalletAccountStatus {
  return value === "ACTIVE" || value === "FROZEN" || value === "CLOSED";
}

function isDepositStatus(value: string): value is DepositStatus {
  return (
    value === "REQUESTED" ||
    value === "CONFIRMED" ||
    value === "CANCELED"
  );
}

function isWithdrawalStatus(value: string): value is WithdrawalStatus {
  return (
    value === "REQUESTED" ||
    value === "RESERVED" ||
    value === "APPROVED" ||
    value === "EXECUTING" ||
    value === "FAILED" ||
    value === "SETTLED" ||
    value === "CANCELED"
  );
}

function isOpenWithdrawalStatus(value: WithdrawalStatus): boolean {
  return (
    value === "REQUESTED" ||
    value === "RESERVED" ||
    value === "APPROVED" ||
    value === "EXECUTING" ||
    value === "FAILED"
  );
}
