import type { ReactNode } from "react";

import Link from "next/link";

type AlertTone = "error" | "success" | "neutral";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        {children}
      </div>
    </main>
  );
}

export function AdminPageHeader({
  actions,
  children,
  description,
  eyebrowHref = "/admin",
  eyebrowLabel = "Admin",
  title,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  description: string;
  eyebrowHref?: string;
  eyebrowLabel?: string;
  title: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6">
      <Link className="text-sm text-zinc-600" href={eyebrowHref}>
        {eyebrowLabel}
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">
            {title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            {description}
          </p>
        </div>
        {actions}
      </div>
      {children}
    </header>
  );
}

export function Alert({ children, tone }: { children: ReactNode; tone: AlertTone }) {
  const className =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <p className={`border px-4 py-3 text-sm ${className}`}>
      {children}
    </p>
  );
}

export function Section({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="border border-zinc-200 p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function TableScroller({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function EmptyState({
  actionHref,
  actionLabel,
  children,
}: {
  actionHref?: string;
  actionLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-6 text-zinc-600">
      <p>{children}</p>
      {actionHref && actionLabel ? (
        <Link className="font-medium text-zinc-950 underline" href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function StatusBadge({ value }: { value: string | null }) {
  const label = value ?? "NONE";
  const tone = statusTone(label);
  const className =
    tone === "success"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : tone === "warning"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : tone === "danger"
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-zinc-300 bg-zinc-50 text-zinc-700";

  return (
    <span className={`inline-flex border px-2 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

export function DefinitionGrid({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div className="border-t border-zinc-100 pt-3" key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {item.label}
          </dt>
          <dd className="mt-1 break-words text-sm text-zinc-900">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function MonoValue({ children }: { children: ReactNode }) {
  return (
    <span className="break-all font-mono text-xs tabular-nums">
      {children}
    </span>
  );
}

function statusTone(value: string): "success" | "warning" | "danger" | "neutral" {
  if (
    [
      "COMPLETED",
      "MATCHED",
      "WITHIN_TOLERANCE",
      "RESOLVED",
      "OBSERVED",
    ].includes(value)
  ) {
    return "success";
  }

  if (
    [
      "PENDING",
      "RUNNING",
      "PARTIAL",
      "OPEN",
      "IN_REVIEW",
      "MISSING_OBSERVATION",
    ].includes(value)
  ) {
    return "warning";
  }

  if (
    [
      "FAILED",
      "MISMATCH",
      "OBSERVATION_FAILED",
      "REVIEW_REQUIRED",
    ].includes(value)
  ) {
    return "danger";
  }

  return "neutral";
}
