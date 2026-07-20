import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminPage() {
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

  const displayName =
    adminAccess.profile.displayName ?? "Admin account";

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/">
            Staking Wallet Web
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Admin
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Local admin boundary placeholder for the managed wallet web
              app.
            </p>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="border border-zinc-200 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Access
            </h2>
            <p className="mt-2 text-base font-medium">Admin verified</p>
          </div>
          <div className="border border-zinc-200 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Assurance
            </h2>
            <p className="mt-2 text-base font-medium">AAL2 required</p>
          </div>
          <div className="border border-zinc-200 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Account
            </h2>
            <p className="mt-2 text-base font-medium">ACTIVE</p>
          </div>
        </section>

        <section className="border border-zinc-200 p-5">
          <h2 className="text-base font-semibold">{displayName}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Administrative product features are intentionally scoped by
            phase. Role grant and revoke commands, project and supported
            asset lifecycle commands, managed wallet account status
            commands, and one-time ledger Opening Balance commands each use
            dedicated AAL2 pages. Generic manual journals, deposits,
            deposit request commands each use dedicated pages. Withdrawals,
            staking, and rewards remain out of scope.
          </p>
        </section>

        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex h-10 items-center border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
            href="/admin/roles"
          >
            Role commands
          </Link>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/admin/catalog"
          >
            Catalog commands
          </Link>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/admin/wallets"
          >
            Wallet commands
          </Link>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/admin/ledger"
          >
            Ledger commands
          </Link>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/admin/deposits"
          >
            Deposit commands
          </Link>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/account"
          >
            Account
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
