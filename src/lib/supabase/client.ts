import "client-only";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/config/public-env";

export function createBrowserSupabaseClient() {
  const env = getPublicEnv();

  return createBrowserClient(
    env.supabaseUrl,
    env.supabasePublishableKey,
  );
}
