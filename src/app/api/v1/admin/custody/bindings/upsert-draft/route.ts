import { NextResponse, type NextRequest } from "next/server";

import {
  isBlankCustodyValue,
  normalizeCustodyCommandReason,
  normalizeCustodyDisplayLabel,
  validateCustodyAccountRole,
  validateCustodyBindingKey,
  validateCustodyCommandId,
  validateCustodyEntityId,
  validateCustodyExpectedVersion,
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
  const bindingId = isBlankCustodyValue(
    formData.get("custody_account_binding_id"),
  )
    ? null
    : validateCustodyEntityId(formData.get("custody_account_binding_id"));
  const expectedVersion = isBlankCustodyValue(
    formData.get("expected_version"),
  )
    ? null
    : validateCustodyExpectedVersion(formData.get("expected_version"));
  const custodyProviderId = validateCustodyEntityId(
    formData.get("custody_provider_id"),
  );
  const assetId = validateCustodyEntityId(formData.get("asset_id"));
  const bindingKey = validateCustodyBindingKey(
    formData.get("binding_key"),
  );
  const displayLabel = normalizeCustodyDisplayLabel(
    formData.get("display_label"),
  );
  const accountRole = validateCustodyAccountRole(
    formData.get("account_role"),
  );
  const commandId = validateCustodyCommandId(formData.get("command_id"));
  const reason = normalizeCustodyCommandReason(formData.get("reason"));

  if (
    (!bindingId &&
      !isBlankCustodyValue(formData.get("custody_account_binding_id"))) ||
    (bindingId && expectedVersion === null) ||
    (!bindingId && expectedVersion !== null) ||
    !custodyProviderId ||
    !assetId ||
    !bindingKey ||
    !displayLabel ||
    !accountRole ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(request, "/admin/custody?error=invalid_input");
  }

  const execution = await executeCustodyConfigAdminCommand({
    action: "upsert_binding_draft",
    custodyAccountBindingId: bindingId,
    expectedVersion,
    custodyProviderId,
    assetId,
    bindingKey,
    displayLabel,
    accountRole,
    commandId,
    reason,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(
    request,
    getBindingUpsertRedirectPath(execution.result, bindingId === null),
  );
}

function getBindingUpsertRedirectPath(
  result: { resultCode: string; replayed: boolean },
  created: boolean,
): string {
  if (result.replayed) {
    return "/admin/custody?result=custody_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return created
        ? "/admin/custody?result=custody_binding_created"
        : "/admin/custody?result=custody_binding_updated";
    case "NOOP":
      return "/admin/custody?result=custody_binding_update_noop";
    case "INVALID_INPUT":
      return "/admin/custody?error=invalid_input";
    case "CUSTODY_CONFIG_COMMAND_ID_CONFLICT":
      return "/admin/custody?error=custody_command_conflict";
    case "CUSTODY_PROVIDER_NOT_FOUND":
      return "/admin/custody?error=custody_provider_not_found";
    case "ASSET_NOT_FOUND":
      return "/admin/custody?error=custody_asset_not_found";
    case "CUSTODY_BINDING_NOT_FOUND":
      return "/admin/custody?error=custody_binding_not_found";
    case "CUSTODY_BINDING_VERSION_CONFLICT":
      return "/admin/custody?error=custody_binding_version_conflict";
    case "CUSTODY_BINDING_NOT_DRAFT":
      return "/admin/custody?error=custody_binding_not_draft";
    case "CUSTODY_BINDING_KEY_EXISTS":
      return "/admin/custody?error=custody_binding_key_exists";
    case "CUSTODY_BINDING_DUPLICATE_ACTIVE_ROLE":
      return "/admin/custody?error=custody_binding_duplicate_active_role";
    case "CUSTODY_BINDING_TERMS_IMMUTABLE":
      return "/admin/custody?error=custody_binding_terms_immutable";
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
