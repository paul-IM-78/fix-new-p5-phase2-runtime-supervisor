# NEW-P3-T03 Deposit State Machine Report

## Baseline

- Project: `D:\Ai\staking-wallet-web`
- Start branch: `feat/new-p3-opening-balance-corrections`
- Start HEAD: `60913e9bb758dc59a1cac4b5685e5aa71f5519d6`
- Work branch: `feat/new-p3-deposit-state-machine`
- Legacy repository: `D:\Ai\Staking-Wallet`
- Legacy repository access: read-only status check only

## Scope Implemented

- Added local manual deposit request schema and state machine.
- Added `private.deposit_requests`.
- Added `private.deposit_command_audit_events`.
- Added state transition and deferred journal-shape invariant triggers.
- Added local deposit command advisory lock
  `staking-wallet-web:deposit-command:v1`.
- Added user create and cancel command RPCs.
- Added AAL2 admin confirm and cancel command RPCs.
- Added user/admin deposit read RPCs and admin audit read RPC.
- Added same-origin web routes and server wrappers for user/admin deposit
  commands.
- Added `/deposits` and `/admin/deposits` pages.
- Added local pgTAP and E2E coverage.

## State Machine

Allowed statuses:

- `REQUESTED`
- `CONFIRMED`
- `CANCELED`

Allowed transitions:

- Create: new row to `REQUESTED`.
- User cancel: `REQUESTED` to `CANCELED`.
- Admin cancel: `REQUESTED` to `CANCELED`.
- Admin confirm: `REQUESTED` to `CONFIRMED`.

Terminal rows cannot be rewritten. Rows are not hard-deleted.

## Ledger Posting

Create request:

- Debit `SYSTEM_DEPOSIT_CLEARING`.
- Credit `USER_PENDING_DEPOSIT`.

Confirm request:

- Debit `SYSTEM_CUSTODY`.
- Credit `SYSTEM_DEPOSIT_CLEARING`.
- Debit `USER_PENDING_DEPOSIT`.
- Credit `USER_AVAILABLE`.

Cancel request:

- Debit `USER_PENDING_DEPOSIT`.
- Credit `SYSTEM_DEPOSIT_CLEARING`.

All postings use `private.post_ledger_journal(...)`. No direct balance column
mutation was added.

## Public RPC Boundary

Write RPCs:

- `public.create_user_funding_request(...)`
- `public.cancel_current_user_funding_request(...)`
- `public.confirm_user_funding_request(...)`
- `public.admin_cancel_user_funding_request(...)`

Read RPCs:

- `public.list_current_user_deposit_requests(...)`
- `public.list_admin_deposit_requests(...)`
- `public.list_deposit_command_audit_events(...)`

All RPCs are authenticated-only `SECURITY DEFINER` functions with empty
`search_path`.

The write RPC names intentionally avoid generic public financial names such as
`deposit`, `manual`, and `posting` to preserve the existing Phase 3 ledger
gate. User-facing routes and pages still describe the workflow as Deposit
Requests.

## Security Notes

- Database remains the final authorization boundary.
- User create/cancel requires ACTIVE profile and caller-owned wallet.
- Admin confirm/cancel requires ACTIVE ADMIN plus current AAL2 in PostgreSQL.
- Admin cancel can reverse pending buckets for inactive targets.
- Browser roles cannot directly read or write private deposit tables.
- Same-origin checks protect POST routes.
- Redirects expose only safe public result/error codes.
- Pages do not expose request data, full UUIDs, private ledger account IDs,
  cookies, tokens, MFA material, or environment values.
- No service-role application client was added.
- No Supabase remote project was connected.
- No mainnet or production path was connected.
- No private key, mnemonic, wallet adapter, client signing, blockchain
  address, transaction ID, signature, webhook, or RPC verification path was
  added.

## Files Changed

- `README.md`
- `docs/05-operations/PHASE3_LEDGER_GATE.md`
- `docs/06-ledger/DEPOSIT_REQUEST_STATE_MACHINE.md`
- `docs/09-governance/NEW_P3_T03_DEPOSIT_STATE_MACHINE_REPORT.md`
- `package.json`
- `scripts/ledger/deposit-state-machine.local.mjs`
- `src/app/account/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/deposits/page.tsx`
- `src/app/api/v1/admin/deposits/cancel/route.ts`
- `src/app/api/v1/admin/deposits/confirm/route.ts`
- `src/app/api/v1/deposits/cancel/route.ts`
- `src/app/api/v1/deposits/create/route.ts`
- `src/app/dashboard/page.tsx`
- `src/app/deposits/page.tsx`
- `src/lib/auth/validation.ts`
- `src/lib/deposit/public-results.ts`
- `src/lib/deposit/validation.ts`
- `src/server/admin/deposit-commands.ts`
- `src/server/deposit/current-deposits.ts`
- `src/server/deposit/deposit-commands.ts`
- `src/types/database.types.ts`
- `supabase/migrations/20260720152145_init_deposit_state_machine.sql`
- `supabase/tests/database/deposit_state_machine.test.sql`

## Explicitly Unchanged

- No existing migration file was modified.
- No existing database test file was modified.
- No existing E2E script was modified.
- No package lock file change was made.
- No service-role client was added.
- No remote Supabase, production, or mainnet connection was used.
- No staging, commit, push, or pull request was performed.

## Validation

- Baseline `npm run supabase:start`: PASS
- Baseline `npm run db:reset:local`: PASS
- Baseline `npm run db:lint:local`: PASS
- Baseline `npm run db:test:local`: PASS, 8 files, 549 tests
- Baseline `npm run db:types:local`: PASS
- Baseline `npm run lint`: PASS
- Baseline `npm run build`: PASS
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS
- `npm run db:test:local`: PASS, 9 files, 594 tests
- `npm run db:types:local`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- `npm run test:auth:admin-roles:local`: PASS
- `npm run test:domain:admin-lifecycle:local`: PASS
- `npm run test:domain:wallet-status:local`: PASS
- `npm run test:phase2:closeout:local`: PASS
- `npm run test:ledger:core:local`: PASS
- `npm run test:ledger:opening-corrections:local`: PASS
- `npm run test:ledger:deposits:local`: PASS
- Production smoke: PASS
  - `GET /api/v1/health`: HTTP 200
  - `GET /api/v1/readiness/config`: HTTP 200
  - `GET /`: HTTP 200
  - Anonymous `/dashboard`, `/account`, `/deposits`, `/admin`, and
    `/admin/deposits`: redirected to `/auth/sign-in`
- Final `npm run db:reset:local`: PASS
- Final `npm run db:lint:local`: PASS, error 0
- Final `npm run db:test:local`: PASS, 9 files, 594 tests
- Final `npm run db:types:local`: PASS
- Final QA data counts after reset: 0 rows in Auth users, MFA factors,
  profiles, roles, projects, assets, assignments, wallet accounts, ledger
  accounts, journals, entries, financial/admin/domain/wallet audit tables,
  deposit requests, and deposit command audit events.

## Local Runtime Notes

- Existing historical E2E scripts are fixed to `http://localhost:3000`.
- The deposit E2E can run against an explicit `APP_ORIGIN`.
- Without `APP_ORIGIN`, the deposit E2E starts a temporary local production
  server on `http://localhost:3010` and stops it after the smoke.
- Local Supabase Auth required a local stack restart after many repeated
  signup-heavy E2E runs; no remote service was used.
- `.env.local` exists locally and is ignored by Git; values were not copied.
- Final local Supabase stack shutdown: PASS.
- Final Next.js smoke process shutdown: PASS.
- Current project container residue: 0 running containers.
- Current project port residue: no listeners on 3000, 3010, or 55721-55724.

## Secret And Sensitive Data Check

- Reported emails: `[REDACTED]`
- Reported passwords: `[REDACTED]`
- Reported TOTP material: `[REDACTED]`
- Reported UUIDs and command IDs from test runs: `[REDACTED]`
- Reported units from test runs: `[REDACTED]`
- JWT, cookies, Supabase keys, and local database URLs: `[REDACTED]`
- No service-role value was added to tracked application code.
- No `.env` or `.env.local` file is tracked.
- The private-key block marker exists only inside the local E2E secret-scan
  denylist, not as key material.
- Documentation-only references to service-role, private key, mnemonic,
  mainnet, blockchain address, deposit address, transaction ID, and signature
  are prohibition and boundary notes only.
- Tracked actual secret values, wallet credentials, blockchain identifiers,
  and production/mainnet credentials: 0.

## Residual Risks

- Deposit Requests are local manual operations only.
- There is no deposit address allocation, transaction ID verification,
  webhook, chain indexer, automatic confirmation, or settlement.
- Admin confirmation is a local internal command and must not be interpreted
  as proof of real asset receipt.
- Withdrawal, staking, rewards, and production operations remain unimplemented.

## Final Task Status

`PASS`

Reason: implementation, DB migration validation, generated type refresh,
existing regression suites, deposit E2E, production smoke, final DB cleanup,
secret scan, and local process shutdown passed. No staging, commit, push, or
pull request was performed.
