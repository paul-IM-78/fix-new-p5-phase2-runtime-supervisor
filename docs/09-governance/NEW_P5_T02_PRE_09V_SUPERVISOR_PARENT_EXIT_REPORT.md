# NEW-P5-T02-PRE-09V Supervisor Parent Exit Report

## Scope

```text
Worktree=D:\Ai\staking-wallet-web-phase2-supervisor
Branch=fix/new-p5-phase2-runtime-supervisor
HEAD=9579660cce7ee52a91fd81d7dc40a2b1d991be70
Task=Supervisor parent event-loop quiescence and natural-exit lifecycle
```

No P5-T02 implementation was started. No package, lockfile, Supabase schema, `src/**`, auth handoff, HTTP harness, MFA business, QR route, or ADMIN Role business logic was changed in PRE-09V.

## PRE-09U Baseline

```text
PRE09F_VALID_PASS=1
PRE09S_VALID_PASS=1
PRE09T_VALID_PASS=7
ADMIN_ROLE_INACTIVE_REVOKE_CUMULATIVE_RESULT=9/30_PASS
STRICT_DIRECT_REPEAT_BLOCKING=false
RISK_BASED_LEAF_STABILITY_GATE=PASS
PRE09U_SUPERVISED_BUSINESS=VALIDATION_INCOMPLETE
PRE09U_PRIMARY_CAUSE=SUPERVISOR_PARENT_PROCESS_EXIT_NOT_OBSERVED_AFTER_RESOURCE_CLEANUP
```

## Root Cause

Primary parent natural-exit cause:

```text
SUPERVISOR_OWNED_TIMEOUT_NOT_CLEARED
```

The supervisor used `Promise.race()` with long `wait()` timeouts. When the child `close` event won, the losing timeout could remain active and keep the parent event loop alive after resource cleanup.

Secondary cleanup cause found during Phase 2 smoke:

```text
SUPERVISOR_PARENT_CLEANUP_FAILURE_ON_CHILD_ERROR
```

If a leaf child failed before returning its server reference to the batch runner, the parent-owned Next server could be orphaned. The leaf failure path now closes that server before rethrowing.

## Selected Hunk

```text
scripts/lib/local-runtime-supervisor.mjs
- replace uncancelled Promise.race wait timers with cancellable parent-owned timeouts
- track owned timeout, child, and stream counts
- emit safe parent lifecycle and active resource markers
- stop leaf-local parent-owned Next runtime on child failure
- emit safe child business and audit boolean markers

scripts/phase/phase2-closeout.local.mjs
- install top-level main, beforeExit, and exit markers
- emit active resource count snapshots with safe type/count only
- avoid process.exit()
```

## Excluded Hunk

```text
ADMIN Role business logic=unchanged
MFA logic=unchanged
QR route logic=unchanged
Auth handoff helper=unchanged
HTTP harness=unchanged
Runtime ownership contract=unchanged
Retry=0
Assertion relaxation=0
process.exit usage=0
```

## Supervised Business 3/3

```text
ADMIN_ROLE_INACTIVE_REVOKE_SUPERVISED_EXIT_STABILITY=3/3_PASS
business_assertion=3/3
audit_assertion=3/3
child_exit=3/3
child_close=3/3
parent_cleanup=3/3
stable_barrier=3/3
main_resolved=3/3
beforeExit=3/3
exit=3/3
owned_timeout_final_count=0
owned_child_final_count=0
owned_stream_final_count=0
signal_handler_residue=0
pending_cleanup_promise=0
secret_findings=0
```

## Active Resource Timeline

```text
leaf_close=Timeout 0, ChildProcess 0
stable_barrier_complete=Timeout 0, ChildProcess 0
cleanup_complete=Timeout 0, ChildProcess 0
main_resolved=Timeout 0, ChildProcess 0
before_exit=Timeout 0, ChildProcess 0, Other 0
```

`PipeWrap` at `before_exit` was limited to standard process streams and was not treated as parent-owned residue.

## Phase 2 Single Closeout

```text
PHASE2_FULL_CLOSEOUT_PARENT_EXIT_SMOKE=EXPECTED_CHILD_FAILURE_CLEANUP_PASS
phase2_integration_marker=false
official_leaf_pass_count=2
first_failed_leaf=admin_role_commands
admin_role_child_exit_code=1
cleanup_barrier_fail=false
beforeExit=true
exit=true
owned_timeout_final_count=0
owned_child_final_count=0
owned_stream_final_count=0
secret_findings=0
```

The full Phase 2 smoke did not pass because `admin_role_commands` full child execution exited with code 1. That is a separate business/regression failure and was not patched in PRE-09V. PRE-09V confirms that the parent now cleans up and exits naturally even on that child failure path.

## Static And Security Gate

```text
node --check selected scripts=PASS
npm ci=PASS
npm audit --omit=dev=PASS, vulnerabilities 0
npm audit --include=dev=PASS, vulnerabilities 0
npm run lint=PASS
npm run build=PASS
package_diff=0
supabase_diff=0
src_additional_diff=0
```

## Cleanup

```text
npm run supabase:stop=PASS
cleanup_samples=3/3_PASS
current_worktree_process=0
current_project_container=0
port_3000_listener=0
port_3010_listener=0
port_55721_55724_listener=0
.env.local=absent
.env.local.phase2-supervisor=absent
qa_residue=0
```

One pre-fix orphaned parent-owned Next process from the failed smoke was stopped. No foreign process, foreign container, `the-lost-heir-api`, or Salon ERP resource was touched.

## Observer

```text
Observer path=D:\Ai\staking-wallet-web-pre05-snapshot\PRE09V_SUPERVISOR_PARENT_EXIT
Manifest=11-sha256-manifest.txt
Raw secret material copied=false
```

## Secret Scan

```text
email_findings=0
jwt_findings=0
totp_uri_findings=0
actual_secret_value_findings=0
false_positive_marker_words=18
false_positive_location=scripts/phase/phase2-closeout.local.mjs denylist strings
```

## Readiness

```text
RUNTIME_SUPERVISOR_COMMIT_POSSIBLE=false
PHASE2_CLOSEOUT_3_OF_3_POSSIBLE=false
P5_T02_BASELINE_POSSIBLE=false
P5_T02_PROGRESS_POSSIBLE=false
```

Commit readiness remains deferred because Phase 2 full closeout has a separate `admin_role_commands` child failure. A follow-up task should address that child failure without changing the parent natural-exit fix.

## Final State

```text
PRE09V_PARENT_EXIT_LIFECYCLE=PASS_DIAGNOSTIC
PRE09V_FINAL_STATUS=REQUIRES_ACTION
STAGING=false
COMMIT=false
PUSH=false
PR=false
```
