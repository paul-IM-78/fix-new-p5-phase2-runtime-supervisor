export type AccountStatus =
  | "ACTIVE"
  | "RESTRICTED"
  | "SUSPENDED"
  | "WITHDRAWN";

export type InactiveAccountStatus = Exclude<AccountStatus, "ACTIVE">;

export type AccountAccessDecision =
  | { allowed: true; status: "ACTIVE" }
  | {
      allowed: false;
      reason:
        | "restricted"
        | "suspended"
        | "withdrawn"
        | "unknown_status";
    };

export function evaluateAccountStatus(
  value: unknown,
): AccountAccessDecision {
  switch (value) {
    case "ACTIVE":
      return { allowed: true, status: "ACTIVE" };
    case "RESTRICTED":
      return { allowed: false, reason: "restricted" };
    case "SUSPENDED":
      return { allowed: false, reason: "suspended" };
    case "WITHDRAWN":
      return { allowed: false, reason: "withdrawn" };
    default:
      return { allowed: false, reason: "unknown_status" };
  }
}

export function isInactiveAccountStatus(
  value: unknown,
): value is InactiveAccountStatus {
  return (
    value === "RESTRICTED" ||
    value === "SUSPENDED" ||
    value === "WITHDRAWN"
  );
}
