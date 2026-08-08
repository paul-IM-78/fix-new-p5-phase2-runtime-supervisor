# NEW-P5-T05-01 Custody Balance Observer Durable Run Ledger Contract

## 1. Status

P5-T05 defines durable, private operational evidence for one custody balance
observer invocation. This is a governance-contract task only: no migration,
pgTAP, source, runtime harness, package, generated type, staging, commit,
push, or pull request is included.

```text
P5_T05_SCOPE=CUSTODY_OBSERVER_DURABLE_RUN_LEDGER
P5_T05_EXISTING_CONTRACT=ABSENT
P5_T05_IMPLEMENTATION=NOT_STARTED
```

## 2. Worktree and Baseline

| Item | Value |
| --- | --- |
| Repository | `paul-IM-78/fix-new-p5-phase2-runtime-supervisor` |
| Main worktree | `D:\Ai\staking-wallet-web-phase2-supervisor` |
| Development worktree | `D:\Ai\staking-wallet-web` |
| Main HEAD | `main` / `5c549f15f61b2c4c090bc89936c56291b5d9107b` |
| Development start | `chore/next-work` / `5c549f15f61b2c4c090bc89936c56291b5d9107b` |
| `origin/main` | `5c549f15f61b2c4c090bc89936c56291b5d9107b` |
| New branch | `feat/p5-t05-custody-observer-run-ledger` |

At start both worktrees were clean, staging was empty, and the target branch
had no local ref, remote ref, or pull request.

## 3. Evidence Reviewed

The following tracked files were read without local environment-file access or
provider/network calls:

- `src/server/custody/balance-observer-orchestrator.ts`
- `src/server/custody/balance-observer-scope-client.ts`
- `src/server/custody/balance-observer-command-client.ts`
- `src/server/custody/balance-observer-worker.ts`
- `src/server/custody/balance-observer-retry.ts`
- `src/server/custody/provider-observation-contract.ts`
- `supabase/migrations/20260729090000_p5_t02_reconciliation_core.sql`
- `supabase/migrations/20260801071426_p5_t03_atomic_balance_observer_command.sql`
- `supabase/migrations/20260802003000_p5_t03_acl_edge_remediation.sql`
- `supabase/migrations/20260802090000_p5_t04_scope_discovery.sql`
- P5-T02 reconciliation, P5-T03 observer, and P5-T04 orchestrator reports.

Repository searches found no P5-T05 contract, observer run ledger, observer
failure ledger, operational incident table, or alert delivery implementation.
P5-T03 explicitly deferred durable failure storage; P5-T04 deferred durable
failure ledger and alerting.

## 4. P5-T04 Baseline and Missing Boundary

P5-T04 is merged in `5c549f1`. Its server-only one-shot orchestrator uses
separate scope-reader and observation-writer clients, deterministic keyset
scope discovery, bounded concurrency, retry, refresh, abort, and `finally`
cleanup. It returns results only in process memory and currently closes only
those two owned clients.

Current terminal statuses are:

```text
COMPLETED
PARTIAL
ABORTED
FAILED_DISCOVERY
FAILED_CLEANUP
```

Successful observations and checkpoints are durable through the worker's
atomic command. Invocation state, final provider-plus-asset scope outcomes,
and failed/aborted binding evidence are not durable. `reconciliation_runs` is
an asset-reconciliation ledger and must not be reused as observer execution
state.

## 5. Contract Decisions

```text
RUN_LEDGER_RUNTIME=SERVER_ONLY_NODE
RUN_LEDGER_DB_CONNECTION=DIRECT_POSTGRES
RUN_LEDGER_AUTHORIZATION=SEPARATE_DEDICATED_POSTGRES_LOGIN_ROLE
RUN_LEDGER_ROLE_LOGICAL_NAME=custody_observer_run_writer
RUN_LEDGER_ACCESS=EXECUTE_ONLY_SECURITY_DEFINER_COMMANDS

ORCHESTRATOR_DB_CREDENTIAL_MODEL=THREE_SEPARATE_CREDENTIALS
SCOPE_READER_ROLE=custody_observer_scope_reader
OBSERVATION_WRITER_ROLE=custody_observer_worker
RUN_LEDGER_WRITER_ROLE=custody_observer_run_writer

RUN_LEDGER_INTEGRATION=INJECTED_LIFECYCLE_REPORTER
RUN_LEDGER_BEGIN_BEFORE_SCOPE_DISCOVERY=true
RUN_LEDGER_SCOPE_PERSISTENCE=ONE_FINAL_SCOPE_OUTCOME_PER_PROVIDER_ASSET
RUN_LEDGER_FINALIZE_AFTER_ORCHESTRATOR_RESULT=true
RUN_LEDGER_PRODUCTION_REQUIREMENT=REQUIRED
LOCAL_IN_MEMORY_REPORTER=TEST_ONLY

RUN_LEDGER_SUMMARY_STORAGE=TYPED_COLUMNS
RUN_LEDGER_FAILURE_STORAGE=TYPED_COLUMNS
RUN_LEDGER_ARBITRARY_JSON=PROHIBITED
RUN_LEDGER_RAW_ERROR_TEXT=PROHIBITED
RUN_LEDGER_RAW_PROVIDER_PAYLOAD=PROHIBITED

EXTERNAL_ALERT_DELIVERY=DEFERRED
OPERATIONAL_ALERT_ELIGIBILITY=DERIVED_READ_MODEL
SCHEDULER_QUEUE_CRON_DAEMON=DEFERRED
AUTOMATIC_RECONCILIATION_TRIGGER=DEFERRED
PRODUCTION_PROVIDER_ADAPTERS=DEFERRED
```

## 6. Run Identity and Idempotency

Each invocation has a database-created UUID `run_id` and caller-supplied,
non-secret idempotency identity `run_key` in the exact form
`obsrun:v1:<canonical-lowercase-uuid>`. The caller creates one key per logical
invocation and reuses it for transport or process retry. It contains no
credential, endpoint, provider payload, timestamp, hostname, process ID, or
retry-specific randomness.

The run table has a unique key on `run_key`. Exact begin replay requires the
same run key, trigger source, identity policy, and invocation contract version;
it returns the existing ID with `created=false` and no mutation. A different
immutable payload fails as `observer_run_idempotency_conflict` and creates no
replacement row.

## 7. Trigger Source and Lifecycle

The closed trigger catalog is `MANUAL`, `SCHEDULED`, `BACKFILL`, and `RECOVERY`.
P5-T05 runtime may use only `MANUAL` or deterministic local-test input;
`SCHEDULED` does not implement a scheduler. Free-text trigger source is
prohibited.

Durable statuses are `RUNNING` plus the five established terminal statuses.
Only `RUNNING` to terminal is valid; terminal changes, reopening,
last-write-wins, and unconditional upsert are prohibited. Exact finalization
replay is a no-op. `completed_at` is non-null only for terminal status and
never precedes `started_at`.

## 8. Durable Data Model

### Run table

`private.custody_balance_observer_runs` has one row per invocation with ID,
run key, trigger source, identity policy, invocation contract version, status,
nullable safe terminal code, started/completed/created/updated timestamps,
optimistic version, and the typed summary in section 9. It does not pre-create
a reconciliation reference, customer identity, provider account identity, or
free-text reason.

### Scope-outcome table

`private.custody_balance_observer_scope_outcomes` has exactly one final row per
`(run_id, provider_id, asset_id)`: discovery index, scope status, binding
success/failure/abort counts, refresh requested/attempted/succeeded/failed and
no-longer-eligible counts, nullable safe code, and recorded timestamp. Exact
same payload is a no-op; conflicting duplicate fails safely. It is append-only
after initial record.

### Binding-failure table

`private.custody_balance_observer_binding_failures` records only failed or
aborted bindings, with one final row per `(run_id, binding_id)`. Typed fields
are run/provider/asset/binding IDs, original binding order, stage, safe code,
retryability, retry exhausted/deferred, scope refresh requirement,
adapter/database attempts, and recorded timestamp. Successful bindings receive
no row. Existing provider and asset codes are joined by read models rather than
denormalized into failure rows.

## 9. Typed Summary and Stored-data Boundary

The run table persists every existing one-shot summary field as a non-null,
non-negative integer/bigint typed column:

```text
pagesRead scopesDiscovered providersDiscovered bindingsDiscovered
scopesStarted scopesCompleted scopesFailed scopesAborted
bindingsSucceeded bindingsFailed bindingsAborted
adapterFactoryCalls adapterFactoryFailures
scopeRefreshRequested scopeRefreshAttempted scopeRefreshSucceeded
scopeRefreshFailed scopeNoLongerEligible
scopeReadAttempts scopeReadRetryAttempts
workerAdapterAttempts workerDatabaseAttempts
workerAdapterRetryAttempts workerDatabaseRetryAttempts
clientCloseAttempts clientCloseFailures
```

Database bigint crosses TypeScript as decimal string, never forced through a
JavaScript `number`. The ledger stores no arbitrary JSON, raw provider payload,
raw error text, stack, SQLSTATE, SQL, constraint name, raw checkpoint or
observation identity, full observation key, balance amount, address, provider
account ID, endpoint, credential, token, session, private key, mnemonic,
hostname, process ID, or customer/profile identity. General logs also exclude
run key; safe IDs, safe stage/code, counts, booleans, and bounded duration are
allowed.

## 10. Failure Catalog

The minimum stage catalog is:

```text
DISCOVERY FACTORY ADAPTER VALIDATION IDENTITY DATABASE REFRESH WORKER CLEANUP ABORTED
```

Codes are bounded uppercase catalog values. Existing orchestrator/worker safe
codes are mapped into this catalog rather than copying error text.

```text
RUN_LEDGER_INPUT_INVALID RUN_LEDGER_CONNECTION_FAILED RUN_LEDGER_TIMEOUT
RUN_LEDGER_UNAVAILABLE RUN_LEDGER_COMMAND_REJECTED
RUN_NOT_FOUND RUN_NOT_RUNNING RUN_ALREADY_TERMINAL RUN_VERSION_CONFLICT
RUN_IDEMPOTENCY_CONFLICT RUN_SCOPE_DUPLICATE RUN_SCOPE_IDEMPOTENCY_CONFLICT
RUN_SCOPE_PROVIDER_ASSET_INVALID RUN_SCOPE_SUMMARY_INVALID
RUN_BINDING_FAILURE_INVALID RUN_BINDING_FAILURE_DUPLICATE
RUN_FINAL_STATUS_INVALID RUN_FINAL_SUMMARY_INVALID RUN_FINALIZATION_CONFLICT
RUN_LEDGER_RESULT_SHAPE_INVALID RUN_LEDGER_CLIENT_CLOSE_FAILED
```

## 11. Run-ledger Writer Role and Isolation

`custody_observer_run_writer` is a dedicated PostgreSQL login role:

```text
LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
```

The migration does not set a password. The role receives only database
`CONNECT`, private schema `USAGE`, and non-grantable `EXECUTE` on the three
ledger commands. Direct table/column/sequence/TEMP/CREATE grants, ownership,
membership, grant options, scope discovery, observation writer,
reconciliation/admin commands, and unrelated functions are denied.

| Role | Allowed command family | Forbidden command family |
| --- | --- | --- |
| `custody_observer_scope_reader` | scope list and refresh | observation and ledger write |
| `custody_observer_worker` | atomic observation/checkpoint write | scope read and ledger write |
| `custody_observer_run_writer` | begin, record outcome, finalize | scope read and observation write |

`PUBLIC`, `anon`, `authenticated`, and `service_role` have no execute grant on
ledger writer commands. Closed-world pgTAP assertions must check role
attributes, password absence, ownership/membership, effective privileges,
grant options, direct relation/column/sequence/TEMP access, and cross-role
command denial using relation OIDs where appropriate.

## 12. Database Commands

`private.begin_balance_observer_run` validates key and immutable input, creates
one `RUNNING` row atomically, and returns ID/version/status/created/start time.

`private.record_balance_observer_scope_outcome` requires the run to be
`RUNNING`, validates provider/asset references and one final scope outcome, and
persists failed/aborted binding rows in the same transaction. It supports exact
replay only.

`private.finalize_balance_observer_run` validates expected version, terminal
status/code, persisted scope aggregates, and typed summary before a one-time
terminal transition. It sets completion time and rejects stale/conflicting
finalization.

Every command is `SECURITY DEFINER`, `set search_path = ''`, schema-qualified,
and executable only by the writer role. Inputs cannot contain raw JSON/payload
or credentials.

## 13. Atomicity and Versioning

```text
RUN_BEGIN_ATOMICITY=SINGLE_DB_COMMAND
SCOPE_OUTCOME_ATOMICITY=SCOPE_AND_FAILURES_SINGLE_DB_TRANSACTION
RUN_FINALIZATION_ATOMICITY=SINGLE_DB_COMMAND
WHOLE_RUN_DATABASE_TRANSACTION=PROHIBITED
```

Begin creates version `1`. Finalize uses expected-version CAS and rejects stale
writers. Scope persistence may increment run version only if the migration
makes the returned expected-version contract explicit; otherwise finalization
derives it from command results. Either choice forbids last-write-wins.

## 14. Selected Runtime Integration

The selected model is an injected server-only lifecycle reporter, not a
recorded wrapper. It begins before discovery, persists each final scope outcome
while execution is running, and finalizes after the terminal result. A wrapper
could only persist after `runCustodyBalanceObserverOneShot()` returns, losing
completed-scope evidence if the process exits mid-run.

The reporter receives only typed safe projections and cannot receive adapters,
raw errors, credentials, raw identities, or provider payloads. P5-T04
concurrency, same-provider sequencing, refresh, abort, and cleanup contracts
must remain intact.

```text
RUN_LEDGER_BEGIN_FAILURE_POLICY=FAIL_CLOSED_BEFORE_EXECUTION
RUN_LEDGER_SCOPE_WRITE_FAILURE_POLICY=STOP_NEW_WORK_AND_ABORT_IN_FLIGHT
```

Begin persistence failure leaves discovery, factory, worker, and observation
attempts at zero. Scope persistence failure prevents new scope starts,
cooperatively aborts in-flight work, preserves previous rows, and attempts safe
finalization where possible. Finalization failure never overstates durable
success; a `RUNNING` row may remain as incomplete evidence. Automatic retry is
not added.

## 15. Three-client Lifecycle

`scopeClient`, `commandClient`, and `runLedgerClient` use separate direct
PostgreSQL credentials, Pools, and fixed application names. Close after a
finalization attempt in this order: scope client, command client, run-ledger
client. Close is idempotent; one close failure cannot prevent later closes;
run-ledger close failure cannot change a durable terminal state.

## 16. Incomplete Runs and Operational Read Direction

`RUNNING` with no scopes or only some persisted scope rows is supported
incomplete execution evidence, not corruption. A stale candidate is derived
only when `status = RUNNING` and `started_at < caller-supplied cutoff`.

```text
PARTIAL_DURABLE_RUN_STATE=SUPPORTED_INCOMPLETE_EXECUTION_EVIDENCE
STALE_RUN_AUTOMATIC_RECOVERY=DEFERRED
```

No automatic terminalization, lease stealing, resume, replay, or re-run is in
P5-T05. A later ADMIN+AAL2-only, user-scoped server read model may provide run
list/detail, scope/failure detail, derived stale/severity/alert eligibility,
filters, and opaque cursor pagination. It returns exact counts as strings and
never exposes private tables to browser Supabase clients. Retry, cancel,
resume, acknowledge, and resolve mutations remain out of scope.

Severity is system-derived: `COMPLETED` is INFO/non-alert, `PARTIAL` is
WARNING/alert-eligible, terminal discovery/cleanup failure and stale RUNNING
are CRITICAL/alert-eligible; `ABORTED` remains derived pending caller-
cancellation distinction. External delivery is deferred.

## 17. Retention and Deferred Scope

```text
RUN_LEDGER_DELETION=PROHIBITED
RUN_LEDGER_SCOPE_OUTCOME_DELETION=PROHIBITED
RUN_LEDGER_FAILURE_DELETION=PROHIBITED
```

Only restricted terminal finalization updates a run; scope outcomes and binding
failures are append-only. Retention/archive policy is deferred. This task also
does not implement scheduler, queue, cron, daemon, lease, stale reaper, retry
queue, production provider adapter or credential loading, provider network,
automatic reconciliation, alert delivery, transfer observation, payout,
signing, webhook, financial remediation, or deployment wiring.

## 18. Validation Plan

P5-T05-02 must validate role configuration, no password, three-role
closed-world ACL isolation, command grants, direct privilege denial, begin/
scope/finalize replay/conflict behavior, scope-and-failure atomicity, final CAS,
terminal immutability, typed summary consistency, and append-only tables under
repeated reset/lint/pgTAP qualification.

P5-T05-03/04 must validate distinct writer login/Pool/application name, begin
before discovery, begin failure with zero execution, scope/failure persistence,
exact/conflicting replay, partial durable evidence after interruption,
finalization success/failure, reporter abort, idempotent cleanup, zero
external/provider network calls, zero credential environment reads, zero
service-role use, and secret-safe output.

## 19. Implementation Roadmap

1. **P5-T05-02:** forward-only migration, writer role, private tables,
   commands, closed-world assertion, and pgTAP.
2. **P5-T05-03:** server-only direct PostgreSQL run-ledger client with explicit
   configuration, dedicated Pool, strict row validation, safe error mapping,
   and idempotent close.
3. **P5-T05-04:** injected lifecycle reporter integration, begin-before-
   execution, scope persistence, finalization, failure policy, and lifecycle.
4. **P5-T05-05:** ADMIN+AAL2 operational read model for safe list/detail and
   derived stale/severity/alert eligibility.
5. **P5-T05-06:** resilience, repeated DB/runtime closeout, and PR readiness.

## 20. Changed Files, Secret Scan, and Final Status

This task creates exactly one untracked file:

```text
docs/09-governance/NEW_P5_T05_01_CUSTODY_OBSERVER_RUN_LEDGER_CONTRACT.md
```

The secret scan covers this document and the working-tree diff. Actual values
for credentials, connection strings, production hosts, JWTs, Supabase keys,
provider credentials, access/refresh tokens, cookies/sessions, private keys,
mnemonics, seed phrases, wallet addresses, provider endpoints, decrypted secret
values, raw checkpoint/observation identities, full observation keys, and local
environment-file content must be zero. Local environment files are not read or
printed.

Staging, commit, push, remote branch creation, and pull request creation are
not performed by this task.

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_RUN_LEDGER_CONTRACT_READY

