# NEW-P2-T02 Domain Lifecycle Commands Report

## Scope

- Starting branch: `feat/new-p2-project-asset-wallet-schema`
- Starting commit: `fe7e51ed03bd5c464820b8282207532236881bbc`
- Working branch: `feat/new-p2-domain-lifecycle-commands`
- Legacy repository: read-only cleanliness check only
- Staging, commit, push, and pull request: not performed

## Changed Files

- `package.json`
- `README.md`
- `supabase/migrations/20260720051711_init_domain_lifecycle_commands.sql`
- `supabase/tests/database/domain_lifecycle_commands.test.sql`
- `src/types/database.types.ts`
- `src/lib/domain/validation.ts`
- `src/lib/domain/public-results.ts`
- `src/server/admin/domain-commands.ts`
- `src/app/admin/page.tsx`
- `src/app/admin/catalog/page.tsx`
- `src/app/api/v1/admin/domain/projects/create/route.ts`
- `src/app/api/v1/admin/domain/projects/update/route.ts`
- `src/app/api/v1/admin/domain/projects/transition/route.ts`
- `src/app/api/v1/admin/domain/assets/create/route.ts`
- `src/app/api/v1/admin/domain/assets/update/route.ts`
- `src/app/api/v1/admin/domain/assets/transition/route.ts`
- `src/app/api/v1/admin/domain/project-token/assign/route.ts`
- `src/app/api/v1/admin/domain/project-token/retire/route.ts`
- `scripts/domain/admin-domain-lifecycle.local.mjs`
- `docs/04-domain/PROJECT_ASSET_LIFECYCLE_COMMANDS.md`
- `docs/09-governance/NEW_P2_T02_DOMAIN_LIFECYCLE_COMMANDS_REPORT.md`

## Database Migration

Migration file:

```text
supabase/migrations/20260720051711_init_domain_lifecycle_commands.sql
```

The migration adds `private.domain_admin_audit_events` for append-only domain
audit events. It includes command ID uniqueness, action and outcome checks,
safe reason validation, JSON shape checks, entity foreign-key consistency
checks, and audit indexes for time, actor, project, asset, and assignment
queries.

An immutability trigger blocks `UPDATE`, `DELETE`, and `TRUNCATE`.

All helper functions and public RPCs use empty `search_path`. Lifecycle
commands and read RPCs are `security definer`, recheck ACTIVE ADMIN plus AAL2
inside PostgreSQL, and grant execute only to `authenticated`.

## Lifecycle Commands

Implemented command RPCs:

- `public.create_project`
- `public.update_project_details`
- `public.transition_project_status`
- `public.create_supported_asset`
- `public.update_supported_asset_details`
- `public.transition_supported_asset_status`
- `public.assign_project_token`
- `public.retire_project_token`

Implemented read RPCs:

- `public.list_admin_projects`
- `public.list_admin_supported_assets`
- `public.list_admin_project_token_assignments`
- `public.list_domain_admin_audit_events`

Mutating commands use the transaction advisory lock
`staking-wallet-web:domain-lifecycle-command:v1`.

Command replay returns the original outcome with `replayed = true`. Reusing a
command ID with different command data returns `COMMAND_ID_CONFLICT`.

Expected-version concurrency checks are enforced on project updates, project
status transitions, asset updates, asset status transitions, and project token
retirement.

## Web Implementation

`/admin/catalog` is an AAL2 administrator-only server component. It uses only
administrator read RPCs and renders shortened IDs plus summarized audit
changes. It does not render raw snapshot JSON, email addresses, credentials,
cookies, tokens, wallet secrets, balances, APY, or staking data.

Eight same-origin POST route handlers were added under
`/api/v1/admin/domain/**`. They validate form input, call the central server
command wrapper, and redirect with safe `result` or `error` codes only.

The existing `/admin` page was updated only to link to `/admin/catalog` and to
state that balances, staking, and financial commands remain out of scope.

## Validation Status

Initial baseline validation before implementation:

- Local Supabase start: PASS
- DB reset: PASS
- DB lint: PASS, error 0, warning 0
- Existing pgTAP before new migration: PASS, files 4, tests 314
- Generated type diff before new migration: 0
- Next.js lint: PASS
- Next.js build: PASS

Implementation validation:

- DB reset after migration: PASS
- pgTAP with new domain lifecycle tests: PASS, files 5, tests 369
- Generated public database types: PASS
- `npm run lint`: PASS
- `npm run build`: PASS

Final validation is recorded at the end of this report.

## Security And Scope

- Service-role application client: not added
- Remote Supabase connection: not used
- Mainnet or production connection: not used
- Real SOL, USDT, project token, mint, or project seed data: not added
- Wallet status command: not implemented
- Ledger, balance, deposit, withdrawal, and staking tables: not implemented
- Package installation or update: not performed
- `package-lock.json`: unchanged
- Existing migrations and existing tests: unchanged
- Legacy repository files: unchanged

QA email, password, TOTP secret, cookie, JWT, command ID, and generated mint
values are process-memory fixtures only and are not printed in reports.

## Known Environmental Warning

Supabase CLI on Windows reports that local services bind to `0.0.0.0` instead
of loopback-only interfaces. This is an existing local Docker/Supabase warning
and does not enable remote Supabase or production connectivity.

Existing moderate dependency advisories remain unchanged.

## Final Validation

Final full validation:

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, files 5, tests 369
- `npm run db:types:local`: PASS
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- Production health smoke: PASS, HTTP 200
- Production readiness smoke: PASS, HTTP 200
- Landing smoke: PASS, HTTP 200
- Sign-in smoke: PASS, HTTP 200
- Anonymous account smoke: PASS, redirect
- Anonymous admin smoke: PASS, redirect
- Anonymous admin roles smoke: PASS, redirect
- Anonymous admin catalog smoke: PASS, redirect
- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- `npm run test:auth:admin-roles:local`: PASS
- `npm run test:domain:admin-lifecycle:local`: PASS

Domain lifecycle E2E verified:

- same-origin rejection for all eight command endpoints
- general USER command, page, and RPC denial
- AAL1 ADMIN command, page, and RPC denial
- AAL2 ADMIN catalog page access
- direct browser domain write denial
- project create, replay, concurrent replay, conflict, duplicate code, update,
  noop, and status transition behavior
- asset create, replay, conflict, duplicate mint, duplicate native symbol,
  update noop, status transition behavior, and active-use protection
- project activation readiness checks
- second active project conflict
- project token assignment, assignment noop, active-project retire block,
  retirement after suspend, replacement token assignment, and history
  preservation
- project, asset, and assignment version conflicts
- append-only domain audit `APPLIED` and `NOOP` outcomes
- audit update, delete, and truncate denial
- catalog audit rendering without credential, cookie, token, metadata,
  private key, mnemonic, balance, APY, or staking data

Final reset residue after E2E:

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

Final process cleanup:

- Next.js test process: stopped
- Local Supabase stack: stopped
- Project Supabase containers: 0
- Port 3000: free
- Ports 55721-55724: free

Secret and financial boundary scan:

- Actual secret value shapes: 0
- Service-role application client: 0
- Database URL configuration: 0
- Private key or mnemonic values: 0
- Real mainnet identifier usage: 0
- Real financial seed data: 0
- QA email, password, TOTP, cookie, JWT, command ID, and generated mint values:
  not printed and not persisted
- Test-only `otpauth://` marker reference: code assertion only, not a secret

Git and dependency status:

- `package-lock.json`: unchanged
- Existing migrations: unchanged
- Existing tests: unchanged
- Existing auth, MFA, role command, Supabase client, proxy, and config modules:
  unchanged
- Legacy repository working tree: clean
- Moderate npm advisories: 2 existing moderate advisories remain unchanged
- Staging, commit, push, and pull request: not performed

Commit possible: yes, after review and explicit approval.

Final task status: `PASS`
