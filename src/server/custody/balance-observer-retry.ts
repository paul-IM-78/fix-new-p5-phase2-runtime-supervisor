import "server-only";

import { randomInt as cryptoRandomInt } from "node:crypto";

export type CustodyBalanceObserverRetryPolicy =
  | {
      mode: "DISABLED";
    }
  | {
      mode: "BOUNDED_V1";
      maxAttempts: number;
      baseDelayMs: number;
      maxDelayMs: number;
      jitterRatio: number;
      maxRetryAfterMs: number;
    };

export type CustodyBalanceObserverRetryRandomInteger = (
  maxExclusive: number,
) => number;

export type CustodyBalanceObserverRetrySleep = (
  delayMs: number,
  signal?: AbortSignal,
) => Promise<"COMPLETED" | "ABORTED" | void>;

export type RetryDelayDecision = {
  delayMs: number;
  retryDeferred: boolean;
  retryAfterMs: number | null;
};

export const DEFAULT_CUSTODY_BALANCE_OBSERVER_RETRY_POLICY = {
  mode: "BOUNDED_V1",
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  jitterRatio: 0.2,
  maxRetryAfterMs: 30_000,
} as const satisfies CustodyBalanceObserverRetryPolicy;

const DISABLED_RETRY_POLICY: CustodyBalanceObserverRetryPolicy = {
  mode: "DISABLED",
};

export function normalizeCustodyBalanceObserverRetryPolicy(
  policy: CustodyBalanceObserverRetryPolicy | undefined,
): CustodyBalanceObserverRetryPolicy {
  if (!policy || policy.mode === "DISABLED") {
    return DISABLED_RETRY_POLICY;
  }

  if (policy.mode !== "BOUNDED_V1") {
    throw new RangeError("RETRY_POLICY_INVALID");
  }

  const maxAttempts = validateInteger(policy.maxAttempts, 1, 5);
  const baseDelayMs = validateInteger(policy.baseDelayMs, 1, 10_000);
  const maxDelayMs = validateInteger(policy.maxDelayMs, baseDelayMs, 60_000);
  const maxRetryAfterMs = validateInteger(policy.maxRetryAfterMs, 1, 300_000);

  if (
    typeof policy.jitterRatio !== "number" ||
    !Number.isFinite(policy.jitterRatio) ||
    policy.jitterRatio < 0 ||
    policy.jitterRatio > 1
  ) {
    throw new RangeError("RETRY_POLICY_INVALID");
  }

  return {
    mode: "BOUNDED_V1",
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitterRatio: policy.jitterRatio,
    maxRetryAfterMs,
  };
}

export function shouldRetryAttempt(
  policy: CustodyBalanceObserverRetryPolicy,
  attemptNumber: number,
): boolean {
  return policy.mode === "BOUNDED_V1" && attemptNumber < policy.maxAttempts;
}

export function calculateRetryDelayDecision({
  policy,
  retryIndex,
  retryAfterMs,
  randomInteger = cryptoRandomInteger,
}: {
  policy: CustodyBalanceObserverRetryPolicy;
  retryIndex: number;
  retryAfterMs?: number | null;
  randomInteger?: CustodyBalanceObserverRetryRandomInteger;
}): RetryDelayDecision {
  if (policy.mode !== "BOUNDED_V1") {
    return {
      delayMs: 0,
      retryDeferred: false,
      retryAfterMs: null,
    };
  }

  const safeRetryAfterMs = normalizeRetryAfterMs(retryAfterMs);

  if (
    safeRetryAfterMs !== null &&
    safeRetryAfterMs > policy.maxRetryAfterMs
  ) {
    return {
      delayMs: 0,
      retryDeferred: true,
      retryAfterMs: safeRetryAfterMs,
    };
  }

  const backoffDelayMs = calculateBackoffDelayMs({
    policy,
    retryIndex,
    randomInteger,
  });

  return {
    delayMs: Math.max(backoffDelayMs, safeRetryAfterMs ?? 0),
    retryDeferred: false,
    retryAfterMs: safeRetryAfterMs,
  };
}

export function calculateBackoffDelayMs({
  policy,
  retryIndex,
  randomInteger = cryptoRandomInteger,
}: {
  policy: Extract<CustodyBalanceObserverRetryPolicy, { mode: "BOUNDED_V1" }>;
  retryIndex: number;
  randomInteger?: CustodyBalanceObserverRetryRandomInteger;
}): number {
  const safeRetryIndex = validateInteger(retryIndex, 1, 32);
  const exponential = policy.baseDelayMs * 2 ** (safeRetryIndex - 1);
  const boundedCap = Math.min(policy.maxDelayMs, exponential);
  const jitterWindow = Math.floor(boundedCap * policy.jitterRatio);
  const minimumDelay = boundedCap - jitterWindow;
  const randomOffset =
    jitterWindow === 0 ? 0 : randomInteger(jitterWindow * 2 + 1);
  const delayMs = minimumDelay + randomOffset;

  return Math.max(0, Math.min(policy.maxDelayMs, delayMs));
}

export async function waitForRetryDelay({
  delayMs,
  signal,
  sleep,
}: {
  delayMs: number;
  signal?: AbortSignal;
  sleep?: CustodyBalanceObserverRetrySleep;
}): Promise<"COMPLETED" | "ABORTED"> {
  const safeDelayMs = validateInteger(delayMs, 0, 300_000);

  if (signal?.aborted) {
    return "ABORTED";
  }

  if (sleep) {
    const result = await sleep(safeDelayMs, signal);

    if (result === "ABORTED" || signal?.aborted) {
      return "ABORTED";
    }

    return "COMPLETED";
  }

  if (safeDelayMs === 0) {
    return signal?.aborted ? "ABORTED" : "COMPLETED";
  }

  return new Promise((resolve) => {
    let settled = false;
    const complete = (result: "COMPLETED" | "ABORTED") => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => complete("ABORTED");
    const timeout = setTimeout(() => complete("COMPLETED"), safeDelayMs);

    signal?.addEventListener("abort", abort, {
      once: true,
    });
  });
}

function normalizeRetryAfterMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return validateInteger(value, 0, 300_000);
}

function validateInteger(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new RangeError("RETRY_POLICY_INVALID");
  }

  return value;
}

function cryptoRandomInteger(maxExclusive: number): number {
  return cryptoRandomInt(validateInteger(maxExclusive, 1, 1_000_000_000));
}
