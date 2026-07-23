# NEW-P5-SEC-03A Next.js 16.2.11 Security Patch Report

## Scope

- Start branch: `feat/new-p5-external-observation-reconciliation`
- Start HEAD: `e6055bc76d5c7ac1c99d2e17942091a647482323`
- Work branch: `fix/new-p5-next-16-2-11-security`
- P5-T02 implementation: 0
- Phase closeout and custody E2E: deferred to SEC-03B
- Staging, commit, push, PR: not performed

Final gate state:

```text
PASS_TO_P5_T02
```

## Advisory Baseline

- Starting Next.js version: `16.2.10`
- Starting production audit: moderate 0 / high 1 / critical 0
- Starting full audit: moderate 0 / high 1 / critical 0
- Affected package: `next`
- Affected range reported by npm audit: `>=16.0.0 <16.2.11`
- Fix version: `16.2.11`

Observed advisory categories included App Router proxy bypass, Server Action denial of service, SSRF, cache confusion, Image Optimization denial of service, and internal Server Function endpoint disclosure entries bundled under the direct `next` package vulnerability.

## Patch Applied

Command used:

```text
npm install next@16.2.11 --save-exact
```

Commands not used:

- `npm audit fix`
- `npm audit fix --force`
- `npm update`
- Next.js canary, preview, beta, or RC install

## Final Dependency State

- Final Next.js version: `16.2.11`
- React version: `19.2.4`
- React DOM version: `19.2.4`
- Supabase CLI version: `2.109.1`
- Next-scoped sharp override: `0.35.3`
- Next-scoped PostCSS override: `8.5.10`
- Top-level Tailwind PostCSS transitive version: `8.5.19`
- Invalid packages: 0
- Extraneous packages: 0

Dependency tree verification:

- `next@16.2.11`
- `react@19.2.4`
- `react-dom@19.2.4`
- `sharp@0.35.3` under Next override
- `postcss@8.5.10` under Next override
- `postcss@8.5.19` under Tailwind PostCSS

## Package Diff

`package.json`:

- Changed `dependencies.next` from `16.2.10` to `16.2.11`
- React unchanged
- React DOM unchanged
- Supabase packages unchanged
- Supabase CLI unchanged
- scripts unchanged
- overrides unchanged

`package-lock.json`:

- Updated root Next dependency metadata to `16.2.11`
- Updated `node_modules/next` to `16.2.11`
- Updated `@next/env` to `16.2.11`
- Updated Next optional SWC package metadata to `16.2.11`
- Preserved registry source as the normal npm registry
- Preserved npm-generated integrity fields
- No manual lockfile editing

## Fresh Install

- `npm ci`: PASS
- Additional package or lockfile mutation after `npm ci`: 0
- Native sharp install/load: PASS

Note: explicit manual removal of `node_modules` was not performed because the tool safety layer rejected direct recursive deletion. The required lockfile-based fresh install was still verified with `npm ci`, which completed successfully and reported 0 vulnerabilities.

## Final Audit

- `npm audit --omit=dev --json`: moderate 0 / high 0 / critical 0
- `npm audit --include=dev --json`: moderate 0 / high 0 / critical 0
- Vulnerable Next.js version in dependency tree: 0
- Advisory ignore or suppression: 0

## Core Build Checks

- sharp module load: `SHARP_MODULE_LOAD_PASS`
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS
- Build version banner: Next.js `16.2.11`
- Route conflict: 0
- Auth route build: PASS
- Proxy build: PASS
- Custody route build: PASS
- Image Optimization module error: 0

## Source Reachability

- Direct `sharp` import in `src/**`: 0
- `ImageResponse` usage in `src/**`: 0
- Direct `postcss` import in `src/**`: 0
- User-controlled image buffer processing found in this task: 0
- `next/image` import: 0

The only `next/image` text match is the existing `src/proxy.ts` matcher exclusion path `/_next/image`; it is not an import or image-processing call site.

## Freeze Verification

- `src/**` diff: 0
- `supabase/**` diff: 0
- `scripts/**` diff: 0
- Database migration diff: 0
- Database test diff: 0
- Generated type diff: 0
- P5-T02 implementation file diff: 0
- Service-role client: 0
- Remote Supabase connection: 0
- Mainnet connection: 0

## Secret And Registry Check

- npm token copied: 0
- Registry credential copied: 0
- Supabase key copied: 0
- JWT or cookie value copied: 0
- Email or password copied: 0
- TOTP secret copied: 0
- DB URL copied: 0
- Private key or mnemonic copied: 0
- Provider credential copied: 0
- Remote Supabase URL copied: 0

Normal npm registry URLs and integrity hashes remain in `package-lock.json`.

## Process Cleanup

- Supabase started by this task: no
- Current project Supabase containers: 0
- Next.js server process started by this task: no
- Watched port listeners after validation: 0
- Audit JSON dump files: 0
- Registry dump files: 0
- Temporary package files: 0

## SEC-03B Requirement

SEC-03A validates the security patch, dependency tree, audit state, sharp loading, lint, and build only. Full phase closeout, custody E2E, auth route E2E, and production smoke remain required in SEC-03B before this branch can be treated as fully ready for P5-T02.

## SEC-03B Full Regression

SEC-03B was executed on the same work branch with no additional package, source, database, or script changes beyond this report update.

### Package Baseline

Baseline captured before the SEC-03B regression:

- `package.json`: SHA-256 captured, size captured, unstaged modified, staged none, conflict none
- `package-lock.json`: SHA-256 captured, size captured, unstaged modified, staged none, conflict none

Final package comparison:

- `PACKAGE_MANIFEST_UNCHANGED_DURING_SEC03B`: PASS
- `PACKAGE_LOCK_UNCHANGED_DURING_SEC03B`: PASS
- `PACKAGE_FILES_INVARIANCE_PASS`: PASS
- Package mutation during SEC-03B: 0

Hashes and full file contents are intentionally not copied into this report.

### Dependency And Audit

- `npm ls next react react-dom sharp postcss --all`: PASS
- Next.js: `16.2.11`
- React: `19.2.4`
- React DOM: `19.2.4`
- sharp: `0.35.3`
- Next-scoped PostCSS: `8.5.10`
- Tailwind transitive PostCSS: `8.5.19`
- Invalid packages: 0
- Extraneous packages: 0
- `npm audit --omit=dev --json`: moderate 0 / high 0 / critical 0
- `npm audit --include=dev --json`: moderate 0 / high 0 / critical 0

### Auth Regression

- Cookie Jar: `HTTP_COOKIE_JAR_PASS`
- Auth Routes: PASS
- ADMIN MFA: PASS
- Admin Role Commands: PASS

Verified coverage included confirmation, sign-in, sign-out, password recovery, cookie deletion, MFA enrollment and challenge, ADMIN AAL2 access, ADMIN role grant and revoke, replay, conflict handling, and same-origin rejection.

### Phase Closeout

- Phase 2 Closeout: PASS
- Phase 3 Closeout: PASS
- Withdrawal stability: PASS
- Phase 4 Closeout: PASS
- `PHASE4_DB_BASELINE_PASS`: PASS
- `DB_OBSERVED_FILES=16`: PASS
- `DB_OBSERVED_TESTS=893`: PASS
- `PACKAGE_FILES_INVARIANCE_PASS`: PASS during Phase 4 closeout
- `PHASE4_CLOSEOUT_PASS`: PASS

During one SEC-03B attempt, Phase 3 initially stopped at the nested Phase 2 closeout step after a reset/readiness-sensitive failure. The nested Phase 2 closeout passed when executed directly with the same silent npm invocation style, and the subsequent Phase 3 closeout rerun completed successfully, including the withdrawal state machine. No source, script, database, package, assertion, or timeout changes were made.

### Custody Boundary

- `npm run test:custody:boundary:local`: PASS
- `CUSTODY_BOUNDARY_PASS`: PASS
- ADMIN AAL2 boundary: PASS
- Provider and binding lifecycle: PASS
- Replay and conflict handling: PASS
- Same-origin boundary: PASS
- Ledger mutation check: PASS
- Network call and credential boundary: PASS

### Database Regression

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, errors 0, warnings 0
- `npm run db:test:local`: PASS
- pgTAP files: 16
- pgTAP tests: 893
- Skip count: 0
- `npm run db:types:local`: PASS
- Generated type diff: 0
- Seed data after final reset: 0

### Next.js And Production Smoke

- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- Build version banner: Next.js `16.2.11`
- Route conflict: 0
- Auth route build: PASS
- Proxy build: PASS
- Custody route build: PASS
- sharp resolution error: 0
- PostCSS build error: 0

Production smoke:

- `GET /api/v1/health`: 200
- `GET /api/v1/readiness/config`: 200
- `GET /`: 200
- `GET /auth/sign-in`: 200
- `GET /auth/verified`: 200
- `GET /account`: redirect to sign-in
- `GET /withdrawals`: redirect to sign-in
- `GET /staking`: redirect to sign-in
- `GET /admin`: redirect to sign-in
- `GET /admin/custody`: redirect to sign-in
- Secret and stack trace exposure: 0

### QA And Cleanup

- QA auth users: 0
- QA profiles: 0
- QA projects, assets, wallets: 0
- QA ledger rows: 0
- QA deposit and withdrawal rows: 0
- QA staking rows: 0
- QA custody provider, binding, and audit rows: 0
- Current project Supabase containers after stop: 0
- Watched port listeners after cleanup: 0
- Audit JSON dump files: 0
- Registry dump files: 0
- Cookie dump files: 0
- Temporary package files: 0

Supabase CLI printed local development credentials during `supabase start`; those values were not copied into source, docs, Git, or final reporting.

### Freeze Verification

- `src/**` additional diff: 0
- `supabase/**` diff: 0
- `scripts/**` diff: 0
- Migration diff: 0
- DB test diff: 0
- Generated type diff: 0
- P5-T02 implementation: 0
- Package changes after SEC-03A patch: 0
- Staging, commit, push, PR: 0

### Final Security Check

- npm token copied: 0
- Registry credential copied: 0
- Supabase key copied: 0
- JWT or cookie value copied: 0
- Email or password copied: 0
- TOTP secret copied: 0
- DB URL copied: 0
- Private key or mnemonic copied: 0
- Provider credential copied: 0
- Remote Supabase URL copied: 0
- Service-role client added: 0
- Remote or mainnet connection: 0

## Final Decision

Final status: PASS for SEC-03A and SEC-03B.

Commit readiness: yes, after review of the three-file diff.

P5-T02 progression: yes, from this validated security patch branch after the SEC-03 changes are committed or otherwise intentionally carried forward.
