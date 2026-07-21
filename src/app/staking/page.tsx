import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { formatAtomicUnitsForDisplay } from "@/lib/ledger/atomic-units";
import { getStakingPublicMessage } from "@/lib/staking/public-results";
import {
  getCurrentStaking,
  type CurrentStakingBalance,
  type CurrentStakingPosition,
  type CurrentStakingProduct,
  type CurrentStakingResult,
} from "@/server/staking/current-staking";

type StakingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type ReadyStaking = Extract<CurrentStakingResult, { status: "ready" }>;

export default async function StakingPage({
  searchParams,
}: StakingPageProps) {
  const staking = await getCurrentStaking();

  if (staking.status === "anonymous") {
    redirect("/auth/sign-in?next=/staking");
  }

  if (staking.status === "inactive_profile") {
    redirect("/auth/account-unavailable");
  }

  if (staking.status === "missing_wallet") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (staking.status === "unavailable") {
    redirect("/auth/error?code=auth_unavailable");
  }

  const params = await searchParams;

  return (
    <StakingView
      errorMessage={getStakingPublicMessage(getSingleValue(params.error))}
      resultMessage={getStakingPublicMessage(getSingleValue(params.result))}
      staking={staking}
    />
  );
}

function StakingView({
  errorMessage,
  resultMessage,
  staking,
}: {
  errorMessage: string | null;
  resultMessage: string | null;
  staking: ReadyStaking;
}) {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/">
            Staking Wallet Web
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Staking
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              Active product terms and principal-lock positions for the
              managed wallet. This phase supports principal lock and matured
              principal unlock only.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <StakingLink href="/dashboard">Dashboard</StakingLink>
            <StakingLink href="/balances">Balances</StakingLink>
            <StakingLink href="/account">Account</StakingLink>
          </nav>
        </header>

        {resultMessage ? (
          <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {resultMessage}
          </p>
        ) : null}

        {errorMessage ? (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMessage}
          </p>
        ) : null}

        <BoundaryNotice />
        <WalletSummary staking={staking} />
        <ProductSection staking={staking} />
        <PositionSection
          positions={staking.positions}
          wallet={staking.wallet}
        />
      </div>
    </main>
  );
}

function BoundaryNotice() {
  return (
    <section className="border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-base font-semibold text-amber-950">
        Principal lock boundary
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        This phase validates Principal Lock and matured Principal Unlock only.
        Reward calculation, reward payment, claims, wallet addresses,
        transactions, and on-chain staking are not provided.
      </p>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        PPM is a fixed term condition, not APY or APR. Unlock moves principal
        only; no estimated reward or yield guarantee is displayed.
      </p>
    </section>
  );
}

function WalletSummary({ staking }: { staking: ReadyStaking }) {
  return (
    <section className="grid gap-4 sm:grid-cols-4">
      <Detail label="Wallet status" value={staking.wallet.status} />
      <Detail label="Wallet version" value={String(staking.wallet.version)} />
      <Detail
        label="Open products"
        value={String(
          staking.products.filter(
            (product) => product.enrollmentState === "OPEN",
          ).length,
        )}
      />
      <Detail
        label="Locked positions"
        value={String(staking.positions.length)}
      />
    </section>
  );
}

function ProductSection({ staking }: { staking: ReadyStaking }) {
  const balancesByAssetId = new Map(
    staking.balances.map((balance) => [balance.assetId, balance]),
  );

  return (
    <section className="border border-zinc-200 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Products</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Each principal lock is validated per position against product
            minimum and maximum atomic units.
          </p>
        </div>
      </div>

      {staking.products.length > 0 ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {staking.products.map((product) => (
            <ProductCard
              balance={balancesByAssetId.get(product.assetId) ?? null}
              key={product.stakingProductId}
              product={product}
              wallet={staking.wallet}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 border border-zinc-100 p-5 text-sm text-zinc-600">
          No staking products are currently open or upcoming.
        </p>
      )}
    </section>
  );
}

function ProductCard({
  balance,
  product,
  wallet,
}: {
  balance: CurrentStakingBalance | null;
  product: CurrentStakingProduct;
  wallet: ReadyStaking["wallet"];
}) {
  const canCreate =
    wallet.status === "ACTIVE" && product.enrollmentState === "OPEN";

  return (
    <article className="border border-zinc-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-zinc-500">
            {product.productCode}
          </div>
          <h3 className="mt-1 text-xl font-semibold">
            {product.displayName}
          </h3>
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
        <Detail
          label="Asset"
          value={`${product.assetSymbol} / ${product.assetCode}`}
        />
        <Detail
          label="Available"
          value={
            balance
              ? formatAtomicUnitsForDisplay(balance.availableUnits)
              : "0 atomic units"
          }
        />
        <Detail
          label="Current locked"
          value={
            balance
              ? formatAtomicUnitsForDisplay(balance.lockedUnits)
              : "0 atomic units"
          }
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
              : "No per-position maximum"
          }
        />
        <Detail
          label="Term reward"
          value={`${product.termRewardRatePpm} ppm / ${product.rewardRoundingMode}`}
        />
      </div>

      <form
        action="/api/v1/staking/positions/create"
        className="mt-5 border-t border-zinc-100 pt-5"
        method="post"
      >
        <input
          name="staking_product_id"
          type="hidden"
          value={product.stakingProductId}
        />
        <input
          name="product_expected_version"
          type="hidden"
          value={product.productVersion}
        />
        <input
          name="wallet_account_id"
          type="hidden"
          value={wallet.walletAccountId}
        />
        <input
          name="wallet_expected_version"
          type="hidden"
          value={wallet.version}
        />
        <input name="position_id" type="hidden" value={randomUUID()} />
        <input name="command_id" type="hidden" value={randomUUID()} />
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Principal atomic units
          </span>
          <input
            className="mt-2 h-11 w-full border border-zinc-300 px-3 font-mono text-sm"
            disabled={!canCreate}
            inputMode="numeric"
            maxLength={38}
            name="principal_units"
            pattern="[1-9][0-9]{0,37}"
            required
            type="text"
          />
        </label>
        <button
          className="mt-4 h-10 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white disabled:border-zinc-300 disabled:bg-zinc-100 disabled:text-zinc-500"
          disabled={!canCreate}
          type="submit"
        >
          Lock principal
        </button>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          {canCreate
            ? "Creates one LOCKED position and posts Available to Locked for this asset."
            : "Principal lock is available only while the wallet is ACTIVE and enrollment is OPEN."}
        </p>
      </form>
    </article>
  );
}

function PositionSection({
  positions,
  wallet,
}: {
  positions: CurrentStakingPosition[];
  wallet: ReadyStaking["wallet"];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Locked positions</h2>
      {positions.length > 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {positions.map((position) => (
            <PositionCard
              key={position.stakingPositionId}
              position={position}
              wallet={wallet}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 border border-zinc-100 p-5 text-sm text-zinc-600">
          No locked staking positions exist for this account.
        </p>
      )}
    </section>
  );
}

function PositionCard({
  position,
  wallet,
}: {
  position: CurrentStakingPosition;
  wallet: ReadyStaking["wallet"];
}) {
  const canUnlock =
    position.status === "LOCKED" &&
    position.maturityState === "MATURED" &&
    wallet.status === "ACTIVE";

  return (
    <article className="border border-zinc-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-zinc-500">
            {position.productCode}
          </div>
          <h3 className="mt-1 text-xl font-semibold">
            {position.productDisplayName}
          </h3>
        </div>
        <span className="border border-zinc-200 px-3 py-1 text-xs text-zinc-600">
          {position.maturityState}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Detail
          label="Principal"
          value={formatAtomicUnitsForDisplay(position.principalUnits)}
        />
        <Detail
          label="Asset"
          value={`${position.assetSymbol} / ${position.assetCode}`}
        />
        <Detail
          label="Locked"
          value={formatTimestamp(position.lockedAt)}
        />
        <Detail
          label="Matures"
          value={formatTimestamp(position.maturesAt)}
        />
        <Detail label="Status" value={position.status} />
        <Detail label="Maturity state" value={position.maturityState} />
        {position.unlockedAt ? (
          <Detail
            label="Unlocked"
            value={formatTimestamp(position.unlockedAt)}
          />
        ) : null}
        {position.unlockActorType ? (
          <Detail label="Unlock actor" value={position.unlockActorType} />
        ) : null}
        <Detail
          label="Duration snapshot"
          value={`${position.lockDurationDaysSnapshot} days`}
        />
        <Detail
          label="Reward snapshot"
          value={`${position.termRewardRatePpmSnapshot} ppm / ${position.rewardRoundingModeSnapshot}`}
        />
      </div>
      <p className="mt-4 text-sm leading-6 text-zinc-600">
        Product status changes after creation do not alter this snapshot.
        Unlock moves matured principal only. Reward posting, reward claim, and
        early exit commands are not implemented.
      </p>
      {position.status === "LOCKED" && position.maturityState === "MATURED" ? (
        <form
          action="/api/v1/staking/positions/unlock"
          className="mt-5 border-t border-zinc-100 pt-5"
          method="post"
        >
          <input
            name="staking_position_id"
            type="hidden"
            value={position.stakingPositionId}
          />
          <input
            name="position_expected_version"
            type="hidden"
            value={position.positionVersion}
          />
          <input
            name="wallet_expected_version"
            type="hidden"
            value={wallet.version}
          />
          <input name="command_id" type="hidden" value={randomUUID()} />
          <button
            className="h-10 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white disabled:border-zinc-300 disabled:bg-zinc-100 disabled:text-zinc-500"
            disabled={!canUnlock}
            type="submit"
          >
            Unlock matured principal
          </button>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            {canUnlock
              ? "Moves this matured principal from Locked to Available."
              : "This wallet is not ACTIVE. An administrator may need to review the matured principal; the principal is not lost."}
          </p>
        </form>
      ) : null}
      {position.status === "LOCKED" && position.maturityState === "LOCKED" ? (
        <p className="mt-4 border border-zinc-100 p-4 text-sm leading-6 text-zinc-600">
          This position is not matured yet. Early unlock and partial unlock are
          not available.
        </p>
      ) : null}
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

function getSingleValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
