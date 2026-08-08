# NEW-P5-T02-06 Asset Reconciliation Run Writer Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Start HEAD: `f17ed4ab213b9b814809c3812ad9d19f3e36eda9`
- Baseline marker: `PASS_OBSERVED_ASSET_BALANCE_BASELINE_COMMITTED`
- Product model: `ASSET_AGGREGATE_RECONCILIATION`
- Previous DB baseline: 21 files / 1088 pgTAP tests PASS

This task implements only the private single-asset reconciliation run writer. It does not add public RPC, API routes, workers, schedulers, UI, provider network adapters, checkpoint updates, resolution workflow, or audit event writers.

## Implemented Migration

- Migration: `supabase/migrations/20260729105000_p5_t02_create_asset_reconciliation_run.sql`
- Writer: `private.create_asset_reconciliation_run(text, uuid, text, timestamptz, numeric, text, uuid)`
- New run metadata:
  - `private.reconciliation_runs.observer_kind`
  - `private.reconciliation_runs.observation_cutoff_at`

The metadata columns are nullable at table level to preserve legacy and existing pgTAP direct-insert compatibility. The canonical writer validates and persists both values as non-null for every new writer-created row, and a pair constraint prevents only one metadata value being present.

## Writer Contract

The writer creates one reconciliation run and one `ASSET_AGGREGATE` reconciliation item for one asset. It returns:

- `reconciliation_run_id`
- `reconciliation_item_id`
- `created`
- `run_status`
- `item_classification`
- `expected_atomic_units`
- `observed_atomic_units`
- `difference_atomic_units`
- `target_binding_count`
- `observed_binding_count`
- `missing_binding_count`

Input validation rejects null, empty, whitespace, malformed, secret-like, or overly long idempotency keys. It also rejects missing assets, invalid observer kinds, null or infinite cutoffs, negative or fractional tolerance, invalid trigger sources, and missing requested actor profiles.

## Calculation Boundary

Expected balance uses the existing private function:

- `private.calculate_expected_external_balance_atomic_units(uuid)`

Observed membership and aggregate use the existing private functions:

- `private.select_latest_external_balance_observations(uuid, text, timestamptz)`
- `private.calculate_observed_external_balance_atomic_units(uuid, text, timestamptz)`

Creation uses one SQL statement with materialized CTEs for expected, selected observations, observed aggregate, calculation, run insert, item insert, and provenance insert. This keeps the initial writer result and binding provenance in a single statement snapshot. Exact idempotent replay reads persisted run, item, and provenance rows and does not recompute current observations.

## Classification

- Complete and `observed - expected = 0`: `MATCHED`
- Complete and nonzero difference within tolerance: `WITHIN_TOLERANCE`
- Complete and absolute difference greater than tolerance: `MISMATCH`
- Incomplete binding observation membership: `OBSERVATION_FAILED`

For complete rows, `difference_atomic_units = observed_atomic_units - expected_atomic_units`. For incomplete rows, observed and difference are stored as `NULL`; missing observations are not hidden as zero.

Run status:

- Complete membership: `COMPLETED`
- Incomplete membership: `PARTIAL`

`FAILED` run persistence remains out of scope for a later failure-recording contract.

## Provenance

The writer snapshots every selected custody binding into:

- `private.reconciliation_item_binding_observations`

Observed bindings store the selected observation id with `membership_status = OBSERVED`. Missing bindings store a null observation id with `membership_status = MISSING_OBSERVATION`.

The writer preserves:

- `target_binding_count = provenance row count`
- `observed_binding_count = OBSERVED row count`
- `missing_binding_count = MISSING_OBSERVATION row count`

## Idempotency And Integrity

The canonical idempotency key is `private.reconciliation_runs.idempotency_key`.

- First exact request creates run, item, and provenance with `created = true`.
- Exact replay returns the same run and item with `created = false`.
- Conflicting replay raises `reconciliation_idempotency_conflict`.
- Existing malformed replay state raises `reconciliation_existing_state_invalid`.
- Concurrency relies on the existing unique idempotency constraint with `ON CONFLICT (idempotency_key) DO NOTHING`.
- No advisory locks, `ON CONFLICT DO UPDATE`, retry loop, delete, or truncate path was added.

## Security

- Schema: `private`
- Volatility: `VOLATILE`
- Security mode: `SECURITY INVOKER`
- Public wrapper RPC: none
- Public view: none
- Execute privilege revoked from `public`, `anon`, and `authenticated`
- Service role runtime: not added
- External network access: not added
- Provider credentials: not stored

## Side Effects

Allowed writes:

- `private.reconciliation_runs`
- `private.reconciliation_items`
- `private.reconciliation_item_binding_observations`

Forbidden side effects were verified by pgTAP:

- `private.external_balance_observations`: unchanged
- `private.external_transaction_observations`: unchanged
- `private.observer_checkpoints`: unchanged
- `private.ledger_accounts`: unchanged
- `private.ledger_journals`: unchanged
- `private.ledger_entries`: unchanged

Audit events and resolution workflow are deferred:

- `RECONCILIATION_AUDIT_EVENT=DEFERRED`
- `RECONCILIATION_RESOLUTION=DEFERRED`

## pgTAP Coverage

New test file:

- `supabase/tests/database/p5_t02_create_asset_reconciliation_run.test.sql`

Coverage includes:

- Function existence, arguments, return contract, volatility, security mode, and comment
- Run metadata columns, constraints, and index
- Execute privilege revocation
- Public RPC and public view absence
- MATCHED, WITHIN_TOLERANCE, MISMATCH, OBSERVATION_FAILED, zero balance, large numeric precision
- Binding provenance membership and cutoff/observer isolation
- Exact idempotent replay
- Conflicting replay
- Input validation and rollback atomicity
- Existing state integrity guard
- Observation, checkpoint, and ledger side-effect absence

An initial pgTAP run failed one static assertion because the `ON CONFLICT` regex was over-escaped. The implementation already used the required `ON CONFLICT (idempotency_key) DO NOTHING` path; the assertion was corrected to a direct lowercase `LIKE` check.

## Validation

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0 / warning 0
- `npm run db:test:local`: PASS
- pgTAP total: 22 files / 1131 tests PASS
- Failures: 0
- Skip: 0
- `npm run db:types:local`: PASS
- Generated type diff: 0
- `npm ci`: PASS
- `npm audit --omit=dev --json`: vulnerabilities 0
- `npm audit --include=dev --json`: vulnerabilities 0
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS

## Runtime And Cleanup

Local Supabase was started only for local DB validation. The CLI printed local development credentials during startup; these values were not copied into repository files and must be treated as `[REDACTED]` in reports and chat.

`the-lost-heir-api` remained stopped and was not restarted.

Cleanup is performed after validation with `npm run supabase:stop`, followed by runtime residue checks.

## Changed Files

- `supabase/migrations/20260729105000_p5_t02_create_asset_reconciliation_run.sql`
- `supabase/tests/database/p5_t02_create_asset_reconciliation_run.test.sql`
- `docs/09-governance/NEW_P5_T02_06_ASSET_RECONCILIATION_RUN_REPORT.md`

No package, lockfile, production source, existing migration, existing pgTAP, generated type, API, worker, scheduler, UI, or legacy repository files were changed.

## Secret Scan

No real wallet address, custody account identifier, email, password, cookie, token, JWT, Supabase key, service-role key, DB URL, provider credential, private key, mnemonic, or npm token was added to the changed repository files.

Test UUIDs and fixed fixture labels are deterministic pgTAP sentinels and are not production identifiers.

## Next Task

Recommended next task:

- `P5-T02-07 Reconciliation discrepancy and review lifecycle`

## Final Status

`PASS_ASSET_RECONCILIATION_RUN_READY`
