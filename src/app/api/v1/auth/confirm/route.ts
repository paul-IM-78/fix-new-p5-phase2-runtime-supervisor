import { NextResponse, type NextRequest } from "next/server";

import { mapSupabaseAuthErrorCode } from "@/lib/auth/public-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import { parseConfirmEmailForm } from "@/server/auth/form-data";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/auth/error?code=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/auth/error?code=confirmation_invalid");
  }

  const parsed = parseConfirmEmailForm(await request.formData());

  if (!parsed.ok) {
    return redirectNoStore(request, `/auth/error?code=${parsed.error}`);
  }

  const supabase = await createServerSupabaseClient();
  const { tokenHash, nextPath } = parsed.value;
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });

  if (error) {
    const publicCode = mapSupabaseAuthErrorCode(
      error,
      "confirmation_invalid",
    );

    return redirectNoStore(request, `/auth/error?code=${publicCode}`);
  }

  const accountAccess = await inspectAccountAccess(supabase);

  if (accountAccess.status === "active") {
    return redirectNoStore(
      request,
      `/auth/verified?next=${encodeURIComponent(nextPath)}`,
    );
  }

  await supabase.auth.signOut();

  if (accountAccess.status === "missing_profile") {
    return redirectNoStore(request, "/auth/error?code=account_unavailable");
  }

  if (accountAccess.status === "inactive") {
    return redirectNoStore(request, "/auth/error?code=account_restricted");
  }

  return redirectNoStore(request, "/auth/error?code=auth_unavailable");
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
