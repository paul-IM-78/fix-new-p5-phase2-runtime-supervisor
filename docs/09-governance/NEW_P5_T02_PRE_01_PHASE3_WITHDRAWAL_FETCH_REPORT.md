# NEW-P5-T02-PRE-01 Phase 3 Withdrawal Fetch Regression Report

## Scope

- Repository: `D:\Ai\staking-wallet-web`
- Branch: `feat/new-p5-external-observation-reconciliation`
- Baseline HEAD: `9e518fce6b3e42f118adaae18ee3ae90607e8c3c`
- P5-T02 implementation: not started
- Legacy repository: read-only status check only
- Staging, commit, push, PR: not performed

## Baseline Regression

- Failing top-level command: `npm run test:phase4:closeout:local`
- Failing path: Phase 4 Closeout -> Phase 3 Closeout -> Withdrawal State Machine
- Phase 3 command: `npm run test:phase3:closeout:local`
- Phase 3 script: `scripts/phase/phase3-closeout.local.mjs`
- Withdrawal command: `npm run test:ledger:withdrawals:local`
- Withdrawal script: `scripts/ledger/withdrawal-state-machine.local.mjs`
- Initial observed error: `fetch failed`
- Initial failure stage: after the withdrawal suite had reached the MFA-ready portion of the flow
- Initial fetch cause code: not preserved by the previous script, so the original OS-level cause code was not recoverable

The first diagnostic pass showed that the regression was not a deterministic application failure. It was tied to nested orchestration around Phase 4 invoking Phase 3 while the child withdrawal suite reused inherited runtime settings.

## Runtime Topology

- Phase 4 shared app origin: `http://localhost:3000`
- Phase 4 app server command: `node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1`
- Withdrawal self-managed app origin: `http://localhost:3010`
- Withdrawal self-managed app server command: `node node_modules/next/dist/bin/next start -p 3010 -H 127.0.0.1`
- Health endpoint: `/api/v1/health`
- Config readiness endpoint: `/api/v1/readiness/config`
- Local Supabase API origin: `http://127.0.0.1:55721`
- Mailpit origin: `http://127.0.0.1:55724`

Phase 3 previously passed `APP_ORIGIN=http://localhost:3000` and `NEXT_PUBLIC_SITE_URL=http://localhost:3000` to every child script. That made ledger suites skip their own self-managed Next runtime and reuse the Phase 4 shared server. The Phase 2 closeout still needs the shared app origin, but the Phase 3 ledger suites do not.

## Root Cause Classification

Primary classification: `NESTED_ORCHESTRATOR_CLEANUP_RACE`

Secondary contributing factor: `APP_NOT_READY` style precondition race in the Phase 3 closeout precondition check.

Production defect found: no

The withdrawal scenario passed repeatedly once the ledger child suites stopped inheriting the shared Phase 4 app origin. No withdrawal database object, API route, auth guard, cookie jar, Same-Origin assertion, or financial assertion required relaxation.

## Remediation

Changed files:

- `scripts/phase/phase3-closeout.local.mjs`
- `scripts/ledger/withdrawal-state-machine.local.mjs`
- `docs/09-governance/NEW_P5_T02_PRE_01_PHASE3_WITHDRAWAL_FETCH_REPORT.md`

Phase 3 closeout changes:

- Added an explicit per-suite `useSharedAppOrigin` flag.
- Kept shared `APP_ORIGIN` only for `test:phase2:closeout:local`.
- Removed inherited `APP_ORIGIN` and `NEXT_PUBLIC_SITE_URL` from Phase 3 ledger child suites.
- Replaced one-shot precondition fetches with bounded local Supabase, app, Mailpit, and database readiness.
- Added an initial local database reset after Phase 3 preconditions so nested Phase 4 retry execution is repeatable.

Withdrawal suite changes:

- Added safe `FETCH_FAILED` diagnostics around app fetches.
- Preserved `error.name`, `error.message`, and `error.cause` fields including code, errno, syscall, address, and port.
- Included app process state, app health, app readiness, Mailpit, database readiness, and port listener state.
- Added a bounded wait for the self-managed Next port to be released during cleanup.
- Kept request bodies, cookies, headers, tokens, user identifiers, command identifiers, wallet addresses, and financial units out of diagnostics.

Assertion relaxation: 0
Scenario changes: 0
Test skips: 0
Same-Origin relaxation: 0
Production source changes: 0
Database changes: 0
Package changes: 0

## Validation

- `node --check scripts/phase/phase3-closeout.local.mjs`: PASS
- `node --check scripts/ledger/withdrawal-state-machine.local.mjs`: PASS
- `npm run test:ledger:withdrawals:local`: 3/3 PASS
- `npm run test:phase3:closeout:local`: 2/2 PASS
- `npm run test:phase4:closeout:local`: PASS
- `PHASE4_DB_BASELINE_PASS`: PASS
- `DB_OBSERVED_FILES=16`: PASS
- `DB_OBSERVED_TESTS=893`: PASS
- `PHASE4_CLOSEOUT_PASS`: PASS
- `npm run test:custody:boundary:local`: PASS
- `CUSTODY_BOUNDARY_PASS`: PASS
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, lint results 0
- `npm run db:test:local`: PASS, 16 files / 893 tests
- `npm run db:types:local`: PASS, generated type diff 0
- `npm audit --omit=dev --json`: moderate 0 / high 0 / critical 0
- `npm audit --include=dev --json`: moderate 0 / high 0 / critical 0
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS
- Production smoke: PASS

Production smoke covered:

- `GET /api/v1/health`: 200
- `GET /api/v1/readiness/config`: 200
- `GET /`: 200
- `GET /auth/sign-in`: 200
- `GET /account`: redirect to sign-in
- `GET /withdrawals`: redirect to sign-in
- `GET /admin`: redirect to sign-in
- `GET /admin/custody`: redirect to sign-in

## Cleanup

- QA auth users: 0
- QA profiles: 0
- QA wallet accounts: 0
- QA withdrawal requests and audit rows: 0
- QA ledger journals and entries: 0
- QA custody rows in currently implemented custody tables: 0
- Current project Supabase containers after stop: 0
- Current project listeners on 3000, 3010, 55721, 55722, 55723, 55724: 0
- Other local project containers: not modified
- Temporary log files: 0
- Cookie dumps: 0
- Credential files: 0

During remediation, one immediate post-run probe observed a transient port listener before the bounded port-release wait was added. After the cleanup wait was added, the withdrawal suite and final process checks completed with current-project listener count 0.

## Security

- Actual email values: not copied
- Passwords: not copied
- Cookie values: not copied
- Access tokens: not copied
- Refresh tokens: not copied
- JWTs: not copied
- TOTP secrets: not copied
- Supabase keys: not copied
- Service-role keys: not present
- Database URLs: not copied
- Private keys or mnemonic values: not present
- Command identifiers, UUIDs, wallet addresses, transaction identifiers, and atomic unit values: not copied
- Production or mainnet network calls: 0

## Final Decision

Final status: PASS

P5-T02 can proceed from the same branch after reviewing this PRE-01 change set. The P5-T02 implementation itself has not been started.
