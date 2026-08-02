import "server-only";

import {
  calculateRetryDelayDecision,
  waitForRetryDelay,
  type CustodyBalanceObserverRetryPolicy,
  type CustodyBalanceObserverRetryRandomInteger,
  type CustodyBalanceObserverRetrySleep,
} from "./balance-observer-retry";
import type {
  CustodyBalanceObserverCommandClient,
} from "./balance-observer-command-client";
import {
  runCustodyBalanceObserverWorkUnit,
  type CustodyBalanceObserverBindingOutcome as WorkerBindingOutcome,
  type CustodyBalanceObserverIdentityPolicy,
  type CustodyBalanceObserverRetryRuntime,
  type CustodyBalanceObserverWorkResult,
  type CustodyBalanceObserverWorkSummary,
} from "./balance-observer-worker";
import {
  CustodyBalanceObserverScopeClientError,
  type CustodyBalanceObserverDiscoveredBinding,
  type CustodyBalanceObserverDiscoveredScope,
  type CustodyBalanceObserverScopeClient,
  type CustodyBalanceObserverScopeCursor,
  type CustodyBalanceObserverScopePage,
} from "./balance-observer-scope-client";
import type {
  CustodyObservationAdapter,
  CustodyObservationAdapterFactory,
  CustodyProviderRef,
} from "./provider-observation-contract";

export type CustodyBalanceObserverScopeReadRetryPolicy =
  | {
      mode: "DISABLED";
    }
  | {
      mode: "BOUNDED_V1";
      maxAttempts: number;
      baseDelayMs: number;
      maxDelayMs: number;
      jitterRatio: number;
    };

export type CustodyBalanceObserverScopeReadRetryRuntime = {
  randomInteger?: (minimum: number, maximum: number) => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

export type CustodyBalanceObserverConcurrencyPolicy = {
  providerConcurrency: number;
};

export type CustodyBalanceObserverOneShotStatus =
  | "COMPLETED"
  | "PARTIAL"
  | "ABORTED"
  | "FAILED_DISCOVERY"
  | "FAILED_CLEANUP";

export type CustodyBalanceObserverOrchestratorCode =
  | "ORCHESTRATOR_INPUT_INVALID"
  | "ORCHESTRATOR_ABORTED"
  | "ORCHESTRATOR_SCOPE_DISCOVERY_FAILED"
  | "ORCHESTRATOR_SCOPE_PAGE_INVALID"
  | "ORCHESTRATOR_SCOPE_CURSOR_LOOP"
  | "ORCHESTRATOR_DISCOVERY_LIMIT_EXCEEDED"
  | "ORCHESTRATOR_SCOPE_DUPLICATE"
  | "ORCHESTRATOR_PROVIDER_REF_INVALID"
  | "ADAPTER_FACTORY_FAILED"
  | "ADAPTER_FACTORY_RESULT_INVALID"
  | "WORKER_RESULT_INVALID"
  | "WORKER_EXECUTION_FAILED"
  | "SCOPE_REFRESH_FAILED"
  | "SCOPE_NO_LONGER_ELIGIBLE"
  | "ORCHESTRATOR_CLIENT_CLOSE_FAILED";

export class CustodyBalanceObserverOrchestratorError extends Error {
  readonly code: CustodyBalanceObserverOrchestratorCode;
  readonly retryable: boolean;

  constructor(
    code: CustodyBalanceObserverOrchestratorCode,
    retryable: boolean,
  ) {
    super("custody_balance_observer_orchestrator_failed");
    this.name = "CustodyBalanceObserverOrchestratorError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type CustodyBalanceObserverOrchestratorBindingOutcome =
  | {
      ok: true;
      bindingId: string;
      status: "SUCCEEDED";
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
      status: "FAILED" | "ABORTED";
      stage:
        | "ADAPTER"
        | "VALIDATION"
        | "IDENTITY"
        | "DATABASE"
        | "REFRESH"
        | "FACTORY"
        | "WORKER"
        | "ABORTED";
      code: string;
      retryable: boolean;
      adapterAttempts: number;
      databaseAttempts: number;
      retryExhausted: boolean;
      retryDeferred: boolean;
      retryAfterMs: number | null;
      requiresScopeRefresh: boolean;
    };

export type CustodyBalanceObserverOrchestratorScopeOutcome = {
  discoveryIndex: number;
  providerId: string;
  providerCode: string;
  assetId: string;
  assetCode: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED" | "ABORTED";
  bindings: readonly CustodyBalanceObserverOrchestratorBindingOutcome[];
  refresh: {
    requested: boolean;
    attempted: boolean;
    succeeded: boolean;
    failed: boolean;
    noLongerEligibleBindings: number;
  };
};

export type CustodyBalanceObserverOneShotSummary = {
  pagesRead: number;
  scopesDiscovered: number;
  providersDiscovered: number;
  bindingsDiscovered: number;
  scopesStarted: number;
  scopesCompleted: number;
  scopesFailed: number;
  scopesAborted: number;
  bindingsSucceeded: number;
  bindingsFailed: number;
  bindingsAborted: number;
  adapterFactoryCalls: number;
  adapterFactoryFailures: number;
  scopeRefreshRequested: number;
  scopeRefreshAttempted: number;
  scopeRefreshSucceeded: number;
  scopeRefreshFailed: number;
  scopeNoLongerEligible: number;
  scopeReadAttempts: number;
  scopeReadRetryAttempts: number;
  workerAdapterAttempts: number;
  workerDatabaseAttempts: number;
  workerAdapterRetryAttempts: number;
  workerDatabaseRetryAttempts: number;
  clientCloseAttempts: number;
  clientCloseFailures: number;
};

export type CustodyBalanceObserverOneShotResult = {
  status: CustodyBalanceObserverOneShotStatus;
  code: CustodyBalanceObserverOrchestratorCode | null;
  outcomes: readonly CustodyBalanceObserverOrchestratorScopeOutcome[];
  summary: CustodyBalanceObserverOneShotSummary;
};

export type CustodyBalanceObserverOrchestratorRuntime = {
  runWorkUnit?: typeof runCustodyBalanceObserverWorkUnit;
};

export type RunCustodyBalanceObserverOneShotInput = {
  scopeClient: CustodyBalanceObserverScopeClient;
  commandClient: CustodyBalanceObserverCommandClient;
  adapterFactory: CustodyObservationAdapterFactory;
  identityPolicy: CustodyBalanceObserverIdentityPolicy;
  workerRetryPolicy?: CustodyBalanceObserverRetryPolicy;
  scopeReadRetryPolicy?: CustodyBalanceObserverScopeReadRetryPolicy;
  scopeReadRetryRuntime?: CustodyBalanceObserverScopeReadRetryRuntime;
  workerRetryRuntime?: CustodyBalanceObserverRetryRuntime;
  concurrencyPolicy?: CustodyBalanceObserverConcurrencyPolicy;
  pageLimit?: number;
  maxDiscoveryPages?: number;
  runtime?: CustodyBalanceObserverOrchestratorRuntime;
  signal?: AbortSignal;
};

type ValidatedRunInput = {
  scopeClient: CustodyBalanceObserverScopeClient;
  commandClient: CustodyBalanceObserverCommandClient;
  adapterFactory: CustodyObservationAdapterFactory;
  identityPolicy: CustodyBalanceObserverIdentityPolicy;
  workerRetryPolicy?: CustodyBalanceObserverRetryPolicy;
  scopeReadRetryPolicy: CustodyBalanceObserverScopeReadRetryPolicy;
  scopeReadRetryRuntime: CustodyBalanceObserverScopeReadRetryRuntime;
  workerRetryRuntime?: CustodyBalanceObserverRetryRuntime;
  providerConcurrency: number;
  pageLimit: number;
  maxDiscoveryPages: number;
  runWorkUnit: typeof runCustodyBalanceObserverWorkUnit;
  signal?: AbortSignal;
};

type DiscoveredScope = CustodyBalanceObserverDiscoveredScope & {
  discoveryIndex: number;
};

type ProviderGroup = {
  providerId: string;
  provider: CustodyProviderRef;
  scopes: readonly DiscoveredScope[];
};

type DiscoveryState = {
  scopes: DiscoveredScope[];
  seenScopeKeys: Set<string>;
  seenCursorKeys: Set<string>;
  providerRefs: Map<string, string>;
  previousScopeKey: string | null;
};

type TerminalResult = {
  status: CustodyBalanceObserverOneShotStatus;
  code: CustodyBalanceObserverOrchestratorCode | null;
  outcomes: readonly CustodyBalanceObserverOrchestratorScopeOutcome[];
};

type ScopeReadResult<TValue> =
  | {
      ok: true;
      value: TValue;
    }
  | {
      ok: false;
      code: CustodyBalanceObserverOrchestratorCode;
      aborted: boolean;
    };

type WorkerRunResult =
  | {
      ok: true;
      outcomes: readonly WorkerBindingOutcome[];
    }
  | {
      ok: false;
      code: "WORKER_RESULT_INVALID" | "WORKER_EXECUTION_FAILED";
    };

type WorkerResultValidation =
  | {
      ok: true;
      outcomes: readonly WorkerBindingOutcome[];
      summary: CustodyBalanceObserverWorkSummary;
    }
  | {
      ok: false;
    };

const DEFAULT_SCOPE_READ_RETRY_POLICY: CustodyBalanceObserverScopeReadRetryPolicy =
  {
    mode: "DISABLED",
  };
const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_MAX_DISCOVERY_PAGES = 100;
const DEFAULT_PROVIDER_CONCURRENCY = 1;
const MAX_PROVIDER_CONCURRENCY = 4;
const MAX_DISCOVERY_PAGES = 1_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROVIDER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
const ASSET_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,31}$/;
const BINDING_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const CHECKPOINT_VERSION_PATTERN = /^(0|[1-9][0-9]{0,18})$/;
const BIGINT_MAX = BigInt("9223372036854775807");

export async function runCustodyBalanceObserverOneShot(
  input: RunCustodyBalanceObserverOneShotInput,
): Promise<CustodyBalanceObserverOneShotResult> {
  const validated = validateInput(input);
  const summary = createEmptySummary();
  let terminal: TerminalResult | null = null;

  try {
    if (validated.signal?.aborted) {
      terminal = {
        status: "ABORTED",
        code: "ORCHESTRATOR_ABORTED",
        outcomes: [],
      };
    } else {
      terminal = await executeOneShot(validated, summary);
    }
  } finally {
    await closeOwnedClients(validated, summary);
  }

  const result = finalizeResult(terminal, summary);

  if (summary.clientCloseFailures > 0) {
    return {
      ...result,
      status: "FAILED_CLEANUP",
      code: "ORCHESTRATOR_CLIENT_CLOSE_FAILED",
      summary: { ...summary },
    };
  }

  return result;
}

async function executeOneShot(
  input: ValidatedRunInput,
  summary: CustodyBalanceObserverOneShotSummary,
): Promise<TerminalResult> {
  const discovery = await discoverScopes(input, summary);

  if (discovery.status !== "READY") {
    return discovery.terminal;
  }

  const groups = groupScopesByProvider(discovery.scopes);
  const outcomes = new Array<
    CustodyBalanceObserverOrchestratorScopeOutcome | undefined
  >(discovery.scopes.length);
  let nextGroupIndex = 0;

  const providerWorkers = Array.from(
    { length: Math.min(input.providerConcurrency, groups.length) },
    async () => {
      while (nextGroupIndex < groups.length) {
        if (input.signal?.aborted) {
          return;
        }

        const group = groups[nextGroupIndex];
        nextGroupIndex += 1;

        if (group) {
          await executeProviderGroup(input, summary, group, outcomes);
        }
      }
    },
  );

  await Promise.all(providerWorkers);

  if (input.signal?.aborted) {
    for (const scope of discovery.scopes) {
      if (!outcomes[scope.discoveryIndex]) {
        outcomes[scope.discoveryIndex] = abortedScopeOutcome(scope);
      }
    }
  }

  const finalOutcomes = outcomes.filter(
    (
      outcome,
    ): outcome is CustodyBalanceObserverOrchestratorScopeOutcome =>
      outcome !== undefined,
  );

  return {
    status: statusFromOutcomes(finalOutcomes, input.signal),
    code: codeFromOutcomes(finalOutcomes, input.signal),
    outcomes: finalOutcomes,
  };
}

async function discoverScopes(
  input: ValidatedRunInput,
  summary: CustodyBalanceObserverOneShotSummary,
): Promise<
  | {
      status: "READY";
      scopes: readonly DiscoveredScope[];
    }
  | {
      status: "TERMINAL";
      terminal: TerminalResult;
    }
> {
  const state: DiscoveryState = {
    scopes: [],
    seenScopeKeys: new Set<string>(),
    seenCursorKeys: new Set<string>(),
    providerRefs: new Map<string, string>(),
    previousScopeKey: null,
  };
  let after: CustodyBalanceObserverScopeCursor | null = null;

  while (true) {
    if (input.signal?.aborted) {
      return {
        status: "TERMINAL",
        terminal: {
          status: "ABORTED",
          code: "ORCHESTRATOR_ABORTED",
          outcomes: state.scopes.map(abortedScopeOutcome),
        },
      };
    }

    const pageResult = await readScopeWithRetry(
      input,
      summary,
      () =>
        input.scopeClient.listBalanceObserverScopePage({
          after,
          limit: input.pageLimit,
        }),
      "DISCOVERY",
    );

    if (pageResult.ok === false) {
      return {
        status: "TERMINAL",
        terminal: {
          status: pageResult.aborted ? "ABORTED" : "FAILED_DISCOVERY",
          code: pageResult.code,
          outcomes: pageResult.aborted ? state.scopes.map(abortedScopeOutcome) : [],
        },
      };
    }

    summary.pagesRead += 1;

    const validation = validateDiscoveryPage(
      pageResult.value,
      input,
      state,
      after,
    );

    if (validation.ok === false) {
      return {
        status: "TERMINAL",
        terminal: {
          status: "FAILED_DISCOVERY",
          code: validation.code,
          outcomes: [],
        },
      };
    }

    if (!pageResult.value.page.hasMore) {
      summary.scopesDiscovered = state.scopes.length;
      summary.bindingsDiscovered = state.scopes.reduce(
        (sum, scope) => sum + scope.bindings.length,
        0,
      );
      summary.providersDiscovered = new Set(
        state.scopes.map((scope) => scope.providerId),
      ).size;

      return {
        status: "READY",
        scopes: state.scopes,
      };
    }

    if (summary.pagesRead >= input.maxDiscoveryPages) {
      return {
        status: "TERMINAL",
        terminal: {
          status: "FAILED_DISCOVERY",
          code: "ORCHESTRATOR_DISCOVERY_LIMIT_EXCEEDED",
          outcomes: [],
        },
      };
    }

    after = pageResult.value.page.nextCursor;
  }
}

function validateDiscoveryPage(
  page: CustodyBalanceObserverScopePage,
  input: ValidatedRunInput,
  state: DiscoveryState,
  after: CustodyBalanceObserverScopeCursor | null,
):
  | {
      ok: true;
    }
  | {
      ok: false;
      code: CustodyBalanceObserverOrchestratorCode;
    } {
  if (
    !isRecord(page) ||
    !Array.isArray(page.scopes) ||
    !isRecord(page.page) ||
    typeof page.page.scopeCount !== "number" ||
    !Number.isSafeInteger(page.page.scopeCount) ||
    typeof page.page.hasMore !== "boolean"
  ) {
    return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
  }

  if (page.scopes.length === 0) {
    if (
      page.page.scopeCount !== 0 ||
      page.page.hasMore ||
      page.page.nextCursor !== null
    ) {
      return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
    }

    return { ok: true };
  }

  if (
    page.page.scopeCount !== page.scopes.length ||
    page.page.scopeCount < 1 ||
    page.page.scopeCount > input.pageLimit
  ) {
    return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
  }

  if (page.page.hasMore) {
    if (!isCursor(page.page.nextCursor)) {
      return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
    }

    const cursorKey = cursorKeyFor(page.page.nextCursor);

    if (
      (after && cursorKey === cursorKeyFor(after)) ||
      state.seenCursorKeys.has(cursorKey)
    ) {
      return { ok: false, code: "ORCHESTRATOR_SCOPE_CURSOR_LOOP" };
    }
  }

  for (const scope of page.scopes) {
    const scopeValidation = validateDiscoveredScope(scope);

    if (scopeValidation.ok === false) {
      return scopeValidation;
    }

    const scopeKey = scopeKeyFor(scope);

    if (state.seenScopeKeys.has(scopeKey)) {
      return { ok: false, code: "ORCHESTRATOR_SCOPE_DUPLICATE" };
    }

    if (state.previousScopeKey !== null && scopeKey <= state.previousScopeKey) {
      return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
    }

    const providerRefKey = JSON.stringify(scope.provider);
    const priorProviderRefKey = state.providerRefs.get(scope.providerId);

    if (priorProviderRefKey && priorProviderRefKey !== providerRefKey) {
      return { ok: false, code: "ORCHESTRATOR_PROVIDER_REF_INVALID" };
    }

    state.providerRefs.set(scope.providerId, providerRefKey);
    state.seenScopeKeys.add(scopeKey);
    state.previousScopeKey = scopeKey;
    state.scopes.push({
      ...scope,
      discoveryIndex: state.scopes.length,
    });
  }

  if (page.page.hasMore) {
    const nextCursor = page.page.nextCursor;

    if (!isCursor(nextCursor)) {
      return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
    }

    const cursorKey = cursorKeyFor(nextCursor);
    const lastScope = page.scopes[page.scopes.length - 1];

    if (
      !lastScope ||
      nextCursor.providerId !== lastScope.providerId ||
      nextCursor.assetId !== lastScope.assetId
    ) {
      return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
    }

    state.seenCursorKeys.add(cursorKey);
    return { ok: true };
  }

  if (page.page.nextCursor !== null) {
    return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
  }

  return { ok: true };
}

function validateDiscoveredScope(
  scope: CustodyBalanceObserverDiscoveredScope,
):
  | {
      ok: true;
    }
  | {
      ok: false;
      code: CustodyBalanceObserverOrchestratorCode;
    } {
  if (
    !isRecord(scope) ||
    !isUuid(scope.providerId) ||
    !isUuid(scope.assetId) ||
    !isAssetCode(scope.assetCode) ||
    !isProviderRef(scope.provider) ||
    !Array.isArray(scope.bindings) ||
    scope.bindings.length < 1
  ) {
    return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
  }

  const bindingIds = new Set<string>();

  for (const binding of scope.bindings) {
    if (
      !isRecord(binding) ||
      !isUuid(binding.bindingId) ||
      binding.assetId !== scope.assetId ||
      !isRecord(binding.binding) ||
      binding.binding.providerCode !== scope.provider.providerCode ||
      !isBindingKey(binding.binding.bindingKey) ||
      binding.binding.assetCode !== scope.assetCode ||
      typeof binding.binding.accountRole !== "string" ||
      !isCheckpointVersion(binding.expectedCheckpointVersion)
    ) {
      return { ok: false, code: "ORCHESTRATOR_SCOPE_PAGE_INVALID" };
    }

    if (bindingIds.has(binding.bindingId)) {
      return { ok: false, code: "ORCHESTRATOR_SCOPE_DUPLICATE" };
    }

    bindingIds.add(binding.bindingId);
  }

  return { ok: true };
}

async function executeProviderGroup(
  input: ValidatedRunInput,
  summary: CustodyBalanceObserverOneShotSummary,
  group: ProviderGroup,
  outcomes: Array<CustodyBalanceObserverOrchestratorScopeOutcome | undefined>,
): Promise<void> {
  if (input.signal?.aborted) {
    for (const scope of group.scopes) {
      outcomes[scope.discoveryIndex] = abortedScopeOutcome(scope);
    }

    return;
  }

  let adapter: CustodyObservationAdapter;

  try {
    summary.adapterFactoryCalls += 1;
    adapter = input.adapterFactory(group.provider);
  } catch {
    summary.adapterFactoryFailures += 1;
    for (const scope of group.scopes) {
      outcomes[scope.discoveryIndex] = failedScopeOutcome(
        scope,
        "ADAPTER_FACTORY_FAILED",
        "FACTORY",
      );
    }

    return;
  }

  if (!isAdapterForProvider(adapter, group.provider)) {
    summary.adapterFactoryFailures += 1;
    for (const scope of group.scopes) {
      outcomes[scope.discoveryIndex] = failedScopeOutcome(
        scope,
        "ADAPTER_FACTORY_RESULT_INVALID",
        "FACTORY",
      );
    }

    return;
  }

  for (const scope of group.scopes) {
    if (input.signal?.aborted) {
      outcomes[scope.discoveryIndex] = abortedScopeOutcome(scope);
      continue;
    }

    outcomes[scope.discoveryIndex] = await executeScope(
      input,
      summary,
      scope,
      adapter,
    );
  }
}

async function executeScope(
  input: ValidatedRunInput,
  summary: CustodyBalanceObserverOneShotSummary,
  scope: DiscoveredScope,
  adapter: CustodyObservationAdapter,
): Promise<CustodyBalanceObserverOrchestratorScopeOutcome> {
  const initialResult = await runWorkerSafely(
    input,
    summary,
    scope,
    scope.bindings,
    adapter,
  );

  if (initialResult.ok === false) {
    return failedScopeOutcome(scope, initialResult.code, "WORKER");
  }

  let bindingOutcomes: CustodyBalanceObserverOrchestratorBindingOutcome[] =
    initialResult.outcomes.map(toSafeBindingOutcome);
  const refreshIds = bindingOutcomes
    .filter(isSafeBindingFailure)
    .filter((outcome) => outcome.requiresScopeRefresh)
    .map((outcome) => outcome.bindingId);
  const refresh = {
    requested: refreshIds.length > 0,
    attempted: false,
    succeeded: false,
    failed: false,
    noLongerEligibleBindings: 0,
  };

  if (refreshIds.length === 0) {
    return scopeOutcome(scope, bindingOutcomes, refresh);
  }

  summary.scopeRefreshRequested += 1;

  if (input.signal?.aborted) {
    bindingOutcomes = replaceBindingOutcomes(
      bindingOutcomes,
      new Set(refreshIds),
      (bindingId) => abortedBindingOutcome(bindingId),
    );

    return scopeOutcome(scope, bindingOutcomes, refresh);
  }

  refresh.attempted = true;
  summary.scopeRefreshAttempted += 1;

  const refreshResult = await readScopeWithRetry(
    input,
    summary,
    () =>
      input.scopeClient.readBalanceObserverScope({
        providerId: scope.providerId,
        assetId: scope.assetId,
      }),
    "REFRESH",
  );

  if (refreshResult.ok === false) {
    if (refreshResult.aborted) {
      bindingOutcomes = replaceBindingOutcomes(
        bindingOutcomes,
        new Set(refreshIds),
        (bindingId) => abortedBindingOutcome(bindingId),
      );
    } else {
      refresh.failed = true;
      summary.scopeRefreshFailed += 1;
      bindingOutcomes = replaceBindingOutcomes(
        bindingOutcomes,
        new Set(refreshIds),
        (bindingId) =>
          failedBindingOutcome(bindingId, "SCOPE_REFRESH_FAILED", "REFRESH"),
      );
    }

    return scopeOutcome(scope, bindingOutcomes, refresh);
  }

  const refreshedScope = refreshResult.value;

  if (refreshedScope === null) {
    refresh.succeeded = true;
    refresh.noLongerEligibleBindings = refreshIds.length;
    summary.scopeRefreshSucceeded += 1;
    summary.scopeNoLongerEligible += refreshIds.length;
    bindingOutcomes = replaceBindingOutcomes(
      bindingOutcomes,
      new Set(refreshIds),
      (bindingId) =>
        failedBindingOutcome(bindingId, "SCOPE_NO_LONGER_ELIGIBLE", "REFRESH"),
    );

    return scopeOutcome(scope, bindingOutcomes, refresh);
  }

  const refreshValidation = validateRefreshScope(refreshedScope, scope);

  if (refreshValidation.ok === false) {
    refresh.failed = true;
    summary.scopeRefreshFailed += 1;
    bindingOutcomes = replaceBindingOutcomes(
      bindingOutcomes,
      new Set(refreshIds),
      (bindingId) =>
        failedBindingOutcome(bindingId, "SCOPE_REFRESH_FAILED", "REFRESH"),
    );

    return scopeOutcome(scope, bindingOutcomes, refresh);
  }

  const selectedBindings = selectRefreshBindings(refreshedScope, refreshIds);
  const selectedIds = new Set(selectedBindings.map((binding) => binding.bindingId));
  const missingIds = refreshIds.filter((bindingId) => !selectedIds.has(bindingId));

  if (missingIds.length > 0) {
    refresh.noLongerEligibleBindings += missingIds.length;
    summary.scopeNoLongerEligible += missingIds.length;
    bindingOutcomes = replaceBindingOutcomes(
      bindingOutcomes,
      new Set(missingIds),
      (bindingId) =>
        failedBindingOutcome(bindingId, "SCOPE_NO_LONGER_ELIGIBLE", "REFRESH"),
    );
  }

  if (input.signal?.aborted) {
    bindingOutcomes = replaceBindingOutcomes(
      bindingOutcomes,
      selectedIds,
      (bindingId) => abortedBindingOutcome(bindingId),
    );

    return scopeOutcome(scope, bindingOutcomes, refresh);
  }

  if (selectedBindings.length === 0) {
    refresh.succeeded = true;
    summary.scopeRefreshSucceeded += 1;

    return scopeOutcome(scope, bindingOutcomes, refresh);
  }

  const rerunResult = await runWorkerSafely(
    input,
    summary,
    scope,
    selectedBindings,
    adapter,
  );

  if (rerunResult.ok === false) {
    refresh.failed = true;
    summary.scopeRefreshFailed += 1;
    bindingOutcomes = replaceBindingOutcomes(
      bindingOutcomes,
      selectedIds,
      (bindingId) => failedBindingOutcome(bindingId, rerunResult.code, "WORKER"),
    );

    return scopeOutcome(scope, bindingOutcomes, refresh);
  }

  const rerunOutcomes = rerunResult.outcomes.map(toSafeBindingOutcome);
  const secondConflict = rerunOutcomes.some(
    (outcome) => isSafeBindingFailure(outcome) && outcome.requiresScopeRefresh,
  );

  bindingOutcomes = mergeBindingOutcomes(bindingOutcomes, rerunOutcomes);

  if (secondConflict) {
    refresh.failed = true;
    summary.scopeRefreshFailed += 1;
  } else {
    refresh.succeeded = true;
    summary.scopeRefreshSucceeded += 1;
  }

  return scopeOutcome(scope, bindingOutcomes, refresh);
}

async function runWorkerSafely(
  input: ValidatedRunInput,
  summary: CustodyBalanceObserverOneShotSummary,
  scope: DiscoveredScope,
  bindings: readonly CustodyBalanceObserverDiscoveredBinding[],
  adapter: CustodyObservationAdapter,
): Promise<WorkerRunResult> {
  try {
    const result = await input.runWorkUnit({
      workUnit: {
        provider: scope.provider,
        assetId: scope.assetId,
        bindings,
        identityPolicy: input.identityPolicy,
      },
      adapter,
      commandClient: input.commandClient,
      retryPolicy: input.workerRetryPolicy,
      retryRuntime: input.workerRetryRuntime,
      signal: input.signal,
    });
    const validation = validateWorkerResult(result, bindings);

    if (validation.ok === false) {
      return { ok: false, code: "WORKER_RESULT_INVALID" };
    }

    addWorkerSummary(summary, validation.summary);

    return {
      ok: true,
      outcomes: validation.outcomes,
    };
  } catch {
    return { ok: false, code: "WORKER_EXECUTION_FAILED" };
  }
}

function validateWorkerResult(
  result: CustodyBalanceObserverWorkResult,
  bindings: readonly CustodyBalanceObserverDiscoveredBinding[],
): WorkerResultValidation {
  if (
    !isRecord(result) ||
    !Array.isArray(result.outcomes) ||
    result.outcomes.length !== bindings.length ||
    !isRecord(result.summary)
  ) {
    return { ok: false };
  }

  const seenBindingIds = new Set<string>();

  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index];
    const outcome = result.outcomes[index];

    if (!binding || !isWorkerOutcomeForBinding(outcome, binding.bindingId)) {
      return { ok: false };
    }

    if (seenBindingIds.has(outcome.bindingId)) {
      return { ok: false };
    }

    seenBindingIds.add(outcome.bindingId);
  }

  if (!isWorkerSummary(result.summary, bindings.length)) {
    return { ok: false };
  }

  return {
    ok: true,
    outcomes: result.outcomes as readonly WorkerBindingOutcome[],
    summary: result.summary as CustodyBalanceObserverWorkSummary,
  };
}

function isWorkerOutcomeForBinding(
  outcome: unknown,
  bindingId: string,
): outcome is WorkerBindingOutcome {
  if (
    !isRecord(outcome) ||
    outcome.bindingId !== bindingId ||
    typeof outcome.ok !== "boolean" ||
    "binding" in outcome ||
    "payload" in outcome ||
    "stack" in outcome ||
    "message" in outcome ||
    "observationKey" in outcome
  ) {
    return false;
  }

  if (outcome.ok) {
    return (
      typeof outcome.observationCreated === "boolean" &&
      typeof outcome.checkpointCreated === "boolean" &&
      typeof outcome.checkpointAdvanced === "boolean" &&
      isCheckpointVersion(outcome.checkpointVersion) &&
      isSafeCount(outcome.adapterAttempts) &&
      isSafeCount(outcome.databaseAttempts)
    );
  }

  return (
    typeof outcome.stage === "string" &&
    typeof outcome.code === "string" &&
    typeof outcome.retryable === "boolean" &&
    isSafeCount(outcome.adapterAttempts) &&
    isSafeCount(outcome.databaseAttempts) &&
    typeof outcome.retryExhausted === "boolean" &&
    typeof outcome.retryDeferred === "boolean" &&
    (outcome.retryAfterMs === null || isSafeCount(outcome.retryAfterMs)) &&
    typeof outcome.requiresScopeRefresh === "boolean"
  );
}

function isWorkerSummary(summary: unknown, requestedBindings: number): boolean {
  if (!isRecord(summary) || summary.requestedBindings !== requestedBindings) {
    return false;
  }

  const fields: (keyof CustodyBalanceObserverWorkSummary)[] = [
    "requestedBindings",
    "adapterSuccesses",
    "adapterFailures",
    "databaseAttempts",
    "persistedObservations",
    "replayedObservations",
    "checkpointsCreated",
    "checkpointsAdvanced",
    "checkpointNoops",
    "failedBindings",
    "abortedBindings",
    "adapterAttempts",
    "adapterRetryAttempts",
    "databaseRetryAttempts",
    "retryExhaustedBindings",
    "retryDeferredBindings",
    "scopeRefreshRequiredBindings",
    "timeoutFailures",
    "lockTimeoutFailures",
    "unavailableFailures",
  ];

  return fields.every((field) => isSafeCount(summary[field]));
}

function addWorkerSummary(
  summary: CustodyBalanceObserverOneShotSummary,
  workerSummary: CustodyBalanceObserverWorkSummary,
) {
  summary.workerAdapterAttempts += workerSummary.adapterAttempts;
  summary.workerDatabaseAttempts += workerSummary.databaseAttempts;
  summary.workerAdapterRetryAttempts += workerSummary.adapterRetryAttempts;
  summary.workerDatabaseRetryAttempts += workerSummary.databaseRetryAttempts;
}

async function readScopeWithRetry<TValue>(
  input: ValidatedRunInput,
  summary: CustodyBalanceObserverOneShotSummary,
  operation: () => Promise<TValue>,
  stage: "DISCOVERY" | "REFRESH",
): Promise<ScopeReadResult<TValue>> {
  let attempts = 0;

  while (true) {
    if (input.signal?.aborted) {
      return {
        ok: false,
        code: "ORCHESTRATOR_ABORTED",
        aborted: true,
      };
    }

    attempts += 1;
    summary.scopeReadAttempts += 1;

    try {
      const value = await operation();

      if (input.signal?.aborted) {
        return {
          ok: false,
          code: "ORCHESTRATOR_ABORTED",
          aborted: true,
        };
      }

      return { ok: true, value };
    } catch (error) {
      if (input.signal?.aborted) {
        return {
          ok: false,
          code: "ORCHESTRATOR_ABORTED",
          aborted: true,
        };
      }

      const retryable =
        error instanceof CustodyBalanceObserverScopeClientError &&
        error.retryable === true;

      if (
        !retryable ||
        input.scopeReadRetryPolicy.mode !== "BOUNDED_V1" ||
        attempts >= input.scopeReadRetryPolicy.maxAttempts
      ) {
        return {
          ok: false,
          code:
            stage === "DISCOVERY"
              ? "ORCHESTRATOR_SCOPE_DISCOVERY_FAILED"
              : "SCOPE_REFRESH_FAILED",
          aborted: false,
        };
      }

      summary.scopeReadRetryAttempts += 1;

      const retryPolicy = toWorkerRetryPolicy(input.scopeReadRetryPolicy);
      const delay = calculateRetryDelayDecision({
        policy: retryPolicy,
        retryIndex: attempts,
        retryAfterMs: null,
        randomInteger: scopeRandomInteger(input.scopeReadRetryRuntime),
      });
      const waitResult = await waitForRetryDelay({
        delayMs: delay.delayMs,
        signal: input.signal,
        sleep: scopeSleep(input.scopeReadRetryRuntime),
      });

      if (waitResult === "ABORTED") {
        return {
          ok: false,
          code: "ORCHESTRATOR_ABORTED",
          aborted: true,
        };
      }
    }
  }
}

function validateRefreshScope(
  refreshedScope: CustodyBalanceObserverDiscoveredScope,
  originalScope: DiscoveredScope,
):
  | {
      ok: true;
    }
  | {
      ok: false;
    } {
  const validation = validateDiscoveredScope(refreshedScope);

  if (
    validation.ok === false ||
    refreshedScope.providerId !== originalScope.providerId ||
    refreshedScope.assetId !== originalScope.assetId ||
    JSON.stringify(refreshedScope.provider) !== JSON.stringify(originalScope.provider)
  ) {
    return { ok: false };
  }

  return { ok: true };
}

function selectRefreshBindings(
  refreshedScope: CustodyBalanceObserverDiscoveredScope,
  bindingIds: readonly string[],
): readonly CustodyBalanceObserverDiscoveredBinding[] {
  const bindingIdSet = new Set(bindingIds);
  const selected: CustodyBalanceObserverDiscoveredBinding[] = [];
  const seen = new Set<string>();

  for (const binding of refreshedScope.bindings) {
    if (!bindingIdSet.has(binding.bindingId)) {
      continue;
    }

    if (seen.has(binding.bindingId)) {
      return [];
    }

    seen.add(binding.bindingId);
    selected.push(binding);
  }

  return selected;
}

function groupScopesByProvider(
  scopes: readonly DiscoveredScope[],
): readonly ProviderGroup[] {
  const groups: ProviderGroup[] = [];
  const groupByProviderId = new Map<string, ProviderGroup>();

  for (const scope of scopes) {
    let group = groupByProviderId.get(scope.providerId);

    if (!group) {
      group = {
        providerId: scope.providerId,
        provider: scope.provider,
        scopes: [],
      };
      groupByProviderId.set(scope.providerId, group);
      groups.push(group);
    }

    (group.scopes as DiscoveredScope[]).push(scope);
  }

  return groups;
}

function validateInput(
  input: RunCustodyBalanceObserverOneShotInput,
): ValidatedRunInput {
  if (
    !isRecord(input) ||
    !isScopeClient(input.scopeClient) ||
    !isCommandClient(input.commandClient) ||
    input.scopeClient === (input.commandClient as unknown) ||
    typeof input.adapterFactory !== "function" ||
    (input.identityPolicy !== "PRODUCTION" &&
      input.identityPolicy !== "LOCAL_MOCK")
  ) {
    throw new CustodyBalanceObserverOrchestratorError(
      "ORCHESTRATOR_INPUT_INVALID",
      false,
    );
  }

  const providerConcurrency = validateInteger(
    input.concurrencyPolicy?.providerConcurrency ?? DEFAULT_PROVIDER_CONCURRENCY,
    1,
    MAX_PROVIDER_CONCURRENCY,
  );
  const pageLimit = validateInteger(
    input.pageLimit ?? DEFAULT_PAGE_LIMIT,
    1,
    200,
  );
  const maxDiscoveryPages = validateInteger(
    input.maxDiscoveryPages ?? DEFAULT_MAX_DISCOVERY_PAGES,
    1,
    MAX_DISCOVERY_PAGES,
  );
  const scopeReadRetryPolicy = validateScopeReadRetryPolicy(
    input.scopeReadRetryPolicy ?? DEFAULT_SCOPE_READ_RETRY_POLICY,
  );

  if (
    input.scopeReadRetryRuntime !== undefined &&
    (!isRecord(input.scopeReadRetryRuntime) ||
      (input.scopeReadRetryRuntime.randomInteger !== undefined &&
        typeof input.scopeReadRetryRuntime.randomInteger !== "function") ||
      (input.scopeReadRetryRuntime.sleep !== undefined &&
        typeof input.scopeReadRetryRuntime.sleep !== "function"))
  ) {
    throw new CustodyBalanceObserverOrchestratorError(
      "ORCHESTRATOR_INPUT_INVALID",
      false,
    );
  }

  if (
    input.runtime !== undefined &&
    (!isRecord(input.runtime) ||
      (input.runtime.runWorkUnit !== undefined &&
        typeof input.runtime.runWorkUnit !== "function"))
  ) {
    throw new CustodyBalanceObserverOrchestratorError(
      "ORCHESTRATOR_INPUT_INVALID",
      false,
    );
  }

  if (
    input.signal !== undefined &&
    (typeof input.signal !== "object" ||
      input.signal === null ||
      typeof input.signal.aborted !== "boolean")
  ) {
    throw new CustodyBalanceObserverOrchestratorError(
      "ORCHESTRATOR_INPUT_INVALID",
      false,
    );
  }

  return {
    scopeClient: input.scopeClient,
    commandClient: input.commandClient,
    adapterFactory: input.adapterFactory,
    identityPolicy: input.identityPolicy,
    workerRetryPolicy: input.workerRetryPolicy,
    scopeReadRetryPolicy,
    scopeReadRetryRuntime: input.scopeReadRetryRuntime ?? {},
    workerRetryRuntime: input.workerRetryRuntime,
    providerConcurrency,
    pageLimit,
    maxDiscoveryPages,
    runWorkUnit: input.runtime?.runWorkUnit ?? runCustodyBalanceObserverWorkUnit,
    signal: input.signal,
  };
}

function validateScopeReadRetryPolicy(
  policy: CustodyBalanceObserverScopeReadRetryPolicy,
): CustodyBalanceObserverScopeReadRetryPolicy {
  if (!isRecord(policy) || typeof policy.mode !== "string") {
    throw new CustodyBalanceObserverOrchestratorError(
      "ORCHESTRATOR_INPUT_INVALID",
      false,
    );
  }

  if (policy.mode === "DISABLED") {
    return DEFAULT_SCOPE_READ_RETRY_POLICY;
  }

  if (policy.mode !== "BOUNDED_V1") {
    throw new CustodyBalanceObserverOrchestratorError(
      "ORCHESTRATOR_INPUT_INVALID",
      false,
    );
  }

  const maxAttempts = validateInteger(policy.maxAttempts, 1, 3);
  const baseDelayMs = validateInteger(policy.baseDelayMs, 1, 4_000);
  const maxDelayMs = validateInteger(policy.maxDelayMs, baseDelayMs, 30_000);

  if (
    typeof policy.jitterRatio !== "number" ||
    !Number.isFinite(policy.jitterRatio) ||
    policy.jitterRatio < 0 ||
    policy.jitterRatio > 0.5
  ) {
    throw new CustodyBalanceObserverOrchestratorError(
      "ORCHESTRATOR_INPUT_INVALID",
      false,
    );
  }

  return {
    mode: "BOUNDED_V1",
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitterRatio: policy.jitterRatio,
  };
}

function toWorkerRetryPolicy(
  policy: Extract<
    CustodyBalanceObserverScopeReadRetryPolicy,
    { mode: "BOUNDED_V1" }
  >,
): Extract<CustodyBalanceObserverRetryPolicy, { mode: "BOUNDED_V1" }> {
  return {
    mode: "BOUNDED_V1",
    maxAttempts: policy.maxAttempts,
    baseDelayMs: policy.baseDelayMs,
    maxDelayMs: policy.maxDelayMs,
    jitterRatio: policy.jitterRatio,
    maxRetryAfterMs: policy.maxDelayMs,
  };
}

function scopeRandomInteger(
  runtime: CustodyBalanceObserverScopeReadRetryRuntime,
): CustodyBalanceObserverRetryRandomInteger | undefined {
  if (!runtime.randomInteger) {
    return undefined;
  }

  return (maxExclusive) => runtime.randomInteger?.(0, maxExclusive - 1) ?? 0;
}

function scopeSleep(
  runtime: CustodyBalanceObserverScopeReadRetryRuntime,
): CustodyBalanceObserverRetrySleep | undefined {
  if (!runtime.sleep) {
    return undefined;
  }

  return async (delayMs, signal) => {
    await runtime.sleep?.(delayMs, signal);

    if (signal?.aborted) {
      return "ABORTED";
    }

    return "COMPLETED";
  };
}

async function closeOwnedClients(
  input: ValidatedRunInput,
  summary: CustodyBalanceObserverOneShotSummary,
) {
  summary.clientCloseAttempts += 1;
  try {
    await input.scopeClient.close();
  } catch {
    summary.clientCloseFailures += 1;
  }

  summary.clientCloseAttempts += 1;
  try {
    await input.commandClient.close();
  } catch {
    summary.clientCloseFailures += 1;
  }
}

function finalizeResult(
  terminal: TerminalResult | null,
  summary: CustodyBalanceObserverOneShotSummary,
): CustodyBalanceObserverOneShotResult {
  const safeTerminal =
    terminal ??
    ({
      status: "FAILED_DISCOVERY",
      code: "ORCHESTRATOR_SCOPE_DISCOVERY_FAILED",
      outcomes: [],
    } satisfies TerminalResult);

  summarizeOutcomes(summary, safeTerminal.outcomes);

  return {
    status: safeTerminal.status,
    code: safeTerminal.code,
    outcomes: orderOutcomes(safeTerminal.outcomes),
    summary: { ...summary },
  };
}

function summarizeOutcomes(
  summary: CustodyBalanceObserverOneShotSummary,
  outcomes: readonly CustodyBalanceObserverOrchestratorScopeOutcome[],
) {
  summary.scopesStarted = outcomes.length;
  summary.scopesCompleted = outcomes.filter(
    (outcome) => outcome.status === "SUCCEEDED",
  ).length;
  summary.scopesFailed = outcomes.filter(
    (outcome) =>
      outcome.status === "PARTIAL" || outcome.status === "FAILED",
  ).length;
  summary.scopesAborted = outcomes.filter(
    (outcome) => outcome.status === "ABORTED",
  ).length;
  summary.bindingsSucceeded = outcomes.reduce(
    (sum, outcome) =>
      sum + outcome.bindings.filter((binding) => binding.ok).length,
    0,
  );
  summary.bindingsFailed = outcomes.reduce(
    (sum, outcome) =>
      sum +
      outcome.bindings.filter(
        (binding) => !binding.ok && binding.status !== "ABORTED",
      ).length,
    0,
  );
  summary.bindingsAborted = outcomes.reduce(
    (sum, outcome) =>
      sum +
      outcome.bindings.filter(
        (binding) => !binding.ok && binding.status === "ABORTED",
      ).length,
    0,
  );
}

function createEmptySummary(): CustodyBalanceObserverOneShotSummary {
  return {
    pagesRead: 0,
    scopesDiscovered: 0,
    providersDiscovered: 0,
    bindingsDiscovered: 0,
    scopesStarted: 0,
    scopesCompleted: 0,
    scopesFailed: 0,
    scopesAborted: 0,
    bindingsSucceeded: 0,
    bindingsFailed: 0,
    bindingsAborted: 0,
    adapterFactoryCalls: 0,
    adapterFactoryFailures: 0,
    scopeRefreshRequested: 0,
    scopeRefreshAttempted: 0,
    scopeRefreshSucceeded: 0,
    scopeRefreshFailed: 0,
    scopeNoLongerEligible: 0,
    scopeReadAttempts: 0,
    scopeReadRetryAttempts: 0,
    workerAdapterAttempts: 0,
    workerDatabaseAttempts: 0,
    workerAdapterRetryAttempts: 0,
    workerDatabaseRetryAttempts: 0,
    clientCloseAttempts: 0,
    clientCloseFailures: 0,
  };
}

function orderOutcomes(
  outcomes: readonly CustodyBalanceObserverOrchestratorScopeOutcome[],
): readonly CustodyBalanceObserverOrchestratorScopeOutcome[] {
  return [...outcomes].sort(
    (left, right) => left.discoveryIndex - right.discoveryIndex,
  );
}

function statusFromOutcomes(
  outcomes: readonly CustodyBalanceObserverOrchestratorScopeOutcome[],
  signal: AbortSignal | undefined,
): CustodyBalanceObserverOneShotStatus {
  if (signal?.aborted || outcomes.some((outcome) => outcome.status === "ABORTED")) {
    return "ABORTED";
  }

  if (
    outcomes.some(
      (outcome) =>
        outcome.status === "PARTIAL" || outcome.status === "FAILED",
    )
  ) {
    return "PARTIAL";
  }

  return "COMPLETED";
}

function codeFromOutcomes(
  outcomes: readonly CustodyBalanceObserverOrchestratorScopeOutcome[],
  signal: AbortSignal | undefined,
): CustodyBalanceObserverOrchestratorCode | null {
  if (signal?.aborted || outcomes.some((outcome) => outcome.status === "ABORTED")) {
    return "ORCHESTRATOR_ABORTED";
  }

  return null;
}

function scopeOutcome(
  scope: DiscoveredScope,
  bindings: readonly CustodyBalanceObserverOrchestratorBindingOutcome[],
  refresh: CustodyBalanceObserverOrchestratorScopeOutcome["refresh"],
): CustodyBalanceObserverOrchestratorScopeOutcome {
  const okCount = bindings.filter((binding) => binding.ok).length;
  const abortedCount = bindings.filter(
    (binding) => !binding.ok && binding.status === "ABORTED",
  ).length;
  const status =
    abortedCount > 0
      ? "ABORTED"
      : okCount === bindings.length
        ? "SUCCEEDED"
        : okCount === 0
          ? "FAILED"
          : "PARTIAL";

  return {
    discoveryIndex: scope.discoveryIndex,
    providerId: scope.providerId,
    providerCode: scope.provider.providerCode,
    assetId: scope.assetId,
    assetCode: scope.assetCode,
    status,
    bindings: orderBindingOutcomes(scope, bindings),
    refresh,
  };
}

function failedScopeOutcome(
  scope: DiscoveredScope,
  code: string,
  stage: "FACTORY" | "WORKER",
): CustodyBalanceObserverOrchestratorScopeOutcome {
  return scopeOutcome(
    scope,
    scope.bindings.map((binding) =>
      failedBindingOutcome(binding.bindingId, code, stage),
    ),
    {
      requested: false,
      attempted: false,
      succeeded: false,
      failed: false,
      noLongerEligibleBindings: 0,
    },
  );
}

function abortedScopeOutcome(
  scope: DiscoveredScope,
): CustodyBalanceObserverOrchestratorScopeOutcome {
  return scopeOutcome(
    scope,
    scope.bindings.map((binding) => abortedBindingOutcome(binding.bindingId)),
    {
      requested: false,
      attempted: false,
      succeeded: false,
      failed: false,
      noLongerEligibleBindings: 0,
    },
  );
}

function toSafeBindingOutcome(
  outcome: WorkerBindingOutcome,
): CustodyBalanceObserverOrchestratorBindingOutcome {
  if (outcome.ok) {
    return {
      ok: true,
      bindingId: outcome.bindingId,
      status: "SUCCEEDED",
      observationCreated: outcome.observationCreated,
      checkpointCreated: outcome.checkpointCreated,
      checkpointAdvanced: outcome.checkpointAdvanced,
      checkpointVersion: outcome.checkpointVersion,
      adapterAttempts: outcome.adapterAttempts,
      databaseAttempts: outcome.databaseAttempts,
    };
  }

  const failure = outcome as Extract<WorkerBindingOutcome, { ok: false }>;

  return {
    ok: false,
    bindingId: failure.bindingId,
    status: failure.stage === "ABORTED" ? "ABORTED" : "FAILED",
    stage: failure.stage,
    code: failure.code,
    retryable: failure.retryable,
    adapterAttempts: failure.adapterAttempts,
    databaseAttempts: failure.databaseAttempts,
    retryExhausted: failure.retryExhausted,
    retryDeferred: failure.retryDeferred,
    retryAfterMs: failure.retryAfterMs,
    requiresScopeRefresh: failure.requiresScopeRefresh,
  };
}

function isSafeBindingFailure(
  outcome: CustodyBalanceObserverOrchestratorBindingOutcome,
): outcome is Extract<
  CustodyBalanceObserverOrchestratorBindingOutcome,
  { ok: false }
> {
  return outcome.ok === false;
}

function failedBindingOutcome(
  bindingId: string,
  code: string,
  stage: "REFRESH" | "FACTORY" | "WORKER",
): CustodyBalanceObserverOrchestratorBindingOutcome {
  return {
    ok: false,
    bindingId,
    status: "FAILED",
    stage,
    code,
    retryable: false,
    adapterAttempts: 0,
    databaseAttempts: 0,
    retryExhausted: false,
    retryDeferred: false,
    retryAfterMs: null,
    requiresScopeRefresh: false,
  };
}

function abortedBindingOutcome(
  bindingId: string,
): CustodyBalanceObserverOrchestratorBindingOutcome {
  return {
    ok: false,
    bindingId,
    status: "ABORTED",
    stage: "ABORTED",
    code: "ORCHESTRATOR_ABORTED",
    retryable: true,
    adapterAttempts: 0,
    databaseAttempts: 0,
    retryExhausted: false,
    retryDeferred: false,
    retryAfterMs: null,
    requiresScopeRefresh: false,
  };
}

function replaceBindingOutcomes(
  existing: readonly CustodyBalanceObserverOrchestratorBindingOutcome[],
  bindingIds: Set<string>,
  factory: (bindingId: string) => CustodyBalanceObserverOrchestratorBindingOutcome,
): CustodyBalanceObserverOrchestratorBindingOutcome[] {
  return existing.map((outcome) =>
    bindingIds.has(outcome.bindingId) ? factory(outcome.bindingId) : outcome,
  );
}

function mergeBindingOutcomes(
  existing: readonly CustodyBalanceObserverOrchestratorBindingOutcome[],
  replacements: readonly CustodyBalanceObserverOrchestratorBindingOutcome[],
): CustodyBalanceObserverOrchestratorBindingOutcome[] {
  const replacementByBindingId = new Map(
    replacements.map((outcome) => [outcome.bindingId, outcome]),
  );

  return existing.map(
    (outcome) => replacementByBindingId.get(outcome.bindingId) ?? outcome,
  );
}

function orderBindingOutcomes(
  scope: DiscoveredScope,
  bindings: readonly CustodyBalanceObserverOrchestratorBindingOutcome[],
): readonly CustodyBalanceObserverOrchestratorBindingOutcome[] {
  const outcomeByBindingId = new Map(
    bindings.map((outcome) => [outcome.bindingId, outcome]),
  );

  return scope.bindings
    .map((binding) => outcomeByBindingId.get(binding.bindingId))
    .filter(
      (
        outcome,
      ): outcome is CustodyBalanceObserverOrchestratorBindingOutcome =>
        outcome !== undefined,
    );
}

function isScopeClient(value: unknown): value is CustodyBalanceObserverScopeClient {
  return (
    isRecord(value) &&
    typeof value.listBalanceObserverScopePage === "function" &&
    typeof value.readBalanceObserverScope === "function" &&
    typeof value.close === "function"
  );
}

function isCommandClient(
  value: unknown,
): value is CustodyBalanceObserverCommandClient {
  return (
    isRecord(value) &&
    typeof value.recordBalanceObservationAndAdvanceCheckpoint === "function" &&
    typeof value.close === "function"
  );
}

function isAdapterForProvider(
  adapter: unknown,
  provider: CustodyProviderRef,
): adapter is CustodyObservationAdapter {
  return (
    isRecord(adapter) &&
    typeof adapter.readBalances === "function" &&
    isProviderRef(adapter.provider) &&
    providerRefsEqual(adapter.provider, provider)
  );
}

function isProviderRef(value: unknown): value is CustodyProviderRef {
  return (
    isRecord(value) &&
    isProviderCode(value.providerCode) &&
    typeof value.providerType === "string" &&
    Array.isArray(value.capabilities) &&
    value.capabilities.length >= 1 &&
    value.capabilities.every((capability) => typeof capability === "string") &&
    value.capabilities.includes("BALANCE_OBSERVATION")
  );
}

function providerRefsEqual(
  left: CustodyProviderRef,
  right: CustodyProviderRef,
): boolean {
  return (
    left.providerCode === right.providerCode &&
    left.providerType === right.providerType &&
    left.capabilities.length === right.capabilities.length &&
    left.capabilities.every(
      (capability, index) => capability === right.capabilities[index],
    )
  );
}

function scopeKeyFor(scope: {
  providerId: string;
  assetId: string;
}): string {
  return `${scope.providerId}:${scope.assetId}`;
}

function cursorKeyFor(cursor: CustodyBalanceObserverScopeCursor): string {
  return `${cursor.providerId}:${cursor.assetId}`;
}

function isCursor(value: unknown): value is CustodyBalanceObserverScopeCursor {
  return (
    isRecord(value) && isUuid(value.providerId) && isUuid(value.assetId)
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isProviderCode(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_CODE_PATTERN.test(value);
}

function isAssetCode(value: unknown): value is string {
  return typeof value === "string" && ASSET_CODE_PATTERN.test(value);
}

function isBindingKey(value: unknown): value is string {
  return typeof value === "string" && BINDING_KEY_PATTERN.test(value);
}

function isCheckpointVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CHECKPOINT_VERSION_PATTERN.test(value) &&
    BigInt(value) <= BIGINT_MAX
  );
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateInteger(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new CustodyBalanceObserverOrchestratorError(
      "ORCHESTRATOR_INPUT_INVALID",
      false,
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
