# NEW-P5-T02-PRE-09X General User Fixture Isolation Report

## Scope

```text
worktree=D:\Ai\staking-wallet-web-phase2-supervisor
branch=fix/new-p5-phase2-runtime-supervisor
head=9579660cce7ee52a91fd81d7dc40a2b1d991be70
status=VALIDATION_INCOMPLETE
```

This task preserves the existing PRE-09 runtime, MFA, QR, auth handoff, HTTP harness, and Phase 2 supervisor changes. The only execution code modified in this task is `scripts/auth/admin-role-commands.local.mjs`.

## PRE-09W Confirmation

```text
last_success=aal1_admin_roles_challenge
first_failure=general_user_blocked_final
primary_cause=ADMIN_ROLE_FULL_CROSS_SCENARIO_CONTAMINATION
secondary_cause=ADMIN_ROLE_FULL_BUSINESS_ASSERTION_FAILURE
```

## Fix

The final general USER scenario no longer reuses the target actor that was granted ADMIN by an earlier scenario. It now creates a current-run, scenario-local general user fixture with a separate session and cookie context.

```text
root_cause_fixed=ADMIN_ROLE_GENERAL_USER_SCENARIO_REUSED_ADMIN_ACTOR
fix_marker=ADMIN_ROLE_GENERAL_USER_FIXTURE_ISOLATION_FIXED
admin_actor_reuse=false
admin_session_reuse=false
admin_cookie_context_reuse=false
```

Selected hunk:

```text
replace final assertGeneralUserBlocked(targetCJar, targetBUserId)
with assertFinalGeneralUserFixtureIsolation(...)
```

Excluded hunk:

```text
no admin actor role removal
no production route change
no MFA or QR change
no runtime supervisor change
no Phase 2 closeout change
no retry or assertion relaxation
```

## General User Contract

```text
fixture_source=scenario_local_fresh_user
created_in_current_run=true
profile_created_in_current_run=true
session_created_in_current_run=true
cookie_context_created_in_current_run=true
actor_distinct=true
profile_distinct=true
session_distinct=true
cookie_context_distinct=true
request_context_distinct=true
admin_role_count=0
active_admin_role_count=0
pending_admin_command_count=0
role_guard=PASS
session_guard=PASS
admin_context_leak=false
request_count=1
expected_public_code=admin_forbidden
actual_public_code=admin_forbidden
final_assertion=PASS
admin_actor_preservation=PASS
general_user_cleanup=PASS
general_user_residue_count=0
```

## Validation

Direct Full ADMIN Role:

```text
run_1=PASS
run_2=PASS
run_3=PASS
ADMIN_ROLE_DIRECT_FULL_GENERAL_USER_ISOLATION=3/3_PASS
```

Supervised Full ADMIN Role:

```text
run_1=PASS
run_2=PASS
run_3=PASS
ADMIN_ROLE_SUPERVISED_FULL_GENERAL_USER_ISOLATION=3/3_PASS
```

Phase 2 Full Closeout single run:

```text
executed=true
result=FAIL
exit_code=1
last_successful_leaf=admin_mfa
first_failed_leaf=admin_role_commands
admin_role_child_exit_code=1
parent_cleanup=PASS
owned_timeout_final_count=0
PHASE2_FULL_CLOSEOUT_GENERAL_USER_FIX_SMOKE=0/1_FAIL
```

Phase 2 3/3 was not run.

## Static And Security

```text
syntax=PASS
npm_ci=PASS
production_audit_vulnerabilities=0
full_audit_vulnerabilities=0
lint=PASS
lint_warning_count=0
build=PASS
package_diff=0
package_lock_diff=0
supabase_diff=0
additional_src_diff=0
```

Cleanup:

```text
supabase_stop=PASS
cleanup_samples=3
current_worktree_process_count=0
current_project_container_count=0
port_3000_listener_count=0
port_3010_listener_count=0
port_55721_55724_listener_count=0
env_local_exists=false
env_local_phase2_supervisor_exists=false
```

Security:

```text
actual_secret_values_copied=0
raw_email_values_copied=0
raw_cookie_or_token_values_copied=0
private_key_or_mnemonic_copied=0
service_role_copied=0
database_url_copied=0
```

## Readiness

```text
phase2_closeout_3_of_3_possible=false
runtime_supervisor_commit_possible=false
p5_t02_baseline_possible=false
p5_t02_progress_possible=false
staging=false
commit=false
push=false
pr=false
final_status=VALIDATION_INCOMPLETE
```

The targeted general USER fixture isolation fix is validated in direct and supervised ADMIN role paths, but Phase 2 full closeout remains blocked by a full-sequence `admin_role_commands` child exit code 1.
