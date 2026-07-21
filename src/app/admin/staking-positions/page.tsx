import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { formatAtomicUnitsForDisplay } from "@/lib/ledger/atomic-units";
import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getStakingPublicMessage } from "@/lib/staking/public-results";
import {
  listAdminStakingPositionCatalog,
  type AdminStakingPosition,
  type StakingPositionAuditEvent,
  type StakingRewardAuditEvent,
} from "@/server/admin/staking-position-reads";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

type AdminStakingPositionsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminStakingPositionsPage({
  searchParams,
}: AdminStakingPositionsPageProps) {
  const adminAccess = await getCurrentAdminAccess();

  if (adminAccess.status === "anonymous") {
    redirect("/auth/sign-in?next=/admin");
  }

  if (adminAccess.status === "inactive") {
    redirect("/auth/account-unavailable");
  }

  if (adminAccess.status === "missing_profile") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (adminAccess.status === "not_admin") {
    redirect("/auth/error?code=admin_forbidden");
  }

  if (adminAccess.status === "mfa_enrollment_required") {
    redirect("/auth/mfa/enroll");
  }

  if (adminAccess.status === "mfa_challenge_required") {
    redirect("/auth/mfa/challenge");
  }

  if (adminAccess.status === "unavailable") {
    redirect("/auth/error?code=mfa_unavailable");
  }

  const catalog = await listAdminStakingPositionCatalog();
  const params = await searchParams;
  const resultMessage = getStakingPublicMessage(
    getSingleValue(params.result),
  );
  const errorMessage =
    getStakingPublicMessage(getSingleValue(params.error)) ??
    getPublicAuthErrorMessage(getSingleValue(params.error));

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/admin">
            Admin
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Staking positions
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              AAL2 administrator read boundary for LOCKED staking positions
              plus principal unlock and one-time reward settlement commands.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <AdminLink href="/admin/staking-products">
              Product operations
            </AdminLink>
            <AdminLink href="/admin">Admin home</AdminLink>
          </nav>
        </header>

        <BoundaryNotice />

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

        {catalog.ok ? (
          <>
            <OperationsSummary positions={catalog.positions} />
            <PositionTable
              description="Matured LOCKED positions that can be unlocked by an AAL2 administrator."
              positions={buildAdminQueues(catalog.positions).principalQueue}
              title="Principal Unlock Queue"
            />
            <PositionTable
              description="UNLOCKED positions with claimable snapshot rewards."
              positions={buildAdminQueues(catalog.positions).rewardQueue}
              title="Reward Settlement Queue"
            />
            <PositionTable
              description="LOCKED positions that are not yet mature according to the DB-derived maturity state."
              positions={buildAdminQueues(catalog.positions).activeLocks}
              title="Active Locks"
            />
            <PositionTable
              description="Positions with final PAID or ZERO reward settlement state."
              positions={buildAdminQueues(catalog.positions).completed}
              title="Completed"
            />
            <AuditTable events={catalog.auditEvents} />
            <RewardAuditTable events={catalog.rewardAuditEvents} />
          </>
        ) : (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {getStakingPublicMessage(catalog.error) ??
              getPublicAuthErrorMessage(catalog.error) ??
              "Staking position catalog is unavailable."}
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
        Read-only position operations
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        This page exposes matured principal unlock and one-time reward
        settlement commands only. It does not accept reward amounts, display
        external account identifiers, cancel positions, or connect to
        on-chain staking.
      </p>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        Product status changes do not erase existing position obligations.
        Inactive profiles and FROZEN or CLOSED wallets may still require AAL2
        cleanup for matured principal or already unlocked rewards.
      </p>
    </section>
  );
}

function OperationsSummary({
  positions,
}: {
  positions: AdminStakingPosition[];
}) {
  const queues = buildAdminQueues(positions);
  const inactiveTargets = positions.filter(
    (position) => position.profileStatus !== "ACTIVE",
  ).length;
  const inactiveWalletTargets = positions.filter(
    (position) =>
      position.walletStatus === "FROZEN" || position.walletStatus === "CLOSED",
  ).length;

  return (
    <section className="grid gap-4 sm:grid-cols-4">
      <Detail label="Locked" value={String(countByStatus(positions, "LOCKED"))} />
      <Detail
        label="Matured principal"
        value={String(queues.principalQueue.length)}
      />
      <Detail
        label="Claimable rewards"
        value={String(queues.rewardQueue.length)}
      />
      <Detail
        label="Paid rewards"
        value={String(countByRewardState(positions, "PAID"))}
      />
      <Detail
        label="Zero rewards"
        value={String(countByRewardState(positions, "ZERO"))}
      />
      <Detail label="Completed" value={String(queues.completed.length)} />
      <Detail
        label="Inactive profiles"
        value={String(inactiveTargets)}
      />
      <Detail
        label="Frozen or closed wallets"
        value={String(inactiveWalletTargets)}
      />
    </section>
  );
}

type AdminPositionQueues = {
  principalQueue: AdminStakingPosition[];
  rewardQueue: AdminStakingPosition[];
  activeLocks: AdminStakingPosition[];
  completed: AdminStakingPosition[];
};

function buildAdminQueues(
  positions: AdminStakingPosition[],
): AdminPositionQueues {
  return {
    principalQueue: positions
      .filter(
        (position) =>
          position.status === "LOCKED" &&
          position.maturityState === "MATURED",
      )
      .toSorted(comparePrincipalQueue),
    rewardQueue: positions
      .filter(
        (position) =>
          position.status === "UNLOCKED" &&
          position.rewardState === "CLAIMABLE",
      )
      .toSorted(compareRewardQueue),
    activeLocks: positions
      .filter(
        (position) =>
          position.status === "LOCKED" &&
          position.maturityState === "LOCKED",
      )
      .toSorted(compareActiveLocks),
    completed: positions
      .filter(
        (position) =>
          position.rewardState === "PAID" || position.rewardState === "ZERO",
      )
      .toSorted(compareCompleted),
  };
}

function PositionTable({
  description,
  positions,
  title,
}: {
  description: string;
  positions: AdminStakingPosition[];
  title: string;
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-600">{description}</p>
      {positions.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Product</th>
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Principal</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Maturity</th>
                <th className="py-2 pr-4 font-medium">Locked</th>
                <th className="py-2 pr-4 font-medium">Matures</th>
                <th className="py-2 pr-4 font-medium">Unlocked</th>
                <th className="py-2 pr-4 font-medium">Reward</th>
                <th className="py-2 pr-4 font-medium">Snapshot</th>
                <th className="py-2 pr-4 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={position.stakingPositionId}
                >
                  <td className="py-3 pr-4">
                    <div className="font-mono text-xs text-zinc-500">
                      {position.productCode}
                    </div>
                    <div className="mt-1">{position.projectCode}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-mono text-xs">
                      {shortIdentifier(position.userId)}
                    </div>
                    <div className="mt-1 text-zinc-600">
                      {position.profileStatus} / {position.walletStatus}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {position.assetSymbol} / {position.assetCode}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {formatAtomicUnitsForDisplay(position.principalUnits)}
                  </td>
                  <td className="py-3 pr-4">{position.status}</td>
                  <td className="py-3 pr-4">{position.maturityState}</td>
                  <td className="py-3 pr-4">
                    {formatTimestamp(position.lockedAt)}
                  </td>
                  <td className="py-3 pr-4">
                    {formatTimestamp(position.maturesAt)}
                  </td>
                  <td className="py-3 pr-4">
                    {position.unlockedAt
                      ? `${formatTimestamp(position.unlockedAt)} / ${position.unlockActorType ?? "UNKNOWN"}`
                      : "Not unlocked"}
                  </td>
                  <td className="py-3 pr-4">
                    <div>{position.rewardState}</div>
                    <div className="mt-1 font-mono text-xs text-zinc-600">
                      {formatAtomicUnitsForDisplay(
                        position.calculatedRewardUnits,
                      )}
                    </div>
                    {position.rewardSettledAt ? (
                      <div className="mt-1 text-xs text-zinc-600">
                        {formatTimestamp(position.rewardSettledAt)} /{" "}
                        {position.rewardActorType ?? "UNKNOWN"}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">
                    v{position.productVersionSnapshot} /{" "}
                    {position.lockDurationDaysSnapshot}d /{" "}
                    {position.termRewardRatePpmSnapshot}ppm
                  </td>
                  <td className="min-w-72 py-3 pr-4">
                    <AdminUnlockForm position={position} />
                    <AdminRewardForm position={position} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 border border-zinc-100 p-5 text-sm text-zinc-600">
          No staking positions exist.
        </p>
      )}
    </section>
  );
}

function AdminUnlockForm({ position }: { position: AdminStakingPosition }) {
  const canUnlock =
    position.status === "LOCKED" &&
    position.maturityState === "MATURED";

  if (position.status === "UNLOCKED") {
    return (
      <p className="text-sm leading-6 text-zinc-600">
        Principal terminal. Review reward state below.
      </p>
    );
  }

  if (!canUnlock) {
    return (
      <p className="text-sm leading-6 text-zinc-600">
        Early unlock, partial unlock, and undo are unavailable.
      </p>
    );
  }

  return (
    <form
      action="/api/v1/admin/staking-positions/unlock"
      className="grid gap-3"
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
      <input name="command_id" type="hidden" value={randomUUID()} />
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Reason
        </span>
        <input
          className="mt-2 h-10 w-full border border-zinc-300 px-3 text-sm"
          maxLength={500}
          minLength={1}
          name="reason"
          required
          type="text"
        />
      </label>
      <button
        className="h-10 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        Unlock principal
      </button>
      <p className="text-xs leading-5 text-zinc-600">
        Principal only. Target inactive cleanup is allowed by the DB command
        when ledger accounts remain valid.
      </p>
    </form>
  );
}

function AdminRewardForm({ position }: { position: AdminStakingPosition }) {
  const canSettleReward =
    position.status === "UNLOCKED" &&
    position.rewardState === "CLAIMABLE";

  if (position.rewardState === "PAID" || position.rewardState === "ZERO") {
    return (
      <p className="mt-3 text-sm leading-6 text-zinc-600">
        Reward settlement is final.
      </p>
    );
  }

  if (!canSettleReward) {
    return (
      <p className="mt-3 text-sm leading-6 text-zinc-600">
        Reward settlement is available after principal unlock.
      </p>
    );
  }

  return (
    <form
      action="/api/v1/admin/staking-positions/settle-reward"
      className="mt-5 grid gap-3 border-t border-zinc-100 pt-5"
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
      <input name="command_id" type="hidden" value={randomUUID()} />
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Reward reason
        </span>
        <input
          className="mt-2 h-10 w-full border border-zinc-300 px-3 text-sm"
          maxLength={500}
          minLength={1}
          name="reason"
          required
          type="text"
        />
      </label>
      <button
        className="h-10 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        Settle reward
      </button>
      <p className="text-xs leading-5 text-zinc-600">
        Uses the immutable position snapshot. Target inactive cleanup is
        allowed by the DB command when ledger accounts remain valid.
      </p>
    </form>
  );
}

function AuditTable({ events }: { events: StakingPositionAuditEvent[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Position command audit</h2>
      {events.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Principal</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Occurred</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={event.eventId}
                >
                  <td className="py-3 pr-4">{event.action}</td>
                  <td className="py-3 pr-4">{event.outcome}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {formatAtomicUnitsForDisplay(event.principalUnits)}
                  </td>
                  <td className="py-3 pr-4">{event.resultingStatus}</td>
                  <td className="py-3 pr-4">
                    {formatTimestamp(event.occurredAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 border border-zinc-100 p-5 text-sm text-zinc-600">
          No staking position audit events exist.
        </p>
      )}
    </section>
  );
}

function RewardAuditTable({
  events,
}: {
  events: StakingRewardAuditEvent[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Reward command audit</h2>
      {events.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Reward</th>
                <th className="py-2 pr-4 font-medium">Actor</th>
                <th className="py-2 pr-4 font-medium">Occurred</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={event.eventId}
                >
                  <td className="py-3 pr-4">{event.action}</td>
                  <td className="py-3 pr-4">
                    {event.outcome} / {event.settlementOutcome}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {formatAtomicUnitsForDisplay(event.rewardUnits)}
                  </td>
                  <td className="py-3 pr-4">{event.actorType}</td>
                  <td className="py-3 pr-4">
                    {formatTimestamp(event.occurredAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 border border-zinc-100 p-5 text-sm text-zinc-600">
          No staking reward audit events exist.
        </p>
      )}
    </section>
  );
}

function shortIdentifier(value: string): string {
  return value.length > 14
    ? `${value.slice(0, 6)}...${value.slice(-6)}`
    : value;
}

function countByStatus(
  positions: AdminStakingPosition[],
  status: AdminStakingPosition["status"],
): number {
  return positions.filter((position) => position.status === status).length;
}

function countByRewardState(
  positions: AdminStakingPosition[],
  rewardState: AdminStakingPosition["rewardState"],
): number {
  return positions.filter((position) => position.rewardState === rewardState)
    .length;
}

function comparePrincipalQueue(
  left: AdminStakingPosition,
  right: AdminStakingPosition,
): number {
  return (
    compareIsoAsc(left.maturesAt, right.maturesAt) ||
    left.stakingPositionId.localeCompare(right.stakingPositionId)
  );
}

function compareRewardQueue(
  left: AdminStakingPosition,
  right: AdminStakingPosition,
): number {
  return (
    compareIsoAsc(left.unlockedAt ?? left.lockedAt, right.unlockedAt ?? right.lockedAt) ||
    left.stakingPositionId.localeCompare(right.stakingPositionId)
  );
}

function compareActiveLocks(
  left: AdminStakingPosition,
  right: AdminStakingPosition,
): number {
  return (
    compareIsoAsc(left.maturesAt, right.maturesAt) ||
    left.stakingPositionId.localeCompare(right.stakingPositionId)
  );
}

function compareCompleted(
  left: AdminStakingPosition,
  right: AdminStakingPosition,
): number {
  return (
    compareIsoDesc(completedSortTime(left), completedSortTime(right)) ||
    left.stakingPositionId.localeCompare(right.stakingPositionId)
  );
}

function completedSortTime(position: AdminStakingPosition): string {
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
    <div className="border border-zinc-200 p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </h2>
      <p className="mt-2 break-words text-base font-medium">{value}</p>
    </div>
  );
}

function AdminLink({
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

function getSingleValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}
