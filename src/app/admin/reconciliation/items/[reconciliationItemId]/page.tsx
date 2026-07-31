import Link from "next/link";
import { redirect } from "next/navigation";

import {
  EMPTY_RECONCILIATION_DISPLAY,
  formatOptionalAtomicUnits,
  formatOptionalText,
  formatOptionalTimestamp,
  formatSignedAtomicUnits,
} from "@/lib/reconciliation/display";
import { getReconciliationReadPublicMessage } from "@/lib/reconciliation/public-results";
import { parseReconciliationItemId } from "@/lib/reconciliation/validation";
import {
  getAdminReconciliationItemDetail,
  type AdminReconciliationItemDetail,
  type AdminReconciliationProvenance,
  type AdminReconciliationReviewEvent,
} from "@/server/admin/reconciliation-read-model";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

import {
  AdminPageHeader,
  Alert,
  DefinitionGrid,
  EmptyState,
  MonoValue,
  PageShell,
  Section,
  StatusBadge,
  TableScroller,
} from "../../_components";

type AdminReconciliationDetailPageProps = {
  params: Promise<{
    reconciliationItemId: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminReconciliationDetailPage({
  params,
}: AdminReconciliationDetailPageProps) {
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

  const { reconciliationItemId } = await params;
  const itemId = parseReconciliationItemId(reconciliationItemId);

  if (!itemId) {
    return <ReconciliationItemNotFound />;
  }

  const execution = await getAdminReconciliationItemDetail(itemId);

  if (!execution.ok) {
    if (execution.error.code === "reconciliation_item_not_found") {
      return <ReconciliationItemNotFound />;
    }

    return (
      <PageShell>
        <AdminPageHeader
          description="Read-only ADMIN+AAL2 reconciliation detail view."
          eyebrowHref="/admin/reconciliation"
          eyebrowLabel="Reconciliation"
          title="Reconciliation item"
        />
        <Alert tone="error">
          {getReconciliationReadPublicMessage(execution.error.code) ??
            "Reconciliation read data is unavailable."}
        </Alert>
      </PageShell>
    );
  }

  return <ReconciliationItemDetailView detail={execution.result} />;
}

function ReconciliationItemNotFound() {
  return (
    <PageShell>
      <AdminPageHeader
        description="The requested reconciliation item could not be loaded from the public-safe admin read model."
        eyebrowHref="/admin/reconciliation"
        eyebrowLabel="Reconciliation"
        title="Reconciliation item not found"
      />
      <Alert tone="neutral">
        Reconciliation item was not found.
      </Alert>
      <Link
        className="inline-flex h-10 w-fit items-center border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
        href="/admin/reconciliation"
      >
        Back to reconciliation
      </Link>
    </PageShell>
  );
}

function ReconciliationItemDetailView({
  detail,
}: {
  detail: AdminReconciliationItemDetail;
}) {
  return (
    <PageShell>
      <AdminPageHeader
        actions={
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={detail.item.classification} />
            <StatusBadge value={detail.run.status} />
          </div>
        }
        description="Read-only ADMIN+AAL2 detail for run metadata, item balances, binding provenance, review case state, and review event history. No review or ledger mutation controls are present."
        eyebrowHref="/admin/reconciliation"
        eyebrowLabel="Reconciliation"
        title={`${detail.item.asset.symbol} reconciliation item`}
      >
        <div className="flex flex-col gap-2 text-sm text-zinc-600">
          <div>
            {detail.item.asset.assetCode} / {detail.item.scopeKind}
          </div>
          <MonoValue>{detail.item.id}</MonoValue>
        </div>
      </AdminPageHeader>

      <Section title="Run">
        <DefinitionGrid
          items={[
            { label: "Run ID", value: <MonoValue>{detail.run.id}</MonoValue> },
            { label: "Status", value: <StatusBadge value={detail.run.status} /> },
            { label: "Trigger source", value: detail.run.triggerSource },
            {
              label: "Observer kind",
              value: formatOptionalText(detail.run.observerKind),
            },
            {
              label: "Observation cutoff",
              value: formatOptionalTimestamp(detail.run.observationCutoffAt),
            },
            {
              label: "Started",
              value: formatOptionalTimestamp(detail.run.startedAt),
            },
            {
              label: "Completed",
              value: formatOptionalTimestamp(detail.run.completedAt),
            },
            { label: "Created", value: formatOptionalTimestamp(detail.run.createdAt) },
            {
              label: "Failure code",
              value: formatOptionalText(detail.run.failureCode),
            },
          ]}
        />
      </Section>

      <Section title="Item">
        <DefinitionGrid
          items={[
            { label: "Item ID", value: <MonoValue>{detail.item.id}</MonoValue> },
            {
              label: "Asset ID",
              value: <MonoValue>{detail.item.asset.id}</MonoValue>,
            },
            { label: "Asset code", value: detail.item.asset.assetCode },
            { label: "Symbol", value: detail.item.asset.symbol },
            { label: "Display name", value: detail.item.asset.displayName },
            { label: "Decimals", value: detail.item.asset.decimals },
            { label: "Scope", value: detail.item.scopeKind },
            {
              label: "Expected",
              value: (
                <MonoValue>
                  {formatOptionalAtomicUnits(detail.item.expectedUnits)}
                </MonoValue>
              ),
            },
            {
              label: "Observed",
              value: (
                <MonoValue>
                  {formatOptionalAtomicUnits(detail.item.observedUnits)}
                </MonoValue>
              ),
            },
            {
              label: "Difference",
              value: (
                <MonoValue>
                  {formatSignedAtomicUnits(detail.item.differenceUnits)}
                </MonoValue>
              ),
            },
            {
              label: "Tolerance",
              value: (
                <MonoValue>
                  {formatOptionalAtomicUnits(detail.item.toleranceUnits)}
                </MonoValue>
              ),
            },
            {
              label: "Classification",
              value: <StatusBadge value={detail.item.classification} />,
            },
            { label: "Created", value: formatOptionalTimestamp(detail.item.createdAt) },
          ]}
        />
      </Section>

      <Section title="Provenance">
        {detail.provenance.length > 0 ? (
          <ProvenanceTable provenance={detail.provenance} />
        ) : (
          <EmptyState>No binding provenance is available for this item.</EmptyState>
        )}
      </Section>

      <Section title="Review case">
        {detail.reviewCase ? (
          <DefinitionGrid
            items={[
              {
                label: "Review case ID",
                value: <MonoValue>{detail.reviewCase.id}</MonoValue>,
              },
              {
                label: "Status",
                value: <StatusBadge value={detail.reviewCase.status} />,
              },
              { label: "Version", value: detail.reviewCase.version },
              {
                label: "Opened",
                value: formatOptionalTimestamp(detail.reviewCase.openedAt),
              },
              {
                label: "Updated",
                value: formatOptionalTimestamp(detail.reviewCase.updatedAt),
              },
              {
                label: "Resolved",
                value: formatOptionalTimestamp(detail.reviewCase.resolvedAt),
              },
            ]}
          />
        ) : (
          <EmptyState>No review case exists for this item.</EmptyState>
        )}
      </Section>

      <Section title="Review event timeline">
        {detail.reviewEvents.length > 0 ? (
          <ReviewEventTable events={detail.reviewEvents} />
        ) : (
          <EmptyState>No review events exist for this item.</EmptyState>
        )}
      </Section>
    </PageShell>
  );
}

function ProvenanceTable({
  provenance,
}: {
  provenance: AdminReconciliationProvenance[];
}) {
  return (
    <TableScroller>
      <table className="min-w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
            <th className="py-2 pr-4 font-medium">Provider</th>
            <th className="py-2 pr-4 font-medium">Binding label</th>
            <th className="py-2 pr-4 font-medium">Binding role</th>
            <th className="py-2 pr-4 font-medium">Membership</th>
            <th className="py-2 pr-4 font-medium">Binding ID</th>
            <th className="py-2 pr-4 font-medium">Observation ID</th>
            <th className="py-2 pr-4 font-medium">Observed units</th>
            <th className="py-2 pr-4 font-medium">Observed at</th>
            <th className="py-2 pr-4 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {provenance.map((entry) => (
            <tr
              className="border-b border-zinc-100 align-top"
              key={`${entry.custodyAccountBindingId}-${entry.createdAt}`}
            >
              <td className="py-3 pr-4">
                <div className="font-medium">{entry.providerCode}</div>
                <div className="text-zinc-600">
                  {entry.providerDisplayName}
                </div>
              </td>
              <td className="py-3 pr-4">{entry.bindingLabel}</td>
              <td className="py-3 pr-4">{entry.bindingRole}</td>
              <td className="py-3 pr-4">
                <StatusBadge value={entry.membershipStatus} />
              </td>
              <td className="py-3 pr-4">
                <MonoValue>{entry.custodyAccountBindingId}</MonoValue>
              </td>
              <td className="py-3 pr-4">
                <MonoValue>
                  {entry.externalBalanceObservationId ??
                    EMPTY_RECONCILIATION_DISPLAY}
                </MonoValue>
              </td>
              <td className="py-3 pr-4">
                <MonoValue>
                  {formatOptionalAtomicUnits(entry.observedUnits)}
                </MonoValue>
              </td>
              <td className="whitespace-nowrap py-3 pr-4 text-zinc-600">
                {formatOptionalTimestamp(entry.observedAt)}
              </td>
              <td className="whitespace-nowrap py-3 pr-4 text-zinc-600">
                {formatOptionalTimestamp(entry.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

function ReviewEventTable({
  events,
}: {
  events: AdminReconciliationReviewEvent[];
}) {
  return (
    <TableScroller>
      <table className="min-w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
            <th className="py-2 pr-4 font-medium">Version</th>
            <th className="py-2 pr-4 font-medium">Event type</th>
            <th className="py-2 pr-4 font-medium">From</th>
            <th className="py-2 pr-4 font-medium">To</th>
            <th className="py-2 pr-4 font-medium">Reason code</th>
            <th className="py-2 pr-4 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              className="border-b border-zinc-100 align-top"
              key={`${event.eventVersion}-${event.createdAt}`}
            >
              <td className="py-3 pr-4 font-mono text-xs">
                {event.eventVersion}
              </td>
              <td className="py-3 pr-4">{event.eventType}</td>
              <td className="py-3 pr-4">
                <StatusBadge value={event.fromStatus} />
              </td>
              <td className="py-3 pr-4">
                <StatusBadge value={event.toStatus} />
              </td>
              <td className="py-3 pr-4 font-mono text-xs">
                {event.reasonCode}
              </td>
              <td className="whitespace-nowrap py-3 pr-4 text-zinc-600">
                {formatOptionalTimestamp(event.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
