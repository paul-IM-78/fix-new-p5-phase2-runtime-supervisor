# NEW-P5-T02-PRE-09K Node Child Process Launcher Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-phase2-supervisor`
- Branch: `fix/new-p5-phase2-runtime-supervisor`
- HEAD: `9579660cce7ee52a91fd81d7dc40a2b1d991be70`
- Observer path: `D:\Ai\staking-wallet-web-pre05-snapshot\PRE09K_ADMIN_ROLE_NODE_CHILD_PROCESS_LAUNCHER`
- Task: execute `inactive_revoke_only` exactly once through an external Node child-process launcher and validate stdio, exit, and close lifecycle.

## PRE-09J Carry Forward

```text
PRE09J_TARGET_LAUNCH_ATTEMPTED=true
PRE09J_TARGET_BUSINESS_EXECUTED=unknown
PRE09J_TARGET_EXIT_OBSERVED=false
PRE09J_TARGET_CLOSE_OBSERVED=false
PRE09J_STDIO_CAPTURE_VALID=false
PRE09J_PRIMARY=POWERSHELL_LAUNCHER_CHILD_LIFECYCLE_NOT_RECORDED
PRE09J_SECONDARY=TARGET_STDIO_OR_EXIT_CAPTURE_UNAVAILABLE
```

## Repository Freeze

- Repository code changes made by PRE-09K: 0
- Package changes made by PRE-09K: 0
- Source changes made by PRE-09K: 0
- Supabase changes made by PRE-09K: 0
- Staging: 0
- Commit: 0
- Push: 0
- PR: 0

The only repository file added by this task is this governance report.

## Node Launcher Structure

- Probe child: `env-probe-child.cjs`
- Probe launcher: `run-env-probe.cjs`
- Target launcher: `run-inactive-revoke.cjs`
- PowerShell child launcher: not used
- `ProcessStartInfo`: not used
- `cmd.exe`: not used
- `npm.cmd`: not used
- Target `shell`: false
- Target invocation count: 1

## Environment Probe

```text
NODE_LAUNCHER_ENVIRONMENT_PROBE=PASS
PROBE_LAUNCHER_PID=55152
PROBE_CHILD_PID=52616
PROBE_CHILD_SPAWN=true
PROBE_CHILD_ERROR_EVENT=false
PROBE_STDOUT_BYTES=20
PROBE_STDOUT_MATCH=true
PROBE_STDERR_BYTES=0
PROBE_EXIT_CODE=0
PROBE_CLOSE_CODE=0
CONFLICTING_MODE_KEY_COUNT=0
```

## Official Script Verification

- Package script: `test:auth:admin-roles:local`
- Package script command: `node scripts/auth/admin-role-commands.local.mjs`
- Official script classification: `direct_node`
- npm wrapper selected: false
- Actual target script: `D:\Ai\staking-wallet-web-phase2-supervisor\scripts\auth\admin-role-commands.local.mjs`

## Target Lifecycle

```text
NODE_LAUNCHER_PID=17292
TARGET_CHILD_PID=59200
TARGET_CHILD_SPAWN_EVENT=true
TARGET_CHILD_ERROR_EVENT=false
STDOUT_FIRST_DATA=false
STDERR_FIRST_DATA=true
STDOUT_BYTES=0
STDERR_BYTES=183
CHILD_EXIT_EVENT=true
CHILD_EXIT_CODE=1
CHILD_EXIT_SIGNAL=null
CHILD_CLOSE_EVENT=true
CHILD_CLOSE_CODE=1
CHILD_CLOSE_SIGNAL=null
LAUNCHER_EXIT_CODE=0
HEARTBEAT_INTERVAL_CLEARED=true
```

Event order:

```text
launcher_start
child_spawn
stderr_first_data
stderr_data
child_exit
child_close
cleanup_start
cleanup_end
launcher_end
```

## Safe Output Timeline

- First safe marker: `launcher_start`
- Last safe marker: `launcher_start`
- Final success marker: false
- Final failure marker: false
- Fixture guard: not reached
- Candidate count: not reached
- Expected state/version: not reached
- Business result: NOT_REACHED
- Audit assertion: NOT_REACHED

Safe stderr summary:

```text
FAIL ADMIN role commands auth handoff LOCAL_AUTH_HANDOFF_READINESS_TIMEOUT cause:AUTH_HANDOFF_NOT_READY
```

No secret value was copied from raw output.

## Process And Port

- Phase 2 path executed: false
- Next runtime PID observed: false
- Port `3000`, `3010`, `55721`-`55724` final listeners: 0
- Current worktree runtime processes final count: 0
- Runtime project containers final count: 0

The Node launcher heartbeat recorded a broad Docker `supabase` name sample of `33`. That broad count is not treated as project-scoped residue; the project-scoped final checks were clean.

## Cleanup

```text
npm run supabase:stop=PASS
STABLE_CLEAN_SAMPLES=3/3
PROJECT_SCOPED_FALLBACK_COUNT=0
FOREIGN_PROCESS_TERMINATION=0
QA_RESIDUE=0
ENV_LOCAL=absent
ENV_LOCAL_PHASE2_SUPERVISOR=absent
```

## Security And Static Gates

```text
START_PRODUCTION_AUDIT=0 vulnerabilities
START_FULL_AUDIT=0 vulnerabilities
START_LINT=PASS warning 0
START_BUILD=PASS
FINAL_PRODUCTION_AUDIT=0 vulnerabilities
FINAL_FULL_AUDIT=0 vulnerabilities
FINAL_LINT=PASS warning 0
FINAL_BUILD=PASS
```

## Raw Log Handling

- Raw logs scanned: `probe.stdout.log`, `probe.stderr.log`, `target.stdout.log`, `target.stderr.log`, `launcher-events.jsonl`
- Actual secret detected: 0
- Supabase local credential detected in raw logs: 0
- Raw logs deleted: 0
- Raw logs retained: safe diagnostic-only, empty, or metadata-only

## Secret Check

- Email copied: 0
- Password copied: 0
- Cookie copied: 0
- Access token copied: 0
- Refresh token copied: 0
- JWT copied: 0
- TOTP secret copied: 0
- Supabase key copied: 0
- Service role copied: 0
- DB URL copied: 0
- UUID copied: 0
- Command ID copied: 0
- Role assignment ID copied: 0
- Request or response body copied: 0
- Private key or mnemonic copied: 0
- npm token copied: 0

## Observer Manifest

- Manifest file: `D:\Ai\staking-wallet-web-pre05-snapshot\PRE09K_ADMIN_ROLE_NODE_CHILD_PROCESS_LAUNCHER\08-sha256-manifest.txt`
- Manifest status: created after observer documentation and raw-log review.

## Decision

```text
PRIMARY_CAUSE=ADMIN_ROLE_AUTH_HANDOFF_HANG
SECONDARY_CAUSE=NODE_LAUNCHER_TARGET_EXITED_NONZERO
LOCAL_DETAIL=LOCAL_AUTH_HANDOFF_READINESS_TIMEOUT
PRE09K_INACTIVE_REVOKE_VALID_PASS_COUNT=0
ADMIN_ROLE_INACTIVE_REVOKE_CUMULATIVE_RESULT=1/30_PASS
ADMIN_ROLE_DIRECT_CUMULATIVE_RESULT=0/20_NOT_RUN
ADMIN_ROLE_SUPERVISED_CUMULATIVE_RESULT=0/5_NOT_RUN
NEXT_TARGET_REPEAT_VALIDATION_POSSIBLE=false
RUNTIME_SUPERVISOR_COMMIT_POSSIBLE=false
P5_T02_PROGRESS_POSSIBLE=false
FINAL_STATUS=REQUIRES_ACTION
```

PRE-09K resolved the PRE-09J lifecycle ambiguity. The child process launched, emitted stderr, exited, and closed under Node launcher observation. The remaining failure is no longer stdio or lifecycle capture; it is the ADMIN Role command's auth handoff readiness timeout.
