import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getDepositPublicMessage } from "@/lib/deposit/public-results";
import {
  listAdminDepositOverview,
  type AdminDepositRequest,
  type DepositAuditEvent,
} from "@/server/admin/deposit-commands";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

type AdminDepositsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminDepositsPage({
  searchParams,
}: AdminDepositsPageProps) {
  const adminAccess = await getCurrentAdminAccess();

  if (adminAccess.status === "anonymous") {
    redirect("/auth/sign-in?next=/admin/deposits");
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
  const resultMessage = getDepositPublicMessage(
    getSingleValue(params.result),
  );
  const errorMessage =
    getDepositPublicMessage(getSingleValue(params.error)) ??
    getPublicAuthErrorMessage(getSingleValue(params.error));
  const overview = await listAdminDepositOverview();

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/admin">
            Admin
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Deposit operations
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              AAL2 administrator boundary for local manual deposit
              confirmation and cancellation. This page does not collect
              blockchain destinations, transaction IDs, partial amounts, or
              generic journal lines.
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

        <BoundaryNotes />

        {overview.ok ? (
          <>
            <DepositRequestTable requests={overview.depositRequests} />
            <DepositAuditTable events={overview.auditEvents} />
          </>
        ) : (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {getDepositPublicMessage(overview.error) ??
              getPublicAuthErrorMessage(overview.error) ??
              "Deposit operations are unavailable."}
          </p>
        )}
      </div>
    </main>
  );
}

function BoundaryNotes() {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">State machine</h2>
      <div className="mt-3 grid gap-3 text-sm leading-6 text-zinc-600 lg:grid-cols-3">
        <p>
          REQUESTED posts pending-deposit and clearing buckets. Available
          balance and custody are not increased at request time.
        </p>
        <p>
          CONFIRMED is an AAL2-only four-line posting that clears pending
          deposit, credits user available balance, and moves clearing into
          custody.
        </p>
        <p>
          CANCELED reverses only REQUESTED pending and clearing buckets.
          CONFIRMED and CANCELED rows are terminal.
        </p>
      </div>
    </section>
  );
}

function DepositRequestTable({
  requests,
}: {
  requests: AdminDepositRequest[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Deposit requests</h2>
      {requests.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Requested</th>
                <th className="py-2 pr-4 font-medium">Target</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Units</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Journal</th>
                <th className="py-2 pr-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={request.depositRequestId}
                >
                  <td className="py-3 pr-4 whitespace-nowrap text-zinc-600">
                    {formatTimestamp(request.requestedAt)}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-mono text-xs">
                      {shortUuid(request.walletAccountId)}
                    </div>
                    <div className="mt-1 text-zinc-600">
                      {request.walletStatus} / {request.profileStatus}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{request.assetCode}</div>
                    <div className="text-zinc-600">
                      {request.symbol} / d{request.decimals}
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    {request.requestedUnits}
                  </td>
                  <td className="py-3 pr-4">
                    <div>{request.status}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      v{request.version}
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(getTerminalJournalId(request))}
                  </td>
                  <td className="py-3 pr-4">
                    {request.status === "REQUESTED" ? (
                      <div className="flex flex-col gap-3">
                        <AdminActionForm
                          action="/api/v1/admin/deposits/confirm"
                          buttonLabel="Confirm"
                          request={request}
                        />
                        <AdminActionForm
                          action="/api/v1/admin/deposits/cancel"
                          buttonLabel="Cancel"
                          request={request}
                        />
                      </div>
                    ) : (
                      <span className="text-zinc-500">Terminal</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No local deposit requests.
        </p>
      )}
    </section>
  );
}

function AdminActionForm({
  action,
  buttonLabel,
  request,
}: {
  action: string;
  buttonLabel: string;
  request: AdminDepositRequest;
}) {
  return (
    <form action={action} className="flex min-w-72 flex-col gap-2" method="post">
      <input name="command_id" type="hidden" value={randomUUID()} />
      <input
        name="deposit_request_id"
        type="hidden"
        value={request.depositRequestId}
      />
      <input
        name="request_expected_version"
        type="hidden"
        value={request.version}
      />
      <textarea
        className="min-h-20 resize-y border border-zinc-300 px-3 py-2 text-sm leading-6"
        maxLength={500}
        name="reason"
        placeholder="Reason"
        required
      />
      <button
        className="h-9 border border-zinc-950 bg-zinc-950 px-3 text-sm font-medium text-white"
        type="submit"
      >
        {buttonLabel}
      </button>
    </form>
  );
}

function DepositAuditTable({ events }: { events: DepositAuditEvent[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Deposit audit</h2>
      {events.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Actor</th>
                <th className="py-2 pr-4 font-medium">Request</th>
                <th className="py-2 pr-4 font-medium">Journal</th>
                <th className="py-2 pr-4 font-medium">Units</th>
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
                  <td className="py-3 pr-4">
                    {event.outcome}
                    <div className="mt-1 text-xs text-zinc-500">
                      {event.previousStatus ?? "NONE"} to{" "}
                      {event.resultingStatus}
                    </div>
                  </td>
                  <td className="py-3 pr-4">{event.actorType}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(event.depositRequestId)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(event.resultingJournalId)}
                  </td>
                  <td className="py-3 pr-4 font-mono">
                    {event.unitsText}
                  </td>
                  <td className="max-w-sm py-3 pr-4 text-zinc-700">
                    {event.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No deposit audit events.
        </p>
      )}
    </section>
  );
}

function getTerminalJournalId(request: AdminDepositRequest): string {
  return (
    request.confirmationJournalId ??
    request.cancellationJournalId ??
    request.requestJournalId
  );
}

function getSingleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}

function shortUuid(value: string): string {
  return value.length >= 14
    ? `${value.slice(0, 8)}...${value.slice(-6)}`
    : value;
}
