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
  CustodyObservationReadOptions,
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

export type MockBalanceObservationAttemptSequence = {
  binding: CustodyAccountBindingRef;
  attempts: readonly MockBalanceObservationFixture[];
};

export type MockCustodyObservationAdapterConfig = {
  provider: CustodyProviderRef;
  health: {
    status: CustodyProviderHealthStatus;
    checkedAt: string;
  };
  balances: readonly MockBalanceObservationFixture[];
  balanceAttemptSequences?: readonly MockBalanceObservationAttemptSequence[];
  transfers?: readonly CustodyTransferObservation[];
  balanceReadDelayMs?: number;
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
  private readonly attemptSequencesByBindingKey = new Map<
    string,
    readonly MockBalanceObservationFixture[]
  >();
  private readonly attemptIndexByBindingKey = new Map<string, number>();
  private readonly duplicateBindingKeys = new Set<string>();
  private readonly transfers: readonly CustodyTransferObservation[];
  private readonly balanceReadDelayMs: number;

  constructor(config: MockCustodyObservationAdapterConfig) {
    this.provider = config.provider;
    this.health = {
      provider: config.provider,
      status: config.health.status,
      checkedAt: normalizeUtcMicrosecondTimestamp(config.health.checkedAt),
    };
    this.transfers = config.transfers ?? [];
    this.balanceReadDelayMs = normalizeDelayMs(config.balanceReadDelayMs ?? 0);

    for (const fixture of config.balances) {
      const key = bindingResultKey(fixture.binding);

      if (this.fixturesByBindingKey.has(key)) {
        this.duplicateBindingKeys.add(key);
      }

      this.fixturesByBindingKey.set(key, fixture);
    }

    for (const sequence of config.balanceAttemptSequences ?? []) {
      const key = bindingResultKey(sequence.binding);

      if (sequence.attempts.length < 1) {
        throw new RangeError("mock_balance_attempt_sequence_empty");
      }

      if (this.attemptSequencesByBindingKey.has(key)) {
        this.duplicateBindingKeys.add(key);
      }

      for (const fixture of sequence.attempts) {
        if (bindingResultKey(fixture.binding) !== key) {
          throw new RangeError("mock_balance_attempt_sequence_binding_mismatch");
        }
      }

      this.attemptSequencesByBindingKey.set(key, sequence.attempts);
    }
  }

  async readHealth(): Promise<CustodyProviderHealth> {
    return this.health;
  }

  async readBalances(
    bindings: readonly CustodyAccountBindingRef[],
    options: CustodyObservationReadOptions = {},
  ): Promise<readonly CustodyBalanceObservationResult[]> {
    throwIfAborted(options.signal);
    await waitForDelay(this.balanceReadDelayMs, options.signal);
    throwIfAborted(options.signal);

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

    const fixture = this.readFixtureForAttempt(key);

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

  private readFixtureForAttempt(
    key: string,
  ): MockBalanceObservationFixture | undefined {
    const sequence = this.attemptSequencesByBindingKey.get(key);

    if (!sequence) {
      return this.fixturesByBindingKey.get(key);
    }

    const index = this.attemptIndexByBindingKey.get(key) ?? 0;
    this.attemptIndexByBindingKey.set(key, index + 1);

    return sequence[Math.min(index, sequence.length - 1)];
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

function normalizeDelayMs(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 10_000
  ) {
    throw new RangeError("mock_balance_read_delay_invalid");
  }

  return value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("custody_balance_observation_read_aborted");
  }
}

function waitForDelay(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (delayMs === 0) {
    return Promise.resolve();
  }

  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const abort = () => {
      cleanup();
      reject(new Error("custody_balance_observation_read_aborted"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };

    signal?.addEventListener("abort", abort, {
      once: true,
    });
  });
}
