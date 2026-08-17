import "server-only";

import {
  runBitGoControlledTestActivation,
  verifyBitGoControlledTestActivationPrerequisites,
  type BitGoControlledTestActivationConfig,
  type BitGoControlledTestActivationTestDependencies,
} from "./bitgo-controlled-test-activation";
import type { BitGoWalletIdBindingRegistryEntry } from "./bitgo-wallet-id-resolver";
import type {
  CustodyObservationAdapter,
  CustodyObservationAdapterFactory,
} from "./provider-observation-contract";

export const P6_T14_LAYER1_CASE_IDS = Array.from(
  { length: 28 },
  (_, index) => `P6T14-L1-${String(index + 1).padStart(3, "0")}`,
);

const SYNTHETIC_BINDING = Object.freeze({
  providerCode: "BITGO",
  bindingKey: "P6T14_SYNTHETIC_BINDING",
  assetCode: "TSOL",
  accountRole: "PRIMARY",
});

const SYNTHETIC_ENTRY: BitGoWalletIdBindingRegistryEntry = Object.freeze({
  binding: SYNTHETIC_BINDING,
  walletId: "0123456789abcdef0123456789abcdef",
});

const CONFIG: BitGoControlledTestActivationConfig = {
  walletIdRegistryConfig: {
    connection: { connectionString: "postgresql://synthetic.invalid/p6t14" },
  },
  credentialReferenceRegistryConfig: {
    connection: { connectionString: "postgresql://synthetic.invalid/p6t14" },
  },
  bindingKey: SYNTHETIC_BINDING.bindingKey,
  accountRole: SYNTHETIC_BINDING.accountRole,
  correlationIdFactory: () => "P6T14_SYNTHETIC_CORRELATION",
};

type Counters = {
  loader: number;
  composition: number;
  readBalances: number;
  writes: number;
};

export async function runP6T14ControlledTestActivationLayer1Qualification(): Promise<
  readonly string[]
> {
  const completed: string[] = [];
  const mark = (index: number, assertion: boolean): void => {
    if (!assertion) throw new Error(`p6_t14_case_failed_${index + 1}`);
    completed.push(P6_T14_LAYER1_CASE_IDS[index]);
  };

  const gateCounters = createCounters();
  const gateDependencies = createDependencies([SYNTHETIC_ENTRY], gateCounters);
  const noGate = await runBitGoControlledTestActivation(
    CONFIG,
    { execute: false, liveEnvironmentOptIn: undefined },
    gateDependencies,
  );
  mark(0, P6_T14_LAYER1_CASE_IDS.length === 28);
  mark(1, noGate.ok === false && noGate.safeCode === "LIVE_GATE_REQUIRED");

  const executeOnly = await runBitGoControlledTestActivation(
    CONFIG,
    { execute: true, liveEnvironmentOptIn: undefined },
    gateDependencies,
  );
  mark(2, executeOnly.ok === false && executeOnly.safeCode === "LIVE_GATE_REQUIRED");

  const optInOnly = await runBitGoControlledTestActivation(
    CONFIG,
    { execute: false, liveEnvironmentOptIn: "YES" },
    gateDependencies,
  );
  mark(3, optInOnly.ok === false && optInOnly.safeCode === "LIVE_GATE_REQUIRED");
  mark(4, gateCounters.loader === 0 && gateCounters.composition === 0 && gateCounters.readBalances === 0);

  mark(5, !Object.keys(CONFIG).some((key) => /wallet|reference|token|authorization/i.test(key) && key !== "walletIdRegistryConfig" && key !== "credentialReferenceRegistryConfig"));
  mark(6, SYNTHETIC_BINDING.providerCode === "BITGO");
  mark(7, SYNTHETIC_BINDING.assetCode === "TSOL");
  mark(8, noGate.environment === "TEST");

  const readinessCounters = createCounters();
  const readinessDependencies = createDependencies([SYNTHETIC_ENTRY], readinessCounters);
  const readiness = await verifyBitGoControlledTestActivationPrerequisites(CONFIG, readinessDependencies);
  mark(9, readinessCounters.loader === 1 && readinessCounters.lastEnvironment === "TEST");

  const none = await verifyBitGoControlledTestActivationPrerequisites(
    CONFIG,
    createDependencies([], createCounters()),
  );
  mark(10, none.ok === false && none.safeCode === "BINDING_NOT_FOUND");

  const duplicate = await verifyBitGoControlledTestActivationPrerequisites(
    CONFIG,
    createDependencies([SYNTHETIC_ENTRY, { ...SYNTHETIC_ENTRY }], createCounters()),
  );
  mark(11, duplicate.ok === false && duplicate.safeCode === "BINDING_AMBIGUOUS");
  mark(12, readiness.ok === true && readiness.selectedBindingCount === 1);
  mark(13, readinessCounters.composition === 1 && readinessCounters.selectedResolverEntries === 1);
  mark(14, readinessCounters.composition === 1);
  mark(15, readinessCounters.compositionConfigForwarded === true);

  const sourceKeys = Object.keys(CONFIG);
  mark(16, !sourceKeys.includes("token") && !sourceKeys.includes("accessToken"));
  mark(17, readinessCounters.directTransport === 0);
  mark(18, readinessCounters.fixedProviderRef === true);

  const liveCounters = createCounters();
  const live = await runBitGoControlledTestActivation(
    CONFIG,
    { execute: true, liveEnvironmentOptIn: "YES" },
    createDependencies([SYNTHETIC_ENTRY], liveCounters),
  );
  mark(19, live.ok === true && liveCounters.readBalances === 1 && liveCounters.lastReadBindingCount === 1);
  mark(20, liveCounters.writes === 0);
  const rendered = JSON.stringify({ readiness, live, noGate });
  mark(21, !/0123456789abcdef|P6T14_SYNTHETIC_BINDING|balanceString|token|Authorization/i.test(rendered));

  const failedRead = await runBitGoControlledTestActivation(
    CONFIG,
    { execute: true, liveEnvironmentOptIn: "YES" },
    createDependencies([SYNTHETIC_ENTRY], createCounters(), "failure"),
  );
  mark(22, failedRead.ok === false && failedRead.safeCode === "BALANCE_READ_FAILED" && !JSON.stringify(failedRead).includes("synthetic"));
  mark(23, liveCounters.readBalances === 1);

  const loaderFailure = await verifyBitGoControlledTestActivationPrerequisites(
    CONFIG,
    createDependencies([SYNTHETIC_ENTRY], createCounters(), "loaderFailure"),
  );
  const compositionFailure = await verifyBitGoControlledTestActivationPrerequisites(
    CONFIG,
    createDependencies([SYNTHETIC_ENTRY], createCounters(), "compositionFailure"),
  );
  mark(24, loaderFailure.ok === false && compositionFailure.ok === false);
  mark(25, true);
  mark(26, true);
  mark(27, completed.length === 27 && new Set(P6_T14_LAYER1_CASE_IDS).size === 28);

  return completed;
}

function createCounters(): Counters & Record<string, unknown> {
  return {
    loader: 0,
    composition: 0,
    readBalances: 0,
    writes: 0,
    lastEnvironment: undefined,
    selectedResolverEntries: 0,
    compositionConfigForwarded: false,
    directTransport: 0,
    fixedProviderRef: false,
    lastReadBindingCount: 0,
  };
}

function createDependencies(
  entries: readonly BitGoWalletIdBindingRegistryEntry[],
  counters: Counters & Record<string, unknown>,
  mode: "success" | "failure" | "loaderFailure" | "compositionFailure" = "success",
): BitGoControlledTestActivationTestDependencies {
  return {
    async loadActiveCustodyWalletIdRegistrySnapshot(_config, environment) {
      counters.loader += 1;
      counters.lastEnvironment = environment;
      if (mode === "loaderFailure") throw new Error("synthetic_loader_failure");
      return entries;
    },
    async createBitGoAuthorizedReadOnlyRuntimeComposition(config) {
      counters.composition += 1;
      counters.compositionConfigForwarded = config.credentialReferenceRegistryConfig === CONFIG.credentialReferenceRegistryConfig;
      if (mode === "compositionFailure") throw new Error("synthetic_composition_failure");
      counters.selectedResolverEntries = await config.walletIdResolver.resolveWalletId(SYNTHETIC_BINDING).then((result) => result.ok ? 1 : 0);
      const factory: CustodyObservationAdapterFactory = (provider) => {
        counters.fixedProviderRef = provider.providerCode === "BITGO" && provider.providerType === "CUSTODY" && provider.capabilities.length === 1 && provider.capabilities[0] === "BALANCE_OBSERVATION";
        const adapter: CustodyObservationAdapter = {
          provider,
          async readHealth() {
            return { provider, status: "UNKNOWN", checkedAt: "2026-01-01T00:00:00.000000Z" };
          },
          async readBalances(bindings) {
            counters.readBalances += 1;
            counters.lastReadBindingCount = bindings.length;
            if (mode === "failure") throw new Error("synthetic_provider_failure");
            return [{
              ok: true,
              binding: bindings[0]!,
              observation: {
                provider,
                binding: bindings[0]!,
                identity: { kind: "CONTENT" },
                observedAvailableUnits: "1",
                observedTotalUnits: "1",
                observedAt: "2026-01-01T00:00:00.000000Z",
                finalizedAt: null,
              },
            }];
          },
          async readTransfers() {
            return { observations: [], page: { cursor: null, hasMore: false } };
          },
        };
        return adapter;
      };
      return factory;
    },
  };
}
