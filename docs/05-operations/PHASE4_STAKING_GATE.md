# Phase 4 Staking Gate

NEW-P4-T01 opens Phase 4 with staking product metadata only.

## Gate Conditions Met

- Staking products are private DB rows exposed through RPCs.
- Product lifecycle commands require ACTIVE ADMIN plus AAL2.
- Product command audit is append-only and immutable.
- Product command idempotency uses caller-supplied command IDs.
- Activation is blocked unless the project and SOLANA SPL project token are
  active and current.
- Product terms freeze after first activation.
- Public `/staking` is read-only and does not accept staking requests.
- Admin `/admin/staking-products` provides local product command forms.
- Product commands produce zero ledger journals and zero ledger entries.
- No Service Role, remote Supabase, production credential, Solana package,
  wallet adapter, private key, mnemonic, client signing, mainnet RPC, or
  blockchain transfer was added.

## Required Before Staking Requests

1. Define staking position schema and request state machine.
2. Define principal lock posting from `USER_AVAILABLE` to `USER_LOCKED`.
3. Add idempotent user staking request commands.
4. Add administrator approval or operational review where required.
5. Define reward accrual or fixed-term reward posting rules.
6. Add unstaking and reward claim state machines.
7. Add full pgTAP and local E2E regression for every financial transition.
8. Keep all units as atomic-unit strings and all postings inside the private
   ledger primitive.

## Explicitly Out Of Scope

- Staking request creation
- Balance mutation
- Position creation
- Reward calculation
- APY/APR display
- Principal locking
- Unstaking
- Reward claim
- External custody proof
- Mainnet or production connectivity
- Wallet address collection
- Private key, mnemonic, or client transaction signing
