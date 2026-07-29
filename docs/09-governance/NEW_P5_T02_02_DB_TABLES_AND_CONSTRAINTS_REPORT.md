# NEW-P5-T02-02 DB Tables And Constraints Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Starting HEAD: `4ce94c79726f67b2042dfba2530a22d0a90c8025`
- Requirements document preserved: `docs/09-governance/NEW_P5_T02_01_REQUIREMENTS_AND_IMPLEMENTATION_PLAN.md`
- Task scope: reconciliation core database schema, indexes, private access boundary, and pgTAP contract tests only.

## Existing Schema Contracts

- Primary key convention: `uuid primary key default gen_random_uuid()`.
- Timestamp convention: `timestamptz not null default clock_timestamp()`.
- Existing positive atomic unit type: `private.positive_atomic_units`.
- Private security convention: private schema objects revoke direct `public`, `anon`, and `authenticated` access; browser access is opened only through explicit public RPCs in later tasks.
- Idempotency convention: unique command or request keys are enforced in database constraints.
- Custody binding FK: `private.custody_account_bindings(id) on delete restrict`.
- Asset FK: `public.supported_assets(id) on delete restrict`.
- Provider observation contract: direction `INBOUND | OUTBOUND`, status `PENDING_FINALITY | FINALIZED | FAILED`.

## Created Migration

- `supabase/migrations/20260729090000_p5_t02_reconciliation_core.sql`

## Created Tables

1. `private.external_balance_observations`
   - Stores append-only non-secret external balance observations.
   - Uses non-negative integer `numeric` units to allow zero.
   - Blocks negative, fractional, scientific, oversized, and duplicate observation keys.
   - Stores custody binding, asset, observer kind, observation key, observed units, observed timestamp, and optional safe checkpoint reference.

2. `private.external_transaction_observations`
   - Stores append-only provider-neutral transfer observations.
   - Reuses `private.positive_atomic_units` for positive transfer amounts.
   - Enforces provider contract direction and status values.
   - Blocks duplicate external event keys per binding and observer kind.
   - Stores no raw transaction payload, signature, provider credential, or wallet address.

3. `private.reconciliation_runs`
   - Stores reconciliation run metadata and idempotency.
   - Status values: `PENDING`, `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED`.
   - Enforces timestamp shape, terminal state shape, and failure classification for failed runs.
   - Does not create run state transition RPCs.

4. `private.reconciliation_items`
   - Stores expected versus observed comparison rows for a run.
   - Expected, observed, and tolerance units are non-negative integer Atomic Units.
   - Difference units are signed integer Atomic Units and must equal `observed_units - expected_units`.
   - Classification values: `MATCHED`, `WITHIN_TOLERANCE`, `MISMATCH`, `OBSERVATION_FAILED`, `REVIEW_REQUIRED`.
   - Enforces one item per run, custody binding, and asset.

5. `private.observer_checkpoints`
   - Stores safe opaque observer cursors per custody binding and observer kind.
   - Enforces non-empty checkpoint values and positive version values.
   - Does not create checkpoint update RPCs.

## Deferred Tables

- `private.reconciliation_resolutions`
- `private.reconciliation_discrepancies`

Resolution workflow is intentionally deferred to a later task. Initial discrepancy state is represented by `private.reconciliation_items.classification`.

## FK And Delete Policy

- All new foreign keys use `ON DELETE RESTRICT`.
- Custody binding and asset records are never deleted through reconciliation records.
- Reconciliation run deletion does not cascade to items.
- Balance observation deletion does not cascade to reconciliation items.

## Index And Idempotency Summary

- Balance observation idempotency: `(custody_account_binding_id, observer_kind, observation_key)`.
- Transaction observation idempotency: `(custody_account_binding_id, observer_kind, external_event_key)`.
- Run idempotency: `idempotency_key`.
- Item idempotency: `(reconciliation_run_id, custody_account_binding_id, asset_id)`.
- Checkpoint idempotency: `(custody_account_binding_id, observer_kind)`.
- Lookup indexes were added for observed timestamps, statuses, classifications, run membership, and binding plus asset lookup.

## RLS And Grants

- New tables are in `private`.
- Explicit direct table grants are revoked from `public`, `anon`, and `authenticated`.
- No public table, public view, public RPC, service-role client, or browser direct access path is created.
- Existing private table convention is grant blocking; no arbitrary browser RLS policy is added.

## pgTAP

- New test file: `supabase/tests/database/p5_t02_reconciliation_core.test.sql`
- Existing baseline before this task: 16 pgTAP files / 893 tests PASS.
- Added coverage:
  - 5 private tables exist.
  - Public schema table exposure is absent.
  - Deferred resolution/discrepancy tables are absent.
  - Required columns, SQL types, NOT NULL/nullability, defaults, primary keys, constraints, FKs, delete policy, indexes, and comments exist.
  - Balance zero is allowed.
  - Negative and fractional units are blocked.
  - Transaction direction and status match the custody observation contract.
  - Run status, timestamp shape, and whitespace-only idempotency key rejection are enforced.
  - Item difference and tolerance invariants are enforced.
  - Browser roles cannot directly read or write new private tables.
  - Public reconciliation RPC count remains zero.

## Validation Results

- `npm ci`: PASS, vulnerabilities 0.
- `npm audit --omit=dev --json`: PASS, production vulnerabilities 0.
- `npm audit --include=dev --json`: PASS, full vulnerabilities 0.
- `npm run lint`: PASS, warning 0.
- `npm run build`: PASS.
- `npm run supabase:start`: PASS; output values were not copied into this report.
- `npm run db:reset:local`: PASS; 18 migrations applied including `20260729090000_p5_t02_reconciliation_core.sql`.
- `npm run db:lint:local`: PASS; `results=[]`, error 0, warning 0.
- `npm run db:test:local`: PASS; 17 files / 957 tests / failures 0 / skip 0.
- `npm run db:types:local`: PASS.
- Generated type diff: 0 content changes; new private tables are outside the generated public schema range.
- Runtime and QA cleanup: PASS after local Supabase stop and listener checks.
- Secret scan: PASS; matched terms are deny-list regex/comment text only, not secret values.

Note: an initial concurrent lint/test invocation produced pgTAP extension-internal lint noise while tests were running. The final authoritative sequence was reset, lint, then pgTAP, and that sequence passed.

## Security Notes

- No external provider network calls were added.
- No Mainnet or Testnet connection was added.
- No service-role runtime was added.
- No private key, mnemonic, signing key, token, cookie, or credential value was added.
- Observer context fields are constrained to safe opaque values and do not store raw provider payloads.

## Git

- Staging: not performed.
- Commit: not performed.
- Push: not performed.
- PR: not performed.
- Expected final changed paths:
  - `docs/09-governance/NEW_P5_T02_01_REQUIREMENTS_AND_IMPLEMENTATION_PLAN.md` preserved from NEW-P5-T02-01.
  - `docs/09-governance/NEW_P5_T02_02_DB_TABLES_AND_CONSTRAINTS_REPORT.md`.
  - `supabase/migrations/20260729090000_p5_t02_reconciliation_core.sql`.
  - `supabase/tests/database/p5_t02_reconciliation_core.test.sql`.

## Next Task

P5-T02-03 can start after this task is committed and handed off.

Final status: `PASS_DB_SCHEMA_READY`.
