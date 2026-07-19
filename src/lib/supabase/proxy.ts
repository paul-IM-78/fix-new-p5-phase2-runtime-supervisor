import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/config/public-env";
import type { Database } from "@/types/database.types";

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  const env = getPublicEnv();
  let response = NextResponse.next({
    request,
  });

  // Proxy synchronizes auth cookies only; route guards own authorization.
  const supabase = createServerClient<Database>(
    env.supabaseUrl,
    env.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({
            request,
          });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  await supabase.auth.getClaims();

  // Future redirects must preserve cookies from this response.
  return response;
}
