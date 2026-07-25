# NEW-P5-SEC-05B Dev Dependency Security Report

## Scope

- Project: staking wallet web
- Worktree: `D:\Ai\staking-wallet-web-sec05b`
- Branch: `fix/new-p5-dev-dependency-security`
- Baseline HEAD: `5ef4fa0bccdc0079d1590ed2eadb3772c05b9606`
- Baseline subject: `fix: update postcss security patch`
- Existing worktrees: preserved; read-only status/list checks only
- Legacy repository: read-only status check only; clean
- Runtime E2E, Phase closeout, Custody Boundary, P5-T02: not run
- Staging, commit, push, PR: not run

## Existing Report Intake

- Existing report path: `docs/09-governance/NEW_P5_SEC_05B_DEV_DEPENDENCY_SECURITY_REPORT.md`
- Existing report size before resume: `6719` bytes
- Existing report SHA-256 before resume: `2b5a47460dedfaa5e81503fd6dc6f88754daec7a287270a5bfcef922946fd60c`
- Existing report title: `# NEW-P5-SEC-05B Dev Dependency Security Report`
- `SEC05B_EXISTING_REPORT_PRESENT=true`
- `SEC05B_EXISTING_REPORT_SCOPE_MATCH=true`
- `SEC05B_EXISTING_REPORT_SECRET_COUNT=0`
- `SEC05B_EXISTING_REPORT_FOREIGN_PROJECT_CONTENT=false`

The existing report was a same-task partial report and was updated in place. No new report file was created.

## Package Baseline

- Next.js: `16.2.11`
- React: `19.2.4`
- React DOM: `19.2.4`
- ESLint direct dependency range: `^9`
- Installed ESLint before patch: `9.39.5`
- Installed ESLint after patch: `9.39.5`
- `eslint-config-next`: `16.2.10`
- Supabase CLI: `2.109.1`
- Next-scoped sharp override: `0.35.3`
- Next-scoped PostCSS override: `8.5.18`

Maintained versions:

- Next.js stayed `16.2.11`
- React stayed `19.2.4`
- React DOM stayed `19.2.4`
- sharp override stayed `0.35.3`
- PostCSS override stayed `8.5.18`
- Supabase CLI stayed `2.109.1`
- ESLint major stayed `9`

## Starting Audit

After fresh `npm ci`:

- `npm ci`: PASS
- Production audit:
  - moderate: 0
  - high: 0
  - critical: 0
- Full audit:
  - moderate: 0
  - high: 9
  - critical: 0

PostCSS advisory `GHSA-r28c-9q8g-f849` remained removed.

## High 9 Analysis

Unique direct advisory:

- Advisory: `GHSA-mh99-v99m-4gvg`
- npm source id: `1124334`
- Package: `brace-expansion`
- Title: `brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash`
- Severity: high
- Affected range: `<=5.0.7`

Initial vulnerable package nodes:

- `node_modules/brace-expansion@1.1.16`
- `node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion@5.0.7`

npm audit meta-vulnerability entries:

- `minimatch`
- `eslint`
- `@eslint/config-array`
- `@eslint/eslintrc`
- `eslint-config-next`
- `eslint-plugin-import`
- `eslint-plugin-jsx-a11y`
- `eslint-plugin-react`

Breakdown:

- Unique advisory count: 1
- Direct vulnerable package type: `brace-expansion`
- Initial vulnerable package node count: 2
- Meta-vulnerability package count: 8
- npm full audit high count: 9
- Duplicate advisory aggregation: the same `brace-expansion` advisory was propagated through ESLint and Next ESLint config dependency chains.

## Dependency Chain

Starting ESLint chain:

- root project -> `eslint@9.39.5`
- `eslint@9.39.5` -> `@eslint/config-array@0.21.2` -> `minimatch@3.1.5` -> `brace-expansion@1.1.16`
- `eslint@9.39.5` -> `@eslint/eslintrc@3.3.6` -> `minimatch@3.1.5` -> `brace-expansion@1.1.16`
- `eslint@9.39.5` -> `minimatch@3.1.5` -> `brace-expansion@1.1.16`

Starting Next ESLint config plugin chain:

- root project -> `eslint-config-next@16.2.10`
- `eslint-config-next@16.2.10` -> `eslint-plugin-import@2.32.0` -> `minimatch@3.1.5` -> `brace-expansion@1.1.16`
- `eslint-config-next@16.2.10` -> `eslint-plugin-jsx-a11y@6.10.2` -> `minimatch@3.1.5` -> `brace-expansion@1.1.16`
- `eslint-config-next@16.2.10` -> `eslint-plugin-react@7.37.5` -> `minimatch@3.1.5` -> `brace-expansion@1.1.16`

Starting TypeScript ESLint chain:

- `eslint-config-next@16.2.10` -> `typescript-eslint@8.64.0` -> `@typescript-eslint/typescript-estree@8.64.0` -> `minimatch@10.2.5` -> `brace-expansion@5.0.7`

Registry checks:

- Latest ESLint: `10.8.0`
- Latest ESLint 9.x: `9.39.5`
- Latest minimatch: `10.2.5`
- Latest brace-expansion: `5.0.8`
- `brace-expansion@1.1.16` is the latest 1.x release
- npm audit `fixAvailable` points to ESLint `10.8.0`, which is a forbidden ESLint major upgrade for this task

## Applied Strategy

Applied only package override changes:

- Added parent-scoped `minimatch@10.2.5` overrides for:
  - `@eslint/config-array`
  - `@eslint/eslintrc`
  - `eslint`
  - `eslint-plugin-import`
  - `eslint-plugin-jsx-a11y`
  - `eslint-plugin-react`
- Added dependency-scoped `brace-expansion@5.0.8` override below `minimatch`

Not performed:

- ESLint 10 upgrade: not performed
- Direct/runtime dependency major upgrade: not performed
- Next.js change: not performed
- React / React DOM change: not performed
- sharp change: not performed
- PostCSS change: not performed
- Supabase CLI change: not performed
- `npm audit fix`: not run
- `npm audit fix --force`: not run
- `npm update`: not run
- `--force`: not used
- `--legacy-peer-deps`: not used
- Lockfile manual edit: not performed

ESLint major was retained at `9.39.5`. The minimatch change is a scoped transitive override used only because no patched `minimatch` 3.x or `brace-expansion` 1.x line exists.

## Final Dependency State

Final ESLint:

- `eslint@9.39.5`
- `eslint-config-next@16.2.10`
- Invalid: 0
- Peer invalid: 0

Final minimatch:

- `minimatch@10.2.5`
- Present under the named ESLint and Next ESLint plugin parents
- Vulnerable minimatch node count: 0
- Invalid: 0
- Peer invalid: 0

Final brace-expansion:

- `brace-expansion@5.0.8`
- Vulnerable brace-expansion node count: 0
- Invalid: 0
- Peer invalid: 0

## Fresh Install

- Lockfile update command: `npm install --package-lock-only`
- Lockfile update result: PASS
- Immediate npm audit after lockfile update: vulnerabilities 0
- Fresh install command: `npm ci`
- Fresh install result: PASS
- Installed packages after patch: 372
- Audited packages after patch: 373
- Invalid count: 0
- Peer invalid count: 0

## Final Security Gate

Production audit:

- moderate: 0
- high: 0
- critical: 0
- total: 0

Full audit:

- moderate: 0
- high: 0
- critical: 0
- total: 0

Final vulnerability entries: 0

## Lint Determinism

`npm run lint` rerun results:

- Run 1: PASS
- Run 2: PASS
- Run 3: PASS
- Warning count: 0
- Output SHA-256 for all three runs: `c5027d3b24b4a1bbda6b202ec88177970f28075623e697689e51f81c966728be`
- Output identical: true

An earlier lint triplet also exited 0/0/0; only the local PowerShell hash helper was incompatible and was rerun with a compatible SHA-256 implementation.

## Build And Sharp

- `npm run build`: PASS
- Build framework: Next.js `16.2.11` with Turbopack
- TypeScript build step: PASS
- Route conflict count: 0
- Image optimization module error count: 0
- `node -e "import('sharp')..."`: PASS
- Marker: `SHARP_MODULE_LOAD_PASS`

## Optional Sharp Extraneous Analysis

Fresh `npm ci` still reports two sharp-related optional extraneous nodes:

- `@img/sharp-wasm32@0.35.3`
- `@emnapi/runtime@1.11.2`

Context:

- Platform: `win32/x64`
- npm omit: `null`
- `sharp@0.35.3` is installed through the Next-scoped sharp override.
- `@img/sharp-wasm32@0.35.3` depends on `@emnapi/runtime@^1.11.1`.
- `npm explain` reports the WASM optional package and its runtime as extraneous after fresh `npm ci`.
- Build and sharp module load both pass.

Classification:

```text
NPM_OPTIONAL_DEPENDENCY_ACCOUNTING_ISSUE
```

No optional package deletion, `npm prune`, sharp change, or lockfile manual cleanup was performed.

## Source Freeze

Diff counts:

- `src/**`: 0
- `scripts/**`: 0
- `supabase/**`: 0
- `eslint.config.*`: 0
- generated database types: 0
- Runtime redesign change: 0
- Migration change: 0
- DB test change: 0

Changed files:

- `package.json`
- `package-lock.json`
- `docs/09-governance/NEW_P5_SEC_05B_DEV_DEPENDENCY_SECURITY_REPORT.md`

Changed file count: 3

## Secret And Cleanup

- Actual npm token: 0
- Registry credential: 0
- Supabase key: 0
- JWT: 0
- Cookie value: 0
- Email/password/TOTP secret: 0
- DB URL: 0
- Private key/mnemonic: 0
- `.env.local` created: 0
- Audit JSON raw file: 0
- Temporary registry dump: 0
- Target Next runtime process: 0
- Target Supabase container: 0

## Git State

- Staged files: 0
- Commit: not run
- Push: not run
- PR: not run

Expected status:

```text
 M package-lock.json
 M package.json
?? docs/09-governance/NEW_P5_SEC_05B_DEV_DEPENDENCY_SECURITY_REPORT.md
```

## Decision

- Commit possible: yes, after user approval
- PRE-07A revalidation possible: yes, after this security branch is committed and selected as a new baseline
- P5-T02 progression possible: hold until the security patch is committed and the requested downstream baseline update is explicitly approved

Final state:

```text
PASS
```
