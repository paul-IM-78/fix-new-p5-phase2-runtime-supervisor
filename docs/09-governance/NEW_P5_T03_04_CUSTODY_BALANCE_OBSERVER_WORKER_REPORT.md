# NEW-P5-T03-04 Custody Balance Observer Worker Report

## 1. Status

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_WORKER_READY

## 2. Worktree / Branch / Start HEAD

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t03-custody-observer-runtime`
- Start HEAD: `47ddd68273020c412f6768cd48912fab95949f41`
- Final HEAD: `47ddd68273020c412f6768cd48912fab95949f41`
- origin/main: `f327ad817787a636ee50d5ddb9c8f11bdb4a3125`

## 3. Baseline Commits

- P5-T03-01 contract: `ac914ba55c96e0cd5f5be61ebe7a43ef96a59567`
- P5-T03-02 mock adapter: `de32592f8f62b8373b0a0ccd9692550a799cdc60`
- P5-T03-03 atomic DB command: `47ddd68273020c412f6768cd48912fab95949f41`

## 4. Changed Files

- `package.json`
- `package-lock.json`
- `src/server/custody/provider-observation-contract.ts`
- `src/server/custody/mock-balance-observation-adapter.ts`
- `src/server/custody/balance-observer-command-client.ts`
- `src/server/custody/balance-observer-worker.ts`
- `scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs`
- `docs/09-governance/NEW_P5_T03_04_CUSTODY_BALANCE_OBSERVER_WORKER_REPORT.md`

## 5. Dependency Additions And Audit

- Production dependency: `pg@8.22.0`
- Dev dependency: `@types/pg@8.20.3`
- New npm script: `test:custody:balance-observer-worker:local`
- Production audit: 0 vulnerabilities.
- Full audit: 0 vulnerabilities.
- No ORM, query builder, pg-native, dotenv, scheduler, retry, or provider credential package was added.

## 6. Worker Orchestration Scope

Implemented:

- direct PostgreSQL atomic-command client
- provider plus asset work-unit orchestration
- caller-supplied pre-resolved binding scope
- binding-level adapter success/error handling
- canonical observation key generation
- binding-level atomic DB command calls
- checkpoint version strings
- safe binding outcomes and deterministic summary
- AbortSignal cooperative shutdown
- local runtime with deterministic mock adapter and actual PostgreSQL worker login

## 7. Explicit Deferred Scope

Deferred:

- production provider network adapter
- production provider credential and secret-manager choice
- DB binding/checkpoint discovery read model
- scheduler
- retry/backoff
- durable failure ledger
- automatic reconciliation trigger
- public API/RPC/UI
- transfer observer
- payout, webhook, wallet signing

## 8. Pre-Resolved Work-Scope Contract

- `WORK_SCOPE_RESOLUTION=CALLER_SUPPLIED_PRE_RESOLVED_INPUT`
- `WORKER_DIRECT_TABLE_READS=DISALLOWED`
- `WORKER_BINDING_DISCOVERY=DEFERRED`
- `WORKER_CHECKPOINT_DISCOVERY=DEFERRED`
- Worker input includes provider, asset id, binding DB id, safe provider-neutral binding reference, and expected checkpoint version.
- Worker does not fall back to service-role, ADMIN session, or browser Supabase reads.

## 9. Provider / Asset Work Unit

- Work unit identity: provider plus asset.
- Bindings minimum: 1.
- Binding execution validates same provider code and same canonical asset id.
- Duplicate binding DB ids are rejected.
- Duplicate provider-neutral binding references are rejected.
- Binding id and asset id must be canonical lowercase UUID strings.
- Expected checkpoint version remains a string: `"0"` or a leading-zero-free positive PostgreSQL bigint string.

## 10. Binding Execution Mode

- `OBSERVER_WORK_UNIT=PROVIDER_ASSET`
- `OBSERVER_ATOMIC_COMMIT_UNIT=BINDING_OBSERVATION`
- `BINDING_EXECUTION_MODE=SEQUENTIAL_V1`
- `AUTOMATIC_RETRY=DISABLED`
- Worker calls the adapter once per work unit, then processes successful bindings sequentially.
- A failed binding does not roll back earlier committed bindings.
- No batch transaction and no `Promise.all` DB execution were added.

## 11. Adapter AbortSignal Contract

- Added optional `CustodyObservationReadOptions` with `signal?: AbortSignal`.
- Existing callers can still call `readBalances(bindings)` without options.
- Mock adapter checks abort before work and after deterministic delay.
- Mock delay is deterministic and bounded.
- Abort is surfaced to the worker as `ABORTED`, not as a provider failure.
- Existing transfer contract was not changed.

## 12. Adapter Result Validation

Worker validates:

- result count
- result order
- result binding identity
- success observation binding identity
- success observation provider identity
- duplicate binding results
- missing binding results
- unexpected binding results

Safe validation codes verified:

- `ADAPTER_RESULT_COUNT_MISMATCH`
- `ADAPTER_RESULT_ORDER_MISMATCH`
- `ADAPTER_BINDING_MISMATCH`
- `ADAPTER_PROVIDER_MISMATCH`
- `ADAPTER_DUPLICATE_BINDING`
- `ADAPTER_MISSING_RESULT`
- `ADAPTER_UNEXPECTED_RESULT`

Invalid adapter batches cause DB attempts 0.

## 13. Identity Policy

- `PRODUCTION_IDENTITY_POLICY=NATIVE_OR_CHECKPOINT`
- `LOCAL_MOCK_IDENTITY_POLICY=NATIVE_CHECKPOINT_OR_CONTENT`
- `PRODUCTION_CONTENT_IDENTITY=DISALLOWED`
- `identityPolicy="PRODUCTION"` allows `NATIVE` and `CHECKPOINT`.
- `identityPolicy="PRODUCTION"` rejects `CONTENT` before DB execution.
- `identityPolicy="LOCAL_MOCK"` allows `NATIVE`, `CHECKPOINT`, and `CONTENT`.
- This matches the finalized P5-T03-01 identity policy contract.
- The worker does not infer identity policy from environment variables, provider names, or `NODE_ENV`.

## 14. TOTAL Balance Semantics

- `BALANCE_VALUE_SEMANTICS=TOTAL`
- DB amount uses `observation.observedTotalUnits`.
- `observedAvailableUnits` is not persisted.
- Available-only changes do not change the generated key or create a new DB row.
- No JavaScript `Number`, `parseInt`, `parseFloat`, rounding, clamping, or decimal recalculation was added.

## 15. Observation Key Generation

- Uses existing `createBalanceObservationKeyV1(...)`.
- Observer kind: `BALANCE_OBSERVER_V1`.
- Key shape only: `balobs:v1:<mode>:<64-lowercase-hex>`.
- Production `CHECKPOINT` observations use checkpoint mode shape `balobs:v1:k:<64-lowercase-hex>`.
- Raw provider identity and canonical digest input are not logged or returned.
- Random UUID and worker execution time are not used.

## 16. Checkpoint Value Source

- `BALANCE_CHECKPOINT_VALUE_SOURCE=OBSERVATION_KEY_V1`
- Atomic command receives the generated observation key as both observation key and next checkpoint value.
- Checkpoint observed timestamp equals normalized observation timestamp.
- Raw provider-native identity and raw checkpoint identity are not stored as checkpoint value.

## 17. Direct PostgreSQL Client

- New server-only module: `src/server/custody/balance-observer-command-client.ts`
- Uses `pg` Pool.
- Caller must provide complete programmatic config.
- No `DATABASE_URL`, `PGPASSWORD`, Supabase URL/key, service-role key, hard-coded password, or hard-coded production host fallback exists in project source.
- Fixed application name: `staking-wallet-balance-observer-v1`.

## 18. Complete Programmatic Config Boundary

Required config fields:

- `host`
- `port`
- `database`
- `user`
- `password`
- `ssl`
- connection timeout
- statement timeout
- query timeout
- lock timeout
- idle-in-transaction timeout
- pool max
- idle timeout
- max lifetime

The config object and password are never logged.

## 19. Pool And Timeout Configuration

Default safety bounds:

- connection timeout: 5000 ms
- statement timeout: 15000 ms
- query timeout: 20000 ms
- lock timeout: 5000 ms
- idle-in-transaction timeout: 5000 ms
- pool max: 4
- idle timeout: 10000 ms
- max lifetime: 300 seconds

Validation rejects zero, non-finite, non-safe-integer, negative, and excessively large timeout/pool values.

## 20. Parameterized Atomic-Command Query

- Client calls only `private.record_balance_observation_and_advance_checkpoint(...)`.
- Query is parameterized.
- Parameter order matches P5-T03-03:
  1. binding id
  2. observer kind
  3. observation key
  4. observed total units
  5. observed at
  6. expected checkpoint version
  7. observation key as checkpoint value
  8. observed at as checkpoint observed timestamp
- No table SELECT/INSERT/UPDATE/DELETE, dynamic SQL, transaction management, public RPC, PostgREST, or service-role path was added to the command client.

## 21. DB Result Validation

Client requires exactly 1 row.

Validated:

- observation id is canonical UUID text
- checkpoint id is canonical UUID text
- booleans are actual booleans
- checkpoint version is positive PostgreSQL bigint text
- `checkpointCreated=true` and `checkpointAdvanced=true` is rejected

Safe protocol failure codes:

- `DB_COMMAND_RESULT_COUNT_INVALID`
- `DB_COMMAND_RESULT_SHAPE_INVALID`
- `DB_COMMAND_FLAG_CONTRACT_INVALID`

## 22. DB Error Mapping

Mapped safe worker codes:

- `CHECKPOINT_VERSION_CONFLICT`
- `CHECKPOINT_REGRESSION`
- `CHECKPOINT_POSITION_CONFLICT`
- `OBSERVATION_IDEMPOTENCY_CONFLICT`
- `BINDING_NOT_FOUND`
- `BINDING_NOT_OBSERVABLE`
- `INPUT_CONTRACT_INVALID`
- `DB_CONNECTION_FAILED`
- `DB_TIMEOUT`
- `DB_UNAVAILABLE`
- `DB_COMMAND_REJECTED`

Mapping uses SQLSTATE plus known safe domain messages. Raw SQL, constraint names, host, port, user, stack, and driver config are not exposed in outcomes.

## 23. Worker Binding Outcome

Success outcome includes:

- `bindingId`
- `observationCreated`
- `checkpointCreated`
- `checkpointAdvanced`
- `checkpointVersion`

Failure outcome includes:

- `bindingId`
- `stage`
- `code`
- `retryable`

Outcomes exclude binding key, provider raw identity, checkpoint raw identity, observation key, amount, endpoint, credential, raw Error, stack, and SQL.

## 24. Work-Unit Summary

Summary fields:

- `requestedBindings`
- `adapterSuccesses`
- `adapterFailures`
- `databaseAttempts`
- `persistedObservations`
- `replayedObservations`
- `checkpointsCreated`
- `checkpointsAdvanced`
- `checkpointNoops`
- `failedBindings`
- `abortedBindings`

Verified invariants:

- requested bindings equals success plus failure outcomes
- database attempts never exceed adapter successes
- persisted plus replayed observations equals successful DB outcomes
- no financial amount aggregation is performed

## 25. Cooperative Abort Behavior

Abort checkpoints:

- after work-unit validation
- before adapter call
- after adapter return
- before each binding
- before DB command
- after DB command

Behavior:

- abort before adapter: adapter calls 0, DB calls 0, all bindings `ABORTED`
- abort after first DB commit: first success is preserved, remaining binding DB calls 0
- in-flight PostgreSQL cancellation and `pg_cancel_backend` were not implemented
- cleanup closes pools and clears local credential

## 26. Local Ephemeral Worker Credential

- Local runtime creates a crypto-random ephemeral worker role password.
- Password is passed only in memory as a structured `pg` config field.
- Password is not stored in source, environment variables, stdout/stderr, report, or connection string.
- SQL is passed to `psql` over stdin rather than command-line arguments.
- Runtime clears the worker password before final DB reset/stop.

## 27. Local Network Allowlist

- Actual worker runtime uses local PostgreSQL TCP.
- `LOCAL_POSTGRES_CONNECTIONS=5`
- `EXTERNAL_NETWORK_CALLS=0`
- `PROVIDER_NETWORK_CALLS=0`
- Guarded paths include fetch, HTTP, HTTPS, and non-allowlisted Node sockets.
- Docker/Supabase CLI setup processes are treated separately from provider/worker network counts.

## 28. Runtime Scenarios

Verified:

- worker role direct login
- fixed application name
- direct private table SELECT rejection
- lower-level primitive direct execute rejection
- initial NATIVE success
- PRODUCTION NATIVE DB command count 1
- exact replay no-op
- CHECKPOINT advance
- PRODUCTION CHECKPOINT DB command count 1
- PRODUCTION CHECKPOINT key mode
- LOCAL_MOCK CONTENT success
- PRODUCTION CONTENT rejection
- PRODUCTION CONTENT DB command count 0
- available-only replay
- partial adapter failure
- stale checkpoint version conflict
- adapter result count/order/binding/provider/duplicate/missing/unexpected validation
- abort before adapter
- abort after first binding
- pool normal/failure/abort/repeated close
- no raw identity, observation key, password, connection string, SQL, or stack in runtime output

## 29. Runtime Case Count

- `WORKER_RUNTIME_CASE_COUNT=44`
- Runtime status: `CUSTODY_BALANCE_OBSERVER_WORKER_RUNTIME_PASS`

## 30. DB Regression

- `npm run supabase:start`: PASS.
- `npm run db:reset:local`: PASS.
- `npm run db:lint:local`: PASS, schema errors 0.
- `npm run db:test:local`: PASS.
- Files: 27.
- Tests: 1318.
- Failed: 0.
- Skip: 0.

## 31. Adapter Regression

- `npm run test:custody:balance-adapter:local`: PASS.
- Runtime cases: 72.
- External network calls: 0.
- Credential env reads: 0.

## 32. Lint / Build / Custody Regression

- `node --check scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs`: PASS.
- `npm run lint`: PASS, warning 0.
- `npm run build`: PASS.
- `npm run test:custody:boundary:local`: PASS.
- Custody boundary cleanup: PASS.

## 33. Generated Type Result

- `npm run db:types:local`: PASS.
- `git diff -- src/types/database.types.ts`: content diff 0.
- Generated type file is not part of this task's changes.

## 34. External / Provider Network Count

- Worker runtime local PostgreSQL connections: 5.
- External network calls: 0.
- Provider network calls: 0.
- Production provider network adapter remains deferred.

## 35. Credential / Environment Access

- Credential environment reads counted by runtime: 0.
- Service-role usage counted by runtime: 0.
- `.env.local` content read/output: 0.
- No provider credential, private key, mnemonic, seed phrase, wallet signing, or service-role production runtime was added.

## 36. Cleanup

- Command client pool close: PASS.
- Repeated close: PASS.
- Temporary worker password cleared: PASS.
- Final DB reset: PASS.
- Fixture residue: 0.
- Supabase stop: PASS.
- Current project running containers: 0.
- Target port listeners on 3000, 3010, 55721, 55722, 55723, 55724: 0.
- TEMP/quarantine residue: 0.
- `.env.local` changed: 0.

## 37. Secret Scan

Scan scope:

- new/modified TypeScript source
- runtime harness
- package files
- governance report
- working-tree diff

Result:

- actual worker password values: 0
- PostgreSQL connection strings: 0
- DB credentials: 0
- remote DB hostnames: 0
- JWT/Supabase/service-role keys: 0
- provider API keys/secrets: 0
- access/refresh tokens: 0
- cookie/session values: 0
- private keys/mnemonics/seed phrases: 0
- wallet addresses: 0
- actual provider endpoints: 0
- actual native/checkpoint identities: 0
- actual observation keys: 0
- `.env.local` contents: 0

Synthetic UUIDs, provider codes, and key format strings are not secrets.

## 38. Git Status

- Staging: empty.
- Commit: not performed.
- Push: not performed.
- PR: not created.
- `supabase/**` diff: 0.
- `src/types/database.types.ts` diff: 0.
- `src/app/**` diff: 0.
- `src/server/admin/**` diff: 0.

## 39. Next Task

Recommended next task:

P5-T03-05 Concurrency, Retry and Failure Runtime.

That task can add multi-process concurrency verification, bounded retry policy, and failure observability without changing the P5-T03-04 callable worker boundary.

## 40. Final Status

PASS_CUSTODY_BALANCE_OBSERVER_WORKER_READY
