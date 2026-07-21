import Link from "next/link";
import { redirect } from "next/navigation";

import { formatAtomicUnitsForDisplay } from "@/lib/ledger/atomic-units";
import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getStakingPublicMessage } from "@/lib/staking/public-results";
import {
  listAdminStakingPositionCatalog,
  type AdminStakingPosition,
  type StakingPositionAuditEvent,
} from "@/server/admin/staking-position-reads";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminStakingPositionsPage() {
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
              and principal-lock audit summaries.
            </p>
          </div>
        </header>

        <BoundaryNotice />

        {catalog.ok ? (
          <>
            <PositionTable positions={catalog.positions} />
            <AuditTable events={catalog.auditEvents} />
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
        This page does not unlock principal, calculate rewards, post reward
        expense, cancel positions, display wallet addresses, or connect to
        on-chain staking.
      </p>
    </section>
  );
}

function PositionTable({
  positions,
}: {
  positions: AdminStakingPosition[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Positions</h2>
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
                <th className="py-2 pr-4 font-medium">Locked</th>
                <th className="py-2 pr-4 font-medium">Matures</th>
                <th className="py-2 pr-4 font-medium">Snapshot</th>
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
                  <td className="py-3 pr-4">
                    {formatTimestamp(position.lockedAt)}
                  </td>
                  <td className="py-3 pr-4">
                    {formatTimestamp(position.maturesAt)}
                  </td>
                  <td className="py-3 pr-4">
                    v{position.productVersionSnapshot} /{" "}
                    {position.lockDurationDaysSnapshot}d /{" "}
                    {position.termRewardRatePpmSnapshot}ppm
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

function shortIdentifier(value: string): string {
  return value.length > 14
    ? `${value.slice(0, 6)}...${value.slice(-6)}`
    : value;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}
