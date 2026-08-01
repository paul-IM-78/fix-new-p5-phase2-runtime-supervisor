# NEW-P5-T02-13B Admin Reconciliation Review Action UI Report

## 1. Status

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t02-admin-reconciliation-review-actions`
- Start HEAD: `70ccfb28ccb7c4c74d8be8c977b9baa44bbf7b54`
- Final HEAD: `70ccfb28ccb7c4c74d8be8c977b9baa44bbf7b54`
- 13A baseline commit: `70ccfb28ccb7c4c74d8be8c977b9baa44bbf7b54`
- 13A baseline contract: `docs/09-governance/NEW_P5_T02_13A_ADMIN_RECONCILIATION_REVIEW_ACTIONS_CONTRACT.md`
- 13A baseline status: `FINAL_STATUS=PASS_ADMIN_RECONCILIATION_REVIEW_ACTIONS_CONTRACT_READY`
- Final status: `PASS_ADMIN_RECONCILIATION_REVIEW_ACTION_UI_READY`

## 2. Changed Files

- `src/lib/reconciliation/review-actions.ts`
- `src/app/admin/reconciliation/items/[reconciliationItemId]/_review-actions.tsx`
- `src/app/admin/reconciliation/items/[reconciliationItemId]/page.tsx`
- `docs/09-governance/NEW_P5_T02_13B_ADMIN_RECONCILIATION_REVIEW_ACTION_UI_REPORT.md`

No DB migration, public RPC, server command, POST API route, generated type, package, lockfile, or runtime harness file was changed.

## 3. Component Boundary

- The reconciliation detail page remains a Server Component with `dynamic = "force-dynamic"`, `revalidate = 0`, `getCurrentAdminAccess()`, ADMIN+AAL2 redirects, and server-side detail read command usage.
- The new review action area is isolated in a route-local Client Component at `_review-actions.tsx`.
- Server props passed to the Client Component are public-safe and serializable: reconciliation item id, item classification, and review case id/status/version when a case exists.
- Browser Supabase usage: 0.
- Service-role usage: 0.
- Private table direct browser access: 0.
- Server Action added: 0.

## 4. Existing API Route Reuse

The UI uses the existing same-origin JSON POST routes only:

- `POST /api/v1/admin/reconciliation/reviews/open`
- `POST /api/v1/admin/reconciliation/reviews/transition`

Request handling:

- Relative same-origin URLs only.
- `method: "POST"`.
- `Content-Type: application/json`.
- `Accept: application/json`.
- `credentials: "same-origin"`.
- No caller actor, profile, role, AAL, session, cookie, or token fields are sent.
- No raw cookie or header value is handled manually.

## 5. Reason Code Catalog v1

Central helper: `src/lib/reconciliation/review-actions.ts`

- `RECONCILIATION_REVIEW_REASON_CODE_CATALOG_VERSION = "V1"`
- `RECONCILIATION_REVIEW_REASON_CODE_INPUT_MODE = "SYSTEM_DERIVED"`
- Free-text reason code input: disallowed.
- User-selectable reason code selector: disallowed.

Catalog:

| Action source | Reason code |
| --- | --- |
| Open review for `MISMATCH` | `BALANCE_MISMATCH_REVIEW_OPENED` |
| Open review for `OBSERVATION_FAILED` | `OBSERVATION_FAILURE_REVIEW_OPENED` |
| Transition to `IN_REVIEW` | `MANUAL_REVIEW_STARTED` |
| Transition to `RESOLVED` | `REVIEW_ASSESSMENT_COMPLETED` |
| Transition to `IGNORED` | `NO_FURTHER_REVIEW_REQUIRED` |

The action panel does not render these reason code values as visible action metadata, URL query data, or user-editable fields. Existing review event history display is unchanged.

## 6. Idempotency

- Browser key source: `crypto.randomUUID()`.
- One idempotency key is generated per semantic submit.
- Network-uncertain retry reuses the same stored request payload and the same idempotency key.
- A different action or a post-conflict user re-selection generates a fresh key.
- No actor, profile, user, session, or role data is included in the key.
- The key is not rendered, placed in the URL, logged, persisted to localStorage/sessionStorage, or written to cookies.

## 7. Action Eligibility

The helper derives action candidates from detail classification and review case state:

| Detail state | UI action |
| --- | --- |
| No case, `MISMATCH` | Open Review |
| No case, `OBSERVATION_FAILED` | Open Review |
| No case, `MATCHED` | No action surface |
| No case, `WITHIN_TOLERANCE` | No action surface |
| No case, `REVIEW_REQUIRED` | No action surface by default |
| `OPEN` case | Start Review, Resolve, Ignore |
| `IN_REVIEW` case | Resolve, Ignore |
| `RESOLVED` case | Terminal notice only |
| `IGNORED` case | Terminal notice only |
| Unexpected case status | Public-safe unavailable notice |

Button visibility is not treated as a security boundary. Existing server command and DB RPC validation remain final.

## 8. UX Contract

- Open Review: single-submit, non-terminal.
- Start Review: single-submit, non-terminal.
- Resolve: inline confirmation required.
- Ignore: inline confirmation required.
- Pending state disables all review action buttons.
- Only one action can be pending at a time.
- Success treats both `created=true` and exact replay `created=false` as successful.
- Success calls `router.refresh()` to reload the server-rendered detail and timeline.
- Stale version and other refresh-worthy 404/409 errors call `router.refresh()` and require the user to choose again.
- Raw response body, raw DB error, SQLSTATE, stack trace, and unexpected object fields are not rendered.

## 9. Terminal State Boundary

`RESOLVED` and `IGNORED` are terminal in the current scope.

The UI does not support:

- Reopen
- Terminal-state cancellation
- State rollback
- Ledger correction
- Balance correction
- Observation overwrite
- Reconciliation rerun
- Financial posting
- Provider network call
- Wallet signing
- Automatic remediation
- Attachment
- Free-text note
- External ticket integration

Resolve does not mean funds were recovered, ledger data was corrected, observations were overwritten, reconciliation was rerun, or provider-side action was completed.

Ignore does not mean the item is correct, problem-free, or that the original reconciliation classification changed.

## 10. Error Mapping

The client reads the existing API envelope:

- Success: `{ ok: true, result }`
- Error: `{ ok: false, error: { code } }`

Public error messages come from `getReconciliationReviewPublicMessage()`, with a local public-safe message for `request_rejected`.

Handled categories:

- `invalid_request`
- `admin_authentication_required`
- `admin_role_required`
- `admin_aal2_required`
- `request_rejected`
- `reconciliation_item_not_found`
- `reconciliation_review_not_found`
- `reconciliation_item_not_reviewable`
- `reconciliation_review_already_exists`
- `reconciliation_review_idempotency_conflict`
- `reconciliation_review_version_conflict`
- `reconciliation_review_terminal`
- `reconciliation_review_transition_invalid`
- `reconciliation_review_state_invalid`
- `reconciliation_review_unavailable`
- Unknown or malformed response shape as generic public-safe failure

No arbitrary sign-in, MFA, or auth URLs are constructed by the action component.

## 11. Accessibility

- Action controls are real `<button type="button">` elements.
- The action region uses `aria-busy` during pending/refresh work.
- Success and neutral messages use polite live regions.
- Error messages use an alert live region.
- Resolve and Ignore use an inline confirmation region with an explicit label.
- Disabled state includes explanatory text while pending.
- Button labels state the action, not only a color or icon.

## 12. Public-Safe Rendering

The action UI does not render:

- Actor profile id
- User id
- Auth uid
- Event id as action UX metadata
- Idempotency key
- Raw error object
- SQLSTATE
- Constraint name
- DB function name
- Stack trace
- Cookie/session/token values
- Private table names
- Service-role information

Existing detail fields and existing review event history remain governed by the prior admin read UI contract.

## 13. Side-Effect Boundary

Successful review actions may change only:

- `private.reconciliation_review_cases`
- `private.reconciliation_review_case_events`

They must not change:

- Reconciliation runs
- Reconciliation items
- Reconciliation binding observations
- External balance observations
- External transaction observations
- Observer checkpoints
- Ledger accounts
- Ledger journals
- Ledger entries

## 14. Existing 12C Runtime Compatibility

`npm run test:reconciliation:admin-ui:local` was not executed in this step.

Expected intentional collision:

- The 12C harness includes read-only assertions that no review action controls are present.
- 13B intentionally adds review action controls to the detail page.
- 13C should update or extend the admin UI runtime harness for action visibility, open, transition, confirmation, conflict refresh, terminal state, public-safe rendering, and side-effect zero.

## 15. Verification

- `git diff --check`: PASS.
- `npm run lint`: PASS, warning 0.
- `npm run build`: PASS.
- `npm run test:reconciliation:review:local`: PASS, `FINAL_STATUS=PASS_P5_T02_RUNTIME_CLOSEOUT_READY`.
- `npm run test:auth:admin-roles:local`: PASS.
- `npm run test:reconciliation:admin-read:local`: PASS, `FINAL_STATUS=PASS_ADMIN_RECONCILIATION_READ_RUNTIME_READY`.
- `npm run test:reconciliation:admin-ui:local`: not run by 13B instruction; expected 12C read-only assertion collision is deferred to 13C.

Runtime note:

- The first review runtime attempt stopped at the clean env precondition because the ignored local `.env.local` file existed.
- Runtime verification was rerun with path-only `.env.local` quarantine and restore.
- `.env.local` contents were not read or output.
- Runtime residue moved: 0.
- `.env.local` restored: true.

## 16. Unchanged Boundaries

Verified unchanged by path diff:

- `supabase/**`: diff 0.
- `src/server/admin/reconciliation-review-commands.ts`: diff 0.
- `src/app/api/v1/admin/reconciliation/reviews/open/route.ts`: diff 0.
- `src/app/api/v1/admin/reconciliation/reviews/transition/route.ts`: diff 0.
- `src/lib/reconciliation/validation.ts`: diff 0.
- `src/lib/reconciliation/public-results.ts`: diff 0.
- `src/types/database.types.ts`: diff 0.
- `package.json`: diff 0.
- `package-lock.json`: diff 0.
- `scripts/**`: diff 0.

## 17. Cleanup

- Port 3000 listener: 0.
- Port 3010 listener: 0.
- Port 55721 listener: 0.
- Port 55722 listener: 0.
- Port 55723 listener: 0.
- Port 55724 listener: 0.
- Current project Supabase container residue: 0.
- Fixture residue: runtime harness cleanup PASS.
- Quarantine residue: 0.
- `.env.local` content read/output: 0.
- `.env.local` restored after runtime verification: true.

## 18. Secret Scan

Scope:

- New/modified review action UI files
- New review action helper
- This 13B report
- Current working tree diff

Final verification result:

- Secret scan: PASS.
- Actual credential or session material findings: 0.
- Runtime UUID idempotency values printed in report/log output: 0.
- `.env.local` contents read or output: 0.

## 19. Git State

- Staging: empty during implementation.
- Commit: not performed.
- Push: not performed.
- PR: not performed.

## 20. Final Status

`PASS_ADMIN_RECONCILIATION_REVIEW_ACTION_UI_READY`
