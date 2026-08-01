# NEW-P5-T03-05 Custody Balance Observer Resilience Report

## 1. Status

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_RESILIENCE_READY

## 2. Worktree / Branch / Start HEAD

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t03-custody-observer-runtime`
- Start HEAD: `0fdb6b268cfca3b2c85697e0fd12ce70122208b8`
- Final HEAD: `0fdb6b268cfca3b2c85697e0fd12ce70122208b8`
- origin/main: `f327ad817787a636ee50d5ddb9c8f11bdb4a3125`

## 3. Baseline Commits

- P5-T03-01 contract: `ac914ba55c96e0cd5f5be61ebe7a43ef96a59567`
- P5-T03-02 mock adapter: `de32592f8f62b8373b0a0ccd9692550a799cdc60`
- P5-T03-03 atomic DB command: `47ddd68273020c412f6768cd48912fab95949f41`
- P5-T03-04 worker: `0fdb6b268cfca3b2c85697e0fd12ce70122208b8`

## 4. Changed Files

- `package.json`
- `src/server/custody/balance-observer-retry.ts`
- `src/server/custody/mock-balance-observation-adapter.ts`
- `src/server/custody/balance-observer-command-client.ts`
- `src/server/custody/balance-observer-worker.ts`
- `scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs`
- `scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs`
- `docs/09-governance/NEW_P5_T03_05_CUSTODY_BALANCE_OBSERVER_RESILIENCE_REPORT.md`

## 5. Existing Contract Preserved

- `WORK_SCOPE_RESOLUTION=CALLER_SUPPLIED_PRE_RESOLVED_INPUT`
- `OBSERVER_WORK_UNIT=PROVIDER_ASSET`
- `OBSERVER_ATOMIC_COMMIT_UNIT=BINDING_OBSERVATION`
- `BINDING_EXECUTION_MODE=SEQUENTIAL_V1`
- `PRODUCTION_IDENTITY_POLICY=NATIVE_OR_CHECKPOINT`
- `LOCAL_MOCK_IDENTITY_POLICY=NATIVE_CHECKPOINT_OR_CONTENT`
- `PRODUCTION_CONTENT_IDENTITY=DISALLOWED`
- `BALANCE_VALUE_SEMANTICS=TOTAL`
- `BALANCE_CHECKPOINT_VALUE_SOURCE=OBSERVATION_KEY_V1`
- Worker direct private table reads, service-role fallback, ADMIN session fallback, provider network, and internal binding/checkpoint discovery remain 0.

## 6. Retry Activation Boundary

- Retry is caller activated.
- Omitted retry policy normalizes to `mode="DISABLED"`.
- Environment variables, `NODE_ENV`, provider code, and credential state do not enable retry.
- Existing P5-T03-04 worker runtime remains 44 cases PASS with retry omitted.

## 7. Bounded Retry Policy V1

- `RETRY_POLICY_VERSION=BOUNDED_V1`
- Default max attempts: 3.
- Default base delay: 250 ms.
- Default max delay: 4000 ms.
- Default jitter ratio: 0.20.
- Default max Retry-After: 30000 ms.
- `maxAttempts` includes the initial attempt.

## 8. Retry Validation

- `maxAttempts`: integer 1 through 5.
- `baseDelayMs`: integer 1 through 10000.
- `maxDelayMs`: integer at least `baseDelayMs`, at most 60000.
- `jitterRatio`: finite number 0 through 1.
- `maxRetryAfterMs`: integer 1 through 300000.
- String/object coercion, NaN, Infinity, negative values, and out-of-range values are rejected before adapter or DB calls.
- Safe code: `RETRY_POLICY_INVALID`.

## 9. Exponential Backoff

- Retry index starts at 1 for the first retry.
- Exponential cap: `baseDelayMs * 2^(retryIndex - 1)`.
- Bounded cap: `min(maxDelayMs, exponential cap)`.
- Final delay is clamped to 0 through `maxDelayMs`.

## 10. Bounded Jitter

- Equal-jitter contract implemented.
- `jitterWindow=floor(boundedCap*jitterRatio)`.
- `minimumDelay=boundedCap-jitterWindow`.
- `randomOffset` is a crypto-random integer from 0 through `jitterWindow*2`.
- Production uses `node:crypto`; runtime injects deterministic random integers.
- `Math.random`, `Date.now` seeding, provider identity seeding, credential seeding, busy-wait, and unbounded delay are absent.

## 11. Abort-Aware Delay

- `waitForRetryDelay(...)` supports `AbortSignal`.
- If already aborted, no timer is created.
- During delay abort clears timer and removes listener.
- Runtime verified abort before retry delay, abort during backoff, and abort after a DB transient failure.
- Abort outcomes use stage `ABORTED` without raw DOMException, AbortError, stack, or provider payload.

## 12. Retry-After Handling

- Adapter `retryAfterMs` is honored for `RATE_LIMITED` and `PROVIDER_UNAVAILABLE`.
- Effective delay is `max(backoffDelay, retryAfterMs ?? 0)`.
- If Retry-After exceeds `maxRetryAfterMs`, retry is deferred instead of truncated.
- Runtime verified Retry-After success and Retry-After deferred failure.
- No raw Retry-After header or provider response is stored.

## 13. Adapter Retryable Catalog

Automatic adapter retry is allowed only for:

- `TIMEOUT`
- `RATE_LIMITED`
- `PROVIDER_UNAVAILABLE`

## 14. Adapter Non-Retryable Catalog

Automatic adapter retry is disallowed for:

- `UNSUPPORTED_ASSET`
- `MALFORMED_AMOUNT`
- `MALFORMED_TIMESTAMP`
- `MISSING_RESULT`
- `DUPLICATE_RESULT`
- `UNEXPECTED_RESULT`
- adapter batch/result mismatch
- `CONTENT_IDENTITY_NOT_ALLOWED`
- input contract failure

## 15. Binding-Level Adapter Retry

- `ADAPTER_RETRY_GRANULARITY=BINDING`
- Initial adapter call remains a provider/asset batch read.
- Only retryable failed bindings are retried as single-binding reads.
- Successful bindings are not read again.
- Single-binding retry result must return exactly one result for the requested binding and provider.
- Invalid retry result safe code: `ADAPTER_RETRY_RESULT_INVALID`.

## 16. DB Retryable Catalog

Automatic DB retry is allowed only for:

- `DB_CONNECTION_FAILED`
- `DB_TIMEOUT`
- `DB_LOCK_TIMEOUT`
- `DB_UNAVAILABLE`

## 17. DB Non-Retryable Catalog

Automatic DB retry is disallowed for:

- `CHECKPOINT_VERSION_CONFLICT`
- `CHECKPOINT_REGRESSION`
- `CHECKPOINT_POSITION_CONFLICT`
- `OBSERVATION_IDEMPOTENCY_CONFLICT`
- `BINDING_NOT_FOUND`
- `BINDING_NOT_OBSERVABLE`
- `INPUT_CONTRACT_INVALID`
- `DB_COMMAND_REJECTED`
- DB command result/protocol shape failures

## 18. Checkpoint Scope-Refresh Boundary

- `CHECKPOINT_VERSION_CONFLICT_AUTO_RETRY=DISALLOWED`
- `CHECKPOINT_VERSION_CONFLICT_REQUIRES_SCOPE_REFRESH=true`
- Worker does not discover or refresh checkpoint scope internally.
- Runtime verified stale checkpoint result with `requiresScopeRefresh=true` and no retry exhaustion.

## 19. DB Retry Idempotency

- DB retries reuse the exact same command input.
- Stable fields: binding id, observer kind, observation key, observed total units, observed at, expected checkpoint version, checkpoint value, checkpoint observed at.
- Adapter success followed by DB retry reuses the same normalized observation.
- Ambiguous commit replay verified final success with one observation and one checkpoint.

## 20. DB Timeout / Error Mapping

- SQLSTATE `57014` maps to `DB_TIMEOUT`.
- SQLSTATE `55P03` maps to `DB_LOCK_TIMEOUT`.
- SQLSTATE `08xxx` and shutdown/unavailable family map to `DB_UNAVAILABLE`.
- Known local connection timeout maps to `DB_CONNECTION_FAILED`.
- Unknown DB errors remain `DB_COMMAND_REJECTED`, retryable false.
- Raw SQL, SQLSTATE, constraint, stack, host, user, database, and password are not exposed in outcomes.

## 21. Binding Outcome Metadata

Success outcome adds:

- `adapterAttempts`
- `databaseAttempts`

Failure outcome adds:

- `adapterAttempts`
- `databaseAttempts`
- `retryExhausted`
- `retryDeferred`
- `retryAfterMs`
- `requiresScopeRefresh`

Forbidden fields remain absent: observation key, raw identity, amount, checkpoint raw value, binding key, provider payload, SQL, SQLSTATE, host, port, database, user, credential, and stack.

## 22. Summary Metadata / Invariants

Summary adds:

- `adapterAttempts`
- `adapterRetryAttempts`
- `databaseRetryAttempts`
- `retryExhaustedBindings`
- `retryDeferredBindings`
- `scopeRefreshRequiredBindings`
- `timeoutFailures`
- `lockTimeoutFailures`
- `unavailableFailures`

No financial amount aggregation was added.

## 23. Scripted Mock Attempts

- Mock adapter supports deterministic binding-level attempt sequences.
- Existing fixed fixture behavior is preserved.
- Attempt sequences are per mock instance.
- Duplicate binding and sequence binding mismatch are rejected safely.
- External/provider network and credential/environment access remain 0.

## 24. Multi-Session Concurrency Method

- Runtime uses actual local PostgreSQL TCP sessions.
- Concurrency uses separate command clients and `pg` pools.
- Advisory-lock blocking uses the same binding/observer advisory key as the DB function.
- No migration, pgTAP, fake persistence, or provider stub server was added.

## 25. Same-Observation Concurrency

- Two concurrent worker invocations used the same binding, expected version, identity, amount, timestamp, and checkpoint value.
- Both completed safely.
- Exactly one observation row and one checkpoint row were added.
- One invocation created; the other replayed/no-op.
- Duplicate observation and idempotency conflict count: 0.

## 26. Competing-Observation Concurrency

- Two concurrent worker invocations used the same binding and same expected version with different observations.
- Exactly one invocation committed.
- The other returned a safe checkpoint conflict class.
- Observation increment: 1.
- Checkpoint increment: 1.
- Partial insert count: 0.
- Deadlock/session leak: 0.

## 27. Different-Binding Concurrency

- Two concurrent worker invocations used the same provider and asset but different bindings.
- Both succeeded.
- Observation increment: 2.
- Checkpoint increment: 2.
- Data isolation defects: 0.

## 28. Lock Timeout Runtime

- Actual local advisory lock holder forced a lock timeout.
- Safe mapping: `DB_LOCK_TIMEOUT`.
- Retry released the lock before the next attempt.
- Final result: success.
- Observation increment: 1.
- Checkpoint increment: 1.
- Partial commit before retry: 0.

## 29. Statement Timeout Runtime

- Actual local advisory lock holder forced a PostgreSQL statement timeout.
- Safe mapping: `DB_TIMEOUT`.
- Retry released the lock before the next attempt.
- Final result: success.
- Observation increment: 1.
- Checkpoint increment: 1.
- Partial commit before retry: 0.

## 30. Query Timeout Runtime

- Actual local blocking query exercised `pg@8.22.0` client-side query timeout.
- Safe mapping: `DB_TIMEOUT`.
- Retry used the same DB command input and recovered after lock release.
- Final result: success.
- Observation/checkpoint duplicates: 0.
- `REQUIRES_ACTION_NODE_POSTGRES_QUERY_TIMEOUT_RECOVERY_DEFECT` was not triggered.

## 31. Connection Failure Runtime

- Runtime reserved an unused loopback port.
- No remote hostname, DNS, remote Supabase, or remote PostgreSQL was used.
- Safe code: `DB_UNAVAILABLE` or `DB_CONNECTION_FAILED`.
- Attempts were bounded.
- Retry exhaustion metadata was verified.

## 32. Controlled Transient Recovery

- Command wrapper injected one safe `DB_UNAVAILABLE` failure.
- Second attempt called the real production DB command.
- Adapter attempts: 1.
- DB attempts: 2.
- Final observation/checkpoint success.
- `databaseRetryAttempts=1`.

## 33. Provider Timeout Runtime

- `TIMEOUT -> success` sequence verified.
- Adapter attempts: 2.
- DB attempts: 1.
- Backoff count: 1.
- `retryExhausted=false`.

## 34. Rate-Limit / Retry-After Runtime

- `RATE_LIMITED -> success` verified with Retry-After delay selected over backoff.
- Retry-After beyond policy verified with `retryDeferred=true`.
- Deferred case had DB attempts 0.

## 35. Retry Exhaustion

- `PROVIDER_UNAVAILABLE` exhausted at `maxAttempts=3`.
- `retryExhausted=true`.
- DB attempts 0.
- Retry bounds held.

## 36. Ambiguous Commit Replay Recovery

- First DB command committed, then wrapper returned a safe transient failure.
- Retry reused the same input.
- Second attempt resolved exact replay/no-op.
- Observation increment: 1.
- Checkpoint increment: 1.
- Duplicate side effect: 0.

## 37. Abort / Retry Interaction

- Abort before retry delay: adapter retry attempt 0, DB attempt 0, stage `ABORTED`.
- Abort during backoff: timer path returned `ABORTED`; later adapter/DB attempt 0.
- Abort after DB transient failure: next DB retry prevented.
- Raw AbortError/stack output: 0.

## 38. Failure Ledger Deferred Boundary

- `DURABLE_OBSERVER_FAILURE_LEDGER=DEFERRED`
- No observer failure table, event table, retry schedule table, provider raw error storage, or stack storage was added.

## 39. Runtime Case Count

- `RESILIENCE_RUNTIME_CASE_COUNT=60`
- Runtime status: `CUSTODY_BALANCE_OBSERVER_RESILIENCE_RUNTIME_PASS`

## 40. Local PostgreSQL Connection Count

- `LOCAL_POSTGRES_CONNECTIONS=20`
- Requirement `LOCAL_POSTGRES_CONNECTIONS >= 2` satisfied.

## 41. External / Provider Network Count

- `EXTERNAL_NETWORK_CALLS=0`
- `PROVIDER_NETWORK_CALLS=0`
- Guarded paths include fetch, HTTP, HTTPS, TLS, DNS, and non-allowlisted sockets.

## 42. Credential Environment Reads

- `CREDENTIAL_ENV_READS=0`
- Worker password stayed in memory as structured config.
- `.env.local` content read/output: 0.

## 43. DB Regression

- `npm run supabase:start`: PASS.
- `npm run db:reset:local`: PASS.
- `npm run db:lint:local`: PASS, schema errors 0.
- `npm run db:test:local`: PASS.
- Files: 27.
- Tests: 1318.
- Failed: 0.
- Skip: 0.

## 44. Worker / Adapter Regressions

- `npm run test:custody:balance-observer-worker:local`: PASS.
- Worker runtime cases: 44.
- `npm run test:custody:balance-adapter:local`: PASS.
- Adapter runtime cases: 72.

## 45. Lint / Build / Custody Regression

- `git diff --check`: PASS.
- `node --check scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs`: PASS.
- `npm run lint`: PASS, warning 0.
- `npm run build`: PASS.
- `npm run test:custody:boundary:local`: PASS.
- Custody boundary cleanup: PASS.

## 46. Dependency Audits

- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm audit`: 0 vulnerabilities.
- New dependencies: 0.
- `package-lock.json` diff: 0.

## 47. Generated Types

- `npm run db:types:local`: PASS.
- `git diff -- src/types/database.types.ts`: content diff 0.
- Generated type file is not part of this task's changes.

## 48. Cleanup

- Lock holder transactions rolled back.
- Lock holder clients closed.
- Concurrent command clients closed.
- Command pool closed.
- Retry timers/listeners cleaned up.
- Ephemeral worker password cleared.
- Final DB reset: PASS.
- Supabase stop: PASS.
- Fixture residue: 0.
- TEMP residue: 0.
- Quarantine residue: 0.
- Target port residue: 0.
- `.env.local` changed: 0.

## 49. Secret Scan

Scan scope:

- new/modified TypeScript source
- runtime harnesses
- package file
- governance report
- working-tree diff

Actual value result:

- worker password: 0
- PostgreSQL connection string: 0
- DB credential: 0
- remote DB hostname: 0
- JWT/Supabase/service-role key: 0
- provider API key/secret: 0
- access/refresh token: 0
- cookie/session: 0
- private key/mnemonic/seed phrase: 0
- wallet address: 0
- actual provider endpoint: 0
- actual native/checkpoint identity: 0
- actual observation key: 0
- raw Retry-After header: 0
- `.env.local` contents: 0

Field names such as `password` and `retryAfterMs` are configuration names, not secret values.

## 50. Git Status

- Staging: empty.
- Commit: not performed.
- Push: not performed.
- PR: not created.
- `supabase/**` diff: 0.
- `src/types/database.types.ts` diff: 0.
- `src/app/**` diff: 0.
- `src/server/admin/**` diff: 0.
- `package-lock.json` diff: 0.

## 51. Deferred Scope

Still deferred:

- production provider adapter
- production provider credential
- production secret manager
- scheduler
- DB binding/checkpoint discovery read model
- durable failure ledger
- automatic reconciliation trigger
- transfer observer
- payout submission
- webhook ingestion
- wallet signing
- ledger posting
- public API/RPC/UI

## 52. Next Task

Recommended next task:

P5-T03-06 Custody Balance Observer Scheduler Boundary and Scope Discovery Plan.

## 53. Final Status

PASS_CUSTODY_BALANCE_OBSERVER_RESILIENCE_READY
