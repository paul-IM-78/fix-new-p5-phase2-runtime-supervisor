# NEW-P5-T02-PRE-09L Local Auth Handoff Readiness Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-phase2-supervisor`
- Branch: `fix/new-p5-phase2-runtime-supervisor`
- HEAD: `9579660cce7ee52a91fd81d7dc40a2b1d991be70`
- Observer path: `D:\Ai\staking-wallet-web-pre05-snapshot\PRE09L_LOCAL_AUTH_HANDOFF_READINESS`
- Task: compare and restore the stable Local Auth Handoff readiness helper before ADMIN Role execution.

## PRE-09K Result

```text
NODE_LAUNCHER_ENVIRONMENT_PROBE=PASS
TARGET_INVOCATION_COUNT=1
TARGET_CHILD_SPAWN_EVENT=true
TARGET_CHILD_ERROR_EVENT=false
TARGET_CHILD_EXIT_EVENT=true
TARGET_CHILD_CLOSE_EVENT=true
PHASE2_PATH_EXECUTED=false
PRIMARY_CAUSE=ADMIN_ROLE_AUTH_HANDOFF_HANG
LOCAL_DETAIL=LOCAL_AUTH_HANDOFF_READINESS_TIMEOUT
```

PRE-09K did not prove fixture or business failure because it stopped at auth handoff readiness.

## Helper Hash And Parity

```text
CURRENT_AUTH_HANDOFF_SHA256=45fb5b1c9d85902401321209ff9f8733f293236062fb14ba27f6af4430d880ba
STABLE_CLOSEOUT_AUTH_HANDOFF_SHA256=6f76ffb7c98e037dff5f459c23a815d1f2dc2b6681b18cec3d21fbf044a70437
STABLE_RUNTIME_AUTH_HANDOFF_SHA256=9df893ad917f26a29da70a758fe80b28a447f10cc310034b5a92edf0b9080e4a
AUTH_HANDOFF_CLOSEOUT_DIFF_PARITY=true
AUTH_HANDOFF_RUNTIME_DIFF_PARITY=false
```

The current helper now has diff parity with the stable closeout helper. The restored hunks separate internal GoTrue readiness from Kong auth route readiness, add project identity assertions, classify stale Kong upstreams, and keep recovery bounded to at most one current-project Kong restart.

## ADMIN Role Helper Call Order

Current ADMIN Role execution order:

```text
waitForLocalAuthHandoffReady("ADMIN role commands auth handoff")
assertPublicSmoke()
assertSameOriginRejectionsWithoutSession()
inactive_revoke_only diagnostic branch
```

The helper runs before the ADMIN Role fixture and business assertions.

## Readiness Classification

```text
LOCAL_GOTRUE_INTERNAL_READY=true
LOCAL_KONG_AUTH_ROUTE_READY=true
LOCAL_KONG_AUTH_STATUS=200
LOCAL_KONG_STALE_AUTH_UPSTREAM=false
LOCAL_AUTH_EXPECTED_PROJECT_MATCH=true
LOCAL_AUTH_FOREIGN_PROJECT_RUNTIME=false
LOCAL_AUTH_API_PORT_MATCH=true
LOCAL_AUTH_CONTAINER_SET_MATCH=true
PRIMARY_READINESS_CAUSE=LOCAL_AUTH_HANDOFF_HELPER_PARITY_MISSING
AUTH_HANDOFF_NOT_READY_AS_ROOT_CAUSE=false
```

## Selected And Excluded Hunks

Selected:

- `REQUIRED_INTERNAL_GOTRUE_READINESS`
- `REQUIRED_KONG_AUTH_READINESS`
- `REQUIRED_PROJECT_IDENTITY`
- `REQUIRED_PORT_RELAY_CLASSIFICATION`
- `REQUIRED_STALE_UPSTREAM_RECOVERY`
- `REQUIRED_BOUNDED_POLLING`
- `REQUIRED_SAFE_CAUSE_MAPPING`

Excluded:

- PRE repetition mode
- Safe tail diagnostics
- One-off debug markers
- Retry changes
- Timeout-only increases
- Other file hunks

## Modified Files

```text
scripts/lib/local-auth-handoff.mjs
docs/09-governance/NEW_P5_T02_PRE_09L_LOCAL_AUTH_HANDOFF_READINESS_REPORT.md
```

No ADMIN Role fixture, supervisor, HTTP harness, package, production source, or Supabase file was modified.

## Auth Handoff Probe

```text
LOCAL_AUTH_HANDOFF_PROBE_RESULT=10/10_PASS
LOCAL_AUTH_HANDOFF_RECOVERY_ATTEMPTED=false
LOCAL_AUTH_HANDOFF_RECOVERY_COUNT=0
LOCAL_AUTH_HANDOFF_RECOVERY_PROJECT_SCOPED=true
```

All 10 independent probe invocations passed with `AUTH_HANDOFF_READY`.

One observer setup attempt failed before Supabase start due to a Windows npm shim execution path. It did not reach the helper and is excluded from the 10/10 auth handoff probe count.

## Target Smoke

```text
ADMIN_ROLE_INACTIVE_REVOKE_AUTH_HANDOFF_SMOKE=0/3_PASS
TARGET_SMOKE_RUNS_EXECUTED=1
TARGET_SMOKE_RUNS_SKIPPED_AFTER_FAILURE=2
TARGET_EXIT_CODE=1
TARGET_CLOSE_CODE=1
TARGET_SMOKE_PRIMARY_CAUSE=ADMIN_ROLE_MFA_ENROLLMENT_START_FAILURE
```

Safe target smoke markers reached:

```text
PASS ADMIN role commands auth handoff AUTH_HANDOFF_READY
PASS Public role command smoke
PASS Role command same-origin rejection
```

Safe target failure:

```text
FAIL Enrollment start status
```

The target smoke confirms auth handoff recovery but does not satisfy the 3/3 target acceptance criterion.

## Gates

```text
node --check scripts/lib/local-auth-handoff.mjs=PASS
node --check scripts/auth/admin-role-commands.local.mjs=PASS
npm ci=PASS
production audit=0 vulnerabilities
full audit=0 vulnerabilities
lint=PASS warning 0
build=PASS
package diff=0
production source diff=0
supabase diff=0
```

## Cleanup

```text
npm run supabase:stop=PASS
STABLE_CLEAN_SAMPLES=3/3
PORT_3000_LISTENER=0
PORT_3010_LISTENER=0
PORT_55721_LISTENER=0
PORT_55722_LISTENER=0
PORT_55723_LISTENER=0
PORT_55724_LISTENER=0
WORKTREE_RUNTIME_PROCESSES=0
PROJECT_CONTAINERS=0
ENV_LOCAL=absent
ENV_LOCAL_PHASE2_SUPERVISOR=absent
QA_RESIDUE=0
```

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
- Target user ID copied: 0
- Private key or mnemonic copied: 0
- npm token copied: 0

## Decision

```text
AUTH_COMMAND_RETRY_COUNT=0
BUSINESS_COMMAND_RETRY_COUNT=0
ASSERTION_WEAKENING=0
ADMIN_ROLE_INACTIVE_REVOKE_CUMULATIVE_RESULT=1/30_PASS
NEXT_TARGET_REPEAT_VALIDATION_POSSIBLE=false
RUNTIME_SUPERVISOR_COMMIT_POSSIBLE=false
P5_T02_BASELINE_POSSIBLE=false
P5_T02_PROGRESS_POSSIBLE=false
FINAL_STATUS=REQUIRES_ACTION
```

PRE-09L restored the local auth handoff readiness helper and proved the auth handoff path 10/10. The task cannot pass because the required `inactive_revoke_only` target smoke 3/3 did not pass; the remaining failure is the ADMIN Role MFA enrollment start status, which is outside the allowed PRE-09L modification scope.
