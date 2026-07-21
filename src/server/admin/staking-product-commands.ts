import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { StakingPublicResultCode } from "@/lib/staking/public-results";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

export type StakingProductAdminAction =
  | "create_product"
  | "update_draft"
  | "transition_status";

export type StakingProductAdminCommandInput =
  | {
      action: "create_product";
      projectId: string;
      assetId: string;
      productCode: string;
      displayName: string;
      description: string | null;
      lockDurationDays: number;
      minStakeUnits: string;
      maxStakeUnits: string | null;
      termRewardRatePpm: number;
      enrollmentStartsAt: string;
      enrollmentEndsAt: string;
      commandId: string;
      reason: string;
    }
  | {
      action: "update_draft";
      stakingProductId: string;
      expectedVersion: number;
      projectId: string;
      assetId: string;
      displayName: string;
      description: string | null;
      lockDurationDays: number;
      minStakeUnits: string;
      maxStakeUnits: string | null;
      termRewardRatePpm: number;
      enrollmentStartsAt: string;
      enrollmentEndsAt: string;
      commandId: string;
      reason: string;
    }
  | {
      action: "transition_status";
      stakingProductId: string;
      expectedVersion: number;
      newStatus: string;
      commandId: string;
      reason: string;
    };

export type StakingProductCommandResult = {
  resultCode: string;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  stakingProductId: string | null;
  projectId: string | null;
  assetId: string | null;
  entityVersion: number | null;
  occurredAt: string | null;
};

export type StakingProductCommandExecution =
  | { ok: true; result: StakingProductCommandResult }
  | { ok: false; error: StakingPublicResultCode | PublicAuthErrorCode };

type CommandRow =
  Database["public"]["Functions"]["create_staking_product"]["Returns"][number];
type AdminProductRow =
  Database["public"]["Functions"]["list_admin_staking_products"]["Returns"][number];
type StakingAuditRow =
  Database["public"]["Functions"]["list_staking_product_admin_audit_events"]["Returns"][number];

export type AdminStakingProduct = {
  stakingProductId: string;
  productCode: string;
  displayName: string;
  description: string | null;
  projectId: string;
  projectCode: string;
  projectDisplayName: string;
  projectStatus: string;
  assetId: string;
  assetCode: string;
  assetSymbol: string;
  assetDecimals: number;
  assetStatus: string;
  assetNetwork: string;
  assetType: string;
  lockDurationDays: number;
  minStakeUnits: string;
  maxStakeUnits: string | null;
  termRewardRatePpm: number;
  rewardRoundingMode: string;
  enrollmentStartsAt: string;
  enrollmentEndsAt: string;
  enrollmentState: string;
  status: string;
  version: number;
  activatedAt: string | null;
  suspendedAt: string | null;
  archivedAt: string | null;
  currentProjectToken: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StakingProductAuditEvent = {
  eventId: string;
  commandId: string;
  action: string;
  outcome: string;
  actorUserId: string;
  stakingProductId: string;
  projectId: string;
  assetId: string;
  reason: string;
  previousStatus: string | null;
  resultingStatus: string;
  entityVersion: number;
  occurredAt: string;
};

export type AdminStakingProductCatalogResult =
  | {
      ok: true;
      products: AdminStakingProduct[];
      auditEvents: StakingProductAuditEvent[];
    }
  | { ok: false; error: StakingPublicResultCode | PublicAuthErrorCode };

export async function executeStakingProductAdminCommand(
  input: StakingProductAdminCommandInput,
): Promise<StakingProductCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await callStakingProductCommand(input, supabase);

  if (response.error) {
    return { ok: false, error: mapRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;

  return row
    ? { ok: true, result: normalizeCommandRow(row) }
    : { ok: false, error: "staking_command_unavailable" };
}

export async function listAdminStakingProductCatalog(): Promise<AdminStakingProductCatalogResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const [products, auditEvents] = await Promise.all([
    supabase.rpc("list_admin_staking_products", { p_limit: 100 }),
    supabase.rpc("list_staking_product_admin_audit_events", {
      p_limit: 25,
    }),
  ]);

  if (products.error) {
    return { ok: false, error: "staking_command_unavailable" };
  }

  if (auditEvents.error) {
    return { ok: false, error: "staking_audit_unavailable" };
  }

  return {
    ok: true,
    products: (products.data ?? []).map(normalizeAdminProductRow),
    auditEvents: (auditEvents.data ?? []).map(normalizeAuditRow),
  };
}

async function callStakingProductCommand(
  input: StakingProductAdminCommandInput,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  switch (input.action) {
    case "create_product":
      return supabase.rpc("create_staking_product", {
        p_project_id: input.projectId,
        p_asset_id: input.assetId,
        p_product_code: input.productCode,
        p_display_name: input.displayName,
        p_description: input.description ?? "",
        p_lock_duration_days: input.lockDurationDays,
        p_min_stake_units: input.minStakeUnits,
        p_max_stake_units: input.maxStakeUnits ?? "",
        p_term_reward_rate_ppm: input.termRewardRatePpm,
        p_enrollment_starts_at: input.enrollmentStartsAt,
        p_enrollment_ends_at: input.enrollmentEndsAt,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "update_draft":
      return supabase.rpc("update_staking_product_draft", {
        p_staking_product_id: input.stakingProductId,
        p_expected_version: input.expectedVersion,
        p_project_id: input.projectId,
        p_asset_id: input.assetId,
        p_display_name: input.displayName,
        p_description: input.description ?? "",
        p_lock_duration_days: input.lockDurationDays,
        p_min_stake_units: input.minStakeUnits,
        p_max_stake_units: input.maxStakeUnits ?? "",
        p_term_reward_rate_ppm: input.termRewardRatePpm,
        p_enrollment_starts_at: input.enrollmentStartsAt,
        p_enrollment_ends_at: input.enrollmentEndsAt,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "transition_status":
      return supabase.rpc("transition_staking_product_status", {
        p_staking_product_id: input.stakingProductId,
        p_expected_version: input.expectedVersion,
        p_new_status: input.newStatus,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
  }
}

function normalizeCommandRow(row: CommandRow): StakingProductCommandResult {
  return {
    resultCode: row.result_code,
    replayed: row.replayed === true,
    eventId: row.event_id ?? null,
    commandId: row.command_id ?? null,
    stakingProductId: row.staking_product_id ?? null,
    projectId: row.project_id ?? null,
    assetId: row.asset_id ?? null,
    entityVersion: row.entity_version ?? null,
    occurredAt: row.occurred_at ?? null,
  };
}

function normalizeAdminProductRow(
  row: AdminProductRow,
): AdminStakingProduct {
  return {
    stakingProductId: row.staking_product_id,
    productCode: row.product_code,
    displayName: row.display_name,
    description: row.description ?? null,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectDisplayName: row.project_display_name,
    projectStatus: row.project_status,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetSymbol: row.asset_symbol,
    assetDecimals: row.asset_decimals,
    assetStatus: row.asset_status,
    assetNetwork: row.asset_network,
    assetType: row.asset_type,
    lockDurationDays: row.lock_duration_days,
    minStakeUnits: row.min_stake_units,
    maxStakeUnits: row.max_stake_units ?? null,
    termRewardRatePpm: row.term_reward_rate_ppm,
    rewardRoundingMode: row.reward_rounding_mode,
    enrollmentStartsAt: row.enrollment_starts_at,
    enrollmentEndsAt: row.enrollment_ends_at,
    enrollmentState: row.enrollment_state,
    status: row.status,
    version: row.version,
    activatedAt: row.activated_at ?? null,
    suspendedAt: row.suspended_at ?? null,
    archivedAt: row.archived_at ?? null,
    currentProjectToken: row.current_project_token === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAuditRow(row: StakingAuditRow): StakingProductAuditEvent {
  return {
    eventId: row.event_id,
    commandId: row.command_id,
    action: row.action,
    outcome: row.outcome,
    actorUserId: row.actor_user_id,
    stakingProductId: row.staking_product_id,
    projectId: row.project_id,
    assetId: row.asset_id,
    reason: row.reason,
    previousStatus: row.previous_status ?? null,
    resultingStatus: row.resulting_status,
    entityVersion: row.entity_version,
    occurredAt: row.occurred_at,
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

function mapRpcError(error: { code?: string }): StakingPublicResultCode {
  return error.code === "42501"
    ? "staking_command_forbidden"
    : "staking_command_unavailable";
}
