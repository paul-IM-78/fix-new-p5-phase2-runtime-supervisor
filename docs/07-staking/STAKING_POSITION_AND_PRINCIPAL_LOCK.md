# Staking Position And Principal Lock

NEW-P4-T02 adds the first staking position boundary for the managed staking
wallet. The implementation creates `LOCKED` positions only and atomically moves
principal from user available units to user locked units.

## Scope

- `private.staking_positions` stores immutable user staking positions.
- `private.staking_position_command_audit_events` stores immutable position
  command audit events.
- `public.create_user_staking_position(...)` creates a position and posts the
  principal lock in the same database transaction.
- `public.list_current_user_staking_positions(...)` returns the current user's
  own position summaries.
- `public.list_admin_staking_positions(...)` and
  `public.list_staking_position_command_audit_events(...)` are AAL2 ADMIN-only
  read RPCs.
- `/staking` lets an authenticated active user create a principal lock and view
  owned locked positions.
- `/admin/staking-positions` is read-only operational review.

This phase does not implement maturity processing, principal unlock, position
cancel, reward calculation, reward posting, reward claim, wallet addresses,
transaction IDs, client signing, service-role application access, remote
Supabase, mainnet, or production connectivity.

## Position Status

The only position status created in this phase is:

```text
LOCKED
```

Future statuses must be added by forward-only migrations. Existing locked
positions are not automatically cancelled, unlocked, or rewarded by this task.

## Principal Units

Principal is accepted as an atomic-unit decimal digit string and stored through
the existing private exact numeric domain. The browser and server validation
reject JavaScript number-style inputs such as decimals, exponent notation,
zero, signed values, whitespace, leading zeroes, and values longer than 38
digits.

No `Number()`, `parseInt()`, `parseFloat()`, `real`, `double precision`, or
`money` path is used for principal.

## Product Boundary

Position creation requires:

- Product status `ACTIVE`
- Enrollment window open at command time
- Active project
- Active SOLANA SPL asset
- Asset is the current unretired project token
- Product expected version matches the submitted version
- Principal is within the product's per-position minimum and maximum

The minimum and maximum apply per position. A user may create multiple
positions for the same product when each position has a distinct command ID and
passes validation. Aggregate per-user, per-product, and project-wide staking
caps are intentionally not implemented yet.

## Snapshot

Each position stores the product terms used at lock time:

- Product version
- Project ID
- Asset ID
- Lock duration days
- Term reward rate PPM
- Reward rounding mode

`locked_at` is the lock journal `posted_at`. `matures_at` is
`locked_at + lock_duration_days_snapshot`.

Product terms are already frozen after first activation, but the position keeps
an explicit snapshot so maturity and future reward work can use the terms that
were accepted when the principal was locked. A later product suspension or
archive does not mutate existing position snapshots.

## Posting

Position creation posts exactly one journal with:

```text
Journal type:   USER_STAKING_POSITION_LOCKED
Initiator type: USER
Reference type: STAKING_POSITION
Reference ID:   Position UUID
```

The journal has exactly two user liability entries:

```text
DEBIT  USER_AVAILABLE
CREDIT USER_LOCKED
```

The result is:

- Available decreases
- Locked increases
- Total liability stays unchanged
- System accounts stay unchanged
- Reward expense stays unchanged

Unlock and reward postings are explicitly absent.

## Atomicity

The command uses a transaction advisory lock:

```text
staking-wallet-web:staking-position-command:v1
```

Product row locking, wallet row locking, ledger account row locking, private
posting, position insert, and audit insert happen in one transaction. The
system must not create a position without its lock journal, or a lock journal
without its position audit.

## Idempotency

The caller supplies both the position ID and command ID. The position audit
table uses `command_id` as the global command key.

Replay with the same actor, action, product, expected versions, wallet,
principal units, position ID, and fixed reason returns the existing position
with `replayed = true`.

Reusing a command ID with a different payload returns:

```text
STAKING_POSITION_COMMAND_ID_CONFLICT
```

Replay does not create duplicate positions, journals, entries, audit events, or
balance movement.

## Invariants

`private.validate_staking_position_core()` blocks unsupported updates and
invalid inserts. `private.prevent_staking_position_deletion()` blocks delete
and truncate.

`private.validate_staking_position_invariants()` is a deferred constraint
trigger that verifies the position, product, wallet, journal, entries, units,
reference, asset, locked timestamp, and maturity timestamp belong together.

`private.prevent_staking_position_command_audit_mutation()` blocks update,
delete, and truncate on the audit table.

## Read Boundary

Users read their own positions through
`public.list_current_user_staking_positions(...)`. The result exposes principal
as text and omits ledger account IDs, journal IDs, request data, reward
calculation, wallet address, transaction ID, cookies, and tokens.

Administrators read position and audit summaries through AAL2-only RPCs. The
admin UI is read-only and does not provide unlock, cancel, reward, address, or
on-chain controls.
