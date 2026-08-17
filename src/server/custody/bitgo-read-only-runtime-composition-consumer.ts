import "server-only";

import {
  createBitGoReadOnlyRuntimeComposition,
  type BitGoReadOnlyRuntimeCompositionConfig,
} from "./bitgo-read-only-runtime-composition";
import {
  runCustodyBalanceObserverOneShot,
  type CustodyBalanceObserverOneShotResult,
  type RunCustodyBalanceObserverOneShotInput,
} from "./balance-observer-orchestrator";

export type BitGoReadOnlyRuntimeCompositionConsumerConfig =
  BitGoReadOnlyRuntimeCompositionConfig &
  Pick<
    RunCustodyBalanceObserverOneShotInput,
    "scopeClient" | "commandClient"
  >;

export function runBitGoReadOnlyRuntimeCompositionOneShot(
  config: BitGoReadOnlyRuntimeCompositionConsumerConfig,
): Promise<CustodyBalanceObserverOneShotResult> {
  const adapterFactory = createBitGoReadOnlyRuntimeComposition({
    registryEntries: config.registryEntries,
    semanticAdapterFactory: config.semanticAdapterFactory,
    correlationIdFactory: config.correlationIdFactory,
  });

  return runCustodyBalanceObserverOneShot({
    scopeClient: config.scopeClient,
    commandClient: config.commandClient,
    adapterFactory,
    identityPolicy: "REMOTE_CONTENT",
  });
}
