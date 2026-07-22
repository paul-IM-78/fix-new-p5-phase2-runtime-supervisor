import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";

import Link from "next/link";
import { redirect } from "next/navigation";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";
import { getCustodyPublicMessage } from "@/lib/custody/public-results";
import { listAdminCustodyConfigCatalog } from "@/server/admin/custody-config-reads";
import type {
  AdminCustodyAccountBinding,
  AdminCustodyProvider,
  CustodyConfigAuditEvent,
} from "@/server/admin/custody-config-reads";
import {
  listAdminDomainCatalog,
  type AdminSupportedAsset,
} from "@/server/admin/domain-commands";
import { getCurrentAdminAccess } from "@/server/auth/admin-guard";

type AdminCustodyPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminCustodyPage({
  searchParams,
}: AdminCustodyPageProps) {
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
  const resultMessage = getCustodyPublicMessage(
    getSingleValue(params.result),
  );
  const errorMessage =
    getCustodyPublicMessage(getSingleValue(params.error)) ??
    getPublicAuthErrorMessage(getSingleValue(params.error));
  const [custodyCatalog, domainCatalog] = await Promise.all([
    listAdminCustodyConfigCatalog(),
    listAdminDomainCatalog(100),
  ]);

  const assets = domainCatalog.ok ? domainCatalog.assets : [];

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-6">
          <Link className="text-sm text-zinc-600" href="/admin">
            Admin
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              Custody configuration
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              AAL2 administrator commands for provider registry metadata,
              internal account binding aliases, capability flags, lifecycle
              state, and immutable configuration audit. This page does not
              connect to providers or chains and does not collect external
              account IDs, blockchain addresses, credentials, balances, or
              transaction identifiers.
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

        {custodyCatalog.ok ? (
          <>
            <section className="grid gap-5 lg:grid-cols-2">
              <ProviderDraftForm />
              <BindingDraftForm
                assets={assets}
                providers={custodyCatalog.providers}
              />
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <ProviderTable providers={custodyCatalog.providers} />
              <BindingTable bindings={custodyCatalog.bindings} />
            </section>

            <CustodyAuditTable events={custodyCatalog.auditEvents} />
          </>
        ) : (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {getCustodyPublicMessage(custodyCatalog.error) ??
              getPublicAuthErrorMessage(custodyCatalog.error) ??
              "Custody configuration is unavailable."}
          </p>
        )}
      </div>
    </main>
  );
}

function ProviderDraftForm() {
  return (
    <CustodyCommandForm
      action="/api/v1/admin/custody/providers/upsert-draft"
      buttonLabel="Save provider draft"
      title="Provider draft"
    >
      <TextInput
        label="Provider UUID"
        name="custody_provider_id"
        required={false}
      />
      <TextInput
        inputMode="numeric"
        label="Expected version"
        name="expected_version"
        required={false}
      />
      <TextInput label="Provider code" maxLength={32} name="provider_code" />
      <TextInput label="Display name" maxLength={100} name="display_name" />
      <SelectInput
        label="Provider type"
        name="provider_type"
        options={[
          "MPC_CUSTODIAN",
          "QUALIFIED_CUSTODIAN",
          "EXCHANGE_CUSTODY",
          "INTERNAL_HSM",
        ]}
      />
      <CheckboxInput
        label="Balance observation"
        name="supports_balance_observation"
      />
      <CheckboxInput
        label="Transfer observation"
        name="supports_transfer_observation"
      />
      <CheckboxInput
        label="Transfer lookup"
        name="supports_transfer_lookup"
      />
      <CheckboxInput
        label="Payout submission capability"
        name="supports_payout_submission"
      />
      <CheckboxInput
        label="Webhook ingestion capability"
        name="supports_webhook_ingestion"
      />
      <ReasonInput />
    </CustodyCommandForm>
  );
}

function BindingDraftForm({
  assets,
  providers,
}: {
  assets: AdminSupportedAsset[];
  providers: AdminCustodyProvider[];
}) {
  return (
    <CustodyCommandForm
      action="/api/v1/admin/custody/bindings/upsert-draft"
      buttonLabel="Save binding draft"
      title="Account binding draft"
    >
      <TextInput
        label="Binding UUID"
        name="custody_account_binding_id"
        required={false}
      />
      <TextInput
        inputMode="numeric"
        label="Expected version"
        name="expected_version"
        required={false}
      />
      <ProviderSelect providers={providers} />
      <AssetSelect assets={assets} />
      <TextInput label="Binding key" maxLength={64} name="binding_key" />
      <TextInput label="Display label" maxLength={100} name="display_label" />
      <SelectInput
        label="Account role"
        name="account_role"
        options={["COLLECTION", "PAYOUT", "TREASURY", "FEE"]}
      />
      <ReasonInput />
    </CustodyCommandForm>
  );
}

function CustodyCommandForm({
  action,
  buttonLabel,
  children,
  title,
}: {
  action: string;
  buttonLabel: string;
  children: ReactNode;
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

function CheckboxInput({ label, name }: { label: string; name: string }) {
  return (
    <label className="flex items-center gap-3 text-sm font-medium">
      <input className="size-4" name={name} type="checkbox" />
      {label}
    </label>
  );
}

function SelectInput({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <select
        className="h-11 border border-zinc-300 bg-white px-3 text-sm"
        name={name}
        required
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProviderSelect({
  providers,
}: {
  providers: AdminCustodyProvider[];
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      Provider
      <select
        className="h-11 border border-zinc-300 bg-white px-3 text-sm"
        name="custody_provider_id"
        required
      >
        <option value="">Select provider</option>
        {providers.map((provider) => (
          <option
            key={provider.custodyProviderId}
            value={provider.custodyProviderId}
          >
            {provider.providerCode} / {provider.status} / v
            {provider.version}
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
        <option value="">Select asset</option>
        {assets.map((asset) => (
          <option key={asset.assetId} value={asset.assetId}>
            {asset.assetCode} / {asset.assetType} / {asset.status} / v
            {asset.version}
          </option>
        ))}
      </select>
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

function ProviderTable({
  providers,
}: {
  providers: AdminCustodyProvider[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Providers</h2>
      {providers.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 pr-4 font-medium">Capabilities</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Transition</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={provider.custodyProviderId}
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium">{provider.providerCode}</div>
                    <div className="text-zinc-600">{provider.displayName}</div>
                    <div className="font-mono text-xs text-zinc-500">
                      {provider.custodyProviderId}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-xs leading-5 text-zinc-700">
                    {capabilitySummary(provider)}
                  </td>
                  <td className="py-3 pr-4">
                    {provider.status} / v{provider.version}
                  </td>
                  <td className="py-3 pr-4">
                    <ProviderTransitionForm provider={provider} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No custody providers.</p>
      )}
    </section>
  );
}

function BindingTable({
  bindings,
}: {
  bindings: AdminCustodyAccountBinding[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Bindings</h2>
      {bindings.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Binding</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Transition</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((binding) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={binding.custodyAccountBindingId}
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium">{binding.bindingKey}</div>
                    <div className="text-zinc-600">
                      {binding.displayLabel} / {binding.accountRole}
                    </div>
                    <div className="font-mono text-xs text-zinc-500">
                      {binding.custodyAccountBindingId}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <div>{binding.assetCode}</div>
                    <div className="text-zinc-600">
                      {binding.assetSymbol} / {binding.assetType} /{" "}
                      {binding.assetStatus}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {binding.status} / v{binding.version}
                  </td>
                  <td className="py-3 pr-4">
                    <BindingTransitionForm binding={binding} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-600">No custody bindings.</p>
      )}
    </section>
  );
}

function ProviderTransitionForm({
  provider,
}: {
  provider: AdminCustodyProvider;
}) {
  const transitions = allowedTransitions(provider.status);

  if (transitions.length === 0) {
    return <span className="text-zinc-500">Terminal</span>;
  }

  return (
    <form
      action="/api/v1/admin/custody/providers/transition"
      className="flex min-w-56 flex-col gap-2"
      method="post"
    >
      <input name="command_id" type="hidden" value={randomUUID()} />
      <input
        name="custody_provider_id"
        type="hidden"
        value={provider.custodyProviderId}
      />
      <input
        name="expected_version"
        type="hidden"
        value={provider.version}
      />
      <select
        className="h-10 border border-zinc-300 bg-white px-3 text-sm"
        name="new_status"
        required
      >
        {transitions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <input
        className="h-10 border border-zinc-300 px-3 text-sm"
        maxLength={500}
        name="reason"
        placeholder="Reason"
        required
        type="text"
      />
      <button
        className="h-10 border border-zinc-950 bg-zinc-950 px-3 text-sm font-medium text-white"
        type="submit"
      >
        Apply
      </button>
    </form>
  );
}

function BindingTransitionForm({
  binding,
}: {
  binding: AdminCustodyAccountBinding;
}) {
  const transitions = allowedTransitions(binding.status);

  if (transitions.length === 0) {
    return <span className="text-zinc-500">Terminal</span>;
  }

  return (
    <form
      action="/api/v1/admin/custody/bindings/transition"
      className="flex min-w-56 flex-col gap-2"
      method="post"
    >
      <input name="command_id" type="hidden" value={randomUUID()} />
      <input
        name="custody_account_binding_id"
        type="hidden"
        value={binding.custodyAccountBindingId}
      />
      <input
        name="expected_version"
        type="hidden"
        value={binding.version}
      />
      <select
        className="h-10 border border-zinc-300 bg-white px-3 text-sm"
        name="new_status"
        required
      >
        {transitions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <input
        className="h-10 border border-zinc-300 px-3 text-sm"
        maxLength={500}
        name="reason"
        placeholder="Reason"
        required
        type="text"
      />
      <button
        className="h-10 border border-zinc-950 bg-zinc-950 px-3 text-sm font-medium text-white"
        type="submit"
      >
        Apply
      </button>
    </form>
  );
}

function CustodyAuditTable({
  events,
}: {
  events: CustodyConfigAuditEvent[];
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">Custody audit</h2>
      {events.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Entity</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  className="border-b border-zinc-100 align-top"
                  key={event.eventId}
                >
                  <td className="whitespace-nowrap py-3 pr-4 text-zinc-600">
                    {formatTimestamp(event.occurredAt)}
                  </td>
                  <td className="py-3 pr-4 font-medium">{event.action}</td>
                  <td className="py-3 pr-4">{event.outcome}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {event.entityType === "ACCOUNT_BINDING"
                      ? shortUuid(event.custodyAccountBindingId ?? "")
                      : shortUuid(event.custodyProviderId)}
                  </td>
                  <td className="py-3 pr-4">
                    {event.previousStatus ?? "None"} {"->"}{" "}
                    {event.resultingStatus} / v{event.entityVersion}
                  </td>
                  <td className="max-w-xs py-3 pr-4 text-zinc-700">
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
      return ["APPROVED", "RETIRED"];
    case "APPROVED":
      return ["SUSPENDED"];
    case "SUSPENDED":
      return ["APPROVED", "RETIRED"];
    default:
      return [];
  }
}

function capabilitySummary(provider: AdminCustodyProvider): string {
  const capabilities = [
    provider.supportsBalanceObservation ? "balance" : null,
    provider.supportsTransferObservation ? "transfer observe" : null,
    provider.supportsTransferLookup ? "transfer lookup" : null,
    provider.supportsPayoutSubmission ? "payout submit" : null,
    provider.supportsWebhookIngestion ? "webhook ingest" : null,
  ].filter(Boolean);

  return capabilities.length > 0 ? capabilities.join(", ") : "None";
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
    : "none";
}
