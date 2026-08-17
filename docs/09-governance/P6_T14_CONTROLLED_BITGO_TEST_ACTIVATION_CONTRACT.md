# P6-T14: Controlled BitGo TEST Activation Contract

## 1. Status and Purpose

Task:

`P6-T14`

Title:

`Controlled BitGo TEST Activation`

Canonical planning base:

`55acaa1f6347ee8645c64f2147aedc3ab5f50c13`

MVP objective:

`OPERABLE_MVP = 100%`

Current canonical MVP progress:

`82%`

Selected activation model:

`ONE_LOGICAL_TEST_BALANCE_READ`

Route compatibility:

`ACTIVATION_ROUTE_VERIFIED`

P6-T14 owns the controlled transition from the fully qualified offline BitGo TEST read-only path to one explicitly authorized real BitGo TEST balance read.

P6-T14 is a qualification and activation task.

It does not establish recurring provider execution.

---

## 2. Existing Canonical Chain

P6-T14 must reuse the canonical chain established by preceding tasks.

The required semantic chain is:

`P6-T11 TEST wallet registry`
-> `P6-T11 wallet-ID resolution`
-> `P6-T12 TEST credential-reference registry`
-> `P6-T13 authorized execution composition`
-> `ProviderCredentialResolver`
-> `BITGO_TEST_ACCESS_TOKEN`
-> `provider-security transport`
-> `BitGo TEST read-only wallet request`

P6-T14 must not bypass any of these security seams.

---

## 3. P6-T11 Wallet-ID Boundary

P6-T11 remains the owner of actual provider wallet identifiers.

The canonical wallet registry is private and TEST-scoped.

Actual TEST wallet IDs must be provisioned only through the controlled P6-T11 local provisioning seam.

P6-T14 must not:

- create a second wallet-ID store;
- accept a raw wallet ID as ordinary provider-call input;
- place a wallet ID in a tracked repository file;
- print a wallet ID in qualification reports;
- pass a wallet ID through ordinary CLI argv where the canonical provisioning seam uses safer input.

---

## 4. P6-T12 Credential-Reference Boundary

P6-T12 remains the owner of provider credential-reference metadata.

P6-T14 requires one valid active TEST credential reference for:

- provider: `BITGO`;
- environment: `TEST`.

The credential reference is not the provider credential secret.

Required invariant:

`credentialReference != credentialSecret`

P6-T14 must not create another credential-reference store.

---

## 5. P6-T13 Authority Boundary

P6-T13 remains the owner of supported server-side execution-authority composition.

P6-T14 must reuse:

`createBitGoAuthorizedReadOnlyRuntimeComposition`

P6-T14 must not expose or recreate:

`authorizedExecutionContext`

as an operator-controlled switch.

The caller of the future activation harness must not supply provider execution authority directly.

---

## 6. Canonical Credential Resolver

Actual BitGo TEST secret resolution must occur only through the canonical:

`ProviderCredentialResolver`

P6-T14 must not:

- read the token directly in activation code;
- construct an Authorization header directly;
- introduce a second credential resolver;
- introduce a second secret backend.

---

## 7. Real TEST Secret Source

The canonical actual TEST secret source is:

`BITGO_TEST_ACCESS_TOKEN`

The secret is:

`SECRET / HIGH_SENSITIVITY`

It must be supplied out of band through the server/operator process environment.

It must never be persisted by P6-T14.

---

## 8. Secret Storage Prohibition

P6-T14 must not store the BitGo TEST token in:

- PostgreSQL;
- Supabase;
- wallet registry;
- credential-reference registry;
- repository files;
- scripts;
- fixtures;
- generated reports;
- logs;
- audit payloads;
- metrics;
- browser storage.

Secret persistence:

`0`

---

## 9. Secret Input Prohibition

The actual token must not be supplied through:

- ordinary CLI argument;
- URL;
- request query;
- public API body;
- browser form;
- tracked config file.

P6-T14 must not require an operator to copy the token into a command invocation.

---

## 10. Secret Inspection Prohibition

Outside an explicitly authorized live activation, P6-T14 must not inspect:

- token value;
- token presence;
- token length;
- token hash;
- token prefix;
- token suffix;
- token format.

There is no separate token preflight request.

The canonical resolver remains responsible for fail-closed credential resolution during the live activation attempt.

---

## 11. Official TEST Environment Boundary

The current verified BitGo TEST API base is:

`https://app.bitgo-test.com`

Canonical provider-security TEST endpoint:

`app.bitgo-test.com:443`

Required:

- HTTPS;
- TEST environment only;
- canonical endpoint registry only;
- production endpoint inactive for this flow.

P6-T14 must not accept a caller-supplied provider hostname.

---

## 12. Production Boundary

Production is explicitly outside P6-T14.

Required:

`production = 0`

P6-T14 must not contact:

`app.bitgo.com`

No TEST-to-PRODUCTION fallback is permitted.

No environment fallback is permitted.

---

## 13. Verified Wallet Read Route

The canonical read-only semantic operation is:

`BITGO_TSOL_WALLET_GET_BALANCE`

Current canonical semantic request:

- provider: `BITGO`;
- environment: `TEST`;
- coin: `tsol`;
- method: `GET`;
- relative route: `/api/v2/tsol/wallet/{walletId}`;
- query: `includeBalance=true`;
- body allowed: `false`.

Current official BitGo wallet documentation supports the coin-specific wallet-read route:

`GET /api/v2/{coin}/wallet/{walletID}`

P6-T14 route compatibility classification is:

`ACTIVATION_ROUTE_VERIFIED`

---

## 14. Route Revalidation Rule

Because provider APIs may change, the exact live activation implementation must revalidate the official BitGo TEST route before the first real provider request.

This is a documentation/OpenAPI compatibility check only.

It must not require an authenticated BitGo request.

If the route has materially changed:

`LIVE_ACTIVATION_AUTHORITY_WITHHELD`

P6-T14 must not discover route compatibility by sending experimental authenticated requests.

---

## 15. Response Compatibility Boundary

The existing canonical semantic adapter expects wallet response semantics including:

- wallet `id`;
- `coin`;
- `balanceString`;
- `spendableBalanceString`;
- optional `confirmedBalanceString`.

P6-T14 must reuse the canonical semantic parser.

P6-T14 must not add a second provider-response parser solely for live activation.

---

## 16. Read-Only Boundary

P6-T14 permits only:

`READ_ONLY_BALANCE_OBSERVATION`

HTTP method:

`GET`

Request body:

`NONE`

Write authority:

`NONE`

---

## 17. Explicitly Prohibited Provider Operations

P6-T14 must never perform:

- POST;
- PUT;
- PATCH;
- DELETE;
- wallet generation;
- wallet mutation;
- address creation;
- transfer;
- send;
- withdrawal;
- payout;
- policy mutation;
- signing;
- staking transaction;
- fund movement.

---

## 18. Controlled Activation Unit

One P6-T14 live activation means:

`ONE_LOGICAL_TEST_BALANCE_READ`

Required:

- selected logical bindings: `1`;
- logical balance observation operations: `1`;
- recurring loop: `0`;
- polling: `0`;
- scheduler: `0`;
- batch-all-wallets behavior: `0`.

---

## 19. Exactly One Binding

A live activation must target exactly one intended TEST binding.

If the selection resolves to:

- zero eligible bindings -> fail closed;
- more than one eligible binding -> fail closed unless the invocation has an explicit deterministic non-secret binding-selection input defined by later implementation scope.

P6-T14 must not silently read all wallet bindings.

---

## 20. Wallet-ID Privacy

The actual TEST wallet ID is operationally sensitive provider metadata.

It may exist only in the canonical private P6-T11 registry and transient server-side runtime memory.

It must not appear in:

- logs;
- metrics;
- reports;
- normal console output;
- public errors;
- browser responses;
- PR descriptions.

---

## 21. Credential-Reference Privacy

Credential references are non-secret but operationally sensitive.

The raw actual credential-reference identifier should not be printed in P6-T14 activation reports unless a later governance requirement explicitly proves that disclosure is necessary.

Default:

`raw credential reference output = 0`

---

## 22. Two-Authority Model

P6-T14 requires two distinct, non-reusable governance authorities.

They are:

1. `PRE_ACTIVATION_PREPARATION_AUTH`
2. `LIVE_TEST_ACTIVATION_AUTH`

They must not be collapsed into one reusable authority.

---

## 23. PRE_ACTIVATION_PREPARATION_AUTH

A future `PRE_ACTIVATION_PREPARATION_AUTH` may authorize only the prerequisites required to make a single controlled activation possible.

It may authorize, if still required:

- one actual TEST wallet-ID registry provisioning operation through P6-T11;
- one actual non-secret TEST credential-reference provisioning operation through P6-T12;
- local registry-state verification;
- route/documentation compatibility verification.

It must not authorize:

- reading `BITGO_TEST_ACCESS_TOKEN`;
- resolving the actual credential secret;
- provider network activity;
- BitGo API calls;
- production activity.

---

## 24. Preparation Authority Local DB Boundary

Any actual wallet-ID or credential-reference preparation must use the canonical local registry DB boundary only.

Expected local DB endpoint:

`127.0.0.1:55722`

Remote DB preparation:

`PROHIBITED`

Preparation must reuse the existing P6-T11 and P6-T12 controlled provisioning tools.

---

## 25. Preparation Authority Input Boundary

Actual wallet-ID preparation must retain the canonical safer-input behavior.

Actual credential-reference preparation remains non-secret metadata only.

The preparation authority must never accept the actual provider token.

---

## 26. LIVE_TEST_ACTIVATION_AUTH

A separate future `LIVE_TEST_ACTIVATION_AUTH` may authorize exactly one logical BitGo TEST balance-read activation attempt.

It may authorize:

- canonical TEST credential resolution;
- canonical provider-security TEST network activity;
- canonical transport retry behavior;
- one logical balance observation.

It must not authorize:

- a second logical activation;
- recurring execution;
- production;
- provider writes;
- operator automation.

---

## 27. Live Authority Consumption

A `LIVE_TEST_ACTIVATION_AUTH` is:

`ONE_TIME / NON_REUSABLE`

It is consumed after one activation attempt regardless of whether the attempt:

- succeeds;
- fails authentication;
- times out;
- fails DNS/TLS;
- returns malformed provider data;
- fails semantic validation.

A failed attempt requires a new explicit authority before another live activation.

---

## 28. Explicit Live Execution Gate

The future live activation harness must default to:

`NO_LIVE_PROVIDER_CALL`

A live request requires both explicit non-secret gates:

`--execute`

and:

`P6_T14_ALLOW_LIVE_BITGO_TEST=YES`

Both must be present.

Missing either must fail closed before actual credential resolution or network activity.

---

## 29. Live Gate Is Not Credential Material

The activation gate:

`P6_T14_ALLOW_LIVE_BITGO_TEST=YES`

is a safety opt-in only.

It is not:

- credential material;
- provider authentication;
- persistent provider authority;
- production permission.

---

## 30. Browser and Public API Boundary

P6-T14 live activation must not be triggerable from:

- browser;
- public API;
- ordinary admin web endpoint;
- unauthenticated HTTP route.

The initial controlled activation is an explicit operator/server-side qualification operation.

---

## 31. Canonical Transport Boundary

All live provider traffic must flow through:

`executeApprovedProviderRequest`

P6-T14 must not create direct network code using:

- raw `fetch`;
- direct `https.request`;
- arbitrary HTTP library;
- curl provider request.

The existing provider-security transport remains the only allowed provider egress boundary.

---

## 32. TLS / DNS / Egress Boundary

The actual live activation must retain the existing provider-security:

- endpoint allowlist;
- DNS resolution policy;
- TLS certificate validation;
- redirect blocking;
- response-size limits;
- timeout policy;
- retry policy.

P6-T14 must not weaken them for convenience.

---

## 33. Retry Boundary

P6-T14 logical activation attempts:

`1`

P6-T14 outer retry loops:

`0`

Underlying HTTP attempts may occur only according to the existing canonical provider-security retry policy.

Current planning maximum underlying transport attempts:

`3`

No P6-T14-specific additional retry layer may be added.

---

## 34. Canonical Activation Flow

The future controlled activation semantic flow is:

`load active P6-T11 TEST wallet registry snapshot`
-> `select exactly one intended BITGO/TSOL binding`
-> `create canonical BitGo wallet-ID resolver`
-> `createBitGoAuthorizedReadOnlyRuntimeComposition`
-> `load canonical P6-T12 BITGO/TEST credential reference`
-> `canonical ProviderCredentialResolver reads BITGO_TEST_ACCESS_TOKEN`
-> `canonical provider-security transport`
-> `canonical BitGo TEST GET balance operation`
-> `canonical semantic validation`
-> `safe activation result`
-> `exit`

---

## 35. No Recorded/Scheduled Orchestration

P6-T14 must not use the activation as a recurring operational worker.

Initial live activation must not use:

- scheduler;
- polling loop;
- recurring cron;
- background daemon;
- full run-ledger orchestration merely to prove provider connectivity.

Persistent operator execution belongs to a later task.

---

## 36. P6-T15 Separation

The remaining post-P6-T14 MVP blocker is expected to be:

`Minimal operator/on-demand execution wiring`

P6-T15 will own the durable usable operator invocation surface.

A P6-T14 activation harness is qualification infrastructure, not final operator UX.

---

## 37. Activation Output

A future P6-T14 activation result should expose only the minimum evidence needed to prove the live read path.

Preferred safe result fields include:

- activation attempted;
- TEST environment;
- logical operation count;
- safe success/failure class;
- provider-security normalized outcome;
- semantic validation result;
- no writes;
- no secret emission.

---

## 38. Output Prohibitions

The activation report must not include:

- access token;
- Authorization header;
- raw wallet ID;
- raw credential-reference ID by default;
- raw provider response JSON;
- wallet label;
- secret metadata;
- secret length/hash/prefix/suffix.

---

## 39. Balance Privacy

P6-T14 does not require dumping the wallet's actual balance values into qualification output.

Preferred proof:

`balance response structurally parsed and validated`

rather than printing account balances.

If later qualification requires numeric assertions, they should remain transient and non-reported unless explicitly authorized.

---

## 40. Authentication Failure Policy

If the real provider request fails authentication:

- stop activation;
- do not print token details;
- do not automatically rotate credentials;
- do not try an alternate credential;
- do not retry outside canonical transport policy;
- do not switch environments.

P6-T14 does not own credential rotation.

---

## 41. Missing Secret Failure

If `BITGO_TEST_ACCESS_TOKEN` is absent or rejected by the canonical resolver:

- fail closed;
- provider call count must remain zero when credential resolution fails before transport;
- do not inspect or report secret metadata;
- do not fall back to another credential source.

---

## 42. Wallet Registry Failure

If the actual TEST wallet registry is:

- unavailable;
- malformed;
- empty for the intended binding;
- ambiguous;
- invalid;

the live activation must fail before credential resolution/provider activity where architecture permits.

No alternate wallet selection is permitted.

---

## 43. Credential Reference Failure

If the actual TEST credential reference is:

- missing;
- ambiguous;
- malformed;
- revoked;
- disabled;
- environment-invalid;

the activation must fail closed.

No fallback reference is permitted.

---

## 44. Provider Failure Policy

Provider failures must remain normalized through the canonical provider-security boundary.

Relevant categories may include:

- authentication denial;
- DNS/egress denial;
- TLS failure;
- timeout;
- rate limit;
- provider unavailable;
- oversized/malformed response;
- semantic mismatch.

P6-T14 must not expose raw provider error payloads merely for qualification.

---

## 45. Response Identity Validation

The canonical semantic adapter must verify the returned wallet identity corresponds to the requested wallet identity.

Wallet-ID mismatch:

`FAIL_CLOSED`

Coin mismatch:

`FAIL_CLOSED`

Malformed balance representation:

`FAIL_CLOSED`

---

## 46. No Solana RPC

P6-T14 activation is a BitGo API read.

Direct Solana RPC activity:

`0`

P6-T14 must not query Solana RPC as a secondary confirmation mechanism.

---

## 47. Offline Safety Qualification Layer

Before any actual values or live provider authority are used, future P6-T14 implementation must pass:

`LAYER_1_OFFLINE_SAFETY_QUALIFICATION`

This layer must use:

- synthetic identifiers;
- fake secrets;
- fake transport;
- network tripwires;
- no real DB mutation;
- no BitGo request.

---

## 48. Real Preparation Verification Layer

After a separate preparation authority, P6-T14 may perform:

`LAYER_2_REAL_PREREQUISITE_PREPARATION_VERIFICATION`

This layer may verify:

- actual TEST wallet binding is configured locally;
- actual TEST credential reference is configured locally;
- exactly one intended binding can be selected.

This layer must still have:

- credential-secret reads: `0`;
- provider calls: `0`.

---

## 49. Live Activation Layer

Only a separate `LIVE_TEST_ACTIVATION_AUTH` may enable:

`LAYER_3_ONE_TIME_LIVE_TEST_ACTIVATION`

This layer permits:

- one canonical actual TEST secret resolution;
- one logical TEST balance operation;
- canonical transport retries only.

It does not authorize any further live call.

---

## 50. Layer Ordering

Required ordering:

`Layer 1 PASS`
-> `Layer 2 PASS`
-> explicit `LIVE_TEST_ACTIVATION_AUTH`
-> `Layer 3`

Skipping a layer:

`PROHIBITED`

---

## 51. Actual Values During Contract Publication

During P6-T14 contract publication:

- actual wallet IDs provisioned: `0`;
- actual credential references provisioned: `0`;
- actual secret reads: `0`;
- provider calls: `0`;
- DB mutations: `0`.

The contract itself grants none of those authorities.

---

## 52. Future Implementation Scope

Expected P6-T14 implementation categories may include:

1. controlled activation/preflight implementation;
2. focused offline safety qualification test;
3. one controlled live activation harness;
4. one focused package script if required.

Exact implementation paths are deferred until this contract becomes canonical and a separate implementation-scope review is completed.

---

## 53. Expected Predecessor Preservation

Preferred predecessor modifications:

`0`

for:

- P6-T11 wallet-ID registry;
- P6-T12 credential-reference registry;
- P6-T13 authorized composition;
- ProviderCredentialResolver;
- provider-security transport;
- provider-security endpoint registry;
- BitGo read-only semantic adapter.

If current official BitGo API compatibility changes require predecessor modification, implementation authorization must stop for re-review.

---

## 54. Expected Database Scope

Expected P6-T14 database migrations:

`0`

P6-T14 must reuse the P6-T11 and P6-T12 registries.

No new activation database is required merely to prove one live read.

---

## 55. Expected Dependencies

Expected new dependencies:

`0`

Expected package-lock changes:

`0`

A dependency addition requires scope re-review.

---

## 56. Future Offline Qualification Requirements

Future Layer 1 qualification must prove at minimum:

- server-only activation boundary;
- live default OFF;
- both live gates required;
- no credential resolution when gate absent;
- no provider call when gate absent;
- one-binding requirement;
- no production support;
- GET-only semantics;
- no request body;
- no write-capable operation;
- canonical P6-T11 seam reused;
- canonical P6-T12 seam reused;
- canonical P6-T13 seam reused;
- canonical resolver reused;
- canonical transport reused;
- no direct network bypass;
- safe output redaction;
- no raw wallet ID output;
- no raw credential-reference output;
- no token emission;
- no Authorization emission;
- no balance dump;
- outer retries `0`;
- network calls `0`;
- BitGo calls `0`;
- production `0`;
- signing/fund movement `0`;
- predecessor regression;
- full authority guard.

Exact qualification IDs/count are deferred until post-contract implementation-scope review.

---

## 57. Future Layer 2 Exit Criteria

Real preparation verification must prove before live authority may be requested:

1. canonical local DB target;
2. exactly one intended actual TEST wallet binding;
3. valid private wallet-ID registry state;
4. valid active BITGO/TEST credential reference;
5. no credential secret read;
6. no provider call;
7. no sensitive identifier printed.

---

## 58. Future Layer 3 Success Criteria

The single live activation succeeds only if:

1. explicit live gates are present;
2. one intended TEST binding resolves;
3. canonical credential reference resolves;
4. canonical actual TEST credential resolves;
5. canonical TEST provider connection succeeds;
6. one read-only balance operation succeeds;
7. provider response passes canonical semantic validation;
8. no sensitive value leaks;
9. provider writes remain zero;
10. production remains zero.

---

## 59. Live Authority Does Not Survive Success

Successful Layer 3 activation produces:

`REAL_TEST_READ_ONLY_PATH_WORKS`

It does not produce reusable provider authority.

After the activation attempt:

`provider authority = NONE`

A later P6-T15 task must receive its own explicit authority model.

---

## 60. Explicitly Out of Scope

P6-T14 does not authorize:

- production credentials;
- production provider calls;
- provider writes;
- wallet generation;
- address creation;
- transaction signing;
- staking transaction submission;
- withdrawals;
- payouts;
- transfers;
- fund movement;
- recurring polling;
- scheduler activation;
- background daemon;
- public/admin web trigger;
- permanent provider authority;
- credential rotation automation;
- final operator workflow.

---

## 61. Authority Boundary

Contract-publication authority:

`GOVERNANCE_ONLY`

Current live credential authority:

`NONE`

Current provider authority:

`NONE`

Current production authority:

`NONE`

Contract publication does not grant:

- preparation authority;
- actual identifier authority;
- actual credential-reference authority;
- credential-secret authority;
- live network authority.

---

## 62. Invalidation Conditions

Future P6-T14 implementation/live activation authorization must stop for re-review if:

- BitGo's verified route changes materially;
- a provider-security bypass is required;
- production access becomes required;
- write methods become necessary;
- more than one logical balance read becomes necessary;
- a new secret store becomes necessary;
- DB schema changes become necessary;
- a predecessor security API must be materially modified;
- raw secret or wallet-ID output becomes necessary;
- a direct network client is required;
- current TEST/PRODUCTION isolation cannot be maintained.

In such a case:

`P6_T14_REPLANNING_REQUIRED`

---

## 63. MVP Progress

Current canonical MVP estimate:

`82%`

P6-T14 contract publication receives:

`0%`

operational implementation credit.

Expected after successful controlled real TEST activation:

approximately `90-92%`

This estimate is planning guidance only.

---

## 64. Remaining MVP Work

After successful P6-T14 live activation, the expected final major blocker is:

`Minimal operator/on-demand execution wiring`

That successor task must not be silently bundled into P6-T14.

---

## 65. Final Contract Principle

P6-T14 establishes:

`REAL_PROVIDER_ACCESS_REQUIRES_EXPLICIT_ONE_TIME_TEST_ONLY_AUTHORITY`

The operable MVP may prove its real BitGo TEST read-only path using exactly one controlled logical balance activation without converting provider access into a standing capability.

Preparation authority, live activation authority, and later operator execution authority remain separate.
