# Password Recovery And Account Guard

This document records the NEW-P1-T03 password recovery and centralized account status guard boundary after the R1 one-shot recovery revision.

## Scope

Implemented in this task:

- Password reset request page and POST route
- Local recovery email template
- Recovery GET page that does not consume the token
- Recovery GET page that renders the new password form
- One-shot password update route that verifies the recovery token and updates the password in the same POST
- Global sign-out call after password update success
- Central account status policy and guard
- Guard integration for sign-in, email confirmation, `/account`, and one-shot recovery update
- Local auth route integration script

Out of scope:

- Logged-in current-password change
- Email change
- Profile editing
- ADMIN role management
- MFA
- Service-role application client
- Remote Supabase
- Financial features

## Reset Request

The reset request flow accepts only same-origin form POST requests.

The public response does not reveal whether an email belongs to an existing, missing, unconfirmed, restricted, suspended, or withdrawn account. Validly shaped requests redirect to the same sent page. Raw Supabase errors, email addresses, user IDs, tokens, and stack traces are not exposed.

The route calls:

```ts
supabase.auth.resetPasswordForEmail(email)
```

It does not use request host headers, user supplied redirects, profile queries, admin APIs, or service-role credentials.

## Recovery Email

The local recovery template adds one link:

```text
{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&type=recovery
```

The template has no external images, scripts, tracking, email address output, metadata output, password input, or marketing content. `{{ .TokenHash }}` is a template placeholder and not a stored secret.

## Recovery GET

`GET /auth/recovery` is dynamic and non-indexable. It validates that `token_hash` is shaped like a recovery token and that `type=recovery`.

The GET page renders the new password form with hidden `token_hash` and `type` inputs plus `password` and `password_confirm` fields. It does not call `verifyOtp`, create a session, update cookies, query the database, run the account guard, mutate a password, call Supabase network mutations, or log tokens.

Invalid query shape shows a safe recovery error and a link to request a new email. The token hash is not shown as visible text and is not re-linked.

## One-Shot Password Update

`POST /api/v1/auth/password-reset/update` performs recovery token verification and password update in the same request.

Required order:

1. Same-origin and form content-type checks
2. Token, type, password, and confirmation validation
3. Server Supabase client creation
4. `verifyOtp({ token_hash, type: "recovery" })`
5. `getClaims()` success with `sub` and `session_id`
6. `inspectAccountAccess(supabase)` central account guard
7. `updateUser({ password })`
8. `signOut({ scope: "global" })`
9. Redirect to `/auth/password-updated`

Password validation happens before `verifyOtp()`, so invalid password shape and confirmation mismatch do not consume the recovery token.

Invalid, missing, consumed, expired, or wrong-type tokens fail before password mutation. Token values, password values, cookies, JWTs, claims, Supabase raw errors, and file paths are not placed in redirects or logs.

## AMR Decision

Initial local validation found this claim shape after `verifyOtp({ type: "recovery" })`:

```text
sub: present
session_id: present
amr method: otp
amr timestamp type: number
```

Because `otp` does not distinguish recovery from other OTP-created sessions, AMR is not used as recovery authorization. The app also does not use cookie flags, query flags, metadata flags, `getSession()` authorization, or service-role lookup as recovery proof.

The trusted proof is the valid unused recovery token hash verified by Supabase Auth in the same request that updates the password.

## Password Update

The existing password policy is used:

- minimum 12 characters
- maximum 128 characters
- control characters rejected
- confirmation must match
- password is not trimmed or logged

The route calls:

```ts
supabase.auth.updateUser({ password: newPassword })
```

On success it explicitly calls:

```ts
supabase.auth.signOut({ scope: "global" })
```

Global sign-out revokes refresh sessions, but already issued access tokens may remain valid until their own expiry. Future financial mutation routes must re-check account status, session state, recent authentication, authorization, audit, and idempotency at command time.

## Account Policy

The pure account status policy is centralized in `src/server/auth/account-policy.ts`.

| Status | Decision |
| --- | --- |
| `ACTIVE` | Allow |
| `RESTRICTED` | Block |
| `SUSPENDED` | Block |
| `WITHDRAWN` | Block |
| Unknown | Fail closed |

The policy performs no I/O, reads no cookies, makes no network calls, queries no roles, and does not trust metadata.

## Account Guard

The server-only guard is centralized in `src/server/auth/account-guard.ts`.

It uses `supabase.auth.getClaims()`, reads `claims.sub`, then selects only the signed-in user's own `profiles` row through RLS. It does not query `user_roles`, use service-role credentials, trust metadata, bypass RLS, or treat profile query errors as anonymous users.

Result model:

- `anonymous`
- `active`
- `inactive`
- `missing_profile`
- `unavailable`

## Guard Integration

The central guard is applied to:

- successful sign-in
- successful email confirmation
- one-shot recovery password update after token verification
- `/account`

The guard is not applied to:

- public landing page
- signup request
- password reset email request
- recovery GET
- health
- readiness
- static assets
- sign-out

The Next.js proxy remains a cookie refresh boundary only and does not run account status queries.

## Integration Script

`npm run test:auth:routes:local` runs a local route test using Node.js standard APIs only.

It manages an in-memory cookie jar, polls Mailpit, extracts confirmation and recovery links, and checks same-origin rejection, signup, confirmation, reset enumeration, recovery GET non-consumption, password-form rendering, general-session update blocking, password input token non-consumption, one-shot password update, token reuse blocking, logout, inactive recovery blocking, and account status matrix behavior.

The script does not print real email addresses, passwords, token hashes, cookies, JWTs, local keys, or database passwords. Local profile status changes use the local PostgreSQL container for test verification only; no application service-role client is added.

## Current Status

Final NEW-P1-T03-R1 status is `PASS` when the governance report's local DB, Next.js, E2E, QA cleanup, and secret checks are reproduced.
