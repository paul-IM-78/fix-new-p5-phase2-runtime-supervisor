import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { WalletPublicResultCode } from "@/lib/wallet/public-results";
import {
  normalizeWalletCommandReason,
  validateWalletAccountId,
  validateWalletAccountStatus,
  validateWalletCommandId,
  validateWalletExpectedVersion,
} from "@/lib/wallet/validation";
import {
  executeWalletStatusCommand,
  type WalletStatusCommandResult,
} from "@/server/admin/wallet-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/wallets?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/wallets?error=invalid_input",
    );
  }

  const formData = await request.formData();
  const walletAccountId = validateWalletAccountId(
    formData.get("wallet_account_id"),
  );
  const expectedVersion = validateWalletExpectedVersion(
    formData.get("expected_version"),
  );
  const newStatus = validateWalletAccountStatus(
    formData.get("new_status"),
  );
  const commandId = validateWalletCommandId(formData.get("command_id"));
  const reason = normalizeWalletCommandReason(formData.get("reason"));

  if (
    !walletAccountId ||
    expectedVersion === null ||
    !newStatus ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(
      request,
      "/admin/wallets?error=invalid_input",
    );
  }

  const execution = await executeWalletStatusCommand({
    walletAccountId,
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
    getWalletTransitionRedirectPath(execution.result),
  );
}

function getWalletTransitionRedirectPath(
  result: WalletStatusCommandResult,
): string {
  if (result.replayed) {
    return "/admin/wallets?result=wallet_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/wallets?result=wallet_status_changed";
    case "NOOP":
      return "/admin/wallets?result=wallet_status_noop";
    case "INVALID_INPUT":
      return "/admin/wallets?error=invalid_input";
    case "WALLET_ACCOUNT_NOT_FOUND":
      return "/admin/wallets?error=wallet_account_not_found";
    case "WALLET_ACCOUNT_VERSION_CONFLICT":
      return "/admin/wallets?error=wallet_account_version_conflict";
    case "WALLET_ACCOUNT_TRANSITION_INVALID":
      return "/admin/wallets?error=wallet_account_transition_invalid";
    case "TARGET_PROFILE_INACTIVE":
      return "/admin/wallets?error=wallet_target_profile_inactive";
    case "COMMAND_ID_CONFLICT":
      return "/admin/wallets?error=wallet_command_conflict";
    default:
      return "/admin/wallets?error=wallet_command_unavailable";
  }
}

function getErrorRedirectPath(
  code: WalletPublicResultCode | PublicAuthErrorCode,
): string {
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
      return `/admin/wallets?error=${code}`;
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
