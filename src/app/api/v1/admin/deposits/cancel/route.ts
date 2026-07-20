import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { DepositPublicResultCode } from "@/lib/deposit/public-results";
import {
  normalizeDepositReason,
  validateDepositCommandId,
  validateDepositExpectedVersion,
  validateDepositRequestId,
} from "@/lib/deposit/validation";
import {
  adminCancelDepositRequest,
  type AdminDepositCommandResult,
} from "@/server/admin/deposit-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/deposits?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/admin/deposits?error=invalid_input");
  }

  const formData = await request.formData();
  const depositRequestId = validateDepositRequestId(
    formData.get("deposit_request_id"),
  );
  const requestExpectedVersion = validateDepositExpectedVersion(
    formData.get("request_expected_version"),
  );
  const commandId = validateDepositCommandId(formData.get("command_id"));
  const reason = normalizeDepositReason(formData.get("reason"));

  if (
    !depositRequestId ||
    requestExpectedVersion === null ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(request, "/admin/deposits?error=invalid_input");
  }

  const execution = await adminCancelDepositRequest({
    depositRequestId,
    requestExpectedVersion,
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
    getCancelRedirectPath(execution.result),
  );
}

function getCancelRedirectPath(result: AdminDepositCommandResult): string {
  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/deposits?result=deposit_request_canceled";
    case "NOOP":
      return "/admin/deposits?result=deposit_request_cancel_noop";
    case "DEPOSIT_COMMAND_ID_CONFLICT":
      return "/admin/deposits?error=deposit_command_conflict";
    case "DEPOSIT_REQUEST_NOT_FOUND":
      return "/admin/deposits?error=deposit_request_not_found";
    case "DEPOSIT_REQUEST_VERSION_CONFLICT":
      return "/admin/deposits?error=deposit_request_version_conflict";
    case "DEPOSIT_REQUEST_CONFIRMED":
      return "/admin/deposits?error=deposit_request_confirmed_terminal";
    case "DEPOSIT_LEDGER_UNAVAILABLE":
      return "/admin/deposits?error=deposit_command_unavailable";
    case "INVALID_INPUT":
      return "/admin/deposits?error=invalid_input";
    default:
      return "/admin/deposits?error=deposit_command_unavailable";
  }
}

function getErrorRedirectPath(
  code: DepositPublicResultCode | PublicAuthErrorCode,
): string {
  switch (code) {
    case "invalid_credentials":
      return "/auth/sign-in?next=/admin/deposits";
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
      return `/admin/deposits?error=${code}`;
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
