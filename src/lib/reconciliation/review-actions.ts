export type ReconciliationReviewActionKind =
  | "OPEN_REVIEW"
  | "START_REVIEW"
  | "RESOLVE_REVIEW"
  | "IGNORE_REVIEW";

export type ReconciliationReviewTargetStatus =
  | "IN_REVIEW"
  | "RESOLVED"
  | "IGNORED";

export type ReconciliationReviewReasonCode =
  | "BALANCE_MISMATCH_REVIEW_OPENED"
  | "OBSERVATION_FAILURE_REVIEW_OPENED"
  | "MANUAL_REVIEW_STARTED"
  | "REVIEW_ASSESSMENT_COMPLETED"
  | "NO_FURTHER_REVIEW_REQUIRED";

export type ReconciliationReviewActionCandidate = {
  kind: ReconciliationReviewActionKind;
  label: string;
  description: string;
  isTerminal: boolean;
  reasonCode: ReconciliationReviewReasonCode;
  targetStatus: ReconciliationReviewTargetStatus | null;
};

export type ReconciliationReviewActionState = {
  classification: string;
  reviewCase: {
    id: string;
    status: string;
    version: number;
  } | null;
};

export const RECONCILIATION_REVIEW_REASON_CODE_CATALOG_VERSION = "V1";
export const RECONCILIATION_REVIEW_REASON_CODE_INPUT_MODE = "SYSTEM_DERIVED";

const OPEN_REVIEW_ACTIONS: Record<
  string,
  ReconciliationReviewActionCandidate
> = {
  MISMATCH: {
    kind: "OPEN_REVIEW",
    label: "Open Review",
    description:
      "Open a manual review case for this balance mismatch item. This does not change reconciliation, ledger, balance, or observation data.",
    isTerminal: false,
    reasonCode: "BALANCE_MISMATCH_REVIEW_OPENED",
    targetStatus: null,
  },
  OBSERVATION_FAILED: {
    kind: "OPEN_REVIEW",
    label: "Open Review",
    description:
      "Open a manual review case for this observation failure item. This does not confirm that a real balance difference exists.",
    isTerminal: false,
    reasonCode: "OBSERVATION_FAILURE_REVIEW_OPENED",
    targetStatus: null,
  },
};

const TRANSITION_ACTIONS: Record<
  ReconciliationReviewTargetStatus,
  ReconciliationReviewActionCandidate
> = {
  IN_REVIEW: {
    kind: "START_REVIEW",
    label: "Start Review",
    description:
      "Mark this case as actively under manual review. This does not complete root cause analysis or remediation.",
    isTerminal: false,
    reasonCode: "MANUAL_REVIEW_STARTED",
    targetStatus: "IN_REVIEW",
  },
  RESOLVED: {
    kind: "RESOLVE_REVIEW",
    label: "Resolve",
    description:
      "Close this review workflow as assessed. This does not recover funds, post ledger entries, overwrite observations, or rerun reconciliation.",
    isTerminal: true,
    reasonCode: "REVIEW_ASSESSMENT_COMPLETED",
    targetStatus: "RESOLVED",
  },
  IGNORED: {
    kind: "IGNORE_REVIEW",
    label: "Ignore",
    description:
      "Close this review workflow without further review. This does not mean the original reconciliation classification changed.",
    isTerminal: true,
    reasonCode: "NO_FURTHER_REVIEW_REQUIRED",
    targetStatus: "IGNORED",
  },
};

export function getReconciliationReviewActionCandidates({
  classification,
  reviewCase,
}: ReconciliationReviewActionState): ReconciliationReviewActionCandidate[] {
  if (!reviewCase) {
    const action = OPEN_REVIEW_ACTIONS[classification];

    return action ? [action] : [];
  }

  switch (reviewCase.status) {
    case "OPEN":
      return [
        TRANSITION_ACTIONS.IN_REVIEW,
        TRANSITION_ACTIONS.RESOLVED,
        TRANSITION_ACTIONS.IGNORED,
      ];
    case "IN_REVIEW":
      return [
        TRANSITION_ACTIONS.RESOLVED,
        TRANSITION_ACTIONS.IGNORED,
      ];
    default:
      return [];
  }
}

export function shouldShowReconciliationReviewActionSurface(
  state: ReconciliationReviewActionState,
): boolean {
  return (
    state.reviewCase !== null ||
    getReconciliationReviewActionCandidates(state).length > 0
  );
}

export function getReconciliationReviewActionUnavailableMessage({
  classification,
  reviewCase,
}: ReconciliationReviewActionState): string {
  if (!reviewCase) {
    return OPEN_REVIEW_ACTIONS[classification]
      ? "Review action is unavailable."
      : "This item is not reviewable by the current review workflow.";
  }

  if (reviewCase.status === "RESOLVED" || reviewCase.status === "IGNORED") {
    return "This review case is terminal. Reopen is not supported in the current workflow.";
  }

  return "Review action state is unavailable for this item.";
}
