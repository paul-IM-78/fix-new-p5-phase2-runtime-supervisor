import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { CustodyPublicResultCode } from "@/lib/custody/public-results";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

export type CustodyConfigAdminCommandInput =
  | {
      action: "upsert_provider_draft";
      custodyProviderId: string | null;
      expectedVersion: number | null;
      providerCode: string;
      displayName: string;
      providerType: string;
      supportsBalanceObservation: boolean;
      supportsTransferObservation: boolean;
      supportsTransferLookup: boolean;
      supportsPayoutSubmission: boolean;
      supportsWebhookIngestion: boolean;
      commandId: string;
      reason: string;
    }
  | {
      action: "transition_provider_status";
      custodyProviderId: string;
      expectedVersion: number;
      newStatus: string;
      commandId: string;
      reason: string;
    }
  | {
      action: "upsert_binding_draft";
      custodyAccountBindingId: string | null;
      expectedVersion: number | null;
      custodyProviderId: string;
      assetId: string;
      bindingKey: string;
      displayLabel: string;
      accountRole: string;
      commandId: string;
      reason: string;
    }
  | {
      action: "transition_binding_status";
      custodyAccountBindingId: string;
      expectedVersion: number;
      newStatus: string;
      commandId: string;
      reason: string;
    };

export type CustodyConfigCommandResult = {
  resultCode: string;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  custodyProviderId: string | null;
  custodyAccountBindingId: string | null;
  assetId: string | null;
  entityVersion: number | null;
  occurredAt: string | null;
};

export type CustodyConfigCommandExecution =
  | { ok: true; result: CustodyConfigCommandResult }
  | { ok: false; error: CustodyPublicResultCode | PublicAuthErrorCode };

type CommandRow =
  Database["public"]["Functions"]["upsert_custody_provider_draft"]["Returns"][number];

export async function executeCustodyConfigAdminCommand(
  input: CustodyConfigAdminCommandInput,
): Promise<CustodyConfigCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await callCustodyConfigCommand(input, supabase);

  if (response.error) {
    return { ok: false, error: mapRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;

  return row
    ? { ok: true, result: normalizeCommandRow(row) }
    : { ok: false, error: "custody_command_unavailable" };
}

async function callCustodyConfigCommand(
  input: CustodyConfigAdminCommandInput,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
) {
  switch (input.action) {
    case "upsert_provider_draft":
      return supabase.rpc("upsert_custody_provider_draft", {
        p_custody_provider_id: input.custodyProviderId ?? undefined,
        p_expected_version: input.expectedVersion ?? undefined,
        p_provider_code: input.providerCode,
        p_display_name: input.displayName,
        p_provider_type: input.providerType,
        p_supports_balance_observation: input.supportsBalanceObservation,
        p_supports_transfer_observation: input.supportsTransferObservation,
        p_supports_transfer_lookup: input.supportsTransferLookup,
        p_supports_payout_submission: input.supportsPayoutSubmission,
        p_supports_webhook_ingestion: input.supportsWebhookIngestion,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "transition_provider_status":
      return supabase.rpc("transition_custody_provider_status", {
        p_custody_provider_id: input.custodyProviderId,
        p_expected_version: input.expectedVersion,
        p_new_status: input.newStatus,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "upsert_binding_draft":
      return supabase.rpc("upsert_custody_account_binding_draft", {
        p_custody_account_binding_id:
          input.custodyAccountBindingId ?? undefined,
        p_expected_version: input.expectedVersion ?? undefined,
        p_custody_provider_id: input.custodyProviderId,
        p_asset_id: input.assetId,
        p_binding_key: input.bindingKey,
        p_display_label: input.displayLabel,
        p_account_role: input.accountRole,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
    case "transition_binding_status":
      return supabase.rpc("transition_custody_account_binding_status", {
        p_custody_account_binding_id: input.custodyAccountBindingId,
        p_expected_version: input.expectedVersion,
        p_new_status: input.newStatus,
        p_command_id: input.commandId,
        p_reason: input.reason,
      });
  }
}

function normalizeCommandRow(row: CommandRow): CustodyConfigCommandResult {
  return {
    resultCode: row.result_code,
    replayed: row.replayed === true,
    eventId: row.event_id ?? null,
    commandId: row.command_id ?? null,
    custodyProviderId: row.custody_provider_id ?? null,
    custodyAccountBindingId: row.custody_account_binding_id ?? null,
    assetId: row.asset_id ?? null,
    entityVersion: row.entity_version ?? null,
    occurredAt: row.occurred_at ?? null,
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

function mapRpcError(error: { code?: string }): CustodyPublicResultCode {
  return error.code === "42501"
    ? "custody_command_forbidden"
    : "custody_command_unavailable";
}
