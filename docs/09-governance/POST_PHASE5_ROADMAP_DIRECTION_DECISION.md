# Post-Phase-5 Roadmap Direction Decision

## Decision Status

ADOPTED

## Canonical Base

- Branch: `fix/new-p5-phase2-runtime-supervisor`
- SHA: `7d540ecf2293818b049988d3e33bef6dcd36877b`

## Completed Phase

Phase 5 is `COMPLETE` and its overall gate is `CLOSED`.

## Prior State

`POST_PHASE5_ROADMAP_DIRECTION_UNDEFINED`

## Adopted Direction

`READ_ONLY_PROVIDER_EXTERNAL_NETWORK_INTEGRATION`

## Decision Classification

`ADOPTED_POST_PHASE5_ROADMAP_DIRECTION`

## Why This Direction

Provider and external-network integration is the strongest identified dependency
bottleneck. Phase 5 already established provider metadata, injected observation
adapter boundaries, safe local/mock observation, one-shot orchestration, durable
run evidence, reconciliation, and administrative review boundaries.

A strictly read-only observation boundary can produce meaningful real-world
evidence while avoiding the financial authority of posting or execution. It also
provides the provider capability information needed to make later webhook and
automation decisions deliberately.

## Explicit Initial Boundary

The next provider/network boundary is observational and read-only only. Its
eventual entry contract may consider balance reads, transaction-history reads,
and provider status or capability reads only when explicitly approved.

No implementation is authorized by this decision. Production provider/network
execution remains prohibited until a separate entry contract defines and approves
the complete boundary.

## Not Authorized

- Webhook ingestion.
- Automation, worker, queue, scheduler, or cron capability.
- Operational posting or financial remediation.
- Financial execution, transaction creation, signing, transfer submission,
  withdrawal submission, payout submission, or provider-side mutation.
- Address-management mutation or application-runtime credential rotation.

## Provider Selection

`PROVIDER_SELECTION_NOT_YET_DECIDED`

No provider, chain, vendor, endpoint, or data source is selected by this decision.

## Required Entry-Contract Decisions

Before implementation, a separate provider-boundary entry contract must define:

1. The first provider, chain, and data source.
2. Allowed read-only API or RPC endpoints.
3. Sandbox/testnet versus production-network boundary.
4. Credential storage and access model.
5. Outbound hostname and egress allowlist.
6. Authentication model.
7. Rate-limit, timeout, backoff, retry, and idempotency semantics.
8. Provider error normalization and degraded-mode behavior.
9. Raw payload retention, redaction, observability, and audit policy.
10. Reconciliation linkage, secret-management qualification, and integration
    test/sandbox qualification.
11. Explicit continued prohibition of write, signing, and submit capabilities.

## Security Expansion

`HIGH_SECURITY_EXPANSION`

The future boundary introduces external trust, provider authentication,
credentials and secrets, outbound network access, provider availability risks,
and potentially sensitive account metadata. Financial execution risk remains
`LOW` only while the boundary is strictly read-only.

## Relationship to Other Future Gates

Webhook ingestion, automation, operational posting, and financial execution are
`SEPARATE_FUTURE_GATE` scopes. Webhook ingestion adds inbound authentication,
replay, deduplication, ordering, rate limiting, and payload-retention concerns.
Automation requires separately governed scheduler, queue, worker, lease, and
stale-run recovery controls. Posting requires explicit review-to-posting,
approval, correction, reversal, and monitoring semantics. Financial execution is
a deferred high-risk gate requiring write-capable provider architecture,
signing-key custody, destination controls, dual approval, confirmation, incident
controls, and post-execution reconciliation.

## Phase 6 Status

`PHASE6_NOT_YET_DEFINED`

The adopted direction is input to a later phase-entry governance decision. It
does not define Phase 6, assign a phase objective, or create an implementation
task.

## P6-T01 Status

`P6_T01_NOT_YET_DEFINED`

## Next Governance Activity

Define provider-boundary entry governance before any implementation. That future
activity must decide whether this adopted direction forms a phase objective, a
layered phase gate, or another formally named roadmap boundary.

## Decision Markers

`POST_PHASE5_ROADMAP_DIRECTION_ADOPTED`

`READ_ONLY_PROVIDER_NETWORK_DIRECTION_ADOPTED`

`PROVIDER_SELECTION_NOT_YET_DECIDED`

`PHASE6_NOT_YET_DEFINED`

`P6_T01_NOT_YET_DEFINED`
