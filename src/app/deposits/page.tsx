import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getDepositPublicMessage } from "@/lib/deposit/public-results";
import {
  getCurrentDeposits,
  type CurrentDepositAsset,
  type CurrentDepositRequest,
  type CurrentDepositsResult,
} from "@/server/deposit/current-deposits";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DepositsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ReadyDeposits = Extract<CurrentDepositsResult, { status: "ready" }>;

export default async function DepositsPage({
  searchParams,
}: DepositsPageProps) {
  const deposits = await getCurrentDeposits();

  if (deposits.status === "anonymous") {
    redirect("/auth/sign-in?next=/deposits");
  }

  if (deposits.status === "inactive_profile") {
    redirect("/auth/account-unavailable");
  }

  if (deposits.status === "missing_profile") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (deposits.status === "missing_wallet") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (deposits.status === "unavailable") {
    redirect("/auth/error?code=auth_unavailable");
  }

  const params = await searchParams;
  const resultMessage = getDepositPublicMessage(
    getSingleValue(params.result),
  );
  const errorMessage =
    getDepositPublicMessage(getSingleValue(params.error)) ??
    getPublicAuthErrorMessage(getSingleValue(params.error));

  return (
    <DepositsView
      deposits={deposits}
      errorMessage={errorMessage}
      resultMessage={resultMessage}
    />
  );
}

function DepositsView({
  deposits,
  errorMessage,
  resultMessage,
}: {
  deposits: ReadyDeposits;
  errorMessage: string | null;
  resultMessage: string | null;
}) {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <nav className="flex flex-wrap gap-3 text-sm text-zinc-600">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/account">Account</Link>
            <Link href="/wallet">Wallet</Link>
            <Link href="/catalog">Catalog</Link>
            <Link href="/balances">Balances</Link>
          </nav>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Deposit requests
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              Current deposit requests are for local manual operation
              validation only. No blockchain destination, automatic
              confirmation, or real asset transfer workflow is provided.
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

        <BoundaryNotice />

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <WalletPanel
            status={deposits.wallet.status}
            version={deposits.wallet.version}
          />
          <RequestForms
            assets={deposits.assets}
            walletAccountId={deposits.wallet.walletAccountId}
            walletVersion={deposits.wallet.version}
          />
        </section>

        <DepositRequestTable requests={deposits.depositRequests} />
      </div>
    </main>
  );
}

function BoundaryNotice() {
  return (
    <section className="border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-base font-semibold text-amber-950">
        Local manual verification only
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        Requests move value into the internal pending-deposit ledger bucket.
        An AAL2 administrator can later confirm or cancel the request. Do
        not send real assets for this workflow.
      </p>
    </section>
  );
}

function WalletPanel({
  status,
  version,
}: {
  status: string;
  version: number;
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Wallet boundary</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <Detail label="Wallet status" value={status} />
        <Detail label="Wallet version" value={String(version)} />
      </div>
      <p className="mt-4 text-sm leading-6 text-zinc-600">
        New deposit requests require an ACTIVE wallet. Existing REQUESTED
        deposits can be canceled by the owner through the dedicated cancel
        command.
      </p>
    </section>
  );
}

function RequestForms({
  assets,
  walletAccountId,
  walletVersion,
}: {
  assets: CurrentDepositAsset[];
  walletAccountId: string;
  walletVersion: number;
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Create request</h2>
      {assets.length > 0 ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {assets.map((asset) => (
            <form
              action="/api/v1/deposits/create"
              className="flex flex-col gap-3 border border-zinc-100 p-4"
              key={asset.assetId}
              method="post"
            >
              <input name="command_id" type="hidden" value={randomUUID()} />
              <input
                name="wallet_account_id"
                type="hidden"
                value={walletAccountId}
              />
              <input
                name="wallet_expected_version"
                type="hidden"
                value={walletVersion}
              />
              <input name="asset_id" type="hidden" value={asset.assetId} />
              <input
                name="asset_expected_version"
                type="hidden"
                value={asset.version}
              />
              <div>
                <div className="font-mono text-xs text-zinc-500">
                  {asset.assetCode}
                </div>
                <h3 className="mt-1 text-base font-semibold">
                  {asset.symbol}
                </h3>
                <p className="mt-1 text-sm text-zinc-600">
                  {asset.displayName} / {asset.assetType} / d
                  {asset.decimals}
                </p>
              </div>
              <label className="flex flex-col gap-2 text-sm font-medium">
                Atomic units
                <input
                  autoComplete="off"
                  className="h-11 border border-zinc-300 px-3 font-mono text-sm"
                  inputMode="numeric"
                  maxLength={38}
                  name="units"
                  required
                  type="text"
                />
              </label>
              <button
                className="h-10 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
                type="submit"
              >
                Create Request
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No ACTIVE supported assets are available for local deposit
          requests.
        </p>
      )}
    </section>
  );
}

function DepositRequestTable({
  requests,
}: {
  requests: CurrentDepositRequest[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Request history</h2>
      {requests.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Requested</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Units</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Journal</th>
                <th className="py-2 pr-4 font-medium">Version</th>
                <th className="py-2 pr-4 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={request.depositRequestId}
                >
                  <td className="py-3 pr-4 whitespace-nowrap text-zinc-600">
                    {formatTimestamp(request.requestedAt)}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{request.assetCode}</div>
                    <div className="text-zinc-600">{request.symbol}</div>
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    {request.requestedUnits}
                  </td>
                  <td className="py-3 pr-4">{request.status}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(getTerminalJournalId(request))}
                  </td>
                  <td className="py-3 pr-4">{request.version}</td>
                  <td className="py-3 pr-4">
                    {request.status === "REQUESTED" ? (
                      <form action="/api/v1/deposits/cancel" method="post">
                        <input
                          name="command_id"
                          type="hidden"
                          value={randomUUID()}
                        />
                        <input
                          name="deposit_request_id"
                          type="hidden"
                          value={request.depositRequestId}
                        />
                        <input
                          name="request_expected_version"
                          type="hidden"
                          value={request.version}
                        />
                        <button
                          className="h-9 border border-zinc-300 px-3 text-sm font-medium"
                          type="submit"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <span className="text-zinc-500">Terminal</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No local deposit requests yet.
        </p>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-100 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </h3>
      <p className="mt-2 break-words text-base font-medium">{value}</p>
    </div>
  );
}

function getTerminalJournalId(request: CurrentDepositRequest): string {
  return (
    request.confirmationJournalId ??
    request.cancellationJournalId ??
    request.requestJournalId
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
