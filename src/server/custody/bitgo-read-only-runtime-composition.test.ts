import "server-only";

import {
  createBitGoReadOnlyRuntimeComposition,
  type BitGoReadOnlyRuntimeCompositionConfig,
} from "./bitgo-read-only-runtime-composition";
import type { BitGoReadOnlySemanticAdapterFactory } from "./bitgo-balance-observer-adapter";
import type {
  BitGoReadOnlyBalanceReadInput,
  BitGoReadOnlySemanticAdapter,
  BitGoReadOnlySemanticAdapterConfig,
} from "./bitgo-read-only-semantic-adapter";
import type { BitGoWalletIdBindingRegistryEntry } from "./bitgo-wallet-id-resolver";
import type {
  CustodyAccountBindingRef,
  CustodyBalanceObservationResult,
  CustodyObservationAdapterFactory,
  CustodyProviderRef,
} from "./provider-observation-contract";

export const P6_T09_RUNTIME_COMPOSITION_CASE_IDS = [
  "P6T09-COMP-001", "P6T09-COMP-002", "P6T09-COMP-003",
  "P6T09-COMP-004", "P6T09-COMP-005", "P6T09-COMP-006",
  "P6T09-COMP-007", "P6T09-COMP-008", "P6T09-COMP-009",
  "P6T09-COMP-010", "P6T09-COMP-011", "P6T09-COMP-012",
  "P6T09-COMP-013", "P6T09-COMP-014", "P6T09-COMP-015",
  "P6T09-COMP-016", "P6T09-COMP-017", "P6T09-COMP-018",
] as const;

const SYNTHETIC_WALLET_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND_SYNTHETIC_WALLET_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PROVIDER: CustodyProviderRef = {
  providerCode: "BITGO",
  providerType: "CUSTODY",
  capabilities: ["BALANCE_OBSERVATION"],
};

type SemanticMode = "SUCCESS" | "FAILURE";

type SemanticSpy = {
  readonly configurations: BitGoReadOnlySemanticAdapterConfig[];
  readonly inputs: BitGoReadOnlyBalanceReadInput[];
  readonly factory: BitGoReadOnlySemanticAdapterFactory;
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

function entry(
  overrides: Partial<BitGoWalletIdBindingRegistryEntry> = {},
): BitGoWalletIdBindingRegistryEntry {
  return {
    binding: binding(),
    walletId: SYNTHETIC_WALLET_ID,
    ...overrides,
  };
}

function success(
  value: BitGoReadOnlyBalanceReadInput,
): CustodyBalanceObservationResult {
  return {
    ok: true,
    binding: value.binding,
    observation: {
      provider: PROVIDER,
      binding: value.binding,
      identity: { kind: "CONTENT" },
      observedAvailableUnits: "7",
      observedTotalUnits: "11",
      observedAt: "2026-01-01T00:00:00.000000Z",
      finalizedAt: null,
    },
  };
}

function failure(
  value: BitGoReadOnlyBalanceReadInput,
): CustodyBalanceObservationResult {
  return {
    ok: false,
    binding: value.binding,
    error: {
      code: "PROVIDER_UNAVAILABLE",
      retryable: false,
      retryAfterMs: null,
    },
  };
}

function createSemanticSpy(mode: SemanticMode = "SUCCESS"): SemanticSpy {
  const configurations: BitGoReadOnlySemanticAdapterConfig[] = [];
  const inputs: BitGoReadOnlyBalanceReadInput[] = [];

  const factory: BitGoReadOnlySemanticAdapterFactory = (config) => {
    configurations.push(config);
    const adapter: BitGoReadOnlySemanticAdapter = {
      provider: PROVIDER,
      capabilities: ["BALANCE_OBSERVATION"],
      async readHealth() {
        return {
          provider: PROVIDER,
          status: "UNKNOWN",
          checkedAt: "2026-01-01T00:00:00.000000Z",
        };
      },
      async readBalance(value) {
        inputs.push(value);
        return mode === "SUCCESS" ? success(value) : failure(value);
      },
    };

    return adapter;
  };

  return { configurations, inputs, factory };
}

function compose(
  registryEntries: readonly BitGoWalletIdBindingRegistryEntry[],
  semanticAdapterFactory: BitGoReadOnlySemanticAdapterFactory,
  correlationIdFactory: () => string = () => "synthetic-correlation-id",
): CustodyObservationAdapterFactory {
  const config: BitGoReadOnlyRuntimeCompositionConfig = {
    registryEntries,
    semanticAdapterFactory,
    correlationIdFactory,
  };

  return createBitGoReadOnlyRuntimeComposition(config);
}

async function read(
  factory: CustodyObservationAdapterFactory,
  value: CustodyAccountBindingRef,
): Promise<CustodyBalanceObservationResult> {
  const results = await factory(PROVIDER).readBalances([value]);
  const [result] = results;
  assert(result !== undefined, "p6_t09_result_missing");
  return result;
}

function assertObserverFailure(
  result: CustodyBalanceObservationResult,
): void {
  assert(!result.ok, "p6_t09_expected_observer_failure");
  assert(
    result.error.code === "UNEXPECTED_RESULT",
    "p6_t09_observer_failure_not_preserved",
  );
}

export async function runP6T09RuntimeCompositionQualification(): Promise<
  readonly string[]
> {
  const completed: string[] = [];
  const run = async (
    caseId: (typeof P6_T09_RUNTIME_COMPOSITION_CASE_IDS)[number],
    proof: () => void | Promise<void>,
  ) => {
    await proof();
    completed.push(caseId);
  };

  await run("P6T09-COMP-001", () => {
    const spy = createSemanticSpy();
    const factory = compose([entry()], spy.factory);
    assert(typeof factory === "function", "p6_t09_factory_not_created");
    assert(spy.configurations.length === 0, "p6_t09_adapter_created_too_early");
  });

  await run("P6T09-COMP-002", async () => {
    const spy = createSemanticSpy();
    const result = await read(compose([entry()], spy.factory), binding());
    assert(result.ok, "p6_t09_registry_entries_not_consumed");
    assert(spy.inputs[0]?.walletId === SYNTHETIC_WALLET_ID, "p6_t09_wallet_id_not_resolved");
  });

  await run("P6T09-COMP-003", async () => {
    const spy = createSemanticSpy();
    const result = await read(compose([entry()], spy.factory), binding());
    assert(result.ok, "p6_t09_exact_flow_failed");
    assert(spy.inputs[0]?.walletId === SYNTHETIC_WALLET_ID, "p6_t09_wallet_id_not_forwarded");
    assert(result.observation.observedAvailableUnits === "7", "p6_t09_success_not_preserved");
  });

  await run("P6T09-COMP-004", async () => {
    const spy = createSemanticSpy();
    assertObserverFailure(await read(compose([entry()], spy.factory), binding({ bindingKey: "synthetic-primary " })));
    assert(spy.inputs.length === 0, "p6_t09_binding_key_fallback_used");
  });

  await run("P6T09-COMP-005", async () => {
    const spy = createSemanticSpy();
    assertObserverFailure(await read(compose([entry()], spy.factory), binding({ providerCode: "bitgo" })));
    assert(spy.inputs.length === 0, "p6_t09_provider_fallback_used");
  });

  await run("P6T09-COMP-006", async () => {
    const spy = createSemanticSpy();
    const result = await read(compose([entry()], spy.factory), binding({ assetCode: "tsol" }));
    assert(!result.ok && result.error.code === "UNSUPPORTED_ASSET", "p6_t09_asset_exactness_lost");
    assert(spy.inputs.length === 0, "p6_t09_asset_fallback_used");
  });

  await run("P6T09-COMP-007", async () => {
    const spy = createSemanticSpy();
    assertObserverFailure(await read(compose([entry()], spy.factory), binding({ accountRole: "treasury" })));
    assert(spy.inputs.length === 0, "p6_t09_role_fallback_used");
  });

  await run("P6T09-COMP-008", async () => {
    const spy = createSemanticSpy();
    assertObserverFailure(await read(compose([], spy.factory), binding()));
    assert(spy.inputs.length === 0, "p6_t09_missing_binding_reached_semantic_adapter");
  });

  await run("P6T09-COMP-009", async () => {
    const spy = createSemanticSpy();
    assertObserverFailure(await read(compose([entry({ walletId: "not-a-wallet-id" })], spy.factory), binding()));
    assert(spy.inputs.length === 0, "p6_t09_invalid_wallet_reached_semantic_adapter");
  });

  await run("P6T09-COMP-010", async () => {
    let bindingKeyReads = 0;
    const failingBinding = new Proxy(binding(), {
      get(target, property, receiver) {
        if (property === "bindingKey") {
          bindingKeyReads += 1;
          if (bindingKeyReads === 3) {
            throw new Error("synthetic_resolver_failure");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    }) as CustodyAccountBindingRef;
    const spy = createSemanticSpy();
    assertObserverFailure(await read(compose([entry()], spy.factory), failingBinding));
    assert(spy.inputs.length === 0, "p6_t09_resolver_failure_reached_semantic_adapter");
  });

  await run("P6T09-COMP-011", () => {
    let error: unknown;
    try {
      compose([entry(), entry()], createSemanticSpy().factory);
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof RangeError, "p6_t09_duplicate_error_type_invalid");
    assert(error.message === "bitgo_wallet_id_resolver_duplicate_binding", "p6_t09_duplicate_error_message_invalid");
  });

  await run("P6T09-COMP-012", async () => {
    const result = await read(compose([entry()], createSemanticSpy("SUCCESS").factory), binding());
    assert(result.ok && result.observation.observedTotalUnits === "11", "p6_t09_downstream_success_not_preserved");
  });

  await run("P6T09-COMP-013", async () => {
    const result = await read(compose([entry()], createSemanticSpy("FAILURE").factory), binding());
    assert(!result.ok && result.error.code === "PROVIDER_UNAVAILABLE", "p6_t09_downstream_failure_not_preserved");
  });

  await run("P6T09-COMP-014", async () => {
    const spy = createSemanticSpy();
    const factory = compose([entry()], spy.factory);
    const first = await read(factory, binding());
    const second = await read(factory, binding());
    assert(JSON.stringify(first) === JSON.stringify(second), "p6_t09_repeated_invocation_unstable");
    assert(spy.inputs.length === 2, "p6_t09_repeated_invocation_not_composed");
  });

  await run("P6T09-COMP-015", async () => {
    const firstSpy = createSemanticSpy();
    const secondSpy = createSemanticSpy();
    const first = await read(compose([entry()], firstSpy.factory), binding());
    const second = await read(
      compose([entry({ binding: binding({ bindingKey: "synthetic-secondary" }), walletId: SECOND_SYNTHETIC_WALLET_ID })], secondSpy.factory),
      binding({ bindingKey: "synthetic-secondary" }),
    );
    assert(first.ok && firstSpy.inputs[0]?.walletId === SYNTHETIC_WALLET_ID, "p6_t09_first_composition_leaked");
    assert(second.ok && secondSpy.inputs[0]?.walletId === SECOND_SYNTHETIC_WALLET_ID, "p6_t09_second_composition_leaked");
  });

  await run("P6T09-COMP-016", async () => {
    const entries = [{ binding: binding(), walletId: SYNTHETIC_WALLET_ID }];
    const factory = compose(entries, createSemanticSpy().factory);
    entries[0].binding.bindingKey = "synthetic-mutated";
    entries[0].walletId = SECOND_SYNTHETIC_WALLET_ID;
    const result = await read(factory, binding());
    assert(result.ok, "p6_t09_caller_registry_snapshot_not_preserved");
  });

  await run("P6T09-COMP-017", () => {
    const spy = createSemanticSpy();
    const factory = compose([entry()], spy.factory);
    assert(spy.configurations.length === 0, "p6_t09_construction_has_semantic_side_effect");
    assert(spy.inputs.length === 0, "p6_t09_construction_has_provider_side_effect");
    assert(typeof factory === "function", "p6_t09_construction_failed");
  });

  await run("P6T09-COMP-018", () => {
    const spy = createSemanticSpy();
    const factory = compose([entry()], spy.factory);
    factory(PROVIDER);
    const config = spy.configurations[0];
    assert(config !== undefined, "p6_t09_semantic_adapter_not_constructed");
    assert(config.credentialReference === null, "p6_t09_credential_reference_not_null");
    assert(config.authorizedExecutionContext === false, "p6_t09_authorized_context_not_false");
    assert(spy.inputs.length === 0, "p6_t09_authority_guard_has_provider_activity");
  });

  assert(completed.length === 18, "p6_t09_case_count_invalid");
  assert(new Set(completed).size === 18, "p6_t09_case_ids_duplicate");
  for (const [index, caseId] of completed.entries()) {
    assert(
      caseId === `P6T09-COMP-${String(index + 1).padStart(3, "0")}`,
      "p6_t09_case_ids_not_sequential",
    );
  }

  return completed;
}
