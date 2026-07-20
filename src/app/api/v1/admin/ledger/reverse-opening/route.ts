import { NextResponse, type NextRequest } from "next/server";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { LedgerPublicResultCode } from "@/lib/ledger/public-results";
import {
  normalizeFinancialAdminReason,
  validateLedgerCommandId,
  validateLedgerJournalId,
} from "@/lib/ledger/validation";
import {
  reverseOpeningBalance,
  type FinancialCommandResult,
} from "@/server/admin/financial-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return redirectNoStore(
      request,
      "/admin/ledger?error=request_rejected",
    );
  }

  if (!isSupportedFormRequest(request)) {
    return redirectNoStore(request, "/admin/ledger?error=invalid_input");
  }

  const formData = await request.formData();
  const originalJournalId = validateLedgerJournalId(
    formData.get("original_journal_id"),
  );
  const commandId = validateLedgerCommandId(formData.get("command_id"));
  const reason = normalizeFinancialAdminReason(formData.get("reason"));

  if (!originalJournalId || !commandId || !reason) {
    return redirectNoStore(request, "/admin/ledger?error=invalid_input");
  }

  const execution = await reverseOpeningBalance({
    originalJournalId,
    commandId,
    reason,
  });

  if (!execution.ok) {
    return redirectNoStore(
      request,
      getErrorRedirectPath(execution.error),
    );
  }

  return redirectNoStore(
    request,
    getOpeningReversalRedirectPath(execution.result),
  );
}

function getOpeningReversalRedirectPath(
  result: FinancialCommandResult,
): string {
  switch (result.resultCode) {
    case "APPLIED":
      return "/admin/ledger?result=opening_reversal_posted";
    case "NOOP":
      return "/admin/ledger?result=opening_reversal_noop";
    case "OPENING_JOURNAL_NOT_FOUND":
      return "/admin/ledger?error=opening_journal_not_found";
    case "OPENING_JOURNAL_INVALID":
      return "/admin/ledger?error=opening_journal_invalid";
    case "OPENING_JOURNAL_NOT_REVERSIBLE":
      return "/admin/ledger?error=opening_journal_not_reversible";
    case "OPENING_REVERSAL_INSUFFICIENT_AVAILABLE":
      return "/admin/ledger?error=opening_reversal_insufficient_available";
    case "FINANCIAL_COMMAND_ID_CONFLICT":
      return "/admin/ledger?error=financial_command_conflict";
    case "INVALID_INPUT":
      return "/admin/ledger?error=invalid_input";
    default:
      return "/admin/ledger?error=financial_command_unavailable";
  }
}

function getErrorRedirectPath(
  code: LedgerPublicResultCode | PublicAuthErrorCode,
): string {
  switch (code) {
    case "invalid_credentials":
      return "/auth/sign-in?next=/admin/ledger";
    case "account_restricted":
      return "/auth/account-unavailable";
    case "mfa_enrollment_required":
      return "/auth/mfa/enroll";
    case "mfa_challenge_required":
      return "/auth/mfa/challenge";
    case "account_unavailable":
    case "admin_forbidden":
    case "auth_unavailable":
    case "mfa_unavailable":
      return `/auth/error?code=${code}`;
    default:
      return `/admin/ledger?error=${code}`;
  }
}

function isSupportedFormRequest(request: NextRequest): boolean {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  return (
    contentType === "application/x-www-form-urlencoded" ||
    contentType === "multipart/form-data"
  );
}

function redirectNoStore(
  request: NextRequest,
  path: string,
): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), {
    status: 303,
  });

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");

  return response;
}
