import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminMfaEnrollment } from "@/components/auth/admin-mfa-enrollment";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MfaEnrollmentPage() {
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

  if (adminAccess.status === "mfa_challenge_required") {
    redirect("/auth/mfa/challenge");
  }

  if (adminAccess.status === "ready") {
    redirect("/admin");
  }

  if (adminAccess.status === "unavailable") {
    redirect("/auth/error?code=mfa_unavailable");
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/">
            Staking Wallet Web
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Admin MFA enrollment
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Register a local authenticator app to enable administrator
              access.
            </p>
          </div>
        </header>

        <AdminMfaEnrollment />
      </div>
    </main>
  );
}
