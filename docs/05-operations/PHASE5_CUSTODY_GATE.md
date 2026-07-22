# Phase 5 Custody Gate

## Status

`NEW-P5-T01`: in progress, custody configuration boundary implemented locally.

This gate is not a production custody launch gate. It verifies only local
configuration-domain boundaries and read-only observation contract scaffolding.

## Required Local Checks

Run:

```bash
npm run db:reset:local
npm run db:lint:local
npm run db:test:local
npm run db:types:local
npm run lint
npm run build
npm run test:phase4:closeout:local
npm run test:custody:boundary:local
```

Expected:

- DB reset PASS
- DB lint error 0, warning 0
- pgTAP PASS
- DB test files at least 16 after NEW-P5-T01
- DB test skip 0
- Generated types from local schema
- Next.js lint PASS
- Next.js build PASS
- Phase 4 baseline DB test files still present
- Phase 4 additive-safe closeout PASS
- Custody boundary E2E PASS
- QA residue 0
- Process cleanup PASS
- Secret scan PASS

## Custody Configuration Gate

The gate requires:

- Private provider registry table
- Private account binding table
- Private immutable custody audit table
- Provider and binding lifecycle triggers
- Provider and binding freeze after first approval
- Provider capability requirement before approval
- Binding approval requirement for approved provider and ACTIVE SOLANA asset
- Duplicate non-retired provider, asset, role binding blocked
- AAL2 ADMIN command RPCs
- AAL2 ADMIN read RPCs
- `SECURITY DEFINER` RPCs with empty search path
- Authenticated execute only
- No direct browser private table access
- No explicit service-role grants
- Same-origin admin POST routes

## Additive-Safe Phase 4 Regression

Phase 4 historical baseline remains:

- 15 DB test files
- 848 DB tests

The closeout script now verifies:

- All 15 Phase 4 baseline DB test files still exist
- Observed file count is at least 15
- Observed test count is at least 848
- Entire pgTAP suite PASS
- Skip count 0

This avoids false failure when Phase 5 adds DB tests while still catching
Phase 4 test deletion, skipped tests, and failures.

## Still Prohibited

Do not enable:

- Remote Supabase link
- Production migration
- Mainnet RPC
- Provider SDK
- Blockchain SDK
- Provider API call
- Blockchain RPC call
- Webhook ingestion
- Worker, cron, queue, or scheduler
- Payout submission
- Deposit address allocation
- External provider account ID storage
- Transaction hash or signature storage
- Service-role application client
- Ledger posting from custody configuration commands
- User balance mutation from custody configuration commands

## Next Gate

Future Phase 5 tasks must define observation ingestion, evidence storage,
provider adapter implementation, reconciliation, or operational posting as
separate gates. None of those responsibilities are approved by NEW-P5-T01.
