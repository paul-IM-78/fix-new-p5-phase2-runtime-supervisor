# NEW-P0-T02 Supabase Boundary Report

## Baseline

- Starting branch: `chore/new-p0-project-baseline`
- Starting commit: `91e29550111e3d1fe8d8a83f777d9918104558f5`
- Working branch: `chore/new-p0-supabase-boundary`
- Project path: `D:\Ai\staking-wallet-web`
- Legacy project path: `D:\Ai\Staking-Wallet`
- Existing health route: preserved at `src/app/api/v1/health/route.ts`
- Staging, commit, push, and pull request: not performed

## Package Installation

Command run:

```text
npm install @supabase/supabase-js @supabase/ssr
```

Installed direct dependencies:

- `@supabase/ssr@0.12.3`
- `@supabase/supabase-js@2.110.7`

Observed install notes:

- `package.json`: direct dependency additions only
- `package-lock.json`: Supabase dependency tree additions only
- Peer dependency warnings: none observed
- Deprecated package warnings: none observed
- Security warnings: npm reported 2 moderate vulnerabilities
- Existing package removals: none observed
- `npm audit fix`: not run

Forbidden dependency check:

- Solana wallet adapter packages: `0`
- Solana web3 or token packages: `0`
- BIP39, signing, Expo, and React Native packages: `0`
- Supabase CLI, ORM, validation library, and Auth UI packages: `0`

## Environment Boundary

Allowed variables for this task:

- `APP_ENV`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

`APP_ENV` accepts only:

- `local`
- `preview`
- `production`

Public Supabase values are browser configuration only and are not privileged credentials. No service-role key, database URL, private key, mnemonic, RPC credential, or production credential was added.

`.env.example` contains placeholders only. No real `.env` or `.env.local` file exists in the repository root.

## Public Env Validator

File: `src/lib/config/public-env.ts`

Implemented behavior:

- Direct static access to `process.env.NEXT_PUBLIC_SUPABASE_URL`
- Direct static access to `process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Missing and blank values fail closed
- URL parsing uses the platform `URL` API
- URL username and password are rejected
- URL query and hash are rejected
- Remote HTTP URLs are rejected
- Local HTTP URLs for `localhost` and `127.0.0.1` are allowed
- HTTPS URLs are allowed
- Trailing slash normalization is deterministic
- Error code is safe and does not include raw values
- No Supabase network call is made
- No dynamic environment lookup or full `process.env` iteration is used

Public env negative validation:

| Case | Result |
| --- | --- |
| Missing URL | PASS, failed closed |
| Missing publishable key | PASS, failed closed |
| Blank publishable key | PASS, failed closed |
| Malformed URL | PASS, failed closed |
| Remote HTTP URL | PASS, failed closed |
| URL credentials | PASS, failed closed |
| URL query | PASS, failed closed |
| URL hash | PASS, failed closed |
| Local HTTP URL | PASS, allowed |
| HTTPS URL | PASS, allowed |

## Server Env Validator

File: `src/server/config/env.ts`

Implemented behavior:

- Uses `import "server-only";`
- Validates `APP_ENV`
- Reuses the public environment validator
- Fails closed for missing or unsupported values
- Does not default to local or production
- Does not inspect client requests to decide environment
- Does not add service-role or database settings
- Performs lazy validation only when called

## Supabase Browser Client

File: `src/lib/supabase/client.ts`

Status: scaffold complete.

Implemented boundary:

- Uses `import "client-only";`
- Uses `createBrowserClient` from `@supabase/ssr`
- Uses only the public URL and publishable key
- Creates the client only when the exported function is called
- Does not call Auth
- Does not query a database
- Does not use Wallet Adapter or Solana packages
- Does not directly manage local storage financial state
- Does not use `any`

## Supabase Server Client

File: `src/lib/supabase/server.ts`

Status: scaffold complete.

Implemented boundary:

- Uses `import "server-only";`
- Uses `createServerClient` from `@supabase/ssr`
- Uses `cookies` from `next/headers`
- Uses Next.js 16 async cookie access with `await cookies()`
- Implements `getAll` through `cookieStore.getAll()`
- Implements `setAll` through `cookieStore.set()`
- Handles known no-write cookie contexts without hiding unrelated errors
- Records in code that Auth session refresh belongs in a later proxy task
- Does not create an admin client
- Does not use service-role credentials
- Does not query a database
- Does not call Auth
- Does not make a network request during module import
- Does not log cookie names or values
- Does not use `any`

## Config Readiness Route

File: `src/app/api/v1/readiness/config/route.ts`

Implemented behavior:

- `runtime = "nodejs"`
- `dynamic = "force-dynamic"`
- `Cache-Control: no-store`
- Valid configuration returns HTTP 200 with `status=ready`
- Invalid configuration returns HTTP 503 with `code=ENVIRONMENT_CONFIGURATION_INVALID`
- Existing liveness route is unchanged
- Does not create a Supabase client
- Does not call Supabase Auth, REST, or database APIs
- Does not read cookies
- Does not expose URL, key, token, file path, stack trace, or raw error object values

## Runtime Validation

Latest validation was run after the final source change.

| Check | Result |
| --- | --- |
| `npm run lint` | PASS, warnings 0 |
| `npm run build` | PASS, TypeScript errors 0, warnings 0 |
| Health smoke | PASS, HTTP 200, `status=ok`, `Cache-Control=no-store` |
| Config readiness smoke | PASS, HTTP 200, `status=ready`, `environment=local`, configured=true |
| Invalid `APP_ENV` | PASS, health 200, readiness 503, safe code only |
| Missing `APP_ENV` | PASS, health 200, readiness 503, safe code only |

The production runtime smoke used a temporary local port and stopped the process after validation.

## Supabase Network Calls

Actual Supabase network calls: `0`.

Evidence:

- Readiness route imports only environment validation modules
- Browser client creation function is not called by UI or routes
- Server client creation function is not called by readiness or health routes
- No Auth API calls were added
- No database queries were added
- No external project URL is configured

## Secret Scan

Changed files and build outputs were scanned for service-role markers, Supabase secret markers, database URL markers, private-key markers, mnemonic markers, secret-key markers, and PEM private-key headers.

Results:

- Actual secrets: `0`
- Service-role environment values: `0`
- Service-role client modules: `0`
- Database URL values: `0`
- Client bundle server-only module exposure: `0`
- Real `.env` files: `0`

The public publishable-key variable name exists by design. Placeholder values were not treated as secrets.

## Legacy Repository

Legacy repository path: `D:\Ai\Staking-Wallet`

Read-only check result:

- Legacy repository status: clean
- Legacy files changed by this task: `0`
- Legacy files copied into this project: `0`
- Direct import of legacy repository files: `0`

## Changed Files

- `.env.example`
- `README.md`
- `package.json`
- `package-lock.json`
- `src/lib/config/public-env.ts`
- `src/server/config/env.ts`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/app/api/v1/readiness/config/route.ts`
- `docs/09-governance/NEW_P0_T02_SUPABASE_BOUNDARY_REPORT.md`

Forbidden files changed:

- `src/app/layout.tsx`: `0`
- `src/app/page.tsx`: `0`
- `src/app/globals.css`: `0`
- `src/app/api/v1/health/route.ts`: `0`
- `next.config.*`: `0`
- `tsconfig.json`: `0`
- `eslint.config.*`: `0`
- `postcss.config.*`: `0`

## Git Diff Summary

Tracked diff before this report:

```text
.env.example      |   5 ++-
README.md         |  40 +++++++++++++++++-
package-lock.json | 120 ++++++++++++++++++++++++++++++++++++++++++++++++++++++
package.json      |   2 +
```

New source and report files:

```text
src/app/api/v1/readiness/config/route.ts
src/lib/config/public-env.ts
src/lib/supabase/client.ts
src/lib/supabase/server.ts
src/server/config/env.ts
docs/09-governance/NEW_P0_T02_SUPABASE_BOUNDARY_REPORT.md
```

## Required Limitations

```text
Supabase Browser Client:
Scaffold complete

Supabase Server Client:
Scaffold complete

Actual Supabase Project:
Not connected

Auth Proxy:
Not implemented

Cookie Session Refresh:
Not implemented

Sign up and login:
Not implemented

Auth Callback:
Not implemented

Profile and Role:
Not implemented

Service Role:
Not implemented

Database, Migration, and RLS:
Not implemented

Financial Features:
Not implemented
```

## Next Task Candidates

- Auth proxy and cookie session refresh
- Sign up, login, and callback routes
- Profile and role schema planning
- npm security advisory triage without forced upgrades

## Commit Readiness

Commit possible: yes, after user review and explicit approval.

Current task status: PASS.
