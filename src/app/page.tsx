import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-8">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Local auth development
          </p>
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl font-semibold tracking-normal">
              Staking Wallet Web
            </h1>
            <p className="max-w-2xl text-base leading-7 text-zinc-600">
              Managed wallet application foundation with local Supabase
              email authentication. Signed-in users can review their
              integrated profile, wallet, and catalog state on the
              dashboard. Financial product execution and production
              connectivity are not implemented yet.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <Link
              className="inline-flex h-10 items-center border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
              href="/auth/sign-up"
            >
              Create account
            </Link>
            <Link
              className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
              href="/auth/sign-in"
            >
              Sign in
            </Link>
            <Link
              className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
              href="/dashboard"
            >
              Dashboard
            </Link>
            <Link
              className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
              href="/account"
            >
              Account
            </Link>
          </nav>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="border border-zinc-200 p-5">
            <h2 className="text-base font-semibold">Email auth</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Sign up, confirm email, sign in, and sign out run against the
              local Supabase stack.
            </p>
          </div>
          <div className="border border-zinc-200 p-5">
            <h2 className="text-base font-semibold">Profile boundary</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              New accounts receive an application profile and a default USER
              role through the database trigger.
            </p>
          </div>
          <div className="border border-zinc-200 p-5">
            <h2 className="text-base font-semibold">Phase 2 boundary</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Account guard, admin command boundaries, managed wallet state,
              and catalog reads are in place. Phase 3 ledger and financial
              operations remain future work.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
