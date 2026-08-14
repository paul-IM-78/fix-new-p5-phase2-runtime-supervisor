# P6-T03 BitGo Egress and SSRF Boundary Architecture Decision Report

## Task Identity

- Task ID: `P6-T03`
- Task name: BitGo Egress and SSRF Boundary
- Classification: `PHASE6_PRE_REAL_CALL_EGRESS_SECURITY_GATE`
- Task type: `GOVERNANCE_AND_ARCHITECTURE_TASK`
- Canonical base: `49eb880184ee4b837d68865d3c1d69e18f2e4d8c`
- Decision status: architecture frozen; implementation not started.

`P6_T03_ARCHITECTURE_DECISIONS_FROZEN`

## Contract Authority

The immutable entry authority is
`P6_T03_BITGO_EGRESS_SSRF_BOUNDARY_CONTRACT.md`, SHA-256
`83ABD8E933CAED103DDF24804C52B0D7785A6564484E655B9C7D41224600D9E4`.
Its task identity, 26 exit criteria, and authority consequence are preserved.

P6-T03 completion authorizes only later implementation governance:

`P6_T03_AUTHORIZES_NEXT_IMPLEMENTATION_GOVERNANCE_ONLY`

It does not authorize implementation, credentials, real provider calls, or
production access.

## Decision Summary

The selected architecture is a server-only Node HTTPS transport that binds
resolved-address policy to the request connection. The caller cannot choose an
origin, host, method, path, or sensitive header. The destination is validated
before any credential is resolved, response bytes are bounded before parsing,
and redirects and uncontrolled proxy routing are prohibited.

## Runtime Decision

Provider transport is Node-runtime only. Edge runtime is prohibited because the
gate requires controlled DNS lookup and direct HTTPS connection behavior.

`P6_T03_NODE_RUNTIME_ONLY`

`P6_T03_SERVER_ONLY_PROVIDER_TRANSPORT`

Future endpoint-registry, egress-policy, connection-plan, credential-resolver,
transport, and provider-adapter modules that can reach transport must begin with
`import "server-only"`.

## Transport Decision

The selected substrate is direct Node `https.request`.

`P6_T03_NODE_HTTPS_REQUEST_DIRECT_TRANSPORT`

The future implementation uses `agent: false`, or an equivalent direct
per-request architecture that prevents uncontrolled global or proxy-agent
inheritance. It propagates a request `AbortSignal`, uses a controlled `lookup`,
keeps default certificate verification, and uses the approved hostname as TLS
SNI identity. No direct runtime dependency is needed.

## Rejected Precheck-Then-Fetch Model

Global fetch plus a separate DNS precheck is rejected.

`P6_T03_GLOBAL_FETCH_PRE_DNS_PATTERN_REJECTED`

An ordinary fetch may independently resolve the hostname during connection,
leaving the precheck disconnected from the actual connection target. This is
classified as `PRECHECK_THEN_FETCH_TOCTOU_UNSAFE`.

`P6_T03_NO_SECOND_UNRESTRICTED_DNS_RESOLUTION`

## Endpoint Registry

The endpoint registry is server-only, fixed, and keyed by provider and
environment.

`P6_T03_SERVER_ONLY_FIXED_ENDPOINT_REGISTRY`

- `BITGO_TEST`: `https://app.bitgo-test.com`
- `BITGO_PRODUCTION`: `https://app.bitgo.com`, inactive and unauthorized

The registry does not accept caller, browser, database, binding, request-body,
or environment-fallback URLs.

## Request Descriptor Model

Requests use an approved operation-to-request descriptor.

`P6_T03_APPROVED_OPERATION_REQUEST_DESCRIPTOR`

A future descriptor binds the provider, environment, operation identifier,
method, fixed path template, validated query schema, body permission, response
parser, and retry-safety classification. It does not permit arbitrary URLs,
methods, paths, or headers.

## URL and Host Policy

URL construction uses a fixed origin selected by the endpoint registry and a
standards-compliant parser. HTTPS, exact normalized hostname equality, no
userinfo, no fragments, no unexpected port, and no suffix matching are
required. The initial TEST hostname is exactly `app.bitgo-test.com`.

`P6_T03_EXACT_HOST_POLICY_FROZEN`

## Connection-Bound DNS Architecture

The selected DNS architecture is `CONNECTION_BOUND_VALIDATED_LOOKUP`.

`P6_T03_CONNECTION_BOUND_VALIDATED_LOOKUP`

The connection plan resolves candidate addresses, normalizes them, validates
every candidate against egress policy, and exposes only approved address data to
the actual request-time lookup path. A prohibited candidate causes fail-closed
rejection; it is not discarded in favor of another answer.

`P6_T03_ALL_RESOLUTION_CANDIDATES_POLICY_VALIDATED`

`P6_T03_DNS_REBINDING_TOCTOU_CLOSED`

The actual HTTPS request remains bound to the validated connection plan after
credential resolution, preventing DNS rebinding through a later unrestricted
lookup.

## IP Address Policy

IP classification uses Node `node:net` `isIP`, `net.BlockList`, and explicit
IPv4-mapped IPv6 normalization. It avoids ad-hoc string-prefix tests.

`P6_T03_NODE_NET_BLOCKLIST_IP_POLICY`

The deny policy includes IPv4 loopback, RFC1918/private IPv4, IPv4 link-local,
IPv6 loopback, unique-local, link-local, unspecified, multicast, reserved or
non-public destinations appropriate to global egress, and IPv4-mapped IPv6
equivalents. General non-public rejection blocks internal and metadata targets;
known metadata targets receive explicit defense-in-depth treatment.

## DNS Rebinding / TOCTOU Protection

The validated connection plan is the only resolution authority available to the
actual request. A future implementation must not validate a host, resolve a
credential, then revert to ordinary uncontrolled fetch or lookup.

`P6_T03_NO_DNS_REBINDING_ESCAPE`

## TLS / SNI

HTTPS is mandatory. The approved registry hostname is retained as the TLS
servername and certificate identity. Raw-IP URL rewriting, certificate bypass,
`rejectUnauthorized: false` equivalents, and custom CAs are not authorized.
The minimum TLS version remains deliberately unfrozen.

`P6_T03_HTTPS_TLS_SNI_BOUNDARY_FROZEN`

## Redirect Policy

Direct Node HTTPS requests do not automatically follow redirects. Any 3xx is
not followed, causes no second request, and cannot forward Authorization. It
normalizes internally as `EGRESS_REDIRECT_BLOCKED` unless later endpoint-specific
governance changes that rule.

`P6_T03_REDIRECTS_DISABLED`

## Proxy Policy

Provider transport uses direct egress by default. It must not silently inherit
`HTTP_PROXY`, `HTTPS_PROXY`, global proxy agents, or framework/global-agent
proxy configuration. Proxy use is not authorized by P6-T03 and requires separate
governance.

`P6_T03_DIRECT_EGRESS_BY_DEFAULT`

`P6_T03_PROXY_REQUIRES_SEPARATE_GOVERNANCE`

## Credential / Egress Ordering

The future logical flow is:

`ProviderOperation -> ProviderEndpointRegistry -> approved request descriptor -> canonical URL and host validation -> ConnectionPlan -> DNS/IP validation -> ProviderCredentialResolver -> internal Authorization construction -> direct HTTPS request -> BoundedResponseReader -> provider parser -> normalized adapter result`

The credential is resolved only after a valid connection plan exists. The same
plan is then used for the actual request.

`P6_T03_CONNECTION_PLAN_BEFORE_CREDENTIAL_RESOLUTION`

`P6_T03_AUTHORIZATION_AFTER_DESTINATION_VALIDATION`

## Abort / Deadline

The future transport propagates the caller signal and owns a total deadline that
covers connection planning, request/connect, response streaming, retry delay,
and every logical retry attempt as runtime behavior permits. Exact milliseconds
remain unfrozen.

`P6_T03_CALLER_SIGNAL_PLUS_TOTAL_DEADLINE`

## Retry / Retry-After

Retry is bounded by total deadline and uses bounded backoff and jitter. Existing
custody retry helpers may be reused where their semantics remain compatible.
Retryable candidates are selected transient failures, connection reset, 408,
selected 5xx, policy-approved timeout, and bounded 429. Egress, TLS,
authentication, malformed-response, and oversize failures are non-retryable.

`P6_T03_RETRY_BOUNDED_BY_TOTAL_DEADLINE`

`P6_T03_RETRY_AFTER_BOUNDED_SAFE_PARSE`

Later parsing supports delta-seconds and HTTP-date. Invalid, past, negative, or
excessive values cannot create an unbounded or negative wait; the total deadline
always wins.

## Response Size Enforcement

The future response boundary is streamed byte counting before parsing. It first
checks `Content-Length` when present, then counts bytes while consuming the body,
aborts or destroys the response when the future cap is exceeded, and keeps only
a bounded diagnostic excerpt. It never calls `response.text()` or
`response.json()` before byte enforcement and never persists raw provider data.

`P6_T03_STREAMED_BYTE_CAP_BEFORE_PARSE`

## JSON Parse Boundary

Only bounded bytes are decoded as UTF-8 and parsed as JSON. Malformed JSON maps
to `PROVIDER_MALFORMED_RESPONSE`; raw provider payload is transient and discarded
after normalization.

`P6_T03_BOUNDED_BYTES_BEFORE_JSON_PARSE`

## Method / Path Boundary

Methods and paths come only from an approved operation descriptor. Arbitrary
method/path selection and mutation semantics are prohibited. GET-only is not
globally frozen because method alone does not prove read-only behavior.

`P6_T03_APPROVED_OPERATION_METHOD_PATH_ONLY`

## Header Boundary

Headers are transport-controlled. Authorization is internal and late-bound;
Host override, caller Authorization, Proxy-Authorization, browser header
forwarding, and sensitive-header logging are prohibited. Allowed non-secret
categories are endpoint-required `Accept`/`Content-Type` and bounded correlation
or user-agent metadata.

`P6_T03_TRANSPORT_CONTROLLED_HEADER_ALLOWLIST`

## Component Boundaries

The frozen conceptual components are:

- `ProviderEndpointRegistry`: provider-generic registry and operation selection.
- `ProviderEgressPolicy`: provider-generic URL, host, IP, redirect, TLS, and proxy policy.
- `ConnectionPlan`: provider-generic validated host/address binding for request connection.
- `BitGoTransport`: BitGo-specific integration over generic security components.
- `ProviderCredentialResolver`: inherited server-only late resolver boundary.
- `BoundedResponseReader`: provider-generic actual-byte cap before parsing.
- `TransportRetryPolicy`: provider-generic classification, backoff, jitter, Retry-After, and deadline budget.

`P6_T03_COMPONENT_BOUNDARIES_FROZEN`

## Error Integration

An internal discriminated transport union preserves destination, scheme, private
address, redirect, timeout, rate-limit, unavailable, TLS, response-size, and
malformed-response distinctions. It maps to existing public custody/run result
semantics where appropriate without changing production enums in P6-T03. Error
data contains no secret values.

`P6_T03_INTERNAL_TRANSPORT_ERROR_UNION`

## Audit / Run Evidence Integration

The architecture is compatible with existing run evidence. Permitted metadata is
provider, environment, operation, endpoint identifier, hostname, policy outcome,
normalized category, safe HTTP status, duration, attempt count, byte counts, and
correlation/run ID. Authorization, token, credential value, raw body, full error
body, secret-resolver internals, and unnecessary raw DNS detail are prohibited.

`P6_T03_NON_SECRET_EGRESS_AUDIT_INTEGRATION`

## Dependency Decision

No new runtime dependency is required. Node HTTPS with controlled lookup and
Node `net` facilities are sufficient; direct Undici and an IP library are not
selected. A later proposal to change this requires governance review.

`P6_T03_NO_NEW_RUNTIME_DEPENDENCY_REQUIRED`

## Server-Only Boundary

Provider transport and every transport-reachable provider module is server-only
and Node-runtime only. Client-bundle reachability and Edge provider transport are
prohibited.

## Numeric Policy

The bounded structural policy is frozen while exact timeout, retry count,
backoff, response-byte cap, TLS minimum version, and BitGo endpoint paths remain
unfrozen until implementation and qualification evidence exists.

`P6_T03_BOUNDED_STRUCTURE_EXACT_NUMBERS_DEFERRED`

## Endpoint Evidence

The official BitGo evidence remains sufficient for the architecture decision:
TEST host `app.bitgo-test.com`, production host `app.bitgo.com`, and production
unauthorized. Exact API paths remain a later governed detail.

`P6_T03_BITGO_ENDPOINT_IDENTITY_EVIDENCE_SUFFICIENT`

## Security Invariants

The frozen architecture enforces no caller-controlled host, unvalidated
connection target, DNS rebinding escape, redirect follow, HTTP, TLS bypass,
uncontrolled proxy, secret before destination validation, Authorization override,
unbounded response, endless retry, raw payload persistence, provider write,
signing, financial execution, or real provider call before a later gate.

## Exit Criteria Evaluation

All 26 contract criteria are architecturally satisfied. All 26 still require
follow-on implementation and qualification. There are no runtime, dependency, or
research blockers to architecture closeout.

`P6_T03_ARCHITECTURE_EXIT_CRITERIA_SATISFIED`

`P6_T03_IMPLEMENTATION_NOT_STARTED`

## Implementation Governance

The only follow-on authority is later implementation governance for an integrated
security-infrastructure boundary covering credential resolver/auth, endpoint
registry, egress policy, connection plan, provider transport, and response,
retry, and error integration. No future task identifier is defined here.

## Real-Call Separation

Actual BitGo TEST reads still require implementation, security qualification,
TEST qualification, and explicit real-call authorization. Production remains
unauthorized. P6-T03 creates no credentials and performs no provider call.

`P6_T03_REAL_PROVIDER_CALLS_REMAIN_PROHIBITED`

`P6_T03_PRODUCTION_ACCESS_REMAINS_PROHIBITED`

## Decision Status

This report freezes architecture only. Implementation, credentials, provider
calls, production access, and any next Phase 6 task remain outside the current
authority.

## Final Closeout Status

P6-T03 is `PASS` and `COMPLETE` as a governance and architecture task. The
BitGo Egress and SSRF Boundary gate is closed: the Node-only direct HTTPS
transport, connection-bound DNS and TOCTOU boundary, fixed endpoint registry,
request-descriptor model, TLS/SNI, redirect, proxy, credential-ordering,
retry, and bounded-response decisions are frozen.

This completion does not mean implementation exists. Credential, egress policy,
connection-plan, provider-transport, response-reader, and adapter code remain
`NOT_STARTED`; actual credentials and provider calls remain `0`. Real BitGo TEST
calls and production access remain unauthorized. The only next authority is
implementation governance, and canonical adoption remains pending publication.

`P6_T03_PASS`

`P6_T03_COMPLETE`

`BITGO_EGRESS_AND_SSRF_BOUNDARY_FROZEN`

`P6_T03_CLOSEOUT_PRECONDITIONS_SATISFIED`

`PASS_P6_T03_BITGO_EGRESS_SSRF_BOUNDARY_READY_FOR_PUBLICATION`
