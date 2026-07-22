import "server-only";

import {
  createServerClient,
  type CookieOptions,
} from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

import { getServerEnv } from "@/server/config/env";
import type { Database } from "@/types/database.types";

const COOKIE_WRITE_CONTEXT_PATTERNS = [
  "Cookies can only be modified",
  "ReadonlyRequestCookies",
  "outside a Server Action",
] as const;

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function createServerSupabaseClient() {
  const env = getServerEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
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

export function createRouteSupabaseClient(request: NextRequest) {
  const env = getServerEnv();
  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders = new Headers();

  const supabase = createServerClient<Database>(
    env.supabaseUrl,
    env.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value, options } of cookiesToSet) {
            pendingCookies.push({ name, value, options });
            request.cookies.set(name, value);
          }

          for (const [key, value] of Object.entries(headers)) {
            pendingHeaders.set(key, value);
          }
        },
      },
    },
  );

  return {
    supabase,
    async withCookies<T extends NextResponse>(response: T): Promise<T> {
      for (const { name, value, options } of pendingCookies) {
        response.cookies.set(name, value, options);
      }

      for (const [key, value] of pendingHeaders) {
        response.headers.set(key, value);
      }

      return response;
    },
  };
}

function isCookieWriteContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    COOKIE_WRITE_CONTEXT_PATTERNS.some((pattern) =>
      error.message.includes(pattern),
    )
  );
}
