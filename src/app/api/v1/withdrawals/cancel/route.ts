import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { WithdrawalPublicResultCode } from "@/lib/withdrawal/public-results";
import {
  normalizeWithdrawalReason,
  validateWithdrawalCommandId,
  validateWithdrawalExpectedVersion,
  validateWithdrawalRequestId,
} from "@/lib/withdrawal/validation";
import {
  cancelCurrentUserWithdrawalRequest,
  type WithdrawalCommandResult,
} from "@/server/withdrawal/withdrawal-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/withdrawals?error=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/withdrawals?error=invalid_input");
  }

  const formData = await request.formData();
  const withdrawalRequestId = validateWithdrawalRequestId(
    formData.get("withdrawal_request_id"),
  );
  const requestExpectedVersion = validateWithdrawalExpectedVersion(
    formData.get("request_expected_version"),
  );
  const commandId = validateWithdrawalCommandId(formData.get("command_id"));
  const reason = normalizeWithdrawalReason(formData.get("reason"));

  if (
    !withdrawalRequestId ||
    requestExpectedVersion === null ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(request, "/withdrawals?error=invalid_input");
  }

  const execution = await cancelCurrentUserWithdrawalRequest({
    withdrawalRequestId,
    requestExpectedVersion,
    commandId,
    reason,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(request, getCancelRedirectPath(execution.result));
}

function getCancelRedirectPath(result: WithdrawalCommandResult): string {
  switch (result.resultCode) {
    case "APPLIED":
      return "/withdrawals?result=withdrawal_request_canceled";
    case "NOOP":
      return "/withdrawals?result=withdrawal_request_cancel_noop";
    case "WITHDRAWAL_COMMAND_ID_CONFLICT":
      return "/withdrawals?error=withdrawal_command_conflict";
    case "WITHDRAWAL_REQUEST_NOT_FOUND":
      return "/withdrawals?error=withdrawal_request_not_found";
    case "WITHDRAWAL_REQUEST_FORBIDDEN":
      return "/withdrawals?error=withdrawal_request_forbidden";
    case "WITHDRAWAL_REQUEST_VERSION_CONFLICT":
      return "/withdrawals?error=withdrawal_request_version_conflict";
    case "WITHDRAWAL_REQUEST_NOT_USER_CANCELABLE":
      return "/withdrawals?error=withdrawal_request_not_user_cancelable";
    case "INVALID_INPUT":
      return "/withdrawals?error=invalid_input";
    default:
      return "/withdrawals?error=withdrawal_command_unavailable";
  }
}

function getErrorRedirectPath(
  code: WithdrawalPublicResultCode | PublicAuthErrorCode,
): string {
  switch (code) {
    case "invalid_credentials":
      return "/auth/sign-in?next=/withdrawals";
    case "account_restricted":
      return "/auth/account-unavailable";
    case "account_unavailable":
    case "auth_unavailable":
      return `/auth/error?code=${code}`;
    default:
      return `/withdrawals?error=${code}`;
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
