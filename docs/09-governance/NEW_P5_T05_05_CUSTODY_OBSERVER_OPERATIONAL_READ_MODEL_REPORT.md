# P5-T05-05: Custody Observer Operational Read Model Report

## 1. Task Identity

| Field | Value |
| --- | --- |
| Task | P5-T05-05 |
| Canonical title | ADMIN+AAL2 operational read model for safe list/detail and derived stale/severity/alert eligibility |
| Branch | `feat/p5-t05-operational-read-model` |
| Base HEAD | `3cf5d6d24ab74a4462f7efc1fdba0e0c5cd9b72e` |

## 2. Executive Result

P5-T05-05 is qualified for publication preparation. It implements a read-only ADMIN+AAL2 operational read boundary over the durable custody observer run ledger. All required final DB, bounded runtime, static, read-only fingerprint, and isolation gates passed.

## 3. Scope and Contract Reference

Implementation follows the frozen contract at [NEW_P5_T05_05_CUSTODY_OBSERVER_OPERATIONAL_READ_MODEL_CONTRACT.md](NEW_P5_T05_05_CUSTODY_OBSERVER_OPERATIONAL_READ_MODEL_CONTRACT.md). This task adds safe List and Detail read access only; it does not change custody observer execution or P5-T05-04 behavior.

## 4. Implemented Artifacts

| Artifact | Path |
| --- | --- |
| Frozen contract | `docs/09-governance/NEW_P5_T05_05_CUSTODY_OBSERVER_OPERATIONAL_READ_MODEL_CONTRACT.md` |
| Database migration | `supabase/migrations/20260809130000_p5_t05_operational_read_model.sql` |
| DB qualification | `supabase/tests/database/p5_t05_operational_read_model.test.sql` |
| Generated types | `src/types/database.types.ts` |
| Query validation | `src/lib/custody/operational-read-validation.ts` |
| Public result normalization | `src/lib/custody/operational-read-public-results.ts` |
| Server read model | `src/server/admin/custody-observer-operational-read-model.ts` |
| List route | `src/app/api/v1/admin/custody-observer/runs/route.ts` |
| Detail route | `src/app/api/v1/admin/custody-observer/runs/[runId]/route.ts` |
| Runtime harness | `scripts/test-p5-t05-custody-observer-operational-read-runtime.mjs` |
| Package script | `package.json` |

## 5. Database Design and Security

The migration introduces dedicated read RPCs: `public.list_admin_custody_observer_runs(...)` and `public.get_admin_custody_observer_run_detail(...)`. They are `STABLE`, `SECURITY DEFINER`, use a fixed empty search path, and use fully-qualified references.

`PUBLIC` execute is revoked, `anon` execute is denied, and `authenticated` execute is granted. Each RPC performs its own DB-side ADMIN+AAL2 recheck. Private tables remain private; no public safe view or application service-role access is required.

## 6. Stale, Severity, and Alert Eligibility Contract

The trusted server UTC clock owns a fixed 15-minute cutoff. It is not client-, environment-, or DB-configurable. A run is stale only when it is `RUNNING` and `started_at < cutoff`; equality is not stale. A `RUNNING` null `started_at` is safely non-stale by logic, although the persisted schema makes it unreachable. The public model exposes only the Boolean `stale`, with no threshold or cutoff metadata.

Severity precedence is `CRITICAL > WARNING > INFO`:

| Severity | Conditions | Alert eligible |
| --- | --- | --- |
| INFO | normal non-stale RUNNING, COMPLETED, ABORTED | false |
| WARNING | PARTIAL | true |
| CRITICAL | stale RUNNING; known discovery/cleanup terminal failure | true |

The explicit terminal failure allowlist is `ORCHESTRATOR_SCOPE_DISCOVERY_FAILED`, `ORCHESTRATOR_SCOPE_PAGE_INVALID`, `ORCHESTRATOR_SCOPE_CURSOR_LOOP`, `ORCHESTRATOR_DISCOVERY_LIMIT_EXCEEDED`, `ORCHESTRATOR_SCOPE_DUPLICATE`, `ORCHESTRATOR_PROVIDER_REF_INVALID`, and `ORCHESTRATOR_CLIENT_CLOSE_FAILED`. No alert reason or delivery behavior is exposed.

## 7. List Public Contract

`GET /api/v1/admin/custody-observer/runs` accepts official filters `status`, `stale`, `severity`, and `alertEligible`, plus strict `cursor` and `limit`. Unknown or duplicate query fields return `400 invalid_query`.

Ordering is `created_at DESC, run_id DESC`. Pagination is opaque strict keyset pagination using an internal `createdAt + runId` cursor, default limit 25, range 1..100, and limit+1 lookahead. Responses are `{ items, totalCount, nextCursor }`; `nextCursor` is null at the end and `totalCount` is the complete filtered result count, independent of cursor position. There is no `hasMore`.

## 8. Detail Public Contract

`GET /api/v1/admin/custody-observer/runs/{runId}` returns `400 invalid_run_id` for malformed UUIDs, `404 custody_observer_run_not_found` for a valid missing UUID, and `{ item: ... }` for an authorized existing run.

The safe item contains run-level metadata, complete `scopeOutcomes`, and complete `bindingFailures`. Evidence arrays are unpaginated, untruncated, and deterministically ordered. Only safe nullable descriptors such as `providerName` and `assetSymbol` are exposed. Private IDs, raw messages, and raw errors are excluded.

All exact public integers remain decimal strings, including version, five core run counts, `totalCount`, scope counts, and failure attempt counts. No JavaScript number conversion is used.

## 9. Authorization, Validation, and Error Contract

Application requests use a user-scoped Supabase server client. Runtime qualification covered anonymous, non-admin AAL1, non-admin AAL2, ADMIN+AAL1, ADMIN+AAL2, and restricted ADMIN sessions through real signup, login, MFA enrollment, challenge, verification, and genuine AAL2 sessions. Fake JWT use was false.

All public errors have the envelope `{ "error": { "code": "..." } }`, with no message, DB details, SQLSTATE, or raw parser error. Canonical codes are:

| Status | Codes |
| --- | --- |
| 400 | `invalid_query`, `invalid_run_id`, `invalid_cursor`, `invalid_limit`, `invalid_status`, `invalid_stale`, `invalid_severity`, `invalid_alert_eligible` |
| 401 | `authentication_required` |
| 403 | `admin_access_required`, `admin_aal2_required` |
| 404 | `custody_observer_run_not_found` |
| 500 | `custody_observer_read_failed` |

## 10. Final Qualification Evidence

| Gate | Result |
| --- | --- |
| DB reset | PASS |
| DB lint | PASS |
| DB qualification | 33 files / 1609 assertions / 0 failures / 0 skips |
| TypeScript | `npx tsc --noEmit` PASS, 0 errors |
| Lint | PASS, 0 errors, 0 warnings |
| Build | `npm run build` PASS, 0 errors; fresh before final runtime regression |
| Foundation runtime | 19 cases PASS |
| List runtime | 23 cases PASS |
| Detail runtime | 20 cases PASS |
| Fingerprint runtime | 18 cases PASS |

Runtime was intentionally split into bounded phases because the local Supabase/Auth/MFA/Next harness exceeded an external execution window as one monolithic invocation during development. The split did not reduce final coverage; each bounded phase completed with 0 failures and 0 skips.

List qualification covered strict query validation, all filters, positive and contradictory AND filtering, exact public projection, string integer types, ordering and same-timestamp ties, opaque cursor roundtrips, multi-page traversal without repeats or skips, filtered `totalCount`, and `no-store`.

Detail qualification covered malformed and missing UUIDs, ADMIN+AAL2 success, restricted ADMIN denial, exact envelope and public projection, two populated scope rows and two populated binding failures, deterministic nested order, safe descriptors, private/raw-error exclusion, and `no-store`.

## 11. Read-Only Fingerprint and Isolation Evidence

The final fingerprint phase passed 18 cases. Run, scope, and failure fingerprints were identical before and after reads. Application read-path inserts, updates, deletes, version changes, lifecycle changes, terminal changes, and evidence changes were all zero.

External application network calls, provider network calls, provider credential environment reads, and application service-role usage were all zero. Local test-infrastructure privilege was limited to fixture insertion, repository-supported auth fixture preparation, and fingerprint inspection; it is not application runtime privilege.

The final source-boundary scan found no service-role use, provider networking, credential loading, scheduler, queue, mutation control, retry/resume/cancel/acknowledge behavior, or raw DB error public exposure. P5-T05-05 remains read-only.

## 12. Runtime-Discovered Production Defects and Remediations

| Defect | File | Effect | Remediation | Result |
| --- | --- | --- | --- | --- |
| Detail input UUID regex omitted the canonical fourth UUID group/hyphen | `src/lib/custody/operational-read-validation.ts` | valid Detail UUID returned `400 invalid_run_id` | aligned regex to repository canonical UUID convention | PASS |
| Public-results UUID regex independently duplicated the malformed pattern | `src/lib/custody/operational-read-public-results.ts` | valid List RPC rows normalized to `500 custody_observer_read_failed` | corrected regex | PASS |
| Detail object passed nested evidence into strict run-summary exact-key normalization | `src/lib/custody/operational-read-public-results.ts` | valid Detail normalization failed | separated scope evidence, failure evidence, and run-summary-only projection while retaining strict validation | PASS |

## 13. Environment and Runtime Findings

These findings are distinct from production defects.

| Finding | Classification | Resolution |
| --- | --- | --- |
| Global Supabase CLI `2.106.0` rejected valid existing `local_smtp` configuration; project-local CLI is `2.109.1` | CLI version mismatch | use project-local/npm-script CLI; package, lockfile, and installed version already agree |
| stale imgproxy and pooler local service metadata remained with no Docker containers | stale local Supabase state | project-local `supabase:stop` cleared ephemeral state; no repository/config defect |
| `next start` consumed an older `.next` after Detail source remediation | `STALE_NEXT_BUILD_ARTIFACT` | fresh `npm run build` produced Detail HTTP 200; not a production source defect |

## 14. Frozen-Path and Repository Integrity

P5-T05-05 was implemented forward-only. Final Step 5A confirmed zero P5-T05-04 source, migration, pgTAP, and runtime harness changes. Before this evidence report, the intentional implementation worktree had 11 paths, staging was empty, upstream was none, push count was zero, PR was absent, package-lock diff was zero, unexpected files were absent, and `git diff --check` passed.

## 15. Accepted Limitation

`HTTP_500_FAULT_INJECTION_NOT_AVAILABLE_WITHOUT_PRODUCTION_CHANGE` is an `ACCEPTED_NON_BLOCKING_LIMITATION`. Generic safe 500 mapping is statically and server qualified. Runtime fault injection would require a production-only test hook or a deliberate production failure capability, neither of which was introduced. This is not a skipped test and does not reduce security-boundary confidence.

## 16. Non-Goals Preserved

This task does not implement alert delivery, retry, cancel, resume, acknowledge, resolve, re-run, scheduler, queue, cron, daemon, stale reaper, provider API execution, provider credential loading, service-role application paths, reconciliation triggers, transfers, payouts, signing, webhooks, financial remediation, or deployment wiring.

## 17. Final Conclusion and Publication Marker

P5-T05-05 implements a read-only ADMIN+AAL2 operational read boundary over the durable custody observer run ledger, providing safe List/Detail access with DB-canonical stale/severity/alert eligibility derivation, strict validation, opaque keyset pagination, exact numeric-string preservation, safe nested evidence projection, user-scoped application access, and DB-side authorization recheck.

All final required DB, runtime, static, and security qualification passed. Publication has not happened.

`PASS_P5_T05_05_OPERATIONAL_READ_MODEL_READY_FOR_PUBLICATION`
