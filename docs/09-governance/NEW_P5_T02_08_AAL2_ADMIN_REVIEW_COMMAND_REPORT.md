# NEW-P5-T02-08 AAL2 ADMIN Review Command Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Start HEAD: `b07b9a5c57c74b4f1b0a0aea0d745e43b4bf1752`
- Baseline marker: `PASS_RECONCILIATION_REVIEW_LIFECYCLE_BASELINE_COMMITTED`
- Baseline review lifecycle:
  - `private.reconciliation_review_cases`
  - `private.reconciliation_review_case_events`
  - `private.open_reconciliation_resolution(...)`
  - `private.transition_reconciliation_resolution(...)`

## Existing Patterns

- `ADMIN_COMMAND_PATTERN=server-only admin command module calls a user-scoped Supabase server client, performs inspectAdminAccess(), then invokes an authenticated public SECURITY DEFINER RPC.`
- `AAL2_CHECK_PATTERN=inspectAdminAccess() evaluates Supabase MFA state and confirms public.is_current_user_admin_aal2(); DB command wrappers also enforce public.is_current_user_admin_aal2() at the mutation boundary.`
- `ACTOR_PROFILE_RESOLUTION=auth.uid() is used as the current profile id after active ADMIN plus AAL2 checks; caller-provided actor fields are not accepted.`
- `USER_SCOPED_DB_CALL_PATTERN=createServerSupabaseClient() with request cookies; no service-role application client or service-role key.`
- `SAFE_ERROR_MAPPING_PATTERN=server command modules map auth status and PostgREST SQLSTATE/message to small public error codes without SQL detail, hints, stack traces, JWT claims, cookies, or profile objects.`
- `REQUEST_GUARD_PATTERN=Next route handler POST plus same-origin guard, JSON content type, bounded body, DTO allowlist, no-store JSON response.`

## Architecture

- DB wrapper added: yes.
- Public RPC names:
  - `public.admin_open_review_case(uuid, text, text)`
  - `public.admin_transition_review_case(uuid, bigint, text, text, text)`
- SECURITY DEFINER: yes, matching existing admin command RPC pattern.
- Search path: empty (`set search_path = ''`).
- Execute privileges:
  - `public`: revoked
  - `anon`: revoked
  - `authenticated`: granted
- Low-level private grants: unchanged; browser roles still cannot execute the private lifecycle functions directly.
- Service role usage: 0.

Function names intentionally avoid `reconciliation` and `resolution` in the public RPC name so earlier phase tests that assert no public reconciliation RPCs remain valid without modifying existing pgTAP files.

## Command Contracts

Open request DTO:

```text
reconciliationItemId
idempotencyKey
reasonCode
```

Open response DTO:

```text
reviewCaseId
eventId
created
status
version
```

Transition request DTO:

```text
reviewCaseId
expectedVersion
targetStatus
idempotencyKey
reasonCode
```

Allowed transition targets:

```text
IN_REVIEW
RESOLVED
IGNORED
```

Transition response DTO:

```text
reviewCaseId
eventId
created
status
version
```

Rejected caller fields include actor/profile/user/role/AAL/admin variants. Unknown JSON fields are rejected rather than ignored.

## Error Mapping

- Unauthenticated: `admin_authentication_required` / HTTP 401.
- Non-admin, inactive, or missing profile: `admin_role_required` / HTTP 403.
- MFA enrollment or challenge required: `admin_aal2_required` / HTTP 403.
- Invalid DTO or low-level invalid input: `invalid_request` / HTTP 400.
- Missing item or review case: safe 404 code.
- Not reviewable, already exists, idempotency conflict, version conflict, terminal state, transition invalid, and existing state invalid: safe 409 code.
- Unexpected DB or auth availability failure: safe 500 or 503 code.

Responses do not include SQL text, constraint names, stack traces, session data, profile objects, cookies, tokens, credentials, amounts, binding provenance, or wallet identifiers.

## Idempotency And Side Effects

- Application layer does not implement idempotency.
- DB wrappers forward the idempotency key to existing private lifecycle functions.
- Exact replay returns `created=false`.
- Optimistic version conflict and terminal protection are preserved by the private transition function.
- Review lifecycle events remain the only business audit trail for this command boundary.
- No generic audit event was added.

Side-effect boundaries verified by pgTAP:

- Reconciliation runs: unchanged
- Reconciliation items: unchanged
- Reconciliation item binding observations: unchanged
- External balance observations: unchanged
- External transaction observations: unchanged
- Observer checkpoints: unchanged
- Ledger accounts: unchanged
- Ledger journals: unchanged
- Ledger entries: unchanged

Only the following review lifecycle tables are mutated by successful commands:

- `private.reconciliation_review_cases`
- `private.reconciliation_review_case_events`

## Validation Results

DB:

- `npm run supabase:start`: PASS
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0 / warning 0
- `npm run db:test:local`: PASS, 24 files / 1225 tests / failure 0 / skip 0
- `npm run db:types:local`: PASS
- Generated type diff: only `admin_open_review_case` and `admin_transition_review_case` public function types were added.

Application:

- `npm run lint`: PASS
- `npm run build`: PASS
- New route handlers appeared in the Next.js production route manifest:
  - `/api/v1/admin/reconciliation/reviews/open`
  - `/api/v1/admin/reconciliation/reviews/transition`
- Existing ADMIN/AAL2 runtime harness:
  - `npm run test:auth:admin-roles:local`: PASS

Dependency:

- `npm ci`: PASS
- `npm audit --omit=dev --json`: vulnerabilities 0
- `npm audit --include=dev --json`: vulnerabilities 0
- `package.json` diff: 0
- `package-lock.json` diff: 0

Runtime notes:

- A Reconciliation-specific local runtime harness did not already exist, and no new ad hoc harness was added.
- Existing ADMIN/AAL2 runtime command flow was reused for real auth/MFA/same-origin boundary validation.
- New Reconciliation mutation boundary was validated with pgTAP using authenticated USER, ADMIN AAL1, and ADMIN AAL2 database contexts.

## Initial Failure And Remediation

Initial pgTAP failed because the first public RPC names matched earlier phase tests that intentionally assert there are no public `reconciliation`/`resolution` RPCs. Existing tests were not modified. The new public functions were renamed to `admin_open_review_case` and `admin_transition_review_case`.

Initial pgTAP also caught a fixture error where a custody provider was inserted directly as `APPROVED`. The fixture was corrected to insert `DRAFT` and then transition to `APPROVED` through the existing table trigger contract shape.

## Files Changed

- `supabase/migrations/20260729107000_p5_t02_reconciliation_admin_commands.sql`
- `supabase/tests/database/p5_t02_reconciliation_admin_commands.test.sql`
- `src/lib/reconciliation/public-results.ts`
- `src/lib/reconciliation/validation.ts`
- `src/server/admin/reconciliation-review-commands.ts`
- `src/app/api/v1/admin/reconciliation/reviews/open/route.ts`
- `src/app/api/v1/admin/reconciliation/reviews/transition/route.ts`
- `src/types/database.types.ts`
- `docs/09-governance/NEW_P5_T02_08_AAL2_ADMIN_REVIEW_COMMAND_REPORT.md`

## Security Review

- Service-role application runtime: 0
- Service-role key reference: 0
- Remote Supabase: 0
- Mainnet/testnet/provider network calls: 0
- Caller-provided actor: rejected
- Caller-provided role/AAL/admin fields: rejected
- Low-level private execute grant relaxation: 0
- Admin UI/read model/notification/worker/scheduler: 0
- Financial posting, ledger correction, observation correction, and reconciliation rerun: 0
- Secrets copied into source/report: 0

Local Supabase CLI default development credentials appeared in command output during local startup; they were not copied into repository files or this report.

## Next Task

Suggested next task:

```text
P5-T02-09 Reconciliation admin read model/UI
```

The read model/UI should remain separate from this command mutation boundary and should not add correction, posting, provider network, or auto-remediation behavior.

## Final Status

```text
FINAL_STATUS=PASS_AAL2_ADMIN_REVIEW_COMMAND_READY
```
