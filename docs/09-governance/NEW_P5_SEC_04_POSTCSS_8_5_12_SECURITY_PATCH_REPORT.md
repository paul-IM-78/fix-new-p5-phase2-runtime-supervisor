# NEW-P5-SEC-04A PostCSS 8.5.12 Security Patch Report

## Scope

- Security worktree: `D:\Ai\staking-wallet-web-sec04`
- Security branch: `fix/new-p5-postcss-8-5-12-security`
- Baseline HEAD: `2da951fe04603318a2e24ab0ca194e1e26e0bd34`
- Baseline short HEAD: `2da951f`
- Baseline commit subject: `docs: record nested closeout stability validation`
- Original dirty worktree: `D:\Ai\staking-wallet-web`
- Clean runtime diagnostic worktree: `D:\Ai\staking-wallet-web-pre05-clean`
- Legacy repository: `D:\Ai\Staking-Wallet`

## Baseline Verification

- Security worktree full HEAD matched the requested baseline exactly.
- Branch reference `refs/heads/fix/new-p5-postcss-8-5-12-security` matched the same full SHA.
- Ancestor check exit code: 0.
- Worktree was clean before the package patch.
- Staging was empty before the package patch.
- Existing dirty and runtime diagnostic worktrees were read-only.
- Existing snapshot directory was not modified.

Baseline verdict:

```text
SEC04_WORKTREE_BASELINE_VERIFIED
```

## Advisory

- GHSA: `GHSA-6g55-p6wh-862q`
- CVE: `CVE-2026-45623`
- Severity: High
- Affected range: `postcss <= 8.5.11`
- Patched minimum version used here: `8.5.12`

Starting audit reproduction:

- Production moderate: 0
- Production high: 2
- Production critical: 0
- Full moderate: 0
- Full high: 2
- Full critical: 0
- Vulnerable path: `next@16.2.11` -> Next-scoped `postcss@8.5.10`

## Version Policy

Only the Next-scoped PostCSS override was changed:

```text
postcss 8.5.10 -> 8.5.12
```

Versions intentionally preserved:

- Next.js: `16.2.11`
- React: `19.2.4`
- React DOM: `19.2.4`
- sharp override: `0.35.3`
- Supabase CLI: `2.109.1`

`8.5.12` was selected because it is the minimum patched version for the advisory and keeps the security patch blast radius smaller than jumping to a newer unrelated PostCSS version.

## Package Diff

Changed files:

- `package.json`
- `package-lock.json`
- `docs/09-governance/NEW_P5_SEC_04_POSTCSS_8_5_12_SECURITY_PATCH_REPORT.md`

`package.json` change:

- `overrides.next.postcss`: `8.5.10` -> `8.5.12`

`package-lock.json` change:

- `node_modules/next/node_modules/postcss`
  - Version: `8.5.10` -> `8.5.12`
  - Resolved tarball metadata updated by npm
  - Integrity metadata updated by npm

No dependency was added or removed.

No script was changed.

No source, Supabase, migration, generated type, or runtime code was changed.

`npm audit fix` was not run.

## Fresh Install

Command:

```text
npm ci
```

Result:

- PASS
- Installed package count: 376
- Audited package count: 377
- Vulnerabilities reported by install: 0
- Package files did not receive additional changes after fresh install.

## Dependency Tree

PostCSS tree after patch:

```text
@tailwindcss/postcss@4.3.3 -> postcss@8.5.19
next@16.2.11 -> postcss@8.5.12 overridden
```

PostCSS lockfile nodes:

- `node_modules/next/node_modules/postcss`: `8.5.12`
- `node_modules/postcss`: `8.5.19`

Vulnerable PostCSS nodes:

```text
0
```

Core version tree:

- Next.js: `16.2.11`
- React: `19.2.4`
- React DOM: `19.2.4`
- sharp: `0.35.3`
- Supabase CLI: `2.109.1`

Invalid packages: 0, based on successful `npm ls` commands.

Extraneous packages: 0, based on successful `npm ls` commands.

## npm Audit

Production audit after patch:

- Moderate: 0
- High: 0
- Critical: 0

Full audit after patch:

- Moderate: 0
- High: 0
- Critical: 0

`GHSA-6g55-p6wh-862q` no longer appears in the audit result.

The Next meta-vulnerability no longer appears in the audit result.

No audit JSON dump was saved.

## Reachability Boundary

Read-only source inspection found:

- Direct production `postcss` imports: 0
- Runtime CSS upload feature: 0
- Runtime user-controlled CSS processing path: 0
- User-controlled `sourceMappingURL` processing path: 0

The security patch was applied regardless of reachability.

## Lint And Build

Commands:

```text
npm run lint
npm run build
```

Results:

- Lint: PASS
- Lint warnings: 0
- Build: PASS
- Build framework: Next.js `16.2.11`
- PostCSS build error: 0
- Route conflict: 0
- Source change required: 0

## Process Cleanup

No Supabase or Next runtime was started for this task.

Cleanup verification:

- Security worktree Next process: 0
- Security worktree Supabase container: 0
- Port 3000 security runtime listener: 0
- Port 3000 Docker Desktop backend listener may be present and is not treated as this task's runtime
- Port 3010 security runtime listener: 0
- Ports 55721-55724 security runtime listener: 0
- `.env.local` created: 0
- Audit JSON dump: 0
- Registry credential dump: 0

## Secret And Registry Check

Changed files were checked for secret-like values.

Result:

- npm credential token value found: 0
- Registry credential: 0
- Supabase key: 0
- JWT: 0
- Cookie value: 0
- Password value found: 0
- TOTP secret: 0
- Actual database URL value: 0
- Private key: 0
- Mnemonic value found: 0
- Remote Supabase credential: 0

Normal lockfile registry URLs, integrity hashes, GHSA IDs, and CVE IDs are expected and allowed.

## Runtime PRE And P5-T02 Boundary

This security patch is independent from the PRE-05 runtime diagnostics.

P5-T02 remains held until the runtime stabilization work reaches its own acceptance criteria.

## Commit Readiness

Commit possible: yes, after user approval.

Expected commit scope:

- `package.json`
- `package-lock.json`
- `docs/09-governance/NEW_P5_SEC_04_POSTCSS_8_5_12_SECURITY_PATCH_REPORT.md`

Staging performed: 0

Commit performed: 0

Push performed: 0

PR performed: 0

## Final Status

`PASS`
