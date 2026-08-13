# P5-T05-06 Custody Observer Resilience Closeout Contract

## 1. Task Identity

| Field | Value |
| --- | --- |
| Task | `P5-T05-06` |
| Canonical title | resilience, repeated DB/runtime closeout, and PR readiness |
| Branch baseline | `9298841dc0a516d76b9ab7cba3d11d1deb6e8ca1` |
| Authoritative roadmap | `NEW_P5_T05_01_CUSTODY_OBSERVER_RUN_LEDGER_CONTRACT.md`, section 19 |
| Task classification | `QUALIFICATION_PLUS_TEST_INFRASTRUCTURE` |
| Default posture | `QUALIFICATION_FIRST_NO_NEW_RUNTIME_CAPABILITY` |

## 2. Authoritative Roadmap and Objective

The roadmap defines P5-T05-06 as "resilience, repeated DB/runtime closeout, and PR readiness" after P5-T05-02 through P5-T05-05. This task repeatedly qualifies the completed durable observer system; it is not a recovery, scheduling, retry, or remediation subsystem.

The objective is to establish reproducible resilience evidence for the existing durable ledger, recorded observer lifecycle, and ADMIN+AAL2 operational read model, then prepare a PR-ready closeout. This document freezes decisions only. No qualification has been executed by this document.

## 3. Inherited Predecessor Contracts

| Predecessor | Inherited guarantee |
| --- | --- |
| P5-T05-02 | Forward-only private durable run ledger, writer-role boundary, and pgTAP qualification. |
| P5-T05-03 | Server-only run-ledger client, strict validation, safe failure mapping, and idempotent close. |
| P5-T05-04 | Recorded one-shot lifecycle, durable scope/failure evidence, abort and failure-origin semantics. |
| P5-T05-05 | Read-only user-scoped ADMIN+AAL2 List/Detail, safe public projection, no-store, and read-only fingerprints. |

Existing local qualification boundaries remain: provider application network calls `0`, provider credential environment reads `0`, and application service-role usage `0`.

## 4. Production-Change Policy

`NO_PROACTIVE_PRODUCTION_CHANGE` applies. Completed T05-02 through T05-05 production implementation is frozen at entry.

A production DB, source, API, generated-type, or route modification is permitted only after a T05-06 execution produces reproducible evidence of a violation of a frozen predecessor contract. Qualification must then stop, the defect must be classified precisely, and a separate remediation scope must be approved before any production change. Refactoring or cleanup-only redesign is not permitted.

Default T05-06 production source diff, migration diff, generated type diff, and API route diff are all `0`.

## 5. Three-Cycle Resilience Model

Exactly three consecutive bounded complete cycles are required: `cycle 1`, `cycle 2`, and `cycle 3`. Two cycles, an unlimited loop, and a time-based soak test do not satisfy this contract.

Each cycle records DB result, recorded observer result, operational-read result, cleanup result, isolation result, and residue result in harness output and later governance evidence. Cycle state must never be persisted in production schema.

One complete cycle contains:

1. Clean cycle-entry integrity check.
2. Canonical project-local Supabase startup.
3. Local DB reset/apply.
4. DB lint.
5. Full DB pgTAP suite.
6. Existing recorded observer lifecycle regression.
7. Bounded operational-read regression.
8. Read-only and ledger-integrity verification where applicable.
9. Cycle-owned process, port, and container cleanup.
10. Residue verification and cycle result recording.

Cleanup or residue failure makes that cycle fail.

## 6. Per-Cycle DB Gate

Every cycle executes local DB reset, DB lint, and the full DB pgTAP suite. With no default DB artifacts changed, the inherited baseline is `33 files / 1609 tests / 0 failures / 0 skips` for every cycle. A count drift without an intentional DB change is a discrepancy requiring investigation.

DB reset is an independent clean-cycle boundary. It is not evidence that durable state survives an infrastructure restart.

## 7. Recorded Observer Runtime Gate

Every cycle re-exercises the existing recorded observer/lifecycle boundary through predecessor-supported harnesses. Where those harnesses already cover them, the required semantic set includes successful one-shot execution, pre-abort, mid-run abort, never-started aborted evidence, reporter/pre-commit failure, failure-origin distinction, discovery/cleanup failure paths, durable scope/failure evidence, and cleanup.

Existing duplicate/idempotency/conflict behavior may be requalified only where already defined by predecessors. T05-06 introduces no new semantic rule for a predecessor-undefined duplicate scenario.

## 8. Operational-Read Runtime Gate

Every cycle executes a bounded P5-T05-05 regression containing at least a real ADMIN+AAL2 List success, Detail success, representative authorization denial, representative strict validation failure, bounded cursor/pagination verification, safe public projection, `Cache-Control: no-store`, read-only fingerprint/invariance, and cleanup.

The dedicated T05-05 harness remains the exhaustive authority. Repeating exhaustive MFA and every List/Detail subcase three times is not required unless the existing harness architecture naturally does so.

## 9. Application Restart and Build Freshness

Cycle-owned runtime processes must start cleanly, qualify, stop cleanly, and restart for the next cycle. At minimum this includes owned local Next/runtime harness processes.

Before a `next start` qualification that depends on current source, a successful current build must exist or a fresh build must occur at the appropriate final qualification boundary. A stale `.next` artifact is an environment/build-freshness issue, not automatically a production source defect.

## 10. Controlled Non-Reset Supabase Restart

`ONE_CONTROLLED_NON_RESET_SUPABASE_RESTART` is required once across all three cycles, not once per cycle. Its purpose is to prove durable run, scope, and failure evidence survives a controlled infrastructure restart.

The bounded procedure is:

1. Create or obtain valid durable run/scope/failure evidence using existing behavior.
2. Record safe identifiers and semantic fingerprints before restart.
3. Stop only the project-owned local Supabase stack using canonical project-local CLI.
4. Do not run DB reset.
5. Restart the same project-local stack and verify local infrastructure health.
6. Re-read durable evidence and compare identifiers/fingerprints.
7. Verify expected status, version, terminal data, scope evidence, and failure evidence remain; no duplicate evidence or extra terminalization occurs.
8. Verify operational read can retrieve safe evidence where technically appropriate, then clean owned resources.

No DB reset is allowed between steps 3 and 7. Fingerprints and identifiers, rather than byte-identical physical database state, are the evidence standard.

## 11. Local Supabase Ownership

Only the project-local Supabase CLI is allowed. The inherited canonical local version is `2.109.1`; npm script or local `.bin` resolution is preferred over global CLI use.

The restart check must detect unrelated stacks, touch only project-owned resources, avoid global Docker prune and arbitrary volume deletion, and preserve unrelated containers/services. If tooling cannot safely prove non-reset persistence, qualification stops and records the limitation; persistence evidence must not be silently weakened.

Stale project-local service metadata may be diagnosed as a test-environment scenario. A project-local stop/recovery and one safe retry are allowed only after ownership is established. Repository configuration is not modified for this condition.

## 12. Failure Matrix and Repeat Distinction

Existing supported scenarios are eligible: pre-abort, mid-run abort, never-started aborted persistence, reporter/pre-commit failure, discovery failure, cleanup failure, and predecessor-defined duplicate/idempotency/conflict behavior. Do not manufacture impossible rows by disabling constraints and do not add production-only fault hooks.

Repeated *test* execution of clean supported scenarios is in scope. New *product* automatic retry, replay, resume, re-run, recovery engine, retry queue, retry scheduler, operator control endpoint, automatic terminalization repair, or automatic remediation is out of scope.

## 13. Security and Mutation Boundary

| Boundary | Frozen decision |
| --- | --- |
| New production DB write behavior | Prohibited; existing observer writes may be exercised. |
| New writer RPC, mutation API, lifecycle/retry/lease metadata | Prohibited. |
| Provider application network | `0`; real custody provider calls are prohibited. |
| Provider credential reads | `0`; no provider, signing, or production secret reads. |
| Application service-role use | `0`; locally privileged fixture setup is separate from the application-under-test boundary. |
| Scheduler, cron, queue, daemon, lease stealing, stale reaper | Prohibited. |
| Automated replay, resume, retry, repair, alert remediation | Prohibited. |
| Signing, broadcast, transfer, payout, withdrawal, financial remediation, webhook mutation | Prohibited; invocation count `0`. |

Localhost traffic for local Next, Supabase/Auth/Postgres, and explicit local harness infrastructure is allowed.

## 14. Cleanup and Residue Contract

Every cycle and controlled restart cleans resources it owns on success, assertion failure, and runtime exception. Required final residue is owned Next processes `0`, owned child processes `0`, watched ports `0`, and project-owned Supabase containers `0` when the harness lifecycle requires stop. Unrelated resources touched must equal `0`. Cleanup failure fails the associated execution.

## 15. Acceptance Gates

### 15.1 Per-Cycle

Each cycle requires DB reset PASS, DB lint PASS, pgTAP failures `0`, pgTAP skips `0`, required recorded-runtime failures/skips `0`, required operational-read failures/skips `0`, cleanup residue `0`, provider network `0`, credential reads `0`, application service-role `0`, and unexpected repository mutation `0`.

### 15.2 Cross-Cycle

All three cycles must pass with no stale project processes, watched-port leakage, project-owned container leakage, harness-caused run-ID collision, duplicate terminalization, evidence loss, semantic degradation, or production file mutation. UUIDs and timestamps need not be identical; semantic guarantees must be stable.

### 15.3 Restart Persistence

The controlled restart must preserve durable run, scope, and failure evidence, expected run status/version/terminal information, and safe operational-read access where appropriate. It must create no evidence duplication or extra terminalization and leave restart-owned residue at zero.

### 15.4 Final-Once Qualification

After cycles and restart pass, run once: TypeScript, ESLint, production build, secret scan, forbidden-capability scan, generated-type review, frozen-predecessor diff review, and exact intended-file scope review. Expected errors/warnings/secrets/forbidden capabilities are `0`.

## 16. Frozen Predecessor Paths

| Scope | Classification |
| --- | --- |
| T05-02 durable-ledger migration and DB contract | `FROZEN_NO_TOUCH` |
| T05-03 run-ledger client | `FROZEN_NO_TOUCH_UNLESS_DEFECT_PROVEN` |
| T05-04 orchestrator, recorded integration, migration, pgTAP, focused harnesses | `FROZEN_NO_TOUCH_UNLESS_DEFECT_PROVEN`; preserve and orchestrate harnesses |
| T05-05 migration, pgTAP, types, validation, public results, server model, routes | `FROZEN_NO_TOUCH_UNLESS_DEFECT_PROVEN` |
| T05-05 runtime harness | `PRESERVE_AND_ORCHESTRATE` |

## 17. Expected Implementation Surface

| Path | Action | Purpose |
| --- | --- | --- |
| `docs/09-governance/NEW_P5_T05_06_CUSTODY_OBSERVER_RESILIENCE_CLOSEOUT_CONTRACT.md` | Create now | Frozen contract. |
| `scripts/test-p5-t05-custody-observer-resilience-runtime.mjs` | Create later | Orchestrate existing commands/harnesses, cycle evidence, restart, cleanup, and summary. |
| `package.json` | Modify later | One focused resilience command. |
| `docs/09-governance/NEW_P5_T05_06_CUSTODY_OBSERVER_RESILIENCE_CLOSEOUT_REPORT.md` | Create later | Final evidence and PR readiness. |
| Migrations, generated types, source, routes | No change by default | Require proven defect and separate remediation scope. |

The resilience harness orchestrates existing qualified surfaces; it must not copy or weaken predecessor internal test logic. It supports independently runnable cycles and restart checks, with full orchestration reserved for local/manual/CI use because local Supabase/MFA/Next work can exceed one external execution window.

## 18. PR-Readiness and Governance Evidence

PR readiness requires this frozen contract, resilience harness, three passing cycles, passing non-reset persistence check, final static/security qualification, unchanged predecessor production artifacts, final governance report, the future publication marker, exact intended diff scope, and intentionally prepared clean publication state.

The final report records each cycle, DB counts, command outcomes, controlled-restart evidence, cleanup/residue, isolation counters, environment incidents, actual defects and remediation scopes, final static/security gate, frozen-path integrity, accepted limitations, and PR-readiness conclusion. Intermittent failures that required remediation must not be concealed.

The future report marker is `PASS_P5_T05_06_RESILIENCE_CLOSEOUT_READY_FOR_PUBLICATION`. It is a future completion marker and is not asserted by this contract.

## 19. Non-Goals

This task does not add production retry, replay, resume, re-run, recovery, scheduler, queue, cron, daemon, lease subsystem, stale reaper, provider execution, provider credential loading, application service-role paths, signing, transfers, payouts, withdrawals, financial remediation, webhook mutation, deployment wiring, or new durable schema.

## 20. Defect and Remediation Procedure

On a reproducible resilience failure, preserve safe evidence, classify whether it violates a predecessor contract, stop qualification, and open a separate remediation scope before changing production behavior. Test-infrastructure or governance-only correction may proceed only when it does not alter production behavior or weaken predecessor qualification.

## 21. Entry and Completion Gates

Entry requires canonical T05-02 through T05-05 completion, clean branch state, and this frozen contract. Completion requires every acceptance gate in section 15 and PR-readiness conditions in section 18. No qualification result is claimed here.

```text
EXPECTED_FUTURE_PUBLICATION_MARKER=PASS_P5_T05_06_RESILIENCE_CLOSEOUT_READY_FOR_PUBLICATION
CONTRACT_STATUS=READY_FOR_P5_T05_06_RESILIENCE_HARNESS_IMPLEMENTATION
```
