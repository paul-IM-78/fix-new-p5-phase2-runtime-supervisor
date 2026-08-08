# NEW-P5-T02-03B Binding Ledger Mapping Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Starting HEAD: `8d57021971e77984794afc20cbe1192f2564bd6d`
- Previous contract: `docs/09-governance/NEW_P5_T02_03A_CUSTODY_LEDGER_ALLOCATION_CONTRACT.md`
- Previous status: `PASS_LEDGER_MODEL_READY`
- This task evaluated whether a binding-to-ledger mapping schema can be added
  safely without changing the existing ledger account model.

## Summary

The mapping table was not implemented.

Primary cause:

```text
PRIMARY_CAUSE=BINDING_SCOPED_LEDGER_ACCOUNT_MODEL_MISSING
P5_T02_BINDING_LEDGER_MAPPING_READY=false
FINAL_STATUS=BLOCKED_LEDGER_ACCOUNT_MODEL
```

Reason:

- P5-T02 requires binding-scoped external balance comparisons.
- Multiple active custody bindings per asset are allowed by the current custody
  schema.
- The current ledger schema has only one `SYSTEM_CUSTODY` direct external
  asset account per asset.
- No existing binding-scoped direct external asset ledger account contract
  exists.
- A mapping table alone would either force multiple active bindings to share
  one `SYSTEM_CUSTODY` account or arbitrarily assign the asset-level account to
  one binding.
- Both outcomes violate the 03A allocation contract.

## 03A Contract Preservation

The 03A governance document remains unchanged and untracked:

```text
docs/09-governance/NEW_P5_T02_03A_CUSTODY_LEDGER_ALLOCATION_CONTRACT.md
```

Important 03A markers preserved:

```text
SELECTED_MODEL=MODEL_B_EXPLICIT_BINDING_TO_LEDGER_MAPPING
EXPECTED_BALANCE_COMPARISON_UNIT=custody_account_binding_id + asset_id
EXPECTED_BALANCE_SOURCE=explicitly mapped DIRECT_EXTERNAL_ASSET ledger accounts
LIABILITY_INCLUDED=false
MAPPING_REQUIRED=true
MAPPING_CARDINALITY=binding 1:N ledger accounts; ledger account active mapping 1:1 binding
MAPPING_HISTORY_REQUIRED=true
CORE_SCHEMA_REVISION_REQUIRED=false
FORWARD_MAPPING_SCHEMA_REQUIRED=true
P5_T02_EXPECTED_BALANCE_CONTRACT_READY=true
```

## Ledger Account Feasibility Gate

Analyzed objects:

- `private.ledger_accounts`
- `private.ledger_account_balances`
- `private.wallet_asset_ledger_balances`
- `private.ensure_system_ledger_accounts(uuid)`
- `private.custody_account_bindings`
- `private.custody_providers`
- `private.external_balance_observations`
- `private.reconciliation_items`
- `private.observer_checkpoints`

Gate result:

```text
MULTIPLE_DIRECT_EXTERNAL_LEDGER_ACCOUNTS_PER_ASSET_SUPPORTED=false
BINDING_SCOPED_LEDGER_ACCOUNT_SUPPORTED=false
SYSTEM_CUSTODY_UNIQUE_PER_ASSET=true
DIRECT_EXTERNAL_ACCOUNT_PURPOSE_ALLOWLIST=SYSTEM_CUSTODY
P5_T02_BINDING_LEDGER_MAPPING_IMPLEMENTABLE=false
```

## Custody Binding Cardinality

Current custody binding table:

```text
private.custody_account_bindings
```

Relevant columns:

```text
id
custody_provider_id
asset_id
binding_key
display_label
account_role
status
approved_at
suspended_at
retired_at
version
created_at
updated_at
```

Relevant uniqueness:

```text
custody_account_bindings_provider_key_uidx:
  custody_provider_id + binding_key

custody_account_bindings_active_role_uidx:
  custody_provider_id + asset_id + account_role
  where status <> RETIRED
```

Observed contract:

```text
MULTIPLE_BINDINGS_PER_ASSET_ALLOWED=true
MULTIPLE_ACTIVE_BINDINGS_PER_ASSET_ALLOWED=true
MULTIPLE_BINDINGS_PER_PROVIDER_ASSET_ALLOWED=true
```

The schema can have more than one active binding for the same asset across
providers, and more than one active binding for the same provider plus asset
when the roles differ.

## Ledger Account Model

Current ledger account table:

```text
private.ledger_accounts
```

Relevant columns:

```text
id
asset_id
wallet_account_id
account_scope
account_class
account_purpose
normal_side
status
version
created_at
updated_at
```

Current system purposes:

| Purpose | Scope | Class | Normal side | Direct external asset |
| --- | --- | --- | --- | --- |
| `SYSTEM_CUSTODY` | `SYSTEM` | `ASSET` | `DEBIT` | Yes |
| `SYSTEM_DEPOSIT_CLEARING` | `SYSTEM` | `CLEARING` | `DEBIT` | No |
| `SYSTEM_WITHDRAWAL_CLEARING` | `SYSTEM` | `CLEARING` | `DEBIT` | No |
| `SYSTEM_REWARD_EXPENSE` | `SYSTEM` | `EXPENSE` | `DEBIT` | No |
| `SYSTEM_TOKEN_ISSUANCE` | `SYSTEM` | `EQUITY` | `CREDIT` | No |
| `SYSTEM_SUSPENSE` | `SYSTEM` | `CLEARING` | `DEBIT` | No |

Current user purposes:

| Purpose | Scope | Class | Direct external asset |
| --- | --- | --- | --- |
| `USER_AVAILABLE` | `USER` | `LIABILITY` | No |
| `USER_LOCKED` | `USER` | `LIABILITY` | No |
| `USER_PENDING_DEPOSIT` | `USER` | `LIABILITY` | No |
| `USER_PENDING_WITHDRAWAL` | `USER` | `LIABILITY` | No |

Relevant uniqueness:

```text
ledger_accounts_system_purpose_uidx:
  asset_id + account_purpose
  where account_scope = SYSTEM
```

Implication:

```text
SYSTEM_CUSTODY is unique per asset.
```

## Direct External Asset Purpose Contract

Allowed purpose confirmed from current schema and 03A:

```text
DIRECT_EXTERNAL_ACCOUNT_PURPOSE_ALLOWLIST=SYSTEM_CUSTODY
```

No other current ledger account purpose is safe as a direct external asset
source:

- `SYSTEM_DEPOSIT_CLEARING` is internal clearing.
- `SYSTEM_WITHDRAWAL_CLEARING` is internal clearing.
- `SYSTEM_REWARD_EXPENSE` is expense.
- `SYSTEM_TOKEN_ISSUANCE` is equity.
- `SYSTEM_SUSPENSE` is internal clearing.
- `USER_*` purposes are user liability accounts.

## Mapping Implementability Decision

The 03B implementation condition requires at least one of the following:

```text
same asset can have multiple DIRECT_EXTERNAL_ASSET ledger accounts
or
an existing binding-scoped ledger account contract exists
```

Neither condition is true.

The mandatory stop condition is true:

```text
same asset multiple active custody bindings allowed = true
SYSTEM_CUSTODY one per asset = true
other binding-scoped DIRECT_EXTERNAL_ASSET accounts available = false
ledger account active mapping must be one binding = true
```

Therefore adding only this table would not satisfy P5-T02. The database could
store rows, but it could not represent independent binding-level expected
balances without sharing or arbitrarily assigning the single asset-level
`SYSTEM_CUSTODY` account.

## Why No Migration Was Created

A migration that creates only `private.custody_binding_ledger_accounts` would
be misleading under the current ledger model.

Unsafe outcomes avoided:

- Assigning the asset-level `SYSTEM_CUSTODY` account to the first binding.
- Allowing several active bindings to share one `SYSTEM_CUSTODY` account.
- Using percentage, weight, or amount allocation to split one ledger account.
- Treating user liabilities as external custody assets.
- Treating clearing, expense, equity, or suspense accounts as external custody
  assets.
- Creating a table that looks ready while the binding-scoped ledger account
  model is still missing.

## Required Technical Decision

At least one forward-only technical decision is required before 03B can be
implemented.

Preferred option:

```text
Option 1:
Add a binding-scoped direct external asset ledger account model.
```

Candidate approaches:

```text
1. Extend ledger account cardinality with a safe scope key so more than one
   direct external asset account can exist per asset.

2. Introduce a new direct external asset account purpose or classification that
   can be created more than once per asset without weakening existing
   SYSTEM_CUSTODY aggregate invariants.

3. Add a dedicated ledger account attribution dimension for custody bindings,
   while preserving existing user liability and system clearing constraints.
```

Rejected without explicit product and accounting approval:

```text
Asset aggregate only reconciliation
Provider + asset reconciliation without binding detail
Percentage allocation
Weighted allocation
Ledger account sharing across active bindings
Automatic first-binding assignment
```

## Core Reconciliation Schema Impact

The existing P5-T02 core schema remains usable as the future binding-level
observation and item boundary.

Current impact:

| Object | Impact | Reason |
| --- | --- | --- |
| `private.external_balance_observations` | `NO_CHANGE` | Binding FK remains correct. |
| `private.external_transaction_observations` | `NO_CHANGE` | Transfer observation remains binding scoped. |
| `private.reconciliation_runs` | `NO_CHANGE` | Run state does not depend on mapping yet. |
| `private.reconciliation_items` | `NO_CHANGE_FOR_NOW` | Item stores expected units; mapping reference can be deferred until a mapping model exists. |
| `private.observer_checkpoints` | `NO_CHANGE` | Checkpoint is correctly binding scoped. |
| `private.ledger_accounts` | `FORWARD_EXTENSION_REQUIRED` | Binding-scoped direct external asset cardinality is missing. |

## Binding Lifecycle

Lifecycle mapping constraint:

```text
BINDING_LIFECYCLE_MAPPING_CONSTRAINT=DEFERRED
```

Reason:

- `custody_account_bindings` has lifecycle states.
- The repository does not yet define how mapping effective periods must relate
  to binding `DRAFT`, `APPROVED`, `SUSPENDED`, or `RETIRED` states.
- This should be decided in the same follow-up that introduces the
  binding-scoped ledger account model.

## Historical Mapping And Overlap

Historical mapping is still required by the 03A contract, but it was not
implemented here.

Required future behavior remains:

- Mapping rows should preserve history.
- Current active mapping should be distinguishable from closed historical
  mapping.
- One ledger account must not overlap across multiple active bindings.
- Same binding plus ledger pair overlap must be blocked.
- Mapping changes should close the old period and create a new row.

No exclusion constraint, overlap trigger, mapping table, or helper function was
created in this task.

## Security

No new database object was created, so there is no new privilege surface.

Confirmed policy for the future mapping table:

- Private schema only.
- No public table.
- No public view.
- No public RPC.
- No direct browser read or write.
- No service-role application runtime.
- No external provider access.

## Validation

Executed validation:

```text
Repository static schema review: PASS
03A contract read: PASS
Implementability gate: BLOCKED as designed
```

Not executed by design:

```text
DB reset
DB lint
pgTAP
db types
npm ci
npm audit
lint
build
runtime smoke
cleanup
```

Reason:

No migration, test, package, generated type, or source file was created. The
task stopped at the mandatory ledger-account-model gate.

## Actual Changed Files

Created:

```text
docs/09-governance/NEW_P5_T02_03B_BINDING_LEDGER_MAPPING_REPORT.md
```

Preserved:

```text
docs/09-governance/NEW_P5_T02_03A_CUSTODY_LEDGER_ALLOCATION_CONTRACT.md
```

Not created:

```text
supabase/migrations/<next_timestamp>_p5_t02_custody_binding_ledger_mapping.sql
supabase/tests/database/p5_t02_custody_binding_ledger_mapping.test.sql
```

Not changed:

```text
src/types/database.types.ts
package.json
package-lock.json
src/**
supabase/migrations/**
supabase/tests/**
```

## Expected Balance Function Readiness

```text
P5_T02_EXPECTED_BALANCE_FUNCTION_READY=false
```

The expected balance function must wait until a binding-scoped direct external
asset ledger account model exists and the mapping table can be safely created.

## Next Task

Recommended next task:

```text
P5-T02-03B-R1 binding-scoped direct external asset ledger account model
```

Goal:

- Decide and implement a forward-only ledger account cardinality extension that
  can represent one or more direct external asset ledger accounts per asset.
- Preserve existing `SYSTEM_CUSTODY` behavior or explicitly migrate it into a
  safe aggregate-plus-binding model.
- Keep user liabilities, clearing, reward expense, equity, and suspense
  accounts excluded from direct external asset mapping.

Only after that task passes should the original mapping table task be retried.

## Secret Review

- No wallet address was added.
- No custody account identifier was added.
- No email was added.
- No password was added.
- No cookie or token was added.
- No Supabase key was added.
- No service-role key was added.
- No database URL was added.
- No provider credential was added.
- No private key was added.
- No mnemonic was added.
- No npm token was added.

## Git

- Staging: not performed.
- Commit: not performed.
- Push: not performed.
- PR: not performed.

Final status:

```text
BLOCKED_LEDGER_ACCOUNT_MODEL
```
