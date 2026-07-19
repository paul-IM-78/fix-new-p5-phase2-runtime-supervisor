import { NextResponse, type NextRequest } from "next/server";

import {
  getSafeAuthNextPath,
  validateMfaFactorId,
  validateTotpCode,
} from "@/lib/auth/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminIdentity } from "@/server/auth/admin-guard";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/auth/mfa/challenge?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(
      request,
      "/auth/mfa/challenge?error=invalid_input",
    );
  }

  const formData = await request.formData();
  const factorId = validateMfaFactorId(formData.get("factor_id"));
  const code = validateTotpCode(formData.get("code"));
  const nextPath = getSafeAuthNextPath(formData.get("next"), "/admin");

  if (!factorId || !code) {
    return redirectNoStore(
      request,
      "/auth/mfa/challenge?error=invalid_input",
    );
  }

  const supabase = await createServerSupabaseClient();
  const identity = await inspectAdminIdentity(supabase);

  if (identity.status !== "admin") {
    return redirectNoStore(
      request,
      `/auth/error?code=${mapIdentityError(identity.status)}`,
    );
  }

  const factors = await supabase.auth.mfa.listFactors();

  if (factors.error) {
    return redirectNoStore(
      request,
      "/auth/mfa/challenge?error=mfa_unavailable",
    );
  }

  const matchingFactor = (factors.data?.all ?? []).find(
    (factor) =>
      factor.id === factorId &&
      factor.factor_type === "totp" &&
      factor.status === "verified",
  );

  if (!matchingFactor) {
    return redirectNoStore(
      request,
      "/auth/mfa/challenge?error=mfa_factor_invalid",
    );
  }

  const verification = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code,
  });

  if (verification.error) {
    return redirectNoStore(
      request,
      "/auth/mfa/challenge?error=mfa_invalid_code",
    );
  }

  if (!(await hasAal2AdminAccess(supabase))) {
    return redirectNoStore(
      request,
      "/auth/mfa/challenge?error=mfa_state_invalid",
    );
  }

  return redirectNoStore(request, nextPath);
}

async function hasAal2AdminAccess(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<boolean> {
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (
    aal.error ||
    aal.data?.currentLevel !== "aal2" ||
    aal.data?.nextLevel !== "aal2"
  ) {
    return false;
  }

  const { data, error } = await supabase.rpc(
    "is_current_user_admin_aal2",
  );

  return !error && data === true;
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

function mapIdentityError(
  status: Exclude<
    Awaited<ReturnType<typeof inspectAdminIdentity>>["status"],
    "admin"
  >,
): string {
  switch (status) {
    case "anonymous":
      return "invalid_credentials";
    case "inactive":
      return "account_restricted";
    case "missing_profile":
      return "account_unavailable";
    case "not_admin":
      return "admin_forbidden";
    case "unavailable":
      return "mfa_unavailable";
  }
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
