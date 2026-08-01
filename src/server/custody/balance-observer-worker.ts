import "server-only";

import {
  CUSTODY_BALANCE_OBSERVER_KIND_V1,
  createBalanceObservationKeyV1,
  normalizeAtomicUnits,
  normalizeCanonicalUuid,
  normalizeUtcMicrosecondTimestamp,
} from "./balance-observation-normalization";
import {
  CustodyBalanceObserverCommandError,
  type CustodyBalanceObserverCommandClient,
} from "./balance-observer-command-client";
import {
  calculateRetryDelayDecision,
  normalizeCustodyBalanceObserverRetryPolicy,
  shouldRetryAttempt,
  waitForRetryDelay,
  type CustodyBalanceObserverRetryPolicy,
  type CustodyBalanceObserverRetryRandomInteger,
  type CustodyBalanceObserverRetrySleep,
} from "./balance-observer-retry";
import type {
  CustodyAccountBindingRef,
  CustodyBalanceObservationResult,
  CustodyProviderRef,
  CustodyObservationAdapter,
  CustodyBalanceObservationIdentity,
} from "./provider-observation-contract";

export type { CustodyBalanceObserverRetryPolicy } from "./balance-observer-retry";

export type CustodyBalanceObserverIdentityPolicy =
  | "PRODUCTION"
  | "LOCAL_MOCK";

export type CustodyBalanceObserverBindingWorkItem = {
  bindingId: string;
  assetId: string;
  binding: CustodyAccountBindingRef;
  expectedCheckpointVersion: string;
};

export type CustodyBalanceObserverWorkUnit = {
  provider: CustodyProviderRef;
  assetId: string;
  bindings: readonly CustodyBalanceObserverBindingWorkItem[];
  identityPolicy: CustodyBalanceObserverIdentityPolicy;
};

export type CustodyBalanceObserverBindingOutcome =
  | {
      ok: true;
      bindingId: string;
      observationCreated: boolean;
      checkpointCreated: boolean;
      checkpointAdvanced: boolean;
      checkpointVersion: string;
      adapterAttempts: number;
      databaseAttempts: number;
    }
  | {
      ok: false;
      bindingId: string;
      stage: "ADAPTER" | "VALIDATION" | "IDENTITY" | "DATABASE" | "ABORTED";
      code: string;
      retryable: boolean;
      adapterAttempts: number;
      databaseAttempts: number;
      retryExhausted: boolean;
      retryDeferred: boolean;
      retryAfterMs: number | null;
      requiresScopeRefresh: boolean;
    };

export type CustodyBalanceObserverWorkSummary = {
  requestedBindings: number;
  adapterSuccesses: number;
  adapterFailures: number;
  databaseAttempts: number;
  persistedObservations: number;
  replayedObservations: number;
  checkpointsCreated: number;
  checkpointsAdvanced: number;
  checkpointNoops: number;
  failedBindings: number;
  abortedBindings: number;
  adapterAttempts: number;
  adapterRetryAttempts: number;
  databaseRetryAttempts: number;
  retryExhaustedBindings: number;
  retryDeferredBindings: number;
  scopeRefreshRequiredBindings: number;
  timeoutFailures: number;
  lockTimeoutFailures: number;
  unavailableFailures: number;
};

export type CustodyBalanceObserverWorkResult = {
  outcomes: readonly CustodyBalanceObserverBindingOutcome[];
  summary: CustodyBalanceObserverWorkSummary;
};

export type CustodyBalanceObserverRetryRuntime = {
  randomInteger?: CustodyBalanceObserverRetryRandomInteger;
  sleep?: CustodyBalanceObserverRetrySleep;
};

export type RunCustodyBalanceObserverWorkUnitInput = {
  workUnit: CustodyBalanceObserverWorkUnit;
  adapter: CustodyObservationAdapter;
  commandClient: CustodyBalanceObserverCommandClient;
  retryPolicy?: CustodyBalanceObserverRetryPolicy;
  retryRuntime?: CustodyBalanceObserverRetryRuntime;
  signal?: AbortSignal;
};

type ValidatedBindingWorkItem = CustodyBalanceObserverBindingWorkItem & {
  bindingId: string;
  assetId: string;
  expectedCheckpointVersion: string;
};

type ValidatedWorkUnit = CustodyBalanceObserverWorkUnit & {
  assetId: string;
  bindings: readonly ValidatedBindingWorkItem[];
};

type AdapterResolution =
  | {
      kind: "SUCCESS";
      result: Extract<CustodyBalanceObservationResult, { ok: true }>;
      adapterAttempts: number;
    }
  | {
      kind: "FAILURE";
      outcome: CustodyBalanceObserverBindingOutcome;
      adapterFailureCount: number;
    }
  | {
      kind: "ABORTED";
      adapterAttempts: number;
    };

const BIGINT_MAX = BigInt("9223372036854775807");
const CHECKPOINT_VERSION_PATTERN = /^(0|[1-9][0-9]{0,18})$/;

export async function runCustodyBalanceObserverWorkUnit({
  workUnit,
  adapter,
  commandClient,
  retryPolicy,
  retryRuntime = {},
  signal,
}: RunCustodyBalanceObserverWorkUnitInput): Promise<CustodyBalanceObserverWorkResult> {
  const validatedWorkUnit = validateWorkUnit(workUnit);
  let safeRetryPolicy: CustodyBalanceObserverRetryPolicy;

  try {
    safeRetryPolicy = normalizeCustodyBalanceObserverRetryPolicy(retryPolicy);
  } catch {
    return createResult(
      validatedWorkUnit.bindings.map((item) =>
        failureOutcome({
          bindingId: item.bindingId,
          stage: "VALIDATION",
          code: "RETRY_POLICY_INVALID",
          retryable: false,
          adapterAttempts: 0,
          databaseAttempts: 0,
        }),
      ),
      0,
      0,
    );
  }

  if (signal?.aborted) {
    return createResult(
      validatedWorkUnit.bindings.map((item) =>
        abortedOutcome(item.bindingId, 0, 0),
      ),
      0,
      0,
    );
  }

  let adapterResults: readonly CustodyBalanceObservationResult[];

  try {
    adapterResults = await adapter.readBalances(
      validatedWorkUnit.bindings.map((item) => item.binding),
      { signal },
    );
  } catch {
    const adapterAttempts = 1;

    if (signal?.aborted) {
      return createResult(
        validatedWorkUnit.bindings.map((item) =>
          abortedOutcome(item.bindingId, adapterAttempts, 0),
        ),
        0,
        0,
      );
    }

    return createResult(
      validatedWorkUnit.bindings.map((item) =>
        failureOutcome({
          bindingId: item.bindingId,
          stage: "ADAPTER",
          code: "ADAPTER_CALL_FAILED",
          retryable: false,
          adapterAttempts,
          databaseAttempts: 0,
        }),
      ),
      0,
      validatedWorkUnit.bindings.length,
    );
  }

  if (signal?.aborted) {
    const adapterSuccesses = countAdapterSuccesses(adapterResults);

    return createResult(
      validatedWorkUnit.bindings.map((item) =>
        abortedOutcome(item.bindingId, 1, 0),
      ),
      adapterSuccesses,
      adapterResults.length - adapterSuccesses,
    );
  }

  const adapterValidationError = validateAdapterResults(
    validatedWorkUnit,
    adapterResults,
  );

  if (adapterValidationError) {
    const adapterSuccesses = countAdapterSuccesses(adapterResults);

    return createResult(
      validatedWorkUnit.bindings.map((item) =>
        failureOutcome({
          bindingId: item.bindingId,
          stage: "VALIDATION",
          code: adapterValidationError,
          retryable: false,
          adapterAttempts: 1,
          databaseAttempts: 0,
        }),
      ),
      adapterSuccesses,
      adapterResults.length - adapterSuccesses,
    );
  }

  const outcomes: CustodyBalanceObserverBindingOutcome[] = [];
  let adapterSuccesses = 0;
  let adapterFailures = 0;

  for (let index = 0; index < validatedWorkUnit.bindings.length; index += 1) {
    const item = validatedWorkUnit.bindings[index];

    if (!item) {
      throw new RangeError("balance_observer_work_item_missing");
    }

    if (signal?.aborted) {
      pushAbortedOutcomes(outcomes, validatedWorkUnit.bindings, index, 0, 0);
      break;
    }

    const adapterResult = adapterResults[index];

    if (!adapterResult) {
      adapterFailures += 1;
      outcomes.push(
        failureOutcome({
          bindingId: item.bindingId,
          stage: "VALIDATION",
          code: "ADAPTER_MISSING_RESULT",
          retryable: false,
          adapterAttempts: 1,
          databaseAttempts: 0,
        }),
      );
      continue;
    }

    const adapterResolution = await resolveAdapterResultForBinding({
      workUnit: validatedWorkUnit,
      item,
      adapter,
      initialResult: adapterResult,
      retryPolicy: safeRetryPolicy,
      retryRuntime,
      signal,
    });

    if (adapterResolution.kind === "ABORTED") {
      pushAbortedOutcomes(
        outcomes,
        validatedWorkUnit.bindings,
        index,
        adapterResolution.adapterAttempts,
        0,
      );
      break;
    }

    if (adapterResolution.kind === "FAILURE") {
      adapterFailures += adapterResolution.adapterFailureCount;
      outcomes.push(adapterResolution.outcome);
      continue;
    }

    adapterSuccesses += 1;

    if (
      !isIdentityAllowedByPolicy(
        validatedWorkUnit.identityPolicy,
        adapterResolution.result.observation.identity.kind,
      )
    ) {
      outcomes.push(
        failureOutcome({
          bindingId: item.bindingId,
          stage: "IDENTITY",
          code: "CONTENT_IDENTITY_NOT_ALLOWED",
          retryable: false,
          adapterAttempts: adapterResolution.adapterAttempts,
          databaseAttempts: 0,
        }),
      );
      continue;
    }

    const normalized = normalizeSuccessfulObservation(
      validatedWorkUnit,
      item,
      adapterResolution.result,
      adapterResolution.adapterAttempts,
    );

    if (!normalized.ok) {
      outcomes.push(normalized.outcome);
      continue;
    }

    if (signal?.aborted) {
      pushAbortedOutcomes(
        outcomes,
        validatedWorkUnit.bindings,
        index,
        adapterResolution.adapterAttempts,
        0,
      );
      break;
    }

    const dbResolution = await recordWithDatabaseRetry({
      item,
      commandClient,
      commandInput: normalized.commandInput,
      adapterAttempts: adapterResolution.adapterAttempts,
      retryPolicy: safeRetryPolicy,
      retryRuntime,
      signal,
    });

    if (!dbResolution.ok && dbResolution.stage === "ABORTED") {
      pushAbortedOutcomes(
        outcomes,
        validatedWorkUnit.bindings,
        index,
        adapterResolution.adapterAttempts,
        dbResolution.databaseAttempts,
      );
      break;
    }

    outcomes.push(dbResolution);

    if (signal?.aborted) {
      pushAbortedOutcomes(
        outcomes,
        validatedWorkUnit.bindings,
        index + 1,
        0,
        0,
      );
      break;
    }
  }

  return createResult(outcomes, adapterSuccesses, adapterFailures);
}

async function resolveAdapterResultForBinding({
  workUnit,
  item,
  adapter,
  initialResult,
  retryPolicy,
  retryRuntime,
  signal,
}: {
  workUnit: ValidatedWorkUnit;
  item: ValidatedBindingWorkItem;
  adapter: CustodyObservationAdapter;
  initialResult: CustodyBalanceObservationResult;
  retryPolicy: CustodyBalanceObserverRetryPolicy;
  retryRuntime: CustodyBalanceObserverRetryRuntime;
  signal?: AbortSignal;
}): Promise<AdapterResolution> {
  let adapterAttempts = 1;
  let currentResult = initialResult;

  while (true) {
    if (currentResult.ok) {
      return {
        kind: "SUCCESS",
        result: currentResult,
        adapterAttempts,
      };
    }

    const retryable = isRetryableAdapterError(currentResult.error.code);

    if (!retryable || !shouldRetryAttempt(retryPolicy, adapterAttempts)) {
      return {
        kind: "FAILURE",
        adapterFailureCount: 1,
        outcome: failureOutcome({
          bindingId: item.bindingId,
          stage: "ADAPTER",
          code: currentResult.error.code,
          retryable,
          adapterAttempts,
          databaseAttempts: 0,
          retryExhausted:
            retryable &&
            retryPolicy.mode === "BOUNDED_V1" &&
            adapterAttempts >= retryPolicy.maxAttempts,
        }),
      };
    }

    const delayDecision = calculateRetryDelayDecision({
      policy: retryPolicy,
      retryIndex: adapterAttempts,
      retryAfterMs: retryAfterForAdapterError(currentResult.error),
      randomInteger: retryRuntime.randomInteger,
    });

    if (delayDecision.retryDeferred) {
      return {
        kind: "FAILURE",
        adapterFailureCount: 1,
        outcome: failureOutcome({
          bindingId: item.bindingId,
          stage: "ADAPTER",
          code: currentResult.error.code,
          retryable,
          adapterAttempts,
          databaseAttempts: 0,
          retryDeferred: true,
          retryAfterMs: delayDecision.retryAfterMs,
        }),
      };
    }

    const waitResult = await waitForRetryDelay({
      delayMs: delayDecision.delayMs,
      signal,
      sleep: retryRuntime.sleep,
    });

    if (waitResult === "ABORTED") {
      return {
        kind: "ABORTED",
        adapterAttempts,
      };
    }

    adapterAttempts += 1;

    try {
      const retryResults = await adapter.readBalances([item.binding], {
        signal,
      });
      const singleResult = validateSingleAdapterRetryResult(
        workUnit,
        item,
        retryResults,
      );

      if (!singleResult) {
        return {
          kind: "FAILURE",
          adapterFailureCount: 1,
          outcome: failureOutcome({
            bindingId: item.bindingId,
            stage: "VALIDATION",
            code: "ADAPTER_RETRY_RESULT_INVALID",
            retryable: false,
            adapterAttempts,
            databaseAttempts: 0,
          }),
        };
      }

      currentResult = singleResult;
    } catch {
      if (signal?.aborted) {
        return {
          kind: "ABORTED",
          adapterAttempts,
        };
      }

      return {
        kind: "FAILURE",
        adapterFailureCount: 1,
        outcome: failureOutcome({
          bindingId: item.bindingId,
          stage: "ADAPTER",
          code: "ADAPTER_CALL_FAILED",
          retryable: false,
          adapterAttempts,
          databaseAttempts: 0,
        }),
      };
    }
  }
}

function validateSingleAdapterRetryResult(
  workUnit: ValidatedWorkUnit,
  item: ValidatedBindingWorkItem,
  results: readonly CustodyBalanceObservationResult[],
): CustodyBalanceObservationResult | null {
  if (results.length !== 1) {
    return null;
  }

  const result = results[0];

  if (!result || bindingResultKey(result.binding) !== bindingResultKey(item.binding)) {
    return null;
  }

  if (!result.ok) {
    return result;
  }

  if (bindingResultKey(result.observation.binding) !== bindingResultKey(item.binding)) {
    return null;
  }

  if (!providerRefsEqual(workUnit.provider, result.observation.provider)) {
    return null;
  }

  return result;
}

function normalizeSuccessfulObservation(
  workUnit: ValidatedWorkUnit,
  item: ValidatedBindingWorkItem,
  adapterResult: Extract<CustodyBalanceObservationResult, { ok: true }>,
  adapterAttempts: number,
):
  | {
      ok: true;
      commandInput: {
        bindingId: string;
        observerKind: string;
        observationKey: string;
        observedTotalUnits: string;
        observedAt: string;
        expectedCheckpointVersion: string;
      };
    }
  | {
      ok: false;
      outcome: CustodyBalanceObserverBindingOutcome;
    } {
  try {
    const observedTotalUnits = normalizeAtomicUnits(
      adapterResult.observation.observedTotalUnits,
    );
    const observedAt = normalizeUtcMicrosecondTimestamp(
      adapterResult.observation.observedAt,
    );
    const observationKey = createBalanceObservationKeyV1({
      providerCode: workUnit.provider.providerCode,
      bindingId: item.bindingId,
      assetId: item.assetId,
      observerKind: CUSTODY_BALANCE_OBSERVER_KIND_V1,
      identity: adapterResult.observation.identity,
      observedTotalUnits,
      observedAt,
    });

    return {
      ok: true,
      commandInput: {
        bindingId: item.bindingId,
        observerKind: CUSTODY_BALANCE_OBSERVER_KIND_V1,
        observationKey,
        observedTotalUnits,
        observedAt,
        expectedCheckpointVersion: item.expectedCheckpointVersion,
      },
    };
  } catch {
    return {
      ok: false,
      outcome: failureOutcome({
        bindingId: item.bindingId,
        stage: "VALIDATION",
        code: "INPUT_CONTRACT_INVALID",
        retryable: false,
        adapterAttempts,
        databaseAttempts: 0,
      }),
    };
  }
}

async function recordWithDatabaseRetry({
  item,
  commandClient,
  commandInput,
  adapterAttempts,
  retryPolicy,
  retryRuntime,
  signal,
}: {
  item: ValidatedBindingWorkItem;
  commandClient: CustodyBalanceObserverCommandClient;
  commandInput: Parameters<
    CustodyBalanceObserverCommandClient["recordBalanceObservationAndAdvanceCheckpoint"]
  >[0];
  adapterAttempts: number;
  retryPolicy: CustodyBalanceObserverRetryPolicy;
  retryRuntime: CustodyBalanceObserverRetryRuntime;
  signal?: AbortSignal;
}): Promise<CustodyBalanceObserverBindingOutcome> {
  let databaseAttempts = 0;

  while (true) {
    if (signal?.aborted) {
      return abortedOutcome(item.bindingId, adapterAttempts, databaseAttempts);
    }

    databaseAttempts += 1;

    try {
      const commandResult =
        await commandClient.recordBalanceObservationAndAdvanceCheckpoint(
          commandInput,
        );

      return {
        ok: true,
        bindingId: item.bindingId,
        observationCreated: commandResult.observationCreated,
        checkpointCreated: commandResult.checkpointCreated,
        checkpointAdvanced: commandResult.checkpointAdvanced,
        checkpointVersion: commandResult.checkpointVersion,
        adapterAttempts,
        databaseAttempts,
      };
    } catch (error) {
      const mapped =
        error instanceof CustodyBalanceObserverCommandError
          ? error
          : new CustodyBalanceObserverCommandError("DB_COMMAND_REJECTED", false);
      const retryable = isRetryableDatabaseError(mapped.code);

      if (!retryable || !shouldRetryAttempt(retryPolicy, databaseAttempts)) {
        return failureOutcome({
          bindingId: item.bindingId,
          stage: "DATABASE",
          code: mapped.code,
          retryable,
          adapterAttempts,
          databaseAttempts,
          retryExhausted:
            retryable &&
            retryPolicy.mode === "BOUNDED_V1" &&
            databaseAttempts >= retryPolicy.maxAttempts,
          requiresScopeRefresh: mapped.code === "CHECKPOINT_VERSION_CONFLICT",
        });
      }

      const delayDecision = calculateRetryDelayDecision({
        policy: retryPolicy,
        retryIndex: databaseAttempts,
        retryAfterMs: null,
        randomInteger: retryRuntime.randomInteger,
      });

      const waitResult = await waitForRetryDelay({
        delayMs: delayDecision.delayMs,
        signal,
        sleep: retryRuntime.sleep,
      });

      if (waitResult === "ABORTED") {
        return abortedOutcome(item.bindingId, adapterAttempts, databaseAttempts);
      }
    }
  }
}

function validateWorkUnit(
  workUnit: CustodyBalanceObserverWorkUnit,
): ValidatedWorkUnit {
  if (workUnit.identityPolicy !== "PRODUCTION" && workUnit.identityPolicy !== "LOCAL_MOCK") {
    throw new RangeError("balance_observer_identity_policy_invalid");
  }

  if (workUnit.bindings.length < 1) {
    throw new RangeError("balance_observer_bindings_empty");
  }

  const assetId = normalizeCanonicalUuid(workUnit.assetId);
  const bindingIds = new Set<string>();
  const bindingRefs = new Set<string>();
  const bindings = workUnit.bindings.map((item) => {
    const bindingId = normalizeCanonicalUuid(item.bindingId);
    const itemAssetId = normalizeCanonicalUuid(item.assetId);

    if (itemAssetId !== assetId) {
      throw new RangeError("balance_observer_asset_mismatch");
    }

    if (item.binding.providerCode !== workUnit.provider.providerCode) {
      throw new RangeError("balance_observer_provider_mismatch");
    }

    if (bindingIds.has(bindingId)) {
      throw new RangeError("balance_observer_duplicate_binding_id");
    }

    bindingIds.add(bindingId);

    const bindingRef = bindingResultKey(item.binding);

    if (bindingRefs.has(bindingRef)) {
      throw new RangeError("balance_observer_duplicate_binding_ref");
    }

    bindingRefs.add(bindingRef);

    return {
      ...item,
      bindingId,
      assetId: itemAssetId,
      expectedCheckpointVersion: normalizeCheckpointVersion(
        item.expectedCheckpointVersion,
      ),
    };
  });

  return {
    ...workUnit,
    assetId,
    bindings,
  };
}

function isIdentityAllowedByPolicy(
  identityPolicy: CustodyBalanceObserverIdentityPolicy,
  identityKind: CustodyBalanceObservationIdentity["kind"],
): boolean {
  if (identityPolicy === "LOCAL_MOCK") {
    return true;
  }

  return identityKind === "NATIVE" || identityKind === "CHECKPOINT";
}

function normalizeCheckpointVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !CHECKPOINT_VERSION_PATTERN.test(value) ||
    BigInt(value) > BIGINT_MAX
  ) {
    throw new RangeError("balance_observer_checkpoint_version_invalid");
  }

  return value;
}

function validateAdapterResults(
  workUnit: ValidatedWorkUnit,
  results: readonly CustodyBalanceObservationResult[],
): string | null {
  if (results.length < workUnit.bindings.length) {
    return "ADAPTER_MISSING_RESULT";
  }

  if (results.length > workUnit.bindings.length) {
    return "ADAPTER_RESULT_COUNT_MISMATCH";
  }

  const requestedKeys = workUnit.bindings.map((item) =>
    bindingResultKey(item.binding),
  );
  const requestedKeySet = new Set(requestedKeys);
  const resultKeys = results.map((result) => bindingResultKey(result.binding));
  const resultKeySet = new Set<string>();

  for (const key of resultKeys) {
    if (resultKeySet.has(key)) {
      return "ADAPTER_DUPLICATE_BINDING";
    }

    resultKeySet.add(key);

    if (!requestedKeySet.has(key)) {
      return "ADAPTER_UNEXPECTED_RESULT";
    }
  }

  for (const key of requestedKeys) {
    if (!resultKeySet.has(key)) {
      return "ADAPTER_MISSING_RESULT";
    }
  }

  for (let index = 0; index < requestedKeys.length; index += 1) {
    if (requestedKeys[index] !== resultKeys[index]) {
      return "ADAPTER_RESULT_ORDER_MISMATCH";
    }
  }

  for (const result of results) {
    if (!result.ok) {
      continue;
    }

    if (bindingResultKey(result.binding) !== bindingResultKey(result.observation.binding)) {
      return "ADAPTER_BINDING_MISMATCH";
    }

    if (!providerRefsEqual(workUnit.provider, result.observation.provider)) {
      return "ADAPTER_PROVIDER_MISMATCH";
    }
  }

  return null;
}

function providerRefsEqual(
  expected: CustodyProviderRef,
  actual: CustodyProviderRef,
): boolean {
  return (
    expected.providerCode === actual.providerCode &&
    expected.providerType === actual.providerType &&
    expected.capabilities.length === actual.capabilities.length &&
    expected.capabilities.every(
      (capability, index) => capability === actual.capabilities[index],
    )
  );
}

function bindingResultKey(binding: CustodyAccountBindingRef): string {
  return [
    binding.providerCode,
    binding.bindingKey,
    binding.assetCode,
    binding.accountRole,
  ].join("\u001f");
}

function countAdapterSuccesses(
  results: readonly CustodyBalanceObservationResult[],
): number {
  return results.filter((result) => result.ok).length;
}

function isRetryableAdapterError(code: string): boolean {
  return (
    code === "TIMEOUT" ||
    code === "RATE_LIMITED" ||
    code === "PROVIDER_UNAVAILABLE"
  );
}

function retryAfterForAdapterError(error: {
  code: string;
  retryAfterMs: number | null;
}): number | null {
  if (error.code === "RATE_LIMITED" || error.code === "PROVIDER_UNAVAILABLE") {
    return error.retryAfterMs;
  }

  return null;
}

function isRetryableDatabaseError(code: string): boolean {
  return (
    code === "DB_CONNECTION_FAILED" ||
    code === "DB_TIMEOUT" ||
    code === "DB_LOCK_TIMEOUT" ||
    code === "DB_UNAVAILABLE"
  );
}

function failureOutcome({
  bindingId,
  stage,
  code,
  retryable,
  adapterAttempts,
  databaseAttempts,
  retryExhausted = false,
  retryDeferred = false,
  retryAfterMs = null,
  requiresScopeRefresh = false,
}: {
  bindingId: string;
  stage: "ADAPTER" | "VALIDATION" | "IDENTITY" | "DATABASE";
  code: string;
  retryable: boolean;
  adapterAttempts: number;
  databaseAttempts: number;
  retryExhausted?: boolean;
  retryDeferred?: boolean;
  retryAfterMs?: number | null;
  requiresScopeRefresh?: boolean;
}): CustodyBalanceObserverBindingOutcome {
  return {
    ok: false,
    bindingId,
    stage,
    code,
    retryable,
    adapterAttempts,
    databaseAttempts,
    retryExhausted,
    retryDeferred,
    retryAfterMs,
    requiresScopeRefresh,
  };
}

function abortedOutcome(
  bindingId: string,
  adapterAttempts: number,
  databaseAttempts: number,
): CustodyBalanceObserverBindingOutcome {
  return {
    ok: false,
    bindingId,
    stage: "ABORTED",
    code: "ABORTED",
    retryable: true,
    adapterAttempts,
    databaseAttempts,
    retryExhausted: false,
    retryDeferred: false,
    retryAfterMs: null,
    requiresScopeRefresh: false,
  };
}

function pushAbortedOutcomes(
  outcomes: CustodyBalanceObserverBindingOutcome[],
  bindings: readonly ValidatedBindingWorkItem[],
  startIndex: number,
  firstAdapterAttempts: number,
  firstDatabaseAttempts: number,
): void {
  for (let index = startIndex; index < bindings.length; index += 1) {
    const item = bindings[index];

    if (item) {
      outcomes.push(
        abortedOutcome(
          item.bindingId,
          index === startIndex ? firstAdapterAttempts : 0,
          index === startIndex ? firstDatabaseAttempts : 0,
        ),
      );
    }
  }
}

function createResult(
  outcomes: readonly CustodyBalanceObserverBindingOutcome[],
  adapterSuccesses: number,
  adapterFailures: number,
): CustodyBalanceObserverWorkResult {
  const summary = summarize(outcomes, adapterSuccesses, adapterFailures);

  assertSummary(outcomes, summary);

  return {
    outcomes,
    summary,
  };
}

function summarize(
  outcomes: readonly CustodyBalanceObserverBindingOutcome[],
  adapterSuccesses: number,
  adapterFailures: number,
): CustodyBalanceObserverWorkSummary {
  const successes = outcomes.filter((outcome) => outcome.ok);
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const adapterAttempts = outcomes.reduce(
    (sum, outcome) => sum + outcome.adapterAttempts,
    0,
  );
  const databaseAttempts = outcomes.reduce(
    (sum, outcome) => sum + outcome.databaseAttempts,
    0,
  );

  return {
    requestedBindings: outcomes.length,
    adapterSuccesses,
    adapterFailures,
    databaseAttempts,
    persistedObservations: successes.filter(
      (outcome) => outcome.ok && outcome.observationCreated,
    ).length,
    replayedObservations: successes.filter(
      (outcome) => outcome.ok && !outcome.observationCreated,
    ).length,
    checkpointsCreated: successes.filter(
      (outcome) => outcome.ok && outcome.checkpointCreated,
    ).length,
    checkpointsAdvanced: successes.filter(
      (outcome) => outcome.ok && outcome.checkpointAdvanced,
    ).length,
    checkpointNoops: successes.filter(
      (outcome) =>
        outcome.ok && !outcome.checkpointCreated && !outcome.checkpointAdvanced,
    ).length,
    failedBindings: failures.filter(
      (outcome) => !outcome.ok && outcome.stage !== "ABORTED",
    ).length,
    abortedBindings: failures.filter(
      (outcome) => !outcome.ok && outcome.stage === "ABORTED",
    ).length,
    adapterAttempts,
    adapterRetryAttempts: outcomes.reduce(
      (sum, outcome) => sum + Math.max(0, outcome.adapterAttempts - 1),
      0,
    ),
    databaseRetryAttempts: outcomes.reduce(
      (sum, outcome) => sum + Math.max(0, outcome.databaseAttempts - 1),
      0,
    ),
    retryExhaustedBindings: failures.filter(
      (outcome) => !outcome.ok && outcome.retryExhausted,
    ).length,
    retryDeferredBindings: failures.filter(
      (outcome) => !outcome.ok && outcome.retryDeferred,
    ).length,
    scopeRefreshRequiredBindings: failures.filter(
      (outcome) => !outcome.ok && outcome.requiresScopeRefresh,
    ).length,
    timeoutFailures: failures.filter(
      (outcome) => !outcome.ok && (outcome.code === "TIMEOUT" || outcome.code === "DB_TIMEOUT"),
    ).length,
    lockTimeoutFailures: failures.filter(
      (outcome) => !outcome.ok && outcome.code === "DB_LOCK_TIMEOUT",
    ).length,
    unavailableFailures: failures.filter(
      (outcome) =>
        !outcome.ok &&
        (outcome.code === "PROVIDER_UNAVAILABLE" ||
          outcome.code === "DB_UNAVAILABLE" ||
          outcome.code === "DB_CONNECTION_FAILED"),
    ).length,
  };
}

function assertSummary(
  outcomes: readonly CustodyBalanceObserverBindingOutcome[],
  summary: CustodyBalanceObserverWorkSummary,
): void {
  const successCount = outcomes.filter((outcome) => outcome.ok).length;
  const failureCount = outcomes.length - successCount;
  const bindingsWithDbAttempts = outcomes.filter(
    (outcome) => outcome.databaseAttempts > 0,
  ).length;

  if (
    summary.requestedBindings !== outcomes.length ||
    summary.requestedBindings !== successCount + failureCount ||
    bindingsWithDbAttempts > summary.adapterSuccesses ||
    summary.persistedObservations + summary.replayedObservations !==
      successCount ||
    summary.failedBindings + summary.abortedBindings !== failureCount ||
    summary.adapterRetryAttempts < 0 ||
    summary.databaseRetryAttempts < 0
  ) {
    throw new RangeError("balance_observer_summary_invariant_invalid");
  }
}
