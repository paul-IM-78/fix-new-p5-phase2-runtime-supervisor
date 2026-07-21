# Phase 4 Staking Gate

NEW-P4-T03 extends Phase 4 from immutable principal-lock positions to matured
principal unlock.

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
- Public `/staking` now accepts authenticated same-origin principal-lock
  requests and lists owned locked positions.
- Admin `/admin/staking-products` provides local product command forms.
- Admin `/admin/staking-positions` exposes matured principal unlock only.
- Product commands still produce zero ledger journals and zero ledger entries.
- No Service Role, remote Supabase, production credential, Solana package,
  wallet adapter, private key, mnemonic, client signing, mainnet RPC, or
  blockchain transfer was added.

## Required After Principal Unlock

1. Define fixed-term reward calculation and rounding.
2. Define reward expense posting and claim rules.
3. Add unstaking or early exit only if a later product decision requires it.
4. Add additional administrator operational review actions where required.
5. Add full pgTAP and local E2E regression for every new financial transition.
6. Keep all units as atomic-unit strings and all postings inside the private
   ledger primitive.

## Explicitly Out Of Scope

- Reward calculation
- APY/APR display
- Unstaking
- Early unlock
- Partial unlock
- Position cancellation
- Reward claim
- External custody proof
- Mainnet or production connectivity
- Wallet address collection
- Private key, mnemonic, or client transaction signing
