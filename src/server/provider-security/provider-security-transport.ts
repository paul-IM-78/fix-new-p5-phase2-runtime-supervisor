import "server-only";

import * as https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { RequestOptions } from "node:https";
import type { Readable } from "node:stream";

import { createProviderSecurityAuditMetadata } from "./provider-security-audit";
import { createConnectionPlan, createConnectionPlanLookup, createDefaultProviderDnsResolver, type ProviderDnsResolver } from "./provider-security-connection-plan";
import { createInternalAuthorizationHeader, createProcessEnvRuntimeSecretSource, createProviderCredentialResolver, type ProviderCredentialResolver } from "./provider-security-credential-resolver";
import { getProviderEndpoint } from "./provider-security-endpoint-registry";
import { buildApprovedProviderUrl, validateApprovedProviderRequestDescriptor } from "./provider-security-request-descriptor";
import { readBoundedProviderJson } from "./provider-security-response";
import {
  PROVIDER_SECURITY_POLICY,
  type ApprovedProviderRequestDescriptor,
  type CredentialReference,
  type ProviderSecurityResult,
  type TransportFailure,
} from "./provider-security-types";

export type ProviderHttpsResponse = Readonly<{
  statusCode: number;
  headers: IncomingHttpHeaders;
  stream: Readable;
}>;

export type ProviderHttpsRequestFactory = (
  options: RequestOptions,
  body: Uint8Array | undefined,
) => Promise<ProviderHttpsResponse>;

export type ProviderSecurityRuntime = Readonly<{
  dnsResolver: ProviderDnsResolver;
  credentialResolver: ProviderCredentialResolver;
  requestFactory: ProviderHttpsRequestFactory;
  now: () => number;
  sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  random: () => number;
}>;

export async function executeApprovedProviderRequest({
  environment,
  descriptor,
  credentialReference,
  authorizedExecutionContext,
  body,
  correlationId,
  signal,
  runtime = createDefaultProviderSecurityRuntime(),
}: {
  environment: "TEST" | "PRODUCTION";
  descriptor: ApprovedProviderRequestDescriptor;
  credentialReference: CredentialReference | null;
  authorizedExecutionContext: boolean;
  body?: Uint8Array;
  correlationId: string;
  signal?: AbortSignal;
  runtime?: ProviderSecurityRuntime;
}): Promise<ProviderSecurityResult> {
  const startedAt = runtime.now();
  const deadline = createDeadlineSignal(signal);
  let attempts = 0;
  let responseBytes = 0;
  const endpoint = getProviderEndpoint("BITGO", environment);
  if (!endpoint) return failureWithoutPlan("EGRESS_DESTINATION_NOT_ALLOWED", "POLICY", endpoint, descriptor.operationId, correlationId, startedAt, attempts, credentialReference);

  try {
    validateApprovedProviderRequestDescriptor(descriptor);
    if (body && !descriptor.bodyAllowed) throw new RangeError("provider_request_body_not_allowed");
    const url = buildApprovedProviderUrl(endpoint, descriptor);
    const plan = await createConnectionPlan({ endpoint, resolver: runtime.dnsResolver, signal: deadline.signal });
    throwIfAborted(deadline.signal);

    const credential = await runtime.credentialResolver.resolve({
      provider: endpoint.provider,
      environment,
      credentialReference,
      authorizedExecutionContext,
    });
    if ("kind" in credential) {
      return { ok: false, error: credential, audit: audit(endpoint, descriptor, "DENIED", credential.code, startedAt, runtime.now(), attempts, null, 0, responseBytes, correlationId, credentialReference) };
    }
    const authorization = createInternalAuthorizationHeader(credential);

    while (attempts < PROVIDER_SECURITY_POLICY.maxTotalAttempts) {
      throwIfAborted(deadline.signal);
      attempts += 1;
      const options: RequestOptions = {
        protocol: "https:",
        hostname: plan.hostname,
        port: plan.port,
        method: descriptor.method,
        path: `${url.pathname}${url.search}`,
        agent: false,
        lookup: createConnectionPlanLookup(plan),
        servername: plan.servername,
        rejectUnauthorized: true,
        signal: deadline.signal,
        headers: { Authorization: authorization },
      };
      const response = await runtime.requestFactory(options, body);
      if (response.statusCode >= 300 && response.statusCode < 400) {
        return transportFailure(endpoint, descriptor, "EGRESS_REDIRECT_BLOCKED", false, response.statusCode, "POLICY", startedAt, runtime.now(), attempts, 0, correlationId, credentialReference);
      }
      const bounded = await readBoundedProviderJson({ stream: response.stream, contentLength: response.headers["content-length"], signal: deadline.signal });
      responseBytes = bounded.bytes;
      if (!bounded.ok) {
        const responseFailure = bounded.error;
        if (!shouldRetry(responseFailure, descriptor.retrySafe) || attempts === PROVIDER_SECURITY_POLICY.maxTotalAttempts) {
          return transportFailure(endpoint, descriptor, responseFailure.code, false, responseFailure.safeStatus, responseFailure.causeClass, startedAt, runtime.now(), attempts, responseBytes, correlationId, credentialReference);
        }
        await waitForRetry({ response, attempt: attempts, deadline, runtime });
        continue;
      }
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return { ok: true, json: bounded.json, audit: audit(endpoint, descriptor, "ALLOWED", "SUCCESS", startedAt, runtime.now(), attempts, response.statusCode, 0, responseBytes, correlationId, credentialReference) };
      }
      const statusFailure = statusToFailure(response.statusCode);
      if (!shouldRetry(statusFailure, descriptor.retrySafe) || attempts === PROVIDER_SECURITY_POLICY.maxTotalAttempts) {
        return transportFailure(endpoint, descriptor, statusFailure.code, statusFailure.retryable, response.statusCode, statusFailure.causeClass, startedAt, runtime.now(), attempts, responseBytes, correlationId, credentialReference);
      }
      await waitForRetry({ response, attempt: attempts, deadline, runtime });
    }
    return transportFailure(endpoint, descriptor, "PROVIDER_UNAVAILABLE", true, null, "NETWORK", startedAt, runtime.now(), attempts, responseBytes, correlationId, credentialReference);
  } catch {
    const failure = deadline.signal.aborted
      ? createTransportFailure("PROVIDER_ABORTED", false, null, "ABORT")
      : createTransportFailure("EGRESS_DESTINATION_NOT_ALLOWED", false, null, "POLICY");
    return transportFailure(endpoint, descriptor, failure.code, failure.retryable, failure.safeStatus, failure.causeClass, startedAt, runtime.now(), attempts, responseBytes, correlationId, credentialReference);
  } finally {
    deadline.dispose();
  }
}

export function createDefaultProviderSecurityRuntime(): ProviderSecurityRuntime {
  return {
    dnsResolver: createDefaultProviderDnsResolver(),
    credentialResolver: createProviderCredentialResolver(createProcessEnvRuntimeSecretSource()),
    requestFactory: defaultRequestFactory,
    now: Date.now,
    sleep: (delayMs, signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("provider_operation_aborted")); }, { once: true });
    }),
    random: Math.random,
  };
}

async function defaultRequestFactory(options: RequestOptions, body: Uint8Array | undefined): Promise<ProviderHttpsResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, stream: response }));
    request.once("error", reject);
    request.end(body);
  });
}

function createDeadlineSignal(caller: AbortSignal | undefined): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  caller?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, PROVIDER_SECURITY_POLICY.totalDeadlineMs);
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); caller?.removeEventListener("abort", abort); } };
}

async function waitForRetry({ response, attempt, deadline, runtime }: {
  response: ProviderHttpsResponse;
  attempt: number;
  deadline: { signal: AbortSignal };
  runtime: ProviderSecurityRuntime;
}): Promise<void> {
  const base = Math.min(PROVIDER_SECURITY_POLICY.retryBackoffMaxMs, PROVIDER_SECURITY_POLICY.retryBackoffBaseMs * 2 ** (attempt - 1));
  const jitter = Math.floor(base * PROVIDER_SECURITY_POLICY.retryJitterRatio);
  const randomized = base - jitter + Math.floor(runtime.random() * (jitter * 2 + 1));
  const retryAfter = parseRetryAfter(response.headers["retry-after"], runtime.now());
  const delay = Math.min(PROVIDER_SECURITY_POLICY.maxRetryAfterMs, Math.max(randomized, retryAfter ?? 0));
  await runtime.sleep(delay, deadline.signal);
}

export function parseRetryAfter(value: string | string[] | undefined, now: number): number | null {
  if (typeof value !== "string") return null;
  if (/^[0-9]+$/.test(value)) return Math.min(PROVIDER_SECURITY_POLICY.maxRetryAfterMs, Number(value) * 1000);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(PROVIDER_SECURITY_POLICY.maxRetryAfterMs, Math.max(0, parsed - now));
}

function shouldRetry(failure: TransportFailure, retrySafe: boolean): boolean {
  return retrySafe && failure.retryable && failure.code !== "PROVIDER_TLS_ERROR" && failure.code !== "PROVIDER_RESPONSE_TOO_LARGE";
}

function statusToFailure(status: number): TransportFailure {
  if (status === 429) return createTransportFailure("PROVIDER_RATE_LIMITED", true, status, "RESPONSE");
  if (status === 408 || status >= 500) return createTransportFailure("PROVIDER_UNAVAILABLE", true, status, "NETWORK");
  return createTransportFailure("PROVIDER_UNAVAILABLE", false, status, "RESPONSE");
}

function createTransportFailure(code: TransportFailure["code"], retryable: boolean, safeStatus: number | null, causeClass: TransportFailure["causeClass"]): TransportFailure {
  return { kind: "TRANSPORT_FAILURE", code, retryable, safeStatus, safeMessageCode: code, causeClass };
}

function transportFailure(endpoint: NonNullable<ReturnType<typeof getProviderEndpoint>>, descriptor: ApprovedProviderRequestDescriptor, code: TransportFailure["code"], retryable: boolean, safeStatus: number | null, causeClass: TransportFailure["causeClass"], started: number, ended: number, attempts: number, responseBytes: number, correlationId: string, reference: CredentialReference | null): ProviderSecurityResult {
  const error = createTransportFailure(code, retryable, safeStatus, causeClass);
  return { ok: false, error, audit: audit(endpoint, descriptor, "DENIED", code, started, ended, attempts, safeStatus, 0, responseBytes, correlationId, reference) };
}

function failureWithoutPlan(code: TransportFailure["code"], causeClass: TransportFailure["causeClass"], endpoint: ReturnType<typeof getProviderEndpoint>, operationId: string, correlationId: string, started: number, attempts: number, reference: CredentialReference | null): ProviderSecurityResult {
  const fallback = endpoint ?? { id: "BITGO_PRODUCTION", provider: "BITGO", environment: "PRODUCTION", scheme: "https:" as const, hostname: "app.bitgo.com", port: 443 as const, active: false };
  return transportFailure(fallback, { operationId, method: "GET", relativePath: "/", query: {}, bodyAllowed: false, retrySafe: false, responseMode: "JSON" }, code, false, null, causeClass, started, started, attempts, 0, correlationId, reference);
}

function audit(endpoint: NonNullable<ReturnType<typeof getProviderEndpoint>>, descriptor: ApprovedProviderRequestDescriptor, policyOutcome: "ALLOWED" | "DENIED", normalizedOutcome: "SUCCESS" | ProviderSecurityResult extends never ? never : string, started: number, ended: number, attempts: number, safeStatus: number | null, requestBytes: number, responseBytes: number, correlationId: string, reference: CredentialReference | null) {
  return createProviderSecurityAuditMetadata({ endpoint, operationId: descriptor.operationId, policyOutcome, normalizedOutcome: normalizedOutcome as never, durationMs: ended - started, attemptCount: attempts, safeStatus, requestBytes, responseBytes, correlationId, credentialReference: reference });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("provider_operation_aborted");
}
