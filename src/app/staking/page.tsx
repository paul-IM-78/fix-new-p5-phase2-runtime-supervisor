import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { formatAtomicUnitsForDisplay } from "@/lib/ledger/atomic-units";
import {
  listCurrentStakingProducts,
  type CurrentStakingProduct,
  type CurrentStakingProductsResult,
} from "@/server/staking/current-products";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type ReadyProducts = Extract<CurrentStakingProductsResult, { status: "ready" }>;

export default async function StakingPage() {
  const products = await listCurrentStakingProducts();

  if (products.status === "anonymous") {
    redirect("/auth/sign-in?next=/staking");
  }

  if (products.status === "inactive_profile") {
    redirect("/auth/account-unavailable");
  }

  if (products.status === "missing_profile") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (products.status === "unavailable") {
    redirect("/auth/error?code=auth_unavailable");
  }

  return <StakingView products={products} />;
}

function StakingView({ products }: { products: ReadyProducts }) {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/">
            Staking Wallet Web
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Staking products
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              Active product terms published for future managed staking.
              These entries are catalog metadata only.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <StakingLink href="/dashboard">Dashboard</StakingLink>
            <StakingLink href="/balances">Balances</StakingLink>
            <StakingLink href="/account">Account</StakingLink>
          </nav>
        </header>

        <BoundaryNotice />

        {products.products.length > 0 ? (
          <section className="grid gap-5 lg:grid-cols-2">
            {products.products.map((product) => (
              <ProductCard
                key={product.stakingProductId}
                product={product}
              />
            ))}
          </section>
        ) : (
          <p className="border border-zinc-200 p-5 text-sm text-zinc-600">
            No staking products are currently open or upcoming.
          </p>
        )}
      </div>
    </main>
  );
}

function BoundaryNotice() {
  return (
    <section className="border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-base font-semibold text-amber-950">
        Product boundary
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        PPM is a fixed term condition for future reward rules, not APY or
        APR. Reward calculation, staking requests, principal locking, claims,
        unlocks, wallet addresses, and transactions are not implemented here.
      </p>
    </section>
  );
}

function ProductCard({ product }: { product: CurrentStakingProduct }) {
  return (
    <article className="border border-zinc-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-zinc-500">
            {product.productCode}
          </div>
          <h2 className="mt-1 text-xl font-semibold">
            {product.displayName}
          </h2>
          {product.description ? (
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              {product.description}
            </p>
          ) : null}
        </div>
        <span className="border border-zinc-200 px-3 py-1 text-xs text-zinc-600">
          {product.enrollmentState}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Detail label="Project" value={product.projectCode} />
        <Detail label="Asset" value={`${product.assetSymbol} / ${product.assetCode}`} />
        <Detail
          label="Decimals"
          value={String(product.assetDecimals)}
        />
        <Detail
          label="Lock duration"
          value={`${product.lockDurationDays} days`}
        />
        <Detail
          label="Minimum"
          value={formatAtomicUnitsForDisplay(product.minStakeUnits)}
        />
        <Detail
          label="Maximum"
          value={
            product.maxStakeUnits
              ? formatAtomicUnitsForDisplay(product.maxStakeUnits)
              : "No product maximum"
          }
        />
        <Detail
          label="Term reward"
          value={`${product.termRewardRatePpm} ppm / ${product.rewardRoundingMode}`}
        />
        <Detail
          label="Product version"
          value={String(product.productVersion)}
        />
        <Detail
          label="Enrollment starts"
          value={formatTimestamp(product.enrollmentStartsAt)}
        />
        <Detail
          label="Enrollment ends"
          value={formatTimestamp(product.enrollmentEndsAt)}
        />
      </div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-100 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </h3>
      <p className="mt-2 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

function StakingLink({
  children,
  href,
}: {
  children: string;
  href: string;
}) {
  return (
    <Link
      className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
      href={href}
    >
      {children}
    </Link>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}
