# Staking Wallet Web

Managed staking wallet web application baseline.

Current phase: Phase 4 staking product domain. Phase 3 double-entry ledger
flows remain intact, and Phase 4 now adds read-only staking product catalog
metadata plus AAL2 administrator product lifecycle commands. Staking requests,
principal locking, position creation, rewards, unstaking, and chain
integration remain out of scope.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- ESLint
- npm
- Supabase SSR client packages

## Environment

The project currently uses placeholders only. Real local values belong in ignored local environment files and must not be committed.

```text
APP_ENV
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

`APP_ENV` must be one of `local`, `preview`, or `production`. The Supabase URL and publishable key are public browser configuration, not privileged server credentials.

No real Supabase project is connected in this phase.

## Development

```bash
npm run dev
npm run lint
npm run build
npm run start
npm run test:ledger:core:local
npm run test:ledger:opening-corrections:local
npm run test:phase2:closeout:local
npm run test:ledger:deposits:local
npm run test:ledger:withdrawals:local
npm run test:ledger:withdrawal-execution:local
npm run test:ledger:balance-overview:local
npm run test:phase3:closeout:local
npm run test:staking:products:local
```

## Supabase Local

Docker Engine is required for the local Supabase stack. The CLI is installed as a project dev dependency and should be run through npm scripts or `npx supabase`.

```bash
npm run supabase:start
npm run supabase:status
npm run db:reset:local
npm run db:lint:local
npm run db:test:local
npm run db:types:local
npm run supabase:stop
```

This project uses local Supabase ports in the `557xx` range to avoid collisions with other local projects:

```text
API: http://127.0.0.1:55721
Database: 127.0.0.1:55722
Studio: http://127.0.0.1:55723
Mailpit: http://127.0.0.1:55724
```

Local app credentials belong in `.env.local`, which is ignored by Git and must not be committed. The app uses only the local API URL and local anon key. Service-role keys, database URLs, JWT secrets, and production credentials are not application configuration in this phase.

Migrations are forward-only and live under `supabase/migrations`. Remote Supabase link, production migration, ADMIN management, financial schemas, and service-role application access are not implemented yet.

## Auth Identity Schema

The local database now includes the first Auth identity migration:

- `public.profiles` stores the application identity row for each Supabase Auth user.
- `public.user_roles` stores role grant history and creates one active `USER` role during provisioning.
- An `auth.users` insert trigger provisions the profile and default role.
- Auth metadata is not trusted for account status, roles, permissions, or admin state.
- Profile self-read RLS is enabled; browser profile writes and direct role reads are blocked.

Run the local database test suite with:

```bash
npm run db:test:local
```

Generate local public database types with:

```bash
npm run db:types:local
```

The generated file is `src/types/database.types.ts` and is created from the local public schema only.

## Auth Web Flow

Local email confirmation is enabled through Mailpit and a custom confirmation template. The email link opens `/auth/confirm` and does not consume the token on GET; the user confirms with a POST button.

Routes:

- `GET /auth/sign-up`
- `POST /api/v1/auth/sign-up`
- `GET /auth/check-email`
- `GET /auth/confirm`
- `POST /api/v1/auth/confirm`
- `GET /auth/verified`
- `GET /auth/sign-in`
- `POST /api/v1/auth/sign-in`
- `POST /api/v1/auth/sign-out`
- `GET /account`

Auth POST routes require same-origin form submissions, use safe redirect allowlists, and do not expose raw Supabase errors. `/account` is the first protected page and reads the signed-in user's own profile through RLS.

Password recovery pages and route boundaries now exist for local testing:

- `GET /auth/forgot-password`
- `POST /api/v1/auth/password-reset/request`
- `GET /auth/password-reset-sent`
- `GET /auth/recovery`
- `POST /api/v1/auth/password-reset/update`
- `GET /auth/password-updated`
- `GET /auth/account-unavailable`

The recovery email link opens `/auth/recovery` and does not consume the token on GET. The page renders the new password form and sends the recovery token and password in the same same-origin POST to `/api/v1/auth/password-reset/update`.

Local validation found that the current Supabase Auth runtime emits AMR method `otp` after recovery verification instead of a distinct `recovery` method. The app does not treat AMR, cookies, query flags, metadata, `getSession()`, or a normal login session as recovery proof. The adopted design trusts only a valid unused recovery token verified in the same POST that performs the password update, followed by the centralized account guard and global sign-out.

Run the local auth route integration script after starting local Supabase, resetting the DB, and running the production Next.js server on `http://localhost:3000`:

```bash
npm run test:auth:routes:local
```

MFA factor removal UI, recovery codes, break-glass recovery, current-password
change, service-role application access, remote Supabase, and production
database workflows are still not implemented.

## ADMIN Role Commands

ADMIN grant and revoke commands are available for local AAL2 administrators:

```text
GET /admin/roles
POST /api/v1/admin/roles/grant
POST /api/v1/admin/roles/revoke
```

The database is the final authorization boundary. The command functions require
the current user to be an ACTIVE ADMIN with an AAL2 JWT, use a global
transaction advisory lock, and use caller-supplied command IDs for idempotent
replay. Reusing a command ID with a different actor, action, target, or reason
is rejected as a conflict.

`private.admin_role_audit_events` stores immutable append-only APPLIED and NOOP
events. Direct browser reads and writes to `public.user_roles` remain blocked;
audit reads go through the AAL2 ADMIN-only RPC
`public.list_admin_role_audit_events`.

The `/admin/roles` page intentionally accepts a target user UUID from a trusted
operator. User lookup, email search, initial production ADMIN bootstrap,
break-glass recovery, service-role application access, and financial admin
commands are not implemented.

Run the local ADMIN role command integration script after starting local
Supabase, resetting the DB, and running the production Next.js server on
`http://localhost:3000`:

```bash
npm run test:auth:admin-roles:local
```

## ADMIN MFA Boundary

Administrative access is protected by a centralized server guard. `/admin`
requires all of the following:

- A verified Supabase Auth session
- An `ACTIVE` profile
- An active `ADMIN` role in `public.user_roles`
- Current session AAL2 from a verified TOTP factor

The browser does not read `public.user_roles` directly, does not send an
admin flag, and does not provide trusted AAL or factor state. Role checks use
the `public.is_current_user_admin()` database function and AAL2 checks use
`public.is_current_user_admin_aal2()`.

Local TOTP enrollment and challenge routes are available:

```text
GET /admin
GET /auth/mfa/enroll
POST /api/v1/auth/mfa/enroll/start
POST /api/v1/auth/mfa/enroll/verify
GET /auth/mfa/challenge
POST /api/v1/auth/mfa/challenge
```

Enrollment is POST-only. The enrollment page does not create a factor on GET.
QR data, manual secrets, factor IDs, TOTP codes, cookies, and tokens are held
only in browser or test process memory and must not be logged or committed.

Run the local ADMIN MFA integration script after starting local Supabase,
resetting the DB, and running the production Next.js server on
`http://localhost:3000`:

```bash
npm run test:auth:admin-mfa:local
```

Direct ADMIN role mutation outside the AAL2 ADMIN command APIs is intentionally
not present. Local E2E tests reset the database afterward.

## Phase 2 Domain Schema

The local database now includes the first non-financial domain schema:

- `public.projects` stores project metadata and allows at most one `ACTIVE`
  project across the system.
- `public.supported_assets` stores SOLANA-scoped asset metadata for future
  catalog use.
- `public.project_token_assignments` stores current and historical project SPL
  token assignment rows. Token replacement is modeled as retire plus insert.
- `public.wallet_accounts` stores exactly one managed wallet account container
  for each profile.

New Supabase Auth signups provision this chain:

```text
auth.users
public.profiles
public.user_roles
public.wallet_accounts
```

The schema deliberately does not include balances, amount columns, ledger
entries, staking positions, APY, deposits, withdrawals, blockchain
transactions, deposit addresses, withdrawal addresses, private keys,
mnemonics, wallet addresses, or client signing. User balances are a later
double-entry ledger concern, not a `wallet_accounts` column.

No real SOL, USDT, project token, project, mint, or production catalog rows are
seeded in this phase. Future AAL2 ADMIN command tasks will define how project
and asset metadata is created, activated, audited, and retired.

Authenticated browser clients may read only active catalog rows and their own
wallet account through RLS. Browser direct insert, update, and delete access is
blocked for the new domain tables. Service-role application access, remote
Supabase, mainnet, and production workflows remain out of scope.

## Project And Asset Lifecycle Commands

AAL2 ADMIN project and asset lifecycle commands are available for local
development:

```text
GET /admin/catalog
POST /api/v1/admin/domain/projects/create
POST /api/v1/admin/domain/projects/update
POST /api/v1/admin/domain/projects/transition
POST /api/v1/admin/domain/assets/create
POST /api/v1/admin/domain/assets/update
POST /api/v1/admin/domain/assets/transition
POST /api/v1/admin/domain/project-token/assign
POST /api/v1/admin/domain/project-token/retire
```

The database remains the final authorization boundary. Every lifecycle command
requires ACTIVE ADMIN plus AAL2 inside PostgreSQL, uses a transaction advisory
lock, accepts a caller-supplied command ID for idempotent replay, and records
APPLIED or NOOP outcomes in immutable domain audit.

Project token replacement is modeled as suspend project, retire current token,
assign a replacement active SPL token, then reactivate the project. Assignment
history is preserved.

Run the local domain lifecycle integration script after starting local
Supabase, resetting the DB, and running the production Next.js server on
`http://localhost:3000`:

```bash
npm run test:domain:admin-lifecycle:local
```

No real SOL, USDT, project token, mint, production project, wallet status
command, balance, ledger, staking, service-role application client, remote
Supabase, mainnet, or production connection is implemented.

## Wallet Account Status And User Reads

ACTIVE users can read current non-financial catalog metadata and their own
managed wallet account state:

```text
GET /dashboard
GET /catalog
GET /wallet
```

Inactive profiles are blocked from catalog and wallet reads by both the
central account guard and RLS. A user's own wallet row remains readable for
ACTIVE, FROZEN, and CLOSED wallet states while the profile is ACTIVE.

`/dashboard` combines the ACTIVE user's profile status, managed wallet account
status, active project metadata, supported asset metadata, and current project
token assignment in a single server-rendered view. It supports empty catalog
states and displays wallet operational states without showing full UUIDs,
credential material, or financial values.

AAL2 ADMIN wallet status operations are available locally:

```text
GET /admin/wallets
POST /api/v1/admin/wallets/transition
```

Allowed wallet status transitions are `ACTIVE` to `FROZEN`, `FROZEN` to
`ACTIVE`, and `FROZEN` to `CLOSED`. Same-status commands return `NOOP`.
`CLOSED` is terminal. Reactivating a FROZEN wallet requires the target profile
to be ACTIVE.

The database remains the final authorization boundary. The command RPC
requires ACTIVE ADMIN plus AAL2 inside PostgreSQL, uses expected-version
concurrency, accepts a caller-supplied command ID for idempotent replay, and
records APPLIED or NOOP outcomes in immutable wallet account audit.

Run the local wallet status integration script after starting local Supabase,
resetting the DB, and running the production Next.js server on
`http://localhost:3000`:

```bash
npm run test:domain:wallet-status:local
```

Run the full Phase 2 local closeout script after starting local Supabase,
resetting the DB, building, and running the production Next.js server on
`http://localhost:3000`:

```bash
npm run test:phase2:closeout:local
```

No balance, ledger, deposit, withdrawal, reward, APY, staking product,
blockchain address, private key, mnemonic, client signing, on-chain
transaction, service-role application client, remote Supabase, mainnet, or
production connection is implemented.

## Double-Entry Ledger Core

Phase 3 starts with a private PostgreSQL double-entry ledger core:

- `private.positive_atomic_units` stores exact positive integer Atomic Units.
- `private.ledger_accounts` defines user liability buckets and system accounts.
- `private.ledger_journals` and `private.ledger_entries` are immutable.
- `private.post_ledger_journal(...)` is the private posting primitive.
- `private.ledger_account_balances` calculates account balances from entries.
- `private.wallet_asset_ledger_balances` aggregates user wallet and asset buckets.
- `public.list_current_user_ledger_balances()` returns the current ACTIVE user's buckets as text strings.

Financial amounts at application and RPC boundaries must be decimal digit
strings. JavaScript `Number`, PostgreSQL `money`, floating point values,
fractional units, browser posting, generic public financial write RPCs, and
direct browser ledger table access are prohibited.

Current user balance buckets:

- `available_units`: future usable user liability bucket.
- `locked_units`: future staking principal liability bucket.
- `pending_deposit_units`: future deposit-confirmation liability bucket.
- `pending_withdrawal_units`: future withdrawal-processing liability bucket.
- `total_liability_units`: sum of the user liability buckets.

Run the local ledger core integration script after starting local Supabase,
resetting the DB, and running the production Next.js server on
`http://localhost:3000`:

```bash
npm run test:ledger:core:local
```

The ledger core does not implement real deposit, withdrawal, staking, reward,
balance UI, real asset seed data, mainnet, remote Supabase, service-role
application access, private keys, mnemonics, or blockchain signing.

## Opening Balance And Corrections

AAL2 ADMIN Opening Balance commands are available locally for initial
migration testing:

```text
GET /admin/ledger
POST /api/v1/admin/ledger/opening-balance
POST /api/v1/admin/ledger/reverse-opening
```

The database remains the final authorization boundary. Opening Balance requires
an ACTIVE wallet, ACTIVE profile, ACTIVE asset, matching wallet and asset
expected versions, an Atomic Units string, no previous ledger entries for that
wallet and asset, and no previous APPLIED Opening for that wallet and asset.

Opening posts debit `SYSTEM_CUSTODY` and credit `USER_AVAILABLE` through the
private Posting Primitive. Exact reversal derives account, side, and units from
the original immutable Opening Journal; administrators cannot enter arbitrary
debit or credit lines.

`private.financial_admin_audit_events` records immutable APPLIED and NOOP
financial administrator events. The admin ledger page reads balances, journal
summaries, and financial audit summaries through AAL2-only RPCs and does not
expose request data, entry lines, email, metadata, cookies, tokens, MFA
material, service-role credentials, or private ledger account IDs.

Run the local Opening Balance integration script after starting local
Supabase, resetting the DB, and building. If `APP_ORIGIN` is not provided, the
script starts a temporary production Next.js server on `http://localhost:3010`
and stops it after the smoke. To test an already running production server,
set `APP_ORIGIN` explicitly, such as `http://localhost:3000`.

```bash
npm run test:ledger:opening-corrections:local
```

Opening replacement after reversal, generic manual journals, real asset seed
data, service-role application access, remote Supabase, mainnet, and
production connectivity remain unimplemented.

## Deposit Request State Machine

Local manual deposit request commands are available for Phase 3 ledger
validation:

```text
GET /deposits
POST /api/v1/deposits/create
POST /api/v1/deposits/cancel
GET /admin/deposits
POST /api/v1/admin/deposits/confirm
POST /api/v1/admin/deposits/cancel
```

User deposit requests are local-only operational records. The app does not
show or store a blockchain destination, transaction ID, signature, webhook,
mainnet RPC, private key, mnemonic, or client signing path.

The database remains the final authorization boundary. User create and cancel
commands require an ACTIVE profile and caller-owned managed wallet. Admin
confirm and cancel commands require ACTIVE ADMIN plus current AAL2 inside
PostgreSQL. Commands use expected versions, caller-supplied command IDs,
idempotent replay, conflict detection, and an append-only
`private.deposit_command_audit_events` table.

Request creation posts debit `SYSTEM_DEPOSIT_CLEARING` and credit
`USER_PENDING_DEPOSIT`. User/admin cancellation reverses those buckets.
Admin confirmation posts four lines: clearing to custody and pending deposit
to available balance.

The public write RPC names use `*_user_funding_request` to avoid generic
public financial write naming while the user-facing product copy remains
Deposit Requests.

Run the local Deposit Request integration script after starting local
Supabase, resetting the DB, and building. If `APP_ORIGIN` is not provided, the
script starts a temporary production Next.js server on `http://localhost:3010`
and stops it after the smoke. To test an already running production server,
set `APP_ORIGIN` explicitly, such as `http://localhost:3000`.

```bash
npm run test:ledger:deposits:local
```

Real deposit settlement, withdrawal, staking, reward, automatic confirmation,
chain indexing, service-role application access, remote Supabase, mainnet, and
production connectivity remain unimplemented.

## Withdrawal Request State Machine

Local manual withdrawal request commands are available for Phase 3 ledger
validation:

```text
GET /withdrawals
POST /api/v1/withdrawals/create
POST /api/v1/withdrawals/cancel
GET /admin/withdrawals
POST /api/v1/admin/withdrawals/reserve
POST /api/v1/admin/withdrawals/approve
POST /api/v1/admin/withdrawals/cancel
POST /api/v1/admin/withdrawals/start-execution
POST /api/v1/admin/withdrawals/fail-execution
POST /api/v1/admin/withdrawals/settle-execution
```

User withdrawal requests are local-only operational records. The app does not
show or store a destination address, transaction identifier, signature,
webhook, mainnet RPC, private key, mnemonic, or client signing path.

The database remains the final authorization boundary. User create and
REQUESTED cancel commands require an ACTIVE profile and caller-owned managed
wallet. Admin reserve, approve, and cancel commands require ACTIVE ADMIN plus
current AAL2 inside PostgreSQL. Commands use expected versions,
caller-supplied command IDs, idempotent replay, conflict detection, a
withdrawal transaction advisory lock, deferred withdrawal invariants, and an
append-only `private.withdrawal_command_audit_events` table.

Request creation prechecks Available Atomic Units but posts no ledger journal.
Admin reservation posts debit `USER_AVAILABLE` and credit
`USER_PENDING_WITHDRAWAL`. Admin approval posts debit
`USER_PENDING_WITHDRAWAL` and credit `SYSTEM_WITHDRAWAL_CLEARING`. Approval
does not debit `SYSTEM_CUSTODY` and does not mean external payout settlement.
Admin cancellation restores local available units from REQUESTED, RESERVED,
APPROVED, or FAILED states as defined by the state machine.

NEW-P3-T05 adds local execution and internal settlement states. AAL2 admins can
move APPROVED or FAILED withdrawals into EXECUTING with an external evidence
reference. The database stores only a lowercase SHA-256 digest of that
reference. EXECUTING can become FAILED without posting a journal, or SETTLED by
posting debit `SYSTEM_WITHDRAWAL_CLEARING` and credit `SYSTEM_CUSTODY` through
the existing private posting primitive. SETTLED is an internal accounting state,
not chain verification, provider confirmation, or payout fulfillment.

The public write RPC names use `*_user_payout_request` to avoid generic public
financial write naming while the user-facing product copy remains Withdrawal
Requests.

Run the local Withdrawal Request integration script after starting local
Supabase, resetting the DB, and building. If `APP_ORIGIN` is not provided, the
script starts a temporary production Next.js server on `http://localhost:3010`
and stops it after the smoke. To test an already running production server,
set `APP_ORIGIN` explicitly, such as `http://localhost:3000`.

```bash
npm run test:ledger:withdrawals:local
npm run test:ledger:withdrawal-execution:local
```

External payout automation, partial approval, partial settlement, withdrawal
addresses, chain indexing, provider response storage, staking, reward,
service-role application access, remote Supabase, mainnet, and production
connectivity remain unimplemented.

## User Balance Overview

ACTIVE users can read their internal managed-wallet ledger state:

```text
GET /balances
```

`/balances` reads existing current-user RPCs only:

- `public.list_current_user_ledger_balances()`
- `public.list_current_user_deposit_requests(p_limit)`
- `public.list_current_user_withdrawal_requests(p_limit)`

The page displays asset-level Available, Locked, Pending Deposit, Pending
Withdrawal, and Total Liability Atomic Unit strings. Total Liability is the
internal double-entry ledger liability sum for one asset. It is not an external
asset holding statement or custody proof.

All financial units remain decimal strings. JavaScript `Number`, floating
point arithmetic, cross-asset totals, fiat valuation, APY, and reward
projections are not used. Destination addresses, transaction identifiers,
explorer links, raw evidence, evidence digests, administrator audit rows,
private keys, mnemonics, and client signing paths are not shown.

Anonymous users are redirected to sign in with `next=/balances`. Inactive
profiles are blocked by the central account guard. ACTIVE, FROZEN, and CLOSED
managed wallets remain readable while the profile is ACTIVE.

Run the local balance overview integration script after starting local
Supabase, resetting the DB, and building. If `APP_ORIGIN` is not provided, the
script starts a temporary production Next.js server on `http://localhost:3010`
and stops it after the smoke. To test an already running production server,
set `APP_ORIGIN` explicitly, such as `http://localhost:3000`.

```bash
npm run test:ledger:balance-overview:local
```

Run the full local Phase 3 closeout regression after starting local Supabase
and a production Next.js server on `http://localhost:3000`:

```bash
npm run test:phase3:closeout:local
```

## Staking Product Domain

Phase 4 starts with staking product metadata only:

```text
GET /staking
GET /admin/staking-products
POST /api/v1/admin/staking-products/create
POST /api/v1/admin/staking-products/update-draft
POST /api/v1/admin/staking-products/transition
```

The database stores product rows in `private.staking_products` and immutable
administrator audit rows in `private.staking_product_admin_audit_events`.
Commands require ACTIVE ADMIN plus current AAL2 inside PostgreSQL, use
caller-supplied command IDs for idempotent replay, freeze product terms after
first activation, and validate that activation uses the current ACTIVE SOLANA
SPL project token.

`/staking` is a read-only product catalog. It shows fixed term PPM metadata
but does not display APY/APR, expected rewards, staking forms, wallet
addresses, transaction IDs, claims, unlocks, or position state. Product
commands do not create ledger accounts, post ledger journals, move balances,
lock principal, create staking positions, calculate rewards, call Solana, or
sign transactions.

Run the local staking product regression after starting local Supabase,
resetting the DB, and building. If `APP_ORIGIN` is not provided, the script
starts a temporary production Next.js server on `http://localhost:3010` and
stops it after the smoke.

```bash
npm run test:staking:products:local
```

## Health Route

```text
GET /api/v1/health
```

The route is a liveness check only. It does not call Supabase, a database, or an external network.

## Config Readiness Route

```text
GET /api/v1/readiness/config
```

The route validates server runtime configuration and public Supabase placeholders without creating a Supabase client, reading cookies, calling Auth, querying a database, or contacting an external network.

## Supabase Client Boundary

- Browser client scaffold: `src/lib/supabase/client.ts`
- Server client scaffold: `src/lib/supabase/server.ts`
- Proxy cookie refresh scaffold: `src/proxy.ts`
- Public environment validator: `src/lib/config/public-env.ts`
- Server-only environment validator: `src/server/config/env.ts`

Client components may use the browser client scaffold. Server components, route handlers, and future server actions may use the server client scaffold. Client components must not import server-only modules.

## Auth Proxy Boundary

Next.js 16 Proxy is scaffolded to synchronize Supabase auth cookies between the request and response and to call `getClaims()` early in the request lifecycle.

The proxy is not the final authorization layer. It does not decide user identity, roles, account state, financial command permissions, RLS policy outcomes, or database business rules. Those checks belong in later route handlers, server guards, and database policies.

The proxy matcher excludes the liveness and configuration readiness routes, Next.js static assets, image optimization assets, the favicon, and common static file extensions. Real sign up, login, logout, callback, protected redirects, profile, role, and MFA flows are not implemented yet.

## Repository Boundary

Current project:

```text
D:\Ai\staking-wallet-web
```

Legacy reference project:

```text
D:\Ai\Staking-Wallet
```

The legacy repository preserves the previous Solana Wallet Adapter dApp and Expo self-custody wallet. This project must not import or copy legacy wallet adapter, Phantom, private key, mnemonic, client transaction signing, SOL transfer, mainnet default RPC, or localStorage financial-state flows.

## Not Implemented Yet

- Real Supabase project connection
- Complete Auth proxy session policy
- Auth callback for hosted OAuth or remote flows
- Initial production ADMIN bootstrap
- User lookup and email search
- MFA factor removal, recovery codes, and break-glass recovery
- Real deposit settlement and automatic confirmation
- External withdrawal fulfillment and blockchain verification
- Staking lock and reward commands
- Generic manual financial commands
- Production deployment
- Mainnet integration
