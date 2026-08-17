# P6-T11: Secure Wallet-ID Registry Provisioning Contract

## 1. Status and Purpose

Task: `P6-T11`

Title: `Secure Wallet-ID Registry Provisioning Governance`

Canonical planning base: `d63a9a1cc5e4a11ef0d4e5d00c16fc70342c2d30`

Selected registry source model: `PRIVATE_DB`

MVP objective: `OPERABLE_MVP = 100%`

P6-T11 is the first remaining MVP blocker after the canonical completion of P6-T10.
Its responsibility is to define a dedicated, private, server-only wallet-ID registry with controlled operator provisioning and immutable runtime loading.

This contract does not authorize actual wallet-ID provisioning or implementation.

---

## 2. Predecessor Boundary

The canonical runtime chain is:

`P6-T10 consumer -> P6-T09 composition -> P6-T08 wallet-ID resolver -> P6-T07 observer adapter -> P6-T05 semantic adapter -> P6-T04 provider-security boundary`

P6-T11 must preserve the existing P6-T08/P6-T09/P6-T10 responsibilities.

The canonical runtime registry entry remains:

`Readonly<{ binding: CustodyAccountBindingRef; walletId: string }>`

P6-T08 remains the final runtime owner of:

- exact tuple lookup;
- wallet-ID runtime format validation;
- duplicate tuple rejection;
- immutable defensive snapshot semantics.

P6-T11 must not add live DB reads inside P6-T08.

Required predecessor modifications:

- P6-T08: `0`
- P6-T09: `0`
- P6-T10: `0`

---

## 3. Dedicated Registry Requirement

The existing private custody models may supply relational parents and the logical binding tuple, but provider wallet IDs must not be stored directly in the existing custody binding model.

Relevant existing private models include:

- `private.custody_providers`
- `private.custody_account_bindings`
- `private.custody_config_audit_events`

The provider wallet-ID registry must remain a dedicated private data model.

Required invariant: `bindingKey != walletId`

The logical binding model and provider-specific external identifier remain separated.

---

## 4. Data Classification

A BitGo wallet ID is:

- credential secret: `false`
- sensitive provider identifier: `true`

Raw wallet IDs are prohibited from:

- browser exposure;
- public APIs;
- ordinary user APIs;
- application logs;
- metrics;
- raw audit payloads.

Credential values and wallet-ID values must never share a storage field or registry responsibility.

---

## 5. Lookup Identity

The canonical binding identity remains the exact tuple:

`providerCode + bindingKey + assetCode + accountRole`

Required:

- exact matching only;
- wildcard matching: `0`;
- fallback matching: `0`;
- normalization fallback: `0`;
- wallet-ID derivation: `0`;
- bindingKey-as-wallet-ID fallback: `0`.

---

## 6. Source Model

P6-T11 selects: `DEDICATED_PRIVATE_DB_REGISTRY`

The registry must:

- live only in a private database boundary;
- link to or validate against canonical provider/binding/asset relationships;
- be unavailable directly to browser/public roles;
- support deterministic environment-scoped loading;
- support a controlled auditable lifecycle;
- remain separate from credentials.

Static configuration and external configuration/secret backends are not selected for the MVP registry source.

---

## 7. Lifecycle

The MVP registry supports the minimum controlled lifecycle.

### Create

Validated and explicitly authorized provisioning only.

### Replace / Update

Versioned replacement through a narrow validated provisioning operation.

### Deactivate / Revoke

Required. Inactive entries must not enter a runtime registry snapshot.

### Physical Delete

`PROHIBITED` for the MVP lifecycle.

### Audit

Lifecycle operations require audit metadata, but raw wallet IDs must not appear in general audit payloads.

### Versioning

Optimistic lifecycle/version control is required.

Exact SQL object names and version representation are implementation-scope decisions and are not authorized by this contract publication.

---

## 8. Operator Provisioning Boundary

MVP provisioning method: `SERVER_ONLY_OPERATOR_COMMAND_OR_TOOL`

The trusted operator may eventually supply a raw wallet ID only as transient input to a narrow validated provisioning boundary. The MVP does not require a new ADMIN web UI.

Required:

- ad-hoc SQL provisioning: `PROHIBITED`;
- browser provisioning: `PROHIBITED`;
- ordinary public API provisioning: `PROHIBITED`;
- direct table mutation by application/browser: `PROHIBITED`.

Actual wallet-ID entry remains separately authorized after implementation and qualification.

---

## 9. Runtime Read Boundary

Runtime loading must use a dedicated server-only read-only registry interface with least privilege.

Required runtime flow:

`private registry -> server-only loader -> complete validated immutable entry snapshot -> P6-T10`

The loader must produce a complete immutable array compatible with the canonical P6-T08 registry entry type. P6-T08 must not acquire DB ownership. P6-T10 must continue to receive dependency-injected registry data.

---

## 10. Runtime Load Timing

For the MVP:

- one bounded registry load per explicit one-shot execution;
- no background watcher;
- no polling;
- no registry daemon;
- no scheduler.

A registry change becomes visible to a subsequent explicit load. No long-lived live-query registry is required.

---

## 11. Snapshot Consistency

One runtime load must represent one complete fail-closed registry snapshot. The loader must not provide a partially loaded or mixed-version registry to P6-T10.

If the registry cannot be loaded consistently, P6-T10 must not execute. Silent partial loading is prohibited.

---

## 12. Fail-Closed Policy

Registry defects fail before P6-T10 invocation.

Required fail-closed conditions include:

- registry unavailable;
- malformed row;
- invalid wallet-ID representation;
- duplicate active tuple;
- invalid relational binding;
- invalid environment;
- inconsistent snapshot.

Inactive/revoked entries must not enter the active runtime snapshot.

Silent invalid-row skipping: `PROHIBITED`

---

## 13. Wallet-ID Validation

The provisioning layer may validate wallet IDs before storage or loading, but must not weaken the canonical P6-T08 validation. The canonical final runtime validator remains P6-T08.

The current canonical wallet-ID representation requirement must be revalidated from P6-T08 during implementation scope review. No provider network call may be used for wallet-ID validation.

---

## 14. Environment Boundary

Registry data is explicitly environment-scoped.

Required:

- TEST registry data cannot silently resolve as production data;
- production registry data cannot silently resolve as TEST data;
- automatic TEST/production fallback: `0`;
- environment context must be explicit.

Production remains unauthorized.

---

## 15. Read and Write Authority Separation

The future implementation must distinguish at least:

### Runtime Registry Read Authority

Read-only and least-privilege. It may only retrieve the registry fields required to produce the immutable runtime snapshot.

### Operator Provisioning Write Authority

Separate, narrow authority for validated create/replace/deactivate lifecycle operations.

### Browser/Public Authority

`NONE`

A broad service-role shortcut is not the default design and is not authorized by this contract. Exact DB role and procedure names are deferred to the implementation scope review.

---

## 16. Credential Separation

P6-T11 must never store or read:

- access tokens;
- bearer tokens;
- credential plaintext;
- credential resolver output;
- credential secrets.

Credential-reference provisioning remains a separate later MVP blocker. P6-T11 does not authorize P6-T12 or any credential task automatically.

---

## 17. Provider Separation

P6-T11 must perform zero provider network validation.

Prohibited:

- BitGo wallet GET;
- BitGo balance read;
- BitGo credential use;
- Solana RPC;
- provider existence validation;
- network-based wallet-ID confirmation.

P6-T11 validation is structural/local only. Controlled provider TEST activation remains separately gated.

---

## 18. Privacy and Observability

Raw wallet IDs must not be emitted through:

- application logging;
- ordinary audit event bodies;
- metrics;
- public error responses;
- qualification output.

Qualification must verify redaction/non-emission. If operator feedback must identify a registry item, use non-sensitive logical binding identity or an appropriately safe representation rather than general raw-value logging.

---

## 19. Future Implementation Categories

The future implementation is expected to contain only the minimum necessary categories:

1. dedicated private registry database migration/schema objects;
2. least-privilege DB access boundaries;
3. server-only immutable registry loader;
4. controlled server-only operator provisioning command/tool;
5. focused DB/runtime qualification using synthetic wallet IDs.

P6-T08, P6-T09, and P6-T10 must remain unchanged.

No exact migration filename, table name, role name, function/procedure name, source filename, or test filename is authorized by this contract. Those exact implementation paths and SQL object names must be frozen in a separate implementation scope review after this contract becomes canonical.

---

## 20. Qualification Requirements

Future P6-T11 implementation qualification must use synthetic wallet IDs only.

Actual wallet IDs: `0`

Qualification must prove at minimum:

1. exact binding tuple provisioning;
2. malformed wallet ID fails closed;
3. duplicate active tuple fails closed;
4. inactive/revoked entry excluded;
5. environment isolation;
6. immutable complete snapshot loading;
7. consistent snapshot behavior;
8. registry failure prevents P6-T10 execution;
9. runtime reader least privilege;
10. provisioning writer least privilege;
11. browser/public registry access prohibited;
12. raw wallet-ID logging prohibited;
13. raw wallet-ID metrics prohibited;
14. raw wallet-ID general audit payload prohibited;
15. credential reads `0`;
16. provider calls `0`;
17. scheduler/polling `0`;
18. P6-T08/P6-T09/P6-T10 regression preserved;
19. full authority guard.

If DB-backed behavior is implemented, real local database qualification is required using synthetic wallet IDs only. Exact qualification IDs and count must be frozen before implementation.

---

## 21. MVP Operational Boundary

P6-T11 implementation is expected to remove the first remaining post-P6-T10 MVP blocker.

Successful implementation is expected to move the current operating-MVP estimate from approximately `60%` to approximately `68-70%`.

This percentage is an operational planning estimate, not a contract exit criterion.

Remaining blockers after P6-T11 are expected to include:

1. credential-reference provisioning;
2. authorized execution-context composition;
3. controlled BitGo TEST activation;
4. minimal operator/on-demand execution wiring.

---

## 22. Explicitly Out of Scope

P6-T11 does not authorize:

- actual wallet IDs;
- production wallet-ID registry population;
- credential provisioning;
- credential reads;
- provider calls;
- BitGo calls;
- Solana RPC;
- authorized provider execution;
- production execution;
- scheduler;
- polling;
- signing;
- withdrawals;
- payouts;
- fund movement;
- advanced admin UI.

---

## 23. Authority Boundary

Current authority:

- actual wallet-ID authority: `NONE`
- registry-entry provisioning authority: `NONE`
- credential authority: `NONE`
- provider authority: `NONE`
- production authority: `NONE`
- signing authority: `NONE`

This contract publication alone does not authorize implementation. Implementation requires a separate post-merge scope review and implementation authorization.

---

## 24. Invalidation Conditions

Future implementation authorization must be withheld or invalidated if:

- P6-T08/P6-T09/P6-T10 must be modified unexpectedly;
- provider validation becomes required;
- credentials become required;
- browser/public registry access becomes required;
- broad service-role access becomes required without new governance;
- runtime registry loading becomes live DB access inside P6-T08;
- scheduler/polling becomes required;
- actual wallet IDs are introduced before separate authority;
- implementation scope cannot preserve credential/provider separation.

---

## 25. Final Contract Principle

P6-T11 establishes:

`SAFE_PRIVATE_REGISTRY_PROVISIONING_BEFORE_REAL_PROVIDER_ACTIVATION`

The MVP runtime must receive only a complete, validated, immutable registry snapshot through a server-only least-privilege boundary.

Actual wallet IDs remain unprovisioned until a later explicit authorization.
