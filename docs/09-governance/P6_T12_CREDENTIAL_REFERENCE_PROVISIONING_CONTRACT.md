# P6-T12 Credential-Reference Provisioning Contract

## 1. Status and Purpose

Task: `P6-T12`

Title: `Credential-Reference Provisioning Governance`

Canonical planning base: `1741453584239ab1156d02087a06f1646447b668`

Selected credential architecture: `ENV_SECRET`

MVP objective: `OPERABLE_MVP = 100%`

Current canonical MVP progress: `69%`

P6-T12 owns the secure provisioning and resolution boundary for non-secret provider credential references required before authorized BitGo TEST execution can be composed.

P6-T12 does not authorize actual provider execution.

---

## 2. Existing Canonical Credential Architecture

Canonical credential-reference type: `CredentialReference`

Canonical module: `src/server/provider-security/provider-security-types.ts`

Canonical credential resolver: `ProviderCredentialResolver`

Canonical resolver module: `src/server/provider-security/provider-security-credential-resolver.ts`

Existing BitGo TEST secret source: `BITGO_TEST_ACCESS_TOKEN`

The existing source is server-only process environment configuration.

P6-T12 must preserve the existing provider-security resolver boundary rather than bypass it.

---

## 3. Core Separation

Required invariant: `credentialReference != credentialSecret`

A credential reference is:

- non-secret metadata;
- a stable logical identifier or binding used to select a credential source;
- safe to lifecycle-manage without storing the actual provider token.

A credential secret is:

- actual provider authentication material;
- high-sensitivity secret data;
- transient server-side data only.

The two must never be conflated.

---

## 4. Selected MVP Model

Selected model: `NON_SECRET_PRIVATE_REFERENCE_REGISTRY_PLUS_EXISTING_TEST_ENVIRONMENT_SECRET`

Classification: `ENV_SECRET`

The MVP must use:

1. private server-side credential-reference metadata;
2. the existing server-only process-environment TEST secret source;
3. the canonical credential resolver boundary.

P6-T12 must not introduce a second credential-secret storage system unless later evidence proves it necessary.

---

## 5. Credential Reference Storage

Credential references are non-secret but operationally sensitive configuration metadata.

They must be stored only in a private server-side provider/environment security boundary.

Credential-reference metadata must remain separate from:

- wallet-ID registry data;
- custody account binding data;
- actual provider secret values.

Browser/public direct access is prohibited.

Exact database relation names are deferred to the post-contract implementation scope review.

---

## 6. Credential Secret Classification

Credential secrets are: `SECRET / HIGH_SENSITIVITY`

Required prohibitions:

- browser exposure;
- public API exposure;
- ordinary application DB plaintext storage;
- application logs;
- metrics;
- audit payloads;
- error serialization;
- repository commits;
- generated reports;
- wallet-ID registry storage.

The actual BitGo token must never be committed to the repository.

---

## 7. TEST Environment Secret Source

The canonical MVP TEST secret source remains: `BITGO_TEST_ACCESS_TOKEN`

The value is supplied through server-only deployment/process environment configuration.

P6-T12 does not store the token in its private reference registry.

P6-T12 does not create the real token.

P6-T12 does not authorize reading a real token during contract publication.

---

## 8. Environment Isolation

Credential references must be explicitly scoped to provider environment.

Required:

- TEST reference may resolve only a TEST credential source;
- PRODUCTION reference may not fall back to TEST;
- TEST reference may not fall back to PRODUCTION;
- environment mismatch fails closed;
- automatic environment fallback: `0`.

Current authorization target: `TEST`

Production remains unauthorized.

---

## 9. Reference Lifecycle

The minimum MVP credential-reference lifecycle is:

- `ACTIVE`
- `ROTATING`
- `REVOKED`
- `DISABLED`

Lifecycle changes apply to non-secret metadata only.

The actual secret value is managed separately through the authorized deployment/environment secret mechanism.

Physical secret history must not be created by P6-T12.

---

## 10. Provisioning Boundary

Credential-reference provisioning must use a controlled server-only operator boundary.

The provisioning operation must not accept the actual provider secret.

Required:

- browser provisioning: `PROHIBITED`;
- public API provisioning: `PROHIBITED`;
- secret value in reference-provisioning arguments: `PROHIBITED`;
- ad-hoc secret persistence: `PROHIBITED`.

A full ADMIN web UI is not required for the MVP.

Exact operator-tool implementation path is deferred until the post-contract implementation scope review.

---

## 11. Secret Configuration Boundary

The actual TEST secret is configured out of band through server/deployment environment configuration.

P6-T12 reference provisioning must not write `BITGO_TEST_ACCESS_TOKEN` or any equivalent secret value.

Secret configuration and reference metadata provisioning remain distinct operations.

---

## 12. Resolution Flow

Required future semantic flow: `credentialReference -> server-only ProviderCredentialResolver -> transient credential secret`

The resolved credential secret must remain:

- server-only;
- transient;
- non-persistent within P6-T12;
- unavailable to browser/public callers;
- absent from logs/audit/metrics/errors.

The resolver must fail closed.

---

## 13. Authorized Execution Context Separation

P6-T12 stops at the credential provisioning/resolution seam.

The later flow, `resolved credential -> authorized execution context`, belongs to a separate successor task.

P6-T12 does not authorize or compose provider execution authority.

---

## 14. Provider Activation Separation

P6-T12 provider activity: `0`

P6-T12 does not perform:

- BitGo API calls;
- balance reads;
- wallet reads;
- Solana RPC;
- credential validity checks against the provider;
- provider network health checks.

Controlled BitGo TEST activation remains a later explicit task.

---

## 15. Reference Validation

Future credential-reference provisioning must validate at minimum:

- provider identity;
- provider environment;
- reference identity;
- lifecycle state;
- supported TEST binding;
- duplicate active reference according to the final frozen data model.

A credential reference must not contain the raw credential secret.

No secret-value format inference may be used to turn secret material into a reference.

---

## 16. Failure Policy

Required fail-closed conditions include:

- missing credential reference;
- unknown credential reference;
- disabled reference;
- revoked reference;
- invalid lifecycle state;
- provider mismatch;
- environment mismatch;
- required TEST secret missing;
- secret resolver failure;
- unauthorized secret source.

Required:

- silent fallback: `0`;
- default credential: `0`;
- fallback reference: `0`;
- TEST/PRODUCTION fallback: `0`.

No failure message may include secret material.

---

## 17. Rotation Model

MVP rotation uses two separated responsibilities.

### Secret Rotation

Actual secret value is updated out of band in the authorized server/deployment environment.

### Reference Metadata Rotation

Non-secret reference metadata moves through the controlled reference lifecycle.

The reference may enter `ROTATING` during a controlled rotation process.

No old secret value is persisted by P6-T12 for history.

---

## 18. Revocation / Disable Model

A reference may be `REVOKED` or `DISABLED`.

Such a reference must fail closed before any authorized provider execution is attempted.

No automatic fallback to another credential reference is permitted.

---

## 19. Audit Boundary

Credential-reference lifecycle operations may be audited using non-secret metadata.

Allowed audit information may include:

- provider;
- environment;
- reference alias/identifier;
- lifecycle operation;
- lifecycle version;
- timestamp;
- authorized actor metadata according to existing repository conventions.

Audit must never contain:

- credential secret;
- access token;
- bearer token;
- raw environment secret value.

Exact audit relation/function design is deferred to implementation scope review.

---

## 20. Wallet-ID Registry Separation

P6-T11 wallet-ID registry and P6-T12 credential reference registry are separate security responsibilities.

Required:

- wallet ID is not a credential;
- credential reference is not a wallet ID;
- credential secret is stored in neither registry;
- P6-T12 must not modify wallet-ID registry semantics merely to provision credentials.

P6-T11 remains canonical and unchanged unless separate governance later requires otherwise.

---

## 21. Database Boundary

P6-T12 may add private non-secret credential-reference metadata storage if required by implementation scope review.

It must not add an ordinary plaintext credential-secret table.

Future DB access must be least privilege.

Required browser/public secret access: `NONE`

Exact migration/table/role/function names are not authorized by this contract publication.

---

## 22. Operator Secret Input

Credential-reference provisioning does not accept a secret.

If a later local/deployment secret-configuration helper is found necessary, secret input must use a secure server-only method.

Raw secret through ordinary argv should be avoided where repository/deployment tooling permits safer input.

P6-T12 contract publication does not authorize such a helper yet.

---

## 23. Privacy and Non-Emission

Future implementation must prove that synthetic credential secrets do not appear in:

- logs;
- metrics;
- audit payloads;
- public errors;
- browser responses;
- generated qualification reports;
- repository-tracked files.

The real BitGo TEST token must never be used during P6-T12 qualification.

---

## 24. Future Implementation Categories

Expected future implementation categories are limited to the minimum required for:

1. private non-secret credential-reference metadata persistence, if required;
2. server-only reference-to-existing-resolver binding;
3. controlled reference lifecycle operator tooling;
4. focused offline/local qualification;
5. one focused package script if repository conventions require it.

Exact implementation paths and SQL object names are deferred until this contract becomes canonical and a separate implementation-scope review is completed.

---

## 25. Qualification Requirements

Future P6-T12 qualification must use: `SYNTHETIC_FAKE_SECRETS_ONLY`

Real BitGo token count: `0`

Qualification must prove at minimum:

1. credential reference contains no credential secret;
2. private reference metadata boundary;
3. browser/public secret access prohibited;
4. valid synthetic TEST reference provisioning;
5. correct TEST reference resolution;
6. unknown reference fails closed;
7. missing synthetic secret fails closed;
8. disabled reference fails closed;
9. revoked reference fails closed;
10. lifecycle transition rules;
11. environment isolation;
12. TEST/PRODUCTION fallback prohibited;
13. reference/secret separation;
14. secret absent from DB reference metadata;
15. secret absent from audit;
16. secret absent from logs;
17. secret absent from metrics;
18. secret absent from errors;
19. secret absent from repository-tracked files;
20. safe operator reference provisioning;
21. secret rotation/reference rotation separation;
22. transient server-only resolution;
23. credential resolver regression preserved;
24. provider-security regression preserved;
25. provider calls `0`;
26. BitGo calls `0`;
27. production execution `0`;
28. full authority guard.

Exact qualification IDs and final count must be frozen before implementation.

---

## 26. Explicitly Out of Scope

P6-T12 does not authorize:

- real BitGo token creation;
- real BitGo token reads;
- provider credential validation through network calls;
- BitGo requests;
- wallet reads;
- balance reads;
- Solana RPC;
- authorized provider execution context;
- controlled TEST activation;
- production credentials;
- production execution;
- signing;
- withdrawals;
- payouts;
- fund movement.

---

## 27. Authority Boundary

Current authority:

- actual credential-reference creation authority: `NONE`
- actual credential-secret authority: `NONE`
- credential-read authority: `NONE`
- provider authority: `NONE`
- production authority: `NONE`
- signing authority: `NONE`

Contract publication alone does not authorize implementation.

---

## 28. Invalidation Conditions

Future P6-T12 implementation authorization must be withheld if:

- credential plaintext must be stored in ordinary DB tables;
- browser/public secret access becomes required;
- P6-T12 must make provider calls;
- production credentials become necessary;
- secret values must enter the wallet-ID registry;
- a second unnecessary secret backend must be introduced;
- existing canonical credential resolver must be bypassed;
- authorized execution context must be bundled into P6-T12;
- implementation scope cannot maintain TEST/PRODUCTION isolation.

---

## 29. MVP Progress

Current canonical MVP estimate: `69%`

Contract publication receives `0%` operational progress credit.

P6-T12 implementation/qualification/merge is expected to move the project into approximately `73-75%` operable-MVP completion.

This percentage is a planning estimate, not a contract exit criterion.

---

## 30. Final Contract Principle

P6-T12 establishes: `NON_SECRET_REFERENCE_PROVISIONING_BEFORE_AUTHORIZED_PROVIDER_EXECUTION`

The MVP may identify which credential should be used without storing, exposing, or activating the provider secret through the credential-reference registry.

Actual provider execution remains separately gated.
