# NEW-P2-T03 Wallet Status And User Reads Report

## Scope

- Starting branch: `feat/new-p2-domain-lifecycle-commands`
- Starting commit: `04412bf8520819688df3308739e246040f37de12`
- Working branch: `feat/new-p2-wallet-status-user-reads`
- Legacy repository: read-only cleanliness check only
- Staging, commit, push, and pull request: not performed

## Changed Files

- `package.json`
- `README.md`
- `supabase/migrations/20260720062356_init_wallet_account_status_commands.sql`
- `supabase/tests/database/wallet_account_status_commands.test.sql`
- `src/types/database.types.ts`
- `src/lib/wallet/validation.ts`
- `src/lib/wallet/public-results.ts`
- `src/server/admin/wallet-commands.ts`
- `src/server/domain/current-catalog.ts`
- `src/server/wallet/current-wallet.ts`
- `src/app/account/page.tsx`
- `src/app/catalog/page.tsx`
- `src/app/wallet/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/wallets/page.tsx`
- `src/app/api/v1/admin/wallets/transition/route.ts`
- `scripts/domain/wallet-account-status.local.mjs`
- `docs/04-domain/WALLET_ACCOUNT_STATUS_AND_USER_READS.md`
- `docs/09-governance/NEW_P2_T03_WALLET_STATUS_USER_READS_REPORT.md`

## Database Migration

Migration file:

```text
supabase/migrations/20260720062356_init_wallet_account_status_commands.sql
```

The migration adds `private.wallet_account_admin_audit_events` for append-only
wallet account status command audit. It includes command ID uniqueness,
safe reason validation, outcome and state consistency checks, closed timestamp
invariants, and indexes for time, actor, target user, and wallet account
queries.

The audit immutability trigger blocks `UPDATE`, `DELETE`, and `TRUNCATE`.

The public RPCs are `security definer`, use empty `search_path`, recheck ACTIVE
ADMIN plus AAL2 inside PostgreSQL, and grant execute only to `authenticated`:

- `public.transition_wallet_account_status`
- `public.list_admin_wallet_accounts`
- `public.list_wallet_account_admin_audit_events`

No service-role application client, remote Supabase connection, or production
credential was added.

## Status Command Behavior

Implemented wallet states:

- `ACTIVE`
- `FROZEN`
- `CLOSED`

Allowed transitions:

- `ACTIVE` to `FROZEN`
- `FROZEN` to `ACTIVE`
- `FROZEN` to `CLOSED`

Same status returns `NOOP` with no version increment. `CLOSED` is terminal and
preserves `closed_at` on NOOP.

Blocked transitions:

- `ACTIVE` to `CLOSED`
- `CLOSED` to `ACTIVE`
- `CLOSED` to `FROZEN`

`FROZEN` to `ACTIVE` requires the target profile to be `ACTIVE`; otherwise
`TARGET_PROFILE_INACTIVE` is returned with no mutation and no audit.

Wallet status and profile account status remain independent. No automatic
state synchronization is implemented.

## Idempotency And Concurrency

The wallet status command uses the transaction advisory lock namespace:

```text
staking-wallet-web:wallet-account-command:v1
```

Each command requires an expected version and caller-supplied command UUID.

Replay with identical actor, action, wallet account, expected version, target
status, and normalized reason returns the original event with `replayed =
true`. Reusing the command ID with different command data returns
`COMMAND_ID_CONFLICT`.

## RLS And Browser Boundary

The following existing SELECT policies were replaced in a forward-only
migration:

- `projects_select_active_catalog`
- `supported_assets_select_active_catalog`
- `project_token_assignments_select_active_catalog`
- `wallet_accounts_select_own`

Catalog and wallet browser reads now require an ACTIVE profile. Wallet owners
can read their own wallet row for ACTIVE, FROZEN, and CLOSED wallet states.
Inactive profiles read zero catalog and wallet rows.

No browser INSERT, UPDATE, or DELETE policies were added for wallet accounts,
catalog tables, or audit tables.

## Web Implementation

Added user pages:

- `/catalog`
- `/wallet`

Added administrator page:

- `/admin/wallets`

Added command route:

- `POST /api/v1/admin/wallets/transition`

The command route requires same-origin form requests and redirects only with
safe public result/error codes. Redirect queries do not include wallet IDs,
user IDs, command IDs, expected versions, reasons, tokens, cookies, or raw
database errors.

Existing `/account` and `/admin` pages were changed only to add navigation and
scope text.

## Generated Types

`src/types/database.types.ts` was regenerated from the local public schema and
now includes:

- `transition_wallet_account_status`
- `list_admin_wallet_accounts`
- `list_wallet_account_admin_audit_events`

The private audit table is not exposed in generated public types.

## Validation

Baseline validation before implementation:

- Local Supabase start: PASS
- DB reset: PASS
- DB lint: PASS
- Existing pgTAP: PASS, files 5, tests 369
- Generated type diff before new migration: 0
- `npm run lint`: PASS
- `npm run build`: PASS

Implementation validation:

- DB reset after migration: PASS
- `npm run db:test:local`: PASS, files 6, tests 425
- `npm run db:types:local`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS

Final full validation:

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0
- `npm run db:test:local`: PASS, files 6, tests 425
- `npm run db:types:local`: PASS
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS
- Production health smoke: PASS, HTTP 200
- Production readiness smoke: PASS, HTTP 200
- Landing smoke: PASS, HTTP 200
- Sign-in smoke: PASS, HTTP 200
- Anonymous account smoke: PASS, redirect
- Anonymous catalog smoke: PASS, redirect
- Anonymous wallet smoke: PASS, redirect
- Anonymous admin smoke: PASS, redirect
- Anonymous admin roles smoke: PASS, redirect
- Anonymous admin catalog smoke: PASS, redirect
- Anonymous admin wallets smoke: PASS, redirect

E2E validation:

- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- `npm run test:auth:admin-roles:local`: PASS
- `npm run test:domain:admin-lifecycle:local`: PASS
- `npm run test:domain:wallet-status:local`: PASS

Wallet status E2E verified:

- user `/catalog` and `/wallet` pages
- own wallet visibility and other wallet denial
- browser wallet INSERT, UPDATE, and DELETE denial
- general USER page, API, command RPC, and admin read RPC denial
- AAL1 ADMIN page, API, command RPC, and admin read RPC denial
- AAL2 ADMIN `/admin/wallets` access
- same-origin rejection for the wallet status command route
- invalid input rejection without mutation or audit
- ACTIVE to FROZEN, FROZEN to ACTIVE, and FROZEN to CLOSED
- ACTIVE to CLOSED and CLOSED to ACTIVE/FROZEN blocked
- CLOSED to CLOSED NOOP with stable version and closed timestamp
- stale expected-version conflict
- idempotent replay with one audit row
- concurrent replay with one mutation and one audit row
- command ID conflict without mutation
- inactive target profile block for FROZEN to ACTIVE
- profile state changes not auto-syncing wallet state
- immutable wallet audit update, delete, and truncate denial
- inactive profile RLS returning zero catalog and wallet rows

Final reset residue:

- `auth.users`: 0
- `public.profiles`: 0
- `public.user_roles`: 0
- `auth.mfa_factors`: 0
- `private.admin_role_audit_events`: 0
- `public.projects`: 0
- `public.supported_assets`: 0
- `public.project_token_assignments`: 0
- `public.wallet_accounts`: 0
- `private.domain_admin_audit_events`: 0
- `private.wallet_account_admin_audit_events`: 0

Final process cleanup:

- Next.js test process: stopped
- Local Supabase stack: stopped
- Project Supabase containers: 0
- Port 3000: free
- Ports 55721, 55723, and 55724: free
- Port 55722: no listening process; transient TIME_WAIT sockets observed after
  shutdown

## Security And Scope

- Service-role application client: not added
- Remote Supabase connection: not used
- Mainnet or production connection: not used
- Real SOL, USDT, project token, mint, or production seed data: not added
- Balance, ledger, deposit, withdrawal, reward, APY, and staking schemas: not
  added
- Private key, mnemonic, client signing, and on-chain transaction code: not
  added
- Package installation or update: not performed
- `package-lock.json`: unchanged
- Existing migrations and existing tests: unchanged
- Existing auth, MFA, role command, Supabase client, proxy, config, and
  same-origin modules: unchanged
- Legacy repository files: unchanged

QA email, password, TOTP secret, cookie, JWT, command ID, and generated test
catalog values are process-memory fixtures only and must not be printed in
reports.

Existing moderate dependency advisories remain unchanged.

Secret and financial boundary scan:

- Actual secret value shapes: 0
- Service-role application client: 0
- Database URL configuration: 0
- Private key or mnemonic values: 0
- Real mainnet identifier usage: 0
- Financial table or amount column additions: 0
- QA email, password, TOTP, cookie, JWT, command ID, and generated test
  catalog values: not printed and not persisted
- Test-only marker strings for credential scan assertions: not secrets

Git and dependency status:

- `package-lock.json`: unchanged
- Existing migrations: unchanged
- Existing tests: unchanged
- Existing auth, MFA, role command, Supabase client, proxy, config, and
  same-origin modules: unchanged
- Legacy repository working tree: clean
- Staging, commit, push, and pull request: not performed

Commit possible: yes, after review and explicit approval.

Final task status: `PASS`
