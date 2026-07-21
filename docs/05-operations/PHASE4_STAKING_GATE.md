# Phase 4 Staking Gate

Status: COMPLETE.

NEW-P4-T05 closes Phase 4 after integrating the user staking lifecycle,
administrator operations queues, lifecycle E2E, and full local closeout
regression. The database, RPC, generated type, and ledger posting boundaries
remain frozen from NEW-P4-T04.

## Gate Conditions Met

- Staking products are private DB rows exposed through RPCs.
- Product lifecycle commands require ACTIVE ADMIN plus AAL2.
- Product command audit is append-only and immutable.
- Product command idempotency uses caller-supplied command IDs.
- Activation is blocked unless the project and SOLANA SPL project token are
  active and current.
- Product terms freeze after first activation.
- Staking positions are private DB rows exposed through RPCs.
- Position creation is limited to `LOCKED`.
- The only supported position transition is `LOCKED -> UNLOCKED`.
- Maturity state is derived from PostgreSQL database time, not client or app
  server time.
- Principal is accepted and stored as exact atomic-unit text.
- Product and wallet expected versions are enforced.
- Product enrollment, current project token, minimum, maximum, wallet status,
  profile status, and available balance are validated before posting.
- Position creation posts one `USER_STAKING_POSITION_LOCKED` journal with
  `DEBIT USER_AVAILABLE` and `CREDIT USER_LOCKED`.
- Available units decrease, locked units increase, and total liability remains
  unchanged.
- Product terms, locked timestamp, and maturity timestamp are snapshotted.
- Position command replay and conflict boundaries use caller-supplied command
  IDs.
- `UNLOCKED` positions are terminal and core position snapshots remain
  immutable.
- Position rows and position command audit are protected from unsupported
  mutation.
- Users can read their own positions through a safe RPC.
- AAL2 administrators can read position and audit summaries.
- Users can unlock their own matured positions only when their wallet is
  `ACTIVE`.
- AAL2 administrators can unlock matured target positions for operational
  cleanup, including inactive target profiles or non-active target wallets
  when ledger accounts remain valid.
- Unlock posts one `USER_STAKING_POSITION_UNLOCKED` or
  `ADMIN_STAKING_POSITION_UNLOCKED` journal with `DEBIT USER_LOCKED` and
  `CREDIT USER_AVAILABLE`.
- Unlock decreases locked units, increases available units, and keeps total
  liability unchanged.
- Unlock command replay, conflict, and NOOP boundaries use caller-supplied
  command IDs.
- Reward calculation uses immutable position snapshot fields only.
- Reward calculation uses exact PostgreSQL `numeric` arithmetic and
  `FLOOR` rounding.
- Reward settlement requires `UNLOCKED` positions.
- Position reward settlement is limited to one row per position.
- Positive reward settlement posts one `USER_STAKING_REWARD_PAID` or
  `ADMIN_STAKING_REWARD_PAID` journal with `DEBIT SYSTEM_REWARD_EXPENSE` and
  `CREDIT USER_AVAILABLE`.
- Positive reward settlement increases available units and total liability
  while leaving principal and locked units unchanged.
- Zero reward settlement creates a final `ZERO` settlement without a journal
  or ledger entries.
- Reward settlement replay, conflict, NOOP, and concurrent replay boundaries
  use caller-supplied command IDs.
- Reward settlement rows and reward command audit rows are append-only and
  immutable.
- Users can settle their own rewards only while profile and wallet are active.
- AAL2 administrators can settle rewards for inactive target positions when
  existing ledger accounts remain valid.
- Users can read reward state and calculated reward units without settlement
  IDs, journal IDs, administrator IDs, request data, or private ledger account
  IDs.
- AAL2 administrators can read reward settlement and reward audit summaries.
- Public `/staking` now accepts authenticated same-origin principal-lock
  requests, matured principal unlock requests, and reward settlement requests.
- Admin `/admin/staking-products` provides local product command forms.
- Admin `/admin/staking-positions` exposes matured principal unlock and reward
  settlement commands only.
- User Lifecycle Integration is complete on `/staking`.
- Action Required, Active Lock, Completed Reward History, OPEN Product, and
  UPCOMING Product views are present.
- Admin Principal Queue and Admin Reward Queue are present on
  `/admin/staking-positions`.
- Product and Position operations cross-links are present.
- Integrated Lifecycle E2E is present as `npm run test:staking:lifecycle:local`.
- Phase 4 Regression Orchestrator is present as
  `npm run test:phase4:closeout:local`.
- Database Freeze is maintained: migration changes 0, DB test changes 0, and
  generated type changes 0 in NEW-P4-T05.
- Phase 4 Closeout is complete when the orchestrator reports
  `PHASE4_CLOSEOUT_PASS`.
- Product commands still produce zero ledger journals and zero ledger entries.
- No Service Role, remote Supabase, production credential, Solana package,
  wallet adapter, private key, mnemonic, client signing, mainnet RPC, or
  blockchain transfer was added.

## Required After Snapshot Reward Settlement

1. Add unstaking or early exit only if a later product decision requires it.
2. Define partial reward, reward reversal, or recurring accrual only in a later
   scoped phase.
3. Add additional administrator operational review actions where required.
4. Add full pgTAP and local E2E regression for every new financial transition.
5. Keep all units as atomic-unit strings and all postings inside the private
   ledger primitive.

## Explicitly Out Of Scope

- Partial reward
- Reward reversal
- Daily accrual
- Compound reward
- Projected yield display
- Unstaking
- Early unlock
- Partial unlock
- Position cancellation
- Repeated reward claim
- External custody proof
- Mainnet or production connectivity
- Wallet address collection
- Private key, mnemonic, or client transaction signing
