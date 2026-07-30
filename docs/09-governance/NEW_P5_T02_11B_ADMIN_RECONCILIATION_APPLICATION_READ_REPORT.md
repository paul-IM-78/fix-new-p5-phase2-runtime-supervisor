# NEW-P5-T02-11B Admin Reconciliation Application Read Report

## Current State

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t02-admin-read-model`
- Start HEAD: `d0f45b969d9fbb99cfcc427b25b7e20c527c1b9a`
- Final HEAD: `d0f45b969d9fbb99cfcc427b25b7e20c527c1b9a`
- Start status: clean
- End status: unstaged application/report changes only
- Staging: 0
- Commit: 0
- Push: 0
- PR: 0

## Changed Files

- `src/lib/reconciliation/validation.ts`
- `src/lib/reconciliation/public-results.ts`
- `src/server/admin/reconciliation-read-model.ts`
- `src/app/api/v1/admin/reconciliation/items/route.ts`
- `src/app/api/v1/admin/reconciliation/items/[reconciliationItemId]/route.ts`
- `docs/09-governance/NEW_P5_T02_11B_ADMIN_RECONCILIATION_APPLICATION_READ_REPORT.md`

## Forbidden Scope Check

- `supabase/**`: no change
- `src/types/database.types.ts`: no change after `npm run db:types:local`
- `package.json`: no change
- `package-lock.json`: no change
- `scripts/**`: no change
- Existing reconciliation mutation routes: no change
- `src/server/admin/reconciliation-review-commands.ts`: no change
- Existing ADMIN guard: no change
- Existing Supabase server client creator: no change
- New runtime harness: 0
- Migration / DB function / pgTAP change: 0
- UI change: 0

## Application Boundary

### List Route

- Route: `GET /api/v1/admin/reconciliation/items`
- File: `src/app/api/v1/admin/reconciliation/items/route.ts`
- Handler validates the query string with `parseAdminReconciliationListQuery`.
- Success body: `{ "ok": true, "result": ... }`
- Error body: `{ "ok": false, "error": { "code": "..." } }`
- Response headers include `Cache-Control: no-store` and `Pragma: no-cache`.
- No request body is read.
- No CORS header was added.

### Detail Route

- Route: `GET /api/v1/admin/reconciliation/items/[reconciliationItemId]`
- File: `src/app/api/v1/admin/reconciliation/items/[reconciliationItemId]/route.ts`
- Next route params are awaited before UUID validation.
- Invalid UUID returns HTTP 400 `invalid_request`.
- Missing item returns HTTP 404 `reconciliation_item_not_found`.
- Success and error envelopes match the list route.
- Response headers include `Cache-Control: no-store` and `Pragma: no-cache`.

### Server Read Commands

- File: `src/server/admin/reconciliation-read-model.ts`
- `listAdminReconciliationItems(input)`
- `getAdminReconciliationItemDetail(reconciliationItemId)`
- Both commands use `createServerSupabaseClient()`.
- Both commands run `inspectAdminAccess()` before RPC access.
- Both commands call only the DB read RPCs:
  - `public.list_admin_reconciliation_items`
  - `public.get_admin_reconciliation_item_detail`
- No private table direct query is used.
- No service-role client is used.
- No mutation/review/ledger/provider/audit/checkpoint command is invoked.

## Auth And Error Mapping

- Unauthenticated: HTTP 401 `admin_authentication_required`
- Non-admin or user role: HTTP 403 `admin_role_required`
- ADMIN without AAL2: HTTP 403 `admin_aal2_required`
- Invalid query/path/cursor: HTTP 400 `invalid_request`
- Missing detail: HTTP 404 `reconciliation_item_not_found`
- Auth/session infrastructure failure: HTTP 503 `admin_authentication_unavailable`
- Unexpected RPC/read failure: HTTP 500 `reconciliation_read_unavailable`

DB defense-in-depth errors are mapped only through exact public-safe allowlists:

- SQLSTATE `42501` with canonical message `ADMIN_AAL2_REQUIRED`
- SQLSTATE `22023` with canonical message `INVALID_INPUT`

Raw DB errors, details, hints, SQLSTATE values, stack traces, private table names, actor IDs, session values, JWT claims, and cookies are not returned by the routes.

## Query Contract

Allowed list query parameters:

- `limit`
- `cursor`
- `assetId`
- `runStatus`
- `classification`
- `reviewState`
- `observerKind`
- `cutoffFrom`
- `cutoffTo`

Validation behavior:

- Unknown query keys are rejected.
- Duplicate scalar keys are rejected.
- Present-but-empty values are rejected.
- `limit` range is `1..100`; default is `50`.
- `assetId` must be UUID.
- `runStatus` is restricted to the DB run status values used by the read model.
- `classification` is restricted to the reconciliation item classification values.
- `reviewState` accepts `NONE` or actual review case statuses.
- `observerKind` uses the DB-compatible observer-kind token pattern.
- `cutoffFrom` and `cutoffTo` must be valid ISO/RFC3339 timestamps.
- When both cutoffs are present, `cutoffFrom < cutoffTo` is required.

## Cursor Contract

- Public cursor format: opaque base64url JSON.
- Exact decoded payload shape: `{ "createdAt": "...", "itemId": "..." }`
- `createdAt` is derived from the returned item's `itemCreatedAt`.
- `itemId` is derived from the returned item's `reconciliationItemId`.
- Extra cursor fields are rejected.
- Malformed base64url, malformed JSON, malformed timestamp, and malformed UUID are rejected.
- Actor, session, filters, secrets, JWT claims, and cookies are not stored in the cursor.
- The application trims returned rows to the requested limit and emits `nextCursor` only when lookahead proves another page exists.

## Public Result Normalization

List result fields are camelCase and public-safe. Numeric atomic-unit fields remain strings or null:

- `expectedUnits`
- `observedUnits`
- `differenceUnits`
- `toleranceUnits`

Counts are numbers only after safe-integer validation:

- `targetBindingCount`
- `observedBindingCount`
- `missingBindingCount`
- `failedBindingCount`

Detail result includes public-safe `run`, `item`, `asset`, `provenance`, `reviewCase`, and `reviewEvents` sections. The normalizers validate the RPC payload shape and reject unexpected top-level/nested keys with a safe internal read error instead of returning raw rows.

Allowed public IDs:

- `reconciliationItemId`
- `reconciliationRunId`
- `assetId`
- `custodyAccountBindingId`
- `reviewCaseId`
- `externalBalanceObservationId`

Forbidden public fields/IDs:

- profile IDs
- actor profile IDs
- requested/opened/last actor IDs
- session/JWT/cookie values
- idempotency keys
- observation keys
- checkpoint cursors
- raw provider payloads
- raw provider responses
- credentials or provider internal metadata

## GET Same-Origin Decision

The new read routes intentionally do not add CORS headers and do not unconditionally apply mutation CSRF helpers to GET. The boundary relies on the existing project pattern:

- user-scoped cookie Supabase session
- application-level ADMIN + AAL2 check
- DB-level ADMIN + AAL2 recheck in the SECURITY DEFINER read RPCs
- browser same-origin policy
- no-store response headers

This keeps the read boundary aligned with same-origin server-side ADMIN read patterns without weakening mutation CSRF boundaries.

## Side Effects

- `INSERT`: 0
- `UPDATE`: 0
- `DELETE`: 0
- Mutation RPC calls: 0
- Review command calls: 0
- Ledger command calls: 0
- Observation writer calls: 0
- Checkpoint writer calls: 0
- Audit writer calls: 0
- Provider/network calls: 0

## Verification

### Application Gate

- `npm ci`: PASS
- `npm audit --omit=dev --json`: PASS, 0 vulnerabilities
- `npm audit --include=dev --json`: PASS, 0 vulnerabilities
- `npm run lint`: PASS
- `npm run build`: PASS
- R1 rerun after runtime regression resume:
  - `npm run lint`: PASS, warnings 0
  - `npm run build`: PASS

### DB Baseline Regression

- `npm run supabase:start`: PASS; CLI local default credentials were not copied into this report
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS
- `npm run db:test:local`: PASS, 26 files / 1270 tests
- `npm run db:types:local`: PASS
- Generated type diff: 0

### Existing Runtime Regression

- Initial 11B block cause: pre-existing local `.env.local` violated the self-owned runtime harness cleanup pre/postcondition.
- The file was confirmed to be Git ignored and untracked before quarantine.
- `.env.local` contents were not read, printed, scanned, or copied into the repository.
- Original metadata was recorded only as file path, length, and last-write time:
  - Path: `D:\Ai\staking-wallet-web\.env.local`
  - Length: `256`
  - LastWriteTimeUtc: `2026-07-19T05:42:12.8696187Z`
- The file was temporarily moved outside the repository to `c:\Temp\staking-wallet-web-p5-t02-11b-env-5818ac97ffac405287e2d432e2c1a271`.
- `npm run test:auth:admin-roles:local`: PASS
- `npm run test:reconciliation:review:local`: PASS
- Existing runtime coverage confirmed:
  - USER AAL2 denied
  - ADMIN AAL1 denied
  - ADMIN AAL2 allowed
  - actor derivation
  - actor spoof blocked
  - exact replay
  - conflicting replay
  - version conflict HTTP 409
  - terminal protection
  - safe public response
  - side-effect boundary
  - fixture cleanup
  - parent/self-owned runtime natural cleanup
- No runtime harness was created or extended.

## Cleanup

- `npm run supabase:stop`: PASS
- Port 3000 listener: 0
- Port 3010 listener: 0
- Port 55721 listener: 0
- Port 55722 listener: 0
- Port 55723 listener: 0
- Port 55724 listener: 0
- Current project process: 0
- Current project Supabase container: 0
- Runtime-created `.env.local` residue: 0
- Existing user-owned `.env.local`: restored to original path
- Restored metadata matched original:
  - Length: `256`
  - LastWriteTimeUtc: `2026-07-19T05:42:12.8696187Z`
- Temporary backup file residue: 0
- Temporary backup directory residue: 0
- `.env.local`: not modified, not read, not staged
- `.env.local.phase2-supervisor`: absent
- No access to `D:\Ai\Ai_Salon_ERP`
- No access to `D:\Ai\Ai_Salon_ERP_main_clean`

## Secret Scan

Changed files and diff were checked for actual secret-like values. No JWTs,
Supabase keys, service-role keys, DB URLs, private key blocks, mnemonic
phrases, seed phrases, actual email fixture values, provider credentials,
cookies, or session values were found.

## Git Summary

Expected `git status --short` after this task:

```text
 M src/lib/reconciliation/public-results.ts
 M src/lib/reconciliation/validation.ts
?? docs/09-governance/NEW_P5_T02_11B_ADMIN_RECONCILIATION_APPLICATION_READ_REPORT.md
?? src/app/api/v1/admin/reconciliation/items/
?? src/server/admin/reconciliation-read-model.ts
```

Expected changed-file scope:

- application validation
- public error/result helpers
- server read boundary
- GET list/detail routes
- governance report

No staging, commit, push, PR, branch switch, merge, rebase, reset, Git restore, or worktree creation was performed.

## Final Status

`PASS_ADMIN_RECONCILIATION_APPLICATION_READ_READY`

Reason: the application read boundary implementation, DB baseline validation, existing runtime regressions, lint/build reruns, cleanup, safe `.env.local` quarantine/restore, and secret scan are complete.
