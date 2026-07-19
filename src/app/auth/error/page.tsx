import Link from "next/link";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";

type ErrorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AuthErrorPage({ searchParams }: ErrorPageProps) {
  const params = await searchParams;
  const message =
    getPublicAuthErrorMessage(getSingleValue(params.code)) ??
    "요청을 처리할 수 없습니다.";

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link className="text-sm text-zinc-600" href="/">
          Staking Wallet Web
        </Link>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-normal">
            Authentication issue
          </h1>
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {message}
          </p>
        </div>
        <nav className="flex flex-wrap gap-3">
          <Link
            className="inline-flex h-10 items-center justify-center border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
            href="/auth/sign-in"
          >
            Sign in
          </Link>
          <Link
            className="inline-flex h-10 items-center justify-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/auth/sign-up"
          >
            Create account
          </Link>
        </nav>
      </div>
    </main>
  );
}

function getSingleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}
