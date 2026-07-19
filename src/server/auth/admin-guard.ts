import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  inspectAccountAccess,
  type ActiveAccountProfile,
} from "@/server/auth/account-guard";
import {
  evaluateAdminMfaPolicy,
  normalizeAdminMfaAalLevel,
  type AdminMfaAalLevel,
} from "@/server/auth/admin-mfa-policy";
import type { Database } from "@/types/database.types";

type MfaFactor = {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
};

export type AdminIdentityResult =
  | { status: "admin"; profile: ActiveAccountProfile }
  | { status: "anonymous" }
  | { status: "inactive" }
  | { status: "missing_profile" }
  | { status: "not_admin" }
  | { status: "unavailable" };

export type AdminAccessResult =
  | { status: "anonymous" }
  | { status: "inactive" }
  | { status: "missing_profile" }
  | { status: "not_admin" }
  | { status: "mfa_enrollment_required" }
  | {
      status: "mfa_challenge_required";
      factorId: string;
      friendlyName: string | null;
    }
  | {
      status: "ready";
      profile: ActiveAccountProfile;
    }
  | { status: "unavailable" };

export async function getCurrentAdminAccess(): Promise<AdminAccessResult> {
  const supabase = await createServerSupabaseClient();

  return inspectAdminAccess(supabase);
}

export async function inspectAdminIdentity(
  supabase: SupabaseClient<Database>,
): Promise<AdminIdentityResult> {
  const accountAccess = await inspectAccountAccess(supabase);

  switch (accountAccess.status) {
    case "active":
      break;
    case "anonymous":
      return { status: "anonymous" };
    case "inactive":
      return { status: "inactive" };
    case "missing_profile":
      return { status: "missing_profile" };
    case "unavailable":
      return { status: "unavailable" };
  }

  const { data, error } = await supabase.rpc("is_current_user_admin");

  if (error) {
    return { status: "unavailable" };
  }

  if (data !== true) {
    return { status: "not_admin" };
  }

  return { status: "admin", profile: accountAccess.profile };
}

export async function inspectAdminAccess(
  supabase: SupabaseClient<Database>,
): Promise<AdminAccessResult> {
  const identity = await inspectAdminIdentity(supabase);

  if (identity.status !== "admin") {
    return identity;
  }

  const factorsResult = await supabase.auth.mfa.listFactors();

  if (factorsResult.error) {
    return { status: "unavailable" };
  }

  const allFactors: MfaFactor[] = factorsResult.data?.all ?? [];

  if (allFactors.some((factor) => factor.factor_type !== "totp")) {
    return { status: "unavailable" };
  }

  const verifiedTotpFactors = allFactors.filter(isVerifiedTotpFactor);
  const unverifiedTotpFactors = allFactors.filter(isUnverifiedTotpFactor);
  const aalResult =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalResult.error) {
    return { status: "unavailable" };
  }

  const currentLevel = readSupportedAalLevel(
    aalResult.data?.currentLevel ?? null,
  );
  const nextLevel = readSupportedAalLevel(
    aalResult.data?.nextLevel ?? null,
  );

  if (!currentLevel.supported || !nextLevel.supported) {
    return { status: "unavailable" };
  }

  const decision = evaluateAdminMfaPolicy({
    currentLevel: currentLevel.value,
    nextLevel: nextLevel.value,
    verifiedTotpFactorCount: verifiedTotpFactors.length,
    unverifiedTotpFactorCount: unverifiedTotpFactors.length,
  });

  switch (decision.status) {
    case "enrollment_required":
      return { status: "mfa_enrollment_required" };
    case "challenge_required": {
      const factor = verifiedTotpFactors[0];

      return factor
        ? {
            status: "mfa_challenge_required",
            factorId: factor.id,
            friendlyName: factor.friendly_name ?? null,
          }
        : { status: "unavailable" };
    }
    case "ready": {
      const { data, error } = await supabase.rpc(
        "is_current_user_admin_aal2",
      );

      if (error || data !== true) {
        return { status: "unavailable" };
      }

      return { status: "ready", profile: identity.profile };
    }
    case "invalid_state":
      return { status: "unavailable" };
  }
}

function isVerifiedTotpFactor(
  factor: MfaFactor,
): factor is MfaFactor {
  return factor.factor_type === "totp" && factor.status === "verified";
}

function isUnverifiedTotpFactor(
  factor: MfaFactor,
): factor is MfaFactor {
  return factor.factor_type === "totp" && factor.status === "unverified";
}

function readSupportedAalLevel(value: string | null): {
  supported: boolean;
  value: AdminMfaAalLevel | null;
} {
  if (value === null) {
    return { supported: true, value: null };
  }

  const normalized = normalizeAdminMfaAalLevel(value);

  return normalized
    ? { supported: true, value: normalized }
    : { supported: false, value: null };
}
