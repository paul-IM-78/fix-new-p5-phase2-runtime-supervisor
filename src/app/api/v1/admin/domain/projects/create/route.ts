import { NextResponse, type NextRequest } from "next/server";

import {
  normalizeDomainCommandReason,
  normalizeProjectDescription,
  normalizeProjectDisplayName,
  validateDomainCommandId,
  validateProjectCode,
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
  const projectCode = validateProjectCode(formData.get("project_code"));
  const displayName = normalizeProjectDisplayName(
    formData.get("display_name"),
  );
  const description = normalizeProjectDescription(
    formData.get("description"),
  );
  const commandId = validateDomainCommandId(formData.get("command_id"));
  const reason = normalizeDomainCommandReason(formData.get("reason"));

  if (!projectCode || !displayName || !commandId || !reason) {
    return redirectNoStore(request, "/admin/catalog?error=invalid_input");
  }

  const execution = await executeDomainAdminCommand({
    action: "create_project",
    projectCode,
    displayName,
    description,
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
    getProjectCreateRedirectPath(execution.result),
  );
}

function getProjectCreateRedirectPath(result: {
  resultCode: string;
  replayed: boolean;
}): string {
  if (result.replayed) {
    return "/admin/catalog?result=domain_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/catalog?result=project_created";
    case "INVALID_INPUT":
      return "/admin/catalog?error=invalid_input";
    case "COMMAND_ID_CONFLICT":
      return "/admin/catalog?error=domain_command_conflict";
    case "PROJECT_CODE_EXISTS":
      return "/admin/catalog?error=project_code_exists";
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
