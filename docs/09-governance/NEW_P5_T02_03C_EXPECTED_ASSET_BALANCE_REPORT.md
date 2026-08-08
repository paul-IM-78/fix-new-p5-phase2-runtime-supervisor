# NEW-P5-T02-03C Expected Asset Balance Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Starting HEAD: `23339181397232d0b49492f15ed214062731e509`
- Baseline commit: `PASS_ASSET_AGGREGATE_BASELINE_COMMITTED`
- Product model: `ASSET_AGGREGATE_RECONCILIATION`

## Schema Findings

Asset key:

```text
public.supported_assets.id = uuid
```

Ledger account key:

```text
private.ledger_accounts.id = uuid
```

Atomic-unit type:

```text
private.ledger_entries.units = private.positive_atomic_units
private.ledger_account_balances.balance_units = numeric
```

Balance projection source:

```text
private.ledger_account_balances.balance_units
```

`private.wallet_asset_ledger_balances` was reviewed and rejected as the expected
custody source because it is a user liability projection. The expected external
balance source must be the system asset-side account balance.

## Source Of Truth

Current P5-T02 v1 expected balance formula:

```text
expected_external_atomic_units(asset_id)
= balance_units of the single OPEN SYSTEM_CUSTODY ledger account for asset_id
```

Included:

```text
account_scope = SYSTEM
account_class = ASSET
account_purpose = SYSTEM_CUSTODY
normal_side = DEBIT
wallet_account_id IS NULL
status = OPEN
```

Excluded:

```text
User liability balances
Internal clearing balances
System token issuance balances
System reward expense balances
External observations
Custody binding allocation
Provider-level allocation
Solvency reconciliation
```

Uniqueness:

```text
ledger_accounts_system_purpose_uidx
= asset_id + account_purpose where account_scope = SYSTEM
SYSTEM_CUSTODY_UNIQUE_PER_ASSET=true
```

Balance row absence:

```text
Account exists but has no ledger entries => ledger_account_balances returns 0
Account missing => safe exception, not 0
```

## Migration

Created:

```text
supabase/migrations/20260729102000_p5_t02_expected_asset_balance.sql
```

Added function:

```text
private.calculate_expected_external_balance_atomic_units(uuid)
```

Function contract:

```text
Argument: p_asset_id uuid
Return: numeric
Volatility: STABLE
Security: SECURITY INVOKER
Side effects: 0
Public execute: revoked
anon execute: revoked
authenticated execute: revoked
```

Safe failures:

```text
asset_not_found
system_custody_account_missing
system_custody_account_ambiguous
system_custody_balance_invalid
```

No public RPC, view, trigger, observation writer, reconciliation writer, worker,
scheduler, API route, package change, or external network path was added.

Supporting indexes:

```text
supporting_index_added=false
existing_index=ledger_accounts_system_purpose_uidx
```

## pgTAP

Created:

```text
supabase/tests/database/p5_t02_expected_asset_balance.test.sql
```

Coverage:

- Function existence, signature, return type, volatility, and security mode.
- Function comment.
- Execute privilege denial for `PUBLIC`, `anon`, and `authenticated`.
- No public expected-balance wrapper RPC.
- Existing system account uniqueness index.
- Atomic-unit source type and integer domain.
- Missing asset failure.
- Existing asset with missing `SYSTEM_CUSTODY` failure.
- Entryless `SYSTEM_CUSTODY` account returns zero.
- Positive custody balance returns exact atomic units.
- Other asset balances are excluded.
- Internal non-custody system balances are excluded.
- User liability balances are excluded.
- Repeated calls are deterministic.
- Negative custody balance raises an invariant failure and is not clamped.
- Fractional atomic units are rejected by the ledger domain.
- Reconciliation and ledger row counts are unchanged by the function call.

## Validation Results

```text
DB_RESET=PASS
DB_LINT=PASS_ERROR_0_WARNING_0
DB_TEST=PASS_FILES_19_TESTS_1009_FAILURES_0_SKIP_0
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
supabase/migrations/20260729102000_p5_t02_expected_asset_balance.sql
```

Full pgTAP result:

```text
Files=19
Tests=1009
Failures=0
Skip=0
Result=PASS
```

New pgTAP file result:

```text
supabase/tests/database/p5_t02_expected_asset_balance.test.sql=PASS
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
```

## Changed Files

```text
supabase/migrations/20260729102000_p5_t02_expected_asset_balance.sql
supabase/tests/database/p5_t02_expected_asset_balance.test.sql
docs/09-governance/NEW_P5_T02_03C_EXPECTED_ASSET_BALANCE_REPORT.md
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

Final status:

```text
PASS_EXPECTED_ASSET_BALANCE_READY
```
