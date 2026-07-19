import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  evaluateAccountStatus,
  isInactiveAccountStatus,
  type InactiveAccountStatus,
} from "@/server/auth/account-policy";
import type { Database } from "@/types/database.types";

type AccountProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type ActiveAccountProfile = {
  id: string;
  displayName: string | null;
  accountStatus: "ACTIVE";
  version: number;
};

export type AccountGuardResult =
  | { status: "anonymous" }
  | { status: "active"; userId: string; profile: ActiveAccountProfile }
  | {
      status: "inactive";
      accountStatus?: InactiveAccountStatus;
      reason: "restricted" | "suspended" | "withdrawn" | "unknown_status";
    }
  | { status: "missing_profile" }
  | { status: "unavailable" };

export async function getCurrentAccountAccess(): Promise<AccountGuardResult> {
  const supabase = await createServerSupabaseClient();

  return inspectAccountAccess(supabase);
}

export async function inspectAccountAccess(
  supabase: SupabaseClient<Database>,
  verifiedClaims?: unknown,
): Promise<AccountGuardResult> {
  const claimsResult =
    verifiedClaims === undefined
      ? await readVerifiedClaims(supabase)
      : { status: "ready" as const, claims: verifiedClaims };

  if (claimsResult.status !== "ready") {
    return { status: claimsResult.status };
  }

  const userId = getClaimSubject(claimsResult.claims);

  if (!userId) {
    return { status: "anonymous" };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, account_status, version")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { status: "unavailable" };
  }

  if (!data) {
    return { status: "missing_profile" };
  }

  return mapProfileRow(userId, data);
}

async function readVerifiedClaims(
  supabase: SupabaseClient<Database>,
): Promise<
  | { status: "ready"; claims: unknown }
  | { status: "anonymous" }
  | { status: "unavailable" }
> {
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    return isMissingAuthSessionError(error)
      ? { status: "anonymous" }
      : { status: "unavailable" };
  }

  return { status: "ready", claims: data?.claims };
}

function mapProfileRow(
  userId: string,
  profile: Pick<
    AccountProfileRow,
    "id" | "display_name" | "account_status" | "version"
  >,
): AccountGuardResult {
  const decision = evaluateAccountStatus(profile.account_status);

  if (decision.allowed) {
    return {
      status: "active",
      userId,
      profile: {
        id: profile.id,
        displayName: profile.display_name,
        accountStatus: decision.status,
        version: profile.version,
      },
    };
  }

  return {
    status: "inactive",
    ...(isInactiveAccountStatus(profile.account_status)
      ? { accountStatus: profile.account_status }
      : {}),
    reason: decision.reason,
  };
}

function getClaimSubject(claims: unknown): string | null {
  const claimRecord = asRecord(claims);
  const subject = claimRecord?.sub;

  return typeof subject === "string" && subject.length > 0
    ? subject
    : null;
}

function isMissingAuthSessionError(error: unknown): boolean {
  const record = asRecord(error);
  const code = record?.code;
  const name = record?.name;
  const message = record?.message;

  return (
    code === "session_not_found" ||
    code === "no_session" ||
    name === "AuthSessionMissingError" ||
    (typeof message === "string" &&
      message.toLowerCase().includes("auth session missing"))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
