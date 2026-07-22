# NEW-P5-T01 Custody Boundary Domain Report

## Baseline

- Start branch: `feat/new-p4-staking-phase4-closeout`
- Start commit: `75995a9ca6647abacd97609df7a50a05f39fa098`
- Work branch: `feat/new-p5-custody-boundary-domain`
- Legacy repository: `D:\Ai\Staking-Wallet`, read-only status check only
- Legacy repository changes: 0

## Initial Blocked Cause

The first attempt was blocked before implementation because
`scripts/phase/phase4-closeout.local.mjs` verified the complete pgTAP output
with an exact string:

```text
Files=15, Tests=848
```

NEW-P5-T01 requires a new custody DB test file. That increases the total file
count to at least 16 even when Phase 4 functionality still passes. Updating
the expected count to exactly 16 would only move the same problem to the next
phase and would not protect the original Phase 4 test set from deletion.

## R1 Resolution

Approved direction: additive-safe baseline regression.

The Phase 4 historical baseline remains:

- Baseline files: 15
- Baseline tests: 848

The closeout script now verifies:

- The exact 15 Phase 4 baseline DB test files still exist
- Each baseline path is a regular `.test.sql` file
- Duplicate baseline paths are rejected
- Observed pgTAP files are at least 15
- Observed pgTAP tests are at least 848
- Entire pgTAP result is PASS
- Skip count is 0

Security, authorization, DB lint, generated type, build, smoke, QA residue,
secret scan, package lock, process cleanup, and Supabase project-scope checks
were not removed or downgraded.

## R1 Validation

- R1 before change Phase 4 closeout: PASS, `PHASE4_CLOSEOUT_PASS`, 15 files /
  848 tests
- R1 after change Phase 4 closeout: PASS, `PHASE4_DB_BASELINE_PASS`,
  `PHASE4_CLOSEOUT_PASS`, observed 15 files / 848 tests
- Phase 4 baseline file existence verification: PASS
- Test failure blocking: retained
- Skip blocking: retained
- Phase 4 regression boundary weakened: no

## Implemented Custody Scope

- `private.custody_providers`
- `private.custody_account_bindings`
- `private.custody_config_audit_events`
- Provider lifecycle command RPCs
- Binding lifecycle command RPCs
- Admin custody read RPCs
- Generated public database types
- `src/lib/custody` validation and public result mapping
- Server-only custody observation adapter type contract
- Server admin custody command and read wrappers
- Four same-origin admin custody POST routes
- `/admin/custody`
- `npm run test:custody:boundary:local`
- Custody boundary documentation and Phase 5 gate

## Database Boundary

- Private table direct browser access: blocked
- RPC authorization: ACTIVE ADMIN plus AAL2 revalidated inside PostgreSQL
- RPC execution grant: authenticated only
- Explicit service-role grant: 0
- RPC security: `SECURITY DEFINER`
- RPC search path: `search_path = ''`
- Command idempotency: implemented
- Command conflict detection: implemented
- Expected-version concurrency: implemented
- Transaction advisory lock: implemented
- Immutable audit: implemented
- Provider terms freeze after first approval: implemented
- Binding terms freeze after first approval: implemented
- Provider capability requirement before approval: implemented
- Binding approved-provider and ACTIVE SOLANA asset requirement: implemented
- Duplicate provider, asset, role binding while non-retired: blocked

## Prohibited Data

The custody schema does not add columns for:

- Balance
- External provider account ID
- Deposit address
- Withdrawal address
- Blockchain address
- Wallet address
- Private key
- Mnemonic
- Seed phrase
- API key
- API secret
- RPC URL
- Transaction ID
- Transaction hash
- Signature

Audit request data is constrained to normalized non-secret metadata and is not
returned by the audit read RPC.

## Application Boundary

- `/admin/custody` uses the existing centralized admin guard.
- Admin POST routes require Same-Origin form submissions.
- Redirect query strings expose result/error codes only.
- Browser private table access was not added.
- Provider SDKs were not added.
- Blockchain SDKs were not added.
- `fetch` was not added to the observation contract.
- Provider or blockchain network calls were not added.
- Service-role application client was not added.
- Ledger posting from custody configuration commands was not added.
- User balance, deposit, withdrawal, and staking state mutations were not
  added.

## Validation Results

- DB reset: PASS
- DB lint: PASS, error 0, warning 0
- pgTAP after custody test: PASS, 16 files / 893 tests
- pgTAP skip count: 0 observed in closeout parser when available; no skip
  markers observed
- Generated types: PASS
- Next.js lint: PASS
- Next.js build: PASS
- Custody boundary E2E: PASS, `CUSTODY_BOUNDARY_PASS`
- Phase 4 closeout after R1 before P5 test: PASS, observed 15 files / 848 tests
- Phase 4 closeout after P5 test: BLOCKED before additive-safe pgTAP check

## Final Validation Blocker

After P5 implementation, the standalone checks passed:

- `npm run db:lint:local`: PASS
- `npm run db:test:local`: PASS, 16 files / 893 tests
- `npm run db:types:local`: PASS after local Supabase was running
- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run test:custody:boundary:local`: PASS, `CUSTODY_BOUNDARY_PASS`

The final `npm run test:phase4:closeout:local` did not reach the new
additive-safe pgTAP assertion. It failed inside the pre-existing nested Phase 3
Closeout, which failed inside Phase 2 Auth route E2E at:

```text
FAIL Confirmed account 200
```

Manual reproduction after a fresh local DB reset showed:

```text
Confirmation POST redirect: /auth/verified
Set-Cookie count: 0
Follow-up /account: 307 /auth/sign-in
```

This indicates the nested Phase 2 Auth route regression is failing before the
Phase 4 closeout reaches the P5 pgTAP count check. Fixing it would require
modifying existing Auth route/server-client behavior or existing Phase 2/3
closeout orchestration, both outside the NEW-P5-T01-R1 allowed file list.

The earlier R1-only run of `npm run test:phase4:closeout:local` passed with
`PHASE4_DB_BASELINE_PASS` and `PHASE4_CLOSEOUT_PASS` before the P5 custody DB
test was added.

## R2 Auth Cookie Recovery

R2 confirmed the email verification link type as a token-hash App Route:

- Host: `localhost:3000`
- Path: `/auth/confirm`
- Query parameter names: `token_hash`, `type`, `next`
- Fragment session: false

Root cause was split into two parts:

- Production route cookie boundary: `verifyOtp()` and `signInWithPassword()`
  could create an auth session, but the final Route Handler redirect response
  did not carry the Supabase SSR cookies.
- Test harness stale cookie parsing: several local E2E scripts classified any
  `Expires=Thu...` cookie as a deletion cookie, even when `Max-Age` was
  positive and the cookie was a valid session cookie.

Production remediation:

- Added a Route Handler Supabase client helper that buffers Supabase SSR
  cookie writes and applies them to the actual `NextResponse`.
- Updated email confirmation, sign-in, and sign-out POST routes to return the
  buffered auth cookies with their final redirect responses.
- Kept Service Role, database schema, auth bypass, and client-side token
  storage out of scope.

Evidence after production remediation:

- Confirmation POST redirect: `/auth/verified`
- Confirmation POST `Set-Cookie` count: 3
- Cookie names observed: `sb-127-auth-token`, `sb-127-auth-token.0`,
  `sb-127-auth-token.1`
- Confirmed `/account`: 200
- Confirmation replay: safe error redirect
- Sign-in POST `Set-Cookie` count: 2
- Sign-in `/account`: 200
- Cookie values, token hash, email, password, and user id were not printed or
  copied.

Test harness remediation completed within R2 scope:

- `scripts/auth/auth-routes.local.mjs` now treats cookies as deletions only
  when `Max-Age <= 0` or `Expires` is at or before the Unix epoch.
- The `Confirmed account 200` assertion was not removed or weakened.
- `npm run test:auth:routes:local`: PASS.

Remaining R2 blocker:

- `npm run test:phase3:closeout:local`: FAIL inside Phase 2 closeout.
- `npm run test:phase2:closeout:local`: Auth route E2E PASS, then FAIL at
  ADMIN MFA E2E.
- `npm run test:auth:admin-mfa:local`: FAIL `Sign-in session cookie`.

Static evidence found the same stale `Expires=Thu` deletion-cookie parser in
additional E2E scripts:

- `scripts/auth/admin-mfa.local.mjs`
- `scripts/auth/admin-role-commands.local.mjs`
- `scripts/domain/admin-domain-lifecycle.local.mjs`
- `scripts/domain/wallet-account-status.local.mjs`
- `scripts/phase/phase2-closeout.local.mjs`
- `scripts/ledger/deposit-state-machine.local.mjs`
- `scripts/ledger/opening-balance-corrections.local.mjs`
- `scripts/ledger/withdrawal-state-machine.local.mjs`
- `scripts/ledger/withdrawal-execution-settlement.local.mjs`
- `scripts/ledger/balance-overview.local.mjs`

Correcting every duplicated stale parser would exceed the R2 limit of six
additional changed paths. Per R2 stop conditions, the final state is therefore
`REQUIRES_ACTION` instead of PASS.

R2 validation completed:

- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run test:auth:routes:local`: PASS
- Production confirmation smoke: PASS
- Production sign-in smoke: PASS
- Phase 2 closeout: REQUIRES_ACTION at duplicated stale parser scope
- Phase 3 closeout: REQUIRES_ACTION because Phase 2 closeout stops first
- Phase 4 closeout after R2: not run to completion after the Phase 2 blocker
  was confirmed

## R3 Common Cookie Jar Recovery

R3 investigated duplicated E2E cookie parsing across:

- `scripts/auth/**`
- `scripts/domain/**`
- `scripts/ledger/**`
- `scripts/phase/**`
- `scripts/staking/**`
- `scripts/custody/**`

Defective parser copies converted to the common module: 11.

- `scripts/auth/auth-routes.local.mjs`
- `scripts/auth/admin-mfa.local.mjs`
- `scripts/auth/admin-role-commands.local.mjs`
- `scripts/domain/admin-domain-lifecycle.local.mjs`
- `scripts/domain/wallet-account-status.local.mjs`
- `scripts/phase/phase2-closeout.local.mjs`
- `scripts/ledger/deposit-state-machine.local.mjs`
- `scripts/ledger/opening-balance-corrections.local.mjs`
- `scripts/ledger/withdrawal-state-machine.local.mjs`
- `scripts/ledger/withdrawal-execution-settlement.local.mjs`
- `scripts/ledger/balance-overview.local.mjs`

Shared module:

- `scripts/lib/http-cookie-jar.mjs`
- `scripts/lib/http-cookie-jar.selftest.mjs`
- `npm run test:http:cookie-jar:local`

The shared cookie jar:

- Uses `headers.getSetCookie()` first when available
- Falls back to raw header arrays when available
- Parses combined `set-cookie` headers without splitting `Expires` date commas
- Preserves Supabase chunk cookie names
- Removes cookies on `Max-Age <= 0` or expired `Expires`
- Separates host-only `localhost` and `127.0.0.1`
- Enforces path and secure matching for generated Cookie headers
- Does not log cookie values, tokens, email addresses, passwords, or UUIDs

Additional R3 harness recovery:

- Phase 2 closeout now restarts the scoped local Auth container before the
  dashboard E2E section and waits for local Auth stability.
- Phase 2 closeout restored the missing `parseJsonRow()` helper used by the
  dashboard wallet checks.
- Phase 4 closeout keeps the Phase 4 pgTAP baseline additive-safe and now
  verifies generated database types by comparing the file before and after
  `db:types`, rather than requiring the P5 working-tree type diff to be zero.

## R3 Validation

- `npm run test:http:cookie-jar:local`: PASS, `HTTP_COOKIE_JAR_PASS`
- Duplicate stale parser search: PASS, remaining defective parser copies 0
- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- `npm run test:auth:admin-roles:local`: PASS
- `npm run test:domain:admin-lifecycle:local`: PASS
- `npm run test:domain:wallet-status:local`: PASS after clean DB reset
- `npm run test:ledger:deposits:local`: PASS
- `npm run test:ledger:opening-corrections:local`: PASS
- `npm run test:ledger:withdrawals:local`: PASS
- `npm run test:ledger:withdrawal-execution:local`: PASS
- `npm run test:ledger:balance-overview:local`: PASS after local Auth
  rate-counter reset and clean DB reset
- `npm run test:phase2:closeout:local`: PASS
- `npm run test:phase3:closeout:local`: PASS
- `npm run test:phase4:closeout:local`: PASS,
  `PHASE4_DB_BASELINE_PASS`, `PHASE4_CLOSEOUT_PASS`
- `npm run test:custody:boundary:local`: PASS, `CUSTODY_BOUNDARY_PASS`
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, 16 files / 893 tests
- `npm run db:types:local`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- Production smoke: PASS for health, readiness, public auth pages, anonymous
  account guard, anonymous admin guard, and anonymous admin custody guard
- QA residue after final DB reset: 0
- Process cleanup: PASS, no project port listeners on 3000, 3010, or
  55721-55724

No assertions were removed or downgraded. Cookie/session assertions remain
blocking.

## Security And Secret Scan

- Actual secret values copied into source/docs: 0
- Service-role app client: 0
- Remote Supabase connection: 0
- Mainnet or production connection: 0
- Private key or mnemonic material: 0
- Provider credential file: 0
- Provider fixture file with secrets: 0
- Local Supabase CLI default credential output was treated as `[REDACTED]` and
  not copied into source or documentation.

## Changed Path Count

R2 changed paths: 27.

R3 final changed paths: 39.

Composition:

- NEW-P5-T01 allowed paths: 21
- R1 approved Phase 4 closeout script path: 1
- R2 production Auth cookie boundary paths: 4
- R2 Auth route test harness parser path: 1
- R3 newly affected E2E harness paths: 10
- R3 new common cookie jar paths: 2

## Files Changed

- `README.md`
- `package.json`
- `scripts/phase/phase4-closeout.local.mjs`
- `scripts/auth/auth-routes.local.mjs`
- `scripts/auth/admin-mfa.local.mjs`
- `scripts/auth/admin-role-commands.local.mjs`
- `scripts/domain/admin-domain-lifecycle.local.mjs`
- `scripts/domain/wallet-account-status.local.mjs`
- `scripts/ledger/balance-overview.local.mjs`
- `scripts/ledger/deposit-state-machine.local.mjs`
- `scripts/ledger/opening-balance-corrections.local.mjs`
- `scripts/ledger/withdrawal-execution-settlement.local.mjs`
- `scripts/ledger/withdrawal-state-machine.local.mjs`
- `scripts/phase/phase2-closeout.local.mjs`
- `scripts/lib/http-cookie-jar.mjs`
- `scripts/lib/http-cookie-jar.selftest.mjs`
- `supabase/migrations/20260722000527_init_custody_boundary_domain.sql`
- `supabase/tests/database/custody_boundary_domain.test.sql`
- `src/types/database.types.ts`
- `src/lib/custody/validation.ts`
- `src/lib/custody/public-results.ts`
- `src/server/custody/provider-observation-contract.ts`
- `src/server/admin/custody-config-commands.ts`
- `src/server/admin/custody-config-reads.ts`
- `src/app/admin/page.tsx`
- `src/app/admin/custody/page.tsx`
- `src/lib/supabase/server.ts`
- `src/app/api/v1/auth/confirm/route.ts`
- `src/app/api/v1/auth/sign-in/route.ts`
- `src/app/api/v1/auth/sign-out/route.ts`
- `src/app/api/v1/admin/custody/providers/upsert-draft/route.ts`
- `src/app/api/v1/admin/custody/providers/transition/route.ts`
- `src/app/api/v1/admin/custody/bindings/upsert-draft/route.ts`
- `src/app/api/v1/admin/custody/bindings/transition/route.ts`
- `scripts/custody/custody-boundary.local.mjs`
- `docs/08-custody/CUSTODY_PROVIDER_AND_ACCOUNT_BOUNDARY.md`
- `docs/08-custody/CUSTODY_OBSERVATION_ADAPTER_CONTRACT.md`
- `docs/05-operations/PHASE5_CUSTODY_GATE.md`
- `docs/09-governance/NEW_P5_T01_CUSTODY_BOUNDARY_DOMAIN_REPORT.md`

## Not Changed

- `package-lock.json`: unchanged
- `.env.example`: unchanged
- `.env.local`: unchanged
- `supabase/config.toml`: unchanged
- `supabase/seed.sql`: unchanged
- Existing migrations: unchanged
- Existing DB tests: unchanged
- Existing ledger, deposit, withdrawal, and staking command migrations:
  unchanged
- Legacy repository: unchanged
- Staging: not performed
- Commit: not performed
- Push or PR: not performed

## Final Status

Final status: `PASS`.

Reason: R3 replaced duplicated stale E2E cookie parsers with a shared HTTP
cookie jar, restored Phase 2 and Phase 4 closeout harness compatibility with
the cumulative P5 state, and completed Phase 2, Phase 3, Phase 4, custody,
database, lint, build, smoke, QA residue, secret, and process-cleanup
validation without staging, commit, push, or PR.
