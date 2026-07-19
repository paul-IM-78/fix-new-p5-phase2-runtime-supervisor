import { NextResponse, type NextRequest } from "next/server";

import { mapSupabaseAuthErrorCode } from "@/lib/auth/public-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import { parseSignInForm } from "@/server/auth/form-data";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/auth/sign-in?error=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/auth/sign-in?error=invalid_input");
  }

  const parsed = parseSignInForm(await request.formData());

  if (!parsed.ok) {
    return redirectNoStore(request, `/auth/sign-in?error=${parsed.error}`);
  }

  const supabase = await createServerSupabaseClient();
  const { email, password, nextPath } = parsed.value;
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const publicCode = mapSupabaseAuthErrorCode(
      error,
      "invalid_credentials",
    );

    return redirectNoStore(
      request,
      `/auth/sign-in?error=${publicCode}`,
    );
  }

  const accountAccess = await inspectAccountAccess(supabase);

  if (accountAccess.status === "active") {
    return redirectNoStore(request, nextPath);
  }

  await supabase.auth.signOut();

  if (accountAccess.status === "missing_profile") {
    return redirectNoStore(
      request,
      "/auth/sign-in?error=account_unavailable",
    );
  }

  if (accountAccess.status === "inactive") {
    return redirectNoStore(
      request,
      "/auth/sign-in?error=account_restricted",
    );
  }

  if (accountAccess.status === "unavailable") {
    return redirectNoStore(
      request,
      "/auth/sign-in?error=auth_unavailable",
    );
  }

  return redirectNoStore(
    request,
    "/auth/sign-in?error=invalid_credentials",
  );
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
