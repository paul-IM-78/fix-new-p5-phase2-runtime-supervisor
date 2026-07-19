import "client-only";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/config/public-env";
import type { Database } from "@/types/database.types";

export function createBrowserSupabaseClient() {
  const env = getPublicEnv();

  return createBrowserClient<Database>(
    env.supabaseUrl,
    env.supabasePublishableKey,
  );
}
