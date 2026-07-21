import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { StakingPublicResultCode } from "@/lib/staking/public-results";
import {
  validateStakingCommandId,
  validateStakingEntityId,
  validateStakingExpectedVersion,
  validateStakingPositionId,
  validateStakingPrincipalUnits,
  validateStakingWalletAccountId,
} from "@/lib/staking/validation";
import {
  createUserStakingPosition,
  type StakingPositionCommandResult,
} from "@/server/staking/staking-position-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/staking?error=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/staking?error=invalid_input");
  }

  const formData = await request.formData();
  const stakingProductId = validateStakingEntityId(
    formData.get("staking_product_id"),
  );
  const productExpectedVersion = validateStakingExpectedVersion(
    formData.get("product_expected_version"),
  );
  const walletAccountId = validateStakingWalletAccountId(
    formData.get("wallet_account_id"),
  );
  const walletExpectedVersion = validateStakingExpectedVersion(
    formData.get("wallet_expected_version"),
  );
  const principalUnits = validateStakingPrincipalUnits(
    formData.get("principal_units"),
  );
  const positionId = validateStakingPositionId(formData.get("position_id"));
  const commandId = validateStakingCommandId(formData.get("command_id"));

  if (
    !stakingProductId ||
    productExpectedVersion === null ||
    !walletAccountId ||
    walletExpectedVersion === null ||
    !principalUnits ||
    !positionId ||
    !commandId
  ) {
    return redirectNoStore(request, "/staking?error=invalid_input");
  }

  const execution = await createUserStakingPosition({
    stakingProductId,
    productExpectedVersion,
    walletAccountId,
    walletExpectedVersion,
    principalUnits,
    positionId,
    commandId,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(request, getCreateRedirectPath(execution.result));
}

function getCreateRedirectPath(
  result: StakingPositionCommandResult,
): string {
  if (result.replayed) {
    return "/staking?result=staking_position_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return "/staking?result=staking_position_created";
    case "INVALID_INPUT":
      return "/staking?error=invalid_input";
    case "STAKING_POSITION_COMMAND_ID_CONFLICT":
      return "/staking?error=staking_command_conflict";
    case "STAKING_PRODUCT_NOT_FOUND":
      return "/staking?error=staking_product_not_found";
    case "STAKING_PRODUCT_VERSION_CONFLICT":
      return "/staking?error=staking_product_version_conflict";
    case "STAKING_PRODUCT_NOT_ACTIVE":
      return "/staking?error=staking_product_not_active";
    case "STAKING_ENROLLMENT_NOT_OPEN":
      return "/staking?error=staking_enrollment_not_open";
    case "STAKING_PROJECT_NOT_ACTIVE":
      return "/staking?error=staking_project_not_active";
    case "STAKING_ASSET_NOT_ACTIVE":
      return "/staking?error=staking_asset_not_active";
    case "STAKING_ASSET_NOT_PROJECT_TOKEN":
      return "/staking?error=staking_asset_not_project_token";
    case "STAKING_POSITION_BELOW_MINIMUM":
      return "/staking?error=staking_position_below_minimum";
    case "STAKING_POSITION_ABOVE_MAXIMUM":
      return "/staking?error=staking_position_above_maximum";
    case "STAKING_WALLET_NOT_FOUND":
      return "/staking?error=staking_wallet_not_found";
    case "STAKING_WALLET_FORBIDDEN":
      return "/staking?error=staking_wallet_forbidden";
    case "STAKING_WALLET_VERSION_CONFLICT":
      return "/staking?error=staking_wallet_version_conflict";
    case "STAKING_WALLET_NOT_ACTIVE":
      return "/staking?error=staking_wallet_not_active";
    case "STAKING_PROFILE_NOT_ACTIVE":
      return "/staking?error=staking_profile_not_active";
    case "STAKING_POSITION_INSUFFICIENT_AVAILABLE":
      return "/staking?error=staking_position_insufficient_available";
    case "STAKING_POSITION_LEDGER_UNAVAILABLE":
      return "/staking?error=staking_position_ledger_unavailable";
    default:
      return "/staking?error=staking_command_unavailable";
  }
}

function getErrorRedirectPath(
  code: StakingPublicResultCode | PublicAuthErrorCode,
): string {
  switch (code) {
    case "invalid_credentials":
      return "/auth/sign-in?next=/staking";
    case "account_restricted":
      return "/auth/account-unavailable";
    case "account_unavailable":
    case "auth_unavailable":
      return `/auth/error?code=${code}`;
    default:
      return `/staking?error=${code}`;
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
