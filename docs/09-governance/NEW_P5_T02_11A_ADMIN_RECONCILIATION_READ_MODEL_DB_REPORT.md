# NEW-P5-T02-11A Admin Reconciliation Read Model DB Report

## Status

- Final status: `PASS_ADMIN_RECONCILIATION_READ_MODEL_DB_READY`
- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t02-admin-read-model`
- Starting HEAD: `62aaf73839ced73c3808fdd62fac9452c4b42bba`
- Scope: DB-only public admin reconciliation read model

## Files Changed

- `supabase/migrations/20260730161000_p5_t02_admin_reconciliation_read_model.sql`
- `supabase/tests/database/p5_t02_admin_reconciliation_read_model.test.sql`
- `supabase/tests/database/p5_t02_reconciliation_core.test.sql`
- `supabase/tests/database/p5_t02_asset_aggregate_scope.test.sql`
- `supabase/tests/database/p5_t02_create_asset_reconciliation_run.test.sql`
- `supabase/tests/database/p5_t02_reconciliation_review_lifecycle.test.sql`
- `src/types/database.types.ts`
- `docs/09-governance/NEW_P5_T02_11A_ADMIN_RECONCILIATION_READ_MODEL_DB_REPORT.md`

No application server command, HTTP route, UI, runtime harness, package manifest, lockfile, script, existing migration, mutation RPC, branch, staging, commit, push, PR, worktree, WIP branch, private key, mnemonic, client signing, provider network, ledger mutation, or service-role production path was added.

## Implemented RPCs

### `public.list_admin_reconciliation_items(...)`

- Type: `plpgsql`, `STABLE`, `SECURITY DEFINER`, `SET search_path = ''`
- Authorization: derives actor from `auth.uid()` and requires `public.is_current_user_admin_aal2()` internally.
- Grants: execute revoked from `public`, `anon`, and `authenticated`, then granted only to `authenticated`.
- Pagination: compound cursor `(p_before_created_at, p_before_item_id)`, both null or both non-null.
- Ordering: `private.reconciliation_items.created_at desc, private.reconciliation_items.id desc`.
- Limit contract: public `p_limit` range `1..100`; DB returns `p_limit + 1` rows for lookahead, maximum 101.
- Filters: `asset_id`, run status, item classification, review state, observer kind, cutoff from inclusive, cutoff to exclusive.
- Counts: aggregate provenance counts from `private.reconciliation_item_binding_observations` without joining into list rows.
- Numeric serialization: `expected_units`, `observed_units`, `difference_units`, and `tolerance_units` are returned as text.
- Exclusions: idempotency keys, profile/actor IDs, raw provider payload fields, observation keys, checkpoints, session/JWT/cookie data, and service-role paths.

### `public.get_admin_reconciliation_item_detail(uuid)`

- Type: `plpgsql`, `STABLE`, `SECURITY DEFINER`, `SET search_path = ''`
- Authorization: derives actor from `auth.uid()` and requires `public.is_current_user_admin_aal2()` internally.
- Grants: execute revoked from `public`, `anon`, and `authenticated`, then granted only to `authenticated`.
- Shape: single `payload jsonb` column; missing item returns zero rows; null item ID returns `INVALID_INPUT` / `22023`.
- Payload includes safe nested `run`, `item`, `provenance`, `reviewCase`, and `reviewEvents`.
- Provenance ordering: provider code asc, binding label asc, custody account binding id asc.
- Review event ordering: event version asc, created at asc, event id asc.
- Numeric serialization: exact Atomic Unit values are emitted as JSON strings; null observed/difference values remain JSON null.
- Exclusions: run and review idempotency keys, requested/opened/last actor profile IDs, event actor profile IDs, observation keys, checkpoints, raw provider payloads, session/JWT/cookie data, and service-role paths.

## Existing Inventory Updates

The existing stale public reconciliation RPC assertions were minimally updated to allow only:

- `public.list_admin_reconciliation_items`
- `public.get_admin_reconciliation_item_detail`

The new pgTAP inventory assertion also verifies the exact public reconciliation/review-case RPC set:

- `public.admin_open_review_case`
- `public.admin_transition_review_case`
- `public.get_admin_reconciliation_item_detail`
- `public.list_admin_reconciliation_items`

No public reconciliation views were added.

## Test Coverage Added

New pgTAP coverage verifies:

- Function existence and return contracts.
- `STABLE`, `SECURITY DEFINER`, and empty `search_path`.
- Governance comments.
- Execute grants only to `authenticated`; no execute for `public` or `anon`.
- No direct authenticated select on private reconciliation tables.
- No actor, profile, role, admin, or AAL caller arguments.
- Exact public reconciliation/review-case RPC inventory.
- ADMIN + AAL2 authorization for list and detail reads.
- Non-admin AAL2 rejection.
- ADMIN AAL1 rejection.
- Compound cursor pagination and stable ordering.
- Limit lookahead behavior.
- Asset, run status, classification, review state, observer kind, and cutoff filters.
- Provenance target/observed/missing/failed counts.
- Exact numeric string serialization, including a 38-digit value.
- Null observed/difference handling for `OBSERVATION_FAILED`.
- Detail safe nested run, item, asset, provenance, review case, and review event fields.
- Missing detail returns zero rows.
- Null detail ID validation.
- No side effects on reconciliation, observation, checkpoint, ledger, review case, or review event tables.

## Verification Results

- `npm run db:reset:local`
  - First attempt failed because local Supabase was not running.
  - After starting local Supabase for DB verification, reset passed and applied `20260730161000_p5_t02_admin_reconciliation_read_model.sql`.
- `npm run db:lint:local`: PASS, no schema errors.
- `npm run db:test:local`: PASS, 26 files, 1270 tests.
- `npm run db:types:local`: PASS, `src/types/database.types.ts` regenerated with both read RPCs.
- `npm ci`: PASS, 372 packages installed, 0 vulnerabilities reported by install audit.
- `npm audit --omit=dev --json`: PASS, 0 vulnerabilities.
- `npm audit --include=dev --json`: PASS, 0 vulnerabilities.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS; only line-ending warnings were reported.

## Cleanup Results

- `npm run supabase:stop`: PASS.
- Ports verified free after cleanup: `3000`, `3010`, `55721`, `55722`, `55723`, `55724`.
- Project containers matching `staking-wallet-web`: 0 running.
- Project processes matching `staking-wallet-web`: 0 found.
- `.env.local`: present as a local file; no tracked change.
- `.env.local.phase2-supervisor`: not present.

## Security Boundary

- No service-role production usage added.
- No private key, mnemonic, client signing, provider SDK/network call, raw provider payload, checkpoint cursor exposure, JWT/session exposure, or browser direct private table access added.
- Read RPCs are side-effect free: no insert, update, delete, merge, trigger creation, index creation, table creation, view creation, RLS change, lock path, sequence allocation, audit write, checkpoint write, observation write, or ledger write was added.

## Notes

- The read model intentionally remains DB-only. Application server commands, HTTP routes, runtime harnesses, and UI integration remain deferred to the next task.
- The list RPC exposes summary counts only; full provenance is reserved for the detail RPC.
- Detail uses a single `jsonb` payload to keep the DB read model compact and avoid exposing raw private rows through PostgREST.
