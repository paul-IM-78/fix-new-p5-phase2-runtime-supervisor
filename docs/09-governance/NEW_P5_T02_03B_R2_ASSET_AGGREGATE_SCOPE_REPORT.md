# NEW-P5-T02-03B-R2 Asset Aggregate Scope Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Starting HEAD: `8d57021971e77984794afc20cbe1192f2564bd6d`
- Product decision: `ASSET_AGGREGATE_RECONCILIATION`

## Preserved Documents

The following existing untracked governance documents were preserved:

- `docs/09-governance/NEW_P5_T02_03A_CUSTODY_LEDGER_ALLOCATION_CONTRACT.md`
- `docs/09-governance/NEW_P5_T02_03B_BINDING_LEDGER_MAPPING_REPORT.md`
- `docs/09-governance/NEW_P5_T02_03B_R1_LEDGER_SCOPE_ARCHITECTURE_DECISION.md`

## Core Schema Analysis

Current reconciliation core before this forward migration:

```text
CURRENT_RECONCILIATION_ITEM_SCOPE=BINDING
CURRENT_SINGLE_OBSERVATION_REFERENCE=true
CORE_FORWARD_MIGRATION_REQUIRED=true
```

The original `private.reconciliation_items` table required
`custody_account_binding_id` and could point to one
`external_balance_observation_id`. That shape works for binding-level items,
but not for asset aggregate items composed from multiple binding observations.

## New Migration

Created migration:

```text
supabase/migrations/20260729101000_p5_t02_asset_aggregate_scope.sql
```

Migration contents:

- Adds `scope_kind` to `private.reconciliation_items`.
- Preserves original binding rows with default `scope_kind = BINDING`.
- Allows asset aggregate rows with `custody_account_binding_id IS NULL`.
- Requires asset aggregate rows to leave `external_balance_observation_id`
  null.
- Adds an asset aggregate unique index per run and asset.
- Adds `private.reconciliation_item_binding_observations`.
- Adds membership status constraints.
- Adds provenance validation for observation binding and asset consistency.
- Adds deferred completeness validation.
- Revokes direct browser privileges.

No expected-balance function, reconciliation calculator, public RPC, API,
worker, scheduler, or UI was added.

## Reconciliation Item Scope Contract

Binding-compatible row:

```text
scope_kind = BINDING
custody_account_binding_id IS NOT NULL
```

Asset aggregate row:

```text
scope_kind = ASSET_AGGREGATE
custody_account_binding_id IS NULL
external_balance_observation_id IS NULL
```

Unique rule:

```text
one reconciliation_run_id + asset_id + ASSET_AGGREGATE item
```

## Provenance Table

Created table:

```text
private.reconciliation_item_binding_observations
```

Columns:

```text
reconciliation_item_id
custody_account_binding_id
external_balance_observation_id nullable
membership_status
created_at
```

Membership statuses:

```text
OBSERVED
MISSING_OBSERVATION
OBSERVATION_FAILED
```

Rules:

- `OBSERVED` requires `external_balance_observation_id`.
- Missing or failed statuses require a null observation reference.
- Observation binding must equal membership binding.
- Observation asset must equal aggregate item asset.
- Duplicate item and binding membership is blocked.

## Completeness Contract

Normal aggregate classifications require every recorded member to be
`OBSERVED`.

Blocked when incomplete:

```text
MATCHED
WITHIN_TOLERANCE
MISMATCH
```

Allowed failure classification for incomplete sets:

```text
OBSERVATION_FAILED
```

No missing or failed observation is treated as zero.

## Security

All new objects are in the `private` schema.

Security boundaries:

```text
PUBLIC table privileges = 0
anon table privileges = 0
authenticated table privileges = 0
Public reconciliation RPCs added = 0
Service-role runtime path added = 0
```

## New pgTAP

Created test:

```text
supabase/tests/database/p5_t02_asset_aggregate_scope.test.sql
```

Test coverage:

- `scope_kind` column.
- Binding nullable contract.
- Scope consistency constraint.
- Asset aggregate unique index.
- Provenance table columns.
- Membership status constraint.
- PK, FK, delete policy, indexes, comments.
- Private table and function security.
- Asset aggregate item with null binding.
- Duplicate aggregate item rejection.
- Duplicate membership rejection.
- OBSERVED and missing member shape rules.
- Observation binding mismatch rejection.
- Observation asset mismatch rejection.
- Single observation FK rejection on asset aggregate items.
- Incomplete member set rejection for normal classifications.
- Existing binding-scoped item compatibility.

## Validation Results

```text
DB_RESET=PASS
DB_LINT=PASS_ERROR_0_WARNING_0
DB_TEST=PASS
GENERATED_TYPE=PASS_DIFF_0
NPM_CI=PASS
NPM_AUDIT_PRODUCTION=PASS_VULNERABILITIES_0
NPM_AUDIT_FULL=PASS_VULNERABILITIES_0
LINT=PASS_WARNING_0
BUILD=PASS
CLEANUP=PASS
SECRET_SCAN=PASS
```

DB reset applied all migrations including:

```text
supabase/migrations/20260729101000_p5_t02_asset_aggregate_scope.sql
```

Serial DB lint result:

```text
results=[]
No schema errors found
```

Full pgTAP result:

```text
Files=18
Tests=987
Failures=1
Skip=0
```

New pgTAP file result:

```text
supabase/tests/database/p5_t02_asset_aggregate_scope.test.sql=PASS
```

Initial pgTAP failure:

```text
supabase/tests/database/p5_t02_reconciliation_core.test.sql
Failed test 12:
observer checkpoint safe columns plus PK, nullability, defaults, and amount types exist
```

Cause:

```text
EXISTING_TEST_STALE_ASSERTION=true
```

The forward migration intentionally changes
`private.reconciliation_items.custody_account_binding_id` from `NOT NULL` to
nullable so an `ASSET_AGGREGATE` item can have no single custody binding. The
existing core pgTAP file has a fixed nullability count that still expects the
old binding-required contract.

Resume remediation:

```text
supabase/tests/database/p5_t02_reconciliation_core.test.sql
```

The stale physical `NOT NULL` expectation was replaced with the forward scope
contract:

- `scope_kind` is now part of the reconciliation item safe column set.
- `scope_kind` is the required physical discriminator.
- `custody_account_binding_id` is nullable at the column level.
- `scope_kind` defaults to `BINDING`.
- `reconciliation_items_scope_kind_check` is required.
- `reconciliation_items_scope_consistency_check` is required.
- Asset aggregate indexes are included in the core lookup index assertion.

This preserves the binding-scoped contract through scope consistency instead of
requiring a single binding on every reconciliation item.

Core test contract status:

```text
CORE_TEST_CONTRACT_WEAKENED=false
STALE_ASSERTION_REPLACED_WITH_SCOPE_CONSTRAINT_TEST=true
MIGRATION_CHANGED_DURING_RESUME=false
NEW_R2_TEST_CHANGED_DURING_RESUME=false
```

Final pgTAP result:

```text
Files=18
Tests=987
Failures=0
Skip=0
Result=PASS
```

Generated type result:

```text
src/types/database.types.ts diff=0
```

Static and security gate:

```text
npm_ci=PASS
npm_audit_omit_dev_total=0
npm_audit_include_dev_total=0
lint=PASS_WARNING_0
build=PASS
next=16.2.11
```

Cleanup result:

```text
supabase_stop=PASS
target_ports_3000_3010_55721_55722_55723_55724_listeners=0
current_project_supabase_containers=0
env_local_files=0
runtime_residue=0
```

Secret scan result:

```text
secret_like_values=0
```

## Actual Changed Files

Created:

```text
docs/09-governance/NEW_P5_T02_03B_R2_ASSET_AGGREGATE_PRODUCT_DECISION.md
docs/09-governance/NEW_P5_T02_03B_R2_ASSET_AGGREGATE_SCOPE_REPORT.md
supabase/migrations/20260729101000_p5_t02_asset_aggregate_scope.sql
supabase/tests/database/p5_t02_asset_aggregate_scope.test.sql
```

Conditional:

```text
src/types/database.types.ts
```

Only if official local type generation changes it.

## Git

- Staging: not performed.
- Commit: not performed.
- Push: not performed.
- PR: not performed.

## Stop Condition

```text
STOP_CONDITION=NONE
P5_T02_03C_READY=true
```

Final status:

```text
PASS_ASSET_AGGREGATE_SCOPE_READY
```
