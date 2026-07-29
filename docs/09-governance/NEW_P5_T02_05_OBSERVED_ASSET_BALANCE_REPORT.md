# NEW-P5-T02-05 Observed Asset Balance Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Starting HEAD: `9925459c87c21136cc52d6ff1e0d40b720e3b527`
- Baseline marker: `PASS_LOCAL_BALANCE_OBSERVATION_BASELINE_COMMITTED`
- Product model: `ASSET_AGGREGATE_RECONCILIATION`

## Implemented Files

- `supabase/migrations/20260729104000_p5_t02_observed_asset_balance.sql`
- `supabase/tests/database/p5_t02_observed_asset_balance.test.sql`
- `docs/09-governance/NEW_P5_T02_05_OBSERVED_ASSET_BALANCE_REPORT.md`

## Boundary

This task implements the read-only observed balance calculation contract for
asset aggregate reconciliation. It does not create reconciliation runs, items,
differences, classifications, checkpoints, provider network calls, workers,
API routes, or UI.

## Target Binding Contract

A custody binding is included in the asset aggregate target set only when all
of the following are true at calculation time:

- `public.supported_assets.status = 'ACTIVE'`
- `private.custody_providers.status = 'APPROVED'`
- `private.custody_providers.supports_balance_observation = true`
- `private.custody_account_bindings.status = 'APPROVED'`
- `private.custody_account_bindings.asset_id = p_asset_id`
- `private.custody_account_bindings.account_role in ('COLLECTION', 'PAYOUT', 'TREASURY', 'FEE')`

The v1 contract is asset aggregate scoped. It intentionally does not allocate
expected ledger balance to individual custody bindings.

## Observer Kind Contract

`p_observer_kind` is required, trimmed, and validated by the existing database
observer-kind shape:

```text
^[A-Z0-9][A-Z0-9_]{1,63}$
```

Invalid input fails closed with:

```text
observer_kind_invalid
```

No default observer kind is introduced. Different valid observer kinds remain
independent streams.

## Cutoff Contract

The calculation uses an explicit cutoff:

```text
p_observed_at_or_before timestamptz
```

Observations with `observed_at > p_observed_at_or_before` are ignored. Null
cutoffs fail closed with:

```text
observation_cutoff_invalid
```

Late-arriving observation behavior:

```text
HISTORICAL_REPRODUCIBILITY=PROVENANCE_SNAPSHOT_REQUIRED
OBSERVATION_FRESHNESS_POLICY=DEFERRED
```

This task provides deterministic selection for a supplied cutoff but does not
yet persist reconciliation provenance snapshots.

## Latest Observation Selection

Function:

```text
private.select_latest_external_balance_observations(
  p_asset_id uuid,
  p_observer_kind text,
  p_observed_at_or_before timestamptz
)
```

Return:

```text
custody_account_binding_id uuid
external_balance_observation_id uuid nullable
observed_atomic_units numeric nullable
observed_at timestamptz nullable
membership_status text
```

Latest valid observation tie-break order:

```text
observed_at DESC
created_at DESC
id DESC
```

Every target binding returns one membership row. A binding without a matching
observation at or before the cutoff returns:

```text
membership_status = MISSING_OBSERVATION
external_balance_observation_id = NULL
observed_atomic_units = NULL
observed_at = NULL
```

Missing observations are never converted to zero.

## Aggregate Contract

Function:

```text
private.calculate_observed_external_balance_atomic_units(
  p_asset_id uuid,
  p_observer_kind text,
  p_observed_at_or_before timestamptz
)
```

Return:

```text
observed_atomic_units numeric nullable
target_binding_count bigint
observed_binding_count bigint
missing_binding_count bigint
is_complete boolean
```

Complete aggregate:

```text
missing_binding_count = 0
observed_atomic_units = sum(selected observed_atomic_units)
is_complete = true
```

Incomplete aggregate:

```text
missing_binding_count > 0
observed_atomic_units = NULL
is_complete = false
```

The aggregate uses PostgreSQL `numeric` throughout and validates the final
complete amount as a non-negative integer atomic-unit value below `10^38`.

## Safe Failures

- Missing asset: `asset_not_found`
- Invalid observer kind: `observer_kind_invalid`
- Null cutoff: `observation_cutoff_invalid`
- Existing asset with no observable target binding: `observable_binding_not_found`
- Invalid complete aggregate amount: `observed_balance_invalid`

## Security

- Both functions are in the `private` schema.
- Both functions are `SECURITY INVOKER`.
- Both functions are side-effect-free selectors.
- Execute privilege is revoked from `public`, `anon`, and `authenticated`.
- No public RPC wrapper was created.
- No service role, remote Supabase project, real custody provider, blockchain
  network, wallet adapter, mnemonic, private key, or production credential was
  introduced.

## Index

Added supporting index:

```text
private.external_balance_observations
  custody_account_binding_id
  observer_kind
  observed_at DESC
  created_at DESC
  id DESC
```

## pgTAP Coverage

The pgTAP contract covers:

- Function existence, signatures, result shapes, volatility, and security mode
- Browser-role execute revocation
- No public observed balance RPC
- Supporting index shape
- No write statements in function bodies
- Binding eligibility and exclusion of non-target bindings
- Observer-kind independence
- Cutoff handling
- `observed_at`, `created_at`, and `id` tie-break behavior
- Missing binding membership preservation
- Incomplete aggregate returning `NULL` instead of a partial sum or zero
- Complete zero observation handling
- Large atomic-unit precision beyond JavaScript safe integer range
- Safe failures for missing asset, invalid observer kind, and no target binding
- Zero persistence side effects across observation, reconciliation, and ledger tables

## Validation

- Local Supabase start: PASS
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, schema errors 0
- `npm run db:test:local`: PASS
- pgTAP: 21 files / 1088 tests PASS
- `npm run db:types:local`: PASS
- Generated type diff: 0
- `npm ci`: PASS, vulnerabilities 0
- `npm audit --omit=dev --json`: PASS, vulnerabilities 0
- `npm audit --include=dev --json`: PASS, vulnerabilities 0
- `npm run lint`: PASS
- `npm run build`: PASS, Next.js 16.2.11
- Local Supabase stop: PASS
- Residue checks: 3/3 PASS, listeners 0, project containers 0, `.env.local*` 0

## Generated Types

- Command: `npm run db:types:local`
- Result: PASS
- Diff in `src/types/database.types.ts`: 0

## Package And Security

- `package.json` changed: no
- `package-lock.json` changed: no
- Production audit vulnerabilities: 0
- Dev-included audit vulnerabilities: 0
- Secret scan: PASS, no actual secret values found
- Secret-like terms in this report are policy language only.

## Source Boundary

- Application source changed: no
- Package files changed: no
- Supabase migration changed: yes, new migration only
- Supabase tests changed: yes, new pgTAP file only
- Generated type file changed: no
- P5-T02 run/item implementation added: no

## Git

Staging, commit, push, and PR were not performed.

## Next Task Candidate

Existing roadmap candidate:

```text
P5-T02-06 Reconciliation run and item calculation
```

The next task should persist reconciliation run/item provenance using the
selector output from this task. It should not treat missing observations as
zero.

## Final Status

```text
PASS_OBSERVED_ASSET_BALANCE_READY
```
