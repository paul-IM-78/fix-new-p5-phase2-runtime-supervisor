# P6-T02 BitGo Credential Architecture and Secret Boundary Contract

## Task Identity

- Task ID: `P6-T02`
- Task name: BitGo Credential Architecture and Secret Boundary
- Classification: `PHASE6_PRE_REAL_CALL_CREDENTIAL_SECURITY_GATE`
- Task type: `GOVERNANCE_AND_ARCHITECTURE_TASK`
- Status: `DEFINED_NOT_STARTED`

`P6_T02_TASK_DEFINED`

`P6_T02_BITGO_CREDENTIAL_SECRET_BOUNDARY`

`P6_T02_PRE_REAL_CALL_CREDENTIAL_SECURITY_GATE`

## Canonical Base

- Canonical branch: `fix/new-p5-phase2-runtime-supervisor`
- Canonical base SHA: `a9c4481006de85c66fa3c8460c0e42616eeec38b`
- Predecessor: P6-T01 is canonically published, PASS, and COMPLETE.

## P6-T01 Authority

P6-T01 selected `BITGO`, `SOLANA`, `BITGO_TEST`, `SCOPE_B`, and
`ON_DEMAND`. It requires separate credential and egress gates. It authorizes no
implementation, credential access, external egress, provider call, provider
write, signing, or financial execution.

This task defines the credential architecture required before any credential
implementation or real provider call. It does not change P6-T01 scope or grant
additional provider authority.

## Purpose

Freeze the provider-specific credential and secret-handling architecture for
BitGo Bearer-token authentication. The architecture protects the credential,
keeps it out of browser and ordinary application-data surfaces, and preserves a
later independently auditable egress gate.

## Task Classification

Architecture in this task means a governance and design contract only. It does
not mean a production implementation, credential creation, token storage,
secret-manager configuration, provider API integration, or network activity.

P6-T02 authorizes only the next egress-governance task after its own closeout:

`P6_T02_AUTHORIZES_NEXT_EGRESS_GOVERNANCE_ONLY`

## Selected Provider Context

- Provider: `BITGO`
- Chain: `SOLANA`
- Qualification environment: `BITGO_TEST`
- Approved product scope: balance observation, normalized availability or health
  semantic, and normalized capability metadata.
- Freshness: `ON_DEMAND`

Production access remains `NOT_AUTHORIZED`. No automatic fallback from TEST to
production is permitted.

## Authentication Family

The frozen authentication architecture is:

`P6_T02_AUTH_FAMILY_BITGO_BEARER_TOKEN`

The conceptual request model is an Authorization header. A token must never be
placed in a URL, query string, path, source file, public configuration value, or
ordinary application record.

`P6_T02_TOKEN_IN_URL_PROHIBITED`

Actual Authorization-header code, secret resolution, and token configuration
are not in scope.

## Least-Privilege Token Boundary

`P6_T02_READ_ONLY_LEAST_PRIVILEGE_TOKEN_REQUIRED`

The future initial qualification credential must grant only the minimum BitGo
permissions required for the approved `SCOPE_B` reads. Convenience authority
for wallet mutation, transaction creation, transfer submission, withdrawal,
signing, payout, or financial execution is prohibited.

If BitGo permission granularity cannot enforce the intended read-only boundary,
work must stop for governance review. A broader token is not an acceptable
fallback.

## Secret Reference Model

Application and domain code must consume an opaque `SECRET_REFERENCE` or an
equivalent non-secret identifier, never a `SECRET_VALUE` persisted in ordinary
business data. The contract distinguishes secret references, secret values, and
non-secret metadata.

Raw token material must not be stored in business tables, provider bindings,
audit rows, run evidence, logs, public API responses, or source code.

`P6_T02_SECRET_REFERENCE_REQUIRED`

`P6_T02_RAW_TOKEN_NORMAL_APP_PERSISTENCE_PROHIBITED`

## Server-Only Injection Boundary

Provider credential resolution may occur only within a future approved trusted
server-side provider execution boundary. The browser, client-side JavaScript,
public API responses, and public DTOs receive neither a token nor a secret
reference capable of retrieval.

`P6_T02_SERVER_ONLY_CREDENTIAL_INJECTION`

`P6_T02_BROWSER_CREDENTIAL_ACCESS_PROHIBITED`

## Browser Isolation

No browser component, browser Supabase client, client-side environment value,
or frontend request may receive or derive a BitGo credential. Provider
credential access remains strictly server-only.

## Application Service-Role Isolation

Ordinary application database or service-role authority must not automatically
grant provider-secret retrieval authority. Provider secret retrieval requires a
separate constrained trust boundary.

`P6_T02_APP_SERVICE_ROLE_SECRET_ACCESS_PROHIBITED`

## TEST / Production Credential Separation

TEST and production credentials must be separate. Environment selection must be
explicit, with no silent reuse, automatic fallback, or production fallback when
TEST configuration is missing. A production secret reference requires separate
creation and approval in a later gate.

`P6_T02_TEST_PRODUCTION_CREDENTIAL_SEPARATION_REQUIRED`

## Raw Secret Persistence Boundary

No secret-store vendor is selected by this contract:

`SECRET_STORAGE_IMPLEMENTATION_NOT_YET_SELECTED`

If future persistent secret storage is needed, it must use an approved encrypted
secret-storage mechanism. Business records retain references and metadata only;
encryption keys must not reside beside encrypted secrets in ordinary database
records. Normal execution must not write plaintext token material to disk.

## Secret Lifetime Boundary

`DECRYPTED_PROVIDER_SECRET_LIFETIME_BOUNDED`

Future code must resolve a secret as late as practical, retain it only for the
required operation lifetime, avoid global plaintext caches and durable context
copies, and avoid exception objects containing secret material. This does not
claim memory erasure that the runtime cannot guarantee.

## Logging and Redaction

`P6_T02_SECRET_LOGGING_PROHIBITED`

Future logging must redact Authorization headers, Bearer values, secret-value
fields, credential-bearing headers, and any secret-bearing URL. Allowed audit
metadata is limited to provider, environment, non-secret credential reference
or version identifier, operation type, normalized outcome, timestamps, and
rotation or revocation state.

## Error Disclosure

`P6_T02_SECRET_ERROR_DISCLOSURE_PROHIBITED`

Errors must not expose tokens, Authorization headers, retrievable secret
reference internals, raw request dumps containing authorization, or secret
environment values. A normalized provider-auth failure category, non-secret
provider/environment metadata, and a correlation or run identifier are allowed.

## Rotation Architecture

`P6_T02_ROTATION_POLICY_REQUIRED`

Credentials must be versionable, and an active reference must be able to change
without changing provider-binding identity. Controlled overlap is allowed only
when separately justified; the previous credential must be revocable after
transition. Audit records identify non-secret reference or version metadata.

`ROTATION_INTERVAL_NOT_YET_FROZEN`

## Revocation and Incident Response

`P6_T02_REVOCATION_POLICY_REQUIRED`

Future architecture must provide an immediate disable or revocation path,
reference deactivation, no fallback to a revoked credential, incident
classification, non-secret audit evidence, and replacement workflow. TEST and
production incident handling must remain isolated. No credential exists and no
revocation is performed in this task.

## Audit Metadata

`P6_T02_AUDIT_METADATA_NON_SECRET_ONLY`

Permitted audit metadata includes provider, environment, secret reference ID,
non-secret credential version, lifecycle timestamps, status, safely-derived
last-used timestamp, and normalized operation outcome. Raw token material,
Authorization headers, secret-bearing URLs, private material, and unnecessary
reversible or sensitive token derivatives are prohibited.

## Developer / Local Handling

`LOCAL_SECRET_MECHANISM_NOT_YET_SELECTED`

Future local handling must not commit a credential or copy one into markdown,
shell history where avoidable, command-line arguments, screenshots, or logs.
Any later local file or environment mechanism requires separate governance,
gitignore coverage, filesystem protections, server-only use, and TEST-only
qualification authority. Mentioning a local environment file here does not
authorize one.

## CI Handling

`CI_PROVIDER_CREDENTIALS_NOT_REQUIRED_FOR_P6_T02`

No CI provider credential or GitHub secret is required or created by P6-T02. If
CI is introduced later, any provider credential requires separate explicit
approval.

## Credential Retrieval Authorization

`SECRET_REFERENCE_DOES_NOT_IMPLY_SECRET_RETRIEVAL_AUTHORITY`

A future provider execution component needs explicit authority to resolve a
reference. Browsers, public routes, generic service-role users, and reporting
processes must not receive this ability.

## Provider Binding / Credential Separation

Provider bindings may retain provider identity, environment, internal binding
alias, and a separately approved external wallet-identifier reference. They
must not contain a raw BitGo token, Authorization header, or secret value. A
credential must rotate independently of custody-binding identity.

## Authentication Implementation Separation

Authentication architecture is frozen, while its implementation is not started:

`AUTH_ARCHITECTURE_FROZEN_IMPLEMENTATION_NOT_STARTED`

Bearer-header production code, secret resolution code, and token configuration
remain out of scope.

## Egress Gate Separation

`P6_T02_EGRESS_GATE_REMAINS_REQUIRED`

P6-T02 does not authorize BitGo hostname connection, DNS resolution, TLS
connection, HTTP request, provider API call, or Solana RPC call. A later egress
gate must separately define the fixed official allowlist, endpoint policy, URL
validation, SSRF controls, redirect and TLS policy, timeout, response bounds,
bounded concurrency, retry/backoff, and rate-limit handling.

## Real-Call Authorization Separation

`SEPARATE_REAL_CALL_AUTHORIZATION_GATE_REQUIRED`

Even after credential governance, egress governance, their implementations,
and adapter work, a later explicit TEST qualification and authorization gate is
required before the first real BitGo TEST request.

`P6_T02_REAL_PROVIDER_CALLS_PROHIBITED`

`P6_T02_IMPLEMENTATION_NOT_STARTED`

`P6_T02_PROVIDER_WRITE_PROHIBITED`

`P6_T02_SIGNING_PROHIBITED`

`P6_T02_FINANCIAL_EXECUTION_PROHIBITED`

## Exit Criteria

`P6_T02_EXIT_CRITERIA_FROZEN`

P6-T02 can close only when all of the following are formally recorded:

1. BitGo Bearer authentication family is frozen.
2. Read-only least-privilege token requirement is frozen.
3. Server-only secret injection boundary is frozen.
4. Opaque secret-reference model is frozen.
5. Raw token normal-application persistence is prohibited.
6. Browser credential access is prohibited.
7. Application service-role secret access is prohibited.
8. Token-in-URL is prohibited.
9. TEST and production credential separation is frozen.
10. Logging and redaction boundary is frozen.
11. Error-disclosure boundary is frozen.
12. Secret lifetime boundary is frozen.
13. Rotation architecture requirement is frozen.
14. Revocation and incident-response requirement is frozen.
15. Audit metadata is limited to non-secret data.
16. Provider binding is separated from credential secret.
17. Local/developer secret mechanism remains separately selected later.
18. CI credential use remains unauthorized and not required.
19. Actual credential values remain zero.
20. Actual provider calls remain zero.
21. Signing authority remains zero.
22. Provider write authority remains zero.
23. Financial execution authority remains zero.
24. Egress gate remains separately required.
25. Real provider calls remain unauthorized.

## Remediation / Stop Policy

If BitGo requirements cannot satisfy server-only isolation, read-only least
privilege, token-in-URL prohibition, logging/redaction, TEST/production
separation, no-signing authority, or no-write authority, stop for governance
review:

`CREDENTIAL_BOUNDARY_INCOMPATIBLE_WITH_PHASE6`

No Phase 6 hard boundary may be weakened automatically.

## Expected Closeout Report

The expected later report is:

`docs/09-governance/P6_T02_BITGO_CREDENTIAL_SECRET_BOUNDARY_REPORT.md`

It is not created by this task-definition step.

## Explicit Out-of-Scope

P6-T02 does not include an actual BitGo token, credential creation, credential
retrieval, credential-storage implementation, secret-manager implementation,
Bearer-header production code, provider API client, BitGo network request,
Solana RPC call, egress allowlist implementation, SSRF implementation, provider
adapter implementation, wallet mapping implementation, database or schema
changes, webhooks, automation, operational posting, financial execution,
production provider access, or definition of the next Phase 6 task.
