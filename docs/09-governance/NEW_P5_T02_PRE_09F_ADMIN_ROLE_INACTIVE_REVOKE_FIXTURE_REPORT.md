# NEW-P5-T02-PRE-09F ADMIN Role inactive_revoke Fixture Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-phase2-supervisor`
- Branch: `fix/new-p5-phase2-runtime-supervisor`
- HEAD: `9579660cce7ee52a91fd81d7dc40a2b1d991be70`
- Task scope: restore the ADMIN Role Direct `inactive_revoke` fixture contract without changing production source, migrations, Supabase schema, package files, HTTP harness, auth handoff, supervisor, or Phase 2 wrapper.
- Allowed code change: `scripts/auth/admin-role-commands.local.mjs`
- Report file: `docs/09-governance/NEW_P5_T02_PRE_09F_ADMIN_ROLE_INACTIVE_REVOKE_FIXTURE_REPORT.md`

## Cleanup Resume

- Initial blocker: port `3000` was held by a current-worktree Next runtime.
- Listener classification: `CURRENT_WORKTREE_ORPHAN_NEXT_RUNTIME`
- Initial listener PID: `21372`
- Parent PID: `70628`
- Current worktree match: true
- Next runtime: true
- Foreign worktree: false
- Active test owner: false
- Graceful cleanup: attempted, blocked by child process ownership.
- Project-scoped fallback: used once against the verified current-worktree root process tree.
- Foreign process kill count: 0
- Supabase stop: PASS
- Stable clean sample count: 3
- Cleanup barrier: PASS

Two later validation invocations exceeded the external command timeout and left current-run process trees. Each was inspected, classified as current-run `test:phase2:closeout:local` ownership, and cleaned by verified root PID only. Foreign process kill count remained 0.

## PRE-09E Baseline Failure

- Official direct command: `npm run test:auth:admin-roles:local`
- Previous result: FAIL
- Last successful stage: `concurrent_grant`
- First failed stage: `inactive_revoke_result__admin_roles_result_admin_role_unavailable`
- Prior classification: ADMIN Role leaf implementation requires action; HTTP transport and supervisor core were not primary.

## Domain Contract

The production `public.revoke_admin_role(uuid, uuid, text)` contract is:

- If the target profile exists and the target has an active ADMIN role row, revoke returns `APPLIED`.
- The target profile can be inactive; inactive target ADMIN revoke is allowed.
- If no active ADMIN role row exists, revoke returns `NOOP`.
- Self-revoke returns `SELF_REVOKE_FORBIDDEN`.
- Replays return the original result with replay metadata.
- Command ID conflicts are rejected.
- `APPLIED` writes immutable audit with `previously_active=true`, `resulting_active=false`, and increments the role row version.
- `NOOP` writes immutable audit with `previously_active=false`, `resulting_active=false`, and no role row version.

Contract classification: `INACTIVE_REVOKE_EXISTING_ROW_REQUIRED`

## Root Cause

Primary cause:

```text
ADMIN_ROLE_SCENARIO_CONTEXT_REUSED
```

Contributing cause:

```text
ADMIN_ROLE_INACTIVE_FIXTURE_STATUS_MISMATCH
```

The prior `inactive_revoke` scenario reused the same target that earlier scenarios used for inactive grant and concurrent grant coverage. Because the failure happened immediately after `concurrent_grant`, the scenario depended on cross-scenario state instead of a scenario-local ADMIN role fixture.

The production command did not need changes. The test fixture needed a fresh target and explicit active ADMIN role reference before making the target profile inactive.

## Implemented Fixture Contract

The ADMIN Role leaf now creates a dedicated inactive-revoke target separate from the previous scenario target.

Fixture path:

```text
fresh target account
-> official grant API command
-> verify active ADMIN candidate count = 1
-> verify version = 1
-> set target profile status to RESTRICTED
-> fixture guard
-> official revoke API command
-> verify APPLIED
-> verify active ADMIN candidate count = 0
-> verify version = 2
-> verify REVOKE_ADMIN APPLIED audit delta = 1
-> restore profile status to ACTIVE
```

No direct SQL role mutation was added. SQL is used only for read verification and profile status setup/cleanup, matching the existing test harness style.

## Fixture Guard

Guard markers added:

```text
ADMIN_ROLE_INACTIVE_FIXTURE_CURRENT_RUN
ADMIN_ROLE_INACTIVE_FIXTURE_CURRENT_SCENARIO
ADMIN_ROLE_INACTIVE_FIXTURE_ROW_EXISTS
ADMIN_ROLE_INACTIVE_FIXTURE_ACTIVE
ADMIN_ROLE_INACTIVE_FIXTURE_ROLE_MATCH
ADMIN_ROLE_INACTIVE_FIXTURE_SCOPE_MATCH
ADMIN_ROLE_INACTIVE_FIXTURE_CANDIDATE_COUNT
ADMIN_ROLE_INACTIVE_FIXTURE_VERSION_MATCH
ADMIN_ROLE_INACTIVE_FIXTURE_REFERENCE_FRESH
ADMIN_ROLE_INACTIVE_REVOKE_FIXTURE_GUARD_PASS
ADMIN_ROLE_INACTIVE_REVOKE_FIXTURE_GUARD_FAIL
```

Guard behavior:

- Candidate count must be exactly `1`.
- Expected version must be `1` before revoke.
- Target account status must be `RESTRICTED`.
- Guard failure stops before the revoke command.
- No UUID, email, token, cookie, command ID, or role assignment ID is printed.

## Hunk Classification

Selected:

- `REQUIRED_FIXTURE_CREATION`
- `REQUIRED_FIXTURE_REFERENCE`
- `REQUIRED_SCENARIO_ISOLATION`
- `REQUIRED_CLEANUP`
- `REQUIRED_VERSION_TRACKING`
- `REQUIRED_BUSINESS_ASSERTION`

Excluded:

- `REQUIRED_HTTP_TRANSPORT`
- `REQUIRED_REQUEST_ISOLATION`
- `OBSERVABILITY_ONLY`
- `DIAGNOSTIC_MODE_ONLY` except the explicitly allowed `inactive_revoke_only` target mode
- `REPETITION_ONLY` retry behavior
- `STALE_PRE_ONLY`

## Validation

Static and security gates:

- `node --check scripts/auth/admin-role-commands.local.mjs`: PASS
- `node --check scripts/lib/local-http-harness.mjs`: PASS
- `node --check scripts/lib/local-auth-handoff.mjs`: PASS
- `node --check scripts/lib/local-runtime-supervisor.mjs`: PASS
- `node --check scripts/phase/phase2-closeout.local.mjs`: PASS
- `npm ci`: PASS
- `npm audit --omit=dev --json`: 0 vulnerabilities
- `npm audit --include=dev --json`: 0 vulnerabilities
- `npm run lint`: PASS, warnings 0
- `npm run build`: PASS
- Package diff: 0
- Production source diff: 0
- Supabase diff: 0

Runtime validation:

- Target diagnostic 1/1: PASS
- Target diagnostic 30/30: VALIDATION_INCOMPLETE
- ADMIN Role Direct 20/20: NOT_RUN
- Supervisor ADMIN Role 5/5: NOT_RUN

Reason for incomplete validation:

- A supervisor-level 30-run attempt exceeded a 40-minute external command timeout.
- A single supervisor invocation with internal 30-run target mode exceeded a 60-minute external command timeout.
- Current-run process trees were cleaned after each timeout.
- Because target 30/30 was not completed, Direct 20/20 and Supervisor 5/5 were intentionally not started.

## Retry and Assertion Policy

- Command retry count: 0
- Scenario retry count: 0
- Leaf retry count: 0
- Assertion weakening: 0
- Test skip: 0
- Production command changes: 0
- RPC changes: 0
- Migration changes: 0
- Package changes: 0

## Cleanup

Final cleanup:

- Supabase stop: PASS
- Port `3000`: listener 0
- Port `3010`: listener 0
- Ports `55721` through `55724`: listener 0
- Runtime project containers: 0
- Current worktree process count: 0
- `.env.local`: absent
- `.env.local.phase2-supervisor`: absent
- Stable clean sample count: 3
- Process cleanup: PASS
- QA residue: not fully measured because target 30/30 timed out before final success path

## Secret Check

- Email output: 0
- Password output: 0
- Cookie output: 0
- Access token output: 0
- Refresh token output: 0
- JWT output: 0
- TOTP secret output: 0
- Supabase key output: 0
- Service role output: 0
- DB URL output: 0
- UUID output in new diagnostic markers: 0
- Command ID output in new diagnostic markers: 0
- Role assignment ID output in new diagnostic markers: 0
- Private key or wallet recovery phrase output: 0

## Status

- Phase 2 repetition can resume only after a bounded or file-backed long-running validation strategy is approved.
- Runtime Supervisor commit readiness: false
- P5-T02 baseline readiness: false
- P5-T02 progress readiness: false

Final state:

```text
VALIDATION_INCOMPLETE
```
