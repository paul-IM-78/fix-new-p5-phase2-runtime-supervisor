import "server-only";

import {
  createBitGoBalanceObserverAdapterFactory,
  type BitGoBalanceObserverCorrelationIdFactory,
  type BitGoReadOnlySemanticAdapterFactory,
  type BitGoWalletIdResolver,
} from "./bitgo-balance-observer-adapter";
import { createBitGoReadOnlySemanticAdapter } from "./bitgo-read-only-semantic-adapter";
import type { CustodyObservationAdapterFactory } from "./provider-observation-contract";
import {
  loadActiveProviderCredentialReference,
  type ProviderCredentialReferenceRegistryClientConfig,
} from "../provider-security/provider-credential-reference-registry-client";

export type BitGoAuthorizedReadOnlyRuntimeCompositionConfig = Readonly<{
  credentialReferenceRegistryConfig: ProviderCredentialReferenceRegistryClientConfig;
  walletIdResolver: BitGoWalletIdResolver;
  correlationIdFactory?: BitGoBalanceObserverCorrelationIdFactory;
}>;

export type BitGoAuthorizedReadOnlyRuntimeCompositionTestDependencies = Readonly<{
  loadActiveProviderCredentialReference?: typeof loadActiveProviderCredentialReference;
  semanticAdapterFactory?: BitGoReadOnlySemanticAdapterFactory;
}>;

export async function createBitGoAuthorizedReadOnlyRuntimeComposition(
  config: BitGoAuthorizedReadOnlyRuntimeCompositionConfig,
  testDependencies: BitGoAuthorizedReadOnlyRuntimeCompositionTestDependencies = {},
): Promise<CustodyObservationAdapterFactory> {
  const loadCredentialReference =
    testDependencies.loadActiveProviderCredentialReference ??
    loadActiveProviderCredentialReference;
  const credentialReference = await loadCredentialReference(
    config.credentialReferenceRegistryConfig,
    "BITGO",
    "TEST",
  );

  return createBitGoBalanceObserverAdapterFactory({
    credentialReference,
    authorizedExecutionContext: true,
    walletIdResolver: config.walletIdResolver,
    correlationIdFactory: config.correlationIdFactory,
    semanticAdapterFactory:
      testDependencies.semanticAdapterFactory ??
      createBitGoReadOnlySemanticAdapter,
  });
}
