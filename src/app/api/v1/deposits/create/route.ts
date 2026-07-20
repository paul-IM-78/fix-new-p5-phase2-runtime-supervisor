import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { DepositPublicResultCode } from "@/lib/deposit/public-results";
import {
  validateDepositAssetId,
  validateDepositCommandId,
  validateDepositExpectedVersion,
  validateDepositUnitsString,
  validateDepositWalletAccountId,
} from "@/lib/deposit/validation";
import {
  createDepositRequest,
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
  const walletAccountId = validateDepositWalletAccountId(
    formData.get("wallet_account_id"),
  );
  const walletExpectedVersion = validateDepositExpectedVersion(
    formData.get("wallet_expected_version"),
  );
  const assetId = validateDepositAssetId(formData.get("asset_id"));
  const assetExpectedVersion = validateDepositExpectedVersion(
    formData.get("asset_expected_version"),
  );
  const units = validateDepositUnitsString(formData.get("units"));
  const commandId = validateDepositCommandId(formData.get("command_id"));

  if (
    !walletAccountId ||
    walletExpectedVersion === null ||
    !assetId ||
    assetExpectedVersion === null ||
    !units ||
    !commandId
  ) {
    return redirectNoStore(request, "/deposits?error=invalid_input");
  }

  const execution = await createDepositRequest({
    walletAccountId,
    walletExpectedVersion,
    assetId,
    assetExpectedVersion,
    units,
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
    getCreateRedirectPath(execution.result),
  );
}

function getCreateRedirectPath(result: DepositCommandResult): string {
  switch (result.resultCode) {
    case "APPLIED":
      return "/deposits?result=deposit_request_created";
    case "DEPOSIT_COMMAND_ID_CONFLICT":
      return "/deposits?error=deposit_command_conflict";
    case "DEPOSIT_WALLET_NOT_FOUND":
      return "/deposits?error=deposit_wallet_not_found";
    case "DEPOSIT_WALLET_VERSION_CONFLICT":
      return "/deposits?error=deposit_wallet_version_conflict";
    case "DEPOSIT_WALLET_NOT_ACTIVE":
      return "/deposits?error=deposit_wallet_not_active";
    case "DEPOSIT_ASSET_NOT_FOUND":
      return "/deposits?error=deposit_asset_not_found";
    case "DEPOSIT_ASSET_VERSION_CONFLICT":
      return "/deposits?error=deposit_asset_version_conflict";
    case "DEPOSIT_ASSET_NOT_ACTIVE":
      return "/deposits?error=deposit_asset_not_active";
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
