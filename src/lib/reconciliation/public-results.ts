export type ReconciliationReviewCommandErrorCode =
  | "invalid_request"
  | "admin_authentication_required"
  | "admin_role_required"
  | "admin_aal2_required"
  | "reconciliation_item_not_found"
  | "reconciliation_item_not_reviewable"
  | "reconciliation_review_already_exists"
  | "reconciliation_review_not_found"
  | "reconciliation_review_version_conflict"
  | "reconciliation_review_terminal"
  | "reconciliation_review_transition_invalid"
  | "reconciliation_review_idempotency_conflict"
  | "reconciliation_review_state_invalid"
  | "reconciliation_review_unavailable";

const RECONCILIATION_REVIEW_PUBLIC_MESSAGES: Record<
  ReconciliationReviewCommandErrorCode,
  string
> = {
  invalid_request: "Check the submitted review command values.",
  admin_authentication_required: "Sign in before using admin commands.",
  admin_role_required: "Administrator access is required.",
  admin_aal2_required: "A verified administrator MFA session is required.",
  reconciliation_item_not_found: "Reconciliation item was not found.",
  reconciliation_item_not_reviewable:
    "Reconciliation item is not reviewable.",
  reconciliation_review_already_exists:
    "A review case already exists for this reconciliation item.",
  reconciliation_review_not_found: "Reconciliation review was not found.",
  reconciliation_review_version_conflict:
    "Reconciliation review version is no longer current.",
  reconciliation_review_terminal:
    "Terminal reconciliation review cases cannot transition.",
  reconciliation_review_transition_invalid:
    "Reconciliation review status transition is not allowed.",
  reconciliation_review_idempotency_conflict:
    "Idempotency key has already been used differently.",
  reconciliation_review_state_invalid:
    "Reconciliation review state is inconsistent.",
  reconciliation_review_unavailable:
    "Reconciliation review command is unavailable.",
};

export function getReconciliationReviewPublicMessage(
  code: string | null | undefined,
): string | null {
  return code && isReconciliationReviewCommandErrorCode(code)
    ? RECONCILIATION_REVIEW_PUBLIC_MESSAGES[code]
    : null;
}

export function isReconciliationReviewCommandErrorCode(
  code: string,
): code is ReconciliationReviewCommandErrorCode {
  return Object.hasOwn(RECONCILIATION_REVIEW_PUBLIC_MESSAGES, code);
}
