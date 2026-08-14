import "server-only";

import {
  normalizeAtomicUnits,
  normalizeUtcMicrosecondTimestamp,
} from "./balance-observation-normalization";
import type {
  CustodyAccountBindingRef,
  CustodyBalanceObservationError,
  CustodyBalanceObservationErrorCode,
  CustodyBalanceObservationResult,
  CustodyObservationCapability,
  CustodyProviderHealth,
  CustodyProviderHealthStatus,
  CustodyProviderRef,
} from "./provider-observation-contract";
import { executeApprovedProviderRequest } from "../provider-security/provider-security-transport";
import type {
  ApprovedProviderRequestDescriptor,
  CredentialReference,
  ProviderSecurityResult,
  TransportFailure,
} from "../provider-security/provider-security-types";

const BITGO_PROVIDER_CODE = "BITGO";
const BITGO_TEST_ENVIRONMENT = "TEST";
const BITGO_TSOL_COIN = "tsol";
const BALANCE_OPERATION_ID = "BITGO_TSOL_WALLET_GET_BALANCE";
const WALLET_ID_PATTERN = /^[0-9a-f]{32}$/;
const BALANCE_CAPABILITIES: readonly CustodyObservationCapability[] = [
  "BALANCE_OBSERVATION",
];

export type ProviderRequestExecutor = typeof executeApprovedProviderRequest;

export type BitGoReadOnlySemanticAdapterConfig = {
  provider: Omit<CustodyProviderRef, "capabilities">;
  credentialReference: CredentialReference | null;
  authorizedExecutionContext: boolean;
  executor?: ProviderRequestExecutor;
  now?: () => Date;
};

export type BitGoReadOnlyBalanceReadInput = {
  binding: CustodyAccountBindingRef;
  walletId: string;
  correlationId: string;
  signal?: AbortSignal;
};

export type BitGoReadOnlySemanticAdapter = {
  readonly provider: CustodyProviderRef;
  readonly capabilities: readonly CustodyObservationCapability[];
  readHealth(): Promise<CustodyProviderHealth>;
  readBalance(
    input: BitGoReadOnlyBalanceReadInput,
  ): Promise<CustodyBalanceObservationResult>;
};

type ParsedWalletBalance = {
  totalUnits: string;
  availableUnits: string;
};

type SemanticFailure = {
  code: CustodyBalanceObservationErrorCode;
};

export function createBitGoReadOnlySemanticAdapter(
  config: BitGoReadOnlySemanticAdapterConfig,
): BitGoReadOnlySemanticAdapter {
  if (config.provider.providerCode !== BITGO_PROVIDER_CODE) {
    throw new RangeError("bitgo_provider_code_required");
  }

  return new BitGoReadOnlySemanticAdapterImpl({
    provider: {
      ...config.provider,
      capabilities: BALANCE_CAPABILITIES,
    },
    credentialReference: config.credentialReference,
    authorizedExecutionContext: config.authorizedExecutionContext,
    executor: config.executor ?? executeApprovedProviderRequest,
    now: config.now ?? (() => new Date()),
  });
}

class BitGoReadOnlySemanticAdapterImpl
  implements BitGoReadOnlySemanticAdapter
{
  readonly provider: CustodyProviderRef;
  readonly capabilities = BALANCE_CAPABILITIES;

  private healthStatus: CustodyProviderHealthStatus = "UNKNOWN";
  private readonly credentialReference: CredentialReference | null;
  private readonly authorizedExecutionContext: boolean;
  private readonly executor: ProviderRequestExecutor;
  private readonly now: () => Date;

  constructor(config: {
    provider: CustodyProviderRef;
    credentialReference: CredentialReference | null;
    authorizedExecutionContext: boolean;
    executor: ProviderRequestExecutor;
    now: () => Date;
  }) {
    this.provider = config.provider;
    this.credentialReference = config.credentialReference;
    this.authorizedExecutionContext = config.authorizedExecutionContext;
    this.executor = config.executor;
    this.now = config.now;
  }

  async readHealth(): Promise<CustodyProviderHealth> {
    return {
      provider: this.provider,
      status: this.healthStatus,
      checkedAt: normalizeUtcMicrosecondTimestamp(this.now().toISOString()),
    };
  }

  async readBalance(
    input: BitGoReadOnlyBalanceReadInput,
  ): Promise<CustodyBalanceObservationResult> {
    if (!WALLET_ID_PATTERN.test(input.walletId)) {
      this.healthStatus = "UNKNOWN";
      return failure(input.binding, "UNEXPECTED_RESULT", false, null);
    }

    const result = await this.executor({
      environment: BITGO_TEST_ENVIRONMENT,
      descriptor: createBalanceDescriptor(input.walletId),
      credentialReference: this.credentialReference,
      authorizedExecutionContext: this.authorizedExecutionContext,
      correlationId: input.correlationId,
      signal: input.signal,
    });

    if (!result.ok) {
      const mapped = mapSecurityFailure(result);
      this.healthStatus = mapped.health;
      return failure(
        input.binding,
        mapped.code,
        mapped.retryable,
        mapped.retryAfterMs,
      );
    }

    const parsed = parseWalletBalance(result.json, input.walletId);

    if ("code" in parsed) {
      this.healthStatus = "UNKNOWN";
      return failure(input.binding, parsed.code, false, null);
    }

    this.healthStatus = "AVAILABLE";
    return {
      ok: true,
      binding: input.binding,
      observation: {
        provider: this.provider,
        binding: input.binding,
        identity: { kind: "CONTENT" },
        observedAvailableUnits: parsed.availableUnits,
        observedTotalUnits: parsed.totalUnits,
        observedAt: normalizeUtcMicrosecondTimestamp(this.now().toISOString()),
        finalizedAt: null,
      },
    };
  }
}

function createBalanceDescriptor(
  walletId: string,
): ApprovedProviderRequestDescriptor {
  return {
    operationId: BALANCE_OPERATION_ID,
    method: "GET",
    relativePath: `/api/v2/tsol/wallet/${walletId}`,
    query: { includeBalance: "true" },
    bodyAllowed: false,
    retrySafe: true,
    responseMode: "JSON",
  };
}

function parseWalletBalance(
  value: unknown,
  walletId: string,
): ParsedWalletBalance | SemanticFailure {
  if (!isRecord(value)) {
    return { code: "UNEXPECTED_RESULT" };
  }

  if (
    !Object.hasOwn(value, "id") ||
    !Object.hasOwn(value, "coin") ||
    !Object.hasOwn(value, "balanceString") ||
    !Object.hasOwn(value, "spendableBalanceString")
  ) {
    return { code: "MISSING_RESULT" };
  }

  const { id, coin, balanceString, spendableBalanceString } = value;

  if (typeof id !== "string" || typeof coin !== "string") {
    return { code: "UNEXPECTED_RESULT" };
  }

  if (id !== walletId) {
    return { code: "UNEXPECTED_RESULT" };
  }

  if (coin !== BITGO_TSOL_COIN) {
    return { code: "UNSUPPORTED_ASSET" };
  }

  if (
    typeof balanceString !== "string" ||
    typeof spendableBalanceString !== "string"
  ) {
    return { code: "MALFORMED_AMOUNT" };
  }

  try {
    const totalUnits = normalizeAtomicUnits(balanceString);
    const availableUnits = normalizeAtomicUnits(spendableBalanceString);

    if (Object.hasOwn(value, "confirmedBalanceString")) {
      const confirmedBalanceString = value.confirmedBalanceString;

      if (typeof confirmedBalanceString !== "string") {
        return { code: "MALFORMED_AMOUNT" };
      }

      normalizeAtomicUnits(confirmedBalanceString);
    }

    return { totalUnits, availableUnits };
  } catch {
    return { code: "MALFORMED_AMOUNT" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapSecurityFailure(result: Extract<ProviderSecurityResult, { ok: false }>): {
  code: CustodyBalanceObservationErrorCode;
  retryable: boolean;
  retryAfterMs: number | null;
  health: CustodyProviderHealthStatus;
} {
  if (result.error.kind === "CREDENTIAL_FAILURE") {
    return {
      code: "UNEXPECTED_RESULT",
      retryable: false,
      retryAfterMs: null,
      health: "UNKNOWN",
    };
  }

  return mapTransportFailure(result.error);
}

function mapTransportFailure(error: TransportFailure): {
  code: CustodyBalanceObservationErrorCode;
  retryable: boolean;
  retryAfterMs: number | null;
  health: CustodyProviderHealthStatus;
} {
  if (error.code === "PROVIDER_TIMEOUT" || error.code === "PROVIDER_ABORTED") {
    return {
      code: "TIMEOUT",
      retryable: error.retryable,
      retryAfterMs: null,
      health: "UNAVAILABLE",
    };
  }

  if (error.code === "PROVIDER_RATE_LIMITED") {
    return {
      code: "RATE_LIMITED",
      retryable: error.retryable,
      retryAfterMs: null,
      health: "DEGRADED",
    };
  }

  const unavailable = error.code === "PROVIDER_UNAVAILABLE";
  const health = unavailable && (error.safeStatus === null || error.safeStatus === 408 || (error.safeStatus !== null && error.safeStatus >= 500))
    ? "UNAVAILABLE"
    : "UNKNOWN";

  return {
    code: "PROVIDER_UNAVAILABLE",
    retryable: error.retryable,
    retryAfterMs: null,
    health,
  };
}

function failure(
  binding: CustodyAccountBindingRef,
  code: CustodyBalanceObservationErrorCode,
  retryable: boolean,
  retryAfterMs: number | null,
): CustodyBalanceObservationResult {
  const error: CustodyBalanceObservationError = {
    code,
    retryable,
    retryAfterMs,
  };

  return { ok: false, binding, error };
}
