# NEW-P2-T01 Project Asset Wallet Schema Report

## Baseline

- Start branch: `feat/new-p1-admin-role-commands`
- Start commit: `016e899cc9f22df9a9ef81602b68975c2cbae06a`
- Work branch: `feat/new-p2-project-asset-wallet-schema`
- Legacy repository: read-only status check only; no file changes
- Staging, commit, push, PR: not performed

## Changed Files

- `README.md`
- `supabase/migrations/20260719192022_init_project_asset_wallet_domain.sql`
- `supabase/tests/database/project_asset_wallet_domain.test.sql`
- `src/types/database.types.ts`
- `docs/04-domain/PROJECT_ASSET_WALLET_DOMAIN.md`
- `docs/09-governance/NEW_P2_T01_PROJECT_ASSET_WALLET_SCHEMA_REPORT.md`

## Migration

- Migration file: `20260719192022_init_project_asset_wallet_domain.sql`
- Existing migrations modified: 0
- Real project, asset, token, mint, balance, address, or seed rows inserted: 0

Created tables:

- `public.projects`
- `public.supported_assets`
- `public.project_token_assignments`
- `public.wallet_accounts`

Created private functions:

- `private.touch_versioned_record()`
- `private.validate_project_token_assignment()`
- `private.ensure_user_wallet_account(uuid)`
- `private.handle_profile_wallet_account_created()`

Created triggers:

- `touch_projects_version`
- `touch_supported_assets_version`
- `touch_project_token_assignments_version`
- `touch_wallet_accounts_version`
- `validate_project_token_assignment`
- `on_profile_created_create_wallet_account`

## Projects

`public.projects` stores project catalog metadata only.

Constraints:

- `project_code` unique, trimmed, uppercase letters, numbers, and underscores
- `display_name` trimmed, length 1 to 100, no control characters
- `description` nullable, trimmed when present, length 1 to 2000, no control characters
- `status` check: `DRAFT`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`
- `version >= 1`

One active project:

- Index: `projects_one_active_idx`
- Enforces at most one `ACTIVE` project
- Allows zero active projects
- Allows multiple `DRAFT`, `SUSPENDED`, and `ARCHIVED` projects

## Supported Assets

`public.supported_assets` stores SOLANA asset catalog metadata only.

Constraints:

- `asset_code` unique, trimmed, uppercase letters, numbers, and underscores
- `symbol` trimmed, uppercase letters and numbers, length 1 to 16
- `display_name` trimmed, length 1 to 100, no control characters
- `network = SOLANA`
- `asset_type` check: `NATIVE`, `SPL_TOKEN`
- `decimals` between 0 and 18
- `NATIVE` assets require `mint_address IS NULL`
- `SPL_TOKEN` assets require a trimmed Base58-like mint string with length 32 to 44
- `status` check: `DRAFT`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`
- `version >= 1`

Indexes:

- `supported_assets_mint_uidx`
- `supported_assets_native_network_symbol_uidx`

Feature flags such as staking, deposit, withdrawal, reward, and project-token
booleans were not added.

## Project Token Assignments

`public.project_token_assignments` stores assignment history.

Rules:

- Current assignment: `retired_at IS NULL`
- Historical assignment: `retired_at IS NOT NULL`
- Current assignment per project: at most 1
- Current assignment per asset: at most 1
- Replacement model: retire current row, then insert new row
- Native assets cannot be assigned as project tokens
- Archived assets cannot be assigned as project tokens

History protection:

- `project_id` is immutable after insert
- `asset_id` is immutable after insert
- `assigned_at` is immutable after insert
- Retired rows cannot be reactivated
- `retired_at` cannot be changed after retirement

Indexes:

- `project_token_assignments_current_project_uidx`
- `project_token_assignments_current_asset_uidx`

## Wallet Accounts

`public.wallet_accounts` stores one managed wallet account container per
profile.

Constraints:

- `user_id` unique
- Profile FK blocks committed hard deletes
- `custody_model = MANAGED`
- `status` check: `ACTIVE`, `FROZEN`, `CLOSED`
- `CLOSED` requires `closed_at`
- `ACTIVE` and `FROZEN` require `closed_at IS NULL`
- `version >= 1`

The profile FK is deferrable and initially deferred so existing local pgTAP
tests can create and remove temporary profiles inside one rollback-only
transaction. A committed profile delete with a wallet account remains blocked.

No financial or wallet credential fields were added.

## Provisioning And Backfill

New Auth provisioning chain:

```text
auth.users
public.profiles
public.user_roles
public.wallet_accounts
```

`private.ensure_user_wallet_account(uuid)` is idempotent:

- Missing profile: rejected
- Existing wallet account: existing ID returned
- Repeated calls: no duplicate and no version bump
- Defaults: `MANAGED`, `ACTIVE`, `closed_at IS NULL`, `version = 1`

Existing profiles are backfilled with wallet accounts through a set-based
insert with conflict handling. Existing profile and role rows are not changed.

## Version Trigger

`private.touch_versioned_record()` applies to all four new domain tables.

On update:

- `updated_at = clock_timestamp()`
- `version = OLD.version + 1`
- Caller-supplied version values are ignored

## Grants And RLS

All new public tables:

- Revoke all privileges from `PUBLIC`, `anon`, and `authenticated`
- Grant `SELECT` only to `authenticated`
- Enable RLS
- Do not create insert, update, or delete policies

Catalog RLS:

- Authenticated users can read active projects
- Authenticated users can read active supported assets
- Authenticated users can read current assignments only when linked project and asset are active

Wallet RLS:

- Authenticated users can read only their own wallet account
- Other users' wallet accounts are blocked

Private helper execute grants:

- `PUBLIC`: revoked
- `anon`: revoked
- `authenticated`: revoked

## Browser Write Boundary

Browser direct writes are blocked for:

- `public.projects`
- `public.supported_assets`
- `public.project_token_assignments`
- `public.wallet_accounts`

Direct browser access to `public.user_roles` remains blocked.

## Financial And Credential Boundary

Not added:

- Balance columns
- Amount columns
- Ledger tables
- Journal tables
- Deposit or withdrawal tables
- Staking tables
- Reward tables
- Blockchain transaction tables
- Deposit addresses
- Withdrawal addresses
- Wallet addresses
- Private keys
- Mnemonics
- Seed phrases
- Client signing

`wallet_accounts` is a managed account container, not a financial ledger.

## Validation Results

Baseline validation before implementation:

- `npm run supabase:start`: PASS
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, files 3, tests 207
- `npm run db:types:local`: PASS, generated type diff 0
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- Existing domain objects before migration: absent

Implementation validation so far:

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, files 4, tests 314
- `npm run db:types:local`: PASS
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0

Final validation:

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, files 4, tests 314
- `npm run db:types:local`: PASS
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0

## pgTAP Coverage

New test file:

- `supabase/tests/database/project_asset_wallet_domain.test.sql`

Covered:

- 4 new tables
- Required columns
- Primary keys
- Foreign keys
- Checks
- Partial unique indexes
- Triggers
- Function comments
- Table comments
- RLS enabled
- Read policies
- No write policies
- Project code, display name, description, status, and version checks
- One active project invariant
- Native and SPL asset rules
- Mint format and duplicate checks
- Decimals range
- Project token assignment current uniqueness
- Assignment history protection
- Wallet defaults, status rules, custody model, and provisioning
- Helper idempotency
- Existing profile backfill
- Version trigger behavior
- Browser write denial
- Financial and credential column absence

## Local Auth Wallet Provisioning Smoke

- Actual Local Auth signup through local Supabase API: PASS
- Mailpit email confirmation: PASS
- Authenticated client own `wallet_accounts` read: PASS, exactly 1 row
- Wallet defaults: PASS, `ACTIVE` and `MANAGED`
- Other user's wallet account hidden by RLS: PASS
- Browser insert blocked: PASS
- Browser update blocked: PASS
- Browser delete blocked: PASS
- Credential, token, cookie, and key output: 0
- Temporary auth script file created: 0

## Existing Auth And ADMIN E2E

- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- `npm run test:auth:admin-roles:local`: PASS

## Next.js Validation

- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- Health smoke: PASS, HTTP 200, `status = ok`, `runtime = node`, `Cache-Control = no-store`
- Readiness smoke: PASS, HTTP 200, `status = ready`, `service = staking-wallet-web`, `Cache-Control = no-store`
- Landing smoke: PASS, HTTP 200
- Sign-in smoke: PASS, HTTP 200
- Anonymous account boundary: PASS, redirect
- Anonymous admin boundary: PASS, redirect
- Anonymous admin roles boundary: PASS, redirect
- Domain data displayed on pages: 0
- Balance, APY, staking, SQL, secret, or stack trace exposure: 0

## Cleanup

- Final DB reset: PASS
- QA auth users: 0
- QA profiles: 0
- QA user roles: 0
- QA admin roles: 0
- QA MFA factors: 0
- QA admin audit rows: 0
- QA projects: 0
- QA assets: 0
- QA assignments: 0
- QA wallet accounts: 0
- QA email rows: 0
- Real project or asset seed rows after reset: 0
- Project Supabase stack stopped: PASS
- Project Supabase ports 55721-55724 free: PASS
- Port 3000 free: PASS
- Temporary auth script files: none created

## Security And Dependency

- Remote Supabase connection: 0
- Production connection: 0
- Mainnet connection: 0
- Service-role client: 0
- Service-role env usage: 0
- Database URL env usage: 0
- Solana or wallet package changes: 0
- Package installs or updates: 0
- `package.json` changes: 0
- `package-lock.json` changes: 0
- Existing moderate advisories: unchanged, 2 moderate
- `npm audit fix`: not run
- Windows Docker bind warning: no blocking warning observed

Secret scan result:

- Tracked actual secret: 0
- Git diff actual secret: 0
- Wallet credential: 0
- Private key: 0
- Mnemonic or seed phrase value: 0
- Service-role key or client: 0
- Database URL value: 0
- Mainnet or production credential: 0
- Session cookie or JWT copied into docs: 0
- Build output: contains only generated code marker strings and the local
  `NEXT_PUBLIC` publishable key from ignored `.next` output; no service-role,
  database, private-key, mnemonic, wallet credential, or tracked secret value.

Known marker strings in docs or tests are documentation/test markers only and
are not actual credentials.

Deterministic pgTAP UUID and mint-format strings are local test fixtures only
and are not real users, assets, wallet addresses, private keys, mnemonics, or
mainnet identifiers.

## Remaining Limitations

- Project ADMIN commands are not implemented.
- Asset ADMIN commands are not implemented.
- Project token replacement command is not implemented.
- Wallet status command is not implemented.
- Historical catalog ADMIN reads are not implemented.
- Real SOL, USDT, project token, project, and mint rows are not seeded.
- Financial ledger and balance calculation are not implemented.
- Deposit, withdrawal, staking, reward, and on-chain flows are not implemented.

## Git State

- Staging: not performed
- Commit: not performed
- Push: not performed
- PR: not performed
- Changed tracked files:
  - `README.md`
  - `src/types/database.types.ts`
- New untracked files:
  - `docs/04-domain/PROJECT_ASSET_WALLET_DOMAIN.md`
  - `docs/09-governance/NEW_P2_T01_PROJECT_ASSET_WALLET_SCHEMA_REPORT.md`
  - `supabase/migrations/20260719192022_init_project_asset_wallet_domain.sql`
  - `supabase/tests/database/project_asset_wallet_domain.test.sql`
- `git diff --stat` tracked summary: 2 files, 211 insertions, 4 deletions
- Legacy repository status: clean
- Commit candidate: yes, after review
- Final status: PASS
