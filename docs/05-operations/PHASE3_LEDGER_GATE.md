# Phase 3 Ledger Gate

Phase 3 tasks that depend on balances can proceed only after the ledger core
gate remains PASS.

## Required PASS

- Exact atomic units.
- Double-entry journal balance.
- Single-asset journal.
- Immutable journal rows.
- Immutable entry rows.
- User negative balance rejection.
- Cross-asset rejection.
- Closed account rejection.
- Command replay.
- Command conflict rejection.
- Deferred database constraint validation.
- Private posting primitive only.
- Browser direct ledger table access blocked.
- Browser posting blocked.
- Read-only current-user balance RPC.
- Text amount return values.
- Service-role application client absent.
- Remote Supabase absent.
- Mainnet absent.
- Real asset seed data absent.

## Next Task Entry Conditions

The following tasks must wait for this gate:

- Deposit request schema.
- Deposit confirmation command.
- Withdrawal request.
- Withdrawal reservation.
- Staking lock.
- Reward posting.
- User balance UI.

## Continuing Prohibitions

- Manual operational SQL posting.
- Public financial write RPC.
- Browser ledger writes.
- JavaScript `Number` for posting amounts.
- Floating point or PostgreSQL `money` financial storage.
- Splitting journal and audit mutation across separate transactions.
- Journal updates.
- Entry deletes.
- Service-role application access.
- Mainnet or production connectivity.
