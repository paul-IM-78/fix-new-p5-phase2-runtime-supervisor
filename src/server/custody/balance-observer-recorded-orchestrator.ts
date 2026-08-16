import "server-only";

import {
  runCustodyBalanceObserverOneShot,
  type CustodyBalanceObserverLifecycleReporter,
  type CustodyBalanceObserverOneShotResult,
  type CustodyBalanceObserverOneShotStatus,
  type CustodyBalanceObserverOrchestratorBindingOutcome,
  type CustodyBalanceObserverOrchestratorScopeOutcome,
  type RunCustodyBalanceObserverOneShotInput,
} from "./balance-observer-orchestrator";
import type {
  BeginBalanceObserverRunInput,
  CustodyBalanceObserverDurableRunSummary,
  CustodyBalanceObserverRunLedgerClient,
  CustodyBalanceObserverBindingFailure,
  FinalizeBalanceObserverRunResult,
  RecordBalanceObserverScopeOutcomeInput,
} from "./balance-observer-run-ledger-client";

export type RunRecordedCustodyBalanceObserverOneShotInput =
  Omit<RunCustodyBalanceObserverOneShotInput, "identityPolicy"> & {
    identityPolicy: BeginBalanceObserverRunInput["identityPolicy"];
    runLedgerClient: CustodyBalanceObserverRunLedgerClient;
    runKey: string;
    triggerSource: BeginBalanceObserverRunInput["triggerSource"];
    invocationContractVersion: BeginBalanceObserverRunInput["invocationContractVersion"];
  };

export type RecordedCustodyBalanceObserverOneShotResult = {
  execution:
    | "EXECUTED"
    | "NO_EXECUTION_REQUIRES_RECOVERY"
    | "INCOMPLETE";
  code:
    | "RECORDED_BEGIN_FAILED"
    | "RECORDED_EXISTING_RUN_REQUIRES_RECOVERY"
    | "RECORDED_SCOPE_PERSIST_FAILED"
    | "RECORDED_FINALIZATION_FAILED"
    | "RECORDED_CLOSE_FAILED"
    | null;
  runId: string | null;
  durableStatus: CustodyBalanceObserverOneShotStatus | "RUNNING" | null;
  durableVersion: string | null;
  oneShot: CustodyBalanceObserverOneShotResult | null;
};

export async function runRecordedCustodyBalanceObserverOneShot(
  input: RunRecordedCustodyBalanceObserverOneShotInput,
): Promise<RecordedCustodyBalanceObserverOneShotResult> {
  const closeTargets = [input.scopeClient, input.commandClient];
  let oneShotStarted = false;
  let result: RecordedCustodyBalanceObserverOneShotResult = incomplete(
    "RECORDED_BEGIN_FAILED",
    null,
    null,
    null,
    null,
  );

  try {
    let begin;
    try {
      begin = await input.runLedgerClient.beginBalanceObserverRun({
        runKey: input.runKey,
        triggerSource: input.triggerSource,
        identityPolicy: input.identityPolicy,
        invocationContractVersion: input.invocationContractVersion,
      });
    } catch {
      result = incomplete("RECORDED_BEGIN_FAILED", null, null, null, null);
      return result;
    }

    if (!begin.created) {
      result = incomplete(
        "RECORDED_EXISTING_RUN_REQUIRES_RECOVERY",
        begin.runId,
        begin.status,
        begin.version,
        null,
      );
      return result;
    }

    let reporterFailed = false;
    const reportedDiscoveryIndexes = new Set<number>();
    const reporter: CustodyBalanceObserverLifecycleReporter = {
      async onScopeFinalized(outcome) {
        try {
          await input.runLedgerClient.recordBalanceObserverScopeOutcome(
            toScopeRecord(begin.runId, outcome),
          );
          reportedDiscoveryIndexes.add(outcome.discoveryIndex);
        } catch {
          reporterFailed = true;
          throw new Error("recorded_scope_persistence_failed");
        }
      },
    };

    oneShotStarted = true;
    const oneShot = await runCustodyBalanceObserverOneShot({
      ...input,
      lifecycleReporter: reporter,
    });

    if (reporterFailed || !allOutcomesWereReported(oneShot, reportedDiscoveryIndexes)) {
      result = incomplete(
        "RECORDED_SCOPE_PERSIST_FAILED",
        begin.runId,
        "RUNNING",
        begin.version,
        oneShot,
      );
      return result;
    }

    let finalized: FinalizeBalanceObserverRunResult;
    try {
      finalized = await input.runLedgerClient.finalizeBalanceObserverRun({
        runId: begin.runId,
        expectedVersion: begin.version,
        terminalStatus: oneShot.status,
        terminalCode: oneShot.code,
        summary: toDurableSummary(oneShot),
      });
    } catch {
      result = incomplete(
        "RECORDED_FINALIZATION_FAILED",
        begin.runId,
        "RUNNING",
        begin.version,
        oneShot,
      );
      return result;
    }

    result = {
      execution: "EXECUTED",
      code: null,
      runId: finalized.runId,
      durableStatus: finalized.status,
      durableVersion: finalized.version,
      oneShot,
    };
    return result;
  } finally {
    const closeFailed = oneShotStarted
      ? await closeLedger(input.runLedgerClient)
      : await closeAll(closeTargets, input.runLedgerClient);
    if (closeFailed && result.code === null) {
      result.code = "RECORDED_CLOSE_FAILED";
    }
  }
}

function incomplete(
  code: Exclude<RecordedCustodyBalanceObserverOneShotResult["code"], null>,
  runId: string | null,
  durableStatus: RecordedCustodyBalanceObserverOneShotResult["durableStatus"],
  durableVersion: string | null,
  oneShot: CustodyBalanceObserverOneShotResult | null,
): RecordedCustodyBalanceObserverOneShotResult {
  return {
    execution: code === "RECORDED_EXISTING_RUN_REQUIRES_RECOVERY"
      ? "NO_EXECUTION_REQUIRES_RECOVERY"
      : "INCOMPLETE",
    code,
    runId,
    durableStatus,
    durableVersion,
    oneShot,
  };
}

function allOutcomesWereReported(
  oneShot: CustodyBalanceObserverOneShotResult,
  reportedDiscoveryIndexes: ReadonlySet<number>,
): boolean {
  return oneShot.outcomes.every((outcome) =>
    reportedDiscoveryIndexes.has(outcome.discoveryIndex),
  );
}

function toScopeRecord(
  runId: string,
  outcome: CustodyBalanceObserverOrchestratorScopeOutcome,
): RecordBalanceObserverScopeOutcomeInput {
  const failures = outcome.bindings.flatMap((binding, bindingOrder) =>
    binding.ok ? [] : [toBindingFailure(binding, bindingOrder)],
  );
  const failureCount = failures.filter((failure) => failure.stage !== "ABORTED").length;
  const abortCount = failures.length - failureCount;

  return {
    runId,
    discoveryIndex: toSafeCount(outcome.discoveryIndex),
    providerId: outcome.providerId,
    assetId: outcome.assetId,
    scopeStatus: outcome.status,
    bindingSuccessCount: outcome.bindings.filter((binding) => binding.ok).length,
    bindingFailureCount: failureCount,
    bindingAbortCount: abortCount,
    refreshRequested: outcome.refresh.requested,
    refreshAttempted: outcome.refresh.attempted,
    refreshSucceeded: outcome.refresh.succeeded,
    refreshFailed: outcome.refresh.failed,
    noLongerEligibleCount: toSafeCount(outcome.refresh.noLongerEligibleBindings),
    scopeCode: scopeCode(outcome),
    failures,
  };
}

function toBindingFailure(
  binding: Exclude<CustodyBalanceObserverOrchestratorBindingOutcome, { ok: true }>,
  bindingOrder: number,
): CustodyBalanceObserverBindingFailure {
  return {
    bindingId: binding.bindingId,
    bindingOrder: toSafeCount(bindingOrder),
    stage: binding.stage,
    code: binding.code,
    retryable: binding.retryable,
    adapterAttempts: toSafeCount(binding.adapterAttempts),
    databaseAttempts: toSafeCount(binding.databaseAttempts),
    retryExhausted: binding.retryExhausted,
    retryDeferred: binding.retryDeferred,
    requiresScopeRefresh: binding.requiresScopeRefresh,
  };
}

function scopeCode(
  outcome: CustodyBalanceObserverOrchestratorScopeOutcome,
): string | null {
  if (outcome.status === "SUCCEEDED") return null;
  return outcome.bindings.find((binding) => !binding.ok)?.code ?? "ORCHESTRATOR_ABORTED";
}

function toDurableSummary(
  result: CustodyBalanceObserverOneShotResult,
): CustodyBalanceObserverDurableRunSummary {
  const summary = result.summary;
  return {
    pagesRead: toSafeCount(summary.pagesRead),
    scopesDiscovered: toSafeCount(summary.scopesDiscovered),
    providersDiscovered: toSafeCount(summary.providersDiscovered),
    bindingsDiscovered: toSafeCount(summary.bindingsDiscovered),
    scopesStarted: toSafeCount(summary.scopesStarted),
    scopesCompleted: toSafeCount(summary.scopesCompleted),
    scopesFailed: toSafeCount(summary.scopesFailed),
    scopesAborted: toSafeCount(summary.scopesAborted),
    bindingsSucceeded: toSafeCount(summary.bindingsSucceeded),
    bindingsFailed: toSafeCount(summary.bindingsFailed),
    bindingsAborted: toSafeCount(summary.bindingsAborted),
    adapterFactoryCalls: toSafeCount(summary.adapterFactoryCalls),
    adapterFactoryFailures: toSafeCount(summary.adapterFactoryFailures),
    scopeRefreshRequested: toSafeCount(summary.scopeRefreshRequested),
    scopeRefreshAttempted: toSafeCount(summary.scopeRefreshAttempted),
    scopeRefreshSucceeded: toSafeCount(summary.scopeRefreshSucceeded),
    scopeRefreshFailed: toSafeCount(summary.scopeRefreshFailed),
    scopeNoLongerEligible: toSafeCount(summary.scopeNoLongerEligible),
    scopeReadAttempts: toSafeCount(summary.scopeReadAttempts),
    scopeReadRetryAttempts: toSafeCount(summary.scopeReadRetryAttempts),
    workerAdapterAttempts: toSafeCount(summary.workerAdapterAttempts),
    workerDatabaseAttempts: toSafeCount(summary.workerDatabaseAttempts),
    workerAdapterRetryAttempts: toSafeCount(summary.workerAdapterRetryAttempts),
    workerDatabaseRetryAttempts: toSafeCount(summary.workerDatabaseRetryAttempts),
    clientCloseAttempts: toSafeCount(summary.clientCloseAttempts),
    clientCloseFailures: toSafeCount(summary.clientCloseFailures),
  };
}

function toSafeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("recorded_observer_count_invalid");
  }
  return value;
}

async function closeAll(
  clients: readonly { close(): Promise<void> }[],
  runLedgerClient: CustodyBalanceObserverRunLedgerClient,
): Promise<boolean> {
  let failed = false;
  for (const client of [...clients, runLedgerClient]) {
    try {
      await client.close();
    } catch {
      failed = true;
    }
  }
  return failed;
}

async function closeLedger(
  runLedgerClient: CustodyBalanceObserverRunLedgerClient,
): Promise<boolean> {
  try {
    await runLedgerClient.close();
    return false;
  } catch {
    return true;
  }
}
