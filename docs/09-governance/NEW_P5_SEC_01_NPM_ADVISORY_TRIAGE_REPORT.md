# NEW-P5-SEC-01 npm Advisory Triage Report

## Scope

- Project repository: `D:\Ai\staking-wallet-web`
- Legacy repository: `D:\Ai\Staking-Wallet`
- Task type: analysis, evidence collection, and this single report only
- Dependency changes: 0
- `package-lock.json` changes: 0
- `npm audit fix`: not run
- Staging, commit, push, PR: not run

## Start Baseline

- Branch: `feat/new-p5-custody-boundary-domain`
- HEAD: `1ca5dd137eaef25b7f3b450a3d107e0e16d9d137`
- Working tree at start: clean
- Staging at start: empty
- Legacy repository working tree: clean
- Prior recorded state: Phase 2, Phase 3, Phase 4, custody boundary PASS; pgTAP 16 files / 893 tests PASS
- Audit collection time: 2026-07-22T19:39:25+09:00

## Evidence Collected

Commands executed without writing dependency files:

- `npm audit --json`
- `npm audit --omit=dev --json`
- `npm audit --include=dev --json`
- `npm explain next`
- `npm explain postcss`
- `npm explain sharp`
- `npm ls next postcss sharp --all`
- `npm view next version`
- `npm view next@16.2.10 dependencies --json`
- `npm view next@16.2.10 optionalDependencies --json`
- `npm view next@16.2.11 dependencies --json`
- `npm view next@16.2.11 optionalDependencies --json`
- `npm view sharp version`
- `npm view sharp@0.35.0 version`
- `npm view postcss version`
- `npm view postcss@8.5.10 version`
- Read-only source searches for `next/image`, `ImageResponse`, `sharp`, `postcss`, image assets, file/blob upload handling, and style injection patterns

External advisory references:

- GitHub Advisory `GHSA-qx2v-qp2m-jg93`: <https://github.com/advisories/GHSA-qx2v-qp2m-jg93>
- GitHub Advisory `GHSA-f88m-g3jw-g9cj`: <https://github.com/advisories/GHSA-f88m-g3jw-g9cj>

No temporary audit JSON file was created.

## Audit Counts

| Audit command | Moderate | High | Critical | Total |
| --- | ---: | ---: | ---: | ---: |
| `npm audit --json` | 1 | 2 | 0 | 3 |
| `npm audit --omit=dev --json` | 1 | 2 | 0 | 3 |
| `npm audit --include=dev --json` | 1 | 2 | 0 | 3 |

The advisories are present even with dev dependencies omitted. They must be treated as production dependency advisories until a separate remediation changes the dependency graph or an explicit risk acceptance is approved.

## Dependency Tree

```text
staking-wallet-web@0.1.0
+-- @tailwindcss/postcss@4.3.3
| `-- postcss@8.5.19
`-- next@16.2.10
  +-- postcss@8.4.31
  `-- sharp@0.34.5
```

Dependency explanations:

- `next@16.2.10` is a direct production dependency from the root project.
- `postcss@8.4.31` is a transitive production dependency under `next@16.2.10`.
- `postcss@8.5.19` also exists as a dev dependency under `@tailwindcss/postcss@4.3.3`; this copy is outside the vulnerable `<8.5.10` range.
- `sharp@0.34.5` is an optional transitive production dependency under `next@16.2.10`.
- `supabase@2.109.1` is a direct dev dependency only and is not part of the reported advisory chain.

## Lockfile Evidence

| Lockfile node | Version | Dev | Optional | Peer | Integrity | Parent |
| --- | --- | --- | --- | --- | --- | --- |
| `node_modules/next` | `16.2.10` | false | false | false | present | root dependency |
| `node_modules/next/node_modules/postcss` | `8.4.31` | false | false | false | present | `next@16.2.10` |
| `node_modules/postcss` | `8.5.19` | true | false | false | present | `@tailwindcss/postcss@4.3.3` |
| `node_modules/sharp` | `0.34.5` | false | true | false | present | optional dependency of `next@16.2.10` |

Observed package metadata:

- `next@16.2.10` depends on `postcss: 8.4.31`.
- `next@16.2.10` has optional dependency `sharp: ^0.34.5`.
- Latest observed `next` was `16.2.11`, but it still declared `postcss: 8.4.31` and optional `sharp: ^0.34.5`.
- `sharp@0.35.0` exists and `sharp@0.35.3` was the latest observed sharp version.
- `postcss@8.5.10` exists and `postcss@8.5.22` was the latest observed postcss version.

No lockfile edits were made.

## High Advisory 1: `next`

| Field | Result |
| --- | --- |
| Package | `next` |
| Installed version | `16.2.10` |
| Dependency type | direct production dependency |
| Audit severity | high |
| Audit range | `9.3.4-canary.0 - 16.3.0-preview.7` |
| Installed node | `node_modules/next` |
| Dependency chain | root -> `next@16.2.10` -> `postcss@8.4.31`; root -> `next@16.2.10` -> optional `sharp@0.34.5` |
| Audit via | `postcss`, `sharp` |
| Fix available from audit | `next@9.3.3`, `isSemVerMajor: true` |
| Production omit included | yes |
| Advisory nature | aggregate high because vulnerable transitive packages are under `next` |

### Runtime Reachability

- Server runtime package presence: yes, because `next` is the production server runtime.
- Browser bundle direct reachability: no direct application import of `sharp` or `postcss` was found.
- Build/tooling reachability: yes, Next build uses the Next toolchain.
- App-level vulnerable input reachability: not found in current source.
- Source search found no application import/use of `next/image`, `ImageResponse`, `sharp`, or `postcss`.
- Source search found no public or `src` image assets with `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, or `ico` extensions.
- `next.config.ts` has no `images`, `remotePatterns`, `domains`, `unoptimized`, or `dangerouslyAllowSVG` configuration.
- The proxy matcher excludes `/_next/image` from proxy execution, but that is not an image-optimizer block. It only means the auth proxy does not run for that path.

Reachability decision: `TRANSITIVE_NOT_REACHABLE` for current app-specific vulnerable input paths, with production package presence confirmed.

### Exploit Preconditions

- The high score is inherited from transitive packages.
- Practical app impact depends on whether the app exposes either user-controlled image processing through `sharp` or user-controlled CSS parsing/stringifying through vulnerable `postcss`.
- Those app paths were not found.
- If future work adds `next/image`, remote image configuration, user image uploads, provider image ingestion, or dynamic CSS embedding, this decision expires immediately.

### Fix Options

- Path A, transitive patch: not currently available lock-only through the existing `next@16.2.10` constraints. `next` pins `postcss` to `8.4.31`; `sharp` is declared as `^0.34.5`, which does not include `0.35.x`.
- Path B, parent patch/minor: latest observed `next@16.2.11` still declared the same vulnerable transitive ranges.
- Path C, major/preview upgrade: requires a separate Next compatibility task and full regression suite.
- Path D, removal: not feasible without replacing the Next.js framework.
- Path E, accept temporarily: possible only with explicit risk acceptance because the advisory appears in `--omit=dev`.

Advisory decision: `FIX_IN_SEPARATE_UPGRADE_TASK`.

## High Advisory 2: `sharp`

| Field | Result |
| --- | --- |
| Package | `sharp` |
| Installed version | `0.34.5` |
| Dependency type | transitive production optional dependency |
| Parent | `next@16.2.10` |
| Audit severity | high |
| Advisory title | sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 |
| Advisory URL | <https://github.com/advisories/GHSA-f88m-g3jw-g9cj> |
| Vulnerable range | `<0.35.0` |
| Patched version | `0.35.0` |
| Latest observed version | `0.35.3` |
| Installed node | `node_modules/sharp` |
| Fix available from audit | `next@9.3.3`, `isSemVerMajor: true` |
| Production omit included | yes |
| CWE | `CWE-1395` |

### Runtime Reachability

- Server runtime package presence: yes, optional package installed under the production dependency graph.
- Browser runtime reachability: no.
- Build/tooling reachability: possible through Next image/build internals, but no application route or script imports `sharp`.
- App-level input reachability: not found.
- No direct `sharp` imports were found in `src`, `scripts`, `supabase`, or config.
- No `next/image` or `ImageResponse` usage was found.
- No image assets were found under `public` or `src`.
- Form routes use `request.formData()`, but no `File`, `Blob`, `arrayBuffer()`, stream, or request body byte handling was found in the searched application paths.

Reachability decision: `TRANSITIVE_NOT_REACHABLE` for current app-specific vulnerable input paths, with production optional package presence confirmed.

### Exploit Preconditions

- The official advisory states affected usage is processing untrusted input with sharp versions before `0.35.0`.
- Current application evidence does not show untrusted image input being accepted, decoded, transformed, or passed to `sharp`.
- A future addition of image upload, provider-supplied media ingestion, remote image optimization, or explicit `sharp` use would make this production-reachable.

### Fix Options

- Path A, transitive patch: not lock-only under the current `next` optional dependency range `^0.34.5`.
- Path B, parent patch/minor: latest observed `next@16.2.11` still uses `sharp: ^0.34.5`.
- Path C, package override/direct sharp upgrade: possible only in a separate branch because it changes dependency resolution and must be regression tested.
- Path D, remove sharp: possible only if Next image optimization remains unused and installation can safely omit the optional dependency; this is a separate dependency/runtime packaging task.
- Path E, temporary risk acceptance: possible only with explicit owner acceptance and expiry conditions because the advisory appears in `--omit=dev`.

Advisory decision: `FIX_IN_SEPARATE_UPGRADE_TASK`.

## Moderate Advisory Context: `postcss`

| Field | Result |
| --- | --- |
| Package | `postcss` |
| Installed vulnerable version | `8.4.31` |
| Safe duplicate version | `8.5.19` under `@tailwindcss/postcss@4.3.3` |
| Dependency type | vulnerable copy is transitive production under `next` |
| Advisory title | PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output |
| Advisory URL | <https://github.com/advisories/GHSA-qx2v-qp2m-jg93> |
| Vulnerable range | `<8.5.10` |
| Patched version | `8.5.10` |
| Production omit included | yes |
| CWE / CVSS | `CWE-79`; `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N` |

The advisory requires user-submitted CSS to be parsed, re-stringified, and embedded into HTML style tags. Current source search found no app import of `postcss`, no user-controlled CSS parser path, and no dynamic style embedding pattern. This supports a `BUILD_TIME_REACHABLE` or framework-internal-only posture for the current app, not an app-level runtime exploit path.

## Supabase CLI Boundary

- Exact package: `supabase@2.109.1`
- Dependency type: direct dev dependency
- Advisory chain involvement: none found
- Production Next.js runtime inclusion: not shown by the reported audit chain
- Local use: scripts for local stack, migration, lint, test, and type generation
- No Supabase CLI version change was made.

## Next.js and React Boundary

- `next@16.2.10` is a direct production dependency.
- `react@19.2.4` and `react-dom@19.2.4` are production dependencies.
- No React advisory was reported by npm audit.
- Latest observed `next@16.2.11` did not remove the two vulnerable transitive edges.
- A Next upgrade or override task can affect build behavior, routing, proxy/cookie behavior, SSR auth, E2E cookie jar tests, and Windows Docker behavior.

## Existing Mitigations

Evidence that lowers current reachability, without eliminating the advisory:

- No file upload, image byte processing, `File`, `Blob`, stream, or `arrayBuffer()` route path was found.
- No `next/image` or `ImageResponse` usage was found.
- No app-level direct `sharp` or `postcss` imports were found.
- `next.config.ts` contains no remote image allowlist or image optimization configuration.
- The product currently models custody observations and financial operations internally; no remote provider image ingestion or mainnet/RPC processing path was found in this triage.
- Auth, admin, AAL2, RLS, command, and ledger guards reduce unrelated business-risk impact, but they are not a direct patch for these package advisories.

## Regression Scope for Any Fix

Minimum validation suite for a separate security remediation task:

- `npm run lint`
- `npm run build`
- `npm audit --omit=dev --json`
- `npm audit --include=dev --json`
- Supabase local start/status/stop as needed
- `npm run db:reset:local`
- `npm run db:lint:local`
- `npm run db:test:local`
- `npm run test:http:cookie-jar:local`
- Auth SSR cookie and route flows
- Phase 2 closeout
- Phase 3 closeout
- Phase 4 closeout
- Custody boundary local test
- Windows Docker/runtime smoke if packaging changes

## Risk Acceptance Requirements

Because both high audit entries remain present with `--omit=dev`, continuing without dependency remediation requires explicit temporary risk acceptance.

- Owner: project security/product owner to be named before P5-T02 proceeds
- Review date: before NEW-P5-T02 starts, and at least every 7 days while open
- Expiration condition: any use of `next/image`, `ImageResponse`, `sharp`, user image upload, provider image ingestion, remote image optimization, dynamic user CSS parsing/stringifying, or production deployment
- Upgrade trigger: a Next.js release or approved dependency override that resolves `postcss >=8.5.10` and `sharp >=0.35.0` without breaking the regression suite
- Immediate stop condition: any evidence of user-controlled input reaching `sharp` or vulnerable `postcss`

## Decisions

| Advisory | Decision | Reason |
| --- | --- | --- |
| `next` high aggregate | `FIX_IN_SEPARATE_UPGRADE_TASK` | Direct production dependency, but high is inherited from transitive `postcss` and `sharp`; no current app-level vulnerable input path found; available audit fix suggests semver-major downgrade and is not a safe direct remediation. |
| `sharp` high | `FIX_IN_SEPARATE_UPGRADE_TASK` | Production optional transitive package is installed; current app has no image processing reachability; fix requires dependency resolution changes and full regression. |
| `postcss` moderate | `FIX_IN_SEPARATE_UPGRADE_TASK` | Vulnerable copy is production transitive under Next; no user CSS parse/stringify/embed path found; fix is blocked by Next pinning `postcss@8.4.31`. |

Overall project decision: `REQUIRES_RISK_ACCEPTANCE`.

Task validation status: `PASS` for analysis completeness. Operational next state: `REQUIRES_ACTION` before NEW-P5-T02 unless the owner explicitly accepts the temporary risk or a separate security upgrade task removes the advisories.

## Secret and Credential Handling

- Actual npm tokens: not printed
- Registry credentials: not printed
- Supabase keys: not printed
- JWTs, cookies, passwords, database URLs, private keys, mnemonics, provider credentials: not printed
- Advisory package names, package versions, and public advisory URLs are not secrets
- Read-only secret-marker searches returned known placeholder/test-deny marker strings and domain constants, not values copied into this report

## End-State Validation

- Dependency changes: 0
- `package.json` changes: 0
- `package-lock.json` changes: 0
- Source changes: 0
- Migration changes: 0
- Script changes: 0
- Temporary files created: 0
- Staging: 0
- Commit: 0
- Push/PR: 0

Expected `git status --short` after this report:

```text
?? docs/09-governance/NEW_P5_SEC_01_NPM_ADVISORY_TRIAGE_REPORT.md
```

Commit possible: yes, for this report only, after review and explicit approval. Dependency remediation should be handled in a separate security upgrade task.

## SEC-02 Resolution Addendum

### Resolution Scope

- Resolution task: NEW-P5-SEC-02
- Work branch: `fix/new-p5-next-transitive-advisories`
- Branch point: `1ca5dd137eaef25b7f3b450a3d107e0e16d9d137`
- Preserved untracked SEC-01 report: yes
- Next.js stable version maintained: `16.2.10`
- React version maintained: `19.2.4`
- Supabase CLI version maintained: `2.109.1`
- Preview, canary, downgrade, React change: not used
- `npm audit fix`: not run
- Manual lockfile editing: not performed

### Selected Candidate

Selected candidate: scoped npm overrides.

```json
{
  "overrides": {
    "next": {
      "postcss": "8.5.10",
      "sharp": "0.35.3"
    }
  }
}
```

Candidate rationale:

- Keeps the stable `next@16.2.10` framework contract.
- Keeps `react@19.2.4` and `react-dom@19.2.4` unchanged.
- Replaces only the vulnerable transitive package resolutions under Next.
- Avoids Next preview, canary, downgrade, or broad dependency update.
- Uses npm lockfile generation via `npm install --package-lock-only` and fresh `npm ci`.

Direct dependency addition: none.

Advisory gate script: not added. Manual audit and dependency-tree gates were sufficient for this task.

### Next.js Dependency Contract

Read-only inspection of `node_modules/next/package.json` before remediation:

- `next`: `16.2.10`
- `engines.node`: `>=20.9.0`
- `dependencies.postcss`: `8.4.31`
- `optionalDependencies.sharp`: `^0.34.5`

Runtime used for validation:

- Node.js: `v24.14.1`
- npm: `11.11.0`
- `sharp@0.35.3` engine requirement: compatible with Node `>=20.9.0`

### Baseline Before SEC-02

| Item | Baseline |
| --- | --- |
| `npm audit --omit=dev` | moderate 1, high 2, critical 0 |
| `npm audit --include=dev` | moderate 1, high 2, critical 0 |
| `sharp` | `0.34.5`, optional transitive under Next |
| `postcss` | `8.4.31`, transitive under Next |
| Next direct dependency | `16.2.10` |
| Audit fix metadata | suggested `next@9.3.3`, semver-major downgrade; rejected |

### Final Dependency Tree

```text
staking-wallet-web@0.1.0
+-- @tailwindcss/postcss@4.3.3
| `-- postcss@8.5.19
`-- next@16.2.10
  +-- postcss@8.5.10 overridden
  `-- sharp@0.35.3 overridden
```

Final dependency checks:

- `sharp <0.35.0`: 0 instances
- `postcss <8.5.10`: 0 instances
- Invalid package tree: 0
- Extraneous package tree: 0
- `SHARP_MODULE_LOAD_PASS`: yes

### Final Audit Counts

| Audit command | Moderate | High | Critical | Total |
| --- | ---: | ---: | ---: | ---: |
| `npm audit --omit=dev --json` | 0 | 0 | 0 | 0 |
| `npm audit --include=dev --json` | 0 | 0 | 0 | 0 |

Updated advisory decision:

- `next` high aggregate: resolved
- `sharp` high: resolved
- `postcss` moderate: resolved
- Residual advisory risk requiring acceptance: none found by npm audit

Updated npm advisory project decision: `PASS_TO_P5_T02`.

### Fresh Install Reproducibility

- `npm install --package-lock-only`: PASS, 0 vulnerabilities
- `npm ci`: PASS, 0 vulnerabilities
- Native `sharp` module load: PASS
- Package install used generated lockfile metadata with registry `resolved` URLs and `integrity` hashes; no manual integrity or resolved URL edits were made.

### Database Freeze Validation

- Migration diff: 0
- Database test diff: 0
- Generated type diff after `npm run db:types:local`: 0
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, no schema errors
- `npm run db:test:local`: PASS
- Observed pgTAP: 16 files / 893 tests / skip 0

### Auth and Runtime Regression

- `npm run test:http:cookie-jar:local`: PASS, `HTTP_COOKIE_JAR_PASS`
- `npm run test:auth:routes:local`: initial attempt failed because no app server was running on `localhost:3000`; rerun after production server start passed
- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- Cookie value output copied into this report: 0
- Auth SSR cookie regression observed: none after server startup

### Phase and Custody Regression

- `npm run test:phase2:closeout:local`: PASS
- `npm run test:phase3:closeout:local`: initial 10 minute tool timeout occurred because the script re-runs Phase 2 and ledger regressions internally; rerun with an extended timeout passed
- `npm run test:phase3:closeout:local`: PASS
- `npm run test:custody:boundary:local`: initial run passed all functional checks but failed final port cleanup because a manually started production server process was still present; rerun after stopping that server passed
- `npm run test:custody:boundary:local`: PASS, `CUSTODY_BOUNDARY_PASS`

Phase 4 closeout result:

- Functional subchecks passed through DB, staking, reward, lifecycle, pgTAP, generated types, QA residue, lint, build, production smoke, secret scan, and Supabase stop.
- Observed output included `PHASE4_DB_BASELINE_PASS`, `DB_OBSERVED_FILES=16`, `DB_OBSERVED_TESTS=893`, and generated type diff 0.
- Final script result: FAIL at `Package lock clean`.
- Root cause: the existing Phase 4 closeout script asserts `package-lock.json` has no diff. SEC-02 intentionally changes `package-lock.json` to remove vulnerable Next transitive resolutions.
- Script or test assertion changes were not made because the task allowed only `package.json`, `package-lock.json`, this report, and an optional new security gate script.
- Closeout compatibility status: `REQUIRES_ACTION` unless the owner accepts this stale package-lock clean assertion for the security branch or approves a separate closeout assertion update.

### Next.js Validation and Production Smoke

- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- Manual production smoke with `next start`:

| Path | Result |
| --- | --- |
| `/api/v1/health` | HTTP 200, `Cache-Control: no-store` |
| `/api/v1/readiness/config` | HTTP 200, `Cache-Control: no-store` |
| `/` | HTTP 200 |
| `/auth/sign-in` | HTTP 200 |
| `/account` | HTTP 307 to `/auth/sign-in?next=/account` |
| `/admin` | HTTP 307 to `/auth/sign-in?next=/admin` |
| `/admin/custody` | HTTP 307 to `/auth/sign-in?next=/admin` |
| `/staking` | HTTP 307 to `/auth/sign-in?next=/staking` |

Authenticated ADMIN AAL2 access was covered by the admin MFA and custody boundary tests.

### Source Reachability Recheck

Rechecked after dependency remediation:

- Direct `sharp` application import: 0
- `next/image` usage: 0
- `ImageResponse` usage: 0
- Image upload or image byte buffer handling: 0
- Direct `postcss` application import: 0
- User-controlled CSS parser/stringify path: 0
- Dynamic CSS stringify into HTML style output: 0

The remediation did not add image or CSS processing features.

### Secret and Registry Handling

- `npm audit` JSON was not saved into the repository.
- Local Supabase CLI commands printed local default development credentials to stdout; those values were not copied into this report.
- No npm token, registry credential, Supabase key, JWT, cookie value, email/password, TOTP secret, database URL, private key, mnemonic, provider credential, mainnet identifier, or remote Supabase URL was added to tracked files.
- Registry `resolved` package URLs and `integrity` hashes in `package-lock.json` are normal lockfile metadata.

### SEC-02 End State

- Changed files:
  - `package.json`
  - `package-lock.json`
  - `docs/09-governance/NEW_P5_SEC_01_NPM_ADVISORY_TRIAGE_REPORT.md`
- Optional security gate script: not added
- Source changes: 0
- Migration changes: 0
- DB test changes: 0
- Generated type changes: 0
- Staging: 0
- Commit: 0
- Push/PR: 0
- Process cleanup: production server and Supabase local stack stopped after validation

Final status:

- Security advisory remediation: `PASS`
- Overall npm advisory decision: `PASS_TO_P5_T02`
- Full task status: `REQUIRES_ACTION`

Reason for full task status: Phase 4 closeout's final package-lock clean assertion is incompatible with this intentional package-lock security remediation and cannot be changed within the SEC-02 allowed file scope.

## SEC-02-R1 Phase 4 Package Invariance Addendum

### R1 Scope

- R1 task: NEW-P5-SEC-02-R1
- Branch: `fix/new-p5-next-transitive-advisories`
- HEAD: `1ca5dd137eaef25b7f3b450a3d107e0e16d9d137`
- Preserved SEC-02 changes:
  - `package.json`
  - `package-lock.json`
  - this report
- Added R1 code change:
  - `scripts/phase/phase4-closeout.local.mjs`
- Staging, commit, push, PR: not run

### Stale Assertion Root Cause

The previous Phase 4 closeout package check used an exact-clean assertion:

```text
git diff --quiet -- package-lock.json
```

That check could not distinguish between:

- intentional package-lock security remediation already present before closeout starts
- unexpected package-lock mutation caused during closeout execution

SEC-02 intentionally changes `package.json` and `package-lock.json` to resolve the Next transitive `sharp` and `postcss` advisories. Therefore HEAD-clean package-lock enforcement was stale for this security branch.

### R1 Implementation

The Phase 4 closeout now captures package file baseline metadata at the beginning of execution for:

- `package.json`
- `package-lock.json`

Captured metadata:

- file existence
- regular-file check with symlink rejection
- SHA-256 content hash
- file size
- `git status --porcelain=v1` status code
- staged flag
- unstaged flag
- untracked flag
- merge-conflict flag

The closeout then re-reads the same metadata after the full Phase 4 validation and fails only if the package files mutate during the closeout run.

Blocking error labels:

- `PACKAGE_MANIFEST_CHANGED_DURING_CLOSEOUT`
- `PACKAGE_LOCK_CHANGED_DURING_CLOSEOUT`
- `PACKAGE_FILE_STATUS_CHANGED_DURING_CLOSEOUT`
- `PACKAGE_FILE_MISSING_AFTER_CLOSEOUT`

Success markers:

- `PASS PACKAGE_FILES_BASELINE_CAPTURED`
- `PASS PACKAGE_MANIFEST_UNCHANGED_DURING_CLOSEOUT`
- `PASS PACKAGE_LOCK_UNCHANGED_DURING_CLOSEOUT`
- `PASS PACKAGE_FILES_INVARIANCE_PASS`

### Package Baseline Status

Current package file status before and after R1 validation remained:

```text
 M package-lock.json
 M package.json
```

Current package file hashes after R1:

| File | SHA-256 | Size |
| --- | --- | ---: |
| `package.json` | `97b0509e3a5cddc7a172b2248cf6827d55bedbacdbe61b742189d62acceeabca` | 3032 |
| `package-lock.json` | `98ca9812ce9665eb83a8e4bb01be53050d8e0755051395e2ed14f308d74f6f8d` | 248979 |

The Phase 4 script compared start/end hash, size, and git status during closeout and reported no package mutation.

### R1 Validation Results

Security dependency checks:

- `npm ci`: PASS, package file hash unchanged, 0 vulnerabilities
- `npm ls sharp postcss --all`: PASS
- Final `sharp`: `0.35.3 overridden` under `next@16.2.10`
- Final Next-scoped `postcss`: `8.5.10 overridden` under `next@16.2.10`
- `sharp <0.35.0`: 0
- `postcss <8.5.10`: 0
- `npm audit --omit=dev --json`: moderate 0, high 0, critical 0
- `npm audit --include=dev --json`: moderate 0, high 0, critical 0

Database and generated type checks:

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, 16 files / 893 tests, skip 0
- `npm run db:types:local`: PASS
- Generated type diff: 0
- Migration diff: 0
- Database test diff: 0

Auth, runtime, and phase checks:

- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- Production smoke: PASS
- `npm run test:http:cookie-jar:local`: PASS, `HTTP_COOKIE_JAR_PASS`
- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- `npm run test:phase2:closeout:local`: PASS
- `npm run test:phase3:closeout:local`: PASS
- `npm run test:phase4:closeout:local`: PASS
- `PHASE4_DB_BASELINE_PASS`: observed
- `DB_OBSERVED_FILES=16`: observed
- `DB_OBSERVED_TESTS=893`: observed
- `PHASE4_CLOSEOUT_PASS`: observed
- `npm run test:custody:boundary:local`: PASS, `CUSTODY_BOUNDARY_PASS`

Notes:

- One Phase 4 attempt failed during the nested Phase 3 suite before the package invariance check. Direct re-runs showed Phase 3 and Phase 2 were healthy; the subsequent clean Phase 4 rerun passed.
- This R1 did not weaken or skip Phase 4 checks. It replaced the stale HEAD-clean package-lock assertion with a stricter execution-time package mutation guard.

### R1 End State

- Source application changes: 0
- Migration changes: 0
- DB test changes: 0
- Generated type changes: 0
- Next.js version change: 0
- React version change: 0
- Supabase CLI version change: 0
- Additional dependency added: 0
- `npm audit fix`: not run
- Service role, remote Supabase, mainnet: not used
- Secret values copied into this report: 0
- Process cleanup: PASS
- Supabase project containers after cleanup: 0
- Target port listeners after cleanup: 0

Final R1 project decision: `PASS_TO_P5_T02`.

Final R1 task status: `PASS`.
