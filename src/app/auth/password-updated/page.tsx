import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PasswordUpdatedPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link className="text-sm text-zinc-600" href="/">
          Staking Wallet Web
        </Link>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-normal">
            Password updated
          </h1>
          <p className="text-sm leading-6 text-zinc-600">
            Your password has been changed. Sign in again before continuing.
          </p>
        </div>
        <Link
          className="inline-flex h-10 items-center justify-center border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
          href="/auth/sign-in"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
