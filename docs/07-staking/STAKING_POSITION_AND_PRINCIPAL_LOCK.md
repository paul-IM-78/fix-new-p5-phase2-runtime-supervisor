# Staking Position And Principal Lock

NEW-P4-T02 added the first staking position boundary for the managed staking
wallet. NEW-P4-T03 extends that boundary with matured principal unlock while
preserving the original principal-lock invariant.

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
- `/admin/staking-positions` is AAL2 operational review and matured principal
  unlock.

This phase does not implement early unlock, partial unlock, position cancel,
reward calculation, reward posting, reward claim, wallet addresses,
transaction IDs, client signing, service-role application access, remote
Supabase, mainnet, or production connectivity.

## Position Status

Position creation still creates only:

```text
LOCKED
```

NEW-P4-T03 adds the only supported forward transition:

```text
LOCKED -> UNLOCKED
```

`UNLOCKED` requires `unlock_journal_id`, `unlocked_by`, `unlock_actor_type`,
and `unlocked_at`. The database requires `unlocked_at >= matures_at`.
`UNLOCKED` is terminal and cannot transition back to `LOCKED`.

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

## Unlock Posting

Principal unlock posts exactly one journal after PostgreSQL database time
reaches `matures_at`.

User self-service unlock:

```text
Journal type:   USER_STAKING_POSITION_UNLOCKED
Initiator type: USER
Reference type: STAKING_POSITION
```

AAL2 administrator unlock:

```text
Journal type:   ADMIN_STAKING_POSITION_UNLOCKED
Initiator type: ADMIN
Reference type: STAKING_POSITION
```

Both journal shapes have exactly two user liability entries:

```text
DEBIT  USER_LOCKED
CREDIT USER_AVAILABLE
```

The result is:

- Locked decreases
- Available increases
- Total liability stays unchanged
- System accounts stay unchanged
- Reward expense stays unchanged

## Atomicity

The command uses a transaction advisory lock:

```text
staking-wallet-web:staking-position-command:v1
```

Product row locking, wallet row locking, ledger account row locking, private
posting, position insert/update, and audit insert happen in one transaction.
The system must not create a position without its lock journal, unlock a
position without its unlock journal, or create a position lifecycle journal
without position audit.

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

Unlock uses the same transaction advisory lock namespace:

```text
staking-wallet-web:staking-position-command:v1
```

The unlock ledger journal uses the same command ID as the audit row. Same
command replay returns the existing unlock state. Reusing the command ID with a
different actor, expected version, position, wallet version for user commands,
or reason returns `STAKING_POSITION_COMMAND_ID_CONFLICT`.

If a new command targets an already `UNLOCKED` position with the current
position version, the database records an immutable `NOOP` audit event and does
not post a journal, change balances, or increment the position version.

## Invariants

`private.validate_staking_position_core()` blocks unsupported updates and
invalid inserts. The only supported update is `LOCKED -> UNLOCKED` with the
unlock fields, `updated_at`, and `version` changed. `private.prevent_staking_position_deletion()` blocks delete
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

Users read their own maturity state through the same read RPC. The result uses
database time and returns `LOCKED`, `MATURED`, or `UNLOCKED`. User output
intentionally omits `unlocked_by`, journal IDs, request data, and audit rows.

Administrators read position and audit summaries through AAL2-only RPCs. The
admin UI can submit matured principal unlock commands, but does not provide
early unlock, partial unlock, cancel, reward, address, or on-chain controls.
