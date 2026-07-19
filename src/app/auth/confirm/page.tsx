import type { Metadata } from "next";
import Link from "next/link";

import { getSafeAuthNextPath } from "@/lib/auth/validation";

type ConfirmPageProps = {
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

export default async function ConfirmEmailPage({
  searchParams,
}: ConfirmPageProps) {
  const params = await searchParams;
  const tokenHash = getSingleValue(params.token_hash);
  const type = getSingleValue(params.type);
  const nextPath = getSafeAuthNextPath(getSingleValue(params.next));
  const canConfirm =
    typeof tokenHash === "string" &&
    tokenHash.length >= 16 &&
    tokenHash.length <= 512 &&
    type === "email";

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link className="text-sm text-zinc-600" href="/">
          Staking Wallet Web
        </Link>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-normal">
            Confirm email address
          </h1>
          <p className="text-sm leading-6 text-zinc-600">
            Review this confirmation request, then use the button below to
            finish email verification.
          </p>
        </div>

        {canConfirm ? (
          <form
            action="/api/v1/auth/confirm"
            className="flex flex-col gap-4"
            method="post"
          >
            <input name="token_hash" type="hidden" value={tokenHash} />
            <input name="type" type="hidden" value="email" />
            <input name="next" type="hidden" value={nextPath} />
            <button
              className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
              type="submit"
            >
              Confirm email address
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              이메일 확인 링크가 유효하지 않습니다.
            </p>
            <Link
              className="inline-flex h-10 items-center justify-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
              href="/auth/sign-up"
            >
              Create account
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
