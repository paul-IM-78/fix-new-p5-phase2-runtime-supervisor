import Link from "next/link";
import { redirect } from "next/navigation";

import {
  formatOptionalAtomicUnits,
  formatOptionalText,
  formatOptionalTimestamp,
  formatSignedAtomicUnits,
  shortIdentifier,
} from "@/lib/reconciliation/display";
import { getReconciliationReadPublicMessage } from "@/lib/reconciliation/public-results";
import {
  parseAdminReconciliationListQuery,
  type AdminReconciliationListQuery,
} from "@/lib/reconciliation/validation";
import {
  listAdminReconciliationItems,
  type AdminReconciliationItemSummary,
} from "@/server/admin/reconciliation-read-model";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

import {
  AdminPageHeader,
  Alert,
  EmptyState,
  MonoValue,
  PageShell,
  Section,
  StatusBadge,
  TableScroller,
} from "./_components";

type AdminReconciliationPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type FilterFormValues = {
  assetId: string;
  runStatus: string;
  classification: string;
  reviewState: string;
  observerKind: string;
  cutoffFrom: string;
  cutoffTo: string;
  limit: string;
};

type ActiveFilter = {
  label: string;
  value: string;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RUN_STATUS_OPTIONS = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
] as const;

const CLASSIFICATION_OPTIONS = [
  "MATCHED",
  "WITHIN_TOLERANCE",
  "MISMATCH",
  "OBSERVATION_FAILED",
  "REVIEW_REQUIRED",
] as const;

const REVIEW_STATE_OPTIONS = [
  "NONE",
  "OPEN",
  "IN_REVIEW",
  "RESOLVED",
  "IGNORED",
] as const;

export default async function AdminReconciliationPage({
  searchParams,
}: AdminReconciliationPageProps) {
  const adminAccess = await getCurrentAdminAccess();

  if (adminAccess.status === "anonymous") {
    redirect("/auth/sign-in?next=/admin/reconciliation");
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

  const rawParams = await searchParams;
  const queryParams = toUrlSearchParams(rawParams);
  const query = parseAdminReconciliationListQuery(queryParams);
  const formValues = query
    ? formValuesFromQuery(query)
    : formValuesFromRawParams(rawParams);
  const activeFilters = query ? getActiveFilters(query) : [];
  const execution = query
    ? await listAdminReconciliationItems(query)
    : null;
  const items = execution?.ok ? execution.result.items : [];
  const resultCount = execution?.ok ? execution.result.items.length : null;

  return (
    <PageShell>
      <AdminPageHeader
        actions={
          <HeaderStats
            activeFilterCount={activeFilters.length}
            resultCount={resultCount}
          />
        }
        description="Read-only ADMIN+AAL2 view for reconciliation item summaries and drill-down detail. This screen does not open review cases, transition review state, mutate ledger data, or call providers."
        title="Reconciliation"
      >
        {activeFilters.length > 0 ? (
          <ActiveFilterList filters={activeFilters} />
        ) : null}
      </AdminPageHeader>

      <FilterForm values={formValues} />

      {!query ? (
        <Alert tone="error">
          {getReconciliationReadPublicMessage("invalid_request")} Reset the
          filters to return to the first page.
        </Alert>
      ) : null}

      {execution && !execution.ok ? (
        <Alert tone="error">
          {getReconciliationReadPublicMessage(execution.error.code) ??
            "Reconciliation read data is unavailable."}
        </Alert>
      ) : null}

      {execution?.ok && query ? (
        <Section title="Reconciliation items">
          {items.length > 0 ? (
            <>
              <ReconciliationItemsTable items={items} />
              <PaginationControls
                nextCursor={execution.result.nextCursor}
                query={query}
              />
            </>
          ) : (
            <EmptyState
              actionHref="/admin/reconciliation"
              actionLabel="Reset filters"
            >
              No reconciliation items matched the current filters.
            </EmptyState>
          )}
        </Section>
      ) : null}
    </PageShell>
  );
}

function HeaderStats({
  activeFilterCount,
  resultCount,
}: {
  activeFilterCount: number;
  resultCount: number | null;
}) {
  return (
    <div className="grid min-w-56 grid-cols-2 gap-3 text-sm">
      <div className="border border-zinc-200 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Results
        </div>
        <div className="mt-1 font-semibold">
          {resultCount === null ? "--" : resultCount}
        </div>
      </div>
      <div className="border border-zinc-200 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Filters
        </div>
        <div className="mt-1 font-semibold">{activeFilterCount}</div>
      </div>
    </div>
  );
}

function ActiveFilterList({ filters }: { filters: ActiveFilter[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((filter) => (
        <span
          className="border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700"
          key={filter.label}
        >
          {filter.label}: {filter.value}
        </span>
      ))}
    </div>
  );
}

function FilterForm({ values }: { values: FilterFormValues }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Filters</h2>
      <form
        action="/admin/reconciliation"
        className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        method="get"
      >
        <TextField
          label="Asset UUID"
          maxLength={64}
          name="assetId"
          value={values.assetId}
        />
        <SelectField
          label="Run status"
          name="runStatus"
          options={RUN_STATUS_OPTIONS}
          value={values.runStatus}
        />
        <SelectField
          label="Classification"
          name="classification"
          options={CLASSIFICATION_OPTIONS}
          value={values.classification}
        />
        <SelectField
          label="Review state"
          name="reviewState"
          options={REVIEW_STATE_OPTIONS}
          value={values.reviewState}
        />
        <TextField
          label="Observer kind"
          maxLength={64}
          name="observerKind"
          value={values.observerKind}
        />
        <TextField
          label="Cutoff from"
          maxLength={64}
          name="cutoffFrom"
          placeholder="2026-07-30T03:00:00.123456Z"
          value={values.cutoffFrom}
        />
        <TextField
          label="Cutoff to"
          maxLength={64}
          name="cutoffTo"
          placeholder="2026-07-30T03:00:00.123456Z"
          value={values.cutoffTo}
        />
        <TextField
          inputMode="numeric"
          label="Limit"
          maxLength={3}
          name="limit"
          value={values.limit}
        />
        <div className="flex flex-wrap items-end gap-3 md:col-span-2 xl:col-span-4">
          <button
            className="h-10 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
            type="submit"
          >
            Search
          </button>
          <Link
            className="inline-flex h-10 items-center border border-zinc-300 px-4 text-sm font-medium text-zinc-900"
            href="/admin/reconciliation"
          >
            Reset filters
          </Link>
        </div>
      </form>
    </section>
  );
}

function TextField({
  inputMode,
  label,
  maxLength,
  name,
  placeholder,
  value,
}: {
  inputMode?: "numeric";
  label: string;
  maxLength: number;
  name: keyof FilterFormValues;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <input
        autoComplete="off"
        className="h-11 border border-zinc-300 px-3 font-mono text-sm"
        defaultValue={value}
        inputMode={inputMode}
        maxLength={maxLength}
        name={name}
        placeholder={placeholder}
        type="text"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: keyof FilterFormValues;
  options: readonly string[];
  value: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <select
        className="h-11 border border-zinc-300 bg-white px-3 text-sm"
        defaultValue={value}
        name={name}
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReconciliationItemsTable({
  items,
}: {
  items: AdminReconciliationItemSummary[];
}) {
  return (
    <TableScroller>
      <table className="min-w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
            <th className="py-2 pr-4 font-medium">Asset</th>
            <th className="py-2 pr-4 font-medium">Run status</th>
            <th className="py-2 pr-4 font-medium">Scope</th>
            <th className="py-2 pr-4 font-medium">Classification</th>
            <th className="py-2 pr-4 font-medium">Review</th>
            <th className="py-2 pr-4 font-medium">Observer</th>
            <th className="py-2 pr-4 font-medium">Cutoff</th>
            <th className="py-2 pr-4 font-medium">Expected</th>
            <th className="py-2 pr-4 font-medium">Observed</th>
            <th className="py-2 pr-4 font-medium">Difference</th>
            <th className="py-2 pr-4 font-medium">Tolerance</th>
            <th className="py-2 pr-4 font-medium">Provenance counts</th>
            <th className="py-2 pr-4 font-medium">Created</th>
            <th className="py-2 pr-4 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              className="border-b border-zinc-100 align-top"
              key={item.reconciliationItemId}
            >
              <td className="py-3 pr-4">
                <div className="font-medium">{item.asset.assetCode}</div>
                <div className="text-zinc-600">
                  {item.asset.symbol} / d{item.asset.decimals}
                </div>
              </td>
              <td className="py-3 pr-4">
                <StatusBadge value={item.runStatus} />
              </td>
              <td className="py-3 pr-4">{item.scopeKind}</td>
              <td className="py-3 pr-4">
                <StatusBadge value={item.classification} />
              </td>
              <td className="py-3 pr-4">
                <StatusBadge value={item.reviewStatus} />
                {item.reviewVersion ? (
                  <div className="mt-1 text-xs text-zinc-600">
                    v{item.reviewVersion}
                  </div>
                ) : null}
              </td>
              <td className="py-3 pr-4">
                {formatOptionalText(item.observerKind)}
              </td>
              <td className="whitespace-nowrap py-3 pr-4 text-zinc-600">
                {formatOptionalTimestamp(item.observationCutoffAt)}
              </td>
              <td className="py-3 pr-4">
                <MonoValue>
                  {formatOptionalAtomicUnits(item.expectedUnits)}
                </MonoValue>
              </td>
              <td className="py-3 pr-4">
                <MonoValue>
                  {formatOptionalAtomicUnits(item.observedUnits)}
                </MonoValue>
              </td>
              <td className="py-3 pr-4">
                <MonoValue>
                  {formatSignedAtomicUnits(item.differenceUnits)}
                </MonoValue>
              </td>
              <td className="py-3 pr-4">
                <MonoValue>
                  {formatOptionalAtomicUnits(item.toleranceUnits)}
                </MonoValue>
              </td>
              <td className="py-3 pr-4 font-mono text-xs">
                {item.targetBindingCount} / {item.observedBindingCount} /{" "}
                {item.missingBindingCount} / {item.failedBindingCount}
              </td>
              <td className="whitespace-nowrap py-3 pr-4 text-zinc-600">
                {formatOptionalTimestamp(item.itemCreatedAt)}
              </td>
              <td className="py-3 pr-4">
                <Link
                  className="font-medium text-zinc-950 underline"
                  href={`/admin/reconciliation/items/${item.reconciliationItemId}`}
                >
                  Open
                </Link>
                <div className="mt-1">
                  <MonoValue>
                    {shortIdentifier(item.reconciliationItemId)}
                  </MonoValue>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

function PaginationControls({
  nextCursor,
  query,
}: {
  nextCursor: string | null;
  query: AdminReconciliationListQuery;
}) {
  return (
    <nav className="mt-5 flex flex-wrap items-center gap-3 text-sm">
      {query.cursor ? (
        <Link
          className="inline-flex h-10 items-center border border-zinc-300 px-4 font-medium text-zinc-900"
          href={buildListHref(query, null)}
        >
          First page
        </Link>
      ) : null}
      {nextCursor ? (
        <Link
          className="inline-flex h-10 items-center border border-zinc-950 bg-zinc-950 px-4 font-medium text-white"
          href={buildListHref(query, nextCursor)}
        >
          Next
        </Link>
      ) : null}
      <span className="text-zinc-600">
        Use the browser Back button for the previous page.
      </span>
    </nav>
  );
}

function toUrlSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const urlSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      urlSearchParams.append(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        urlSearchParams.append(key, item);
      }
    }
  }

  return urlSearchParams;
}

function formValuesFromQuery(
  query: AdminReconciliationListQuery,
): FilterFormValues {
  return {
    assetId: query.assetId ?? "",
    runStatus: query.runStatus ?? "",
    classification: query.classification ?? "",
    reviewState: query.reviewState ?? "",
    observerKind: query.observerKind ?? "",
    cutoffFrom: query.cutoffFrom ?? "",
    cutoffTo: query.cutoffTo ?? "",
    limit: String(query.limit),
  };
}

function formValuesFromRawParams(
  params: Record<string, string | string[] | undefined>,
): FilterFormValues {
  return {
    assetId: readSafeParam(params.assetId),
    runStatus: readSafeParam(params.runStatus),
    classification: readSafeParam(params.classification),
    reviewState: readSafeParam(params.reviewState),
    observerKind: readSafeParam(params.observerKind),
    cutoffFrom: readSafeParam(params.cutoffFrom),
    cutoffTo: readSafeParam(params.cutoffTo),
    limit: readSafeParam(params.limit) || "50",
  };
}

function readSafeParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;

  return typeof raw === "string" ? raw.slice(0, 256) : "";
}

function getActiveFilters(
  query: AdminReconciliationListQuery,
): ActiveFilter[] {
  return [
    query.assetId ? { label: "Asset", value: shortIdentifier(query.assetId) } : null,
    query.runStatus ? { label: "Run", value: query.runStatus } : null,
    query.classification
      ? { label: "Classification", value: query.classification }
      : null,
    query.reviewState ? { label: "Review", value: query.reviewState } : null,
    query.observerKind
      ? { label: "Observer", value: query.observerKind }
      : null,
    query.cutoffFrom ? { label: "Cutoff from", value: query.cutoffFrom } : null,
    query.cutoffTo ? { label: "Cutoff to", value: query.cutoffTo } : null,
  ].filter((filter): filter is ActiveFilter => filter !== null);
}

function buildListHref(
  query: AdminReconciliationListQuery,
  cursor: string | null,
): string {
  const params = new URLSearchParams();

  params.set("limit", String(query.limit));
  appendParam(params, "assetId", query.assetId);
  appendParam(params, "runStatus", query.runStatus);
  appendParam(params, "classification", query.classification);
  appendParam(params, "reviewState", query.reviewState);
  appendParam(params, "observerKind", query.observerKind);
  appendParam(params, "cutoffFrom", query.cutoffFrom);
  appendParam(params, "cutoffTo", query.cutoffTo);
  appendParam(params, "cursor", cursor);

  return `/admin/reconciliation?${params.toString()}`;
}

function appendParam(
  params: URLSearchParams,
  key: string,
  value: string | null,
) {
  if (value) {
    params.set(key, value);
  }
}
