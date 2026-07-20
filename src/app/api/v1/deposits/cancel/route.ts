import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { DepositPublicResultCode } from "@/lib/deposit/public-results";
import {
  validateDepositCommandId,
  validateDepositExpectedVersion,
  validateDepositRequestId,
} from "@/lib/deposit/validation";
import {
  cancelCurrentUserDepositRequest,
  type DepositCommandResult,
} from "@/server/deposit/deposit-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/deposits?error=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/deposits?error=invalid_input");
  }

  const formData = await request.formData();
  const depositRequestId = validateDepositRequestId(
    formData.get("deposit_request_id"),
  );
  const requestExpectedVersion = validateDepositExpectedVersion(
    formData.get("request_expected_version"),
  );
  const commandId = validateDepositCommandId(formData.get("command_id"));

  if (!depositRequestId || requestExpectedVersion === null || !commandId) {
    return redirectNoStore(request, "/deposits?error=invalid_input");
  }

  const execution = await cancelCurrentUserDepositRequest({
    depositRequestId,
    requestExpectedVersion,
    commandId,
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

function getCancelRedirectPath(result: DepositCommandResult): string {
  switch (result.resultCode) {
    case "APPLIED":
      return "/deposits?result=deposit_request_canceled";
    case "NOOP":
      return "/deposits?result=deposit_request_cancel_noop";
    case "DEPOSIT_COMMAND_ID_CONFLICT":
      return "/deposits?error=deposit_command_conflict";
    case "DEPOSIT_REQUEST_NOT_FOUND":
      return "/deposits?error=deposit_request_not_found";
    case "DEPOSIT_REQUEST_FORBIDDEN":
      return "/deposits?error=deposit_request_forbidden";
    case "DEPOSIT_REQUEST_VERSION_CONFLICT":
      return "/deposits?error=deposit_request_version_conflict";
    case "DEPOSIT_REQUEST_CONFIRMED":
      return "/deposits?error=deposit_request_confirmed_terminal";
    case "INVALID_INPUT":
      return "/deposits?error=invalid_input";
    default:
      return "/deposits?error=deposit_command_unavailable";
  }
}

function getErrorRedirectPath(
  code: DepositPublicResultCode | PublicAuthErrorCode,
): string {
  switch (code) {
    case "invalid_credentials":
      return "/auth/sign-in?next=/deposits";
    case "account_restricted":
      return "/auth/account-unavailable";
    case "account_unavailable":
    case "auth_unavailable":
      return `/auth/error?code=${code}`;
    default:
      return `/deposits?error=${code}`;
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
