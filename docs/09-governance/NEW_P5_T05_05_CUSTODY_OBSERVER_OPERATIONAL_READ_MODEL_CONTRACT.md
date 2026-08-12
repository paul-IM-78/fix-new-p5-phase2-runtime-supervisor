# NEW-P5-T05-05 Custody Observer Operational Read Model Contract

## 1. Task Identity

- Task: `P5-T05-05`
- Title: `ADMIN+AAL2 operational read model for safe list/detail and derived stale/severity/alert eligibility`
- Branch: `feat/p5-t05-operational-read-model`
- Baseline: `3cf5d6d24ab74a4462f7efc1fdba0e0c5cd9b72e`
- Status: contract frozen; implementation has not started.

## 2. Objective and Inherited Boundaries

This task adds a strictly read-only, user-scoped ADMIN+AAL2 operational list and detail boundary over the durable observer run ledger. It does not alter observer execution, durable lifecycle semantics, or writer behavior.

Inherited requirements from `NEW_P5_T05_01_CUSTODY_OBSERVER_RUN_LEDGER_CONTRACT.md` are authoritative:

- List/detail includes safe run, scope outcome, and binding failure evidence.
- Exact integer values are decimal strings.
- Private ledger tables are never exposed directly to browser Supabase clients.
- Retry, cancel, resume, acknowledge, resolve, automatic terminalization, lease stealing, and re-execution are out of scope.
- Provider networking, credential loading, application service-role use, alert delivery, scheduler, queue, cron, daemon, and stale reaper remain out of scope.

The P5-T05-04 orchestrator, recorded orchestrator, run-ledger client, migration, pgTAP, and runtime harnesses are `FROZEN_NO_TOUCH`.

## 3. Repository-Derived Facts

### 3.1 Durable schema

- Runs: `private.custody_balance_observer_runs`.
- Scope evidence: `private.custody_balance_observer_scope_outcomes` with immutable key `(run_id, provider_id, asset_id)` and unique `(run_id, discovery_index)`.
- Binding failure evidence: `private.custody_balance_observer_binding_failures` with immutable key `(run_id, binding_id)`.
- Run statuses: `RUNNING`, `COMPLETED`, `PARTIAL`, `ABORTED`, `FAILED_DISCOVERY`, `FAILED_CLEANUP`.
- Run list ordering uses `created_at DESC, run_id DESC`.
- Scope evidence ordering uses `recorded_at ASC, discovery_index ASC`.
- Failure evidence ordering uses `recorded_at ASC, binding_order ASC, binding_id ASC`; the final UUID tie-breaker is DB-only.

### 3.2 Descriptor sources

- Provider descriptor: `private.custody_providers.display_name`.
- Asset descriptor: `public.supported_assets.symbol`.
- Detail RPCs use `LEFT JOIN`; absent metadata returns `null` descriptor fields. Internal IDs never substitute for a missing descriptor.

### 3.3 Existing authorization and read conventions

- Server guard: `inspectAdminAccess()` in `src/server/auth/admin-guard.ts`.
- DB helper: `public.is_current_user_admin_aal2()` with `auth.uid()`.
- Existing read RPC convention: `STABLE SECURITY DEFINER SET search_path = ''`, fully qualified references, revoke `PUBLIC`/`anon`, grant only `authenticated`, and raise `ADMIN_AAL2_REQUIRED` with SQLSTATE `42501`.
- Existing cursor codec reference: `encodeReconciliationListCursor()` and its paired parser in `src/lib/reconciliation/validation.ts`.
- Existing route reference: the reconciliation list/detail GET routes use strict parsing and `Cache-Control: no-store`.

## 4. Stale, Severity, and Alert Eligibility

### 4.1 Stale

- Only `RUNNING` can be stale.
- DB condition: `started_at < p_cutoff`.
- The cutoff is calculated once per request by server code: trusted UTC now minus a fixed 15 minutes.
- The threshold is an explicit server-code constant; it is not environment-configured, DB-configured, client-configurable, or ADMIN-overridable.
- Equality is not stale. A null `started_at` is not stale and does not fall back to `created_at`.
- Public output exposes only `stale: boolean`, never the cutoff or threshold.
- Every list request has a fresh cutoff. Cursor position is stable, but stale/severity/alert fields and total count may change between pages.

### 4.2 Severity

`INFO`, `WARNING`, and `CRITICAL` are the only exact uppercase values. Severity is DB-derived with precedence `CRITICAL > WARNING > INFO`.

- `RUNNING` and not stale: `INFO`.
- stale `RUNNING`: `CRITICAL`.
- `COMPLETED`: `INFO`.
- `ABORTED`: `INFO`.
- `PARTIAL`: `WARNING`.
- Existing discovery/cleanup failure allowlist: `ORCHESTRATOR_SCOPE_DISCOVERY_FAILED`, `ORCHESTRATOR_SCOPE_PAGE_INVALID`, `ORCHESTRATOR_SCOPE_CURSOR_LOOP`, `ORCHESTRATOR_DISCOVERY_LIMIT_EXCEEDED`, `ORCHESTRATOR_SCOPE_DUPLICATE`, `ORCHESTRATOR_PROVIDER_REF_INVALID`, and `ORCHESTRATOR_CLIENT_CLOSE_FAILED` produce `CRITICAL` only with their established corresponding terminal status.
- Unknown terminal codes do not fail the read and do not become `CRITICAL` merely because they are non-null.

### 4.3 Alert eligibility

`alertEligible` is DB-derived from the canonical severity expression only: `WARNING` and `CRITICAL` are eligible; `INFO` is not. No alert reason, category, array, delivery, queue, or side effect is returned or created.

## 5. Public List Contract

`GET /api/v1/admin/custody-observer/runs` returns an envelope with `items`, `totalCount`, and `nextCursor` on every `200` response.

Every item includes `runId`, `status`, `version`, `terminalCode`, `createdAt`, `startedAt`, `completedAt`, `scopeCount`, `successCount`, `failedCount`, `abortedCount`, `bindingFailureCount`, `stale`, `severity`, and `alertEligible`.

- `version` and every count are decimal strings.
- `terminalCode`, `startedAt`, and `completedAt` are always present and nullable.
- Public timestamps are UTC ISO-8601 strings.
- Provider/asset descriptors, binding IDs, scope/failure arrays, raw errors, and retry/refresh/close/page telemetry are excluded.
- Empty results are `200` with `items=[]`, `totalCount="0"`, and `nextCursor=null`.

### 5.1 List filters and query validation

Only `status`, `stale`, `severity`, `alertEligible`, `cursor`, and `limit` are supported. All filters combine with `AND`; valid contradictory filters return an empty `200` response.

- Status uses the durable status enum exactly.
- Severity accepts only `INFO`, `WARNING`, `CRITICAL`.
- Boolean filters accept only lowercase `true` or `false`.
- Unknown, duplicate, empty, multi-value, case-normalized, or alias query values are rejected.
- Error codes are `invalid_status`, `invalid_stale`, `invalid_severity`, `invalid_alert_eligible`, `invalid_cursor`, `invalid_limit`, or `invalid_query` as applicable.

### 5.2 Cursor and pagination

- Ordering is `created_at DESC, run_id DESC`.
- The opaque server cursor contains `createdAt` and `runId`; the DB receives typed components and never decodes a token.
- Next-page predicate is strictly `(created_at < cursor_created_at) OR (created_at = cursor_created_at AND run_id < cursor_run_id)`.
- Default limit is 25, minimum 1, maximum 100.
- Limit is a canonical positive decimal integer with no leading zero, sign, whitespace, decimal, or exponent form.
- The list RPC reads at most `limit + 1` rows. The next cursor is derived from the last returned row, not the lookahead row.
- `totalCount` is the full filtered result count before cursor position, recalculated by the same list RPC using the request cutoff and filters. No separate count RPC and no `hasMore` field are added.

## 6. Public Detail Contract

`GET /api/v1/admin/custody-observer/runs/{runId}` validates a UUID and returns `{ "item": { ... } }`.

- Malformed IDs return `400 invalid_run_id`.
- A valid missing run returns `404 custody_observer_run_not_found`.
- Found detail contains the same safe run fields and derived fields as List, plus complete unpaginated `scopeOutcomes` and `bindingFailures` arrays.
- Scope rows include safe status, safe scope code, bounded count strings, result-meaning refresh flags, timestamp, `providerName`, and `assetSymbol`.
- Failure rows include failure stage/code, retry and refresh booleans, bounded `attempts` strings, timestamp, `providerName`, and `assetSymbol`.
- No message/description, provider/asset/binding ID, endpoint, account/address identity, raw error, stack, SQL error, provider response, or credential is exposed.
- Evidence uses the immutable DB ordering defined in section 3.1. Internal tie-breaker identifiers are never public.

## 7. HTTP and Authorization Contract

All public errors are exactly `{ "error": { "code": "<stable_code>" } }` with no message.

- Anonymous: `401 authentication_required`.
- Inactive or non-admin: `403 admin_access_required`.
- ADMIN without AAL2: `403 admin_aal2_required`.
- Valid ADMIN+AAL2: read allowed.
- Unexpected read failures: `500 custody_observer_read_failed`.

Server calls `inspectAdminAccess()`, then invokes the RPC through the existing user-scoped server Supabase client. Both List and Detail RPCs independently require `auth.uid()` and `public.is_current_user_admin_aal2()`. Routes use `Cache-Control: no-store`.

## 8. DB Read Boundary

One forward-only migration creates exactly two public safe JSONB RPCs: a list RPC and a detail RPC. They are `STABLE SECURITY DEFINER SET search_path = ''`, fully qualify objects, revoke execution from `PUBLIC` and `anon`, and grant execute only to `authenticated`.

No safe view is created. No authenticated direct SELECT grant is added to any private run-ledger table. RPC output is snake_case JSON; the server validates and normalizes it to camelCase public JSON. List and Detail use the same DB-derived stale/severity/alert expression.

## 9. Implementation Plan

Planned new files are a forward-only T05-05 migration, a dedicated pgTAP test, a custody observer admin read-model server module, custody validation/public-result modules as required, list/detail GET routes, a focused local runtime harness, and a governance evidence report. `package.json` gains only the corresponding focused test script. `src/types/database.types.ts` is regenerated only after the migration is approved and applied.

## 10. Validation Matrix

Validation must cover DB grants, revokes, empty search path, internal ADMIN+AAL2 recheck, read-only behavior, auth matrix, strict list query parsing, keyset pagination, same-timestamp ties, count strings, every filter, empty list, detail not-found/UUID behavior, full ordered evidence arrays, null descriptors, no private fields, stale boundary cases, all severity cases, allowlisted and unknown terminal codes, no-store, zero provider network, zero credential reads, zero application service-role use, DB lint, pgTAP, runtime harness, TypeScript, ESLint, build, secret scan, generated-type review, frozen-path integrity, and `git diff --check`.

## 11. Explicit Non-Goals

No UI, mutation/control-plane endpoint, scheduler, queue, cron, daemon, reaper, retry, provider adapter/network, credential loading, alert delivery, reconciliation trigger, transfer, payout, signing, webhook, financial remediation, deployment wiring, or subsequent T05-06 work is included.

## 12. Implementation Entry Gate

Implementation may begin only with a new migration and dedicated read-model paths. The frozen P5-T05-04 paths remain unchanged, DB derives all operational state, browser clients receive only public-safe data, and no validation is claimed by this contract document.

```text
FINAL_STATUS=READY_FOR_P5_T05_05_STEP_4_IMPLEMENTATION
```
