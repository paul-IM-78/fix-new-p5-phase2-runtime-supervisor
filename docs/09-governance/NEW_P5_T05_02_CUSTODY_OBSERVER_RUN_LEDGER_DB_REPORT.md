# P5-T05-02 Custody Observer Run Ledger DB Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t05-custody-observer-run-ledger`
- Start and final HEAD: `5565b89fef9c902e42e205385ae51f8255fc7495`
- Parent: `fa99332a664c3f4e167fca2e5564bb51c47146e7`
- `origin/main` and merge base: `5c549f15f61b2c4c090bc89936c56291b5d9107b`
- Contract sources: `NEW_P5_T05_01_CUSTODY_OBSERVER_RUN_LEDGER_CONTRACT.md` and its R1 version/CAS resolution
- Branch-only commits: 2 governance commits; this task creates no commit, remote branch, or PR.

## Delivered DB Contract

New migration: `supabase/migrations/20260808131500_p5_t05_custody_observer_run_ledger.sql`.

- Adds `private.custody_balance_observer_runs`, `private.custody_balance_observer_scope_outcomes`, and `private.custody_balance_observer_binding_failures`.
- Reuses canonical `private.custody_providers`, `public.supported_assets`, and `private.custody_account_bindings` foreign-key relations.
- Run keys are constrained to `obsrun:v1:<canonical-lowercase-uuid>`; trigger values and identity policies are constrained catalogs.
- Runs begin as `RUNNING`, version `1`; terminal states are immutable and first finalization advances only to version `2`.
- Summary data is typed columns with non-negative and cross-counter consistency checks. There are no JSON or JSONB ledger columns, raw error text, provider payloads, credentials, checkpoint identities, or observed balance values.
- Scope rows are unique by `(run_id, provider_id, asset_id)` and `(run_id, discovery_index)`; binding failures are unique by `(run_id, binding_id)`.
- Adds indexes for run status/time, run scope order, and run failure order.

## Authorization And Commands

- Adds `custody_observer_run_writer` as LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, and NOBYPASSRLS, with no stored password or memberships.
- The role has only database CONNECT and private-schema USAGE. Direct table privileges are absent.
- Commands are `private.begin_balance_observer_run`, `private.record_balance_observer_scope_outcome`, and `private.finalize_balance_observer_run`.
- All three are VOLATILE SECURITY DEFINER commands with `search_path=''`, schema-qualified references, and execute grants only for the dedicated run writer.
- `anon`, `authenticated`, `service_role`, scope reader, and observer worker cannot execute run commands. The run writer cannot execute scope read or observation-write commands.
- `private.assert_custody_observer_run_writer_role_contract()` validates the dedicated-role boundary during migration and pgTAP.

## Lifecycle, Replay, And Atomicity

- Begin exact replay returns the existing run with `created=false`; different immutable metadata raises a safe idempotency conflict.
- Scope recording locks the parent run `FOR UPDATE`, does not increment run version, validates scope and failure payloads, and writes the outcome plus all failure rows in one command transaction.
- Exact scope replay returns `created=false`; changed scope/failure data raises a safe conflict. Terminal runs reject late scope writes.
- Finalization locks the parent run `FOR UPDATE`, requires expected version `1` from the begin result, performs the one terminal transition to version `2`, and exact replay has no version delta.
- Different terminal data raises a safe finalization conflict. No whole-run transaction, scheduler, queue, alert delivery, provider adapter, credential, or service-role runtime was added.

## pgTAP

New test: `supabase/tests/database/p5_t05_custody_observer_run_ledger.test.sql`.

- Plan count: 26.
- Covers role attributes, password/membership absence, connection/schema limits, direct-table denial, exact command signatures, execute allowlist, SECURITY DEFINER/search path, role assertion, run begin replay/conflict, scope replay/conflict, scope/failure atomicity, terminal version/CAS/replay/conflict, terminal immutability, and browser/service/sibling-role denial.
- Final DB suite: 32 files, 1,496 tests, 0 failures, 0 skips.
- Same local instance: 3 consecutive PASS runs, 0 failures.
- Fresh local instances: 2 start/reset/lint/test/stop PASS cycles, 0 failures.
- Final DB reset, lint, test, and generated public-type cycle: PASS; generated type diff: 0.

## Regression Evidence

- Balance adapter runtime: 74 PASS; external network 0; credential environment reads 0.
- Balance observer worker runtime: 62 PASS; provider network 0; service-role usage 0.
- Balance observer resilience runtime: 62 PASS; external/provider network and credential reads 0.
- Scope client runtime: 88 PASS; direct table access denied and cleanup PASS.
- One-shot orchestrator runtime: 269 PASS; replay durable deltas 0; provider concurrency bounded and same-provider concurrency 1.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `npm run test:custody:boundary:local`: PASS.

## Audit And Safety Notes

- `npm audit --omit=dev` reported 3 existing production dependency advisories; full `npm audit` reported 5. No package or lockfile change is included in this task, and no audit remediation was attempted because dependency changes are out of scope.
- Secret scan of the migration, pgTAP, this report, and the Git diff found no actual credential, token, key, password, secret material, cookie, database URL, or local environment-file content.
- No local environment-file content was inspected or included. No external/provider network, production service-role, private key, secret material, or client signing was introduced.
- Local Supabase was explicitly stopped after validation. No listener remains on ports 3000, 3010, 55721, 55722, 55723, or 55724.

## Change Boundary

- New files only: migration, pgTAP, and this report.
- Existing tracked-file modifications: 0.
- Package, lockfile, source, scripts, and generated type diffs: 0.
- Staging, commit, push, remote feature branch, and PR: 0.

## Next Step

Implement the server-only direct PostgreSQL run-writer client and injected lifecycle reporter in P5-T05-03, using a separately provisioned run-writer credential rather than scope-reader or observer-worker credentials.

## Machine-Checkable Markers

```text
P5_T05_SCOPE=CUSTODY_OBSERVER_DURABLE_RUN_LEDGER
RUN_LEDGER_ROLE_LOGICAL_NAME=custody_observer_run_writer
RUN_LEDGER_DB_CONNECTION=DIRECT_POSTGRES
RUN_LEDGER_ACCESS=EXECUTE_ONLY_SECURITY_DEFINER_COMMANDS
RUN_LEDGER_ARBITRARY_JSON=PROHIBITED
ORCHESTRATOR_DB_CREDENTIAL_MODEL=THREE_SEPARATE_CREDENTIALS

RUN_VERSION_SEMANTICS=LIFECYCLE_ONLY
RUN_VERSION_INITIAL=1
RUN_VERSION_SCOPE_OUTCOME_INCREMENT=false
RUN_SCOPE_RECORD_PARENT_LOCK=FOR_UPDATE
RUN_FINALIZE_PARENT_LOCK=FOR_UPDATE
RUN_FINALIZATION_SCOPE_FREEZE=SHARED_PARENT_ROW_LOCK
RUN_FINALIZE_EXPECTED_VERSION_SOURCE=BEGIN_RESULT_VERSION
RUN_FINALIZE_SUCCESS_VERSION_INCREMENT=1
RUN_VERSION_FIRST_TERMINAL=2
RUN_VERSION_SCOPE_EXACT_REPLAY_DELTA=0
RUN_VERSION_SCOPE_CONFLICT_DELTA=0
RUN_VERSION_FINALIZE_EXACT_REPLAY_DELTA=0
RUN_VERSION_FINALIZE_CONFLICT_DELTA=0

RUN_BEGIN_ATOMICITY=SINGLE_DB_COMMAND
SCOPE_OUTCOME_ATOMICITY=SCOPE_AND_FAILURES_SINGLE_DB_TRANSACTION
RUN_FINALIZATION_ATOMICITY=SINGLE_DB_COMMAND
WHOLE_RUN_DATABASE_TRANSACTION=PROHIBITED

JSON_LEDGER_COLUMN_COUNT=0
RUN_WRITER_PASSWORD_IN_MIGRATION=0
RUN_WRITER_DIRECT_TABLE_PRIVILEGES=0
RUN_WRITER_SCOPE_READ_EXECUTE=0
RUN_WRITER_OBSERVATION_WRITE_EXECUTE=0
SCOPE_READER_RUN_WRITE_EXECUTE=0
OBSERVER_WORKER_RUN_WRITE_EXECUTE=0
PUBLIC_RUN_WRITE_EXECUTE=0
ANON_RUN_WRITE_EXECUTE=0
AUTHENTICATED_RUN_WRITE_EXECUTE=0
SERVICE_ROLE_RUN_WRITE_EXECUTE=0

EXTERNAL_ALERT_DELIVERY=DEFERRED
SCHEDULER_QUEUE_CRON_DAEMON=DEFERRED
AUTOMATIC_RECONCILIATION_TRIGGER=DEFERRED
PRODUCTION_PROVIDER_ADAPTERS=DEFERRED

P5_T05_02_PGTAP_PLAN_COUNT=26
FINAL_DB_FILE_COUNT=32
FINAL_DB_TEST_COUNT=1496
FINAL_DB_FAILURES=0
FINAL_DB_SKIPS=0
SAME_INSTANCE_DB_RUNS=3
SAME_INSTANCE_DB_PASSES=3
SAME_INSTANCE_DB_FAILURES=0
FRESH_INSTANCE_DB_CYCLES=2
FRESH_INSTANCE_DB_PASSES=2
FRESH_INSTANCE_DB_FAILURES=0
GENERATED_DATABASE_TYPE_DIFF=0

BALANCE_ADAPTER_RUNTIME_CASES=74
BALANCE_ADAPTER_RUNTIME_STATUS=PASS
BALANCE_OBSERVER_WORKER_RUNTIME_CASES=62
BALANCE_OBSERVER_WORKER_RUNTIME_STATUS=PASS
BALANCE_OBSERVER_RESILIENCE_RUNTIME_CASES=62
BALANCE_OBSERVER_RESILIENCE_RUNTIME_STATUS=PASS
BALANCE_OBSERVER_SCOPE_CLIENT_RUNTIME_CASES=88
BALANCE_OBSERVER_SCOPE_CLIENT_RUNTIME_STATUS=PASS
BALANCE_OBSERVER_ORCHESTRATOR_RUNTIME_CASES=269
BALANCE_OBSERVER_ORCHESTRATOR_RUNTIME_STATUS=PASS
TYPESCRIPT_NOEMIT_STATUS=PASS
LINT_STATUS=PASS
LINT_WARNING_COUNT=0
BUILD_STATUS=PASS
CUSTODY_BOUNDARY_STATUS=PASS

PRODUCTION_AUDIT_VULNERABILITIES=3
FULL_AUDIT_VULNERABILITIES=5
DEPENDENCY_CHANGE_IN_P5_T05_02=false
PACKAGE_JSON_DIFF=0
PACKAGE_LOCK_DIFF=0
AUDIT_FINDINGS_DISCLOSED=true

EXTERNAL_PROVIDER_NETWORK_CALLS=0
PRODUCTION_PROVIDER_NETWORK_CALLS=0
PRODUCTION_CREDENTIAL_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
SECRET_PATTERN_FINDINGS=0

SUPABASE_CONTAINER_RESIDUE=0
WATCHED_PORT_LISTENER_RESIDUE=0
ACL_CONTAMINATION_RESIDUE=0
FIXTURE_RESIDUE=0
TEMP_FILE_RESIDUE=0
CLEANUP_STATUS=PASS
```

## Final Status

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_RUN_LEDGER_DB_READY
