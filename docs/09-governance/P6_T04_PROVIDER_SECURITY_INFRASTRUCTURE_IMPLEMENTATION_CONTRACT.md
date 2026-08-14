# P6-T04 Provider Security Infrastructure Implementation Contract

## Task Identity

- Task ID: `P6-T04`
- Task name: Provider Security Infrastructure Implementation
- Classification: `PHASE6_PRE_REAL_CALL_SECURITY_INFRASTRUCTURE_IMPLEMENTATION_GATE`
- Task type: `IMPLEMENTATION_TASK_WITH_FROZEN_CONTRACT`
- Status: `DEFINED_NOT_STARTED`
- Provider context: `BITGO`
- Environment context: `BITGO_TEST`

`P6_T04_TASK_DEFINED`

`P6_T04_PROVIDER_SECURITY_INFRASTRUCTURE_IMPLEMENTATION`

`P6_T04_PRE_REAL_CALL_SECURITY_INFRASTRUCTURE_IMPLEMENTATION_GATE`

`P6_T04_IMPLEMENTATION_TASK_WITH_FROZEN_CONTRACT`

`P6_T04_IMPLEMENTATION_NOT_STARTED`

## Canonical Base And Predecessor Authority

- Canonical base: `f019eeefff492f92120351eaf3db66e9d9d81f19`
- P6-T02 is canonically published, PASS, and COMPLETE.
- P6-T03 is canonically published, PASS, and COMPLETE.

P6-T02 freezes a provider-and-environment-scoped credential reference model.
P6-T03 freezes the Node HTTPS, connection-bound DNS, and SSRF boundary. This
task implements those security boundaries offline; it does not alter their
authority or authorize a provider call.

`P6_T04_REAL_CREDENTIAL_PROHIBITED`

`P6_T04_REAL_CALLS_REMAIN_PROHIBITED`

`P6_T04_PRODUCTION_ACCESS_PROHIBITED`

## Purpose And Completion Authority

Implement and deterministically offline-qualify the integrated credential/auth
and egress/transport security infrastructure. Completion means implementation
and offline qualification are complete, but real provider calls remain
prohibited.

`P6_T04_COMPLETION_AUTHORITY = IMPLEMENTATION_COMPLETE_BUT_REAL_CALLS_PROHIBITED`

`P6_T04_AUTHORIZES_NEXT_PROVIDER_SEMANTIC_AND_SECURITY_QUALIFICATION_GOVERNANCE_ONLY`

Completion may authorize later governance for a BitGo semantic adapter, wallet
mapping, balance normalization, health/capability semantics, and TEST
qualification planning. It must not authorize real credentials, BitGo calls,
provider writes, signing, financial execution, production access, or P6-T05.

## Allowed Implementation Scope

P6-T04 may implement the following server-only security infrastructure:

- credential reference/lifecycle types and `ProviderCredentialResolver`;
- TEST runtime-injection resolver plumbing using fake test values only;
- late internal Authorization construction and redaction/sanitization;
- endpoint registry, approved operation descriptors, egress policy, IP policy,
  ConnectionPlan, and controlled lookup;
- direct Node HTTPS transport shell, deadline, retry, Retry-After, bounded
  response reader, JSON boundary, error unions, and non-secret audit metadata;
- deterministic unit and integration tests with mocked lookup/dispatch.

No database migration, generated type change, package change, or new runtime
dependency is authorized for the initial implementation.

`P6_T04_NO_DB_SCHEMA_CHANGE_REQUIRED`

`P6_T04_NO_NEW_RUNTIME_DEPENDENCY_REQUIRED`

## Explicit Out-Of-Scope

P6-T04 must not implement real BitGo API paths, balance operation descriptors,
response parsing, wallet-ID mapping, health semantics, capability metadata, or
real `CustodyObservationAdapter` result mapping. Tests use fake operation
descriptors and deterministic fixtures only.

`P6_T04_PROVIDER_SEMANTIC_LAYER_EXCLUDED`

P6-T04 must not create or read actual credentials, use dotenv credential
storage, contact external DNS or TLS endpoints, call BitGo or Solana RPC, write
to a provider, sign, or execute financial actions.

`P6_T04_EXTERNAL_NETWORK_PROHIBITED`

`P6_T04_DNS_PROBES_PROHIBITED`

`P6_T04_TLS_PROBES_PROHIBITED`

`P6_T04_BITGO_CALLS_PROHIBITED`

`P6_T04_SOLANA_RPC_PROHIBITED`

`P6_T04_PROVIDER_WRITE_PROHIBITED`

`P6_T04_SIGNING_PROHIBITED`

`P6_T04_FINANCIAL_EXECUTION_PROHIBITED`

## Server-Only Runtime Boundary

Provider security infrastructure is `NODE_RUNTIME_ONLY` and server-only. Every
transport-reachable module must use the repository `import "server-only"`
convention where applicable. Client imports and Edge runtime provider transport
are prohibited.

`P6_T04_NODE_RUNTIME_ONLY`

`P6_T04_SERVER_ONLY_REQUIRED`

## TEST Runtime Secret Slot And Credential Resolver

The only P6-T04 TEST runtime slot name is `BITGO_TEST_ACCESS_TOKEN`. This
freezes a name, not a value. Tests may inject clearly fake process-local values;
no actual token, committed dotenv value, production slot, or generic
service-role retrieval is authorized.

`P6_T04_BITGO_TEST_RUNTIME_SECRET_SLOT_FROZEN`

The resolver is conceptually equivalent to:

```text
resolveProviderCredential({ provider, environment, credentialReference,
  authorizedExecutionContext })
```

It is server-only, returns operation-local plaintext only, and uses no durable
plaintext cache. It must fail closed for missing/unavailable references,
environment mismatch, revoked state, disabled state, invalid scope, or denied
resolution authority. The minimum lifecycle states are `ACTIVE`, `ROTATING`,
`REVOKED`, and `DISABLED`; revoked and disabled credentials never fall back.

`P6_T04_PROVIDER_CREDENTIAL_RESOLVER_REQUIRED`

## Destination-Before-Secret And Authorization Boundary

The required execution sequence is: endpoint registry, approved descriptor,
URL/host validation, ConnectionPlan, DNS/IP validation, validated connection
target, credential resolver, internal Authorization construction, direct
dispatch, bounded reader, and parser boundary.

`P6_T04_DESTINATION_BEFORE_SECRET_REQUIRED`

`P6_T04_DESTINATION_BEFORE_SECRET_IMPLEMENTATION_REQUIRED`

Credential resolution before a validated ConnectionPlan is structurally
prohibited. Authorization is constructed only inside the server-only transport
after validation; caller Authorization, Host, and Proxy-Authorization overrides
are prohibited. Authorization is never returned, persisted, or logged.

`P6_T04_AUTHORIZATION_INTERNAL_ONLY`

## Redaction And Error Boundary

Sanitization must redact Authorization headers, Bearer values, credential
values, credential-bearing URLs, provider authentication failures, resolver
failures, request diagnostics, transport diagnostics, and bounded provider error
excerpts. Tests must prove that a fake token does not escape errors, audit data,
or diagnostics.

`P6_T04_REDACTION_IMPLEMENTATION_REQUIRED`

Implement internal credential categories including `CREDENTIAL_REFERENCE_MISSING`,
`CREDENTIAL_UNAVAILABLE`, `CREDENTIAL_REVOKED`,
`CREDENTIAL_ENVIRONMENT_MISMATCH`, `CREDENTIAL_SCOPE_INVALID`,
`SECRET_RESOLUTION_DENIED`, and `AUTHENTICATION_FAILED`. Implement internal
transport categories including destination, scheme, private address, redirect,
timeout, rate-limit, unavailable, TLS, response-size, and malformed-response
failures. Public enum expansion is not authorized.

`P6_T04_INTERNAL_CREDENTIAL_ERROR_UNION_REQUIRED`

`P6_T04_INTERNAL_TRANSPORT_ERROR_UNION_REQUIRED`

## Endpoint Registry And Request Descriptor Model

Implement a `SERVER_ONLY_FIXED_PROVIDER_ENVIRONMENT_REGISTRY` with initial
security entries for `BITGO_TEST` at `app.bitgo-test.com` (active) and
`BITGO_PRODUCTION` at `app.bitgo.com` (inactive). Host selection must never come
from browser input, request input, database bindings, wallet metadata, or a
caller URL.

`P6_T04_FIXED_ENDPOINT_REGISTRY_REQUIRED`

Implement an approved operation-to-request descriptor binding operation ID,
method, path template, query policy, body permission, response boundary, and
retry-safety metadata. P6-T04 permits fake descriptors only. Arbitrary caller
host, method, path, or headers are prohibited.

`P6_T04_APPROVED_OPERATION_DESCRIPTOR_REQUIRED`

## URL, IP, And ConnectionPlan Boundary

URL validation must use standards-compliant parsing: HTTPS only, exact hostname
equality, no userinfo, unexpected port, fragment, raw-IP URL, suffix host, Host
override, or caller absolute URL. IP policy uses Node-native `node:net` and
`net.BlockList` or an equivalent Node-native policy, including IPv4-mapped IPv6
normalization. Private, loopback, link-local, unique-local, unspecified,
multicast, reserved, metadata, and internal destinations are denied.

`P6_T04_EXACT_HOST_HTTPS_POLICY_REQUIRED`

`P6_T04_IP_BLOCK_POLICY_REQUIRED`

Implement `ConnectionPlan` and connection-bound validated lookup. Every resolved
candidate must pass policy; one prohibited candidate fails closed. The actual
request must use the validated plan with no second unrestricted lookup and must
retain the approved hostname for TLS SNI rather than rewriting the URL to an IP.

`P6_T04_CONNECTION_PLAN_REQUIRED`

`P6_T04_CONNECTION_BOUND_LOOKUP_REQUIRED`

`P6_T04_ALL_DNS_CANDIDATES_MUST_PASS`

`P6_T04_SECOND_UNRESTRICTED_DNS_PROHIBITED`

## Direct HTTPS Transport, TLS, Redirect, And Proxy Boundary

The transport shell uses `node:https.request` with a direct per-request
connection path such as `agent: false`. It allows HTTPS only, preserves default
certificate verification and approved SNI, accepts no custom CA or TLS bypass,
does not follow redirects, and does not inherit an uncontrolled proxy path.

`P6_T04_REDIRECTS_PROHIBITED`

`P6_T04_TLS_SNI_REQUIRED`

`P6_T04_DIRECT_EGRESS_REQUIRED`

## Abort, Exact Numeric, Retry, And Response Policy

The caller AbortSignal and total deadline apply to the whole operation. These
values are frozen before implementation; existing observer retry constants are
precedent only and do not control provider transport defaults.

```text
P6_T04_TOTAL_TRANSPORT_DEADLINE_MS=10000
P6_T04_MAX_TOTAL_ATTEMPTS=3
P6_T04_RETRY_BACKOFF_BASE_MS=250
P6_T04_RETRY_BACKOFF_MAX_MS=2000
P6_T04_RETRY_JITTER_RATIO=0.20
P6_T04_MAX_RETRY_AFTER_MS=5000
P6_T04_MAX_RESPONSE_BYTES=1048576
P6_T04_MAX_ERROR_EXCERPT_BYTES=8192
```

TLS minimum version remains the platform/runtime secure default; P6-T04 does
not invent a fixed value. Retry is limited to approved transient failures,
bounded 429, selected 5xx, connection reset, and approved timeout categories.
Destination, SSRF, scheme, TLS certificate, auth, invalid request, malformed
response, and response-size failures are non-retryable. Total deadline wins.
Retry-After accepts delta-seconds and HTTP-date, ignores invalid values, never
becomes negative, is capped, and is bounded by remaining deadline.

`P6_T04_TOTAL_DEADLINE_FROZEN`

`P6_T04_RETRY_BUDGET_FROZEN`

`P6_T04_RETRY_AFTER_BOUND_FROZEN`

Response handling must precheck Content-Length, count streamed bytes, cancel on
cap exceedance, bound diagnostic excerpts, decode UTF-8 only after the byte
boundary, then parse JSON and discard raw payload. `response.text()` or
`response.json()` before the cap is prohibited.

`P6_T04_RESPONSE_CAP_FROZEN`

`P6_T04_ERROR_EXCERPT_CAP_FROZEN`

`P6_T04_BOUNDED_JSON_PARSE_REQUIRED`

## Audit, Storage, And Dependency Boundary

Reuse existing run evidence where possible. Allowed metadata is provider,
environment, operation, endpoint ID, hostname, policy outcome, normalized
outcome, duration, attempt count, safe HTTP status, byte count, correlation/run
ID, and non-secret credential reference/version metadata. Tokens, Authorization,
raw bodies, full provider errors, and resolver internals are prohibited.

`P6_T04_NON_SECRET_AUDIT_REQUIRED`

Initial P6-T04 uses server-only interfaces and in-memory/test metadata. Raw
secrets never enter the database; no credential persistence or production secret
backend is authorized. Node built-ins and existing dependencies are sufficient.

## Offline Qualification And Guards

All tests are deterministic and offline: unit tests, mocked resolver/lookup,
transport-dispatch seams, fake credentials, and controlled local test fixtures.
The qualification matrix must cover public and prohibited IP candidates,
IPv4-mapped IPv6, multi-candidate fail-closed, no second lookup, validated plan
reuse, destination-before-secret, Authorization isolation/redaction, response
caps, malformed JSON, abort/deadline, retry budget, and 429 Retry-After.

`P6_T04_OFFLINE_TESTS_ONLY`

External-network, actual-credential, DNS-probe, TLS-probe, BitGo-call, Solana
RPC, provider-write, signing, and financial-execution guards are mandatory.

## Quality Gates And Security Invariants

Required later gates are focused unit and deterministic integration tests,
TypeScript, lint, build, secret scan, scope review, network guard, credential
guard, and DNS-probe guard. The following invariants must remain true:

1. no caller-controlled host;
2. no unvalidated connection target;
3. no DNS rebinding escape;
4. no redirect follow;
5. no HTTP;
6. no TLS bypass;
7. no uncontrolled proxy;
8. no secret before destination validation;
9. no Authorization override;
10. no unbounded response;
11. no endless retry;
12. no raw provider payload persistence;
13. no provider write;
14. no signing;
15. no financial execution; and
16. no real provider call before a later gate.

## Exit Criteria And Completion Semantics

P6-T04 has these 42 frozen exit criteria:

1. P6-T02 credential architecture is implemented.
2. P6-T03 egress architecture is implemented.
3. Node/server-only boundaries are enforced.
4. ProviderCredentialResolver is implemented.
5. TEST fake/runtime injection is implemented without a real credential.
6. Provider/environment mismatch fails closed.
7. Revoked and disabled credentials fail closed.
8. Destination validation precedes credential resolution.
9. Authorization is internal and late.
10. Caller Authorization, Host, and Proxy-Authorization are rejected.
11. Credential, log, error, and audit redaction is implemented.
12. Fixed endpoint registry is implemented.
13. Approved request descriptors are implemented.
14. Exact-host HTTPS URL policy is implemented.
15. IP classification/block policy is implemented.
16. IPv4-mapped IPv6 is handled safely.
17. ConnectionPlan is implemented.
18. Connection-bound lookup is implemented.
19. All DNS candidates pass or fail closed.
20. No second unrestricted DNS resolution occurs.
21. Redirects are not followed.
22. TLS certificate verification and SNI are preserved.
23. Direct/no-uncontrolled-proxy egress is preserved.
24. Caller AbortSignal is propagated.
25. Total transport deadline is implemented.
26. Exact retry/backoff/jitter budgets are implemented.
27. Retry-After is bounded by policy and remaining deadline.
28. Streamed response cap is implemented.
29. Error excerpts are bounded.
30. Bytes are bounded before JSON parsing.
31. Internal credential error union is implemented.
32. Internal transport error union is implemented.
33. Non-secret audit metadata integration is implemented.
34. No DB/schema migration is introduced.
35. No runtime dependency is introduced.
36. Deterministic DNS/SSRF/TOCTOU qualification passes.
37. Deterministic credential-order/redaction qualification passes.
38. Deterministic response/retry/429 qualification passes.
39. TypeScript, lint, build, and focused tests pass.
40. Actual credentials, external DNS/TLS, BitGo, and Solana calls remain zero.
41. Provider writes, signing, and financial execution remain zero.
42. Real-call authorization remains separately required.

`P6_T04_EXIT_CRITERIA_FROZEN`

Later PASS/COMPLETE means security infrastructure is implemented and offline
qualified. It does not mean a semantic adapter, actual credential, external
provider qualification, TEST call authorization, or production access exists.

## Expected Reports

- This contract: `docs/09-governance/P6_T04_PROVIDER_SECURITY_INFRASTRUCTURE_IMPLEMENTATION_CONTRACT.md`
- Future implementation report: `docs/09-governance/P6_T04_PROVIDER_SECURITY_INFRASTRUCTURE_IMPLEMENTATION_REPORT.md`
- Future qualification report: `docs/09-governance/P6_T04_PROVIDER_SECURITY_INFRASTRUCTURE_QUALIFICATION_REPORT.md`

Only this contract is created by the definition step.

## Required Status Markers

`P6_T04_EXIT_CRITERIA_FROZEN`

P6-T04 must not claim pass, completion, publication readiness, a successor task,
or real-provider authorization until later authorized work proves those states.
