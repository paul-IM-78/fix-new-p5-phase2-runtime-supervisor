# P6-T09: BitGo Read-Only Runtime Composition and Binding Integration Contract Freeze

Status: FROZEN CONTRACT

Classification: `PHASE6_P6_T09_OFFLINE_SYNTHETIC_RUNTIME_COMPOSITION`

Canonical basis: `cd91d0903661dbf7f0db87d63db23df235e05fc5`

Planning decision: `PHASE6_SUCCESSOR_PLANNING_DECISION_CD91D090_P6T09`

Publication preparation authorization:
`P6_T09_CONTRACT_PUBLICATION_PREP_AUTH_CD91D090_18`

## Task Identity

- Task: `P6-T09`
- Title: BitGo Read-Only Runtime Composition and Binding Integration
- Predecessors: `P6-T07`, `P6-T08`
- Task classification: `OFFLINE / SYNTHETIC RUNTIME COMPOSITION`
- Implementation authority at contract publication: `NONE`
- Provider authority: `NONE`

`P6_T09_BITGO_READ_ONLY_RUNTIME_COMPOSITION_BINDING_INTEGRATION_FROZEN`

This contract defines an offline, synthetic-only composition seam. It does not
authorize BitGo, Solana RPC, credentials, a real registry, real wallet IDs,
database activity, scheduling, production, writes, signing, or fund movement.

## Purpose

P6-T09 defines the minimum construction boundary that connects the canonical
P6-T07 balance-observer adapter factory with the canonical P6-T08 wallet-ID
resolver. The future implementation must:

1. construct the P6-T08 resolver from caller-injected registry entries;
2. inject that resolver into the P6-T07 observer adapter factory;
3. inject a synthetic `BitGoReadOnlySemanticAdapterFactory`;
4. prove observer-to-resolver-to-synthetic-downstream dependency wiring; and
5. preserve predecessor success and failure semantics without adding a runtime
   framework, retry model, result model, or provider activation path.

P6-T09 is not a real BitGo integration task.

## Predecessor Authority And Ownership

### P6-T04

P6-T04 retains provider-security infrastructure ownership. P6-T09 does not
modify or reinterpret provider-security behavior.

### P6-T05

P6-T05 retains BitGo read-only semantic-adapter ownership. P6-T09 receives the
existing `BitGoReadOnlySemanticAdapterFactory` by injection and does not define
another semantic-adapter contract.

### P6-T07

P6-T07 retains ownership of the observer adapter, worker, generic
orchestrator, recorded-run boundary, and non-recorded offline behavior. P6-T09
does not modify P6-T07 semantics.

### P6-T08

P6-T08 retains ownership of exact four-field binding lookup, wallet-ID
validation, registry snapshots, duplicate-tuple detection, and resolver
results. P6-T09 constructs and consumes the resolver; it does not reimplement
resolver behavior.

### P6-T09

P6-T09 owns runtime composition construction and dependency wiring only.
Neither P6-T07 nor P6-T08 implementation authority is reused.

## Canonical Interfaces Reused

The implementation must reuse these canonical interfaces without duplicates:

- `CustodyObservationAdapter`
- `CustodyObservationAdapterFactory`
- `createBitGoBalanceObserverAdapterFactory`
- `BitGoWalletIdResolver`
- `createBitGoWalletIdResolver`
- `BitGoWalletIdBindingRegistryEntry`
- `BitGoReadOnlySemanticAdapterFactory`
- the existing P6-T07 correlation-ID factory type, if a correlation factory is
  supplied

Duplicate public interfaces: `0`.

## P6-T09 Public API

The future source module is:

`src/server/custody/bitgo-read-only-runtime-composition.ts`

It must directly import `server-only` and export exactly this public surface:

```ts
type BitGoReadOnlyRuntimeCompositionConfig = Readonly<{
  registryEntries: readonly BitGoWalletIdBindingRegistryEntry[];
  semanticAdapterFactory: BitGoReadOnlySemanticAdapterFactory;
  correlationIdFactory?: BitGoBalanceObserverCorrelationIdFactory;
}>;

function createBitGoReadOnlyRuntimeComposition(
  config: BitGoReadOnlyRuntimeCompositionConfig,
): CustodyObservationAdapterFactory;
```

Equivalent property spelling is permitted only when it follows the canonical
repository convention and preserves this exact dependency set. No credential,
execution-context, registry-provider, transport, client, environment, or
database input is authorized.

## Composition Model

The composition factory must explicitly:

1. receive caller-provided readonly registry entries;
2. call `createBitGoWalletIdResolver(config.registryEntries)`;
3. inject the returned resolver into
   `createBitGoBalanceObserverAdapterFactory`;
4. inject `config.semanticAdapterFactory` into that factory;
5. pass the optional existing correlation-ID factory unchanged when present;
6. use the canonical non-authorized credential representation, `null`; and
7. retain `authorizedExecutionContext` as `false`.

The result is the existing `CustodyObservationAdapterFactory` boundary. P6-T09
does not construct an authorized execution context, a credential context, a
provider client, or an orchestration framework.

## Registry Input And Binding Semantics

Registry input is synthetic, caller-injected, and in-memory only. Allowed
inputs are readonly registry-entry arrays and synthetic test fixtures.

P6-T09 must not read a registry from a database, environment, filesystem,
configuration file, secret manager, remote service, or external API. It must
not implement a registry copy, refresh manager, cache, singleton, or mutable
external registry dependency. P6-T08 remains responsible for the construction
snapshot.

The existing P6-T08 identity tuple remains exact:

- `providerCode`
- `bindingKey`
- `assetCode`
- `accountRole`

P6-T09 must not add normalization, trimming, case conversion, coercion,
wildcards, partial matching, fallback, alternate provider matching, alternate
asset matching, or bindingKey-as-wallet behavior.

Qualification fixtures may use only clearly synthetic test-only wallet IDs that
match the P6-T08 validation format `^[0-9a-f]{32}$`. Production source must not
hard-code a wallet ID. Actual BitGo wallet IDs: `0`.

## Execution Context And Credential Boundary

P6-T09 owns neither existing execution-context construction nor a future
authorized execution context. The composition must preserve the P6-T07 factory
flag as `authorizedExecutionContext: false`.

The credential reference is `null`, the exact canonical non-authorized
representation. Credential IDs, secret references, actual credentials,
environment credentials, secret-manager reads, and P6-T06 authority reuse are
prohibited. P6-T06 live credential authority is `CLOSED / NON-REUSABLE`.

`Authorized Execution Context Composition` is deferred to separately governed
future work.

## Adapter, Server-Only, And Lifecycle Boundary

The semantic adapter factory is supplied by injection only. P6-T09 must not
instantiate a BitGo SDK, HTTP transport, provider transport, credential
resolver, or provider client, and must not make a network request.

The source module requires a direct `server-only` boundary. Client/browser
imports are prohibited. Static import and composition construction must cause
network, credential, provider, and database activity of `0`.

Composition occurs only through an explicit factory call. The implementation
must have no module-import initialization, singleton, global mutable state,
background task, scheduler, interval, automatic startup, dynamic refresh, hot
reload registry behavior, or provider connection during construction. Repeated
invocation must be stable. Separate composition instances must be isolated.
Provider-client lifecycle remains predecessor-owned.

## Success And Failure Propagation

The successful synthetic path is: binding, existing observer, P6-T08 resolver,
synthetic wallet ID, injected semantic adapter boundary, and existing observer
result. P6-T09 must propagate the existing P6-T07 result unchanged.

P6-T09 must preserve predecessor behavior for:

- `WALLET_ID_NOT_CONFIGURED` missing-binding resolution;
- `WALLET_ID_INVALID` invalid wallet-ID resolution;
- `WALLET_ID_RESOLUTION_FAILED` resolver internal-failure resolution;
- `RangeError("bitgo_wallet_id_resolver_duplicate_binding")` for a duplicate
  exact registry tuple; and
- downstream semantic-adapter results and failures.

P6-T09 must not catch or translate the duplicate-tuple error, add result codes,
perform hidden retries, add fallbacks, or swallow errors. New result codes:
`0`. Hidden retry: `0`. Fallback: `0`. Swallowed errors: `0`.

## Exact Future Implementation Scope

The future implementation scope is frozen as `A2 / M0 / D0`:

1. `src/server/custody/bitgo-read-only-runtime-composition.ts`
2. `src/server/custody/bitgo-read-only-runtime-composition.test.ts`

No other tracked path is authorized. In particular, P6-T04 security source,
P6-T05 semantic-adapter source, P6-T07 observer/worker/orchestrator source,
P6-T08 resolver source and test, package files, lockfiles, TypeScript/lint/build
configuration, database schema, migrations, `.env*`, credential stores,
production schedulers, and provider-registry persistence are prohibited.

If implementation requires a prohibited path, this contract is blocking and
work must return to governance. Scope must not expand automatically.

## Type Safety

Existing types and union/result contracts must be reused. Production `any` is
prohibited unless separately reviewed. Production `as unknown as` is prohibited.
Runtime coercion is prohibited. Registry input remains readonly and no mutable
external registry dependency is permitted.

## Offline Qualification Catalog

The qualification catalog is exactly 18 sequential, unique, gap-free,
synthetic-only cases. Each case identifier appears exactly once in the catalog
below.

### P6T09-COMP-001: Factory Construction And Canonical Dependency Reuse

Prove the composition factory accepts canonical dependencies, returns the
expected `CustodyObservationAdapterFactory`, and introduces no duplicate
observer, resolver, or adapter contract.

### P6T09-COMP-002: Resolver Construction From Injected Registry Entries

Prove supplied entries construct the canonical P6-T08 resolver and no external
registry source is accessed.

### P6T09-COMP-003: Successful Exact Synthetic Binding Flow

Prove an exact synthetic BITGO/TSOL binding resolves, the expected synthetic
wallet ID reaches the injected downstream boundary, and the existing success
result propagates unchanged.

### P6T09-COMP-004: Binding-Key Exactness Preserved

Prove composition adds no bindingKey normalization or fallback.

### P6T09-COMP-005: Provider Exactness Preserved

Prove composition adds no provider normalization or fallback.

### P6T09-COMP-006: Asset Exactness Preserved

Prove composition adds no asset normalization or fallback.

### P6T09-COMP-007: Account-Role Exactness Preserved

Prove composition adds no account-role normalization or fallback.

### P6T09-COMP-008: Missing-Binding Propagation

Prove the P6-T08 missing-resolution behavior reaches the observer boundary
according to existing P6-T07 semantics, with no new result code.

### P6T09-COMP-009: Invalid Wallet-ID Propagation

Prove the `WALLET_ID_INVALID` path is preserved through composition without
retry or fallback.

### P6T09-COMP-010: Resolver Internal-Failure Propagation

Prove `WALLET_ID_RESOLUTION_FAILED` remains fail-closed through composition.

### P6T09-COMP-011: Duplicate-Tuple Construction Failure

Prove an exact duplicate tuple produces
`RangeError("bitgo_wallet_id_resolver_duplicate_binding")` without translation
or swallowing by P6-T09.

### P6T09-COMP-012: Synthetic Downstream Success And Result Preservation

Prove the injected semantic-adapter result is returned through existing P6-T07
observer semantics without a P6-T09 result code.

### P6T09-COMP-013: Synthetic Downstream Failure Propagation

Prove downstream semantic-adapter failure or result propagates according to the
predecessor contract with no retry.

### P6T09-COMP-014: Repeated Invocation Stability

Using one composition instance, prove repeated synthetic observations remain
stable and do not mutate registry or composition state.

### P6T09-COMP-015: Composition-Instance Isolation

Create two composition instances with distinct synthetic registries and
dependencies and prove no state leaks between them.

### P6T09-COMP-016: Caller Registry Mutation Isolation

After construction, mutate caller-owned test array or entry state as permitted
by test typing and prove behavior remains based on the P6-T08 construction
snapshot.

### P6T09-COMP-017: Construction And Import Side-Effect Boundary

Prove or statically inspect that import and construction cause provider calls,
network activity, credentials, database activity, and scheduler activity of
`0`.

### P6T09-COMP-018: Full Authority Guard

Prove qualification uses actual wallet IDs, real registry entries, credentials,
BitGo, Solana RPC, database mutation, scheduler, production, writes, and
signing at `0`, and does not reuse closed live authority from P6-T06, P6-T07,
or P6-T08.

## Qualification Strategy

Required static gates are `npx tsc --noEmit`, exact-path lint of the two future
P6-T09 files with zero warnings, and `npm run build`. Each must pass.

Runtime qualification must use an exported P6-T09 qualification function from
the test module when consistent with predecessor style. If the repository test
runner does not execute it, qualification may compile only required modules into
an operating-system temporary directory outside the repository, supply a
temporary `server-only` shim only when necessary, use a process-local
`NODE_PATH` only when necessary, execute with Node, and remove all temporary
files afterward. No tracked harness, dependency installation, package change,
or repository residue is authorized.

Required gates are 18 / 18 cases, TypeScript pass, exact two-file lint pass
with zero warnings, build pass, and provider, credential, and database activity
of `0`.

## External Activity And Provider Activation Guard

Expected counts are all `0`: actual registry entries, actual wallet IDs, DB
registry reads, DB mutations, environment registry reads, environment credential
reads, filesystem registry reads, secret-manager reads, credential resolver
calls, provider calls, BitGo calls, Solana RPC calls, scheduler activity,
production activity, writes, and signing.

P6-T09 does not authorize a real wallet-ID registry, actual BitGo wallet IDs,
real credential references, secret resolution, BitGo TEST calls, BitGo
production calls, provider transport, Solana RPC, a DB-backed registry,
scheduling, production, writes, signing, or fund movement. Provider authority:
`NONE`.

## Deferred Follow-On Work

The following work is explicitly deferred without assigning later task IDs:

1. Secure Wallet-ID Registry and Resolver Provisioning Governance.
2. BitGo Credential-Reference Provisioning Governance.
3. Authorized Execution Context Composition.
4. Controlled BitGo TEST Read Activation.
5. Scheduler / Production Activation Governance.

## Implementation Authorization Prerequisites

Implementation authority may be issued only after this contract is merged into
canonical, its SHA-256 and Git blob are frozen, the exact implementation scope
is reconfirmed, P6-T07 and P6-T08 canonical identity remains valid, the 18 / 18
proof mapping remains frozen, and provider authority remains `NONE`.

Contract publication grants no implementation authority.

## Invalidation Conditions

Future implementation authorization is invalidated by canonical drift, contract
identity drift, scope expansion, predecessor contract or interface change, a
need to modify P6-T04/P6-T05/P6-T07/P6-T08, a package or configuration change
requirement, qualification failure, provider activity, credential activity,
actual wallet-ID use, database mutation, or scheduler/production activity.

## Definition Of Done

P6-T09 implementation is complete only when the exact two implementation files
are the only implementation paths, canonical predecessor interfaces are reused,
18 / 18 qualification cases pass, TypeScript passes, exact two-file lint passes
with zero warnings, build passes, external/provider/credential/database activity
is zero, separately authorized Git publication and canonical merge/cleanup are
complete, and provider activation remains unauthorized.

This contract publication preparation does not satisfy those conditions.

## Final Frozen Markers

- Task: `P6-T09`
- Status: `FROZEN CONTRACT`
- Implementation scope: `A2 / M0 / D0`
- Qualification: complete sequential 18-case P6-T09 composition catalog
- Qualification case count: `18`
- Provider authority: `NONE`
- Real provider activation: `PROHIBITED`
- Actual wallet IDs: `PROHIBITED`
- Credentials: `PROHIBITED`
- Production: `PROHIBITED`
