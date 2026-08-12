import "server-only";

import {
  encodeCustodyObserverListCursor,
  type AdminCustodyObserverListQuery,
} from "@/lib/custody/operational-read-validation";
import {
  normalizeCustodyObserverDetailPayload,
  normalizeCustodyObserverListPayload,
  type CustodyObserverDetailResult,
  type CustodyObserverListResult,
  type CustodyObserverReadErrorCode,
} from "@/lib/custody/operational-read-public-results";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";

export const CUSTODY_OBSERVER_STALE_THRESHOLD_MS = 15 * 60 * 1000;

type CustodyObserverReadError = {
  code: CustodyObserverReadErrorCode;
  httpStatus: number;
};

export type CustodyObserverReadExecution<T> =
  | { ok: true; result: T }
  | { ok: false; error: CustodyObserverReadError };

export async function listAdminCustodyObserverRuns(
  input: AdminCustodyObserverListQuery,
): Promise<CustodyObserverReadExecution<CustodyObserverListResult>> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("list_admin_custody_observer_runs", {
    p_limit: input.limit,
    p_cutoff: createCustodyObserverStaleCutoff(),
    p_before_created_at: input.cursor?.createdAt,
    p_before_run_id: input.cursor?.runId,
    p_status: input.status ?? undefined,
    p_stale: input.stale ?? undefined,
    p_severity: input.severity ?? undefined,
    p_alert_eligible: input.alertEligible ?? undefined,
  });

  if (response.error) {
    return { ok: false, error: readFailure() };
  }

  const payload = normalizeCustodyObserverListPayload(response.data);
  if (!payload) {
    return { ok: false, error: readFailure() };
  }

  return {
    ok: true,
    result: {
      items: payload.items,
      totalCount: payload.totalCount,
      nextCursor:
        payload.nextCursorCreatedAt && payload.nextCursorRunId
          ? encodeCustodyObserverListCursor({
              createdAt: payload.nextCursorCreatedAt,
              runId: payload.nextCursorRunId,
            })
          : null,
    },
  };
}

export async function getAdminCustodyObserverRunDetail(
  runId: string,
): Promise<CustodyObserverReadExecution<CustodyObserverDetailResult>> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("get_admin_custody_observer_run_detail", {
    p_run_id: runId,
    p_cutoff: createCustodyObserverStaleCutoff(),
  });

  if (response.error) {
    return { ok: false, error: readFailure() };
  }

  if (response.data === null) {
    return {
      ok: false,
      error: { code: "custody_observer_run_not_found", httpStatus: 404 },
    };
  }

  const result = normalizeCustodyObserverDetailPayload(response.data);
  return result
    ? { ok: true, result }
    : { ok: false, error: readFailure() };
}

export function createCustodyObserverStaleCutoff(now = new Date()): string {
  return new Date(now.getTime() - CUSTODY_OBSERVER_STALE_THRESHOLD_MS).toISOString();
}

function mapAdminAccessError(
  status: Exclude<
    Awaited<ReturnType<typeof inspectAdminAccess>>["status"],
    "ready"
  >,
): CustodyObserverReadError {
  switch (status) {
    case "anonymous":
      return { code: "authentication_required", httpStatus: 401 };
    case "inactive":
    case "missing_profile":
    case "not_admin":
      return { code: "admin_access_required", httpStatus: 403 };
    case "mfa_enrollment_required":
    case "mfa_challenge_required":
      return { code: "admin_aal2_required", httpStatus: 403 };
    case "unavailable":
      return readFailure();
  }
}

function readFailure(): CustodyObserverReadError {
  return { code: "custody_observer_read_failed", httpStatus: 500 };
}
