# NEW-P5-T02-13A Admin Reconciliation Review Actions Contract

## 1. Status

- Worktree: `D:\Ai\staking-wallet-web`
- Previous branch: `chore/next-work`
- Branch: `feat/p5-t02-admin-reconciliation-review-actions`
- HEAD: `339197ff929b984671822ae14bf148115511a920`
- origin/main: `339197ff929b984671822ae14bf148115511a920`
- Scope: analysis plus this governance contract only.
- Code, migration, API, UI, test, package, staging, commit, push, PR, merge, rebase, reset: not performed.
- Contract result: existing write boundary is sufficient for UI wiring, and the semantic reason-code catalog is now defined as v1.
- Final status: `FINAL_STATUS=PASS_ADMIN_RECONCILIATION_REVIEW_ACTIONS_CONTRACT_READY`

## 2. Worktree / Branch / HEAD

- Development worktree started clean on `chore/next-work` at `339197ff929b984671822ae14bf148115511a920`.
- `origin/main` was fetched and matched `339197ff929b984671822ae14bf148115511a920`.
- Local branch `feat/p5-t02-admin-reconciliation-review-actions` was created from that HEAD.
- The new branch has no upstream and was not pushed.

## 3. Analysis Scope

Read sources:

- Governance: `NEW_P5_T02_07_RECONCILIATION_REVIEW_LIFECYCLE_REPORT.md`, `NEW_P5_T02_08_AAL2_ADMIN_REVIEW_COMMAND_REPORT.md`, `NEW_P5_T02_09_RECONCILIATION_RUNTIME_CLOSEOUT_REPORT.md`, `NEW_P5_T02_12A_ADMIN_RECONCILIATION_READ_UI_REPORT.md`, `NEW_P5_T02_12C_ADMIN_RECONCILIATION_UI_RUNTIME_REPORT.md`, `NEW_P5_T02_12D_ADMIN_RECONCILIATION_UI_BRANCH_CLOSEOUT_REPORT.md`
- DB migrations: `20260729106000_p5_t02_reconciliation_review_lifecycle.sql`, `20260729107000_p5_t02_reconciliation_admin_commands.sql`, `20260729107100_p5_t02_reconciliation_admin_error_transport.sql`
- DB tests: `p5_t02_reconciliation_review_lifecycle.test.sql`, `p5_t02_reconciliation_admin_commands.test.sql`, `p5_t02_reconciliation_admin_error_transport.test.sql`
- Application: `src/server/admin/reconciliation-review-commands.ts`, `src/lib/reconciliation/validation.ts`, `src/lib/reconciliation/public-results.ts`, review open and transition API routes, `src/types/database.types.ts`
- Runtime: `scripts/test-p5-t02-reconciliation-review-runtime.mjs`, `package.json`
- Read UI/read model: reconciliation admin pages, shared reconciliation components, display helper, and `src/server/admin/reconciliation-read-model.ts`

## 4. Existing Architecture Map

- The private DB lifecycle owns review-case state changes and event append semantics.
- Public ADMIN RPCs are `SECURITY DEFINER` wrappers with empty `search_path`.
- The server command module is `server-only`, creates a user-scoped server Supabase client, calls `inspectAdminAccess()`, then calls the authenticated public RPC.
- The HTTP routes are same-origin JSON POST boundaries with bounded body parsing, DTO allowlists, no-store JSON responses, and public-safe error codes.
- The current admin reconciliation UI is read-only server-rendered UI. It reads via server read commands, does not use browser Supabase, and does not include review action controls.

## 5. DB Tables And Constraints

`private.reconciliation_review_cases` stores the current review case for one reconciliation item.

- PK: `id uuid default gen_random_uuid()`.
- FK: `reconciliation_item_id` references `private.reconciliation_items(id)` with `ON DELETE RESTRICT`.
- Actor FKs: `opened_by_profile_id` and `last_actor_profile_id` reference `public.profiles(id)` with `ON DELETE RESTRICT`.
- Cardinality: one current case per item, enforced by unique constraint `reconciliation_resolutions_item_uidx` on `reconciliation_item_id`.
- Status check: `OPEN`, `IN_REVIEW`, `RESOLVED`, `IGNORED`.
- Version: `bigint not null default 1`, constrained to `>= 1`.
- Terminal timestamp shape: `OPEN` and `IN_REVIEW` require `resolved_at is null`; `RESOLVED` and `IGNORED` require `resolved_at is not null`.
- Time order: `updated_at >= opened_at`; terminal timestamp must be at or after open.
- Indexes: status/update/id lookup and last actor/update lookup.
- Direct privileges are revoked from `public`, `anon`, and `authenticated`.
- No RLS policy was added for these private tables; the boundary is private schema access plus revoked direct privileges plus RPC/server command mediation.
- UPDATE on the current case is allowed only through privileged DB function execution paths; browser roles have no direct update privilege.

`private.reconciliation_review_case_events` stores append-only review lifecycle history.

- PK: `id uuid default gen_random_uuid()`.
- FK: `reconciliation_resolution_id` references `private.reconciliation_review_cases(id)` with `ON DELETE RESTRICT`.
- Actor FK: `actor_profile_id` references `public.profiles(id)` with `ON DELETE RESTRICT`.
- Unique event version per case: `unique (reconciliation_resolution_id, event_version)`.
- Unique idempotency per case: `unique (reconciliation_resolution_id, idempotency_key)`.
- Global idempotency uniqueness: `unique (idempotency_key)`.
- Event version: `bigint >= 1`; it equals the resulting current case version.
- Event types: `OPENED`, `REVIEW_STARTED`, `RESOLVED`, `IGNORED`.
- Type/status shape enforces `OPENED` as version 1 with null `from_status`, `OPEN -> IN_REVIEW`, `OPEN|IN_REVIEW -> RESOLVED`, and `OPEN|IN_REVIEW -> IGNORED`.
- Reason code syntax is bounded uppercase text.
- Direct privileges are revoked from `public`, `anon`, and `authenticated`.
- A trigger blocks UPDATE, DELETE, and TRUNCATE by raising `reconciliation_resolution_event_immutable` with SQLSTATE `55000`.

## 6. Review Eligibility

Review open is allowed only when the target reconciliation item exists and its classification is:

- `MISMATCH`
- `OBSERVATION_FAILED`

Review open is rejected for:

- `MATCHED`
- `WITHIN_TOLERANCE`

`REVIEW_REQUIRED` exists in the application read/filter type union but is not accepted by the current private open function. The UI may use the detail DTO as a hint, but the DB command remains the final source of eligibility.

## 7. State Transition Matrix

| Current state | Target `OPEN` | Target `IN_REVIEW` | Target `RESOLVED` | Target `IGNORED` |
| --- | --- | --- | --- | --- |
| No case | Not a transition | Not a transition | Not a transition | Not a transition |
| `OPEN` | Reject | Allow | Allow | Allow |
| `IN_REVIEW` | Reject | Reject | Allow | Allow |
| `RESOLVED` | Reject | Reject | Reject | Reject |
| `IGNORED` | Reject | Reject | Reject | Reject |

Additional rules:

- Reopen is not implemented.
- Same-state transitions are rejected.
- `RESOLVED <-> IGNORED` is rejected through terminal protection.
- Public transition RPC rejects caller target `OPEN` before the private transition function.

## 8. Private Lifecycle Functions

`private.open_reconciliation_resolution(p_reconciliation_item_id uuid, p_idempotency_key text, p_actor_profile_id uuid, p_reason_code text)`

- Returns `reconciliation_resolution_id`, `created`, `status`, `version`, `event_id`.
- Normalizes and validates idempotency key and reason code.
- Requires an existing actor profile.
- Checks global idempotency key first.
- Exact replay returns the existing case and original `OPENED` event with `created=false`.
- Conflicting replay raises `reconciliation_resolution_idempotency_conflict`.
- Missing item raises `reconciliation_item_not_found`.
- Non-reviewable classification raises `reconciliation_item_not_reviewable`.
- Existing case with a different key raises `reconciliation_resolution_already_exists`.
- First open inserts one current case and one version 1 `OPENED` event in the same DB function call.
- Concurrency is guarded by unique constraints and `ON CONFLICT (reconciliation_item_id) DO NOTHING`.
- Unique violations map to idempotency conflict.

`private.transition_reconciliation_resolution(p_reconciliation_resolution_id uuid, p_expected_version bigint, p_target_status text, p_idempotency_key text, p_actor_profile_id uuid, p_reason_code text)`

- Returns `reconciliation_resolution_id`, `event_id`, `created`, `status`, `version`.
- Validates expected version, target status, idempotency key, reason code, and actor profile.
- Checks global idempotency key first.
- Exact replay returns the existing transition event with `created=false`.
- Conflicting replay raises `reconciliation_resolution_idempotency_conflict`.
- Locks the current case with `FOR UPDATE` for non-replay transitions.
- Runs integrity verification before transition.
- Missing case raises `reconciliation_resolution_not_found`.
- Terminal cases raise `reconciliation_resolution_terminal`.
- Stale expected version raises `reconciliation_resolution_version_conflict` with private SQLSTATE `40001`.
- Invalid matrix transition raises `reconciliation_resolution_transition_invalid`.
- Successful transition updates the current case, increments version by 1, sets `resolved_at` only for terminal states, and appends one event.

## 9. Public ADMIN RPC

`public.admin_open_review_case(uuid, text, text)`

- `VOLATILE`, `SECURITY DEFINER`, `set search_path = ''`.
- Execute revoked from `public`, `anon`, and `authenticated`, then granted only to `authenticated`.
- Derives actor profile from `auth.uid()`.
- Requires `auth.uid()` and `public.is_current_user_admin_aal2()`.
- Accepts no caller actor/profile/role/admin/AAL arguments.
- Calls `private.open_reconciliation_resolution(...)`.

`public.admin_transition_review_case(uuid, bigint, text, text, text)`

- `VOLATILE`, `SECURITY DEFINER`, `set search_path = ''`.
- Execute revoked from `public`, `anon`, and `authenticated`, then granted only to `authenticated`.
- Derives actor profile from `auth.uid()`.
- Requires `auth.uid()` and `public.is_current_user_admin_aal2()`.
- Accepts no caller actor/profile/role/admin/AAL arguments.
- Trims and allowlists caller target status to `IN_REVIEW`, `RESOLVED`, `IGNORED`.
- Calls `private.transition_reconciliation_resolution(...)`.
- Preserves private/direct DB `40001` for version conflict.
- Translates only exact PostgREST request-context `reconciliation_resolution_version_conflict` to `PT409`.

## 10. Server Command

File: `src/server/admin/reconciliation-review-commands.ts`

- Imports `server-only`.
- Uses `createServerSupabaseClient()` with request cookies and publishable key; no service-role client is used.
- Calls `inspectAdminAccess()` before RPC invocation.
- Input union:
  - `open_review`: `reconciliationItemId`, `idempotencyKey`, `reasonCode`
  - `transition_review`: `reviewCaseId`, `expectedVersion`, `targetStatus`, `idempotencyKey`, `reasonCode`
- RPC rows are normalized to `reviewCaseId`, `eventId`, `created`, `status`, `version`.
- `version` is converted with `Number(row.version)`. Current DB lifecycle versions start at 1 and increment by one per event, so current use is safe in practice for review UI optimistic concurrency. Long term, this remains a bigint-to-number edge to watch if review event counts could ever approach unsafe integer bounds.
- Domain DB errors are mapped to public error codes and HTTP status values.
- Unexpected DB errors map to `reconciliation_review_unavailable` with HTTP 500.
- Admin access unavailable maps to HTTP 503.

## 11. HTTP Route Contracts

Routes:

- `POST /api/v1/admin/reconciliation/reviews/open`
- `POST /api/v1/admin/reconciliation/reviews/transition`

Shared route behavior:

- Runtime: `nodejs`.
- Dynamic: `force-dynamic`.
- Same-origin guard via `isSameOriginRequest()`.
- `Content-Type` media type must be `application/json`.
- Raw request body limit: 4096 bytes.
- Parsed body must be a plain JSON object.
- Unknown fields are rejected.
- Caller actor/profile/user/role/admin/AAL spoof fields are rejected.
- Response is JSON with `Cache-Control: no-store` and `Pragma: no-cache`.
- Raw SQLSTATE, DB details, stack traces, profile objects, session state, and credential material are not returned.

## 12. Request / Response DTO

Open request:

```json
{
  "reconciliationItemId": "uuid",
  "idempotencyKey": "non-secret-key",
  "reasonCode": "UPPERCASE_REASON"
}
```

Open forbidden caller fields:

- `actor`, `actorProfileId`, `actor_profile_id`, `openedByProfileId`, `opened_by_profile_id`
- `lastActorProfileId`, `last_actor_profile_id`
- `profileId`, `userId`, `user_id`
- `role`, `admin`, `isAdmin`, `is_admin`, `AAL`, `aal`, `assuranceLevel`, `status`, `version`

Transition request:

```json
{
  "reviewCaseId": "uuid",
  "expectedVersion": 1,
  "targetStatus": "IN_REVIEW",
  "idempotencyKey": "non-secret-key",
  "reasonCode": "UPPERCASE_REASON"
}
```

Transition target status allowlist:

- `IN_REVIEW`
- `RESOLVED`
- `IGNORED`

Success response envelope:

```json
{
  "ok": true,
  "result": {
    "reviewCaseId": "uuid",
    "eventId": "uuid",
    "created": true,
    "status": "OPEN",
    "version": 1
  }
}
```

Error response envelope:

```json
{
  "ok": false,
  "error": {
    "code": "public_error_code"
  }
}
```

## 13. Authentication And Actor Derivation

- Page access uses `getCurrentAdminAccess()`.
- Server command access uses `inspectAdminAccess()` with the same user-scoped Supabase client pattern.
- Public DB RPCs also enforce `public.is_current_user_admin_aal2()`.
- Actor is derived only from `auth.uid()` inside the public RPC.
- Caller actor/profile/user/admin/AAL fields are rejected before command execution.
- UI controls are not a security boundary; server command and DB RPC remain the final boundary.

## 14. Reason-Code Contract

`REASON_CODE_SYNTAX_CONTRACT=trimmed text matching ^[A-Z][A-Z0-9_]{2,63}$`

- Minimum length: 3 characters.
- Maximum length: 64 characters.
- First character: uppercase A-Z.
- Remaining characters: uppercase A-Z, digits, underscore.
- Null, empty, whitespace-only, lowercase, embedded whitespace, and overlong values are rejected.
- The application route uses the same syntax regex.
- The DB stores reason code in `private.reconciliation_review_case_events.reason_code`.
- No free-text note is stored by the current contract.

`REASON_CODE_CATALOG=DEFINED`

`REASON_CODE_CATALOG_VERSION=V1`

`REASON_CODE_INPUT_MODE=SYSTEM_DERIVED`

`FREE_TEXT_REASON_CODE=DISALLOWED`

`USER_SELECTABLE_REASON_CODE=DISALLOWED`

Catalog v1:

| Review action source | System-derived reason code |
| --- | --- |
| Open review for classification `MISMATCH` | `BALANCE_MISMATCH_REVIEW_OPENED` |
| Open review for classification `OBSERVATION_FAILED` | `OBSERVATION_FAILURE_REVIEW_OPENED` |
| Transition to `IN_REVIEW` | `MANUAL_REVIEW_STARTED` |
| Transition to `RESOLVED` | `REVIEW_ASSESSMENT_COMPLETED` |
| Transition to `IGNORED` | `NO_FURTHER_REVIEW_REQUIRED` |

Reason meanings and boundaries:

- `BALANCE_MISMATCH_REVIEW_OPENED`: means a manual review case was opened for a balance mismatch item. It does not mean that funds were lost or that an accounting defect has been confirmed.
- `OBSERVATION_FAILURE_REVIEW_OPENED`: means a manual review case was opened for an internal balance observation failure item. It does not mean that a real balance difference exists.
- `MANUAL_REVIEW_STARTED`: means an admin started manual review. It does not mean that root cause analysis or remediation is complete.
- `REVIEW_ASSESSMENT_COMPLETED`: means the current review workflow assessment is complete. It does not mean that funds were recovered, ledger data was corrected, observations were overwritten, reconciliation was rerun, or provider-side action was completed.
- `NO_FURTHER_REVIEW_REQUIRED`: means the current workflow decided not to continue further review. It does not mean that the item is correct, problem-free, or that the original reconciliation classification changed.

UI contract:

- Admins must not directly enter reason codes.
- Admins must not choose reason codes from a selector.
- The UI derives the fixed reason code from the item's classification for open actions or from the target status for transition actions.
- Retrying the exact same semantic action after a network failure uses the same reason code and the same idempotency key.
- Changing to another action uses that action's fixed reason code and a new idempotency key.
- Reason codes must not be exposed in URL query strings, detail metadata, or general logs.
- The API request body still includes `reasonCode` because the existing route/application/DB contract requires it.
- Arbitrary or tampered reason codes remain subject to the existing route, application, and DB validation boundaries.
- 13B should place the v1 catalog/helper in one central implementation location instead of duplicating constants across UI components.

## 15. Idempotency Contract

- Syntax: trimmed text matching `^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$`.
- Effective length: 8 to 200 characters.
- Null, empty, whitespace-only, malformed, overlong, control-character, and credential-like strings are rejected.
- Global uniqueness is enforced on `private.reconciliation_review_case_events.idempotency_key`.
- Per-case uniqueness is also enforced on `(reconciliation_resolution_id, idempotency_key)`.
- Exact open replay requires the same item, actor, reason code, `OPENED` event, event version 1, and target `OPEN`.
- Exact transition replay requires the same case, resulting event version `expectedVersion + 1`, actor, target status, reason code, and non-`OPENED` event.
- Conflicting reuse raises `reconciliation_resolution_idempotency_conflict`.
- Open and transition share the same global key space, so one key must not be reused across semantic actions.

`IDEMPOTENCY_UI_GENERATOR=NOT_DEFINED`

UI contract proposal:

- Generate a new key for each user submit.
- Reuse the same key only for retrying the exact same network request.
- Generate a new key for a different semantic action.
- After a stale version conflict and user reconfirmation, generate a new key.
- Do not place actor/profile/session identifiers in the key.
- Do not display the key in the UI, URL, or logs.

## 16. Optimistic Concurrency

- Detail read payload provides `reviewCase.version`.
- Transition UI must submit that value as `expectedVersion`.
- The DB transition function locks the case and checks current version before writing.
- Version conflict returns public code `reconciliation_review_version_conflict` with HTTP 409 through the route.
- UI must not auto-apply an action onto a newer version.
- On 409 version conflict, refetch detail, show the latest state, and require the user to choose again.
- Exact replay with `created=false` is a success for retry UX.

## 17. Error Transport Table

| Source | HTTP | Public code | UI message nature | Refresh detail | Retry | Idempotency key | AAL2 move |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Invalid JSON, DTO, syntax, target | 400 | `invalid_request` | Correct submitted values | No | After user edit | New key after edit | No |
| Missing session | 401 | `admin_authentication_required` | Sign in required | No | After sign-in | New key | Sign-in |
| Non-admin, inactive, missing profile | 403 | `admin_role_required` | Admin role required | No | No | New key if retried later | No |
| MFA enrollment/challenge required | 403 | `admin_aal2_required` | Verified admin MFA required | No | After MFA | Same semantic submit should use a fresh key after returning | Yes |
| Same-origin guard failed | 403 | `request_rejected` | Request rejected | No | No | New key if user retries from valid page | No |
| Missing reconciliation item | 404 | `reconciliation_item_not_found` | Item not found | Yes | No | New key if item changes | No |
| Missing review case | 404 | `reconciliation_review_not_found` | Review not found | Yes | No | New key after refresh | No |
| Item not reviewable | 409 | `reconciliation_item_not_reviewable` | Item is not reviewable | Yes | No | New key after state change | No |
| Review already exists | 409 | `reconciliation_review_already_exists` | Review already exists | Yes | No | New key after refresh | No |
| Idempotency conflict | 409 | `reconciliation_review_idempotency_conflict` | Submit identity conflict | Yes | No automatic retry | New key only after user reconfirms | No |
| Version conflict | 409 | `reconciliation_review_version_conflict` | Review changed | Yes | No automatic retry | New key after reconfirmation | No |
| Terminal case | 409 | `reconciliation_review_terminal` | Terminal state cannot transition | Yes | No | Do not reuse for different action | No |
| Invalid transition | 409 | `reconciliation_review_transition_invalid` | Transition not allowed | Yes | No | New key after user chooses valid action | No |
| Existing state invalid | 409 | `reconciliation_review_state_invalid` | Review state inconsistent | Yes | No | New key only after resolution | No |
| Unexpected command failure | 500 | `reconciliation_review_unavailable` | Temporary unavailable | Maybe | Safe retry of same exact request only after checking result | Same key for same request retry | No |
| Admin access unavailable | 503 | `reconciliation_review_unavailable` | Temporary unavailable | No | Later | New key after returning to page | No |

Raw DB messages must not be displayed.

## 18. Runtime Coverage

Script: `scripts/test-p5-t02-reconciliation-review-runtime.mjs`

NPM script: `test:reconciliation:review:local`

Existing PASS markers cover:

- public health/readiness smoke
- unauthenticated denied
- USER AAL2 denied
- ADMIN AAL1 denied
- ADMIN AAL2 open success
- actor derivation
- actor spoof blocked
- exact open replay
- open idempotency conflict
- transition DTO validation
- transition success
- exact transition replay
- private/direct/public route version conflict transport separation
- route-level 409 version conflict
- terminal protection
- source row side-effect boundary
- public-safe response denylist
- low-level private function execute blocked
- fixture, runtime, port, process, container, and environment cleanup

The 09 closeout report records `FINAL_STATUS=PASS_P5_T02_RUNTIME_CLOSEOUT_READY`.

## 19. Admin UI Action Eligibility Matrix

| Detail state | UI action candidate | Target command | System reason code | Required inputs | Final guard |
| --- | --- | --- | --- | --- | --- |
| No review case, classification `MISMATCH` | Open Review | open route | `BALANCE_MISMATCH_REVIEW_OPENED` | item id, new key, derived reason code | DB open function |
| No review case, classification `OBSERVATION_FAILED` | Open Review | open route | `OBSERVATION_FAILURE_REVIEW_OPENED` | item id, new key, derived reason code | DB open function |
| No review case, classification `MATCHED` | None | none | none | none | DB would reject |
| No review case, classification `WITHIN_TOLERANCE` | None | none | none | none | DB would reject |
| No review case, classification `REVIEW_REQUIRED` | Do not assume | none by default | none | none | DB currently rejects |
| `OPEN` | Start Review | transition route | `MANUAL_REVIEW_STARTED` | case id, version, `IN_REVIEW`, new key, derived reason code | DB transition function |
| `OPEN` | Resolve | transition route | `REVIEW_ASSESSMENT_COMPLETED` | case id, version, `RESOLVED`, new key, derived reason code | DB transition function |
| `OPEN` | Ignore | transition route | `NO_FURTHER_REVIEW_REQUIRED` | case id, version, `IGNORED`, new key, derived reason code | DB transition function |
| `IN_REVIEW` | Resolve | transition route | `REVIEW_ASSESSMENT_COMPLETED` | case id, version, `RESOLVED`, new key, derived reason code | DB transition function |
| `IN_REVIEW` | Ignore | transition route | `NO_FURTHER_REVIEW_REQUIRED` | case id, version, `IGNORED`, new key, derived reason code | DB transition function |
| `RESOLVED` | None | none | none | none | terminal |
| `IGNORED` | None | none | none | none | terminal |

The UI should hide impossible actions for clarity, but hidden buttons are not a security boundary.

## 20. Recommended UI Mutation Path

`ADMIN_REVIEW_UI_MUTATION_PATH=API_ROUTE`

Recommendation: add a client action panel that calls the existing same-origin JSON POST API routes.

Rationale:

- The existing routes are already the runtime-verified mutation boundary.
- Reusing routes preserves same-origin checks, bounded JSON parsing, DTO allowlist rejection, no-store response, and public-safe error mapping.
- Server actions would duplicate or bypass the route-level request contract unless a second boundary is created.
- Browser Supabase access remains unnecessary and forbidden.
- Client UI can handle pending state, double-submit protection, exact retry, and detail refresh while keeping the DB/server command as the final authority.
- The current read detail page can remain server-rendered and pass only public-safe fields to a small client action panel.

## 21. Submit / Retry / Revalidation UX

- Use the detail read `reviewCase.version` as `expectedVersion`.
- Disable action controls while a submit is pending.
- Treat `created=false` as success for exact replay.
- On success, refetch or refresh the detail route so the review case and timeline reflect the latest DB state.
- On version conflict, refetch detail and require explicit user confirmation before another command.
- On already exists or terminal errors, refetch detail and remove action controls if the refreshed state is terminal or no longer eligible.
- On network timeout, retry only the exact same request with the same key.
- If the user changes action, target status, or item classification context, generate a new key.

## 22. Confirmation And Terminal-State UX

- Start Review can be single-submit or lightweight confirmation.
- Resolve should require explicit confirmation.
- Ignore should require explicit confirmation.
- Confirmation text should show the action and target status.
- Terminal actions should explain that reopen is not implemented.
- The UI must not imply that `RESOLVED` means financial correction, ledger posting, external balance recovery, or provider data repair.
- `RESOLVED` and `IGNORED` are terminal states in the current scope.
- The current scope does not support reopen, terminal-state cancellation, state rollback, ledger correction, balance correction, observation overwrite, reconciliation replay, financial posting, or automatic remediation.
- No free-text note is stored by the current write contract, so the UI must not present a note box unless a future DB/API contract adds storage.

## 23. Side-Effect Boundary

Successful review commands may change only:

- `private.reconciliation_review_cases`
- `private.reconciliation_review_case_events`

Successful review commands must not change:

- reconciliation runs
- reconciliation items
- reconciliation binding observations
- external balance observations
- external transaction observations
- observer checkpoints
- ledger accounts
- ledger journals
- ledger entries

## 24. Security Boundary

- ADMIN plus AAL2 is required at page, server command, and public RPC boundaries.
- Actor is DB-derived from `auth.uid()`.
- No caller-supplied actor/profile/admin/AAL field is accepted.
- No production service-role client is used.
- No private table is exposed to the browser.
- No browser Supabase private table access is used.
- No raw DB row is returned directly by the HTTP routes.
- No raw DB error should be shown to the user.
- Idempotency keys must be non-secret and not logged as user-visible output.

## 25. Explicitly Deferred Scope

- Ledger correction
- Balance correction
- Observation overwrite
- Reconciliation rerun
- Transaction posting
- Provider network call
- Wallet signing
- Automatic remediation
- Notification
- Reopen
- Attachment
- Free-text note persistence
- External ticket integration
- New DB migration
- New write endpoint

## 26. Gaps And Required Decisions

| Gap | Current finding | Classification |
| --- | --- | --- |
| Semantic reason-code catalog | Defined as v1 in this contract. | `RESOLVED` |
| UI idempotency key generator/helper | No review-specific helper exists. Existing admin pages often use generated command ids, but no shared review key helper exists. | `CAN_BE_DECIDED_DURING_UI_IMPLEMENTATION` |
| API route vs server action convention | Existing review write routes are canonical and runtime-verified; 13B should use them. | `RESOLVED` |
| Success notification pattern | JSON action UI pattern is not yet present for this page. | `CAN_BE_DECIDED_DURING_UI_IMPLEMENTATION` |
| AAL2 challenge return URL | Current admin pages redirect to MFA routes without detail return-url preservation. | `CAN_BE_DECIDED_DURING_UI_IMPLEMENTATION` |
| Confirmation dialog/component convention | No dedicated review confirmation component exists. | `CAN_BE_DECIDED_DURING_UI_IMPLEMENTATION` |
| Client component location and revalidation | Not yet implemented. | `CAN_BE_DECIDED_DURING_UI_IMPLEMENTATION` |

## 27. Recommended Implementation Sequence

Before 13B:

1. No additional DB, RPC, server command, or API decision is required by this contract.

13B:

1. Add a small client action panel to the admin reconciliation detail page.
2. Use existing POST API routes as the only mutation path.
3. Add one central v1 reason-code catalog/helper for UI action derivation.
4. Generate per-submit idempotency keys client-side or in a small shared helper.
5. Implement pending, retry, conflict refresh, and terminal-state removal.

13C:

1. Add UI runtime coverage for action visibility, open, transition, exact replay, stale version, terminal state, same-origin/API route safety, and side-effect zero.

13D:

1. Branch closeout and PR readiness report.

## 28. Changed Files

Created or modified in this task:

- `docs/09-governance/NEW_P5_T02_13A_ADMIN_RECONCILIATION_REVIEW_ACTIONS_CONTRACT.md`

No source, Supabase, package, script, generated type, push, PR, merge, rebase, reset, or worktree creation was performed while preparing this contract. The follow-up commit task stages and commits only this contract document.

## 29. Secret Scan

Scope:

- This contract document
- Current working tree diff

Final verification result:

- Actual credential or session material findings: 0
- Local environment file contents read or output: 0

## 30. Final Status

`FINAL_STATUS=PASS_ADMIN_RECONCILIATION_REVIEW_ACTIONS_CONTRACT_READY`
