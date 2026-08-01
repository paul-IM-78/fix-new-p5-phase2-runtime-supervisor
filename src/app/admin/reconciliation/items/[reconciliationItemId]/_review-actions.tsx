"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  getReconciliationReviewPublicMessage,
  type ReconciliationReviewCommandErrorCode,
} from "@/lib/reconciliation/public-results";
import {
  getReconciliationReviewActionCandidates,
  getReconciliationReviewActionUnavailableMessage,
  type ReconciliationReviewActionCandidate,
} from "@/lib/reconciliation/review-actions";

type ReviewCaseActionState = {
  id: string;
  status: string;
  version: number;
};

type ReconciliationReviewActionsProps = {
  classification: string;
  reconciliationItemId: string;
  reviewCase: ReviewCaseActionState | null;
};

type ReviewActionRequest = {
  action: ReconciliationReviewActionCandidate;
  body: Record<string, number | string>;
  path: string;
};

type ReviewActionResult = {
  created: boolean;
  status: string;
  version: number;
};

type ReviewActionResponse =
  | { ok: true; result: ReviewActionResult }
  | { ok: false; code: string };

type Notice = {
  message: string;
  tone: "error" | "neutral" | "success";
};

const OPEN_REVIEW_PATH = "/api/v1/admin/reconciliation/reviews/open";
const TRANSITION_REVIEW_PATH =
  "/api/v1/admin/reconciliation/reviews/transition";

const REFRESH_AFTER_ERROR_CODES = new Set([
  "reconciliation_item_not_found",
  "reconciliation_review_not_found",
  "reconciliation_item_not_reviewable",
  "reconciliation_review_already_exists",
  "reconciliation_review_idempotency_conflict",
  "reconciliation_review_version_conflict",
  "reconciliation_review_terminal",
  "reconciliation_review_transition_invalid",
  "reconciliation_review_state_invalid",
]);

export function ReconciliationReviewActions({
  classification,
  reconciliationItemId,
  reviewCase,
}: ReconciliationReviewActionsProps) {
  const router = useRouter();
  const mountedRef = useRef(true);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [confirmationAction, setConfirmationAction] =
    useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] =
    useState<ReviewActionRequest | null>(null);
  const actions = getReconciliationReviewActionCandidates({
    classification,
    reviewCase,
  });
  const busy = pendingAction !== null || isRefreshing;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (actions.length === 0) {
    return reviewCase ? (
      <ActionMessage tone="neutral">
        {getReconciliationReviewActionUnavailableMessage({
          classification,
          reviewCase,
        })}
      </ActionMessage>
    ) : null;
  }

  function refreshDetail() {
    startRefreshTransition(() => {
      router.refresh();
    });
  }

  async function submitRequest(request: ReviewActionRequest) {
    setPendingAction(request.action.kind);
    setConfirmationAction(null);
    setNotice(null);

    try {
      const response = await fetch(request.path, {
        body: JSON.stringify(request.body),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = await readReviewActionResponse(response);

      if (!mountedRef.current) {
        return;
      }

      setRetryRequest(null);

      if (result.ok) {
        setNotice({
          message: result.result.created
            ? "Review action completed. Refreshing the latest detail."
            : "Review action was already applied. Refreshing the latest detail.",
          tone: "success",
        });
        refreshDetail();
        return;
      }

      setNotice({
        message: getReviewActionErrorMessage(result.code),
        tone: "error",
      });

      if (REFRESH_AFTER_ERROR_CODES.has(result.code)) {
        refreshDetail();
      }
    } catch {
      if (!mountedRef.current) {
        return;
      }

      setRetryRequest(request);
      setNotice({
        message:
          "The network result is unclear. Retry only to resend the same review action.",
        tone: "error",
      });
    } finally {
      if (mountedRef.current) {
        setPendingAction(null);
      }
    }
  }

  function handleAction(action: ReconciliationReviewActionCandidate) {
    if (busy) {
      return;
    }

    if (action.isTerminal && confirmationAction !== action.kind) {
      setConfirmationAction(action.kind);
      setNotice(null);
      setRetryRequest(null);
      return;
    }

    const request = createReviewActionRequest({
      action,
      reconciliationItemId,
      reviewCase,
    });

    if (!request) {
      setNotice({
        message: "Refresh this reconciliation item before trying again.",
        tone: "error",
      });
      refreshDetail();
      return;
    }

    void submitRequest(request);
  }

  function handleRetry() {
    if (!retryRequest || busy) {
      return;
    }

    void submitRequest(retryRequest);
  }

  const confirmingAction =
    confirmationAction === null
      ? null
      : actions.find((action) => action.kind === confirmationAction) ?? null;

  return (
    <div aria-busy={busy} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 text-sm text-zinc-600">
        <p>
          Review actions use the existing ADMIN+AAL2 JSON API route. They only
          change review case state and append review events.
        </p>
        <p>
          These controls do not post ledger entries, correct balances, overwrite
          observations, call providers, or reopen terminal cases.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <button
            className={getActionButtonClassName(action, busy)}
            disabled={busy}
            key={action.kind}
            onClick={() => handleAction(action)}
            type="button"
          >
            {pendingAction === action.kind ? "Working..." : action.label}
          </button>
        ))}
      </div>

      {confirmingAction ? (
        <div
          aria-labelledby="review-action-confirmation-title"
          className="border-l-4 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="group"
        >
          <h3
            className="font-semibold"
            id="review-action-confirmation-title"
          >
            Confirm terminal review action
          </h3>
          <p className="mt-2">{confirmingAction.description}</p>
          <p className="mt-2">
            This terminal state cannot be reopened in the current workflow.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="h-9 border border-zinc-950 bg-zinc-950 px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={() => handleAction(confirmingAction)}
              type="button"
            >
              Confirm {confirmingAction.label}
            </button>
            <button
              className="h-9 border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={() => setConfirmationAction(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {retryRequest ? (
        <button
          className="h-9 w-fit border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          onClick={handleRetry}
          type="button"
        >
          Retry same action
        </button>
      ) : null}

      {busy ? (
        <p className="text-sm text-zinc-600">
          Review action is pending. Other actions are disabled until it finishes.
        </p>
      ) : null}

      {notice ? (
        <ActionMessage tone={notice.tone}>{notice.message}</ActionMessage>
      ) : null}
    </div>
  );
}

function createReviewActionRequest({
  action,
  reconciliationItemId,
  reviewCase,
}: {
  action: ReconciliationReviewActionCandidate;
  reconciliationItemId: string;
  reviewCase: ReviewCaseActionState | null;
}): ReviewActionRequest | null {
  const idempotencyKey = crypto.randomUUID();

  if (action.kind === "OPEN_REVIEW") {
    return {
      action,
      body: {
        idempotencyKey,
        reasonCode: action.reasonCode,
        reconciliationItemId,
      },
      path: OPEN_REVIEW_PATH,
    };
  }

  if (!reviewCase || !action.targetStatus) {
    return null;
  }

  return {
    action,
    body: {
      expectedVersion: reviewCase.version,
      idempotencyKey,
      reasonCode: action.reasonCode,
      reviewCaseId: reviewCase.id,
      targetStatus: action.targetStatus,
    },
    path: TRANSITION_REVIEW_PATH,
  };
}

async function readReviewActionResponse(
  response: Response,
): Promise<ReviewActionResponse> {
  const mediaType = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (mediaType !== "application/json") {
    return { ok: false, code: "reconciliation_review_unavailable" };
  }

  let parsed: unknown;

  try {
    parsed = await response.json();
  } catch {
    return { ok: false, code: "reconciliation_review_unavailable" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, code: "reconciliation_review_unavailable" };
  }

  if (parsed.ok === true && isRecord(parsed.result)) {
    const result = parsed.result;

    if (
      typeof result.created === "boolean" &&
      typeof result.status === "string" &&
      typeof result.version === "number"
    ) {
      return {
        ok: true,
        result: {
          created: result.created,
          status: result.status,
          version: result.version,
        },
      };
    }
  }

  if (
    parsed.ok === false &&
    isRecord(parsed.error) &&
    typeof parsed.error.code === "string"
  ) {
    return { ok: false, code: parsed.error.code };
  }

  return { ok: false, code: "reconciliation_review_unavailable" };
}

function getReviewActionErrorMessage(code: string): string {
  if (code === "request_rejected") {
    return "Review request was rejected. Refresh this page before trying again.";
  }

  const message = getReconciliationReviewPublicMessage(
    code as ReconciliationReviewCommandErrorCode,
  );

  return message ?? "Review action could not be completed.";
}

function getActionButtonClassName(
  action: ReconciliationReviewActionCandidate,
  busy: boolean,
): string {
  const base =
    "h-10 border px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";

  if (busy) {
    return `${base} border-zinc-300 bg-zinc-100 text-zinc-500`;
  }

  if (action.kind === "RESOLVE_REVIEW") {
    return `${base} border-emerald-700 bg-emerald-700 text-white`;
  }

  if (action.kind === "IGNORE_REVIEW") {
    return `${base} border-zinc-500 bg-zinc-700 text-white`;
  }

  return `${base} border-zinc-950 bg-zinc-950 text-white`;
}

function ActionMessage({
  children,
  tone,
}: {
  children: string;
  tone: Notice["tone"];
}) {
  const className =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <p
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`border px-4 py-3 text-sm ${className}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
