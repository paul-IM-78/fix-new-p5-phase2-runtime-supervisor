# NEW-P3-T04 Withdrawal State Machine Report

## Scope

- Starting branch: `feat/new-p3-deposit-state-machine`
- Starting commit: `45e131865504f3b28af97337d405af23d80b44cc`
- Working branch: `feat/new-p3-withdrawal-state-machine`
- Migration: `supabase/migrations/20260720174042_init_withdrawal_state_machine.sql`

## Implemented

- `private.withdrawal_requests`
- `private.withdrawal_command_audit_events`
- Request states: `REQUESTED`, `RESERVED`, `APPROVED`, `CANCELED`
- One open request per wallet and asset for non-terminal states
- Transition trigger: `private.validate_withdrawal_request_transition()`
- Deferred invariant trigger: `private.validate_withdrawal_request_invariants()`
- Immutable audit trigger
- Withdrawal transaction advisory lock
- User request and REQUESTED cancel commands
- AAL2 admin reserve, approve, and cancel commands
- User, admin, and admin-audit read RPCs
- Server command wrappers, same-origin API routes, and protected pages
- Local E2E script: `npm run test:ledger:withdrawals:local`

## Ledger Behavior

- Request creation prechecks Available Atomic Units and posts no journal.
- Reservation posts debit `USER_AVAILABLE` and credit `USER_PENDING_WITHDRAWAL`.
- Approval posts debit `USER_PENDING_WITHDRAWAL` and credit `SYSTEM_WITHDRAWAL_CLEARING`.
- Approval does not debit `SYSTEM_CUSTODY` and is not actual external settlement.
- User cancellation is limited to `REQUESTED`.
- Admin cancellation supports `REQUESTED`, `RESERVED`, and `APPROVED`.
- RESERVED cancellation restores pending withdrawal to available units.
- APPROVED cancellation restores withdrawal clearing to available units.

## Security Boundary

- All mutation RPCs are `SECURITY DEFINER`.
- Function `search_path` is pinned to `''`.
- Execute grants are limited to `authenticated`.
- Private withdrawal tables are not browser-readable or browser-writable.
- Application code uses publishable Supabase SSR clients only.
- No Service Role application client was added.
- No remote Supabase, mainnet, private key, mnemonic, client signing, address collection, transaction ID, scanner, webhook, or real payout settlement was added.

## Validation Result

Completed local validation:

- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS
- `npm run db:test:local`: PASS
- `npm run db:types:local`: PASS
- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- `npm run test:auth:admin-roles:local`: PASS
- `npm run test:domain:admin-lifecycle:local`: PASS
- `npm run test:domain:wallet-status:local`: PASS after clean DB reset
- `npm run test:phase2:closeout:local`: PASS after extended timeout
- `npm run test:ledger:core:local`: PASS
- `npm run test:ledger:opening-corrections:local`: PASS
- `npm run test:ledger:deposits:local`: PASS with `APP_ORIGIN=http://localhost:3000`
- `npm run test:ledger:withdrawals:local`: PASS with `APP_ORIGIN=http://localhost:3000`
- Final DB reset, lint, pgTAP, generated type, Next.js lint, Next.js build, and smoke checks: PASS

The deposit E2E rejected `APP_ORIGIN=http://127.0.0.1:3000` because same-origin validation compares the request origin to the Next.js request URL origin. Re-running the existing script with `APP_ORIGIN=http://localhost:3000` passed without modifying the existing deposit test or application source.

## Known Notes

- The public write RPCs use `*_user_payout_request` names to preserve the Phase 3 gate against generic public financial write naming.
- Deterministic pgTAP UUIDs and QA units are test fixtures only.
- E2E credentials, command IDs, TOTP material, JWTs, cookies, local anon keys, and local service-role keys must not be printed or committed.
- Existing moderate npm advisories remain unchanged; `npm audit fix` was not run.

## Task Result

PASS. The withdrawal request state machine, ledger posting commands, AAL2 admin command boundary, immutable audit, protected pages, local E2E coverage, DB reset, pgTAP, lint, build, and smoke validations completed without staging, commit, push, production, remote Supabase, service-role application client, blockchain, private key, mnemonic, or package-lock changes.
