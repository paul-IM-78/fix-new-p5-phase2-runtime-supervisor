import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getWalletPublicMessage } from "@/lib/wallet/public-results";
import {
  listAdminWalletManagement,
  type AdminWalletAccount,
  type WalletAuditEvent,
} from "@/server/admin/wallet-commands";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

type AdminWalletsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminWalletsPage({
  searchParams,
}: AdminWalletsPageProps) {
  const adminAccess = await getCurrentAdminAccess();

  if (adminAccess.status === "anonymous") {
    redirect("/auth/sign-in?next=/admin");
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
  const resultMessage = getWalletPublicMessage(
    getSingleValue(params.result),
  );
  const errorMessage =
    getWalletPublicMessage(getSingleValue(params.error)) ??
    getPublicAuthErrorMessage(getSingleValue(params.error));
  const management = await listAdminWalletManagement(100);

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/admin">
            Admin
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Wallet account operations
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              AAL2 administrator boundary for managed wallet account status
              changes. Wallet status is separate from profile account status
              and does not represent a balance or financial position.
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

        {management.ok ? (
          <>
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <WalletTransitionForm />
              <WalletStatusMatrix />
            </section>

            <WalletAccountTable walletAccounts={management.walletAccounts} />
            <WalletAuditTable events={management.auditEvents} />
          </>
        ) : (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {getWalletPublicMessage(management.error) ??
              getPublicAuthErrorMessage(management.error) ??
              "Wallet management is unavailable."}
          </p>
        )}
      </div>
    </main>
  );
}

function WalletTransitionForm() {
  return (
    <form
      action="/api/v1/admin/wallets/transition"
      className="flex flex-col gap-4 border border-zinc-200 p-5"
      method="post"
    >
      <input name="command_id" type="hidden" value={randomUUID()} />
      <h2 className="text-lg font-semibold">Change wallet status</h2>
      <TextInput label="Wallet account UUID" name="wallet_account_id" />
      <TextInput
        inputMode="numeric"
        label="Expected version"
        name="expected_version"
      />
      <label className="flex flex-col gap-2 text-sm font-medium">
        New status
        <select
          className="h-11 border border-zinc-300 bg-white px-3 text-sm"
          name="new_status"
          required
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="FROZEN">FROZEN</option>
          <option value="CLOSED">CLOSED</option>
        </select>
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Reason
        <textarea
          className="min-h-24 resize-y border border-zinc-300 px-3 py-2 text-sm leading-6"
          maxLength={500}
          name="reason"
          required
        />
      </label>
      <button
        className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        Submit status command
      </button>
    </form>
  );
}

function WalletStatusMatrix() {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Status matrix</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-2 pr-4 font-medium">From</th>
              <th className="py-2 pr-4 font-medium">To</th>
              <th className="py-2 pr-4 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["ACTIVE", "FROZEN", "Allowed"],
              ["FROZEN", "ACTIVE", "Allowed when profile is ACTIVE"],
              ["FROZEN", "CLOSED", "Allowed"],
              ["Same status", "Same status", "NOOP"],
              ["ACTIVE", "CLOSED", "Blocked"],
              ["CLOSED", "ACTIVE/FROZEN", "Blocked"],
            ].map(([from, to, result]) => (
              <tr className="border-b border-zinc-100" key={`${from}-${to}`}>
                <td className="py-3 pr-4">{from}</td>
                <td className="py-3 pr-4">{to}</td>
                <td className="py-3 pr-4">{result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WalletAccountTable({
  walletAccounts,
}: {
  walletAccounts: AdminWalletAccount[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Managed wallet accounts</h2>
      {walletAccounts.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Wallet</th>
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Custody</th>
                <th className="py-2 pr-4 font-medium">Wallet</th>
                <th className="py-2 pr-4 font-medium">Profile</th>
                <th className="py-2 pr-4 font-medium">Version</th>
                <th className="py-2 pr-4 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {walletAccounts.map((wallet) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={wallet.walletAccountId}
                >
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(wallet.walletAccountId)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(wallet.userId)}
                  </td>
                  <td className="py-3 pr-4">{wallet.custodyModel}</td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{wallet.walletStatus}</div>
                    <div className="text-zinc-600">
                      {wallet.closedAt
                        ? `Closed ${formatTimestamp(wallet.closedAt)}`
                        : "Open"}
                    </div>
                  </td>
                  <td className="py-3 pr-4">{wallet.profileAccountStatus}</td>
                  <td className="py-3 pr-4">{wallet.version}</td>
                  <td className="py-3 pr-4 text-zinc-600">
                    {formatTimestamp(wallet.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No managed wallet accounts.
        </p>
      )}
    </section>
  );
}

function WalletAuditTable({ events }: { events: WalletAuditEvent[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Wallet audit</h2>
      {events.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Wallet</th>
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Change</th>
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
                    {shortUuid(event.targetUserId)}
                  </td>
                  <td className="py-3 pr-4">
                    {event.previousStatus} {"->"} {event.resultingStatus} / v
                    {event.entityVersion}
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
        <p className="mt-3 text-sm text-zinc-600">No wallet audit events.</p>
      )}
    </section>
  );
}

function TextInput({
  inputMode,
  label,
  name,
}: {
  inputMode?: "numeric";
  label: string;
  name: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <input
        autoComplete="off"
        className="h-11 border border-zinc-300 px-3 font-mono text-sm"
        inputMode={inputMode}
        maxLength={64}
        name={name}
        required
        type="text"
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
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}
