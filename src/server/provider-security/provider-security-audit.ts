import "server-only";

import type {
  CredentialReference,
  ProviderEndpoint,
  ProviderSecurityAuditMetadata,
} from "./provider-security-types";

export function createProviderSecurityAuditMetadata({
  endpoint,
  operationId,
  policyOutcome,
  normalizedOutcome,
  durationMs,
  attemptCount,
  safeStatus,
  requestBytes,
  responseBytes,
  correlationId,
  credentialReference,
}: {
  endpoint: ProviderEndpoint;
  operationId: string;
  policyOutcome: "ALLOWED" | "DENIED";
  normalizedOutcome: ProviderSecurityAuditMetadata["normalizedOutcome"];
  durationMs: number;
  attemptCount: number;
  safeStatus: number | null;
  requestBytes: number;
  responseBytes: number;
  correlationId: string;
  credentialReference: CredentialReference | null;
}): ProviderSecurityAuditMetadata {
  return Object.freeze({
    provider: endpoint.provider,
    environment: endpoint.environment,
    operationId,
    endpointId: endpoint.id,
    hostname: endpoint.hostname,
    policyOutcome,
    normalizedOutcome,
    durationMs: Math.max(0, Math.floor(durationMs)),
    attemptCount,
    safeStatus,
    requestBytes,
    responseBytes,
    correlationId,
    credentialReferenceId: credentialReference?.referenceId ?? null,
    credentialVersion: credentialReference?.version ?? null,
  });
}
