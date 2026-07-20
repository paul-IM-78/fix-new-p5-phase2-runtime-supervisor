import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { DomainPublicResultCode } from "@/lib/domain/public-results";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database, Json } from "@/types/database.types";

export type DomainAdminAction =
  | "create_project"
  | "update_project"
  | "transition_project"
  | "create_asset"
  | "update_asset"
  | "transition_asset"
  | "assign_project_token"
  | "retire_project_token";

export type DomainAdminCommandInput =
  | {
      action: "create_project";
      projectCode: string;
      displayName: string;
      description: string | null;
      commandId: string;
      reason: string;
    }
  | {
      action: "update_project";
      projectId: string;
      expectedVersion: number;
      displayName: string;
      description: string | null;
      commandId: string;
      reason: string;
    }
  | {
      action: "transition_project";
      projectId: string;
      expectedVersion: number;
      newStatus: string;
      commandId: string;
      reason: string;
    }
  | {
      action: "create_asset";
      assetCode: string;
      symbol: string;
      displayName: string;
      assetType: string;
      decimals: number;
      mintAddress: string | null;
      commandId: string;
      reason: string;
    }
  | {
      action: "update_asset";
      assetId: string;
      expectedVersion: number;
      symbol: string;
      displayName: string;
      commandId: string;
      reason: string;
    }
  | {
      action: "transition_asset";
      assetId: string;
      expectedVersion: number;
      newStatus: string;
      commandId: string;
      reason: string;
    }
  | {
      action: "assign_project_token";
      projectId: string;
      assetId: string;
      commandId: string;
      reason: string;
    }
  | {
      action: "retire_project_token";
      assignmentId: string;
      expectedVersion: number;
      commandId: string;
      reason: string;
    };

export type DomainCommandResult = {
  resultCode: string;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  projectId: string | null;
  assetId: string | null;
  assignmentId: string | null;
  entityVersion: number | null;
  occurredAt: string | null;
};

export type DomainCommandExecution =
  | { ok: true; result: DomainCommandResult }
  | { ok: false; error: DomainPublicResultCode | PublicAuthErrorCode };

type DomainCommandRow =
  Database["public"]["Functions"]["create_project"]["Returns"][number];

type ProjectRow =
  Database["public"]["Functions"]["list_admin_projects"]["Returns"][number];
type AssetRow =
  Database["public"]["Functions"]["list_admin_supported_assets"]["Returns"][number];
type AssignmentRow =
  Database["public"]["Functions"]["list_admin_project_token_assignments"]["Returns"][number];
type DomainAuditRow =
  Database["public"]["Functions"]["list_domain_admin_audit_events"]["Returns"][number];

export type AdminProject = {
  projectId: string;
  projectCode: string;
  displayName: string;
  description: string | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminSupportedAsset = {
  assetId: string;
  assetCode: string;
  symbol: string;
  displayName: string;
  network: string;
  assetType: string;
  decimals: number;
  mintAddress: string | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminProjectTokenAssignment = {
  assignmentId: string;
  projectId: string;
  projectCode: string;
  projectDisplayName: string;
  assetId: string;
  assetCode: string;
  assetSymbol: string;
  assignedAt: string;
  retiredAt: string | null;
  version: number;
};

export type DomainAuditEvent = {
  eventId: string;
  commandId: string;
  action: string;
  outcome: string;
  actorUserId: string;
  projectId: string | null;
  assetId: string | null;
  assignmentId: string | null;
  reason: string;
  beforeState: Json | null;
  afterState: Json | null;
  entityVersion: number | null;
  occurredAt: string;
};

export type AdminDomainCatalogResult =
  | {
      ok: true;
      projects: AdminProject[];
      assets: AdminSupportedAsset[];
      assignments: AdminProjectTokenAssignment[];
      auditEvents: DomainAuditEvent[];
    }
  | { ok: false; error: DomainPublicResultCode | PublicAuthErrorCode };

export async function executeDomainAdminCommand(
  input: DomainAdminCommandInput,
): Promise<DomainCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await callDomainCommand(input, supabase);

  if (response.error) {
    return { ok: false, error: mapRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;

  if (!row || typeof row.result_code !== "string") {
    return { ok: false, error: "domain_command_unavailable" };
  }

  return { ok: true, result: normalizeDomainCommandRow(row) };
}

export async function listAdminDomainCatalog(
  limit = 100,
): Promise<AdminDomainCatalogResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const [projects, assets, assignments, auditEvents] = await Promise.all([
    supabase.rpc("list_admin_projects", { p_limit: limit }),
    supabase.rpc("list_admin_supported_assets", { p_limit: limit }),
    supabase.rpc("list_admin_project_token_assignments", {
      p_limit: limit,
      p_include_retired: true,
    }),
    supabase.rpc("list_domain_admin_audit_events", { p_limit: 25 }),
  ]);

  if (projects.error || assets.error || assignments.error) {
    return { ok: false, error: "domain_command_unavailable" };
  }

  if (auditEvents.error) {
    return { ok: false, error: "domain_audit_unavailable" };
  }

  return {
    ok: true,
    projects: (projects.data ?? []).map(normalizeProjectRow),
    assets: (assets.data ?? []).map(normalizeAssetRow),
    assignments: (assignments.data ?? []).map(normalizeAssignmentRow),
    auditEvents: (auditEvents.data ?? []).map(normalizeAuditRow),
  };
}

async function callDomainCommand(
  input: DomainAdminCommandInput,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  switch (input.action) {
    case "create_project":
      return supabase.rpc("create_project", {
        p_project_code: input.projectCode,
        p_display_name: input.displayName,
        p_description: input.description ?? "",
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "update_project":
      return supabase.rpc("update_project_details", {
        p_project_id: input.projectId,
        p_expected_version: input.expectedVersion,
        p_display_name: input.displayName,
        p_description: input.description ?? "",
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "transition_project":
      return supabase.rpc("transition_project_status", {
        p_project_id: input.projectId,
        p_expected_version: input.expectedVersion,
        p_new_status: input.newStatus,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "create_asset":
      return supabase.rpc("create_supported_asset", {
        p_asset_code: input.assetCode,
        p_symbol: input.symbol,
        p_display_name: input.displayName,
        p_asset_type: input.assetType,
        p_decimals: input.decimals,
        p_mint_address: input.mintAddress ?? "",
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "update_asset":
      return supabase.rpc("update_supported_asset_details", {
        p_asset_id: input.assetId,
        p_expected_version: input.expectedVersion,
        p_symbol: input.symbol,
        p_display_name: input.displayName,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "transition_asset":
      return supabase.rpc("transition_supported_asset_status", {
        p_asset_id: input.assetId,
        p_expected_version: input.expectedVersion,
        p_new_status: input.newStatus,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "assign_project_token":
      return supabase.rpc("assign_project_token", {
        p_project_id: input.projectId,
        p_asset_id: input.assetId,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "retire_project_token":
      return supabase.rpc("retire_project_token", {
        p_assignment_id: input.assignmentId,
        p_expected_version: input.expectedVersion,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
  }
}

function normalizeDomainCommandRow(
  row: DomainCommandRow,
): DomainCommandResult {
  return {
    resultCode: row.result_code,
    replayed: row.replayed === true,
    eventId: row.event_id ?? null,
    commandId: row.command_id ?? null,
    projectId: row.project_id ?? null,
    assetId: row.asset_id ?? null,
    assignmentId: row.assignment_id ?? null,
    entityVersion: row.entity_version ?? null,
    occurredAt: row.occurred_at ?? null,
  };
}

function normalizeProjectRow(row: ProjectRow): AdminProject {
  return {
    projectId: row.project_id,
    projectCode: row.project_code,
    displayName: row.display_name,
    description: row.description ?? null,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAssetRow(row: AssetRow): AdminSupportedAsset {
  return {
    assetId: row.asset_id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    displayName: row.display_name,
    network: row.network,
    assetType: row.asset_type,
    decimals: row.decimals,
    mintAddress: row.mint_address ?? null,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAssignmentRow(
  row: AssignmentRow,
): AdminProjectTokenAssignment {
  return {
    assignmentId: row.assignment_id,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectDisplayName: row.project_display_name,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetSymbol: row.asset_symbol,
    assignedAt: row.assigned_at,
    retiredAt: row.retired_at ?? null,
    version: row.version,
  };
}

function normalizeAuditRow(row: DomainAuditRow): DomainAuditEvent {
  return {
    eventId: row.event_id,
    commandId: row.command_id,
    action: row.action,
    outcome: row.outcome,
    actorUserId: row.actor_user_id,
    projectId: row.project_id ?? null,
    assetId: row.asset_id ?? null,
    assignmentId: row.assignment_id ?? null,
    reason: row.reason,
    beforeState: row.before_state ?? null,
    afterState: row.after_state ?? null,
    entityVersion: row.entity_version ?? null,
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

function mapRpcError(error: { code?: string }): DomainPublicResultCode {
  return error.code === "42501"
    ? "domain_command_forbidden"
    : "domain_command_unavailable";
}
