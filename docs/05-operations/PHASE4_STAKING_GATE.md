# Phase 4 Staking Gate

NEW-P4-T02 extends Phase 4 from staking product metadata to immutable
principal-lock positions.

## Gate Conditions Met

- Staking products are private DB rows exposed through RPCs.
- Product lifecycle commands require ACTIVE ADMIN plus AAL2.
- Product command audit is append-only and immutable.
- Product command idempotency uses caller-supplied command IDs.
- Activation is blocked unless the project and SOLANA SPL project token are
  active and current.
- Product terms freeze after first activation.
- Staking positions are private DB rows exposed through RPCs.
- Position status is limited to `LOCKED`.
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
- Position rows and position command audit are immutable in this phase.
- Users can read their own positions through a safe RPC.
- AAL2 administrators can read position and audit summaries.
- Public `/staking` now accepts authenticated same-origin principal-lock
  requests and lists owned locked positions.
- Admin `/admin/staking-products` provides local product command forms.
- Admin `/admin/staking-positions` is read-only.
- Product commands still produce zero ledger journals and zero ledger entries.
- No Service Role, remote Supabase, production credential, Solana package,
  wallet adapter, private key, mnemonic, client signing, mainnet RPC, or
  blockchain transfer was added.

## Required After Principal Lock

1. Define maturity processing.
2. Define principal unlock posting from `USER_LOCKED` to `USER_AVAILABLE`.
3. Define fixed-term reward calculation and rounding.
4. Define reward expense posting and claim rules.
5. Add early exit or cancellation only if a later product decision requires it.
6. Add administrator operational review actions where required.
7. Add full pgTAP and local E2E regression for every new financial transition.
8. Keep all units as atomic-unit strings and all postings inside the private
   ledger primitive.

## Explicitly Out Of Scope

- Reward calculation
- APY/APR display
- Unstaking
- Principal unlock
- Position cancellation
- Maturity command
- Reward claim
- External custody proof
- Mainnet or production connectivity
- Wallet address collection
- Private key, mnemonic, or client transaction signing
