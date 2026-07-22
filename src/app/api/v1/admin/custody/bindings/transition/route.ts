import { NextResponse, type NextRequest } from "next/server";

import {
  normalizeCustodyCommandReason,
  validateCustodyCommandId,
  validateCustodyEntityId,
  validateCustodyExpectedVersion,
  validateCustodyStatus,
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
  const custodyAccountBindingId = validateCustodyEntityId(
    formData.get("custody_account_binding_id"),
  );
  const expectedVersion = validateCustodyExpectedVersion(
    formData.get("expected_version"),
  );
  const newStatus = validateCustodyStatus(formData.get("new_status"));
  const commandId = validateCustodyCommandId(formData.get("command_id"));
  const reason = normalizeCustodyCommandReason(formData.get("reason"));

  if (
    !custodyAccountBindingId ||
    expectedVersion === null ||
    !newStatus ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(request, "/admin/custody?error=invalid_input");
  }

  const execution = await executeCustodyConfigAdminCommand({
    action: "transition_binding_status",
    custodyAccountBindingId,
    expectedVersion,
    newStatus,
    commandId,
    reason,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(
    request,
    getBindingTransitionRedirectPath(execution.result),
  );
}

function getBindingTransitionRedirectPath(result: {
  resultCode: string;
  replayed: boolean;
}): string {
  if (result.replayed) {
    return "/admin/custody?result=custody_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/custody?result=custody_binding_status_changed";
    case "NOOP":
      return "/admin/custody?result=custody_binding_status_noop";
    case "INVALID_INPUT":
      return "/admin/custody?error=invalid_input";
    case "CUSTODY_CONFIG_COMMAND_ID_CONFLICT":
      return "/admin/custody?error=custody_command_conflict";
    case "CUSTODY_BINDING_NOT_FOUND":
      return "/admin/custody?error=custody_binding_not_found";
    case "CUSTODY_BINDING_VERSION_CONFLICT":
      return "/admin/custody?error=custody_binding_version_conflict";
    case "CUSTODY_BINDING_PROVIDER_NOT_APPROVED":
      return "/admin/custody?error=custody_binding_provider_not_approved";
    case "CUSTODY_BINDING_ASSET_NOT_READY":
      return "/admin/custody?error=custody_binding_asset_not_ready";
    case "CUSTODY_BINDING_TRANSITION_INVALID":
      return "/admin/custody?error=custody_binding_transition_invalid";
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
