import "server-only";

import {
  createBitGoAuthorizedReadOnlyRuntimeComposition,
  type BitGoAuthorizedReadOnlyRuntimeCompositionConfig,
} from "./bitgo-authorized-read-only-runtime-composition";
import type { BitGoBalanceObserverCorrelationIdFactory } from "./bitgo-balance-observer-adapter";
import {
  loadActiveCustodyWalletIdRegistrySnapshot,
  type CustodyWalletIdRegistryClientConfig,
} from "./custody-wallet-id-registry-client";
import { createBitGoWalletIdResolver } from "./bitgo-wallet-id-resolver";
import type {
  CustodyAccountBindingRef,
  CustodyObservationAdapter,
  CustodyObservationAdapterFactory,
  CustodyProviderRef,
} from "./provider-observation-contract";
import type { ProviderCredentialReferenceRegistryClientConfig } from "../provider-security/provider-credential-reference-registry-client";

const BITGO_PROVIDER_CODE = "BITGO";
const BITGO_PROVIDER_TYPE = "CUSTODY";
const TSOL_ASSET_CODE = "TSOL";
const MAX_BINDING_FIELD_LENGTH = 128;

const FIXED_PROVIDER_REF: CustodyProviderRef = Object.freeze({
  providerCode: BITGO_PROVIDER_CODE,
  providerType: BITGO_PROVIDER_TYPE,
  capabilities: ["BALANCE_OBSERVATION"] as const,
});

export type BitGoControlledTestActivationConfig = Readonly<{
  walletIdRegistryConfig: CustodyWalletIdRegistryClientConfig;
  credentialReferenceRegistryConfig: ProviderCredentialReferenceRegistryClientConfig;
  bindingKey: string;
  accountRole: string;
  correlationIdFactory?: BitGoBalanceObserverCorrelationIdFactory;
}>;

export type BitGoControlledTestActivationGate = Readonly<{
  execute: boolean;
  liveEnvironmentOptIn: string | undefined;
}>;

export type BitGoControlledTestActivationSafeCode =
  | "LIVE_GATE_REQUIRED"
  | "ACTIVATION_INPUT_INVALID"
  | "WALLET_REGISTRY_UNAVAILABLE"
  | "BINDING_NOT_FOUND"
  | "BINDING_AMBIGUOUS"
  | "AUTHORIZATION_COMPOSITION_FAILED"
  | "BALANCE_READ_FAILED"
  | "UNEXPECTED_RESULT";

export type BitGoControlledTestActivationPrerequisiteResult =
  | Readonly<{
      ok: true;
      ready: true;
      environment: "TEST";
      selectedBindingCount: 1;
    }>
  | Readonly<{
      ok: false;
      ready: false;
      environment: "TEST";
      selectedBindingCount: 0;
      safeCode: BitGoControlledTestActivationSafeCode;
    }>;

export type BitGoControlledTestActivationResult =
  | Readonly<{
      ok: true;
      attempted: true;
      environment: "TEST";
      logicalReadCount: 1;
      semanticValidated: true;
      outcome: "SUCCESS";
    }>
  | Readonly<{
      ok: false;
      attempted: boolean;
      environment: "TEST";
      logicalReadCount: 0 | 1;
      semanticValidated: false;
      outcome: "DENIED" | "FAILED";
      safeCode: BitGoControlledTestActivationSafeCode;
    }>;

export type BitGoControlledTestActivationTestDependencies = Readonly<{
  loadActiveCustodyWalletIdRegistrySnapshot?: typeof loadActiveCustodyWalletIdRegistrySnapshot;
  createBitGoAuthorizedReadOnlyRuntimeComposition?: typeof createBitGoAuthorizedReadOnlyRuntimeComposition;
}>;

type PreparedActivation = Readonly<{
  adapter: CustodyObservationAdapter;
  binding: CustodyAccountBindingRef;
}>;

type PreparationResult =
  | Readonly<{ ok: true; prepared: PreparedActivation }>
  | Readonly<{ ok: false; safeCode: BitGoControlledTestActivationSafeCode }>;

export async function verifyBitGoControlledTestActivationPrerequisites(
  config: BitGoControlledTestActivationConfig,
  testDependencies: BitGoControlledTestActivationTestDependencies = {},
): Promise<BitGoControlledTestActivationPrerequisiteResult> {
  const prepared = await prepareActivation(config, testDependencies);

  if (!prepared.ok) {
    return prerequisiteFailure(prepared.safeCode);
  }

  return Object.freeze({
    ok: true,
    ready: true,
    environment: "TEST",
    selectedBindingCount: 1,
  });
}

export async function runBitGoControlledTestActivation(
  config: BitGoControlledTestActivationConfig,
  gate: BitGoControlledTestActivationGate,
  testDependencies: BitGoControlledTestActivationTestDependencies = {},
): Promise<BitGoControlledTestActivationResult> {
  if (!hasLiveGate(gate)) {
    return activationFailure(false, 0, "DENIED", "LIVE_GATE_REQUIRED");
  }

  const prepared = await prepareActivation(config, testDependencies);

  if (!prepared.ok) {
    return activationFailure(true, 0, "FAILED", prepared.safeCode);
  }

  try {
    const results = await prepared.prepared.adapter.readBalances([
      prepared.prepared.binding,
    ]);

    if (results.length !== 1 || !results[0]?.ok) {
      return activationFailure(true, 1, "FAILED", "BALANCE_READ_FAILED");
    }

    return Object.freeze({
      ok: true,
      attempted: true,
      environment: "TEST",
      logicalReadCount: 1,
      semanticValidated: true,
      outcome: "SUCCESS",
    });
  } catch {
    return activationFailure(true, 1, "FAILED", "BALANCE_READ_FAILED");
  }
}

async function prepareActivation(
  config: BitGoControlledTestActivationConfig,
  testDependencies: BitGoControlledTestActivationTestDependencies,
): Promise<PreparationResult> {
  if (!isSafeBindingField(config.bindingKey) || !isSafeBindingField(config.accountRole)) {
    return { ok: false, safeCode: "ACTIVATION_INPUT_INVALID" };
  }

  const loadSnapshot =
    testDependencies.loadActiveCustodyWalletIdRegistrySnapshot ??
    loadActiveCustodyWalletIdRegistrySnapshot;
  let snapshot;

  try {
    snapshot = await loadSnapshot(config.walletIdRegistryConfig, "TEST");
  } catch {
    return { ok: false, safeCode: "WALLET_REGISTRY_UNAVAILABLE" };
  }

  const matches = snapshot.filter(
    (entry) =>
      entry.binding.providerCode === BITGO_PROVIDER_CODE &&
      entry.binding.assetCode === TSOL_ASSET_CODE &&
      entry.binding.bindingKey === config.bindingKey &&
      entry.binding.accountRole === config.accountRole,
  );

  if (matches.length === 0) {
    return { ok: false, safeCode: "BINDING_NOT_FOUND" };
  }
  if (matches.length !== 1) {
    return { ok: false, safeCode: "BINDING_AMBIGUOUS" };
  }

  try {
    const walletIdResolver = createBitGoWalletIdResolver(matches);
    const createComposition =
      testDependencies.createBitGoAuthorizedReadOnlyRuntimeComposition ??
      createBitGoAuthorizedReadOnlyRuntimeComposition;
    const compositionConfig: BitGoAuthorizedReadOnlyRuntimeCompositionConfig = {
      credentialReferenceRegistryConfig: config.credentialReferenceRegistryConfig,
      walletIdResolver,
      correlationIdFactory: config.correlationIdFactory,
    };
    const factory: CustodyObservationAdapterFactory = await createComposition(
      compositionConfig,
    );

    return {
      ok: true,
      prepared: {
        adapter: factory(FIXED_PROVIDER_REF),
        binding: matches[0].binding,
      },
    };
  } catch {
    return { ok: false, safeCode: "AUTHORIZATION_COMPOSITION_FAILED" };
  }
}

function hasLiveGate(gate: BitGoControlledTestActivationGate): boolean {
  return gate.execute === true && gate.liveEnvironmentOptIn === "YES";
}

function isSafeBindingField(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= MAX_BINDING_FIELD_LENGTH
  );
}

function prerequisiteFailure(
  safeCode: BitGoControlledTestActivationSafeCode,
): BitGoControlledTestActivationPrerequisiteResult {
  return Object.freeze({
    ok: false,
    ready: false,
    environment: "TEST",
    selectedBindingCount: 0,
    safeCode,
  });
}

function activationFailure(
  attempted: boolean,
  logicalReadCount: 0 | 1,
  outcome: "DENIED" | "FAILED",
  safeCode: BitGoControlledTestActivationSafeCode,
): BitGoControlledTestActivationResult {
  return Object.freeze({
    ok: false,
    attempted,
    environment: "TEST",
    logicalReadCount,
    semanticValidated: false,
    outcome,
    safeCode,
  });
}
