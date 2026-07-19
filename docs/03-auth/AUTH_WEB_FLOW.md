# Auth Web Flow

## Scope

This document describes the local Supabase email authentication flow for the managed staking wallet web app.

Implemented:

- Email and password sign up
- Local Mailpit confirmation email
- User-approved confirmation POST
- Cookie session creation after confirmation
- Email and password sign in
- Sign out
- Protected `/account` page
- RLS-backed own profile read

Not implemented:

- Password reset
- Email change
- Profile editing
- ADMIN role management
- MFA
- Service-role application client
- Remote Supabase
- Financial tables and ledger

## Generated Database Types

The local public database schema is generated into:

```text
src/types/database.types.ts
```

Command:

```text
npm run db:types:local
```

The generated type is wired into the Supabase browser, server, and proxy clients with type-only imports. The generated file includes `profiles` and `user_roles` and excludes `private` and `auth` schemas.

## Sign Up

The sign-up page posts an HTML form to:

```text
POST /api/v1/auth/sign-up
```

Accepted fields:

- `email`
- `display_name`
- `password`
- `password_confirm`

The route accepts only same-origin form POST requests. It validates input, calls `supabase.auth.signUp()`, and sends only `display_name` as non-authority metadata.

Metadata keys such as `role`, `roles`, `admin`, `is_admin`, `account_status`, `permissions`, and `aal` are not trusted or sent by the application.

The public response does not distinguish an existing account from a new account. Successful and non-enumerating responses redirect to `/auth/check-email`.

## Trigger Provisioning

When Supabase Auth creates an `auth.users` row, the database trigger provisions:

- one `public.profiles` row
- one active `USER` role in `public.user_roles`

The trigger does not create `ADMIN` and does not trust metadata for account status or role assignment.

## Confirmation Email

Local email confirmation is enabled in `supabase/config.toml`.

The confirmation template is:

```text
supabase/templates/confirmation.html
```

The email link opens:

```text
/auth/confirm?token_hash=<redacted>&type=email&next=/account
```

The template uses `TokenHash`, not `ConfirmationURL`. It includes no external images, scripts, tracking, user metadata, email address, or token text output.

## GET Confirmation Page

`GET /auth/confirm` validates the presence of `token_hash`, `type=email`, and a safe `next` path.

It does not call `verifyOtp()`, create a session, update cookies, query the database, or log the token. The page renders a confirmation button and stores the token hash only in a hidden form field for POST.

The page is dynamic, not indexed, and uses a no-referrer metadata policy.

## POST Confirmation

The confirmation form posts to:

```text
POST /api/v1/auth/confirm
```

The route requires same-origin form POST, accepts only `type=email`, checks token length, and calls:

```text
supabase.auth.verifyOtp({ token_hash, type: "email" })
```

After verification it calls `getClaims()`, reads the user's own `profiles` row through RLS, and requires `account_status = ACTIVE`.

Valid confirmation redirects to:

```text
/auth/verified?next=/account
```

Invalid, expired, missing profile, or restricted account states redirect to safe public error pages without exposing Supabase messages or token values.

## Sign In

The sign-in page posts to:

```text
POST /api/v1/auth/sign-in
```

The route requires same-origin form POST, validates email/password, and calls `signInWithPassword()`.

After sign-in it calls `getClaims()`, uses `claims.sub` as the user id, and reads the user's own profile through RLS.

Allowed account status:

- `ACTIVE`

Rejected account statuses:

- `RESTRICTED`
- `SUSPENDED`
- `WITHDRAWN`

Missing profiles fail closed and do not trigger automatic provisioning.

Invalid password and missing account cases use the same public error code to reduce enumeration risk. Raw Supabase error messages are not exposed.

## Protected Account Page

`GET /account` is a server component page. It calls `getCurrentUserProfile()`.

Anonymous users redirect to:

```text
/auth/sign-in?next=/account
```

The page displays only:

- display name
- account status
- profile version

It does not show the full user UUID, roles, balances, wallet addresses, assets, staking positions, rewards, or financial information.

## Sign Out

Sign out is POST-only:

```text
POST /api/v1/auth/sign-out
```

The route requires same-origin POST, calls `getClaims()` to detect a session, and calls `signOut()` when a session or invalid auth cookie exists. Repeated sign-out is safe and redirects to `/auth/sign-in`.

GET sign-out is not implemented.

## Request Boundaries

Auth mutation routes require:

- `Origin` header
- exact same origin as the request URL
- `Sec-Fetch-Site` of `same-origin` or `none` when present
- form content type for sign-up, sign-in, and confirmation

No CORS wildcard or cross-origin API support is added in this phase.

## Safe Redirects

Auth `next` values are allowlisted to:

- `/account`
- `/`

Absolute URLs, protocol-relative URLs, backslashes, API routes, admin routes, and external hosts are rejected and replaced with `/account`.

## Error Boundary

Public auth errors use safe codes and Korean user messages.

The UI and redirects do not expose:

- Supabase raw errors
- SQL
- stack traces
- file paths
- email existence
- user UUIDs
- tokens
- cookies

## Role Boundary

The application does not query `user_roles` from browser-facing routes. Role checks and ADMIN assignment remain future server-side work.

Profile reads use RLS and the authenticated user's claims. Service-role access is not used.
