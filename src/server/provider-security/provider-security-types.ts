import "server-only";

export const PROVIDER_SECURITY_POLICY = {
  totalDeadlineMs: 10_000,
  maxTotalAttempts: 3,
  retryBackoffBaseMs: 250,
  retryBackoffMaxMs: 2_000,
  retryJitterRatio: 0.2,
  maxRetryAfterMs: 5_000,
  maxResponseBytes: 1_048_576,
  maxErrorExcerptBytes: 8_192,
} as const;

export type ProviderId = "BITGO";
export type ProviderEnvironment = "TEST" | "PRODUCTION";
export type CredentialLifecycleState =
  | "ACTIVE"
  | "ROTATING"
  | "REVOKED"
  | "DISABLED";

export type CredentialReference = Readonly<{
  provider: ProviderId;
  environment: ProviderEnvironment;
  referenceId: string;
  version: string;
  lifecycle: CredentialLifecycleState;
}>;

export type ProviderEndpoint = Readonly<{
  id: "BITGO_TEST" | "BITGO_PRODUCTION";
  provider: ProviderId;
  environment: ProviderEnvironment;
  scheme: "https:";
  hostname: string;
  port: 443;
  active: boolean;
}>;

export type ProviderRequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApprovedProviderRequestDescriptor = Readonly<{
  operationId: string;
  method: ProviderRequestMethod;
  relativePath: string;
  query: Readonly<Record<string, string>>;
  bodyAllowed: boolean;
  retrySafe: boolean;
  responseMode: "JSON";
}>;

export type ResolvedProviderAddress = Readonly<{
  address: string;
  family: 4 | 6;
}>;

export type ConnectionPlan = Readonly<{
  endpointId: ProviderEndpoint["id"];
  provider: ProviderId;
  environment: ProviderEnvironment;
  scheme: "https:";
  hostname: string;
  port: 443;
  addresses: readonly ResolvedProviderAddress[];
  selectedAddress: string;
  selectedFamily: 4 | 6;
  servername: string;
  policyVersion: "P6_T04_V1";
}>;

export type RuntimeSecretSource = Readonly<{
  read(name: "BITGO_TEST_ACCESS_TOKEN"): string | undefined;
}>;

export type CredentialResolutionRequest = Readonly<{
  provider: ProviderId;
  environment: ProviderEnvironment;
  credentialReference: CredentialReference | null;
  authorizedExecutionContext: boolean;
}>;

declare const resolvedCredentialBrand: unique symbol;
export type ResolvedProviderCredential = Readonly<{
  readonly [resolvedCredentialBrand]: "RESOLVED_PROVIDER_CREDENTIAL";
}>;

export type CredentialFailureCode =
  | "CREDENTIAL_REFERENCE_MISSING"
  | "CREDENTIAL_UNAVAILABLE"
  | "CREDENTIAL_REVOKED"
  | "CREDENTIAL_ENVIRONMENT_MISMATCH"
  | "CREDENTIAL_SCOPE_INVALID"
  | "SECRET_RESOLUTION_DENIED"
  | "AUTHENTICATION_FAILED";

export type CredentialFailure = Readonly<{
  kind: "CREDENTIAL_FAILURE";
  code: CredentialFailureCode;
  retryable: false;
  safeMessageCode: CredentialFailureCode;
  causeClass: "REFERENCE" | "LIFECYCLE" | "AUTHORITY" | "RUNTIME_SOURCE";
}>;

export type TransportFailureCode =
  | "EGRESS_DESTINATION_NOT_ALLOWED"
  | "EGRESS_SCHEME_NOT_ALLOWED"
  | "EGRESS_PRIVATE_ADDRESS_BLOCKED"
  | "EGRESS_REDIRECT_BLOCKED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TLS_ERROR"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_MALFORMED_RESPONSE"
  | "PROVIDER_ABORTED";

export type TransportFailure = Readonly<{
  kind: "TRANSPORT_FAILURE";
  code: TransportFailureCode;
  retryable: boolean;
  safeMessageCode: TransportFailureCode;
  safeStatus: number | null;
  causeClass: "POLICY" | "NETWORK" | "TLS" | "RESPONSE" | "ABORT" | "TIMEOUT";
}>;

export type ProviderSecurityAuditMetadata = Readonly<{
  provider: ProviderId;
  environment: ProviderEnvironment;
  operationId: string;
  endpointId: ProviderEndpoint["id"];
  hostname: string;
  policyOutcome: "ALLOWED" | "DENIED";
  normalizedOutcome: "SUCCESS" | CredentialFailureCode | TransportFailureCode;
  durationMs: number;
  attemptCount: number;
  safeStatus: number | null;
  requestBytes: number;
  responseBytes: number;
  correlationId: string;
  credentialReferenceId: string | null;
  credentialVersion: string | null;
}>;

export type ProviderSecurityResult =
  | Readonly<{ ok: true; json: unknown; audit: ProviderSecurityAuditMetadata }>
  | Readonly<{
      ok: false;
      error: CredentialFailure | TransportFailure;
      audit: ProviderSecurityAuditMetadata;
    }>;
