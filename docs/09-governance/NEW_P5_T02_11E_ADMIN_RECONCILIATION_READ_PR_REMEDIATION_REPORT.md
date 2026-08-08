# NEW-P5-T02-11E Admin Reconciliation Read PR Review Remediation Report

## A. Current State

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t02-admin-read-model`
- Start HEAD: `fd1c5f8841edf2fc2d8d2e415e6d5e1b53a08809`
- Final HEAD: `fd1c5f8841edf2fc2d8d2e415e6d5e1b53a08809`
- Tracking branch: `origin/feat/p5-t02-admin-read-model`
- Remote feature HEAD: `fd1c5f8841edf2fc2d8d2e415e6d5e1b53a08809`
- PR: `https://github.com/paul-IM-78/fix-new-p5-phase2-runtime-supervisor/pull/2`
- Staging: empty
- Commit: not created
- Push: not performed
- PR update/comment: not performed

## B. Review Findings And Root Cause

### DEFECT-1: Cursor Timestamp Microsecond Precision Loss

Root cause:

- Cursor timestamp validation accepted RFC3339/timestamptz strings but returned `new Date(time).toISOString()`.
- JavaScript `Date` canonicalizes to millisecond precision, so a DB value such as `2026-07-30T03:00:00.123456Z` could become `2026-07-30T03:00:00.123Z`.
- The DB cursor predicate uses `(items.created_at, items.id) < (cursor.created_at, cursor.item_id)`, so precision loss could skip or duplicate rows across pages.

Remediation:

- `src/lib/reconciliation/validation.ts` still validates with `Date.parse`, but now returns the validated original timestamp string.
- No cursor payload fields were added. The cursor remains `{ createdAt, itemId }`.
- No timestamp is converted to epoch milliseconds or reserialized with `toISOString()` on the cursor path.

### DEFECT-2: BINDING Scope List Provenance Count Mismatch

Root cause:

- The list RPC counted only rows from `private.reconciliation_item_binding_observations`.
- The detail RPC already synthesizes direct BINDING provenance from the reconciliation item itself when `scope_kind = 'BINDING'`.
- Therefore a BINDING item could show `targetBindingCount = 0` in the list while detail returned `provenance.length = 1`.

Remediation:

- A forward-only migration replaces only `public.list_admin_reconciliation_items`.
- The list RPC now builds a unified provenance row source:
  - ASSET_AGGREGATE rows from `private.reconciliation_item_binding_observations`
  - BINDING direct rows from `private.reconciliation_items`
- BINDING direct status mirrors the existing detail RPC:
  - `external_balance_observation_id is null` -> `OBSERVATION_FAILED`
  - otherwise -> `OBSERVED`

### DEFECT-3: Double Lookahead

Root cause:

- The application command passed `input.limit + 1` to the RPC.
- The DB RPC also fetched `p_limit + 1`.
- Public `limit=50` therefore caused a DB fetch of 52 rows instead of the intended 51.

Remediation:

- `src/server/admin/reconciliation-read-model.ts` now passes `p_limit: input.limit`.
- The DB RPC remains the sole owner of lookahead via `v_db_limit := v_limit + 1`.
- The public response still slices rows to the requested public limit and emits a cursor only when a lookahead row exists.

## C. Changed Files

- `src/lib/reconciliation/validation.ts`
- `src/server/admin/reconciliation-read-model.ts`
- `supabase/migrations/20260730223000_p5_t02_admin_reconciliation_read_model_remediation.sql`
- `supabase/tests/database/p5_t02_admin_reconciliation_read_model.test.sql`
- `scripts/test-p5-t02-admin-reconciliation-read-runtime.mjs`
- `docs/09-governance/NEW_P5_T02_11E_ADMIN_RECONCILIATION_READ_PR_REMEDIATION_REPORT.md`

Optional file `src/lib/reconciliation/public-results.ts` was not changed.

## D. Database Remediation

- New forward-only migration:
  - `supabase/migrations/20260730223000_p5_t02_admin_reconciliation_read_model_remediation.sql`
- Existing baseline migration diff:
  - `supabase/migrations/20260730161000_p5_t02_admin_reconciliation_read_model.sql`: diff 0
- RPC replaced:
  - `public.list_admin_reconciliation_items(integer, timestamptz, uuid, uuid, text, text, text, text, timestamptz, timestamptz)`
- RPC signature change: 0
- Detail RPC contract change: 0
- Generated type diff after `npm run db:types:local`: 0

Security contract after replacement:

- `STABLE`
- `SECURITY DEFINER`
- `SET search_path = ''`
- `authenticated` execute grant only
- `public` and `anon` execute revoked
- Internal `auth.uid()` / `public.is_current_user_admin_aal2()` check retained
- Private tables remain hidden from browser clients
- Numeric atomic-unit values remain returned as text
- No service-role production use
- No mutation or ledger side effect

## E. Test Additions

pgTAP:

- Added a real BINDING-scope reconciliation item fixture.
- Added assertion that the list count for that BINDING item is `1,1,0,0`.
- Added assertion that list target/observed/missing/failed counts match detail provenance status counts.
- Existing ASSET_AGGREGATE count coverage was retained.

Runtime harness:

- Added microsecond `created_at` fixture values.
- Added direct BINDING item fixture.
- Reworked pagination traversal to collect all pages and assert:
  - skipped rows 0
  - duplicated rows 0
  - full expected set
  - stable order
  - response length never exceeds public limit
  - cursor `createdAt` exactly equals the last item timestamp
  - cursor keeps a fractional component with 4-6 digits
- Added BINDING list/detail count consistency assertion.
- Existing 23 runtime test-case contract retained.
- Final admin-read runtime case count: 24.

## F. Verification Results

- `npm ci`: PASS
- `npm audit --omit=dev --json`: vulnerabilities 0
- `npm audit --include=dev --json`: vulnerabilities 0
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, schema errors 0
- `npm run db:test:local`: PASS
  - Files: 26
  - Tests: 1272
  - Failures: 0
  - Skips: 0
- `npm run db:types:local`: PASS
- `git diff -- src/types/database.types.ts`: diff 0
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS
- `npm run test:auth:admin-roles:local`: PASS
- `npm run test:reconciliation:review:local`: PASS
- `npm run test:reconciliation:admin-read:local`: PASS
  - `ADMIN_READ_MICROSECOND_CURSOR=PASS`
  - `ADMIN_READ_BINDING_PROVENANCE_COUNTS=PASS`
  - `ADMIN_READ_LIMIT_LOOKAHEAD=PASS`
  - `ADMIN_READ_RUNTIME_TEST_CASE_COUNT=24`
  - `FINAL_STATUS=PASS_ADMIN_RECONCILIATION_READ_RUNTIME_READY`

## G. Cleanup And Local Environment Protection

- `.env.local` content read: 0
- `.env.local` git state: ignored/untracked
- `.env.local` restored: PASS
- `.env.local` restored metadata matched:
  - Length: 256
  - LastWriteTimeUtc: `2026-07-19T05:42:12.8696187Z`
- Quarantine residue for this run: 0
- Fixture residue: 0
- Runtime taskkill fallback count: 0
- Current project Supabase container residue: 0
- Port residue:
  - 3000: 0
  - 3010: 0
  - 55721: 0
  - 55722: 0
  - 55723: 0
  - 55724: 0

## H. Secret Scan

Scope:

- Changed source/test/migration/report files
- Working tree diff
- New governance report

Excluded:

- `.env.local`
- quarantine backup paths
- local credential files

Result:

- JWT: 0
- access token: 0
- refresh token: 0
- cookie/session value: 0
- Supabase anon key: 0
- Supabase service-role key: 0
- DB URL: 0
- password value: 0
- TOTP secret value: 0
- private key: 0
- mnemonic/seed phrase: 0
- actual email: 0
- provider credential: 0
- raw provider payload: 0

## I. Git Boundary

- Allowed remediation files only: PASS
- Existing migration diff: 0
- `src/types/database.types.ts` diff: 0
- `package.json` diff: 0
- `package-lock.json` diff: 0
- Staging: empty
- Commit: not created
- Push: not performed
- PR update/comment: not performed
- Branch switch/rebase/merge/reset/restore/cherry-pick/worktree creation: not performed

## J. Final Decision

The three PR review defects are remediated without changing the existing detail RPC contract, generated types, package files, or the baseline migration.

FINAL_STATUS=PASS_ADMIN_RECONCILIATION_READ_PR_REMEDIATION_READY
