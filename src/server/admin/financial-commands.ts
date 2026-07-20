import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import type { LedgerPublicResultCode } from "@/lib/ledger/public-results";
import { validateAtomicUnitsString } from "@/lib/ledger/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inspectAdminAccess } from "@/server/auth/admin-guard";
import type { Database } from "@/types/database.types";

export type PostOpeningBalanceInput = {
  walletAccountId: string;
  walletExpectedVersion: number;
  assetId: string;
  assetExpectedVersion: number;
  units: string;
  commandId: string;
  reason: string;
};

export type ReverseOpeningBalanceInput = {
  originalJournalId: string;
  commandId: string;
  reason: string;
};

export type FinancialCommandResult = {
  resultCode: string;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  journalId: string | null;
  originalJournalId: string | null;
  walletAccountId: string | null;
  assetId: string | null;
  units: string | null;
  postedAt: string | null;
};

export type FinancialCommandExecution =
  | { ok: true; result: FinancialCommandResult }
  | { ok: false; error: LedgerPublicResultCode | PublicAuthErrorCode };

type PostOpeningBalanceRow =
  Database["public"]["Functions"]["post_opening_balance"]["Returns"][number];
type ReverseOpeningBalanceRow =
  Database["public"]["Functions"]["reverse_opening_balance"]["Returns"][number];
type AdminBalanceRow =
  Database["public"]["Functions"]["list_admin_wallet_asset_ledger_balances"]["Returns"][number];
type AdminJournalRow =
  Database["public"]["Functions"]["list_admin_ledger_journals"]["Returns"][number];
type FinancialAuditRow =
  Database["public"]["Functions"]["list_financial_admin_audit_events"]["Returns"][number];

export type AdminWalletAssetLedgerBalance = {
  walletAccountId: string;
  targetUserId: string;
  walletStatus: string;
  profileStatus: string;
  assetId: string;
  assetCode: string;
  symbol: string;
  decimals: number;
  availableUnits: string;
  lockedUnits: string;
  pendingDepositUnits: string;
  pendingWithdrawalUnits: string;
  totalLiabilityUnits: string;
};

export type AdminLedgerJournal = {
  journalId: string;
  commandId: string;
  assetId: string;
  assetCode: string;
  symbol: string;
  journalType: string;
  initiatorType: string;
  initiatorUserId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string;
  debitTotalUnits: string;
  creditTotalUnits: string;
  entryCount: number;
  postedAt: string;
  reversed: boolean;
  reversalJournalId: string | null;
};

export type FinancialAuditEvent = {
  eventId: string;
  commandId: string;
  action: string;
  outcome: string;
  actorUserId: string;
  targetUserId: string;
  walletAccountId: string;
  assetId: string;
  originalJournalId: string | null;
  resultingJournalId: string | null;
  reason: string;
  unitsText: string;
  occurredAt: string;
};

export type AdminLedgerOverviewResult =
  | {
      ok: true;
      balances: AdminWalletAssetLedgerBalance[];
      journals: AdminLedgerJournal[];
      auditEvents: FinancialAuditEvent[];
    }
  | { ok: false; error: LedgerPublicResultCode | PublicAuthErrorCode };

export async function postOpeningBalance(
  input: PostOpeningBalanceInput,
): Promise<FinancialCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("post_opening_balance", {
    p_wallet_account_id: input.walletAccountId,
    p_wallet_expected_version: input.walletExpectedVersion,
    p_asset_id: input.assetId,
    p_asset_expected_version: input.assetExpectedVersion,
    p_units: input.units,
    p_command_id: input.commandId,
    p_reason: input.reason,
  });

  if (response.error) {
    return { ok: false, error: mapCommandRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;
  const result = row ? normalizePostOpeningBalanceRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "financial_command_unavailable" };
}

export async function reverseOpeningBalance(
  input: ReverseOpeningBalanceInput,
): Promise<FinancialCommandExecution> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const response = await supabase.rpc("reverse_opening_balance", {
    p_original_journal_id: input.originalJournalId,
    p_command_id: input.commandId,
    p_reason: input.reason,
  });

  if (response.error) {
    return { ok: false, error: mapCommandRpcError(response.error) };
  }

  const row = response.data?.[0] ?? null;
  const result = row ? normalizeReverseOpeningBalanceRow(row) : null;

  return result
    ? { ok: true, result }
    : { ok: false, error: "financial_command_unavailable" };
}

export async function listAdminLedgerOverview(): Promise<AdminLedgerOverviewResult> {
  const supabase = await createServerSupabaseClient();
  const access = await inspectAdminAccess(supabase);

  if (access.status !== "ready") {
    return { ok: false, error: mapAdminAccessError(access.status) };
  }

  const [balances, journals, auditEvents] = await Promise.all([
    supabase.rpc("list_admin_wallet_asset_ledger_balances", {
      p_limit: 100,
    }),
    supabase.rpc("list_admin_ledger_journals", {
      p_limit: 50,
    }),
    supabase.rpc("list_financial_admin_audit_events", {
      p_limit: 25,
    }),
  ]);

  if (balances.error || journals.error) {
    return { ok: false, error: "financial_command_unavailable" };
  }

  if (auditEvents.error) {
    return { ok: false, error: "financial_audit_unavailable" };
  }

  return {
    ok: true,
    balances: (balances.data ?? []).map(normalizeAdminBalanceRow),
    journals: (journals.data ?? []).map(normalizeAdminJournalRow),
    auditEvents: (auditEvents.data ?? []).map(normalizeFinancialAuditRow),
  };
}

function normalizePostOpeningBalanceRow(
  row: PostOpeningBalanceRow,
): FinancialCommandResult | null {
  return normalizeCommandResult({
    resultCode: row.result_code,
    replayed: row.replayed,
    eventId: row.event_id,
    commandId: row.command_id,
    journalId: row.journal_id,
    originalJournalId: null,
    walletAccountId: row.wallet_account_id,
    assetId: row.asset_id,
    units: row.units,
    postedAt: row.posted_at,
  });
}

function normalizeReverseOpeningBalanceRow(
  row: ReverseOpeningBalanceRow,
): FinancialCommandResult | null {
  return normalizeCommandResult({
    resultCode: row.result_code,
    replayed: row.replayed,
    eventId: row.event_id,
    commandId: row.command_id,
    journalId: row.reversal_journal_id,
    originalJournalId: row.original_journal_id,
    walletAccountId: row.wallet_account_id,
    assetId: row.asset_id,
    units: row.units,
    postedAt: row.posted_at,
  });
}

function normalizeCommandResult(row: {
  resultCode: string;
  replayed: boolean;
  eventId: string | null;
  commandId: string | null;
  journalId: string | null;
  originalJournalId: string | null;
  walletAccountId: string | null;
  assetId: string | null;
  units: string | null;
  postedAt: string | null;
}): FinancialCommandResult | null {
  if (typeof row.resultCode !== "string") {
    return null;
  }

  if (row.units !== null && !validateAtomicUnitsString(row.units)) {
    return null;
  }

  return {
    resultCode: row.resultCode,
    replayed: row.replayed === true,
    eventId: row.eventId ?? null,
    commandId: row.commandId ?? null,
    journalId: row.journalId ?? null,
    originalJournalId: row.originalJournalId ?? null,
    walletAccountId: row.walletAccountId ?? null,
    assetId: row.assetId ?? null,
    units: row.units ?? null,
    postedAt: row.postedAt ?? null,
  };
}

function normalizeAdminBalanceRow(
  row: AdminBalanceRow,
): AdminWalletAssetLedgerBalance {
  return {
    walletAccountId: row.wallet_account_id,
    targetUserId: row.target_user_id,
    walletStatus: row.wallet_status,
    profileStatus: row.profile_status,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    decimals: row.decimals,
    availableUnits: normalizeNonNegativeUnits(row.available_units),
    lockedUnits: normalizeNonNegativeUnits(row.locked_units),
    pendingDepositUnits: normalizeNonNegativeUnits(row.pending_deposit_units),
    pendingWithdrawalUnits: normalizeNonNegativeUnits(
      row.pending_withdrawal_units,
    ),
    totalLiabilityUnits: normalizeNonNegativeUnits(
      row.total_liability_units,
    ),
  };
}

function normalizeAdminJournalRow(row: AdminJournalRow): AdminLedgerJournal {
  return {
    journalId: row.journal_id,
    commandId: row.command_id,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    symbol: row.symbol,
    journalType: row.journal_type,
    initiatorType: row.initiator_type,
    initiatorUserId: row.initiator_user_id ?? null,
    referenceType: row.reference_type ?? null,
    referenceId: row.reference_id ?? null,
    reason: row.reason,
    debitTotalUnits: normalizeNonNegativeUnits(row.debit_total_units),
    creditTotalUnits: normalizeNonNegativeUnits(row.credit_total_units),
    entryCount: row.entry_count,
    postedAt: row.posted_at,
    reversed: row.reversed === true,
    reversalJournalId: row.reversal_journal_id ?? null,
  };
}

function normalizeFinancialAuditRow(
  row: FinancialAuditRow,
): FinancialAuditEvent {
  return {
    eventId: row.event_id,
    commandId: row.command_id,
    action: row.action,
    outcome: row.outcome,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id,
    walletAccountId: row.wallet_account_id,
    assetId: row.asset_id,
    originalJournalId: row.original_journal_id ?? null,
    resultingJournalId: row.resulting_journal_id ?? null,
    reason: row.reason,
    unitsText: normalizeNonNegativeUnits(row.units_text),
    occurredAt: row.occurred_at,
  };
}

function normalizeNonNegativeUnits(value: string): string {
  return /^(0|[1-9][0-9]{0,37})$/.test(value) ? value : "0";
}

function mapAdminAccessError(
  status: Exclude<
    Awaited<ReturnType<typeof inspectAdminAccess>>["status"],
    "ready"
  >,
): PublicAuthErrorCode {
  switch (status) {
    case "anonymous":
      return "invalid_credentials";
    case "inactive":
      return "account_restricted";
    case "missing_profile":
      return "account_unavailable";
    case "not_admin":
      return "admin_forbidden";
    case "mfa_enrollment_required":
      return "mfa_enrollment_required";
    case "mfa_challenge_required":
      return "mfa_challenge_required";
    case "unavailable":
      return "mfa_unavailable";
  }
}

function mapCommandRpcError(error: {
  code?: string;
}): LedgerPublicResultCode {
  return error.code === "42501"
    ? "financial_command_forbidden"
    : "financial_command_unavailable";
}
