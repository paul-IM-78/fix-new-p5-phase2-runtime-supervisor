# NEW-P5-T02-03B-R1 Ledger Scope Architecture Decision

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Starting HEAD: `8d57021971e77984794afc20cbe1192f2564bd6d`
- Preserved document: `docs/09-governance/NEW_P5_T02_03A_CUSTODY_LEDGER_ALLOCATION_CONTRACT.md`
- Preserved document: `docs/09-governance/NEW_P5_T02_03B_BINDING_LEDGER_MAPPING_REPORT.md`
- This task is analysis and governance only.
- Migration changes: none.
- Test changes: none.
- Production source changes: none.
- Generated type changes: none.

## Prior Decisions

The 03A document selected an explicit binding-to-ledger mapping direction:

```text
P5_T02_RECONCILIATION_CLASS=CUSTODY_ASSET_RECONCILIATION
SELECTED_MODEL=MODEL_B_EXPLICIT_BINDING_TO_LEDGER_MAPPING
EXPECTED_BALANCE_COMPARISON_UNIT=custody_account_binding_id + asset_id
EXPECTED_BALANCE_SOURCE=explicitly mapped DIRECT_EXTERNAL_ASSET ledger accounts
LIABILITY_INCLUDED=false
MAPPING_REQUIRED=true
MAPPING_HISTORY_REQUIRED=true
```

The 03B implementation attempt then stopped before migration creation:

```text
MULTIPLE_DIRECT_EXTERNAL_LEDGER_ACCOUNTS_PER_ASSET_SUPPORTED=false
BINDING_SCOPED_LEDGER_ACCOUNT_SUPPORTED=false
SYSTEM_CUSTODY_UNIQUE_PER_ASSET=true
DIRECT_EXTERNAL_ACCOUNT_PURPOSE_ALLOWLIST=SYSTEM_CUSTODY
P5_T02_BINDING_LEDGER_MAPPING_IMPLEMENTABLE=false
FINAL_STATUS=BLOCKED_LEDGER_ACCOUNT_MODEL
```

This R1 document does not modify either prior document. It reviews the full
ledger posting impact before any schema, RPC, or expected-balance function is
implemented.

## Primary Evidence

Reviewed repository evidence:

- `docs/05-operations/PHASE5_CUSTODY_GATE.md`
- `supabase/migrations/20260720090000_init_double_entry_ledger_core.sql`
- `supabase/migrations/20260720130743_init_opening_balance_corrections.sql`
- `supabase/migrations/20260720152145_init_deposit_state_machine.sql`
- `supabase/migrations/20260720174042_init_withdrawal_state_machine.sql`
- `supabase/migrations/20260720194355_init_withdrawal_execution_settlement.sql`
- `supabase/migrations/20260721023627_init_staking_position_lock.sql`
- `supabase/migrations/20260721042827_init_staking_position_unlock.sql`
- `supabase/migrations/20260721061825_init_staking_reward_settlement.sql`
- `supabase/migrations/20260722000527_init_custody_boundary_domain.sql`
- `supabase/migrations/20260729090000_p5_t02_reconciliation_core.sql`
- `src/server/admin/custody-config-commands.ts`
- `src/server/admin/custody-config-reads.ts`
- `src/server/custody/provider-observation-contract.ts`

The Phase 5 custody gate defines local provider configuration and read-only
observation scaffolding boundaries. It does not approve provider API calls,
blockchain RPC, production custody launch, ledger posting from custody
configuration commands, or automatic user balance mutation from custody
configuration commands.

## SYSTEM_CUSTODY Usage Classification

| Classification | Repository evidence | Binding input present | Selection behavior |
| --- | --- | --- | --- |
| `ACCOUNT_CREATION` | `private.ensure_system_ledger_accounts(uuid)` | No | Creates one `SYSTEM_CUSTODY` row per asset through system purpose provisioning. |
| `ACCOUNT_LOOKUP` | Opening, deposit, withdrawal settlement functions and test scripts | No | Looks up by `asset_id`, `account_scope = SYSTEM`, and `account_purpose = SYSTEM_CUSTODY`. |
| `DEPOSIT_POSTING` | `public.confirm_user_funding_request(...)` | No | Debits asset-level `SYSTEM_CUSTODY`. |
| `WITHDRAWAL_POSTING` | `public.settle_user_payout_execution(...)` and custody availability checks | No | Credits asset-level `SYSTEM_CUSTODY`; approval does not touch custody. |
| `STAKING_POSTING` | Staking lock and unlock migrations | Not applicable | Uses user liability accounts only. |
| `REWARD_POSTING` | Reward settlement migration | Not applicable | Debits `SYSTEM_REWARD_EXPENSE` and credits `USER_AVAILABLE`. |
| `TREASURY_POSTING` | No implemented treasury posting flow found | Not implemented | Custody role exists, but no ledger posting contract exists. |
| `AUDIT_OR_INVARIANT` | Ledger, deposit, withdrawal, and phase reports | No | Documents and verifies aggregate asset-side custody behavior. |
| `TEST_FIXTURE` | Local ledger scripts | No | Uses the same asset-level `SYSTEM_CUSTODY` lookup. |
| `REPORTING` | Phase and ledger governance docs | No | Describes `SYSTEM_CUSTODY` as current direct external asset account. |

Current meaning:

```text
SYSTEM_CUSTODY = aggregate internal asset-side custody exposure for one asset
```

It is not currently one custody binding, one provider account, one operational
role, or one external account.

## Existing Ledger Account Model

`private.ledger_accounts` currently has:

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

It does not have:

```text
custody_account_binding_id
custody_provider_id
binding_role
external_account_scope
```

Current constraints enforce:

```text
account_scope in USER, SYSTEM
SYSTEM_CUSTODY is SYSTEM + ASSET + DEBIT
ledger_accounts_system_purpose_uidx = asset_id + account_purpose
  where account_scope = SYSTEM
```

Impact:

- More than one `SYSTEM_CUSTODY` account for the same asset is not currently
  representable.
- Existing account lookup helpers assume purpose-based singleton system
  accounts per asset.
- A binding-scoped direct external account requires a forward ledger account
  model extension, not only a mapping table.
- Changing `ledger_accounts` cardinality would affect provisioning, posting
  lookup, balance reads, invariant tests, and financial command RPCs.

## Ledger Posting Flow Matrix

| Flow | Current journal behavior | Binding availability | Binding decision |
| --- | --- | --- | --- |
| Opening balance | Debit `SYSTEM_CUSTODY`, credit `USER_AVAILABLE` | `BINDING_NOT_AVAILABLE` | Asset and wallet inputs only. |
| Opening correction reversal | Debit `USER_AVAILABLE`, credit `SYSTEM_CUSTODY` | `BINDING_NOT_AVAILABLE` | Reverses the same aggregate account. |
| Deposit request | User pending deposit and deposit clearing flow | `BINDING_NOT_AVAILABLE` | Request stores wallet and asset only. |
| Deposit confirmation | Debits `SYSTEM_CUSTODY` and completes user liability movement | `BINDING_NOT_AVAILABLE` | No provider or binding source is stored. |
| Withdrawal request | No journal at request creation | `BINDING_NOT_AVAILABLE` | Request stores wallet and asset only. |
| Withdrawal reserve | Debits `USER_AVAILABLE`, credits `USER_PENDING_WITHDRAWAL` | `NOT_APPLICABLE` | User liability movement only. |
| Withdrawal approval | Debits `USER_PENDING_WITHDRAWAL`, credits `SYSTEM_WITHDRAWAL_CLEARING` | `BINDING_NOT_AVAILABLE` | Approval is not external settlement. |
| Withdrawal execution start | Validates asset-level custody availability | `BINDING_NOT_AVAILABLE` | Uses asset-level `SYSTEM_CUSTODY` balance. |
| Withdrawal failed | No custody journal | `NOT_APPLICABLE` | Records safe execution state only. |
| Withdrawal settlement | Debits `SYSTEM_WITHDRAWAL_CLEARING`, credits `SYSTEM_CUSTODY` | `BINDING_NOT_AVAILABLE` | Internal settlement uses aggregate custody account. |
| Admin withdrawal cancel | Restores liability or clearing state | `BINDING_NOT_AVAILABLE` | No binding-specific custody effect. |
| Staking principal lock | Debits `USER_AVAILABLE`, credits `USER_LOCKED` | `NOT_APPLICABLE` | Internal liability state only. |
| Staking principal unlock | Debits `USER_LOCKED`, credits `USER_AVAILABLE` | `NOT_APPLICABLE` | Internal liability state only. |
| Reward payment | Debits `SYSTEM_REWARD_EXPENSE`, credits `USER_AVAILABLE` | `NOT_APPLICABLE` | Reward funding source is not external custody. |
| Treasury movement | Not implemented | `NOT_IMPLEMENTED` | Binding role exists without accounting contract. |
| Fee movement | Not implemented | `NOT_IMPLEMENTED` | Binding role exists without accounting contract. |

Posting flow conclusion:

```text
POSTING_FLOWS_CARRY_BINDING=false
BINDING_DERIVABLE_DETERMINISTICALLY=false
MULTIPLE_BINDINGS_POSSIBLE=true
AUTOMATIC_BINDING_SELECTION_ALLOWED=false
```

Binding cannot be guessed from active binding count, first binding, equal
allocation, role name, provider, or percentage. Any such rule would create
unverifiable accounting attribution.

## Binding Information Availability

| Flow | Classification | Reason |
| --- | --- | --- |
| Deposit | `BINDING_NOT_AVAILABLE` | Deposit request and confirmation are wallet and asset scoped. |
| Withdrawal reserve | `NOT_APPLICABLE` | Liability reserve does not touch external custody. |
| Withdrawal approval | `BINDING_NOT_AVAILABLE` | Approval moves pending withdrawal to clearing, not custody. |
| Withdrawal broadcast or start | `BINDING_NOT_AVAILABLE` | Execution evidence is safe local state without provider account binding. |
| Withdrawal settlement | `BINDING_NOT_AVAILABLE` | Settlement uses asset-level custody account. |
| Staking lock | `NOT_APPLICABLE` | No external custody movement. |
| Staking settlement or unlock | `NOT_APPLICABLE` | No external custody movement. |
| Reward accrual | `NOT_IMPLEMENTED` | Accrual table is not a custody balance source. |
| Reward payment | `NOT_APPLICABLE` | Expense to user liability only. |
| Treasury | `NOT_IMPLEMENTED` | Role exists but no posting function exists. |
| Fee | `NOT_IMPLEMENTED` | Role exists but no posting function exists. |
| Admin adjustment | `BINDING_NOT_AVAILABLE` | Opening balance RPC is asset and wallet scoped. |

## Candidate A - Immutable Binding-Scoped Ledger Account

Definition:

```text
Each direct external asset ledger account is permanently tied to one custody
binding.
```

Required changes:

- Add a binding dimension or equivalent scope to `private.ledger_accounts`.
- Allow more than one direct external asset account per asset.
- Preserve binding immutability or historical attribution once entries exist.
- Change system account provisioning so aggregate singleton assumptions do not
  accidentally select a binding-specific account.
- Propagate binding into every posting flow that changes external custody.
- Define cutover handling for existing aggregate `SYSTEM_CUSTODY` balances.

Assessment:

```text
MODEL_A_IMMUTABLE_BINDING_ACCOUNT=REQUIRES_PRODUCT_DECISION
```

Reason:

- Current posting flows do not carry binding.
- Current schema does not allow more than one `SYSTEM_CUSTODY` per asset.
- The approach is accounting-correct only if product accepts binding-level
  custody as the future source of truth and approves the cutover contract.

## Candidate B - Separate Historical Mapping

Definition:

```text
Generic direct external asset ledger accounts are mapped to custody bindings
through an effective-dated private mapping table.
```

Assessment:

```text
MODEL_B_HISTORICAL_MAPPING=NOT_SUPPORTED_UNDER_CURRENT_LEDGER_MODEL
```

Reason:

- Mapping history remains useful, but it cannot create independent expected
  balances while there is only one direct external asset account per asset.
- Sharing one aggregate `SYSTEM_CUSTODY` row across active bindings would make
  binding-level reconciliation double count or arbitrarily attribute balances.
- This model becomes viable only after a direct external account cardinality
  extension exists.

## Candidate C - Asset Aggregate Reconciliation

Definition:

```text
expected_units = asset-level SYSTEM_CUSTODY balance
observed_units = sum of safe observations for the asset across approved bindings
comparison_scope = asset
```

Assessment:

```text
MODEL_C_ASSET_AGGREGATE=PARTIALLY_SUPPORTED
```

Strengths:

- Fits the current ledger account model.
- Does not require binding propagation through legacy financial posting flows.
- Avoids arbitrary allocation of aggregate custody balance.
- Keeps `SYSTEM_CUSTODY` as the authoritative internal asset-side balance.

Risks:

- Current P5-T02 reconciliation core tables require
  `custody_account_binding_id` on observations, items, and checkpoints.
- It cannot detect binding-level shortage or surplus.
- It requires a forward core schema revision or an additional aggregate result
  table before implementation.
- It needs explicit product approval that asset-level comparison satisfies the
  Phase 5 reconciliation requirement.

## Candidate D - Aggregate Plus Binding Subledger

Definition:

```text
Keep asset-level SYSTEM_CUSTODY and also record binding-level subledger amounts.
```

Assessment:

```text
MODEL_D_DUAL_LEDGER=NOT_RECOMMENDED
```

Reason:

- The same economic event would be represented in both aggregate and binding
  ledgers unless a formal control-account architecture is introduced.
- No existing repository evidence defines control accounts, subledger
  balancing, or drift correction between aggregate and binding scopes.
- It adds accounting complexity without solving the missing binding data in
  existing posting commands.

## Backfill Feasibility

Existing historical data does not contain enough binding evidence:

- Ledger journals and entries store account and asset context, not custody
  binding context.
- Deposit requests store wallet and asset context, not binding context.
- Withdrawal requests and execution records store wallet, asset, and safe
  evidence status, not binding context.
- Staking and reward flows are internal liability or expense flows.
- Custody bindings are configuration aliases and intentionally do not store
  external account identifiers.

Backfill decision:

```text
HISTORICAL_BINDING_BACKFILL=NOT_BACKFILLABLE
NO_EXISTING_PRODUCTION_DATA_ASSUMED=REPOSITORY_LOCAL_ASSUMPTION_ONLY
AUTOMATIC_ALLOCATION_ALLOWED=false
```

Rejected backfill methods:

- Assigning all historical aggregate custody to the first binding.
- Assigning all historical aggregate custody to the currently active binding.
- Equal split across bindings.
- Percentage or weighted split.
- Inferring binding from provider or role names alone.

## Cutover Requirement

If a binding-scoped ledger model is selected:

```text
CUTOVER_REQUIRED=true
OPENING_ALLOCATION_REQUIRED=true
```

The cutover would need a forward-only accounting contract that either:

- Keeps pre-cutover history as asset aggregate and starts binding-level
  attribution only after a cutover timestamp, or
- Creates approved opening allocation journal entries into binding-scoped
  direct external accounts.

This task does not execute either option.

If asset aggregate reconciliation is selected:

```text
CUTOVER_REQUIRED=false
OPENING_ALLOCATION_REQUIRED=false
CORE_SCHEMA_REVISION_REQUIRED=true
```

The required follow-up is a reconciliation scope revision, not a ledger cutover.

## Core Reconciliation Schema Impact

| Candidate | Core schema impact | Notes |
| --- | --- | --- |
| Immutable binding-scoped account | `NO_CHANGE_FOR_CORE`, `LEDGER_SCHEMA_EXTENSION_REQUIRED` | Current core already stores binding on observations and items. |
| Historical mapping | `ADD_MAPPING_REFERENCE_OPTIONAL`, `LEDGER_SCHEMA_EXTENSION_REQUIRED` | Mapping alone is not enough until direct external account cardinality exists. |
| Asset aggregate | `CORE_SCHEMA_REVISION_REQUIRED`, `MAKE_BINDING_NULLABLE_OR_ADD_SCOPE_COLUMN` | Current non-null binding item shape does not directly represent aggregate results. |
| Provider and asset aggregate | `ADD_PROVIDER_ASSET_SCOPE`, `CORE_SCHEMA_REVISION_REQUIRED` | Would require provider-level run or item scope plus observation aggregation rules. |
| Dual ledger | `CORE_SCHEMA_REVISION_REQUIRED`, `CONTROL_ACCOUNT_MODEL_REQUIRED` | Not recommended without a full subledger design. |

## Official Requirement Fit

Primary source reviewed:

```text
docs/05-operations/PHASE5_CUSTODY_GATE.md
```

Finding:

- The gate approves local custody configuration and read-only observation
  contract scaffolding.
- It does not explicitly state that binding-level reconciliation is a product
  must.
- It does not explicitly approve asset aggregate reconciliation as sufficient.
- It requires future reconciliation and operational posting to be separate
  gates.

Therefore repository evidence alone cannot choose between binding-level
accuracy and asset-level aggregate fit.

```text
OFFICIAL_REQUIREMENT_BINDING_LEVEL_MUST=NOT_CONFIRMED
OFFICIAL_REQUIREMENT_ASSET_AGGREGATE_ALLOWED=NOT_CONFIRMED
PRODUCT_DECISION_REQUIRED=true
```

## Decision Matrix

| Criterion | Immutable binding account | Historical mapping | Asset aggregate | Provider asset aggregate | Dual ledger |
| --- | --- | --- | --- | --- | --- |
| Official requirement fit | `MEDIUM` | `MEDIUM` | `MEDIUM` | `MEDIUM` | `LOW` |
| Current ledger fit | `BLOCKING` | `BLOCKING` | `HIGH` | `MEDIUM` | `LOW` |
| Posting flow binding availability | `BLOCKING` | `BLOCKING` | `HIGH` | `MEDIUM` | `BLOCKING` |
| Historical reproducibility | `LOW` | `MEDIUM_AFTER_EXTENSION` | `HIGH` | `MEDIUM` | `LOW` |
| Backfill feasibility | `BLOCKING` | `BLOCKING` | `HIGH` | `MEDIUM` | `BLOCKING` |
| Accounting correctness | `HIGH_AFTER_CUTOVER` | `HIGH_AFTER_EXTENSION` | `HIGH_AGGREGATE_ONLY` | `MEDIUM` | `LOW_WITHOUT_CONTROL_ACCOUNTS` |
| Implementation scope | `HIGH` | `HIGH` | `MEDIUM` | `MEDIUM_HIGH` | `HIGH` |
| Migration risk | `HIGH` | `HIGH` | `MEDIUM` | `MEDIUM_HIGH` | `HIGH` |
| Operational clarity | `HIGH_AFTER_PRODUCT_DECISION` | `MEDIUM` | `HIGH` | `MEDIUM` | `LOW` |
| Future provider compatibility | `HIGH` | `HIGH` | `MEDIUM` | `HIGH` | `MEDIUM` |

## Final Selection

Selected status:

```text
FINAL_SELECTION=PRODUCT_DECISION_REQUIRED
LEDGER_SCOPE_ARCHITECTURE_READY=false
PRODUCT_DECISION_REQUIRED=true
```

Why:

- Binding-scoped expected balance cannot be safely implemented because current
  posting flows and current ledger accounts do not carry binding attribution.
- A mapping table alone cannot represent multiple active bindings for one
  asset while `SYSTEM_CUSTODY` remains unique per asset.
- Asset aggregate reconciliation fits the current ledger but conflicts with
  the currently committed binding-centered P5 reconciliation core shape unless
  a forward core schema revision is approved.
- The Phase 5 gate does not force either product interpretation.

Expected-balance implementation readiness:

```text
EXPECTED_BALANCE_IMPLEMENTABLE_NOW=false
```

## Required Product Decision

The product owner should choose one of these paths before implementation
continues.

### Option 1 - Asset Aggregate Reconciliation

Accounting meaning:

```text
Compare asset-level SYSTEM_CUSTODY to the sum of safe external balance
observations for that asset.
```

Implementation scope:

- Add a forward reconciliation scope revision for aggregate asset items.
- Keep existing ledger posting flows unchanged.
- Keep observations binding-scoped as raw inputs, but aggregate them into
  asset-level reconciliation outputs.

Existing schema impact:

- Requires new aggregate result scope or nullable binding behavior in a
  forward migration.

Past data impact:

- Safe for existing aggregate ledger history.

Operational tradeoff:

- Simpler and aligned with current ledger.
- Cannot isolate mismatches to a single binding without a secondary review.

### Option 2 - Binding-Scoped Ledger Account Architecture

Accounting meaning:

```text
Each binding has explicit direct external asset ledger account attribution.
```

Implementation scope:

- Extend `private.ledger_accounts` or add an equivalent direct external account
  model.
- Update deposit, withdrawal settlement, and any future custody-affecting
  posting commands to receive or resolve binding explicitly.
- Define cutover and opening allocation rules.
- Add mapping history and expected-balance functions after the account model.

Existing schema impact:

- Requires forward ledger schema extension.
- Existing singleton system account assumptions must be preserved or migrated.

Past data impact:

- Historical binding backfill is not supported from repository data.
- Pre-cutover history must remain aggregate or be moved through approved
  opening allocation.

Operational tradeoff:

- Best per-binding audit precision.
- Highest accounting and migration risk.

### Option 3 - Provider And Asset Aggregate Reconciliation

Accounting meaning:

```text
Compare expected and observed balances by provider plus asset instead of each
binding.
```

Implementation scope:

- Add provider and asset reconciliation scope.
- Define how binding observations roll up to provider and asset totals.
- Decide whether ledger accounts remain asset aggregate or become
  provider-scoped in a later phase.

Existing schema impact:

- Requires forward core schema revision.
- May later require provider-scoped ledger attribution.

Past data impact:

- Easier than binding backfill, but provider attribution still does not exist
  in historical ledger entries.

Operational tradeoff:

- More granular than asset aggregate.
- Less precise than binding-level reconciliation.

## Next Task Routing

Do not start implementation until one option is selected.

If Option 1 is selected:

```text
P5-T02-02B aggregate reconciliation scope forward migration
P5-T02-03C aggregate expected balance function
```

If Option 2 is selected:

```text
P5-T02-03B-R2 binding-scoped ledger account schema
P5-T02-03B-R3 posting flow binding propagation
P5-T02-03C binding expected balance function
```

If Option 3 is selected:

```text
P5-T02-02B provider-asset reconciliation scope forward migration
P5-T02-03C provider-asset expected balance function
```

## Guardrails

The following remain prohibited until explicitly approved:

- Splitting `SYSTEM_CUSTODY` by arbitrary ratio.
- Assigning aggregate custody to the first or current binding.
- Sharing one aggregate account across multiple active binding-level expected
  balances.
- Backfilling binding history from provider or role names.
- Creating operational custody postings without explicit binding source.
- Changing committed migrations in place.
- Calling remote providers, remote Supabase, blockchain RPC, mainnet, or
  testnet.

## Security And Secret Review

- No wallet address value was added.
- No custody account identifier value was added.
- No email value was added.
- No password value was added.
- No cookie or token value was added.
- No Supabase key value was added.
- No service-role key value was added.
- No database URL value was added.
- No provider credential value was added.
- No private key value was added.
- No mnemonic value was added.
- No npm token value was added.

## Git

- Existing 03A document: preserved unchanged.
- Existing 03B document: preserved unchanged.
- Staging: not performed.
- Commit: not performed.
- Push: not performed.
- PR: not performed.

Final status:

```text
PASS_PRODUCT_DECISION_REQUIRED
```
