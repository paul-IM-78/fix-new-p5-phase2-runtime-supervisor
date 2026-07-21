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
  unlockCurrentUserStakingPosition,
  type StakingPositionUnlockCommandResult,
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

  const execution = await unlockCurrentUserStakingPosition({
    stakingPositionId,
    positionExpectedVersion,
    walletExpectedVersion,
    commandId,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(request, getUnlockRedirectPath(execution.result));
}

function getUnlockRedirectPath(
  result: StakingPositionUnlockCommandResult,
): string {
  if (result.replayed) {
    return "/staking?result=staking_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return "/staking?result=staking_position_unlocked";
    case "NOOP":
      return "/staking?result=staking_position_unlock_noop";
    case "INVALID_INPUT":
      return "/staking?error=invalid_input";
    case "STAKING_POSITION_COMMAND_ID_CONFLICT":
      return "/staking?error=staking_position_command_conflict";
    case "STAKING_POSITION_NOT_FOUND":
      return "/staking?error=staking_position_not_found";
    case "STAKING_POSITION_FORBIDDEN":
      return "/staking?error=staking_position_forbidden";
    case "STAKING_POSITION_VERSION_CONFLICT":
      return "/staking?error=staking_position_version_conflict";
    case "STAKING_POSITION_NOT_MATURED":
      return "/staking?error=staking_position_not_matured";
    case "STAKING_WALLET_NOT_FOUND":
      return "/staking?error=staking_wallet_not_found";
    case "STAKING_WALLET_VERSION_CONFLICT":
      return "/staking?error=staking_wallet_version_conflict";
    case "STAKING_WALLET_NOT_ACTIVE":
      return "/staking?error=staking_wallet_not_active";
    case "STAKING_INSUFFICIENT_LOCKED_BALANCE":
      return "/staking?error=staking_insufficient_locked_balance";
    case "STAKING_POSITION_LEDGER_UNAVAILABLE":
      return "/staking?error=staking_position_ledger_unavailable";
    default:
      return "/staking?error=staking_position_unavailable";
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
