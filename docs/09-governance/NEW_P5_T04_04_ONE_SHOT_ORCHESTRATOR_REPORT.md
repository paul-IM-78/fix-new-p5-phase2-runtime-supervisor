# NEW-P5-T04-04 One-shot Orchestrator Report

## 1. Baseline

| Item | Value |
| --- | --- |
| Worktree | `D:\Ai\staking-wallet-web` |
| Branch | `feat/p5-t04-custody-observer-orchestrator` |
| Start HEAD | `f858bac5ad6934d008018a21d4273cee88b9119e` |
| Final HEAD | `f858bac5ad6934d008018a21d4273cee88b9119e` |
| Parent | `9f23d59c3d09c526276818502288277180fcf839` |
| origin/main | `e931dd173e0ab5005a386bf91c8e1276a74bcec4` |
| Commits over origin/main | `3` |
| Remote feature branch | `absent` |
| PR | `absent` |
| Staging | `empty` |
| Commit/push/PR | `not performed` |

## 2. Changed Files

| Path | Purpose |
| --- | --- |
| `src/server/custody/balance-observer-orchestrator.ts` | Server-only one-shot orchestrator for scope discovery, provider grouping, worker execution, targeted refresh, abort, and cleanup ownership. |
| `scripts/test-p5-t04-custody-balance-observer-orchestrator-runtime.mjs` | Local runtime harness for source boundaries, DB-backed smoke, deterministic orchestration cases, refresh, abort, cleanup, and secret-safe output. |
| `package.json` | Added `test:custody:balance-observer-orchestrator:local`. |
| `docs/09-governance/NEW_P5_T04_04_ONE_SHOT_ORCHESTRATOR_REPORT.md` | This report. |

No `package-lock.json`, `supabase/**`, `src/types/database.types.ts`,
`src/app/**`, or `src/server/admin/**` content diff was introduced.

## 3. Orchestrator Contract

Implemented entry point:

```text
runCustodyBalanceObserverOneShot(input)
```

Source boundary:

```text
SERVER_ONLY_FIRST_LINE=PASS
POOL_CREATION=0
ENVIRONMENT_FALLBACK=0
CONNECTION_STRING=0
SUPABASE_CLIENT=0
BROWSER_CLIENT=0
FETCH_PROVIDER_NETWORK=0
PROCESS_EXIT=0
CRON_DAEMON_SCHEDULER=0
AUTO_RUN_ON_IMPORT=0
```

Injected inputs only:

```text
scopeClient
commandClient
adapterFactory
identityPolicy
workerRetryPolicy
scopeReadRetryPolicy
scopeReadRetryRuntime
workerRetryRuntime
concurrencyPolicy
pageLimit
maxDiscoveryPages
runtime.runWorkUnit
signal
```

The orchestrator rejects invalid input before scope reads, adapter factory
calls, worker calls, or DB write attempts. The same object cannot be reused as
both scope reader and writer command client.

## 4. Discovery and Execution

Discovery contract:

```text
DISCOVERY_FIRST=PASS
PAGE_READS=SEQUENTIAL_ONLY
PAGINATION=KEYSET_CURSOR
OFFSET=0
PAGE_LIMIT_RANGE=1..200
MAX_DISCOVERY_PAGES_RANGE=1..1000
CURSOR_LOOP_REJECTED=PASS
DUPLICATE_SCOPE_REJECTED=PASS
PROVIDER_REF_CONFLICT_REJECTED=PASS
```

Execution contract:

```text
WORK_UNIT=PROVIDER_ASSET_SCOPE
ADAPTER_FACTORY_CALLS=ONCE_PER_PROVIDER_PER_RUN
SAME_PROVIDER_SCOPES=SEQUENTIAL
DIFFERENT_PROVIDER_CONCURRENCY=BOUNDED_1_TO_4
DEFAULT_PROVIDER_CONCURRENCY=1
OUTCOME_ORDER=DISCOVERY_ORDER
WORKER_RESULT_TREATED_UNTRUSTED=PASS
RAW_ERROR_STACK_PAYLOAD_OUTPUT=0
```

Targeted refresh contract:

```text
REFRESH_TRIGGER=requiresScopeRefresh
MAX_REFRESH_PER_SCOPE=1
REFRESH_READ_COMMAND=readBalanceObserverScope
RERUN_BINDINGS=AFFECTED_BINDINGS_ONLY
UNRELATED_INITIAL_SUCCESS_RERUN=0
SECOND_REFRESH_CONFLICT=FAIL_CLOSED
SCOPE_NO_LONGER_ELIGIBLE_CODE=SCOPE_NO_LONGER_ELIGIBLE
SCOPE_REFRESH_FAILURE_CODE=SCOPE_REFRESH_FAILED
```

Client lifecycle:

```text
PASSED_CLIENTS_OWNED_AFTER_VALID_INPUT=PASS
CLOSE_ORDER=scope_then_command
CLOSE_ATTEMPTS_PER_CLIENT=1
ONE_CLOSE_FAILURE_DOES_NOT_SKIP_OTHER=PASS
CLOSE_FAILURE_STATUS=FAILED_CLEANUP
```

## 5. Runtime Harness Result

Command:

```text
npm run test:custody:balance-observer-orchestrator:local
```

Result:

```text
CUSTODY_BALANCE_OBSERVER_ORCHESTRATOR_RUNTIME_PASS
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
LOCAL_POSTGRES_CONNECTIONS=6
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
```

R1 remediation evidence:

```text
ORCHESTRATOR_SOURCE_R1_MODIFIED=NO
R1_SCOPE=HARNESS_AND_REPORT_EVIDENCE
REAL_DB_FIRST_RUN=PASS
REAL_DB_EXACT_REPLAY_FRESH_CLIENTS=PASS
CHECKPOINT_CREATE_EVIDENCE=PASS
CHECKPOINT_ADVANCE_EVIDENCE=PASS
DUPLICATE_OBSERVATION_GROUPS=0
UNRELATED_DURABLE_TABLE_DELTA=0
SERVICE_ROLE_APPLICATION_USAGE=0
PROVIDER_CONCURRENCY_4=PASS
INVALID_PROVIDER_CONCURRENCY_REJECTED_BEFORE_SIDE_EFFECTS=PASS
RETRY_DELAY_ABORT=PASS
PROVIDER_EXECUTION_ABORT=PASS
EXACT_REFRESH_ABORT=PASS
CLOSE_FAILURE_COMBINATION_MATRIX=PASS
```

The R1 source review did not reproduce an orchestrator implementation defect.
The remediation closed evidence gaps in the runtime harness and report while
preserving the existing one-shot source contract.

Covered cases:

- source boundary scan
- Supabase start/reset/stop
- synthetic DB fixtures and cleanup
- ephemeral scope-reader and worker credentials set/clear
- direct scope-reader login
- direct worker login
- scope-reader direct table read rejection
- worker scope-list execute rejection
- real DB one-shot with actual scope client, command client, worker, and mock adapter
- real DB first run side effect bounded to two inserted observations
- real DB checkpoint creation for a new binding
- real DB checkpoint advancement for an existing binding
- real DB exact replay with fresh scope and command clients
- exact replay observation row delta 0
- exact replay duplicate observation group delta 0
- exact replay checkpoint row and version delta 0
- unrelated durable table delta 0
- invalid input safe errors
- invalid provider concurrency values rejected before scope, worker, factory, or DB side effects
- multi-page discovery and cursor propagation
- page metadata, cursor loop, page limit, duplicate scope, and provider ref conflict rejection
- discovery retry and non-retry boundaries
- one adapter per provider
- same-provider sequential execution
- provider concurrency bounded to 2 in runtime case
- provider concurrency bounded to 4 in runtime case
- deterministic outcome order
- adapter factory throw and provider mismatch isolation
- malformed worker result and worker throw sanitization
- targeted refresh success, missing resource, refresh read failure, refresh retry, and second-conflict fail-closed cases
- pre-abort, discovery abort, retry-delay abort, provider execution abort, and exact refresh abort boundaries
- close failure cleanup status and success/scope/command/both/discovery-failure close combinations
- default worker integration with checkpoint observation key mode
- no external/provider network
- no credential environment reads
- no application service-role usage
- temp runtime cleanup
- safe output scan

## 6. Regression Validation

| Command | Result |
| --- | --- |
| `node --check scripts/test-p5-t04-custody-balance-observer-orchestrator-runtime.mjs` | `PASS` |
| `npx tsc --noEmit --pretty false --incremental false` | `PASS` |
| `npm run test:custody:balance-observer-orchestrator:local` | `PASS`, `269 cases` |
| `node --check scripts/test-p5-t04-custody-observer-scope-client-runtime.mjs` | `PASS` |
| `npm run test:custody:balance-observer-scope-client:local` | `PASS`, `88 cases` |
| `node --check scripts/test-p5-t03-custody-balance-adapter-runtime.mjs` | `PASS` |
| `npm run test:custody:balance-adapter:local` | `PASS`, `74 cases` |
| `node --check scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs` | `PASS` |
| `npm run test:custody:balance-observer-worker:local` | `PASS`, `62 cases` |
| `node --check scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs` | `PASS` |
| `npm run test:custody:balance-observer-resilience:local` | `PASS`, `62 cases` |
| `npm run supabase:start` | `PASS` |
| `npm run db:reset:local` | `PASS` |
| `npm run db:lint:local` | `PASS`, schema errors `0` |
| `npm run db:test:local` | `PASS`, `31 files / 1470 tests` |
| `npm run db:types:local` | `PASS` |
| `git diff -- src/types/database.types.ts` | content diff `0` |
| `npm run supabase:stop` | `PASS` |
| `npm run lint` | `PASS`, warning `0` |
| `npm run build` | `PASS` |
| `npm run test:custody:boundary:local` | `PASS` |
| `npm audit --omit=dev` | vulnerabilities `0` |
| `npm audit` | vulnerabilities `0` |
| `git diff --check` | `PASS`; CRLF warnings only |

Notes:

- Supabase CLI local development credential metadata was not copied into this
  report.
- Build observed the existing `.env.local` file by name only. No `.env*`
  content was read into this report.

## 7. Restricted Diff and Cleanup

| Boundary | Result |
| --- | --- |
| `supabase/**` diff | `0` |
| `src/types/database.types.ts` diff | `0` |
| `src/app/**` diff | `0` |
| `src/server/admin/**` diff | `0` |
| `package-lock.json` diff | `0` |
| Existing P5-T03 source diff | `0` |
| Ports `3000,3010,55721,55722,55723,55724` listening | `0` |
| Running `staking-wallet-web` Supabase containers | `0` |
| Temporary runtime directory residue | `0` |
| Staging | `empty` |
| Commit | `0` |
| Push | `0` |
| PR | `0` |

## 8. Secret Safety

Secret scan scope:

- new orchestrator source
- new orchestrator runtime harness
- `package.json` diff
- current git diff
- this governance report

Findings:

```text
ACTUAL_SECRET=0
JWT=0
SUPABASE_KEY=0
SERVICE_ROLE_KEY=0
DB_URL=0
PASSWORD_VALUE_IN_REPORT=0
ACCESS_REFRESH_TOKEN=0
COOKIE_SESSION=0
PRIVATE_KEY=0
MNEMONIC=0
SEED_PHRASE=0
REAL_EMAIL=0
PROVIDER_CREDENTIAL=0
ENV_LOCAL_CONTENT_READ_INTO_REPORT=0
RAW_CHECKPOINT_IDENTITY_LOG=0
FULL_OBSERVATION_KEY_LOG=0
```

Synthetic UUIDs, role names, function names, and deterministic fixture identity
labels used inside the runtime harness are not production secrets.

## 9. Final Status

```text
FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_ONE_SHOT_ORCHESTRATOR_REMEDIATION_READY
```
