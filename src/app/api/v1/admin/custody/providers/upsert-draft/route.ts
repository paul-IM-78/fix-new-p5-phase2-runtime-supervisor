import { NextResponse, type NextRequest } from "next/server";

import {
  isBlankCustodyValue,
  normalizeCustodyCommandReason,
  normalizeCustodyDisplayName,
  parseCustodyBoolean,
  validateCustodyCommandId,
  validateCustodyEntityId,
  validateCustodyExpectedVersion,
  validateCustodyProviderCode,
  validateCustodyProviderType,
} from "@/lib/custody/validation";
import { executeCustodyConfigAdminCommand } from "@/server/admin/custody-config-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/admin/custody?error=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/admin/custody?error=invalid_input");
  }

  const formData = await request.formData();
  const providerId = isBlankCustodyValue(formData.get("custody_provider_id"))
    ? null
    : validateCustodyEntityId(formData.get("custody_provider_id"));
  const expectedVersion = isBlankCustodyValue(
    formData.get("expected_version"),
  )
    ? null
    : validateCustodyExpectedVersion(formData.get("expected_version"));
  const providerCode = validateCustodyProviderCode(
    formData.get("provider_code"),
  );
  const displayName = normalizeCustodyDisplayName(
    formData.get("display_name"),
  );
  const providerType = validateCustodyProviderType(
    formData.get("provider_type"),
  );
  const commandId = validateCustodyCommandId(formData.get("command_id"));
  const reason = normalizeCustodyCommandReason(formData.get("reason"));

  if (
    (!providerId && !isBlankCustodyValue(formData.get("custody_provider_id"))) ||
    (providerId && expectedVersion === null) ||
    (!providerId && expectedVersion !== null) ||
    !providerCode ||
    !displayName ||
    !providerType ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(request, "/admin/custody?error=invalid_input");
  }

  const execution = await executeCustodyConfigAdminCommand({
    action: "upsert_provider_draft",
    custodyProviderId: providerId,
    expectedVersion,
    providerCode,
    displayName,
    providerType,
    supportsBalanceObservation: parseCustodyBoolean(
      formData.get("supports_balance_observation"),
    ),
    supportsTransferObservation: parseCustodyBoolean(
      formData.get("supports_transfer_observation"),
    ),
    supportsTransferLookup: parseCustodyBoolean(
      formData.get("supports_transfer_lookup"),
    ),
    supportsPayoutSubmission: parseCustodyBoolean(
      formData.get("supports_payout_submission"),
    ),
    supportsWebhookIngestion: parseCustodyBoolean(
      formData.get("supports_webhook_ingestion"),
    ),
    commandId,
    reason,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(
    request,
    getProviderUpsertRedirectPath(execution.result, providerId === null),
  );
}

function getProviderUpsertRedirectPath(
  result: { resultCode: string; replayed: boolean },
  created: boolean,
): string {
  if (result.replayed) {
    return "/admin/custody?result=custody_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return created
        ? "/admin/custody?result=custody_provider_created"
        : "/admin/custody?result=custody_provider_updated";
    case "NOOP":
      return "/admin/custody?result=custody_provider_update_noop";
    case "INVALID_INPUT":
      return "/admin/custody?error=invalid_input";
    case "CUSTODY_CONFIG_COMMAND_ID_CONFLICT":
      return "/admin/custody?error=custody_command_conflict";
    case "CUSTODY_PROVIDER_CODE_EXISTS":
      return "/admin/custody?error=custody_provider_code_exists";
    case "CUSTODY_PROVIDER_NOT_FOUND":
      return "/admin/custody?error=custody_provider_not_found";
    case "CUSTODY_PROVIDER_VERSION_CONFLICT":
      return "/admin/custody?error=custody_provider_version_conflict";
    case "CUSTODY_PROVIDER_NOT_DRAFT":
      return "/admin/custody?error=custody_provider_not_draft";
    case "CUSTODY_PROVIDER_TERMS_IMMUTABLE":
      return "/admin/custody?error=custody_provider_terms_immutable";
    default:
      return "/admin/custody?error=custody_command_unavailable";
  }
}

function getErrorRedirectPath(code: string): string {
  switch (code) {
    case "invalid_credentials":
      return "/auth/sign-in?next=/admin";
    case "account_restricted":
      return "/auth/account-unavailable";
    case "mfa_enrollment_required":
      return "/auth/mfa/enroll";
    case "mfa_challenge_required":
      return "/auth/mfa/challenge";
    case "account_unavailable":
    case "admin_forbidden":
    case "auth_unavailable":
    case "mfa_unavailable":
      return `/auth/error?code=${code}`;
    default:
      return `/admin/custody?error=${code}`;
  }
}

function isSupportedFormRequest(request: NextRequest): boolean {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  return (
    contentType === "application/x-www-form-urlencoded" ||
    contentType === "multipart/form-data"
  );
}

function redirectNoStore(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), {
    status: 303,
  });

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");

  return response;
}
