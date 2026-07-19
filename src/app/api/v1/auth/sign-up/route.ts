import { NextResponse, type NextRequest } from "next/server";

import {
  getSupabaseAuthErrorCode,
  mapSupabaseAuthErrorCode,
} from "@/lib/auth/public-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseSignUpForm } from "@/server/auth/form-data";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/auth/sign-up?error=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/auth/sign-up?error=invalid_input");
  }

  const parsed = parseSignUpForm(await request.formData());

  if (!parsed.ok) {
    return redirectNoStore(request, `/auth/sign-up?error=${parsed.error}`);
  }

  const supabase = await createServerSupabaseClient();
  const { email, password, displayName } = parsed.value;

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: displayName ? { display_name: displayName } : {},
    },
  });

  if (error) {
    const code = getSupabaseAuthErrorCode(error);

    if (code === "user_already_exists" || code === "email_exists") {
      return redirectNoStore(request, "/auth/check-email");
    }

    const publicCode = mapSupabaseAuthErrorCode(
      error,
      "signup_unavailable",
    );

    return redirectNoStore(
      request,
      `/auth/sign-up?error=${publicCode}`,
    );
  }

  return redirectNoStore(request, "/auth/check-email");
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
