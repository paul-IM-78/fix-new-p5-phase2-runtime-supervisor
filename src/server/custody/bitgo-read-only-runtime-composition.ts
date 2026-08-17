import "server-only";

import {
  createBitGoBalanceObserverAdapterFactory,
  type BitGoBalanceObserverCorrelationIdFactory,
  type BitGoReadOnlySemanticAdapterFactory,
} from "./bitgo-balance-observer-adapter";
import {
  createBitGoWalletIdResolver,
  type BitGoWalletIdBindingRegistryEntry,
} from "./bitgo-wallet-id-resolver";
import type { CustodyObservationAdapterFactory } from "./provider-observation-contract";

export type BitGoReadOnlyRuntimeCompositionConfig = {
  registryEntries: readonly BitGoWalletIdBindingRegistryEntry[];
  semanticAdapterFactory: BitGoReadOnlySemanticAdapterFactory;
  correlationIdFactory?: BitGoBalanceObserverCorrelationIdFactory;
};

export function createBitGoReadOnlyRuntimeComposition(
  config: BitGoReadOnlyRuntimeCompositionConfig,
): CustodyObservationAdapterFactory {
  return createBitGoBalanceObserverAdapterFactory({
    credentialReference: null,
    authorizedExecutionContext: false,
    walletIdResolver: createBitGoWalletIdResolver(config.registryEntries),
    semanticAdapterFactory: config.semanticAdapterFactory,
    correlationIdFactory: config.correlationIdFactory,
  });
}
