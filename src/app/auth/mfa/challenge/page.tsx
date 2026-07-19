import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

type MfaChallengePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MfaChallengePage({
  searchParams,
}: MfaChallengePageProps) {
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

  if (adminAccess.status === "ready") {
    redirect("/admin");
  }

  if (adminAccess.status === "unavailable") {
    redirect("/auth/error?code=mfa_unavailable");
  }

  const params = await searchParams;
  const message = getPublicAuthErrorMessage(getSingleValue(params.error));
  const friendlyName =
    adminAccess.friendlyName ?? "Registered authenticator";

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/">
            Staking Wallet Web
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Admin verification
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Enter a code from {friendlyName} to open the admin workspace.
            </p>
          </div>
        </header>

        {message ? (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {message}
          </p>
        ) : null}

        <form
          action="/api/v1/auth/mfa/challenge"
          className="flex flex-col gap-4"
          method="post"
        >
          <input
            name="factor_id"
            type="hidden"
            value={adminAccess.factorId}
          />
          <input name="next" type="hidden" value="/admin" />
          <label className="flex flex-col gap-2 text-sm font-medium">
            6-digit code
            <input
              autoComplete="one-time-code"
              className="h-11 border border-zinc-300 px-3 text-base"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="code"
              pattern="[0-9]{6}"
              required
              type="text"
            />
          </label>
          <button
            className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
            type="submit"
          >
            Verify
          </button>
        </form>
      </div>
    </main>
  );
}

function getSingleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}
