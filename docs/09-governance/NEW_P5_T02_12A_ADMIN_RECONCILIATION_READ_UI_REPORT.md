# NEW-P5-T02-12A Admin Reconciliation Read-only UI Report

## Current State

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t02-admin-reconciliation-ui`
- Start HEAD: `68b73b2ef2c2e6e523149d2fd55c0c339ee3dc9a`
- Final HEAD: `68b73b2ef2c2e6e523149d2fd55c0c339ee3dc9a`
- Staging: none
- Commit: none
- Push: none
- PR: none

## Changed Files

- `src/app/admin/page.tsx`
- `src/app/admin/reconciliation/page.tsx`
- `src/app/admin/reconciliation/items/[reconciliationItemId]/page.tsx`
- `src/app/admin/reconciliation/_components.tsx`
- `src/lib/reconciliation/display.ts`
- `docs/09-governance/NEW_P5_T02_12A_ADMIN_RECONCILIATION_READ_UI_REPORT.md`

## Admin Navigation

- Added an `/admin` menu link to `/admin/reconciliation`.
- Link label: `Reconciliation reads`.
- Admin home copy now states that reconciliation reads are a separate read-only AAL2 surface.

## Routes

- List page: `/admin/reconciliation`
- Detail page: `/admin/reconciliation/items/[reconciliationItemId]`
- Both pages are server components.
- Both pages export `dynamic = "force-dynamic"` and `revalidate = 0`.

## Admin Access

- Both pages use `getCurrentAdminAccess()`.
- Redirect handling follows the existing admin page pattern:
  - anonymous: sign-in
  - inactive: account unavailable
  - missing profile: account unavailable error
  - non-admin: admin forbidden error
  - MFA enrollment required: MFA enrollment
  - MFA challenge required: MFA challenge
  - unavailable: MFA unavailable error
- No new auth or redirect contract was introduced.

## Data Access

- List page calls `parseAdminReconciliationListQuery(...)`.
- List page calls `listAdminReconciliationItems(...)` only after query validation succeeds.
- Detail page calls `parseReconciliationItemId(...)`.
- Detail page calls `getAdminReconciliationItemDetail(...)` only after UUID validation succeeds.
- UI does not fetch the same-origin API.
- UI does not use browser fetch for reconciliation reads.
- UI does not use a browser Supabase client.
- UI does not query private tables.
- UI does not call RPCs directly.
- UI does not use service-role credentials.

## Filters And Search Params

- Search params are converted to `URLSearchParams` by appending every scalar value, including array values.
- Duplicate scalar query values therefore remain duplicate values and are rejected by the existing parser.
- Supported query keys:
  - `limit`
  - `cursor`
  - `assetId`
  - `runStatus`
  - `classification`
  - `reviewState`
  - `observerKind`
  - `cutoffFrom`
  - `cutoffTo`
- Invalid query state:
  - server read command is not called
  - raw parser internals are not displayed
  - a safe invalid filter message is displayed
  - reset link returns to `/admin/reconciliation`
- Filter submit uses an HTML GET form.
- Filter submit omits `cursor`, so filter changes restart from the first page.
- `cutoffFrom` and `cutoffTo` use text inputs to preserve RFC3339 timezone and microsecond strings.
- `assetId` is a UUID text input. This keeps the task data access limited to the reconciliation read model and avoids adding an extra catalog read to the page.

## Cursor Pagination

- The list page renders a `Next` link only when `nextCursor` is present.
- The `Next` URL preserves current filters and limit, and adds only the opaque cursor string.
- Cursor payload is not decoded or displayed.
- Cursor timestamp and cursor item UUID are not displayed.
- Previous page UX is browser Back, matching the requested minimal UX.
- A first-page link is shown when the current URL contains a cursor.
- No cursor stack, localStorage, or client state was added.

## Numeric Precision

- `expectedUnits`, `observedUnits`, `differenceUnits`, and `toleranceUnits` are displayed as strings.
- The UI does not convert atomic unit strings with `Number`, `parseInt`, or `parseFloat`.
- Unsigned values use the existing `formatAtomicUnitsForDisplay(...)`.
- Signed difference values use `formatSignedAtomicUnits(...)`, which:
  - splits a leading `-` as text
  - formats the unsigned remainder with the existing string formatter
  - rejoins the sign as text
  - does not use BigInt or JavaScript number conversion
- Null numeric values render as `--`.
- Numeric cells use monospace/tabular styling and allow overflow wrapping.

## Timestamp Display

- Render-only timestamps use `formatOptionalTimestamp(...)`.
- Invalid or null timestamps render as `--`.
- Filter and cursor source strings are not reformatted before validation or pagination.

## List UI

- Header includes:
  - back link to admin
  - title
  - read-only explanation
  - result count
  - active filter count
  - active filter summary
- Filter form includes:
  - `assetId`
  - `runStatus`
  - `classification`
  - `reviewState`
  - `observerKind`
  - `cutoffFrom`
  - `cutoffTo`
  - `limit`
- Table columns:
  - Asset
  - Run status
  - Scope
  - Classification
  - Review
  - Observer
  - Cutoff
  - Expected
  - Observed
  - Difference
  - Tolerance
  - Provenance counts
  - Created
  - Detail
- Full provenance is not rendered in the list.
- List provenance uses count summary only.

## Detail UI

- Invalid UUID path is handled without calling the read command.
- Missing item is rendered as a safe not-found state.
- Raw RPC errors are not displayed.
- Header includes:
  - back link to list
  - asset symbol/code
  - classification badge
  - run status badge
  - scope kind
  - item ID
  - read-only explanation
- Run section includes run ID, status, trigger source, observer kind, cutoff, started, completed, created, and failure code.
- Item section includes item ID, asset ID, asset code, symbol, display name, decimals, scope, expected, observed, difference, tolerance, classification, and created.
- Provenance section includes provider, binding label, binding role, membership status, custody account binding ID, external balance observation ID, observed units, observed at, and created.
- Review case section includes review case ID, status, version, opened, updated, and resolved when present.
- Review event timeline includes event version, event type, from status, to status, reason code, and created at.
- Review event order is the existing RPC order.

## Shared Component And Helper

- `src/app/admin/reconciliation/_components.tsx`
  - shared page shell
  - admin header
  - alert
  - section
  - table scroller
  - empty state
  - text+color status badge
  - definition grid
  - monospace value wrapper
- `src/lib/reconciliation/display.ts`
  - timestamp display helper
  - optional atomic units helper
  - signed difference helper
  - optional text helper
  - short identifier helper

## Responsive And Accessibility

- Tables use horizontal overflow for mobile.
- Filter form uses responsive grid columns.
- Detail metadata uses responsive definition grids.
- Form controls have explicit labels.
- Status presentation uses both text and color.
- Long UUIDs and atomic values are wrapped safely.
- Heading order is preserved.
- No client component or client JavaScript state was added.

## Explicit Exclusions

- Review case open button: not added
- Review state transition button: not added
- Mutation form: not added
- DB migration: not changed
- RPC: not changed
- API routes: not changed
- Server command files: not changed
- Generated types: not changed
- Package files: not changed
- Scripts: not changed
- New runtime/E2E harness: not added
- Ledger side effects: none
- Provider/network calls: none

## Verification

- `npm ci`: PASS
- `npm audit --omit=dev --json`: vulnerabilities total 0
- `npm audit --include=dev --json`: vulnerabilities total 0
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS
- `npm run test:auth:admin-roles:local`: PASS
- `npm run test:reconciliation:admin-read:local`: PASS
- Admin read runtime case count: 25
- Admin read runtime final status: `PASS_ADMIN_RECONCILIATION_READ_RUNTIME_READY`
- Admin read fixture residue: 0
- Admin read runtime taskkill fallback count: 0
- `npm run supabase:stop`: PASS

## Static Diff Checks

- `git diff -- supabase`: diff 0
- `git diff -- src/types/database.types.ts`: diff 0
- `git diff -- src/app/api`: diff 0
- `git diff -- src/server`: diff 0
- `git diff -- package.json package-lock.json`: diff 0
- `git diff -- scripts`: diff 0
- `git diff --cached --name-only`: empty
- `git diff --check`: PASS

## Local Environment And Cleanup

- Existing `.env.local`: present, ignored by git
- `.env.local` content read count: 0
- `.env.local` content output count: 0
- `.env.local` staged: no
- `.env.local.phase2-supervisor`: absent
- Temporary quarantine residue count: 0
- Port listeners on 3000, 3010, 55721, 55722, 55723, 55724: 0
- Project process count: 0
- Project Supabase container count: 0

## Secret Scan

- New UI/source diff actual secret value findings: 0
- New UI/source forbidden response marker findings: 0
- Actual credential, token, email, cookie, DB URL, TOTP secret, private key, mnemonic, seed phrase, provider credential, and `.env.local` content copied: 0

## Final Judgment

The read-only ADMIN+AAL2 reconciliation UI is implemented without changing DB, API, server command, generated type, package, or script boundaries. Existing backend/runtime gates pass, and UI runtime/E2E coverage remains deferred to P5-T02-12C as requested.

FINAL_STATUS=PASS_ADMIN_RECONCILIATION_READ_UI_READY
