import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import {
  validateAdminRoleReason,
  validateAuthUserId,
  validateCommandId,
} from "@/lib/auth/validation";
import {
  executeAdminRoleCommand,
  type AdminRoleCommandResultCode,
} from "@/server/admin/role-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/roles?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/roles?error=admin_role_invalid_input",
    );
  }

  const formData = await request.formData();
  const targetUserId = validateAuthUserId(formData.get("target_user_id"));
  const commandId = validateCommandId(formData.get("command_id"));
  const reason = validateAdminRoleReason(formData.get("reason"));

  if (!targetUserId || !commandId || !reason) {
    return redirectNoStore(
      request,
      "/admin/roles?error=admin_role_invalid_input",
    );
  }

  const execution = await executeAdminRoleCommand("grant", {
    targetUserId,
    commandId,
    reason,
  });

  if (!execution.ok) {
    return redirectNoStore(
      request,
      getErrorRedirectPath(execution.error),
    );
  }

  const query = getResultQuery("grant", execution.result);

  return redirectNoStore(request, `/admin/roles?${query}`);
}

function getResultQuery(
  action: "grant",
  result: {
    resultCode: AdminRoleCommandResultCode;
    replayed: boolean;
  },
): string {
  if (result.replayed) {
    return `${action}=replayed`;
  }

  switch (result.resultCode) {
    case "APPLIED":
      return `${action}=applied`;
    case "NOOP":
      return `${action}=noop`;
    case "INVALID_INPUT":
      return "error=admin_role_invalid_input";
    case "TARGET_NOT_FOUND":
      return "error=admin_role_target_not_found";
    case "TARGET_INACTIVE":
      return "error=admin_role_target_inactive";
    case "COMMAND_ID_CONFLICT":
      return "error=admin_role_command_conflict";
    case "SELF_REVOKE_FORBIDDEN":
      return "error=admin_role_self_revoke_forbidden";
  }
}

function getErrorRedirectPath(code: PublicAuthErrorCode): string {
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
      return `/admin/roles?error=${code}`;
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
