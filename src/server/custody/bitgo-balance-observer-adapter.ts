import "server-only";

import { randomUUID } from "node:crypto";

import {
  createBitGoReadOnlySemanticAdapter,
  type BitGoReadOnlySemanticAdapter,
  type BitGoReadOnlySemanticAdapterConfig,
} from "./bitgo-read-only-semantic-adapter";
import type {
  CustodyAccountBindingRef,
  CustodyBalanceObservationResult,
  CustodyObservationAdapter,
  CustodyObservationAdapterFactory,
  CustodyObservationPage,
  CustodyObservationReadOptions,
  CustodyProviderHealth,
  CustodyProviderRef,
  CustodyTransferObservation,
} from "./provider-observation-contract";
import type { CredentialReference } from "../provider-security/provider-security-types";

const BITGO_PROVIDER_CODE = "BITGO";
const BITGO_ASSET_CODE = "TSOL";
const WALLET_ID_PATTERN = /^[0-9a-f]{32}$/;
const BALANCE_CAPABILITY = "BALANCE_OBSERVATION";

export type BitGoWalletIdResolution =
  | { ok: true; walletId: string }
  | {
      ok: false;
      code:
        | "WALLET_ID_NOT_CONFIGURED"
        | "WALLET_ID_INVALID"
        | "WALLET_ID_RESOLUTION_FAILED";
    };

export type BitGoWalletIdResolver = {
  resolveWalletId(
    binding: CustodyAccountBindingRef,
    options?: { signal?: AbortSignal },
  ): Promise<BitGoWalletIdResolution>;
};

export type BitGoBalanceObserverCorrelationIdFactory = () => string;

export type BitGoReadOnlySemanticAdapterFactory = (
  config: BitGoReadOnlySemanticAdapterConfig,
) => BitGoReadOnlySemanticAdapter;

export type BitGoBalanceObserverAdapterFactoryConfig = {
  credentialReference: CredentialReference | null;
  authorizedExecutionContext?: boolean;
  walletIdResolver: BitGoWalletIdResolver;
  correlationIdFactory?: BitGoBalanceObserverCorrelationIdFactory;
  semanticAdapterFactory?: BitGoReadOnlySemanticAdapterFactory;
};

export class BitGoBalanceObserverDuplicateBindingError extends Error {
  readonly code = "BITGO_BALANCE_OBSERVER_DUPLICATE_BINDING";

  constructor() {
    super("bitgo_balance_observer_duplicate_binding");
  }
}

export class BitGoBalanceObserverAbortedError extends Error {
  readonly code = "BITGO_BALANCE_OBSERVER_ABORTED";

  constructor() {
    super("bitgo_balance_observer_aborted");
  }
}

export class BitGoBalanceObserverUnsupportedCapabilityError extends Error {
  readonly code = "UNSUPPORTED_CAPABILITY";

  constructor() {
    super("bitgo_balance_observer_unsupported_capability");
  }
}

export function createBitGoBalanceObserverAdapterFactory(
  config: BitGoBalanceObserverAdapterFactoryConfig,
): CustodyObservationAdapterFactory {
  const authorizedExecutionContext = config.authorizedExecutionContext ?? false;
  const correlationIdFactory = config.correlationIdFactory ?? randomUUID;
  const semanticAdapterFactory =
    config.semanticAdapterFactory ?? createBitGoReadOnlySemanticAdapter;

  return (provider) => {
    assertBitGoBalanceProvider(provider);

    const semanticAdapter = semanticAdapterFactory({
      provider,
      credentialReference: config.credentialReference,
      authorizedExecutionContext,
    });

    return new BitGoBalanceObserverAdapter({
      provider,
      semanticAdapter,
      walletIdResolver: config.walletIdResolver,
      correlationIdFactory,
    });
  };
}

export class BitGoBalanceObserverAdapter implements CustodyObservationAdapter {
  readonly provider: CustodyProviderRef;

  private readonly semanticAdapter: BitGoReadOnlySemanticAdapter;
  private readonly walletIdResolver: BitGoWalletIdResolver;
  private readonly correlationIdFactory: BitGoBalanceObserverCorrelationIdFactory;

  constructor(config: {
    provider: CustodyProviderRef;
    semanticAdapter: BitGoReadOnlySemanticAdapter;
    walletIdResolver: BitGoWalletIdResolver;
    correlationIdFactory: BitGoBalanceObserverCorrelationIdFactory;
  }) {
    this.provider = config.provider;
    this.semanticAdapter = config.semanticAdapter;
    this.walletIdResolver = config.walletIdResolver;
    this.correlationIdFactory = config.correlationIdFactory;
  }

  readHealth(): Promise<CustodyProviderHealth> {
    return this.semanticAdapter.readHealth();
  }

  async readBalances(
    bindings: readonly CustodyAccountBindingRef[],
    options: CustodyObservationReadOptions = {},
  ): Promise<readonly CustodyBalanceObservationResult[]> {
    throwIfAborted(options.signal);
    assertNoDuplicateBindings(bindings);

    const results: CustodyBalanceObservationResult[] = [];

    for (const binding of bindings) {
      throwIfAborted(options.signal);

      if (!isBinding(binding) || binding.providerCode !== BITGO_PROVIDER_CODE) {
        results.push(failure(binding, "UNEXPECTED_RESULT"));
        continue;
      }

      if (binding.assetCode !== BITGO_ASSET_CODE) {
        results.push(failure(binding, "UNSUPPORTED_ASSET"));
        continue;
      }

      let resolution: BitGoWalletIdResolution;

      try {
        resolution = await this.walletIdResolver.resolveWalletId(binding, {
          signal: options.signal,
        });
      } catch {
        results.push(failure(binding, "UNEXPECTED_RESULT"));
        continue;
      }

      throwIfAborted(options.signal);

      if (!resolution.ok || !WALLET_ID_PATTERN.test(resolution.walletId)) {
        results.push(failure(binding, "UNEXPECTED_RESULT"));
        continue;
      }

      const result = await this.semanticAdapter.readBalance({
        binding,
        walletId: resolution.walletId,
        correlationId: this.correlationIdFactory(),
        signal: options.signal,
      });

      throwIfAborted(options.signal);
      results.push(result);
    }

    return results;
  }

  async readTransfers(_input: {
    bindings: readonly CustodyAccountBindingRef[];
    sinceObservedAt: string | null;
    cursor: string | null;
    limit: number;
  }): Promise<CustodyObservationPage<CustodyTransferObservation>> {
    void _input;
    throw new BitGoBalanceObserverUnsupportedCapabilityError();
  }
}

function assertBitGoBalanceProvider(provider: CustodyProviderRef): void {
  if (
    provider.providerCode !== BITGO_PROVIDER_CODE ||
    provider.capabilities.length !== 1 ||
    provider.capabilities[0] !== BALANCE_CAPABILITY
  ) {
    throw new RangeError("bitgo_balance_observer_provider_invalid");
  }
}

function assertNoDuplicateBindings(
  bindings: readonly CustodyAccountBindingRef[],
): void {
  const seen = new Set<string>();

  for (const binding of bindings) {
    const key = [
      binding.providerCode,
      binding.bindingKey,
      binding.assetCode,
      binding.accountRole,
    ].join("\u001f");

    if (seen.has(key)) {
      throw new BitGoBalanceObserverDuplicateBindingError();
    }

    seen.add(key);
  }
}

function isBinding(value: unknown): value is CustodyAccountBindingRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CustodyAccountBindingRef).providerCode === "string" &&
    typeof (value as CustodyAccountBindingRef).bindingKey === "string" &&
    typeof (value as CustodyAccountBindingRef).assetCode === "string" &&
    typeof (value as CustodyAccountBindingRef).accountRole === "string"
  );
}

function failure(
  binding: CustodyAccountBindingRef,
  code: "UNEXPECTED_RESULT" | "UNSUPPORTED_ASSET",
): CustodyBalanceObservationResult {
  return {
    ok: false,
    binding,
    error: { code, retryable: false, retryAfterMs: null },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new BitGoBalanceObserverAbortedError();
  }
}
