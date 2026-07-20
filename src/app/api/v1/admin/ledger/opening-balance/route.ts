import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { LedgerPublicResultCode } from "@/lib/ledger/public-results";
import {
  normalizeFinancialAdminReason,
  validateAtomicUnitsString,
  validateLedgerAssetId,
  validateLedgerCommandId,
  validateLedgerExpectedVersion,
  validateLedgerWalletAccountId,
} from "@/lib/ledger/validation";
import {
  postOpeningBalance,
  type FinancialCommandResult,
} from "@/server/admin/financial-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/ledger?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/admin/ledger?error=invalid_input");
  }

  const formData = await request.formData();
  const walletAccountId = validateLedgerWalletAccountId(
    formData.get("wallet_account_id"),
  );
  const walletExpectedVersion = validateLedgerExpectedVersion(
    formData.get("wallet_expected_version"),
  );
  const assetId = validateLedgerAssetId(formData.get("asset_id"));
  const assetExpectedVersion = validateLedgerExpectedVersion(
    formData.get("asset_expected_version"),
  );
  const units = validateAtomicUnitsString(formData.get("units"));
  const commandId = validateLedgerCommandId(formData.get("command_id"));
  const reason = normalizeFinancialAdminReason(formData.get("reason"));

  if (
    !walletAccountId ||
    walletExpectedVersion === null ||
    !assetId ||
    assetExpectedVersion === null ||
    !units ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(request, "/admin/ledger?error=invalid_input");
  }

  const execution = await postOpeningBalance({
    walletAccountId,
    walletExpectedVersion,
    assetId,
    assetExpectedVersion,
    units,
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
    getOpeningBalanceRedirectPath(execution.result),
  );
}

function getOpeningBalanceRedirectPath(
  result: FinancialCommandResult,
): string {
  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/ledger?result=opening_balance_posted";
    case "OPENING_BALANCE_ALREADY_POSTED":
      return "/admin/ledger?error=opening_balance_already_posted";
    case "OPENING_WALLET_NOT_FOUND":
      return "/admin/ledger?error=opening_wallet_not_found";
    case "OPENING_WALLET_VERSION_CONFLICT":
      return "/admin/ledger?error=opening_wallet_version_conflict";
    case "OPENING_WALLET_NOT_ACTIVE":
      return "/admin/ledger?error=opening_wallet_not_active";
    case "OPENING_PROFILE_NOT_ACTIVE":
      return "/admin/ledger?error=opening_profile_not_active";
    case "OPENING_ASSET_NOT_FOUND":
      return "/admin/ledger?error=opening_asset_not_found";
    case "OPENING_ASSET_VERSION_CONFLICT":
      return "/admin/ledger?error=opening_asset_version_conflict";
    case "OPENING_ASSET_NOT_ACTIVE":
      return "/admin/ledger?error=opening_asset_not_active";
    case "OPENING_LEDGER_ACTIVITY_EXISTS":
      return "/admin/ledger?error=opening_ledger_activity_exists";
    case "FINANCIAL_COMMAND_ID_CONFLICT":
      return "/admin/ledger?error=financial_command_conflict";
    case "INVALID_INPUT":
      return "/admin/ledger?error=invalid_input";
    default:
      return "/admin/ledger?error=financial_command_unavailable";
  }
}

function getErrorRedirectPath(
  code: LedgerPublicResultCode | PublicAuthErrorCode,
): string {
  switch (code) {
    case "invalid_credentials":
      return "/auth/sign-in?next=/admin/ledger";
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
      return `/admin/ledger?error=${code}`;
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
