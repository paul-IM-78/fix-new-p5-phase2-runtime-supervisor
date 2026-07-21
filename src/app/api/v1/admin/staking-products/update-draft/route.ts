import { NextResponse, type NextRequest } from "next/server";

import {
  normalizeOptionalPositiveAtomicUnits,
  normalizeStakingCommandReason,
  normalizeStakingDescription,
  normalizeStakingDisplayName,
  validateIsoDateTime,
  validateLockDurationDays,
  validatePositiveAtomicUnits,
  validateStakingCommandId,
  validateStakingEntityId,
  validateStakingExpectedVersion,
  validateTermRewardRatePpm,
} from "@/lib/staking/validation";
import { executeStakingProductAdminCommand } from "@/server/admin/staking-product-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/staking-products?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/staking-products?error=invalid_input",
    );
  }

  const formData = await request.formData();
  const stakingProductId = validateStakingEntityId(
    formData.get("staking_product_id"),
  );
  const expectedVersion = validateStakingExpectedVersion(
    formData.get("expected_version"),
  );
  const projectId = validateStakingEntityId(formData.get("project_id"));
  const assetId = validateStakingEntityId(formData.get("asset_id"));
  const displayName = normalizeStakingDisplayName(
    formData.get("display_name"),
  );
  const description = normalizeStakingDescription(
    formData.get("description"),
  );
  const lockDurationDays = validateLockDurationDays(
    formData.get("lock_duration_days"),
  );
  const minStakeUnits = validatePositiveAtomicUnits(
    formData.get("min_stake_units"),
  );
  const maxStakeUnits = normalizeOptionalPositiveAtomicUnits(
    formData.get("max_stake_units"),
  );
  const termRewardRatePpm = validateTermRewardRatePpm(
    formData.get("term_reward_rate_ppm"),
  );
  const enrollmentStartsAt = validateIsoDateTime(
    formData.get("enrollment_starts_at"),
  );
  const enrollmentEndsAt = validateIsoDateTime(
    formData.get("enrollment_ends_at"),
  );
  const commandId = validateStakingCommandId(formData.get("command_id"));
  const reason = normalizeStakingCommandReason(formData.get("reason"));

  if (
    !stakingProductId ||
    expectedVersion === null ||
    !projectId ||
    !assetId ||
    !displayName ||
    lockDurationDays === null ||
    !minStakeUnits ||
    maxStakeUnits === null ||
    termRewardRatePpm === null ||
    !enrollmentStartsAt ||
    !enrollmentEndsAt ||
    Date.parse(enrollmentEndsAt) <= Date.parse(enrollmentStartsAt) ||
    !commandId ||
    !reason
  ) {
    return redirectNoStore(
      request,
      "/admin/staking-products?error=invalid_input",
    );
  }

  const execution = await executeStakingProductAdminCommand({
    action: "update_draft",
    stakingProductId,
    expectedVersion,
    projectId,
    assetId,
    displayName,
    description,
    lockDurationDays,
    minStakeUnits,
    maxStakeUnits: maxStakeUnits ?? null,
    termRewardRatePpm,
    enrollmentStartsAt,
    enrollmentEndsAt,
    commandId,
    reason,
  });

  if (!execution.ok) {
    return redirectNoStore(request, getErrorRedirectPath(execution.error));
  }

  return redirectNoStore(
    request,
    getUpdateRedirectPath(execution.result),
  );
}

function getUpdateRedirectPath(result: {
  resultCode: string;
  replayed: boolean;
}): string {
  if (result.replayed) {
    return "/admin/staking-products?result=staking_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/staking-products?result=staking_product_updated";
    case "NOOP":
      return "/admin/staking-products?result=staking_product_update_noop";
    case "INVALID_INPUT":
      return "/admin/staking-products?error=invalid_input";
    case "STAKING_PRODUCT_COMMAND_ID_CONFLICT":
      return "/admin/staking-products?error=staking_command_conflict";
    case "STAKING_PRODUCT_NOT_FOUND":
      return "/admin/staking-products?error=staking_product_not_found";
    case "STAKING_PRODUCT_VERSION_CONFLICT":
      return "/admin/staking-products?error=staking_product_version_conflict";
    case "STAKING_PRODUCT_NOT_DRAFT":
      return "/admin/staking-products?error=staking_product_not_draft";
    case "STAKING_PROJECT_NOT_FOUND":
      return "/admin/staking-products?error=staking_project_not_found";
    case "STAKING_ASSET_NOT_FOUND":
      return "/admin/staking-products?error=staking_asset_not_found";
    case "STAKING_PRODUCT_DUPLICATE_TERM":
      return "/admin/staking-products?error=staking_product_duplicate_term";
    default:
      return "/admin/staking-products?error=staking_command_unavailable";
  }
}

function getErrorRedirectPath(code: string): string {
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
      return `/admin/staking-products?error=${code}`;
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
