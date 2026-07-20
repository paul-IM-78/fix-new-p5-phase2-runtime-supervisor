import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { WithdrawalPublicResultCode } from "@/lib/withdrawal/public-results";
import {
  validateWithdrawalAssetId,
  validateWithdrawalCommandId,
  validateWithdrawalExpectedVersion,
  validateWithdrawalUnitsString,
  validateWithdrawalWalletAccountId,
} from "@/lib/withdrawal/validation";
import {
  createWithdrawalRequest,
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
  const walletAccountId = validateWithdrawalWalletAccountId(
    formData.get("wallet_account_id"),
  );
  const walletExpectedVersion = validateWithdrawalExpectedVersion(
    formData.get("wallet_expected_version"),
  );
  const assetId = validateWithdrawalAssetId(formData.get("asset_id"));
  const assetExpectedVersion = validateWithdrawalExpectedVersion(
    formData.get("asset_expected_version"),
  );
  const units = validateWithdrawalUnitsString(formData.get("units"));
  const commandId = validateWithdrawalCommandId(formData.get("command_id"));

  if (
    !walletAccountId ||
    walletExpectedVersion === null ||
    !assetId ||
    assetExpectedVersion === null ||
    !units ||
    !commandId
  ) {
    return redirectNoStore(request, "/withdrawals?error=invalid_input");
  }

  const execution = await createWithdrawalRequest({
    walletAccountId,
    walletExpectedVersion,
    assetId,
    assetExpectedVersion,
    units,
    commandId,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(request, getCreateRedirectPath(execution.result));
}

function getCreateRedirectPath(result: WithdrawalCommandResult): string {
  switch (result.resultCode) {
    case "APPLIED":
      return "/withdrawals?result=withdrawal_request_created";
    case "WITHDRAWAL_COMMAND_ID_CONFLICT":
      return "/withdrawals?error=withdrawal_command_conflict";
    case "WITHDRAWAL_WALLET_NOT_FOUND":
      return "/withdrawals?error=withdrawal_wallet_not_found";
    case "WITHDRAWAL_WALLET_VERSION_CONFLICT":
      return "/withdrawals?error=withdrawal_wallet_version_conflict";
    case "WITHDRAWAL_WALLET_NOT_ACTIVE":
      return "/withdrawals?error=withdrawal_wallet_not_active";
    case "WITHDRAWAL_ASSET_NOT_FOUND":
      return "/withdrawals?error=withdrawal_asset_not_found";
    case "WITHDRAWAL_ASSET_VERSION_CONFLICT":
      return "/withdrawals?error=withdrawal_asset_version_conflict";
    case "WITHDRAWAL_ASSET_NOT_ACTIVE":
      return "/withdrawals?error=withdrawal_asset_not_active";
    case "WITHDRAWAL_INSUFFICIENT_AVAILABLE":
      return "/withdrawals?error=withdrawal_insufficient_available";
    case "WITHDRAWAL_REQUEST_ALREADY_OPEN":
      return "/withdrawals?error=withdrawal_request_already_open";
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
