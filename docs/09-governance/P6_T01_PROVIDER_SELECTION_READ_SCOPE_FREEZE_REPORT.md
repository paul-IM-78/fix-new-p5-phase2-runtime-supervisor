# P6-T01 Provider Selection and Read Scope Freeze Decision Report

## Status

This report records the P6-T01 product decisions made after the entry contract
and read-only official-source research. It supersedes the entry-state decision
markers in the contract without changing that contract.

`ENTRY_CONTRACT_STATE_SUPERSEDED_BY_DECISION_REPORT_OUTCOME`

`P6_T01_PRODUCT_DECISIONS_FROZEN`

`P6_T01_PRODUCT_DECISION_EXIT_CRITERIA_SATISFIED`

P6-T01 remains governance only. It does not authorize implementation,
credentials, external egress, provider authentication execution, or real
provider calls.

`P6_T01_IMPLEMENTATION_REMAINS_PROHIBITED`

`P6_T01_REAL_PROVIDER_CALLS_REMAIN_PROHIBITED`

## Decision Authority

- Task: `P6-T01` Provider Selection and Read Scope Freeze
- Branch: `docs/p6-t01-provider-selection-read-scope-freeze`
- Canonical base: `fix/new-p5-phase2-runtime-supervisor`
- Canonical SHA: `479ca8b7037a0a053bea3a8d286b31b53b7a2cbd`
- Research retrieval date: `2026-08-14`
- Research classification: `READY_FOR_P6_T01_FINAL_PRODUCT_DECISION`
- Evidence: one viable provider and one viable provider/chain combination.

## Frozen Product Decisions

### Provider

`P6_T01_SELECTED_PROVIDER = BITGO`

`P6_T01_PROVIDER_SELECTED_BITGO`

- Provider type: `QUALIFIED_CUSTODIAN`
- Classification: `PRODUCT_CHOICE`
- Status: `SELECTED`

BitGo is selected because it fits the current custody-provider model, documents
Solana support and a test environment, exposes wallet balance reads, documents
string balance values, and documents a least-privilege/read-scoped access-token
path. This is a lower conflict with the inherited signing-key prohibition than
the evaluated Fireblocks authentication model.

Known limitations remain intentionally unresolved for later gates:

- a public rate-limit figure for this exact read scope was not established;
- no dedicated BitGo public health endpoint was confirmed;
- secure internal binding-to-BitGo wallet identifier mapping is still required;
- timestamp and finality mapping require qualification; and
- credential and egress architecture are not implemented.

`BITGO_SELECTED_FOR_P6_T01_INITIAL_READ_ONLY_DIRECTION`

### Chain and Network

`P6_T01_SELECTED_CHAIN = SOLANA`

`P6_T01_CHAIN_SELECTED_SOLANA`

`SOLANA_EXTERNAL_INTEGRATION_SELECTED_FOR_P6_T01`

- Classification: `PRODUCT_CHOICE`
- Status: `SELECTED`

Solana is selected because it has the repository's current product/domain and
approved custody-binding authority, the selected provider supports it, and the
existing atomic-unit normalization model is compatible with its balance data.
Ethereum is `NOT_SELECTED_FOR_INITIAL_PHASE6_GATE`.

### Qualification Environment

`P6_T01_SELECTED_ENVIRONMENT = BITGO_TEST`

`P6_T01_ENVIRONMENT_SELECTED_BITGO_TEST`

- Classification: `PRODUCT_CHOICE`
- Status: `SELECTED_FOR_INITIAL_QUALIFICATION`
- Chain/provider scope: BitGo's documented Solana test coin/environment model
  (`tsol`) where applicable.

The initial sequence is BitGo TEST and supported Solana test scope, followed by
separate credential, egress, authentication, and external-qualification gates.
The BitGo production environment is not authorized for initial calls. This
report does not equate BitGo TEST with Solana Devnet.

### Initial Read Scope

`P6_T01_INITIAL_READ_SCOPE = SCOPE_B`

`P6_T01_INITIAL_READ_SCOPE_FROZEN`

`P6_T01_SCOPE_B_SELECTED`

Scope B contains only:

1. `BALANCE_OBSERVATION`
2. normalized provider health or availability
3. normalized provider capability metadata

Transaction/history reads are not included. `TRANSFER_OBSERVATION`,
`TRANSFER_LOOKUP`, webhook ingestion, provider writes, signing, withdrawals,
payouts, and financial execution remain unauthorized.

### Health Semantic

`READ_HEALTH_SEMANTIC_REQUIRED`

No dedicated BitGo public health endpoint was confirmed. Provider health means
normalized availability derived from a bounded permitted read, a later approved
official health mechanism, or another separately qualified provider-specific
mapping. No mechanism is implemented or selected here.

### Freshness and Latency

`P6_T01_FRESHNESS = ON_DEMAND`

`P6_T01_FRESHNESS_ON_DEMAND_FROZEN`

`ON_DEMAND_READ_ONLY_OBSERVATION`

The product expectation is an explicitly initiated bounded observation only.
It authorizes no recurring cadence, scheduler, polling daemon, cron, queue
worker, background task, webhook, autonomous observation, or near-real-time
promise.

## Evidence Classification

- `FACT`: BitGo official documentation covers Solana support, a test model,
  wallet balance reads, string balance representations, and token scopes.
- `PRODUCT_CHOICE`: BitGo, Solana, BitGo TEST, Scope B, and ON_DEMAND are the
  frozen P6-T01 decisions.
- `ARCHITECTURE_INFERENCE`: BitGo maps more directly to the existing
  custody-provider and binding model than address-oriented infrastructure RPC
  providers.

## Alternative Disposition

### Fireblocks

- Status: `NOT_SELECTED`
- Classification: `INCOMPATIBLE_WITH_CURRENT_PHASE6_INITIAL_SECURITY_BOUNDARY`

Fireblocks officially documents Solana vault balances, Sandbox, and a Viewer
role, but its API authentication requires an RSA private key to sign requests.
That conflicts with the inherited initial signing-key-access prohibition. This
does not characterize Fireblocks as universally unsafe or prohibit it in a
future separately governed phase.

### Helius

- Status: `NOT_SELECTED`
- Classification: `INCOMPATIBLE_WITH_CURRENT_INITIAL_CUSTODY_BINDING_MODEL`

Its address-oriented infrastructure-RPC model would require architecture
expansion beyond the current custody-provider binding model. Its documented
API-key endpoint shape also increases later egress and secret-policy complexity.

### QuickNode

- Status: `NOT_SELECTED`
- Classification: `INCOMPATIBLE_WITH_CURRENT_INITIAL_CUSTODY_BINDING_MODEL`

Its infrastructure-RPC and address-oriented model has the same initial binding
and provider-type mismatch. Neither Helius nor QuickNode is permanently
prohibited from a future separately governed scope.

## Compatibility Decision

`P6_T01_BITGO_RECONCILIATION_COMPATIBLE_WITH_MAPPING`

`BITGO_RECONCILIATION_COMPATIBILITY = COMPATIBLE_WITH_MAPPING`

`BITGO_ADAPTER_COMPATIBILITY = MEDIUM_COMPLEXITY_COMPATIBLE`

A later adapter must map internal provider identity and internal binding/account
aliases to a BitGo wallet identifier under a separately approved security
architecture. It must normalize exact atomic-unit balances, timestamps,
observation identity, run evidence, idempotency, and applicable finality
semantics without persisting raw provider payloads.

`REAL_PROVIDER_OBSERVATION_MUST_PRESERVE_PHASE5_RECONCILIATION_CONTRACT`

`REAL_PROVIDER_ADAPTER_READ_ONLY_BY_INTERFACE`

The only conceptual adapter methods remain `readHealth` and `readBalances`.
No mutation, signing, or submission method is introduced.

## Follow-On Gates

`P6_T01_BITGO_CREDENTIAL_GATE_REQUIRED`

`BITGO_CREDENTIAL_ARCHITECTURE_REQUIRED`

Later credential governance must define server-only Bearer-token injection,
least-privilege/read-scoped tokens, rotation policy, audit-safe secret
references, production IP-restriction evaluation, zero browser access, zero
log exposure, and no raw token persistence in normal application data.

`P6_T01_BITGO_EGRESS_GATE_REQUIRED`

`BITGO_EGRESS_BOUNDARY_REQUIRED`

Later egress governance must define the official hostname allowlist,
environment-specific endpoint policy, strict URL validation, SSRF prevention,
redirect and TLS policy, timeouts, response bounds, bounded concurrency,
retry/backoff, and rate-limit handling.

- Auth family identified: Bearer access token
- Classification: `AUTH_REQUIREMENT_IDENTIFIED_NOT_IMPLEMENTED`
- Credential acquired, configured, tested, stored, or read: no
- Real provider calls authorized: false

`P6_T01_AUTH_IDENTIFIED_NOT_IMPLEMENTED`

## Inherited Hard Boundaries

- `READ_ONLY_PROVIDER_BOUNDARY`
- Provider write, signing, withdrawal submission, transfer submission, payout,
  and financial execution: `PROHIBITED`
- Webhook, automation, and operational posting: `NOT_AUTHORIZED`
- Browser provider credentials and application service-role provider access:
  `PROHIBITED`
- Raw secret logging and raw provider-payload public exposure: `PROHIBITED`

## Exit Criteria Evaluation

All 18 frozen P6-T01 product-decision criteria are satisfied:

1. provider selected;
2. chain/network selected;
3. environment selected;
4. initial read scope frozen;
5. freshness expectation frozen;
6. selection rationale recorded;
7. official-source evidence recorded;
8. required initial reads supported;
9. read-only boundary remains enforceable;
10. reconciliation compatibility assessed;
11. provider write authority remains zero;
12. signing authority remains zero;
13. financial execution authority remains zero;
14. webhook remains unauthorized;
15. automation remains unauthorized;
16. credential gate remains separately required;
17. egress gate remains separately required; and
18. real provider calls remain unauthorized.

This is not final task publication or implementation authorization.

## Official Sources

All sources below were retrieved on `2026-08-14` from official domains.

| Source | Domain | Claim supported |
| --- | --- | --- |
| BitGo Solana documentation | `developers.bitgo.com` | Solana production/test model and string balance handling. |
| BitGo wallet and balance documentation | `developers.bitgo.com` | Wallet balance-read capability. |
| BitGo access-token documentation | `developers.bitgo.com` | Read-scoped/least-privilege token path and production IP restriction. |
| Fireblocks vault balance documentation | `developers.fireblocks.com` | Vault asset balance response model. |
| Fireblocks API access documentation | `developers.fireblocks.com` | Viewer role and RSA private-key request signing. |
| Fireblocks supported-network documentation | `developers.fireblocks.com` | Solana support. |
| Solana clusters documentation | `solana.com` | Public cluster and development-environment model. |
| Solana RPC documentation | `solana.com` | Balance, health, commitment, and JSON-RPC read concepts. |
| Helius endpoint documentation | `helius.dev` | Solana Mainnet/Devnet endpoint model. |
| QuickNode Solana documentation | `quicknode.com` | Solana Mainnet/Testnet/Devnet support and endpoint model. |

## Scope and Authority Statement

This report changes no application, database, schema, provider adapter,
credential, endpoint, egress, test, build, or runtime behavior. No real provider
or Solana RPC call was made. P6-T01 authorizes only follow-on governance.

## Final Closeout Status

- Task ID: `P6-T01`
- Task name: Provider Selection and Read Scope Freeze
- Classification: `PHASE6_FIRST_INTERNAL_GOVERNANCE_GATE`
- Task type: `GOVERNANCE_ONLY_TASK`
- Canonical base: `479ca8b7037a0a053bea3a8d286b31b53b7a2cbd`
- Task status: `COMPLETE`
- Gate status: Provider Selection and Read Scope Freeze is `CLOSED`
- Product decisions: `FROZEN`
- Provider: `BITGO`
- Chain: `SOLANA`
- Environment: `BITGO_TEST`
- Initial read scope: `SCOPE_B`
- Freshness: `ON_DEMAND`
- Implementation authorization: `NONE`
- Real provider calls: `NOT_AUTHORIZED`
- Credential and egress gates: `REQUIRED`
- Authentication: identified but not implemented
- Subsequent Phase 6 task defined: false

`P6_T01_CLOSEOUT_PRECONDITIONS_SATISFIED`

`P6_T01_PASS`

`P6_T01_COMPLETE`

`PROVIDER_SELECTION_AND_READ_SCOPE_FROZEN`

`PASS_P6_T01_PROVIDER_SELECTION_READ_SCOPE_FREEZE_READY_FOR_PUBLICATION`

These final P6-T01 markers mean only that the required product choices and
governance evidence are complete and this initial gate is closed. They do not
authorize provider integration, credentials, outbound provider egress, BitGo or
Solana RPC calls, production access, or a subsequent task.
