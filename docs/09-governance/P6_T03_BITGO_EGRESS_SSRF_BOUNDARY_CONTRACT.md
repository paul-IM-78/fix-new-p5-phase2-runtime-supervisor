# P6-T03 BitGo Egress and SSRF Boundary Contract

## Task Identity

- Task ID: `P6-T03`
- Task name: BitGo Egress and SSRF Boundary
- Classification: `PHASE6_PRE_REAL_CALL_EGRESS_SECURITY_GATE`
- Task type: `GOVERNANCE_AND_ARCHITECTURE_TASK`
- Status: `DEFINED_NOT_STARTED`

`P6_T03_TASK_DEFINED`

`P6_T03_BITGO_EGRESS_SSRF_BOUNDARY`

`P6_T03_PRE_REAL_CALL_EGRESS_SECURITY_GATE`

## Canonical Base

- Canonical branch: `fix/new-p5-phase2-runtime-supervisor`
- Canonical base SHA: `49eb880184ee4b837d68865d3c1d69e18f2e4d8c`
- Predecessors: P6-T01 and P6-T02 are canonically published and complete.

## P6-T01 / P6-T02 Authority

P6-T01 selected `BITGO`, `SOLANA`, `BITGO_TEST`, `SCOPE_B`, and
`ON_DEMAND`. P6-T02 froze a provider-environment credential reference model and
preserved a separate egress gate:

`P6_T02_EGRESS_GATE_REMAINS_REQUIRED`

`P6_T02_AUTHORIZES_NEXT_EGRESS_GOVERNANCE_ONLY`

No credential, authentication, transport, adapter, DNS, provider call, or
production authority is inherited by this task.

## Purpose

Freeze the BitGo provider outbound destination, SSRF, redirect, TLS, timeout,
retry/rate-limit, response-bound, proxy, and credential-ordering architecture
before any provider transport implementation or real external call.

## Task Classification

This is governance and architecture only. It introduces no production code,
credentials, DNS probes, HTTP requests, TLS connections, provider calls, or
database changes.

P6-T03 completion authorizes only later implementation governance:

`P6_T03_AUTHORIZES_NEXT_IMPLEMENTATION_GOVERNANCE_ONLY`

It does not itself authorize implementation or real provider calls.

## Provider / Environment Context

- Provider: `BITGO`
- Chain: `SOLANA`
- Initial environment: `BITGO_TEST`
- Initial read scope: `SCOPE_B`
- Freshness: `ON_DEMAND`
- Actual provider credentials: `0`
- Real provider calls: `NOT_AUTHORIZED`
- Production access: `NOT_AUTHORIZED`

## Official BitGo Destination Identity

The official BitGo developer documentation recorded on 2026-08-14 identifies
the TEST API base environment as `https://app.bitgo-test.com` and production as
`https://app.bitgo.com`.

- Initial TEST hostname: `app.bitgo-test.com`
- Production hostname: `app.bitgo.com`
- Evidence family: BitGo official developer documentation

`P6_T03_BITGO_TEST_HOST_FROZEN`

`P6_T03_PRODUCTION_HOST_SEPARATE_UNAUTHORIZED`

Only `BITGO_TEST` is eligible for the current Phase 6 qualification path.
Individual API endpoint paths are deliberately deferred:

`ENDPOINT_PATH_CONTRACT_DEFERRED_TO_PROVIDER_CLIENT_GOVERNANCE`

## Provider Environment Endpoint Registry

`P6_T03_FIXED_PROVIDER_ENVIRONMENT_ENDPOINT_REGISTRY`

Provider plus environment selects a governed endpoint definition. A destination
must not come from browser or public API input, custody/provider binding URL,
wallet metadata, query parameters, request-body URLs, unvalidated database URLs,
or caller-supplied Host headers.

`P6_T03_CALLER_CONTROLLED_URL_PROHIBITED`

## Environment Separation

`BITGO_TEST` and `BITGO_PRODUCTION` require distinct registry entries. Unknown
environments fail closed. TEST and production must never silently fall back to
each other. Production remains unauthorized.

## Host Allowlist

`P6_T03_EXACT_HOST_ALLOWLIST`

The future transport compares a normalized effective hostname to an exact
provider/environment registry entry. Broad suffix matching, such as
`*.bitgo.com` or `endsWith("bitgo.com")`, is prohibited by default. IP pinning
is not required or recommended because provider/CDN addresses can change.

## URL Parsing and Normalization

`CANONICAL_URL_PARSING_REQUIRED`

Future transport must use a standards-compliant URL parser, normalize hostname
before comparison, reject userinfo, malformed URLs, alternate schemes,
unexpected ports, and hostname canonicalization tricks including case and
trailing-dot mismatches.

## Scheme Boundary

`P6_T03_HTTPS_ONLY`

Only HTTPS to an approved destination is permitted. HTTP, FTP, file, data, and
all other schemes are prohibited and normalize as `EGRESS_SCHEME_NOT_ALLOWED`.

## SSRF Threat Boundary

`P6_T03_SSRF_DEFENSE_REQUIRED`

Future transport must defend against IPv4 loopback, RFC1918/private addresses,
link-local addresses, cloud metadata targets, IPv6 loopback, IPv6 unique-local,
IPv6 link-local, alternate textual IP forms, DNS rebinding, redirect-based
destination escape, userinfo tricks, scheme confusion, and hostname
canonicalization tricks.

## DNS / Resolved-IP Policy

`P6_T03_RESOLVED_IP_VALIDATION_REQUIRED`

The architecture is `HOST_ALLOWLIST_PLUS_RESOLVED_IP_DENYLIST`:

1. Select the approved provider/environment hostname.
2. Validate scheme and exact normalized hostname.
3. Validate the effective resolved destination at request/connection time.
4. Reject loopback, private, link-local, metadata/internal, and IPv6-equivalent
   disallowed classes.
5. Only then proceed toward credential resolution and request execution.

No DNS query is made by this task. IP pinning is false.

## DNS Rebinding Defense

`P6_T03_DNS_REBINDING_DEFENSE_REQUIRED`

The future transport must not rely only on an earlier one-time DNS check. The
effective connection destination must be subject to the approved IP policy. This
contract intentionally does not prescribe a Node implementation mechanism.

## Redirect Policy

`P6_T03_REDIRECTS_DISABLED`

Automatic redirect following must be disabled for governed provider transport.
Cross-host redirects, same-host redirects by default, and Authorization
forwarding across redirects are prohibited. Redirects normalize as
`EGRESS_REDIRECT_BLOCKED`.

## TLS Policy

`P6_T03_TLS_CERTIFICATE_VERIFICATION_REQUIRED`

Certificate verification bypass, including an equivalent of
`rejectUnauthorized=false`, is prohibited. Custom CAs are not authorized by
P6-T03. A fixed TLS minimum version is deliberately not frozen. TLS failures
must not disclose sensitive request data.

## Provider Transport Boundary

The future architecture is `DEDICATED_SERVER_PROVIDER_TRANSPORT`. It owns
endpoint selection, URL/host/resolved-IP checks, SSRF enforcement, redirect
denial, TLS, deadline, retry/rate-limit, response bounds, method/header policy,
proxy behavior, non-secret audit metadata, and normalized transport errors.

The adapter owns approved read semantics and response normalization. The
credential resolver remains server-only and resolves a secret only after the
destination passes egress validation.

## Credential / Egress Ordering

`P6_T03_DESTINATION_VALIDATED_BEFORE_SECRET_RESOLUTION`

`P6_T03_AUTHORIZATION_CONSTRUCTED_AFTER_DESTINATION_VALIDATION`

The frozen logical sequence is: select provider/environment endpoint; parse and
validate URL; enforce exact host; validate resolved destination; establish the
destination is permitted; resolve credential in its approved server-only
boundary; construct Authorization at the late transport boundary; perform a
bounded request; normalize outcome; discard operation-scoped secret exposure.

## Timeout / AbortSignal

`P6_T03_ABORT_SIGNAL_REQUIRED`

`P6_T03_TRANSPORT_DEADLINE_REQUIRED`

Future transport requires caller `AbortSignal` propagation and a transport-owned
total deadline. Numeric timeout values are deliberately `NOT_FROZEN`.

## Retry / Backoff

`P6_T03_BOUNDED_RETRY_BACKOFF_JITTER`

Potentially retryable failures are transient network/DNS errors, connection
resets, HTTP 408, selected 5xx, policy-approved timeouts, and HTTP 429 subject
to bounded Retry-After handling. Authentication/authorization failure, invalid
request, egress violation, SSRF rejection, TLS validation failure, malformed
response, and response-too-large failures are non-retryable. Endless retry is
prohibited. Exact counts and timing are deliberately `NOT_FROZEN`.

## Rate-Limit Semantics

`P6_T03_RATE_LIMIT_SEMANTICS_FROZEN`

HTTP 429 maps to `RATE_LIMITED`. Retry-After may be honored only when safely
parsed within the bounded retry policy. Non-secret, bounded quota metadata may
be retained only when useful to normalized audit evidence.

## Response Size

`P6_T03_BOUNDED_PROVIDER_RESPONSE_REQUIRED`

Future defenses must validate Content-Length when supplied, enforce an actual
streamed/body byte cap, prevent unbounded buffering, truncate error bodies before
audit/diagnostic handling, and avoid raw-provider payload persistence. Exact byte
limits are deliberately `NOT_FROZEN`. Oversize responses normalize as
`PROVIDER_RESPONSE_TOO_LARGE`.

## Method Boundary

`P6_T03_METHOD_BY_ENDPOINT_CONTRACT`

Permitted methods are defined by a future approved endpoint contract. P6-T03
does not globally freeze GET-only because HTTP verb alone does not prove
read-only semantics. Arbitrary methods and provider mutation semantics are
prohibited.

## Header Boundary

`P6_T03_TRANSPORT_CONTROLLED_HEADER_ALLOWLIST`

Allowed categories are Authorization, Accept, Content-Type where an endpoint
requires it, and bounded non-secret correlation/user-agent metadata. Caller Host,
caller Authorization, arbitrary forwarded browser headers, Proxy-Authorization,
and unapproved credential-bearing headers are prohibited. Sensitive-header
logging is prohibited.

## Proxy Boundary

`P6_T03_PROXY_BEHAVIOR_EXPLICITLY_GOVERNED`

Future provider transport must not silently inherit an uncontrolled proxy path.
HTTP_PROXY, HTTPS_PROXY, and system-proxy behavior require explicit evaluation.
Transparent proxy use is not automatically authorized; any required proxy needs
separate trust, destination, credential, and audit governance.

## Transport Failure Semantics

`P6_T03_TRANSPORT_FAILURE_SEMANTICS_FROZEN`

Required non-secret categories are `EGRESS_DESTINATION_NOT_ALLOWED`,
`EGRESS_SCHEME_NOT_ALLOWED`, `EGRESS_PRIVATE_ADDRESS_BLOCKED`,
`EGRESS_REDIRECT_BLOCKED`, `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMITED`,
`PROVIDER_UNAVAILABLE`, `PROVIDER_TLS_ERROR`, `PROVIDER_RESPONSE_TOO_LARGE`, and
`PROVIDER_MALFORMED_RESPONSE`. P6-T03 changes no production enum.

## Outbound Audit Metadata

`P6_T03_EGRESS_AUDIT_METADATA_NON_SECRET_ONLY`

Permitted conceptual metadata is provider, environment, endpoint identifier,
hostname, operation, approved method, normalized outcome, duration, retry count,
safe HTTP status, byte counts, and correlation/run ID. Authorization, Bearer
values, tokens, raw sensitive responses, unbounded error bodies, and resolver
internals are prohibited. Existing run-evidence boundaries remain compatible.

## Production Separation

`BITGO_PRODUCTION_EGRESS_REMAINS_UNAUTHORIZED`

The production hostname is recorded only to preserve environment separation. No
production network call, credential, or transport activation is authorized.

## Real-Call Authorization Separation

`P6_T03_REAL_PROVIDER_CALLS_PROHIBITED`

`P6_T03_REAL_CALL_GATE_REMAINS_REQUIRED`

`SEPARATE_TEST_QUALIFICATION_AND_REAL_CALL_AUTHORIZATION_REQUIRED`

Even after P6-T03 closes, TEST requests, credential/auth implementation, egress
implementation, and provider clients remain not automatically authorized.

## Implementation Governance Separation

`P6_T03_IMPLEMENTATION_NOT_STARTED`

P6-T03 permits only later implementation-governance planning for credentials,
egress security, provider transport, and adapter integration. It does not define
P6-T04 or assign any future task ID.

## Exit Criteria

`P6_T03_EXIT_CRITERIA_FROZEN`

P6-T03 can close only when the following architecture conditions are formally
recorded:

1. BitGo TEST hostname identity is frozen.
2. Production hostname is separate and unauthorized.
3. Fixed provider/environment registry is frozen.
4. Caller-controlled provider URLs are prohibited.
5. Exact-host allowlist is frozen.
6. SSRF defense requirements are frozen.
7. Resolved-IP/private-address policy is frozen.
8. DNS rebinding defense is frozen.
9. Redirects-disabled policy is frozen.
10. HTTPS-only policy is frozen.
11. TLS certificate verification is required.
12. Timeout/deadline architecture is frozen.
13. AbortSignal propagation is required.
14. Bounded retry/backoff/jitter is frozen.
15. HTTP 429 and Retry-After semantics are frozen.
16. Bounded provider response architecture is frozen.
17. Method-by-endpoint policy is frozen.
18. Transport-controlled header allowlist is frozen.
19. Proxy behavior is explicitly governed.
20. Transport failure semantics are frozen.
21. Outbound audit metadata is non-secret only.
22. Destination validation precedes secret resolution.
23. Actual provider calls remain zero.
24. Actual provider credentials remain zero.
25. Provider write, signing, and financial execution authority remain zero.
26. Separate TEST qualification and real-call authorization remain required.

## Remediation / Stop Policy

If future transport cannot satisfy exact governed destination, HTTPS-only, TLS
verification, SSRF/private-address protections, redirect prohibition, controlled
credentials, or bounded timeout/retry/response behavior, stop for governance
review:

`EGRESS_BOUNDARY_INCOMPATIBLE_WITH_PHASE6`

Security rules must not be silently weakened.

## Expected Closeout Report

The expected later report is:

`docs/09-governance/P6_T03_BITGO_EGRESS_SSRF_BOUNDARY_REPORT.md`

It is not created by this task-definition step.

## Explicit Out-of-Scope

P6-T03 does not include a BitGo API call, DNS or TLS probe, Solana RPC call,
credential creation/retrieval/storage, secret resolver, Authorization-header,
HTTP/provider transport, SSRF or endpoint-registry implementation, provider
adapter, wallet mapping, health semantic, normalization, DB/schema change,
production endpoint activation, webhook, automation, provider write, signing,
financial execution, or next Phase 6 task definition.

`P6_T03_ACTUAL_CREDENTIALS_ZERO`

`P6_T03_PROVIDER_WRITE_PROHIBITED`

`P6_T03_SIGNING_PROHIBITED`

`P6_T03_FINANCIAL_EXECUTION_PROHIBITED`

## Deliberately Unfrozen Values

Exact timeout milliseconds, retry count, backoff milliseconds, response byte
limit, fixed TLS minimum version, and provider API paths are `NOT_FROZEN`.
These values require later evidence and qualification; their deferral is not a
P6-T03 contract defect.
