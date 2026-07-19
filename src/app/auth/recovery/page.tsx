import type { Metadata } from "next";
import Link from "next/link";

import { validateRecoveryTokenHash } from "@/lib/auth/validation";

type RecoveryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
  referrer: "no-referrer",
};

export default async function RecoveryPage({
  searchParams,
}: RecoveryPageProps) {
  const params = await searchParams;
  const tokenHash = validateRecoveryTokenHash(
    getSingleValue(params.token_hash),
  );
  const type = getSingleValue(params.type);
  const canReset = Boolean(tokenHash) && type === "recovery";

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link className="text-sm text-zinc-600" href="/">
          Staking Wallet Web
        </Link>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-normal">
            Set new password
          </h1>
          <p className="text-sm leading-6 text-zinc-600">
            Choose a new password to complete this recovery request.
          </p>
        </div>

        {canReset && tokenHash ? (
          <form
            action="/api/v1/auth/password-reset/update"
            className="flex flex-col gap-4"
            method="post"
          >
            <input name="token_hash" type="hidden" value={tokenHash} />
            <input name="type" type="hidden" value="recovery" />
            <label className="flex flex-col gap-2 text-sm font-medium">
              New password
              <input
                autoComplete="new-password"
                className="h-11 border border-zinc-300 px-3 text-base"
                maxLength={128}
                minLength={12}
                name="password"
                required
                type="password"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Confirm new password
              <input
                autoComplete="new-password"
                className="h-11 border border-zinc-300 px-3 text-base"
                maxLength={128}
                minLength={12}
                name="password_confirm"
                required
                type="password"
              />
            </label>
            <button
              className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
              type="submit"
            >
              Update password
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              This password reset link is not valid.
            </p>
            <Link
              className="inline-flex h-10 items-center justify-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
              href="/auth/forgot-password"
            >
              Request a new link
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function getSingleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}
