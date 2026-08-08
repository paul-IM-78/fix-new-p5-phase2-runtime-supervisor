# NEW-P5-T02-07 Reconciliation Review Lifecycle Report

## Status

FINAL_STATUS=PASS_RECONCILIATION_REVIEW_LIFECYCLE_READY

## Worktree

- Worktree: `D:\Ai\staking-wallet-web-p5-t02`
- Branch: `feat/p5-t02-reconciliation`
- Start HEAD: `f83c9b5d5fe34ab92a00c10b6ef3365484f1cd49`
- Baseline marker: `PASS_ASSET_RECONCILIATION_RUN_BASELINE_COMMITTED`
- Run writer baseline: `private.create_asset_reconciliation_run(...)`
- P5-T02 model: `ASSET_AGGREGATE_RECONCILIATION`

## Existing Convention Review

- Version columns use `bigint` and start at `1`.
- Actor references use `public.profiles(id)` foreign keys with delete restricted.
- Append-only audit tables are protected by mutation-prevention triggers.
- Private helper and writer functions stay `SECURITY INVOKER`.
- Browser roles do not receive direct table privileges or private function execute privileges.
- Idempotency keys are non-secret bounded text values and are rejected when they look like credentials, network locators, wallet identifiers, or token material.

## Naming Decision

The task requested `private.reconciliation_resolutions` and `private.reconciliation_resolution_events` as preferred names, while allowing equivalent names if project naming conventions require it.

This implementation uses:

- `private.reconciliation_review_cases`
- `private.reconciliation_review_case_events`

Reason:

- The existing reconciliation core baseline includes a compatibility assertion that no `private.reconciliation_resolutions` table exists.
- Existing baseline pgTAP files were not modified.
- The public/private function contract still uses the review lifecycle wording `open_reconciliation_resolution` and `transition_reconciliation_resolution`.

## Review Eligibility

Review case creation is allowed for:

- `MISMATCH`
- `OBSERVATION_FAILED`

Review case creation is rejected for:

- `MATCHED`
- `WITHIN_TOLERANCE`

`REVIEW_REQUIRED` is not inferred or expanded by this task.

## Tables

### private.reconciliation_review_cases

Purpose:

- Stores the current review case state for one reconciliation item.
- References the original reconciliation item as the source of truth for expected, observed, difference, tolerance, classification, scope, and asset values.
- Stores no duplicate amount snapshots and no wallet/provider credential material.

Key contract:

- One current case per reconciliation item.
- `status`: `OPEN`, `IN_REVIEW`, `RESOLVED`, `IGNORED`.
- `version`: positive `bigint`, initial value `1`.
- Terminal states require `resolved_at`.
- Non-terminal states require `resolved_at IS NULL`.
- `opened_by_profile_id` and `last_actor_profile_id` reference `public.profiles`.
- Foreign keys use delete restriction.

### private.reconciliation_review_case_events

Purpose:

- Stores append-only lifecycle history for review case open and transition events.

Key contract:

- Event types: `OPENED`, `REVIEW_STARTED`, `RESOLVED`, `IGNORED`.
- Event version is scoped to one review case.
- Event version and idempotency key are unique per review case.
- Idempotency key is globally unique to prevent cross-case replay ambiguity.
- Reason code is bounded uppercase text matching `[A-Z][A-Z0-9_]{2,63}`.
- Free-text notes, JSON metadata blobs, raw provider payloads, wallet identifiers, credentials, and financial postings are not stored.
- UPDATE, DELETE, and TRUNCATE are blocked by trigger.

## Transition Matrix

Allowed:

- `OPEN -> IN_REVIEW`
- `OPEN -> RESOLVED`
- `OPEN -> IGNORED`
- `IN_REVIEW -> RESOLVED`
- `IN_REVIEW -> IGNORED`

Rejected:

- `OPEN -> OPEN`
- `IN_REVIEW -> IN_REVIEW`
- Any transition from `RESOLVED`
- Any transition from `IGNORED`
- `RESOLVED -> IGNORED`
- Reopen workflow

RECONCILIATION_REOPEN_WORKFLOW=DEFERRED

## Functions

### private.open_reconciliation_resolution

Arguments:

- `p_reconciliation_item_id uuid`
- `p_idempotency_key text`
- `p_actor_profile_id uuid`
- `p_reason_code text`

Returns:

- `reconciliation_resolution_id uuid`
- `created boolean`
- `status text`
- `version bigint`
- `event_id uuid`

Contract:

- First valid open creates one review case and one `OPENED` event atomically.
- Exact replay returns the original case and event with `created=false`.
- Conflicting replay is rejected with `reconciliation_resolution_idempotency_conflict`.
- A second key for the same item is rejected with `reconciliation_resolution_already_exists`.

### private.transition_reconciliation_resolution

Arguments:

- `p_reconciliation_resolution_id uuid`
- `p_expected_version bigint`
- `p_target_status text`
- `p_idempotency_key text`
- `p_actor_profile_id uuid`
- `p_reason_code text`

Returns:

- `reconciliation_resolution_id uuid`
- `event_id uuid`
- `created boolean`
- `status text`
- `version bigint`

Contract:

- Requires current `version = p_expected_version`.
- Successful transition increments version by `1`.
- Case update and event append occur in the same database transaction.
- Exact replay returns the original transition event with `created=false`.
- Conflicting replay is rejected without mutating case or event state.
- Terminal states reject further transition attempts.

## Integrity

Existing state validation checks:

- Exactly one current review case exists.
- Event history exists.
- Event versions are contiguous from `1` to current version.
- Latest event version equals current case version.
- Latest event `to_status` equals current case status.
- Terminal timestamp shape is consistent.

Failure marker:

- `reconciliation_resolution_existing_state_invalid`

No automatic repair is attempted.

## Actor And Authorization

Actor contract:

- Actor must reference an existing `public.profiles(id)`.
- Actor foreign keys are enforced.

Authorization boundary:

- `ACTOR_AUTHORIZATION=DEFERRED_TO_AAL2_ADMIN_COMMAND`
- This private primitive does not implement ADMIN role or AAL2 checks.
- Future AAL2 ADMIN command/API must be the final authorization boundary.

## Deferred Scope

The following remain out of scope:

- Public RPC
- API route
- Worker or scheduler
- Admin UI
- Notifications or alerts
- Ledger correction
- Observation overwrite
- Reconciliation rerun
- Financial resolution posting
- Automatic remediation
- Reopen workflow
- Free-text note
- Attachment or external ticket integration

## Security

- Tables are in `private` schema.
- Browser role direct table access is revoked.
- Browser role private function execution is revoked.
- No `SECURITY DEFINER` function was added.
- No public reconciliation RPC was added.
- No public reconciliation view was added.
- No service-role client, remote Supabase connection, provider credential, wallet key, mnemonic, cookie, token, or database URL was added.

## Immutable Side Effects

Open and transition operations leave these existing domains unchanged:

- `private.reconciliation_runs`
- `private.reconciliation_items`
- `private.reconciliation_item_binding_observations`
- `private.external_balance_observations`
- `private.external_transaction_observations`
- `private.observer_checkpoints`
- `private.ledger_accounts`
- `private.ledger_journals`
- `private.ledger_entries`

Only these new review lifecycle tables may change:

- `private.reconciliation_review_cases`
- `private.reconciliation_review_case_events`

## Changed Files

- `supabase/migrations/20260729106000_p5_t02_reconciliation_review_lifecycle.sql`
- `supabase/tests/database/p5_t02_reconciliation_review_lifecycle.test.sql`
- `docs/09-governance/NEW_P5_T02_07_RECONCILIATION_REVIEW_LIFECYCLE_REPORT.md`

Generated type diff:

- `src/types/database.types.ts`: no diff after official local generation

## Validation

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS
- pgTAP before this task: 22 files / 1131 tests PASS
- pgTAP after this task: 23 files / 1194 tests PASS
- New pgTAP file: 63 tests PASS
- Failures: 0
- Skips: 0
- `npm run db:types:local`: PASS
- Generated type diff: 0
- `npm ci`: PASS
- `npm audit --omit=dev --json`: vulnerabilities 0
- `npm audit --include=dev --json`: vulnerabilities 0
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS

## Security Scan

- Secret values: none found in changed files.
- Service-role values: none found in changed files.
- Database URLs: none found in changed files.
- Wallet identifiers: none found in changed files.
- Private keys or mnemonics: none found in changed files.
- Test fixture UUIDs and reason codes are synthetic non-secret sentinels.
- Long-token scan note: one false positive was the baseline commit SHA, not a credential.

## Cleanup

- `npm run supabase:stop`: PASS
- Current project process count: 0
- Current project container count: 0
- Port `3000`: listener 0
- Port `3010`: listener 0
- Ports `55721` through `55724`: listener 0
- `.env.local`: absent
- `.env.local.phase2-supervisor`: absent
- Runtime residue: 0
- `the-lost-heir-api`: remains stopped and was not restarted

## Next Task

Recommended next task:

- `P5-T02-08 AAL2 ADMIN reconciliation review command/API`

Do not treat this primitive as a user-facing command until the future AAL2 ADMIN authorization boundary is implemented.
