# Staking Reward Calculation And Settlement

NEW-P4-T04 adds one-time reward settlement for an already `UNLOCKED` staking
position.

## Scope

- Reward calculation uses only immutable position snapshot fields.
- PostgreSQL calculates reward units with exact `numeric` arithmetic.
- The only supported rounding mode is `FLOOR`.
- Each staking position can have at most one reward settlement.
- Positive rewards post one double-entry journal.
- Zero rewards create a final settlement row without a journal.
- User reward settlement requires an ACTIVE profile, the caller's own position,
  and an ACTIVE managed wallet.
- AAL2 administrators can settle an unlocked position for operational cleanup,
  including inactive target profiles, non-active target wallets, suspended
  products, suspended projects, or suspended assets when existing ledger
  accounts remain valid.

## Formula

The database function is:

```text
private.calculate_staking_reward_units(
  p_principal_units,
  p_term_reward_rate_ppm,
  p_rounding_mode
)
```

The formula is:

```text
floor(principal_units * term_reward_rate_ppm_snapshot / 1,000,000)
```

Inputs come from `private.staking_positions` only:

- `principal_units`
- `term_reward_rate_ppm_snapshot`
- `reward_rounding_mode_snapshot`

The calculation does not read the current product row, current product version,
current enrollment state, current reward rate, or browser-supplied values.
JavaScript `Number`, floating point arithmetic, and client-side reward math are
not used.

## Ledger Posting

When calculated reward units are greater than zero, settlement posts:

```text
DEBIT  SYSTEM_REWARD_EXPENSE
CREDIT USER_AVAILABLE
```

Effects:

- User Available increases by the reward units.
- User Total Liability increases by the reward units.
- System Reward Expense increases by the reward units.
- Principal does not change.
- Locked units do not change.
- Custody, deposit clearing, withdrawal clearing, and pending buckets do not
  change.

User settlement journal type:

```text
USER_STAKING_REWARD_PAID
```

Admin settlement journal type:

```text
ADMIN_STAKING_REWARD_PAID
```

Both use:

```text
reference_type = STAKING_REWARD_SETTLEMENT
```

## Zero Reward

If the formula returns zero:

- `private.staking_position_reward_settlements` stores outcome `ZERO`.
- No ledger journal is created.
- No ledger entries are created.
- User balances do not change.
- The reward command audit outcome remains `APPLIED`.
- The position reward state is final as `ZERO`.

Zero reward is a valid final settlement, not an error.

## Commands

User command:

```text
public.settle_current_user_staking_reward(
  p_staking_position_id,
  p_position_expected_version,
  p_wallet_expected_version,
  p_command_id
)
```

Admin command:

```text
public.settle_staking_reward_as_admin(
  p_staking_position_id,
  p_position_expected_version,
  p_command_id,
  p_reason
)
```

Both commands reuse the staking position advisory lock namespace:

```text
staking-wallet-web:staking-position-command:v1
```

Same-command replay returns the existing result. A new command against an
already settled position records `NOOP` audit and does not create another
settlement or journal. Reusing a command ID with different request data is a
conflict.

## Read Model

User staking positions expose:

- `reward_state`
- `calculated_reward_units`
- `reward_settled_at`
- `reward_actor_type`

The user read RPC does not expose settlement IDs, journal IDs, administrator
profile IDs, request data, or private ledger account IDs.

AAL2 administrator staking positions additionally expose reward settlement,
journal, actor, and outcome identifiers for operational review.

Reward states:

```text
NOT_ELIGIBLE
CLAIMABLE
PAID
ZERO
```

Settlement outcomes:

```text
PAID
ZERO
```

## Audit

`private.staking_reward_command_audit_events` stores immutable append-only
reward command audit rows. It records `APPLIED` and `NOOP` outcomes for:

```text
SETTLE_STAKING_REWARD
```

The AAL2-only read RPC is:

```text
public.list_staking_reward_command_audit_events(p_limit, p_before_event_id)
```

The public audit read omits request data, credentials, cookies, tokens,
balances, private ledger accounts, and raw user metadata.

## Explicitly Out Of Scope

- Partial reward payment
- Repeated reward claim
- Reward reversal
- Reward cancellation
- Daily accrual
- Compound reward
- Projected yield display
- On-chain reward settlement
- Wallet addresses
- Transaction signatures or external evidence
- Client signing
- Private keys or mnemonics
- Service-role application client
- Remote Supabase
- Mainnet or production connectivity
