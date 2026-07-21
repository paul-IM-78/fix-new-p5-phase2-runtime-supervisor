import "server-only";

import {
  addAtomicUnitStrings,
  isCanonicalNonNegativeAtomicUnits,
  isPositiveAtomicUnits,
} from "@/lib/ledger/atomic-units";
import {
  validateStakingMaturityState,
  validateStakingPositionStatus,
} from "@/lib/staking/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

type WalletRow = Pick<
  Database["public"]["Tables"]["wallet_accounts"]["Row"],
  "id" | "user_id" | "custody_model" | "status" | "closed_at" | "version"
>;
type ProductRow =
  Database["public"]["Functions"]["list_current_staking_products"]["Returns"][number];
type BalanceRow =
  Database["public"]["Functions"]["list_current_user_ledger_balances"]["Returns"][number];
type PositionRow =
  Database["public"]["Functions"]["list_current_user_staking_positions"]["Returns"][number];

type WalletStatus = "ACTIVE" | "FROZEN" | "CLOSED";

export type CurrentStakingWallet = {
  walletAccountId: string;
  custodyModel: "MANAGED";
  status: WalletStatus;
  version: number;
  closedAt: string | null;
};

export type CurrentStakingBalance = {
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

export type CurrentStakingProduct = {
  stakingProductId: string;
  productCode: string;
  displayName: string;
  description: string | null;
  projectId: string;
  projectCode: string;
  projectDisplayName: string;
  assetId: string;
  assetCode: string;
  assetSymbol: string;
  assetDecimals: number;
  lockDurationDays: number;
  minStakeUnits: string;
  maxStakeUnits: string | null;
  termRewardRatePpm: number;
  rewardRoundingMode: "FLOOR";
  enrollmentStartsAt: string;
  enrollmentEndsAt: string;
  enrollmentState: "UPCOMING" | "OPEN";
  productVersion: number;
};

export type CurrentStakingPosition = {
  stakingPositionId: string;
  stakingProductId: string;
  productCode: string;
  productDisplayName: string;
  projectId: string;
  projectCode: string;
  projectDisplayName: string;
  assetId: string;
  assetCode: string;
  assetSymbol: string;
  assetDecimals: number;
  principalUnits: string;
  status: "LOCKED" | "UNLOCKED";
  maturityState: "LOCKED" | "MATURED" | "UNLOCKED";
  productVersionSnapshot: number;
  lockDurationDaysSnapshot: number;
  termRewardRatePpmSnapshot: number;
  rewardRoundingModeSnapshot: "FLOOR";
  lockedAt: string;
  maturesAt: string;
  unlockedAt: string | null;
  unlockActorType: "USER" | "ADMIN" | null;
  positionVersion: number;
};

export type CurrentStakingResult =
  | { status: "anonymous" }
  | { status: "inactive_profile" }
  | { status: "missing_wallet" }
  | { status: "unavailable" }
  | {
      status: "ready";
      wallet: CurrentStakingWallet;
      products: CurrentStakingProduct[];
      balances: CurrentStakingBalance[];
      positions: CurrentStakingPosition[];
    };

export async function getCurrentStaking(): Promise<CurrentStakingResult> {
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

  const [wallets, products, balances, positions] = await Promise.all([
    supabase
      .from("wallet_accounts")
      .select("id, user_id, custody_model, status, closed_at, version")
      .eq("user_id", access.userId)
      .limit(2),
    supabase.rpc("list_current_staking_products", { p_limit: 50 }),
    supabase.rpc("list_current_user_ledger_balances"),
    supabase.rpc("list_current_user_staking_positions", { p_limit: 100 }),
  ]);

  if (
    wallets.error ||
    products.error ||
    balances.error ||
    positions.error
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

  const wallet = normalizeWallet(walletRows[0]);
  const productRows = normalizeProducts(products.data ?? []);
  const balanceRows = normalizeBalances(balances.data ?? []);
  const positionRows = normalizePositions(positions.data ?? []);

  if (!wallet || !productRows || !balanceRows || !positionRows) {
    return { status: "unavailable" };
  }

  return {
    status: "ready",
    wallet,
    products: productRows,
    balances: balanceRows,
    positions: positionRows,
  };
}

function normalizeWallet(row: WalletRow): CurrentStakingWallet | null {
  if (
    row.custody_model !== "MANAGED" ||
    !isWalletStatus(row.status) ||
    !Number.isSafeInteger(row.version)
  ) {
    return null;
  }

  return {
    walletAccountId: row.id,
    custodyModel: row.custody_model,
    status: row.status,
    version: row.version,
    closedAt: row.closed_at ?? null,
  };
}

function normalizeProducts(rows: ProductRow[]): CurrentStakingProduct[] | null {
  const results: CurrentStakingProduct[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.staking_product_id)) {
      return null;
    }

    const product = normalizeProduct(row);

    if (!product) {
      return null;
    }

    seen.add(product.stakingProductId);
    results.push(product);
  }

  return results;
}

function normalizeProduct(row: ProductRow): CurrentStakingProduct | null {
  if (
    !isSafeText(row.product_code, 64) ||
    !isSafeText(row.display_name, 100) ||
    !isSafeText(row.project_code, 64) ||
    !isSafeText(row.project_display_name, 100) ||
    !isSafeText(row.asset_code, 64) ||
    !isSafeText(row.asset_symbol, 64) ||
    !isSafeDecimals(row.asset_decimals) ||
    !isSafeInteger(row.lock_duration_days, 1, 3650) ||
    !isPositiveAtomicUnits(row.min_stake_units) ||
    (row.max_stake_units !== null &&
      !isPositiveAtomicUnits(row.max_stake_units)) ||
    !isSafeInteger(row.term_reward_rate_ppm, 1, 1000000) ||
    row.reward_rounding_mode !== "FLOOR" ||
    !isEnrollmentState(row.enrollment_state) ||
    !isValidIsoDate(row.enrollment_starts_at) ||
    !isValidIsoDate(row.enrollment_ends_at) ||
    !isSafeInteger(row.product_version, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }

  if (row.description !== null && !isSafeText(row.description, 1000)) {
    return null;
  }

  return {
    stakingProductId: row.staking_product_id,
    productCode: row.product_code,
    displayName: row.display_name,
    description: row.description ?? null,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectDisplayName: row.project_display_name,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetSymbol: row.asset_symbol,
    assetDecimals: row.asset_decimals,
    lockDurationDays: row.lock_duration_days,
    minStakeUnits: row.min_stake_units,
    maxStakeUnits: row.max_stake_units ?? null,
    termRewardRatePpm: row.term_reward_rate_ppm,
    rewardRoundingMode: row.reward_rounding_mode,
    enrollmentStartsAt: row.enrollment_starts_at,
    enrollmentEndsAt: row.enrollment_ends_at,
    enrollmentState: row.enrollment_state,
    productVersion: row.product_version,
  };
}

function normalizeBalances(
  rows: BalanceRow[],
): CurrentStakingBalance[] | null {
  const results: CurrentStakingBalance[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.asset_id)) {
      return null;
    }

    const balance = normalizeBalance(row);

    if (!balance) {
      return null;
    }

    seen.add(balance.assetId);
    results.push(balance);
  }

  return results;
}

function normalizeBalance(row: BalanceRow): CurrentStakingBalance | null {
  const units = [
    row.available_units,
    row.locked_units,
    row.pending_deposit_units,
    row.pending_withdrawal_units,
    row.total_liability_units,
  ];

  if (
    !isSafeText(row.asset_code, 64) ||
    !isSafeText(row.symbol, 64) ||
    !isSafeDecimals(row.decimals) ||
    !units.every(isCanonicalNonNegativeAtomicUnits)
  ) {
    return null;
  }

  const availableAndLocked = addAtomicUnitStrings(
    row.available_units,
    row.locked_units,
  );
  const withPendingDeposit = availableAndLocked
    ? addAtomicUnitStrings(availableAndLocked, row.pending_deposit_units)
    : null;
  const total = withPendingDeposit
    ? addAtomicUnitStrings(withPendingDeposit, row.pending_withdrawal_units)
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

function normalizePositions(
  rows: PositionRow[],
): CurrentStakingPosition[] | null {
  const results: CurrentStakingPosition[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.staking_position_id)) {
      return null;
    }

    const position = normalizePosition(row);

    if (!position) {
      return null;
    }

    seen.add(position.stakingPositionId);
    results.push(position);
  }

  return results;
}

function normalizePosition(row: PositionRow): CurrentStakingPosition | null {
  const status = validateStakingPositionStatus(row.status);
  const maturityState = validateStakingMaturityState(row.maturity_state);

  if (
    !isSafeText(row.product_code, 64) ||
    !isSafeText(row.product_display_name, 100) ||
    !isSafeText(row.project_code, 64) ||
    !isSafeText(row.project_display_name, 100) ||
    !isSafeText(row.asset_code, 64) ||
    !isSafeText(row.asset_symbol, 64) ||
    !isSafeDecimals(row.asset_decimals) ||
    !isPositiveAtomicUnits(row.principal_units) ||
    !status ||
    !maturityState ||
    !isSafeInteger(row.product_version_snapshot, 1, Number.MAX_SAFE_INTEGER) ||
    !isSafeInteger(row.lock_duration_days_snapshot, 1, 3650) ||
    !isSafeInteger(row.term_reward_rate_ppm_snapshot, 1, 1000000) ||
    row.reward_rounding_mode_snapshot !== "FLOOR" ||
    !isValidIsoDate(row.locked_at) ||
    !isValidIsoDate(row.matures_at) ||
    (row.unlocked_at !== null && !isValidIsoDate(row.unlocked_at)) ||
    !isUnlockActorTypeOrNull(row.unlock_actor_type) ||
    !isSafeInteger(row.position_version, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }

  return {
    stakingPositionId: row.staking_position_id,
    stakingProductId: row.staking_product_id,
    productCode: row.product_code,
    productDisplayName: row.product_display_name,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectDisplayName: row.project_display_name,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetSymbol: row.asset_symbol,
    assetDecimals: row.asset_decimals,
    principalUnits: row.principal_units,
    status,
    maturityState,
    productVersionSnapshot: row.product_version_snapshot,
    lockDurationDaysSnapshot: row.lock_duration_days_snapshot,
    termRewardRatePpmSnapshot: row.term_reward_rate_ppm_snapshot,
    rewardRoundingModeSnapshot: row.reward_rounding_mode_snapshot,
    lockedAt: row.locked_at,
    maturesAt: row.matures_at,
    unlockedAt: row.unlocked_at ?? null,
    unlockActorType: row.unlock_actor_type ?? null,
    positionVersion: row.position_version,
  };
}

function isWalletStatus(value: string): value is WalletStatus {
  return value === "ACTIVE" || value === "FROZEN" || value === "CLOSED";
}

function isEnrollmentState(value: string): value is "UPCOMING" | "OPEN" {
  return value === "UPCOMING" || value === "OPEN";
}

function isUnlockActorTypeOrNull(
  value: unknown,
): value is "USER" | "ADMIN" | null {
  return value === null || value === "USER" || value === "ADMIN";
}

function isSafeText(value: string, maxLength: number): boolean {
  return value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeDecimals(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 38;
}

function isSafeInteger(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function isValidIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}
