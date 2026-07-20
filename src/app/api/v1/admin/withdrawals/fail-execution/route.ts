import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { WithdrawalPublicResultCode } from "@/lib/withdrawal/public-results";
import {
  normalizeWithdrawalFailureReason,
  normalizeWithdrawalReason,
  validateWithdrawalCommandId,
  validateWithdrawalExecutionAttemptId,
  validateWithdrawalExpectedVersion,
  validateWithdrawalFailureCode,
  validateWithdrawalRequestId,
} from "@/lib/withdrawal/validation";
import {
  failWithdrawalExecution,
  type AdminWithdrawalCommandResult,
} from "@/server/admin/withdrawal-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/withdrawals?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/admin/withdrawals?error=invalid_input");
  }

  const formData = await request.formData();
  const input = readFailExecutionInput(formData);

  if (!input) {
    return redirectNoStore(request, "/admin/withdrawals?error=invalid_input");
  }

  const execution = await failWithdrawalExecution(input);

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(request, getFailRedirectPath(execution.result));
}

function readFailExecutionInput(formData: FormData) {
  const withdrawalRequestId = validateWithdrawalRequestId(
    formData.get("withdrawal_request_id"),
  );
  const requestExpectedVersion = validateWithdrawalExpectedVersion(
    formData.get("request_expected_version"),
  );
  const executionAttemptId = validateWithdrawalExecutionAttemptId(
    formData.get("execution_attempt_id"),
  );
  const attemptExpectedVersion = validateWithdrawalExpectedVersion(
    formData.get("attempt_expected_version"),
  );
  const commandId = validateWithdrawalCommandId(formData.get("command_id"));
  const reason = normalizeWithdrawalReason(formData.get("reason"));
  const failureCode = validateWithdrawalFailureCode(
    formData.get("failure_code"),
  );
  const failureReason = normalizeWithdrawalFailureReason(
    formData.get("failure_reason"),
  );

  return withdrawalRequestId &&
    requestExpectedVersion !== null &&
    executionAttemptId &&
    attemptExpectedVersion !== null &&
    commandId &&
    reason &&
    failureCode &&
    failureReason
    ? {
        withdrawalRequestId,
        requestExpectedVersion,
        executionAttemptId,
        attemptExpectedVersion,
        commandId,
        reason,
        failureCode,
        failureReason,
      }
    : null;
}

function getFailRedirectPath(result: AdminWithdrawalCommandResult): string {
  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/withdrawals?result=withdrawal_execution_failed";
    case "NOOP":
      return "/admin/withdrawals?result=withdrawal_execution_fail_noop";
    case "WITHDRAWAL_COMMAND_ID_CONFLICT":
      return "/admin/withdrawals?error=withdrawal_command_conflict";
    case "WITHDRAWAL_REQUEST_NOT_FOUND":
      return "/admin/withdrawals?error=withdrawal_request_not_found";
    case "WITHDRAWAL_REQUEST_VERSION_CONFLICT":
      return "/admin/withdrawals?error=withdrawal_request_version_conflict";
    case "WITHDRAWAL_EXECUTION_ATTEMPT_NOT_FOUND":
      return "/admin/withdrawals?error=withdrawal_execution_attempt_not_found";
    case "WITHDRAWAL_EXECUTION_ATTEMPT_VERSION_CONFLICT":
      return "/admin/withdrawals?error=withdrawal_execution_attempt_version_conflict";
    case "WITHDRAWAL_EXECUTION_ATTEMPT_MISMATCH":
      return "/admin/withdrawals?error=withdrawal_execution_attempt_mismatch";
    case "WITHDRAWAL_EXECUTION_NOT_FAILABLE":
      return "/admin/withdrawals?error=withdrawal_execution_not_failable";
    case "INVALID_INPUT":
      return "/admin/withdrawals?error=invalid_input";
    default:
      return "/admin/withdrawals?error=withdrawal_command_unavailable";
  }
}

function getErrorRedirectPath(
  code: WithdrawalPublicResultCode | PublicAuthErrorCode,
): string {
  switch (code) {
    case "invalid_credentials":
      return "/auth/sign-in?next=/admin/withdrawals";
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
      return `/admin/withdrawals?error=${code}`;
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
