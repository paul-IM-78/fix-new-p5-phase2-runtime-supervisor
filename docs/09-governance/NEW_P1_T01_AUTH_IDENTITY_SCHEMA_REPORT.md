# NEW-P1-T01 Auth Identity Schema Report

## Baseline

- Starting branch: `chore/new-p0-supabase-local`
- Starting commit: `93443ce408696f9468ac7287edcea32069aadc32`
- Working branch: `feat/new-p1-auth-identity-schema`
- Project path: `D:\Ai\staking-wallet-web`
- Legacy repository path: `D:\Ai\Staking-Wallet`
- Staging, commit, push, and pull request: not performed

## Migration

Migration file:

```text
supabase/migrations/20260719061909_init_auth_identity.sql
```

Existing migrations changed: `0`

Seed changes: `0`

## Tables

Created tables:

- `public.profiles`
- `public.user_roles`

`public.profiles` columns:

- `id`
- `display_name`
- `account_status`
- `terms_version`
- `terms_accepted_at`
- `version`
- `created_at`
- `updated_at`

`public.user_roles` columns:

- `id`
- `user_id`
- `role`
- `granted_by`
- `granted_at`
- `grant_reason`
- `revoked_by`
- `revoked_at`
- `revoke_reason`
- `version`
- `created_at`

## FK Delete Policy

- `public.profiles.id -> auth.users.id`: `ON DELETE RESTRICT`
- `public.user_roles.user_id -> public.profiles.id`: `ON DELETE RESTRICT`
- `public.user_roles.granted_by -> auth.users.id`: `ON DELETE SET NULL`
- `public.user_roles.revoked_by -> auth.users.id`: `ON DELETE SET NULL`

Hard delete of Auth users with profiles is blocked. Future withdrawal should use `profiles.account_status = 'WITHDRAWN'`.

## Constraints And Indexes

Constraints:

- `profiles_account_status_check`
- `profiles_display_name_check`
- `profiles_terms_pair_check`
- `profiles_version_check`
- `user_roles_role_check`
- `user_roles_version_check`
- `user_roles_grant_reason_length_check`
- `user_roles_revoke_reason_length_check`
- `user_roles_revoke_details_check`
- `user_roles_revoked_at_check`

Indexes:

- `user_roles_active_role_uidx`: partial unique index on `(user_id, role)` where `revoked_at is null`
- `user_roles_user_id_idx`
- `user_roles_granted_by_idx`
- `user_roles_revoked_by_idx`

## Provisioning

Helper:

```text
private.ensure_auth_user_provisioned(uuid)
```

Responsibilities:

- Confirms the Auth user exists
- Reads only `raw_user_meta_data ->> 'display_name'`
- Creates `public.profiles` if missing
- Creates one active `USER` role if missing
- Does not overwrite existing profile fields
- Is idempotent

Trigger handler:

```text
private.handle_auth_user_created()
```

Trigger:

```text
on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
```

## Function Security

Both provisioning functions are:

- `SECURITY DEFINER`
- `search_path = ''`

EXECUTE revoked from:

- `PUBLIC`
- `anon`
- `authenticated`

Service-role execute grant added: `0`

Public RPC wrapper added: `0`

## Grants And RLS

`public.profiles`:

- RLS enabled
- `authenticated` has `SELECT`
- `anon` has no `SELECT`
- `authenticated` has no `INSERT`, `UPDATE`, or `DELETE`
- Policy: `profiles_select_own`

`public.user_roles`:

- RLS enabled
- Browser table grants: `0`
- RLS policies: `0`

## Metadata Escalation Defense

Ignored authority metadata:

- `role`
- `roles`
- `admin`
- `is_admin`
- `account_status`
- `permissions`
- `aal`

Tested malicious metadata result:

- `display_name`: accepted as non-authority text
- `account_status`: remains `ACTIVE`
- active `USER` roles: `1`
- active `ADMIN` roles: `0`

## Validation

DB reset:

- Initial reset after migration: PASS
- Final reset after Local Auth signup smoke: PASS
- QA smoke user residual after final reset: `0`

DB lint:

- Final result: PASS
- Errors: `0`
- Warnings: `0`

pgTAP:

- File: `supabase/tests/database/auth_identity.test.sql`
- Files: `1`
- Tests: `88`
- Result: PASS
- Rollback cleanup: PASS

Covered tests:

- Table, column, PK, FK, CHECK constraint, partial unique index, RLS structure
- Table grants and direct browser write/read denial
- Function `SECURITY DEFINER`, empty `search_path`, and revoked EXECUTE
- Auth insert trigger provisioning
- Metadata privilege escalation defense
- Invalid display names
- Provisioning idempotency
- Duplicate active role rejection
- Hard delete restriction
- Actual JWT-claim RLS context checks

Local Auth API signup smoke:

- Local Auth API used: PASS
- Remote Supabase used: `0`
- Service Role used: `0`
- Test email value recorded: `0`
- Test password value recorded: `0`
- Credential output: `[REDACTED]`
- Auth user creation: PASS
- Trigger profile creation: PASS
- active `USER` roles: `1`
- active `ADMIN` roles: `0`

Next.js regression:

- `npm run lint`: PASS, warnings `0`
- `npm run build`: PASS, warnings `0`
- Proxy build convention: PASS
- `GET /api/v1/health`: PASS, HTTP 200
- `GET /api/v1/readiness/config`: PASS, HTTP 200
- `GET /`: PASS, HTTP 200
- Response secret markers: `0`

## Local Stack

Start command:

```text
npm run supabase:start
```

Stop command:

```text
npm run supabase:stop
```

Shutdown result:

- Current project containers remaining: `0`
- `--no-backup`: not used
- `--all`: not used
- Local volume preserved

Docker bind residual warning:

- Supabase CLI again reported the Windows local development notice that services can bind to all host interfaces
- This is not a remote Supabase link
- Local-network exposure hardening remains a separate follow-up

## Remote And Service Role Boundary

Remote commands executed:

- `supabase login`: `0`
- `supabase link`: `0`
- `supabase db pull`: `0`
- `supabase db push`: `0`
- `supabase secrets set`: `0`

Actual remote Supabase project connection: `0`

Application Service Role client: `0`

Database URL added to app config: `0`

## Dependency Advisory State

New packages installed: `0`

`package-lock.json` changed: `0`

`npm audit fix`: not run

Current advisory summary:

- Moderate: `2`
- High: `0`
- Critical: `0`

The existing moderate advisories remain separate from this migration task.

## Secret Scan

Tracked files were checked for service-role markers, Supabase secret markers, database URL assignments, JWT secret assignments, private-key markers, mnemonic markers, and token markers.

Results:

- Tracked actual secrets: `0`
- Local anon key recorded: `0`
- Local service-role key recorded: `0`
- JWT secret recorded: `0`
- DB password recorded: `0`
- QA password recorded: `0`
- Access or refresh token recorded: `0`

Allowed:

- Environment variable names in documentation
- Git-ignored `.env.local`
- Local-only Supabase runtime state

## Legacy Repository

Legacy path:

```text
D:\Ai\Staking-Wallet
```

Result:

- Branch changed: `0`
- Files changed by this task: `0`
- Working tree status: clean

## Changed Files

Commit candidate files:

- `package.json`
- `README.md`
- `supabase/migrations/20260719061909_init_auth_identity.sql`
- `supabase/tests/database/auth_identity.test.sql`
- `docs/02-database/AUTH_IDENTITY_MODEL.md`
- `docs/09-governance/NEW_P1_T01_AUTH_IDENTITY_SCHEMA_REPORT.md`

Forbidden file changes:

- `package-lock.json`: `0`
- `.env.example`: `0`
- `.env.local`: `0`
- `supabase/config.toml`: `0`
- `supabase/seed.sql`: `0`
- Existing migration edits: `0`
- `src/**`: `0`
- `next.config.*`: `0`
- `tsconfig.json`: `0`
- `eslint.config.*`: `0`

## Commit Readiness

Commit possible: yes, after user review and explicit approval.

Current task status: PASS.

Next task candidates:

- Commit this migration and documentation
- Generate typed Supabase database definitions
- Implement Auth UI and callback flow
- Define server-side role guard and ADMIN management policy
