import { NextResponse, type NextRequest } from "next/server";

import { mapSupabaseAuthErrorCode } from "@/lib/auth/public-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getCurrentUserProfileFromClient,
  isActiveProfile,
} from "@/server/auth/current-user";
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

  const currentUser = await getCurrentUserProfileFromClient(supabase);

  if (currentUser.status === "missing_profile") {
    await supabase.auth.signOut();

    return redirectNoStore(request, "/auth/error?code=account_unavailable");
  }

  if (!isActiveProfile(currentUser)) {
    await supabase.auth.signOut();

    return redirectNoStore(request, "/auth/error?code=account_restricted");
  }

  return redirectNoStore(
    request,
    `/auth/verified?next=${encodeURIComponent(nextPath)}`,
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
