import { NextResponse, type NextRequest } from "next/server";

import {
  mapSupabasePasswordUpdateErrorCode,
  mapSupabaseRecoveryErrorCode,
} from "@/lib/auth/public-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAccountAccess } from "@/server/auth/account-guard";
import { parsePasswordUpdateForm } from "@/server/auth/form-data";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(request, "/auth/error?code=request_rejected");
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/auth/error?code=invalid_input");
  }

  const parsed = parsePasswordUpdateForm(await request.formData());

  if (!parsed.ok) {
    return redirectNoStore(request, `/auth/error?code=${parsed.error}`);
  }

  const supabase = await createServerSupabaseClient();
  const { tokenHash, password } = parsed.value;
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery",
  });

  if (verifyError) {
    await signOutSilently(supabase);

    return redirectNoStore(
      request,
      `/auth/error?code=${mapSupabaseRecoveryErrorCode(verifyError)}`,
    );
  }

  const claimsResult = await supabase.auth.getClaims();

  if (
    claimsResult.error ||
    !hasVerifiedSubjectAndSession(claimsResult.data?.claims)
  ) {
    await signOutSilently(supabase);

    return redirectNoStore(request, "/auth/error?code=recovery_invalid");
  }

  const accountAccess = await inspectAccountAccess(
    supabase,
    claimsResult.data?.claims,
  );

  if (accountAccess.status === "active") {
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      await signOutSilently(supabase);

      return redirectNoStore(
        request,
        `/auth/error?code=${mapSupabasePasswordUpdateErrorCode(updateError)}`,
      );
    }

    await signOutSilently(supabase, "global");

    return redirectNoStore(request, "/auth/password-updated");
  }

  await signOutSilently(supabase);

  if (accountAccess.status === "missing_profile") {
    return redirectNoStore(request, "/auth/error?code=account_unavailable");
  }

  if (accountAccess.status === "inactive") {
    return redirectNoStore(request, "/auth/error?code=account_restricted");
  }

  if (accountAccess.status === "anonymous") {
    return redirectNoStore(request, "/auth/error?code=recovery_invalid");
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

function hasVerifiedSubjectAndSession(claims: unknown): boolean {
  const record =
    typeof claims === "object" && claims !== null
      ? (claims as Record<string, unknown>)
      : null;

  return (
    typeof record?.sub === "string" &&
    record.sub.length > 0 &&
    typeof record.session_id === "string" &&
    record.session_id.length > 0
  );
}

async function signOutSilently(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  scope?: "global",
): Promise<void> {
  const options = scope ? { scope } : undefined;

  await supabase.auth.signOut(options).catch(() => {
    // Password update success is not rolled back by local cookie cleanup errors.
  });
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
