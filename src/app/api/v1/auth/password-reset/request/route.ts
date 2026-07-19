import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parsePasswordResetRequestForm } from "@/server/auth/form-data";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/auth/forgot-password?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(
      request,
      "/auth/forgot-password?error=invalid_input",
    );
  }

  const parsed = parsePasswordResetRequestForm(await request.formData());

  if (!parsed.ok) {
    return redirectNoStore(
      request,
      `/auth/forgot-password?error=${parsed.error}`,
    );
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.value.email,
  );

  if (isAuthServiceUnavailable(error)) {
    return redirectNoStore(
      request,
      "/auth/forgot-password?error=auth_unavailable",
    );
  }

  return redirectNoStore(request, "/auth/password-reset-sent");
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

function isAuthServiceUnavailable(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : null;
  const status = record?.status;

  return typeof status === "number" && status >= 500;
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
