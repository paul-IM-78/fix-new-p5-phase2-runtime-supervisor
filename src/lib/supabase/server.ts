import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getServerEnv } from "@/server/config/env";

const COOKIE_WRITE_CONTEXT_PATTERNS = [
  "Cookies can only be modified",
  "ReadonlyRequestCookies",
  "outside a Server Action",
] as const;

export async function createServerSupabaseClient() {
  const env = getServerEnv();
  const cookieStore = await cookies();

  return createServerClient(
    env.supabaseUrl,
    env.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            try {
              cookieStore.set(name, value, options);
            } catch (error) {
              // Auth session refresh belongs in a later proxy task.
              if (isCookieWriteContextError(error)) {
                continue;
              }

              throw error;
            }
          }
        },
      },
    },
  );
}

function isCookieWriteContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    COOKIE_WRITE_CONTEXT_PATTERNS.some((pattern) =>
      error.message.includes(pattern),
    )
  );
}
