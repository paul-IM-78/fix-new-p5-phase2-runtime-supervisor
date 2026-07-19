# NEW-P1-T05 ADMIN Role Commands Report

## Baseline

- Start branch: `feat/new-p1-admin-mfa-boundary`
- Start commit: `e1b361c9f01c909362bbf35aed6543ef6ffea69c`
- Work branch: `feat/new-p1-admin-role-commands`
- Legacy repository: read-only status check only; no file changes
- Staging, commit, push, PR: not performed

## Changed Files

- `package.json`
- `README.md`
- `supabase/migrations/20260719160706_init_admin_role_commands.sql`
- `supabase/tests/database/admin_role_commands.test.sql`
- `src/types/database.types.ts`
- `src/lib/auth/validation.ts`
- `src/lib/auth/public-errors.ts`
- `src/server/admin/role-commands.ts`
- `src/app/admin/page.tsx`
- `src/app/admin/roles/page.tsx`
- `src/app/api/v1/admin/roles/grant/route.ts`
- `src/app/api/v1/admin/roles/revoke/route.ts`
- `scripts/auth/admin-role-commands.local.mjs`
- `docs/03-auth/ADMIN_ROLE_COMMANDS_AND_AUDIT.md`
- `docs/09-governance/NEW_P1_T05_ADMIN_ROLE_COMMANDS_REPORT.md`

## Migration

- Migration file: `20260719160706_init_admin_role_commands.sql`
- Existing migrations modified: 0

Created objects:

- `private.admin_role_audit_events`
- `private.prevent_admin_role_audit_mutation()`
- `public.grant_admin_role(uuid, uuid, text)`
- `public.revoke_admin_role(uuid, uuid, text)`
- `public.list_admin_role_audit_events(integer, uuid)`

Audit table:

- Private schema table
- `command_id` unique
- Action check: `GRANT_ADMIN`, `REVOKE_ADMIN`
- Outcome check: `APPLIED`, `NOOP`
- Role check: `ADMIN`
- Reason trim, length, and control-character checks
- Target account status check
- Role version check
- Explicit state transition check for grant/revoke APPLIED and NOOP
- Indexes on occurrence time, actor, target, and role record

Audit immutability:

- UPDATE blocked
- DELETE blocked
- TRUNCATE blocked
- Fixed error marker: `ADMIN_AUDIT_IMMUTABLE`

## Command Functions

Both grant and revoke functions:

- Use `SECURITY DEFINER`
- Use `search_path = ''`
- Revoke execute from `PUBLIC`, `anon`, and `authenticated`
- Grant execute only to `authenticated`
- Recheck `auth.uid()`
- Recheck `public.is_current_user_admin_aal2()`
- Use global transaction advisory lock
- Use command ID idempotency
- Reject command ID conflicts without mutation or audit
- Avoid service-role access

Grant behavior:

- ACTIVE target required
- Missing target returns `TARGET_NOT_FOUND`
- Inactive target returns `TARGET_INACTIVE`
- Existing active ADMIN returns `NOOP`
- New active ADMIN role returns `APPLIED`
- Existing USER role is preserved

Revoke behavior:

- Target profile must exist
- Inactive targets can have ADMIN cleaned up
- Self-revoke returns `SELF_REVOKE_FORBIDDEN`
- Missing active ADMIN returns `NOOP`
- Active ADMIN revoke returns `APPLIED`
- `revoked_by`, `revoked_at`, `revoke_reason`, and `version` are updated

## Web Boundary

Created:

- `GET /admin/roles`
- `POST /api/v1/admin/roles/grant`
- `POST /api/v1/admin/roles/revoke`

The page and routes require the existing AAL2 ADMIN guard. The API routes also:

- Require same-origin form submission
- Validate target UUID, command ID, and reason
- Return safe redirect codes only
- Do not expose raw SQL, target details, reason text, command IDs, cookies, JWTs, or tokens

The page accepts target UUID input from a trusted operator. User lookup and
email search are not implemented.

## Validation Results

Baseline validation before implementation:

- `npm run supabase:start`: PASS
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, files 2, tests 125
- `npm run db:types:local`: PASS
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0

Implementation validation:

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, files 3, tests 207
- `npm run db:types:local`: PASS
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- Health smoke: PASS
- Readiness smoke: PASS
- Landing smoke: PASS
- Sign-in smoke: PASS
- Anonymous account redirect: PASS
- Anonymous admin redirect: PASS
- Anonymous admin roles redirect: PASS

Auth E2E:

- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- `npm run test:auth:admin-roles:local`: PASS

ADMIN role command E2E covered:

- General USER blocked
- AAL1 ADMIN blocked
- AAL2 ADMIN allowed
- Grant APPLIED
- Grant NOOP
- Revoke APPLIED
- Revoke NOOP
- Replay idempotency
- Command conflict rejection
- Concurrent same-command safety
- Inactive target grant block
- Inactive ADMIN revoke allowed
- Self-revoke block
- Role revoke immediate access block
- AAL2 audit read allowed
- AAL1 and USER audit read blocked
- Same-origin rejection
- Invalid input rejection
- MFA material process-only handling

pgTAP covered:

- Audit table structure
- Constraints and indexes
- Function signatures
- `SECURITY DEFINER`
- Empty `search_path`
- Function privileges
- Browser direct `user_roles` access remains blocked
- Audit UPDATE, DELETE, and TRUNCATE immutability
- Unauthorized command and audit access

## Final Cleanup

Final database reset:

- `auth.users`: 0
- `public.profiles`: 0
- `public.user_roles`: 0
- `auth.mfa_factors`: 0
- `private.admin_role_audit_events`: 0
- QA email rows: 0

Process cleanup:

- Project Supabase stack: stopped
- Project Supabase ports 55721-55724: free
- Port 3000: free
- Other unrelated local Supabase containers: not modified
- Other non-3000 Next.js processes: not modified

## Security And Dependency

- Remote Supabase connection: 0
- Production connection: 0
- Mainnet connection: 0
- Service-role client: 0
- Service-role env usage: 0
- Database URL env usage: 0
- Solana or wallet package changes: 0
- Package installs or updates: 0
- `package-lock.json` changes: 0
- Existing moderate advisories: unchanged
- Windows Docker bind warning: no blocking warning observed in this run
- Supabase CLI telemetry note: one parallel `db:types:local` attempt hit a local telemetry rename race; the type file was regenerated successfully in a single follow-up run.

Secret scan result:

- Tracked actual secret: 0
- Tracked MFA secret: 0
- Tracked TOTP code: 0
- Tracked QR data: 0
- Tracked session cookie: 0
- Tracked JWT: 0
- Tracked QA identifier: 0
- Actual UUID or command ID copied into docs: 0

Known marker strings in docs or tests are documentation/test markers only and
are not actual credentials.

## Remaining Limitations

- Initial production ADMIN bootstrap is not implemented.
- User lookup and email-based target selection are not implemented.
- Break-glass recovery is not implemented.
- MFA factor removal and recovery codes are not implemented.
- Financial administrator commands are not implemented.
- Rate limiting and two-person approval are not implemented.

## Git State

- Staging: not performed
- Commit: not performed
- Push: not performed
- PR: not performed
- Commit candidate: yes, after review
- Final status: PASS
