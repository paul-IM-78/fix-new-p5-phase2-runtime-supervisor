# NEW-P3-T05 Withdrawal Execution Settlement Report

## Scope

- Starting branch: `feat/new-p3-withdrawal-state-machine`
- Starting commit: `f260e406e417516bb622677e79c2c328897dcc30`
- Working branch: `feat/new-p3-withdrawal-execution-settlement`
- Migration: `supabase/migrations/20260720194355_init_withdrawal_execution_settlement.sql`

## Implemented

- Request states extended with `EXECUTING`, `FAILED`, and `SETTLED`.
- `private.withdrawal_execution_attempts`
- Execution attempt transition and immutability triggers.
- Digest-only evidence reference helper using `extensions.digest()`.
- AAL2 admin execution commands:
  - `public.start_user_payout_execution`
  - `public.fail_user_payout_execution`
  - `public.settle_user_payout_execution`
- AAL2 admin execution attempt read RPC:
  - `public.list_withdrawal_execution_attempts`
- FAILED-state admin cancellation extension in `public.admin_cancel_user_payout_request`.
- Server command wrappers, same-origin API routes, protected admin UI controls, user status display, generated database types, and local E2E script.

## Ledger Behavior

- Start execution posts no ledger journal.
- Fail execution posts no ledger journal.
- Settlement posts journal type `ADMIN_WITHDRAWAL_SETTLED`.
- Settlement reference type is `WITHDRAWAL_EXECUTION_ATTEMPT`.
- Settlement debits `SYSTEM_WITHDRAWAL_CLEARING`.
- Settlement credits `SYSTEM_CUSTODY`.
- FAILED cancellation debits `SYSTEM_WITHDRAWAL_CLEARING` and credits `USER_AVAILABLE`.
- Partial settlement, partial failure, and partial cancellation are not implemented.

## Evidence Boundary

- Evidence reference input must match `^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$`.
- No trim delta, whitespace, or control characters are accepted.
- The private schema stores only a lowercase 64-character SHA-256 digest.
- Raw evidence, destination addresses, transaction IDs, transaction hashes, signatures, provider responses, webhooks, scanner payloads, cookies, tokens, secrets, and filesystem paths are not stored or returned by read RPCs.

## Security Boundary

- Mutation RPCs are `SECURITY DEFINER`.
- Function `search_path` is pinned to `''`.
- Execute grants are limited to `authenticated`.
- AAL2 ADMIN is enforced inside PostgreSQL.
- Private withdrawal execution attempts are not browser-readable or browser-writable.
- Application code uses publishable Supabase SSR clients only.
- No Service Role application client was added.
- No remote Supabase, mainnet, private key, mnemonic, client signing, on-chain verification, or production path was added.

## Validation Result

Completed local validation:

- `npm run db:reset:local`: PASS, including the new withdrawal execution settlement migration
- `npm run db:lint:local`: PASS, error 0, warning 0 after a clean reset
- `npm run db:test:local`: PASS, 11 files, 684 tests
- `npm run db:types:local`: PASS
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- `npm run test:ledger:withdrawal-execution:local`: PASS

Existing local E2E regression validation:

- `npm run test:auth:routes:local`: PASS
- `npm run test:auth:admin-mfa:local`: PASS
- `npm run test:auth:admin-roles:local`: PASS
- `npm run test:domain:admin-lifecycle:local`: PASS
- `npm run test:domain:wallet-status:local`: PASS
- `npm run test:phase2:closeout:local`: PASS
- `npm run test:ledger:core:local`: PASS
- `npm run test:ledger:opening-corrections:local`: PASS
- `npm run test:ledger:deposits:local`: PASS
- `npm run test:ledger:withdrawals:local`: PASS
- `npm run test:ledger:withdrawal-execution:local`: PASS

Production server smoke:

- `GET /api/v1/health`: PASS, HTTP 200, `status=ok`, `service=staking-wallet-web`, `runtime=node`, `Cache-Control=no-store`
- `GET /api/v1/readiness/config`: PASS, HTTP 200, `Cache-Control=no-store`
- `GET /`: PASS, HTTP 200
- Anonymous `GET /dashboard`, `/account`, `/deposits`, `/withdrawals`, `/admin`, `/admin/deposits`, and `/admin/withdrawals`: PASS, HTTP 307 to sign-in
- Response body and header scan: PASS, no raw secret, token, evidence, address, transaction identifier, provider payload, webhook payload, scanner payload, stack trace, or filesystem path exposure

Final data and security checks:

- Final DB reset after E2E: PASS
- QA residual data count: PASS, auth users 0, withdrawal requests 0, withdrawal audit rows 0, execution attempts 0, ledger journals 0, ledger entries 0
- Package lock mutation: 0
- Actual service-role key, database URL, private key, mnemonic, seed phrase, raw evidence, destination address, transaction ID/hash/signature, provider response, webhook payload, scanner payload: 0
- Application Service Role client: 0
- Remote Supabase, mainnet, production, blockchain auto-verification, and client signing integration: 0
- `npm audit --json`: moderate 2, high 0, critical 0; no `npm audit fix` run

## Known Notes

- The new public write RPCs use `*_user_payout_execution` names to preserve the Phase 3 gate against generic public financial write naming.
- The local E2E script is derived from the existing withdrawal E2E helpers and disables unused-variable lint for that file only because copied legacy helper functions remain out of the new execution path.
- Deterministic pgTAP UUIDs and QA reference strings are test fixtures only.
- Local Supabase CLI output may include local development keys; report those values only as `[REDACTED]`.
- Existing moderate npm advisories remain unchanged; `npm audit fix` was not run.
- Local Kong was restarted between isolated E2E runs to avoid local-only readiness drift after repeated database resets.
- DB lint was run after a clean reset and not concurrently with pgTAP, because pgTAP extension installation can create unrelated extension-lint noise during a parallel run.

## Task Result

PASS. No staging, commit, push, PR, remote Supabase, service-role application client, production, mainnet, package-lock mutation, or existing migration rewrite has been performed.
