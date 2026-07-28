# NEW-P5-T02-PRE-09C Phase 2 Leaf Parity Report

## Scope

- Project: D:\Ai\staking-wallet-web-phase2-supervisor
- Branch: fix/new-p5-phase2-runtime-supervisor
- HEAD: 9579660cce7ee52a91fd81d7dc40a2b1d991be70
- Validated source inspected read-only: D:\Ai\staking-wallet-web-closeout-integration
- P5-T02 implementation: not started
- Staging: not used
- Commit, push, PR: not performed

## Starting State

- Branch and HEAD matched the requested baseline.
- Working tree preserved the existing PRE-09A/PRE-09B changes.
- Staging was empty.
- The PRE09C transfer bundle path did not exist before this task.
- package.json and package-lock.json had no diff.
- src/** and supabase/** had no diff.
- Legacy repository was treated read-only.
- No local listeners were present on ports 3000, 3010, 55721, 55722, 55723, or 55724 before validation.

## Parity Audit

The supervisor worktree already contained:

- scripts/lib/local-auth-handoff.mjs
- scripts/lib/local-http-harness.mjs
- scripts/lib/local-runtime-supervisor.mjs

The Phase 2 leaf scripts did not use the available helper boundary before PRE-09C. The validated source worktree had leaf-level auth handoff and local HTTP transport wiring, while the supervisor worktree still used direct global fetch calls.

Cause classification:

- LEAF_PARITY_TRANSFER_INCOMPLETE
- HELPER_PRESENT_BUT_UNUSED
- LEAF_USES_LEGACY_GLOBAL_FETCH
- LEAF_USES_MIXED_RUNTIME_OWNERSHIP

Not selected before retest:

- SUPERVISOR_CORE_FAILURE

## Remediation

Changed PRE-09C allowed leaf files only:

- scripts/auth/admin-mfa.local.mjs
- scripts/auth/admin-role-commands.local.mjs
- scripts/domain/admin-domain-lifecycle.local.mjs
- scripts/domain/wallet-account-status.local.mjs

Applied minimal parity:

- Import localFetch from the existing supervisor local HTTP harness.
- Import waitForLocalAuthHandoffReady from the existing auth handoff helper.
- Await auth handoff readiness before public smoke and authentication actions.
- Read APP_ORIGIN from process.env.APP_ORIGIN with localhost fallback.
- Route appFetch and appJsonFetch through localFetch.
- Route Mailpit polling through localFetch.

No business assertions were weakened. No skips, command retries, fallback kills, package changes, src changes, Supabase schema changes, or supervisor core rewrites were added.

Supervisor core files intentionally not modified by PRE-09C:

- scripts/lib/local-auth-handoff.mjs
- scripts/lib/local-http-harness.mjs
- scripts/lib/local-runtime-supervisor.mjs
- scripts/phase/phase2-closeout.local.mjs

## Transfer Bundle

Created:

- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09C_PHASE2_LEAF_PARITY_TRANSFER\01-leaf-parity-audit.md
- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09C_PHASE2_LEAF_PARITY_TRANSFER\02-selected-hunks.md
- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09C_PHASE2_LEAF_PARITY_TRANSFER\03-excluded-hunks.md
- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09C_PHASE2_LEAF_PARITY_TRANSFER\04-leaf-parity.patch
- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09C_PHASE2_LEAF_PARITY_TRANSFER\05-sha256-manifest.txt

Manifest hashes were generated for the first four bundle files.

## Static Validation

Syntax:

- node --check scripts/lib/local-auth-handoff.mjs: PASS
- node --check scripts/lib/local-http-harness.mjs: PASS
- node --check scripts/lib/local-runtime-supervisor.mjs: PASS
- node --check scripts/phase/phase2-closeout.local.mjs: PASS
- node --check scripts/auth/admin-mfa.local.mjs: PASS
- node --check scripts/auth/admin-role-commands.local.mjs: PASS
- node --check scripts/domain/admin-domain-lifecycle.local.mjs: PASS
- node --check scripts/domain/wallet-account-status.local.mjs: PASS

Package and build:

- npm ci: PASS, 0 vulnerabilities
- npm audit --omit=dev --json: vulnerabilities 0
- npm audit --include=dev --json: vulnerabilities 0
- npm run lint: PASS
- npm run build: PASS

## Leaf Smoke Validation

All smoke runs used the official supervisor path:

```text
PHASE2_SUPERVISOR_MODE=leaf_direct
npm run test:phase2:closeout:local
```

Results:

- ADMIN MFA 1/1: PASS
- ADMIN Role Commands 1/1: PASS
- Domain Lifecycle 1/1: PASS
- Wallet Status 1/1: PASS

Observed markers:

- RUNTIME_OWNERSHIP=PARENT_OWNED_RUNTIME
- CLEANUP_OWNERSHIP=PARENT_OWNED_RUNTIME
- MIXED_OWNERSHIP=false
- PHASE2_SUPERVISOR_CHILD_EXIT
- PHASE2_SUPERVISOR_CHILD_CLOSE
- PHASE2_SUPERVISOR_CLEANUP_BARRIER_PASS
- PHASE2_SUPERVISOR_LEAF_PASS

## Repeat Validation

Required repeat validation was started after all smoke runs passed.

Attempted:

1. ADMIN Role Commands 5-run batch
2. ADMIN Role Commands 3-run batch

Both attempts exceeded the outer command timeout before returning final PASS or FAIL markers to Codex. The attempts were not counted toward the required fresh 20/20 total.

After each timeout, only current-project runtime cleanup was performed:

- Current project node phase2/next process tree terminated.
- npm run supabase:stop executed.
- Ports 3000, 3010, 55721, 55722, 55723, 55724 returned to no listeners.
- staking-wallet-web containers returned to none.

No repeat target was completed:

- ADMIN Role Commands: NOT_COMPLETED
- Domain Lifecycle: NOT_STARTED
- Wallet Status: NOT_STARTED
- Phase 2 Closeout: NOT_STARTED

Because required repeat targets were not met, final post-repeat audit/lint/build was not rerun.

## Security Check

- package.json diff: 0
- package-lock.json diff: 0
- src/** diff: 0
- supabase/** diff: 0
- Service Role addition: 0
- Secret file addition: 0
- Production or Mainnet connection: 0
- Direct P5-T02 implementation: 0
- Actual secret, token, private key, or mnemonic value copied to this report: 0

The scripts contain only deny-list marker strings used by safety assertions.

## Final Cleanup

- Supabase local setup stopped for staking-wallet-web.
- Project containers: 0
- Ports 3000, 3010, 55721, 55722, 55723, 55724: no listeners after cleanup.
- Staging: not used.
- Commit, push, PR: not performed.

## Final Decision

Leaf parity restoration is complete and smoke validation passed. The full PRE-09C acceptance criteria are not complete because repeat validation could not return required totals within the current command execution window.

Final state:

- REQUIRES_ACTION

Recommended next action:

- Diagnose supervisor batch duration/hang behavior from a clean runtime using smaller counted batches or a supervisor-level timeout/streaming strategy.
- Do not start P5-T02 implementation until Phase 2 repeat validation reaches the required totals.
