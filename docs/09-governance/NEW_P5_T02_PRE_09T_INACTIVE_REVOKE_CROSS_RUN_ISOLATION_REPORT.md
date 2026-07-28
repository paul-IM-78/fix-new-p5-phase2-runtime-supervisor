# NEW-P5-T02-PRE-09T Inactive Revoke Cross-Run Isolation Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-phase2-supervisor`
- Branch: `fix/new-p5-phase2-runtime-supervisor`
- HEAD: `9579660cce7ee52a91fd81d7dc40a2b1d991be70`
- Task: isolate the `inactive_revoke_only` run-2 `admin_role_unavailable` reported after PRE-09S and apply a minimal script fix only if a concrete cross-run cause is reproduced.
- Ignored scope: Salon ERP, Step 3-CL, P5-T02 implementation.

## Preserved Baseline

- PRE-09S QR normalization route change preserved.
- MFA enrollment behavior preserved.
- Runtime ownership model preserved:
  - Direct mode: self-owned runtime.
  - Supervisor mode: parent-owned runtime.
- Auth handoff, local HTTP harness, runtime supervisor, package files, Supabase files, routes, RPC, and migrations were not modified in PRE-09T.

## PRE-09S Input State

PRE-09S established:

- Reference ADMIN MFA post-fix: PASS.
- ADMIN Role MFA post-fix: PASS.
- Enrollment smoke: 3/3 PASS.
- `inactive_revoke_only` run 1: PASS.
- `inactive_revoke_only` run 2: FAIL with public result `admin_role_unavailable`.
- `inactive_revoke_only` run 3: not run.

## Source Analysis

Read-only source inspection found:

- `/api/v1/admin/roles/revoke` redirects failed command execution to the mapped public error.
- `executeAdminRoleCommand("revoke", ...)` maps RPC errors to `admin_role_unavailable`.
- `revoke_admin_role` requires the actor to satisfy `is_current_user_admin_aal2()`.
- The current diagnostic script creates a fresh admin actor and fresh inactive-revoke target for each independent process invocation.

Potential classes considered:

- `ACTOR_ADMIN_ROLE_UNAVAILABLE`
- `TARGET_ADMIN_ROLE_UNAVAILABLE`
- `TARGET_ROLE_ASSIGNMENT_NOT_ACTIVE`
- `TARGET_ROLE_ASSIGNMENT_NOT_FOUND`
- `COMMAND_CANDIDATE_UNAVAILABLE`
- `STALE_COMMAND_RESULT`
- `INACTIVE_REVOKE_TRANSIENT_ENVIRONMENT_FAILURE`

## Reproduction

PRE-09T current-code reproduction used two independent invocations:

```text
ADMIN_ROLE_DIAGNOSTIC_MODE=inactive_revoke_only
```

Results:

- Reproduction run 1: PASS.
- Reproduction run 2: PASS.
- `admin_role_unavailable`: not reproduced.
- Retry count: 0.
- Assertion relaxation: 0.

Because the failure did not reproduce, no script fix was applied.

## Cross-Run Stability

Five further independent invocations were executed without changing code:

```text
ADMIN_ROLE_INACTIVE_REVOKE_CROSS_RUN_SMOKE=5/5_PASS
```

Each run reported:

- Self-owned runtime bootstrap: PASS.
- Auth handoff after runtime ready: PASS.
- MFA enrollment: PASS.
- AAL2 admin page: PASS.
- Target fixture guard: PASS.
- Candidate count: 1.
- Command result: APPLIED.
- Business assertion: PASS.
- Audit assertion: PASS.
- Runtime cleanup: PASS.

## Parity

- Cross-run actor state parity: true.
- Cross-run target freshness parity: true.
- Cross-run candidate guard parity: true.
- Cross-run cleanup parity: true.
- Actor-target distinct: preserved by separate generated actor and target fixtures per invocation.
- Actor role-target role distinct: preserved by separate users and separate role rows per invocation.

No raw user ids, profile ids, role assignment ids, command ids, emails, cookies, tokens, MFA secrets, QR data, or scenario references were recorded.

## Root Cause

Confirmed current-task classification:

```text
INACTIVE_REVOKE_TRANSIENT_ENVIRONMENT_FAILURE
```

Reason:

- The PRE-09S failure was not reproducible under the same current worktree and diagnostic mode.
- Two reproduction runs passed.
- Five further stability runs passed.
- No actor/target/candidate/cleanup drift was observed through existing safe markers.
- No code-level cross-run contamination cause could be confirmed.

## Fix Decision

Selected hunk:

- Governance report only.

Excluded hunk:

- No `scripts/auth/admin-role-commands.local.mjs` change.
- No QR route change.
- No MFA logic change.
- No runtime ownership change.
- No auth handoff change.
- No local HTTP harness change.
- No supervisor change.
- No production source change.
- No RPC or migration change.
- No command retry.
- No auth retry.
- No failed-run retry.
- No assertion relaxation.

## Validation

Static and security gates:

- `node --check scripts/auth/admin-role-commands.local.mjs`: PASS.
- `node --check scripts/auth/admin-mfa.local.mjs`: PASS.
- `node --check scripts/lib/local-auth-handoff.mjs`: PASS.
- `node --check scripts/lib/local-http-harness.mjs`: PASS.
- `node --check scripts/lib/local-runtime-supervisor.mjs`: PASS.
- `node --check scripts/phase/phase2-closeout.local.mjs`: PASS.
- `npm ci`: PASS.
- `npm audit --omit=dev --json`: 0 vulnerabilities.
- `npm audit --include=dev --json`: 0 vulnerabilities.
- `npm run lint`: PASS.
- `npm run build`: PASS.

Diff invariants:

- `package.json`: no PRE-09T diff.
- `package-lock.json`: no PRE-09T diff.
- `supabase/**`: no PRE-09T diff.
- `src/**`: no PRE-09T diff beyond preserved PRE-09S state.

Cleanup:

- Final Supabase stop: PASS.
- Port 3000 listener: 0.
- Port 3010 listener: 0.
- Ports 55721-55724 listeners: 0.
- Current project containers: 0.
- Host port 3000 published container: 0.
- `.env.local`: absent.
- `.env.local.phase2-supervisor`: absent.

## Pass Count

- Previous official valid inactive-revoke pass count: 4/30 from PRE-09S reporting.
- PRE-09S run 1 accepted as valid pass: true.
- PRE-09T new valid pass count: 5.
- Updated cumulative result:

```text
ADMIN_ROLE_INACTIVE_REVOKE_CUMULATIVE_RESULT=9/30_PASS
```

## Observer

Observer directory:

```text
D:\Ai\staking-wallet-web-pre05-snapshot\PRE09T_INACTIVE_REVOKE_CROSS_RUN_ISOLATION
```

Files:

- `01-unavailable-source.md`
- `02-actor-target-contract.md`
- `03-run-1-state-ledger.md`
- `04-run-1-cleanup-ledger.md`
- `05-run-2-state-ledger.md`
- `06-run-2-failure-ledger.md`
- `07-cross-run-parity.md`
- `08-fix-decision.md`
- `09-post-fix-validation.md`
- `10-sha256-manifest.txt`

## Secret Review

- Email values: not recorded.
- Password values: not recorded.
- Cookie values: not recorded.
- Access or refresh tokens: not recorded.
- JWTs: not recorded.
- TOTP secrets: not recorded.
- QR data, SVG, base64 payloads: not recorded.
- Supabase keys, service role keys, DB URLs: not recorded.
- UUIDs and internal ids: not recorded.
- Private keys and mnemonics: not present.

## Final Status

```text
PASS_DIAGNOSTIC
```

P5-T02 status:

- QR normalization remains PASS.
- Enrollment 3/3 remains preserved.
- `inactive_revoke_only` is now 5/5 stable in PRE-09T, but the PRE-09S run-2 failure source was not reproduced.
- P5-T02 can proceed only if the project accepts this as a diagnostic pass rather than a code-fix pass.
