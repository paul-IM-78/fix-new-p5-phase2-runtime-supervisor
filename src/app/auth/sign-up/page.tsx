import Link from "next/link";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";

type AuthPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SignUpPage({ searchParams }: AuthPageProps) {
  const params = await searchParams;
  const message = getPublicAuthErrorMessage(getSingleValue(params.error));

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link className="text-sm text-zinc-600" href="/">
            Staking Wallet Web
          </Link>
          <h1 className="text-3xl font-semibold tracking-normal">
            Create account
          </h1>
          <p className="text-sm leading-6 text-zinc-600">
            Use a local development email address and confirm it through
            Mailpit.
          </p>
        </header>

        {message ? (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {message}
          </p>
        ) : null}

        <form
          action="/api/v1/auth/sign-up"
          className="flex flex-col gap-4"
          method="post"
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            Email
            <input
              autoComplete="email"
              className="h-11 border border-zinc-300 px-3 text-base"
              maxLength={254}
              name="email"
              required
              type="email"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Display name
            <input
              autoComplete="name"
              className="h-11 border border-zinc-300 px-3 text-base"
              maxLength={80}
              name="display_name"
              type="text"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Password
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
            Confirm password
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
            Create account
          </button>
        </form>

        <p className="text-sm text-zinc-600">
          Already have an account?{" "}
          <Link className="font-medium text-zinc-950" href="/auth/sign-in">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function getSingleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}
