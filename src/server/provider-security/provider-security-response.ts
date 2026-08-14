import "server-only";

import { TextDecoder } from "node:util";
import type { Readable } from "node:stream";

import { PROVIDER_SECURITY_POLICY, type TransportFailure } from "./provider-security-types";
import { redactProviderSecurityText } from "./provider-security-redaction";

export type BoundedProviderResponse =
  | Readonly<{ ok: true; json: unknown; bytes: number }>
  | Readonly<{ ok: false; error: TransportFailure; bytes: number; excerpt: string }>;

export async function readBoundedProviderJson({
  stream,
  contentLength,
  signal,
  sensitiveValues = [],
}: {
  stream: Readable;
  contentLength: string | string[] | undefined;
  signal?: AbortSignal;
  sensitiveValues?: readonly string[];
}): Promise<BoundedProviderResponse> {
  const declaredLength = parseContentLength(contentLength);
  if (declaredLength !== null && declaredLength > PROVIDER_SECURITY_POLICY.maxResponseBytes) {
    stream.destroy();
    return tooLarge(0, "content_length_exceeds_cap", sensitiveValues);
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const value of stream) {
      if (signal?.aborted) {
        stream.destroy();
        return failure("PROVIDER_ABORTED", false, null, "ABORT", bytes, "operation_aborted", sensitiveValues);
      }
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > PROVIDER_SECURITY_POLICY.maxResponseBytes) {
        stream.destroy();
        return tooLarge(bytes, "stream_exceeds_cap", sensitiveValues);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    return failure("PROVIDER_UNAVAILABLE", true, null, "NETWORK", bytes, error instanceof Error ? error.message : "stream_failed", sensitiveValues);
  }

  const body = Buffer.concat(chunks, bytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { ok: true, json: JSON.parse(text), bytes };
  } catch {
    return failure("PROVIDER_MALFORMED_RESPONSE", false, null, "RESPONSE", bytes, "response_json_invalid", sensitiveValues);
  }
}

export function boundedProviderErrorExcerpt(value: string, sensitiveValues: readonly string[] = []): string {
  return redactProviderSecurityText(
    value.slice(0, PROVIDER_SECURITY_POLICY.maxErrorExcerptBytes),
    sensitiveValues,
  );
}

function parseContentLength(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function tooLarge(bytes: number, excerpt: string, sensitiveValues: readonly string[]): BoundedProviderResponse {
  return failure("PROVIDER_RESPONSE_TOO_LARGE", false, null, "RESPONSE", bytes, excerpt, sensitiveValues);
}

function failure(
  code: TransportFailure["code"],
  retryable: boolean,
  safeStatus: number | null,
  causeClass: TransportFailure["causeClass"],
  bytes: number,
  excerpt: string,
  sensitiveValues: readonly string[],
): BoundedProviderResponse {
  return {
    ok: false,
    error: { kind: "TRANSPORT_FAILURE", code, retryable, safeStatus, safeMessageCode: code, causeClass },
    bytes,
    excerpt: boundedProviderErrorExcerpt(excerpt, sensitiveValues),
  };
}
