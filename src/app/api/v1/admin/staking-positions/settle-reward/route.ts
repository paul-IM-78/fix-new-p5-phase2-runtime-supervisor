import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { StakingPublicResultCode } from "@/lib/staking/public-results";
import {
  normalizeAdminStakingRewardSettlementReason,
  validateStakingCommandId,
  validateStakingExpectedVersion,
  validateStakingPositionId,
} from "@/lib/staking/validation";
import {
  settleStakingRewardAsAdmin,
  type AdminStakingRewardSettlementResult,
} from "@/server/admin/staking-position-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/staking-positions?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/staking-positions?error=invalid_input",
    );
  }

  const formData = await request.formData();
  const stakingPositionId = validateStakingPositionId(
    formData.get("staking_position_id"),
  );
  const positionExpectedVersion = validateStakingExpectedVersion(
    formData.get("position_expected_version"),
  );
  const commandId = validateStakingCommandId(formData.get("command_id"));
  const reason = normalizeAdminStakingRewardSettlementReason(
    formData.get("reason"),
  );

  if (
    !stakingPositionId ||
    positionExpectedVersion === null ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(
      request,
      "/admin/staking-positions?error=invalid_input",
    );
  }

  const execution = await settleStakingRewardAsAdmin({
    stakingPositionId,
    positionExpectedVersion,
    commandId,
    reason,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(
    request,
    getAdminRewardRedirectPath(execution.result),
  );
}

function getAdminRewardRedirectPath(
  result: AdminStakingRewardSettlementResult,
): string {
  if (result.replayed) {
    return "/admin/staking-positions?result=staking_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return result.settlementOutcome === "ZERO"
        ? "/admin/staking-positions?result=staking_reward_zero_settled"
        : "/admin/staking-positions?result=staking_reward_settled";
    case "NOOP":
      return "/admin/staking-positions?result=staking_reward_settlement_noop";
    case "INVALID_INPUT":
      return "/admin/staking-positions?error=invalid_input";
    case "STAKING_REWARD_COMMAND_ID_CONFLICT":
      return "/admin/staking-positions?error=staking_reward_command_conflict";
    case "STAKING_REWARD_POSITION_NOT_FOUND":
      return "/admin/staking-positions?error=staking_reward_position_not_found";
    case "STAKING_REWARD_POSITION_VERSION_CONFLICT":
      return "/admin/staking-positions?error=staking_reward_position_version_conflict";
    case "STAKING_REWARD_POSITION_NOT_UNLOCKED":
      return "/admin/staking-positions?error=staking_reward_position_not_unlocked";
    case "STAKING_REWARD_WALLET_NOT_FOUND":
      return "/admin/staking-positions?error=staking_reward_wallet_not_found";
    case "STAKING_REWARD_CALCULATION_INVALID":
      return "/admin/staking-positions?error=staking_reward_calculation_invalid";
    case "STAKING_REWARD_ACCOUNT_UNAVAILABLE":
      return "/admin/staking-positions?error=staking_reward_account_unavailable";
    default:
      return "/admin/staking-positions?error=staking_reward_unavailable";
  }
}

function getErrorRedirectPath(
  code: StakingPublicResultCode | PublicAuthErrorCode,
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
      return `/admin/staking-positions?error=${code}`;
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
