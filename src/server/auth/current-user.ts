import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

const ACCOUNT_STATUSES = [
  "ACTIVE",
  "RESTRICTED",
  "SUSPENDED",
  "WITHDRAWN",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type CurrentUserProfile = {
  id: string;
  displayName: string | null;
  accountStatus: AccountStatus;
  version: number;
};

export type CurrentUserResult =
  | { status: "anonymous" }
  | { status: "missing_profile" }
  | { status: "ready"; profile: CurrentUserProfile };

export async function getCurrentUserProfile(): Promise<CurrentUserResult> {
  const supabase = await createServerSupabaseClient();

  return getCurrentUserProfileFromClient(supabase);
}

export async function getCurrentUserProfileFromClient(
  supabase: SupabaseClient<Database>,
): Promise<CurrentUserResult> {
  const claimsResult = await supabase.auth.getClaims();
  const userId = claimsResult.data?.claims.sub;

  if (claimsResult.error || typeof userId !== "string" || !userId) {
    return { status: "anonymous" };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, account_status, version")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data || !isAccountStatus(data.account_status)) {
    return { status: "missing_profile" };
  }

  return {
    status: "ready",
    profile: {
      id: data.id,
      displayName: data.display_name,
      accountStatus: data.account_status,
      version: data.version,
    },
  };
}

export function isActiveProfile(result: CurrentUserResult): boolean {
  return (
    result.status === "ready" &&
    result.profile.accountStatus === "ACTIVE"
  );
}

function isAccountStatus(value: string): value is AccountStatus {
  return (ACCOUNT_STATUSES as readonly string[]).includes(value);
}
