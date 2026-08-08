# NEW-P5-T03-03 Atomic Balance Observer Command Report

## Status

FINAL_STATUS=PASS_ATOMIC_BALANCE_OBSERVER_COMMAND_READY

## Worktree

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t03-custody-observer-runtime`
- Start HEAD: `de32592f8f62b8373b0a0ccd9692550a799cdc60`
- Final HEAD: `de32592f8f62b8373b0a0ccd9692550a799cdc60`
- origin/main: `f327ad817787a636ee50d5ddb9c8f11bdb4a3125`
- merge-base: `f327ad817787a636ee50d5ddb9c8f11bdb4a3125`
- origin/main ancestor: `true`

## Baseline

- P5-T03-01 contract baseline: `ac914ba55c96e0cd5f5be61ebe7a43ef96a59567`
- P5-T03-02 mock adapter and canonical normalization baseline: `de32592f8f62b8373b0a0ccd9692550a799cdc60`
- Scope: DB command and checkpoint atomicity only.
- No worker loop, scheduler, provider network, API route, RPC wrapper, UI, credential injection, or service-role runtime was added.

## Changed Files

- `supabase/migrations/20260801071426_p5_t03_atomic_balance_observer_command.sql`
- `supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql`
- `docs/09-governance/NEW_P5_T03_03_ATOMIC_BALANCE_OBSERVER_COMMAND_REPORT.md`

## Worker Role Contract

- Role: `custody_observer_worker`
- Attributes: `LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`.
- Password: none created by the migration; pgTAP verifies the catalog value is null without printing any secret value.
- Memberships: 0.
- Owned database objects: 0.
- Ambient privileges: database `CONNECT` and private schema `USAGE`.
- Direct private table privileges: 0.
- Direct private sequence privileges: 0.
- Effective execute on other private functions: 0.
- Effective execute on public write/admin command RPCs: 0.

## Atomic Command

- Function: `private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamptz, bigint, text, timestamptz)`
- Return:
  - `external_balance_observation_id uuid`
  - `observation_created boolean`
  - `observer_checkpoint_id uuid`
  - `checkpoint_created boolean`
  - `checkpoint_advanced boolean`
  - `checkpoint_version bigint`
- Volatility: `VOLATILE`.
- Security: `SECURITY DEFINER`.
- `search_path`: empty.
- Owner boundary: owned by migration owner, not by `custody_observer_worker`.
- Execute grants: dedicated worker role only among non-owner runtime roles.
- Revoked from: `public`, `anon`, `authenticated`, `service_role`.
- Public wrapper: none.
- Dynamic SQL: none.

## Lock And Checkpoint Scope

- Uses transaction-scoped advisory lock only: `pg_advisory_xact_lock`.
- Does not use session-scoped `pg_advisory_lock`.
- Lock scope is binding plus observer kind:
  - `custody_account_binding_id`
  - `BALANCE_OBSERVER_V1`
- Checkpoint identity remains binding-scoped through `private.observer_checkpoints(custody_account_binding_id, observer_kind)`.
- Checkpoint value is trim-stable, non-empty, max 200 characters, control-character-free, and screened for credential-like markers.
- Checkpoint observed timestamp must match the observation timestamp exactly.
- Checkpoint advancement is guarded by expected-version CAS.

## Observation Contract

- Observer kind is pinned to `BALANCE_OBSERVER_V1`.
- Observation key must match `balobs:v1:[nkc]:[0-9a-f]{64}`.
- Atomic units remain non-negative integer numeric with less than 38 digits.
- Raw numeric values are kept in Postgres numeric form; no JavaScript number conversion was introduced.
- Existing append-only primitive is reused through `private.record_external_balance_observation`.
- The command does not update or delete `private.external_balance_observations`.

## Verified Behaviors

- Initial call creates one balance observation and checkpoint version `1`.
- Initial checkpoint value: `p5t03-cursor-0001`.
- Initial checkpoint timestamp: `2026-08-01 01:00:00+00`.
- Exact replay returns the existing observation and checkpoint ids.
- Exact replay does not create a new observation.
- Exact replay does not advance checkpoint version.
- Advance call creates a new observation and moves existing checkpoint to version `2`.
- Stale expected version raises a safe serialization conflict before side effects.
- Initial call with expected version other than `0` is rejected.
- Reusing an observation key with changed amount, timestamp, or checkpoint value raises idempotency conflict.
- Older checkpoint timestamp raises regression error and rolls back the attempted observation.
- Same checkpoint timestamp with a different observation identity is blocked.
- Old exact replay after later checkpoint is a no-op and returns current checkpoint version `2`.
- Legacy catch-up creates a missing checkpoint for an existing exact observation without appending a duplicate observation.

## Error Catalog

- `observer_kind_invalid`: SQLSTATE `22023`
- `observation_key_invalid`: SQLSTATE `22023`
- `observation_amount_invalid`: SQLSTATE `22023`
- `observation_timestamp_invalid`: SQLSTATE `22023`
- `observer_checkpoint_version_invalid`: SQLSTATE `22023`
- `observer_checkpoint_value_invalid`: SQLSTATE `22023`
- `observer_checkpoint_timestamp_invalid`: SQLSTATE `22023`
- `observer_checkpoint_timestamp_mismatch`: SQLSTATE `22023`
- `observer_checkpoint_version_conflict`: SQLSTATE `40001`
- `observation_idempotency_conflict`: SQLSTATE `23505`
- `observer_checkpoint_regression`: SQLSTATE `22023`
- `observer_checkpoint_position_conflict`: SQLSTATE `23505`
- Preserved primitive error: `binding_not_found`
- Preserved primitive error: `binding_not_observable`

## Side-Effect Boundary

Allowed writes are limited to:

- `private.external_balance_observations`
- `private.observer_checkpoints`

Verified unchanged during command tests:

- `private.external_transaction_observations`
- `private.reconciliation_runs`
- `private.reconciliation_items`
- `private.reconciliation_item_binding_observations`
- `private.reconciliation_review_cases`
- `private.reconciliation_review_case_events`
- `private.ledger_accounts`
- `private.ledger_journals`
- `private.ledger_entries`
- custody provider configuration tables
- supported asset configuration tables

## pgTAP Coverage

- New pgTAP file: `supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql`
- New pgTAP cases: 46.
- Coverage:
  - worker role attributes
  - password absence without value output
  - role memberships
  - role object ownership
  - ambient privilege boundary
  - function signature
  - return contract
  - SECURITY DEFINER metadata
  - empty search_path
  - execute grants
  - no public wrapper
  - transaction advisory lock
  - no dynamic SQL
  - no observation update/delete
  - initial create
  - exact replay
  - checkpoint advance
  - stale CAS
  - initial expected-version conflict
  - replay conflict variants
  - timestamp regression
  - timestamp position conflict
  - old replay after advance
  - legacy catch-up
  - input validation
  - missing binding
  - non-observable binding
  - side-effect zero checks

## Validation

- `npm run supabase:start`: PASS.
- `npm run db:reset:local`: PASS.
- `npm run db:lint:local`: PASS, schema errors 0.
- `npm run db:test:local`: PASS.
  - Files: 27.
  - Tests: 1318.
  - Failed: 0.
- `npm run db:types:local`: PASS.
- `git diff -- src/types/database.types.ts`: content diff 0.
- Repeated `npm run db:reset:local`: PASS.
- Repeated `npm run db:lint:local`: PASS, schema errors 0.
- Repeated `npm run db:test:local`: PASS.
  - Files: 27.
  - Tests: 1318.
  - Failed: 0.
- `npm run test:custody:balance-adapter:local`: PASS.
  - Runtime cases: 72.
  - External network calls: 0.
  - Credential env reads: 0.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npm run test:custody:boundary:local`: PASS.
  - Includes final DB reset.
  - Includes Supabase stop.
  - Includes process cleanup.
- Final `npm run supabase:stop`: PASS.

## Cleanup And Drift

- Source diff under `src/**`: 0.
- Script diff under `scripts/**`: 0.
- `package.json` diff: 0.
- `package-lock.json` diff: 0.
- Generated type content diff: 0.
- Staging: empty.
- Commit: not performed.
- Push: not performed.
- PR: not created.
- Supabase cleanup: PASS through custody boundary runtime.
- Runtime process cleanup: PASS through custody boundary runtime.
- Project running container residue: 0.
- Project label running container residue: 0.
- Port listener residue on `3000`, `3010`, `55721`, `55722`, `55723`, `55724`: 0.
- Temp/quarantine residue: 0.

## Secret Safety

- `.env.local` content read/output: 0.
- Service-role production usage: 0.
- Provider network implementation: 0.
- Private key, mnemonic, seed phrase, client signing, provider credential implementation: 0.
- Secret scan scope:
  - new migration
  - new pgTAP
  - governance report
  - working-tree diff metadata
- Secret scan result: PASS, actual secret value 0.

## Deferred Scope

- Worker runtime loop remains deferred to P5-T03-04.
- Scheduler remains deferred.
- Provider/network adapter remains deferred.
- Credential injection remains deferred.
- API/UI changes remain deferred.
- Service-role runtime remains forbidden.

## Next Task

Recommended next task: P5-T03-04 worker runtime command boundary, using `custody_observer_worker` as the only DB execution role and preserving the no-network/no-credential default adapter boundary until a later explicit provider integration task.

## Final Decision

PASS_ATOMIC_BALANCE_OBSERVER_COMMAND_READY
