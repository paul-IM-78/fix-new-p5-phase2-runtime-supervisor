# P5-T02-14 Phase 5 Reconciliation Closeout Contract

## 1. Identity and Status

- Task: `P5-T02-14` - Closeout - Phase 5 reconciliation gate.
- Classification: `QUALIFICATION_AND_GOVERNANCE_CLOSEOUT`.
- Default posture: `NO_PROACTIVE_PRODUCTION_OR_SCHEMA_CHANGE`.
- Execution model: `BOUNDED_INDEPENDENT_QUALIFICATION`.
- Status: contract frozen; qualification has not yet started.

This contract defines the current-canonical closeout of the Phase 5
reconciliation workstream. It is a qualification and governance task, not a
new reconciliation product feature.

## 2. Authority, Baseline, and Scope

The authoritative planning source is
`docs/09-governance/NEW_P5_T02_01_REQUIREMENTS_AND_IMPLEMENTATION_PLAN.md`.
Its P5-T02-14 definition is authoritative:

- Purpose: close the Phase 5 reconciliation gate.
- Expected implementation scope: closeout checklist/report and, only if
  needed, additive closeout script changes.
- DB changes: none unless a predecessor defect is proven.
- Production source changes: none unless a predecessor defect is proven.
- External/provider network: not required.
- Prior task: P5-T02-13.
- Completion gate: DB, lint, build, custody boundary, reconciliation E2E,
  secret scan, and process cleanup.

The canonical baseline is:

- Canonical branch: `fix/new-p5-phase2-runtime-supervisor`.
- Canonical baseline SHA: `4be726f12de83af351ea10c8d44f10e9d780445a`.
- Feature branch: `feat/p5-t02-14-reconciliation-closeout`.

All P5-T02-14 evidence must be collected against this canonical baseline plus
the governance-only P5-T02-14 changes. Historical P5-T02-13D evidence is not
the current runtime baseline.

## 3. Frozen Predecessor and Remediation Policy

P5-T02-02 through P5-T02-13 are
`FROZEN_NO_TOUCH_UNLESS_DEFECT_PROVEN`. Completed P5-T03, P5-T04, and P5-T05
areas are also protected from incidental modification.

The normal expected diff is governance-only:

- production source: 0;
- migrations and schema artifacts: 0;
- generated types: 0;
- `package.json`: 0;
- `package-lock.json`: 0;
- existing runtime harnesses: 0.

If a qualification gate reproduces a real defect, the closeout must stop,
preserve safe failure evidence, identify the predecessor owner, and open a
separate remediation scope. Production or schema changes must not be silently
made inside normal closeout work.

## 4. DB Qualification

The eventual current-canonical DB sequence is:

```text
npm run supabase:start
npm run db:reset:local
npm run db:lint:local
npm run db:test:local
```

`npm run db:types:local` is a generator, not a no-write check. It may run only
when needed for validation, followed by generated-type diff review.

Required final DB evidence is reset PASS, zero lint errors and warnings, full
pgTAP with zero failures and no skips unless explicitly authorized by an
existing contract, actual current file/test counts, and generated-type diff 0.
The historical P5-T02-13D count of `26 / 1272` is reference only. The closeout
uses `CURRENT_COUNTS_TO_BE_MEASURED_DURING_CLOSEOUT`.

## 5. Static Qualification

The eventual static sequence is:

```text
npx tsc --noEmit
npm run lint
npm run build
```

Required evidence is zero TypeScript errors, zero ESLint errors and warnings,
production build PASS, and no tracked build-output mutation.

## 6. Focused Custody Boundary Regression

The required focused custody regression is:

```text
npm run test:custody:boundary:local
```

It must preserve approved custody configuration, unsupported-network
rejection, applicable ADMIN/AAL2 and same-origin mutation boundaries,
replay/conflict safety, public-safe reads, audit safety, no sensitive/private
credential exposure, and no application service-role regression.

P5-T02-14 does not require full reruns of the P5-T03 suite, the P5-T04 suite,
or P5-T05 three-cycle resilience qualification unless this focused command
exposes a defect.

## 7. Reconciliation E2E Qualification

The reconciliation commands execute independently:

```text
npm run test:reconciliation:review:local
npm run test:reconciliation:admin-read:local
npm run test:reconciliation:admin-ui:local
```

Required markers are respectively:

```text
PASS_P5_T02_RUNTIME_CLOSEOUT_READY
PASS_ADMIN_RECONCILIATION_READ_RUNTIME_READY
PASS_ADMIN_RECONCILIATION_REVIEW_ACTION_UI_RUNTIME_READY
```

The review runtime covers reconciliation review lifecycle. The ADMIN read
runtime covers the guarded public-safe read model. The ADMIN UI runtime covers
the UI and review-action matrix. Historical counts (ADMIN read 25; ADMIN UI
total 34, including read regression 27, action UI 7, and reused review API 8)
are reference only. Actual current counts, failures, skips, and markers are
captured during closeout.

The review-action boundary remains frozen: ADMIN+AAL2, same-origin server
routes, no direct browser private DB mutation, no client-supplied authority,
optimistic concurrency, exact replay safety, stale-version conflict safety,
terminal-state protection, and writes limited to intended review case/event
scope. It must not mutate reconciliation items, correct balances or ledgers,
post financially, call a provider, sign, or automatically remediate.

## 8. Security and Cleanup

Mandatory final security evidence includes a focused secret scan, zero
application service-role use, zero provider-network calls, no raw/private
observation exposure, no token/JWT/cookie/session/credential output, no
tracked secret artifact, and `.env.local` content never read or reported.
Environment quarantine, where used by the existing harnesses, must restore
correctly with no residue.

The recommended dependency regression commands are:

```text
npm audit --omit=dev --json
npm audit --include=dev --json
```

Both are expected to report zero vulnerabilities. A new advisory stops for
security review; dependencies must not be silently updated.

After every runtime phase, require owned Next processes and Node children at
zero; ports `3000`, `3010`, `55721`, `55722`, `55723`, `55724` clear;
project Supabase containers cleaned according to harness ownership; fixture
residue and environment-quarantine residue zero; and unrelated resources
touched zero. Current ownership must be preserved. Legacy self-owned
closeout/orchestration behavior must not be revived.

## 9. Bounded Execution and Failure Handling

Each expensive command may run as an independent bounded phase. Final
governance evidence may aggregate completed phases only when production/schema
state and predecessor code remain unchanged and each phase cleanup completes.
A monolithic aggregate runner is not required, and no new harness is added
unless a missing qualification path is later proven.

An outer Codex/tool execution timeout is not automatically a product or
repository defect. When a healthy child remains active, classify it separately
as an execution-environment limitation, use an adequate bounded outer
allowance when appropriate, and do not change product/repository timeouts or
auto-retry repeatedly.

No three-cycle repetition is imposed. One current-canonical qualification is
required unless a gate fails, remediation occurs, or a later contract-specific
requirement requires requalification.

## 10. Planned Closeout Sequence

1. Phase A: baseline, integrity, and current command mapping.
2. Phase B: DB qualification.
3. Phase C: custody boundary regression.
4. Phase D: reconciliation review runtime.
5. Phase E: ADMIN reconciliation read runtime.
6. Phase F: ADMIN reconciliation UI and review-action runtime.
7. Phase G: final static, dependency, and security qualification.
8. Phase H: cleanup, frozen-integrity, and exact-scope closeout.
9. Phase I: final governance report.

## 11. Expected File Scope and Report

The planned final report is:

```text
docs/09-governance/NEW_P5_T02_14_PHASE5_RECONCILIATION_CLOSEOUT_REPORT.md
```

It must record actual canonical DB and runtime counts, markers, failures and
skips, custody results, audits, secret/security findings, cleanup, frozen
predecessor integrity, exact file scope, PR readiness, accepted limitations,
and any defect/remediation evidence. It is not created in this contract step.

The default final scope is exactly the contract and report. Harness files,
package files, production source, migrations, and generated types remain 0
unless the separate-defect rule is triggered.

## 12. Dependency Security Remediation Exception

Step 8 production audit identified an inherited canonical dependency finding.
P5-T02-14 introduced no dependency change and no vulnerability. The finding is
classified as `INHERITED_CANONICAL_SECURITY_FINDING`.

The approved remediation is `next` `16.2.11` to `16.3.0`. This is a supported
semver-minor framework security remediation with MEDIUM regression risk. The
only allowed dependency files are:

```text
package.json
package-lock.json
```

Production source, migrations/schema, generated types, and harness changes are
expected to remain 0. The expected final T02-14 scope becomes the contract,
`package.json`, `package-lock.json`, and the final closeout report.

DB reset/lint/pgTAP evidence may remain preserved if the Next update has no
DB/schema/tooling impact. The following must be requalified after dependency
remediation: TypeScript, lint, production build, custody boundary,
reconciliation review runtime, ADMIN read runtime, ADMIN UI runtime, production
audit, full audit, and secret/security/frozen-integrity review. This exception
does not claim that those post-remediation gates have already passed.

```text
P5_T02_14_DEPENDENCY_SECURITY_REMEDIATION_SCOPE_APPROVED
```

### Manifest Canonicalization

The canonical `package.json` contained duplicate
`test:custody:balance-observer-resilience:local` keys. JSON and npm used the
later value, `node scripts/test-p5-t05-custody-observer-resilience-runtime.mjs`.
Normalization removed only the unreachable earlier P5-T03 definition.
Classification: `SEMANTICS_PRESERVING_MANIFEST_CANONICALIZATION`. The approved
state is `KEEP_NORMALIZED`, with effective runtime behavior change 0.

### Final Dependency Override Strategy

The final approved manifest keeps `next` at `16.3.0`, removes
`overrides.next.postcss`, and adds root overrides `postcss` `8.5.23` and
`nanoid` `3.3.17`. The Next-scoped `sharp` override remains `0.35.3`; all
other existing overrides remain unchanged.

Next `16.3.0` natively declares PostCSS `8.5.23`, so the old Next-specific
`8.5.18` pin is stale. The root PostCSS override keeps the graph outside the
current vulnerable PostCSS range, and the root Nanoid override removes the
vulnerable `3.3.16` resolution. No production source change is required.

```text
P5_T02_14_DEPENDENCY_REMEDIATION_TARGET_FROZEN
```

### Development Dependency Advisory Remediation

The full dependency audit identified two inherited canonical development-only
findings. No vulnerability waiver is permitted: both the production and full
audit targets remain 0. These changes affect no production source, harness,
schema, migration, generated type, or DB tooling path; the qualified DB
evidence remains preserved. They add no runtime scope beyond the already
required Step 8R3 application requalification.

#### brace-expansion

- Finding: inherited canonical development dependency advisory.
- Advisory: `GHSA-rgw5-rvv9-x895` (High).
- Previous resolution: `5.0.8`.
- Safe target: `5.0.9`.
- Dependency owner: ESLint through minimatch.
- Exposure: `DEV_TOOLING_ONLY`; the production graph is not affected.
- Approved change: `overrides.minimatch.brace-expansion` `5.0.8` to `5.0.9`.

#### js-yaml

- Finding: inherited canonical development dependency advisory.
- Advisory: `GHSA-5p4m-2wfm-xmqj` (High).
- Previous resolution: `4.3.0`.
- Safe target: `4.3.1`.
- Dependency owner: ESLint through `@eslint/eslintrc`.
- Exposure: `DEV_TOOLING_ONLY`; the production graph is not affected.
- Approved change: root override `js-yaml` `4.3.1`.

```text
P5_T02_14_DEV_DEPENDENCY_REMEDIATION_TARGET_FROZEN
```

### Brace-Expansion Resolution Correction

The initial approved attempt set
`overrides.minimatch.brace-expansion` to `5.0.9`. After a normal npm install,
the installed ESLint-to-minimatch path still resolved `brace-expansion` to
`5.0.8`, and the full audit remained at one High finding. `npm explain`
classified the outcome as `NESTED_OVERRIDE_NOT_APPLIED_TO_OVERRIDDEN_PARENT_EDGE`.

The final approved correction removes the ineffective nested override and adds
the root override `brace-expansion` `5.0.9`. Its scope is
`DEV_TOOLING_ONLY_ROOT_OVERRIDE`: production graph, Next, Supabase runtime, and
DB tooling impact are all 0. It adds no application runtime qualification beyond
the existing Step 8R3 plan.

The final `package.json` and `package-lock.json` pair must reproduce
`brace-expansion` `5.0.9` using a fresh `npm ci`.

```text
P5_T02_14_BRACE_EXPANSION_ROOT_OVERRIDE_TARGET_FROZEN
```

### Dependency Security Remediation Closeout

The final manifest uses the root `brace-expansion` override `5.0.9`; the
ineffective nested minimatch override has been removed. A fresh `npm ci`
reproduced the safe dependency graph without changing either `package.json` or
`package-lock.json`.

The current clean-installed graph records production vulnerabilities 0 and full
vulnerabilities 0. The four reviewed advisories are absent from this project
graph: `GHSA-rgw5-rvv9-x895`, `GHSA-5p4m-2wfm-xmqj`,
`GHSA-2v37-7h3g-55p8`, and `GHSA-fxqj-rqcc-2cmp`.

Production source, schema, and harness changes remain 0. The current DB
evidence remains preserved. Application and static runtime requalification is
still required in Step 8R3.

```text
CLEAN_INSTALL_SECURITY_GRAPH_REPRODUCED
PASS_P5_T02_14_DEPENDENCY_SECURITY_REMEDIATION
```

## 13. Contract Marker

```text
PASS_P5_T02_14_CLOSEOUT_CONTRACT_READY
```

This marker means the scope is frozen and qualification may begin. It does not
mean P5-T02-14 qualification or Phase 5 closeout has passed.
