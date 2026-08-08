# NEW-P5-T03-08 Final PR Review Remediation Report

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_FINAL_REVIEW_REMEDIATION_READY

## 1. Status

- Status: `PASS_CUSTODY_BALANCE_OBSERVER_FINAL_REVIEW_REMEDIATION_READY`
- Scope: final PR #5 review remediation for adapter isolation and worker ACL closure.
- Pull request: `#5`
- PR state: `OPEN`
- PR draft: `false`
- PR base: `main`
- PR head: `feat/p5-t03-custody-observer-runtime`
- PR head SHA: `dc6c26cb817480850a1b28a2cb7946d266686e39`
- Staging: not performed.
- Commit: not performed.
- Push: not performed.
- PR comment/review/body/title update: not performed.
- Merge/auto-merge: not performed.

## 2. Worktree / Branch / HEAD

- Worktree: `D:\Ai\staking-wallet-web`
- Repository: `paul-IM-78/fix-new-p5-phase2-runtime-supervisor`
- Branch: `feat/p5-t03-custody-observer-runtime`
- Start HEAD: `dc6c26cb817480850a1b28a2cb7946d266686e39`
- Final HEAD: `dc6c26cb817480850a1b28a2cb7946d266686e39`
- Upstream: `origin/feat/p5-t03-custody-observer-runtime`
- Upstream SHA: `dc6c26cb817480850a1b28a2cb7946d266686e39`
- origin/main: `f327ad817787a636ee50d5ddb9c8f11bdb4a3125`

## 3. Final Review Findings

Four merge-blocking findings were remediated locally:

1. Retry adapter response non-array handling.
2. Per-binding isolation for binding/provider mismatch.
3. Database and schema grant-option gaps in the worker role assertion.
4. Closed-world project object and atomic command ACL validation.

## 4. Retry Non-Array Result Remediation

- File: `src/server/custody/balance-observer-worker.ts`
- The retry path now treats the second adapter response as untrusted runtime data.
- `adapter.readBalances(...)` retry output is checked with `Array.isArray(...)` before single-result validation.
- Non-array retry results map to:
  - stage: `VALIDATION`
  - code: `ADAPTER_RETRY_RESULT_INVALID`
  - retryable: `false`
  - DB attempts: `0`
- Adapter promise rejection remains mapped to `ADAPTER_CALL_FAILED`.
- Raw returned values, raw error objects, messages, stacks, and payloads are not exposed.

Runtime coverage:

- Retry resolves `null`: PASS.
- Retry resolves `undefined`: PASS.
- Retry resolves object: PASS.
- Retry resolves string: PASS.
- Each case enters the retry path after an initial `TIMEOUT`, uses 2 adapter attempts, performs 0 DB attempts, does not set retry exhausted, and does not reject the work-unit promise.

## 5. Per-Binding Isolation Remediation

- File: `src/server/custody/balance-observer-worker.ts`
- Global adapter validation now stays limited to batch-level invariants:
  - array shape
  - result count shortage/excess
  - duplicate binding
  - unexpected binding
  - strict order contract
- Per-binding validation owns binding/provider/result union checks:
  - result binding shape
  - observation binding shape
  - result/observation binding mismatch
  - observation provider mismatch
  - success/error union shape
  - identity
  - amount/timestamp field types
  - error shape

Runtime coverage:

- Binding mismatch is isolated to the malformed binding: PASS.
- Provider mismatch is isolated to the malformed binding: PASS.
- The next valid binding continues and executes exactly one DB command.
- Batch cardinality, order, duplicate, and unexpected binding failures remain global validation failures.

## 6. Worker ACL Closure Remediation

New forward-only migration:

```text
supabase/migrations/20260801153000_p5_t03_final_review_remediation.sql
```

The migration recreates:

```text
private.assert_custody_observer_worker_role_contract()
```

The assertion now validates:

- Database `CONNECT` is available without grant option.
- Database `CREATE` and `CREATE WITH GRANT OPTION` are forbidden.
- Direct worker `TEMP` grants and `TEMP WITH GRANT OPTION` are forbidden.
- Global PostgreSQL/Supabase `PUBLIC TEMP` baseline is not treated as a worker-specific violation.
- Private schema `USAGE` is available without grant option.
- Private schema `CREATE`, `CREATE WITH GRANT OPTION`, and `USAGE WITH GRANT OPTION` are forbidden.
- Other project-schema direct worker `CREATE` or grant-option contamination is forbidden.
- The atomic command has exactly the allowed executable worker grant and no worker grant option.
- Unexpected atomic command executable grantees are forbidden.
- Worker-executable private functions other than the atomic command are forbidden.
- Worker-executable public project functions are forbidden.
- Public/private table privileges are forbidden.
- Public/private sequence privileges are forbidden.
- Table and sequence grant options are forbidden.
- Existing role login/noinherit/elevated attribute, membership, and ownership checks are preserved.

## 7. ACL Contamination Tests

New pgTAP:

```text
supabase/tests/database/p5_t03_final_review_remediation.test.sql
```

The new pgTAP verifies:

- Database `CONNECT WITH GRANT OPTION` contamination fails with SQLSTATE `42501`.
- Direct database `TEMP` contamination fails with SQLSTATE `42501`.
- Direct database `TEMP WITH GRANT OPTION` contamination fails with SQLSTATE `42501`.
- Private schema `USAGE WITH GRANT OPTION` contamination fails with SQLSTATE `42501`.
- Public schema `CREATE` contamination fails with SQLSTATE `42501`.
- Public function `EXECUTE` contamination fails with SQLSTATE `42501`.
- Unexpected atomic command grantee contamination fails with SQLSTATE `42501`.
- Public table privilege contamination fails with SQLSTATE `42501`.
- Public sequence privilege contamination fails with SQLSTATE `42501`.
- Private sequence privilege contamination fails with SQLSTATE `42501`.
- Each revoke/drop cleanup restores the assertion to PASS.
- Synthetic public function/table/sequence and private sequence fixtures leave no durable residue.

## 8. Existing Contract Regression

Preserved contracts:

- Abort-safe retry and mock delays.
- Adapter malformed-result isolation.
- Production identity policy: `NATIVE` or `CHECKPOINT`.
- Local mock identity policy includes deterministic `CONTENT`.
- `TOTAL` balance semantics.
- Atomic observation/checkpoint command.
- Current observability validation before replay success.
- Old replay no-op.
- Legacy catch-up.
- Checkpoint CAS.
- Same-observation concurrency.
- Competing observation single-winner behavior.
- Timeout/retry recovery.
- Ambiguous commit replay.
- Direct worker login.
- Lower primitive execute rejection.
- Service-role/browser/public observer path count: 0.

## 9. Validation Results

DB validation:

```text
npm run supabase:start                  PASS
npm run db:reset:local                  PASS
npm run db:lint:local                   PASS
npm run db:test:local                   PASS
npm run db:types:local                  PASS
git diff -- src/types/database.types.ts 0
npm run db:reset:local                  PASS
npm run db:lint:local                   PASS
npm run db:test:local                   PASS
```

Final pgTAP result:

```text
Files=29
Tests=1359
Failures=0
Skips=0
Result=PASS
```

Runtime and application validation:

```text
git diff --check                                                    PASS
node --check scripts/test-p5-t03-custody-balance-adapter-runtime.mjs PASS
node --check scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs PASS
node --check scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs PASS
npm run test:custody:balance-adapter:local                         PASS
npm run test:custody:balance-observer-worker:local                 PASS
npm run test:custody:balance-observer-resilience:local             PASS
npm run lint                                                       PASS
npm run build                                                      PASS
npm run test:custody:boundary:local                                PASS
npm audit --omit=dev                                               PASS
npm audit                                                          PASS
```

Runtime case counts:

```text
adapter runtime: 74 cases PASS
worker runtime: 62 cases PASS
resilience runtime: 62 cases PASS
custody boundary runtime: PASS
```

Network and credential counters:

```text
adapter external network calls: 0
adapter credential environment reads: 0
worker external network calls: 0
worker provider network calls: 0
worker credential environment reads: 0
resilience external network calls: 0
resilience provider network calls: 0
resilience credential environment reads: 0
```

Audit:

```text
npm audit --omit=dev vulnerabilities=0
npm audit vulnerabilities=0
```

## 10. Changed Files

Expected changed files after this report:

```text
M  scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs
M  src/server/custody/balance-observer-worker.ts
?? docs/09-governance/NEW_P5_T03_08_FINAL_PR_REVIEW_REMEDIATION_REPORT.md
?? supabase/migrations/20260801153000_p5_t03_final_review_remediation.sql
?? supabase/tests/database/p5_t03_final_review_remediation.test.sql
```

Restricted path diff:

```text
package.json diff: 0
package-lock.json diff: 0
src/types/database.types.ts diff: 0
src/app diff: 0
src/server/admin diff: 0
existing migrations modified: 0
existing pgTAP modified: 0
existing governance reports modified: 0
```

## 11. Cleanup

- Project Supabase stop: PASS.
- App server listener: 0.
- Ports `3000`, `3010`, `55721`, `55722`, `55723`, `55724`: 0.
- PostgreSQL socket residue: 0.
- Pool waiting clients: 0 expected.
- Timer/listener residue: runtime harness PASS.
- Fixture residue: runtime harness PASS.
- Test public function/table/sequence residue: pgTAP transaction rollback/drop PASS.
- Test role/ACL contamination residue: pgTAP revoke PASS.
- `.env.local` diff: 0.
- package-lock diff: 0.

## 12. Secret Scan

Scope:

- Modified source.
- New forward-only migration.
- New pgTAP.
- Runtime harness change.
- This governance report.
- Working-tree diff.

Result:

- Worker password: 0.
- DB connection string: 0.
- DB credential: 0.
- JWT: 0.
- Supabase key: 0.
- Service-role key: 0.
- Provider credential: 0.
- Cookie/session: 0.
- Private key: 0.
- Mnemonic/seed phrase: 0.
- Wallet address: 0.
- Raw observation identity: 0.
- Generated observation key added by this remediation: 0.
- `.env.local` content: 0.

## 13. Git / PR State

- Git status: dirty with allowed unstaged remediation files only.
- Staging: empty.
- Commit: not performed.
- Push: not performed.
- PR update/comment/review/body/title: not performed.
- PR #5: remains OPEN.
- PR head SHA: remains `dc6c26cb817480850a1b28a2cb7946d266686e39`.
- Merge/auto-merge: not performed.

## 14. Next Step

Create a dedicated P5-T03-08 remediation commit after reviewing the 5-file diff, then push that commit to update PR #5.

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_FINAL_REVIEW_REMEDIATION_READY
