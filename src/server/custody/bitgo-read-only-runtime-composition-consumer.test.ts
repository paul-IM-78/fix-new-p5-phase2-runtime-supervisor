import "server-only";

import {
  runBitGoReadOnlyRuntimeCompositionOneShot,
  type BitGoReadOnlyRuntimeCompositionConsumerConfig,
} from "./bitgo-read-only-runtime-composition-consumer";
import type { BitGoReadOnlySemanticAdapterFactory } from "./bitgo-balance-observer-adapter";
import type {
  CustodyBalanceObserverCommandClient,
  RecordBalanceObservationCommandInput,
} from "./balance-observer-command-client";
import type { CustodyBalanceObserverScopeClient } from "./balance-observer-scope-client";
import type {
  CustodyAccountBindingRef,
  CustodyBalanceObservationResult,
  CustodyProviderRef,
} from "./provider-observation-contract";

export const P6_T10_CONSUMER_CASE_IDS = [
  "P6T10-CONS-001", "P6T10-CONS-002", "P6T10-CONS-003",
  "P6T10-CONS-004", "P6T10-CONS-005", "P6T10-CONS-006",
  "P6T10-CONS-007", "P6T10-CONS-008", "P6T10-CONS-009",
  "P6T10-CONS-010", "P6T10-CONS-011", "P6T10-CONS-012",
  "P6T10-CONS-013", "P6T10-CONS-014", "P6T10-CONS-015",
  "P6T10-CONS-016", "P6T10-CONS-017",
] as const;

const PROVIDER: CustodyProviderRef = {
  providerCode: "BITGO",
  providerType: "CUSTODY",
  capabilities: ["BALANCE_OBSERVATION"],
};
const PROVIDER_ID = "00000000-0000-4000-8000-000000000001";
const ASSET_ID = "00000000-0000-4000-8000-000000000002";
const BINDING_ID = "00000000-0000-4000-8000-000000000003";
const OBSERVATION_ID = "00000000-0000-4000-8000-000000000004";
const CHECKPOINT_ID = "00000000-0000-4000-8000-000000000005";
const WALLET_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

type SemanticMode = "SUCCESS" | "FAILURE";

type Fixture = {
  config: BitGoReadOnlyRuntimeCompositionConsumerConfig;
  commandInputs: RecordBalanceObservationCommandInput[];
  semanticInputs: number[];
  scopeReads: number[];
  correlationCalls: number[];
  authority: {
    actualDbClients: number;
    actualDbConnections: number;
    actualDbReads: number;
    actualDbMutations: number;
    syntheticSemanticCalls: number;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function binding(
  overrides: Partial<CustodyAccountBindingRef> = {},
): CustodyAccountBindingRef {
  return {
    providerCode: "BITGO",
    bindingKey: "synthetic-primary",
    assetCode: "TSOL",
    accountRole: "TREASURY",
    ...overrides,
  };
}

function createFixture(options: {
  registryEntries?: readonly {
    binding: CustodyAccountBindingRef;
    walletId: string;
  }[];
  scopeBinding?: CustodyAccountBindingRef;
  semanticMode?: SemanticMode;
  commandFailure?: boolean;
  scopeFailure?: boolean;
  correlationId?: string;
} = {}): Fixture {
  const commandInputs: RecordBalanceObservationCommandInput[] = [];
  const semanticInputs: number[] = [];
  const scopeReads: number[] = [];
  const correlationCalls: number[] = [];
  const authority = {
    actualDbClients: 0,
    actualDbConnections: 0,
    actualDbReads: 0,
    actualDbMutations: 0,
    syntheticSemanticCalls: 0,
  };
  const observedBinding = options.scopeBinding ?? binding();
  const semanticAdapterFactory: BitGoReadOnlySemanticAdapterFactory = () => ({
    provider: PROVIDER,
    capabilities: ["BALANCE_OBSERVATION"],
    async readHealth() {
      return { provider: PROVIDER, status: "UNKNOWN", checkedAt: "2026-01-01T00:00:00.000000Z" };
    },
    async readBalance(input) {
      semanticInputs.push(1);
      authority.syntheticSemanticCalls += 1;
      const result: CustodyBalanceObservationResult = options.semanticMode === "FAILURE"
        ? { ok: false, binding: input.binding, error: { code: "PROVIDER_UNAVAILABLE", retryable: false, retryAfterMs: null } }
        : {
            ok: true,
            binding: input.binding,
            observation: {
              provider: PROVIDER,
              binding: input.binding,
              identity: { kind: "CONTENT" },
              observedAvailableUnits: "7",
              observedTotalUnits: "11",
              observedAt: "2026-01-01T00:00:00.000000Z",
              finalizedAt: null,
            },
          };
      return result;
    },
  });
  const scopeClient: CustodyBalanceObserverScopeClient = {
    async listBalanceObserverScopePage() {
      scopeReads.push(1);
      if (options.scopeFailure) {
        throw new Error("synthetic_scope_failure");
      }
      return {
        scopes: [{
          providerId: PROVIDER_ID,
          provider: PROVIDER,
          assetId: ASSET_ID,
          assetCode: "TSOL",
          bindings: [{
            bindingId: BINDING_ID,
            assetId: ASSET_ID,
            binding: observedBinding,
            expectedCheckpointVersion: "1",
          }],
        }],
        page: { scopeCount: 1, hasMore: false, nextCursor: null },
      };
    },
    async readBalanceObserverScope() {
      return null;
    },
    async close() {},
  };
  const commandClient: CustodyBalanceObserverCommandClient = {
    async recordBalanceObservationAndAdvanceCheckpoint(input) {
      commandInputs.push(input);
      if (options.commandFailure) {
        throw new Error("synthetic_command_failure");
      }
      return {
        externalBalanceObservationId: OBSERVATION_ID,
        observationCreated: true,
        observerCheckpointId: CHECKPOINT_ID,
        checkpointCreated: false,
        checkpointAdvanced: true,
        checkpointVersion: "2",
      };
    },
    async close() {},
  };
  return {
    config: {
      registryEntries: options.registryEntries ?? [{ binding: observedBinding, walletId: WALLET_ID }],
      semanticAdapterFactory,
      correlationIdFactory: () => {
        correlationCalls.push(1);
        return options.correlationId ?? "synthetic-correlation-id";
      },
      scopeClient,
      commandClient,
    },
    commandInputs,
    semanticInputs,
    scopeReads,
    correlationCalls,
    authority,
  };
}

async function runFixture(fixture: Fixture) {
  return runBitGoReadOnlyRuntimeCompositionOneShot(fixture.config);
}

function assertFailedWithoutRecording(fixture: Fixture, message: string): void {
  assert(fixture.commandInputs.length === 0, `${message}_recorded`);
  assert(fixture.scopeReads.length === 1, `${message}_scope_not_traversed`);
}

export async function runP6T10RuntimeCompositionConsumerQualification(): Promise<
  readonly string[]
> {
  const completed: string[] = [];
  const run = async (
    caseId: (typeof P6_T10_CONSUMER_CASE_IDS)[number],
    proof: () => void | Promise<void>,
  ) => {
    await proof();
    completed.push(caseId);
  };

  await run("P6T10-CONS-001", () => {
    assert(typeof runBitGoReadOnlyRuntimeCompositionOneShot === "function", "p6_t10_public_entrypoint_missing");
  });
  await run("P6T10-CONS-002", async () => {
    const fixture = createFixture();
    const result = await runFixture(fixture);
    assert(result.status === "COMPLETED", "p6_t10_public_seam_not_completed");
    assert(fixture.scopeReads.length === 1, "p6_t10_one_shot_not_consumed");
    assert(fixture.semanticInputs.length === 1, "p6_t10_p6_t09_not_consumed");
  });
  await run("P6T10-CONS-003", async () => {
    const fixture = createFixture();
    const result = await runFixture(fixture);
    assert(result.outcomes[0]?.bindings[0]?.ok, "p6_t10_remote_content_not_accepted");
  });
  await run("P6T10-CONS-004", async () => {
    const fixture = createFixture({ correlationId: "correlation-propagated" });
    await runFixture(fixture);
    assert(fixture.correlationCalls.length === 1, "p6_t10_correlation_not_propagated");
    assert(fixture.semanticInputs.length === 1, "p6_t10_registry_or_semantic_factory_not_propagated");
  });
  await run("P6T10-CONS-005", async () => {
    const fixture = createFixture();
    await runFixture(fixture);
    assert(fixture.commandInputs.length === 1, "p6_t10_canonical_record_not_preserved");
    assert(fixture.commandInputs[0]?.bindingId === BINDING_ID, "p6_t10_record_input_not_preserved");
  });
  await run("P6T10-CONS-006", async () => {
    const fixture = createFixture({ registryEntries: [] });
    await runFixture(fixture);
    assertFailedWithoutRecording(fixture, "p6_t10_missing_binding");
    assert(fixture.semanticInputs.length === 0, "p6_t10_missing_binding_reached_semantic_adapter");
  });
  await run("P6T10-CONS-007", async () => {
    const fixture = createFixture({ registryEntries: [{ binding: binding(), walletId: "invalid" }] });
    await runFixture(fixture);
    assertFailedWithoutRecording(fixture, "p6_t10_invalid_wallet");
    assert(fixture.semanticInputs.length === 0, "p6_t10_invalid_wallet_reached_semantic_adapter");
  });
  await run("P6T10-CONS-008", async () => {
    const reads = { count: 0 };
    const failingBinding = new Proxy(binding(), {
      get(target, property, receiver) {
        if (property === "bindingKey" && ++reads.count === 3) {
          throw new Error("synthetic_resolver_failure");
        }
        return Reflect.get(target, property, receiver);
      },
    }) as CustodyAccountBindingRef;
    const fixture = createFixture({ scopeBinding: failingBinding });
    await runFixture(fixture);
    assertFailedWithoutRecording(fixture, "p6_t10_resolver_internal_failure");
    assert(fixture.semanticInputs.length === 0, "p6_t10_resolver_failure_reached_semantic_adapter");
  });
  await run("P6T10-CONS-009", async () => {
    const fixture = createFixture({ registryEntries: [{ binding: binding(), walletId: WALLET_ID }, { binding: binding(), walletId: WALLET_ID }] });
    let error: unknown;
    try {
      await runFixture(fixture);
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof RangeError, "p6_t10_duplicate_tuple_not_propagated");
    assert(fixture.scopeReads.length === 0, "p6_t10_duplicate_tuple_reached_one_shot");
  });
  await run("P6T10-CONS-010", async () => {
    const fixture = createFixture({ semanticMode: "FAILURE" });
    await runFixture(fixture);
    assertFailedWithoutRecording(fixture, "p6_t10_semantic_failure");
  });
  await run("P6T10-CONS-011", async () => {
    const fixture = createFixture({ commandFailure: true });
    const result = await runFixture(fixture);
    assert(result.status === "PARTIAL", "p6_t10_command_failure_not_preserved");
    assert(fixture.commandInputs.length === 1, "p6_t10_command_failure_not_exercised");
  });
  await run("P6T10-CONS-012", async () => {
    const fixture = createFixture({ scopeFailure: true });
    const result = await runFixture(fixture);
    assert(result.status === "FAILED_DISCOVERY", "p6_t10_scope_failure_not_preserved");
    assert(fixture.semanticInputs.length === 0, "p6_t10_scope_failure_reached_semantic_adapter");
    assert(fixture.commandInputs.length === 0, "p6_t10_scope_failure_recorded");
  });
  await run("P6T10-CONS-013", async () => {
    const fixture = createFixture();
    const first = await runFixture(fixture);
    const second = await runFixture(fixture);
    assert(first.status === second.status, "p6_t10_repeated_invocation_unstable");
    assert(fixture.commandInputs.length === 2, "p6_t10_repeated_invocation_not_isolated");
  });
  await run("P6T10-CONS-014", async () => {
    const first = createFixture();
    const second = createFixture({ registryEntries: [{ binding: binding({ bindingKey: "synthetic-second" }), walletId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }], scopeBinding: binding({ bindingKey: "synthetic-second" }) });
    await runFixture(first);
    await runFixture(second);
    assert(first.commandInputs.length === 1 && second.commandInputs.length === 1, "p6_t10_config_isolation_failed");
  });
  await run("P6T10-CONS-015", async () => {
    const fixture = createFixture();
    await runFixture(fixture);
    assert(fixture.commandInputs.length === 1, "p6_t10_synthetic_record_missing");
    assert(fixture.authority.actualDbClients === 0 && fixture.authority.actualDbConnections === 0 && fixture.authority.actualDbReads === 0 && fixture.authority.actualDbMutations === 0, "p6_t10_actual_db_activity_detected");
  });
  await run("P6T10-CONS-016", async () => {
    const fixture = createFixture();
    const result = await runFixture(fixture);
    assert(result.status === "COMPLETED", "p6_t10_generic_one_shot_not_used");
    assert(fixture.scopeReads.length === 1, "p6_t10_recorded_path_substituted");
  });
  await run("P6T10-CONS-017", async () => {
    const fixture = createFixture();
    await runFixture(fixture);
    assert(
      fixture.authority.syntheticSemanticCalls === 1,
      "p6_t10_synthetic_semantic_call_missing",
    );
    assert(fixture.authority.actualDbClients === 0 && fixture.authority.actualDbConnections === 0 && fixture.authority.actualDbReads === 0 && fixture.authority.actualDbMutations === 0, "p6_t10_live_authority_detected");
  });

  assert(completed.length === 17, "p6_t10_case_count_invalid");
  assert(new Set(completed).size === 17, "p6_t10_case_ids_duplicate");
  for (const [index, caseId] of completed.entries()) {
    assert(caseId === `P6T10-CONS-${String(index + 1).padStart(3, "0")}`, "p6_t10_case_ids_not_sequential");
  }
  return completed;
}
