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
import type {
  CustodyAccountBindingRef,
  CustodyBalanceObservationIdentity,
  CustodyBalanceObservationResult,
  CustodyObservationAdapter,
  CustodyProviderRef,
} from "./provider-observation-contract";

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
    }
  | {
      ok: false;
      bindingId: string;
      stage: "ADAPTER" | "VALIDATION" | "IDENTITY" | "DATABASE" | "ABORTED";
      code: string;
      retryable: boolean;
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
};

export type CustodyBalanceObserverWorkResult = {
  outcomes: readonly CustodyBalanceObserverBindingOutcome[];
  summary: CustodyBalanceObserverWorkSummary;
};

export type RunCustodyBalanceObserverWorkUnitInput = {
  workUnit: CustodyBalanceObserverWorkUnit;
  adapter: CustodyObservationAdapter;
  commandClient: CustodyBalanceObserverCommandClient;
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

const BIGINT_MAX = BigInt("9223372036854775807");
const CHECKPOINT_VERSION_PATTERN = /^(0|[1-9][0-9]{0,18})$/;

export async function runCustodyBalanceObserverWorkUnit({
  workUnit,
  adapter,
  commandClient,
  signal,
}: RunCustodyBalanceObserverWorkUnitInput): Promise<CustodyBalanceObserverWorkResult> {
  const validatedWorkUnit = validateWorkUnit(workUnit);

  if (signal?.aborted) {
    return createResult(
      validatedWorkUnit.bindings.map((item) => abortedOutcome(item.bindingId)),
      0,
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
    if (signal?.aborted) {
      return createResult(
        validatedWorkUnit.bindings.map((item) => abortedOutcome(item.bindingId)),
        0,
        0,
        0,
      );
    }

    return createResult(
      validatedWorkUnit.bindings.map((item) =>
        failureOutcome(item.bindingId, "ADAPTER", "ADAPTER_UNEXPECTED_RESULT", false),
      ),
      0,
      0,
      0,
    );
  }

  const adapterSuccesses = countAdapterSuccesses(adapterResults);
  const adapterFailures = adapterResults.length - adapterSuccesses;

  if (signal?.aborted) {
    return createResult(
      validatedWorkUnit.bindings.map((item) => abortedOutcome(item.bindingId)),
      adapterSuccesses,
      adapterFailures,
      0,
    );
  }

  const adapterValidationError = validateAdapterResults(
    validatedWorkUnit,
    adapterResults,
  );

  if (adapterValidationError) {
    return createResult(
      validatedWorkUnit.bindings.map((item) =>
        failureOutcome(item.bindingId, "VALIDATION", adapterValidationError, false),
      ),
      adapterSuccesses,
      adapterFailures,
      0,
    );
  }

  const outcomes: CustodyBalanceObserverBindingOutcome[] = [];
  let databaseAttempts = 0;

  for (let index = 0; index < validatedWorkUnit.bindings.length; index += 1) {
    const item = validatedWorkUnit.bindings[index];

    if (!item) {
      throw new RangeError("balance_observer_work_item_missing");
    }

    if (signal?.aborted) {
      pushAbortedOutcomes(outcomes, validatedWorkUnit.bindings, index);
      break;
    }

    const adapterResult = adapterResults[index];

    if (!adapterResult) {
      outcomes.push(
        failureOutcome(item.bindingId, "VALIDATION", "ADAPTER_MISSING_RESULT", false),
      );
      continue;
    }

    if (!adapterResult.ok) {
      outcomes.push(
        failureOutcome(
          item.bindingId,
          "ADAPTER",
          adapterResult.error.code,
          adapterResult.error.retryable,
        ),
      );
      continue;
    }

    if (
      !isIdentityAllowedByPolicy(
        validatedWorkUnit.identityPolicy,
        adapterResult.observation.identity.kind,
      )
    ) {
      outcomes.push(
        failureOutcome(
          item.bindingId,
          "IDENTITY",
          "CONTENT_IDENTITY_NOT_ALLOWED",
          false,
        ),
      );
      continue;
    }

    let observedTotalUnits: string;
    let observedAt: string;
    let observationKey: string;

    try {
      observedTotalUnits = normalizeAtomicUnits(
        adapterResult.observation.observedTotalUnits,
      );
      observedAt = normalizeUtcMicrosecondTimestamp(
        adapterResult.observation.observedAt,
      );
      observationKey = createBalanceObservationKeyV1({
        providerCode: validatedWorkUnit.provider.providerCode,
        bindingId: item.bindingId,
        assetId: item.assetId,
        observerKind: CUSTODY_BALANCE_OBSERVER_KIND_V1,
        identity: adapterResult.observation.identity,
        observedTotalUnits,
        observedAt,
      });
    } catch {
      outcomes.push(
        failureOutcome(item.bindingId, "VALIDATION", "INPUT_CONTRACT_INVALID", false),
      );
      continue;
    }

    if (signal?.aborted) {
      pushAbortedOutcomes(outcomes, validatedWorkUnit.bindings, index);
      break;
    }

    databaseAttempts += 1;

    try {
      const commandResult =
        await commandClient.recordBalanceObservationAndAdvanceCheckpoint({
          bindingId: item.bindingId,
          observerKind: CUSTODY_BALANCE_OBSERVER_KIND_V1,
          observationKey,
          observedTotalUnits,
          observedAt,
          expectedCheckpointVersion: item.expectedCheckpointVersion,
        });

      outcomes.push({
        ok: true,
        bindingId: item.bindingId,
        observationCreated: commandResult.observationCreated,
        checkpointCreated: commandResult.checkpointCreated,
        checkpointAdvanced: commandResult.checkpointAdvanced,
        checkpointVersion: commandResult.checkpointVersion,
      });

      if (signal?.aborted) {
        pushAbortedOutcomes(outcomes, validatedWorkUnit.bindings, index + 1);
        break;
      }
    } catch (error) {
      const mapped =
        error instanceof CustodyBalanceObserverCommandError
          ? error
          : new CustodyBalanceObserverCommandError("DB_COMMAND_REJECTED", false);

      outcomes.push(
        failureOutcome(item.bindingId, "DATABASE", mapped.code, mapped.retryable),
      );
    }
  }

  return createResult(
    outcomes,
    adapterSuccesses,
    adapterFailures,
    databaseAttempts,
  );
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

function failureOutcome(
  bindingId: string,
  stage: "ADAPTER" | "VALIDATION" | "IDENTITY" | "DATABASE",
  code: string,
  retryable: boolean,
): CustodyBalanceObserverBindingOutcome {
  return {
    ok: false,
    bindingId,
    stage,
    code,
    retryable,
  };
}

function abortedOutcome(bindingId: string): CustodyBalanceObserverBindingOutcome {
  return {
    ok: false,
    bindingId,
    stage: "ABORTED",
    code: "ABORTED",
    retryable: true,
  };
}

function pushAbortedOutcomes(
  outcomes: CustodyBalanceObserverBindingOutcome[],
  bindings: readonly ValidatedBindingWorkItem[],
  startIndex: number,
): void {
  for (let index = startIndex; index < bindings.length; index += 1) {
    const item = bindings[index];

    if (item) {
      outcomes.push(abortedOutcome(item.bindingId));
    }
  }
}

function createResult(
  outcomes: readonly CustodyBalanceObserverBindingOutcome[],
  adapterSuccesses: number,
  adapterFailures: number,
  databaseAttempts: number,
): CustodyBalanceObserverWorkResult {
  const summary = summarize(outcomes, adapterSuccesses, adapterFailures, databaseAttempts);

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
  databaseAttempts: number,
): CustodyBalanceObserverWorkSummary {
  const successes = outcomes.filter((outcome) => outcome.ok);
  const failures = outcomes.filter((outcome) => !outcome.ok);

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
  };
}

function assertSummary(
  outcomes: readonly CustodyBalanceObserverBindingOutcome[],
  summary: CustodyBalanceObserverWorkSummary,
): void {
  const successCount = outcomes.filter((outcome) => outcome.ok).length;
  const failureCount = outcomes.length - successCount;

  if (
    summary.requestedBindings !== outcomes.length ||
    summary.requestedBindings !== successCount + failureCount ||
    summary.databaseAttempts > summary.adapterSuccesses ||
    summary.persistedObservations + summary.replayedObservations !==
      successCount ||
    summary.failedBindings + summary.abortedBindings !== failureCount
  ) {
    throw new RangeError("balance_observer_summary_invariant_invalid");
  }
}
