# P6-T02 BitGo Credential Architecture and Secret Boundary Decision Report

## Task Identity

- Task ID: `P6-T02`
- Task: BitGo Credential Architecture and Secret Boundary
- Canonical branch: `fix/new-p5-phase2-runtime-supervisor`
- Canonical base SHA: `a9c4481006de85c66fa3c8460c0e42616eeec38b`
- Classification: governance and architecture only; no credential, provider, or
  network implementation is authorized.

## Decision Summary

`P6_T02_ARCHITECTURE_DECISIONS_FROZEN`

P6-T02 freezes a provider-and-environment-scoped, non-secret reference model.
Secrets are resolved only at a dedicated server-only provider execution
boundary. Initial `BITGO_TEST` qualification uses trusted server-process runtime
injection; a future production deployment uses the same abstraction with an
external secret backend. Raw credentials are prohibited from normal application
data, bindings, browser code, logs, URLs, and public responses.

## Architecture Decision

`P6_T02_CREDENTIAL_ARCHITECTURE = PROVIDER_ENVIRONMENT_SCOPED_REFERENCE_TO_INJECTED_SECRET_RESOLVER`

This decision authorizes governance for the next egress boundary only. It does
not authorize credential creation, credential implementation, provider client
implementation, outbound egress, or real provider calls.

## Secret Reference Model

`P6_T02_REFERENCE_MODEL_PROVIDER_ENVIRONMENT_SCOPED`

The reference is an opaque, stable identifier scoped to `provider +
environment`. Its non-secret metadata may identify the provider, environment,
version, lifecycle status, and timestamps. It contains neither raw token
material nor secret retrieval authority. Per-wallet, per-binding, global, and
cross-environment references are not the default model.

## Reference Placement

`P6_T02_REFERENCE_ONLY_DATABASE_BOUNDARY`

Credential-reference metadata belongs in future separate provider-environment
security metadata. It is not a custody/provider binding field, wallet record,
or business-domain secret field. Ordinary database or service-role authority
does not grant secret-resolution authority.

## TEST Secret Backend

`P6_T02_TEST_RUNTIME_INJECTION_SELECTED`

`BITGO_TEST` uses trusted server-process runtime injection for controlled
qualification only. The credential is not committed, persisted in ordinary
storage, exposed to a browser, or passed as a command-line argument where that
can be avoided.

## Production Secret Direction

`P6_T02_PRODUCTION_EXTERNAL_SECRET_BACKEND_DIRECTION`

Production uses an external secret backend behind the common resolver
abstraction. The backend vendor, deployment topology, production credential,
and production access are not selected or authorized by this decision.

`P6_T02_SAME_ABSTRACTION_DIFFERENT_BACKEND`

## Secret Resolver Boundary

`P6_T02_SECRET_RESOLVER_SERVER_ONLY`

The future conceptual interface is:

```text
resolve(provider, environment, opaqueReference, authorizedExecutionContext)
```

Inputs are non-secret provider/environment/reference metadata and trusted
execution context. Output is a short-lived server-local credential object. The
browser, public routes, and generic service-role access have zero direct
resolution authority.

## Authorization Header Boundary

`P6_T02_AUTH_HEADER_LATE_TRANSPORT_BOUNDARY`

Any future Authorization Bearer header is constructed only inside a server-only
provider transport immediately before an authorized outbound request. It is not
propagated upward, persisted, logged, or placed in a URL.

## Secret Lifetime / Cache

`P6_T02_SECRET_NO_CACHE_DEFAULT`

The default plaintext secret lifetime is one authorized provider operation. A
long-lived global plaintext cache is prohibited by default. A fixed TTL is not
frozen; no-cache preserves rotation consistency for the initial on-demand scope.

## Environment Isolation

`P6_T02_ENVIRONMENT_NAMESPACE_FROZEN`

References are explicitly namespaced. A `BITGO_TEST` reference may resolve only
the corresponding TEST secret. A future production reference may resolve only
the corresponding production secret. Automatic fallback in either direction is
prohibited. Mismatch fails closed as `CREDENTIAL_ENVIRONMENT_MISMATCH`.

## Least-Privilege Verification

`P6_T02_ADMINISTRATIVE_SCOPE_VERIFICATION`

Runtime permission introspection is not documented by current evidence. Future
controlled qualification must retain non-secret administrative evidence that a
TEST credential has only the minimum approved read scope. A broader write-capable
credential is prohibited as fallback.

## Logging / Redaction Requirement

`P6_T02_REDACTION_ARCHITECTURE_REQUIRED`

Current redaction controls are partial. Before any credential implementation,
future code must redact Authorization headers, Bearer values, token fields,
credential-bearing URLs, secret-resolution failures, provider authentication
failures, and request/error dumps.

`P6_T02_REDACTION_IMPLEMENTATION_FOLLOW_ON_REQUIRED`

## Rotation Model

`P6_T02_ROTATION_STABLE_REFERENCE_VERSIONED_SECRET`

Rotation uses a stable logical reference with a versioned backend secret. It
does not require provider-binding changes. Lifecycle metadata records only
non-secret events. A fixed rotation interval remains future operational policy.

## Revocation Model

The frozen lifecycle states are `ACTIVE`, `ROTATING`, `REVOKED`, and `DISABLED`.
Revoked credentials never fall back. The following conditions fail closed:

- missing reference: `CREDENTIAL_REFERENCE_MISSING`
- unavailable backend secret: `CREDENTIAL_UNAVAILABLE`
- revoked credential: `CREDENTIAL_REVOKED`
- environment mismatch: `CREDENTIAL_ENVIRONMENT_MISMATCH`
- invalid scope: `CREDENTIAL_SCOPE_INVALID`
- denied resolver authority: `SECRET_RESOLUTION_DENIED`
- provider authentication rejection: `AUTHENTICATION_FAILED`

`P6_T02_REVOCATION_FAIL_CLOSED`

## Credential Failure Semantics

`P6_T02_CREDENTIAL_FAILURE_SEMANTICS_FROZEN`

All credential failures above are semantic categories only. They must not carry
raw credentials, Authorization values, reversible derivatives, or provider
request dumps.

## Audit Metadata

`P6_T02_AUDIT_METADATA_NON_SECRET_ONLY`

Future audit metadata may contain provider, environment, opaque reference,
credential version, lifecycle status/timestamps, and normalized outcome class.
It must not contain raw credentials, Authorization headers, reversible secret
derivatives, credential-bearing URLs, or private material.

## Local TEST Handling

`P6_T02_LOCAL_TEST_RUNTIME_INJECTION`

The approved initial local TEST mechanism is trusted server-process runtime
injection. An OS-native secret store is only a possible future fallback. This
decision does not authorize committed dotenv secrets, shell token arguments,
source or markdown tokens, screenshots, browser storage, or gitignored local
files by themselves.

## CI Policy

`P6_T02_NO_PROVIDER_SECRET_IN_NORMAL_CI`

Normal CI neither requires nor receives a provider credential. Any future
real-provider qualification in CI requires separate governance. No GitHub
secrets are created by this task.

## Provider Binding Separation

`P6_T02_PROVIDER_BINDING_SECRET_PROHIBITED`

Provider bindings never contain raw secret material. Future credential-reference
metadata remains separate, and credential rotation is independent of bindings.

## Egress Separation

`P6_T02_EGRESS_GATE_REMAINS_REQUIRED`

This task does not freeze hostnames, URLs, redirect handling, SSRF controls,
transport retries, or an egress implementation. Credential architecture closes
independently and does not authorize network traffic.

## Implementation Separation

`P6_T02_AUTH_IMPLEMENTATION_NOT_STARTED`

`P6_T02_CREDENTIAL_IMPLEMENTATION_NOT_STARTED`

No resolver, header construction, provider client, or credential storage code is
implemented by P6-T02.

## Real-Call Prohibition

`P6_T02_REAL_PROVIDER_CALLS_REMAIN_PROHIBITED`

`P6_T02_PRODUCTION_ACCESS_REMAINS_PROHIBITED`

`P6_T02_AUTHORIZES_NEXT_EGRESS_GOVERNANCE_ONLY`

Actual credential values, BitGo calls, Solana RPC calls, signing, provider
write authority, and financial execution remain unauthorized. A separate real
call authorization gate is required.

## Exit Criteria Evaluation

All 25 P6-T02 contract exit criteria are satisfied as architecture decisions:
reference scope, storage separation, resolver boundary, late header boundary,
lifetime, namespace isolation, least privilege, redaction requirement,
rotation/revocation, failure semantics, audit model, local/CI policy, provider
binding separation, and follow-on prohibitions are explicitly frozen.

`P6_T02_ARCHITECTURE_EXIT_CRITERIA_SATISFIED`

This is not a final task PASS or COMPLETE marker. Final integrity and closeout
preconditions remain in the next step.

## Security Findings

- Actual credentials created or read: `0`
- Provider, Solana RPC, or other external calls: `0`
- Signing, provider write, or financial execution authority: `0`
- Raw secret findings in this report: `0`

## Decision Status

Classification: `P6_T02_CONTRACT_REQUIREMENTS_SATISFIED_BY_ARCHITECTURE_DECISION_REPORT`

`PASS_P6_T02_FINAL_ARCHITECTURE_DECISION_FROZEN`

The architecture is frozen for final integrity review. P6-T02 remains open
until its dedicated closeout step; no implementation authority is created.

## Final Closeout Status

- Task classification: `PHASE6_PRE_REAL_CALL_CREDENTIAL_SECURITY_GATE`
- Task type: `GOVERNANCE_AND_ARCHITECTURE_TASK`
- Task status: `COMPLETE`
- Gate status: BitGo Credential Architecture and Secret Boundary is `CLOSED`.
- Architecture decisions: `FROZEN`
- Implementation status and authorization: `NOT_STARTED` and `NONE`
- Actual credentials: `0`
- Real provider calls: `NOT_AUTHORIZED`
- Egress gate: `STILL_REQUIRED`
- Production access: `NOT_AUTHORIZED`
- P6-T03: `NOT_DEFINED`
- Canonical adoption: `false` until PR merge.

`P6_T02_PASS`

`P6_T02_COMPLETE`

`BITGO_CREDENTIAL_ARCHITECTURE_AND_SECRET_BOUNDARY_FROZEN`

`P6_T02_CLOSEOUT_PRECONDITIONS_SATISFIED`

`PASS_P6_T02_BITGO_CREDENTIAL_SECRET_BOUNDARY_READY_FOR_PUBLICATION`

These final markers close only the credential-security governance gate. They do
not authorize a credential, resolver implementation, Authorization-header code,
egress implementation, provider adapter, provider call, signing authority, or
production access.
