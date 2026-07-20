# Project, Asset, And Managed Wallet Domain

## Scope

This document defines the Phase 2 domain schema baseline for the managed
staking wallet web app.

Implemented in this phase:

- Project metadata
- Supported asset metadata
- Project token assignment history
- One managed wallet account container per user profile
- Automatic wallet account provisioning for new profiles
- Authenticated read-only catalog and own-wallet RLS

Not implemented in this phase:

- Balances
- Amount movement
- Double-entry ledger
- Deposits
- Withdrawals
- Staking positions
- Rewards
- APY
- Blockchain transactions
- Deposit or withdrawal addresses
- Private keys
- Mnemonics
- Client signing
- Project or asset ADMIN command surfaces

## Projects

`public.projects` stores project metadata only.

Allowed statuses:

```text
DRAFT
ACTIVE
SUSPENDED
ARCHIVED
```

Project codes are immutable application slugs. They must be trimmed, 2 to 32
characters, and contain only uppercase letters, numbers, and underscores. The
first character must be an uppercase letter or number.

The database enforces at most one `ACTIVE` project across the whole system with
a partial unique index. Zero active projects is valid.

Archived projects are preserved as historical metadata. This phase does not add
a hard-delete command for projects.

## Supported Assets

`public.supported_assets` stores SOLANA-scoped asset metadata only.

Allowed networks:

```text
SOLANA
```

Allowed asset types:

```text
NATIVE
SPL_TOKEN
```

Allowed statuses:

```text
DRAFT
ACTIVE
SUSPENDED
ARCHIVED
```

`NATIVE` assets must have `mint_address IS NULL`. `SPL_TOKEN` assets must have a
trimmed Base58-like mint string with length 32 to 44 characters.

The migration does not seed real SOL, USDT, project token, or mint rows. Real
asset metadata belongs to a later AAL2 ADMIN command and audit task.

The table intentionally does not include feature flags such as
`is_stakeable`, `deposit_enabled`, `withdrawal_enabled`, `reward_enabled`, or
`is_project_token`. Those decisions require later product and command
boundaries.

## Project Token Assignments

`public.project_token_assignments` stores current and historical project token
assignment rows.

Rules:

- Current rows have `retired_at IS NULL`.
- Historical rows have `retired_at IS NOT NULL`.
- A project can have at most one current token assignment.
- An asset can be assigned to at most one current project.
- Native assets cannot be project tokens.
- Archived assets cannot be assigned.
- Token replacement must be retire plus insert, not in-place asset mutation.

The assignment validation trigger blocks mutation of `project_id`, `asset_id`,
and `assigned_at` after creation. It also blocks reactivation or mutation of an
already retired assignment.

ADMIN project and asset command RPCs are not part of this task.

## Managed Wallet Accounts

`public.wallet_accounts` stores one managed wallet account container per
profile.

Allowed custody model:

```text
MANAGED
```

Allowed statuses:

```text
ACTIVE
FROZEN
CLOSED
```

`CLOSED` requires `closed_at IS NOT NULL`. `ACTIVE` and `FROZEN` require
`closed_at IS NULL`.

`wallet_accounts` is not a balance table. It does not store asset balances,
ledger values, blockchain addresses, private keys, mnemonics, seed phrases, or
transaction identifiers.

The profile relationship is a deferred foreign key that blocks committed
profile deletes while preserving existing local pgTAP rollback fixtures that
temporarily create and remove profiles inside one transaction.

## Provisioning

New Supabase Auth users already create a profile and default USER role through
the Auth identity migration. This phase adds profile-to-wallet provisioning:

```text
auth.users INSERT
public.profiles INSERT
public.user_roles INSERT
public.wallet_accounts INSERT
```

`private.ensure_user_wallet_account(uuid)` idempotently creates or returns the
existing wallet account for a profile. It is a private `SECURITY DEFINER`
helper with `search_path = ''` and no browser execute privilege.

`private.handle_profile_wallet_account_created()` calls the helper from an
`AFTER INSERT` trigger on `public.profiles`.

Existing profiles are backfilled without changing profile status, role status,
or profile version.

## Status Boundaries

`profiles.account_status` is the application access state. It is used by auth,
account, and admin guards.

`wallet_accounts.status` is a future financial-account operating state. It does
not replace profile status and is not yet connected to financial commands.

The two states are not automatically synchronized.

## Versioning

`private.touch_versioned_record()` applies to:

- `public.projects`
- `public.supported_assets`
- `public.project_token_assignments`
- `public.wallet_accounts`

On update it sets:

```text
updated_at = clock_timestamp()
version = OLD.version + 1
```

Caller-supplied version values are not trusted.

## Browser Access

Authenticated browser clients may read:

- Active projects
- Active supported assets
- Current assignments whose project and asset are active
- Their own wallet account

Browser clients may not directly insert, update, or delete any Phase 2 domain
table.

`anon` has no direct read or write grants on the new domain tables.

## Future Tasks

Later tasks must define audited AAL2 ADMIN commands for:

- Project creation and activation
- Asset creation and activation
- Project token assignment replacement
- Wallet account operating status changes
- Historical catalog reads for administrators

Financial ledger, balances, deposits, withdrawals, staking, rewards, addresses,
and on-chain integrations remain separate future phases.
