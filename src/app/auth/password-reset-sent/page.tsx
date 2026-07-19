import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PasswordResetSentPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link className="text-sm text-zinc-600" href="/">
          Staking Wallet Web
        </Link>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-normal">
            Check your email
          </h1>
          <p className="text-sm leading-6 text-zinc-600">
            If the account exists and can be reset, a password reset email
            will be sent. In local development, check Mailpit.
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
            href="/auth/forgot-password"
          >
            Send again
          </Link>
        </nav>
      </div>
    </main>
  );
}
