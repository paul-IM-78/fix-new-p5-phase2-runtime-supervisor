import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type AssetRow = Database["public"]["Tables"]["supported_assets"]["Row"];
type AssignmentRow =
  Database["public"]["Tables"]["project_token_assignments"]["Row"];
type CatalogProjectRow = Pick<
  ProjectRow,
  "id" | "project_code" | "display_name" | "description" | "status"
>;
type CatalogAssetRow = Pick<
  AssetRow,
  | "id"
  | "asset_code"
  | "symbol"
  | "display_name"
  | "network"
  | "asset_type"
  | "decimals"
  | "mint_address"
  | "status"
>;
type CatalogAssignmentRow = Pick<
  AssignmentRow,
  "id" | "project_id" | "asset_id" | "assigned_at"
>;

export type CurrentCatalogProject = {
  projectId: string;
  projectCode: string;
  displayName: string;
  description: string | null;
  status: string;
};

export type CurrentCatalogAsset = {
  assetId: string;
  assetCode: string;
  symbol: string;
  displayName: string;
  network: string;
  assetType: string;
  decimals: number;
  mintAddress: string | null;
  status: string;
};

export type CurrentCatalogAssignment = {
  assignmentId: string;
  projectId: string;
  projectCode: string | null;
  assetId: string;
  assetCode: string | null;
  assetSymbol: string | null;
  assignedAt: string;
};

export type CurrentCatalogResult =
  | {
      status: "ready";
      projects: CurrentCatalogProject[];
      assets: CurrentCatalogAsset[];
      assignments: CurrentCatalogAssignment[];
    }
  | { status: "anonymous" }
  | { status: "inactive_profile" }
  | { status: "missing_profile" }
  | { status: "unavailable" };

export async function getCurrentCatalog(): Promise<CurrentCatalogResult> {
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

  const [projects, assets, assignments] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_code, display_name, description, status")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("supported_assets")
      .select(
        "id, asset_code, symbol, display_name, network, asset_type, decimals, mint_address, status",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("project_token_assignments")
      .select("id, project_id, asset_id, assigned_at")
      .order("assigned_at", { ascending: false })
      .limit(100),
  ]);

  if (projects.error || assets.error || assignments.error) {
    return { status: "unavailable" };
  }

  const projectRows = projects.data ?? [];
  const assetRows = assets.data ?? [];
  const projectById = new Map(
    projectRows.map((project) => [project.id, project]),
  );
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));

  return {
    status: "ready",
    projects: projectRows.map(normalizeProject),
    assets: assetRows.map(normalizeAsset),
    assignments: (assignments.data ?? []).map((assignment) =>
      normalizeAssignment(assignment, projectById, assetById),
    ),
  };
}

function normalizeProject(row: CatalogProjectRow): CurrentCatalogProject {
  return {
    projectId: row.id,
    projectCode: row.project_code,
    displayName: row.display_name,
    description: row.description ?? null,
    status: row.status,
  };
}

function normalizeAsset(row: CatalogAssetRow): CurrentCatalogAsset {
  return {
    assetId: row.id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    displayName: row.display_name,
    network: row.network,
    assetType: row.asset_type,
    decimals: row.decimals,
    mintAddress: row.mint_address ?? null,
    status: row.status,
  };
}

function normalizeAssignment(
  row: CatalogAssignmentRow,
  projectById: Map<string, CatalogProjectRow>,
  assetById: Map<string, CatalogAssetRow>,
): CurrentCatalogAssignment {
  const project = projectById.get(row.project_id);
  const asset = assetById.get(row.asset_id);

  return {
    assignmentId: row.id,
    projectId: row.project_id,
    projectCode: project?.project_code ?? null,
    assetId: row.asset_id,
    assetCode: asset?.asset_code ?? null,
    assetSymbol: asset?.symbol ?? null,
    assignedAt: row.assigned_at,
  };
}
