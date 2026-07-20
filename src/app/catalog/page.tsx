import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getCurrentCatalog,
  type CurrentCatalogAsset,
  type CurrentCatalogAssignment,
  type CurrentCatalogProject,
} from "@/server/domain/current-catalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CatalogPage() {
  const catalog = await getCurrentCatalog();

  if (catalog.status === "anonymous") {
    redirect("/auth/sign-in?next=/catalog");
  }

  if (catalog.status === "inactive_profile") {
    redirect("/auth/account-unavailable");
  }

  if (catalog.status === "missing_profile") {
    redirect("/auth/error?code=account_unavailable");
  }

  if (catalog.status === "unavailable") {
    redirect("/auth/error?code=auth_unavailable");
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <nav className="flex flex-wrap gap-3 text-sm text-zinc-600">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/account">Account</Link>
            <Link href="/wallet">Wallet</Link>
          </nav>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Current catalog
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              Active project and supported asset metadata visible to ACTIVE
              accounts. Financial execution features are not implemented
              here.
            </p>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-2">
          <ProjectSection projects={catalog.projects} />
          <AssetSection assets={catalog.assets} />
        </section>

        <AssignmentSection assignments={catalog.assignments} />
      </div>
    </main>
  );
}

function ProjectSection({
  projects,
}: {
  projects: CurrentCatalogProject[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Projects</h2>
      {projects.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={project.projectCode}
                >
                  <td className="py-3 pr-4 font-mono text-xs">
                    {project.projectCode}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{project.displayName}</div>
                    {project.description ? (
                      <div className="mt-1 text-zinc-600">
                        {project.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">{project.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No active projects are currently published.
        </p>
      )}
    </section>
  );
}

function AssetSection({ assets }: { assets: CurrentCatalogAsset[] }) {
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
                <th className="py-2 pr-4 font-medium">Mint</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={asset.assetCode}
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium">{asset.assetCode}</div>
                    <div className="text-zinc-600">
                      {asset.symbol} / {asset.displayName}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {asset.network} / {asset.assetType} / {asset.decimals}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {asset.mintAddress
                      ? shortIdentifier(asset.mintAddress)
                      : "Native asset"}
                  </td>
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
  assignments,
}: {
  assignments: CurrentCatalogAssignment[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Current assignments</h2>
      {assignments.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Assigned</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={`${assignment.projectCode ?? "project"}-${assignment.assetCode ?? assignment.assetSymbol ?? "asset"}-${assignment.assignedAt}`}
                >
                  <td className="py-3 pr-4">
                    {assignment.projectCode ?? shortUuid(assignment.projectId)}
                  </td>
                  <td className="py-3 pr-4">
                    {assignment.assetCode ?? shortUuid(assignment.assetId)}
                    {assignment.assetSymbol
                      ? ` / ${assignment.assetSymbol}`
                      : ""}
                  </td>
                  <td className="py-3 pr-4 text-zinc-600">
                    {formatTimestamp(assignment.assignedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No current project token assignment is published.
        </p>
      )}
    </section>
  );
}

function shortUuid(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
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
