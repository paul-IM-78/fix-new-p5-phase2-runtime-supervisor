# NEW-P1-T03 Password Recovery Guard Report

## Baseline

- Start branch: `feat/new-p1-auth-web-flow`
- Start commit: `aad6b92fb08153943797e10778116192d0ce8230`
- Work branch: `feat/new-p1-password-recovery-guard`
- R1 start state: NEW-P1-T03 implementation present, unstaged, uncommitted, blocked by recovery AMR shape
- Legacy repository: read-only status check only; no file changes

## Preserved Implementation

- Recovery email config
- `supabase/templates/recovery.html`
- Password reset request page and API
- Password reset sent page
- Reset enumeration defense
- Same-origin checks
- Password and token validation
- Public error mapping
- Central `account-policy`
- Central `account-guard`
- Sign-in guard integration
- Email confirmation guard integration
- `/account` guard integration
- Account unavailable page
- Password updated page
- Auth route local integration script
- Auth document
- Governance report
- README changes

## Removed Uncommitted Files

- `src/server/auth/recovery-session.ts`
- `src/app/auth/update-password/page.tsx`
- `src/app/api/v1/auth/password-reset/verify/route.ts`

Reason: R1 removed the previous design that carried a recovery session across a redirect and required `amr.method === "recovery"`. These files were new and uncommitted.

## Recovery Config And Template

- `[auth.email.template.recovery]` preserved
- Subject: `Reset your Staking Wallet password`
- Template path: `./supabase/templates/recovery.html`
- Link: `/auth/recovery?token_hash={{ .TokenHash }}&type=recovery`
- No `ConfirmationURL`
- No external image, script, tracking, email output, metadata output, or real token value

## One-Shot Flow

Adopted flow:

```text
Recovery email link GET
-> password form render
-> same-origin POST
-> input validation
-> verifyOtp(type=recovery)
-> getClaims()
-> central account guard
-> updateUser(password)
-> global signOut
-> password-updated page
```

Token verification and password update happen in the same POST. There is no browser redirect between `verifyOtp()` and `updateUser()`.

## AMR Decision

Initial blocked observation:

```text
verifyOtp({ type: "recovery" }) claim result:
sub: present
session_id: present
amr method: otp
amr timestamp type: number
```

Decision:

- AMR `otp` is not treated as recovery
- AMR is not used for recovery authorization
- Cookie flags are not used
- Query flags are not used
- Metadata flags are not used
- `getSession()` is not used for authorization
- Service-role lookup is not used

Trust basis:

- a valid unused recovery token hash verified by Supabase Auth in the same POST that performs password update

## Recovery GET

- `GET /auth/recovery`: dynamic
- `revalidate = 0`
- `robots.index = false`
- `robots.follow = false`
- `referrer = no-referrer`
- Validates token hash shape and `type=recovery`
- Renders password and password confirmation fields
- Carries token hash and type only in hidden form inputs
- Does not call `verifyOtp`
- Does not call `updateUser`
- Does not create a session
- Does not write cookies
- Does not query DB
- Does not run account guard
- Does not log tokens

## One-Shot Update API

- `POST /api/v1/auth/password-reset/update`
- Same-origin required
- Form content-type required
- Validates `token_hash`, `type`, `password`, and `password_confirm` before `verifyOtp()`
- Invalid password length and mismatch do not consume the token
- Calls `verifyOtp({ type: "recovery" })`
- Calls `getClaims()` and requires `sub` and `session_id`
- Calls `inspectAccountAccess(supabase, claims)` before password mutation
- Only ACTIVE accounts can update password
- Calls `updateUser({ password })`
- Calls `signOut({ scope: "global" })`
- Redirects to `/auth/password-updated`

## Account Guard

- `ACTIVE`: allowed
- `RESTRICTED`: blocked
- `SUSPENDED`: blocked
- `WITHDRAWN`: blocked
- Unknown status: fail closed
- Missing profile: fail closed
- Profile query error: unavailable
- Uses `getClaims()`
- Reads own `profiles` row through RLS
- Does not query `user_roles`
- Does not use service-role credentials
- Does not trust metadata status or roles

## Auth Route Integration Script

- `scripts/auth/auth-routes.local.mjs`
- `npm run test:auth:routes:local`
- Node.js standard APIs only
- No package added
- No credential fixture file
- Credentials, tokens, cookies, JWTs, and local keys remain in process memory only
- Output is PASS stages or safe failure labels only

Coverage:

- Health and readiness
- Signup and confirmation
- Sign-in and sign-out
- Account protection
- Same-origin rejection
- Reset enumeration
- Recovery email
- Recovery GET non-consumption
- Recovery password form
- Invalid password token non-consumption
- General session bypass rejection
- One-shot password update
- Global sign-out
- Old password failure
- New password login
- Token reuse rejection
- Account status matrix
- Inactive account recovery block

## Validation Results

Initial DB baseline before R1:

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, pgTAP 88
- `npm run db:types:local`: PASS, generated type diff 0

Pre-E2E static validation after R1 code changes:

- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- Route conflict: 0
- Removed `/auth/update-password`: PASS
- Removed password-reset verify route: PASS

Final validation results are recorded after the last local run in the completion section below.

## Security

- Remote Supabase connection: 0
- Application service-role client: 0
- Service-role environment requirement: 0
- `getSession()` authorization use: 0
- Browser `user_roles` query: 0
- Metadata role/status trust: 0
- Cookie/query recovery flag: 0
- RLS relaxation: 0
- Existing migration edits: 0
- `package-lock.json` change: 0
- Actual token, cookie, password, JWT, local anon key, local service-role key, DB password, private key, or mnemonic recorded in tracked files: 0

## Dependency

- Package added: 0
- Package removed: 0
- Package upgraded: 0
- `npm audit fix`: not run
- Existing moderate advisories: 2

## Residual Security

Global sign-out revokes refresh sessions, but already-issued access tokens can remain valid until expiry. Future financial mutations must re-check account status, session state, recent authentication, authorization, audit, and idempotency at mutation time.

Windows Supabase local Docker exposes development ports on `0.0.0.0`. This is local-development only and must not be treated as production network posture.

## Completion

- Supabase local start: PASS
- DB reset baseline: PASS
- DB lint baseline: PASS, error 0, warning 0
- DB pgTAP baseline: PASS, 88 tests
- Generated database types: PASS, generated type diff 0
- Lint before E2E: PASS, warning 0
- Build before E2E: PASS, warning 0
- Public guard: PASS
- Same-origin rejection: PASS
- Signup and email confirmation: PASS
- Auth user profile provisioning: PASS
- Logout: PASS
- Reset enumeration defense: PASS
- Recovery email delivery: PASS
- Recovery GET non-consuming password form: PASS
- Invalid password token non-consumption: PASS
- Password mismatch token non-consumption: PASS
- General session bypass blocked: PASS
- One-shot token and password POST update: PASS
- Token reuse blocked: PASS
- Account status matrix: PASS
- Inactive account recovery blocked: PASS
- Old password failure after update: PASS
- New password login after update: PASS
- Global sign-out after update: PASS
- Final DB reset: PASS
- Final DB lint: PASS, error 0, warning 0
- Final DB pgTAP: PASS, 88 tests
- Final generated database types: PASS, generated type diff 0
- Final lint: PASS, warning 0
- Final build: PASS, warning 0
- Production server smoke: PASS
- Health smoke: PASS
- Config readiness smoke: PASS
- Public auth page smoke: PASS
- Unauthenticated account guard smoke: PASS
- QA auth/profile/role residue: 0
- Forbidden file diff: 0
- Tracked `.env` files: 0
- Actual secret, token, cookie, password, private key, mnemonic, local anon key, local service-role key, or DB password copied into tracked files: 0
- Package added/removed/upgraded after R1: 0
- `package-lock.json` changed: 0
- Remote Supabase project connection: 0
- Service-role client: 0
- Legacy repository changes: 0
- Staging, commit, push, PR: 0
- Local Next.js process after smoke: stopped
- Local Supabase stack after validation: stopped

## Final Status

`PASS`
