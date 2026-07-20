import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getLedgerPublicMessage } from "@/lib/ledger/public-results";
import {
  listAdminLedgerOverview,
  type AdminLedgerJournal,
  type AdminWalletAssetLedgerBalance,
  type FinancialAuditEvent,
} from "@/server/admin/financial-commands";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

type AdminLedgerPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLedgerPage({
  searchParams,
}: AdminLedgerPageProps) {
  const adminAccess = await getCurrentAdminAccess();

  if (adminAccess.status === "anonymous") {
    redirect("/auth/sign-in?next=/admin/ledger");
  }

  if (adminAccess.status === "inactive") {
    redirect("/auth/account-unavailable");
  }

  if (adminAccess.status === "missing_profile") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (adminAccess.status === "not_admin") {
    redirect("/auth/error?code=admin_forbidden");
  }

  if (adminAccess.status === "mfa_enrollment_required") {
    redirect("/auth/mfa/enroll");
  }

  if (adminAccess.status === "mfa_challenge_required") {
    redirect("/auth/mfa/challenge");
  }

  if (adminAccess.status === "unavailable") {
    redirect("/auth/error?code=mfa_unavailable");
  }

  const params = await searchParams;
  const resultMessage = getLedgerPublicMessage(
    getSingleValue(params.result),
  );
  const errorMessage =
    getLedgerPublicMessage(getSingleValue(params.error)) ??
    getPublicAuthErrorMessage(getSingleValue(params.error));
  const overview = await listAdminLedgerOverview();

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/admin">
            Admin
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Ledger operations
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              AAL2 administrator boundary for one-time Opening Balance
              migration entries and exact Opening reversal. Generic manual
              journals, deposits, withdrawals, staking, rewards, and user
              balance screens are not implemented here.
            </p>
          </div>
        </header>

        {resultMessage ? (
          <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {resultMessage}
          </p>
        ) : null}

        {errorMessage ? (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMessage}
          </p>
        ) : null}

        {overview.ok ? (
          <>
            <section className="grid gap-5 xl:grid-cols-2">
              <OpeningBalanceForm />
              <OpeningReversalForm />
            </section>

            <LedgerBoundaryNotes />
            <BalanceTable balances={overview.balances} />
            <JournalTable journals={overview.journals} />
            <FinancialAuditTable events={overview.auditEvents} />
          </>
        ) : (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {getLedgerPublicMessage(overview.error) ??
              getPublicAuthErrorMessage(overview.error) ??
              "Ledger operations are unavailable."}
          </p>
        )}
      </div>
    </main>
  );
}

function OpeningBalanceForm() {
  return (
    <form
      action="/api/v1/admin/ledger/opening-balance"
      className="flex flex-col gap-4 border border-zinc-200 p-5"
      method="post"
    >
      <input name="command_id" type="hidden" value={randomUUID()} />
      <h2 className="text-lg font-semibold">Opening Balance</h2>
      <TextInput label="Wallet account UUID" name="wallet_account_id" />
      <TextInput
        inputMode="numeric"
        label="Wallet expected version"
        name="wallet_expected_version"
      />
      <TextInput label="Asset UUID" name="asset_id" />
      <TextInput
        inputMode="numeric"
        label="Asset expected version"
        name="asset_expected_version"
      />
      <TextInput
        inputMode="numeric"
        label="Atomic units string"
        maxLength={38}
        name="units"
      />
      <ReasonInput />
      <button
        className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        Post Opening Balance
      </button>
    </form>
  );
}

function OpeningReversalForm() {
  return (
    <form
      action="/api/v1/admin/ledger/reverse-opening"
      className="flex flex-col gap-4 border border-zinc-200 p-5"
      method="post"
    >
      <input name="command_id" type="hidden" value={randomUUID()} />
      <h2 className="text-lg font-semibold">Reverse Opening</h2>
      <TextInput
        label="Original Opening Journal UUID"
        name="original_journal_id"
      />
      <ReasonInput />
      <button
        className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        Reverse Opening Journal
      </button>
    </form>
  );
}

function LedgerBoundaryNotes() {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Boundary</h2>
      <div className="mt-3 grid gap-3 text-sm leading-6 text-zinc-600 lg:grid-cols-2">
        <p>
          Opening Balance is a one-time migration command for an ACTIVE
          wallet, ACTIVE profile, ACTIVE asset, matching expected versions,
          and a wallet-asset pair with no previous ledger entries.
        </p>
        <p>
          Reversal is exact: account, side, and units are derived from the
          original Opening Journal. A reversed Opening cannot be posted again
          and a new Opening cannot replace it in this phase.
        </p>
      </div>
    </section>
  );
}

function BalanceTable({
  balances,
}: {
  balances: AdminWalletAssetLedgerBalance[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Wallet asset balances</h2>
      {balances.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Wallet</th>
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Available</th>
                <th className="py-2 pr-4 font-medium">Locked</th>
                <th className="py-2 pr-4 font-medium">Pending</th>
                <th className="py-2 pr-4 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((balance) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={`${balance.walletAccountId}-${balance.assetId}`}
                >
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(balance.walletAccountId)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(balance.targetUserId)}
                  </td>
                  <td className="py-3 pr-4">
                    {balance.walletStatus} / {balance.profileStatus}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{balance.assetCode}</div>
                    <div className="text-zinc-600">
                      {balance.symbol} / d{balance.decimals}
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    {balance.availableUnits}
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    {balance.lockedUnits}
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    {balance.pendingDepositUnits} /{" "}
                    {balance.pendingWithdrawalUnits}
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    {balance.totalLiabilityUnits}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No wallet asset ledger balances.
        </p>
      )}
    </section>
  );
}

function JournalTable({ journals }: { journals: AdminLedgerJournal[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Ledger journals</h2>
      {journals.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">Journal</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Initiator</th>
                <th className="py-2 pr-4 font-medium">Reference</th>
                <th className="py-2 pr-4 font-medium">Totals</th>
                <th className="py-2 pr-4 font-medium">Reversal</th>
                <th className="py-2 pr-4 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {journals.map((journal) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={journal.journalId}
                >
                  <td className="py-3 pr-4 whitespace-nowrap text-zinc-600">
                    {formatTimestamp(journal.postedAt)}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{journal.journalType}</div>
                    <div className="font-mono text-xs text-zinc-600">
                      {shortUuid(journal.journalId)}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {journal.assetCode} / {journal.symbol}
                  </td>
                  <td className="py-3 pr-4">{journal.initiatorType}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {journal.referenceType ?? "none"}{" "}
                    {journal.referenceId
                      ? shortUuid(journal.referenceId)
                      : ""}
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    {journal.debitTotalUnits} / {journal.creditTotalUnits} /{" "}
                    {journal.entryCount}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {journal.reversed
                      ? shortUuid(journal.reversalJournalId ?? "")
                      : "No"}
                  </td>
                  <td className="max-w-xs py-3 pr-4 text-zinc-700">
                    {journal.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No ledger journals.</p>
      )}
    </section>
  );
}

function FinancialAuditTable({
  events,
}: {
  events: FinancialAuditEvent[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Financial audit</h2>
      {events.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Wallet</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Journal</th>
                <th className="py-2 pr-4 font-medium">Units</th>
                <th className="py-2 pr-4 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={event.eventId}
                >
                  <td className="py-3 pr-4 whitespace-nowrap text-zinc-600">
                    {formatTimestamp(event.occurredAt)}
                  </td>
                  <td className="py-3 pr-4 font-medium">{event.action}</td>
                  <td className="py-3 pr-4">{event.outcome}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(event.walletAccountId)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(event.assetId)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {event.originalJournalId
                      ? `${shortUuid(event.originalJournalId)} -> `
                      : ""}
                    {shortUuid(event.resultingJournalId ?? "")}
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    {event.unitsText}
                  </td>
                  <td className="max-w-xs py-3 pr-4 text-zinc-700">
                    {event.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No financial audit events.
        </p>
      )}
    </section>
  );
}

function TextInput({
  inputMode,
  label,
  maxLength,
  name,
}: {
  inputMode?: "numeric";
  label: string;
  maxLength?: number;
  name: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <input
        autoComplete="off"
        className="h-11 border border-zinc-300 px-3 font-mono text-sm"
        inputMode={inputMode}
        maxLength={maxLength ?? 64}
        name={name}
        required
        type="text"
      />
    </label>
  );
}

function ReasonInput() {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      Reason
      <textarea
        className="min-h-24 resize-y border border-zinc-300 px-3 py-2 text-sm leading-6"
        maxLength={500}
        name="reason"
        required
      />
    </label>
  );
}

function getSingleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}

function shortUuid(value: string): string {
  return value.length >= 14
    ? `${value.slice(0, 8)}...${value.slice(-6)}`
    : value;
}
