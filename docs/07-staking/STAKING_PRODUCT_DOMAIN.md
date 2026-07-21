# Staking Product Domain

NEW-P4-T01 introduces the first staking product domain boundary for local
managed-wallet development.

## Scope

- `private.staking_products` stores product terms and lifecycle status.
- `private.staking_product_admin_audit_events` stores immutable administrator
  command audit summaries.
- Product commands require an ACTIVE ADMIN with current AAL2 in PostgreSQL.
- Product reads use RPCs only. Browser clients do not receive direct table
  privileges.
- Product commands do not create ledger accounts, post journals, create
  staking positions, lock principal, calculate rewards, sign transactions, or
  contact a blockchain.

## Product Status

Allowed statuses:

- `DRAFT`
- `ACTIVE`
- `SUSPENDED`
- `ARCHIVED`

Allowed transitions:

- `DRAFT` to `ACTIVE`
- `DRAFT` to `ARCHIVED`
- `ACTIVE` to `SUSPENDED`
- `SUSPENDED` to `ACTIVE`
- `SUSPENDED` to `ARCHIVED`

Same-status transitions return `NOOP` and do not increment the product
version. `ARCHIVED` is terminal. `ACTIVE` to `ARCHIVED` is intentionally
blocked.

## Term Freeze

The product code is immutable after creation. Product terms are frozen after
the first activation and cannot be edited by the draft update command or by
direct table mutation.

Frozen fields include:

- Project
- Asset
- Display name
- Description
- Lock duration
- Minimum and maximum stake units
- Term reward rate PPM
- Reward rounding mode
- Enrollment window

## Activation Boundary

Activation requires:

- Project exists and is `ACTIVE`
- Asset exists and is `ACTIVE`
- Asset is `SOLANA` and `SPL_TOKEN`
- Asset is the current unretired token assignment for the project
- Enrollment end is still in the future

Native assets, non-current SPL tokens, inactive projects, inactive assets, and
expired enrollment windows are rejected.

## Public Read Boundary

`public.list_current_staking_products(p_limit)` is the user-facing product
catalog RPC. It requires an ACTIVE profile and returns active products only
when the project, asset, and current project-token assignment are valid.

The `/staking` page displays product metadata only:

- Product code and name
- Project and asset metadata
- Lock duration
- Min/max atomic-unit limits
- Fixed term reward PPM
- Enrollment state and window

It does not provide a stake button, amount entry, expected reward, APY/APR,
claim, unlock, wallet address, or transaction identifier.

## Admin Boundary

`/admin/staking-products` uses AAL2-only RPCs:

- `public.create_staking_product(...)`
- `public.update_staking_product_draft(...)`
- `public.transition_staking_product_status(...)`
- `public.list_admin_staking_products(...)`
- `public.list_staking_product_admin_audit_events(...)`

Command idempotency compares actor, action, normalized reason, and normalized
request data. Replays return the original event. A reused command ID with a
different payload returns a conflict.

## Ledger Boundary

Staking product commands have zero ledger side effects. They do not touch:

- `private.ledger_accounts`
- `private.ledger_journals`
- `private.ledger_entries`
- Financial admin audit tables
- Deposit request tables
- Withdrawal request tables
- User balance views

Actual principal locking and reward posting are later Phase 4 tasks.
