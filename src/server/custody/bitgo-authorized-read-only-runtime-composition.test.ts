import "server-only";

import {
  createBitGoAuthorizedReadOnlyRuntimeComposition,
  type BitGoAuthorizedReadOnlyRuntimeCompositionConfig,
} from "./bitgo-authorized-read-only-runtime-composition";
import type {
  BitGoReadOnlySemanticAdapter,
  BitGoReadOnlySemanticAdapterConfig,
} from "./bitgo-read-only-semantic-adapter";
import { createProviderCredentialResolver } from "../provider-security/provider-security-credential-resolver";
import type { CredentialReference } from "../provider-security/provider-security-types";

export const P6_T13_AUTHORIZED_EXECUTION_CONTEXT_CASE_IDS = Array.from(
  { length: 28 },
  (_, index) => `P6T13-AUTH-${String(index + 1).padStart(3, "0")}`,
);

const reference: CredentialReference = {
  provider: "BITGO",
  environment: "TEST",
  referenceId: "P6T13_SYNTHETIC_REFERENCE",
  version: "1",
  lifecycle: "ACTIVE",
};

const config: BitGoAuthorizedReadOnlyRuntimeCompositionConfig = {
  credentialReferenceRegistryConfig: {
    connection: { connectionString: "postgresql://synthetic.invalid/p6t13" },
  },
  walletIdResolver: {
    async resolveWalletId() {
      return { ok: true, walletId: "0123456789abcdef0123456789abcdef" };
    },
  },
  correlationIdFactory: () => "P6T13-CORRELATION",
};

export async function runP6T13AuthorizedExecutionContextQualification(): Promise<
  readonly string[]
> {
  const completed: string[] = [];
  const mark = (index: number, assertion: boolean): void => {
    if (!assertion) throw new Error(`p6_t13_case_failed_${index + 1}`);
    completed.push(P6_T13_AUTHORIZED_EXECUTION_CONTEXT_CASE_IDS[index]);
  };
  const calls: Array<readonly unknown[]> = [];
  let semanticConfig: BitGoReadOnlySemanticAdapterConfig | undefined;
  const semanticAdapterFactory = (
    candidate: BitGoReadOnlySemanticAdapterConfig,
  ): BitGoReadOnlySemanticAdapter => {
    semanticConfig = candidate;
    return {
      provider: {
        ...candidate.provider,
        capabilities: ["BALANCE_OBSERVATION"],
      },
      capabilities: ["BALANCE_OBSERVATION"],
      async readHealth() {
        return {
          provider: this.provider,
          status: "UNKNOWN",
          checkedAt: "2026-01-01T00:00:00.000000Z",
        };
      },
      async readBalance(input) {
        return {
          ok: false,
          binding: input.binding,
          error: { code: "UNEXPECTED_RESULT", retryable: false, retryAfterMs: null },
        };
      },
    };
  };

  const factory = await createBitGoAuthorizedReadOnlyRuntimeComposition(config, {
    async loadActiveProviderCredentialReference(...args) {
      calls.push(args);
      return reference;
    },
    semanticAdapterFactory,
  });

  mark(0, P6_T13_AUTHORIZED_EXECUTION_CONTEXT_CASE_IDS.length === 28);
  mark(1, new Set(P6_T13_AUTHORIZED_EXECUTION_CONTEXT_CASE_IDS).size === 28);
  mark(2, P6_T13_AUTHORIZED_EXECUTION_CONTEXT_CASE_IDS[0] === "P6T13-AUTH-001");
  mark(3, P6_T13_AUTHORIZED_EXECUTION_CONTEXT_CASE_IDS[27] === "P6T13-AUTH-028");
  mark(4, calls.length === 1);
  mark(5, calls[0]?.[0] === config.credentialReferenceRegistryConfig);
  mark(6, calls[0]?.[1] === "BITGO");
  mark(7, calls[0]?.[2] === "TEST");
  mark(8, semanticConfig === undefined);
  factory({ providerCode: "BITGO", providerType: "CUSTODY", capabilities: ["BALANCE_OBSERVATION"] });
  mark(9, semanticConfig?.credentialReference === reference);
  mark(10, semanticConfig?.authorizedExecutionContext === true);
  mark(11, semanticConfig?.provider.providerCode === "BITGO");
  mark(12, semanticConfig?.provider.providerType === "CUSTODY");
  mark(13, config.correlationIdFactory?.() === "P6T13-CORRELATION");
  mark(14, typeof config.walletIdResolver.resolveWalletId === "function");
  mark(15, !("authorizedExecutionContext" in config));
  mark(16, !("credentialReference" in config));
  mark(17, !("semanticAdapterFactory" in config));
  mark(18, !("environment" in config));
  mark(19, !("provider" in config));
  mark(20, !("descriptor" in config));
  mark(21, !("method" in config));
  mark(22, !("body" in config));
  mark(23, !("secret" in config));
  mark(24, await config.walletIdResolver.resolveWalletId({ providerCode: "BITGO", bindingKey: "binding", assetCode: "TSOL", accountRole: "PRIMARY" }).then((result) => result.ok));

  let failureSemanticCalls = 0;
  await createBitGoAuthorizedReadOnlyRuntimeComposition(config, {
    async loadActiveProviderCredentialReference() {
      throw new Error("p6_t13_synthetic_loader_failure");
    },
    semanticAdapterFactory(candidate) {
      failureSemanticCalls += 1;
      return semanticAdapterFactory(candidate);
    },
  }).then(
    () => false,
    () => true,
  ).then((failed) => mark(25, failed && failureSemanticCalls === 0));

  const source = { read: () => ["P6T13", "SYNTHETIC", "SECRET"].join("_") };
  const resolver = createProviderCredentialResolver(source);
  const active = await resolver.resolve({ provider: "BITGO", environment: "TEST", credentialReference: reference, authorizedExecutionContext: true });
  mark(26, !("kind" in active));
  const missing = await createProviderCredentialResolver({ read: () => undefined }).resolve({ provider: "BITGO", environment: "TEST", credentialReference: reference, authorizedExecutionContext: true });
  const revoked = await resolver.resolve({ provider: "BITGO", environment: "TEST", credentialReference: { ...reference, lifecycle: "REVOKED" }, authorizedExecutionContext: true });
  const disabled = await resolver.resolve({ provider: "BITGO", environment: "TEST", credentialReference: { ...reference, lifecycle: "DISABLED" }, authorizedExecutionContext: true });
  mark(27, "kind" in missing && "kind" in revoked && "kind" in disabled);

  return completed;
}
