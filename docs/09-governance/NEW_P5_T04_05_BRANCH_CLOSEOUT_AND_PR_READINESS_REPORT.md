# NEW-P5-T04-05 Final Branch Closeout and PR Readiness

## 1. Status

P5-T04 custody balance observer orchestrator branch closeout completed after the R3 relation OID ACL test remediation.

```text
PR_READINESS=READY
MERGE_METHOD=MERGE_COMMIT
```

## 2. Worktree / Branch / HEAD

```text
Worktree: D:\Ai\staking-wallet-web
Repository: paul-IM-78/fix-new-p5-phase2-runtime-supervisor
Branch: feat/p5-t04-custody-observer-orchestrator
Start HEAD: d71548b8a21b9b83e803fcc38234cc0826033be0
Final HEAD: d71548b8a21b9b83e803fcc38234cc0826033be0
HEAD parent: 73a3158d9954e1c2a823ff5e1daea26a2f2f8506
Working tree before report: clean
Staging before report: empty
```

## 3. Main and Merge-base

```text
origin/main: e931dd173e0ab5005a386bf91c8e1276a74bcec4
merge-base: e931dd173e0ab5005a386bf91c8e1276a74bcec4
origin/main ancestor: true
local commits over origin/main: 5
remote feature branch: absent
PR: absent
```

## 4. P5-T04 Commit History

The branch contains exactly five commits over `origin/main`, in this order:

1. `43b78195299658568afd46cb466a383672054f63` - `docs(governance): define custody observer orchestrator contract`
2. `9f23d59c3d09c526276818502288277180fcf839` - `feat(custody): add observer scope discovery commands`
3. `f858bac5ad6934d008018a21d4273cee88b9119e` - `feat(custody): add observer scope client`
4. `73a3158d9954e1c2a823ff5e1daea26a2f2f8506` - `feat(custody): add one-shot observer orchestrator`
5. `d71548b8a21b9b83e803fcc38234cc0826033be0` - `test(custody): stabilize observer relation ACL checks`

No unexpected commit, merge commit, graph divergence, rebase residue, remote feature branch, or PR was found.

## 5. Branch Changed-file Inventory

`git diff --name-status origin/main...HEAD` contains exactly 13 committed changed files.

```text
A docs/09-governance/NEW_P5_T04_01_CUSTODY_OBSERVER_ORCHESTRATOR_CONTRACT.md
A docs/09-governance/NEW_P5_T04_02_SCOPE_DISCOVERY_DB_REPORT.md
A docs/09-governance/NEW_P5_T04_03_SCOPE_CLIENT_REPORT.md
A docs/09-governance/NEW_P5_T04_04_ONE_SHOT_ORCHESTRATOR_REPORT.md
A docs/09-governance/NEW_P5_T04_05_R3_RELATION_ACL_TEST_REMEDIATION_REPORT.md
M package.json
A scripts/test-p5-t04-custody-balance-observer-orchestrator-runtime.mjs
A scripts/test-p5-t04-custody-observer-scope-client-runtime.mjs
A src/server/custody/balance-observer-orchestrator.ts
A src/server/custody/balance-observer-scope-client.ts
A supabase/migrations/20260802090000_p5_t04_scope_discovery.sql
M supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql
A supabase/tests/database/p5_t04_scope_discovery.test.sql
```

Inventory checks:

```text
COMMITTED_CHANGED_FILE_COUNT=13
NEW_FILES=11
MODIFIED_FILES=2
DELETED_FILES=0
RENAMED_FILES=0
FILE_MODE_CHANGES=0
PACKAGE_LOCK_DIFF=0
GENERATED_TYPE_DIFF=0
APP_ADMIN_UI_DIFF=0
GITHUB_WORKFLOW_DIFF=0
ENVIRONMENT_FILE_DIFF=0
```

## 6. Contract Traceability

The P5-T04-01 contract markers were preserved and traced through DB implementation, TypeScript implementation, runtime evidence, and final validation.

```text
ORCHESTRATOR_EXECUTION_MODE=ONE_SHOT_EXPLICIT_INVOCATION
ORCHESTRATOR_RUNTIME=SERVER_ONLY_NODE
ORCHESTRATOR_WORK_UNIT=PROVIDER_ASSET
ORCHESTRATOR_ATOMIC_COMMIT_UNIT=BINDING_OBSERVATION
SCOPE_DISCOVERY_AUTHORIZATION=SEPARATE_DEDICATED_POSTGRES_LOGIN_ROLE
SCOPE_READER_ROLE_LOGICAL_NAME=custody_observer_scope_reader
SCOPE_READER_DB_CONNECTION=DIRECT_POSTGRES
SCOPE_READER_ACCESS=EXECUTE_ONLY_SECURITY_DEFINER_READ_COMMANDS
WRITE_ROLE_LOGICAL_NAME=custody_observer_worker
WRITE_ROLE_ACCESS=ATOMIC_OBSERVATION_COMMAND_ONLY
ORCHESTRATOR_DB_CREDENTIAL_MODEL=SEPARATE_READ_AND_WRITE_CREDENTIALS
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
SCOPE_REFRESH_RERUN=ONLY_AFFECTED_BINDINGS
MAX_SCOPE_REFRESH_ATTEMPTS=1
DEFAULT_PROVIDER_CONCURRENCY=1
MAX_PROVIDER_CONCURRENCY=4
SAME_PROVIDER_ASSET_EXECUTION=SEQUENTIAL
ADAPTER_FACTORY=INJECTED_SERVER_ONLY
ADAPTER_INSTANCE_LIFETIME=ONE_INSTANCE_PER_PROVIDER_PER_RUN
ORCHESTRATOR_WHOLE_RUN_TRANSACTION=PROHIBITED
```

## 7. Scope Reader Authorization

Role: `custody_observer_scope_reader`

Allowed:

- target database `CONNECT`
- private schema `USAGE`
- `private.list_balance_observer_scope_page(uuid, uuid, integer)` execute
- `private.read_balance_observer_scope(uuid, uuid)` execute

Prohibited and tested:

- database/schema `CREATE`
- direct `TEMP`
- grant option
- role membership
- object ownership
- public/private table privilege
- public/private column privilege
- public/private sequence privilege
- atomic write command execute
- unrelated function execute

Closed-world assertions block public, anon, authenticated, service-role, and worker cross-role execution paths.

## 8. Observer Worker Authorization

Role: `custody_observer_worker`

Allowed:

- atomic observation/checkpoint command execute

Prohibited and tested:

- scope list command execute
- exact refresh command execute
- direct relation privilege
- direct column privilege
- direct sequence privilege
- unrelated function execute
- ownership, membership, and grant option

The R3 pgTAP remediation preserves the closed-world relation ACL contract using OID-based privilege evaluation. Production migrations and production authorization assertions were not changed by R3.

## 9. Read/write Credential Separation

Scope discovery and observation writing remain separated:

- scope reader: dedicated direct PostgreSQL login, independent Pool, read-only SECURITY DEFINER commands
- worker: dedicated direct PostgreSQL login, independent Pool, atomic observation command only
- application service-role client: not used
- browser Supabase client: not used
- environment or connection-string fallback in production source: 0

## 10. Scope Discovery DB Commands

DB command checks passed:

```text
private.list_balance_observer_scope_page(uuid, uuid, integer)=PRESENT
private.read_balance_observer_scope(uuid, uuid)=PRESENT
VOLATILITY=STABLE
SECURITY_DEFINER=true
SEARCH_PATH_EMPTY=true
READ_ONLY=true
APPROVED_PROVIDER_REQUIRED=true
BALANCE_OBSERVATION_CAPABILITY_REQUIRED=true
APPROVED_BINDING_REQUIRED=true
ACTIVE_ASSET_REQUIRED=true
MISSING_CHECKPOINT_VERSION=0
PROVIDER_ASSET_KEYSET_PAGINATION=true
OFFSET_PAGINATION=0
SCOPE_SPLIT=0
TERMINAL_PAGE_ROWS=0
EXACT_CURRENT_SCOPE_REFRESH=true
```

## 11. Scope Client

The direct PostgreSQL scope client was validated as server-only and credential-isolated.

```text
SERVER_ONLY=true
DEDICATED_DIRECT_POSTGRES_CONFIG=true
INDEPENDENT_POOL=true
STATIC_PARAMETERIZED_SQL=true
ENVIRONMENT_FALLBACK=0
CONNECTION_STRING=0
SERVICE_ROLE_CLIENT=0
TRANSACTION=0
INTERNAL_RETRY=0
STRICT_INPUT_VALIDATION=true
UNTRUSTED_ROW_VALIDATION=true
CANONICAL_UUID=true
CHECKPOINT_BIGINT_STRING=true
DUPLICATE_DETECTION=true
DETERMINISTIC_GROUPING_AND_ORDER=true
SAFE_ERROR_MAPPING=true
POOL_CLOSE_IDEMPOTENT=true
```

Runtime evidence: `SCOPE_CLIENT_RUNTIME_CASE_COUNT=88`.

## 12. One-shot Orchestrator

The one-shot orchestrator was validated as explicit-invocation-only, discovery-first, and server-only.

```text
EXPLICIT_INVOCATION_ONLY=true
IMPORT_SIDE_EFFECTS=0
CRON_SCHEDULER_QUEUE_DAEMON=0
DISCOVERY_FIRST_EXECUTION=true
PAGE_READS_SEQUENTIAL=true
SCOPE_READ_RETRY=OPTIONAL_BOUNDED
PROVIDER_GROUPING=true
ADAPTER_FACTORY_PER_PROVIDER=1
ADAPTER_INSTANCE_PER_PROVIDER=1
CROSS_PROVIDER_CONCURRENCY_MAX=4
SAME_PROVIDER_CONCURRENCY_MAX=1
WORKER_WORK_UNIT_INTEGRATION=true
AFFECTED_BINDING_TARGETED_REFRESH=true
SECOND_REFRESH=0
NO_LONGER_ELIGIBLE_HANDLING=true
REFRESH_FAILURE_ISOLATION=true
ABORT_BOUNDARIES=true
DETERMINISTIC_OUTCOME_ORDER=true
DETERMINISTIC_SUMMARY=true
WHOLE_RUN_TRANSACTION=0
POOL_SQL_CREDENTIAL_DIRECT_OWNERSHIP=0
```

Runtime evidence: `ORCHESTRATOR_RUNTIME_CASE_COUNT=269`.

## 13. Pagination and Exact Refresh

Scope pagination and exact refresh match the contract:

- deterministic keyset pagination by provider id and asset id
- provider+asset is the page unit
- binding rows do not split one provider+asset scope across pages
- OFFSET pagination is prohibited
- checkpoint projection uses missing checkpoint version `0`
- exact refresh targets only the affected provider+asset scope
- successful rerun is limited to affected bindings

## 14. Provider Concurrency

Provider execution is bounded and deterministic:

```text
DEFAULT_PROVIDER_CONCURRENCY=1
MAX_PROVIDER_CONCURRENCY=4
MAX_CROSS_PROVIDER_CONCURRENCY=4
MAX_SAME_PROVIDER_CONCURRENCY=1
SAME_PROVIDER_ASSET_EXECUTION=SEQUENTIAL
```

## 15. Abort and Retry

Runtime coverage confirms:

- invalid input causes zero run side effects
- discovery retry is bounded
- refresh retry is bounded
- second checkpoint conflict fails closed
- abort before discovery avoids scope reads and DB writes
- abort during retry delay stops factory and worker execution
- abort during execution marks pending scopes deterministically
- refresh abort prevents rerun

## 16. Client Lifecycle and Cleanup Failures

Scope and command clients are both closed. Close failures are preserved in the final result without losing execution outcomes.

Observed combinations:

- both close success
- scope close failure
- command close failure
- both close failure
- discovery failure plus close failures

## 17. Real DB First-run Evidence

Orchestrator real DB evidence:

```text
REAL_DB_ONE_SHOT_RUN_COUNT=2
FIRST_RUN_OBSERVATION_ROW_DELTA=2
FIRST_RUN_CHECKPOINT_ROW_DELTA=2
FIRST_RUN_DUPLICATE_OBSERVATION_GROUPS=0
FIRST_RUN_UNRELATED_DURABLE_DELTA=0
FIRST_RUN_CONFIGURATION_MUTATION=0
```

## 18. Fresh-client Replay Evidence

Replay evidence from fresh clients:

```text
REAL_DB_EXACT_REPLAY_RUN_COUNT=1
REPLAY_OBSERVATION_ROW_DELTA=0
REPLAY_DUPLICATE_OBSERVATION_DELTA=0
REPLAY_CHECKPOINT_ROW_DELTA=0
REPLAY_CHECKPOINT_VERSION_DELTA=0
REPLAY_UNRELATED_DURABLE_TABLE_DELTA=0
```

## 19. Durable-table Invariants

Durable table invariants were preserved:

- exact replay created no duplicate observations
- exact replay advanced no checkpoints
- unrelated durable tables were unchanged
- invalid input and invalid concurrency paths produced zero DB side effects
- production service-role application usage remained zero

## 20. Previous Intermittent DB Failures

R3 documented two reproducible intermittent failures in the pre-remediation text-based pgTAP ACL check.

```text
DB_VALIDATION_EVENT=INTERMITTENT_REPRODUCIBLE_TEST_FAILURE
DB_VALIDATION_FAILURE_OCCURRENCES=2
FAILING_PGTAP=supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql
FAILING_ASSERTION_PURPOSE=custody observer worker has no direct private table privileges
SECRET_ROW_LOOKUP=0
DECRYPTED_VALUE_LOOKUP=0
```

The observed failure referenced a missing private relation name during test-only relation reconstruction. No secret or decrypted rows were queried.

## 21. Relation ACL pgTAP Remediation

R3 replaced text-based private relation reconstruction with existing relation OID evaluation.

```text
DB_VALIDATION_TEST_DEFECT=TEXT_RELATION_RECONSTRUCTION
DB_VALIDATION_REMEDIATION=PG_CLASS_OID_PRIVILEGE_CHECK
PRODUCTION_DB_CONTRACT_DEFECT_IDENTIFIED=false
UNDERLYING_TOOLING_TIMING_ROOT_CAUSE=UNRESOLVED
HARDCODED_RELATION_EXCLUSIONS=0
```

Removed test-only pattern:

- `information_schema.tables`
- `'private.' || table_name`
- text relation name reparse

Added test-only pattern:

- `pg_catalog.pg_class`
- `pg_catalog.pg_namespace`
- relation OID
- `pg_catalog.has_table_privilege(role, classes.oid, privilege)`

Coverage preserved:

```text
RELKIND_COVERAGE=r,p,v,m,f
PRIVILEGE_COVERAGE=SELECT,INSERT,UPDATE,DELETE
EXPECTED_CONTAMINATION_COUNT=0
PRODUCTION_MIGRATION_DIFF=0
PRODUCTION_ASSERTION_DIFF=0
```

No hardcoded Vault or decrypted relation exclusions were added.

## 22. Target pgTAP Result

Targeted pgTAP command:

```text
npm exec -- supabase test db --local supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql
```

Result:

```text
TARGET_PGTAP_FILES=1
TARGET_PGTAP_TESTS=46
TARGET_PGTAP_RESULT=PASS
TARGET_PGTAP_MISSING_RELATION_ERROR=0
TARGET_PGTAP_ASSERTION_FAILURE=0
```

## 23. Same-instance Final DB Matrix

Same-instance matrix used one reset and three consecutive full pgTAP runs without resetting between runs.

```text
SAME_INSTANCE_FINAL_RUNS=3
SAME_INSTANCE_FINAL_PASSES=3
SAME_INSTANCE_FINAL_FAILURES=0
SAME_INSTANCE_FILES_PER_RUN=31
SAME_INSTANCE_TESTS_PER_RUN=1470
SAME_INSTANCE_SKIPS_PER_RUN=0
SAME_INSTANCE_TAP_PARSE_ERRORS=0
SAME_INSTANCE_MISSING_RELATION_ERRORS=0
```

## 24. Fresh-instance Final DB Matrix

Fresh-instance matrix used three isolated start/reset/lint/test/stop cycles.

```text
FRESH_INSTANCE_FINAL_CYCLES=3
FRESH_INSTANCE_FINAL_PASSES=3
FRESH_INSTANCE_FINAL_FAILURES=0
FRESH_INSTANCE_FILES_PER_CYCLE=31
FRESH_INSTANCE_TESTS_PER_CYCLE=1470
FRESH_INSTANCE_SKIPS_PER_CYCLE=0
FRESH_INSTANCE_TAP_ERRORS=0
FRESH_INSTANCE_MISSING_RELATION_ERRORS=0
```

## 25. Final DB Validation

Final DB validation:

```text
DB_RESET=PASS
DB_LINT_ERRORS=0
DB_LINT_WARNINGS=0
FINAL_DB_TEST_FILES=31
FINAL_DB_TEST_TESTS=1470
FINAL_DB_TEST_FAILURES=0
FINAL_DB_TEST_SKIPS=0
GENERATED_TYPE_DIFF=0
FINAL_DB_MISSING_RELATION_ERROR=0
FINAL_DB_TAP_PARSE_ERROR=0
```

## 26. Runtime Validation

Runtime validation:

```text
ORCHESTRATOR_RUNTIME_CASE_COUNT=269
ORCHESTRATOR_RUNTIME_RESULT=PASS
SCOPE_CLIENT_RUNTIME_CASE_COUNT=88
SCOPE_CLIENT_RUNTIME_RESULT=PASS
ADAPTER_RUNTIME_CASE_COUNT=74
ADAPTER_RUNTIME_RESULT=PASS
WORKER_RUNTIME_CASE_COUNT=62
WORKER_RUNTIME_RESULT=PASS
RESILIENCE_RUNTIME_CASE_COUNT=62
RESILIENCE_RUNTIME_RESULT=PASS
```

Network and credential guard evidence:

```text
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_USAGE=0
```

## 27. TypeScript / Lint / Build

Static and build gates:

```text
TYPESCRIPT_NOEMIT=PASS
LINT=PASS
LINT_WARNINGS=0
BUILD=PASS
```

Next build reported the `.env.local` filename as an environment source but no values were printed in this report.

## 28. Custody Boundary

Custody boundary integration:

```text
CUSTODY_BOUNDARY=PASS
CUSTODY_HTTP_SMOKE=PASS
CUSTODY_SAME_ORIGIN_REJECTION=PASS
CUSTODY_AUTHORIZATION_BLOCKS=PASS
CUSTODY_CONCURRENT_REPLAY=PASS
CUSTODY_UNSUPPORTED_NETWORK_BOUNDARY=PASS
CUSTODY_READ_RPCS=PASS
CUSTODY_AUDIT_SAFETY=PASS
CUSTODY_DATABASE_STATE_MACHINE=PASS
PROCESS_CLEANUP=PASS
```

## 29. Audits

```text
NPM_AUDIT_PRODUCTION_VULNERABILITIES=0
NPM_AUDIT_FULL_VULNERABILITIES=0
```

## 30. Package Diff

Allowed package diff contains only the two P5-T04 local runtime scripts.

```text
PACKAGE_JSON_SCRIPT_ADDITIONS=2
PACKAGE_JSON_EXISTING_SCRIPT_DELETIONS=0
PACKAGE_JSON_DEPENDENCY_DIFF=0
PACKAGE_JSON_DEV_DEPENDENCY_DIFF=0
PACKAGE_JSON_OVERRIDES_DIFF=0
PACKAGE_LOCK_DIFF=0
PACKAGE_FILE_MODE_CHANGE=0
```

Added scripts:

```text
test:custody:balance-observer-scope-client:local
test:custody:balance-observer-orchestrator:local
```

## 31. Production Source Boundary

Production source boundary scan covered:

- `src/server/custody/balance-observer-scope-client.ts`
- `src/server/custody/balance-observer-orchestrator.ts`

Results:

```text
PROCESS_ENV_REFERENCES=0
CONNECTION_STRING_REFERENCES=0
DATABASE_URL_REFERENCES=0
SUPABASE_URL_REFERENCES=0
SERVICE_ROLE_APPLICATION_CLIENT=0
BROWSER_SUPABASE_CLIENT=0
FETCH_OR_PROVIDER_NETWORK=0
AXIOS_OR_HTTP_CLIENT=0
PUBLIC_API_ROUTE=0
ADMIN_UI_CHANGE=0
CREDENTIAL_LOGGING=0
PROVIDER_PAYLOAD_LOGGING=0
RAW_CHECKPOINT_IDENTITY_LOGGING=0
FULL_OBSERVATION_KEY_LOGGING=0
ORCHESTRATOR_NEW_POOL=0
ORCHESTRATOR_SQL_STATEMENT=0
ORCHESTRATOR_CRON_SCHEDULER_QUEUE_DAEMON=0
SCOPE_CLIENT_WRITE_COMMAND_CALL=0
SCOPE_CLIENT_TRANSACTION=0
SCOPE_CLIENT_INTERNAL_RETRY=0
```

## 32. Network and Credential Counts

Runtime and source guard totals:

```text
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
LOCAL_POSTGRES_CONNECTIONS=EXPECTED_LOCAL_ONLY
```

No production provider credentials, production network calls, wallet signing, mnemonic, private key, or provider endpoint implementation was added.

## 33. Secret Scan

Secret scan covered the branch diff, changed file contents, migration, pgTAP, source files, runtime harnesses, governance reports, package diff, and this closeout report draft.

```text
SECRET_SCAN_JWT_COUNT=0
SECRET_SCAN_DB_URL_COUNT=0
SECRET_SCAN_SUPABASE_KEY_COUNT=0
SECRET_SCAN_PRIVATE_KEY_COUNT=0
SECRET_SCAN_MNEMONIC_LIKE_COUNT=0
SECRET_SCAN_COOKIE_SESSION_COUNT=0
SECRET_SCAN_ACCESS_REFRESH_TOKEN_COUNT=0
SECRET_SCAN_EMAIL_COUNT=0
SECRET_SCAN_WALLET_ADDRESS_HEX_COUNT=0
SECRET_SCAN_PROVIDER_ENDPOINT_COUNT=0
SECRET_SCAN_FULL_OBSERVATION_KEY_COUNT=0
SECRET_SCAN_TOTAL=0
ENV_FILE_CONTENT_OUTPUT=0
```

Object names such as `decrypted_secrets` were treated as schema identifiers, not secret values.

## 34. Cleanup

Final cleanup:

```text
SUPABASE_STOP=PASS
STAKING_WALLET_WEB_SUPABASE_RUNNING_CONTAINERS=0
PORT_3000_LISTENERS=0
PORT_3010_LISTENERS=0
PORT_55721_LISTENERS=0
PORT_55722_LISTENERS=0
PORT_55723_LISTENERS=0
PORT_55724_LISTENERS=0
POSTGRESQL_SOCKET_RESIDUE=0
SCOPE_POOL_RESIDUE=0
COMMAND_POOL_RESIDUE=0
TIMER_LISTENER_RESIDUE=0
CHILD_PROCESS_RESIDUE=0
FIXTURE_RESIDUE=0
ACL_FIXTURE_RESIDUE=0
ACL_CONTAMINATION_RESIDUE=0
ROLE_MEMBERSHIP_CONTAMINATION_RESIDUE=0
ENV_LOCAL_DIFF=0
PACKAGE_LOCK_DIFF=0
```

Unrelated Supabase containers from other local projects were observed but not started, stopped, deleted, or modified.

## 35. Deferred Scope

The following are intentionally deferred and must not be represented as complete production automation:

- production custodian/exchange adapters
- production provider network
- production provider credentials
- secret-manager selection
- credential rotation
- cron
- scheduler
- queue
- daemon
- always-on deployment
- durable failure ledger
- alerting
- automatic reconciliation trigger
- transfer observation
- payout submission
- wallet signing
- webhook ingestion
- public API
- admin UI
- production deployment manifest

## 36. PR Readiness

The branch is ready for a PR to `main`.

```text
PR_TARGET_BASE=main
PR_TARGET_HEAD=feat/p5-t04-custody-observer-orchestrator
PR_READINESS=READY
REMOTE_FEATURE_BRANCH=absent
PR_CREATED=false
PUSH_PERFORMED=false
```

## 37. PR Target

Base branch: `main`

Head branch: `feat/p5-t04-custody-observer-orchestrator`

The repository default branch does not change this recommendation. The PR base should be `main`.

## 38. PR Title

Recommended PR title:

```text
feat(custody): add balance observer orchestration runtime
```

## 39. PR Body Draft

```markdown
## Summary

- add a dedicated read-only PostgreSQL scope-reader role and closed-world ACL assertion
- add deterministic provider-and-asset scope discovery and exact refresh commands
- add a server-only direct PostgreSQL scope client with strict untrusted-row validation
- add a discovery-first one-shot custody balance observer orchestrator
- add bounded cross-provider concurrency and same-provider sequencing
- add targeted checkpoint-conflict refresh for affected bindings only
- stabilize relation ACL pgTAP checks with catalog OID privilege evaluation

## Security boundaries

- separate scope-reader and observation-writer login roles, credentials, and Pools
- no service-role or browser runtime
- no environment or connection-string fallback
- no direct table privileges for runtime roles
- no provider network or production credential integration
- no scheduler, queue, cron, daemon, payout, signing, or webhook implementation

## Validation

- orchestrator runtime: 269 cases PASS
- scope client runtime: 88 cases PASS
- adapter runtime: 74 cases PASS
- worker runtime: 62 cases PASS
- resilience runtime: 62 cases PASS
- target ACL pgTAP: 1 file / 46 tests PASS
- pgTAP: 31 files / 1470 tests / failures 0 / skips 0
- same-instance repeated DB tests: 3/3 PASS
- fresh-instance DB cycles: 3/3 PASS
- R3 pre-commit stability: same-instance 5/5 and fresh-instance 5/5 PASS
- generated DB type diff: 0
- TypeScript noEmit: PASS
- lint: PASS, warnings 0
- build: PASS
- custody boundary: PASS
- production/full audits: 0 vulnerabilities
- external/provider network calls: 0
- credential environment reads: 0
- service-role application usage: 0
- cleanup and secret scan: PASS

## Relation ACL test remediation

Two intermittent pgTAP failures were traced to text-based relation-name
reconstruction inside a test-only ACL assertion. The assertion now evaluates
existing private relations by `pg_class` OID while preserving table, partition,
view, materialized-view, foreign-table and SELECT/INSERT/UPDATE/DELETE coverage.

No relation-name exclusions were added, and no production migration or
authorization assertion was changed. The underlying tooling/catalog timing
cause remains unresolved.

## Deferred

- production provider adapters and credentials
- secret-manager selection and rotation
- scheduler, queue, cron, daemon, and deployment wiring
- durable failure ledger and alerting
- automatic reconciliation triggering
- transfer observation, payout, signing, and webhook ingestion
```

## 40. Merge Recommendation

```text
MERGE_METHOD=MERGE_COMMIT
```

Reason:

- preserves the contract commit
- preserves the scope DB command commit
- preserves the scope client commit
- preserves the orchestrator implementation commit
- preserves the R3 relation ACL test stabilization commit

No merge was performed in this step.

## 41. Changed Files

This closeout step creates exactly one new working-tree file:

```text
docs/09-governance/NEW_P5_T04_05_BRANCH_CLOSEOUT_AND_PR_READINESS_REPORT.md
```

Existing file modifications in this closeout step: `0`

## 42. Git Status

Expected final working-tree status after report creation:

```text
?? docs/09-governance/NEW_P5_T04_05_BRANCH_CLOSEOUT_AND_PR_READINESS_REPORT.md
```

Expected staging: empty

## 43. Commit / Push / Remote Branch / PR Status

```text
STAGING=empty
COMMIT_CREATED=false
PUSH_PERFORMED=false
REMOTE_FEATURE_BRANCH_CREATED=false
PR_CREATED=false
MERGE_PERFORMED=false
```

## 44. Next Step

Next single recommended action:

1. Commit this closeout report only.
2. Push `feat/p5-t04-custody-observer-orchestrator`.
3. Open a PR to base `main` using the recommended title and body.

## 45. Final Status

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_ORCHESTRATOR_BRANCH_CLOSEOUT_READY
