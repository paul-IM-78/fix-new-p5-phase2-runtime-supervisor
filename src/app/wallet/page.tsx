import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentWallet } from "@/server/wallet/current-wallet";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WalletPage() {
  const result = await getCurrentWallet();

  if (result.status === "anonymous") {
    redirect("/auth/sign-in?next=/account");
  }

  if (result.status === "inactive_profile") {
    redirect("/auth/account-unavailable");
  }

  if (result.status === "missing_profile") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (result.status === "missing_wallet") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (result.status === "unavailable") {
    redirect("/auth/error?code=auth_unavailable");
  }

  const { walletAccount } = result;

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/account">
            Account
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Managed wallet account
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Operational wallet-account state only. Financial amounts,
              wallet identifiers, transaction operations, and reward
              positions are not implemented in this phase.
            </p>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          <Detail label="Wallet ID" value={shortUuid(walletAccount.walletAccountId)} />
          <Detail label="Custody model" value={walletAccount.custodyModel} />
          <Detail label="Wallet status" value={walletAccount.status} />
          <Detail label="Version" value={String(walletAccount.version)} />
          <Detail
            label="Created"
            value={formatTimestamp(walletAccount.createdAt)}
          />
          <Detail
            label="Updated"
            value={formatTimestamp(walletAccount.updatedAt)}
          />
          <Detail
            label="Closed"
            value={
              walletAccount.closedAt
                ? formatTimestamp(walletAccount.closedAt)
                : "Not closed"
            }
          />
        </section>

        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/catalog"
          >
            Catalog
          </Link>
          <form action="/api/v1/auth/sign-out" method="post">
            <button
              className="h-10 border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
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

function shortUuid(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}
