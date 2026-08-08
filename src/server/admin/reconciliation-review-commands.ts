import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import type { ReconciliationReviewCommandErrorCode } from "@/lib/reconciliation/public-results";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

export type ReconciliationReviewAdminCommandInput =
  | {
      action: "open_review";
      reconciliationItemId: string;
      idempotencyKey: string;
      reasonCode: string;
    }
  | {
      action: "transition_review";
      reviewCaseId: string;
      expectedVersion: number;
      targetStatus: string;
      idempotencyKey: string;
      reasonCode: string;
    };

export type ReconciliationReviewCommandResult = {
  reviewCaseId: string;
  eventId: string;
  created: boolean;
  status: string;
  version: number;
};

export type ReconciliationReviewCommandError = {
  code: ReconciliationReviewCommandErrorCode;
  httpStatus: number;
};

export type ReconciliationReviewCommandExecution =
  | { ok: true; result: ReconciliationReviewCommandResult }
  | { ok: false; error: ReconciliationReviewCommandError };

type OpenCommandRow =
  Database["public"]["Functions"]["admin_open_review_case"]["Returns"][number];
type TransitionCommandRow =
  Database["public"]["Functions"]["admin_transition_review_case"]["Returns"][number];
type ReconciliationReviewRpcDomainErrorCode =
  | "reconciliation_resolution_idempotency_key_invalid"
  | "reconciliation_resolution_reason_code_invalid"
  | "reconciliation_resolution_expected_version_invalid"
  | "reconciliation_resolution_status_invalid"
  | "reconciliation_review_target_status_invalid"
  | "reconciliation_item_not_found"
  | "reconciliation_resolution_not_found"
  | "reconciliation_item_not_reviewable"
  | "reconciliation_resolution_already_exists"
  | "reconciliation_resolution_idempotency_conflict"
  | "reconciliation_resolution_version_conflict"
  | "reconciliation_resolution_terminal"
  | "reconciliation_resolution_transition_invalid"
  | "reconciliation_resolution_existing_state_invalid";

export async function executeReconciliationReviewAdminCommand(
  input: ReconciliationReviewAdminCommandInput,
): Promise<ReconciliationReviewCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response =
    input.action === "open_review"
      ? await supabase.rpc("admin_open_review_case", {
          p_reconciliation_item_id: input.reconciliationItemId,
          p_idempotency_key: input.idempotencyKey,
          p_reason_code: input.reasonCode,
        })
      : await supabase.rpc("admin_transition_review_case", {
          p_review_case_id: input.reviewCaseId,
          p_expected_version: input.expectedVersion,
          p_target_status: input.targetStatus,
          p_idempotency_key: input.idempotencyKey,
          p_reason_code: input.reasonCode,
        });

  if (response.error) {
    return { ok: false, error: mapRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;

  return row
    ? { ok: true, result: normalizeCommandRow(row) }
    : {
        ok: false,
        error: {
          code: "reconciliation_review_unavailable",
          httpStatus: 500,
        },
      };
}

function normalizeCommandRow(
  row: OpenCommandRow | TransitionCommandRow,
): ReconciliationReviewCommandResult {
  return {
    reviewCaseId: row.review_case_id,
    eventId: row.event_id,
    created: row.created === true,
    status: row.status,
    version: Number(row.version),
  };
}

function mapAdminAccessError(
  status: Exclude<
    Awaited<ReturnType<typeof inspectAdminAccess>>["status"],
    "ready"
  >,
): ReconciliationReviewCommandError {
  switch (status) {
    case "anonymous":
      return {
        code: "admin_authentication_required",
        httpStatus: 401,
      };
    case "inactive":
    case "missing_profile":
    case "not_admin":
      return {
        code: "admin_role_required",
        httpStatus: 403,
      };
    case "mfa_enrollment_required":
    case "mfa_challenge_required":
      return {
        code: "admin_aal2_required",
        httpStatus: 403,
      };
    case "unavailable":
      return {
        code: "reconciliation_review_unavailable",
        httpStatus: 503,
      };
  }
}

function mapRpcError(
  error: PostgrestError,
): ReconciliationReviewCommandError {
  const domainCode = readRpcDomainErrorCode(error);

  switch (domainCode) {
    case "reconciliation_resolution_idempotency_key_invalid":
    case "reconciliation_resolution_reason_code_invalid":
    case "reconciliation_resolution_expected_version_invalid":
    case "reconciliation_resolution_status_invalid":
    case "reconciliation_review_target_status_invalid":
      return { code: "invalid_request", httpStatus: 400 };
    case "reconciliation_item_not_found":
      return { code: "reconciliation_item_not_found", httpStatus: 404 };
    case "reconciliation_resolution_not_found":
      return { code: "reconciliation_review_not_found", httpStatus: 404 };
    case "reconciliation_item_not_reviewable":
      return {
        code: "reconciliation_item_not_reviewable",
        httpStatus: 409,
      };
    case "reconciliation_resolution_already_exists":
      return {
        code: "reconciliation_review_already_exists",
        httpStatus: 409,
      };
    case "reconciliation_resolution_idempotency_conflict":
      return {
        code: "reconciliation_review_idempotency_conflict",
        httpStatus: 409,
      };
    case "reconciliation_resolution_version_conflict":
      return {
        code: "reconciliation_review_version_conflict",
        httpStatus: 409,
      };
    case "reconciliation_resolution_terminal":
      return {
        code: "reconciliation_review_terminal",
        httpStatus: 409,
      };
    case "reconciliation_resolution_transition_invalid":
      return {
        code: "reconciliation_review_transition_invalid",
        httpStatus: 409,
      };
    case "reconciliation_resolution_existing_state_invalid":
      return {
        code: "reconciliation_review_state_invalid",
        httpStatus: 409,
      };
  }

  if (error.code === "42501") {
    return { code: "admin_aal2_required", httpStatus: 403 };
  }

  if (error.code === "22023") {
    return { code: "invalid_request", httpStatus: 400 };
  }

  if (error.code === "23505") {
    return {
      code: "reconciliation_review_idempotency_conflict",
      httpStatus: 409,
    };
  }

  if (error.code === "23503") {
    return {
      code: "reconciliation_review_not_found",
      httpStatus: 404,
    };
  }

  if (error.code === "23514") {
    return {
      code: "reconciliation_review_state_invalid",
      httpStatus: 409,
    };
  }

  return {
    code: "reconciliation_review_unavailable",
    httpStatus: 500,
  };
}

function readRpcDomainErrorCode(
  error: PostgrestError,
): ReconciliationReviewRpcDomainErrorCode | null {
  for (const value of [error.message, error.details, error.hint]) {
    if (isReconciliationReviewRpcDomainErrorCode(value)) {
      return value;
    }
  }

  return null;
}

function isReconciliationReviewRpcDomainErrorCode(
  value: string | null | undefined,
): value is ReconciliationReviewRpcDomainErrorCode {
  switch (value) {
    case "reconciliation_resolution_idempotency_key_invalid":
    case "reconciliation_resolution_reason_code_invalid":
    case "reconciliation_resolution_expected_version_invalid":
    case "reconciliation_resolution_status_invalid":
    case "reconciliation_review_target_status_invalid":
    case "reconciliation_item_not_found":
    case "reconciliation_resolution_not_found":
    case "reconciliation_item_not_reviewable":
    case "reconciliation_resolution_already_exists":
    case "reconciliation_resolution_idempotency_conflict":
    case "reconciliation_resolution_version_conflict":
    case "reconciliation_resolution_terminal":
    case "reconciliation_resolution_transition_invalid":
    case "reconciliation_resolution_existing_state_invalid":
      return true;
    default:
      return false;
  }
}
