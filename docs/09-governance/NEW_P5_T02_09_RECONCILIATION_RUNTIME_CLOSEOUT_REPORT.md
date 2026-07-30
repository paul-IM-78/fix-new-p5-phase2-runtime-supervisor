# NEW-P5-T02-09 Reconciliation Runtime Closeout Report

## Summary

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Start HEAD: `5ab586f87391ea41e6366ac36b874e6ee1a27d0c`
- Baseline marker: `PASS_AAL2_ADMIN_REVIEW_COMMAND_BASELINE_COMMITTED`
- Final status: `PASS_P5_T02_RUNTIME_CLOSEOUT_READY`

The dedicated reconciliation review runtime harness now passes against the real
Next.js HTTP routes, local Supabase Auth sessions, local PostgreSQL fixture
data, and the existing ADMIN/AAL2 MFA pattern. The stale-version path returns a
deterministic public conflict response without exposing raw DB errors.

## Preserved Failure History

### Initial Result

The first runtime harness exposed a stale-version mapping defect:

```text
HTTP status: 500
Public code: reconciliation_review_unavailable
Expected status: 409
Expected code: reconciliation_review_version_conflict
```

### R1 Result

R1 added exact application-side matching for canonical safe RPC error fields
(`message`, `details`, and `hint`) and narrowed the temporary SQLSTATE fallback
to `transition_review`. The runtime still failed because the application did
not receive a PostgREST-style error object; the local route observed a
message-only upstream timeout.

```text
R1 final status: REQUIRES_ACTION
Initial finding: HTTP 500 generic unavailable
R1 finding: canonical mapper added, but message-only upstream timeout remained
```

## R2 Layer Isolation

The stale-version path was separated into three boundaries with the same local
fixture and stale expected version condition.

### A. Private DB Lifecycle Function

- Function: `private.transition_reconciliation_resolution(...)`
- Result: `IMMEDIATE_DOMAIN_ERROR`
- Duration: `140 ms` in the final PASS run
- SQLSTATE: `40001`
- Message: `reconciliation_resolution_version_conflict`
- State mutation: 0
- Event mutation: 0

The private optimistic concurrency contract remains unchanged.

### B. Public ADMIN RPC Boundary

- Function: `public.admin_transition_review_case(...)`
- Direct DB caller contract: preserves private `40001`
- PostgREST request-context contract: translates exact version conflict to
  `PT409`
- Duration: `120 ms` in the final PASS run
- Safe transport status: `409`
- Safe transport code: `PT409`
- Safe message class: `canonical_version_conflict`

The first confirmed R2 correction was inside this boundary. The wrapper was
attempting to call `pg_catalog.nullif(...)` in the exception handler; `NULLIF`
is SQL syntax rather than a schema-qualified function, so the handler produced
SQLSTATE `42883` instead of the intended transport-safe conflict. The fix uses
plain `nullif(...)`.

### C. Next.js HTTP Route

- Route: `POST /api/v1/admin/reconciliation/reviews/transition`
- Final status: `409`
- Final public code: `reconciliation_review_version_conflict`
- Raw DB error exposure: 0
- Generic unavailable misclassification: resolved
- Response timeout: 0

## Lock And Transport Diagnostics

```text
VERSION_CONFLICT_BLOCKED_SESSION_COUNT=0
VERSION_CONFLICT_BLOCKING_SESSION_COUNT=0
VERSION_CONFLICT_WAIT_CLASS=Client
OPEN_TRANSACTION_RESIDUE=0
POSTGREST_REQUEST_COMPLETED=true
POSTGREST_ERROR_CLASS=transport_safe_domain_error
KONG_UPSTREAM_TIMEOUT=false
SQLSTATE_40001_TRANSPORT_HYPOTHESIS=CONFIRMED
```

Confirmed root cause:

```text
Private lifecycle correctly raises 40001 for optimistic version conflicts.
The public RPC needed an exact PostgREST transport translation for that one
domain error. An invalid schema-qualified NULLIF call initially prevented the
translation and surfaced as a transport failure.
```

## Correction

Modified files:

- `package.json`
- `src/server/admin/reconciliation-review-commands.ts`
- `scripts/test-p5-t02-reconciliation-review-runtime.mjs`
- `docs/09-governance/NEW_P5_T02_09_RECONCILIATION_RUNTIME_CLOSEOUT_REPORT.md`
- `supabase/migrations/20260729107100_p5_t02_reconciliation_admin_error_transport.sql`
- `supabase/tests/database/p5_t02_reconciliation_admin_error_transport.test.sql`

Correction details:

- Added a forward migration for only
  `public.admin_transition_review_case(uuid, bigint, text, text, text)`.
- Preserved private `40001` for direct DB lifecycle calls.
- Preserved direct DB public wrapper `40001` where no PostgREST request context
  exists.
- Translated only exact
  `SQLSTATE=40001 + reconciliation_resolution_version_conflict` inside a
  PostgREST request context to `PT409`.
- Removed the application mapper's broad `40001` fallback so unrelated
  serialization failures are not misclassified as review version conflicts.
- Kept exact safe domain-code mapping across `message`, `details`, and `hint`.
- Added pgTAP coverage for private DB, direct public DB, and PostgREST-context
  public RPC error transport contracts.
- Added runtime harness markers for private/public/route layer separation.

Forward migration: yes

Transport SQLSTATE:

```text
PT409
```

Broad `40001` fallback removed: yes

## Runtime Harness Results

Command:

```text
npm run test:reconciliation:review:local
```

Result:

```text
RUNTIME_HTTP_UNAUTHENTICATED=PASS
RUNTIME_HTTP_USER_AAL2_DENIED=PASS
RUNTIME_HTTP_ADMIN_AAL1_DENIED=PASS
RUNTIME_HTTP_ADMIN_AAL2_OPEN=PASS
RUNTIME_HTTP_ACTOR_DERIVATION=PASS
RUNTIME_HTTP_ACTOR_SPOOF_BLOCKED=PASS
RUNTIME_HTTP_OPEN_REPLAY=PASS
RUNTIME_HTTP_OPEN_CONFLICT=PASS
RUNTIME_HTTP_TRANSITION_VALIDATION=PASS
RUNTIME_HTTP_TRANSITION=PASS
RUNTIME_HTTP_TRANSITION_REPLAY=PASS
RUNTIME_HTTP_VERSION_CONFLICT=PASS
RUNTIME_HTTP_TERMINAL_PROTECTION=PASS
RUNTIME_HTTP_SIDE_EFFECT_BOUNDARY=PASS
RUNTIME_SAFE_RESPONSE=PASS
RUNTIME_LOW_LEVEL_PRIVILEGE_BLOCKED=PASS
RUNTIME_FIXTURE_CLEANUP=PASS
FINAL_STATUS=PASS_P5_T02_RUNTIME_CLOSEOUT_READY
```

Child process cleanup: PASS

Parent natural exit: PASS

Taskkill fallback count: `0`

## Regression Gates

### ADMIN/AAL2 Runtime

Command:

```text
npm run test:auth:admin-roles:local
```

Result: PASS

### DB Full Gate

Commands:

```text
npm run db:reset:local
npm run db:lint:local
npm run db:test:local
npm run db:types:local
```

Results:

```text
DB reset: PASS
DB lint: PASS, error 0, warning 0
pgTAP files: 25
pgTAP tests: 1235
pgTAP failures: 0
pgTAP skips: 0
Generated type diff: 0
```

### Dependency And Static Gates

Commands:

```text
npm ci
npm audit --omit=dev --json
npm audit --include=dev --json
npm run lint
npm run build
```

Results:

```text
npm ci: PASS
Production audit vulnerabilities: 0
Full audit vulnerabilities: 0
Lint: PASS
Build: PASS
Next.js: 16.2.11
React: 19.2.4
React DOM: 19.2.4
PostCSS override: 8.5.18
```

## Cleanup

```text
Supabase stop: PASS
Current project process: 0
Current project container: 0
Port 3000 listener: 0
Port 3010 listener: 0
Port 55721-55724 listener: 0
Runtime timeout: 0
Open DB transaction: 0
the-lost-heir-api restarted: false
```

## Scope Audit

```text
Production reconciliation source changed: 1
DB migration added: 1
pgTAP added: 1
Generated DB types changed: 0
Dependency changes: 0
package-lock.json changes: 0
Existing migrations modified: 0
Existing pgTAP files modified: 0
Staging: 0
Commit: 0
Push: 0
PR: 0
```

## Secret Scan

Changed files were scanned for JWT-shaped values, Supabase secret/publishable
key values, database URL assignments, private-key markers, mnemonic markers,
and token values. No actual secret values were written.

Positive text hits were limited to safe denylist strings in the runtime harness
and the marker `SERVICE_ROLE_PRODUCTION_USAGE=0`.

CLI output from local Supabase commands can contain local default credentials;
those values are not copied into this report.

## Completion Matrix

```text
P5_T02_DB_WRITE_PATH_COMPLETE=true
P5_T02_APPLICATION_MUTATION_BOUNDARY_COMPLETE=true
P5_T02_HTTP_RUNTIME_VERIFIED=true

P5_T02_ADMIN_READ_MODEL=DEFERRED
P5_T02_ADMIN_UI=DEFERRED
P5_T02_PROVIDER_NETWORK=DEFERRED
P5_T02_SCHEDULER=DEFERRED
```

## Final Status

```text
P5_T02_RUNTIME_CLOSEOUT_READY=true
FINAL_STATUS=PASS_P5_T02_RUNTIME_CLOSEOUT_READY
```
