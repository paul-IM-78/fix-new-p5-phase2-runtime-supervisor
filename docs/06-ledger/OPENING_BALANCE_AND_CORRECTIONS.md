# Opening Balance And Corrections

## Scope

This phase adds a narrow AAL2 administrator path for initial ledger migration
entries:

- Post one Opening Balance for a wallet and asset.
- Reverse that exact Opening Balance journal once.
- Record immutable financial administrator audit events.

It does not add generic manual journals, arbitrary debit and credit entry
forms, replacement Opening Balance, repeated Opening setup, real deposits,
withdrawals, staking, rewards, on-chain settlement, service-role application
access, remote Supabase, production, mainnet, private keys, mnemonics, or
client signing.

## Opening Balance

`public.post_opening_balance(...)` is the only Opening command.

It requires:

- Authenticated ACTIVE ADMIN with current AAL2, verified again inside
  PostgreSQL.
- ACTIVE wallet account.
- ACTIVE target profile.
- ACTIVE SOLANA supported asset with type `NATIVE` or `SPL_TOKEN`.
- Matching wallet expected version.
- Matching asset expected version.
- Atomic Units as a decimal digit string matching `^[1-9][0-9]{0,37}$`.
- A normalized reason, 1 to 500 characters, with no control characters or
  credential markers.
- No previous ledger entries for that wallet and asset.
- No previous APPLIED Opening Balance for that wallet and asset.

The command provisions ledger accounts when needed, then posts through the
private Posting Primitive:

- Debit `SYSTEM_CUSTODY`.
- Credit `USER_AVAILABLE`.

The command and audit event share the same database transaction. If validation
fails, no journal, entry, or audit event is created.

The migration also re-declares
`private.validate_ledger_journal_invariants()` as `SECURITY DEFINER`. This
preserves the deferred double-entry invariant checks while allowing
authenticated AAL2 RPC commands to commit through the private Posting Primitive
without granting browser roles direct access to private ledger tables.

## Idempotency

Every command receives a caller-supplied UUID command ID.

The financial administrator command lock is acquired before any wallet, asset,
or journal row lock. The lock order is:

1. Financial admin transaction advisory lock.
2. Wallet, asset, or original journal row locks.
3. Private Posting Primitive.
4. Ledger posting advisory lock and account row locks.

Replay with the same actor, action, normalized reason, and normalized request
data returns the existing event and journal. Reusing a command ID with different
request data returns `FINANCIAL_COMMAND_ID_CONFLICT` and creates no journal or
audit event.

## Reversal

`public.reverse_opening_balance(...)` reverses only an original
`ADMIN_OPENING_BALANCE` journal that is linked to an APPLIED Opening audit
event.

The reversal command validates that the original journal has exactly two
entries:

- Debit `SYSTEM_CUSTODY`.
- Credit `USER_AVAILABLE`.
- Same asset.
- Same atomic units.
- Wallet reference type `WALLET_ACCOUNT`.

The reversal derives account IDs, sides, and units from the immutable original
entries. Administrators cannot enter arbitrary account, side, or unit lines.

The reversal posts the exact opposite journal:

- Debit `USER_AVAILABLE`.
- Credit `SYSTEM_CUSTODY`.

If current `USER_AVAILABLE` balance is less than the original Opening units,
the command returns `OPENING_REVERSAL_INSUFFICIENT_AVAILABLE` and creates no
journal or audit event.

## One-Time Rules

One APPLIED Opening Balance is allowed per wallet and asset. Reversal does not
permit a replacement Opening Balance in this phase.

One APPLIED reversal is allowed per original Opening journal. A later command
against an already reversed Opening records a `REVERSE_OPENING_BALANCE / NOOP`
financial audit event and returns the existing reversal journal without posting
another journal.

## Audit

`private.financial_admin_audit_events` is append-only and private.

It records command ID, action, outcome, actor user ID, target user ID, wallet
account ID, asset ID, original and resulting journal IDs, reason, normalized
request data, atomic units, and occurrence time.

`UPDATE`, `DELETE`, and `TRUNCATE` are blocked by
`private.prevent_financial_admin_audit_mutation()`.

Browser roles have no direct table privileges. Audit reads use
`public.list_financial_admin_audit_events(...)` and require ACTIVE ADMIN plus
AAL2 inside PostgreSQL.

## Admin Reads

The AAL2 admin ledger page uses only read RPCs:

- `public.list_admin_wallet_asset_ledger_balances(...)`
- `public.list_admin_ledger_journals(...)`
- `public.list_financial_admin_audit_events(...)`

All unit values are returned as text. The page does not show request data,
entry-line dumps, email, auth metadata, cookies, tokens, MFA material, wallet
credentials, or private ledger account IDs.

## Remaining Work

The following remain explicitly unimplemented:

- Opening Balance replacement.
- Generic manual journal.
- Deposit request and confirmation.
- Withdrawal reservation and fulfillment.
- Staking lock.
- Reward posting.
- User balance UI.
- Real asset seed data.
- Remote Supabase, production, or mainnet connectivity.
