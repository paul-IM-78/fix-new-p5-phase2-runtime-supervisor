# P6-T13 - Authorized Execution Context Composition Contract

## 1. Status and Purpose

Task: `P6-T13`

Title: `Authorized Execution Context Composition`

Canonical planning base: `c671c77cab4a4dc80099c22469c8742dbe7775e6`

Selected architecture: `WRAPPER_COMPOSITION`

MVP objective: `OPERABLE_MVP = 100%`

Current canonical MVP progress: `74%`

P6-T13 owns the server-only composition boundary that may establish authorization for the existing BitGo TEST read-only provider path. It exists because the current low-level provider-security path carries execution authority as a boolean and that authority must not remain an ordinary operational caller choice. P6-T13 does not activate the real BitGo provider.

---

## 2. Existing Canonical Authority Primitive

The canonical provider-security transport is `executeApprovedProviderRequest`. The current authority input is `authorizedExecutionContext: boolean`, and the same authority value is forwarded to `ProviderCredentialResolver.resolve(...)`. The canonical resolver denies secret resolution when execution authority is absent.

The low-level boolean remains an internal security primitive. P6-T13 must not expose that boolean through its new supported operational API.

## 3. Existing Canonical Credential Reference Boundary

P6-T12 provides the canonical server-only credential-reference loader `loadActiveProviderCredentialReference` and the canonical credential-reference model `CredentialReference`. P6-T13 must reuse the P6-T12 loader and must not create another credential-reference registry, DB model, secret store, or credential resolver.

## 4. Existing Secret Resolver Boundary

The canonical credential resolver remains `ProviderCredentialResolver`; the canonical TEST secret source remains `BITGO_TEST_ACCESS_TOKEN`.

`credentialReference != credentialSecret`

P6-T13 must not move, copy, persist, duplicate, or expose a credential secret. The existing resolver remains owner of conversion from an authorized credential reference to a transient provider credential.

## 5. Selected Design

Selected model: `WRAPPER_COMPOSITION`

A dedicated server-only wrapper becomes the supported composition point for authorized BitGo TEST read-only execution. It may internally establish the existing low-level authorization value only after all P6-T13 authorization prerequisites pass. The ordinary caller does not receive an authority switch.

Required invariant: `ordinaryCaller != executionAuthorityOwner`

## 6. Why a Wrapper Is Sufficient

A branded capability refactor is not required because the canonical architecture can centralize the supported authorized runtime path without modifying provider-security types, the provider-security credential resolver, provider-security transport, P6-T11, or P6-T12.

P6-T13 does not claim that the low-level boolean ceases to exist internally. It establishes the only P6-T13-supported authorized operational composition path. A broader provider-security API hardening may be considered separately if future architecture makes direct low-level access materially unsafe.

## 7. Authority Ownership Boundary

The new P6-T13 supported operational API must not accept `authorizedExecutionContext`. The ordinary caller must not choose true, false, an equivalent authorization flag, or an equivalent execution-authority enum. The wrapper owns authorization establishment internally. Caller-supplied authority injection must fail structurally because the supported wrapper API contains no such input.

## 8. Provider Boundary

P6-T13 authorized composition is fixed to `BITGO`. The caller must not select an arbitrary provider. Provider override is `PROHIBITED`. Any non-BitGo provider request must fail closed or be structurally impossible through the P6-T13 API.

## 9. Environment Boundary

P6-T13 authorized composition is fixed to `TEST`. The caller must not select `PRODUCTION`.

Required: caller environment override `0`; TEST-to-PRODUCTION fallback `0`; PRODUCTION-to-TEST fallback `0`; default-to-PRODUCTION behavior `0`. Production remains explicitly unauthorized.

## 10. Read-Only Capability Boundary

P6-T13 authorizes only the existing read-only balance-observation provider path. Authorized semantic operation category: `BALANCE_OBSERVATION`. Authorized HTTP semantic method: `GET`. Mutation capability: `NONE`.

The wrapper must not create authority for POST, PUT, PATCH, DELETE, wallet mutation, transfer, withdrawal, payout, signing, policy mutation, or fund movement.

## 11. Approved Descriptor Boundary

P6-T13 must reuse an existing canonical read-only descriptor-producing seam. The ordinary caller must not submit an arbitrary `ApprovedProviderRequestDescriptor` or control HTTP method, relative provider endpoint, `bodyAllowed`, retry-safety semantics, or response mode.

The existing BitGo read-only semantic adapter may continue to construct the approved balance descriptor internally. Exact wrapper composition with that adapter is deferred to the post-contract implementation-scope review.

## 12. Request Body Boundary

P6-T13 authorized balance observation must use `body = NONE`. The supported wrapper API must not expose arbitrary provider request-body input. Any mutation/body-capable execution remains unauthorized.

## 13. Credential Reference Ownership

The ordinary P6-T13 caller must not supply an arbitrary `CredentialReference`. The P6-T13 wrapper must obtain the current canonical TEST reference through the P6-T12 credential-reference loader.

Expected flow: `P6-T13 wrapper -> loadActiveProviderCredentialReference(BITGO, TEST)`.

Reference missing, ambiguous, invalid, or invalid-environment conditions must fail closed. No reference fallback is permitted.

## 14. Credential Lifecycle Boundary

A credential reference used for authorized composition must be acceptable to the canonical credential resolver. The canonical lifecycle model remains `ACTIVE`, `ROTATING`, `REVOKED`, and `DISABLED`. P6-T13 must not weaken lifecycle enforcement. REVOKED and DISABLED references must not obtain provider credentials. No P6-T13 lifecycle override is permitted.

## 15. Internal Authorization Decision

Only after all composition gates pass may P6-T13 internally establish `authorizedExecutionContext = true`. It is permitted only inside the trusted server-only wrapper implementation and must never become a caller option. Its existence does not authorize real provider activation during P6-T13 qualification.

## 16. Required Authorization Prerequisites

Before internal authority may be established, composition must guarantee:

1. provider is BitGo;
2. environment is TEST;
3. operation is the approved read-only balance operation;
4. request method is GET;
5. request body is prohibited;
6. current credential reference comes from canonical P6-T12 loading;
7. caller did not supply execution authority;
8. caller did not supply arbitrary provider descriptor;
9. caller did not choose production; and
10. correlation identity is present.

Failure of any prerequisite must fail closed.

## 17. Correlation Boundary

Authorized execution must retain an explicit `correlationId`. The wrapper may accept or obtain correlation identity according to canonical runtime conventions. Missing or invalid correlation identity must not silently degrade to an unaudited authorized provider request. Exact generation ownership is deferred to implementation-scope review.

## 18. Provider-Security Audit Reuse

P6-T13 must reuse existing provider-security audit output. A second provider-execution audit system is not required for the MVP unless later implementation evidence proves it necessary. Audit must not contain raw credential-secret material and should preserve provider, environment, operation, credential reference identifier, credential version, policy outcome, and correlation ID.

## 19. Semantic Adapter Reuse

The canonical BitGo read-only semantic adapter already owns the approved balance semantic request and TEST environment behavior. P6-T13 should compose it rather than recreate wallet-balance endpoints, provider request descriptors, normalization logic, response parsing, or provider error mapping. Exact implementation API is deferred.

## 20. Existing Low-Level Primitive Preservation

Preferred P6-T13 predecessor diffs are `0` for `provider-security-types.ts`, `provider-security-credential-resolver.ts`, `provider-security-transport.ts`, existing P6-T11 implementation, and existing P6-T12 implementation. Modification of these boundaries requires separate re-review before implementation authorization.

## 21. Existing Semantic Adapter Preservation

P6-T13 should not modify the existing semantic adapter merely to remove its internal authority field if a wrapper can safely own the supported authorized composition. Preferred existing semantic-adapter diff: `0`. Preferred existing balance-observer-adapter diff: `0`.

## 22. Supported Caller Inputs

The future wrapper may accept only non-authority inputs necessary for existing balance-observation semantics: canonical provider metadata if required, balance read input, wallet identifier through the existing custody seam, correlation identity, abort signal, and narrowly injected test/runtime dependencies.

The caller must not provide authority boolean, arbitrary credential reference, arbitrary environment, arbitrary provider, arbitrary request descriptor, arbitrary HTTP method, arbitrary request body, or raw credential secret. Exact function signature is deferred.

## 23. Wallet-ID Responsibility

P6-T13 does not own wallet-ID registry provisioning or wallet-ID resolution. P6-T11 remains the wallet-ID registry owner. Existing custody/BitGo runtime composition remains responsible for wallet-ID resolution at its canonical seam. P6-T13 must not merge wallet-ID and credential-authorization responsibilities.

## 24. Provider Activation Separation

P6-T13 provider calls during contract preparation: `0`. P6-T13 provider calls during future implementation qualification: `0`. Qualification must not contact BitGo, Solana RPC, any external provider, or any remote credential service. Actual BitGo TEST activation remains a separate successor task.

## 25. Real Credential Separation

P6-T13 contract preparation does not authorize `BITGO_TEST_ACCESS_TOKEN` reads. Future P6-T13 implementation qualification must use `SYNTHETIC_FAKE_SECRET_SOURCE_ONLY`. Real BitGo token count: `0`. Real credential-secret reads: `0`.

## 26. Offline Qualification Architecture

Future qualification must exercise the authorized composition path using injected synthetic boundaries: synthetic credential reference or P6-T12 loader, synthetic `RuntimeSecretSource`, fake provider credential resolver runtime, fake DNS resolver, fake request factory, fake provider JSON response, and deterministic clock/correlation values. Actual network activity: `0`.

## 27. Resolver Compatibility Proof

Future qualification must prove the wrapper internally propagates execution authority only after its gates and the canonical resolver can resolve a valid synthetic TEST credential through that path. It must prove synthetic fake secret source use, real environment source unused, valid TEST reference success, missing fake secret failure, REVOKED failure, DISABLED failure, and no secret-byte emission.

## 28. Authority Non-Escape Proof

Future qualification must prove the supported P6-T13 API exposes none of `authorizedExecutionContext`, equivalent boolean authority, arbitrary environment, arbitrary provider, arbitrary credential reference, arbitrary request descriptor, arbitrary write method, or arbitrary provider body. Authority non-escape is a critical exit criterion.

## 29. Failure Policy

P6-T13 must fail closed for credential reference unavailable, ambiguous, malformed, lifecycle denied, provider mismatch, environment mismatch, non-approved operation, non-read-only operation, request body attempt, arbitrary descriptor attempt, production request, missing correlation identity, credential-resolution denial, and missing synthetic secret.

Required: authorization fallback `0`; environment fallback `0`; credential fallback `0`; descriptor fallback `0`.

## 30. Secret Privacy Boundary

Credential secrets remain `SECRET / HIGH_SENSITIVITY`. They must not appear in caller-visible return values, browser responses, public APIs, logs, metrics, audit payloads, errors, repository files, or generated qualification reports. P6-T13 must not persist resolved credentials.

## 31. Browser / Public API Boundary

P6-T13 wrapper is `SERVER_ONLY`. Direct browser execution-authority composition and public API authority injection are prohibited. A later operator execution route may call a trusted server-side seam, but that is outside this task.

## 32. Operator Execution Separation

P6-T13 does not create final operator/on-demand execution UX or command. It only establishes a safe server-side authorized composition capability. The separate later blocker remains `Minimal operator/on-demand execution wiring`.

## 33. Controlled TEST Activation Separation

P6-T13 does not prove real BitGo credentials work, network reachability, a real token read, or a real wallet/balance request. Those belong to `Controlled BitGo TEST Activation`.

## 34. Future Implementation Categories

If wrapper design remains sufficient after this contract becomes canonical, expected categories are one server-only authorized-composition wrapper, one focused unit/qualification test, one offline runtime qualification harness, and one focused package script if conventions require it.

Expected DB changes: `0`. Expected dependencies: `0`. Expected package-lock changes: `0`. Exact implementation paths are deferred until post-contract implementation-scope review.

## 35. No Predecessor Modification Assumption

Current expected predecessor modifications: `0`.

If implementation discovery proves P6-T13 requires modification of provider-security transport, provider-security resolver, provider-security core types, credential-reference registry, or wallet-ID registry, implementation authorization must pause for re-review. Do not silently expand scope.

## 36. Qualification Requirements

Future qualification must prove at minimum server-only wrapper boundary; caller authority boolean, production, provider, credential-reference, descriptor, write-method, and body paths absent; canonical P6-T12 TEST reference seam reused; missing/ambiguous/invalid reference fails closed; revoked/disabled denied; approved balance path accepted; authority only internal; canonical resolver authorized only after gates; synthetic valid credential and missing-secret failure; audit/correlation preserved; no secret emission; fake transport only; network, BitGo, production, signing/write/fund movement `0`; P6-T12, provider-security, and semantic-adapter regressions preserved; and full authority guard. Exact qualification IDs and count are deferred.

## 37. Explicitly Out of Scope

P6-T13 does not authorize actual credential-reference provisioning, real credential-secret reads, `BITGO_TEST_ACCESS_TOKEN` reads, actual BitGo API calls, credential validity network checks, real wallet or balance reads, Solana RPC, provider writes, wallet mutations, transfers, withdrawals, payouts, signing, fund movement, production credentials, production execution, scheduler activation, or final operator execution wiring.

## 38. Authority Boundary

Current authority during contract publication: actual credential-reference creation `NONE`; credential-secret read `NONE`; provider execution `NONE`; network activity `NONE`; production `NONE`; signing `NONE`; fund movement `NONE`.

Contract publication alone does not authorize P6-T13 implementation.

## 39. Invalidation Conditions

Future implementation authorization must be withheld if wrapper-only composition cannot prevent caller-controlled authority on the supported operational path; arbitrary descriptors must be caller supplied; production support, provider mutation, real credential reads, actual BitGo calls, P6-T12 bypass, a new secret store, material predecessor API modification, DB/schema changes, or expanded wrapper responsibility becomes necessary.

In those cases: `P6_T13_REPLANNING_REQUIRED`.

## 40. MVP Progress

Current canonical MVP estimate: `74%`.

P6-T13 contract publication receives `0%` implementation progress credit. Expected post-P6-T13 implementation percentage must be recalculated only after exact implementation scope and qualification catalog become canonical.

## 41. Final Contract Principle

P6-T13 establishes:

`AUTHORIZED_EXECUTION_IS_COMPOSED_SERVER_SIDE_NOT_CALLER_SELECTED`

The supported MVP provider path may obtain TEST read-only credential resolution authority only through a trusted server-side composition boundary. The ordinary caller must never turn provider execution authority on by supplying a boolean. Real provider activation remains separately gated.
