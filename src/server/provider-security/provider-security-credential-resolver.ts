import "server-only";

import type {
  CredentialFailure,
  CredentialResolutionRequest,
  ResolvedProviderCredential,
  RuntimeSecretSource,
} from "./provider-security-types";

const secretByCredential = new WeakMap<object, string>();

export type ProviderCredentialResolver = Readonly<{
  resolve(request: CredentialResolutionRequest): Promise<ResolvedProviderCredential | CredentialFailure>;
}>;

export function createProcessEnvRuntimeSecretSource(): RuntimeSecretSource {
  return { read: () => process.env.BITGO_TEST_ACCESS_TOKEN };
}

export function createProviderCredentialResolver(source: RuntimeSecretSource): ProviderCredentialResolver {
  return {
    async resolve(request) {
      const reference = request.credentialReference;
      if (!reference) return failure("CREDENTIAL_REFERENCE_MISSING", "REFERENCE");
      if (reference.provider !== request.provider || reference.environment !== request.environment) {
        return failure("CREDENTIAL_ENVIRONMENT_MISMATCH", "REFERENCE");
      }
      if (!request.authorizedExecutionContext) return failure("SECRET_RESOLUTION_DENIED", "AUTHORITY");
      if (reference.lifecycle === "REVOKED") return failure("CREDENTIAL_REVOKED", "LIFECYCLE");
      if (reference.lifecycle === "DISABLED") return failure("CREDENTIAL_SCOPE_INVALID", "LIFECYCLE");
      if (reference.lifecycle !== "ACTIVE" && reference.lifecycle !== "ROTATING") {
        return failure("CREDENTIAL_SCOPE_INVALID", "LIFECYCLE");
      }
      if (request.environment !== "TEST") return failure("CREDENTIAL_SCOPE_INVALID", "REFERENCE");
      const secret = source.read("BITGO_TEST_ACCESS_TOKEN");
      if (!secret || secret !== secret.trim()) return failure("CREDENTIAL_UNAVAILABLE", "RUNTIME_SOURCE");
      const credential = Object.freeze({});
      secretByCredential.set(credential, secret);
      return credential as ResolvedProviderCredential;
    },
  };
}

export function createInternalAuthorizationHeader(credential: ResolvedProviderCredential): string {
  const secret = secretByCredential.get(credential as object);
  if (!secret) throw new Error("provider_credential_unavailable");
  return `Bearer ${secret}`;
}

function failure(
  code: CredentialFailure["code"],
  causeClass: CredentialFailure["causeClass"],
): CredentialFailure {
  return { kind: "CREDENTIAL_FAILURE", code, retryable: false, safeMessageCode: code, causeClass };
}
