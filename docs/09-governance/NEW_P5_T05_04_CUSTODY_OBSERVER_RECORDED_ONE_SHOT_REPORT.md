# NEW-P5-T05-04 Custody Observer Recorded One-shot Report

## Status

This implementation adds the server-only recorded entrypoint and an optional
lifecycle reporter to the existing one-shot orchestrator. The unrecorded
orchestrator retains ownership of the scope and command clients. The recorded
entrypoint owns only the run-ledger client and does not introduce scheduling,
automatic recovery, provider networking, credential discovery, or mutations
outside the existing observer and ledger commands.

```text
RECORDED_ONE_SHOT_EXECUTION_MODE=EXPLICIT_SERVER_ONLY
RUN_LEDGER_BEGIN_BEFORE_DISCOVERY=true
RECORDED_BEGIN_CREATED_REQUIRED_FOR_EXECUTION=true
RECORDED_BEGIN_EXISTING_RUN_POLICY=NO_EXECUTION_REQUIRES_RECOVERY
SCOPE_OUTCOME_PERSISTENCE_TIMING=AFTER_FINAL_SCOPE_OUTCOME_BEFORE_NEXT_SAME_PROVIDER_SCOPE
RUN_LEDGER_SCOPE_PERSIST_FAILURE_POLICY=STOP_NEW_WORK_AND_ABORT_IN_FLIGHT
RUN_LEDGER_SCOPE_PERSIST_FAILURE_FINALIZATION=PROHIBITED
RUN_LEDGER_FINALIZATION_FAILURE_DURABLE_STATUS=RUNNING
RUN_LEDGER_CLIENT_CLOSE_FAILURE_TERMINAL_MUTATION=PROHIBITED
AUTOMATIC_INCOMPLETE_RUN_RECOVERY=DEFERRED
AUTOMATIC_RECORDED_RUN_REEXECUTION=PROHIBITED

RUN_VERSION_SEMANTICS=LIFECYCLE_ONLY
RUN_VERSION_INITIAL=1
RUN_VERSION_SCOPE_OUTCOME_INCREMENT=false
RUN_FINALIZE_EXPECTED_VERSION_SOURCE=BEGIN_RESULT_VERSION
RUN_FINALIZE_SUCCESS_VERSION_INCREMENT=1
RUN_VERSION_FIRST_TERMINAL=2

UNRECORDED_ORCHESTRATOR_RUNTIME_CASES=269
UNRECORDED_ORCHESTRATOR_REGRESSION=PASS
NOOP_REPORTER_RESULT_PARITY=PASS
REPORTER_INTERMEDIATE_SCOPE_CALLS=0
REPORTER_SCOPE_DUPLICATE_CALLS=0
REPORTER_FAILURE_FINALIZE_CALLS=0

RECORDED_ORCHESTRATOR_RUNTIME_CASES=163
RECORDED_ORCHESTRATOR_RUNTIME=PASS
RECORDED_RUNTIME_REAL_DB_INTEGRATION=COVERED_PASS
R4B3_REAL_ABORT_FAILURE_MATRIX=PASS

RUN_LEDGER_CLIENT_RUNTIME_CASES=53
BALANCE_ADAPTER_RUNTIME_CASES=74
BALANCE_OBSERVER_WORKER_RUNTIME_CASES=62
BALANCE_OBSERVER_RESILIENCE_RUNTIME_CASES=62
BALANCE_OBSERVER_SCOPE_CLIENT_RUNTIME_CASES=88
BALANCE_OBSERVER_ORCHESTRATOR_RUNTIME_CASES=269

FINAL_DB_FILE_COUNT=32
FINAL_DB_TEST_COUNT=1514
FINAL_DB_FAILURES=0
FINAL_DB_SKIPS=0
GENERATED_DATABASE_TYPE_DIFF=0
DB_LINT=PASS
TYPESCRIPT=PASS
ESLINT=PASS
PRODUCTION_BUILD=PASS
CUSTODY_BOUNDARY=PASS

PACKAGE_SCRIPT_ADDITIONS=1
DEPENDENCY_CHANGE_IN_P5_T05_04=false
PACKAGE_LOCK_DIFF=0
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
SECRET_PATTERN_FINDINGS=0
```

## Implementation Boundary

`balance-observer-orchestrator.ts` accepts an optional generic reporter. It
awaits a reporter only after a final provider-plus-asset scope outcome has
been computed and before the next scope of that provider starts. Reporter
failure aborts the shared signal so no later work is scheduled. The reporter
does not receive an adapter, a raw error, an observation identity, a balance,
or a credential.

`balance-observer-recorded-orchestrator.ts` performs begin before invoking the
one-shot orchestrator. A non-created begin result returns the safe
`NO_EXECUTION_REQUIRES_RECOVERY` result without scope discovery, adapter
creation, worker execution, observation write, scope record, or finalization.
Scope persistence and finalization failure return safe incomplete results and
do not issue an automatic retry. Finalization uses only the begin result's
lifecycle version.

The recorded entrypoint closes scope and command clients itself only when the
existing orchestrator was not invoked. Once invoked, it preserves the
orchestrator's close ownership and closes the run-ledger client afterward.
Run-ledger close failure is surfaced without mutating or re-finalizing a
durable terminal row.

## Initial Verification (Historical Pre-Remediation Checkpoint)

- New recorded orchestrator harness: 38 cases PASS. It covers source boundary,
  successful begin/scope/finalize, existing-run block, begin failure with zero
  execution, scope persistence failure with finalization prohibited, finalize
  failure, close failure, and no-op reporter parity.
- Existing orchestrator runtime: 269 cases PASS.
- Existing run-ledger client runtime: 44 cases PASS.
- Adapter, worker, resilience, and scope-client runtimes: 74, 62, 62, and 88
  cases PASS.
- DB reset, lint, pgTAP, and generated types passed: 32 files, 1496 tests,
  zero failures, zero skips, generated type diff zero.
- TypeScript, lint, build, and custody boundary checks passed.
- Local Supabase was stopped after verification. Watched port listener residue
  and project container residue were both zero.

## Historical Required Follow-up (Resolved by R4A-R4B-3)

The new harness currently uses deterministic in-memory collaborator doubles
for the recorded-entrypoint integration cases. It does not yet execute the
whole recorded entrypoint against a local ledger row and the real scope and
command clients in one fixture. The required real-DB happy path, durable
summary/scope/failure parity, terminal/RUNNING reinvocation block, ambiguous
scope/finalize commit simulation, and caller-abort paths must be added before
this work is marked ready.

No dependency or lockfile change was made. Audit findings were not remediated
in this task.

## R1 Real PostgreSQL Evidence Investigation

R1 was started to add real local PostgreSQL recorded-entrypoint evidence without
modifying production source. The production source hashes for the orchestrator,
recorded entrypoint, and package manifest were captured before investigation.

Before adding a real-DB caller mid-run abort scenario, the recorded execution
path was reviewed against that required contract. A production behavior defect
was found: when the shared signal becomes aborted, `executeOneShot` fills any
not-yet-started discovered scope with an `ABORTED` outcome after provider work
settles. Those synthetic terminal outcomes do not pass through the lifecycle
reporter. The recorded entrypoint then detects that not every returned outcome
was reported and deliberately treats the run as incomplete, prohibiting
finalization.

This is correct for a reporter persistence failure, but it does not satisfy the
required caller-abort distinction when all final abort outcomes could otherwise
be persisted. A real PostgreSQL caller mid-run abort would therefore be expected
to leave a `RUNNING` incomplete run rather than the required durable `ABORTED`
terminal state. R1 does not alter production behavior, weaken the assertion, or
replace this with a synthetic PASS.

```text
PRODUCTION_SOURCE_MODIFICATIONS_IN_R1=0
REAL_DB_RECORDED_ENTRYPOINT=NOT_RUN_AFTER_PRODUCTION_DEFECT
REAL_RECORDED_RUN=NOT_RUN_AFTER_PRODUCTION_DEFECT
CALLER_ABORT_AND_REPORTER_FAILURE_DISTINCT=FAIL
MIDRUN_ABORT_UNREPORTED_SYNTHETIC_SCOPE_OUTCOMES=DEFECT
```

The next implementation task must make caller-aborted final scope outcomes
observable to the lifecycle reporter while preserving the separate behavior for
reporter persistence failure. It must then add the requested real PostgreSQL
happy-path, parity, replay, ambiguous-commit, pre-abort, and mid-run abort
evidence.

## R2 Production Remediation

R2 introduced the smallest orchestrator-only control-flow change. A mutable
reporter state now distinguishes a caller abort from a reporter persistence
failure. When a caller abort leaves a discovered scope unstarted, its final
`ABORTED` outcome is routed through the same lifecycle reporter path exactly
once. Once a reporter callback fails, the reporter state is terminal and later
synthetic outcomes are not written.

The recorded runtime increased from 38 to 41 cases and confirms the caller
mid-run abort result remains `ABORTED`, all final scopes are reported exactly
once, and no-op reporter parity remains intact. The existing DB-backed
orchestrator (269 cases) and run-ledger client (44 cases) regressions also
passed after the change.

The R2 real PostgreSQL recorded-entrypoint scenarios have not yet been added to
the harness. Consequently no real-DB happy-path, parity, replay, ambiguous
commit, or abort marker is claimed here; the final status remains non-PASS.

```text
R1_PRODUCTION_DEFECT_CONFIRMED=true
R1_DEFECT_CALLER_ABORT_UNREPORTED_FINAL_SCOPE=true
R2_CALLER_ABORT_SYNTHETIC_SCOPE_REPORTING=PASS
R2_REPORTER_FAILURE_SYNTHETIC_SCOPE_REPORTING=PROHIBITED
R2_REPORTER_FAILURE_STOPS_FURTHER_REPORTER_CALLS=PASS
CALLER_ABORT_AND_REPORTER_FAILURE_DISTINCT=PASS
RECORDED_ORCHESTRATOR_RUNTIME_CASES=41
UNRECORDED_ORCHESTRATOR_REGRESSION=PASS
RUN_LEDGER_CLIENT_RUNTIME_CASES=44
```

## Changed Files

- `src/server/custody/balance-observer-orchestrator.ts`
- `src/server/custody/balance-observer-recorded-orchestrator.ts`
- `scripts/test-p5-t05-custody-observer-recorded-orchestrator-runtime.mjs`
- `docs/09-governance/NEW_P5_T05_04_CUSTODY_OBSERVER_RECORDED_ONE_SHOT_REPORT.md`
- `package.json`

```text
INITIAL_STATUS=REQUIRES_ACTION_P5_T05_04_R2_RUNTIME_FAILED
```

## R4A-1A Recorded Harness PostgreSQL Foundation Helpers

The recorded-orchestrator runtime harness now contains the local PostgreSQL
foundation helpers required for a subsequent smoke suite: bounded local command
execution, temporary module loading, three dedicated role configurations,
ephemeral credentials, local-only network protection, credential-environment
guarding, synthetic fixture setup, safe output checks, and cleanup helpers.
No database command was executed in R4A-1A.

```text
R4A1A_HARNESS_HELPERS=PASS
```

## R4A-1B Real PostgreSQL Foundation Smoke

The recorded harness ran its synthetic suite plus a bounded local PostgreSQL
foundation smoke. Local Supabase start/reset, the synthetic custody fixture,
and three distinct ephemeral dedicated-role credentials were used. Direct role
logins proved the scope reader, observer worker, and run writer identities;
the three production PostgreSQL client factories were created with their fixed,
distinct application names.

The smoke used the real scope reader client to discover the synthetic approved
scope and the real run-ledger client to create one `RUNNING`, version-one run.
The durable row was checked through safe metadata only. The worker client was
created and its atomic observer-command EXECUTE privilege was verified, but no
observer command was invoked. There were no observation writes, scope-outcome
writes, or finalization calls.

The harness then cleared ephemeral credentials, reset and stopped local
Supabase, removed its temporary runtime directory, and reported no external or
provider network calls, credential-environment reads, or service-role use.

```text
R4A1B_REAL_POSTGRES_FOUNDATION_SMOKE=PASS
PRODUCTION_SOURCE_MODIFICATIONS_IN_R4A1B=0
REAL_FOUNDATION_DISTINCT_EPHEMERAL_CREDENTIALS=PASS
REAL_FOUNDATION_SCOPE_ROLE_LOGIN=PASS
REAL_FOUNDATION_WORKER_ROLE_LOGIN=PASS
REAL_FOUNDATION_RUN_WRITER_ROLE_LOGIN=PASS
REAL_FOUNDATION_THREE_CLIENT_CREATION=PASS
REAL_FOUNDATION_DISTINCT_APPLICATION_NAMES=PASS
REAL_FOUNDATION_SCOPE_DISCOVERY=PASS
REAL_FOUNDATION_SCOPE_COUNT=1
REAL_FOUNDATION_COMMAND_CLIENT_READY=PASS
REAL_FOUNDATION_RUN_BEGIN=PASS
REAL_FOUNDATION_RUN_BEGIN_CREATED=true
REAL_FOUNDATION_RUN_BEGIN_VERSION=1
FOUNDATION_OBSERVATION_WRITES=0
FOUNDATION_SCOPE_LEDGER_WRITES=0
FOUNDATION_FINALIZE_CALLS=0
LOCAL_POSTGRES_CONNECTIONS=6
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
EPHEMERAL_ROLE_PASSWORD_RESIDUE=0
CLIENT_POOL_RESIDUE=0
FIXTURE_RESIDUE=0
TEMP_RUNTIME_DIRECTORY_RESIDUE=0
SUPABASE_CONTAINER_RESIDUE=0
WATCHED_PORT_LISTENER_RESIDUE=0
RECORDED_ORCHESTRATOR_RUNTIME_CASES=84
ORCHESTRATOR_RUNTIME_CASE_COUNT=269
RUN_LEDGER_CLIENT_RUNTIME_CASE_COUNT=44
```

This evidence does not execute the real recorded-entrypoint happy path or any
observation/checkpoint write. Durable summary and scope parity, binding-failure
parity, terminal and `RUNNING` reinvocation, ambiguous commit handling, and
pre-abort and mid-run caller-abort scenarios remain pending.

```text
INITIAL_STATUS=REQUIRES_ACTION_P5_T05_04_REAL_DB_HAPPY_PATH_PENDING
```

## R4A-2A Real Recorded Happy Path

The recorded entrypoint was executed once against the local PostgreSQL
foundation with a deterministic credential-free adapter. The execution used
the real scope, observer-command, and run-ledger clients, and completed the
begin, discovery, worker, atomic observation/checkpoint command, lifecycle
scope persistence, and terminal finalization chain.

The returned one-shot summary was compared with every persisted run-summary
count using exact bigint comparisons. Each returned final scope outcome was
compared with its durable row for identity, status, binding counts, refresh
flags, and no-longer-eligible count. The success-only fixture persisted zero
binding-failure rows. No raw run key, credential, amount, observation key, or
checkpoint value was printed.

```text
R4A2A_REAL_RECORDED_HAPPY_PATH=PASS
PRODUCTION_SOURCE_MODIFICATIONS_IN_R4A2A=0
REAL_DB_RECORDED_ENTRYPOINT=PASS
REAL_RECORDED_RUN=PASS
REAL_RECORDED_BEGIN_CREATED=true
REAL_RECORDED_BEGIN_VERSION=1
REAL_RECORDED_OBSERVATION_EFFECT=PASS
REAL_RECORDED_SCOPE_VERSION_DELTA=0
REAL_RECORDED_TERMINAL_VERSION=2
REAL_RECORDED_FINALIZE_CALLS=1
DURABLE_SUMMARY_PARITY=PASS
DURABLE_SCOPE_PARITY=PASS
REAL_HAPPY_PATH_BINDING_FAILURE_ROWS=0
RECORDED_ENTRYPOINT_CALLS=1
RECORDED_SCOPE_DISCOVERY_CALLS=1
RECORDED_ADAPTER_FACTORY_CALLS=1
RECORDED_WORKER_EXECUTION_CALLS=1
RECORDED_OBSERVATION_COMMAND_EFFECTS=1
RECORDED_SCOPE_LEDGER_WRITES=1
RECORDED_FINALIZE_CALLS=1
RECORDED_ORCHESTRATOR_RUNTIME_CASES=102
ORCHESTRATOR_RUNTIME_CASE_COUNT=269
RUN_LEDGER_CLIENT_RUNTIME_CASE_COUNT=44
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
EPHEMERAL_ROLE_PASSWORD_RESIDUE=0
CLIENT_POOL_RESIDUE=0
FIXTURE_RESIDUE=0
TEMP_RUNTIME_DIRECTORY_RESIDUE=0
SUPABASE_CONTAINER_RESIDUE=0
WATCHED_PORT_LISTENER_RESIDUE=0
```

The durable binding-failure parity, terminal and `RUNNING` reinvocation,
ambiguous scope/finalize commit handling, real pre-abort and mid-run abort,
and reporter-persistence-failure matrix remain unexecuted and are not claimed
as passing by this report.

```text
INITIAL_STATUS=REQUIRES_ACTION_P5_T05_04_REAL_DB_FAILURE_AND_EDGE_MATRIX_PENDING
```

## R4A-2B Real Durable Binding-Failure Parity

A second fresh recorded run used the same real local PostgreSQL foundation with
a deterministic, non-retryable adapter failure. The returned final binding
outcome was failed, and its durable binding-failure row was compared field by
field: binding identity, failure stage and safe code, retryability, adapter and
database attempt counts, retry flags, and scope-refresh requirement. No direct
failure-row insertion or forced database error was used.

The failure run also finalized normally. Its returned summary and final scope
outcome matched the durable run and scope records, and the failure table had
exactly one row. The schema has no raw-error or raw-provider-payload column;
no such material was recorded or printed.

```text
R4A2B_REAL_BINDING_FAILURE_RUN=PASS
PRODUCTION_SOURCE_MODIFICATIONS_IN_R4A2B=0
REAL_FAILURE_RUN_BEGIN_CREATED=true
REAL_FAILURE_RUN_BEGIN_VERSION=1
REAL_FAILURE_RUN_SCOPE_VERSION_DELTA=0
REAL_FAILURE_RUN_TERMINAL_VERSION=2
REAL_FAILURE_RUN_SUMMARY_PARITY=PASS
REAL_FAILURE_RUN_SCOPE_PARITY=PASS
DURABLE_BINDING_FAILURE_PARITY=PASS
SUCCESS_BINDING_FAILURE_LEDGER_ROWS=0
DURABLE_FAILURE_RAW_ERROR_TEXT=0
DURABLE_FAILURE_RAW_PROVIDER_PAYLOAD=0
RECORDED_ORCHESTRATOR_RUNTIME_CASES=118
ORCHESTRATOR_RUNTIME_CASE_COUNT=269
RUN_LEDGER_CLIENT_RUNTIME_CASE_COUNT=44
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
CLIENT_POOL_RESIDUE=0
EPHEMERAL_ROLE_PASSWORD_RESIDUE=0
FIXTURE_RESIDUE=0
TEMP_RUNTIME_DIRECTORY_RESIDUE=0
SUPABASE_CONTAINER_RESIDUE=0
WATCHED_PORT_LISTENER_RESIDUE=0
```

Terminal and `RUNNING` reinvocation, ambiguous scope/finalize commits,
finalize rejection, caller abort paths, and reporter-persistence-failure
evidence remain pending and are not claimed as passing.

```text
INITIAL_STATUS=REQUIRES_ACTION_P5_T05_04_REAL_DB_EDGE_MATRIX_PENDING
```

## R4B-1 Real Run Reinvocation Blocking

Two real local PostgreSQL replay scenarios were executed with fresh clients.
First, a completed recorded happy-path run was invoked again using its exact
same run key. Second, a fresh `RUNNING`, begin-only run was invoked through the
recorded entrypoint using its exact same run key. In both cases the durable
begin returned the existing run and the entrypoint returned its existing-run
recovery result without discovering scope, creating an adapter, running a
worker, writing an observation or scope outcome, or finalizing the run.

The terminal run retained its terminal state and version two. The `RUNNING`
run retained version one with no completion timestamp. Each replay used and
closed fresh scope, command, and run-ledger clients.

```text
R4B1_REAL_REINVOCATION_MATRIX=PASS
PRODUCTION_SOURCE_MODIFICATIONS_IN_R4B1=0
TERMINAL_RUN_REINVOCATION_EXECUTION_DELTA=0
TERMINAL_RUN_REINVOCATION_DURABLE_DELTA=0
RUNNING_RUN_REINVOCATION_EXECUTION_DELTA=0
RUNNING_RUN_REINVOCATION_DURABLE_DELTA=0
RUNNING_RUN_AUTOMATIC_RESUME=0
REINVOCATION_CLIENT_CLEANUP=PASS
RECORDED_ORCHESTRATOR_RUNTIME_CASES=130
ORCHESTRATOR_RUNTIME_CASE_COUNT=269
RUN_LEDGER_CLIENT_RUNTIME_CASE_COUNT=44
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
CLIENT_POOL_RESIDUE=0
EPHEMERAL_ROLE_PASSWORD_RESIDUE=0
FIXTURE_RESIDUE=0
TEMP_RUNTIME_DIRECTORY_RESIDUE=0
SUPABASE_CONTAINER_RESIDUE=0
WATCHED_PORT_LISTENER_RESIDUE=0
```

Ambiguous scope/finalize commit handling, finalize rejection, caller abort
paths, and reporter-persistence-failure real-DB evidence remain pending.

```text
INITIAL_STATUS=REQUIRES_ACTION_P5_T05_04_REAL_DB_AMBIGUOUS_AND_ABORT_MATRIX_PENDING
```

## R4B-2 Real Ambiguous Persistence Matrix

Three fresh recorded runs distinguished database commit state from application
observation state. In the ambiguous-scope case, the real scope command
committed once and the decorator then rejected; the run remained `RUNNING` at
version one and finalization was not called. In the finalize pre-commit case,
scope evidence committed but the decorator rejected before the real finalize
method; the run likewise remained `RUNNING` at version one. In the ambiguous
finalize case, the real finalize committed once and the decorator then
rejected; the run persisted its terminal state at version two without a second
finalize or provider reexecution.

```text
R4B2_REAL_AMBIGUOUS_PERSISTENCE_MATRIX=PASS
PRODUCTION_SOURCE_MODIFICATIONS_IN_R4B2=0
AMBIGUOUS_SCOPE_COMMIT=PASS
AMBIGUOUS_SCOPE_FINALIZE_CALLS=0
AMBIGUOUS_SCOPE_RUN_STATUS=RUNNING
AMBIGUOUS_SCOPE_RUN_VERSION=1
AMBIGUOUS_SCOPE_AUTOMATIC_RETRY=0
AMBIGUOUS_SCOPE_AUTOMATIC_REEXECUTION=0
AMBIGUOUS_SCOPE_POST_FAILURE_REPORTER_CALLS=0
REAL_FINALIZE_REJECTION_RUN_STATUS=RUNNING
REAL_FINALIZE_REJECTION_RUN_VERSION=1
REAL_FINALIZE_REJECTION_COMPLETED_AT_NULL=true
REAL_FINALIZE_AUTOMATIC_RETRY=0
FINALIZE_REJECTION_SCOPE_EVIDENCE_PRESERVED=PASS
AMBIGUOUS_FINALIZE_COMMIT=PASS
AMBIGUOUS_FINALIZE_CALL_COUNT=1
AMBIGUOUS_FINALIZE_AUTOMATIC_RETRY=0
AMBIGUOUS_FINALIZE_PROVIDER_REEXECUTION=0
AMBIGUOUS_FINALIZE_REPLACEMENT_RUNS=0
AMBIGUOUS_FINALIZE_DURABLE_VERSION=2
AMBIGUOUS_FAILURE_MODES_DISTINCT=PASS
RECORDED_ORCHESTRATOR_RUNTIME_CASES=143
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
```

## R4B-3 DB and Client Cardinality Remediation

The first R4B-3 real PostgreSQL mid-run abort attempt exposed a DB command
cardinality defect: durable failure evidence included ABORTED bindings while
the DB invariant counted only failed bindings. The DB contract was remediated
and independently closed with a fresh-reset baseline of 32 files, 1514 tests,
and zero failures.

The resumed matrix then reached the run-ledger client and exposed the same
failure-only cardinality assumption before the DB command was issued. The
client now validates and transports the same invariant as the DB:
failure-evidence count equals binding failure count plus binding abort count.
The client-only remediation completed with 53 runtime cases passing, including
ABORTED-only, FAILED-only, mixed, and invalid-cardinality inputs.

```text
R4B3_DB_CARDINALITY_DEFECT_CONFIRMED=true
OLD_DB_FAILURE_EVIDENCE_INVARIANT=FAILURE_ONLY
NEW_DB_FAILURE_EVIDENCE_INVARIANT=FAILURE_PLUS_ABORT
DB_ABORT_COUNT_REMEDIATION=PASS
R4B3_CLIENT_CARDINALITY_DEFECT_CONFIRMED=true
OLD_CLIENT_FAILURE_EVIDENCE_INVARIANT=FAILURE_ONLY
NEW_CLIENT_FAILURE_EVIDENCE_INVARIANT=FAILURE_PLUS_ABORT
CLIENT_ABORT_COUNT_REMEDIATION=PASS
FINAL_DB_FILE_COUNT=32
FINAL_DB_TEST_COUNT=1514
FINAL_DB_FAILURES=0
RUN_LEDGER_CLIENT_RUNTIME_CASES=53
```

## R4B-3 Resumed Real Caller-Abort and Reporter-Failure Matrix

The completed real PostgreSQL matrix used fresh direct scope, worker, and
run-writer clients. A pre-aborted invocation began once, performed no scope
report, finalized once, and durably reached ABORTED version two. In the
deterministic mid-run scenario, the first scope completed, the caller signal
aborted, and the discovered-but-never-started scope became a final ABORTED
outcome. Both final scopes persisted exactly once; the never-started scope
persisted one ABORTED failure-evidence row with failure count zero and abort
count one. The run finalized ABORTED at version two with no post-abort work,
automatic retry, resume, replacement run, or reporter failure.

A separate reporter pre-commit rejection used no caller abort. It performed no
real scope DB write, stopped further reporter calls, did not finalize, and
correctly retained an incomplete RUNNING version-one durable run. This proves
that caller abort and reporter persistence failure remain distinct lifecycle
outcomes.

```text
R4B3_REAL_ABORT_FAILURE_MATRIX=PASS
R4B3_CARDINALITY_CONTRACT_ALIGNMENT=PASS
PRODUCTION_SOURCE_MODIFICATIONS_IN_R4B3_RESUME2=0
DB_REMEDIATION_MODIFICATIONS_IN_R4B3_RESUME2=0
CLIENT_REMEDIATION_MODIFICATIONS_IN_R4B3_RESUME2=0
REAL_PREABORT_RECORDED_INVOCATION=PASS
REAL_PREABORT_DURABLE_STATUS=ABORTED
REAL_PREABORT_DURABLE_VERSION=2
REAL_PREABORT_FINALIZE_CALLS=1
REAL_MIDRUN_CALLER_ABORT=PASS
REAL_MIDRUN_ABORT_FINAL_OUTCOME_DURABILITY=PASS
REAL_MIDRUN_ABORT_FINALIZE_CALLS=1
REAL_MIDRUN_ABORT_DURABLE_STATUS=ABORTED
REAL_MIDRUN_ABORT_DURABLE_VERSION=2
CALLER_ABORT_ABORTED_ONLY_CLIENT_VALIDATION=PASS
CALLER_ABORT_NEVER_STARTED_SCOPE_DURABLE=PASS
CALLER_ABORT_DURABLE_SCOPE_PARITY=PASS
CALLER_ABORT_POST_ABORT_NEW_WORK_STARTS=0
CALLER_ABORT_REPORTER_FAILURES=0
CALLER_ABORT_AUTOMATIC_REEXECUTION=0
REPORTER_FAILURE_DETECTED=PASS
REPORTER_FAILURE_POST_FAILURE_REPORTER_CALLS=0
REPORTER_FAILURE_INCOMPLETE_DURABLE_EVIDENCE=PASS
SCOPE_PERSIST_FAILURE_FINALIZE_CALLS=0
SCOPE_PERSIST_FAILURE_RUN_STATUS=RUNNING
SCOPE_PERSIST_FAILURE_RUN_VERSION=1
REPORTER_FAILURE_AUTOMATIC_RETRY=0
REPORTER_FAILURE_AUTOMATIC_REEXECUTION=0
CALLER_ABORT_AND_REPORTER_FAILURE_DISTINCT=PASS
REPORTER_INTERMEDIATE_SCOPE_CALLS=0
REPORTER_SCOPE_DUPLICATE_CALLS=0
R1_PRODUCTION_DEFECT_CONFIRMED=true
R1_DEFECT_CALLER_ABORT_UNREPORTED_FINAL_SCOPE=true
R2_CALLER_ABORT_SYNTHETIC_SCOPE_REPORTING=PASS
R2_REPORTER_FAILURE_SYNTHETIC_SCOPE_REPORTING=PROHIBITED
R2_REPORTER_FAILURE_STOPS_FURTHER_REPORTER_CALLS=PASS
RECORDED_ORCHESTRATOR_RUNTIME_CASES=163
UNRECORDED_ORCHESTRATOR_RUNTIME_CASES=269
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
ABORT_LISTENER_RESIDUE=0
TIMER_RESIDUE=0
CLIENT_POOL_RESIDUE=0
EPHEMERAL_ROLE_PASSWORD_RESIDUE=0
FIXTURE_RESIDUE=0
TEMP_RUNTIME_DIRECTORY_RESIDUE=0
```

P5-T05-04 now requires only the final consolidated regression closeout before
commit consideration. No commit is made by this evidence update.

## Final Consolidated Regression Evidence

The following is the current canonical evidence after the R4B-3 cardinality
remediation and final consolidated regression steps. Earlier R4A and R4B
checkpoint counts remain above as historical evidence only.

```text
FINAL_RUNTIME_RUN_LEDGER_CLIENT_CASES=53
FINAL_RUNTIME_UNRECORDED_ORCHESTRATOR_CASES=269
FINAL_RUNTIME_RECORDED_ORCHESTRATOR_CASES=163
FINAL_RUNTIME_FAILURES=0
FINAL_RUNTIME_SKIPS=0
FINAL_DB_FILE_COUNT=32
FINAL_DB_TEST_COUNT=1514
FINAL_DB_FAILURES=0
FINAL_DB_SKIPS=0
FINAL_DB_LINT=PASS
FINAL_REAL_POSTGRES_PRE_ABORT=PASS
FINAL_REAL_POSTGRES_MID_RUN_ABORT=PASS
FINAL_REAL_POSTGRES_NEVER_STARTED_ABORTED=PASS
FINAL_REAL_POSTGRES_REPORTER_PRE_COMMIT_FAILURE=PASS
FINAL_REAL_POSTGRES_FAILURE_ORIGIN_DISTINCTION=PASS
FINAL_TYPESCRIPT=PASS
FINAL_ESLINT=PASS
FINAL_PRODUCTION_BUILD=PASS
FINAL_CUSTODY_BOUNDARY=PASS
FINAL_EXTERNAL_APPLICATION_NETWORK_CALLS=0
FINAL_PROVIDER_NETWORK_CALLS=0
FINAL_CREDENTIAL_ENV_READS=0
FINAL_APPLICATION_SERVICE_ROLE_USAGE=0
FINAL_REMOTE_SUPABASE_CONNECTIONS=0
FINAL_PRODUCTION_STAGING_DB_USAGE=0
FINAL_ACTUAL_SECRET_PATTERN_MATCHES=0
FINAL_WATCHED_PORT_RESIDUE=0
FINAL_RELEVANT_PROCESS_RESIDUE=0
FINAL_PROJECT_CONTAINER_RESIDUE=0
FINAL_PACKAGE_LOCK_DIFF=0
FINAL_GENERATED_DATABASE_TYPE_DIFF=0
FINAL_STAGED_CHANGES=0
FINAL_GIT_DIFF_CHECK=PASS
```

## Final Governance Closeout

The initial Step 6 read-only barrier found stale values in the authoritative
governance status block only. It found no implementation, test, database,
build, security, cleanup, package, generated-artifact, or worktree failure.
Step 6A reconciled the current values and classified earlier checkpoint values
as historical evidence. The Step 6 barrier was then re-run read-only and
passed with zero discrepancies, authorizing this closeout.

P5-T05-04 custody balance observer recorded one-shot implementation and its
final consolidated regression closeout are complete and ready for the next
explicitly authorized workflow step. This status does not approve deployment,
production release, branch merge, PR approval, or unrelated P5 work.

```text
FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_RECORDED_ONE_SHOT_READY
```
