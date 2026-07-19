# NEW-P0-T03 Auth Proxy Boundary Report

## Baseline

- Starting branch: `chore/new-p0-supabase-boundary`
- Starting commit: `46d8e73b3531b4a87289a8fb85a92edac7ecd138`
- Working branch: `chore/new-p0-auth-proxy`
- Project path: `D:\Ai\staking-wallet-web`
- Legacy project path: `D:\Ai\Staking-Wallet`
- Staging, commit, push, and pull request: not performed

## Created Files

- `src/proxy.ts`
- `src/lib/supabase/proxy.ts`
- `docs/09-governance/NEW_P0_T03_AUTH_PROXY_REPORT.md`

Updated file:

- `README.md`

## Next.js 16 Proxy Entry

File: `src/proxy.ts`

Result:

- Uses the Next.js 16 `proxy` function export
- Does not create `middleware.ts`
- Does not add a separate runtime override
- Delegates request handling to `updateSession(request)`
- Build output recognizes the file as `Proxy (Middleware)`

## Proxy Matcher

Configured matcher:

```text
/((?!_next/static|_next/image|favicon.ico|api/v1/health|api/v1/readiness/config|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf)$).*)
```

Matcher validation:

| Path | Expected | Result |
| --- | --- | --- |
| `/` | match | PASS |
| `/dashboard` | match | PASS |
| `/api/private` | match | PASS |
| `/api/v1/health` | excluded | PASS |
| `/api/v1/readiness/config` | excluded | PASS |
| `/_next/static/chunk.js` | excluded | PASS |
| `/_next/image?url=x` | excluded | PASS |
| `/favicon.ico` | excluded | PASS |
| `/logo.png` | excluded | PASS |
| `/font.woff2` | excluded | PASS |
| `/styles.css` | excluded | PASS |

Health and config readiness are excluded so that liveness and configuration checks remain independent of the Auth provider.

## Supabase Proxy Utility

File: `src/lib/supabase/proxy.ts`

Implemented behavior:

- Uses `createServerClient` from `@supabase/ssr`
- Uses `NextResponse` and `NextRequest` from `next/server`
- Reuses `getPublicEnv()`
- Does not import `server-only`
- Creates a per-request Supabase SSR client
- Calls `await supabase.auth.getClaims()` early in the request lifecycle
- Does not call `getSession()` for authorization decisions
- Does not call `getUser()`
- Does not read claims into headers or response bodies
- Does not log token, cookie, or claim values
- Does not redirect
- Does not perform role checks

## Cookie Synchronization

Cookie adapter behavior:

- `getAll` returns `request.cookies.getAll()`
- `setAll` updates `request.cookies`
- `setAll` rebuilds `NextResponse.next({ request })` after request cookie mutation
- `setAll` writes the same cookies to `response.cookies`
- Supabase-provided cookie options are preserved
- Supabase-provided response headers are preserved

Response preservation note:

- Current task does not implement redirects
- Future redirect responses must preserve cookies from the proxy response

## Proxy Responsibility Boundary

Proxy responsibilities:

- Cookie session refresh
- Request and response cookie synchronization
- Basic Auth boundary initialization through `getClaims()`

Proxy non-responsibilities:

- Final user identity decision
- USER or ADMIN role decision
- Account status decision
- Financial command authorization
- RLS replacement
- Database business rules
- Protected page redirect policy

Authorization must still be implemented in later route handlers, server guards, and database policies.

## Existing Server Client Boundary

File checked: `src/lib/supabase/server.ts`

Result:

- Existing file was not changed
- Uses Next.js 16 `await cookies()`
- Uses the publishable key only
- Does not use service-role credentials
- Remains separate from the Proxy cookie adapter
- Suitable for Route Handler, Server Component, and future Server Action use

## Dependency Boundary

Dependency changes in this task: `0`.

Confirmed:

- `@supabase/ssr@0.12.3` retained
- `@supabase/supabase-js@2.110.7` retained
- `package.json` changed: `0`
- `package-lock.json` changed: `0`
- Package install: not run
- `npm audit fix`: not run
- Existing moderate npm advisory count from the prior task remains documented as 2 and is a separate follow-up

## Validation

Latest validation was run after the final source change.

| Check | Result |
| --- | --- |
| `npm run lint` | PASS, warnings 0 |
| `npm run build` | PASS, TypeScript errors 0, warnings 0 |
| Next.js Proxy convention | PASS, build recognized `Proxy (Middleware)` |
| Matcher structure | PASS |
| Health smoke | PASS, HTTP 200, `status=ok`, `Cache-Control=no-store` |
| Readiness smoke | PASS, HTTP 200, `status=ready`, `environment=local` |
| Non-authenticated `/` request | PASS, HTTP 200 |

Runtime smoke scope:

- Production server was started on a temporary local port
- `APP_ENV=local` was passed as a process-scoped variable
- Public Supabase placeholders came from the build-time environment
- The temporary server process was stopped after validation
- Supabase Local Stack was not started
- Real authenticated token refresh was not tested because no real Supabase project or session exists

## Runtime Exposure Check

Observed during smoke:

- `/` response contained access-token text: `false`
- `/` response contained refresh-token text: `false`
- `/` response contained stack trace marker: `false`
- Server logs contained local placeholder URL: `false`
- Server logs contained access-token text: `false`
- Server logs contained refresh-token text: `false`

Health and readiness requests completed without observable Supabase network output and without exposing token, cookie, or claim values.

## Secret and Token Scan

Changed files:

- Secret marker matches: `0`
- Token assignment marker matches: `0`
- Service-role client implementation: `0`
- Actual Supabase project URL: `0`

Build output:

- Runtime JavaScript secret marker matches: `0`
- Source map contains one vendor documentation example marker from `@supabase/auth-js`
- The source-map marker is not an assigned value, not project code, and not a service-role client implementation
- Actual secrets in build output: `0`
- Actual token values in build output: `0`

## Real Supabase Network Scope

Actual Supabase project connection: `0`.

Allowed observation:

- A non-authenticated `/` request was made against the placeholder local URL configuration
- The request returned HTTP 200 without starting Supabase Local Stack

Not performed:

- Remote Supabase host connection
- Auth API validation against a real project
- Real user session verification
- Real access token or refresh token handling
- Database query

## Legacy Repository

Legacy repository path: `D:\Ai\Staking-Wallet`

Read-only check result:

- Legacy repository status: clean
- Legacy files changed by this task: `0`
- Legacy files copied into this project: `0`

## Git Status

Expected changed files:

```text
README.md
src/lib/supabase/proxy.ts
src/proxy.ts
docs/09-governance/NEW_P0_T03_AUTH_PROXY_REPORT.md
```

Forbidden changes:

- `package.json`: `0`
- `package-lock.json`: `0`
- `.env.example`: `0`
- Existing Supabase env and client scaffold files: `0`
- Existing health and readiness routes: `0`
- `src/app/layout.tsx`: `0`
- `src/app/page.tsx`: `0`
- Legacy repository: `0`

## Limitations

Still not implemented:

- Sign up
- Login and logout
- Auth callback
- Password reset
- Protected page redirects
- User profile
- USER and ADMIN roles
- Admin authorization
- MFA and recent re-authentication
- Database, migration, and RLS
- Service-role client
- Financial APIs
- Real Supabase project connection

## Commit Readiness

Commit possible: yes, after user review and explicit approval.

Current task status: PASS.
