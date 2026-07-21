import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { formatAtomicUnitsForDisplay } from "@/lib/ledger/atomic-units";
import {
  getCurrentFinancialOverview,
  type CurrentFinancialOverviewResult,
  type UserAssetLedgerBalance,
  type UserDepositSummary,
  type UserWithdrawalSummary,
} from "@/server/finance/current-financial-overview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type ReadyOverview = Extract<CurrentFinancialOverviewResult, { status: "ready" }>;

export default async function BalancesPage() {
  const overview = await getCurrentFinancialOverview();

  if (overview.status === "anonymous") {
    redirect("/auth/sign-in?next=/balances");
  }

  if (overview.status === "inactive_profile") {
    redirect("/auth/account-unavailable");
  }

  if (overview.status === "missing_wallet") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (overview.status === "unavailable") {
    redirect("/auth/error?code=auth_unavailable");
  }

  return <BalancesView overview={overview} />;
}

function BalancesView({ overview }: { overview: ReadyOverview }) {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/">
            Staking Wallet Web
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Managed wallet ledger balances
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              Asset-level internal ledger buckets for the managed wallet. The
              values are atomic-unit strings from PostgreSQL read RPCs.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <BalanceLink href="/dashboard">Dashboard</BalanceLink>
            <BalanceLink href="/account">Account</BalanceLink>
            <BalanceLink href="/wallet">Wallet</BalanceLink>
            <BalanceLink href="/staking">Staking</BalanceLink>
            <BalanceLink href="/deposits">Deposits</BalanceLink>
            <BalanceLink href="/withdrawals">Withdrawals</BalanceLink>
          </nav>
        </header>

        <WalletSummary wallet={overview.wallet} />
        <BoundaryNotice />
        <BalanceSection balances={overview.balances} />
        <section className="grid gap-5 lg:grid-cols-2">
          <DepositStatusSection deposits={overview.deposits} />
          <WithdrawalStatusSection withdrawals={overview.withdrawals} />
        </section>
      </div>
    </main>
  );
}

function WalletSummary({ wallet }: { wallet: ReadyOverview["wallet"] }) {
  return (
    <section className="grid gap-4 sm:grid-cols-4">
      <Detail label="Custody model" value={wallet.custodyModel} />
      <Detail label="Wallet status" value={wallet.accountStatus} />
      <Detail label="Wallet version" value={String(wallet.version)} />
      <Detail
        label="Closed"
        value={wallet.closedAt ? formatTimestamp(wallet.closedAt) : "Not closed"}
      />
      <p className="sm:col-span-4 text-sm leading-6 text-zinc-600">
        {wallet.accountStatus === "ACTIVE"
          ? "ACTIVE wallets can read balances and may submit financial requests subject to each state machine."
          : null}
        {wallet.accountStatus === "FROZEN"
          ? "FROZEN wallets remain readable, but new deposit and withdrawal mutation paths are restricted by their command guards."
          : null}
        {wallet.accountStatus === "CLOSED"
          ? "CLOSED wallets remain readable for historical review, but new financial requests are not supported."
          : null}
      </p>
    </section>
  );
}

function BoundaryNotice() {
  return (
    <section className="border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-base font-semibold text-amber-950">
        Internal liability view
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        Total Liability is the internal double-entry ledger liability sum for
        the user. It is not an external asset holding statement or external
        custody proof.
      </p>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        The page does not combine different assets, calculate external value,
        estimate yield, or display external transfer proof.
      </p>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        Locked Atomic Units are the future staking principal bucket. A locked
        value by itself does not mean a staking position exists in this phase.
      </p>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        Available Atomic Units may be used for new staking positions when a
        product is OPEN and the wallet is ACTIVE. Post-unlock settlement
        payouts credit Available units. This page still avoids asset-level aggregation,
        portfolio value, and projected yield.
      </p>
    </section>
  );
}

function BalanceSection({ balances }: { balances: UserAssetLedgerBalance[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Asset buckets</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Each row is validated independently. Assets are never summed
            together.
          </p>
        </div>
      </div>

      {balances.length > 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {balances.map((balance) => (
            <article className="border border-zinc-200 p-5" key={balance.assetId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-xs text-zinc-500">
                    {balance.assetCode}
                  </div>
                  <h3 className="mt-1 text-xl font-semibold">
                    {balance.symbol}
                  </h3>
                </div>
                <span className="border border-zinc-200 px-3 py-1 text-xs text-zinc-600">
                  decimals {balance.decimals}
                </span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <UnitDetail
                  label="Available Atomic Units"
                  value={balance.availableUnits}
                />
                <UnitDetail
                  label="Locked Atomic Units"
                  value={balance.lockedUnits}
                />
                <UnitDetail
                  label="Pending Deposit Atomic Units"
                  value={balance.pendingDepositUnits}
                />
                <UnitDetail
                  label="Pending Withdrawal Atomic Units"
                  value={balance.pendingWithdrawalUnits}
                />
                <div className="sm:col-span-2">
                  <UnitDetail
                    label="Total Liability Atomic Units"
                    value={balance.totalLiabilityUnits}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 border border-zinc-100 p-5 text-sm text-zinc-600">
          No user ledger balance has been created yet.
        </p>
      )}
    </section>
  );
}

function DepositStatusSection({
  deposits,
}: {
  deposits: ReadyOverview["deposits"];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Deposit status</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Pending requests: {deposits.pendingCount}
          </p>
        </div>
        <BalanceLink href="/deposits">Deposits</BalanceLink>
      </div>
      {deposits.requests.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {deposits.requests.slice(0, 10).map((request) => (
            <DepositRow key={request.depositRequestId} request={request} />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-600">
          No local deposit requests yet.
        </p>
      )}
    </section>
  );
}

function WithdrawalStatusSection({
  withdrawals,
}: {
  withdrawals: ReadyOverview["withdrawals"];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Withdrawal status</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Open requests: {withdrawals.openCount} / settled requests:{" "}
            {withdrawals.settledCount}
          </p>
        </div>
        <BalanceLink href="/withdrawals">Withdrawals</BalanceLink>
      </div>
      {withdrawals.requests.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {withdrawals.requests.slice(0, 10).map((request) => (
            <WithdrawalRow
              key={request.withdrawalRequestId}
              request={request}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-600">
          No local withdrawal requests yet.
        </p>
      )}
    </section>
  );
}

function DepositRow({ request }: { request: UserDepositSummary }) {
  return (
    <article className="border border-zinc-100 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">
            {request.assetCode} / {request.symbol}
          </h3>
          <p className="mt-1 font-mono text-sm">
            {formatAtomicUnitsForDisplay(request.requestedUnits)}
          </p>
        </div>
        <span className="border border-zinc-200 px-3 py-1 text-xs">
          {request.status}
        </span>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        requested {formatTimestamp(request.requestedAt)}
        {request.confirmedAt
          ? ` / confirmed ${formatTimestamp(request.confirmedAt)}`
          : ""}
        {request.canceledAt
          ? ` / canceled ${formatTimestamp(request.canceledAt)}`
          : ""}
      </p>
    </article>
  );
}

function WithdrawalRow({ request }: { request: UserWithdrawalSummary }) {
  return (
    <article className="border border-zinc-100 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">
            {request.assetCode} / {request.symbol}
          </h3>
          <p className="mt-1 font-mono text-sm">
            {formatAtomicUnitsForDisplay(request.requestedUnits)}
          </p>
        </div>
        <span className="border border-zinc-200 px-3 py-1 text-xs">
          {request.status}
        </span>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        requested {formatTimestamp(request.requestedAt)}
        {request.reservedAt ? ` / reserved ${formatTimestamp(request.reservedAt)}` : ""}
        {request.approvedAt ? ` / approved ${formatTimestamp(request.approvedAt)}` : ""}
        {request.canceledAt ? ` / canceled ${formatTimestamp(request.canceledAt)}` : ""}
      </p>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        {getWithdrawalStatusCopy(request.status)}
      </p>
    </article>
  );
}

function UnitDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-100 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </h3>
      <p className="mt-2 break-words font-mono text-sm">
        {formatAtomicUnitsForDisplay(value)}
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-200 p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </h2>
      <p className="mt-2 break-words text-base font-medium">{value}</p>
    </div>
  );
}

function BalanceLink({
  children,
  href,
}: {
  children: string;
  href: string;
}) {
  return (
    <Link
      className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
      href={href}
    >
      {children}
    </Link>
  );
}

function getWithdrawalStatusCopy(status: UserWithdrawalSummary["status"]): string {
  switch (status) {
    case "EXECUTING":
      return "An administrator has started the local external processing record.";
    case "FAILED":
      return "External processing failed and has not been internally settled.";
    case "SETTLED":
      return "Internal ledger settlement is complete. This is not automated chain verification.";
    case "REQUESTED":
      return "The request has been created and is waiting for reservation.";
    case "RESERVED":
      return "Available units have moved into pending withdrawal.";
    case "APPROVED":
      return "Pending withdrawal has moved into withdrawal clearing.";
    case "CANCELED":
      return "The request is terminal and canceled.";
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}
