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

export type CustodyBalanceObservation = {
  provider: CustodyProviderRef;
  binding: CustodyAccountBindingRef;
  observedAvailableUnits: string;
  observedTotalUnits: string;
  observedAt: string;
  finalizedAt: string | null;
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

export type CustodyObservationAdapter = {
  readonly provider: CustodyProviderRef;
  readHealth(): Promise<CustodyProviderHealth>;
  readBalances(
    bindings: readonly CustodyAccountBindingRef[],
  ): Promise<readonly CustodyBalanceObservation[]>;
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
