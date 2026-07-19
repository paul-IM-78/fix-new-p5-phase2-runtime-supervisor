import { NextResponse, type NextRequest } from "next/server";

import {
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
    return jsonNoStore({ status: "error", code: "request_rejected" }, 403);
  }

  if (!isJsonRequest(request)) {
    return jsonNoStore({ status: "error", code: "invalid_input" }, 400);
  }

  const body = await readJsonObject(request);
  const factorId = validateMfaFactorId(body?.factor_id);
  const code = validateTotpCode(body?.code);

  if (!factorId || !code) {
    return jsonNoStore({ status: "error", code: "invalid_input" }, 400);
  }

  const supabase = await createServerSupabaseClient();
  const identity = await inspectAdminIdentity(supabase);

  if (identity.status !== "admin") {
    return jsonNoStore(
      { status: "error", code: mapIdentityError(identity.status) },
      identity.status === "anonymous" ? 401 : 403,
    );
  }

  const factors = await supabase.auth.mfa.listFactors();

  if (factors.error) {
    return jsonNoStore({ status: "error", code: "mfa_unavailable" }, 503);
  }

  const matchingFactor = (factors.data?.all ?? []).find(
    (factor) =>
      factor.id === factorId &&
      factor.factor_type === "totp" &&
      factor.status === "unverified",
  );

  if (!matchingFactor) {
    return jsonNoStore(
      { status: "error", code: "mfa_factor_invalid" },
      400,
    );
  }

  const verification = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code,
  });

  if (verification.error) {
    return jsonNoStore(
      { status: "error", code: "mfa_invalid_code" },
      400,
    );
  }

  if (!(await hasAal2AdminAccess(supabase))) {
    return jsonNoStore(
      { status: "error", code: "mfa_state_invalid" },
      403,
    );
  }

  return jsonNoStore({ status: "verified", redirectTo: "/admin" });
}

async function readJsonObject(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  const value: unknown = await request.json().catch(() => null);

  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
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

function isJsonRequest(request: NextRequest): boolean {
  return request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase() === "application/json";
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

function jsonNoStore(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}
