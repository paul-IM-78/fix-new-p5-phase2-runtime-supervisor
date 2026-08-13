# Phase 6 Entry Contract - Read-Only External Provider Observation

## Status and Authority

- Canonical base branch: `fix/new-p5-phase2-runtime-supervisor`
- Canonical base SHA: `de5c37da6df13d21c82213fd84221519aa4dbdd6`
- Prior phase state: Phase 5 is `COMPLETE`; its overall gate is `CLOSED`.
- Roadmap decision: `READ_ONLY_PROVIDER_EXTERNAL_NETWORK_INTEGRATION`
- Phase classification: `PROVIDER_AGNOSTIC_PHASE_BOUNDARY`
- Phase implementation status: `NOT_STARTED`
- Phase implementation authorization: `NOT_GRANTED`

This contract defines a governance boundary only. It does not select a provider,
chain, environment, endpoint, authentication mechanism, or implementation task.
It does not authorize real provider calls, credentials, external egress, or any
financial or operational capability.

## Phase Objective

Establish the governed architecture and qualification boundary for secure,
read-only external provider observations that feed the existing custody,
run-evidence, and reconciliation contracts.

## Entry Markers

`PHASE6_ENTRY_BOUNDARY_DEFINED`

`PHASE6_PROVIDER_AGNOSTIC`

`PHASE6_READ_ONLY_PROVIDER_OBSERVATION`

`PHASE6_IMPLEMENTATION_NOT_YET_AUTHORIZED`

`PHASE6_PROVIDER_SELECTION_REQUIRED_FIRST_GATE`

`PHASE6_PROVIDER_NOT_SELECTED`

`PHASE6_CHAIN_NOT_SELECTED`

`PHASE6_REAL_PROVIDER_CALLS_NOT_YET_AUTHORIZED`

`PHASE6_PROVIDER_WRITE_PROHIBITED`

`PHASE6_SIGNING_PROHIBITED`

`PHASE6_FINANCIAL_EXECUTION_PROHIBITED`

`P6_T01_NOT_YET_DEFINED`

## Existing Authority and Preserved Boundaries

The post-Phase-5 roadmap direction is adopted, but it selected no provider,
chain, vendor, endpoint, or data source. Existing Solana asset support is domain
support only; it is not an external provider or network selection. Existing mock
observation adapters are test-only and are not provider-selection authority.

The current provider abstraction remains provider-agnostic but partial. It has
server-only injected observation adapters, provider references, capability
metadata, normalized observation DTOs, error categories, and reconciliation
linkage. It has no real provider adapter, credential source, egress boundary, or
provider-specific authentication implementation.

## Initial Read-Only Capability Boundary

The first permitted capability family is limited to:

- `BALANCE_OBSERVATION`
- Provider health and status reads through `readHealth`
- Provider capability metadata reads
- Balance reads through `readBalances`

`TRANSFER_OBSERVATION` and `TRANSFER_LOOKUP` are optional later Phase 6 scopes
and remain outside the first integration gate unless separately authorized.

The following are prohibited by this entry contract:

- `PAYOUT_SUBMISSION`
- Provider account mutation
- Transaction, transfer, withdrawal, or payout submission
- Signing, private-key use, seed or mnemonic use
- Webhook ingestion
- Operational posting or automatic financial remediation
- Scheduler, cron, queue consumer, worker daemon, and autonomous operation
- Automatic reconciliation or custody-observation scheduling

Financial execution is outside this entry authority.

## First Internal Governance Gate

Working name: **Provider Selection and Read Scope Freeze**

Classification: `MANDATORY_FIRST_PHASE6_GOVERNANCE_GATE`

Before implementation, this gate must freeze:

1. The first provider.
2. The first chain and network.
3. The provider environment.
4. Exact permitted read methods and endpoints.
5. Balance-only versus additional read scope.
6. Data freshness and latency requirements.

Implementation before this gate is prohibited. The gate has no task ID in this
contract; `P6_T01_NOT_YET_DEFINED` remains true.

## Mandatory Pre-Real-Call Security Gates

### Credential Architecture

Before any real provider call, a provider-specific credential architecture must
be implemented and qualified. It must use secret references rather than raw
secret persistence where possible, server-only access, least privilege, rotation
support or policy, audit-safe injection, no secret logging, and no public DTO
exposure. Browser credential access is prohibited.

Classification: `MANDATORY_PRE_REAL_CALL_SECURITY_GATE`

Current readiness: `NOT_READY`

### Outbound Egress

Before any real provider call, implementation must provide a fixed hostname and
endpoint allowlist, strict URL validation, SSRF prevention, protocol
restrictions, redirect policy, TLS expectations, bounded response handling where
applicable, timeout, bounded concurrency, retry/backoff, and rate-limit handling.

Classification: `MANDATORY_PRE_REAL_CALL_EGRESS_GATE`

Current readiness: `NOT_READY`

### Authentication and Environment Qualification

Authentication is `PROVIDER_SPECIFIC` and remains
`AUTH_MECHANISM_DEFERRED_UNTIL_PROVIDER_SELECTION`. No repository authority
selects API key, bearer token, HMAC, OAuth, RPC token, or mTLS.

Provider-specific external qualification is required before production use. The
default sequence is provider sandbox or test environment followed by controlled
production read-only qualification. If the chosen provider has no non-production
environment, the first internal gate must define an alternative safe strategy.

`RECOMMENDED_NON_PRODUCTION_FIRST` is a Phase 6 governance default, not a
provider selection.

## Payload and Reconciliation Preservation

`RAW_PROVIDER_PAYLOAD_PERSISTENCE_PROHIBITED` is the Phase 6 default. Existing
normalized storage and public-safe DTO exclusions are preserved. A later gate
must define provider-specific evidence fields, retention, digests, redaction,
diagnostic snippets, and audit evidence. Public raw-payload exposure and
secret-bearing payload persistence remain zero.

Any real adapter must preserve provider identity, custody binding and account
identity, observation identity, atomic-unit balances, timestamps,
finality/reference semantics where applicable, run evidence, idempotency,
normalization, and safe reconciliation consumption.

`REAL_PROVIDER_OBSERVATION_MUST_PRESERVE_PHASE5_RECONCILIATION_CONTRACT`

## Failure and Read-Only Invariants

A provider adapter must normalize the semantic categories timeout, provider
unavailable, rate limited, authentication failure, malformed response, partial
observation, stale data, and retry exhausted. Existing `TIMEOUT`,
`PROVIDER_UNAVAILABLE`, and `RATE_LIMITED` vocabulary is preserved. Authentication
failure and stale data are required semantic categories, not newly declared
implementation enum values.

`REAL_PROVIDER_ADAPTER_READ_ONLY_BY_INTERFACE` is required. The initial real
adapter must not expose methods for signing, withdrawal, transfer submission,
payout, provider mutation, or financial execution. Any future need for those
methods requires separate phase or gate governance.

The following security invariants are frozen:

- `APPLICATION_SERVICE_ROLE_FOR_PROVIDER_ACCESS = PROHIBITED`
- `BROWSER_PROVIDER_CREDENTIAL_ACCESS = PROHIBITED`
- `RAW_PROVIDER_SECRET_LOGGING = PROHIBITED`
- `RAW_PROVIDER_PAYLOAD_PUBLIC_EXPOSURE = PROHIBITED`
- `SIGNING_KEY_ACCESS = PROHIBITED`
- `FINANCIAL_EXECUTION = PROHIBITED`
- `AUTOMATIC_FINANCIAL_REMEDIATION = PROHIBITED`
- `WEBHOOK_INGESTION = NOT_AUTHORIZED`
- `AUTONOMOUS_OPERATION = NOT_AUTHORIZED`

## Entry Precondition Matrix

| Precondition | Status |
| --- | --- |
| Provider selection | `MUST_BE_DEFINED_BEFORE_IMPLEMENTATION` |
| Chain/network selection | `MUST_BE_DEFINED_BEFORE_IMPLEMENTATION` |
| Provider environment | `MUST_BE_DEFINED_BEFORE_IMPLEMENTATION` |
| Permitted read scope | `MUST_BE_DEFINED_BEFORE_IMPLEMENTATION` |
| Credential architecture | `MUST_BE_IMPLEMENTED_BEFORE_REAL_PROVIDER_CALL` |
| Egress architecture | `MUST_BE_IMPLEMENTED_BEFORE_REAL_PROVIDER_CALL` |
| Authentication | `MUST_BE_DEFINED_AND_IMPLEMENTED_BEFORE_REAL_PROVIDER_CALL` |
| Timeout, rate limit, retry | `PARTIAL_MUST_BE_COMPLETED` |
| Payload governance | `PARTIAL_MUST_BE_COMPLETED` |
| Reconciliation linkage | `PARTIAL_MUST_BE_PROVIDER_QUALIFIED` |
| Sandbox or external qualification | `MUST_BE_DEFINED` |
| Read-only structural enforcement | `ALREADY_SATISFIED_MUST_BE_PRESERVED` |
| No-signing and no-submit boundary | `ALREADY_SATISFIED_MUST_BE_PRESERVED` |

## Phase Exit Criteria

Phase 6 can be complete only after authoritative internal gates prove all of the
following: provider, chain/network, environment, and permitted read scope are
selected; credentials, egress/SSRF, and authentication are qualified; a real
read-only adapter, normalized balances, provider health behavior, and failure
mapping are qualified; payload/redaction, run evidence, and reconciliation
linkage are qualified; secret findings and browser credential access are zero;
provider write, signing, and financial execution capabilities are zero; and
separate future gates remain unauthorized.

None of these exit criteria are complete at entry-contract publication.

## Separately Gated Scope

Webhook ingestion, continuous automation, operational posting, financial
execution, write-capable provider adapters, signing, withdrawals, payouts, and
automatic remediation remain separate future gates. Transaction and history
observation may be considered only through a separately defined read-only gate.

## Task Numbering and Implementation Status

`P6_T01_STATUS = NOT_DEFINED`

No Phase 6 implementation task ID is assigned by this contract. An authoritative
task ID may be assigned only after this entry boundary is canonically adopted and
the first internal governance gate is separately defined.

No implementation authority, real provider call, credential read, external
egress, provider write, signing, webhook, automation, posting, or financial
execution is granted by this document.
