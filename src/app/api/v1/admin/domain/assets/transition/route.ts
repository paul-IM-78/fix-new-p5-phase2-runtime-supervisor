import { NextResponse, type NextRequest } from "next/server";

import {
  normalizeDomainCommandReason,
  validateAssetStatus,
  validateDomainCommandId,
  validateDomainEntityId,
  validateExpectedVersion,
} from "@/lib/domain/validation";
import { executeDomainAdminCommand } from "@/server/admin/domain-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/admin/catalog?error=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/admin/catalog?error=invalid_input");
  }

  const formData = await request.formData();
  const assetId = validateDomainEntityId(formData.get("asset_id"));
  const expectedVersion = validateExpectedVersion(
    formData.get("expected_version"),
  );
  const newStatus = validateAssetStatus(formData.get("new_status"));
  const commandId = validateDomainCommandId(formData.get("command_id"));
  const reason = normalizeDomainCommandReason(formData.get("reason"));

  if (
    !assetId ||
    expectedVersion === null ||
    !newStatus ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(request, "/admin/catalog?error=invalid_input");
  }

  const execution = await executeDomainAdminCommand({
    action: "transition_asset",
    assetId,
    expectedVersion,
    newStatus,
    commandId,
    reason,
  });

  if (!execution.ok) {
    return redirectNoStore(
      request,
      getErrorRedirectPath(execution.error),
    );
  }

  return redirectNoStore(
    request,
    getAssetTransitionRedirectPath(execution.result),
  );
}

function getAssetTransitionRedirectPath(result: {
  resultCode: string;
  replayed: boolean;
}): string {
  if (result.replayed) {
    return "/admin/catalog?result=domain_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/catalog?result=asset_status_changed";
    case "NOOP":
      return "/admin/catalog?result=asset_status_noop";
    case "INVALID_INPUT":
      return "/admin/catalog?error=invalid_input";
    case "COMMAND_ID_CONFLICT":
      return "/admin/catalog?error=domain_command_conflict";
    case "ASSET_NOT_FOUND":
      return "/admin/catalog?error=asset_not_found";
    case "ASSET_VERSION_CONFLICT":
      return "/admin/catalog?error=asset_version_conflict";
    case "ASSET_TRANSITION_INVALID":
      return "/admin/catalog?error=asset_transition_invalid";
    case "ASSET_IN_USE_BY_ACTIVE_PROJECT":
      return "/admin/catalog?error=asset_in_use";
    case "ASSET_HAS_CURRENT_ASSIGNMENT":
      return "/admin/catalog?error=asset_has_current_assignment";
    default:
      return "/admin/catalog?error=domain_command_unavailable";
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
      return `/admin/catalog?error=${code}`;
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

function redirectNoStore(
  request: NextRequest,
  path: string,
): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), {
    status: 303,
  });

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");

  return response;
}
