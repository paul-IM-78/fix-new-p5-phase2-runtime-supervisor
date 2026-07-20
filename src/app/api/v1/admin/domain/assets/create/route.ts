import { NextResponse, type NextRequest } from "next/server";

import {
  isBlankDomainValue,
  normalizeAssetDisplayName,
  normalizeAssetMintAddress,
  normalizeDomainCommandReason,
  validateAssetCode,
  validateAssetDecimals,
  validateAssetSymbol,
  validateAssetType,
  validateDomainCommandId,
} from "@/lib/domain/validation";
import { executeDomainAdminCommand } from "@/server/admin/domain-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/admin/catalog?error=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/admin/catalog?error=invalid_input");
  }

  const formData = await request.formData();
  const assetCode = validateAssetCode(formData.get("asset_code"));
  const symbol = validateAssetSymbol(formData.get("symbol"));
  const displayName = normalizeAssetDisplayName(
    formData.get("display_name"),
  );
  const assetType = validateAssetType(formData.get("asset_type"));
  const decimals = validateAssetDecimals(formData.get("decimals"));
  const mintValue = formData.get("mint_address");
  const mintAddress = assetType
    ? normalizeAssetMintAddress(mintValue, assetType)
    : null;
  const commandId = validateDomainCommandId(formData.get("command_id"));
  const reason = normalizeDomainCommandReason(formData.get("reason"));

  if (
    !assetCode ||
    !symbol ||
    !displayName ||
    !assetType ||
    decimals === null ||
    !commandId ||
    !reason ||
    (assetType === "NATIVE" && !isBlankDomainValue(mintValue)) ||
    (assetType === "SPL_TOKEN" && !mintAddress)
  ) {
    return redirectNoStore(request, "/admin/catalog?error=invalid_input");
  }

  const execution = await executeDomainAdminCommand({
    action: "create_asset",
    assetCode,
    symbol,
    displayName,
    assetType,
    decimals,
    mintAddress,
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
    getAssetCreateRedirectPath(execution.result),
  );
}

function getAssetCreateRedirectPath(result: {
  resultCode: string;
  replayed: boolean;
}): string {
  if (result.replayed) {
    return "/admin/catalog?result=domain_command_replayed";
  }

  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/catalog?result=asset_created";
    case "INVALID_INPUT":
      return "/admin/catalog?error=invalid_input";
    case "COMMAND_ID_CONFLICT":
      return "/admin/catalog?error=domain_command_conflict";
    case "ASSET_CODE_EXISTS":
      return "/admin/catalog?error=asset_code_exists";
    case "ASSET_MINT_EXISTS":
      return "/admin/catalog?error=asset_mint_exists";
    case "ASSET_NATIVE_SYMBOL_EXISTS":
      return "/admin/catalog?error=asset_native_symbol_exists";
    default:
      return "/admin/catalog?error=domain_command_unavailable";
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
      return `/admin/catalog?error=${code}`;
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
