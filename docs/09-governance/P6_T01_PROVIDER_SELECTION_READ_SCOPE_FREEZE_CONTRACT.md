# P6-T01 Provider Selection and Read Scope Freeze Contract

## Task Identity

- Task ID: `P6-T01`
- Task name: Provider Selection and Read Scope Freeze
- Classification: `PHASE6_FIRST_INTERNAL_GOVERNANCE_GATE`
- Task type: `GOVERNANCE_ONLY_TASK`
- Predecessor: `PHASE6_ENTRY_BOUNDARY_CANONICALLY_DEFINED`
- Task status: `DEFINED_NOT_STARTED`

## Canonical Base

- Branch: `fix/new-p5-phase2-runtime-supervisor`
- SHA: `479ca8b7037a0a053bea3a8d286b31b53b7a2cbd`
- Phase 6: canonically defined as Read-Only External Provider Observation

## Purpose

Freeze the first external provider observation product boundary sufficiently to
allow later security and integration architecture gates to be defined without
ambiguity. P6-T01 resolves who the provider is, where it operates, which
environment is eligible, what initial reads are permitted, and how fresh the
observations must be.

## Governance-Only Classification

P6-T01 permits zero application implementation changes, database changes,
provider network calls, credential access, external egress, or provider adapter
execution. It does not authorize real provider calls, provider writes, signing,
transaction submission, withdrawals, payouts, or financial execution.

## Task Markers

`P6_T01_TASK_DEFINED`

`P6_T01_PROVIDER_SELECTION_READ_SCOPE_FREEZE`

`P6_T01_GOVERNANCE_ONLY`

`P6_T01_PROVIDER_NOT_SELECTED`

`P6_T01_CHAIN_NOT_SELECTED`

`P6_T01_ENVIRONMENT_NOT_SELECTED`

`P6_T01_READ_SCOPE_NOT_FROZEN`

`P6_T01_LATENCY_NOT_FROZEN`

`P6_T01_IMPLEMENTATION_PROHIBITED`

`P6_T01_REAL_PROVIDER_CALLS_PROHIBITED`

`P6_T01_PROVIDER_WRITE_PROHIBITED`

`P6_T01_SIGNING_PROHIBITED`

`P6_T01_FINANCIAL_EXECUTION_PROHIBITED`

`P6_T01_EXIT_CRITERIA_FROZEN`

## Phase 6 Authority

Phase 6 requires this task as its first internal governance gate. Implementation
before this gate is prohibited. P6-T01 completion authorizes only follow-on
governance; credential, egress, authentication, and qualification gates remain
separately required before any real provider call.

## Decision A: Provider

Status: `PRODUCT_DECISION_REQUIRED`

Current value: `NOT_SELECTED`

The eventual decision must record the provider/vendor identity, selection
rationale, relevant read capabilities, environment availability, high-level
authentication implications, rate-limit and operational considerations,
read-only suitability, and evidence sources.

## Decision B: Chain/Network

Status: `PRODUCT_DECISION_REQUIRED`

Current value: `NOT_SELECTED`

Existing Solana domain support is not external integration selection authority.
The eventual decision must record the selected chain/network, provider
compatibility, asset relevance, environment/network identifier, and wrong-network
prevention requirements. Test-only Ethereum references have no selection
authority.

## Decision C: Environment

Status: `PRODUCT_DECISION_REQUIRED`

Current value: `NOT_SELECTED`

`RECOMMENDED_NON_PRODUCTION_FIRST` remains the governance default. A
provider-supported sandbox or test environment is preferred where available. If
one is unavailable, the eventual decision must document that fact and require a
separately justified safe qualification strategy before real calls.

## Decision D: Initial Read Scope

Status: `PRODUCT_DECISION_REQUIRED`

Architecture default: `BALANCE_AND_HEALTH_MINIMUM`

The existing read-only boundary supports provider health/status, balance
observation, and provider capability metadata. The default recommended initial
scope is `BALANCE_OBSERVATION` plus provider health. Transaction/history,
`TRANSFER_OBSERVATION`, and `TRANSFER_LOOKUP` are not included by default and
remain separately gated. `WEBHOOK_INGESTION` is not authorized.

## Decision E: Freshness/Latency

Status: `PRODUCT_DECISION_REQUIRED`

Current value: `NOT_FROZEN`

The eventual decision must state a product expectation adequate for later
architecture. It may use a class or range such as `NEAR_REAL_TIME`,
`SHORT_DELAY`, `PERIODIC`, or `ON_DEMAND`; this contract adopts none. A latency
expectation must not implicitly authorize polling automation or webhooks.

## Decision Evidence Requirements

The final decision must distinguish `FACT`, `PRODUCT_CHOICE`, and
`ARCHITECTURE_INFERENCE`. It must use official or other primary provider sources
where available and cover supported chains/networks, required read APIs,
environment availability, authentication method, rate-limit model, API stability,
balance and health capability, operational limitations, security considerations,
and fit with the current read-only adapter contract.

## Provider Comparison Requirements

When more than one viable candidate exists, compare target-chain support,
read-only balances, sandbox support, authentication complexity, credential
sensitivity, rate limits, API stability, reliability signals, integration
complexity, adapter compatibility, enforceable read-only permissions, and write
capability isolation. If only one candidate is viable, document why alternatives
are not viable.

## Inherited Architecture Constraints

P6-T01 does not reopen the following constraints:

- `READ_ONLY_PROVIDER_BOUNDARY`
- Provider write, signing, withdrawal submission, transfer submission, payout,
  and financial execution are prohibited.
- Webhook ingestion, automation, and operational posting are not authorized.
- Application service-role provider access and browser provider credentials are
  prohibited.
- Raw provider secret logging and raw provider payload public exposure are
  prohibited.

## Reconciliation Compatibility

`REAL_PROVIDER_OBSERVATION_MUST_PRESERVE_PHASE5_RECONCILIATION_CONTRACT`

The eventual selection must remain compatible with provider identity, custody
binding/account identity, observation identity, atomic-unit balance
normalization, timestamps, run evidence, idempotency, normalization, and safe
reconciliation consumption. A candidate that cannot reasonably map to these
contracts must be disfavored or rejected.

## Read-Only Structural Invariant

`REAL_PROVIDER_ADAPTER_READ_ONLY_BY_INTERFACE`

P6-T01 must not require an initial adapter method for signing, withdrawal,
transfer submission, payout, provider mutation, or financial execution. A
provider that needs one of those capabilities for balance observation is
incompatible with the initial Phase 6 boundary.

## Credential Follow-On Gate

Credential architecture remains `MANDATORY_PRE_REAL_CALL_SECURITY_GATE`.
P6-T01 may identify the provider's high-level authentication requirements, but
must not obtain, create, store, configure, read, or test credentials.

## Egress Follow-On Gate

Outbound networking remains `MANDATORY_PRE_REAL_CALL_EGRESS_GATE`. P6-T01 may
record official endpoint information needed for a later hostname allowlist, URL
validation, SSRF-control, TLS, timeout, and rate-limit design; it must not make
external calls.

## Authentication Follow-On Gate

Authentication remains `AUTH_MECHANISM_DEFERRED_UNTIL_PROVIDER_SELECTION`.
Only later governance may define authentication implementation.

## Real-Call Prohibition

`REAL_PROVIDER_CALLS_AUTHORIZED = false`

## Exit Criteria

P6-T01 may be complete only when all of the following are proven:

1. Provider selected.
2. Chain/network selected.
3. Environment selected.
4. Initial read scope frozen.
5. Freshness/latency expectation frozen.
6. Selection rationale and supporting evidence recorded.
7. Official-source evidence recorded.
8. The selected provider supports required initial reads.
9. Read-only structural boundary remains enforceable.
10. Reconciliation compatibility is assessed.
11. Provider write authority remains zero.
12. Signing authority remains zero.
13. Financial execution authority remains zero.
14. Webhook authority remains unauthorized.
15. Automation authority remains unauthorized.
16. Credential gate remains separately required.
17. Egress gate remains separately required.
18. Real provider calls remain unauthorized.

The eventual completion state is recorded by a separate decision report only
after the criteria above are met. Completion does not automatically begin
provider integration or any subsequent Phase 6 task.

## Remediation / Stop Policy

If no provider, chain, environment, or read scope can safely satisfy the Phase 6
entry boundary, stop and classify the candidate as incompatible. Do not loosen
the read-only, no-signing, no-write, or no-financial-execution constraints.

## Expected Decision Report

The expected later report is:

`docs/09-governance/P6_T01_PROVIDER_SELECTION_READ_SCOPE_FREEZE_REPORT.md`

It is not created by this contract-definition step.

## Explicit Out-of-Scope

P6-T01 does not include production source changes, database or schema changes,
provider adapters, credential implementation, egress/network implementation,
provider API or RPC calls, webhooks, automation, operational posting, financial
execution, or subsequent Phase 6 task definition.
