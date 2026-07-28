# NEW-P5-T02-PRE-09W ADMIN Role Full Child Failure Report

## Scope

```text
worktree=D:\Ai\staking-wallet-web-phase2-supervisor
branch=fix/new-p5-phase2-runtime-supervisor
head=9579660cce7ee52a91fd81d7dc40a2b1d991be70
task=diagnose Phase 2 admin_role_commands child exit code 1
status=PASS_DIAGNOSTIC
```

The existing PRE-09 runtime changes were preserved. No P5-T02 implementation, package change, migration, production source change, staging, commit, push, or pull request was performed.

## PRE-09V Baseline

```text
PRE09V_PARENT_LIFECYCLE=PASS
SUPERVISOR_PARENT_EXIT_FAILURE=false
SUPERVISOR_RESOURCE_CLEANUP_FAILURE=false
ADMIN_ROLE_INACTIVE_REVOKE_FAILURE=false
ADMIN_ROLE_FULL_CHILD_FAILURE=true
PHASE2_CLOSEOUT_BLOCKED=true
```

## Official Entry

```text
admin_role_package_script=test:auth:admin-roles:local
admin_role_node_entry=node scripts/auth/admin-role-commands.local.mjs
phase2_leaf=admin_role_commands
phase2_child_script=test:auth:admin-roles:local
phase2_child_label=ADMIN role command E2E
ADMIN_ROLE_PHASE2_CHILD_ENTRY_MATCH=true
ADMIN_ROLE_PHASE2_CHILD_ARGUMENT_PARITY=true
ADMIN_ROLE_PHASE2_CHILD_ENVIRONMENT_PARITY=static_match
```

Phase 2 leaf order:

```text
auth_routes
admin_mfa
admin_role_commands
domain_lifecycle
wallet_status
dashboard
```

ADMIN Role previous leaves in Phase 2:

```text
auth_routes
admin_mfa
```

## Scenario Map

Observed full ADMIN role scenario sequence:

```text
public_smoke
same_origin_rejection
general_user_blocked_initial
aal1_admin_blocked
mfa_enrollment_preflight
mfa_enrollment_start
admin_mfa_ready
aal2_admin_roles_page
input_rejection
grant_admin_applied
granted_target_requires_mfa
grant_replay_idempotent
command_conflict_blocked
grant_admin_noop
inactive_target_grant_blocked
concurrent_grant_idempotent
inactive_admin_revoke_allowed
revoke_admin_applied
revoke_replay_idempotent
revoke_admin_noop
self_revoke_blocked
aal2_audit_page
aal1_admin_roles_challenge
general_user_blocked_final
factor_secret_not_printed
integration_complete
cleanup
```

## Execution Results

Direct Full ADMIN Role:

```text
executed=true
count=1
result=FAIL
exit_code=1
child_exit=observed
child_close=observed
runtime_owner=SELF
cleanup_owner=SELF
diagnostic_mode=none
pass_marker_count=27
failure_marker_count=1
last_success_marker=ADMIN_ROLE_DIRECT_SUPABASE_STOP
last_business_success=aal1_admin_roles_challenge
first_failure=USER roles page code _auth_mfa_enroll
first_business_failure=general_user_blocked_final
retry_count=0
assertion_relaxation=0
```

The runtime cleanup markers appear before the failure line because cleanup runs in the self-owned finalizer before the caught failure is printed. The logical failure remains the final general USER roles page assertion.

Supervised Full ADMIN Role:

```text
executed=false
result=NOT_RUN
reason=Direct Full ADMIN Role failed
```

Phase 2 Full Closeout:

```text
executed=false
result=NOT_RUN
reason=Direct Full ADMIN Role failed
phase2_last_successful_leaf=not_observed
phase2_first_failed_leaf=not_observed
admin_role_phase2_last_success_scenario=not_observed
admin_role_phase2_first_failure_scenario=not_observed
```

## Environment And State

```text
DIRECT_SUPERVISED_ENV_PARITY=not_applicable
SUPERVISED_PHASE2_ENV_PARITY=not_applicable
DIRECT_SUPERVISED_SCENARIO_ORDER_PARITY=static_match
SUPERVISED_PHASE2_SCENARIO_ORDER_PARITY=static_match
PHASE2_PRE_ADMIN_ROLE_QA_RESIDUE_COUNT=not_measured
PHASE2_PRE_ADMIN_ROLE_MFA_FACTOR_RESIDUE_COUNT=not_measured
PHASE2_PRE_ADMIN_ROLE_PENDING_COMMAND_COUNT=not_measured
PHASE2_PRE_ADMIN_ROLE_STATE_GUARD_PASS=not_measured
```

The direct run failed outside Phase 2. This rules out Phase 2-only child environment mismatch as the primary cause for this diagnostic pass.

## Primary Cause

```text
PRIMARY_CAUSE=ADMIN_ROLE_FULL_CROSS_SCENARIO_CONTAMINATION
SECONDARY_CAUSE=ADMIN_ROLE_FULL_BUSINESS_ASSERTION_FAILURE
CHILD_EXIT_CODE_IS_ROOT_CAUSE=false
NEXT_FIX_CANDIDATE=scripts/auth/admin-role-commands.local.mjs
```

The final `assertGeneralUserBlocked` path uses the same target actor that was granted ADMIN in an earlier `concurrent_grant_idempotent` scenario. The observed redirect to `_auth_mfa_enroll` is consistent with an ADMIN/AAL1 actor, while the assertion expected a general USER `admin_forbidden` result.

Not primary:

```text
SUPERVISOR_PARENT_EXIT_FAILURE=false
SUPERVISOR_RESOURCE_CLEANUP_FAILURE=false
ADMIN_ROLE_INACTIVE_REVOKE_FAILURE=false
PHASE2_PRE_ADMIN_ROLE_CROSS_LEAF_CONTAMINATION=false_observed
PHASE2_ADMIN_ROLE_ENVIRONMENT_CONTRACT_MISMATCH=false_observed
PHASE2_ADMIN_ROLE_ARGUMENT_CONTRACT_MISMATCH=false_observed
```

## Verification

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
src_additional_diff=0
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
qa_residue=not_measured_after_direct_failure
```

## Security

```text
actual_secret_values_copied=0
raw_account_identifiers_copied=0
private_key_or_mnemonic_copied=0
service_role_copied=0
database_url_copied=0
token_material_copied=0
```

Safe marker names and counts are used instead of raw identifiers or secret-bearing values.

## Observer

```text
observer_base=D:\Ai\staking-wallet-web-pre05-snapshot\PRE09W_ADMIN_ROLE_FULL_CHILD_FAILURE
manifest=10-sha256-manifest.txt
raw_log=03-direct-full-run.combined.log
```

## Readiness

```text
phase2_3_of_3_possible=false
runtime_supervisor_commit_possible=false
p5_t02_baseline_possible=false
p5_t02_progress_possible=false
commit_readiness=deferred_until_admin_role_fixture_fix
```

Staging, commit, push, and PR were not performed.
