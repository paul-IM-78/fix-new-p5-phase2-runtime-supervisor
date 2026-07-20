# Double-Entry Ledger Core

## Scope

This phase introduces the database-only core for managed wallet balances. It
does not implement deposits, withdrawals, staking products, rewards, balance
UI, blockchain signing, real asset seed data, service-role application access,
remote Supabase, production, or mainnet.

The ledger is private by default. Browser clients can only call the read-only
current-user balance RPC.

## Atomic Units

Ledger amounts are exact PostgreSQL `numeric` values constrained by
`private.positive_atomic_units`.

Rules:

- Positive integer only.
- Maximum 38 decimal digits.
- No zero, negative, fractional, NaN, infinity, or scientific notation at the posting boundary.
- Application and RPC boundaries use decimal digit strings.
- JavaScript `Number`, floating point math, PostgreSQL `money`, and decimal display amounts are prohibited for posting.

## Accounts

`private.ledger_accounts` stores account metadata and no computed balances.
Balances are derived from immutable entries.

User accounts:

- Scope: `USER`
- Class: `LIABILITY`
- Normal side: `CREDIT`
- Purposes: `USER_AVAILABLE`, `USER_LOCKED`, `USER_PENDING_DEPOSIT`, `USER_PENDING_WITHDRAWAL`
- Must reference one managed wallet account.

System accounts:

- `SYSTEM_CUSTODY`: `ASSET`, `DEBIT`
- `SYSTEM_DEPOSIT_CLEARING`: `CLEARING`, `DEBIT`
- `SYSTEM_WITHDRAWAL_CLEARING`: `CLEARING`, `DEBIT`
- `SYSTEM_REWARD_EXPENSE`: `EXPENSE`, `DEBIT`
- `SYSTEM_TOKEN_ISSUANCE`: `EQUITY`, `CREDIT`
- `SYSTEM_SUSPENSE`: `CLEARING`, `DEBIT`
- Must not reference a wallet account.

The mapping is enforced by table constraints, not naming convention.

## Posting Primitive

`private.post_ledger_journal(...)` is the only posting primitive in this phase.
It is `SECURITY DEFINER`, private, and revoked from `public`, `anon`, and
`authenticated`.

It enforces:

- Caller-supplied `command_id` idempotency.
- Canonical request comparison for replay.
- Conflict rejection when a command ID is reused with different data.
- Transaction advisory lock for atomic posting serialization.
- Deterministic account row locking.
- Single asset per journal.
- At least one debit and one credit.
- Debit sum equals credit sum.
- Positive atomic unit line amounts.
- No duplicate account in a journal.
- Only open accounts.
- No negative user liability balance.

Correction is modeled by a new reversing journal, not by mutating existing
journals or entries.

## Immutability

`private.ledger_journals` and `private.ledger_entries` are posted-only records.
Triggers reject `UPDATE`, `DELETE`, and `TRUNCATE`.

Deferred constraint triggers re-check database invariants at transaction end,
including owner-level direct inserts. Invalid direct inserts cannot commit.

## Balance Views

`private.ledger_account_balances` calculates each account balance from ledger
entries:

- Debit-normal account: debit units minus credit units.
- Credit-normal account: credit units minus debit units.
- Entryless accounts return zero.

`private.wallet_asset_ledger_balances` aggregates user wallet and asset buckets:

- `available_units`
- `locked_units`
- `pending_deposit_units`
- `pending_withdrawal_units`
- `total_liability_units`

No fake row is returned for assets without user ledger accounts.

## Public Read RPC

`public.list_current_user_ledger_balances()` is the only public ledger RPC in
this phase.

It:

- Requires an authenticated ACTIVE profile.
- Reads only the current user's managed wallet.
- Returns one row per wallet asset with ledger accounts.
- Returns amounts as text.
- Does not return ledger account IDs, journal IDs, entry IDs, email, wallet address, credential material, cookies, or tokens.
- Does not post or mutate financial state.

## Balance Buckets

`available_units` is the future usable user liability bucket.

`locked_units` is the future staking principal liability bucket.

`pending_deposit_units` is the future deposit confirmation bucket.

`pending_withdrawal_units` is the future withdrawal processing bucket.

This task validates bucket accounting with QA postings only. It does not define
the real product commands that will use those buckets.

## Not Implemented

- Deposit request schema.
- Deposit confirmation command.
- Withdrawal request or reservation.
- Staking lock command.
- Reward posting command.
- Balance UI.
- Real asset seed data.
- On-chain settlement.
- Mainnet or production integration.
