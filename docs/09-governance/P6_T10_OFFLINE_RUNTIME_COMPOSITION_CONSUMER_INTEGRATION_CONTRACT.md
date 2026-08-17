# P6-T10: Offline Runtime Composition Consumer Integration Contract

## 1. Status and Authority

- Task: `P6-T10`
- Title: `Offline Runtime Composition Consumer Integration`
- Planning decision: `PHASE6_SUCCESSOR_PLANNING_DECISION_33A99204_P6T10`
- Corrective planning decision: `PHASE6_P6_T10_PLANNING_BOUNDARY_CORRECTION_33A99204_SYNTHETIC_COMMAND_RECORDING`
- Canonical base: `33a9920480376bb3f36320499c3c3ec72e648875`
- Contract status: `FROZEN CONTENT / PUBLICATION PREPARATION`
- Authority class: `OFFLINE_SYNTHETIC_ONLY`
- Provider, credential, DB, scheduler, and production authority: `NONE`

This contract does not authorize implementation until its publication lifecycle is complete and separate implementation authorization is issued.

## 2. Purpose

P6-T10 adds the minimum server-only consumer seam between canonical P6-T09 runtime composition and generic custody balance-observer one-shot orchestration. The consumer must accept only frozen caller-injected dependencies, construct P6-T09 once per explicit invocation, provide its `CustodyObservationAdapterFactory` to `runCustodyBalanceObserverOneShot`, fix identity policy to `REMOTE_CONTENT`, and return `CustodyBalanceObserverOneShotResult` directly. It creates no orchestration framework or result domain.

## 3. Corrected Persistence Terminology

The generic one-shot path is non-recorded relative to the separately governed recorded path, but a successful observation may invoke the injected `CustodyBalanceObserverCommandClient.recordBalanceObservationAndAdvanceCheckpoint(...)`.

Synthetic, process-local, in-memory command recording is allowed and must retain the canonical predecessor semantic. The following remain prohibited: actual DB command client, connection, query, mutation, persistent checkpoint storage, durable observation persistence, production persistence, `runRecordedCustodyBalanceObserverOneShot`, and durable `REMOTE_CONTENT`. A synthetic command method call is not an actual DB mutation.

## 4. Canonical Predecessor Ownership

- P6-T04 owns provider security and execution boundaries.
- P6-T05 owns BitGo read-only semantic adapter and normalization semantics.
- P6-T07 owns the generic adapter, worker, and one-shot orchestration semantics.
- P6-T08 owns immutable injected wallet-ID resolution and exact binding lookup.
- P6-T09 owns `createBitGoReadOnlyRuntimeComposition`; P6-T10 calls it directly and must not rebuild its resolver or adapter graph.

## 5. Exact Paths and Scope

- Contract: `docs/09-governance/P6_T10_OFFLINE_RUNTIME_COMPOSITION_CONSUMER_INTEGRATION_CONTRACT.md`
- Future source: `src/server/custody/bitgo-read-only-runtime-composition-consumer.ts`
- Future test: `src/server/custody/bitgo-read-only-runtime-composition-consumer.test.ts`
- Future implementation scope: `A2 / M0 / D0`

Only the two future paths may be added. No predecessor modification is authorized.

## 6. Production Module Boundary

The future production module must directly use `import "server-only";`. It has no import-time work, singleton runtime state, mutable global state, provider activity, command activity, or DB activity.

## 7. Public API

P6-T10 exports exactly:

```ts
type BitGoReadOnlyRuntimeCompositionConsumerConfig =
  BitGoReadOnlyRuntimeCompositionConfig &
  Pick<RunCustodyBalanceObserverOneShotInput, "scopeClient" | "commandClient">;

function runBitGoReadOnlyRuntimeCompositionOneShot(
  config: BitGoReadOnlyRuntimeCompositionConsumerConfig,
): Promise<CustodyBalanceObserverOneShotResult>;
```

There is one public entrypoint, no new result domain, and no new result codes.

## 8. Config and Composition Mapping

The config contains only `registryEntries`, `semanticAdapterFactory`, optional `correlationIdFactory`, `scopeClient`, and `commandClient`, using their existing canonical types. Caller-supplied `adapterFactory`, identity-policy override, credential reference, authorized execution flag, provider client or transport, DB repository/connection, recorded orchestrator, scheduler, and production mode are prohibited.

P6-T10 calls `createBitGoReadOnlyRuntimeComposition` exactly once with:

- `registryEntries <- config.registryEntries`
- `semanticAdapterFactory <- config.semanticAdapterFactory`
- `correlationIdFactory <- config.correlationIdFactory`

P6-T09 retains `credentialReference: null` and `authorizedExecutionContext: false`. The returned factory is the required `adapterFactory`; callers cannot override it.

## 9. Generic One-Shot Mapping

The canonical target is `runCustodyBalanceObserverOneShot` from `src/server/custody/balance-observer-orchestrator.ts`. P6-T10 maps:

- `scopeClient <- config.scopeClient`
- `commandClient <- config.commandClient`
- `adapterFactory <- createBitGoReadOnlyRuntimeComposition(...)`
- `identityPolicy <- "REMOTE_CONTENT"`

P6-T10 excludes optional worker/scope retry policies and runtimes, concurrency policy, page limits, runtime override, lifecycle reporter, and signal. Canonical disabled/default behavior therefore applies. It creates no second orchestration layer.

## 10. Identity and Correlation Semantics

P6-T10 fixes the existing identity literal to `REMOTE_CONTENT`; caller override is prohibited and no new policy is defined. Optional `correlationIdFactory` is passed unchanged only to P6-T09 as `BitGoBalanceObserverCorrelationIdFactory`. Generic one-shot has no correlation input, and P6-T10 creates no competing correlation mechanism.

## 11. Synthetic Client Boundaries

`CustodyBalanceObserverScopeClient` is synthetic-only in qualification and may implement `listBalanceObserverScopePage`, `readBalanceObserverScope`, and `close` process-locally. `CustodyBalanceObserverCommandClient` is synthetic/process-local/in-memory only and may implement `recordBalanceObservationAndAdvanceCheckpoint` and `close` in memory.

P6-T10 does not own production scope/command client construction, DB persistence, transactions, checkpoint storage, or repository provisioning. A successful synthetic observation preserves exactly one canonical injected command-record call; P6-T10 adds none, duplicates none, and suppresses none.

## 12. Execution, Failure, and Recorded-Path Policy

One explicit public call constructs P6-T09 once and calls generic one-shot once. Automatic startup, background execution, timers, polling, schedulers, recurring loops, production bootstrap, and P6-T10 retry logic are prohibited.

P6-T10 adds zero retry, fallback, swallowing, translation, catch-and-rewrite behavior, and result codes. It preserves canonical duplicate-tuple `RangeError`, missing binding, invalid wallet, resolver internal failure, semantic failure, command-client failure, scope-client failure, and one-shot result behavior.

P6-T10 must not import or call `runRecordedCustodyBalanceObserverOneShot`, add recorded persistence, add DB-backed recording, or introduce durable `REMOTE_CONTENT`.

## 13. Live Authority and Side-Effect Boundary

Registry entries and wallet IDs are synthetic only. P6-T10 authorizes zero actual registry sources, credentials, credential reads/resolution, provider/BitGo/Solana calls, DB clients/connections/reads/mutations, durable checkpoint writes, scheduler activity, production activity, writes, signing, or fund movement.

Import and config construction cause zero provider calls, command calls, credential reads, DB reads/writes, filesystem/environment registry reads, or scheduler creation. Explicit qualification calls may invoke only injected synthetic dependencies.

## 14. Qualification Catalog

Qualification is `OFFLINE / SYNTHETIC`. The exact sequential, unique, gap-free catalog is `P6T10-CONS-001` through `P6T10-CONS-017`:

1. `P6T10-CONS-001`: public API, server-only boundary, and no import-time side effects.
2. `P6T10-CONS-002`: full public seam traversal through P6-T09 and canonical generic one-shot orchestration.
3. `P6T10-CONS-003`: fixed `REMOTE_CONTENT` policy and P6-T10 adapter-factory ownership.
4. `P6T10-CONS-004`: exact registry, semantic-factory, and correlation-factory propagation.
5. `P6T10-CONS-005`: successful synthetic observation records exactly once with preserved command input.
6. `P6T10-CONS-006`: missing binding preserves failure and avoids synthetic recording.
7. `P6T10-CONS-007`: invalid synthetic wallet ID preserves failure and avoids synthetic recording.
8. `P6T10-CONS-008`: resolver internal failure preserves canonical behavior through the public seam.
9. `P6T10-CONS-009`: duplicate registry tuple `RangeError` propagates unchanged.
10. `P6T10-CONS-010`: downstream semantic failure preserves result behavior and avoids recording.
11. `P6T10-CONS-011`: synthetic command-client failure preserves worker/orchestrator behavior.
12. `P6T10-CONS-012`: synthetic scope-client failure preserves `FAILED_DISCOVERY`.
13. `P6T10-CONS-013`: repeated explicit invocation is stable.
14. `P6T10-CONS-014`: separate invocations preserve registry/config isolation.
15. `P6T10-CONS-015`: synthetic command recording is distinguished from real DB construction, connection, query, and mutation.
16. `P6T10-CONS-016`: recorded orchestration and durable `REMOTE_CONTENT` remain excluded.
17. `P6T10-CONS-017`: full authority guard proves all live authority counts are zero.

Critical proofs: seam traversal `002`; synthetic-recording/DB boundary `015`; resolver internal failure `008`; recorded-path exclusion `016`; full authority guard `017`.

Every behavioral case traverses the P6-T10 public seam except a specific import/construction guard. Tests must not substitute direct P6-T09 tests, bypass generic one-shot, use real provider/DB dependencies, weaken assertions, or claim no command call where canonical success requires one.

## 15. Qualification Execution and Static Gates

Use repository-native execution when available; an external temporary runner is permitted only outside the repository with a temporary `server-only` shim and process-local `NODE_PATH` when necessary, followed by full cleanup. Dependency installation, package/lockfile changes, tracked harness changes, and repository residue are prohibited.

Required gates are `npx tsc --noEmit`, exact source/test lint with zero warnings, and `npm run build`.

## 16. Prohibited Scope and Invalidation

P6-T10 must not implement real wallet registry provisioning, actual wallet IDs, credential provisioning/resolution, authorized execution context, provider activation, BitGo/Solana execution, DB client provisioning/persistence, recorded orchestration, durable `REMOTE_CONTENT`, scheduler/daemon/recurring execution, production bootstrap, writes, signing, or fund movement.

Future implementation authorization is invalidated by canonical or API drift, path collision, scope expansion, predecessor modification, caller adapter/policy override, credential/provider/actual-DB/recorded-path requirement, qualification catalog change, or proof weakening.

## 17. Implementation Lifecycle

After contract publication, separate authority is required for: implementation authorization; exact `A2 / M0 / D0` implementation; `17 / 17` qualification; review; commit; push; PR; merge; canonical sync and cleanup; and final closeout. No authority is reusable outside its exact step.

## 18. Provider Activation Guard

Throughout P6-T10, actual registry entries, wallet IDs, credentials, credential reads/resolver calls, provider/BitGo/Solana calls, actual DB clients/reads/mutations, scheduler executions, production executions, writes, signing, and fund movement are all `0`. Provider authority is `NONE`.
