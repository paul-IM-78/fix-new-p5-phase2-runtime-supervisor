# NEW-P0-T04 Supabase Local Report

## Baseline

- Starting branch: `chore/new-p0-auth-proxy`
- Starting commit: `d0fa8ce51ee188c543f2405de7607198f6ed6138`
- Working branch: `chore/new-p0-supabase-local`
- Project path: `D:\Ai\staking-wallet-web`
- Legacy project path: `D:\Ai\Staking-Wallet`
- Staging, commit, push, and pull request: not performed

## Supabase CLI

Installed command:

```text
npm install --save-dev --save-exact supabase
```

Installed CLI version:

```text
supabase 2.109.1
```

Package result:

- `package.json`: `supabase` added as an exact dev dependency
- `package-lock.json`: Supabase CLI package tree added
- Existing dependency removal: `0`
- `--force`: not used
- `--legacy-peer-deps`: not used
- `npm audit fix`: not run

Security advisory status:

- Existing moderate advisory count remains `2`
- No dependency upgrade or audit fix was performed
- Follow-up security triage remains separate

## NPM Scripts

Added scripts:

- `supabase:start`
- `supabase:stop`
- `supabase:status`
- `db:reset:local`
- `db:lint:local`
- `db:migration:new`

Remote or destructive scripts were not added.

## Supabase Init

Command:

```text
npx supabase init
```

Result:

- `supabase/config.toml` created
- `supabase/.gitignore` created
- `supabase/.temp/` ignored
- `supabase/.branches/` ignored
- `supabase init --force`: not used

## Config

Project:

- `project_id = "staking-wallet-web"`

Auth:

- `site_url = "http://localhost:3000"`
- `additional_redirect_urls = ["http://127.0.0.1:3000"]`

Local ports:

- API: `127.0.0.1:55721`
- Database: `127.0.0.1:55722`
- Studio: `127.0.0.1:55723`
- Mailpit: `127.0.0.1:55724`
- Analytics: `127.0.0.1:55727`

Reason for non-default ports:

- Existing local Supabase projects were already using the default `54321-54324` range
- No other project containers were stopped
- Current project was isolated by changing only local config ports

Windows local security notice:

- Supabase CLI reported that local services can bind to all host interfaces
- This is not a remote Supabase project link
- It remains a local-network exposure risk and should be addressed in a later local security hardening task if needed

## Migration

Migration file:

```text
supabase/migrations/20260719053642_init_private_schema.sql
```

Contents:

- Creates `private` schema if absent
- Adds a schema comment
- Revokes all access on `private` from `public`
- Revokes all access on `private` from `anon`
- Revokes all access on `private` from `authenticated`

Not included:

- Profiles
- Roles
- Financial tables
- Asset tables
- Service-role grants
- Security definer functions
- Triggers
- RLS policies
- Test users
- Opening balances
- Business data
- Drop schema statements

## Seed

Seed file:

```text
supabase/seed.sql
```

Status:

- Comment-only baseline
- No data inserts
- No Auth users
- No admin users
- No financial fixtures
- No schema DDL
- No secrets

Config seed path:

- `supabase/seed.sql` is used by local reset

## Local Stack

Start command:

```text
npm run supabase:start
```

Initial attempt:

- Failed because default DB port `54322` was already allocated by another local Supabase project
- Other project containers were not stopped

Remediation:

- Local Supabase ports were moved to the `557xx` range

Final start result:

- Local API: PASS
- Local PostgreSQL: PASS
- Local Auth: PASS
- Local Studio: PASS
- Local Mailpit: PASS
- Health checks: PASS

Stopped services reported by CLI:

- `supabase_imgproxy_staking-wallet-web`
- `supabase_pooler_staking-wallet-web`

These are disabled or not active for this local baseline.

## Local App Environment

Created file:

```text
.env.local
```

Status:

- Git ignored: PASS
- BOM-free env parsing: PASS
- Uses local API URL
- Uses local anon key mapped to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Service-role key stored: `0`
- JWT secret stored: `0`
- Database URL stored: `0`
- Remote Supabase URL stored: `0`

Credential values are not recorded in this report.

## DB Reset

Command:

```text
npm run db:reset:local
```

Result:

- Local database reset: PASS
- Migration applied: PASS
- Seed executed: PASS
- Remote connection: `0`
- Migration error: `0`

## DB Lint

Command:

```text
npm run db:lint:local
```

Result:

- Exit code: `0`
- Errors: `0`
- Warnings: `0`
- Linted schemas: `extensions`, `private`, `public`

## Private Schema Verification

Local SQL verification result:

- `private` schema exists: PASS
- `anon` has `private` usage: false
- `authenticated` has `private` usage: false
- Migration history record exists: PASS

No remote DB connection was used.

## Next.js Validation

Commands:

```text
npm run lint
npm run build
```

Results:

- Lint: PASS
- Build: PASS
- TypeScript errors: `0`
- Warnings: `0`
- Build used `.env.local`
- Service role required: no
- Proxy convention still recognized: PASS

## Runtime Smoke

Temporary production server:

- Started on a safe random local port
- Stopped after validation

Results:

- `GET /api/v1/health`: PASS, HTTP 200, `status=ok`
- `GET /api/v1/readiness/config`: PASS, HTTP 200, `status=ready`, `environment=local`, configured=true
- `GET /`: PASS, HTTP 200, no proxy crash
- Page response access-token text: false
- Page response refresh-token text: false
- Page response stack trace marker: false
- Server logs access-token text: false
- Server logs refresh-token text: false

## Studio and Mailpit

Smoke results:

- Local Studio HTTP response: PASS, HTTP 200
- Local Mailpit HTTP response: PASS, HTTP 200

Email sending was not tested.

## Stack Shutdown

Stop command:

```text
npm run supabase:stop
```

Result:

- Current project stack stopped: PASS
- `--no-backup`: not used
- `--all`: not used
- Local Docker volume preserved
- Remaining current-project containers: `0`

## Remote Boundary

Remote commands executed:

- `supabase login`: `0`
- `supabase link`: `0`
- `supabase projects`: `0`
- `supabase db pull`: `0`
- `supabase db push`: `0`
- `supabase migration repair --linked`: `0`
- `supabase secrets set`: `0`

Actual remote Supabase project connection: `0`.

## Secret Scan

Tracked candidate files and changed files were checked for service-role markers, Supabase secret markers, database URL assignments, JWT secret assignments, private-key markers, and mnemonic markers.

Results:

- Tracked actual secrets: `0`
- Reported key values: `0`
- Migration secrets: `0`
- `config.toml` production secrets: `0`
- `.env.local` staged candidate: `0`
- `supabase/.temp` staged candidate: `0`

Allowed:

- Environment variable names in documentation
- Git-ignored local `.env.local`
- CLI-created local runtime state

## Legacy Repository

Legacy repository path: `D:\Ai\Staking-Wallet`

Result:

- Legacy repository status: clean
- Legacy files changed by this task: `0`

## Changed Files

Commit candidate tracked files:

- `package.json`
- `package-lock.json`
- `README.md`
- `supabase/.gitignore`
- `supabase/config.toml`
- `supabase/migrations/20260719053642_init_private_schema.sql`
- `supabase/seed.sql`
- `docs/02-database/LOCAL_MIGRATION_WORKFLOW.md`
- `docs/09-governance/NEW_P0_T04_SUPABASE_LOCAL_REPORT.md`

Ignored local file:

- `.env.local`

Forbidden source changes:

- `.env.example`: `0`
- `src/app/**`: `0`
- `src/lib/**`: `0`
- `src/server/**`: `0`
- `src/proxy.ts`: `0`
- `next.config.*`: `0`
- `tsconfig.json`: `0`
- `eslint.config.*`: `0`
- `postcss.config.*`: `0`

## Commit Readiness

Commit possible: yes, after user review and explicit approval.

Current task status: PASS.

Residual warning:

- Supabase CLI reported a Windows local-network bind notice for Docker-published ports
- The app used `127.0.0.1` local URLs and no remote Supabase project
- Local network exposure hardening remains a separate follow-up if required
