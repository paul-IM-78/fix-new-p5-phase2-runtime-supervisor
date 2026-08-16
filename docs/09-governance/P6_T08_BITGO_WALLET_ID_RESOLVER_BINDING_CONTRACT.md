# P6-T08: BitGo Wallet-ID Resolver Source and Binding-Resolution Contract Freeze

Status: FROZEN CONTRACT

Classification:
\`PHASE6_BITGO_WALLET_ID_RESOLVER_SOURCE_AND_BINDING_RESOLUTION_CONTRACT_FREEZE\`

Canonical baseline:
\`79f9acd593df8193f4bb051e0589bde9741344ff\`

Task source:
\`DERIVED_NEXT_TASK_CANDIDATE\`

Governance authorization:
\`P6_T08_BITGO_WALLET_ID_RESOLVER_GOVERNANCE_AUTH_79F9ACD5\`

Required primary marker:
\`P6_T08_BITGO_WALLET_ID_RESOLVER_SOURCE_AND_BINDING_RESOLUTION_FROZEN\`

## Purpose And Confirmed Source Gap

P6-T07 froze and qualified the read-only balance-observer boundary, including
the \`BitGoWalletIdResolver\` interface. The actual source of a raw BitGo TEST
wallet identifier remains intentionally disabled and is not implemented.

The future architecture chain is:

\`\`\`
logical binding
  -> exact server-only binding lookup
  -> raw BitGo TEST wallet ID
  -> P6-T07 adapter
  -> P6-T05 observation persistence
\`\`\`

Marker:
\`BITGO_WALLET_ID_RESOLVER_SOURCE_GAP_CONFIRMED\`

This contract freezes only the resolver source and binding-resolution boundary.
It does not authorize actual resolution, a real provider request, credential
use, wallet provisioning, or any runtime activation.

## Selected Resolver Source Model

The selected future source model is:

\`SERVER_ONLY_INJECTED_IMMUTABLE_BINDING_REGISTRY\`

Marker:
\`P6_T08_SERVER_ONLY_INJECTED_IMMUTABLE_BINDING_REGISTRY_SELECTED\`

A future resolver receives server-only registry entries by dependency
injection. It must not read a database, environment variable, dotenv file,
checked-in configuration file, secret manager, local file, network resource,
or BitGo service. It must not perform I/O, refresh, reload, watch, polling, or
background activity. Construction creates one immutable in-memory snapshot.

This selection does not select a persistent store. Actual source provisioning,
process composition, lifecycle, deployment, restart behavior, and activation
remain separate future governance.

## Future Registry Entry And Resolver API

The future conceptual registry entry is exactly:

\`\`\`ts
type BitGoWalletIdBindingRegistryEntry = Readonly<{
  binding: CustodyAccountBindingRef;
  walletId: string;
}>;
\`\`\`

The future component must be server-only and use the existing resolver
interface:

\`\`\`ts
import "server-only";

export function createBitGoWalletIdResolver(
  entries: readonly BitGoWalletIdBindingRegistryEntry[],
): BitGoWalletIdResolver;
\`\`\`

The raw wallet identifier is a sensitive server-only provider identifier, not a
credential. No actual wallet identifiers are authorized in this contract,
repository source, tests, fixtures, logs, reports, or documentation. Future
tests use synthetic identifiers only.

## Exact Binding Identity

Binding resolution uses the exact tuple:

\`\`\`
providerCode, bindingKey, assetCode, accountRole
\`\`\`

Every tuple field is exact. The resolver must not trim whitespace, change case,
normalize Unicode, coerce types, use substring or prefix matching, use
wildcards, or fall back to a default. Provider, asset, and role defaults are
not permitted.

P6-T08 covers only:

\`\`\`
providerCode = BITGO
assetCode = TSOL
\`\`\`

The \`TSOL -> tsol\` mapping remains owned by P6-T07 and P6-T05. P6-T08 adds
no provider or asset mapping.

The binding key is a logical alias and is not a provider identifier.

Marker:
\`P6_T08_BINDING_KEY_IS_LOGICAL_ALIAS_NOT_PROVIDER_IDENTIFIER\`

The resolver must not use, derive, hash, transform, or treat \`bindingKey\` as
a BitGo wallet ID. It must only use it as one component of the exact logical
lookup tuple.

## Duplicate And Wallet-ID Validation

Duplicate exact binding tuples must fail resolver construction with a static,
safe diagnostic. The diagnostic must not contain binding values, binding keys,
wallet IDs, or registry contents.

Marker:
\`P6_T08_DUPLICATE_BINDING_SOURCE_REJECTED\`

P6-T08 does not require global wallet-ID uniqueness across different valid
binding tuples.

A wallet ID is valid only when it matches exactly:

\`\`\`
^[0-9a-f]{32}$
\`\`\`

Whitespace, uppercase characters, a \`0x\` prefix, incorrect length, and
non-hex characters are invalid. No wallet-ID normalization is permitted.

## Resolution Outcomes And Fail-Closed Behavior

The future resolver preserves exactly these outcomes:

| Condition | Outcome |
| --- | --- |
| Exact valid tuple | \`{ ok: true, walletId }\` |
| Missing tuple | \`WALLET_ID_NOT_CONFIGURED\` |
| Invalid configured wallet ID | \`WALLET_ID_INVALID\` |
| Internal resolver failure | \`WALLET_ID_RESOLUTION_FAILED\` |

No additional outcome code is authorized. Failure results and diagnostics must
not disclose sensitive data.

Marker:
\`P6_T08_WALLET_ID_RESOLUTION_FAIL_CLOSED_NO_FALLBACK\`

Any failure has zero provider calls, zero credential use, zero transport
activity, zero fallback, and zero hidden retry. The resolver must not invent a
wallet ID or fabricate success.

## Immutable Snapshot Boundary

Marker:
\`P6_T08_IMMUTABLE_RESOLVER_SOURCE_SNAPSHOT\`

Caller mutation of the input entries after construction must not affect the
resolver. The resolver must not support hot reload, watched files, periodic
refresh, background refresh, polling, or network refresh.

Raw wallet IDs may exist only in the constructor input snapshot, the resolver's
private memory, a successful result object, and the existing P6-T07/P6-T05
server-side call stack. They must not be exposed to a browser, API response,
public module, or client-side state.

## Persistence, Logs, And Observability

Raw wallet-ID persistence is not authorized.

Marker:
\`P6_T08_RAW_WALLET_ID_PERSISTENCE_NOT_AUTHORIZED\`

P6-T08 authorizes no database, Supabase, custody persistence, observation
persistence, run-ledger persistence, dotenv persistence, checked-in
configuration persistence, JSON/YAML persistence, browser persistence, or
migration. It does not authorize a durable wallet-ID record.

Logs, metrics, and audit events must not include a raw wallet ID or a hash of a
raw wallet ID. New error and metric paths must not include a binding key.
Coarse safe observability may use provider code, asset code, account role,
outcome code, or aggregate count only.

## Credential, Transport, And Ownership Boundaries

Wallet identifier source is separate from credential source.

Marker:
\`P6_T08_WALLET_IDENTIFIER_SOURCE_SEPARATE_FROM_CREDENTIAL_SOURCE\`

P6-T08 authorizes no access token, credential reference, Authorization header,
secret name, credential resolver, credential provisioning, token lifecycle, or
credential pairing. Credential and transport ownership remains with P6-T02 and
P6-T04. P6-T08 does not authorize \`fetch\`, HTTP, DNS, TLS, Solana RPC, BitGo
SDK usage, or direct provider activity.

The existing P6-T07 abort behavior remains unchanged. P6-T08 adds no abort
code, retry code, or fabricated success behavior.

## Activation And Durable Boundaries

Marker:
\`P6_T08_REAL_WALLET_ID_RESOLVER_ACTIVATION_NOT_AUTHORIZED\`

This frozen contract does not authorize actual wallet IDs, registry entries,
real resolution, process composition, credential pairing, authorized execution
context, on-demand invocation, scheduler activity, polling, production, or a
real provider call.

Marker:
\`P6_T08_RUNTIME_COMPOSITION_DEFERRED\`

Future runtime composition governance must separately decide source
provisioning, process lifecycle, restart behavior, credential pairing,
authorized execution context, and on-demand invocation. It must remain
offline, synthetic, and non-provider until separately activated.

Any future production policy remains limited to read-only, on-demand
\`BITGO\`/\`SOLANA\`/\`BITGO_TEST\`/\`TSOL\` behavior. P6-T08 authorizes no
production values or production execution.

P6-T08 must not change the recorded-orchestrator durable policy, run-ledger
TypeScript validator, database CHECK constraint, SQL function, schema, or
migrations. Recorded durable execution remains limited to
\`PRODUCTION | LOCAL_MOCK\`; durable \`REMOTE_CONTENT\` remains unsupported.

Preserved marker:
\`P6_T07_RECORDED_REMOTE_CONTENT_ACTIVATION_NOT_YET_AUTHORIZED\`

P6-T08 authorizes no scheduler, timer, cron, worker loop, background polling,
write, signing, transfer, staking, withdrawal, approval, or transaction
submission capability.

## Future Implementation Scope

Future implementation is limited to exactly two new paths:

1. \`src/server/custody/bitgo-wallet-id-resolver.ts\`
2. \`src/server/custody/bitgo-wallet-id-resolver.test.ts\`

Expected future path totals:

\`\`\`
A = 2
M = 0
D = 0
total = 2
\`\`\`

The future resolver implements the existing \`BitGoWalletIdResolver\` interface
only. P6-T07 adapter code remains unchanged unless a later contract-blocking
defect requires separate governance. P6-T08 does not authorize changes to
package files, lock files, database schema, migrations, generated types,
run-ledger scope, P6-T04 security infrastructure, or P6-T05 semantics.

## Offline Qualification Catalog

Future P6-T08 implementation qualification must contain exactly 32 sequential,
unique synthetic case IDs:

| ID | Required proof |
| --- | --- |
| P6T08-RES-001 | Server-only module boundary is present. |
| P6T08-RES-002 | Empty registry constructs safely. |
| P6T08-RES-003 | Exact tuple resolves a valid synthetic wallet ID. |
| P6T08-RES-004 | Missing tuple returns \`WALLET_ID_NOT_CONFIGURED\`. |
| P6T08-RES-005 | Provider mismatch does not resolve. |
| P6T08-RES-006 | Asset mismatch does not resolve. |
| P6T08-RES-007 | Binding-key matching is exact. |
| P6T08-RES-008 | Account-role matching is exact. |
| P6T08-RES-009 | No trim behavior exists. |
| P6T08-RES-010 | No lowercasing behavior exists. |
| P6T08-RES-011 | No Unicode normalization exists. |
| P6T08-RES-012 | No type coercion exists. |
| P6T08-RES-013 | Exact valid wallet-ID format resolves. |
| P6T08-RES-014 | Uppercase wallet ID is rejected. |
| P6T08-RES-015 | Whitespace wallet ID is rejected. |
| P6T08-RES-016 | Incorrect wallet-ID length is rejected. |
| P6T08-RES-017 | Non-hex wallet ID is rejected. |
| P6T08-RES-018 | Duplicate exact tuple fails construction safely. |
| P6T08-RES-019 | No wildcard or default tuple resolution exists. |
| P6T08-RES-020 | No binding fallback exists. |
| P6T08-RES-021 | Resolver snapshot is immutable. |
| P6T08-RES-022 | Caller mutation cannot alter resolver behavior. |
| P6T08-RES-023 | Resolution is deterministic. |
| P6T08-RES-024 | Distinct valid tuples resolve independently. |
| P6T08-RES-025 | Missing diagnostic contains no sensitive data. |
| P6T08-RES-026 | Invalid diagnostic contains no sensitive data. |
| P6T08-RES-027 | No raw wallet ID, log, metric, or hash output is introduced. |
| P6T08-RES-028 | Zero database, file, environment, or secret-manager access occurs. |
| P6T08-RES-029 | Zero credential, provider, DNS, TLS, or Solana activity occurs. |
| P6T08-RES-030 | Existing resolver interface is reused. |
| P6T08-RES-031 | Durable and scheduler boundaries remain unexpanded. |
| P6T08-RES-032 | Production, provider, and mapping activation remain unauthorized. |

All cases are synthetic only. Future qualification requires:

\`\`\`
32 / 32 cases
TypeScript PASS
lint: 0 errors / 0 warnings
production build: PASS
provider calls: 0
credential activity: 0
actual wallet identifiers: 0
database mutations: 0
file/environment source access: 0
secret-manager access: 0
scheduler activity: 0
production activity: 0
writes/signing: 0
\`\`\`

## Contract Authority And Deferred Work

P6-T06 and P6-T07 are closed and their qualification evidence is not reusable
as implementation authorization for P6-T08. This contract freezes the
boundary only.

Classification:
\`P6_T08_CONTRACT_FROZEN_IMPLEMENTATION_NOT_YET_AUTHORIZED\`

Future implementation requires separate P6-T08 implementation governance. This
contract does not assign a P6-T09 task.

## Required Markers

- \`P6_T08_BITGO_WALLET_ID_RESOLVER_SOURCE_AND_BINDING_RESOLUTION_FROZEN\`
- \`BITGO_WALLET_ID_RESOLVER_SOURCE_GAP_CONFIRMED\`
- \`P6_T08_SERVER_ONLY_INJECTED_IMMUTABLE_BINDING_REGISTRY_SELECTED\`
- \`P6_T08_BINDING_KEY_IS_LOGICAL_ALIAS_NOT_PROVIDER_IDENTIFIER\`
- \`P6_T08_DUPLICATE_BINDING_SOURCE_REJECTED\`
- \`P6_T08_WALLET_ID_RESOLUTION_FAIL_CLOSED_NO_FALLBACK\`
- \`P6_T08_IMMUTABLE_RESOLVER_SOURCE_SNAPSHOT\`
- \`P6_T08_RAW_WALLET_ID_PERSISTENCE_NOT_AUTHORIZED\`
- \`P6_T08_WALLET_IDENTIFIER_SOURCE_SEPARATE_FROM_CREDENTIAL_SOURCE\`
- \`P6_T08_REAL_WALLET_ID_RESOLVER_ACTIVATION_NOT_AUTHORIZED\`
- \`P6_T08_RUNTIME_COMPOSITION_DEFERRED\`
- \`P6_T08_CONTRACT_FROZEN_IMPLEMENTATION_NOT_YET_AUTHORIZED\`
- \`P6_T07_RECORDED_REMOTE_CONTENT_ACTIVATION_NOT_YET_AUTHORIZED\`
