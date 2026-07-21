import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  formatAtomicUnitsForDisplay,
  isPositiveAtomicUnits,
} from "@/lib/ledger/atomic-units";
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
  const lifecycle = buildLifecycle(staking);

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
              managed wallet. This phase supports principal lock, matured
              principal unlock, and one-time snapshot reward settlement.
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
        <LifecycleSummary lifecycle={lifecycle} staking={staking} />
        <ActionRequiredSection
          positions={lifecycle.actionRequired}
          wallet={staking.wallet}
        />
        <AssetBalanceSection balances={staking.balances} />
        <ActiveLockSection positions={lifecycle.activeLocks} />
        <ProductSection
          balancesByAssetId={lifecycle.balancesByAssetId}
          openProducts={lifecycle.openProducts}
          upcomingProducts={lifecycle.upcomingProducts}
          wallet={staking.wallet}
        />
        <CompletedSection positions={lifecycle.completed} />
      </div>
    </main>
  );
}

function BoundaryNotice() {
  return (
    <section className="border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-base font-semibold text-amber-950">
        Staking position boundary
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        This phase validates Principal Lock, matured Principal Unlock, and
        one-time snapshot reward settlement only. External account identifiers,
        transactions, repeated claims, and on-chain staking are not provided.
      </p>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        PPM is a fixed term snapshot condition. The browser never accepts a
        reward amount or computes the reward locally.
      </p>
    </section>
  );
}

function LifecycleSummary({
  lifecycle,
  staking,
}: {
  lifecycle: StakingLifecycle;
  staking: ReadyStaking;
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-4">
      <Detail label="Wallet status" value={staking.wallet.status} />
      <Detail
        label="Open products"
        value={String(lifecycle.openProducts.length)}
      />
      <Detail
        label="Upcoming products"
        value={String(lifecycle.upcomingProducts.length)}
      />
      <Detail
        label="Active locks"
        value={String(lifecycle.activeLocks.length)}
      />
      <Detail
        label="Matured principal"
        value={String(lifecycle.maturedPrincipalCount)}
      />
      <Detail
        label="Claimable rewards"
        value={String(lifecycle.claimableRewardCount)}
      />
      <Detail
        label="Completed rewards"
        value={String(lifecycle.completed.length)}
      />
      <Detail
        label="Total positions"
        value={String(staking.positions.length)}
      />
    </section>
  );
}

function AssetBalanceSection({
  balances,
}: {
  balances: CurrentStakingBalance[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Asset balances</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-600">
        Each asset is displayed independently from the ledger balance read.
        The page does not combine assets or convert atomic units.
      </p>
      {balances.length > 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {balances.map((balance) => (
            <article className="border border-zinc-100 p-4" key={balance.assetId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-xs text-zinc-500">
                    {balance.assetCode}
                  </div>
                  <h3 className="mt-1 text-base font-semibold">
                    {balance.symbol}
                  </h3>
                </div>
                <span className="border border-zinc-200 px-3 py-1 text-xs text-zinc-600">
                  decimals {balance.decimals}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Detail
                  label="Available"
                  value={formatAtomicUnitsForDisplay(balance.availableUnits)}
                />
                <Detail
                  label="Locked"
                  value={formatAtomicUnitsForDisplay(balance.lockedUnits)}
                />
                <Detail
                  label="Pending deposit"
                  value={formatAtomicUnitsForDisplay(
                    balance.pendingDepositUnits,
                  )}
                />
                <Detail
                  label="Pending withdrawal"
                  value={formatAtomicUnitsForDisplay(
                    balance.pendingWithdrawalUnits,
                  )}
                />
                <div className="sm:col-span-2">
                  <Detail
                    label="Total liability"
                    value={formatAtomicUnitsForDisplay(
                      balance.totalLiabilityUnits,
                    )}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 border border-zinc-100 p-5 text-sm text-zinc-600">
          No asset balance rows exist for this managed wallet yet.
        </p>
      )}
    </section>
  );
}

function ProductSection({
  balancesByAssetId,
  openProducts,
  upcomingProducts,
  wallet,
}: {
  balancesByAssetId: Map<string, CurrentStakingBalance>;
  openProducts: CurrentStakingProduct[];
  upcomingProducts: CurrentStakingProduct[];
  wallet: ReadyStaking["wallet"];
}) {
  const products = [...openProducts, ...upcomingProducts];

  return (
    <section className="border border-zinc-200 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Products</h2>
          <p className="mt-1 text-sm text-zinc-600">
            OPEN products can accept a principal lock when this managed wallet
            is ACTIVE and the matching asset has available atomic units.
            UPCOMING products are displayed without a form.
          </p>
        </div>
      </div>

      {products.length > 0 ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {products.map((product) => (
            <ProductCard
              balance={balancesByAssetId.get(product.assetId) ?? null}
              key={product.stakingProductId}
              product={product}
              wallet={wallet}
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
    wallet.status === "ACTIVE" &&
    product.enrollmentState === "OPEN" &&
    balance !== null &&
    isPositiveAtomicUnits(balance.availableUnits);

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
        <Detail
          label="Enrollment starts"
          value={formatTimestamp(product.enrollmentStartsAt)}
        />
        <Detail
          label="Enrollment ends"
          value={formatTimestamp(product.enrollmentEndsAt)}
        />
      </div>

      {product.enrollmentState === "OPEN" ? (
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
              : "Principal lock requires an ACTIVE wallet, OPEN enrollment, and available atomic units for this asset."}
          </p>
        </form>
      ) : (
        <p className="mt-5 border-t border-zinc-100 pt-5 text-sm leading-6 text-zinc-600">
          Enrollment has not started. The product terms are visible, but no
          principal lock form is available for UPCOMING products.
        </p>
      )}
    </article>
  );
}

function ActionRequiredSection({
  positions,
  wallet,
}: {
  positions: CurrentStakingPosition[];
  wallet: ReadyStaking["wallet"];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Action Required</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-600">
        Matured principal unlocks are listed before claimable rewards. These
        are DB-derived states from the position read RPC, not browser clock
        decisions.
      </p>
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
          No matured principal or claimable reward action is currently waiting.
        </p>
      )}
    </section>
  );
}

function ActiveLockSection({
  positions,
}: {
  positions: CurrentStakingPosition[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Active Locks</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-600">
        Principal is currently in the USER_LOCKED bucket before database-time
        maturity. Early unlock, partial unlock, and position cancellation are
        not available.
      </p>
      {positions.length > 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {positions.map((position) => (
            <ReadOnlyPositionCard
              key={position.stakingPositionId}
              position={position}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 border border-zinc-100 p-5 text-sm text-zinc-600">
          No active principal locks are waiting for maturity.
        </p>
      )}
    </section>
  );
}

function CompletedSection({
  positions,
}: {
  positions: CurrentStakingPosition[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Completed</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-600">
        Completed positions are final. PAID rewards credited Available units;
        ZERO rewards recorded a final settlement without a ledger journal.
      </p>
      {positions.length > 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {positions.map((position) => (
            <ReadOnlyPositionCard
              key={position.stakingPositionId}
              position={position}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 border border-zinc-100 p-5 text-sm text-zinc-600">
          No paid or zero reward settlement history exists yet.
        </p>
      )}
    </section>
  );
}

function ReadOnlyPositionCard({
  position,
}: {
  position: CurrentStakingPosition;
}) {
  const rewardCopy =
    position.rewardState === "PAID"
      ? "Principal returned and reward paid to Available units."
      : position.rewardState === "ZERO"
        ? "Principal returned and reward finalized at zero atomic units without a journal."
        : position.status === "LOCKED"
          ? "Principal remains in USER_LOCKED until database-time maturity."
          : "Principal is unlocked and reward settlement is pending.";

  return (
    <article className="border border-zinc-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-zinc-500">
            {shortIdentifier(position.stakingPositionId)}
          </div>
          <h3 className="mt-1 text-xl font-semibold">
            {position.productDisplayName}
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            {position.productCode} / {position.projectCode}
          </p>
        </div>
        <span className="border border-zinc-200 px-3 py-1 text-xs text-zinc-600">
          {position.status} / {position.maturityState}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Detail
          label="Asset"
          value={`${position.assetSymbol} / ${position.assetCode}`}
        />
        <Detail
          label="Principal"
          value={formatAtomicUnitsForDisplay(position.principalUnits)}
        />
        <Detail
          label="Duration snapshot"
          value={`${position.lockDurationDaysSnapshot} days`}
        />
        <Detail
          label="Reward snapshot"
          value={`${position.termRewardRatePpmSnapshot} ppm / ${position.rewardRoundingModeSnapshot}`}
        />
        <Detail label="Locked at" value={formatTimestamp(position.lockedAt)} />
        <Detail label="Matures at" value={formatTimestamp(position.maturesAt)} />
        <Detail
          label="Unlocked at"
          value={
            position.unlockedAt
              ? formatTimestamp(position.unlockedAt)
              : "Not unlocked"
          }
        />
        <Detail label="Reward state" value={position.rewardState} />
        <Detail
          label="Calculated reward"
          value={formatAtomicUnitsForDisplay(position.calculatedRewardUnits)}
        />
        <Detail
          label="Reward settled"
          value={
            position.rewardSettledAt
              ? formatTimestamp(position.rewardSettledAt)
              : "Not settled"
          }
        />
        <Detail
          label="Reward actor"
          value={position.rewardActorType ?? "Not settled"}
        />
        <Detail
          label="Position version"
          value={String(position.positionVersion)}
        />
      </div>
      <p className="mt-4 border border-zinc-100 p-4 text-sm leading-6 text-zinc-600">
        {rewardCopy}
      </p>
    </article>
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
  const canSettleReward =
    position.status === "UNLOCKED" &&
    position.rewardState === "CLAIMABLE" &&
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
        <Detail label="Reward state" value={position.rewardState} />
        <Detail
          label="Calculated reward"
          value={formatAtomicUnitsForDisplay(
            position.calculatedRewardUnits,
          )}
        />
        {position.rewardSettledAt ? (
          <Detail
            label="Reward settled"
            value={formatTimestamp(position.rewardSettledAt)}
          />
        ) : null}
        {position.rewardActorType ? (
          <Detail
            label="Reward actor"
            value={position.rewardActorType}
          />
        ) : null}
      </div>
      <p className="mt-4 text-sm leading-6 text-zinc-600">
        Product status changes after creation do not alter this snapshot.
        Unlock moves matured principal only. Reward settlement is a separate
        one-time command after unlock.
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
      {position.status === "UNLOCKED" && position.rewardState === "CLAIMABLE" ? (
        <form
          action="/api/v1/staking/positions/settle-reward"
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
            disabled={!canSettleReward}
            type="submit"
          >
            Settle reward
          </button>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            {canSettleReward
              ? "Credits the calculated snapshot reward to Available units."
              : "Reward settlement requires an ACTIVE wallet; an administrator may review the unlocked position."}
          </p>
        </form>
      ) : null}
      {position.status === "UNLOCKED" &&
      (position.rewardState === "PAID" || position.rewardState === "ZERO") ? (
        <p className="mt-4 border border-zinc-100 p-4 text-sm leading-6 text-zinc-600">
          Reward settlement is final for this position.
        </p>
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

type StakingLifecycle = {
  actionRequired: CurrentStakingPosition[];
  activeLocks: CurrentStakingPosition[];
  completed: CurrentStakingPosition[];
  openProducts: CurrentStakingProduct[];
  upcomingProducts: CurrentStakingProduct[];
  balancesByAssetId: Map<string, CurrentStakingBalance>;
  maturedPrincipalCount: number;
  claimableRewardCount: number;
};

function buildLifecycle(staking: ReadyStaking): StakingLifecycle {
  const actionRequired = staking.positions
    .filter(isActionRequired)
    .toSorted(compareActionRequired);
  const activeLocks = staking.positions
    .filter(
      (position) =>
        position.status === "LOCKED" && position.maturityState === "LOCKED",
    )
    .toSorted(compareActiveLocks);
  const completed = staking.positions
    .filter(
      (position) =>
        position.status === "UNLOCKED" &&
        (position.rewardState === "PAID" || position.rewardState === "ZERO"),
    )
    .toSorted(compareCompleted);
  const openProducts = staking.products.filter(
    (product) => product.enrollmentState === "OPEN",
  );
  const upcomingProducts = staking.products.filter(
    (product) => product.enrollmentState === "UPCOMING",
  );

  return {
    actionRequired,
    activeLocks,
    completed,
    openProducts,
    upcomingProducts,
    balancesByAssetId: new Map(
      staking.balances.map((balance) => [balance.assetId, balance]),
    ),
    maturedPrincipalCount: staking.positions.filter(
      (position) =>
        position.status === "LOCKED" &&
        position.maturityState === "MATURED",
    ).length,
    claimableRewardCount: staking.positions.filter(
      (position) =>
        position.status === "UNLOCKED" &&
        position.rewardState === "CLAIMABLE",
    ).length,
  };
}

function isActionRequired(position: CurrentStakingPosition): boolean {
  return (
    (position.status === "LOCKED" &&
      position.maturityState === "MATURED") ||
    (position.status === "UNLOCKED" &&
      position.rewardState === "CLAIMABLE")
  );
}

function compareActionRequired(
  left: CurrentStakingPosition,
  right: CurrentStakingPosition,
): number {
  return (
    actionPriority(left) - actionPriority(right) ||
    compareIsoAsc(actionSortTime(left), actionSortTime(right)) ||
    left.stakingPositionId.localeCompare(right.stakingPositionId)
  );
}

function compareActiveLocks(
  left: CurrentStakingPosition,
  right: CurrentStakingPosition,
): number {
  return (
    compareIsoAsc(left.maturesAt, right.maturesAt) ||
    left.stakingPositionId.localeCompare(right.stakingPositionId)
  );
}

function compareCompleted(
  left: CurrentStakingPosition,
  right: CurrentStakingPosition,
): number {
  return (
    compareIsoDesc(completedSortTime(left), completedSortTime(right)) ||
    left.stakingPositionId.localeCompare(right.stakingPositionId)
  );
}

function actionPriority(position: CurrentStakingPosition): number {
  return position.status === "LOCKED" &&
    position.maturityState === "MATURED"
    ? 0
    : 1;
}

function actionSortTime(position: CurrentStakingPosition): string {
  return position.maturityState === "MATURED"
    ? position.maturesAt
    : position.lockedAt;
}

function completedSortTime(position: CurrentStakingPosition): string {
  return position.rewardSettledAt ?? position.unlockedAt ?? position.lockedAt;
}

function compareIsoAsc(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

function compareIsoDesc(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left);
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

function shortIdentifier(value: string): string {
  return value.length > 14
    ? `${value.slice(0, 6)}...${value.slice(-6)}`
    : value;
}

function getSingleValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
