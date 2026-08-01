# NEW-P5-T03-01 Custody Balance Observer Contract

## 1. Status

This task creates an analysis and worker contract document only.

No provider network call, credential connection, worker implementation,
scheduler implementation, DB migration, API route, runtime harness, package
change, staging, commit, push, or PR was performed.

Final status:

```text
FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_CONTRACT_READY
```

Resolved by R1 and R2:

```text
WORKER_DB_AUTHORIZATION=DEDICATED_POSTGRES_LOGIN_ROLE
WORKER_DB_CONNECTION=DIRECT_POSTGRES
WORKER_ROLE_LOGICAL_NAME=custody_observer_worker
OBSERVATION_CHECKPOINT_ATOMICITY=SINGLE_DB_COMMAND
OBSERVER_CONCURRENCY_CONTROL=ADVISORY_XACT_LOCK_PLUS_CHECKPOINT_VERSION_CAS
OBSERVATION_IDENTITY_VERSION=V1
OBSERVATION_KEY_SOURCE=NATIVE_THEN_CHECKPOINT_THEN_CONTENT
OBSERVATION_IDENTITY_PRIORITY=NATIVE_THEN_CHECKPOINT_THEN_CONTENT
OBSERVATION_KEY_GENERATOR=SHARED_SERVER_HELPER
```

## 2. Worktree / Branch / HEAD

```text
Worktree: D:\Ai\staking-wallet-web
Previous branch: chore/next-work
Previous HEAD: f327ad817787a636ee50d5ddb9c8f11bdb4a3125
New branch: feat/p5-t03-custody-observer-runtime
New branch HEAD: f327ad817787a636ee50d5ddb9c8f11bdb4a3125
origin/main: f327ad817787a636ee50d5ddb9c8f11bdb4a3125
```

Start-state expectations were satisfied before branch creation:

- working tree clean
- staging empty
- local target branch absent
- remote target branch absent

## 3. Analysis Scope

Repository search covered custody provider, binding, external balance
observation, observer checkpoint, advisory lock, worker, scheduler, and
service-role boundary terms. `.git`, `node_modules`, and `.env*` were excluded
from output to avoid internal repository data and local secret material.

Files reviewed:

- `src/server/custody/provider-observation-contract.ts`
- `docs/08-custody/CUSTODY_OBSERVATION_ADAPTER_CONTRACT.md`
- `docs/08-custody/CUSTODY_PROVIDER_AND_ACCOUNT_BOUNDARY.md`
- `supabase/migrations/20260722000527_init_custody_boundary_domain.sql`
- `supabase/migrations/20260729090000_p5_t02_reconciliation_core.sql`
- `supabase/migrations/20260729102000_p5_t02_expected_asset_balance.sql`
- `supabase/migrations/20260729103000_p5_t02_record_balance_observation.sql`
- `supabase/migrations/20260729104000_p5_t02_observed_asset_balance.sql`
- `supabase/migrations/20260729105000_p5_t02_create_asset_reconciliation_run.sql`
- `supabase/tests/database/p5_t02_record_balance_observation.test.sql`
- `supabase/tests/database/p5_t02_observed_asset_balance.test.sql`
- `supabase/tests/database/p5_t02_create_asset_reconciliation_run.test.sql`
- `docs/09-governance/NEW_P5_T02_03B_R2_ASSET_AGGREGATE_PRODUCT_DECISION.md`
- `docs/09-governance/NEW_P5_T02_04_LOCAL_BALANCE_OBSERVATION_REPORT.md`
- `docs/09-governance/NEW_P5_T02_05_OBSERVED_ASSET_BALANCE_REPORT.md`
- `docs/09-governance/NEW_P5_T02_10_BRANCH_CLOSEOUT_AND_PR_READINESS_REPORT.md`
- `docs/09-governance/NEW_P5_T02_PRE_10A_PHASE2_BASELINE_FREEZE_REPORT.md`
- `src/types/database.types.ts`
- `package.json`
- `scripts/lib/local-http-harness.mjs`
- `scripts/lib/local-runtime-supervisor.mjs`

## 4. Existing Architecture Map

P5-T01 introduced custody configuration only:

- `private.custody_providers`
- `private.custody_account_bindings`
- `private.custody_config_audit_events`
- public ADMIN+AAL2 custody configuration command/read RPCs
- `/admin/custody` application surface

P5-T02 introduced reconciliation and observation persistence:

- `private.external_balance_observations`
- `private.external_transaction_observations`
- `private.observer_checkpoints`
- `private.reconciliation_runs`
- `private.reconciliation_items`
- `private.reconciliation_item_binding_observations`
- private expected and observed balance functions
- private asset reconciliation run writer
- public ADMIN+AAL2 reconciliation review functions
- public ADMIN+AAL2 admin read model functions
- admin read UI and review action UI

Current missing architecture:

- no real provider adapter implementation
- no balance observer worker
- no checkpoint writer function
- no scheduler or queue
- no implemented worker DB role or machine identity migration
- no concrete production secret-manager product selection
- no durable worker failure ledger

## 5. Custody Provider Model

Table:

```text
private.custody_providers
```

Primary key and identity:

- Primary key: `id uuid`
- Provider code: `provider_code text not null unique`
- `provider_code` is not the primary key.

Provider metadata:

- `display_name text`
- `provider_type text`
- capability booleans:
  - `supports_balance_observation`
  - `supports_transfer_observation`
  - `supports_transfer_lookup`
  - `supports_payout_submission`
  - `supports_webhook_ingestion`
- `status text`
- lifecycle timestamps
- `version bigint`
- `created_at`, `updated_at`

Allowed provider types:

```text
MPC_CUSTODIAN
QUALIFIED_CUSTODIAN
EXCHANGE_CUSTODY
INTERNAL_HSM
```

Allowed statuses:

```text
DRAFT
APPROVED
SUSPENDED
RETIRED
```

Worker-relevant status:

- Only `APPROVED` providers with `supports_balance_observation = true` are
  observable by the existing DB writer and observed-balance selector.

Secret and endpoint storage:

- No API key column.
- No secret column.
- No credential reference column.
- No endpoint or URL column.
- No external account ID column.
- No wallet address column.

Browser privilege:

- Direct table privileges are revoked from `public`, `anon`, and
  `authenticated`.
- Public custody read/write RPCs are granted to `authenticated` and re-check
  ACTIVE ADMIN plus AAL2 inside PostgreSQL.

Lifecycle behavior:

- Provider starts as `DRAFT`.
- Approval requires at least one capability.
- Provider terms and capabilities are frozen after first approval.
- `APPROVED -> RETIRED` is not direct; suspension is required first.

## 6. Custody Account Binding Model

Table:

```text
private.custody_account_bindings
```

Primary key and relationships:

- Primary key: `id uuid`
- Provider FK: `custody_provider_id -> private.custody_providers(id)`
- Asset FK: `asset_id -> public.supported_assets(id)`

Binding metadata:

- `binding_key text`
- `display_label text`
- `account_role text`
- `status text`
- lifecycle timestamps
- `version bigint`
- `created_at`, `updated_at`

Allowed account roles:

```text
COLLECTION
PAYOUT
TREASURY
FEE
```

Uniqueness:

- Unique `custody_provider_id, binding_key`.
- Unique non-retired `custody_provider_id, asset_id, account_role`.

Observation eligibility:

- Binding status must be `APPROVED`.
- Provider status must be `APPROVED`.
- Provider must support balance observation.
- Asset status must be `ACTIVE`.
- Account role must be one of `COLLECTION`, `PAYOUT`, `TREASURY`, `FEE`.

Safe worker reference:

- Worker can use `provider_code`, `binding_key`, `asset_code`, and
  `account_role` as non-secret references.
- Worker must not treat `binding_key` as a provider account ID, wallet address,
  external address, or credential.

Forbidden binding storage:

- No raw provider account identifier.
- No wallet address.
- No blockchain address.
- No transaction identifier.
- No credential.
- No endpoint.

## 7. Existing Provider Adapter Contract

File:

```text
src/server/custody/provider-observation-contract.ts
```

The contract is server-only and type-only. It defines:

- `CustodyProviderRef`
- `CustodyAccountBindingRef`
- `CustodyProviderHealth`
- `CustodyBalanceObservation`
- `CustodyTransferObservation`
- `CustodyObservationPage`
- `CustodyObservationAdapter`
- `CustodyObservationAdapterFactory`

`readBalances()` contract:

```text
readBalances(bindings: readonly CustodyAccountBindingRef[])
  -> Promise<readonly CustodyBalanceObservation[]>
```

`CustodyBalanceObservation` currently contains:

- `provider`
- `binding`
- `observedAvailableUnits`
- `observedTotalUnits`
- `observedAt`
- `finalizedAt`

Current gaps:

- provider-native observation ID: not present
- deterministic observation key: not present
- checkpoint reference: not present
- block height: not present
- ledger sequence: not present
- snapshot version: not present
- per-binding error: not present
- provider error classification: not present
- request correlation: not present
- partial success result model: not present
- retry-after metadata: not present
- rate-limit metadata: not present

## 8. Existing Balance Observation DB Contract

Table:

```text
private.external_balance_observations
```

Columns:

- `id uuid`
- `custody_account_binding_id uuid`
- `asset_id uuid`
- `observer_kind text`
- `observation_key text`
- `observed_units numeric`
- `checkpoint_reference text null`
- `observed_at timestamptz`
- `created_at timestamptz`

Amount:

- Exact non-negative integer Atomic Units.
- Zero is allowed.
- Fractional values are rejected.
- Negative values are rejected.
- NaN and infinity are rejected.
- Values must be below `10^38`.

Idempotency identity:

```text
custody_account_binding_id + observer_kind + observation_key
```

Unique constraint:

```text
external_balance_observations_binding_observer_key_uidx
```

Direct browser access:

- Table privileges are revoked from `public`, `anon`, and `authenticated`.

## 9. Existing Checkpoint Contract

Table:

```text
private.observer_checkpoints
```

Columns:

- `id uuid`
- `custody_account_binding_id uuid`
- `observer_kind text`
- `checkpoint_value text`
- `checkpoint_observed_at timestamptz`
- `version bigint`
- `created_at timestamptz`
- `updated_at timestamptz`

Unique constraint:

```text
custody_account_binding_id + observer_kind
```

Shape:

- Current-state table, not append-only.
- One checkpoint row per binding and observer kind.
- `version >= 1` supports future optimistic concurrency.

Current writer:

```text
CHECKPOINT_WRITER=NOT_IMPLEMENTED
```

Current gaps:

- no checkpoint insert/update function
- no compare-and-swap writer
- no checkpoint advance validation
- no stale checkpoint rejection
- no atomic observation insert plus checkpoint advance
- no durable link from checkpoint row to the inserted observation row

## 10. Balance Value Semantics

Decision:

```text
BALANCE_VALUE_SEMANTICS=TOTAL
```

Reasoning:

- P5-T02 selected asset aggregate reconciliation.
- Expected balance is the asset-level OPEN `SYSTEM_CUSTODY` internal ledger
  balance.
- `SYSTEM_CUSTODY` is the asset-side total custody exposure for an asset.
- Observed balance is the sum of latest safe balance observations from every
  eligible binding for that asset.
- `observedAvailableUnits` may exclude provider-side locked, reserved, pending,
  or otherwise unavailable custody assets and could create false mismatches
  against the total custody ledger balance.

Worker v1 must map:

```text
CustodyBalanceObservation.observedTotalUnits
-> private.record_external_balance_observation.p_observed_atomic_units
```

Observation identity inclusion:

```text
AVAILABLE_UNITS_IN_OBSERVATION_IDENTITY=EXCLUDED
TOTAL_UNITS_IN_OBSERVATION_IDENTITY=INCLUDED_FOR_CONTENT_MODE_ONLY
```

Rules:

- `observedAvailableUnits` is not persisted as the reconciliation observation
  amount.
- `observedAvailableUnits` does not participate in observation identity.
- Available-balance-only changes must not create new reconciliation
  observations.
- NATIVE and CHECKPOINT mode digests exclude amount values.
- When the same native or checkpoint identity is reused with a different total
  amount, observed time, checkpoint reference, binding, asset, provider, or
  observer kind, the DB must detect an idempotency conflict for the same
  observation key.

If a provider cannot supply a reliable total balance for an eligible binding,
the worker must not silently fall back to available balance. It should classify
that binding as a failed or missing observation according to the future failure
model.

## 11. Amount Normalization Ownership

Decision:

```text
AMOUNT_NORMALIZATION_OWNER=ADAPTER
```

Rationale:

- Provider-specific adapters know provider amount fields, asset decimal
  conventions, and malformed response shapes.
- The worker should receive already-normalized Atomic Unit strings.
- The worker should still validate string shape and pass exact numeric text to
  PostgreSQL.

Rules:

- Do not convert amounts through JavaScript `Number`.
- Do not use `parseInt` or `parseFloat` for balance amounts.
- Do not round, clamp, or infer decimal precision in the generic worker.
- Reject decimal, fractional, negative, NaN, infinity, empty, or over-precision
  values before calling the DB writer.
- Preserve large integer precision beyond JavaScript safe integer range.

## 12. Observation Key Contract

Decision:

```text
OBSERVATION_IDENTITY_VERSION=V1
OBSERVATION_DIGEST_ALGORITHM=SHA256
OBSERVATION_DIGEST_ENCODING=LOWERCASE_HEX
OBSERVATION_KEY_SOURCE=NATIVE_THEN_CHECKPOINT_THEN_CONTENT
OBSERVATION_IDENTITY_PRIORITY=NATIVE_THEN_CHECKPOINT_THEN_CONTENT
OBSERVATION_KEY_GENERATOR=SHARED_SERVER_HELPER
OBSERVATION_KEY_GENERATOR_OWNER=WORKER_BOUNDARY
ADAPTER_RETURNS_IDENTITY_MATERIAL_ONLY=true
CONTENT_DIGEST_FALLBACK=MOCK_AND_LOCAL_ONLY
PRODUCTION_PROVIDER_REQUIRES_NATIVE_OR_CHECKPOINT_IDENTITY=true
PRODUCTION_CONTENT_DIGEST_FALLBACK=DISALLOWED
```

Observation key format:

```text
balobs:v1:<mode>:<64-lowercase-hex>
```

Allowed modes:

```text
balobs:v1:n:<sha256>
balobs:v1:k:<sha256>
balobs:v1:c:<sha256>
```

Mode meaning:

- `n`: provider-native stable observation identity.
- `k`: provider-native checkpoint, block height, ledger sequence, snapshot
  sequence, or provider-defined stable checkpoint.
- `c`: canonical content fallback.

The observation key stores only the mode and SHA-256 digest. It must not store
raw provider ID, checkpoint, balance, binding information, URL, address,
signature, credential, or provider payload directly.

Identity priority:

```text
NATIVE
CHECKPOINT
CONTENT
```

Rules:

- Use NATIVE when a stable provider-native snapshot identity exists.
- Use CHECKPOINT when no native ID exists but a stable block, ledger, snapshot,
  or provider checkpoint identity exists.
- Use CONTENT only when neither NATIVE nor CHECKPOINT exists.
- The same adapter response replay must not switch identity mode.
- The same provider integration must not arbitrarily mix modes.
- Identity mode switching is treated as an adapter contract version change.

Production and mock boundary:

```text
CONTENT_DIGEST_FALLBACK=MOCK_AND_LOCAL_ONLY
PRODUCTION_CONTENT_DIGEST_FALLBACK=DISALLOWED
```

- Mock and local deterministic adapters may use CONTENT mode.
- Production provider adapters must provide NATIVE or CHECKPOINT identity.
- A production provider that cannot provide stable native/checkpoint identity is
  blocked from onboarding.
- Poll timestamp, worker execution timestamp, and random UUID are not production
  observation identities.

Canonical serialization:

- Digest input is an exact ordered array, not a JSON object.
- The array is serialized with `JSON.stringify(canonicalArray)`.
- UTF-8 bytes of that JSON string are hashed.
- Optional fields must not change array length; each mode has a fixed schema.
- `null` and empty string are not interchangeable.
- Raw object property ordering is never part of the contract.
- Digest is `SHA-256(UTF8(JSON.stringify(canonicalArray)))`.
- Output is 64-character lowercase hexadecimal.
- Base64, Base64URL, and uppercase hex are not used.

Native mode canonical array:

```json
[
  "BALANCE_OBSERVATION",
  "v1",
  "native",
  "providerCode",
  "bindingId",
  "assetId",
  "observerKind",
  "nativeObservationId"
]
```

Field semantics:

- `providerCode`: canonical provider code read from DB.
- `bindingId`: `private.custody_account_bindings.id`.
- `assetId`: `public.supported_assets.id`.
- `observerKind`: canonical observer kind used by the worker.
- `nativeObservationId`: stable provider-native snapshot identity returned by
  the adapter.

Native mode rules:

- Provider or caller input cannot define `bindingId` or `assetId`.
- Worker injects DB identity after resolving safe binding mapping.
- Native identity is trimmed and Unicode NFC normalized.
- Empty, control-character, credential-like, URL-like, address-like, or
  signature-like native identity is rejected.
- Raw native identity is never logged or reported directly.
- The same native identity with different total units, observed time,
  checkpoint reference, binding, asset, provider, or observer kind must produce
  the same key and then fail as a DB idempotency conflict.

Checkpoint mode canonical array:

```json
[
  "BALANCE_OBSERVATION",
  "v1",
  "checkpoint",
  "providerCode",
  "bindingId",
  "assetId",
  "observerKind",
  "checkpointReference"
]
```

Checkpoint reference candidates:

- block height
- ledger sequence
- snapshot sequence
- provider-defined stable checkpoint

Checkpoint mode rules:

- Trim and Unicode NFC normalize the checkpoint reference.
- Empty, control-character, credential-like, URL-like, wallet-address-like, or
  transaction-signature-like checkpoint references are rejected.
- Raw checkpoint value is never embedded directly in `observation_key`.
- The checkpoint reference must be stable and suitable for DB checkpoint
  progression.
- The same checkpoint reference with a different amount or observed time must
  produce the same key and then fail as a DB idempotency conflict.

Content mode canonical array:

```json
[
  "BALANCE_OBSERVATION",
  "v1",
  "content",
  "providerCode",
  "bindingId",
  "assetId",
  "observerKind",
  "observedTotalUnits",
  "observedAtUtcMicroseconds"
]
```

CONTENT mode excludes:

- `observedAvailableUnits`
- worker execution time
- retry attempt
- random UUID
- process ID
- hostname
- credential
- endpoint URL
- raw provider response
- non-deterministic metadata

CONTENT mode treats the same total amount at the same observed time as the same
observation. The same total balance observed at a different observed time is a
different observation.

String normalization:

- `providerCode`: DB canonical value only; no worker case conversion.
- `bindingId` and `assetId`: canonical lowercase hyphenated UUID strings; no
  braces or uppercase UUIDs.
- `observerKind`: uppercase canonical catalog value matching the existing DB
  safe pattern; no worker version, host name, or process ID.
- native/checkpoint identity: trim, Unicode NFC, no control characters, no
  empty values, no credential/URL/address/signature shape.
- `observedTotalUnits`: integer string without decimal point, leading zero,
  sign, fraction, or scientific notation; zero is `"0"`; JavaScript `Number`
  conversion is prohibited.

Timestamp canonicalization:

```text
OBSERVATION_TIMESTAMP_CANONICAL_FORMAT=UTC_MICROSECONDS
OBSERVATION_TIMESTAMP_CANONICAL_SHAPE=YYYY-MM-DDTHH:mm:ss.ffffffZ
```

Rules:

- Only ISO-8601 timestamps with explicit timezone are accepted.
- Timezone offsets are normalized to UTC `Z`.
- Fractional seconds with 0..6 digits are right-padded to six digits.
- Precision greater than six digits is rejected, not rounded or truncated.
- Local timestamps without timezone are rejected.
- Invalid calendar timestamps are rejected.
- Leap seconds are rejected as non-standard for the implementation contract.
- JavaScript `Date` roundtrip must not be used when it would lose microseconds.
- Worker execution time must not replace provider observed time.

Example normalization:

```text
2026-08-01T01:02:03Z -> 2026-08-01T01:02:03.000000Z
2026-08-01T10:02:03.123+09:00 -> 2026-08-01T01:02:03.123000Z
```

Shared helper contract:

```text
createBalanceObservationKeyV1(...)
```

The final file name and export name are deferred to implementation so they can
match repository conventions.

Helper responsibilities:

- choose identity mode
- validate canonical fields
- normalize strings, timestamps, and amounts
- create canonical ordered array
- serialize with UTF-8 JSON
- produce SHA-256 lowercase hex digest
- assemble `balobs:v1:<mode>:<digest>`

Helper prohibitions:

- credential input
- raw provider response input
- browser import
- unstable object serialization
- JavaScript `Number` amount handling
- timestamp precision loss
- random value use
- logging raw identity or digest input

Adapter identity extension direction:

```ts
type BalanceObservationIdentity =
  | { kind: "NATIVE"; value: string }
  | { kind: "CHECKPOINT"; value: string }
  | { kind: "CONTENT" };
```

Rules:

- Production adapters must not return CONTENT-only identity.
- Mock/local adapters may return deterministic CONTENT identity.
- NATIVE and CHECKPOINT values must not be credentials.
- Raw identity values are not written to general logs or reports.
- Identity exists per binding result.
- Adapter batch results must keep identities independent by binding.

Current implementation state:

```text
ADAPTER_IDENTITY_FIELD=PLANNED_NOT_IMPLEMENTED
```

Replay contract:

- Exact replay with the same observation key and identical payload returns the
  existing observation id, `created=false`, observation row increase 0, and
  checkpoint version increase 0.
- Conflicting replay with the same key and different total units, observed
  time, checkpoint reference, binding, provider, asset, or observer kind fails
  with observation idempotency conflict.
- Conflicting replay changes observation rows 0 and checkpoint rows 0.
- The worker must not auto-generate a replacement key to bypass conflict.
- New NATIVE snapshot ID, CHECKPOINT reference, or CONTENT amount/time pair
  produces a new key.

Security boundary:

- API keys, API secrets, passwords, bearer tokens, access tokens, refresh
  tokens, database credentials, service-role keys, cookies, sessions, private
  keys, mnemonics, seed phrases, wallet addresses, transaction signatures,
  endpoint URLs, raw provider payloads, customer/user/profile identity, worker
  hostname, and process IDs are prohibited from digest inputs.
- SHA-256 is not used as a mechanism to safely store secrets.
- Hashing a secret-like value into an observation key is still prohibited.

## 13. Observer Kind Catalog

Existing state:

```text
OBSERVER_KIND_CATALOG=NOT_DEFINED
```

Observed repository usage:

- DB constraints allow `^[A-Z0-9][A-Z0-9_]{1,63}$`.
- Tests and runtime fixtures use values such as `BALANCE_OBSERVER` and
  `BALANCE_OBSERVER_ALT`.
- No centralized enum or catalog exists.

Recommended v1 value:

```text
BALANCE_OBSERVER
```

Policy:

- `observer_kind` should identify the logical observer pipeline and version
  when needed.
- It should not include provider code, binding key, credential names, endpoint
  names, or runtime environment secrets.
- Provider and binding identity already exist in provider/binding references and
  the DB idempotency tuple.

## 14. Per-binding Result And Partial Failure Model

Existing adapter model:

```text
BALANCE_ADAPTER_RESULT_MODEL=ARRAY_OF_SUCCESSES_ONLY
```

Current gap:

- The adapter cannot represent a per-binding timeout, unsupported asset,
  malformed provider amount, missing binding result, duplicate binding result,
  extra binding result, or provider-classified error.

Recommended model:

```text
BALANCE_ADAPTER_RESULT_MODEL=PER_BINDING_SUCCESS_ERROR_UNION
```

Reasoning:

- Batch calls are useful for provider throughput, but worker persistence must
  remain per binding.
- One failed binding must not convert another binding's successful observation
  into a failure.
- Reconciliation already models incomplete membership and does not treat missing
  observations as zero.

Future adapter result shape must distinguish:

- per-binding success
- per-binding failure
- provider-wide outage
- duplicate or missing provider result
- malformed amount
- unsupported asset
- timeout
- retryable versus non-retryable failure

Classification:

```text
per-binding failure result=CAN_BE_DECIDED_DURING_MOCK_ADAPTER
```

## 15. Worker Execution Unit

Recommended execution unit:

```text
OBSERVER_WORK_UNIT=PROVIDER_ASSET
OBSERVER_ATOMIC_COMMIT_UNIT=BINDING_OBSERVATION
```

Reasoning:

- Provider-level batching can reduce network calls.
- Asset scoping matches the current reconciliation comparison scope.
- Binding-level persistence preserves isolation and idempotency.
- Checkpoints are stored by binding and observer kind, so the worker must update
  or evaluate binding checkpoint state even when the external call is batched.

Non-selected units:

- Whole-system worker: too broad for isolation and retry.
- Binding-only worker: safe but may be inefficient for providers with batch
  balance APIs.
- Provider-only worker: insufficient asset isolation and noisier retries.

Partial batch contract:

- The adapter may read balances in a provider plus asset batch.
- Each successful binding is persisted through its own atomic DB command call.
- One binding failure must not roll back another binding's successful
  observation/checkpoint commit.
- A failed binding leaves its checkpoint unchanged.
- Only successful bindings advance observation/checkpoint state.
- A whole-batch database transaction is prohibited.

## 16. Trusted Worker DB Authorization

Decision:

```text
WORKER_DB_AUTHORIZATION=DEDICATED_POSTGRES_LOGIN_ROLE
WORKER_DB_CONNECTION=DIRECT_POSTGRES
WORKER_ROLE_LOGICAL_NAME=custody_observer_worker
SERVICE_ROLE_WORKER_RUNTIME=DISALLOWED
USER_SESSION_WORKER_RUNTIME=DISALLOWED
ADMIN_AAL2_WORKER_RUNTIME=DISALLOWED
BROWSER_WORKER_RUNTIME=DISALLOWED
```

Evidence:

- `private.record_external_balance_observation(...)` is `SECURITY INVOKER`.
- Execute is revoked from `public`, `anon`, and `authenticated`.
- Observation and checkpoint tables are in `private`.
- The generated public TypeScript database contract does not expose the private
  writer.
- Existing application patterns intentionally avoid production service-role
  clients.
- Existing user-scoped ADMIN+AAL2 patterns are browser-session based and are
  not suitable for unattended workers.

Rejected worker runtime identities:

- Browser session.
- User-scoped ADMIN+AAL2 session.
- Client-supplied actor, role, or AAL.
- Production service-role application runtime.

Direct PostgreSQL contract:

- The observer worker uses a direct PostgreSQL connection.
- The worker must not call PostgREST or browser Supabase RPC paths.
- The connection credential is dedicated to the unattended worker.
- It is not connected to a personal user session or administrator session.
- `auth.uid()` is not used as worker identity.
- A service-role key is not used as the PostgreSQL worker credential.
- The database login role itself is the worker identity.

Minimum grants for the worker login role:

- target database `CONNECT`
- required `private` schema `USAGE`
- `EXECUTE` on exactly one atomic balance observation/checkpoint command
- permission to use the transaction-scoped advisory lock inside that command

Forbidden grants for the worker login role:

- direct private table `SELECT`
- direct private table `INSERT`
- direct private table `UPDATE`
- direct private table `DELETE`
- broad public or auth schema access
- broad existing private function `EXECUTE`
- reconciliation write command execution
- ledger write command execution
- review write command execution
- payout or wallet signing capability
- schema or object ownership
- migration execution
- role creation or privilege delegation

Ownership:

- The worker login role must not own the `SECURITY DEFINER` command.
- The function owner remains a migration/admin-owned role.
- The worker login role receives `EXECUTE` only.
- `public`, `anon`, and `authenticated` receive no execute grant.

Auditability recommendation:

- Set safe DB session context such as `application_name`.
- Include a public-safe worker execution identifier when available.
- Include public-safe provider code when useful.
- Do not include secrets, binding keys, account identifiers, raw provider
  identifiers, or credentials in `application_name` or logs.

R1 resolves the worker DB identity decision. The concrete migration that
creates and grants the role is deferred to the DB implementation step.

## 17. Credential Injection Boundary

Decision:

```text
PROVIDER_CREDENTIAL_SOURCE=UNRESOLVED
LOCAL_WORKER_CREDENTIAL_SOURCE=EPHEMERAL_TEST_SECRET
PRODUCTION_WORKER_CREDENTIAL_SOURCE=PLATFORM_SECRET_MANAGER
DATABASE_CREDENTIAL_IN_SOURCE=DISALLOWED
DATABASE_CREDENTIAL_IN_DATABASE_TABLE=DISALLOWED
DATABASE_CREDENTIAL_IN_GOVERNANCE_REPORT=DISALLOWED
DATABASE_CREDENTIAL_IN_REPOSITORY_ENV_FILE=DISALLOWED
DATABASE_CREDENTIAL_IN_LOG=DISALLOWED
```

Repository evidence:

- Provider table stores no credentials.
- Binding table stores no external account identifiers.
- There is no secret-manager abstraction.
- There is no provider SDK initialization path.
- `.env.local` is ignored and must not be read into reports or logs.

Contract:

- browser credential exposure: 0
- database raw credential storage: 0
- source code credential storage: 0
- governance report credential storage: 0
- provider raw payload storage: 0
- credential in observation key/checkpoint/error: 0
- credential logging/output: 0

Local worker credential contract:

- Local runtime may use an ephemeral test credential created or injected at
  execution time.
- The test credential and role must be cleaned up after the test run.
- The credential value must not be committed, staged, printed, or copied into a
  report.

Production worker credential contract:

- Production credentials come from the deployment platform's secret manager.
- The specific secret-manager product is not selected in this document.
- `.env.local` is not a production worker credential store.
- Rotation and expiration policy are deferred to the production provider phase.

Mock adapter impact:

- P5-T03 mock adapter can proceed with credential count 0.

Production provider impact:

```text
production secret-manager product=BLOCKING_BEFORE_PRODUCTION_PROVIDER
```

## 18. Observation / Checkpoint Atomicity

Decision:

```text
OBSERVATION_CHECKPOINT_ATOMICITY=SINGLE_DB_COMMAND
```

Meaning:

- The durable observation insert and checkpoint advance should happen in one DB
  function and one database transaction.
- The function should verify exact observation replay before advancing a
  checkpoint.
- The function should use checkpoint version compare-and-swap or equivalent
  stale-worker protection.

Canonical command name:

```text
private.record_balance_observation_and_advance_checkpoint(...)
```

This name is the recommended canonical name. The final SQL signature is deferred
to the DB implementation step so it can match the final schema and test
contract.

The worker must not compose lower-level primitives directly. The existing
primitive remains usable inside the atomic command:

```text
private.record_external_balance_observation(...)
```

Required same-transaction sequence:

1. Normalize and validate input.
2. Verify binding, provider, and asset observability.
3. Acquire a transaction-scoped advisory lock for binding plus observer kind.
4. Read and row-lock the current checkpoint when present.
5. Verify `expectedCheckpointVersion`.
6. Append the balance observation or verify exact replay.
7. Create or advance the checkpoint.
8. Commit observation and checkpoint together.

Why not separate operations:

- A crash between observation insert and checkpoint update can duplicate work.
- A checkpoint update before durable evidence can skip a snapshot.
- Separate operations make partial batch retry semantics harder to prove.

Current support:

- Existing observation writer inserts only observations.
- Existing checkpoint table supports future current-state rows and `version`.
- No checkpoint writer exists.

Required future DB change:

```text
CHECKPOINT_ATOMICITY_REQUIRES_NEW_DB_FUNCTION=true
```

Security contract for the new command:

- private schema
- `SECURITY DEFINER`
- `set search_path = ''`
- all object names schema-qualified
- execute revoked from `public`, `anon`, and `authenticated`
- execute granted only to the dedicated worker role
- caller cannot override asset or provider identity
- asset and provider are derived from the binding
- raw provider payload input is prohibited
- credential input is prohibited
- URL, address, and signature input is prohibited
- only safe bounded observation and checkpoint values are allowed

The `SECURITY DEFINER` function expands the worker role only inside the command
and only for balance observation and checkpoint mutation.

Public-safe domain error candidates for the future DB implementation:

- `observer_binding_not_found`
- `observer_binding_not_observable`
- `observer_checkpoint_version_conflict`
- `observer_checkpoint_regression`
- `observer_checkpoint_value_invalid`
- `observation_idempotency_conflict`
- `observation_amount_invalid`
- `observation_timestamp_invalid`
- `observer_command_unavailable`

Existing implemented errors such as `binding_not_found`,
`binding_not_observable`, `observation_idempotency_conflict`,
`observation_amount_invalid`, `observation_timestamp_invalid`,
`observation_key_invalid`, and `observation_checkpoint_invalid` remain
descriptive of the current primitive only. The new command may map or preserve
them, but must not expose raw PostgreSQL error text, constraint names, SQL,
stack traces, credentials, or provider payloads to worker logs.

## 19. Checkpoint Advancement Rules

Input concepts required by the future command:

- `expectedCheckpointVersion`
- `nextCheckpointValue`
- `nextCheckpointObservedAt`

Initial checkpoint:

- A missing checkpoint uses an explicit initial-state contract.
- Successful initial creation stores `version = 1`.

Existing checkpoint:

- Stored `version` must match `expectedCheckpointVersion`.
- Successful advancement increments version by one.
- Stale version is a conflict.
- Automatic retry is prohibited at the DB command layer.

Rules:

- Checkpoints are per `custody_account_binding_id + observer_kind`.
- Only a successfully persisted observation may advance a binding checkpoint.
- Exact observation replay may return `created=false`.
- If the existing observation payload is identical and the checkpoint is already
  equal or ahead, checkpoint version increase is 0.
- Replay must not re-advance the checkpoint without new durable evidence.
- If provider checkpoint ordering is opaque, rely on expected checkpoint version
  and observed-time regression checks rather than lexical comparison.
- Failed binding observations must not advance that binding checkpoint.
- Partial batch success advances only successful binding checkpoints.
- Out-of-order observations must not move checkpoints backward.
- Stale workers must fail closed on version mismatch.
- `checkpoint_reference` in `external_balance_observations` is optional
  evidence context, while `observer_checkpoints.checkpoint_value` is the
  current cursor state.

Current blocker:

```text
CHECKPOINT_WRITER=NOT_IMPLEMENTED
```

Forbidden checkpoint behavior:

- unconditional upsert
- last-write-wins
- stale worker overwrite
- checkpoint version decrease
- checkpoint timestamp regression
- empty checkpoint value
- credential-like checkpoint value

Failure rollback rules:

- observation validation failure changes observation rows 0 and checkpoint rows
  0
- observation idempotency conflict changes observation rows 0 and checkpoint
  rows 0
- checkpoint CAS failure rolls back any attempted observation insert
- out-of-order checkpoint failure must not leave an observation-only partial
  commit

## 20. Concurrency And Lease

Existing patterns:

- Several financial/admin command functions use transaction advisory locks.
- The existing reconciliation run writer intentionally relies on idempotency and
  constraints rather than a broad advisory lock.
- No observer lease table or job claim table exists.

Decision:

```text
OBSERVER_CONCURRENCY_CONTROL=ADVISORY_XACT_LOCK_PLUS_CHECKPOINT_VERSION_CAS
```

Contract:

- Use a transaction-scoped PostgreSQL advisory lock per binding and observer
  kind.
- Do not rely on a single-process production assumption.
- Do not rely on scheduler uniqueness as the final safety boundary.
- Treat manual and scheduled runs as potentially concurrent.
- Let idempotency protect duplicate observation rows.
- Let checkpoint versioning protect stale advancement.

Advisory lock scope:

```text
custody_account_binding_id + observer_kind
```

Requirements:

- Use transaction-scoped locks only.
- Do not use session-scoped locks.
- Lock keys must be deterministic.
- Do not use provider credentials, binding key strings, raw identifiers, or
  secret-like values as lock key text.
- Derive safe numeric lock keys from UUID and observer kind.
- Locks release automatically at transaction end.
- Advisory lock alone is not stale-worker protection.
- Always pair advisory lock with checkpoint version CAS.

R1 resolves the concurrency-control decision. Implementation and pgTAP proof
remain deferred.

## 21. Timeout / Retry / Rate Limit

Current state:

- Existing local runtime harnesses use bounded timeouts, safe output checks, and
  cleanup barriers.
- There is no provider timeout, retry, or rate-limit contract.

Recommended default contract for P5-T03 implementation:

- connection timeout: defined per provider adapter
- request timeout: defined per provider adapter
- total attempt deadline: defined by worker
- retryable errors: network uncertainty, 429, 5xx, transient timeout
- non-retryable errors: malformed success response, invalid amount, unsupported
  asset, contract violation, credential misconfiguration
- backoff: exponential with jitter
- provider `Retry-After`: respected when safe and bounded
- shutdown: `AbortSignal` propagated to adapter
- per-provider concurrency cap: explicit configuration, not implicit global
  process behavior

Classification:

```text
timeout/retry defaults=CAN_BE_DECIDED_DURING_RUNTIME_IMPLEMENTATION
```

## 22. Failure Recording And Observability

Current state:

```text
OBSERVER_FAILURE_LEDGER=NOT_DEFINED
```

Evidence:

- `private.external_balance_observations` stores successful numeric balance
  observations only.
- Reconciliation `OBSERVATION_FAILED` means the reconciliation membership was
  incomplete or failed; it is not a durable worker operational failure ledger.
- No observer run table, failure event table, metrics table, or alert table
  exists.

Forbidden failure storage:

- Do not store a failure as `observed_units = 0`.
- Do not store raw provider errors.
- Do not store stack traces in DB reason fields.
- Do not store URLs, credentials, payloads, addresses, signatures, or secrets.
- Do not make failed observations look like successful evidence.

Recommended future model:

- Structured safe worker logs for local mock runtime.
- A later private observer run/failure table if durable operational
  observability is required.
- Reconciliation should continue to distinguish missing evidence from a zero
  balance.

Classification:

```text
failure ledger=CAN_BE_DECIDED_DURING_RUNTIME_IMPLEMENTATION
```

## 23. Scheduler Boundary

Current state:

```text
SCHEDULER_IMPLEMENTATION=DEFERRED
```

Repository state:

- No cron/platform scheduler exists.
- No queue exists.
- No Next route trigger exists for observer execution.
- No CLI worker exists.
- Existing runtime scripts are local verification harnesses, not production
  worker schedulers.

Contract:

- Worker implementation must be callable independently from scheduler
  implementation.
- Scheduler overlap must not be the final concurrency boundary.
- Scheduler must not carry provider credentials into logs or governance
  reports.

## 24. Mock Provider Runtime Contract

P5-T03 should introduce a deterministic mock adapter before any real provider.

Mock requirements:

- real provider network calls: 0
- credentials: 0
- deterministic fixtures
- success result
- zero balance
- very large Atomic Unit balance
- partial failure
- timeout
- 429
- 5xx
- malformed amount
- duplicate observation
- idempotent replay
- checkpoint progression
- stale checkpoint
- concurrent worker attempt
- graceful shutdown

The mock adapter and future production adapters must use the same public
server-only interface. Provider SDK work remains out of P5-T03-01.

## 25. Side-effect Boundary

Allowed atomic observer command side effects after future implementation:

- append to `private.external_balance_observations`
- update `private.observer_checkpoints`

Forbidden observer side effects:

- `private.ledger_accounts`
- `private.ledger_journals`
- `private.ledger_entries`
- `private.reconciliation_runs`
- `private.reconciliation_items`
- `private.reconciliation_item_binding_observations`
- `private.reconciliation_review_cases`
- `private.reconciliation_review_case_events`
- `private.external_transaction_observations`
- custody provider or binding configuration
- supported asset configuration
- payout or withdrawal state
- deposit state
- staking state

The observer must not auto-create reconciliation runs, post ledger journals, or
perform wallet signing.

A future private observer run, lease, or failure table would require a separate
approved migration. It is not part of the atomic command side-effect set.

## 26. Security Boundary

The balance observer contract preserves:

- server-only adapter code
- no browser Supabase private table access
- no raw provider payload storage
- no provider credentials in DB rows
- no service-role production runtime without a separate approved boundary
- no private keys
- no mnemonic or seed phrase
- no client signing
- no wallet address or provider account identifier persistence
- no provider endpoint in observation keys, checkpoints, errors, reports, or
  logs
- no raw DB error exposure
- no `auth.uid()` spoofing by the worker
- no ADMIN+AAL2 user session reuse as machine identity

## 27. Explicit Deferred Scope

Deferred:

- real provider adapter
- real API credential
- remote provider network call
- transfer observer
- transaction lookup
- payout submission
- webhook ingestion
- scheduler
- alert notification
- auto reconciliation trigger
- ledger correction
- financial remediation
- wallet signing
- withdrawal processing
- deposit processing
- provider onboarding UI
- admin credential UI
- multi-region worker
- production secret-manager deployment

## 28. Gaps And Required Decisions

| Area | Current state | Decision or recommendation | Classification |
| --- | --- | --- | --- |
| Balance value semantics | Adapter exposes available and total; DB stores one value | `BALANCE_VALUE_SEMANTICS=TOTAL` | decided |
| Observation key source | No adapter field/helper implemented | `NATIVE_THEN_CHECKPOINT_THEN_CONTENT`, `balobs:v1:<mode>:<digest>` | resolved decision; implementation deferred |
| Observation key generator | Not implemented | `OBSERVATION_KEY_GENERATOR=SHARED_SERVER_HELPER` | resolved decision; implementation deferred |
| Production content fallback | Not previously defined | `PRODUCTION_CONTENT_DIGEST_FALLBACK=DISALLOWED` | resolved decision |
| Timestamp canonicalization | Not previously defined | `UTC_MICROSECONDS`, `YYYY-MM-DDTHH:mm:ss.ffffffZ` | resolved decision; implementation deferred |
| Adapter identity field | Not implemented | NATIVE/CHECKPOINT/CONTENT union planned | `CAN_BE_IMPLEMENTED_DURING_MOCK_ADAPTER` |
| Observer kind catalog | Regex only; tests use `BALANCE_OBSERVER` | `OBSERVER_KIND_CATALOG=NOT_DEFINED`; use `BALANCE_OBSERVER` for v1 until catalog migration | `CAN_BE_DECIDED_DURING_MOCK_ADAPTER` |
| Per-binding result | Success array only | `PER_BINDING_SUCCESS_ERROR_UNION` | `CAN_BE_DECIDED_DURING_MOCK_ADAPTER` |
| Checkpoint writer | Table only | `CHECKPOINT_WRITER=NOT_IMPLEMENTED`; canonical command required | DB implementation deferred after digest decision |
| Observation/checkpoint atomicity | Not implemented | `OBSERVATION_CHECKPOINT_ATOMICITY=SINGLE_DB_COMMAND` | resolved decision; implementation deferred |
| Worker DB authorization | No role implemented | `DEDICATED_POSTGRES_LOGIN_ROLE` over `DIRECT_POSTGRES` | resolved decision; implementation deferred |
| Provider credential source | Production secret-manager product not selected | platform secret manager for production; ephemeral test secret for local | `BLOCKING_BEFORE_PRODUCTION_PROVIDER` |
| Concurrency/lease | No observer lease | `ADVISORY_XACT_LOCK_PLUS_CHECKPOINT_VERSION_CAS` | resolved decision; implementation deferred |
| Failure ledger | Not defined | structured safe logs first, later private table if needed | `CAN_BE_DECIDED_DURING_RUNTIME_IMPLEMENTATION` |
| Timeout/retry defaults | Not defined | bounded retry/backoff contract required | `CAN_BE_DECIDED_DURING_RUNTIME_IMPLEMENTATION` |
| Scheduler topology | Not defined | worker callable separately, scheduler deferred | `NOT_REQUIRED` for P5-T03-01 |

Remaining non-blocking gaps:

- observer kind v1 constant: `CAN_BE_DECIDED_DURING_MOCK_ADAPTER`
- per-binding success/error union implementation:
  `CAN_BE_DECIDED_DURING_MOCK_ADAPTER`
- production secret-manager product: `BLOCKING_BEFORE_PRODUCTION_PROVIDER`
- durable observer failure ledger:
  `CAN_BE_DECIDED_DURING_RUNTIME_IMPLEMENTATION`
- timeout/retry numeric defaults:
  `CAN_BE_DECIDED_DURING_RUNTIME_IMPLEMENTATION`
- scheduler topology: `SCHEDULER_IMPLEMENTATION=DEFERRED`

## 29. Recommended Implementation Sequence

Recommended sequence:

1. P5-T03-02: Mock Custody Balance Adapter and Canonical Normalization
2. P5-T03-03: Balance Observation DB Command and Checkpoint Atomicity
4. P5-T03-04: Custody balance observer worker
5. P5-T03-05: Concurrency, retry, and failure runtime
6. P5-T03-06: Scheduler integration
7. P5-T03-07: Branch closeout and PR readiness

P5-T03-02 baseline scope:

- provider network 0
- credential 0
- deterministic mock adapter
- adapter identity union
- shared observation key helper
- TOTAL balance semantics
- atomic-unit string normalization
- UTC microsecond timestamp normalization
- per-binding success/error result model
- observer kind v1 decision
- code/runtime validation
- no DB migration
- no worker DB command implementation

## 30. Changed Files

Allowed changed file:

```text
docs/09-governance/NEW_P5_T03_01_CUSTODY_BALANCE_OBSERVER_CONTRACT.md
```

Expected non-changes:

```text
src/** diff: 0
supabase/** diff: 0
scripts/** diff: 0
package.json diff: 0
package-lock.json diff: 0
src/types/database.types.ts diff: 0
```

## 31. Secret Scan

Secret scan scope:

- this new governance report
- working tree diff

Expected result:

```text
SECRET_SCAN_ACTUAL_VALUES=0
```

This report contains no actual JWT, access token, refresh token,
cookie/session value, Supabase key, service-role key, database URL, password,
provider API key, provider secret, wallet address, private key, mnemonic, seed
phrase, real email address, provider endpoint credential, or `.env.local`
content.

Security terms appear only as policy boundaries and denylist descriptions.

## 32. Final Status

P5-T03 worker DB authorization, direct PostgreSQL execution, checkpoint
atomicity, concurrency control, balance semantics, amount ownership, and
canonical observation identity are now decided at the contract level.

```text
BALANCE_VALUE_SEMANTICS=TOTAL
AMOUNT_NORMALIZATION_OWNER=ADAPTER
AVAILABLE_UNITS_IN_OBSERVATION_IDENTITY=EXCLUDED
TOTAL_UNITS_IN_OBSERVATION_IDENTITY=INCLUDED_FOR_CONTENT_MODE_ONLY
OBSERVATION_IDENTITY_VERSION=V1
OBSERVATION_DIGEST_ALGORITHM=SHA256
OBSERVATION_DIGEST_ENCODING=LOWERCASE_HEX
OBSERVATION_KEY_SOURCE=NATIVE_THEN_CHECKPOINT_THEN_CONTENT
OBSERVATION_IDENTITY_PRIORITY=NATIVE_THEN_CHECKPOINT_THEN_CONTENT
OBSERVATION_KEY_FORMAT=balobs:v1:<mode>:<64-lowercase-hex>
OBSERVATION_KEY_GENERATOR=SHARED_SERVER_HELPER
OBSERVATION_KEY_GENERATOR_OWNER=WORKER_BOUNDARY
ADAPTER_RETURNS_IDENTITY_MATERIAL_ONLY=true
CONTENT_DIGEST_FALLBACK=MOCK_AND_LOCAL_ONLY
PRODUCTION_PROVIDER_REQUIRES_NATIVE_OR_CHECKPOINT_IDENTITY=true
PRODUCTION_CONTENT_DIGEST_FALLBACK=DISALLOWED
OBSERVATION_TIMESTAMP_CANONICAL_FORMAT=UTC_MICROSECONDS
OBSERVATION_TIMESTAMP_CANONICAL_SHAPE=YYYY-MM-DDTHH:mm:ss.ffffffZ
ADAPTER_IDENTITY_FIELD=PLANNED_NOT_IMPLEMENTED
OBSERVER_KIND_CATALOG=NOT_DEFINED
BALANCE_ADAPTER_RESULT_MODEL=PER_BINDING_SUCCESS_ERROR_UNION
OBSERVER_WORK_UNIT=PROVIDER_ASSET
OBSERVER_ATOMIC_COMMIT_UNIT=BINDING_OBSERVATION
WORKER_DB_AUTHORIZATION=DEDICATED_POSTGRES_LOGIN_ROLE
WORKER_DB_CONNECTION=DIRECT_POSTGRES
WORKER_ROLE_LOGICAL_NAME=custody_observer_worker
SERVICE_ROLE_WORKER_RUNTIME=DISALLOWED
USER_SESSION_WORKER_RUNTIME=DISALLOWED
ADMIN_AAL2_WORKER_RUNTIME=DISALLOWED
BROWSER_WORKER_RUNTIME=DISALLOWED
LOCAL_WORKER_CREDENTIAL_SOURCE=EPHEMERAL_TEST_SECRET
PRODUCTION_WORKER_CREDENTIAL_SOURCE=PLATFORM_SECRET_MANAGER
PROVIDER_CREDENTIAL_SOURCE=UNRESOLVED
OBSERVATION_CHECKPOINT_ATOMICITY=SINGLE_DB_COMMAND
CHECKPOINT_WRITER=NOT_IMPLEMENTED
OBSERVER_CONCURRENCY_CONTROL=ADVISORY_XACT_LOCK_PLUS_CHECKPOINT_VERSION_CAS
OBSERVER_FAILURE_LEDGER=NOT_DEFINED
SCHEDULER_IMPLEMENTATION=DEFERRED
FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_CONTRACT_READY
```
