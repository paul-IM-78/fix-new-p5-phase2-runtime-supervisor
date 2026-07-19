# NEW-P0-T01-R1 Project Baseline Report

## Summary

Final status: `PASS`

The `create-next-app` automatic initial commit was preserved unchanged. The default branch was renamed from `master` to `main`, and baseline work was performed on `chore/new-p0-project-baseline`.

## Repositories

- New project path: `D:\Ai\staking-wallet-web`
- Legacy project path: `D:\Ai\Staking-Wallet`
- Legacy repository status: unchanged and clean
- Legacy source copied: no

## Git Baseline

- Automatic baseline commit: `c28cfcb725d854f157692d1ed79e9a1a71147c27`
- Automatic baseline commit message: `Initial commit from Create Next App`
- Commit count at start: `1`
- Default branch rename: `master` to `main`
- Working branch: `chore/new-p0-project-baseline`
- Staging performed: no
- Commit performed: no
- Push or pull request performed: no

## Create Command

Equivalent command:

```text
npx create-next-app@latest staking-wallet-web --typescript --eslint --tailwind --app --src-dir --use-npm --import-alias "@/*" --yes
```

Generated template:

- App Router
- TypeScript
- ESLint
- Tailwind CSS
- `src` directory
- npm
- Import alias `@/*`

## Package Versions

Installed top-level package versions:

- Next.js: `16.2.10`
- React: `19.2.4`
- React DOM: `19.2.4`
- TypeScript: `5.9.3`
- ESLint: `9.39.5`
- Tailwind CSS: `4.3.3`
- Node: `v24.14.1`
- npm: `11.11.0`

Package manager lock file:

- `package-lock.json`

Package changes in R1:

- package install: none
- package removal: none
- package version change: none

## Generated Structure

Key generated files and directories:

- `src/app`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`
- `next.config.ts`
- `tsconfig.json`
- `eslint.config.mjs`
- `postcss.config.mjs`
- `package.json`
- `package-lock.json`
- `public`

Runtime notes:

- App Router is enabled.
- The project uses `src`.
- Import alias is `@/*` mapped to `./src/*`.
- `next.config.ts` does not configure static export.
- No nginx or Dockerfile exists in this task.

## Forbidden Dependency Check

Result: `PASS`

The package manifest and lockfile were checked for Solana wallet, Expo, React Native, mnemonic, signing, and Supabase packages. Exact package matches found: `0`.

Supabase is intentionally not installed in this baseline task.

## `.gitignore`

Updated `.gitignore` with missing build, log, environment, OS, and key-candidate exclusions.

Notable policy:

- `.env.example` is explicitly allowed.
- Broad patterns such as all mnemonic-like filenames or all key-like extensions were not added.
- Existing generated Next.js, dependency, and Vercel ignore rules were preserved.

## Environment Example

Created:

- `.env.example`

The file contains placeholder-only values for:

- `APP_ENV`
- public Supabase URL placeholder
- public Supabase publishable key placeholder

Actual environment files were not created.

## Health Route

Created:

- `src/app/api/v1/health/route.ts`

Route:

- `GET /api/v1/health`

Properties:

- Node runtime
- force dynamic
- no authentication
- no Supabase call
- no database call
- no external network call
- `Cache-Control: no-store`
- JSON liveness response only

## Project Boundary

Created:

- `docs/00-product/PROJECT_BOUNDARY.md`

The document records:

- this repository as the active managed staking wallet web app
- the legacy repository as reference-only
- new product rules
- prohibited legacy reuse
- no direct import or copy of legacy wallet, Phantom, signing, self-custody, mainnet default RPC, or localStorage financial-state flows

## README

Updated:

- `README.md`

The README now documents:

- project name
- current phase
- stack
- commands
- health route
- repository boundary
- not-yet-implemented Supabase, Auth, DB, RLS, ledger, financial, production, and mainnet features

## Validation

Lint command:

```text
npm run lint
```

Lint result: `PASS`

Warnings: none

Build command:

```text
npm run build
```

Build result: `PASS`

Warnings: none

Build output confirmed:

- `/api/v1/health` exists as a dynamic route.
- TypeScript completed with zero errors.

## Runtime Smoke

Production server smoke result: `PASS`

Checked:

- `GET /api/v1/health`
- HTTP `200`
- `status = ok`
- `service = staking-wallet-web`
- `runtime = node`
- valid ISO timestamp
- `Cache-Control = no-store`
- no secret, file path, stack trace, or environment value in response

The temporary server process was stopped after verification.

## Secret Check

Result: `PASS`

Tracked candidates and new source files were scanned for service-role, database URL, private key, mnemonic, and secret-key indicators. Actual secret matches: `0`.

Personal key matches: `0`

Mnemonic matches: `0`

Service-role matches: `0`

## Changed Files

- `.gitignore`
- `.env.example`
- `src/app/api/v1/health/route.ts`
- `docs/00-product/PROJECT_BOUNDARY.md`
- `docs/09-governance/NEW_P0_T01_PROJECT_BASELINE_REPORT.md`
- `README.md`

## Git Diff

Tracked diff before this report:

```text
.gitignore | 14 ++++++++++++++
README.md  | 62 ++++++++++++++++++++++++++++++++++++++++++--------------------
2 files changed, 56 insertions(+), 20 deletions(-)
```

Additional untracked files:

- `.env.example`
- `docs/00-product/PROJECT_BOUNDARY.md`
- `docs/09-governance/NEW_P0_T01_PROJECT_BASELINE_REPORT.md`
- `src/app/api/v1/health/route.ts`

## Commit Readiness

Commit possible: `YES`

Reason:

- baseline commit was preserved
- branch is `chore/new-p0-project-baseline`
- `main` branch exists
- working tree changes are limited to allowed files
- forbidden dependency check passed
- lint passed
- build passed
- health smoke passed
- secret scan passed
- legacy repository was not modified
- staging, commit, push, and pull request were not performed

## Next Task Candidates

- Commit the NEW-P0-T01-R1 baseline changes after approval.
- Add server runtime Docker configuration in a later scoped task.
- Add public/server environment validation in a later scoped task.
- Add Supabase client boundary only after dependency policy is approved.
