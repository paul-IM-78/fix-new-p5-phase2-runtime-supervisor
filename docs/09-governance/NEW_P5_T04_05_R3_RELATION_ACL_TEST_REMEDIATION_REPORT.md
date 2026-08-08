# NEW-P5-T04-05-R3 Relation ACL Test Remediation Report

## Status

```text
DB_VALIDATION_EVENT=INTERMITTENT_REPRODUCIBLE_TEST_FAILURE
DB_VALIDATION_FAILURE_OCCURRENCES=2
DB_VALIDATION_TEST_DEFECT=TEXT_RELATION_RECONSTRUCTION
DB_VALIDATION_REMEDIATION=PG_CLASS_OID_PRIVILEGE_CHECK
PRODUCTION_DB_CONTRACT_DEFECT_IDENTIFIED=false
UNDERLYING_TOOLING_TIMING_ROOT_CAUSE=UNRESOLVED
HARDCODED_RELATION_EXCLUSIONS=0
```

## Worktree / Branch / HEAD

| Item | Value |
| --- | --- |
| Worktree | `D:\Ai\staking-wallet-web` |
| Branch | `feat/p5-t04-custody-observer-orchestrator` |
| Start HEAD | `73a3158d9954e1c2a823ff5e1daea26a2f2f8506` |
| Final HEAD | `73a3158d9954e1c2a823ff5e1daea26a2f2f8506` |
| origin/main | `e931dd173e0ab5005a386bf91c8e1276a74bcec4` |
| merge-base | `e931dd173e0ab5005a386bf91c8e1276a74bcec4` |
| Local commits over main | `4` |
| Remote feature branch | `absent` |
| PR | `absent` |
| Staging | `empty` |
| Commit/push/PR | `not performed` |

## Original Validation Failures

The branch closeout process observed the same intermittent pgTAP stop twice:

```text
FAILING_FILE=supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql
FAILING_LOCATION=line 224 near direct private table privilege assertion
FAILING_ERROR=relation "private.decrypted_secrets" does not exist
TAP_PARSE_ERROR=No plan found in TAP output
OBSERVED_FAILED_COUNT=Files=31, Tests=1437, Result=FAIL
```

Intermediate qualification before this remediation showed non-determinism:

```text
R1_PREVIOUS_FRESH_CYCLES=3
R1_PREVIOUS_FRESH_PASSES=3
R2_SAME_INSTANCE_RUNS=3
R2_SAME_INSTANCE_PASSES=3
R2_FRESH_INSTANCE_CYCLES=3
R2_FRESH_INSTANCE_PASSES=3
R2_FINAL_DB_VALIDATION_RECURRED=true
```

The event is therefore classified as an intermittent reproducible test failure,
not as a confirmed production database contract defect.

## Failing PgTAP Assertion

The prior assertion tested this contract:

```text
custody observer worker has no direct private table privileges
```

The previous SQL enumerated `information_schema.tables`, rebuilt relation names
as text using `private.` plus the table name, and passed those text names to
`has_table_privilege`. When catalog visibility exposed a non-resolvable private
relation name, PostgreSQL raised a relation-resolution exception before pgTAP
could finish the file.

## Safe Object Metadata

Only object metadata was inspected. No relation rows, Vault rows, decrypted
values, DB dumps, credentials, or `.env*` contents were read.

```text
to_regclass_private_decrypted_secrets=NULL
to_regclass_vault_decrypted_secrets=vault.decrypted_secrets
vault_decrypted_secrets_relkind=v
vault_decrypted_secrets_oid_exists=true
vault_decrypted_secrets_extension_dependency_exists=true
SECRET_ROW_LOOKUP=0
DECRYPTED_VALUE_LOOKUP=0
```

## Root Cause Boundary

```text
ROOT_CAUSE_BOUNDARY=TEST_ONLY_TEXT_RELATION_RECONSTRUCTION
UNDERLYING_TOOLING_TIMING_ROOT_CAUSE=UNRESOLVED
VAULT_EXTENSION_RACE_ASSUMED=false
SUPABASE_CLI_BUG_ASSUMED=false
PGTAP_PARALLEL_EXECUTION_BUG_ASSUMED=false
POSTGRESQL_CATALOG_CORRUPTION_ASSUMED=false
```

The remediation removes the unsafe test-side text relation reconstruction. It
does not claim to identify the lower-level timing behavior that intermittently
made the old assertion attempt to resolve `private.decrypted_secrets`.

## Production Assertion Impact

Production migration code was not modified.

The production worker/scope-reader ACL assertions use catalog identity and OID
based privilege checks for relation-level closed-world coverage. The R3 defect
was limited to the pgTAP assertion that rebuilt relation names as text.

```text
PRODUCTION_DB_CONTRACT_IMPACT=NONE_IDENTIFIED
PRODUCTION_MIGRATION_CHANGED=0
REMEDIATION_SCOPE=PGTAP_ONLY
```

## Test-only Remediation Decision

Changed file:

```text
supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql
```

The assertion was replaced in-place to preserve the pgTAP assertion count and
the original contract meaning.

## Previous SQL Pattern

The old pattern:

```text
SOURCE_CATALOG=information_schema.tables
RELATION_IDENTITY='private.' || tables.table_name
PRIVILEGE_FUNCTION=has_table_privilege(role, text, privilege)
```

This was vulnerable to text relation re-resolution.

## OID-based Replacement

The new pattern:

```text
SOURCE_CATALOG=pg_catalog.pg_class + pg_catalog.pg_namespace
RELATION_IDENTITY=classes.oid
PRIVILEGE_FUNCTION=pg_catalog.has_table_privilege(role, oid, privilege)
TEXT_RELATION_RECONSTRUCTION=0
```

Relation kind coverage:

```text
RELKIND_R_ORDINARY_TABLE=covered
RELKIND_P_PARTITIONED_TABLE=covered
RELKIND_V_VIEW=covered
RELKIND_M_MATERIALIZED_VIEW=covered
RELKIND_F_FOREIGN_TABLE=covered
```

Privilege coverage preserved:

```text
SELECT=covered
INSERT=covered
UPDATE=covered
DELETE=covered
EXPECTED_PRIVILEGE_COUNT=0
ASSERTION_MESSAGE_PRESERVED=true
PGTAP_ASSERTION_COUNT_DECREASE=0
HARDCODED_RELATION_EXCLUSIONS=0
```

## Same-file Pattern Review

The same file still uses `has_sequence_privilege` with `classes.oid` for private
sequence coverage. The failed private relation-level assertion was the only
same-file pattern using `information_schema.tables` plus `private.` text
reconstruction.

```text
PRIVATE_RELATION_TEXT_RECONSTRUCTION_AFTER_REMEDIATION=0
UNRELATED_PGTAP_FILES_CHANGED=0
```

## Test-safe Contamination Proof

A transaction-local synthetic table was created under `private`, granted SELECT
to `custody_observer_worker`, detected by the OID query, then revoked/dropped and
rolled back. No production table privilege was changed persistently.

```text
OID_ACL_BASELINE_COUNT=0
OID_ACL_CONTAMINATION_DETECTED=true
OID_ACL_CONTAMINATION_COUNT=1
OID_ACL_RECOVERY_COUNT=0
ACL_FIXTURE_RESIDUE=0
SECRET_ROW_LOOKUP=0
DECRYPTED_VALUE_LOOKUP=0
```

## Targeted Test Result

Command:

```text
npm run db:test:local -- supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql
```

Result:

```text
TARGET_PGTAP_FILES=1
TARGET_PGTAP_TESTS=46
TARGET_PGTAP_PASS=true
TARGET_MISSING_RELATION_ERROR=false
TARGET_TAP_PARSE_ERROR=false
```

The repository npm script was used for the single-file target run so it used the
same local Supabase CLI wrapper as the full DB test command.

## Same-instance Five-run Matrix

One Supabase instance was started, reset once, linted once, then full DB tests
were run five consecutive times.

```text
SAME_INSTANCE_DB_TEST_RUNS=5
SAME_INSTANCE_DB_TEST_PASSES=5
SAME_INSTANCE_DB_TEST_FAILURES=0
SAME_INSTANCE_LINT_ERRORS=0
```

| Run | Files | Tests | Missing relation | TAP parse error | Result |
| --- | ---: | ---: | --- | --- | --- |
| 1 | 31 | 1470 | false | false | PASS |
| 2 | 31 | 1470 | false | false | PASS |
| 3 | 31 | 1470 | false | false | PASS |
| 4 | 31 | 1470 | false | false | PASS |
| 5 | 31 | 1470 | false | false | PASS |

## Fresh-instance Five-cycle Matrix

Each cycle started Supabase, reset the database, ran lint, ran the full DB test,
and stopped Supabase.

```text
FRESH_INSTANCE_DB_CYCLES=5
FRESH_INSTANCE_DB_PASSES=5
FRESH_INSTANCE_DB_FAILURES=0
```

| Cycle | Reset | Lint errors | Files | Tests | Missing relation | TAP parse error | Result |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 1 | PASS | 0 | 31 | 1470 | false | false | PASS |
| 2 | PASS | 0 | 31 | 1470 | false | false | PASS |
| 3 | PASS | 0 | 31 | 1470 | false | false | PASS |
| 4 | PASS | 0 | 31 | 1470 | false | false | PASS |
| 5 | PASS | 0 | 31 | 1470 | false | false | PASS |

## Final DB Validation

Final separate DB validation also passed.

```text
FINAL_DB_RESET=PASS
FINAL_DB_LINT_ERRORS=0
FINAL_DB_TEST_FILES=31
FINAL_DB_TEST_TESTS=1470
FINAL_DB_TEST_FAILURES=0
FINAL_DB_TEST_SKIPS=0
FINAL_DB_TEST_MISSING_RELATION_ERROR=false
FINAL_DB_TEST_TAP_PARSE_ERROR=false
FINAL_DB_TYPES=PASS
GENERATED_TYPE_DIFF=0
```

## Runtime Validation

| Command | Result |
| --- | --- |
| `node --check scripts/test-p5-t04-custody-balance-observer-orchestrator-runtime.mjs` | PASS |
| `npm run test:custody:balance-observer-orchestrator:local` | PASS, 269 cases |
| `node --check scripts/test-p5-t04-custody-observer-scope-client-runtime.mjs` | PASS |
| `npm run test:custody:balance-observer-scope-client:local` | PASS, 88 cases |
| `node --check scripts/test-p5-t03-custody-balance-adapter-runtime.mjs` | PASS |
| `npm run test:custody:balance-adapter:local` | PASS, 74 cases |
| `node --check scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs` | PASS |
| `npm run test:custody:balance-observer-worker:local` | PASS, 62 cases |
| `node --check scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs` | PASS |
| `npm run test:custody:balance-observer-resilience:local` | PASS, 62 cases |

Key runtime metrics:

```text
ORCHESTRATOR_RUNTIME_CASE_COUNT=269
REAL_DB_ONE_SHOT_RUN_COUNT=2
REAL_DB_EXACT_REPLAY_RUN_COUNT=1
REPLAY_OBSERVATION_ROW_DELTA=0
REPLAY_DUPLICATE_OBSERVATION_DELTA=0
REPLAY_CHECKPOINT_ROW_DELTA=0
REPLAY_CHECKPOINT_VERSION_DELTA=0
REPLAY_UNRELATED_DURABLE_TABLE_DELTA=0
SERVICE_ROLE_USAGE=0
MAX_CROSS_PROVIDER_CONCURRENCY=4
MAX_SAME_PROVIDER_CONCURRENCY=1
SCOPE_CLIENT_RUNTIME_CASE_COUNT=88
ADAPTER_RUNTIME_CASE_COUNT=74
WORKER_RUNTIME_CASE_COUNT=62
RESILIENCE_RUNTIME_CASE_COUNT=62
```

## TypeScript / Lint / Build

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS, warnings 0 |
| `npm run build` | PASS |
| `npm run test:custody:boundary:local` | PASS |

The build detected `.env.local` by file name only. No `.env*` content was read
into this report.

## Audits

| Command | Result |
| --- | --- |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` | 0 vulnerabilities |

## Network and Credential Counts

```text
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_USAGE=0
```

## Secret and Decrypted-data Boundary

Secret scan scope:

- modified pgTAP file
- this remediation report
- current working-tree diff

Findings:

```text
POSTGRESQL_PASSWORD=0
DB_CONNECTION_STRING=0
PRODUCTION_HOST=0
JWT=0
SUPABASE_KEY=0
PROVIDER_CREDENTIAL=0
ACCESS_REFRESH_TOKEN=0
COOKIE_SESSION=0
PRIVATE_KEY=0
MNEMONIC=0
SEED_PHRASE=0
WALLET_ADDRESS=0
PROVIDER_ENDPOINT=0
DECRYPTED_SECRET_VALUE=0
VAULT_SECRET_VALUE=0
RAW_CHECKPOINT_IDENTITY=0
RAW_OBSERVATION_IDENTITY=0
FULL_OBSERVATION_KEY=0
ENV_LOCAL_CONTENT_READ=0
```

The object name `decrypted_secrets`, relation metadata, synthetic UUIDs, and
test role/function names are not secret values.

## Cleanup

```text
SUPABASE_RUNNING_CONTAINERS=0
LISTENING_PORTS_3000_3010_55721_55722_55723_55724=0
POSTGRESQL_SOCKET_RESIDUE=0
POOL_RESIDUE=0
TIMER_LISTENER_RESIDUE=0
CHILD_PROCESS_RESIDUE=0
TEMP_COMPILE_DIRECTORY_RESIDUE=0
TEMPORARY_ROLE_PASSWORD_REMOVED=PASS
FIXTURE_RESIDUE=0
ACL_FIXTURE_RESIDUE=0
ACL_CONTAMINATION_RESIDUE=0
ROLE_MEMBERSHIP_CONTAMINATION_RESIDUE=0
ENV_LOCAL_DIFF=0
PACKAGE_LOCK_DIFF=0
```

No unrelated service was started, stopped, or modified.

## Changed Files

Expected changed files:

```text
M  supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql
?? docs/09-governance/NEW_P5_T04_05_R3_RELATION_ACL_TEST_REMEDIATION_REPORT.md
```

Unchanged boundaries:

```text
MIGRATION_DIFF=0
OTHER_PGTAP_DIFF=0
SOURCE_RUNTIME_PACKAGE_DIFF=0
PACKAGE_LOCK_DIFF=0
GENERATED_TYPES_DIFF=0
APP_ADMIN_DIFF=0
GITHUB_WORKFLOW_DIFF=0
ENVIRONMENT_FILE_DIFF=0
```

## Git Status

```text
WORKING_TREE_CHANGED_FILES=2
STAGING=empty
COMMIT=not performed
PUSH=not performed
REMOTE_BRANCH=absent
PR=absent
```

## Next Step

Review and commit the two R3 remediation files when ready. After that, rerun the
P5-T04-05 branch closeout/PR readiness flow.

## Final Status

```text
FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_RELATION_ACL_TEST_REMEDIATION_READY
```
