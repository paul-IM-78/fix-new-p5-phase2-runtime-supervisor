# Phase 3 Closeout Checklist

Phase 3 is complete only when the database, application, E2E scripts, and
security boundaries all pass together on the local stack.

## Ledger Core

- Exact Atomic Unit strings are enforced.
- Double-entry journals balance per journal.
- Journals and entries are immutable.
- Deferred invariants remain valid.
- User negative balances are blocked.
- Command replay and conflict behavior remains deterministic.
- Generic public posting remains absent.

## Opening Balance

- AAL2 administrator Opening Balance command exists.
- Opening Balance is one-time per wallet and asset with no prior activity.
- Exact reversal is derived from the original immutable journal.
- Arbitrary manual corrections remain absent.
- Financial administrator audit is append-only.

## Deposits

- `REQUESTED`, `CONFIRMED`, and `CANCELED` states pass.
- Pending Deposit bucket postings are correct.
- Administrator confirmation moves pending deposit to available.
- User and administrator cancellation paths are covered.
- Deposit audit is append-only.
- Destination addresses and automatic chain confirmation are not implemented.

## Withdrawals

- `REQUESTED`, `RESERVED`, `APPROVED`, `EXECUTING`, `FAILED`, `SETTLED`, and
  `CANCELED` states pass.
- Available reservation and Pending Withdrawal postings are correct.
- Approval moves value to withdrawal clearing.
- Internal settlement moves withdrawal clearing to custody.
- Failure records no ledger posting.
- FAILED cancellation reverses clearing to user available.
- Withdrawal audit and execution attempt history are append-only.
- Partial settlement, destination addresses, and provider automation are not
  implemented.

## User Reads

- `/balances` exists and is server-rendered.
- Asset buckets are displayed as strings.
- Bucket sum validation is enforced.
- Cross-asset aggregation is absent.
- Deposit and withdrawal statuses are integrated.
- Cross-user balance isolation is covered.
- Inactive profiles are blocked.
- FROZEN and CLOSED wallets remain readable.

## Security

- Application service-role client is absent.
- Remote Supabase and mainnet connections are absent.
- Destination addresses are absent from user balance UI.
- Transaction identifiers are absent from user balance UI.
- Raw evidence is absent from user balance UI.
- Private key, mnemonic, and client signing paths are absent.
- Same-origin checks remain enforced on mutation routes.
- AAL2 administrator mutations remain database-authorized.
- Financial, deposit, withdrawal, and execution audit rows are append-only.

## Regression Command

Run the full local Phase 3 closeout after local Supabase is running, the
database is reset, and a production Next.js server is listening on
`http://localhost:3000`:

```bash
npm run test:phase3:closeout:local
```

The script runs:

- `test:phase2:closeout:local`
- `test:ledger:core:local`
- `test:ledger:opening-corrections:local`
- `test:ledger:deposits:local`
- `test:ledger:withdrawals:local`
- `test:ledger:withdrawal-execution:local`
- `test:ledger:balance-overview:local`

It resets the local database between scripts and checks bounded readiness for
the app, local Supabase API, REST, Mailpit, database, and the current project
Kong container.

## Residual

The following remain outside Phase 3:

- Real blockchain provider integration
- Real destination addresses
- Real transaction verification
- Mainnet settlement
- Automatic deposit detection
- Withdrawal fee handling
- Partial deposit or partial withdrawal workflows
- Staking positions
- Reward accounting
- Fiat prices
- Custody proof
- Production operating procedures
