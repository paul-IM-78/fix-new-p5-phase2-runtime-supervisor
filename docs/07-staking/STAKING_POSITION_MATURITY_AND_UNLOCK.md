# Staking Position Maturity And Principal Unlock

NEW-P4-T03 adds the first maturity-dependent staking position transition.

## Scope

- Position maturity is derived in PostgreSQL from database time.
- User read RPCs return `LOCKED`, `MATURED`, or `UNLOCKED` maturity state.
- A user can unlock only their own `LOCKED` and `MATURED` position when their
  managed wallet is `ACTIVE`.
- An AAL2 administrator can unlock a `LOCKED` and `MATURED` position for
  operational cleanup, including inactive target profiles or non-active target
  wallets when existing ledger accounts remain valid.
- Unlock posts principal only:

```text
DEBIT  USER_LOCKED
CREDIT USER_AVAILABLE
```

## Database Boundary

`private.staking_positions` is extended forward-only with:

- `unlock_journal_id`
- `unlocked_by`
- `unlock_actor_type`
- `unlocked_at`

The only supported status transition is:

```text
LOCKED -> UNLOCKED
```

`UNLOCKED` is terminal. Core position fields, snapshots, principal, wallet,
asset, product, lock journal, locked timestamp, and maturity timestamp remain
immutable.

## Commands

User command:

```text
public.unlock_current_user_staking_position(
  p_staking_position_id,
  p_position_expected_version,
  p_wallet_expected_version,
  p_command_id
)
```

Admin command:

```text
public.unlock_staking_position_as_admin(
  p_staking_position_id,
  p_position_expected_version,
  p_command_id,
  p_reason
)
```

Both commands use the existing staking position advisory lock namespace:

```text
staking-wallet-web:staking-position-command:v1
```

Both commands use the same command ID for the ledger journal and immutable
position audit row. Same-command replay returns the existing result. A new
command against an already unlocked position records `NOOP` audit and does not
post a journal, update the position, increment version, or change balances.

## Audit

`private.staking_position_command_audit_events` now records:

- `actor_type`
- `previous_status`
- `resulting_status`
- `resulting_journal_id`

Unlock audit action is:

```text
UNLOCK_STAKING_POSITION
```

Outcomes are:

```text
APPLIED
NOOP
```

Audit rows are append-only. Full request data and journal line payloads are
not exposed through public read RPCs.

## UI And API

User API:

```text
POST /api/v1/staking/positions/unlock
```

Admin API:

```text
POST /api/v1/admin/staking-positions/unlock
```

Both routes require same-origin form POSTs and redirect with safe public result
codes only. Redirect query strings do not include position IDs, command IDs,
versions, principal units, journal IDs, balances, reasons, or database errors.

## Explicitly Out Of Scope

- Early unlock
- Partial unlock
- Position cancellation
- Reward calculation
- Reward posting
- Reward claim
- APY/APR or expected reward display
- Unstaking
- Wallet address collection
- Transaction signatures or external evidence
- Client signing
- Private keys or mnemonics
- Service-role application client
- Remote Supabase
- Mainnet or production connectivity
