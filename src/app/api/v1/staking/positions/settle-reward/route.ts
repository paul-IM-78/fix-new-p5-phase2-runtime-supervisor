import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { StakingPublicResultCode } from "@/lib/staking/public-results";
import {
  validateStakingCommandId,
  validateStakingExpectedVersion,
  validateStakingPositionId,
} from "@/lib/staking/validation";
import { isSameOriginRequest } from "@/server/http/require-same-origin";
import {
  settleCurrentUserStakingReward,
  type StakingRewardSettlementCommandResult,
} from "@/server/staking/staking-position-commands";

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
  const stakingPositionId = validateStakingPositionId(
    formData.get("staking_position_id"),
  );
  const positionExpectedVersion = validateStakingExpectedVersion(
    formData.get("position_expected_version"),
  );
  const walletExpectedVersion = validateStakingExpectedVersion(
    formData.get("wallet_expected_version"),
  );
  const commandId = validateStakingCommandId(formData.get("command_id"));

  if (
    !stakingPositionId ||
    positionExpectedVersion === null ||
    walletExpectedVersion === null ||
    !commandId
  ) {
    return redirectNoStore(request, "/staking?error=invalid_input");
  }

  const execution = await settleCurrentUserStakingReward({
    stakingPositionId,
    positionExpectedVersion,
    walletExpectedVersion,
    commandId,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(
    request,
    getRewardRedirectPath(execution.result),
  );
}

function getRewardRedirectPath(
  result: StakingRewardSettlementCommandResult,
): string {
  if (result.replayed) {
    return "/staking?result=staking_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return result.settlementOutcome === "ZERO"
        ? "/staking?result=staking_reward_zero_settled"
        : "/staking?result=staking_reward_settled";
    case "NOOP":
      return "/staking?result=staking_reward_settlement_noop";
    case "INVALID_INPUT":
      return "/staking?error=invalid_input";
    case "STAKING_REWARD_COMMAND_ID_CONFLICT":
      return "/staking?error=staking_reward_command_conflict";
    case "STAKING_REWARD_POSITION_NOT_FOUND":
      return "/staking?error=staking_reward_position_not_found";
    case "STAKING_REWARD_FORBIDDEN":
      return "/staking?error=staking_reward_forbidden";
    case "STAKING_REWARD_POSITION_VERSION_CONFLICT":
      return "/staking?error=staking_reward_position_version_conflict";
    case "STAKING_REWARD_POSITION_NOT_UNLOCKED":
      return "/staking?error=staking_reward_position_not_unlocked";
    case "STAKING_REWARD_WALLET_NOT_FOUND":
      return "/staking?error=staking_reward_wallet_not_found";
    case "STAKING_REWARD_WALLET_VERSION_CONFLICT":
      return "/staking?error=staking_reward_wallet_version_conflict";
    case "STAKING_REWARD_WALLET_NOT_ACTIVE":
      return "/staking?error=staking_reward_wallet_not_active";
    case "STAKING_REWARD_CALCULATION_INVALID":
      return "/staking?error=staking_reward_calculation_invalid";
    case "STAKING_REWARD_ACCOUNT_UNAVAILABLE":
      return "/staking?error=staking_reward_account_unavailable";
    default:
      return "/staking?error=staking_reward_unavailable";
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
