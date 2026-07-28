# NEW-P5-T02-PRE-09R MFA Enrollment Internal Stage Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-phase2-supervisor`
- Branch: `fix/new-p5-phase2-runtime-supervisor`
- Baseline HEAD: `9579660cce7ee52a91fd81d7dc40a2b1d991be70`
- Production route observed: `src/app/api/v1/auth/mfa/enroll/start/route.ts`
- Behavior goal: observe internal failure stage only.
- Public behavior changed: no.
- Staging, commit, push, PR: not performed.
- P5-T02 implementation: not started.

## PRE-09P And PRE-09Q Baseline

PRE-09P:

```text
REFERENCE_ADMIN_MFA=PASS
REFERENCE_ENROLLMENT_STATUS=200
ADMIN_ROLE_MFA=FAIL
ADMIN_ROLE_ENROLLMENT_STATUS=503
ADMIN_ROLE_PUBLIC_CODE=mfa_enrollment_failed
PRIMARY_CAUSE=ADMIN_ROLE_MFA_REQUEST_CONTRACT_MISMATCH
SECONDARY_CAUSE=APPLICATION_MFA_ROUTE_GENERIC_503_MAPPING
```

PRE-09Q:

```text
ADMIN_ROLE_MFA_PREFLIGHT_PARITY=PASS
ADMIN_ROLE_MFA_REQUEST_CONTRACT_FAILURE=NOT_CONFIRMED
ADMIN_ROLE_MFA_ENROLLMENT_REQUEST_COUNT=1
ADMIN_ROLE_MFA_ENROLLMENT_ACTUAL_STATUS=503
ADMIN_ROLE_MFA_ENROLLMENT_PUBLIC_CODE=mfa_enrollment_failed
```

## Route Execution Order

Actual source order:

```text
route_entry
origin_guard
createServerSupabaseClient
inspectAdminIdentity
listFactors
existing factor state checks
unverified factor cleanup
upstream_call to Supabase GoTrue /auth/v1/factors
upstream_result
raw response shape read
factor id validation
QR normalization
secret validation
public_mapping
```

Request parse and input validation are not applicable for this start endpoint because the route does not consume request body fields.

## Safe Marker Contract

Marker format:

```text
MFA_ENROLL_SAFE stage=<allowlisted_stage> result=<allowlisted_result> class=<allowlisted_class> status=<safe_status>
```

The route logs only allowlisted stages, classes, booleans/count-equivalent statuses, and HTTP status integers. It does not log request or response bodies, upstream error objects, stack traces, cookies, tokens, ids, QR data, TOTP secrets, or raw Supabase values.

## Reference ADMIN MFA Result

Single reference script invocation:

```text
REFERENCE_ADMIN_MFA_RESULT=PASS
REFERENCE_ADMIN_MFA_EXIT=0
REFERENCE_ENROLLMENT_STATUS=200
```

Observed reference success markers:

```text
MFA_ENROLL_SAFE stage=upstream_result result=pass class=none status=200
MFA_ENROLL_SAFE stage=response_shape result=pass class=none status=none
MFA_ENROLL_SAFE stage=qr_shape result=pass class=none status=none
MFA_ENROLL_SAFE stage=secret_shape result=pass class=none status=none
MFA_ENROLL_SAFE stage=public_mapping result=pass class=none status=200
```

Note: the existing reference script intentionally performs an enrollment restart check, so one invocation reaches the enrollment start route twice. The route behavior remained unchanged.

## ADMIN Role MFA Result

ADMIN Role diagnostic mode:

```text
ADMIN_ROLE_DIAGNOSTIC_MODE=mfa_enrollment_start_only
ADMIN_ROLE_MFA_RESULT=FAIL
ADMIN_ROLE_MFA_EXIT=1
```

Preserved diagnostic request contract:

```text
ADMIN_ROLE_MFA_ENROLLMENT_PREFLIGHT_GUARD_PASS
ADMIN_ROLE_MFA_ENROLLMENT_REQUEST_COUNT=1
ADMIN_ROLE_MFA_ENROLLMENT_ACTUAL_STATUS=503
ADMIN_ROLE_MFA_ENROLLMENT_PUBLIC_CODE=mfa_enrollment_failed
```

Observed server route markers:

```text
MFA_ENROLL_SAFE stage=route_entry result=start class=none status=none
MFA_ENROLL_SAFE stage=upstream_call result=start class=none status=none
MFA_ENROLL_SAFE stage=upstream_result result=pass class=none status=200
MFA_ENROLL_SAFE stage=qr_shape result=invalid class=qr_shape_invalid status=503
MFA_ENROLL_SAFE stage=public_mapping result=fail class=upstream_shape_invalid status=503
```

Parent-owned observer note:

- `admin-role-commands.local.mjs` self-owned runtime intentionally discards Next stdout/stderr, so route server markers cannot be collected from that mode without modifying the script.
- The observer used an externally owned local Next runtime to collect server markers while preserving the ADMIN Role request contract.
- A local Mailpit residue caused an initial parent readiness failure; the local test mailbox was cleared and the ADMIN Role diagnostic was rerun once to reach the route.

## Stage Findings

```text
MFA_ROUTE_REACHED=true
MFA_AUTH_GUARD_PASS=true
MFA_ORIGIN_GUARD_PASS=true
MFA_REQUEST_PARSE_PASS=NOT_APPLICABLE
MFA_INPUT_VALIDATION_PASS=NOT_APPLICABLE
MFA_AAL_GUARD_PASS=true
MFA_UPSTREAM_CALL_REACHED=true
MFA_UPSTREAM_ERROR_PRESENT=false
MFA_UPSTREAM_STATUS=200
MFA_UPSTREAM_DATA_PRESENT=true
MFA_FACTOR_SHAPE_VALID=true
MFA_TOTP_SHAPE_VALID=true
MFA_QR_SHAPE_VALID=false
MFA_SECRET_SHAPE_VALID=NOT_DETERMINED_AFTER_QR_FAILURE
MFA_PUBLIC_MAPPING_STATUS=503
MFA_PUBLIC_MAPPING_CODE=mfa_enrollment_failed
```

Primary cause:

```text
APPLICATION_MFA_ROUTE_QR_SHAPE_FAILURE
```

Not primary:

```text
APPLICATION_MFA_ROUTE_AUTH_GUARD_FAILURE=false
APPLICATION_MFA_ROUTE_ORIGIN_GUARD_FAILURE=false
APPLICATION_MFA_ROUTE_REQUEST_PARSE_FAILURE=false
APPLICATION_MFA_ROUTE_INPUT_VALIDATION_FAILURE=false
APPLICATION_MFA_ROUTE_AAL_GUARD_FAILURE=false
APPLICATION_MFA_ROUTE_CLIENT_CREATION_FAILURE=false
SUPABASE_GOTRUE_ENROLLMENT_ERROR=false
SUPABASE_GOTRUE_ENROLLMENT_NON_OK=false
SUPABASE_GOTRUE_ENROLLMENT_EMPTY_DATA=false
APPLICATION_MFA_ROUTE_FACTOR_SHAPE_FAILURE=false
APPLICATION_MFA_ROUTE_TOTP_SHAPE_FAILURE=false
APPLICATION_MFA_ROUTE_UNEXPECTED_EXCEPTION=false
APPLICATION_MFA_ROUTE_STAGE_STILL_UNKNOWN=false
```

## Validation

Executed:

```text
node --check scripts/auth/admin-role-commands.local.mjs
node --check scripts/auth/admin-mfa.local.mjs
node --check scripts/lib/local-auth-handoff.mjs
node --check scripts/lib/local-http-harness.mjs
node --check scripts/lib/local-runtime-supervisor.mjs
node --check scripts/phase/phase2-closeout.local.mjs
npm ci
npm audit --omit=dev --json
npm audit --include=dev --json
npm run lint
npm run build
```

Results:

```text
Syntax=PASS
npm_ci=PASS
production_vulnerabilities=0
full_vulnerabilities=0
lint=PASS
lint_warnings=0
build=PASS
package_diff=0
supabase_diff=0
allowed_route_src_diff_only=true
```

## Cleanup

Executed:

```text
npm run supabase:stop
```

Final cleanup samples:

```text
CLEAN_SAMPLE_1 ports=0 publish3000=0 supabase_containers=0 compose_containers=0 env_local=0
CLEAN_SAMPLE_2 ports=0 publish3000=0 supabase_containers=0 compose_containers=0 env_local=0
CLEAN_SAMPLE_3 ports=0 publish3000=0 supabase_containers=0 compose_containers=0 env_local=0
```

## Observer

Observer path:

```text
D:\Ai\staking-wallet-web-pre05-snapshot\PRE09R_MFA_ENROLLMENT_INTERNAL_STAGE
```

Files:

```text
01-route-analysis.md
02-safe-marker-contract.md
03-reference-admin-mfa.md
04-admin-role-mfa.md
05-next-safe-timeline.md
06-stage-classification.md
07-runtime-cleanup-ledger.md
08-sha256-manifest.txt
```

## Secret Review

No secret values were added to repository files, observer files, governance report, or final safe marker summaries.

The Supabase local CLI printed local development defaults during startup in tool output; those values were not copied into repository files, observer files, the report, or the final response.

## Final Status

```text
FINAL_STATUS=PASS_DIAGNOSTIC
FUNCTIONAL_STATUS=REQUIRES_ACTION
NEXT_FIX_SCOPE=QR_NORMALIZATION_OR_UPSTREAM_QR_PAYLOAD_FORMAT_COMPARISON
ENROLLMENT_REPEAT_10_OF_10=NOT_RUN
INACTIVE_REVOKE=NOT_RUN
P5_T02=ON_HOLD
```
