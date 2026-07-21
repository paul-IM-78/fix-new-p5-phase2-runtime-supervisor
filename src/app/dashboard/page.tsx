import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getCurrentDashboard,
  type CurrentDashboardAsset,
  type CurrentDashboardAssignment,
  type CurrentDashboardProject,
  type CurrentDashboardResult,
} from "@/server/dashboard/current-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type ReadyDashboard = Extract<CurrentDashboardResult, { status: "ready" }>;

export default async function DashboardPage() {
  const dashboard = await getCurrentDashboard();

  if (dashboard.status === "anonymous") {
    redirect("/auth/sign-in?next=/dashboard");
  }

  if (dashboard.status === "inactive_profile") {
    redirect("/auth/account-unavailable");
  }

  if (dashboard.status === "missing_wallet") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (dashboard.status === "unavailable") {
    redirect("/auth/error?code=auth_unavailable");
  }

  return <DashboardView dashboard={dashboard} />;
}

function DashboardView({ dashboard }: { dashboard: ReadyDashboard }) {
  const displayName = dashboard.profile.displayName ?? "Managed wallet user";
  const currentAssignment = dashboard.catalog.assignments.at(0) ?? null;
  const assignedProject = currentAssignment
    ? dashboard.catalog.projects.find(
        (project) => project.id === currentAssignment.projectId,
      ) ?? null
    : null;
  const assignedAsset = currentAssignment
    ? dashboard.catalog.assets.find(
        (asset) => asset.id === currentAssignment.assetId,
      ) ?? null
    : null;

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/">
            Staking Wallet Web
          </Link>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-normal">
              Dashboard
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-zinc-600">
              {displayName} can review profile state, managed wallet account
              state, and active catalog metadata in one place.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <DashboardLink href="/account">Account</DashboardLink>
            <DashboardLink href="/catalog">Catalog</DashboardLink>
            <DashboardLink href="/wallet">Wallet</DashboardLink>
            <DashboardLink href="/balances">Balances</DashboardLink>
            <DashboardLink href="/deposits">Deposits</DashboardLink>
            <DashboardLink href="/withdrawals">Withdrawals</DashboardLink>
          </nav>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Detail label="Profile status" value={dashboard.profile.accountStatus} />
          <Detail
            label="Profile version"
            value={String(dashboard.profile.version)}
          />
          <Detail
            label="Account model"
            value="Managed wallet account"
          />
        </section>

        <section className="border border-zinc-200 p-5">
          <h2 className="text-base font-semibold">Financial state overview</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Use Balances to review asset-level internal ledger buckets together
            with recent deposit and withdrawal states. The dashboard keeps this
            summary as a link rather than duplicating balance reads.
          </p>
          <Link
            className="mt-4 inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/balances"
          >
            Balances
          </Link>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <WalletSection wallet={dashboard.wallet} />
          <ProjectSection projects={dashboard.catalog.projects} />
        </section>

        <AssetSection assets={dashboard.catalog.assets} />

        <AssignmentSection
          assignment={currentAssignment}
          asset={assignedAsset}
          project={assignedProject}
        />
      </div>
    </main>
  );
}

function DashboardLink({
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

function WalletSection({
  wallet,
}: {
  wallet: ReadyDashboard["wallet"];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Wallet status</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <Detail label="Custody model" value={wallet.custodyModel} />
        <Detail label="Status" value={wallet.accountStatus} />
        <Detail label="Version" value={String(wallet.version)} />
        <Detail label="Updated" value={formatTimestamp(wallet.updatedAt)} />
        {wallet.accountStatus === "CLOSED" ? (
          <Detail
            label="Closed"
            value={
              wallet.closedAt
                ? formatTimestamp(wallet.closedAt)
                : "Closed time unavailable"
            }
          />
        ) : null}
      </div>
      <p className="mt-4 text-sm leading-6 text-zinc-600">
        {getWalletStatusCopy(wallet.accountStatus)}
      </p>
    </section>
  );
}

function ProjectSection({
  projects,
}: {
  projects: CurrentDashboardProject[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Active projects</h2>
      {projects.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {projects.map((project) => (
            <article
              className="border border-zinc-100 p-4"
              key={project.projectCode}
            >
              <div className="font-mono text-xs text-zinc-500">
                {project.projectCode}
              </div>
              <h3 className="mt-2 text-base font-semibold">
                {project.displayName}
              </h3>
              {project.description ? (
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  {project.description}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-zinc-500">
                Version {project.version}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          현재 활성 프로젝트가 없습니다.
        </p>
      )}
    </section>
  );
}

function AssetSection({ assets }: { assets: CurrentDashboardAsset[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Supported assets</h2>
      {assets.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Decimals</th>
                <th className="py-2 pr-4 font-medium">Mint</th>
                <th className="py-2 pr-4 font-medium">Version</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={asset.assetCode}
                >
                  <td className="py-3 pr-4">
                    <div className="font-mono text-xs text-zinc-500">
                      {asset.assetCode}
                    </div>
                    <div className="mt-1 font-medium">{asset.symbol}</div>
                    <div className="text-zinc-600">{asset.displayName}</div>
                  </td>
                  <td className="py-3 pr-4">{asset.assetType}</td>
                  <td className="py-3 pr-4">{asset.decimals}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {asset.assetType === "NATIVE"
                      ? "Native asset"
                      : shortIdentifier(asset.mintAddress)}
                  </td>
                  <td className="py-3 pr-4">{asset.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No active assets are currently published.
        </p>
      )}
    </section>
  );
}

function AssignmentSection({
  assignment,
  asset,
  project,
}: {
  assignment: CurrentDashboardAssignment | null;
  asset: CurrentDashboardAsset | null;
  project: CurrentDashboardProject | null;
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Current project token</h2>
      {assignment && asset && project ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Project code" value={project.projectCode} />
          <Detail label="Token symbol" value={asset.symbol} />
          <Detail label="Token name" value={asset.displayName} />
          <Detail
            label="Assigned"
            value={formatTimestamp(assignment.assignedAt)}
          />
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          현재 프로젝트 토큰이 배정되지 않았습니다.
        </p>
      )}
    </section>
  );
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

function getWalletStatusCopy(status: ReadyDashboard["wallet"]["accountStatus"]) {
  switch (status) {
    case "ACTIVE":
      return "The managed wallet account is active. Local ledger deposit and withdrawal request flows are available for controlled validation only.";
    case "FROZEN":
      return "An administrator has placed an operational freeze on this account. Current state is read only, and future financial mutations are blocked.";
    case "CLOSED":
      return "This managed wallet account is closed and terminal.";
  }
}

function shortIdentifier(value: string | null): string {
  if (!value) {
    return "Unavailable";
  }

  return value.length > 14
    ? `${value.slice(0, 6)}...${value.slice(-6)}`
    : value;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}
