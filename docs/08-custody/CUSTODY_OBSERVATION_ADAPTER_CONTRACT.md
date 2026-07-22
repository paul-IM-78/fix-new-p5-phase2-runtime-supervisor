# Custody Observation Adapter Contract

## Purpose

`src/server/custody/provider-observation-contract.ts` defines a future
server-only interface for reading custody provider observations. It is a type
contract, not an adapter implementation.

The contract lets future phases reason about provider health, balance
observations, transfer observations, pagination, and evidence-digest lookup
without introducing a real provider SDK or blockchain connection in NEW-P5-T01.

## Contract Types

The contract defines:

- `CustodyProviderRef`
- `CustodyAccountBindingRef`
- `CustodyProviderHealth`
- `CustodyBalanceObservation`
- `CustodyTransferObservation`
- `CustodyObservationPage`
- `CustodyObservationAdapter`
- `CustodyObservationAdapterFactory`

The contract uses:

- Internal provider code
- Internal binding key
- Asset code
- Account role
- Atomic-unit strings
- ISO timestamp strings
- Opaque pagination cursors
- Evidence digest strings

## Allowed Future Read Responsibilities

A future adapter may read:

- Provider health
- Provider-reported balances
- Provider-reported inbound or outbound transfer observations
- Transfer details by already-normalized evidence digest

These reads must remain observational until a later approved phase maps them
to domain commands and ledger postings.

## Prohibited In This Phase

The contract file does not and must not include:

- `fetch`
- Provider SDK imports
- Blockchain SDK imports
- RPC URLs
- API keys or secrets
- Webhook secrets
- Service-role access
- Signing
- Payout submission
- Deposit address creation
- External account ID storage
- Transaction hash or signature storage
- Ledger posting
- Deposit, withdrawal, staking, or balance mutation

## Evidence Boundary

Transfer observations expose `evidenceDigest`, not raw provider payloads,
transaction signatures, URLs, or account identifiers.

The digest is an opaque reference boundary. Later phases must define how raw
external evidence is received, normalized, digested, stored, redacted, audited,
and authorized before any production use.

## Ledger Boundary

The adapter contract never posts ledger journals and never changes user
balances. Ledger posting must remain in database command functions with
explicit business state transitions, idempotency, expected-version checks, and
auditable outcomes.

## Authorization Boundary

The observation contract is server-only but not an authorization system. Final
authorization for any future operational command must remain in database RPCs,
RLS, AAL2 admin guards, and command-specific invariants.
