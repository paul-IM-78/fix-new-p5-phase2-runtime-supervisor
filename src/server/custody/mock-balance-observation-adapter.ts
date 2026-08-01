import "server-only";

import {
  normalizeAtomicUnits,
  normalizeObservationIdentityValue,
  normalizeUtcMicrosecondTimestamp,
} from "./balance-observation-normalization";
import type {
  CustodyAccountBindingRef,
  CustodyBalanceObservation,
  CustodyBalanceObservationError,
  CustodyBalanceObservationErrorCode,
  CustodyBalanceObservationIdentity,
  CustodyBalanceObservationResult,
  CustodyObservationAdapter,
  CustodyObservationAdapterFactory,
  CustodyObservationPage,
  CustodyProviderHealth,
  CustodyProviderHealthStatus,
  CustodyProviderRef,
  CustodyTransferObservation,
} from "./provider-observation-contract";

export type MockBalanceObservationSuccessFixture = {
  kind: "SUCCESS";
  binding: CustodyAccountBindingRef;
  identity: CustodyBalanceObservationIdentity;
  observedAvailableUnits: string;
  observedTotalUnits: string;
  observedAt: string;
  finalizedAt: string | null;
};

export type MockBalanceObservationErrorFixture = {
  kind: "ERROR";
  binding: CustodyAccountBindingRef;
  code: CustodyBalanceObservationErrorCode;
  retryable?: boolean;
  retryAfterMs?: number | null;
};

export type MockBalanceObservationFixture =
  | MockBalanceObservationSuccessFixture
  | MockBalanceObservationErrorFixture;

export type MockCustodyObservationAdapterConfig = {
  provider: CustodyProviderRef;
  health: {
    status: CustodyProviderHealthStatus;
    checkedAt: string;
  };
  balances: readonly MockBalanceObservationFixture[];
  transfers?: readonly CustodyTransferObservation[];
};

export function createMockCustodyObservationAdapter(
  config: MockCustodyObservationAdapterConfig,
): CustodyObservationAdapter {
  return new MockCustodyObservationAdapter(config);
}

export function createMockCustodyObservationAdapterFactory(
  config: MockCustodyObservationAdapterConfig,
): CustodyObservationAdapterFactory {
  return (provider) =>
    createMockCustodyObservationAdapter({
      ...config,
      provider,
    });
}

function createBalanceObservationError(
  code: CustodyBalanceObservationErrorCode,
  retryable = isRetryableErrorCode(code),
  retryAfterMs: number | null = null,
): CustodyBalanceObservationError {
  if (
    retryAfterMs !== null &&
    (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0)
  ) {
    throw new RangeError("retry_after_ms_invalid");
  }

  return {
    code,
    retryable,
    retryAfterMs,
  };
}

class MockCustodyObservationAdapter implements CustodyObservationAdapter {
  readonly provider: CustodyProviderRef;

  private readonly health: CustodyProviderHealth;
  private readonly fixturesByBindingKey = new Map<
    string,
    MockBalanceObservationFixture
  >();
  private readonly duplicateBindingKeys = new Set<string>();
  private readonly transfers: readonly CustodyTransferObservation[];

  constructor(config: MockCustodyObservationAdapterConfig) {
    this.provider = config.provider;
    this.health = {
      provider: config.provider,
      status: config.health.status,
      checkedAt: normalizeUtcMicrosecondTimestamp(config.health.checkedAt),
    };
    this.transfers = config.transfers ?? [];

    for (const fixture of config.balances) {
      const key = bindingResultKey(fixture.binding);

      if (this.fixturesByBindingKey.has(key)) {
        this.duplicateBindingKeys.add(key);
      }

      this.fixturesByBindingKey.set(key, fixture);
    }
  }

  async readHealth(): Promise<CustodyProviderHealth> {
    return this.health;
  }

  async readBalances(
    bindings: readonly CustodyAccountBindingRef[],
  ): Promise<readonly CustodyBalanceObservationResult[]> {
    return bindings.map((binding) => this.readBindingBalance(binding));
  }

  async readTransfers(input: {
    bindings: readonly CustodyAccountBindingRef[];
    sinceObservedAt: string | null;
    cursor: string | null;
    limit: number;
  }): Promise<CustodyObservationPage<CustodyTransferObservation>> {
    void input.bindings;
    void input.sinceObservedAt;
    void input.cursor;
    void input.limit;

    return {
      observations: this.transfers,
      page: {
        cursor: null,
        hasMore: false,
      },
    };
  }

  private readBindingBalance(
    binding: CustodyAccountBindingRef,
  ): CustodyBalanceObservationResult {
    const key = bindingResultKey(binding);

    if (this.duplicateBindingKeys.has(key)) {
      return {
        ok: false,
        binding,
        error: createBalanceObservationError("DUPLICATE_RESULT", false),
      };
    }

    const fixture = this.fixturesByBindingKey.get(key);

    if (!fixture) {
      return {
        ok: false,
        binding,
        error: createBalanceObservationError("MISSING_RESULT", true),
      };
    }

    if (fixture.kind === "ERROR") {
      return {
        ok: false,
        binding,
        error: createBalanceObservationError(
          fixture.code,
          fixture.retryable ?? isRetryableErrorCode(fixture.code),
          fixture.retryAfterMs ?? null,
        ),
      };
    }

    return this.successResult(binding, fixture);
  }

  private successResult(
    binding: CustodyAccountBindingRef,
    fixture: MockBalanceObservationSuccessFixture,
  ): CustodyBalanceObservationResult {
    try {
      const observation: CustodyBalanceObservation = {
        provider: this.provider,
        binding,
        identity: normalizeIdentity(fixture.identity),
        observedAvailableUnits: normalizeAtomicUnits(
          fixture.observedAvailableUnits,
        ),
        observedTotalUnits: normalizeAtomicUnits(fixture.observedTotalUnits),
        observedAt: normalizeUtcMicrosecondTimestamp(fixture.observedAt),
        finalizedAt:
          fixture.finalizedAt === null
            ? null
            : normalizeUtcMicrosecondTimestamp(fixture.finalizedAt),
      };

      return {
        ok: true,
        binding,
        observation,
      };
    } catch (error) {
      const code =
        error instanceof RangeError &&
        String(error.message).includes("timestamp")
          ? "MALFORMED_TIMESTAMP"
          : error instanceof RangeError &&
              String(error.message).includes("atomic_units")
            ? "MALFORMED_AMOUNT"
            : "UNEXPECTED_RESULT";

      return {
        ok: false,
        binding,
        error: createBalanceObservationError(code, false),
      };
    }
  }
}

function normalizeIdentity(
  identity: CustodyBalanceObservationIdentity,
): CustodyBalanceObservationIdentity {
  if (identity.kind === "CONTENT") {
    return identity;
  }

  return {
    kind: identity.kind,
    value: normalizeObservationIdentityValue(identity.value),
  };
}

function bindingResultKey(binding: CustodyAccountBindingRef): string {
  return [
    binding.providerCode,
    binding.bindingKey,
    binding.assetCode,
    binding.accountRole,
  ].join("\u001f");
}

function isRetryableErrorCode(code: CustodyBalanceObservationErrorCode): boolean {
  return (
    code === "TIMEOUT" ||
    code === "RATE_LIMITED" ||
    code === "PROVIDER_UNAVAILABLE" ||
    code === "MISSING_RESULT"
  );
}
