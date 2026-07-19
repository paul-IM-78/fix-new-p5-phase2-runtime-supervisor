# NEW-P1-T04 ADMIN MFA Boundary Report

## Baseline

- Start branch: `feat/new-p1-password-recovery-guard`
- Start commit: `7ddfb0e194aeee391ce25edca9c25ef3e0300f19`
- Work branch: `feat/new-p1-admin-mfa-boundary`
- Legacy repository: read-only status check only; no file changes
- Staging, commit, push, PR: not performed

## Changed Files

- `package.json`
- `README.md`
- `supabase/config.toml`
- `supabase/migrations/20260719142152_init_admin_authorization.sql`
- `supabase/tests/database/admin_authorization.test.sql`
- `src/types/database.types.ts`
- `src/lib/auth/validation.ts`
- `src/lib/auth/public-errors.ts`
- `src/server/auth/admin-mfa-policy.ts`
- `src/server/auth/admin-guard.ts`
- `src/components/auth/admin-mfa-enrollment.tsx`
- `src/app/admin/page.tsx`
- `src/app/auth/mfa/enroll/page.tsx`
- `src/app/auth/mfa/challenge/page.tsx`
- `src/app/api/v1/auth/mfa/enroll/start/route.ts`
- `src/app/api/v1/auth/mfa/enroll/verify/route.ts`
- `src/app/api/v1/auth/mfa/challenge/route.ts`
- `scripts/auth/admin-mfa.local.mjs`
- `docs/03-auth/ADMIN_MFA_BOUNDARY.md`
- `docs/09-governance/NEW_P1_T04_ADMIN_MFA_BOUNDARY_REPORT.md`

## Migration

- Migration file: `20260719142152_init_admin_authorization.sql`
- Existing migrations modified: 0

Created functions:

- `public.is_current_user_admin()`
- `public.is_current_user_admin_aal2()`

Function boundaries:

- No arguments
- `SECURITY DEFINER`
- `search_path = ''`
- `PUBLIC` execute revoked
- `anon` execute revoked
- `authenticated` execute granted
- Fully qualified schema references
- No metadata role trust
- No service-role dependency
- No role row, grant actor, reason, UUID, or SQL detail exposure

## AAL2 Database Check

`public.is_current_user_admin_aal2()` returns true only when the current user is
an ACTIVE ADMIN and the current JWT `aal` claim is exactly `aal2`.

Observed matrix:

- ACTIVE ADMIN + `aal1`: false
- ACTIVE ADMIN + missing AAL: false
- ACTIVE ADMIN + `aal2`: true
- USER + `aal2`: false
- Revoked ADMIN + `aal2`: false
- Inactive ADMIN + `aal2`: false

## TOTP Config

- `supabase/config.toml` enables local TOTP enrollment and verification.
- `max_enrolled_factors = 1`
- Email signup, confirmation templates, recovery templates, Mailpit, and local
  ports were preserved.
- Phone MFA, WebAuthn, passkeys, remote SMTP, and OAuth remain out of scope.

## Central ADMIN Guard

Created:

- `src/server/auth/admin-mfa-policy.ts`
- `src/server/auth/admin-guard.ts`

Guard behavior:

- Reuses central account guard
- Requires ACTIVE profile
- Checks ADMIN through `rpc('is_current_user_admin')`
- Lists current user's MFA factors through Supabase Auth
- Rejects unsupported factor types
- Evaluates AAL and TOTP factor state through a pure policy
- Rechecks `rpc('is_current_user_admin_aal2')` before ready access
- Fails closed on DB/Auth errors and inconsistent states

Authorization exclusions:

- `getSession()` authorization use: 0
- Browser `user_roles` direct read: 0
- Metadata role trust: 0
- Service-role client: 0
- Proxy role or DB query: 0

Implementation note: enrollment start obtains the current user's bearer token
only after `inspectAdminIdentity()` succeeds so the server can call the local
Supabase Auth factor endpoint. This token retrieval is not used as the ADMIN
authorization decision.

## Enrollment

Created:

- `GET /auth/mfa/enroll`
- `POST /api/v1/auth/mfa/enroll/start`
- `POST /api/v1/auth/mfa/enroll/verify`
- `src/components/auth/admin-mfa-enrollment.tsx`

Observed behavior:

- Enrollment GET mutation: 0
- Enrollment start requires same-origin POST
- General USER enrollment start: blocked
- ACTIVE ADMIN AAL1 without factor: enrollment required
- Verified TOTP factor already enrolled: no new factor created
- Unverified TOTP restart: previous unverified factor removed safely
- Factor max count maintained at 1
- QR returned as validated `data:image/*`
- Manual secret returned only to the immediate browser ceremony
- QR, secret, factor ID, code, token, cookie, and JWT values recorded in files: 0

Local Supabase QR payload handling:

- SVG XML
- URL-encoded SVG
- base64 SVG
- base64 PNG/JPEG/WebP

Unsupported QR payloads fail closed.

## Verify And Challenge

Enrollment verify:

- Same-origin JSON only
- Factor ID UUID validation
- TOTP six-digit validation
- Current user factor ownership check
- Requires unverified TOTP factor
- Calls Supabase MFA challenge and verify
- Rechecks current and next AAL2
- Rechecks `public.is_current_user_admin_aal2()`

Challenge:

- Same-origin form only
- Safe `next` path allowlist includes `/admin`
- Requires matching verified TOTP factor
- Wrong code does not upgrade AAL
- Tampered factor ID does not mutate factor state
- Successful challenge upgrades the session to AAL2

## `/admin`

Created `GET /admin` as a guarded placeholder.

Observed behavior:

- Anonymous user: redirected to sign-in
- General USER: blocked with `admin_forbidden`
- ACTIVE ADMIN at AAL1 with no verified factor: redirected to enrollment
- ACTIVE ADMIN at AAL1 with verified factor: redirected to challenge
- ACTIVE ADMIN at AAL2: allowed
- Role revoke during AAL2 session: blocked immediately
- RESTRICTED ADMIN: blocked
- SUSPENDED ADMIN: blocked
- WITHDRAWN ADMIN: blocked

Admin feature scope:

- User management: not implemented
- Role grant/revoke API: not implemented
- Audit log: not implemented
- Financial command: not implemented

## Input And Same-Origin Tests

Same-origin rejection covered:

- Missing origin
- External origin
- Invalid `Sec-Fetch-Site`
- Enrollment start
- Enrollment verify
- Challenge

Input rejection covered:

- Missing factor ID
- Empty factor ID
- Non-UUID factor ID
- Control-character factor ID
- Overlong factor ID
- Foreign or nonexistent factor ID
- Missing TOTP code
- Empty TOTP code
- Five-digit code
- Seven-digit code
- Alphabetic code
- Whitespace code
- Control-character code
- Wrong six-digit code
- Unsafe next path

## Validation Results

Baseline validation before implementation:

- `npm run supabase:start`: PASS
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, pgTAP 88
- `npm run db:types:local`: PASS, generated type diff 0
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0

Final DB validation:

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, files 2, tests 125
- `npm run db:types:local`: PASS
- Generated type includes `is_current_user_admin`: PASS
- Generated type includes `is_current_user_admin_aal2`: PASS

Final Next.js validation:

- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- TypeScript errors: 0
- Route conflicts: 0
- Proxy changed: 0

Production E2E:

- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- Existing auth route integration: PASS
- ADMIN MFA integration: PASS
- Credential output: 0

Final smoke:

- Health: PASS
- Readiness: PASS
- Landing: PASS
- Sign-in: PASS
- Anonymous account redirect: PASS
- Anonymous admin redirect: PASS

## Cleanup

- Final DB reset: PASS
- QA auth users: 0
- QA profiles: 0
- QA roles: 0
- QA MFA factors: 0
- Next.js test process after smoke: stopped
- Port 3000 after smoke: free
- Local Supabase stack after validation: stopped
- Supabase project containers after stop: 0
- Ports 55721, 55722, 55723, 55724 after stop: free
- Temporary QR image files: 0
- Temporary TOTP secret files: 0
- Temporary QA credential files: 0

## Security And Secrets

- Remote Supabase project connection: 0
- Application service-role client: 0
- Service-role environment requirement: 0
- Service-role code path: 0
- Database URL application config: 0
- Private key or mnemonic: 0
- Mainnet or production credential: 0
- Actual QA email, password, TOTP secret, QR data URI, code, factor ID, JWT,
  cookie, local anon key, local service-role key, or DB password recorded in
  tracked files: 0
- Secret scan false-positive markers: `otpauth://` appears only as a string
  assertion in the local test script; six-digit numeric matches are validation
  limits or test literals, not live TOTP codes.

Secret values observed from local CLI output are development defaults and are
not copied into tracked files. Any such values are treated as `[REDACTED]`.

## Dependency And Advisory

- Package added: 0
- Package removed: 0
- Package upgraded: 0
- `package-lock.json` changed: 0
- QR package added: 0
- TOTP package added: 0
- Validation package added: 0
- `npm audit fix`: not run
- `npm audit --json`: moderate 2, high 0, critical 0

The two moderate advisories remain in the existing dependency tree and were not
changed by this task.

## Local Docker Note

Windows local Supabase still reports the Docker bind warning for analytics and
development services. This is local-development posture only and is not a
production configuration.

## Limitations

- Application ADMIN provisioning is not implemented.
- Application ADMIN revoke API is not implemented.
- Factor removal UI is not implemented.
- Recovery codes are not implemented.
- Lost-device recovery and break-glass procedures are not implemented.
- Financial administrator commands are not implemented.
- Future financial commands must recheck ACTIVE ADMIN plus AAL2 at the command
  boundary and add audit, idempotency, and authorization policy.

## Git State

- Allowed file scope only: PASS
- Forbidden existing migration changes: 0
- `package-lock.json` changes: 0
- Legacy repository changes: 0
- Staging: 0
- Commit: 0
- Push: 0
- PR: 0

## Commit Readiness

Commit is possible after user review and approval.

## Final Status

`PASS`
