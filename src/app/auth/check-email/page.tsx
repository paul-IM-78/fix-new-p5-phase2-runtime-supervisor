import Link from "next/link";

export default function CheckEmailPage() {
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
            If an account can be created, a confirmation email will be sent.
            Follow the confirmation link and approve the confirmation page.
          </p>
          <p className="text-xs leading-5 text-zinc-500">
            Local development uses Mailpit. Production SMTP is not configured
            in this phase.
          </p>
        </div>
        <Link
          className="inline-flex h-10 items-center justify-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
          href="/auth/sign-in"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
