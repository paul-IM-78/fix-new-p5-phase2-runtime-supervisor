# NEW-P2-T04 Phase 2 Closeout Report

## Baseline

- Start branch: `feat/new-p2-wallet-status-user-reads`
- Start commit: `cdb2d78f393d8a03bdc3e6fcbd651980b955f38e`
- Work branch: `feat/new-p2-user-dashboard-closeout`
- Legacy repository: read-only clean check only

## Scope

- Database changes: 0
- Migration changes: 0
- pgTAP test changes: 0
- Generated database type changes: 0
- Package additions: 0
- Package lock changes: 0
- Remote Supabase connections: 0
- Service-role application client: 0
- Mainnet or production connectivity: 0

## Dashboard Helper

`src/server/dashboard/current-dashboard.ts` adds a server-only dashboard
reader. It creates one server Supabase client, calls
`inspectAccountAccess(supabase)`, and then reads the current user's own managed
wallet account plus active catalog metadata through normal RLS-bound public
table selects.

The helper does not use `getSession()`, auth metadata, `user_roles`, admin read
RPCs, MFA factors, raw AAL claims, a browser client, service-role access, or RLS
bypass. It returns `unavailable` when more than one active project is returned,
when the current user has more than one wallet row, when non-active catalog
rows are returned, or when a current assignment cannot be joined to the
returned project and asset metadata.

## Dashboard Page

`src/app/dashboard/page.tsx` adds a dynamic server component with noindex and
nofollow metadata. It redirects anonymous users to
`/auth/sign-in?next=/dashboard`, inactive profiles to
`/auth/account-unavailable`, missing wallet containers to
`/auth/error?code=account_unavailable`, and unavailable states to
`/auth/error?code=auth_unavailable`.

The page displays:

- Profile display name or a generic user label
- Profile ACTIVE state and profile version
- Managed wallet custody model, status, version, update time, and closed time
- ACTIVE, FROZEN, and CLOSED operational copy
- Active project metadata with code, name, description, and version
- Active supported assets with code, symbol, type, decimals, shortened mint, and version
- Current project token assignment by project code, token symbol, token name, and assigned time
- Empty states for no active project and no current project token assignment

It does not display full user, wallet, project, asset, or assignment UUIDs. It
does not display a full mint. It does not include financial UI, wallet adapter,
Phantom, private key, mnemonic, client signing, on-chain transaction, deposit,
withdrawal, or staking controls.

## Safe Redirect

`src/lib/auth/validation.ts` extends the safe auth next-path allowlist to:

- `/`
- `/account`
- `/dashboard`
- `/catalog`
- `/wallet`
- `/admin`

Arbitrary `/admin/**`, `/api/**`, absolute URLs, protocol-relative URLs,
backslashes, control characters, `javascript:`, external hosts, and query-based
internal path injection remain blocked by exact allowlist matching.

## Navigation

- Landing page now links to `/dashboard` and describes the integrated user view.
- Account page now links to `/dashboard`, `/catalog`, and `/wallet`.
- Catalog page now links to `/dashboard`, `/account`, and `/wallet` and
  preserves `/catalog` for anonymous login return.
- Wallet page now links to `/dashboard`, `/account`, and `/catalog` and
  preserves `/wallet` for anonymous login return.
- No user page queries roles or conditionally renders admin navigation.

## Phase 2 Closeout Script

`scripts/phase/phase2-closeout.local.mjs` adds a local closeout command:

```bash
npm run test:phase2:closeout:local
```

The script checks local preconditions, runs the existing Auth, ADMIN MFA,
ADMIN role command, domain lifecycle, and wallet status E2E scripts, and then
runs dashboard-specific E2E coverage. It resets the local database between
existing fixed-fixture scripts so their deterministic QA data does not collide.

Dashboard E2E covers public and anonymous routing, safe redirect negative
cases, signup and email confirmation, empty dashboard state, local catalog
fixture state, FROZEN/CLOSED wallet display after an initial ACTIVE wallet
state, inactive profile blocking, RLS zero-row checks, relation fail-closed
source checks, and credential-output guards. QA email, password, token, cookie,
UUID, and mint values are held in process memory only and are not printed.

During repeated local resets, Kong retained a stale Auth upstream address after
the Auth container was recreated. The closeout script now restarts only the
local project Kong container after each local DB reset and rechecks readiness.
No other Supabase project containers are modified by that command.

## Security Boundary

- Application service role: absent
- Database URL in application config: absent
- Remote Supabase project: absent
- Mainnet credential: absent
- Browser financial write path: absent
- User-role query in dashboard: absent
- Admin read RPC in dashboard: absent
- Raw cookie, token, JWT, TOTP, UUID, and mint output: absent
- Financial display values: absent

## Validation

| Check | Result |
| --- | --- |
| Baseline DB reset | PASS |
| Baseline DB lint | PASS |
| Baseline pgTAP | PASS, 6 files / 425 tests |
| Baseline generated types | PASS, diff 0 |
| Baseline Next.js lint | PASS |
| Baseline Next.js build | PASS |
| Final DB reset | PASS |
| Final DB lint | PASS, error 0 / warning 0 |
| Final pgTAP | PASS, 6 files / 425 tests |
| Final generated types | PASS, diff 0 |
| Final Next.js lint | PASS, warning 0 |
| Final Next.js build | PASS, warning 0, `/dashboard` present |
| Phase 2 closeout script | PASS |
| Production smoke | PASS |
| Local stack and process cleanup | PASS, Next process stopped, Supabase stopped, ports 3000 and 55721-55724 free |
| QA data residue | PASS, all checked counts 0 |
| Secret and financial boundary scan | PASS, marker references only in local scan guard strings |
| Dependency advisory status | Existing 2 moderate advisories retained; no fix attempted |

## Residual Risks

- Moderate dependency advisories remain intentionally unfixed because
  `npm audit fix` and dependency updates are outside this task.
- Local Docker on Windows may continue to emit bind-mount or filesystem
  performance warnings unrelated to application behavior.
- Local Supabase `db reset` can recreate Auth with a new container address
  while Kong remains up; the closeout script refreshes this project's Kong
  container after reset to avoid stale Auth upstream failures.
- Phase 3 must design the ledger, balance, deposit, withdrawal, staking,
  reward, blockchain transaction, address, and production credential boundary
  before any financial functionality is added.

## Commit Readiness

Commit candidate is ready from the validation perspective. Staging, commit,
push, PR, main merge, and next-task automation were not performed.
