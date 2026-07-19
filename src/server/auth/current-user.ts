import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountStatus } from "@/server/auth/account-policy";
import {
  getCurrentAccountAccess,
  inspectAccountAccess,
} from "@/server/auth/account-guard";
import type { Database } from "@/types/database.types";

export type CurrentUserProfile = {
  id: string;
  displayName: string | null;
  accountStatus: AccountStatus;
  version: number;
};

export type CurrentUserResult =
  | { status: "anonymous" }
  | { status: "missing_profile" }
  | { status: "unavailable" }
  | { status: "ready"; profile: CurrentUserProfile };

export async function getCurrentUserProfile(): Promise<CurrentUserResult> {
  const accountAccess = await getCurrentAccountAccess();

  return mapAccountAccessToCurrentUser(accountAccess);
}

export async function getCurrentUserProfileFromClient(
  supabase: SupabaseClient<Database>,
): Promise<CurrentUserResult> {
  const accountAccess = await inspectAccountAccess(supabase);

  return mapAccountAccessToCurrentUser(accountAccess);
}

export function isActiveProfile(result: CurrentUserResult): boolean {
  return (
    result.status === "ready" &&
    result.profile.accountStatus === "ACTIVE"
  );
}

function mapAccountAccessToCurrentUser(
  accountAccess: Awaited<ReturnType<typeof inspectAccountAccess>>,
): CurrentUserResult {
  switch (accountAccess.status) {
    case "active":
      return {
        status: "ready",
        profile: {
          id: accountAccess.profile.id,
          displayName: accountAccess.profile.displayName,
          accountStatus: accountAccess.profile.accountStatus,
          version: accountAccess.profile.version,
        },
      };
    case "anonymous":
      return { status: "anonymous" };
    case "missing_profile":
      return { status: "missing_profile" };
    case "inactive":
    case "unavailable":
      return { status: "unavailable" };
  }
}
