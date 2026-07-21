# Staking User And Operations Overview

Phase 4 defines the managed staking lifecycle from product enrollment through
one-time reward settlement. The implementation remains an internal managed web
and database flow. It does not perform on-chain staking or expose wallet
custody material.

## Lifecycle

1. ACTIVE staking products are exposed to users as OPEN or UPCOMING enrollment.
2. A user creates a position by submitting principal atomic units for one asset.
3. Principal lock posts `DEBIT USER_AVAILABLE` and `CREDIT USER_LOCKED`.
4. Product terms are snapshotted onto the position.
5. Maturity is derived inside PostgreSQL from database time.
6. Matured principal unlock posts `DEBIT USER_LOCKED` and
   `CREDIT USER_AVAILABLE`.
7. Reward settlement calculates from immutable position snapshots.
8. Positive reward posts `DEBIT SYSTEM_REWARD_EXPENSE` and
   `CREDIT USER_AVAILABLE`.
9. Zero reward records a final `ZERO` settlement without a journal or entries.

## User Surface

`/staking` uses existing current-user read RPCs only. It shows:

- User lifecycle summary counts
- Action Required positions
- Active Locks
- OPEN and UPCOMING products
- Completed PAID and ZERO reward history
- Asset-level Available, Locked, Pending Deposit, Pending Withdrawal, and Total
  Liability atomic-unit strings

Action Required includes:

- `LOCKED` positions with `MATURED` maturity state
- `UNLOCKED` positions with `CLAIMABLE` reward state

Rows are not duplicated between Action Required, Active Locks, and Completed.
The UI does not trust browser time for maturity and does not calculate rewards.

## Product Enrollment

OPEN products show a principal lock form only when:

- Enrollment state is `OPEN`
- The managed wallet is `ACTIVE`
- The matching asset has positive Available atomic units

UPCOMING products show terms and enrollment start time without a form. PPM is
displayed as a fixed full-term snapshot condition, not APY or APR.

## Operations Surface

`/admin/staking-products` is the AAL2 product lifecycle area. It manages draft
creation, draft update, status transition, and immutable product audit. Product
state controls new enrollment only.

`/admin/staking-positions` is the AAL2 existing-position obligations area. It
shows:

- Operations summary counts
- Principal Unlock Queue
- Reward Settlement Queue
- Active Locks
- Completed positions
- Position command audit
- Reward command audit

Inactive target cleanup is intentionally supported for administrators when the
database command accepts the target state. Product SUSPENDED or ARCHIVED does
not remove existing principal or reward obligations.

## Boundaries

- Exact atomic-unit strings are preserved per asset.
- Asset values are not summed across assets.
- Client clocks are not used for financial eligibility.
- Application code does not calculate staking rewards.
- Generic public ledger writes remain prohibited.
- AAL2 is required for administrator financial commands.
- Same-origin POST boundaries remain in place.
- Browser private table writes are not used.

## Out Of Scope

- APY or APR display
- Early exit
- Partial unlock
- Position cancellation
- Partial reward
- Reward reversal
- Daily accrual
- Compound reward
- Tax or withholding
- Validator selection
- Delegation
- On-chain staking
- Remote Supabase
- Mainnet
- Production custody integration
