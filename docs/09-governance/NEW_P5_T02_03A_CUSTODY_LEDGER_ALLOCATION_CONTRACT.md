# NEW-P5-T02-03A Custody Ledger Allocation Contract

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Starting HEAD: `8d57021971e77984794afc20cbe1192f2564bd6d`
- Previous status: `BLOCKED_LEDGER_CONTRACT`
- Previous primary cause: `CUSTODY_BINDING_LEDGER_MAPPING_MISSING`
- This task creates a governance contract only.
- Migration changes: none.
- Test changes: none.
- Production source changes: none.

## Official Sources

- `docs/09-governance/NEW_P5_T02_01_REQUIREMENTS_AND_IMPLEMENTATION_PLAN.md`
- `docs/09-governance/NEW_P5_T02_02_DB_TABLES_AND_CONSTRAINTS_REPORT.md`
- `docs/08-custody/CUSTODY_PROVIDER_AND_ACCOUNT_BOUNDARY.md`
- `docs/08-custody/CUSTODY_OBSERVATION_ADAPTER_CONTRACT.md`
- `docs/06-ledger/DOUBLE_ENTRY_LEDGER_CORE.md`
- `docs/06-ledger/OPENING_BALANCE_AND_CORRECTIONS.md`
- `docs/06-ledger/DEPOSIT_REQUEST_STATE_MACHINE.md`
- `docs/06-ledger/WITHDRAWAL_REQUEST_STATE_MACHINE.md`
- `docs/06-ledger/WITHDRAWAL_EXECUTION_AND_SETTLEMENT.md`
- `docs/07-staking/STAKING_POSITION_AND_PRINCIPAL_LOCK.md`
- `docs/07-staking/STAKING_POSITION_MATURITY_AND_UNLOCK.md`
- `docs/07-staking/STAKING_REWARD_CALCULATION_AND_SETTLEMENT.md`
- `docs/07-staking/STAKING_USER_AND_OPERATIONS_OVERVIEW.md`
- `supabase/migrations/20260719192022_init_project_asset_wallet_domain.sql`
- `supabase/migrations/20260720090000_init_double_entry_ledger_core.sql`
- `supabase/migrations/20260722000527_init_custody_boundary_domain.sql`
- `supabase/migrations/20260729090000_p5_t02_reconciliation_core.sql`
- `src/server/custody/provider-observation-contract.ts`

## Previous Blocked Cause

The previous expected-balance implementation stopped correctly because the
repository had no explicit attribution contract between
`private.custody_account_bindings` and internal ledger accounts.

Confirmed facts:

- `private.custody_account_bindings` has `custody_provider_id`, `asset_id`,
  `binding_key`, `display_label`, `account_role`, and lifecycle fields.
- `private.custody_account_bindings` has no `ledger_account_id`.
- `private.ledger_accounts` has `asset_id`, optional `wallet_account_id`,
  `account_scope`, `account_class`, `account_purpose`, and `normal_side`.
- `private.ledger_accounts` has no `custody_account_binding_id`.
- `SYSTEM_CUSTODY` is currently one system asset account per asset.
- `private.wallet_asset_ledger_balances` aggregates user liability buckets and
  has no custody binding attribution.

Result:

```text
P5_T02_EXPECTED_BALANCE_CONTRACT_READY=false
```

## Binding Cardinality

Schema source:

- `private.custody_account_bindings`
- Unique index `custody_account_bindings_provider_key_uidx`
- Unique partial index `custody_account_bindings_active_role_uidx`

Current contract:

```text
Provider 1 : N bindings
Asset 1 : N bindings
Provider + asset 1 : up to one non-retired binding per role
Provider + asset + role 1 : 1 non-retired binding
Binding 1 : 1 asset
Binding 1 : 1 provider
```

Safety markers:

```text
MULTIPLE_BINDINGS_PER_ASSET_ALLOWED=true
MULTIPLE_ACTIVE_BINDINGS_PER_ASSET_ALLOWED=true
MULTIPLE_BINDINGS_PER_PROVIDER_ASSET_ALLOWED=true
BINDING_ROLE_UNIQUENESS=provider+asset+account_role unique while status <> RETIRED
SYSTEM_CUSTODY_ACCOUNT_PER_ASSET_COUNT=one per asset and account_purpose while account_scope = SYSTEM
```

Notes:

- Multiple active bindings for the same asset are possible across providers.
- Multiple active bindings for the same provider and asset are possible across
  different roles.
- The existing schema does not allow binding role names to allocate ledger
  amounts automatically.

## Binding Role Semantics

Allowed roles:

```text
COLLECTION
PAYOUT
TREASURY
FEE
```

Repository-defined meaning:

- Roles are operational roles on an internal custody account binding.
- Binding keys are internal aliases only.
- Binding keys are not external custody account identifiers, wallet addresses,
  blockchain addresses, transaction identifiers, signatures, hashes, provider
  credentials, or secrets.
- At most one non-retired binding exists for a provider, asset, and role.

Role matrix:

| Role | Repository-defined business meaning | Deposit use | Withdrawal use | Operating use | Storage use | Ledger purpose mapping | External balance reconciliation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `COLLECTION` | Operational role name only. Detailed deposit semantics are not defined. | `NOT_DEFINED` | `NOT_DEFINED` | `NOT_DEFINED` | `NOT_DEFINED` | None today | Candidate only through explicit mapping |
| `PAYOUT` | Operational role name only. Detailed payout semantics are not implemented. | `NOT_DEFINED` | `NOT_DEFINED` | `NOT_DEFINED` | `NOT_DEFINED` | None today | Candidate only through explicit mapping |
| `TREASURY` | Role exists and treasury observation is in P5-T02 scope. Detailed treasury accounting is not mapped. | `NOT_DEFINED` | `NOT_DEFINED` | `DEFINED_LIMITED` | `NOT_DEFINED` | None today | Candidate only through explicit mapping |
| `FEE` | Operational role name only. Fee balance accounting is not defined. | `NOT_DEFINED` | `NOT_DEFINED` | `NOT_DEFINED` | `NOT_DEFINED` | None today | Candidate only through explicit mapping |

Marker:

```text
BINDING_ROLE_SEMANTICS_READY=PARTIAL
```

The role enum is defined, but role names do not carry enough accounting
meaning to allocate ledger balances without an explicit mapping contract.

## Ledger Account Purpose Classification

Current ledger account purposes:

| Purpose | Scope | Class | Normal side | Classification | External custody comparable |
| --- | --- | --- | --- | --- | --- |
| `SYSTEM_CUSTODY` | `SYSTEM` | `ASSET` | `DEBIT` | `DIRECT_EXTERNAL_ASSET` | Yes, as asset-side custody exposure |
| `SYSTEM_DEPOSIT_CLEARING` | `SYSTEM` | `CLEARING` | `DEBIT` | `INTERNAL_CLEARING` | No |
| `SYSTEM_WITHDRAWAL_CLEARING` | `SYSTEM` | `CLEARING` | `DEBIT` | `INTERNAL_CLEARING` | No |
| `SYSTEM_REWARD_EXPENSE` | `SYSTEM` | `EXPENSE` | `DEBIT` | `NOT_RECONCILABLE` | No |
| `SYSTEM_TOKEN_ISSUANCE` | `SYSTEM` | `EQUITY` | `CREDIT` | `NOT_RECONCILABLE` | No |
| `SYSTEM_SUSPENSE` | `SYSTEM` | `CLEARING` | `DEBIT` | `INTERNAL_CLEARING` | No |
| `USER_AVAILABLE` | `USER` | `LIABILITY` | `CREDIT` | `INTERNAL_LIABILITY` | No; solvency comparison only |
| `USER_LOCKED` | `USER` | `LIABILITY` | `CREDIT` | `INTERNAL_LIABILITY` | No; staking principal liability |
| `USER_PENDING_DEPOSIT` | `USER` | `LIABILITY` | `CREDIT` | `PENDING_LIABILITY` | No |
| `USER_PENDING_WITHDRAWAL` | `USER` | `LIABILITY` | `CREDIT` | `PENDING_LIABILITY` | No |

## SYSTEM_CUSTODY Meaning

`SYSTEM_CUSTODY` is the current internal asset-side custody account. Existing
posting documents use it as follows:

- Opening balance: debit `SYSTEM_CUSTODY`, credit `USER_AVAILABLE`.
- Deposit confirmation: debit `SYSTEM_CUSTODY`, credit
  `SYSTEM_DEPOSIT_CLEARING`, debit `USER_PENDING_DEPOSIT`, credit
  `USER_AVAILABLE`.
- Withdrawal internal settlement: debit `SYSTEM_WITHDRAWAL_CLEARING`, credit
  `SYSTEM_CUSTODY`.
- Opening reversal: debit `USER_AVAILABLE`, credit `SYSTEM_CUSTODY`.

Current meaning:

```text
SYSTEM_CUSTODY = aggregate internal asset-side custody exposure for one asset
```

It does not mean one custody binding, one external account, one hot wallet, one
cold wallet, one provider account, or one operational role.

## P5-T02 Reconciliation Class

P5-T02 should not merge custody asset reconciliation with solvency
reconciliation.

Selected class:

```text
P5_T02_RECONCILIATION_CLASS=CUSTODY_ASSET_RECONCILIATION
```

Definition:

- Compare external provider-reported balances to explicitly mapped internal
  asset-side ledger accounts.
- Do not compare external observations directly to aggregate user liabilities
  in the same calculation.

Deferred class:

```text
SOLVENCY_RECONCILIATION=DEFERRED_SEPARATE_TASK
```

Solvency reconciliation may later compare external asset totals to aggregate
user liabilities, but it must be a separate calculation and report.

## Model A - Asset Aggregate

Definition:

```text
expected external balance = asset-level SYSTEM_CUSTODY balance
comparison scope = asset or provider + asset
```

Assessment:

```text
MODEL_A_REQUIREMENTS_COMPATIBLE=PARTIALLY_SUPPORTED
MODEL_A_SCHEMA_COMPATIBLE=PARTIALLY_SUPPORTED
MODEL_A_DECISION=REJECTED_FOR_P5_T02_BINDING_SCOPE
```

Advantages:

- Directly matches the current `SYSTEM_CUSTODY` account cardinality.
- Requires no binding-to-ledger mapping.
- Provides a simple asset-level custody total.

Risks:

- Does not preserve the P5-T02 binding-centered observation and item boundary.
- Cannot detect shortage or surplus per custody binding.
- Cannot distinguish multiple active bindings for the same asset.
- Would require changing or bypassing non-null binding fields in the P5-T02
  core schema if used as the only comparison model.

Decision:

Model A is useful later as solvency or asset aggregate reconciliation, but it
is not the selected P5-T02 binding-level expected-balance model.

## Model B - Explicit Binding-To-Ledger Mapping

Definition:

```text
expected external balance =
sum of balances from DIRECT_EXTERNAL_ASSET ledger accounts explicitly mapped
to the custody binding
```

Candidate object:

```text
private.custody_binding_ledger_accounts
```

Required meaning:

- A custody binding owns one or more mapped internal asset-side ledger
  accounts.
- A ledger account has at most one active custody binding mapping at a time.
- Mapping rows must not allocate by percentage, fraction, or weight.
- Mapping rows must not share one ledger account across multiple active
  bindings.
- Mapping rows must preserve enough history to explain a past reconciliation
  run.

Assessment:

```text
MODEL_B_REQUIREMENTS_COMPATIBLE=SUPPORTED
MODEL_B_SCHEMA_COMPATIBLE=REQUIRES_FORWARD_SCHEMA_EXTENSION
MODEL_B_MAPPING_CARDINALITY=binding 1:N ledger accounts; ledger account active mapping 1:1 binding
MODEL_B_DECISION=SELECTED
```

Why this model is selected:

- P5-T02 observations are binding-centered.
- `private.external_balance_observations` requires a
  `custody_account_binding_id`.
- `private.reconciliation_items` requires a `custody_account_binding_id` and
  `asset_id`.
- The custody observation adapter contract reads balances by binding refs.
- Multiple active bindings per asset are allowed by schema.
- Current ledger accounts are asset aggregate and do not carry binding
  attribution.
- Binding role names alone are not reliable accounting allocation rules.

Implementation implication:

The next schema task must create an explicit mapping layer before an expected
balance calculation function can be implemented. The mapping layer must either
map existing direct external asset ledger accounts where safe, or introduce
the minimum ledger-account cardinality extension required to represent
binding-specific asset-side custody accounts.

## Model C - Observation Scope Change

Definition:

```text
comparison scope = provider + asset or asset
binding FK nullable, removed, or replaced by a scope key
```

Assessment:

```text
MODEL_C_REQUIREMENTS_COMPATIBLE=NOT_SUPPORTED
MODEL_C_SCHEMA_COMPATIBLE=REQUIRES_CORE_SCHEMA_REVISION
MODEL_C_REQUIRES_CORE_SCHEMA_REVISION=true
MODEL_C_DECISION=REJECTED
```

Advantages:

- Could align with the current aggregate `SYSTEM_CUSTODY` account.
- Avoids binding-to-ledger allocation.

Risks:

- Conflicts with the current binding-centered observation contract.
- Requires core schema changes to observations, items, and checkpoints.
- Loses the per-binding operational review boundary.
- Makes future provider adapter behavior less precise.

Decision:

Model C is rejected for P5-T02 unless a later product decision explicitly
replaces the binding-centered reconciliation requirement.

## Decision Matrix

| Criterion | Model A - Asset Aggregate | Model B - Explicit Mapping | Model C - Scope Change |
| --- | --- | --- | --- |
| P5-T02 binding observations | `PARTIALLY_SUPPORTED` | `SUPPORTED` | `NOT_SUPPORTED` |
| Current observation contract | `PARTIALLY_SUPPORTED` | `SUPPORTED` | `NOT_SUPPORTED` |
| Current core schema | `PARTIALLY_SUPPORTED` | `SUPPORTED_WITH_EXTENSION` | `NOT_SUPPORTED` |
| Multiple binding support | `NOT_SUPPORTED` | `SUPPORTED` | `PARTIALLY_SUPPORTED` |
| Binding shortage or surplus detection | `NOT_SUPPORTED` | `SUPPORTED` | `NOT_SUPPORTED` |
| Accounting source of truth | `SUPPORTED` | `SUPPORTED` | `SUPPORTED` |
| Idempotency | `SUPPORTED` | `SUPPORTED` | `REQUIRES_REVISION` |
| Historical reproducibility | `PARTIALLY_SUPPORTED` | `SUPPORTED_WITH_MAPPING_HISTORY` | `REQUIRES_REVISION` |
| Operational complexity | `LOW` | `MEDIUM` | `HIGH` |
| Migration risk | `LOW` | `MEDIUM` | `HIGH` |
| Future provider adapter compatibility | `PARTIALLY_SUPPORTED` | `SUPPORTED` | `PARTIALLY_SUPPORTED` |

Selected model:

```text
SELECTED_MODEL=MODEL_B_EXPLICIT_BINDING_TO_LEDGER_MAPPING
CUSTODY_LEDGER_MODEL_DECISION_READY=true
PRODUCT_DECISION_REQUIRED=false
```

Product decision note:

No product decision is required to choose the P5-T02 technical model. Future
production work may still need a product decision for provider-specific role
semantics, account naming, and operational custody procedures.

## Expected Balance Formula

Model B formula:

```text
expected_external_atomic_units(binding_id)
= sum(private.ledger_account_balances.balance_units)
  for active mapping rows where:
    mapping.custody_account_binding_id = binding_id
    ledger account asset_id = binding asset_id
    ledger account classification = DIRECT_EXTERNAL_ASSET
    ledger account is open
```

Current direct external asset purpose:

```text
SYSTEM_CUSTODY
```

Important restriction:

The existing asset-level `SYSTEM_CUSTODY` account must not be assigned to a
binding when multiple active bindings for the same asset require independent
expected balances. Binding-level expected balances require explicit
binding-level ledger attribution.

The formula must not include:

- Unmapped `SYSTEM_CUSTODY` accounts.
- Aggregate user liability totals.
- Other binding accounts.
- Other asset accounts.
- Internal clearing accounts.
- Expense or equity accounts.
- Percentage allocation.
- Fractional allocation.
- Automatic first-binding assignment.

## Liability Policy

External custody reconciliation:

```text
LIABILITY_INCLUDED=false
```

Reason:

User liabilities represent internal obligations to users. They are not
provider-reported external asset balances. They belong in a separate solvency
or internal reserve invariant.

## Bucket Policies

| Bucket or state | Policy | Rationale |
| --- | --- | --- |
| Available | `EXCLUDED_FROM_CUSTODY_ASSET_FORMULA` | User liability bucket; included only in solvency reconciliation. |
| Locked staking principal | `EXCLUDED_FROM_CUSTODY_ASSET_FORMULA` | User liability bucket; staking is internal and not on-chain in current scope. |
| Accrued reward | `NOT_DEFINED` | Accrued unpaid rewards are not modeled as external custody. |
| Paid reward | `EXCLUDED_FROM_CUSTODY_ASSET_FORMULA` | Reward settlement increases `USER_AVAILABLE` and `SYSTEM_REWARD_EXPENSE`; it does not change custody. |
| Pending deposit | `EXCLUDED_FROM_CUSTODY_ASSET_FORMULA` | Pending deposit is clearing/liability state until confirmation debits `SYSTEM_CUSTODY`. |
| Pending withdrawal | `EXCLUDED_FROM_CUSTODY_ASSET_FORMULA` | Pending withdrawal is liability/clearing state until internal settlement credits `SYSTEM_CUSTODY`. |
| Broadcast withdrawal | `SEPARATE_RECONCILIATION` | Execution evidence is represented separately and no chain/provider verification exists yet. |
| Fee reserve | `NOT_DEFINED` | No fee reserve ledger contract exists. |
| Treasury | `INCLUDED_BY_EXPLICIT_MAPPING` | Only when a treasury binding is mapped to direct external asset ledger account rows. |

## Mapping History Contract

Expected-balance calculations must be explainable after a reconciliation run.

Required mapping history properties:

- Mapping rows must be private.
- Mapping rows must not store external account identifiers, wallet addresses,
  provider account identifiers, credentials, URLs, raw payloads, signatures, or
  transaction hashes.
- Mapping rows must preserve effective history.
- Active mapping overlap must be blocked.
- A mapping change must not make a past reconciliation item impossible to
  explain.

Recommended forward schema properties:

```text
custody_account_binding_id
ledger_account_id
mapping_role or mapping_classification
effective_from
effective_to nullable
status or supersession marker
version
created_at
created_by_command_id or audit reference
```

Historical reproducibility decision:

```text
MAPPING_HISTORY_REQUIRED=true
RECONCILIATION_ITEM_MAPPING_SNAPSHOT_REQUIRED=NOT_REQUIRED_FOR_FIRST_IMPLEMENTATION
```

Rationale:

`private.reconciliation_items.expected_units` persists the calculated value for
the run. A forward-only mapping history can explain the calculation without
changing the existing item table in the first implementation. A later audit
enhancement may add a mapping snapshot reference if operations require
stronger forensic traceability.

## Mapping Invariants

Required invariants for the next schema task:

- Binding asset must equal ledger account asset.
- Only asset-side direct external ledger accounts may be mapped.
- User liability accounts must not be mapped.
- Internal clearing accounts must not be mapped.
- Expense and equity accounts must not be mapped.
- Closed ledger accounts must not be active expected-balance sources.
- A ledger account must not have more than one active custody binding mapping.
- The same binding and ledger account must not have duplicate active mappings.
- Mapping without a valid binding must fail.
- Mapping without a valid ledger account must fail.
- Ambiguous active mapping must make expected balance calculation fail.
- Missing mapping must make expected balance calculation fail, not return zero.
- Zero balance is valid only when mapping exists and mapped accounts sum to
  zero.
- Negative expected result must fail and must not be clamped.

DB enforcement candidates:

- Private mapping table constraints.
- Exclusion or partial unique indexes for overlap prevention.
- Trigger or RPC validation for ledger purpose and asset equality.
- pgTAP checks for privilege, cardinality, overlap, missing mapping, ambiguity,
  zero balance, and negative invariant behavior.

## Existing Core Schema Impact

| Object | Impact | Notes |
| --- | --- | --- |
| `private.external_balance_observations` | `NO_CHANGE` | Binding FK remains the correct observation scope. |
| `private.external_transaction_observations` | `NO_CHANGE` | Transfer observations remain binding scoped. |
| `private.reconciliation_runs` | `NO_CHANGE` | Run scope can remain independent from mapping details. |
| `private.reconciliation_items` | `NO_CHANGE_FOR_FIRST_IMPLEMENTATION` | Stores binding, asset, expected, observed, and difference units. Optional mapping snapshot can be deferred. |
| `private.observer_checkpoints` | `NO_CHANGE` | Binding and observer kind remain the correct checkpoint scope. |
| `private.ledger_accounts` | `FORWARD_EXTENSION_MAY_BE_REQUIRED` | Current system custody cardinality is asset aggregate only. Binding-specific external asset accounts may require ledger-account cardinality changes. |

Core schema revision decision:

```text
CORE_SCHEMA_REVISION_REQUIRED=false
FORWARD_MAPPING_SCHEMA_REQUIRED=true
LEDGER_ACCOUNT_CARDINALITY_EXTENSION_REQUIRED=CONDITIONAL
```

The P5-T02 core reconciliation tables can stay intact. The next schema task
must decide the minimum safe way to represent binding-specific asset-side
ledger accounts without mutating existing migrations.

## Implementation Task Breakdown

### P5-T02-03B custody binding-ledger mapping schema

Purpose:

- Add the private mapping contract between custody bindings and direct external
  asset ledger accounts.
- Preserve effective history and prevent ambiguous active mappings.

Expected files:

- New forward-only migration.
- New pgTAP file.
- Governance report.
- Generated database types only if the official generation changes them.

Completion gate:

- DB reset, DB lint, pgTAP, db types.
- No public RPC.
- No external network.
- No package changes.
- No production source changes unless the task explicitly permits a server-only
  read helper.

### P5-T02-03C expected external balance calculation

Purpose:

- Implement one canonical private read-only function that calculates
  binding-level expected external atomic units from explicit mappings.

Expected files:

- New forward-only migration.
- New pgTAP file.
- Governance report.
- Generated database types only if the official generation changes them.

Completion gate:

- Function is private, `STABLE`, `SECURITY INVOKER` unless a documented reason
  requires otherwise.
- Public, anon, and authenticated execute are revoked.
- Missing mapping fails.
- Ambiguous mapping fails.
- Zero mapped balance returns zero.
- Negative invariant fails.
- Side effects are zero.

### P5-T02-04 local mock balance observation

Purpose:

- Add deterministic local non-secret observation fixtures after the mapping and
  expected-balance function exist.

Expected files:

- Local test helper or script only.
- No real provider SDK.
- No network call.
- No raw external identifiers.

Completion gate:

- Mock observations use binding refs and atomic-unit strings.
- No provider, chain, mainnet, testnet, or remote Supabase call.

## Product Decision Status

Current decision:

```text
PRODUCT_DECISION_REQUIRED=false
```

Required product decision list:

```text
NONE_FOR_P5_T02_TECHNICAL_MODEL
```

Future decisions that remain outside this task:

- Provider-specific operational meaning for `COLLECTION`, `PAYOUT`,
  `TREASURY`, and `FEE`.
- Whether production will use one external account per binding or another
  provider-side arrangement.
- Whether a separate solvency report compares external assets to aggregate
  user liabilities.
- Whether mapping provenance must be embedded directly in reconciliation item
  rows for regulatory reporting.

## Final Contract

```text
P5_T02_RECONCILIATION_CLASS=CUSTODY_ASSET_RECONCILIATION
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

## Security And Secret Review

- This document contains no external account identifiers.
- This document contains no wallet addresses.
- This document contains no credentials.
- This document contains no tokens.
- This document contains no private keys.
- This document contains no mnemonics.
- This document contains no provider payloads.
- This document contains no production or remote Supabase values.

## Git

- Staging: not performed.
- Commit: not performed.
- Push: not performed.
- PR: not performed.

Final status:

```text
PASS_LEDGER_MODEL_READY
```
