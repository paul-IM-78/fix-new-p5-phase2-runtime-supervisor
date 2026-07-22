import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { CustodyPublicResultCode } from "@/lib/custody/public-results";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

type ProviderRow =
  Database["public"]["Functions"]["list_admin_custody_providers"]["Returns"][number];
type BindingRow =
  Database["public"]["Functions"]["list_admin_custody_account_bindings"]["Returns"][number];
type AuditRow =
  Database["public"]["Functions"]["list_custody_config_audit_events"]["Returns"][number];

export type AdminCustodyProvider = {
  custodyProviderId: string;
  providerCode: string;
  displayName: string;
  providerType: string;
  supportsBalanceObservation: boolean;
  supportsTransferObservation: boolean;
  supportsTransferLookup: boolean;
  supportsPayoutSubmission: boolean;
  supportsWebhookIngestion: boolean;
  status: string;
  approvedAt: string | null;
  suspendedAt: string | null;
  retiredAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminCustodyAccountBinding = {
  custodyAccountBindingId: string;
  custodyProviderId: string;
  providerCode: string;
  assetId: string;
  assetCode: string;
  assetSymbol: string;
  assetType: string;
  assetStatus: string;
  bindingKey: string;
  displayLabel: string;
  accountRole: string;
  status: string;
  approvedAt: string | null;
  suspendedAt: string | null;
  retiredAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CustodyConfigAuditEvent = {
  eventId: string;
  commandId: string;
  action: string;
  outcome: string;
  entityType: string;
  actorUserId: string;
  custodyProviderId: string;
  custodyAccountBindingId: string | null;
  assetId: string | null;
  reason: string;
  previousStatus: string | null;
  resultingStatus: string;
  entityVersion: number;
  occurredAt: string;
};

export type AdminCustodyConfigCatalogResult =
  | {
      ok: true;
      providers: AdminCustodyProvider[];
      bindings: AdminCustodyAccountBinding[];
      auditEvents: CustodyConfigAuditEvent[];
    }
  | { ok: false; error: CustodyPublicResultCode | PublicAuthErrorCode };

export async function listAdminCustodyConfigCatalog(): Promise<AdminCustodyConfigCatalogResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const [providers, bindings, auditEvents] = await Promise.all([
    supabase.rpc("list_admin_custody_providers", { p_limit: 100 }),
    supabase.rpc("list_admin_custody_account_bindings", { p_limit: 100 }),
    supabase.rpc("list_custody_config_audit_events", { p_limit: 25 }),
  ]);

  if (providers.error || bindings.error) {
    return { ok: false, error: "custody_command_unavailable" };
  }

  if (auditEvents.error) {
    return { ok: false, error: "custody_audit_unavailable" };
  }

  return {
    ok: true,
    providers: (providers.data ?? []).map(normalizeProviderRow),
    bindings: (bindings.data ?? []).map(normalizeBindingRow),
    auditEvents: (auditEvents.data ?? []).map(normalizeAuditRow),
  };
}

function normalizeProviderRow(row: ProviderRow): AdminCustodyProvider {
  return {
    custodyProviderId: row.custody_provider_id,
    providerCode: row.provider_code,
    displayName: row.display_name,
    providerType: row.provider_type,
    supportsBalanceObservation: row.supports_balance_observation === true,
    supportsTransferObservation: row.supports_transfer_observation === true,
    supportsTransferLookup: row.supports_transfer_lookup === true,
    supportsPayoutSubmission: row.supports_payout_submission === true,
    supportsWebhookIngestion: row.supports_webhook_ingestion === true,
    status: row.status,
    approvedAt: row.approved_at ?? null,
    suspendedAt: row.suspended_at ?? null,
    retiredAt: row.retired_at ?? null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeBindingRow(row: BindingRow): AdminCustodyAccountBinding {
  return {
    custodyAccountBindingId: row.custody_account_binding_id,
    custodyProviderId: row.custody_provider_id,
    providerCode: row.provider_code,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetSymbol: row.asset_symbol,
    assetType: row.asset_type,
    assetStatus: row.asset_status,
    bindingKey: row.binding_key,
    displayLabel: row.display_label,
    accountRole: row.account_role,
    status: row.status,
    approvedAt: row.approved_at ?? null,
    suspendedAt: row.suspended_at ?? null,
    retiredAt: row.retired_at ?? null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeAuditRow(row: AuditRow): CustodyConfigAuditEvent {
  return {
    eventId: row.event_id,
    commandId: row.command_id,
    action: row.action,
    outcome: row.outcome,
    entityType: row.entity_type,
    actorUserId: row.actor_user_id,
    custodyProviderId: row.custody_provider_id,
    custodyAccountBindingId: row.custody_account_binding_id ?? null,
    assetId: row.asset_id ?? null,
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
