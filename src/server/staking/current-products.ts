import "server-only";

import { isPositiveAtomicUnits } from "@/lib/ledger/atomic-units";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

type ProductRow =
  Database["public"]["Functions"]["list_current_staking_products"]["Returns"][number];

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

export type CurrentStakingProductsResult =
  | { status: "anonymous" }
  | { status: "inactive_profile" }
  | { status: "missing_profile" }
  | { status: "unavailable" }
  | { status: "ready"; products: CurrentStakingProduct[] };

export async function listCurrentStakingProducts(): Promise<CurrentStakingProductsResult> {
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

  const response = await supabase.rpc("list_current_staking_products", {
    p_limit: 50,
  });

  if (response.error) {
    return { status: "unavailable" };
  }

  const products = normalizeProductRows(response.data ?? []);

  return products ? { status: "ready", products } : { status: "unavailable" };
}

function normalizeProductRows(
  rows: ProductRow[],
): CurrentStakingProduct[] | null {
  const products: CurrentStakingProduct[] = [];
  const seenProductIds = new Set<string>();

  for (const row of rows) {
    if (seenProductIds.has(row.staking_product_id)) {
      return null;
    }

    const product = normalizeProductRow(row);

    if (!product) {
      return null;
    }

    seenProductIds.add(product.stakingProductId);
    products.push(product);
  }

  return products;
}

function normalizeProductRow(row: ProductRow): CurrentStakingProduct | null {
  if (
    !isSafeText(row.product_code, 64) ||
    !isSafeText(row.display_name, 100) ||
    !isSafeText(row.project_code, 64) ||
    !isSafeText(row.project_display_name, 100) ||
    !isSafeText(row.asset_code, 64) ||
    !isSafeText(row.asset_symbol, 64) ||
    !isSafeDecimals(row.asset_decimals) ||
    !isPositiveInteger(row.lock_duration_days, 1, 3650) ||
    !isPositiveAtomicUnits(row.min_stake_units) ||
    (row.max_stake_units !== null &&
      !isPositiveAtomicUnits(row.max_stake_units)) ||
    !isPositiveInteger(row.term_reward_rate_ppm, 1, 1000000) ||
    row.reward_rounding_mode !== "FLOOR" ||
    !isEnrollmentState(row.enrollment_state) ||
    !isValidIsoDate(row.enrollment_starts_at) ||
    !isValidIsoDate(row.enrollment_ends_at) ||
    !isPositiveInteger(row.product_version, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }

  if (
    row.description !== null &&
    !isSafeText(row.description, 1000)
  ) {
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

function isSafeText(value: string, maxLength: number): boolean {
  return value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isPositiveInteger(
  value: number,
  min: number,
  max: number,
): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function isSafeDecimals(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 38;
}

function isEnrollmentState(value: string): value is "UPCOMING" | "OPEN" {
  return value === "UPCOMING" || value === "OPEN";
}

function isValidIsoDate(value: string): boolean {
  const time = Date.parse(value);

  return !Number.isNaN(time);
}
