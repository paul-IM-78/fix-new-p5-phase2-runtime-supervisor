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
- AAL2 Opening Balance command.
- Opening Balance one-time limit.
- Opening blocked when the target wallet and asset already have ledger entries.
- Exact Opening reversal.
- Reversal one-time limit.
- Immutable financial administrator audit.
- AAL2 admin ledger summary read RPCs.
- Local manual deposit request state machine.
- Deposit create, confirm, and cancel postings through the private Posting Primitive.
- Immutable deposit command audit.
- Generic manual journal absent.
- Text amount return values.
- Service-role application client absent.
- Remote Supabase absent.
- Mainnet absent.
- Real asset seed data absent.

## Next Task Entry Conditions

The following tasks must wait for this gate:

- Withdrawal request.
- Withdrawal reservation.
- Staking lock.
- Reward posting.
- User balance UI.

## Continuing Prohibitions

- Manual operational SQL posting.
- Generic public financial write RPC.
- Arbitrary manual ledger correction.
- Opening Balance replacement after reversal.
- Real deposit settlement or automatic confirmation.
- Blockchain deposit addresses or transaction IDs.
- Browser ledger writes.
- JavaScript `Number` for posting amounts.
- Floating point or PostgreSQL `money` financial storage.
- Splitting journal and audit mutation across separate transactions.
- Journal updates.
- Entry deletes.
- Service-role application access.
- Mainnet or production connectivity.

## Current Residual

P3-T02 intentionally adds a narrow AAL2 administrator Opening Balance command
and admin ledger read RPCs. P3-T03 intentionally adds local manual deposit
request commands and read RPCs. Earlier P3-T01 wording that described all
public financial write RPCs as absent now means generic/manual public
financial write RPCs remain absent.

The P3-T03 public write RPC names use `*_user_funding_request` rather than
generic `deposit`, `manual`, or `posting` names. The workflow is still
user-facing Deposit Requests, but no real settlement, deposit address,
transaction ID, chain verification, automatic confirmation, withdrawal,
staking, reward, service-role application client, remote Supabase, mainnet, or
production path is implemented.
