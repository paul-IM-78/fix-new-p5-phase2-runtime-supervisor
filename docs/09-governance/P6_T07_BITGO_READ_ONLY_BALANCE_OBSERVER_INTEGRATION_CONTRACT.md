# P6-T07: BitGo Read-Only Balance Observer Integration Contract Freeze

Status: FROZEN CONTRACT

Classification: `PHASE6_BITGO_READ_ONLY_BALANCE_OBSERVER_INTEGRATION_CONTRACT_FREEZE`

Canonical baseline: `6b5111bdbb4cae013cdf9b707eb3cfd58d28dbe4`

## Purpose

This contract defines the fail-closed integration boundary that adapts the
already-qualified P6-T05 BitGo single-wallet balance semantic adapter to the
generic `CustodyObservationAdapter` and `CustodyObservationAdapterFactory`
surface consumed by the balance-observer worker and orchestrator.

THIS CONTRACT DOES NOT AUTHORIZE REAL PROVIDER EXECUTION.

## Predecessor Closure

P6-T06 is COMPLETE with classification `CLEAN_PASS`. Its process authority and
logical-read authority are both exhausted at `1 / 1 / 0`. Its credentials are
cleared, token reuse is prohibited, execution authority reuse is prohibited,
and a second provider read is prohibited. P6-T07 starts with zero provider
execution authority and MUST NOT inherit any P6-T06 credential, session, token,
or logical-read budget.

## Architecture Gap

The generic `CustodyObservationAdapter` requires `provider`, `readHealth()`,
`readBalances(...)`, and `readTransfers(...)`. The balance-observer worker calls
`adapter.readBalances(...)`, and the orchestrator consumes a
`CustodyObservationAdapterFactory`.

P6-T05 exposes `readHealth()` and
`readBalance(binding, walletId, correlationId)`. It does not itself provide the
generic batch adapter or factory surface. No canonical bridge currently composes
the P6-T05 semantics into that surface.

Classification: `BITGO_BALANCE_OBSERVER_INTEGRATION_GAP_CONFIRMED`.

## Integration Components

The future implementation has exactly these conceptual components:

- `BitGoBalanceObserverAdapter`: a generic balance-only adapter bridge.
- `BitGoBalanceObserverAdapterFactory`: the validated construction and lifecycle boundary.
- `BitGoWalletIdResolver`: the server-only binding-alias to raw BitGo wallet-ID resolution boundary.

No plaintext-token component, direct provider transport component, or
database-writing bridge component is authorized.

## Capability and Generic Adapter Contract

The provider capability declaration MUST be exactly:

```ts
["BALANCE_OBSERVATION"]
```

`TRANSFER_OBSERVATION`, `TRANSFER_LOOKUP`, `PAYOUT_SUBMISSION`,
`WEBHOOK_INGESTION`, staking, withdrawal, transaction submission, signing,
wallet creation, and address creation are out of scope and unauthorized.

`BitGoBalanceObserverAdapter` MUST expose the generic `provider`,
`readHealth()`, `readBalances(bindings, options)`, and `readTransfers(...)`
members. `lookupTransferByEvidenceDigest` MUST be omitted because
`TRANSFER_LOOKUP` is absent.

## Health Contract

P6-T05 owns semantic health. The bridge MUST NOT perform an additional health
network request, credential probe, or wallet-existence probe. `UNKNOWN` is
valid before a provider attempt. A successful P6-T05 balance read makes the
P6-T05 state `AVAILABLE`; P6-T05 and P6-T04 retain transport/security failure
mapping.

One bridge instance MUST use one underlying P6-T05 semantic-adapter instance.
The latest P6-T05 read health is authoritative. The bridge MUST NOT add a
second aggregated health model.

## Batch and Duplicate Contract

Initial bridge execution MUST be `SEQUENTIAL_PER_BINDING`. Input order and
output order MUST be preserved: output index N corresponds to input index N.
The bridge MUST return exactly one result for each requested non-aborted
binding, with no reordering, omission, duplication, or fabricated success.
Bridge-owned concurrency is zero. `Promise.all` provider fan-out is prohibited.
The existing orchestrator retains concurrency ownership.

The balance-observer worker remains the primary duplicate validation owner.
Direct bridge invocation with duplicate binding references MUST reject before
wallet resolution or provider activity with the deterministic server-only code
`BITGO_BALANCE_OBSERVER_DUPLICATE_BINDING`. It MUST NOT fabricate a duplicate
result array.

## Binding Validation and Abort Contract

Before resolution, the bridge MUST validate each generic binding. Provider
mismatch maps to `UNEXPECTED_RESULT`; asset mismatch maps to
`UNSUPPORTED_ASSET`; malformed binding maps to `UNEXPECTED_RESULT`. Each is
non-retryable with `retryAfterMs: null`. Invalid bindings MUST cause zero wallet
resolver calls and zero provider calls.

The generic abort signal MUST propagate from bridge to P6-T05 and P6-T04. If
already aborted, a binding MUST not start resolution or provider activity. If
aborted during a binding, existing P6-T05/P6-T04 abort semantics govern and no
remaining binding may start. The bridge MUST reject the batch on abort without
a bridge-owned retry; the existing worker converts adapter abort/throw behavior
to complete `ABORTED` worker outcomes.

## Correlation ID Contract

The default correlation-ID generator MUST be `crypto.randomUUID()`, producing
an opaque lowercase UUID. It MUST NOT be derived from a wallet ID, binding key,
user, account, asset, or other raw provider identifier. Focused offline tests
may inject a deterministic `correlationIdFactory`.

## Binding Key and Wallet Resolver Contract

`bindingKey` is a private immutable logical alias. It is not a BitGo wallet ID.
`walletId = binding.bindingKey` is prohibited.

Classification: `BINDING_KEY_REQUIRES_WALLET_RESOLUTION`.

The injected, server-only, async-capable, abort-aware `BitGoWalletIdResolver`
has the conceptual signature:

```ts
resolveWalletId(
  binding: CustodyAccountBindingRef,
  options?: { signal?: AbortSignal },
): Promise<BitGoWalletIdResolution>
```

Success may contain the raw BitGo wallet ID in process memory only. Failures
MUST contain only safe deterministic diagnostics. Integration-local safe codes
are `WALLET_ID_NOT_CONFIGURED`, `WALLET_ID_INVALID`, and
`WALLET_ID_RESOLUTION_FAILED`; before becoming a generic adapter result they
MUST map to non-retryable `UNEXPECTED_RESULT` with `retryAfterMs: null`.
Resolver exceptions MUST be caught, stripped of unsafe details, and mapped to a
static safe failure.

The resolved value MUST already match `^[0-9a-f]{32}$`. Trimming, lowercasing,
normalization, and coercion are prohibited. Invalid resolution causes zero
provider calls. P6-T05 retains its validation as defense in depth.

## Wallet Privacy and Storage

The raw BitGo wallet ID is a `SENSITIVE_SERVER_ONLY_PROVIDER_IDENTIFIER`. It
may exist only in a resolver success object, bridge call stack, and P6-T05 input
for the minimum execution duration. It MUST NOT appear in logs, error messages,
metrics labels, correlation IDs, public APIs, client state, governance reports,
or database observation rows unless separately governed. Runtime hashing for
telemetry is not authorized.

`P6_T07_RAW_WALLET_PERSISTENCE = PROHIBITED`.

P6-T07 MUST NOT implement raw wallet persistence in PostgreSQL, dotenv files,
configuration files, browsers, public APIs, persistent secret managers, or any
other storage. Classification:
`SERVER_ONLY_INJECTED_WALLET_RESOLVER_NO_PERSISTENCE_IN_P6_T07`. A separate
future activation task must govern the actual secure resolver source.

## Credential and Execution Context Boundary

The bridge and factory may accept only `CredentialReference | null` using the
existing P6-T04 symbolic reference type. Plaintext token input, direct
`process.env` token access, Authorization construction, token caching, token
refresh, and token creation are prohibited. P6-T04 remains the exclusive
plaintext credential resolver.

`authorizedExecutionContext` MUST default to `false`. It MUST NOT be globally
hard-coded true, kept in a permanently-authorized singleton, or enabled by an
environment variable. Offline tests may inject true only with a fake or stub
executor for which real network activity is impossible. Real execution requires
a separate governance gate.

## Provider, Asset, and Unsupported Capability Contract

The provider code MUST be `BITGO` and capabilities MUST be exactly
`BALANCE_OBSERVATION`. The implementation MUST NOT introduce a new hardcoded
provider type; it validates against the approved/discovered generic provider
configuration before wallet resolution or P6-T05 invocation.

The only mapping is `TSOL -> tsol`. `TSOL` is the canonical observer asset code
and `tsol` is the P6-T05 BitGo coin. No automatic case conversion and no
additional asset mapping are authorized.

Because the generic interface requires `readTransfers(...)`, that method MUST
fail closed using `BitGoBalanceObserverUnsupportedCapabilityError` with static
safe code `UNSUPPORTED_CAPABILITY`. It performs zero provider calls, wallet
resolutions, credential resolutions, P6-T05 calls, and P6-T04 calls. It MUST
NOT return an empty successful page, which could be interpreted as a provider
query with zero transfers.

## P6-T04 and P6-T05 Ownership

P6-T04 exclusively owns endpoint registry, TEST/production endpoint selection,
DNS and IP validation, SSRF protection, TLS, plaintext credential resolution,
Authorization timing, deadlines, response-byte limits, JSON transport,
transport retry, safe status handling, redaction, and audit metadata. The
bridge MUST NOT directly use fetch, axios, undici, http, https, or another
provider network mechanism.

P6-T05 exclusively owns the BitGo balance descriptor, response wallet-ID match,
`coin == tsol` validation, balance amount validation, atomic-unit normalization,
health mapping, and `CustodyBalanceObservationResult` construction. The bridge
MUST NOT parse raw BitGo JSON or inspect provider balance fields.

## Retry Contract

P6-T04 owns bounded transport retry with a maximum of 3 attempts and a 10
second total deadline. The P6-T07 bridge adds zero retry attempts:

```text
P6_T07_BRIDGE_HIDDEN_RETRY_ATTEMPTS = 0
```

No bridge-level loop, recursive retry, hidden second wallet resolution,
fallback provider call, or hidden P6-T05 retry is allowed. The worker retains
existing explicit bounded adapter/database retries, with canonical default
maximum 3 where applicable. The orchestrator retains explicit scope-read retry,
disabled by default. Future activation governance must account for the
multiplicative risk that one worker adapter attempt can include bounded P6-T04
transport attempts.

## Identity, Idempotency, and Persistence

The identity policy union MUST be extended only as follows:

```ts
type CustodyBalanceObserverIdentityPolicy =
  | "PRODUCTION"
  | "REMOTE_CONTENT"
  | "LOCAL_MOCK";
```

`PRODUCTION` remains `NATIVE | CHECKPOINT` only. `REMOTE_CONTENT` permits
`CONTENT` only. `LOCAL_MOCK` continues to permit all currently valid identity
kinds. `PRODUCTION` and `LOCAL_MOCK` semantics MUST NOT change.

P6-T05 BitGo observations retain `{ kind: "CONTENT" }`. The bridge MUST NOT
manufacture `NATIVE` or `CHECKPOINT` identity from a wallet ID, balance, or
binding alias. The existing key algorithm is retained:
`EXISTING_CONTENT_OBSERVATION_KEY_V1_REUSED`.

The existing key includes canonical provider, binding, asset, observer kind,
identity, total units, and observed-at fields. An identical normalized payload
at the same observed-at timestamp remains deterministic. An equal balance at a
different observed-at timestamp is a distinct valid observation event. P6-T07
MUST NOT change checkpoint or database idempotency semantics.

The bridge is provider-read adaptation only and MUST NOT connect to PostgreSQL
or write a database. The worker owns normalization and identity enforcement;
the command client owns atomic observation persistence/checkpoint advancement;
the orchestrator owns scope coordination. No migration or new persistence table
is expected. Classification:
`EXISTING_BALANCE_OBSERVER_PERSISTENCE_REUSED_UNCHANGED`.

## Factory and Per-Binding Sequence

The factory configuration consists of validated `provider`,
`credentialReference`, `authorizedExecutionContext`, `walletIdResolver`, and
optional `correlationIdFactory` and offline semantic-adapter test injection.
The factory returns one bridge using one semantic adapter for its sequential
batch lifecycle.

For every binding, the bridge MUST perform this sequence:

1. Observe abort state.
2. Validate the generic binding.
3. Validate provider and asset mapping.
4. Resolve the wallet ID through the injected resolver.
5. Validate the exact lowercase 32-hex wallet-ID format.
6. Generate an opaque correlation ID.
7. Invoke P6-T05 `readBalance` once.
8. Put the returned result at the same output index.

New integration errors MUST have only static safe messages and deterministic
safe codes. They MUST NOT include a binding key, wallet ID, token, provider
body, or unsafe error cause.

## Offline Qualification Contract

All P6-T07 implementation tests MUST be offline. The matrix MUST cover factory
validation, ordered batch output, exact count, provider/asset mismatch,
resolver absence/throw, wallet format, one call per resolved binding,
correlation privacy, abort before/between bindings, zero hidden retry, partial
failure, duplicate rejection, transfer fail-closed behavior, health delegation,
`CONTENT`, `REMOTE_CONTENT`, unchanged `PRODUCTION` and `LOCAL_MOCK`, symbolic
credential passage, exact execution-context propagation, and TEST-only P6-T05
reuse.

Executors, resolvers, and credential references MUST be faked or symbolic.
Tests MUST perform zero real BitGo, DNS, TLS, Solana RPC, credential-environment,
or provider network activity.

## Future Implementation Scope

Expected new source:

```text
src/server/custody/bitgo-balance-observer-adapter.ts
```

Expected new test:

```text
src/server/custody/bitgo-balance-observer-adapter.test.ts
```

Expected modified files are limited to:

```text
src/server/custody/balance-observer-worker.ts
scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs
```

P6-T04 provider-security, P6-T05 semantic adapter, generic orchestrator, scope
client, command client, and database schema/migrations are expected to remain
unchanged. This document does not authorize implementation.

## Activation and Environment Boundary

Contract publication and later P6-T07 implementation do not authorize a real
provider call. The required progression is contract publication, implementation,
offline qualification, a separately governed TEST one-shot activation, and only
then a separate consideration of recurring runtime.

Scheduler, polling, recurring worker activation, startup hooks, and cron are
prohibited. The only provider environment is BITGO TEST with asset `TSOL` and
coin `tsol`. Production and automatic TEST-to-production switching are
prohibited.

Future real integration separately requires credential-reference provisioning,
wallet-resolver provisioning, explicit execution-context activation, and
one-shot authorization. It does not reuse P6-T06 credential lifecycle.

## In Scope and Out of Scope

In scope: the generic balance adapter/factory contract, wallet resolver
interface, batch and abort semantics, correlation policy, provider/asset
validation, symbolic credential boundary, execution-context gate, unsupported
transfer behavior, retry ownership, `REMOTE_CONTENT`, `CONTENT` identity,
existing persistence reuse, offline tests, and a future one-shot prerequisite.

Out of scope: real provider calls, credential creation or token management, raw
wallet persistence, production, scheduler/polling/recurring workers, transfer
observation or lookup, webhooks, payout, withdrawal, staking, transaction
submission, signing, wallet/address creation, migrations unless separately
governed, UI, public APIs, and deployment.

## Security Invariants

1. The bridge never receives a plaintext token.
2. The bridge never constructs Authorization.
3. The bridge never directly calls the BitGo network.
4. A raw wallet ID is never assumed equal to `bindingKey`.
5. A raw wallet ID is server-only and transient.
6. Invalid provider, asset, or wallet input fails before a provider call.
7. The bridge adds zero hidden retries.
8. Unsupported transfer access fails closed.
9. Execution context defaults false.
10. No automatic production path exists.
11. P6-T04 remains the security owner.
12. P6-T05 remains the BitGo semantic owner.
13. The bridge does not write the database.
14. Real provider activation requires future governance.
15. Scheduler activation requires future governance.
16. P6-T06 credentials and authority cannot be reused.

## Definition of Done

P6-T07 implementation is not complete until offline qualification proves the
exact adapter/factory surface, server-only resolver injection, `TSOL -> tsol`
validation, batch order/count, duplicate rejection, abort handling, correlation
privacy, symbolic credential use, false-by-default execution context, no direct
network path, zero bridge retries, fail-closed transfers, `REMOTE_CONTENT`,
`CONTENT` retention, observation-key reuse, existing persistence ownership,
unchanged P6-T04/P6-T05/orchestrator and database boundaries, and all required
tests passing. Production and scheduler activation remain prohibited.

## Contract Authority

This contract publication authorizes future implementation work only after
separate implementation governance. It does not authorize a BitGo request,
credential use, production wallet resolver source, live database testing,
scheduler, or production access.
