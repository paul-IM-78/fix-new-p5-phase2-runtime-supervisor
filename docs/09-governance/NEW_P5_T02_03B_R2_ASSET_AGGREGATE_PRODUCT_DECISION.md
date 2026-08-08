# NEW-P5-T02-03B-R2 Asset Aggregate Product Decision

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Starting HEAD: `8d57021971e77984794afc20cbe1192f2564bd6d`
- Prior document preserved: `NEW_P5_T02_03A_CUSTODY_LEDGER_ALLOCATION_CONTRACT.md`
- Prior document preserved: `NEW_P5_T02_03B_BINDING_LEDGER_MAPPING_REPORT.md`
- Prior document preserved: `NEW_P5_T02_03B_R1_LEDGER_SCOPE_ARCHITECTURE_DECISION.md`

## Product Decision

P5-T02 v1 uses asset aggregate reconciliation.

```text
P5_T02_V1_RECONCILIATION_MODEL=ASSET_AGGREGATE_RECONCILIATION
COMPARISON_SCOPE=asset_id
```

Expected balance:

```text
expected_units = asset-level SYSTEM_CUSTODY internal ledger balance
```

Observed balance:

```text
observed_units = sum of safe balance observations from every included
custody binding member for the asset
```

The following models are not selected for v1:

```text
BINDING_SCOPED_LEDGER_RECONCILIATION
PROVIDER_ASSET_LEDGER_RECONCILIATION
DUAL_AGGREGATE_AND_BINDING_LEDGER
```

## Selection Basis

Repository evidence shows:

- `SYSTEM_CUSTODY` is one aggregate system asset account per asset.
- Deposit confirmation posts without custody binding information.
- Withdrawal internal settlement posts without custody binding information.
- Opening balance and correction postings do not carry custody binding
  information.
- Staking principal and reward postings are internal liability or expense
  movements and do not carry external custody binding information.
- Provider and binding metadata exists for observation and configuration, but
  provider identity is not carried through current ledger postings.

Therefore current repository state can safely calculate only an asset-level
internal expected balance. Binding-level or provider-level expected balances
would require ledger account redesign and binding propagation through financial
posting flows.

## Binding Scope Policy

Binding-scoped observation boundaries are preserved for:

- `private.external_balance_observations`
- `private.external_transaction_observations`
- `private.observer_checkpoints`

Reason:

- Provider balance observation and checkpoint cursors are naturally executed
  by custody binding.
- Binding observations remain the raw external evidence source.
- Binding observations are aggregated into asset-level reconciliation items
  through a private provenance snapshot table.

## Asset Aggregate Item Policy

`private.reconciliation_items` now supports asset aggregate rows.

Contract:

```text
scope_kind = ASSET_AGGREGATE
custody_account_binding_id IS NULL
external_balance_observation_id IS NULL
```

One reconciliation run may have at most one asset aggregate item per asset.

The original binding item shape remains available as a backward-compatible
scope:

```text
scope_kind = BINDING
custody_account_binding_id IS NOT NULL
```

P5-T02 v1 does not use binding items as the product comparison output.

## Observation Provenance

Asset aggregate items cannot be explained by one
`external_balance_observation_id`, because the observed value is composed from
multiple binding observations.

The selected provenance contract is:

```text
private.reconciliation_item_binding_observations
```

Each row snapshots one custody binding member for one asset aggregate item.

Membership statuses:

```text
OBSERVED
MISSING_OBSERVATION
OBSERVATION_FAILED
```

Rules:

- `OBSERVED` requires a safe external balance observation reference.
- Missing or failed members must not store an observation reference.
- Observation binding must equal the member binding.
- Observation asset must equal the aggregate item asset.
- Duplicate membership for the same item and binding is blocked.

## Completeness Policy

Normal aggregate classifications require complete observed membership.

Normal classifications:

```text
MATCHED
WITHIN_TOLERANCE
MISMATCH
```

If any recorded member is:

```text
MISSING_OBSERVATION
OBSERVATION_FAILED
```

then the aggregate item must not use a normal classification. P5-T02 v1 uses
the existing `OBSERVATION_FAILED` classification for incomplete observation
sets and does not introduce a new classification value.

Missing observations are not treated as zero.

Failed observations are not treated as zero.

## Provider And Asset Scope

Provider and asset reconciliation is excluded from v1.

Reason:

- Provider identity exists in custody configuration and observation metadata.
- Provider identity does not exist in the current ledger posting model.
- A provider-level expected internal balance cannot be derived without
  provider-scoped ledger attribution.

Provider can remain provenance context, but it is not the comparison scope.

## Binding-Level Deferred Contract

Binding-level reconciliation is deferred until all prerequisites exist:

```text
BINDING_LEVEL_RECONCILIATION=DEFERRED_LEDGER_REDESIGN
```

Required future prerequisites:

- Posting flows carry or resolve explicit binding scope.
- Binding-scoped direct external asset ledger accounts exist.
- Historical cutover or backfill policy is approved.
- Binding-level expected balance can be calculated without allocation guesses.

## Solvency Separation

The following comparison is out of P5-T02 v1 scope:

```text
external custody assets vs aggregate user liabilities
```

That is a separate solvency reconciliation task and must not be mixed into
asset aggregate custody reconciliation.

## Forward Schema Impact

Required forward migration impact:

- Add `scope_kind` to `private.reconciliation_items`.
- Make `custody_account_binding_id` nullable for asset aggregate items.
- Preserve single-observation FK behavior for binding items.
- Require asset aggregate rows to leave the single observation FK null.
- Add an asset aggregate unique index per run and asset.
- Add a private provenance table for item binding observation membership.
- Add DB-level binding and asset provenance consistency checks.
- Keep all new objects private.

Committed migrations are not edited in place.

## Final Product Markers

```text
P5_T02_V1_RECONCILIATION_MODEL=ASSET_AGGREGATE_RECONCILIATION
EXPECTED_BALANCE_SOURCE=ASSET_LEVEL_SYSTEM_CUSTODY
OBSERVED_BALANCE_SOURCE=BINDING_OBSERVATION_SUM_BY_ASSET
BINDING_OBSERVATIONS_RETAINED=true
BINDING_LEVEL_RECONCILIATION=DEFERRED_LEDGER_REDESIGN
PROVIDER_ASSET_RECONCILIATION=EXCLUDED_FROM_V1
SOLVENCY_RECONCILIATION=SEPARATE_TASK
```

## Security Review

- This document contains no wallet address values.
- This document contains no custody account identifier values.
- This document contains no email values.
- This document contains no password values.
- This document contains no cookies, tokens, or JWT values.
- This document contains no Supabase key values.
- This document contains no service-role key values.
- This document contains no database URL values.
- This document contains no provider credential values.
- This document contains no private key or mnemonic values.

Final status:

```text
PASS_ASSET_AGGREGATE_PRODUCT_DECISION
```
