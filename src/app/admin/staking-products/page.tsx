import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getStakingPublicMessage } from "@/lib/staking/public-results";
import {
  listAdminDomainCatalog,
  type AdminProject,
  type AdminProjectTokenAssignment,
  type AdminSupportedAsset,
} from "@/server/admin/domain-commands";
import {
  listAdminStakingProductCatalog,
  type AdminStakingProduct,
  type StakingProductAuditEvent,
} from "@/server/admin/staking-product-commands";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

type AdminStakingProductsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminStakingProductsPage({
  searchParams,
}: AdminStakingProductsPageProps) {
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
  const resultMessage = getStakingPublicMessage(
    getSingleValue(params.result),
  );
  const errorMessage =
    getStakingPublicMessage(getSingleValue(params.error)) ??
    getPublicAuthErrorMessage(getSingleValue(params.error));
  const [domainCatalog, stakingCatalog] = await Promise.all([
    listAdminDomainCatalog(100),
    listAdminStakingProductCatalog(),
  ]);

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/admin">
            Admin
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Staking product commands
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              AAL2 administrator commands for product terms and lifecycle
              state. Commands do not create staking positions, post ledger
              entries, lock principal, calculate rewards, or contact a chain.
            </p>
          </div>
          <nav className="flex flex-wrap gap-3">
            <AdminLink href="/admin/staking-positions">
              Position operations
            </AdminLink>
            <AdminLink href="/admin">Admin home</AdminLink>
          </nav>
        </header>

        <OperationsNotice />

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

        {domainCatalog.ok && stakingCatalog.ok ? (
          <>
            <ProductOperationsSummary
              assignments={domainCatalog.assignments}
              products={stakingCatalog.products}
            />
            <section className="grid gap-5 xl:grid-cols-3">
              <CreateProductForm
                assets={domainCatalog.assets}
                projects={domainCatalog.projects}
              />
              <DraftUpdateForms products={stakingCatalog.products} />
              <TransitionForms products={stakingCatalog.products} />
            </section>

            <ProductTable
              assignments={domainCatalog.assignments}
              products={stakingCatalog.products}
            />
            <StakingAuditTable events={stakingCatalog.auditEvents} />
          </>
        ) : (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {domainCatalog.ok
              ? "Staking product catalog is unavailable."
              : "Project and asset catalog is unavailable."}
          </p>
        )}
      </div>
    </main>
  );
}

function OperationsNotice() {
  return (
    <section className="border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-base font-semibold text-amber-950">
        Product and position lifecycle are separate
      </h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        Product SUSPENDED or ARCHIVED controls new position enrollment only.
        It does not rewrite existing position snapshots or remove matured
        principal and reward obligations. Use Position operations for AAL2
        cleanup of existing positions.
      </p>
    </section>
  );
}

function ProductOperationsSummary({
  assignments,
  products,
}: {
  assignments: AdminProjectTokenAssignment[];
  products: AdminStakingProduct[];
}) {
  const currentTokenCount = products.filter((product) =>
    isCurrentAssignment(product, assignments),
  ).length;

  return (
    <section className="grid gap-4 sm:grid-cols-4">
      <Detail label="Draft" value={String(countProducts(products, "DRAFT"))} />
      <Detail
        label="Active"
        value={String(countProducts(products, "ACTIVE"))}
      />
      <Detail
        label="Suspended"
        value={String(countProducts(products, "SUSPENDED"))}
      />
      <Detail
        label="Archived"
        value={String(countProducts(products, "ARCHIVED"))}
      />
      <Detail
        label="Open enrollment"
        value={String(countEnrollment(products, "OPEN"))}
      />
      <Detail
        label="Upcoming enrollment"
        value={String(countEnrollment(products, "UPCOMING"))}
      />
      <Detail label="Current token" value={String(currentTokenCount)} />
      <Detail label="Total products" value={String(products.length)} />
    </section>
  );
}

function CreateProductForm({
  assets,
  projects,
}: {
  assets: AdminSupportedAsset[];
  projects: AdminProject[];
}) {
  return (
    <StakingCommandForm
      action="/api/v1/admin/staking-products/create"
      buttonLabel="Create draft"
      title="Create product draft"
    >
      <ProjectSelect projects={projects} />
      <AssetSelect assets={assets} />
      <TextInput label="Product code" maxLength={32} name="product_code" />
      <TextInput label="Display name" maxLength={100} name="display_name" />
      <TextArea label="Description" maxLength={1000} name="description" />
      <TextInput
        inputMode="numeric"
        label="Lock duration days"
        name="lock_duration_days"
      />
      <TextInput
        inputMode="numeric"
        label="Minimum stake units"
        maxLength={38}
        name="min_stake_units"
      />
      <TextInput
        inputMode="numeric"
        label="Maximum stake units"
        maxLength={38}
        name="max_stake_units"
        required={false}
      />
      <TextInput
        inputMode="numeric"
        label="Term reward PPM"
        name="term_reward_rate_ppm"
      />
      <TextInput
        label="Enrollment starts at"
        name="enrollment_starts_at"
        placeholder="2026-07-21T00:00:00Z"
      />
      <TextInput
        label="Enrollment ends at"
        name="enrollment_ends_at"
        placeholder="2026-08-21T00:00:00Z"
      />
      <ReasonInput />
    </StakingCommandForm>
  );
}

function DraftUpdateForms({
  products,
}: {
  products: AdminStakingProduct[];
}) {
  const draftProducts = products.filter((product) => product.status === "DRAFT");

  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Update drafts</h2>
      {draftProducts.length > 0 ? (
        <div className="mt-4 grid gap-4">
          {draftProducts.map((product) => (
            <form
              action="/api/v1/admin/staking-products/update-draft"
              className="grid gap-3 border border-zinc-100 p-4"
              key={product.stakingProductId}
              method="post"
            >
              <input name="command_id" type="hidden" value={randomUUID()} />
              <input
                name="staking_product_id"
                type="hidden"
                value={product.stakingProductId}
              />
              <input
                name="expected_version"
                type="hidden"
                value={product.version}
              />
              <input
                name="project_id"
                type="hidden"
                value={product.projectId}
              />
              <input name="asset_id" type="hidden" value={product.assetId} />
              <p className="text-sm font-medium">
                {product.productCode} / v{product.version}
              </p>
              <TextInput
                defaultValue={product.displayName}
                label="Display name"
                maxLength={100}
                name="display_name"
              />
              <TextArea
                defaultValue={product.description ?? ""}
                label="Description"
                maxLength={1000}
                name="description"
              />
              <TextInput
                defaultValue={String(product.lockDurationDays)}
                inputMode="numeric"
                label="Lock duration days"
                name="lock_duration_days"
              />
              <TextInput
                defaultValue={product.minStakeUnits}
                inputMode="numeric"
                label="Minimum stake units"
                maxLength={38}
                name="min_stake_units"
              />
              <TextInput
                defaultValue={product.maxStakeUnits ?? ""}
                inputMode="numeric"
                label="Maximum stake units"
                maxLength={38}
                name="max_stake_units"
                required={false}
              />
              <TextInput
                defaultValue={String(product.termRewardRatePpm)}
                inputMode="numeric"
                label="Term reward PPM"
                name="term_reward_rate_ppm"
              />
              <TextInput
                defaultValue={product.enrollmentStartsAt}
                label="Enrollment starts at"
                name="enrollment_starts_at"
              />
              <TextInput
                defaultValue={product.enrollmentEndsAt}
                label="Enrollment ends at"
                name="enrollment_ends_at"
              />
              <ReasonInput />
              <button
                className="h-10 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
                type="submit"
              >
                Update draft
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No draft products.</p>
      )}
    </section>
  );
}

function TransitionForms({
  products,
}: {
  products: AdminStakingProduct[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Transitions</h2>
      {products.length > 0 ? (
        <div className="mt-4 grid gap-4">
          {products.map((product) => (
            <article
              className="border border-zinc-100 p-4"
              key={product.stakingProductId}
            >
              <p className="text-sm font-medium">
                {product.productCode} / {product.status} / v{product.version}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {allowedTransitions(product.status).map((status) => (
                  <TransitionButton
                    key={status}
                    product={product}
                    status={status}
                  />
                ))}
                {allowedTransitions(product.status).length === 0 ? (
                  <span className="text-sm text-zinc-600">
                    No transition available.
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No products.</p>
      )}
    </section>
  );
}

function TransitionButton({
  product,
  status,
}: {
  product: AdminStakingProduct;
  status: string;
}) {
  return (
    <form action="/api/v1/admin/staking-products/transition" method="post">
      <input name="command_id" type="hidden" value={randomUUID()} />
      <input
        name="staking_product_id"
        type="hidden"
        value={product.stakingProductId}
      />
      <input
        name="expected_version"
        type="hidden"
        value={product.version}
      />
      <input name="new_status" type="hidden" value={status} />
      <input
        name="reason"
        type="hidden"
        value={`transition staking product to ${status}`}
      />
      <button
        className="h-9 border border-zinc-300 px-3 text-xs font-medium text-zinc-900"
        type="submit"
      >
        {status}
      </button>
    </form>
  );
}

function StakingCommandForm({
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

function ProjectSelect({ projects }: { projects: AdminProject[] }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      Project
      <select
        className="h-11 border border-zinc-300 bg-white px-3 text-sm"
        name="project_id"
        required
      >
        {projects.map((project) => (
          <option key={project.projectId} value={project.projectId}>
            {project.projectCode} / {project.status}
          </option>
        ))}
      </select>
    </label>
  );
}

function AssetSelect({ assets }: { assets: AdminSupportedAsset[] }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      Asset
      <select
        className="h-11 border border-zinc-300 bg-white px-3 text-sm"
        name="asset_id"
        required
      >
        {assets.map((asset) => (
          <option key={asset.assetId} value={asset.assetId}>
            {asset.assetCode} / {asset.symbol} / {asset.assetType} /{" "}
            {asset.status}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextInput({
  defaultValue,
  inputMode,
  label,
  maxLength,
  name,
  placeholder,
  required = true,
}: {
  defaultValue?: string;
  inputMode?: "numeric";
  label: string;
  maxLength?: number;
  name: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <input
        autoComplete="off"
        className="h-11 border border-zinc-300 px-3 font-mono text-sm"
        defaultValue={defaultValue}
        inputMode={inputMode}
        maxLength={maxLength ?? 64}
        name={name}
        placeholder={placeholder}
        required={required}
        type="text"
      />
    </label>
  );
}

function TextArea({
  defaultValue,
  label,
  maxLength,
  name,
}: {
  defaultValue?: string;
  label: string;
  maxLength: number;
  name: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <textarea
        className="min-h-24 resize-y border border-zinc-300 px-3 py-2 text-sm leading-6"
        defaultValue={defaultValue}
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

function ProductTable({
  assignments,
  products,
}: {
  assignments: AdminProjectTokenAssignment[];
  products: AdminStakingProduct[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Products</h2>
      {products.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Product</th>
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Term</th>
                <th className="py-2 pr-4 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={product.stakingProductId}
                >
                  <td className="py-3 pr-4">
                    <div className="font-mono text-xs text-zinc-500">
                      {product.productCode}
                    </div>
                    <div className="font-medium">{product.displayName}</div>
                    <div className="text-zinc-600">
                      {shortUuid(product.stakingProductId)} / v
                      {product.version}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {product.projectCode} / {product.projectStatus}
                  </td>
                  <td className="py-3 pr-4">
                    {product.assetCode} / {product.assetSymbol} /{" "}
                    {product.assetType} / {product.assetStatus}
                    <div className="text-zinc-600">
                      Current token:{" "}
                      {isCurrentAssignment(product, assignments)
                        ? "yes"
                        : "no"}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {product.lockDurationDays} days /{" "}
                    {product.termRewardRatePpm} ppm
                    <div className="text-zinc-600">
                      {product.minStakeUnits} min
                      {product.maxStakeUnits
                        ? ` / ${product.maxStakeUnits} max`
                        : " / no max"}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {product.status} / {product.enrollmentState}
                    <div className="text-zinc-600">
                      {formatTimestamp(product.enrollmentStartsAt)} {"->"}{" "}
                      {formatTimestamp(product.enrollmentEndsAt)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No staking products.</p>
      )}
    </section>
  );
}

function StakingAuditTable({
  events,
}: {
  events: StakingProductAuditEvent[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Staking product audit</h2>
      {events.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Product</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Version</th>
                <th className="py-2 pr-4 font-medium">Reason</th>
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
                    {shortUuid(event.stakingProductId)}
                  </td>
                  <td className="py-3 pr-4">
                    {event.previousStatus ?? "None"} {"->"}{" "}
                    {event.resultingStatus}
                  </td>
                  <td className="py-3 pr-4">{event.entityVersion}</td>
                  <td className="max-w-sm py-3 pr-4 text-zinc-700">
                    {event.reason}
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

function allowedTransitions(status: string): string[] {
  switch (status) {
    case "DRAFT":
      return ["ACTIVE", "ARCHIVED"];
    case "ACTIVE":
      return ["SUSPENDED"];
    case "SUSPENDED":
      return ["ACTIVE", "ARCHIVED"];
    default:
      return [];
  }
}

function isCurrentAssignment(
  product: AdminStakingProduct,
  assignments: AdminProjectTokenAssignment[],
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.projectId === product.projectId &&
      assignment.assetId === product.assetId &&
      assignment.retiredAt === null,
  );
}

function countProducts(
  products: AdminStakingProduct[],
  status: string,
): number {
  return products.filter((product) => product.status === status).length;
}

function countEnrollment(
  products: AdminStakingProduct[],
  enrollmentState: string,
): number {
  return products.filter(
    (product) => product.enrollmentState === enrollmentState,
  ).length;
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
  return typeof value === "string" ? value : null;
}

function shortUuid(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}
