import "server-only";

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 5;

export function redactProviderSecurityValue(value: unknown, sensitiveValues: readonly string[] = []): unknown {
  return redact(value, new WeakSet<object>(), 0, sensitiveValues.filter(Boolean));
}

export function redactProviderSecurityText(value: string, sensitiveValues: readonly string[] = []): string {
  let result = value;
  for (const secret of sensitiveValues) result = result.replaceAll(secret, REDACTED);
  result = result.replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, `$1${REDACTED}`);
  result = result.replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
  return result;
}

function redact(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  sensitiveValues: readonly string[],
): unknown {
  if (typeof value === "string") return redactProviderSecurityText(value, sensitiveValues);
  if (value instanceof Error) {
    return Object.freeze({ name: value.name, message: redactProviderSecurityText(value.message, sensitiveValues) });
  }
  if (!value || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH || seen.has(value)) return "[REDACTED_OBJECT]";
  seen.add(value);
  if (Array.isArray(value)) return Object.freeze(value.map((item) => redact(item, seen, depth + 1, sensitiveValues)));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /authorization|credential|secret|token|password/i.test(key)
      ? REDACTED
      : redact(item, seen, depth + 1, sensitiveValues);
  }
  return Object.freeze(result);
}
