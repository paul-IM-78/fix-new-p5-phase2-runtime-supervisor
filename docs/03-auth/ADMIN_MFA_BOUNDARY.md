# ADMIN MFA Boundary

## Scope

This document defines the local ADMIN access boundary for the managed staking
wallet web app.

ADMIN access is not a financial command surface in this phase. It is a guarded
placeholder that proves the application can distinguish a normal user from an
ACTIVE ADMIN with a current AAL2 session.

Out of scope:

- Application ADMIN role grant and revoke APIs
- Admin user lists
- Audit logs
- MFA factor removal UI
- MFA recovery codes
- Lost-device recovery
- SMS MFA
- WebAuthn or passkeys
- Service-role application access
- Remote Supabase workflows
- Assets, balances, ledger, staking, withdrawal, or other financial commands

## Source Of Truth

ADMIN state is stored in `public.user_roles`.

An active ADMIN role means:

```text
role = ADMIN
revoked_at is null
```

The application does not trust user metadata, app metadata, cookies, query
parameters, localStorage, browser-provided AAL, or browser-provided factor
state for ADMIN authorization.

## Database Functions

`public.is_current_user_admin()` returns `true` only for the current JWT subject
when all of the following are true:

- `auth.uid()` is present
- A matching `public.profiles` row exists
- `profiles.account_status = 'ACTIVE'`
- A matching active `public.user_roles` row exists with `role = 'ADMIN'`

`public.is_current_user_admin_aal2()` returns `true` only when
`public.is_current_user_admin()` is true and the current JWT `aal` claim is
exactly `aal2`.

Both functions:

- Take no arguments
- Use `SECURITY DEFINER`
- Use an empty `search_path`
- Grant `EXECUTE` only to `authenticated`
- Do not expose role rows, grant actors, reasons, user IDs, or metadata

## Account Status

ADMIN access still requires an ACTIVE account. The central account guard blocks:

- `RESTRICTED`
- `SUSPENDED`
- `WITHDRAWN`
- Missing profile
- Unknown or unavailable account state

Role revocation and account-status changes are rechecked by the server guard on
each admin request. Existing AAL2 cookies are not enough after a role revoke or
inactive account transition.

## AAL1 And AAL2

A newly signed-in ADMIN session starts at AAL1. The server guard evaluates:

- Current AAL level
- Next AAL level
- Verified TOTP factor count
- Unverified TOTP factor count

Allowed states:

- AAL1 plus zero verified factors: enrollment required
- AAL1 plus one verified factor and next AAL2: challenge required
- AAL2 plus one verified factor and next AAL2: ready

Contradictory states fail closed. Examples include AAL2 without a verified
factor, more than one verified factor, unsupported AAL values, or non-TOTP
factors.

## Enrollment

`GET /auth/mfa/enroll` renders the enrollment page for an ACTIVE ADMIN that has
no verified TOTP factor. GET does not create a factor, issue a secret, mutate
cookies, or query role rows directly from the browser.

`POST /api/v1/auth/mfa/enroll/start`:

- Requires same-origin
- Requires an authenticated ACTIVE ADMIN identity
- Lists existing factors through the server Supabase client
- Rejects verified factors as already enrolled
- Safely removes only the current user's unverified TOTP factors before restart
- Rejects unsupported factor types
- Starts local TOTP enrollment
- Returns a validated factor ID, QR image data URI, and manual secret
- Uses `Cache-Control: no-store`

QR data and manual secrets are returned only for the immediate browser
enrollment ceremony. They are not written to the database by application code,
not logged, not placed in URLs, and not committed.

The local Supabase runtime returns a QR image body that can be SVG XML,
URL-encoded SVG, base64 SVG, or base64 image data. The app normalizes only
recognized image payloads into `data:image/*` and rejects anything else.

## Verify

`POST /api/v1/auth/mfa/enroll/verify`:

- Requires same-origin JSON
- Validates the factor ID as a UUID
- Validates the TOTP code as exactly six digits
- Rechecks ACTIVE ADMIN identity
- Requires the factor to belong to the current user and be unverified TOTP
- Calls Supabase MFA challenge and verify
- Rechecks current and next AAL2
- Rechecks `public.is_current_user_admin_aal2()`

On success, the response directs the browser to `/admin`. Raw Supabase errors,
factor IDs, codes, secrets, cookies, JWTs, and claims are not logged or exposed.

## Challenge

After logout and sign-in, an ADMIN with a verified factor returns to AAL1.
`/admin` redirects to `/auth/mfa/challenge`.

`GET /auth/mfa/challenge` renders a form with the current user's verified TOTP
factor ID in a hidden input. The page does not render QR data, manual secret,
role rows, raw AAL claims, or JWT contents.

`POST /api/v1/auth/mfa/challenge`:

- Requires same-origin form submission
- Validates factor ID, code, and safe next path
- Rechecks ACTIVE ADMIN identity
- Requires a matching verified TOTP factor
- Calls Supabase MFA challenge and verify
- Rechecks AAL2 and `public.is_current_user_admin_aal2()`
- Redirects to `/admin` only after successful verification

Wrong codes, missing fields, tampered factor IDs, foreign factor IDs, and unsafe
next paths do not upgrade the session.

## Admin Page

`/admin` is a server component protected by `getCurrentAdminAccess()`.

It redirects:

- Anonymous users to sign-in
- Inactive accounts to account-unavailable
- Missing profile to a public error
- Non-admin users to a public error
- AAL1 admins without verified TOTP to enrollment
- AAL1 admins with verified TOTP to challenge
- Unavailable or inconsistent MFA states to a public error

The page currently renders only a placeholder. Admin product features, financial
commands, role management, and audit logs remain out of scope.

## Proxy Boundary

The Next.js proxy refreshes Supabase cookies. It does not query roles, read the
database, decide ADMIN status, decide AAL2 status, replace RLS, or authorize
financial commands.

Final ADMIN authorization happens in the server guard and is rechecked by the
database functions.

## Browser Boundary

Browser code must not:

- Query `public.user_roles` directly
- Send trusted `is_admin` or role flags
- Send trusted AAL or factor status
- Store financial or authorization state in localStorage
- Store TOTP secrets, QR data, factor IDs, codes, cookies, or JWTs in files
- Use service-role credentials

## Future Work

Future financial administrator commands must recheck ACTIVE ADMIN plus AAL2 at
the command boundary. They should also define audit logging, idempotency,
approval rules, rate limits, RLS behavior, and service-role handling separately.

Factor removal, recovery codes, lost-device recovery, and break-glass procedures
are high-risk follow-up tasks and are not implemented here.
