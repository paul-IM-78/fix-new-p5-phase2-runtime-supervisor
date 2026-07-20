import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getDomainPublicMessage } from "@/lib/domain/public-results";
import {
  listAdminDomainCatalog,
  type AdminProject,
  type AdminProjectTokenAssignment,
  type AdminSupportedAsset,
  type DomainAuditEvent,
} from "@/server/admin/domain-commands";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";
import type { Json } from "@/types/database.types";

type AdminCatalogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminCatalogPage({
  searchParams,
}: AdminCatalogPageProps) {
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

  const params = await searchParams;
  const resultMessage = getDomainPublicMessage(
    getSingleValue(params.result),
  );
  const errorMessage =
    getDomainPublicMessage(getSingleValue(params.error)) ??
    getPublicAuthErrorMessage(getSingleValue(params.error));
  const catalog = await listAdminDomainCatalog(100);

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/admin">
            Admin
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Project and asset catalog
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              AAL2 administrator commands for project metadata, supported
              asset metadata, and project token assignment history. Balances,
              staking positions, APY, and wallet status commands are not
              part of this page.
            </p>
          </div>
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

        {catalog.ok ? (
          <>
            <section className="grid gap-5 lg:grid-cols-2">
              <ProjectCreateForm />
              <ProjectUpdateForm />
              <ProjectTransitionForm />
              <AssetCreateForm />
              <AssetUpdateForm />
              <AssetTransitionForm />
              <ProjectTokenAssignForm />
              <ProjectTokenRetireForm />
            </section>

            <section className="grid gap-5 xl:grid-cols-3">
              <ProjectTable projects={catalog.projects} />
              <AssetTable assets={catalog.assets} />
              <AssignmentTable assignments={catalog.assignments} />
            </section>

            <DomainAuditTable events={catalog.auditEvents} />
          </>
        ) : (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {getDomainPublicMessage(catalog.error) ??
              getPublicAuthErrorMessage(catalog.error) ??
              "Catalog is unavailable."}
          </p>
        )}
      </div>
    </main>
  );
}

function ProjectCreateForm() {
  return (
    <DomainCommandForm
      action="/api/v1/admin/domain/projects/create"
      buttonLabel="Create project"
      title="Create project"
    >
      <TextInput label="Project code" maxLength={32} name="project_code" />
      <TextInput label="Display name" maxLength={100} name="display_name" />
      <TextArea label="Description" maxLength={2000} name="description" />
      <ReasonInput />
    </DomainCommandForm>
  );
}

function ProjectUpdateForm() {
  return (
    <DomainCommandForm
      action="/api/v1/admin/domain/projects/update"
      buttonLabel="Update project"
      title="Update project details"
    >
      <TextInput label="Project UUID" name="project_id" />
      <TextInput
        inputMode="numeric"
        label="Expected version"
        name="expected_version"
      />
      <TextInput label="Display name" maxLength={100} name="display_name" />
      <TextArea label="Description" maxLength={2000} name="description" />
      <ReasonInput />
    </DomainCommandForm>
  );
}

function ProjectTransitionForm() {
  return (
    <DomainCommandForm
      action="/api/v1/admin/domain/projects/transition"
      buttonLabel="Change status"
      title="Change project status"
    >
      <TextInput label="Project UUID" name="project_id" />
      <TextInput
        inputMode="numeric"
        label="Expected version"
        name="expected_version"
      />
      <StatusSelect label="New status" name="new_status" />
      <ReasonInput />
    </DomainCommandForm>
  );
}

function AssetCreateForm() {
  return (
    <DomainCommandForm
      action="/api/v1/admin/domain/assets/create"
      buttonLabel="Create asset"
      title="Create supported asset"
    >
      <TextInput label="Asset code" maxLength={32} name="asset_code" />
      <TextInput label="Symbol" maxLength={16} name="symbol" />
      <TextInput label="Display name" maxLength={100} name="display_name" />
      <label className="flex flex-col gap-2 text-sm font-medium">
        Asset type
        <select
          className="h-11 border border-zinc-300 bg-white px-3 text-sm"
          name="asset_type"
          required
        >
          <option value="SPL_TOKEN">SPL_TOKEN</option>
          <option value="NATIVE">NATIVE</option>
        </select>
      </label>
      <TextInput inputMode="numeric" label="Decimals" name="decimals" />
      <TextInput
        label="Mint address"
        maxLength={44}
        name="mint_address"
        required={false}
      />
      <ReasonInput />
    </DomainCommandForm>
  );
}

function AssetUpdateForm() {
  return (
    <DomainCommandForm
      action="/api/v1/admin/domain/assets/update"
      buttonLabel="Update asset"
      title="Update asset details"
    >
      <TextInput label="Asset UUID" name="asset_id" />
      <TextInput
        inputMode="numeric"
        label="Expected version"
        name="expected_version"
      />
      <TextInput label="Symbol" maxLength={16} name="symbol" />
      <TextInput label="Display name" maxLength={100} name="display_name" />
      <ReasonInput />
    </DomainCommandForm>
  );
}

function AssetTransitionForm() {
  return (
    <DomainCommandForm
      action="/api/v1/admin/domain/assets/transition"
      buttonLabel="Change status"
      title="Change asset status"
    >
      <TextInput label="Asset UUID" name="asset_id" />
      <TextInput
        inputMode="numeric"
        label="Expected version"
        name="expected_version"
      />
      <StatusSelect label="New status" name="new_status" />
      <ReasonInput />
    </DomainCommandForm>
  );
}

function ProjectTokenAssignForm() {
  return (
    <DomainCommandForm
      action="/api/v1/admin/domain/project-token/assign"
      buttonLabel="Assign token"
      title="Assign project token"
    >
      <TextInput label="Project UUID" name="project_id" />
      <TextInput label="Asset UUID" name="asset_id" />
      <ReasonInput />
    </DomainCommandForm>
  );
}

function ProjectTokenRetireForm() {
  return (
    <DomainCommandForm
      action="/api/v1/admin/domain/project-token/retire"
      buttonLabel="Retire token"
      title="Retire project token"
    >
      <TextInput label="Assignment UUID" name="assignment_id" />
      <TextInput
        inputMode="numeric"
        label="Expected version"
        name="expected_version"
      />
      <ReasonInput />
    </DomainCommandForm>
  );
}

function DomainCommandForm({
  action,
  buttonLabel,
  children,
  title,
}: {
  action: string;
  buttonLabel: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <form
      action={action}
      className="flex flex-col gap-4 border border-zinc-200 p-5"
      method="post"
    >
      <input name="command_id" type="hidden" value={randomUUID()} />
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
      <button
        className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        {buttonLabel}
      </button>
    </form>
  );
}

function TextInput({
  inputMode,
  label,
  maxLength,
  name,
  required = true,
}: {
  inputMode?: "numeric";
  label: string;
  maxLength?: number;
  name: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <input
        autoComplete="off"
        className="h-11 border border-zinc-300 px-3 font-mono text-sm"
        inputMode={inputMode}
        maxLength={maxLength ?? 64}
        name={name}
        required={required}
        type="text"
      />
    </label>
  );
}

function TextArea({
  label,
  maxLength,
  name,
}: {
  label: string;
  maxLength: number;
  name: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <textarea
        className="min-h-24 resize-y border border-zinc-300 px-3 py-2 text-sm leading-6"
        maxLength={maxLength}
        name={name}
      />
    </label>
  );
}

function ReasonInput() {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      Reason
      <textarea
        className="min-h-24 resize-y border border-zinc-300 px-3 py-2 text-sm leading-6"
        maxLength={500}
        name="reason"
        required
      />
    </label>
  );
}

function StatusSelect({ label, name }: { label: string; name: string }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <select
        className="h-11 border border-zinc-300 bg-white px-3 text-sm"
        name={name}
        required
      >
        <option value="DRAFT">DRAFT</option>
        <option value="ACTIVE">ACTIVE</option>
        <option value="SUSPENDED">SUSPENDED</option>
        <option value="ARCHIVED">ARCHIVED</option>
      </select>
    </label>
  );
}

function ProjectTable({ projects }: { projects: AdminProject[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Projects</h2>
      {projects.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">ID</th>
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Version</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={project.projectId}
                >
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(project.projectId)}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{project.projectCode}</div>
                    <div className="text-zinc-600">{project.displayName}</div>
                  </td>
                  <td className="py-3 pr-4">{project.status}</td>
                  <td className="py-3 pr-4">{project.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No projects.</p>
      )}
    </section>
  );
}

function AssetTable({ assets }: { assets: AdminSupportedAsset[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Assets</h2>
      {assets.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">ID</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Mint</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={asset.assetId}
                >
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(asset.assetId)}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{asset.assetCode}</div>
                    <div className="text-zinc-600">
                      {asset.symbol} / {asset.assetType} / v{asset.version}
                    </div>
                  </td>
                  <td className="py-3 pr-4">{asset.status}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {asset.mintAddress
                      ? shortIdentifier(asset.mintAddress)
                      : "None"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No assets.</p>
      )}
    </section>
  );
}

function AssignmentTable({
  assignments,
}: {
  assignments: AdminProjectTokenAssignment[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Assignments</h2>
      {assignments.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">ID</th>
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={assignment.assignmentId}
                >
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(assignment.assignmentId)}
                  </td>
                  <td className="py-3 pr-4">{assignment.projectCode}</td>
                  <td className="py-3 pr-4">
                    {assignment.assetCode} / {assignment.assetSymbol}
                  </td>
                  <td className="py-3 pr-4">
                    {assignment.retiredAt ? "RETIRED" : "CURRENT"} / v
                    {assignment.version}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No assignments.</p>
      )}
    </section>
  );
}

function DomainAuditTable({ events }: { events: DomainAuditEvent[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Domain audit</h2>
      {events.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Entity</th>
                <th className="py-2 pr-4 font-medium">Reason</th>
                <th className="py-2 pr-4 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={event.eventId}
                >
                  <td className="py-3 pr-4 whitespace-nowrap text-zinc-600">
                    {formatTimestamp(event.occurredAt)}
                  </td>
                  <td className="py-3 pr-4 font-medium">{event.action}</td>
                  <td className="py-3 pr-4">{event.outcome}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {getAuditEntity(event)}
                  </td>
                  <td className="max-w-xs py-3 pr-4 text-zinc-700">
                    {event.reason}
                  </td>
                  <td className="max-w-md py-3 pr-4 text-zinc-600">
                    {summarizeState(event.beforeState)} {"->"}{" "}
                    {summarizeState(event.afterState)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No audit events.</p>
      )}
    </section>
  );
}

function getAuditEntity(event: DomainAuditEvent): string {
  if (event.assignmentId) {
    return `assignment ${shortUuid(event.assignmentId)}`;
  }

  if (event.projectId) {
    return `project ${shortUuid(event.projectId)}`;
  }

  if (event.assetId) {
    return `asset ${shortUuid(event.assetId)}`;
  }

  return "none";
}

function summarizeState(value: Json | null): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "None";
  }

  const record = value as Record<string, Json | undefined>;
  const parts = [
    stringPart(record.project_code),
    stringPart(record.asset_code),
    stringPart(record.status),
    record.retired_at ? "retired" : null,
    numberPart("v", record.version),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "Changed";
}

function stringPart(value: Json | undefined): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberPart(prefix: string, value: Json | undefined): string | null {
  return typeof value === "number" ? `${prefix}${value}` : null;
}

function getSingleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}

function shortUuid(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function shortIdentifier(value: string): string {
  return value.length > 14
    ? `${value.slice(0, 6)}...${value.slice(-6)}`
    : value;
}
