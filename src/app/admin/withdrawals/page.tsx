import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getWithdrawalPublicMessage } from "@/lib/withdrawal/public-results";
import {
  listAdminWithdrawalOverview,
  type AdminWithdrawalRequest,
  type WithdrawalAuditEvent,
  type WithdrawalExecutionAttempt,
} from "@/server/admin/withdrawal-commands";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

type AdminWithdrawalsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminWithdrawalsPage({
  searchParams,
}: AdminWithdrawalsPageProps) {
  const adminAccess = await getCurrentAdminAccess();

  if (adminAccess.status === "anonymous") {
    redirect("/auth/sign-in?next=/admin/withdrawals");
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
  const resultMessage = getWithdrawalPublicMessage(
    getSingleValue(params.result),
  );
  const errorMessage =
    getWithdrawalPublicMessage(getSingleValue(params.error)) ??
    getPublicAuthErrorMessage(getSingleValue(params.error));
  const overview = await listAdminWithdrawalOverview();

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/admin">
            Admin
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Withdrawal operations
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              AAL2 administrator boundary for local manual withdrawal
              reservation, approval, and cancellation. Approval is a local
              ledger state change, not an external settlement event.
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
            <WithdrawalRequestTable requests={overview.withdrawalRequests} />
            <WithdrawalAttemptTable attempts={overview.executionAttempts} />
            <WithdrawalAuditTable events={overview.auditEvents} />
          </>
        ) : (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {getWithdrawalPublicMessage(overview.error) ??
              getPublicAuthErrorMessage(overview.error) ??
              "Withdrawal operations are unavailable."}
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
          REQUESTED rows are user-created and do not post ledger journals.
          The command only verifies current Available Atomic Units.
        </p>
        <p>
          RESERVED moves USER_AVAILABLE into USER_PENDING_WITHDRAWAL.
          APPROVED moves pending withdrawal into SYSTEM_WITHDRAWAL_CLEARING.
        </p>
        <p>
          EXECUTING and FAILED are local operator states. SETTLED posts an
          internal clearing-to-custody ledger journal, but it is not blockchain
          verification.
        </p>
        <p>
          No raw payout address, transaction identifier, provider response, or
          scanner payload is stored. Only a hashed external evidence reference
          is retained for execution attempts.
        </p>
      </div>
    </section>
  );
}

function WithdrawalRequestTable({
  requests,
}: {
  requests: AdminWithdrawalRequest[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Withdrawal requests</h2>
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
                  key={request.withdrawalRequestId}
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
                      {request.canceledFromStatus
                        ? ` / from ${request.canceledFromStatus}`
                        : ""}
                    </div>
                    {request.latestExecutionStatus ? (
                      <div className="mt-1 text-xs text-zinc-500">
                        attempt {request.latestExecutionAttemptNo} /{" "}
                        {request.latestExecutionStatus} / v
                        {request.latestExecutionAttemptVersion}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(getTerminalJournalId(request))}
                  </td>
                  <td className="py-3 pr-4">
                    <AdminActions request={request} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No local withdrawal requests.
        </p>
      )}
    </section>
  );
}

function AdminActions({ request }: { request: AdminWithdrawalRequest }) {
  if (request.status === "REQUESTED") {
    return (
      <div className="flex flex-col gap-3">
        <AdminActionForm
          action="/api/v1/admin/withdrawals/reserve"
          buttonLabel="Reserve"
          request={request}
        />
        <AdminActionForm
          action="/api/v1/admin/withdrawals/cancel"
          buttonLabel="Cancel"
          request={request}
        />
      </div>
    );
  }

  if (request.status === "RESERVED") {
    return (
      <div className="flex flex-col gap-3">
        <AdminActionForm
          action="/api/v1/admin/withdrawals/approve"
          buttonLabel="Approve"
          request={request}
        />
        <AdminActionForm
          action="/api/v1/admin/withdrawals/cancel"
          buttonLabel="Cancel"
          request={request}
        />
      </div>
    );
  }

  if (request.status === "APPROVED") {
    return (
      <div className="flex flex-col gap-3">
        <StartExecutionForm request={request} />
        <AdminActionForm
          action="/api/v1/admin/withdrawals/cancel"
          buttonLabel="Cancel"
          request={request}
        />
      </div>
    );
  }

  if (request.status === "EXECUTING") {
    return request.latestExecutionAttemptId &&
      request.latestExecutionAttemptVersion ? (
      <div className="flex flex-col gap-3">
        <SettleExecutionForm request={request} />
        <FailExecutionForm request={request} />
      </div>
    ) : (
      <span className="text-zinc-500">Attempt unavailable</span>
    );
  }

  if (request.status === "FAILED") {
    return (
      <div className="flex flex-col gap-3">
        <StartExecutionForm request={request} />
        <AdminActionForm
          action="/api/v1/admin/withdrawals/cancel"
          buttonLabel="Cancel"
          request={request}
        />
      </div>
    );
  }

  return <span className="text-zinc-500">Terminal</span>;
}

function AdminActionForm({
  action,
  buttonLabel,
  request,
}: {
  action: string;
  buttonLabel: string;
  request: AdminWithdrawalRequest;
}) {
  return (
    <form action={action} className="flex min-w-72 flex-col gap-2" method="post">
      <input name="command_id" type="hidden" value={randomUUID()} />
      <input
        name="withdrawal_request_id"
        type="hidden"
        value={request.withdrawalRequestId}
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

function StartExecutionForm({
  request,
}: {
  request: AdminWithdrawalRequest;
}) {
  return (
    <form
      action="/api/v1/admin/withdrawals/start-execution"
      className="flex min-w-80 flex-col gap-2"
      method="post"
    >
      <input name="command_id" type="hidden" value={randomUUID()} />
      <input
        name="withdrawal_request_id"
        type="hidden"
        value={request.withdrawalRequestId}
      />
      <input
        name="request_expected_version"
        type="hidden"
        value={request.version}
      />
      <input
        autoComplete="off"
        className="h-10 border border-zinc-300 px-3 font-mono text-sm"
        maxLength={200}
        minLength={8}
        name="evidence_reference"
        pattern="[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}"
        placeholder="Evidence reference"
        required
        type="text"
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
        Start Execution
      </button>
    </form>
  );
}

function FailExecutionForm({
  request,
}: {
  request: AdminWithdrawalRequest;
}) {
  return (
    <form
      action="/api/v1/admin/withdrawals/fail-execution"
      className="flex min-w-80 flex-col gap-2"
      method="post"
    >
      <ExecutionAttemptHiddenInputs request={request} />
      <input
        autoComplete="off"
        className="h-10 border border-zinc-300 px-3 font-mono text-sm"
        maxLength={64}
        minLength={2}
        name="failure_code"
        pattern="[A-Z][A-Z0-9_]{1,63}"
        placeholder="FAILURE_CODE"
        required
        type="text"
      />
      <textarea
        className="min-h-16 resize-y border border-zinc-300 px-3 py-2 text-sm leading-6"
        maxLength={500}
        name="failure_reason"
        placeholder="Failure reason"
        required
      />
      <textarea
        className="min-h-16 resize-y border border-zinc-300 px-3 py-2 text-sm leading-6"
        maxLength={500}
        name="reason"
        placeholder="Audit reason"
        required
      />
      <button
        className="h-9 border border-zinc-300 px-3 text-sm font-medium"
        type="submit"
      >
        Mark Failed
      </button>
    </form>
  );
}

function SettleExecutionForm({
  request,
}: {
  request: AdminWithdrawalRequest;
}) {
  return (
    <form
      action="/api/v1/admin/withdrawals/settle-execution"
      className="flex min-w-80 flex-col gap-2"
      method="post"
    >
      <ExecutionAttemptHiddenInputs request={request} />
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
        Settle Internally
      </button>
    </form>
  );
}

function ExecutionAttemptHiddenInputs({
  request,
}: {
  request: AdminWithdrawalRequest;
}) {
  return (
    <>
      <input name="command_id" type="hidden" value={randomUUID()} />
      <input
        name="withdrawal_request_id"
        type="hidden"
        value={request.withdrawalRequestId}
      />
      <input
        name="request_expected_version"
        type="hidden"
        value={request.version}
      />
      <input
        name="execution_attempt_id"
        type="hidden"
        value={request.latestExecutionAttemptId ?? ""}
      />
      <input
        name="attempt_expected_version"
        type="hidden"
        value={request.latestExecutionAttemptVersion ?? ""}
      />
    </>
  );
}

function WithdrawalAttemptTable({
  attempts,
}: {
  attempts: WithdrawalExecutionAttempt[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Execution attempts</h2>
      {attempts.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Started</th>
                <th className="py-2 pr-4 font-medium">Attempt</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Request</th>
                <th className="py-2 pr-4 font-medium">Settlement</th>
                <th className="py-2 pr-4 font-medium">Failure</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={attempt.executionAttemptId}
                >
                  <td className="py-3 pr-4 whitespace-nowrap text-zinc-600">
                    {formatTimestamp(attempt.startedAt)}
                    {attempt.completedAt ? (
                      <div className="mt-1 text-xs text-zinc-500">
                        completed {formatTimestamp(attempt.completedAt)}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4">
                    <div>#{attempt.attemptNo}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      v{attempt.version}
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-medium">{attempt.status}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(attempt.withdrawalRequestId)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(attempt.settlementJournalId)}
                  </td>
                  <td className="max-w-sm py-3 pr-4">
                    <div className="font-mono text-xs">
                      {attempt.failureCode ?? "None"}
                    </div>
                    {attempt.failureReason ? (
                      <div className="mt-1 text-zinc-600">
                        {attempt.failureReason}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">
          No local withdrawal execution attempts.
        </p>
      )}
    </section>
  );
}

function WithdrawalAuditTable({ events }: { events: WithdrawalAuditEvent[] }) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Withdrawal audit</h2>
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
                <th className="py-2 pr-4 font-medium">Attempt</th>
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
                    {shortUuid(event.withdrawalRequestId)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {shortUuid(event.executionAttemptId)}
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
          No withdrawal audit events.
        </p>
      )}
    </section>
  );
}

function getTerminalJournalId(
  request: AdminWithdrawalRequest,
): string | null {
  return (
    request.cancellationJournalId ??
    request.settlementJournalId ??
    request.approvalJournalId ??
    request.reservationJournalId
  );
}

function getSingleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Invalid time" : date.toISOString();
}

function shortUuid(value: string | null): string {
  if (!value) {
    return "None";
  }

  return value.length >= 14
    ? `${value.slice(0, 8)}...${value.slice(-6)}`
    : value;
}
