# NEW-P5-T02-01 Requirements And Implementation Plan

## Baseline

- Baseline repository: `D:\Ai\staking-wallet-web-phase2-supervisor`
- Baseline branch in the original task brief: `fix/new-p5-phase2-runtime-supervisor`
- Current stable branch after approved main consolidation: `main`
- Baseline commit: `4ce94c79726f67b2042dfba2530a22d0a90c8025`
- Baseline status: `PASS_BASELINE_COMMITTED`
- New branch: `feat/p5-t02-reconciliation`
- New worktree: `D:\Ai\staking-wallet-web-p5-t02`
- P5-T02 implementation in this task: `0`

The original task brief named `fix/new-p5-phase2-runtime-supervisor` as the
baseline branch. That branch, local `main`, and `origin/main` all point to the
same baseline commit. The new worktree was created from the immutable commit
hash, not by changing the stable worktree.

## Official Definition Search

Markers:

```text
P5_T02_OFFICIAL_DEFINITION_FOUND=true
P5_T02_PRIMARY_SOURCE=docs/05-operations/PHASE5_CUSTODY_GATE.md
P5_T02_SECONDARY_SOURCE_COUNT=6
P5_T02_REQUIREMENT_CONFLICT_COUNT=0
```

Primary source:

- `docs/05-operations/PHASE5_CUSTODY_GATE.md`

Secondary sources:

- `README.md`
- `docs/08-custody/CUSTODY_PROVIDER_AND_ACCOUNT_BOUNDARY.md`
- `docs/08-custody/CUSTODY_OBSERVATION_ADAPTER_CONTRACT.md`
- `docs/09-governance/NEW_P5_T01_CUSTODY_BOUNDARY_DOMAIN_REPORT.md`
- `docs/09-governance/NEW_P5_T02_PRE_09Z_PARENT_RUNTIME_BOUNDARY_REPORT.md`
- `docs/09-governance/NEW_P5_T02_PRE_10A_PHASE2_BASELINE_FREEZE_REPORT.md`

The primary source does not define a complete P5-T02 table-by-table design. It
does define that Phase 5 responsibilities after NEW-P5-T01, including
observation ingestion, evidence storage, provider adapter implementation,
reconciliation, and operational posting, must be separate gates. This document
therefore fixes the P5-T02 requirements and implementation order before any
migration, RPC, API, worker, or UI work begins.

## Requirement Conflicts

No direct conflict was found between the governing sources.

Non-conflicting constraints:

- Phase 5 may define observation and reconciliation as a separate gate.
- NEW-P5-T01 allows only a server-only read contract for future observations.
- Real provider SDKs, blockchain SDKs, webhooks, payout submission, mainnet,
  production connectivity, and service-role application runtime remain out of
  scope.
- Internal managed-wallet balances remain derived from the private
  double-entry ledger.
- External evidence is represented by safe digests or non-secret observation
  records, not raw provider payloads or wallet credentials.

## Product Boundary

This product is a managed custodial staking wallet web application.

P5-T02 must preserve these boundaries:

- No Phantom or browser wallet adapter authentication.
- No client-side signing.
- No browser private key.
- No browser mnemonic.
- No custody key exposure to users.
- No service-role application runtime.
- No mainnet transaction execution.
- No remote Supabase mutation.
- No production secret usage.
- No direct external custody provider API call in this requirements task.
- No direct blockchain RPC or indexer call in this requirements task.

## Custody Boundary

Existing reusable custody configuration objects:

- `private.custody_providers`
- `private.custody_account_bindings`
- `private.custody_config_audit_events`
- `public.list_admin_custody_providers(integer, text)`
- `public.list_admin_custody_account_bindings(integer, text)`
- `public.list_custody_config_audit_events(integer, uuid)`
- `src/server/custody/provider-observation-contract.ts`

P5-T02 may reference approved custody providers and approved account bindings as
internal aliases. It must not store or expose:

- Provider account IDs.
- Wallet addresses.
- Blockchain addresses.
- Transaction hashes or signatures.
- Provider URLs.
- API keys.
- API secrets.
- Private keys.
- Mnemonics.
- Service-role keys.

The existing observation contract is read-only and server-only. It defines
health, balance, transfer, cursor, and evidence-digest shapes. It does not
implement an adapter and does not perform network I/O.

## External System Boundary

| Topic | Status | Requirement |
| --- | --- | --- |
| Supported chain | `DEFINED_LIMITED` | Existing domain and custody binding approval are SOLANA-only. |
| Supported assets | `DEFINED_LIMITED` | Existing `public.supported_assets` rows and `private.custody_account_bindings.asset_id` are the allowed asset boundary. |
| Node RPC | `DEFERRED` | No RPC URL or chain client in P5-T02-01. |
| Indexer | `DEFERRED` | No indexer dependency or API call in P5-T02-01. |
| Custodian API | `DEFERRED` | Future adapter may read through the contract, but no provider API call is approved here. |
| Exchange API | `OUT_OF_SCOPE` | Not defined by current custody sources. |
| Mock adapter | `DEFERRED` | Candidate for a later local-only task after DB contracts are fixed. |
| Local fixture | `IN_SCOPE` | DB and service tests may use synthetic non-secret fixture observations. |
| Polling period | `NOT_DEFINED` | Must not be invented in this task. |
| Confirmation depth | `NOT_DEFINED` | Must be defined by a later adapter/provider task. |
| Finality rule | `DEFINED_LIMITED` | Observation contract supports `PENDING_FINALITY`, `FINALIZED`, and `FAILED`. |
| Rate limit | `NOT_DEFINED` | Must be adapter-specific later. |
| Timeout | `NOT_DEFINED` | Must be adapter-specific later. |

## Scope Classification

| Item | Classification | Reason |
| --- | --- | --- |
| External wallet balance observation | `IN_SCOPE` | Observation contract already defines provider-reported balances. |
| Blockchain transaction observation | `DEFERRED` | No chain RPC or indexer is approved; transfer observations can be modeled without a real chain call. |
| Deposit observation | `IN_SCOPE` | Inbound transfer observations are required for future deposit reconciliation. |
| Withdrawal observation | `IN_SCOPE` | Outbound transfer observations are required for future withdrawal settlement review. |
| Staking principal observation | `DEFERRED` | Current staking is internal ledger state, not on-chain staking. |
| Reward observation | `DEFERRED` | Current rewards are internally calculated and settled. External reward evidence is not defined. |
| Treasury observation | `IN_SCOPE` | Custody account role `TREASURY` exists. |
| Hot wallet observation | `NOT_DEFINED` | No hot-wallet role exists; do not invent it. |
| Cold wallet observation | `NOT_DEFINED` | No cold-wallet role exists; do not invent it. |
| Internal ledger expected balance | `IN_SCOPE` | Existing ledger views are the internal source of truth. |
| Observed external balance | `IN_SCOPE` | Required to compare custody observation with ledger expectation. |
| Difference calculation | `IN_SCOPE` | Core reconciliation responsibility. |
| Tolerance policy | `IN_SCOPE` | Must default to exact atomic units until approved otherwise. |
| Reconciliation run | `IN_SCOPE` | Required batch boundary. |
| Reconciliation item | `IN_SCOPE` | Required per binding/asset comparison boundary. |
| Discrepancy classification | `IN_SCOPE` | Required to separate match, mismatch, and observation failure. |
| Admin review | `IN_SCOPE` | AAL2 admin review is required for discrepancies. |
| Resolution workflow | `DEFERRED` | Model may reserve state, but command workflow can be a later task. |
| Audit event | `IN_SCOPE` | Existing admin command pattern requires immutable audit. |
| Alerting | `DEFERRED` | No alert channel or queue exists. |
| Scheduled execution | `DEFERRED` | No worker, cron, queue, or scheduler exists. |
| Manual execution | `IN_SCOPE` | AAL2 admin trigger is the first safe execution boundary. |
| Idempotency | `IN_SCOPE` | Existing command pattern requires caller command IDs and replay safety. |
| Concurrency control | `IN_SCOPE` | Existing pattern uses expected versions, locks, and unique constraints. |
| Retry policy | `DEFERRED` | No external network calls are introduced in the first implementation task. |
| Failure recovery | `IN_SCOPE` | Failed runs and observation failures must be modeled without retrying commands. |

## Internal Ledger Source Of Truth

Internal expected balances must be derived from existing private ledger state.

Reusable existing objects:

- `private.ledger_accounts`
- `private.ledger_journals`
- `private.ledger_entries`
- `private.ledger_account_balances`
- `private.wallet_asset_ledger_balances`
- `public.list_current_user_ledger_balances()`
- `public.list_admin_wallet_asset_ledger_balances(...)`

Expected balance source:

- User liability expectation comes from `private.wallet_asset_ledger_balances`.
- Available, locked, pending deposit, pending withdrawal, and total liability
  are separate buckets.
- System custody exposure comes from `SYSTEM_CUSTODY` ledger account balances.
- Deposit clearing and withdrawal clearing remain separate from settled custody.
- Staking principal is represented by `USER_LOCKED`.
- Paid rewards are represented by `USER_AVAILABLE` and
  `SYSTEM_REWARD_EXPENSE` after settlement.
- Accrued but unpaid rewards are not part of external expected balance unless a
  later task explicitly defines an accrual model.

Open questions to resolve in P5-T02 DB design:

- Whether reconciliation compares external observed balances to
  `SYSTEM_CUSTODY`, aggregate user total liabilities, or both.
- Whether pending deposits and pending withdrawals are included in expected
  custody exposure.
- Whether failed withdrawal execution attempts should remain expected custody
  until an administrator resolves them.

## Amount And Precision Contract

Existing amount rules must be reused.

- Financial units are exact atomic units.
- Application and RPC boundaries use decimal digit strings.
- PostgreSQL stores exact integer-like `numeric`.
- Existing `private.positive_atomic_units` allows positive values only.
- Observation models need a non-negative atomic unit contract because an
  external balance may be zero.
- Maximum precision should stay at 38 decimal digits unless the existing asset
  model is explicitly expanded.
- JavaScript `Number`, `Number()`, `parseInt()`, `parseFloat()`, unary plus,
  floating point math, implicit rounding, and cross-asset arithmetic are
  prohibited.
- Asset `decimals` are metadata. Reconciliation must compare atomic units, not
  decimal display amounts.
- Default tolerance should be zero atomic units until a documented per-asset or
  per-provider tolerance policy is approved.

## Reconciliation State Model

Candidate run statuses:

```text
PENDING
RUNNING
COMPLETED
PARTIAL
FAILED
```

Candidate item statuses:

```text
MATCHED
WITHIN_TOLERANCE
MISMATCH
OBSERVATION_FAILED
REVIEW_REQUIRED
RESOLVED
IGNORED
```

The final status names must be enforced by database constraints in the first
schema implementation. Status transitions should be append-only audited and
must not mutate immutable observations.

## Required DB Model Candidates

| Candidate | Classification | Notes |
| --- | --- | --- |
| `external_balance_observations` | `NEW_REQUIRED` | Immutable provider/binding/asset balance observations. |
| `external_transaction_observations` | `NEW_REQUIRED` | Immutable inbound/outbound transfer observations using evidence digests. |
| `reconciliation_runs` | `NEW_REQUIRED` | One execution boundary for manual or future scheduled reconciliation. |
| `reconciliation_items` | `NEW_REQUIRED` | One comparison result per run/binding/asset/scope. |
| `reconciliation_discrepancies` | `EXISTING_NEEDS_EXTENSION` | May be folded into items initially; separate table needed if review lifecycle grows. |
| `reconciliation_resolutions` | `NEW_REQUIRED` | Needed before any admin resolution command is implemented. |
| `observer_checkpoints` | `NEW_REQUIRED` | Needed before scheduled or paginated adapter execution. |
| Existing custody provider tables | `EXISTING_AND_REUSABLE` | Reuse provider and binding ids; do not store external account identifiers. |
| Existing ledger views | `EXISTING_AND_REUSABLE` | Reuse as expected internal balance source. |
| Existing audit tables | `EXISTING_NEEDS_EXTENSION` | Pattern reusable, but reconciliation needs its own immutable audit events. |

## Idempotency Contract

P5-T02 must follow existing command patterns:

- Caller-supplied `command_id`.
- Unique command IDs for command audit rows.
- Same-command replay returns the prior outcome.
- Reusing a command ID with different actor, target, action, reason, or request
  payload is a conflict.
- Immutable observations must have a natural uniqueness boundary, likely
  provider, binding, asset, observation type, observed timestamp, and evidence
  digest or source cursor.
- Reconciliation run creation must prevent accidental duplicate active runs for
  the same provider/binding/asset scope.
- Resolution commands must be idempotent and must not mutate immutable
  observation rows.

## Concurrency Contract

Expected controls:

- Transaction advisory lock namespace for reconciliation commands.
- Row locks on run, item, discrepancy, and checkpoint rows when advancing state.
- Expected-version checks for mutable operational rows.
- Unique partial indexes to prevent more than one active run for the same
  reconciliation scope when that rule is approved.
- Deferred constraints where cross-row consistency is required.
- No command retry and no business retry in local E2E harnesses.

## RLS And Authorization Contract

Role classification:

| Actor | Requirement |
| --- | --- |
| USER | May read only safe user-facing reconciliation summaries if a later task defines them. No raw external observation access by default. |
| ADMIN | AAL2 admin can trigger manual runs, inspect runs/items, and review discrepancies. |
| Operations staff | Not a separate role today; use ADMIN until a formal role exists. |
| Internal worker | Deferred; must not rely on service-role application runtime in this phase. |
| Database scheduled job | Deferred; must be explicitly approved before implementation. |

Database remains the final authorization boundary. Browser clients must not
write reconciliation tables directly. Private tables should be inaccessible to
`anon` and direct `authenticated` table grants. Public RPCs should be
`SECURITY DEFINER`, `search_path = ''`, and executable only by authenticated
users when appropriate.

## Audit Contract

Required reconciliation audit event candidates:

```text
RECONCILIATION_STARTED
RECONCILIATION_COMPLETED
RECONCILIATION_FAILED
DISCREPANCY_DETECTED
DISCREPANCY_REVIEWED
DISCREPANCY_RESOLVED
DISCREPANCY_IGNORED
CHECKPOINT_ADVANCED
```

Audit rows must be append-only. UPDATE, DELETE, and TRUNCATE must be blocked by
trigger. Public admin read RPCs should omit raw request data, raw observation
payloads, credential material, cookie/token values, and full external
identifiers.

## API Scope

| API candidate | Classification | Notes |
| --- | --- | --- |
| Manual reconciliation trigger | `REQUIRED_NOW` | First safe API after DB model exists; AAL2 ADMIN only. |
| Run list | `REQUIRED_NOW` | AAL2 ADMIN read after DB model exists. |
| Run detail | `REQUIRED_NOW` | AAL2 ADMIN read after DB model exists. |
| Discrepancy list | `REQUIRED_NOW` | AAL2 ADMIN read after DB model exists. |
| Resolution command | `DEFERRED` | Needs resolution state model and audit first. |

No API is created in P5-T02-01.

## Worker Scope

| Worker candidate | Classification | Notes |
| --- | --- | --- |
| External observation adapter | `DEFERRED` | Contract exists; implementation later. |
| Scheduled polling | `DEFERRED` | No scheduler exists. |
| Checkpoint management | `DEFERRED` | DB model first, worker later. |
| Reconciliation calculation | `REQUIRED_NOW` | First implementation should define DB/service calculation contract. |
| Alert generation | `DEFERRED` | No alert channel exists. |

No worker is created in P5-T02-01.

## Admin UI Scope

| Admin UI candidate | Classification | Notes |
| --- | --- | --- |
| Run dashboard | `DEFERRED` | Build after read RPCs exist. |
| Mismatch detail | `DEFERRED` | Build after items/discrepancy reads exist. |
| Resolution workflow | `DEFERRED` | Build after resolution command exists. |
| Audit trail | `DEFERRED` | Build after audit read RPC exists. |

No UI is created in P5-T02-01.

## Implementation Task List

### P5-T02-01 Requirements and schema contract

- Purpose: create this requirements and implementation plan.
- Expected files: one governance document.
- DB changes: no.
- Production source changes: no.
- External network required: no.
- Prior task: PRE-10A baseline.
- Completion gate: npm ci, audit, lint, build, clean git state except this
  untracked document.

### P5-T02-02 DB tables and constraints

- Purpose: add immutable observation, reconciliation run, item, resolution,
  checkpoint, and audit schemas.
- Expected files: one migration, one pgTAP test file, generated database types,
  database documentation/report.
- DB changes: yes.
- Production source changes: no unless generated types are considered source.
- External network required: no.
- Prior task: P5-T02-01.
- Completion gate: db reset, db lint, pgTAP, db types, lint, build, custody
  boundary.

### P5-T02-03 Internal expected balance calculation

- Purpose: define expected custody exposure from ledger buckets and system
  accounts.
- Expected files: migration/RPC tests, server-side read helper only if needed.
- DB changes: yes.
- Production source changes: possible server-only read helper.
- External network required: no.
- Prior task: P5-T02-02.
- Completion gate: exact atomic-unit tests and no JavaScript Number use.

### P5-T02-04 External observer adapter interface extension

- Purpose: connect DB ingestion contract to the existing server-only adapter
  type without implementing a real provider.
- Expected files: TypeScript contract and local test helper.
- DB changes: no or minimal.
- Production source changes: server-only type/service only.
- External network required: no.
- Prior task: P5-T02-03.
- Completion gate: no fetch/provider SDK/blockchain SDK.

### P5-T02-05 Local mock observer

- Purpose: deterministic non-secret local fixture adapter for E2E.
- Expected files: scripts and test fixtures only.
- DB changes: no.
- Production source changes: no.
- External network required: no.
- Prior task: P5-T02-04.
- Completion gate: fixture contains no addresses, signatures, keys, or raw
  provider credentials.

### P5-T02-06 Reconciliation calculation RPC/service

- Purpose: compare expected internal balances with observed external balances.
- Expected files: migration/RPC tests and server wrapper.
- DB changes: yes.
- Production source changes: server-only wrapper.
- External network required: no.
- Prior task: P5-T02-05.
- Completion gate: matched, tolerance, mismatch, and observation failure tests.

### P5-T02-07 Discrepancy lifecycle

- Purpose: model admin review, ignore, and resolve states.
- Expected files: migration/RPC tests and governance docs.
- DB changes: yes.
- Production source changes: possible server admin command wrapper.
- External network required: no.
- Prior task: P5-T02-06.
- Completion gate: idempotent replay and immutable audit tests.

### P5-T02-08 Admin command/API

- Purpose: expose AAL2 ADMIN manual trigger and review commands.
- Expected files: same-origin route handlers and server command wrappers.
- DB changes: no if DB RPCs already exist.
- Production source changes: yes.
- External network required: no.
- Prior task: P5-T02-07.
- Completion gate: auth, AAL2, same-origin, RLS, and audit E2E.

### P5-T02-09 Admin UI

- Purpose: run dashboard, item list, and discrepancy review UI.
- Expected files: `src/app/admin/reconciliation/**`.
- DB changes: no.
- Production source changes: yes.
- External network required: no.
- Prior task: P5-T02-08.
- Completion gate: anonymous/admin guard smoke and no sensitive data exposure.

### P5-T02-10 Scheduled execution

- Purpose: define scheduled or worker-owned reconciliation.
- Expected files: worker/scheduler design and implementation files.
- DB changes: likely checkpoint constraints.
- Production source changes: yes.
- External network required: not until adapter is approved.
- Prior task: P5-T02-09.
- Completion gate: no service-role runtime unless separately approved.

### P5-T02-11 Audit and alerts

- Purpose: finalize immutable audit reads and alert boundaries.
- Expected files: audit read RPCs, admin views, docs.
- DB changes: yes.
- Production source changes: possible admin read surface.
- External network required: no unless alert provider is approved separately.
- Prior task: P5-T02-10.
- Completion gate: append-only audit tests and no raw payload exposure.

### P5-T02-12 Security and RLS

- Purpose: harden direct table access, function grants, and secret scans.
- Expected files: migration/tests/docs.
- DB changes: yes.
- Production source changes: no.
- External network required: no.
- Prior task: P5-T02-11.
- Completion gate: no direct browser private table access, no service-role app
  client, no raw observation exposure.

### P5-T02-13 Integration tests

- Purpose: full local P5-T02 integration with deterministic mock observations.
- Expected files: scripts and governance report.
- DB changes: no.
- Production source changes: no.
- External network required: no.
- Prior task: P5-T02-12.
- Completion gate: phase closeout remains additive-safe.

### P5-T02-14 Closeout

- Purpose: close Phase 5 reconciliation gate.
- Expected files: closeout checklist/report and maybe additive closeout script
  changes.
- DB changes: no unless prior gaps are found.
- Production source changes: no unless prior gaps are found.
- External network required: no.
- Prior task: P5-T02-13.
- Completion gate: DB, lint, build, custody boundary, reconciliation E2E, secret
  scan, and process cleanup.

## First Implementation Task

Selected first implementation task:

```text
P5-T02-02 DB tables and constraints
```

Reason:

- It requires no external network.
- It requires no mainnet, production secret, provider SDK, or service-role app
  runtime.
- It fixes schema, state, precision, idempotency, concurrency, RLS, and audit
  contracts before any API, worker, or UI is added.
- It is small enough to validate with pgTAP and rollback by reverting one
  forward-only migration before production use.

Expected change scope for P5-T02-02:

- New migration under `supabase/migrations/`.
- New pgTAP file under `supabase/tests/database/`.
- Generated `src/types/database.types.ts` only if public RPCs/types are added.
- New database/governance documentation.
- No `src/app/**` route or page.
- No worker.
- No provider SDK.
- No blockchain SDK.
- No network call.

## Risk Elements

- Official detailed P5-T02 schema names are not present before this document.
- Expected custody exposure policy is not fully settled for pending deposits,
  pending withdrawals, and failed withdrawal execution attempts.
- Observation tables need zero-unit support, while existing
  `private.positive_atomic_units` is positive-only.
- Raw external evidence storage remains undefined and must not be improvised.
- Worker identity and scheduler ownership remain undefined.
- User-facing visibility of reconciliation results remains undefined.
- Any future provider adapter can accidentally cross the no-network boundary if
  not isolated in a later task.

## P5-T02 Readiness

```text
P5_T02_BASELINE_COMMIT=4ce94c79726f67b2042dfba2530a22d0a90c8025
P5_T02_REQUIREMENTS_READY=true
P5_T02_IMPLEMENTATION_STARTED=false
P5_T02_FIRST_IMPLEMENTATION_TASK=P5-T02-02 DB tables and constraints
FINAL_STATUS=PASS_REQUIREMENTS_READY
```
