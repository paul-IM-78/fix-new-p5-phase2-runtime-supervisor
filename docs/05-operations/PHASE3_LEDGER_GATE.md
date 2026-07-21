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
- Local manual withdrawal request state machine.
- Withdrawal request available-balance precheck with no request-time posting.
- AAL2 administrator withdrawal reservation posting.
- AAL2 administrator withdrawal approval posting.
- Withdrawal approval leaves custody unchanged and moves value to clearing only.
- User REQUESTED withdrawal cancellation.
- Admin REQUESTED, RESERVED, and APPROVED withdrawal cancellation.
- AAL2 administrator withdrawal execution start with digest-only evidence reference storage.
- AAL2 administrator withdrawal execution failure with no ledger posting.
- AAL2 administrator internal withdrawal settlement posting from clearing to custody.
- Admin FAILED withdrawal cancellation with clearing reversal to user available.
- Immutable withdrawal command audit.
- Immutable withdrawal execution attempts.
- User Balance Overview page.
- Atomic Unit text rendering.
- Balance bucket sum validation.
- Cross-asset aggregation absent.
- Deposit and withdrawal status integration.
- Cross-user balance read isolation.
- Inactive profile balance read blocking.
- FROZEN and CLOSED wallet read boundary.
- Phase 3 full regression script.
- Phase 3 closeout checklist.
- Generic manual journal absent.
- Text amount return values.
- Service-role application client absent.
- Remote Supabase absent.
- Mainnet absent.
- Real asset seed data absent.

## Next Task Entry Conditions

The following tasks must wait for this gate:

- Withdrawal request.
- Staking lock.
- Reward posting.
- External custody and provider integration.

## Continuing Prohibitions

- Manual operational SQL posting.
- Generic public financial write RPC.
- Arbitrary manual ledger correction.
- Opening Balance replacement after reversal.
- Real deposit settlement or automatic confirmation.
- Blockchain deposit addresses, withdrawal addresses, transaction IDs, transaction hashes, signatures, provider responses, webhooks, and scanner payloads.
- Partial withdrawal settlement, partial failure, and partial cancellation.
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
request commands and read RPCs. P3-T04 intentionally adds local manual
withdrawal request, reservation, approval, cancellation, and read RPCs. Earlier
P3-T01 wording that described all public financial write RPCs as absent now
means generic/manual public financial write RPCs remain absent.

The P3-T03 public write RPC names use `*_user_funding_request` rather than
generic `deposit`, `manual`, or `posting` names. The workflow is still
user-facing Deposit Requests, but no real settlement, deposit address,
transaction ID, chain verification, or automatic confirmation is implemented.

The P3-T04 public write RPC names use `*_user_payout_request` rather than
generic `withdraw`, `manual`, or `posting` names. The workflow is still
user-facing Withdrawal Requests, but approval is not external settlement.
There is no withdrawal address, transaction ID, chain execution, custody
decrease, partial approval, staking, reward, service-role application client,
remote Supabase, mainnet, or production path.

NEW-P3-T05 intentionally adds narrow `*_user_payout_execution` write RPCs for
AAL2 administrator execution and internal settlement. The workflow is still
local-only: start and fail post no journal, settle posts only the exact
`SYSTEM_WITHDRAWAL_CLEARING` to `SYSTEM_CUSTODY` journal, raw evidence is
reduced to a SHA-256 digest in the private schema, and no external payout,
provider, scanner, webhook, mainnet, remote Supabase, service-role application
client, or production path is added.

NEW-P3-T06 intentionally adds the `/balances` user read view and Phase 3
closeout regression script without changing migrations, database tests, or
generated database types. The view is an internal ledger liability overview
only. It shows per-asset Atomic Unit strings and local request statuses, but no
cross-asset totals, fiat valuation, APY, rewards, destination addresses,
transaction identifiers, explorer links, raw evidence, evidence digests,
custody proof, service-role application client, remote Supabase, mainnet, or
production path.
