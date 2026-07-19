import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { listAdminRoleAuditEvents } from "@/server/admin/role-commands";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

type AdminRolesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ROLE_NOTICES: Record<string, string> = {
  grant_applied: "Admin role granted.",
  grant_noop: "Admin role was already active.",
  grant_replayed: "Grant command replayed without duplicate changes.",
  revoke_applied: "Admin role revoked.",
  revoke_noop: "No active admin role was present.",
  revoke_replayed: "Revoke command replayed without duplicate changes.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminRolesPage({
  searchParams,
}: AdminRolesPageProps) {
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
  const grantNotice = getSingleValue(params.grant);
  const revokeNotice = getSingleValue(params.revoke);
  const notice =
    getRoleNotice("grant", grantNotice) ??
    getRoleNotice("revoke", revokeNotice);
  const errorMessage = getPublicAuthErrorMessage(getSingleValue(params.error));
  const audit = await listAdminRoleAuditEvents(25);
  const grantCommandId = randomUUID();
  const revokeCommandId = randomUUID();

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/admin">
            Admin
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Role commands
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              AAL2 administrator command surface for ADMIN grants,
              revocations, and immutable audit review.
            </p>
          </div>
        </header>

        {notice ? (
          <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}

        {errorMessage ? (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMessage}
          </p>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-2">
          <form
            action="/api/v1/admin/roles/grant"
            className="flex flex-col gap-4 border border-zinc-200 p-5"
            method="post"
          >
            <input name="command_id" type="hidden" value={grantCommandId} />
            <div>
              <h2 className="text-lg font-semibold">Grant ADMIN</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Target must be an ACTIVE account.
              </p>
            </div>
            <RoleCommandFields verb="Grant" />
          </form>

          <form
            action="/api/v1/admin/roles/revoke"
            className="flex flex-col gap-4 border border-zinc-200 p-5"
            method="post"
          >
            <input name="command_id" type="hidden" value={revokeCommandId} />
            <div>
              <h2 className="text-lg font-semibold">Revoke ADMIN</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Self-revoke is blocked by the database command.
              </p>
            </div>
            <RoleCommandFields verb="Revoke" />
          </form>
        </section>

        <section className="flex flex-col gap-4 border border-zinc-200 p-5">
          <div>
            <h2 className="text-lg font-semibold">Audit events</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Recent ADMIN role command outcomes.
            </p>
          </div>

          {audit.ok ? (
            audit.events.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                      <th className="py-2 pr-4 font-medium">Time</th>
                      <th className="py-2 pr-4 font-medium">Action</th>
                      <th className="py-2 pr-4 font-medium">Outcome</th>
                      <th className="py-2 pr-4 font-medium">Actor</th>
                      <th className="py-2 pr-4 font-medium">Target</th>
                      <th className="py-2 pr-4 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.events.map((event) => (
                      <tr
                        className="border-b border-zinc-100 align-top"
                        key={event.eventId}
                      >
                        <td className="py-3 pr-4 whitespace-nowrap text-zinc-600">
                          {formatTimestamp(event.occurredAt)}
                        </td>
                        <td className="py-3 pr-4 font-medium">
                          {event.action}
                        </td>
                        <td className="py-3 pr-4">{event.outcome}</td>
                        <td className="py-3 pr-4 font-mono text-xs">
                          {shortUuid(event.actorUserId)}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs">
                          {shortUuid(event.targetUserId)}
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
              <p className="text-sm text-zinc-600">No audit events.</p>
            )
          ) : (
            <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Audit events are unavailable.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function RoleCommandFields({ verb }: { verb: "Grant" | "Revoke" }) {
  return (
    <>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Target user UUID
        <input
          autoComplete="off"
          className="h-11 border border-zinc-300 px-3 font-mono text-sm"
          maxLength={64}
          name="target_user_id"
          required
          type="text"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Reason
        <textarea
          className="min-h-28 resize-y border border-zinc-300 px-3 py-2 text-sm leading-6"
          maxLength={500}
          name="reason"
          required
        />
      </label>
      <button
        className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        {verb}
      </button>
    </>
  );
}

function getRoleNotice(
  action: "grant" | "revoke",
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  return ROLE_NOTICES[`${action}_${value}`] ?? null;
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
