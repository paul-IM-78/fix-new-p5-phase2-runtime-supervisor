# NEW-P1-T02 Auth Web Flow Report

## Baseline

- Starting branch: `feat/new-p1-auth-identity-schema`
- Starting commit: `adbb7a9cc0e4b2b8d4d4c48af76b90a0b3e85ec2`
- Working branch: `feat/new-p1-auth-web-flow`
- Project path: `D:\Ai\staking-wallet-web`
- Legacy repository path: `D:\Ai\Staking-Wallet`
- Staging, commit, push, and pull request: not performed

## Generated Database Types

Command:

```text
npm run db:types:local
```

Generated file:

```text
src/types/database.types.ts
```

Result:

- Local database only: PASS
- Schema: `public`
- `profiles` type included: PASS
- `user_roles` type included: PASS
- Row, Insert, Update types included: PASS
- Relationship type sections included: PASS
- `private` schema excluded: PASS
- `auth` schema excluded: PASS
- Manual edit: `0`
- `any` keyword in generated file: `0`
- Reproducibility: PASS

## Supabase Client Generics

Typed clients:

- `src/lib/supabase/client.ts`: `createBrowserClient<Database>`
- `src/lib/supabase/server.ts`: `createServerClient<Database>`
- `src/lib/supabase/proxy.ts`: `createServerClient<Database>`

Result:

- Type-only `Database` imports: PASS
- Runtime type import: `0`
- Existing server `await cookies()` preserved: PASS
- Existing proxy `getClaims()` preserved: PASS
- Service Role client: `0`
- Admin client: `0`

## Local Email Confirmation

Config file:

```text
supabase/config.toml
```

Changes:

- `[auth.email].enable_signup = true`
- `[auth.email].enable_confirmations = true`
- `[auth.email.template.confirmation]` added

Template:

```text
supabase/templates/confirmation.html
```

Template result:

- Subject: `Confirm your Staking Wallet account`
- Uses `TokenHash`: PASS
- Uses `ConfirmationURL`: `0`
- External image/script/tracking: `0`
- User metadata output: `0`
- Email address output: `0`
- Token text output: `0`

Email prefetch defense:

- GET confirmation page does not call `verifyOtp()`
- User POST button is required to consume the token

## Auth Pages

Created pages:

- `/auth/sign-up`
- `/auth/sign-in`
- `/auth/check-email`
- `/auth/confirm`
- `/auth/verified`
- `/auth/error`
- `/account`

Landing page:

- Updated `/` with local Auth development links and current scope
- Fake balances, APY, staking products, Wallet Connect, Phantom, Mainnet, and investment promotion: `0`

## Auth API Routes

Created POST routes:

- `POST /api/v1/auth/sign-up`
- `POST /api/v1/auth/sign-in`
- `POST /api/v1/auth/sign-out`
- `POST /api/v1/auth/confirm`

GET mutation routes:

- Sign-out GET: `0`
- Confirmation token GET consumption: `0`

All Auth mutation responses set:

- `Cache-Control: no-store`
- `Pragma: no-cache`

## Input Validation

Validation file:

```text
src/lib/auth/validation.ts
```

Covered:

- Email trim and lowercase normalization
- Email length and basic local/domain structure
- Email control character and whitespace rejection
- Password length `12..128`
- Password control character rejection
- Display name optional handling
- Display name trim, length, and control character rejection
- Safe Auth next path allowlist

Invalid input smoke:

- Missing email: PASS
- Bad email: PASS
- Email with whitespace: PASS
- Password 11 chars: PASS
- Password 129 chars: PASS
- Password confirmation mismatch: PASS
- Display name 81 chars: PASS
- Display name control character: PASS
- External Origin: PASS
- JSON content type: PASS
- Invalid-input Auth user residual: `0`

## Same-Origin And Safe Redirect

Same-Origin helper:

```text
src/server/http/require-same-origin.ts
```

Rules:

- `Origin` required
- Origin must match request URL origin
- `Sec-Fetch-Site` must be `same-origin` or `none` when present
- CORS wildcard: `0`

Negative verification:

- No Origin: PASS
- External Origin: PASS
- Bad `Sec-Fetch-Site`: PASS

Safe redirects:

- Allowed: `/account`, `/`
- Blocked: absolute URL, protocol-relative URL, backslash path, API path
- Confirmation open redirect tests: PASS
- Unsafe values replaced with `/account`

## Public Error Boundary

Error mapping file:

```text
src/lib/auth/public-errors.ts
```

Result:

- Safe public error codes only: PASS
- Korean user messages: PASS
- Raw Supabase error in URL/UI: `0`
- Stack trace in UI: `0`
- Email existence disclosure: `0`
- Token or cookie output: `0`

## Current User And Account Page

Current user helper:

```text
src/server/auth/current-user.ts
```

Behavior:

- Uses `auth.getClaims()`: PASS
- Uses claim `sub` as user id: PASS
- `getSession()` for authorization: `0`
- Reads `profiles` through RLS: PASS
- `user_roles` browser query: `0`
- Service Role: `0`

`/account`:

- Anonymous redirect to `/auth/sign-in?next=/account`: PASS
- ACTIVE profile allowed: PASS
- Missing profile fail closed: PASS
- Restricted statuses blocked from sign-in: implemented
- Full UUID displayed: `0`
- Financial data displayed: `0`

## Local E2E Smoke

QA values:

- Email: `[REDACTED]`
- Password: `[REDACTED]`
- Token hash: `[REDACTED]`
- Cookie values: `[REDACTED]`

Public page smoke:

- `GET /`: PASS
- `GET /auth/sign-up`: PASS
- `GET /auth/sign-in`: PASS
- `GET /auth/check-email`: PASS
- `GET /auth/error`: PASS
- Secret markers: `0`

Sign-up:

- HTTP 303 to `/auth/check-email`: PASS
- Auth user created: PASS
- Profile created: PASS
- `account_status = ACTIVE`: PASS
- Active USER role count: `1`
- Active ADMIN role count: `0`
- Confirmation-before-session: PASS
- Pre-confirmation `/account` access redirects to sign-in: PASS

Pre-confirmation login:

- Rejected safely: PASS
- Session cookie created: `0`
- Still rejected after confirmation GET: PASS

Mailpit:

- Confirmation email received: PASS
- Subject: `Confirm your Staking Wallet account`
- Link host: `localhost`
- Link path: `/auth/confirm`
- `token_hash` parameter exists: PASS
- `type=email`: PASS
- `next=/account`: PASS

Confirmation GET:

- HTTP 200: PASS
- `verifyOtp()` not called: PASS
- Email not confirmed after GET: PASS
- Session cookie after GET: `0`
- Token visible text: `0`
- Hidden token field only: PASS
- Noindex marker: PASS
- No-referrer marker: PASS

Confirmation POST:

- HTTP 303: PASS
- Redirect to `/auth/verified?next=/account`: PASS
- Session cookie created: PASS
- Email confirmed: PASS
- Profile exists: PASS
- `account_status = ACTIVE`: PASS
- Active USER role count: `1`
- Active ADMIN role count: `0`

Verified and account:

- `GET /auth/verified?next=/account`: PASS
- `GET /account`: PASS
- Own profile read: PASS
- Full UUID exposed: `0`
- Secret markers: `0`

Logout:

- POST logout HTTP 303: PASS
- Redirect to `/auth/sign-in`: PASS
- `/account` after logout redirects to sign-in: PASS
- Repeated logout safe: PASS

Login:

- Confirmed user login HTTP 303: PASS
- Redirect to `/account`: PASS
- Session cookie created: PASS
- Account page HTTP 200: PASS
- Wrong password returns generic invalid credentials: PASS
- Missing email returns same generic invalid credentials: PASS
- Enumeration equivalence: PASS

Duplicate signup:

- Safe non-enumerating response: PASS
- Auth user count remains `1`
- Profile count remains `1`
- Active USER role count remains `1`
- Active ADMIN role count remains `0`

## Final Database Validation

Final reset:

- `npm run db:reset:local`: PASS
- QA Auth user residual: `0`
- QA Profile residual: `0`
- QA Role residual: `0`

Final DB lint:

- `npm run db:lint:local`: PASS
- Errors: `0`
- Warnings: `0`

Final pgTAP:

- `npm run db:test:local`: PASS
- Files: `1`
- Tests: `88`

Final type generation:

- `npm run db:types:local`: PASS
- Generated type unchanged: PASS

## Next.js Validation

Results:

- `npm run lint`: PASS
- Lint warnings: `0`
- `npm run build`: PASS
- TypeScript errors: `0`
- Build warnings: `0`
- Next.js 16 async `searchParams`: PASS
- Proxy build: PASS
- Route conflicts: `0`

Production smoke:

- `GET /api/v1/health`: PASS
- `GET /api/v1/readiness/config`: PASS
- `GET /`: PASS
- `GET /auth/sign-up`: PASS
- `GET /auth/sign-in`: PASS
- `GET /account` unauthenticated redirect: PASS
- Secret or token markers: `0`

## Remote And Service Role Boundary

Remote Supabase commands:

- `supabase login`: `0`
- `supabase link`: `0`
- `supabase db pull`: `0`
- `supabase db push`: `0`
- `supabase secrets set`: `0`

Application Service Role client: `0`

Admin API: `0`

Actual SMTP credential: `0`

OAuth: `0`

## Dependency And Advisory State

New packages installed: `0`

`package-lock.json` changed: `0`

`npm audit fix`: not run

Current advisory status:

- Moderate: `2`
- High: `0`
- Critical: `0`

## Secret And Token Scan

Tracked files and build output were checked for:

- `SUPABASE_SERVICE_ROLE`
- `SUPABASE_SECRET_KEY`
- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `JWT_SECRET`
- `ACCESS_TOKEN`
- `REFRESH_TOKEN`
- private key block marker
- `PRIVATE_KEY`
- `MNEMONIC`
- QA email
- QA password
- token hash
- session cookie
- local anon key

Results:

- Tracked actual secrets: `0`
- Report credential values: `0`
- Application Service Role Client: `0`

Allowed:

- Variable names in documentation
- `[REDACTED]`
- Template placeholder `{{ .TokenHash }}`
- Git-ignored `.env.local`

## Docker Bind Warning

Supabase CLI again reported the Windows local development warning that local services can bind to all host interfaces.

This remains local-development-only and is not a remote Supabase connection. Local network hardening remains a separate follow-up.

## Legacy Repository

Legacy path:

```text
D:\Ai\Staking-Wallet
```

Result:

- Branch changed: `0`
- Files changed: `0`
- Working tree status: clean

## Changed Files

Commit candidate files:

- `package.json`
- `README.md`
- `supabase/config.toml`
- `supabase/templates/confirmation.html`
- `src/types/database.types.ts`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/proxy.ts`
- `src/lib/auth/validation.ts`
- `src/lib/auth/public-errors.ts`
- `src/server/http/require-same-origin.ts`
- `src/server/auth/form-data.ts`
- `src/server/auth/current-user.ts`
- `src/app/page.tsx`
- `src/app/account/page.tsx`
- `src/app/auth/sign-up/page.tsx`
- `src/app/auth/sign-in/page.tsx`
- `src/app/auth/check-email/page.tsx`
- `src/app/auth/confirm/page.tsx`
- `src/app/auth/verified/page.tsx`
- `src/app/auth/error/page.tsx`
- `src/app/api/v1/auth/sign-up/route.ts`
- `src/app/api/v1/auth/sign-in/route.ts`
- `src/app/api/v1/auth/sign-out/route.ts`
- `src/app/api/v1/auth/confirm/route.ts`
- `docs/03-auth/AUTH_WEB_FLOW.md`
- `docs/09-governance/NEW_P1_T02_AUTH_WEB_FLOW_REPORT.md`

Forbidden file changes:

- `package-lock.json`: `0`
- `.env.example`: `0`
- `.env.local`: `0`
- `supabase/seed.sql`: `0`
- `supabase/migrations/**`: `0`
- `supabase/tests/database/auth_identity.test.sql`: `0`
- `src/server/config/env.ts`: `0`
- `src/lib/config/public-env.ts`: `0`
- health/readiness routes: `0`
- `src/proxy.ts`: `0`
- `next.config.*`: `0`
- `tsconfig.json`: `0`
- `eslint.config.*`: `0`
- `postcss.config.*`: `0`

## Commit Readiness

Commit possible: yes, after user review and explicit approval.

Current task status: PASS.

Next task candidates:

- Commit this Auth Web Flow change
- Add generated DB type drift check to CI
- Implement password reset
- Define server-side ADMIN guard and MFA policy
