# NEW-P5-T02-PRE-09E ADMIN Role Direct vs Supervisor A/B Report

## Scope

- Worktree: D:\Ai\staking-wallet-web-phase2-supervisor
- Branch: fix/new-p5-phase2-runtime-supervisor
- HEAD: 9579660cce7ee52a91fd81d7dc40a2b1d991be70
- P5-T02 implementation: not started
- Existing PRE-09A, PRE-09B, PRE-09C, PRE-09D changes: preserved
- Staging, commit, push, PR: not performed

## PRE-09D Result Carried Forward

- ADMIN Role child exit observed: true
- ADMIN Role child close observed: true
- ADMIN Role child exit code: 1
- ADMIN Role business result: FAIL
- Supervisor pass marker: false
- Supervisor fail marker: true
- Cleanup barrier: FAIL
- Parent-owned Next runtime residue: true

Current PRE-09D interpretation carried forward:

- ADMIN_ROLE_SUPERVISED_EXECUTION_FAILURE=true
- SUPERVISOR_CLEANUP_BARRIER_HANG=true
- SUPERVISOR_CLEANUP_BARRIER_HANG_IS_SECONDARY=true
- PHASE2_SUPERVISOR_CORE_FAILURE=NOT_CONFIRMED

## Static Gate

Start gate:

- npm audit --omit=dev --json: vulnerabilities 0
- npm audit --include=dev --json: vulnerabilities 0
- npm run lint: PASS
- npm run build: PASS

End gate:

- npm audit --omit=dev --json: vulnerabilities 0
- npm audit --include=dev --json: vulnerabilities 0
- npm run lint: PASS
- npm run build: PASS

## Direct Execution Contract

- Official package script: test:auth:admin-roles:local
- Direct node target: scripts/auth/admin-role-commands.local.mjs
- Supervisor used: false
- Phase 2 wrapper used: false
- Supabase owner: external direct harness
- DB reset owner: external direct harness
- Next runtime owner: external direct harness
- Next runtime start count: 1
- APP_ORIGIN: present, localhost
- Auth handoff owner: leaf child helper
- Session owner: leaf child
- AAL2 owner: leaf child
- Cleanup owner: external direct harness
- Final success marker: absent
- Final failure marker: present

## Supervisor Execution Contract

- Supervisor wrapper: scripts/phase/phase2-closeout.local.mjs
- Supervisor helper: scripts/lib/local-runtime-supervisor.mjs
- Supervisor leaf label: admin_role_commands
- Child script: test:auth:admin-roles:local
- Child working directory: repository root
- APP_ORIGIN passed to child: present
- Parent-owned Supabase: true
- Parent-owned Next runtime: true
- Auth handoff owner: parent helper and leaf child helper
- Child cleanup responsibility: none
- Parent cleanup responsibility: supervisor helper
- Failure cleanup sequence: carried forward from PRE-09D

## Contract Diff

- Runtime owner: different
- Cleanup owner: different
- APP_ORIGIN state: same
- Supabase owner: different
- Next owner: different
- Auth handoff owner: different
- Session owner: same
- AAL2 owner: same
- HTTP harness usage: same

Environment key diff, focused keys only:

- DIRECT_ONLY_KEY_COUNT=3
- SUPERVISOR_ONLY_KEY_COUNT=3
- COMMON_KEY_COUNT=2
- OVERRIDDEN_KEY_COUNT=2
- REMOVED_KEY_COUNT=0

No environment values, prefixes, lengths, or hashes were recorded.

## Direct Single Result

- ADMIN_ROLE_DIRECT_SINGLE_RESULT=FAIL
- ADMIN_ROLE_DIRECT_FAILURE_STAGE=inactive_revoke_result__admin_roles_result_admin_role_unavailable
- ADMIN_ROLE_DIRECT_LAST_SUCCESS_STAGE=concurrent_grant
- ADMIN_ROLE_DIRECT_EXIT_CODE=1
- ADMIN_ROLE_DIRECT_SIGNAL=none
- ADMIN_ROLE_DIRECT_CLEANUP_PASS=true
- Port residue after cleanup: 0
- Container residue after cleanup: 0

## Supervisor Single Result

- ADMIN_ROLE_SUPERVISED_SINGLE_RESULT=NOT_RUN
- Reason: direct invocation failed and stop conditions require stopping on Direct Leaf Business Failure.

## A/B Result

- ADMIN_ROLE_DIRECT_AB_RESULT=0/5_PASS
- ADMIN_ROLE_SUPERVISED_AB_RESULT=0/5_PASS
- A/B pair validation: not run

## Root Cause Classification

Selected classification:

- ADMIN_ROLE_LEAF_IMPLEMENTATION=REQUIRES_ACTION
- PHASE2_SUPERVISOR_CORE_FAILURE=NOT_PRIMARY

Not selected:

- ADMIN_ROLE_DIRECT_SELF_OWNED_VALID
- ADMIN_ROLE_SUPERVISOR_PARENT_OWNED_VALID
- ADMIN_ROLE_PARENT_CHILD_OWNERSHIP_MISMATCH
- ADMIN_ROLE_AUTH_HANDOFF_OWNER_MISMATCH
- ADMIN_ROLE_SESSION_BOOTSTRAP_OWNER_MISMATCH
- ADMIN_ROLE_ENVIRONMENT_INHERITANCE_MISMATCH
- ADMIN_ROLE_APP_ORIGIN_MISMATCH
- ADMIN_ROLE_SUPERVISOR_CORE_FAILURE

Rationale:

- Direct execution failed without supervisor involvement.
- The direct failure occurred after concurrent_grant and before inactive revoke completion.
- Therefore PRE09E cannot attribute the primary failure to supervisor runtime ownership or environment inheritance.

## Cleanup

- Runtime project containers: 0
- Next test process: 0
- Known project descendant: 0
- Port 3000 listener: 0
- Port 3010 listener: 0
- Port 55721 listener: 0
- Port 55722 listener: 0
- Port 55723 listener: 0
- Port 55724 listener: 0
- .env.local: absent
- .env.local.phase2-supervisor: absent

## Security

- Secret output in report: 0
- Cookie or token output: 0
- Email output: 0
- UUID or command id output: 0
- Request or response body output: 0
- Service Role output: 0
- Private key or mnemonic output: 0

## Validation Ledger

- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09E_ADMIN_ROLE_DIRECT_SUPERVISOR_AB\01-contract-diff.md
- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09E_ADMIN_ROLE_DIRECT_SUPERVISOR_AB\02-environment-key-diff.md
- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09E_ADMIN_ROLE_DIRECT_SUPERVISOR_AB\03-direct-run-ledger.md
- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09E_ADMIN_ROLE_DIRECT_SUPERVISOR_AB\04-supervised-run-ledger.md
- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09E_ADMIN_ROLE_DIRECT_SUPERVISOR_AB\05-cleanup-failure-path.md
- D:\Ai\staking-wallet-web-pre05-snapshot\PRE09E_ADMIN_ROLE_DIRECT_SUPERVISOR_AB\06-sha256-manifest.txt

## Final Decision

- Supervisor fix scope: not opened by PRE09E.
- Leaf fix scope: required before runtime supervisor repeat validation can resume.
- Runtime supervisor commit readiness: not ready.
- P5-T02 baseline readiness: not ready.
- P5-T02 progress: blocked.

Final status:

- REQUIRES_ACTION
