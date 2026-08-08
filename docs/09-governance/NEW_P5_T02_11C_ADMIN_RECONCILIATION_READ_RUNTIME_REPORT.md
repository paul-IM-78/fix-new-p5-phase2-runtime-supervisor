# NEW-P5-T02-11C Admin Reconciliation Read Runtime Report

## Status

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t02-admin-read-model`
- Start HEAD: `adaaf02927789157ba0e2d79175d2faaa72048e0`
- Final HEAD: `adaaf02927789157ba0e2d79175d2faaa72048e0`
- Git status at report time:
  - `M package.json`
  - `?? scripts/test-p5-t02-admin-reconciliation-read-runtime.mjs`
  - `?? docs/09-governance/NEW_P5_T02_11C_ADMIN_RECONCILIATION_READ_RUNTIME_REPORT.md`
- Staging: empty
- Commit/push: not performed

## Scope

Allowed files changed:

- `scripts/test-p5-t02-admin-reconciliation-read-runtime.mjs`
- `package.json`
- `docs/09-governance/NEW_P5_T02_11C_ADMIN_RECONCILIATION_READ_RUNTIME_REPORT.md`

Files intentionally not changed:

- `src/**`
- `supabase/**`
- `src/types/database.types.ts`
- `package-lock.json`
- Existing runtime harnesses, migrations, pgTAP tests, auth guard, and reconciliation mutation code

`package.json` only adds:

```json
"test:reconciliation:admin-read:local": "node scripts/test-p5-t02-admin-reconciliation-read-runtime.mjs"
```

## Harness

Runtime harness:

- Starts owned local Supabase runtime.
- Runs local DB reset before fixture setup.
- Starts the Next application on `127.0.0.1:3010`.
- Uses actual HTTP GET routes:
  - `GET /api/v1/admin/reconciliation/items`
  - `GET /api/v1/admin/reconciliation/items/[reconciliationItemId]`
- Uses Mailpit-confirmed local sign-up and real cookie jars.
- Creates USER AAL2 and ADMIN AAL1/AAL2 sessions through the application boundary.
- Inserts reconciliation read fixture directly into local private tables after DB reset.
- Stops the owned Next process, resets DB, stops Supabase, and verifies residue cleanup.

`.env.local` protection:

- Existing ignored/untracked `.env.local` is never read.
- It is moved outside the repository during runtime to `D:\Ai\.staking-wallet-runtime-quarantine\<uuid>\.env.local`.
- It is restored after runtime.
- Metadata match was verified.
- Backup residue after restore: `0`.

Local fixture shape:

- 2 supported assets
- 1 custody provider
- 5 custody account bindings
- 8 external balance observations
- 3 reconciliation runs
- 5 reconciliation items
- 10 binding provenance rows
- 1 reconciliation review case
- 2 reconciliation review events

The custody provider and bindings follow the current lifecycle contract: insert as `DRAFT`, then transition to `APPROVED`.

## Runtime Coverage

Authentication and authorization:

- Unauthenticated list/detail: `401 admin_authentication_required`
- USER AAL2 list/detail: `403 admin_role_required`
- ADMIN AAL1 list/detail: `403 admin_aal2_required`
- ADMIN AAL2 list/detail: `200`

List API:

- Default list response shape
- Stable ordering by `itemCreatedAt desc, reconciliationItemId desc`
- Lookahead pagination with `limit=2`
- Opaque cursor shape with decoded `{ createdAt, itemId }`
- 27 invalid query cases
- 11 invalid cursor cases
- Filters:
  - `assetId`
  - `runStatus`
  - `classification`
  - `reviewState`
  - `observerKind`
  - `cutoffFrom`
  - `cutoffTo`
  - compound asset/observer filter
- Provenance is summarized in list responses through counts only.
- Full provenance rows are not included in list responses.

Detail API:

- Safe run/item/detail shape
- Full provenance rows
- Stable provenance ordering
- Review case fields
- Review event fields ordered by event version
- Invalid UUID: `400 invalid_request`
- Missing UUID: `404 reconciliation_item_not_found`
- Unexpected query string is ignored safely by the existing detail route and still returns the path item.

Numeric and public-safety assertions:

- Exact Atomic Unit values are asserted as strings.
- Huge integer precision is preserved.
- Zero and null are distinguished.
- Signed differences are preserved as strings.
- Raw JavaScript number coercion is not used for API amount assertions.
- Responses are checked for no leaked cookies/JWT/session/secret-like markers.
- Responses exclude actor profile IDs, idempotency keys, private DB error details, and private table names.
- Changed-file secret-shape scan found `0` private key blocks, JWT-shaped literals, mnemonic assignments, service-role assignments, and database URL assignments.

Side-effect and method boundary:

- POST to list/detail routes is rejected by route method boundary.
- Read side-effect snapshot is unchanged after GET calls.
- No mutation or ledger side effect is introduced by the read runtime.

## Results

Runtime harness:

```text
npm run test:reconciliation:admin-read:local
FINAL_STATUS=PASS_ADMIN_RECONCILIATION_READ_RUNTIME_READY
ADMIN_READ_RUNTIME_TEST_CASE_COUNT=23
```

Lint:

```text
npm run lint
PASS
```

Build:

```text
npm run build
PASS
```

Build route output included both admin reconciliation read routes:

- `/api/v1/admin/reconciliation/items`
- `/api/v1/admin/reconciliation/items/[reconciliationItemId]`

## Cleanup Result

Post-runtime cleanup checks:

- Port `3000`: `0` listeners
- Port `3010`: `0` listeners
- Port `55721`: `0` listeners
- Port `55722`: `0` listeners
- Port `55723`: `0` listeners
- Port `55724`: `0` listeners
- Project containers: `0`
- Project processes: `0`
- `.env.local` exists: `true`
- `.env.local.phase2-supervisor` exists: `false`
- Quarantine residue: `0`

## Risk Notes

- The harness owns local Supabase and Next lifecycle; it must not run while another process is using the project ports.
- The fixture is intentionally local-only and writes private tables only after DB reset.
- The harness does not use service-role production credentials.
- DB/application sources were not modified during this task.
- Existing pgTAP/database baseline was not changed by this task.

## Final Judgment

The Admin Reconciliation GET API runtime boundary is now covered by a self-owned local HTTP harness with real auth, AAL2, list/detail, pagination, filters, safe response, numeric precision, side-effect, and cleanup checks.

FINAL_STATUS=PASS_ADMIN_RECONCILIATION_READ_RUNTIME_READY
