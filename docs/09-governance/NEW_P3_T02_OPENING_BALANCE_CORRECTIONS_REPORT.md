# NEW-P3-T02 Opening Balance Corrections Report

## Baseline

- Project: `D:\Ai\staking-wallet-web`
- Branch: `feat/new-p3-opening-balance-corrections`
- Start HEAD: `4f0d06d9f54615fae2ef0c28cc4a72a9483cb8a7`
- Legacy repository: `D:\Ai\Staking-Wallet`
- Legacy repository access: read-only status check only

## Scope Implemented

- Added a forward-only Opening Balance and exact reversal migration.
- Added `private.financial_admin_audit_events` as append-only financial admin audit.
- Added AAL2-only public command RPCs:
  - `public.post_opening_balance(...)`
  - `public.reverse_opening_balance(...)`
- Added AAL2-only admin read RPCs:
  - `public.list_admin_wallet_asset_ledger_balances(...)`
  - `public.list_admin_ledger_journals(...)`
  - `public.list_financial_admin_audit_events(...)`
- Added server wrappers, input validation, safe public result codes, admin page, and same-origin POST routes.
- Added local P3-T02 pgTAP and E2E coverage.

## Ledger And Audit Boundary

- Opening Balance is one-time per wallet and asset.
- Opening requires ACTIVE wallet, ACTIVE profile, ACTIVE supported asset, expected versions, valid atomic units text, and no previous ledger entries for the wallet and asset.
- Opening posts only through the private Posting Primitive:
  - debit `SYSTEM_CUSTODY`
  - credit `USER_AVAILABLE`
- Reversal derives all account IDs, sides, and units from the immutable original Opening journal.
- Reversal posts only the exact opposite journal.
- Already reversed Opening journals return a NOOP audit event without posting a new journal.
- Generic manual journals, arbitrary correction entries, deposits, withdrawals, staking, rewards, replacement Opening, and user balance UI remain out of scope.

## Security Notes

- Database remains the final authorization boundary.
- Command RPCs require ACTIVE ADMIN plus current AAL2 inside PostgreSQL.
- No service-role client was added.
- No direct browser table writes were added.
- Atomic units remain text at application boundaries.
- JavaScript `Number` is not used for posting units.
- Redirects expose only safe result or error codes, not UUIDs, command IDs, units, reasons, cookies, or tokens.
- Admin ledger page does not expose request data, entry-line dumps, auth metadata, email, private ledger account IDs, cookies, tokens, MFA material, service-role credentials, or production credentials.

## Existing Ledger Core Remediation

The new migration re-declares `private.validate_ledger_journal_invariants()` as `SECURITY DEFINER`.

Reason: authenticated PostgREST RPC commits were blocked by the existing deferred invariant trigger because the trigger function referenced private ledger tables using the trigger executor privileges. The existing migration file was not edited. The remediation is forward-only in the new migration and keeps direct private ledger table access revoked from browser roles.

## Files Changed

- `README.md`
- `docs/05-operations/PHASE3_LEDGER_GATE.md`
- `docs/06-ledger/OPENING_BALANCE_AND_CORRECTIONS.md`
- `docs/09-governance/NEW_P3_T02_OPENING_BALANCE_CORRECTIONS_REPORT.md`
- `package.json`
- `scripts/ledger/opening-balance-corrections.local.mjs`
- `src/app/admin/page.tsx`
- `src/app/admin/ledger/page.tsx`
- `src/app/api/v1/admin/ledger/opening-balance/route.ts`
- `src/app/api/v1/admin/ledger/reverse-opening/route.ts`
- `src/lib/ledger/public-results.ts`
- `src/lib/ledger/validation.ts`
- `src/server/admin/financial-commands.ts`
- `src/types/database.types.ts`
- `scripts/phase/phase2-closeout.local.mjs`
- `supabase/migrations/20260720130743_init_opening_balance_corrections.sql`
- `supabase/tests/database/double_entry_ledger_core.test.sql`
- `supabase/tests/database/opening_balance_corrections.test.sql`

## Explicitly Unchanged

- No existing migration files were modified.
- No existing database test files were modified except the R1 correction to `double_entry_ledger_core.test.sql` test 75.
- No existing E2E scripts were modified except the R1 readiness hardening in `scripts/phase/phase2-closeout.local.mjs`.
- No package lock file change was made.
- No auth guard source was modified.
- No Supabase service-role client was added.
- No remote Supabase, production, or mainnet connection was used.
- No staging, commit, push, or pull request was performed.

## R1 Remediation

- `double_entry_ledger_core.test.sql` test 75 now verifies the current security contract instead of the old broad name-based expectation.
- The corrected assertion confirms:
  - generic/manual public financial write RPC names remain absent,
  - AAL2 Opening Balance and exact reversal are treated as the allowed narrow Phase 3 command boundary,
  - read RPCs with `list_` names are not misclassified as write RPCs,
  - `private.validate_ledger_journal_invariants()` is `SECURITY DEFINER`,
  - the invariant trigger function keeps `search_path = ''`,
  - public, anon, and authenticated roles cannot execute the private invariant trigger function directly.
- `scripts/phase/phase2-closeout.local.mjs` now waits for bounded local Supabase readiness after each reset before launching the next child E2E.
- The closeout runner checks the app health route, config readiness route, local Auth endpoint, local REST endpoint, Mailpit, database readiness, and current-project Kong container scope.
- Normal ready state does not restart Kong.
- Only stale upstream/readiness failure triggers a bounded restart of the current project Kong container.
- Kong scope is verified with project labels and the generated current-project Kong container name. No other Supabase project container is restarted.

## Validation

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS
- `npx supabase test db --local supabase/tests/database/double_entry_ledger_core.test.sql`: PASS, 76 tests
- `npm run db:test:local`: PASS, 8 files, 549 tests
- `npm run db:types:local`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run test:ledger:opening-corrections:local`: PASS
- `npm run test:phase2:closeout:local`: PASS
  - Auth Route E2E: PASS
  - ADMIN MFA E2E: PASS
  - ADMIN Role Command E2E: PASS
  - Domain Lifecycle E2E: PASS
  - Wallet Status E2E: PASS
  - Dashboard E2E: PASS
  - Normal run Kong restart count: 0
- `npm run test:ledger:core:local`: PASS
- Production smoke: PASS
  - `/api/v1/health`: 200
  - `/api/v1/readiness/config`: 200
  - `/`: 200
  - `/dashboard`, `/account`, `/catalog`, `/wallet`, `/admin`, `/admin/ledger`: protected redirects
- Final QA data counts: 0 for auth users, profiles, roles, MFA factors, projects, assets, assignments, wallets, ledger accounts, journals, entries, admin role audit, domain audit, wallet audit, and financial audit.

## Local Runtime Notes

- P3-T02 E2E can run against an explicit `APP_ORIGIN`.
- Without `APP_ORIGIN`, the script starts a temporary local production server on port `3010` and stops it after the smoke.
- Existing historical E2E scripts are fixed to `http://localhost:3000`.
- Temporary Next.js processes were stopped after validation.
- Local Supabase stack was stopped after validation and target local ports were released.
- `.env.local` exists locally and is ignored by Git; values were not printed or copied.

## Secret And Sensitive Data Check

- Reported emails: `[REDACTED]`
- Reported passwords: `[REDACTED]`
- Reported TOTP material: `[REDACTED]`
- Reported UUIDs and command IDs from test runs: `[REDACTED]`
- Reported units from test runs: `[REDACTED]`
- JWT, cookies, Supabase keys, and local database URLs: `[REDACTED]`
- No service-role value was added to tracked application code.
- No `.env` or `.env.local` file is tracked.

## Residual Risks

- P3-T02 does not seed real assets or implement deposit, withdrawal, staking, reward, generic corrections, or balance UI.
- The local-only closeout runner contains a bounded stale-upstream recovery path for the current project Kong container, but the validated normal run did not need it.

## Final Task Status

`PASS`

Reason: NEW-P3-T02 implementation remains intact, the stale pgTAP assertion was minimally corrected, Phase 2 closeout readiness was hardened, all DB tests and E2E checks passed, and no staging, commit, push, PR, service-role, remote Supabase, mainnet, package, or lockfile change was performed.
