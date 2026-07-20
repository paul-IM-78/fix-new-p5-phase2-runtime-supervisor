import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentAccountAccess } from "@/server/auth/account-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AccountPage() {
  const accountAccess = await getCurrentAccountAccess();

  if (accountAccess.status === "anonymous") {
    redirect("/auth/sign-in?next=/account");
  }

  if (accountAccess.status === "missing_profile") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (accountAccess.status === "inactive") {
    redirect("/auth/account-unavailable");
  }

  if (accountAccess.status === "unavailable") {
    redirect("/auth/error?code=auth_unavailable");
  }

  const { profile } = accountAccess;
  const displayName = profile.displayName ?? "Unnamed account";

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/">
            Staking Wallet Web
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Account
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Local authentication profile for the managed wallet web app.
            </p>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="border border-zinc-200 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Display name
            </h2>
            <p className="mt-2 text-base font-medium">{displayName}</p>
          </div>
          <div className="border border-zinc-200 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Status
            </h2>
            <p className="mt-2 text-base font-medium">
              {profile.accountStatus}
            </p>
          </div>
          <div className="border border-zinc-200 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Profile version
            </h2>
            <p className="mt-2 text-base font-medium">{profile.version}</p>
          </div>
        </section>

        <section className="border border-zinc-200 p-5">
          <h2 className="text-base font-semibold">Current scope</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            This page intentionally excludes financial operation details and
            role administration. Catalog and managed wallet account reads
            expose metadata and operational state only.
          </p>
        </section>

        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/dashboard"
          >
            Dashboard
          </Link>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/catalog"
          >
            Catalog
          </Link>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/wallet"
          >
            Wallet account
          </Link>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/deposits"
          >
            Deposits
          </Link>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/withdrawals"
          >
            Withdrawals
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
