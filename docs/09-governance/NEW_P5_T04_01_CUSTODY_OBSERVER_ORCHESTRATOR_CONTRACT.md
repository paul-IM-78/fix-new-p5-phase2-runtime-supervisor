# NEW-P5-T04-01 Custody Observer Orchestrator Contract

## Status

Status: PASS

Final status: PASS_CUSTODY_BALANCE_OBSERVER_ORCHESTRATOR_CONTRACT_READY

This document is the P5-T04 contract baseline for custody balance observer
scope discovery and one-shot orchestration. It records analysis and decisions
only.

No implementation source, DB migration, pgTAP test, runtime harness, package
file, staging, commit, push, PR, provider network call, Supabase start, server
start, or `.env*` content read was performed for this task.

## Worktree / Branch / HEAD

Main worktree:

- Worktree: `D:\Ai\staking-wallet-web-phase2-supervisor`
- Branch: `main`
- HEAD: `e931dd173e0ab5005a386bf91c8e1276a74bcec4`
- Status before branch creation: clean

Development worktree:

- Worktree: `D:\Ai\staking-wallet-web`
- Start branch: `chore/next-work`
- Created branch: `feat/p5-t04-custody-observer-orchestrator`
- HEAD: `e931dd173e0ab5005a386bf91c8e1276a74bcec4`
- Base: `origin/main`
- Status before this document: clean

Target branch preflight:

- Local branch existed before task: false
- Remote branch existed before task: false
- Existing PR for branch before task: false

## P5-T03 Baseline

P5-T03 is the accepted baseline for the orchestrator input and persistence
boundary:

- Provider-neutral custody observation contract exists under server-only code.
- Mock balance observation adapter exists and remains local-only.
- Balance observation key v1 exists with modes `n`, `k`, and `c`.
- Observer kind is `BALANCE_OBSERVER_V1`.
- Production identity policy allows `NATIVE` and `CHECKPOINT`.
- Production identity policy rejects `CONTENT`.
- Local mock identity policy allows `NATIVE`, `CHECKPOINT`, and `CONTENT`.
- Atomic observation/checkpoint command exists.
- Worker role is `custody_observer_worker`.
- Worker DB access is direct PostgreSQL, not Supabase service-role.
- Worker can execute exactly the atomic command and has no direct table,
  column, sequence, unrelated function, schema create, database create, owner,
  membership, or grant-option privilege.
- Worker runtime accepts caller-supplied pre-resolved provider-plus-asset work
  units.
- Worker executes binding observations sequentially inside a work unit.
- Worker reports safe per-binding outcomes and summary counters.
- Worker sets `requiresScopeRefresh=true` only for
  `CHECKPOINT_VERSION_CONFLICT`.
- Worker does not perform internal scope discovery or scope refresh.

Latest accepted P5-T03 validation evidence in governance reports:

- Adapter runtime: 74 cases PASS.
- Worker runtime: 62 cases PASS.
- Resilience runtime: 62 cases PASS.
- DB reset/lint/pgTAP/types: PASS.
- pgTAP: 30 files / 1387 tests / failure 0 / skip 0.
- Lint: PASS, warning 0.
- Build: PASS.
- Production/full audit: 0 vulnerabilities.
- Provider network calls: 0.
- Credential environment reads: 0.

## Repository Evidence Reviewed

Application/server files reviewed:

- `src/server/custody/provider-observation-contract.ts`
- `src/server/custody/balance-observation-normalization.ts`
- `src/server/custody/balance-observer-command-client.ts`
- `src/server/custody/balance-observer-retry.ts`
- `src/server/custody/balance-observer-worker.ts`
- `src/server/custody/mock-balance-observation-adapter.ts`

Database migrations reviewed:

- `supabase/migrations/20260722000527_init_custody_boundary_domain.sql`
- `supabase/migrations/20260729090000_p5_t02_reconciliation_core.sql`
- `supabase/migrations/20260801120000_p5_t03_observer_review_remediation.sql`
- `supabase/migrations/20260801153000_p5_t03_final_review_remediation.sql`
- `supabase/migrations/20260802003000_p5_t03_acl_edge_remediation.sql`

Governance reports reviewed:

- `docs/09-governance/NEW_P5_T03_01_CUSTODY_BALANCE_OBSERVER_CONTRACT.md`
- `docs/09-governance/NEW_P5_T03_02_MOCK_CUSTODY_BALANCE_ADAPTER_REPORT.md`
- `docs/09-governance/NEW_P5_T03_03_ATOMIC_BALANCE_OBSERVER_COMMAND_REPORT.md`
- `docs/09-governance/NEW_P5_T03_04_CUSTODY_BALANCE_OBSERVER_WORKER_REPORT.md`
- `docs/09-governance/NEW_P5_T03_05_CUSTODY_BALANCE_OBSERVER_RESILIENCE_REPORT.md`
- `docs/09-governance/NEW_P5_T03_06_BRANCH_CLOSEOUT_AND_PR_READINESS_REPORT.md`
- `docs/09-governance/NEW_P5_T03_07_PR_REVIEW_REMEDIATION_REPORT.md`
- `docs/09-governance/NEW_P5_T03_08_FINAL_PR_REVIEW_REMEDIATION_REPORT.md`
- `docs/09-governance/NEW_P5_T03_09_ACL_EDGE_REMEDIATION_REPORT.md`

## Current Implemented Boundary

The implemented worker boundary is intentionally narrow:

- `runCustodyBalanceObserverWorkUnit()` accepts one `CustodyBalanceObserverWorkUnit`.
- The work unit contains one provider, one asset id, an identity policy, and a
  non-empty binding list.
- Each binding item contains `bindingId`, `assetId`, `binding`, and
  `expectedCheckpointVersion`.
- The worker validates canonical UUIDs and provider/asset consistency.
- The adapter is injected by the caller.
- The command client is injected by the caller.
- The worker calls `adapter.readBalances()` once for the current work unit, then
  processes binding results sequentially.
- The worker records each successful observation through the atomic DB command.
- The worker does not query private tables.
- The worker does not open service-role, user-session, ADMIN, browser, or
  PostgREST paths.
- The worker does not create its own adapter factory or production provider
  credential source.

Safe output boundary:

- Success exposes binding id, creation flags, checkpoint flags, checkpoint
  version, adapter attempts, and DB attempts.
- Failure exposes binding id, stage, safe code, retry flags, attempt counters,
  retry-after value, and scope refresh flag.
- Failure does not expose observation key, raw identity, amount, raw checkpoint
  value, binding key, provider payload, SQL, SQLSTATE, host, port, database,
  user, credential, raw error, or stack.

## Current Missing Orchestration Boundary

The following boundary remains missing and becomes the P5-T04 target:

- DB scope discovery read model.
- Dedicated scope reader PostgreSQL login role.
- Scope reader command client.
- Provider-plus-asset pagination.
- One-shot orchestrator that turns scope pages into worker work units.
- Targeted scope refresh after worker checkpoint conflicts.
- Adapter factory ownership and lifetime.
- Provider-level concurrency governance.
- Abort and cleanup ownership across reader client, writer client, and adapters.
- Runtime governance report and harness.

Still deferred after P5-T04:

- Scheduler, cron, durable queue, or background daemon.
- Durable failure ledger.
- Production provider adapters.
- Production provider network calls.
- Automatic reconciliation trigger.

## Contract Decision Summary

```text
ORCHESTRATOR_EXECUTION_MODE=ONE_SHOT_EXPLICIT_INVOCATION
ORCHESTRATOR_RUNTIME=SERVER_ONLY_NODE
ORCHESTRATOR_WORK_UNIT=PROVIDER_ASSET
ORCHESTRATOR_ATOMIC_COMMIT_UNIT=BINDING_OBSERVATION
ORCHESTRATOR_WHOLE_RUN_TRANSACTION=PROHIBITED

SCOPE_DISCOVERY_AUTHORIZATION=SEPARATE_DEDICATED_POSTGRES_LOGIN_ROLE
SCOPE_READER_ROLE_LOGICAL_NAME=custody_observer_scope_reader
SCOPE_READER_DB_CONNECTION=DIRECT_POSTGRES
SCOPE_READER_ACCESS=EXECUTE_ONLY_SECURITY_DEFINER_READ_COMMANDS
SCOPE_READER_DATABASE_PRIVILEGE=CONNECT_ONLY
SCOPE_READER_PRIVATE_SCHEMA_PRIVILEGE=USAGE_ONLY

WRITE_ROLE_LOGICAL_NAME=custody_observer_worker
WRITE_ROLE_ACCESS=ATOMIC_OBSERVATION_COMMAND_ONLY
WRITE_ROLE_SCOPE_LIST_EXECUTE=PROHIBITED
WRITE_ROLE_SCOPE_REFRESH_EXECUTE=PROHIBITED

ORCHESTRATOR_DB_CREDENTIAL_MODEL=SEPARATE_READ_AND_WRITE_CREDENTIALS
SERVICE_ROLE_ORCHESTRATOR_RUNTIME=DISALLOWED
USER_SESSION_ORCHESTRATOR_RUNTIME=DISALLOWED
ADMIN_AAL2_ORCHESTRATOR_RUNTIME=DISALLOWED
BROWSER_ORCHESTRATOR_RUNTIME=DISALLOWED

SCOPE_LIST_COMMAND=private.list_balance_observer_scope_page
SCOPE_REFRESH_COMMAND=private.read_balance_observer_scope

SCOPE_PAGINATION=DETERMINISTIC_KEYSET
SCOPE_PAGINATION_KEY=PROVIDER_ID_ASSET_ID
SCOPE_PAGINATION_UNIT=PROVIDER_ASSET_SCOPE
SCOPE_ROW_UNIT=BINDING
SCOPE_SPLIT_ACROSS_PAGES=PROHIBITED
SCOPE_OFFSET_PAGINATION=PROHIBITED

OBSERVER_KIND=BALANCE_OBSERVER_V1
MISSING_CHECKPOINT_EXPECTED_VERSION=0

SCOPE_REFRESH_POLICY=ONE_TARGETED_REFRESH
SCOPE_REFRESH_TRIGGER=REQUIRES_SCOPE_REFRESH
SCOPE_REFRESH_RERUN=ONLY_AFFECTED_BINDINGS
MAX_SCOPE_REFRESH_ATTEMPTS=1

ORCHESTRATOR_CONCURRENCY=BOUNDED_ACROSS_PROVIDERS
SAME_PROVIDER_ASSET_EXECUTION=SEQUENTIAL
DEFAULT_PROVIDER_CONCURRENCY=1
MAX_PROVIDER_CONCURRENCY=4

ADAPTER_FACTORY=INJECTED_SERVER_ONLY
ADAPTER_INSTANCE_LIFETIME=ONE_INSTANCE_PER_PROVIDER_PER_RUN
IDENTITY_POLICY_SOURCE=TRUSTED_ORCHESTRATOR_CONFIGURATION

SCOPE_READ_RETRY=EXPLICIT_BOUNDED_V1_DEFAULT_DISABLED
DURABLE_FAILURE_LEDGER=DEFERRED
SCHEDULER_QUEUE_CRON=DEFERRED
PRODUCTION_PROVIDER_ADAPTERS=DEFERRED
PRODUCTION_PROVIDER_NETWORK=DISALLOWED
AUTOMATIC_RECONCILIATION_TRIGGER=DEFERRED
```

## One-shot Execution Mode

The orchestrator is not a scheduler. It is a server-only Node function invoked
explicitly by a trusted runtime entry point. A single invocation drains eligible
scope pages until there are no more pages, an abort is observed, or a fatal
scope-level error occurs.

Allowed in P5-T04:

- local runtime harness invocation
- explicit server-only function call
- injected adapter factory
- injected scope reader client
- injected worker command client

Disallowed in P5-T04:

- browser invocation
- same-origin API route invocation
- ADMIN session invocation
- service-role Supabase invocation
- automatic cron, queue, or daemon execution

## Provider+Asset Work Unit

The orchestrator groups bindings by provider and asset. This matches the
current worker input contract and prevents a work unit from mixing assets or
provider configuration.

Provider-plus-asset grouping contract:

- Work unit key: `providerId + assetId`.
- Worker provider ref comes from the scope reader command output.
- Worker asset id comes from the scope reader command output.
- Worker binding list contains only rows with the same provider and asset.
- A provider-plus-asset group is never split across pages.
- Same provider-plus-asset execution remains sequential.
- The binding observation is the atomic commit unit.

## Separate Read/Write DB Authorization

The orchestrator must use separate DB credentials:

| Purpose | Logical role | Connection | Allowed access |
| --- | --- | --- | --- |
| Scope discovery | `custody_observer_scope_reader` | Direct PostgreSQL | Execute approved read commands only |
| Observation write | `custody_observer_worker` | Direct PostgreSQL | Execute atomic observation command only |

This separation keeps the P5-T03 write role closed. The writer must not gain
scope SELECT privileges. The reader must not execute the atomic write command
and must not gain direct table/column/sequence privileges.

Write-role scope read prohibition:

- `custody_observer_worker` access to `private.list_balance_observer_scope_page`
  is prohibited and must not be granted directly, through role membership, or
  through PUBLIC.
- `custody_observer_worker` access to `private.read_balance_observer_scope` is
  prohibited and must not be granted directly, through role membership, or
  through PUBLIC.
- `custody_observer_worker` executes only the atomic observation/checkpoint
  write command.
- Scope reader and write worker function EXECUTE grants must not cross.
- Read and write credentials and pools must remain separately configured.

## Scope Reader Role

The future DB migration should create `custody_observer_scope_reader` as a
dedicated login role with these constraints:

The scope reader is allowed CONNECT on the target database and USAGE on the
private schema only.
CONNECT privilege is granted to `custody_observer_scope_reader` only on the
target database. USAGE privilege on the private schema is granted only to
`custody_observer_scope_reader`.

Allowed privileges:

```text
GRANT CONNECT ON DATABASE <target_database>
TO custody_observer_scope_reader

GRANT USAGE ON SCHEMA private
TO custody_observer_scope_reader
```

- login allowed
- no inherit
- no superuser
- no createdb
- no createrole
- no replication
- no bypassrls
- no ownership of app objects
- no membership except unavoidable owner/bootstrap relationships
- connect to current database only
- usage on `private` only as required to execute functions
- no grant option on database CONNECT or private schema USAGE
- no direct TEMP grant
- no schema create
- no table SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
- no column SELECT/INSERT/UPDATE/REFERENCES
- no sequence USAGE/SELECT/UPDATE
- execute only `private.list_balance_observer_scope_page` and
  `private.read_balance_observer_scope`
- no execute on unrelated private or public functions
- no grant options

The migration must add an assertion function equivalent in strictness to
`private.assert_custody_observer_worker_role_contract()`, but scoped to the
reader role and read commands.

## Scope List Command

Canonical name:

```text
private.list_balance_observer_scope_page
```

Function class:

- `STABLE`
- `SECURITY DEFINER`
- `set search_path = ''`
- direct table reads only inside the function body
- safe, normalized return columns only
- no dynamic SQL
- no mutation
- no advisory locks
- no service-role dependency

Suggested arguments:

```text
p_observer_kind text
p_after_provider_id uuid default null
p_after_asset_id uuid default null
p_limit integer default 20
```

Rules:

- `p_observer_kind` must equal `BALANCE_OBSERVER_V1`.
- `p_limit` must be bounded and positive.
- Cursor input is a provider id plus asset id pair.
- Cursor pair must be null together or non-null together.
- Result ordering is ascending by provider id, then asset id.
- A page returns complete provider-plus-asset groups.
- A page limit counts provider-plus-asset groups, not binding rows.
- Empty result is valid.

## Exact Scope Refresh Command

Canonical name:

```text
private.read_balance_observer_scope
```

Function class:

- `STABLE`
- `SECURITY DEFINER`
- `set search_path = ''`
- direct table reads only inside the function body
- safe, normalized return columns only
- no dynamic SQL
- no mutation
- no advisory locks
- no service-role dependency

Suggested arguments:

```text
p_observer_kind text
p_provider_id uuid
p_asset_id uuid
p_binding_ids uuid[] default null
```

Rules:

- `p_observer_kind` must equal `BALANCE_OBSERVER_V1`.
- Provider and asset ids must be canonical UUID values.
- Optional binding ids constrain refresh to affected bindings.
- Returned rows must still satisfy full eligibility rules.
- Missing or no-longer-eligible rows are returned as absent, not as raw DB
  errors.
- The orchestrator converts absent affected bindings into a safe
  `SCOPE_NO_LONGER_ELIGIBLE` result.

## Eligibility Rules

An eligible balance observer scope row must satisfy all of the following:

- Provider status is `APPROVED`.
- Provider `supports_balance_observation` is true.
- Binding status is `APPROVED`.
- Binding account role is one of `COLLECTION`, `PAYOUT`, `TREASURY`, `FEE`.
- Asset status is active/approved according to the current supported asset
  domain contract.
- Binding asset id matches the provider-plus-asset group.
- Observer kind is `BALANCE_OBSERVER_V1`.
- Provider and binding metadata remains non-secret configuration only.

Ineligible rows must not be returned to the orchestrator. The atomic writer
still remains the final validation boundary and can return
`BINDING_NOT_OBSERVABLE` if eligibility changes between read and write.

## Scope Row Shape

The scope reader should return one row per eligible binding. All returned values
must be safe to pass to the server-only worker and safe to include in local test
diagnostics by key name only.

Required group fields:

- `provider_id uuid`
- `provider_code text`
- `provider_type text`
- `provider_capabilities text[]`
- `asset_id uuid`
- `asset_code text`
- `asset_symbol text`
- `asset_decimals integer`
- `asset_network text`

Required binding fields:

- `binding_id uuid`
- `binding_key text`
- `binding_account_role text`
- `expected_checkpoint_version text`
- `checkpoint_exists boolean`
- `checkpoint_observed_at timestamptz null`

Forbidden scope output fields:

- checkpoint value
- observation key
- raw provider payload
- provider endpoint
- provider credential name or value
- wallet address
- private key
- mnemonic
- seed phrase
- token
- cookie or session
- DB URL
- raw SQL error
- SQLSTATE

## Capability Mapping

Provider capabilities map from custody provider boolean flags:

| DB flag | Adapter capability |
| --- | --- |
| `supports_balance_observation` | `BALANCE_OBSERVATION` |
| `supports_transfer_observation` | `TRANSFER_OBSERVATION` |
| `supports_transfer_lookup` | `TRANSFER_LOOKUP` |
| `supports_payout_submission` | `PAYOUT_SUBMISSION` |
| `supports_webhook_ingestion` | `WEBHOOK_INGESTION` |

The scope reader must include `BALANCE_OBSERVATION` for every returned provider.
Other capabilities may be included to keep `CustodyProviderRef` faithful, but
they must not cause the balance orchestrator to perform transfer, payout, or
webhook work.

## Checkpoint Version Mapping

The current checkpoint table has one current-state row per
`custody_account_binding_id + observer_kind`.

Mapping:

- Existing checkpoint: `expectedCheckpointVersion = checkpoint.version::text`.
- Missing checkpoint: `expectedCheckpointVersion = "0"`.
- Checkpoint value is never returned by scope reads.
- Checkpoint observed timestamp may be returned for diagnostics and ordering,
  but must not be used as a credential or provider cursor by the orchestrator.

The worker uses the adapter result identity and observation details to generate
the next observation key/checkpoint value. For `CHECKPOINT` identity, the raw
adapter checkpoint identity is normalized and hashed into a
`balobs:v1:k:<64-lowercase-hex>` observation key; the raw identity must not be
used directly as the DB checkpoint value.

## Provider+Asset Pagination

Pagination is deterministic keyset pagination.

Primary key:

```text
PROVIDER_ID_ASSET_ID
```

Ordering:

```text
provider_id asc, asset_id asc, binding_id asc
```

Cursor:

```json
{
  "providerId": "uuid",
  "assetId": "uuid"
}
```

Cursor rules:

- Cursor values are server-only internal values.
- Cursor must not contain provider code, binding key, checkpoint value, or raw
  provider identifiers.
- Invalid cursor input maps to a safe validation error.
- Page size limits provider-plus-asset groups.
- Binding rows for a group are sorted by binding id.
- A provider-plus-asset group must never be split across pages.
- OFFSET pagination is prohibited.
- Scope discovery uses only deterministic `(provider_id, asset_id)` keyset
  pagination. OFFSET/LIMIT pagination is prohibited because concurrent
  configuration changes can produce duplicate or skipped provider-plus-asset
  scope groups.

## Cross-page Consistency

The orchestrator does not require a long transaction across all pages. Each page
is a current snapshot. If configuration changes between pages, the atomic writer
and targeted refresh policy provide the safety boundary.

Consistency rules:

- A whole-run database transaction is prohibited.
- One-shot execution must not wrap all pages or scopes in one database
  transaction.
- Long-lived snapshot transactions are prohibited.
- Scope list/read commands are statement-level reads.
- Binding observation writes remain scoped to the existing atomic DB command.
- Scope read connections must not be held idle in transaction.
- Already successful binding results must not be rolled back by whole-run
  failure handling.
- Page reads are idempotent and mutation-free.
- A group skipped due to cursor progression is not revisited in the same run.
- A binding that becomes ineligible after read may fail safely at write time.
- A checkpoint version conflict does not cause blind retry with stale scope.
- A refresh rerun targets only affected bindings.

## Scope Refresh Policy

Refresh trigger:

```text
REQUIRES_SCOPE_REFRESH=true
```

Refresh policy:

- Run one targeted refresh for the affected provider-plus-asset group.
- Include only binding ids that returned `requiresScopeRefresh=true`.
- Maximum refresh attempts per binding per orchestrator invocation: 1.
- If refresh returns the affected binding as eligible, rerun only that binding
  with the refreshed `expectedCheckpointVersion`.
- If refresh returns no eligible row for the affected binding, record a safe
  `SCOPE_NO_LONGER_ELIGIBLE` outcome for that binding.
- If the refreshed rerun conflicts again, stop and report the safe conflict.
- Do not escalate to whole-page or whole-run replay.

This keeps checkpoint conflicts as an orchestration scope problem rather than a
worker auto-retry problem.

## Adapter Factory Lifecycle

The adapter factory is injected by the trusted server-only orchestrator caller.

Contract:

- Factory type follows `CustodyObservationAdapterFactory`.
- Factory is never imported by browser/client code.
- Factory is not selected from environment variables or `NODE_ENV`.
- Production adapter selection remains deferred.
- P5-T04 may use the existing local mock adapter for runtime harnesses only.
- One adapter instance is created per provider per orchestrator run.
- Adapter instances are reused across all asset groups for the same provider in
  that run when the implementation keeps provider concurrency at 1.
- Adapter state must not contain raw credentials in logs or result payloads.

## Provider Concurrency

Concurrency model:

- Default provider concurrency: 1.
- Maximum provider concurrency: 4.
- Same provider-plus-asset execution: sequential.
- Same provider execution should be sequential by default until a production
  adapter proves safe parallelism.
- Cross-provider execution may be bounded when explicitly configured.

The initial implementation should default to sequential provider execution. Any
increase above 1 must be explicit and bounded by the trusted server-only caller.

## Same-provider Sequencing

Within one provider:

- Process provider-plus-asset groups in scope-page order.
- Process one provider-plus-asset group at a time.
- Let the worker process bindings sequentially as already implemented.
- Do not invoke two work units for the same provider-plus-asset concurrently.
- Do not invoke two refresh reruns for the same binding concurrently.

This preserves the P5-T03 checkpoint CAS and advisory-lock assumptions while the
system remains one-shot and local-runtime focused.

## Abort Semantics

Abort contract:

- The orchestrator accepts an optional `AbortSignal`.
- The signal is passed to scope reads where the future client supports it.
- The same signal is passed to `runCustodyBalanceObserverWorkUnit()`.
- Abort before the first page returns a safe whole-run aborted result.
- Abort during scope read returns a safe scope-stage aborted result.
- Abort during adapter or DB retry uses the existing worker abort outcomes.
- Abort after a work unit finishes stops before the next scope group.
- Cleanup always closes both reader and writer clients.

Abort output must not include raw error, stack, DB host, credential, SQL, or
provider payload.

## Retry Semantics

Retry policy:

- Scope read retry: `EXPLICIT_BOUNDED_V1_DEFAULT_DISABLED`.
- Worker retry: reuse P5-T03 retry policy.
- Retry randomness: production-safe runtime only, not provider identity seeded.
- Retry-After: only when the stage explicitly supports it.
- Blind retry on checkpoint version conflict: disallowed.

Retryable stages:

- Scope DB connection/unavailable/timeout/lock timeout may be retried when
  bounded retry is explicitly enabled.
- Worker adapter transient failures may be retried by the worker.
- Worker transient DB failures may be retried by the worker.
- Non-retryable validation, policy, eligibility, and contract failures must not
  be retried without a targeted scope refresh.

## Error Catalog

| Code | Stage | Retryable | Failure scope | Refresh possible | Safe exposure |
| --- | --- | --- | --- | --- | --- |
| `SCOPE_CURSOR_INVALID` | Scope validation | false | Whole run | false | true |
| `SCOPE_LIMIT_INVALID` | Scope validation | false | Whole run | false | true |
| `SCOPE_OBSERVER_KIND_INVALID` | Scope validation | false | Whole run | false | true |
| `SCOPE_PROVIDER_ASSET_CURSOR_INVALID` | Scope validation | false | Whole run | false | true |
| `SCOPE_DB_CONNECTION_FAILED` | Scope read | true | Whole run or refresh group | true | true |
| `SCOPE_DB_TIMEOUT` | Scope read | true | Whole run or refresh group | true | true |
| `SCOPE_DB_LOCK_TIMEOUT` | Scope read | true | Whole run or refresh group | true | true |
| `SCOPE_DB_UNAVAILABLE` | Scope read | true | Whole run or refresh group | true | true |
| `SCOPE_COMMAND_REJECTED` | Scope read | false | Whole run or refresh group | false | true |
| `SCOPE_RESULT_COUNT_INVALID` | Scope result | false | Whole run | false | true |
| `SCOPE_RESULT_SHAPE_INVALID` | Scope result | false | Whole run | false | true |
| `SCOPE_RESULT_ORDER_INVALID` | Scope result | false | Whole run | false | true |
| `SCOPE_DUPLICATE_GROUP` | Scope result | false | Whole run | false | true |
| `SCOPE_DUPLICATE_BINDING` | Scope result | false | Whole run | false | true |
| `SCOPE_PROVIDER_REF_INVALID` | Scope result | false | Provider group | false | true |
| `SCOPE_BINDING_REF_INVALID` | Scope result | false | Binding | true | true |
| `SCOPE_CHECKPOINT_VERSION_INVALID` | Scope result | false | Binding | true | true |
| `SCOPE_NO_LONGER_ELIGIBLE` | Scope refresh | false | Binding | false | true |
| `SCOPE_REFRESH_FAILED` | Scope refresh | false | Binding group | false | true |
| `ADAPTER_FACTORY_FAILED` | Adapter factory | false | Provider | false | true |
| `WORKER_RESULT_INVALID` | Worker result | false | Provider asset | false | true |
| `ORCHESTRATOR_ABORTED` | Abort | false | Whole run, provider asset, or binding | false | true |
| `ORCHESTRATOR_INPUT_INVALID` | Validation | false | Whole run | false | true |

Existing worker error codes remain owned by the worker and must pass through
without adding private details.

## Failure Isolation

Isolation rules:

- Scope-list fatal validation/protocol errors stop the run.
- Provider adapter factory failure isolates to that provider.
- Worker binding failure isolates to the binding.
- Worker provider-plus-asset result-shape failure isolates to that group.
- Checkpoint version conflict isolates to affected bindings and triggers one
  targeted refresh.
- Scope refresh failure isolates to the affected provider-plus-asset group.
- Durable cross-run accounting remains deferred.

## Safe Result and Logging Model

The orchestrator result should include:

- invocation status
- processed provider count
- processed provider-plus-asset group count
- processed binding count
- worker summary totals
- scope refresh attempts
- skipped/no-longer-eligible binding count
- safe error codes

The orchestrator result must not include:

- provider endpoint
- provider credential
- raw provider payload
- binding key in public/log output
- checkpoint value
- observation key
- observed amount unless explicitly needed in a server-only diagnostic and never
  logged by default
- SQL
- SQLSTATE
- DB host, port, database, user, password
- token, cookie, JWT, Supabase key, service-role key
- private key, mnemonic, seed phrase
- raw Error object or stack

Logging should use counters, safe codes, provider id count, group count, and
binding count. Internal ids may be retained in in-memory server-only structures
but should not be emitted by default logs.

## Client Lifecycle and Cleanup

The orchestrator owns the lifecycle of injected or constructed clients.

Cleanup contract:

- Scope reader client closes exactly once.
- Worker command client closes exactly once.
- Adapter cleanup hook, if introduced later, closes exactly once.
- Cleanup runs on success, failure, and abort.
- Cleanup must not print credential values.
- Runtime harness must verify no temporary process, socket, timer, fixture,
  role, or ACL residue.

## Credential and Secret Boundary

Hard rules:

- Service-role orchestrator runtime is disallowed.
- User session orchestrator runtime is disallowed.
- ADMIN+AAL2 orchestrator runtime is disallowed.
- Browser orchestrator runtime is disallowed.
- Direct PostgreSQL credentials are dedicated by role and purpose.
- Read and write credentials are separate.
- Credentials are provided only by trusted server runtime configuration.
- Credentials are never derived from provider code, binding key, asset code,
  `NODE_ENV`, or untrusted request input.
- `.env.local` contents must not be read, printed, copied, staged, or committed.
- Production provider credentials and network calls remain deferred.

## Deferred Scope

Deferred beyond P5-T04:

- scheduler
- cron
- durable queue
- durable failure ledger
- production provider adapter implementation
- production provider network access
- production provider credential loading
- automatic reconciliation trigger
- admin UI/API trigger
- mutation of provider or binding configuration
- ledger or financial side effects

## Implementation Roadmap

Recommended next tasks:

1. P5-T04-02 DB scope reader migration and pgTAP.
2. P5-T04-03 scope reader command client and validation.
3. P5-T04-04 one-shot orchestrator implementation using injected clients and
   adapter factory.
4. P5-T04-05 runtime harness for pagination, refresh, retry, abort, cleanup,
   and secret boundaries.
5. P5-T04-06 branch closeout and PR readiness report.

Minimum future implementation files:

- New migration for `custody_observer_scope_reader`,
  `private.list_balance_observer_scope_page`,
  `private.read_balance_observer_scope`, and reader ACL assertion.
- New pgTAP file for scope eligibility, pagination, grouping, refresh, grants,
  and no-mutation guarantees.
- New generated type update after DB migration.
- New server-only scope reader command client.
- New server-only one-shot orchestrator module.
- New local runtime harness.
- New governance reports.

## Changed Files

This task intentionally creates one governance document only:

- `docs/09-governance/NEW_P5_T04_01_CUSTODY_OBSERVER_ORCHESTRATOR_CONTRACT.md`

No source, migration, generated type, package, runtime harness, staging, commit,
push, PR, worktree creation, worktree deletion, or worktree prune is included.

## Git Status

Expected final development worktree status for this task:

```text
?? docs/09-governance/NEW_P5_T04_01_CUSTODY_OBSERVER_ORCHESTRATOR_CONTRACT.md
```

Expected staging:

```text
empty
```

## Commit / Push / PR Status

- Staging: none
- Commit: none
- Push: none
- PR: none

## Final Status

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_ORCHESTRATOR_CONTRACT_REMEDIATION_READY

Final status: PASS_CUSTODY_BALANCE_OBSERVER_ORCHESTRATOR_CONTRACT_READY
Remediation final status: PASS_CUSTODY_BALANCE_OBSERVER_ORCHESTRATOR_CONTRACT_REMEDIATION_READY
