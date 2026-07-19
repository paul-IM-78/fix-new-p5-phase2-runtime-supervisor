export type AdminMfaAalLevel = "aal1" | "aal2";

export type AdminMfaPolicyInput = {
  currentLevel: AdminMfaAalLevel | null;
  nextLevel: AdminMfaAalLevel | null;
  verifiedTotpFactorCount: number;
  unverifiedTotpFactorCount: number;
};

export type AdminMfaDecision =
  | { status: "enrollment_required" }
  | { status: "challenge_required"; factorIdRequired: true }
  | { status: "ready" }
  | { status: "invalid_state" };

export function evaluateAdminMfaPolicy(
  input: AdminMfaPolicyInput,
): AdminMfaDecision {
  const {
    currentLevel,
    nextLevel,
    verifiedTotpFactorCount,
    unverifiedTotpFactorCount,
  } = input;

  if (
    !Number.isInteger(verifiedTotpFactorCount) ||
    !Number.isInteger(unverifiedTotpFactorCount) ||
    verifiedTotpFactorCount < 0 ||
    unverifiedTotpFactorCount < 0 ||
    verifiedTotpFactorCount > 1
  ) {
    return { status: "invalid_state" };
  }

  if (
    currentLevel === "aal1" &&
    nextLevel === "aal1" &&
    verifiedTotpFactorCount === 0
  ) {
    return { status: "enrollment_required" };
  }

  if (
    currentLevel === "aal1" &&
    nextLevel === "aal2" &&
    verifiedTotpFactorCount === 1
  ) {
    return { status: "challenge_required", factorIdRequired: true };
  }

  if (
    currentLevel === "aal2" &&
    nextLevel === "aal2" &&
    verifiedTotpFactorCount === 1
  ) {
    return { status: "ready" };
  }

  return { status: "invalid_state" };
}

export function normalizeAdminMfaAalLevel(
  value: string | null,
): AdminMfaAalLevel | null {
  if (value === "aal1" || value === "aal2") {
    return value;
  }

  return null;
}
