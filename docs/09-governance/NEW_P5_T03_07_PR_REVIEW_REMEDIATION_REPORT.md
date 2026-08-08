# NEW-P5-T03-07 PR Review Remediation Report

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_PR_REVIEW_REMEDIATION_READY

## 1. Status

- Status: `PASS_CUSTODY_BALANCE_OBSERVER_PR_REVIEW_REMEDIATION_READY`
- Scope: PR review remediation for P5-T03 Custody Balance Observer Runtime.
- Pull request: `#5`
- PR title: `feat(custody): add balance observer runtime`
- PR state: `OPEN`
- PR draft: `false`
- PR base: `main`
- Push: not performed.
- Commit: not performed.
- PR comment/update/review/merge: not performed.

## 2. Worktree / Branch

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t03-custody-observer-runtime`
- Repository: `paul-IM-78/fix-new-p5-phase2-runtime-supervisor`
- Start HEAD: `da1c984895fe394b0ee319513930ea465669e87a`
- Current HEAD after remediation: `da1c984895fe394b0ee319513930ea465669e87a`
- Upstream HEAD: `da1c984895fe394b0ee319513930ea465669e87a`
- origin/main: `f327ad817787a636ee50d5ddb9c8f11bdb4a3125`
- Ahead/behind vs upstream: `0/0`
- Staging: empty.

## 3. PR Metadata

- PR URL: `https://github.com/paul-IM-78/fix-new-p5-phase2-runtime-supervisor/pull/5`
- PR base ref: `main`
- PR base SHA: `f327ad817787a636ee50d5ddb9c8f11bdb4a3125`
- PR head ref: `feat/p5-t03-custody-observer-runtime`
- PR head SHA before local remediation push: `da1c984895fe394b0ee319513930ea465669e87a`
- Review remediation remained local only.

## 4. Review Findings Addressed

1. Abort listener registration race in retry delay and mock adapter delay paths.
2. Missing runtime validation for untrusted adapter results before worker processing.
3. Exact replay bypass of current provider/binding/asset observability validation.
4. Missing executable assertion for existing `custody_observer_worker` role ACL contract.

## 5. Changed Files

Changed files before this report: 8.

```text
scripts/test-p5-t03-custody-balance-adapter-runtime.mjs
scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs
scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs
src/server/custody/balance-observer-retry.ts
src/server/custody/balance-observer-worker.ts
src/server/custody/mock-balance-observation-adapter.ts
supabase/migrations/20260801120000_p5_t03_observer_review_remediation.sql
supabase/tests/database/p5_t03_observer_review_remediation.test.sql
```

This report adds one additional governance file:

```text
docs/09-governance/NEW_P5_T03_07_PR_REVIEW_REMEDIATION_REPORT.md
```

- `src/app` diff: 0.
- `src/server/admin` diff: 0.
- `src/types/database.types.ts` diff after generation: 0.
- `package.json` diff: 0.
- `package-lock.json` diff: 0.
- Staged files: 0.

## 6. Abort Registration Race Remediation

- `waitForRetryDelay()` registers the abort listener before creating the timer.
- The retry delay path rechecks `signal.aborted` after listener registration.
- Completion is idempotent and removes the abort listener during cleanup.
- Timer cleanup is guarded by a cleanup holder so the abort path is safe before timer creation.
- The mock adapter delay helper uses the same registration, recheck, idempotent settle, and cleanup pattern.

Deterministic runtime coverage:

- Retry delay registration race: PASS.
- Retry delay race cleanup: PASS.
- Mock delay registration race: PASS.
- Mock delay race cleanup: PASS.

## 7. Adapter Result Validation Remediation

The worker treats adapter output as untrusted runtime data before using it.

- Adapter result array shape is checked before per-binding processing.
- Per-binding result validation runs before success/error handling.
- Malformed initial results map to `VALIDATION` / `ADAPTER_RESULT_INVALID`.
- Malformed retry results map to `VALIDATION` / `ADAPTER_RETRY_RESULT_INVALID`.
- Unknown identity kind or malformed `NATIVE` / `CHECKPOINT` identity maps to `IDENTITY` / `ADAPTER_IDENTITY_INVALID`.
- Malformed adapter results isolate the affected binding and do not block unrelated normal bindings.
- Raw `Error`, message, stack, payload, SQL detail, JWT/session/actor material, and raw provider payload are not returned.

Allowed adapter error catalog:

```text
TIMEOUT
RATE_LIMITED
PROVIDER_UNAVAILABLE
UNSUPPORTED_ASSET
MALFORMED_AMOUNT
MALFORMED_TIMESTAMP
MISSING_RESULT
DUPLICATE_RESULT
UNEXPECTED_RESULT
```

Retry contract:

- Retry is allowed only when the catalog code is retryable and `error.retryable === true`.
- `retryAfterMs` must be `null` or a non-negative safe integer not greater than `300000`.
- `NaN`, `Infinity`, strings, objects, negative values, and values above `300000` are rejected.

Runtime coverage:

- Unknown error code isolated: PASS.
- Non-boolean retryable isolated: PASS.
- Invalid `retryAfterMs` isolated: PASS.
- `TIMEOUT` with `retryable=false` does not retry: PASS.
- Non-retryable catalog code with `retryable=true` does not retry: PASS.
- Unknown identity isolated: PASS.
- Bad `NATIVE` value isolated: PASS.
- Bad `CHECKPOINT` value isolated: PASS.
- Malformed retry result invalid: PASS.

## 8. Exact Replay Observability Remediation

A forward-only migration was added:

```text
supabase/migrations/20260801120000_p5_t03_observer_review_remediation.sql
```

The migration recreates:

```text
private.record_balance_observation_and_advance_checkpoint(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  bigint,
  text,
  timestamptz
)
```

The atomic command now calls `private.record_external_balance_observation(...)` exactly once under the advisory transaction lock before any success/no-op return. This preserves the lower primitive's current provider, binding, and asset observability validation for replay and advance paths.

DB behavior verified:

- Exact replay with disabled provider fails with `binding_not_observable`.
- Exact replay with disabled binding fails with `binding_not_observable`.
- Exact replay with disabled asset fails with `binding_not_observable`.
- These failure paths leave observation/checkpoint side effects at 0.
- Observable old replay after a later checkpoint remains a no-op.
- Legacy catch-up remains supported.
- Regression and checkpoint conflict semantics are preserved.

## 9. Worker Role ACL Assertion

The migration adds:

```text
private.assert_custody_observer_worker_role_contract()
```

The assertion verifies the existing worker role contract:

- `custody_observer_worker` exists.
- Login is enabled.
- `NOINHERIT` is enforced.
- Elevated role attributes are absent.
- Worker is not a member of other roles.
- Non-migration-owner members of the worker role are forbidden.
- Direct private table privileges are forbidden.
- Direct private sequence privileges are forbidden.
- Broad private function execute is forbidden.
- Grant option on the atomic command is forbidden.
- Worker owns no database objects.
- Database create privilege is forbidden.
- Public schema create privilege is revoked.
- `private` schema usage required for the atomic command is retained.
- Atomic command execute remains granted only to the worker role.

Operational note:

- Database `TEMP` is not globally revoked from `PUBLIC` because the existing pgTAP/project temp-schema contract depends on PostgreSQL temp schema access. The assertion focuses on direct or effective worker-specific ACLs and excludes the global PostgreSQL `PUBLIC TEMP` contract.

Role contamination tests:

- Direct private table grant contamination is detected.
- Lower primitive execute grant contamination is detected.
- Atomic command grant option contamination is detected.
- Revoking each contaminating grant restores the role contract.
- The assertion function itself is not executable by the worker role.

## 10. Validation Results

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
Files=28
Tests=1336
Result=PASS
Failure=0
Skip=0
```

Runtime validation:

```text
git diff --check                                                PASS
node --check scripts/test-p5-t03-custody-balance-adapter-runtime.mjs PASS
node --check scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs PASS
node --check scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs PASS
npm run test:custody:balance-adapter:local                     PASS
npm run test:custody:balance-observer-worker:local             PASS
npm run test:custody:balance-observer-resilience:local         PASS
npm run test:custody:boundary:local                            PASS
npm run lint                                                   PASS
npm run build                                                  PASS
npm audit --omit=dev                                           PASS
npm audit                                                      PASS
```

Runtime case counts:

```text
CUSTODY_BALANCE_ADAPTER_RUNTIME_PASS
RUNTIME_CASE_COUNT=74
EXTERNAL_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0

CUSTODY_BALANCE_OBSERVER_WORKER_RUNTIME_PASS
WORKER_RUNTIME_CASE_COUNT=58
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0

CUSTODY_BALANCE_OBSERVER_RESILIENCE_RUNTIME_PASS
RESILIENCE_RUNTIME_CASE_COUNT=62
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0

CUSTODY_BOUNDARY_PASS
```

Audit:

```text
npm audit --omit=dev vulnerabilities=0
npm audit vulnerabilities=0
```

Build:

```text
Next.js build PASS
TypeScript PASS
```

Lint:

```text
ESLint PASS
Warnings=0
Errors=0
```

## 11. Safety and Cleanup

- External network calls during custody runtime verification: 0.
- Provider network calls during custody runtime verification: 0.
- Credential environment reads during custody runtime verification: 0.
- Service-role production usage: 0.
- Production provider implementation added: 0.
- Private key added: 0.
- Mnemonic added: 0.
- Client signing added: 0.
- Raw checkpoint identity logs: 0.
- Observation key logs: 0.
- Local Supabase was stopped by the final runtime/boundary harnesses.
- Temporary runtime cleanup checks: PASS.
- Port/process/container residue reported by harness cleanup: 0.
- `.env.local` content read/output: 0.
- Staging: empty.
- Commit: not performed.
- Push: not performed.
- PR update/comment/review/merge: not performed.

## 12. Secret Scan

Scope:

- Local remediation diff.
- New forward-only migration.
- New pgTAP remediation test.
- Runtime harness changes.
- This governance report.

Result:

- JWT: 0.
- Access token: 0.
- Refresh token: 0.
- Supabase anon key: 0.
- Supabase service-role key: 0.
- DB URL: 0.
- Password value: 0.
- TOTP secret: 0.
- Cookie/session value: 0.
- Private key: 0.
- Mnemonic/seed phrase: 0.
- Actual email: 0.
- Provider credential: 0.
- `.env.local` content: 0.

## 13. Final Git State

Expected working tree changes after this report:

```text
 M scripts/test-p5-t03-custody-balance-adapter-runtime.mjs
 M scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs
 M scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs
 M src/server/custody/balance-observer-retry.ts
 M src/server/custody/balance-observer-worker.ts
 M src/server/custody/mock-balance-observation-adapter.ts
?? docs/09-governance/NEW_P5_T03_07_PR_REVIEW_REMEDIATION_REPORT.md
?? supabase/migrations/20260801120000_p5_t03_observer_review_remediation.sql
?? supabase/tests/database/p5_t03_observer_review_remediation.test.sql
```

Staged files:

```text
0
```

## 14. Next Step

The remediation is ready for an explicit baseline commit in a separate commit task. Do not push or update PR #5 until the commit scope is reviewed.

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_PR_REVIEW_REMEDIATION_READY
