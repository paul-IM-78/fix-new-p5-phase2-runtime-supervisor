import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type AssetRow = Database["public"]["Tables"]["supported_assets"]["Row"];
type AssignmentRow =
  Database["public"]["Tables"]["project_token_assignments"]["Row"];
type WalletRow = Database["public"]["Tables"]["wallet_accounts"]["Row"];

type DashboardProjectRow = Pick<
  ProjectRow,
  "id" | "project_code" | "display_name" | "description" | "status" | "version"
>;
type DashboardAssetRow = Pick<
  AssetRow,
  | "id"
  | "asset_code"
  | "symbol"
  | "display_name"
  | "asset_type"
  | "decimals"
  | "mint_address"
  | "status"
  | "version"
>;
type DashboardAssignmentRow = Pick<
  AssignmentRow,
  "id" | "project_id" | "asset_id" | "assigned_at" | "retired_at" | "version"
>;
type DashboardWalletRow = Pick<
  WalletRow,
  | "id"
  | "user_id"
  | "custody_model"
  | "status"
  | "closed_at"
  | "version"
  | "created_at"
  | "updated_at"
>;

export type CurrentDashboardResult =
  | { status: "anonymous" }
  | { status: "inactive_profile" }
  | { status: "missing_wallet" }
  | { status: "unavailable" }
  | {
      status: "ready";
      profile: {
        displayName: string | null;
        accountStatus: "ACTIVE";
        version: number;
      };
      wallet: {
        custodyModel: "MANAGED";
        accountStatus: "ACTIVE" | "FROZEN" | "CLOSED";
        closedAt: string | null;
        version: number;
        createdAt: string;
        updatedAt: string;
      };
      catalog: {
        projects: CurrentDashboardProject[];
        assets: CurrentDashboardAsset[];
        assignments: CurrentDashboardAssignment[];
      };
    };

export type CurrentDashboardProject = {
  id: string;
  projectCode: string;
  displayName: string;
  description: string | null;
  version: number;
};

export type CurrentDashboardAsset = {
  id: string;
  assetCode: string;
  symbol: string;
  displayName: string;
  assetType: "NATIVE" | "SPL_TOKEN";
  decimals: number;
  mintAddress: string | null;
  version: number;
};

export type CurrentDashboardWallet = {
  custodyModel: "MANAGED";
  accountStatus: "ACTIVE" | "FROZEN" | "CLOSED";
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CurrentDashboardAssignment = {
  id: string;
  projectId: string;
  assetId: string;
  assignedAt: string;
  version: number;
};

export async function getCurrentDashboard(): Promise<CurrentDashboardResult> {
  const supabase = await createServerSupabaseClient();

  return inspectCurrentDashboard(supabase);
}

export async function inspectCurrentDashboard(
  supabase: SupabaseClient<Database>,
): Promise<CurrentDashboardResult> {
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

  const [wallets, projects, assets, assignments] = await Promise.all([
    supabase
      .from("wallet_accounts")
      .select(
        "id, user_id, custody_model, status, closed_at, version, created_at, updated_at",
      )
      .eq("user_id", access.userId)
      .order("created_at", { ascending: false })
      .limit(2),
    supabase
      .from("projects")
      .select("id, project_code, display_name, description, status, version")
      .order("created_at", { ascending: false })
      .limit(2),
    supabase
      .from("supported_assets")
      .select(
        "id, asset_code, symbol, display_name, asset_type, decimals, mint_address, status, version",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("project_token_assignments")
      .select("id, project_id, asset_id, assigned_at, retired_at, version")
      .order("assigned_at", { ascending: false })
      .limit(100),
  ]);

  if (wallets.error || projects.error || assets.error || assignments.error) {
    return { status: "unavailable" };
  }

  const walletRows = wallets.data ?? [];

  if (walletRows.length === 0) {
    return { status: "missing_wallet" };
  }

  if (walletRows.length !== 1) {
    return { status: "unavailable" };
  }

  const projectRows = projects.data ?? [];
  const assetRows = assets.data ?? [];
  const assignmentRows = assignments.data ?? [];

  if (
    projectRows.length > 1 ||
    projectRows.some((project) => project.status !== "ACTIVE") ||
    assetRows.some((asset) => asset.status !== "ACTIVE") ||
    assetRows.some((asset) => !isAssetType(asset.asset_type)) ||
    assignmentRows.some((assignment) => assignment.retired_at !== null)
  ) {
    return { status: "unavailable" };
  }

  const projectById = new Map(
    projectRows.map((project) => [project.id, project]),
  );
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));

  if (
    assignmentRows.some(
      (assignment) =>
        !projectById.has(assignment.project_id) ||
        !assetById.has(assignment.asset_id),
    )
  ) {
    return { status: "unavailable" };
  }

  const wallet = normalizeWallet(walletRows[0]);

  if (!wallet) {
    return { status: "unavailable" };
  }

  return {
    status: "ready",
    profile: {
      displayName: access.profile.displayName,
      accountStatus: access.profile.accountStatus,
      version: access.profile.version,
    },
    wallet,
    catalog: {
      projects: projectRows.map(normalizeProject),
      assets: assetRows.map(normalizeAsset),
      assignments: assignmentRows.map(normalizeAssignment),
    },
  };
}

function normalizeWallet(row: DashboardWalletRow): CurrentDashboardWallet | null {
  if (
    row.user_id.length === 0 ||
    row.custody_model !== "MANAGED" ||
    !isWalletAccountStatus(row.status)
  ) {
    return null;
  }

  return {
    custodyModel: row.custody_model,
    accountStatus: row.status,
    closedAt: row.closed_at ?? null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeProject(row: DashboardProjectRow): CurrentDashboardProject {
  return {
    id: row.id,
    projectCode: row.project_code,
    displayName: row.display_name,
    description: row.description ?? null,
    version: row.version,
  };
}

function normalizeAsset(row: DashboardAssetRow): CurrentDashboardAsset {
  if (!isAssetType(row.asset_type)) {
    throw new Error("Unexpected asset type");
  }

  return {
    id: row.id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    displayName: row.display_name,
    assetType: row.asset_type,
    decimals: row.decimals,
    mintAddress: row.mint_address ?? null,
    version: row.version,
  };
}

function normalizeAssignment(
  row: DashboardAssignmentRow,
): CurrentDashboardAssignment {
  return {
    id: row.id,
    projectId: row.project_id,
    assetId: row.asset_id,
    assignedAt: row.assigned_at,
    version: row.version,
  };
}

function isWalletAccountStatus(
  value: string,
): value is "ACTIVE" | "FROZEN" | "CLOSED" {
  return value === "ACTIVE" || value === "FROZEN" || value === "CLOSED";
}

function isAssetType(value: string): value is "NATIVE" | "SPL_TOKEN" {
  return value === "NATIVE" || value === "SPL_TOKEN";
}
