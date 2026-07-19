import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AccountUnavailablePage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link className="text-sm text-zinc-600" href="/">
          Staking Wallet Web
        </Link>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-normal">
            Account unavailable
          </h1>
          <p className="text-sm leading-6 text-zinc-600">
            This account cannot access protected wallet features right now.
            Support and review procedures are not finalized yet.
          </p>
        </div>
        <form action="/api/v1/auth/sign-out" method="post">
          <button
            className="h-10 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
