# P6-T05 BitGo Read-Only Semantic Adapter Implementation Contract

## Task Identity And Authority

- Task ID: `P6-T05`
- Task name: BitGo Read-Only Semantic Adapter Implementation
- Classification: `PHASE6_READ_ONLY_PROVIDER_SEMANTIC_ADAPTER_IMPLEMENTATION_GATE`
- Task type: `IMPLEMENTATION_TASK_WITH_FROZEN_CONTRACT`
- Status: `DEFINED_NOT_STARTED`
- Completion authority: `SEMANTIC_ADAPTER_IMPLEMENTED_AND_OFFLINE_QUALIFIED_BUT_REAL_CALLS_PROHIBITED`
- Canonical base: `6cb03076f1b8d50f52d2b6f907eea40345624158`

`P6_T05_TASK_DEFINED`

`P6_T05_BITGO_READ_ONLY_SEMANTIC_ADAPTER_IMPLEMENTATION`

`P6_T05_REAL_CALLS_REMAIN_PROHIBITED`

P6-T05 implementation may begin only after this contract successfully defined
and a later implementation step explicitly authorizes source/test changes.
Once this contract's SHA-256 is recorded after Step 3, it is immutable;
formatting-only changes are prohibited without governance reopen.

## Scope Freeze

The sole provider scope is `BITGO`, `SOLANA`, `BITGO_TEST`, and coin `tsol`.
The semantic scope is one native SOL test-wallet balance observation, derived
health, static capability metadata, deterministic response transformation, and
one approved request descriptor. Production access, real credentials, real
provider calls, wallet creation, transaction history, token/ATA/NFT inventory,
writes, signing, transfer/payout/withdrawal execution, webhooks, scheduling,
and automatic remediation are out of scope.

`P6_T05_TEST_ONLY`

`P6_T05_NATIVE_TSOL_ONLY`

`P6_T05_READ_ONLY`

`P6_T05_NO_PROVIDER_WRITES`

`P6_T05_NO_SIGNING`

`P6_T05_NO_REAL_CREDENTIALS`

`P6_T05_NO_REAL_PROVIDER_CALLS`

## Existing Architecture Compatibility

P6-T05 reuses, rather than changes, the following current contracts:

- `CustodyProviderRef`, `CustodyAccountBindingRef`,
  `CustodyBalanceObservation`, `CustodyBalanceObservationResult`,
  `CustodyBalanceObservationError`, `CustodyProviderHealth`, and
  `CustodyProviderHealthStatus` from
  `src/server/custody/provider-observation-contract.ts`.
- `normalizeAtomicUnits` from
  `src/server/custody/balance-observation-normalization.ts`.
- `ApprovedProviderRequestDescriptor`, `ProviderSecurityResult`,
  `CredentialFailure`, and `TransportFailure` from
  `src/server/provider-security/provider-security-types.ts`.
- `validateApprovedProviderRequestDescriptor` and `buildApprovedProviderUrl`
  from `src/server/provider-security/provider-security-request-descriptor.ts`.
- `executeApprovedProviderRequest` and its injected
  `ProviderSecurityRuntime` seam from
  `src/server/provider-security/provider-security-transport.ts`.
- `readBoundedProviderJson` from
  `src/server/provider-security/provider-security-response.ts`.

The current `CustodyObservationAdapter` also requires `readTransfers`. P6-T05
therefore defines a focused semantic balance reader, not a newly wired global
adapter factory or transfer implementation. A later, separately authorized
integration task must decide whether and how that reader is composed into a
full `CustodyObservationAdapter`; P6-T05 must not fake transfer support.

`CURRENT_CUSTODY_CONTRACT_SUFFICIENT = true`

`CURRENT_DESCRIPTOR_MODEL_SUFFICIENT = true`

`CURRENT_PROVIDER_SECURITY_TRANSPORT_SUFFICIENT = true`

`NO_GENERIC_SECURITY_INFRASTRUCTURE_CHANGE_REQUIRED = true`

## Frozen Read Operation

The only permitted provider operation is:

```text
GET /api/v2/{coin}/wallet/{walletId}
```

For P6-T05, `{coin}` is always `tsol`; the effective relative path is
`/api/v2/tsol/wallet/{walletId}`. `walletId` must match
`^[0-9a-f]{32}$` before descriptor construction. It is a BitGo wallet ID, not
a Solana receive address. A binding key must not be treated as a wallet ID
unless a later mapping authority explicitly establishes that mapping.

The approved descriptor is exactly:

```text
operationId: BITGO_TSOL_WALLET_GET_BALANCE
method: GET
relativePath: /api/v2/tsol/wallet/{walletId}
query: { includeBalance: "true" }
bodyAllowed: false
retrySafe: true
responseMode: JSON
```

`BALANCE_QUERY_POLICY_INCLUDE_BALANCE_TRUE`

`BG-SRC-024_FROZEN_PRIMARY_SOURCE`

`includeBalances` is prohibited. `expandBalance` is prohibited. Omitting all
balance query flags is insufficient. Combining query flags is prohibited.

## Response, Identity, And Amount Semantics

The minimum accepted object response contains:

- `id` as the requested wallet ID;
- `coin` as `tsol`;
- `balanceString` as the total balance in Lamports;
- `spendableBalanceString` as the available balance in Lamports.

`confirmedBalanceString` is optional. When present, it is independently
validated but is never a fallback for either required balance. Unknown fields
are ignored and never serialized to custody results, logs, errors, audit data,
or client output.

The response `id` and `coin` must exactly equal the validated request values.
Mismatch is an `UNEXPECTED_RESULT`; missing required fields are
`MISSING_RESULT`; unsupported coin/asset is `UNSUPPORTED_ASSET`; invalid
required or optional amount strings are `MALFORMED_AMOUNT`.

All balances are strings in native SOL base units: Lamports, with 9 decimal
places per SOL (`1e9` Lamports per SOL). The implementation must call
`normalizeAtomicUnits` for every accepted amount. Its exact policy is
`^(0|[1-9][0-9]{0,37})$`: non-empty decimal integer strings only, zero allowed,
no leading zero except zero, no sign, decimal point, exponent, whitespace,
control characters, or JavaScript numeric conversion. `Number`, `BigInt`,
`parseInt`, `parseFloat`, and floating-point arithmetic are prohibited for
provider amount parsing and output transformation.

`balanceString` maps to `observedTotalUnits` and `spendableBalanceString` maps
to `observedAvailableUnits`. P6-T05 does not assert arithmetic ordering between
these two provider values; it preserves individually validated strings.

## Input And Output Boundary

The semantic reader input is a server-only, explicitly typed request carrying:

- a `CustodyAccountBindingRef` for result association;
- a separately authorized and validated BitGo `walletId`;
- a TEST-only credential reference and authorized execution context supplied
  only to `executeApprovedProviderRequest`;
- a correlation ID and optional abort signal.

It must reject empty, malformed, uppercase, whitespace-padded, address-shaped,
or path-injection wallet IDs before the provider descriptor is created. It must
not accept arbitrary provider path, query, method, Authorization header,
environment, host, credential, request body, actor, browser identity, or
client-controlled provider result.

On success it returns a `CustodyBalanceObservationResult` with only the
approved provider reference, original binding, deterministic identity,
validated available and total unit strings, and locally generated normalized
observation timestamp. It emits no raw response, wallet object, credential,
header, endpoint URL, account address, token inventory, or provider error text.
Identity selection must use `CONTENT` unless a later contract authorizes a
non-address native/checkpoint identity that passes
`normalizeObservationIdentityValue`.

## Security, Transport, And Credential Ownership

P6-T05 owns operation semantics only: input validation, descriptor construction,
response-shape validation, wallet/coin equality, string-unit transformation,
custody-result mapping, static capabilities, and derived health state.

P6-T04 exclusively owns endpoint registry, DNS and private-address policy,
connection planning, TLS, redirects, deadlines, retries, bounded JSON reading,
credential lifecycle resolution, Authorization construction, redaction, and
security audit metadata. P6-T05 must call `executeApprovedProviderRequest`; it
must not call HTTPS, DNS, TLS, `readBoundedProviderJson`, credential resolution,
or Authorization construction directly. It must not read
`process.env.BITGO_TEST_ACCESS_TOKEN`.

The P6-T05 offline seam is an injected function conforming to the
`executeApprovedProviderRequest` outcome shape, returning deterministic
`ProviderSecurityResult` fixtures. Fixtures may contain clearly fake values
only. Provider DNS, TLS, BitGo API, production provider, and Solana RPC traffic
must each remain zero during P6-T05 implementation and qualification.

`P6_T05_TRANSPORT_REUSE_REQUIRED`

`P6_T05_CREDENTIAL_BOUNDARY_REUSE_REQUIRED`

`P6_T05_EXTERNAL_NETWORK_PROHIBITED`

## Error, Health, And Capability Contract

P6-T05 must not add a public custody error enum. It maps outcomes only to the
existing `CustodyBalanceObservationErrorCode` values as follows:

| Source condition | Custody code | Retryable |
| --- | --- | --- |
| `PROVIDER_TIMEOUT` or `PROVIDER_ABORTED` | `TIMEOUT` | transport value |
| `PROVIDER_RATE_LIMITED` | `RATE_LIMITED` | transport value |
| other `TransportFailure` | `PROVIDER_UNAVAILABLE` | transport value |
| `CredentialFailure` | `UNEXPECTED_RESULT` | false |
| missing required result | `MISSING_RESULT` | false |
| response identity/coin mismatch or invalid shape | `UNEXPECTED_RESULT` | false |
| non-`tsol` response coin | `UNSUPPORTED_ASSET` | false |
| invalid base-unit string | `MALFORMED_AMOUNT` | false |

The `retryAfterMs` value is retained only when the mapped source outcome is
retryable and has a non-negative safe retry value; otherwise it is `null`.
P6-T05 must neither implement an independent retry loop nor reinterpret P6-T04
attempt counts or audit metadata.

Health is derived only from the last P6-T05 approved balance-read outcome in
the adapter instance: no read yet or semantic/credential failure is `UNKNOWN`;
success is `AVAILABLE`; rate limit is `DEGRADED`; timeout or provider-unavailable
transport failure is `UNAVAILABLE`. Health does not perform a probe, does not
claim global provider availability, and has no cache beyond the instance-local
last outcome required for this derivation.

The provider metadata has exactly one capability: `BALANCE_OBSERVATION`.
`TRANSFER_OBSERVATION`, `TRANSFER_LOOKUP`, `PAYOUT_SUBMISSION`, and
`WEBHOOK_INGESTION` are not advertised. No new write or signing capability is
authorized.

## Semantic Invariants

- `S01`: scope is BITGO/TEST/tsol only.
- `S02`: the operation is GET only.
- `S03`: the path is the frozen wallet-get path only.
- `S04`: wallet ID matches `^[0-9a-f]{32}$` before descriptor construction.
- `S05`: a wallet ID is not a receive address or an arbitrary binding key.
- `S06`: the query is exactly `includeBalance=true`.
- `S07`: `includeBalances` is prohibited.
- `S08`: `expandBalance` is prohibited.
- `S09`: no-query and multi-query variants are prohibited.
- `S10`: response must be a JSON object supplied by P6-T04.
- `S11`: response `id` exactly equals requested wallet ID.
- `S12`: response `coin` exactly equals `tsol`.
- `S13`: `balanceString` is required and maps to total units.
- `S14`: `spendableBalanceString` is required and maps to available units.
- `S15`: `confirmedBalanceString` is optional and never a fallback.
- `S16`: every accepted amount passes `normalizeAtomicUnits`.
- `S17`: amounts remain strings in Lamports with no numeric coercion.
- `S18`: raw provider fields do not cross the semantic output boundary.
- `S19`: unknown fields do not change semantic output.
- `S20`: P6-T05 uses only the approved descriptor and transport call.
- `S21`: P6-T05 performs no direct DNS, TLS, HTTP, credential, or auth work.
- `S22`: P6-T04 retains retry, deadline, bounded-reader, and redaction ownership.
- `S23`: transport failures map only through existing custody error codes.
- `S24`: semantic and credential failures fail closed.
- `S25`: retry-after is retained only for a retryable mapped failure.
- `S26`: health is derived from the last approved read and never probes.
- `S27`: health is not a claim of global provider availability.
- `S28`: capabilities are exactly `BALANCE_OBSERVATION`.
- `S29`: no write, signing, transfer, payout, withdrawal, or webhook capability exists.
- `S30`: offline qualification performs zero provider DNS, TLS, API, RPC, credential, or production calls.

## Proposed Future Implementation Scope

The next, separately authorized P6-T05 implementation step may create only:

- `src/server/custody/bitgo-read-only-semantic-adapter.ts`: focused server-only
  semantic reader, descriptor construction, parsing, custody mapping, and
  derived health.
- `src/server/custody/bitgo-read-only-semantic-adapter.test.ts`: deterministic
  unit coverage through injected `ProviderSecurityResult` fixtures.
- `scripts/test-p6-t05-bitgo-read-only-semantic-adapter-runtime.mjs`: offline
  qualification harness with a fake transport outcome seam and no network.

It must not modify P6-T04 modules, package files, database schema, generated
types, existing custody contracts, or existing adapter factories. It must not
wire a production runtime, scheduler, worker, route, UI, or global adapter
factory. Any file-scope expansion requires a new governance decision.

## Offline Qualification Matrix

The later implementation must prove at least the following 64 deterministic
cases without external network, a credential read, a real provider value, or a
database mutation:

1. descriptor uses the frozen operation ID.
2. descriptor method is GET.
3. descriptor path uses `tsol`.
4. descriptor path contains the validated wallet ID only.
5. descriptor query is exactly `includeBalance=true`.
6. descriptor body is prohibited.
7. descriptor is retry-safe.
8. descriptor response mode is JSON.
9. valid lowercase 32-hex wallet ID is accepted.
10. uppercase wallet ID is rejected.
11. short wallet ID is rejected.
12. long wallet ID is rejected.
13. whitespace-padded wallet ID is rejected.
14. receive-address-shaped input is rejected.
15. slash or query injection is rejected.
16. arbitrary coin input is rejected.
17. arbitrary environment input is rejected.
18. arbitrary query input is rejected.
19. response must be an object.
20. missing `id` maps to `MISSING_RESULT`.
21. missing `coin` maps to `MISSING_RESULT`.
22. missing `balanceString` maps to `MISSING_RESULT`.
23. missing `spendableBalanceString` maps to `MISSING_RESULT`.
24. response ID mismatch maps to `UNEXPECTED_RESULT`.
25. response coin mismatch maps to `UNSUPPORTED_ASSET`.
26. response coin `sol` is not accepted for TEST scope.
27. valid `balanceString` maps to total units.
28. valid `spendableBalanceString` maps to available units.
29. zero amount is accepted.
30. maximum 38-digit accepted amount is accepted.
31. leading-zero nonzero amount is rejected.
32. negative amount is rejected.
33. decimal amount is rejected.
34. exponent amount is rejected.
35. whitespace amount is rejected.
36. non-string amount is rejected.
37. malformed optional confirmed amount is rejected.
38. absent optional confirmed amount does not fail a valid observation.
39. confirmed amount is not substituted for total amount.
40. no `Number` conversion is used by parsing path.
41. no `parseInt` conversion is used by parsing path.
42. no `parseFloat` conversion is used by parsing path.
43. no `BigInt` conversion is used by parsing path.
44. unknown response fields are not serialized.
45. raw wallet response is not returned.
46. success health becomes AVAILABLE.
47. no-read health is UNKNOWN.
48. rate-limit health becomes DEGRADED.
49. timeout health becomes UNAVAILABLE.
50. provider-unavailable health becomes UNAVAILABLE.
51. semantic failure health is UNKNOWN.
52. credential failure health is UNKNOWN.
53. timeout maps to `TIMEOUT`.
54. rate limit maps to `RATE_LIMITED`.
55. other transport failure maps to `PROVIDER_UNAVAILABLE`.
56. credential failure maps to `UNEXPECTED_RESULT` without a secret.
57. retryable transport state is preserved.
58. safe retry-after is preserved only for retryable mapped failure.
59. capability list is exactly `BALANCE_OBSERVATION`.
60. no transfer capability is advertised.
61. no payout or webhook capability is advertised.
62. injected fake success invokes no DNS, TLS, HTTP, BitGo, or Solana RPC.
63. injected fake failure invokes no credential resolver or Authorization path.
64. diagnostics, errors, and results expose no fake token or raw provider data.

Static qualification must additionally prove server-only import boundaries,
absence of direct environment token reads, absence of direct HTTP/DNS/TLS calls,
absence of provider writes/signing, exact descriptor construction, and the
frozen proposed file scope. No dependency, database, migration, generated type,
audit, or real-call qualification work is authorized by this contract.

## Research Basis And Deferred Authority

This contract incorporates P6-T01 through P6-T04 and the approved Step 2/2A
research resolution. The selected BitGo balance policy is grounded in the
official OpenAPI operation `v2.wallet.get`, corroborated by the endpoint
reference and current BitGoJS serialization behavior. `includeBalance=true` is
the frozen primary-source query policy; `expandBalance` belongs to wallet-list
semantics and is not authorized here.

Actual credential scope verification, authenticated BitGo TEST calls, provider
response compatibility against a live service, and any production authorization
remain separate future governance gates. This contract does not authorize them.

## Exit Criteria And Mutation Guard

Step 3 is complete only when this single contract exists, contains all frozen
rules and the 64-case offline matrix, passes `git diff --check`, has no secret
or real configuration value, and is the sole worktree change. The contract
SHA-256 must be recorded by the Step 3 result before later work begins.

Allowed mutation for Step 3: one governance contract created. All source,
test, script, dependency, lockfile, schema, generated-type, environment,
credential, provider, and runtime mutations are zero.

`P6_T05_CONTRACT_DEFINED`

`P6_T05_IMPLEMENTATION_NOT_STARTED`

`P6_T05_OFFLINE_QUALIFICATION_NOT_STARTED`

`P6_T05_REAL_CALL_QUALIFICATION_NOT_STARTED`
