import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { StakingPublicResultCode } from "@/lib/staking/public-results";
import {
  normalizeAdminStakingPositionUnlockReason,
  validateStakingCommandId,
  validateStakingExpectedVersion,
  validateStakingPositionId,
} from "@/lib/staking/validation";
import { unlockStakingPositionAsAdmin } from "@/server/admin/staking-position-commands";
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
  const reason = normalizeAdminStakingPositionUnlockReason(
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

  const execution = await unlockStakingPositionAsAdmin({
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
    getAdminUnlockRedirectPath(execution.result.resultCode, execution.result.replayed),
  );
}

function getAdminUnlockRedirectPath(
  resultCode: string,
  replayed: boolean,
): string {
  if (replayed) {
    return "/admin/staking-positions?result=staking_command_replayed";
  }

  switch (resultCode) {
    case "APPLIED":
      return "/admin/staking-positions?result=staking_position_unlocked";
    case "NOOP":
      return "/admin/staking-positions?result=staking_position_unlock_noop";
    case "INVALID_INPUT":
      return "/admin/staking-positions?error=invalid_input";
    case "STAKING_POSITION_COMMAND_ID_CONFLICT":
      return "/admin/staking-positions?error=staking_position_command_conflict";
    case "STAKING_POSITION_NOT_FOUND":
      return "/admin/staking-positions?error=staking_position_not_found";
    case "STAKING_POSITION_VERSION_CONFLICT":
      return "/admin/staking-positions?error=staking_position_version_conflict";
    case "STAKING_POSITION_NOT_MATURED":
      return "/admin/staking-positions?error=staking_position_not_matured";
    case "STAKING_WALLET_NOT_FOUND":
      return "/admin/staking-positions?error=staking_wallet_not_found";
    case "STAKING_INSUFFICIENT_LOCKED_BALANCE":
      return "/admin/staking-positions?error=staking_insufficient_locked_balance";
    case "STAKING_POSITION_LEDGER_UNAVAILABLE":
      return "/admin/staking-positions?error=staking_position_ledger_unavailable";
    default:
      return "/admin/staking-positions?error=staking_position_unavailable";
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
