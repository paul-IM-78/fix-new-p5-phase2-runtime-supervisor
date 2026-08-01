import "server-only";

export type CustodyObservationCapability =
  | "BALANCE_OBSERVATION"
  | "TRANSFER_OBSERVATION"
  | "TRANSFER_LOOKUP"
  | "PAYOUT_SUBMISSION"
  | "WEBHOOK_INGESTION";

export type CustodyObservationDirection = "INBOUND" | "OUTBOUND";

export type CustodyObservationStatus =
  | "PENDING_FINALITY"
  | "FINALIZED"
  | "FAILED";

export type CustodyProviderHealthStatus =
  | "UNKNOWN"
  | "AVAILABLE"
  | "DEGRADED"
  | "UNAVAILABLE";

export type CustodyProviderRef = {
  providerCode: string;
  providerType: string;
  capabilities: readonly CustodyObservationCapability[];
};

export type CustodyAccountBindingRef = {
  providerCode: string;
  bindingKey: string;
  assetCode: string;
  accountRole: string;
};

export type CustodyProviderHealth = {
  provider: CustodyProviderRef;
  status: CustodyProviderHealthStatus;
  checkedAt: string;
};

export type CustodyBalanceObservationIdentity =
  | {
      kind: "NATIVE";
      value: string;
    }
  | {
      kind: "CHECKPOINT";
      value: string;
    }
  | {
      kind: "CONTENT";
    };

export type CustodyBalanceObservation = {
  provider: CustodyProviderRef;
  binding: CustodyAccountBindingRef;
  identity: CustodyBalanceObservationIdentity;
  observedAvailableUnits: string;
  observedTotalUnits: string;
  observedAt: string;
  finalizedAt: string | null;
};

export type CustodyBalanceObservationErrorCode =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "UNSUPPORTED_ASSET"
  | "MALFORMED_AMOUNT"
  | "MALFORMED_TIMESTAMP"
  | "MISSING_RESULT"
  | "DUPLICATE_RESULT"
  | "UNEXPECTED_RESULT";

export type CustodyBalanceObservationError = {
  code: CustodyBalanceObservationErrorCode;
  retryable: boolean;
  retryAfterMs: number | null;
};

export type CustodyBalanceObservationResult =
  | {
      ok: true;
      binding: CustodyAccountBindingRef;
      observation: CustodyBalanceObservation;
    }
  | {
      ok: false;
      binding: CustodyAccountBindingRef;
      error: CustodyBalanceObservationError;
    };

export type CustodyTransferObservation = {
  provider: CustodyProviderRef;
  binding: CustodyAccountBindingRef;
  direction: CustodyObservationDirection;
  status: CustodyObservationStatus;
  amountUnits: string;
  observedAt: string;
  finalizedAt: string | null;
  evidenceDigest: string;
};

export type CustodyObservationPageCursor = {
  cursor: string | null;
  hasMore: boolean;
};

export type CustodyObservationPage<TObservation> = {
  observations: readonly TObservation[];
  page: CustodyObservationPageCursor;
};

export type CustodyObservationReadOptions = {
  signal?: AbortSignal;
};

export type CustodyObservationAdapter = {
  readonly provider: CustodyProviderRef;
  readHealth(): Promise<CustodyProviderHealth>;
  readBalances(
    bindings: readonly CustodyAccountBindingRef[],
    options?: CustodyObservationReadOptions,
  ): Promise<readonly CustodyBalanceObservationResult[]>;
  readTransfers(input: {
    bindings: readonly CustodyAccountBindingRef[];
    sinceObservedAt: string | null;
    cursor: string | null;
    limit: number;
  }): Promise<CustodyObservationPage<CustodyTransferObservation>>;
  lookupTransferByEvidenceDigest?(
    evidenceDigest: string,
  ): Promise<CustodyTransferObservation | null>;
};

export type CustodyObservationAdapterFactory = (
  provider: CustodyProviderRef,
) => CustodyObservationAdapter;
