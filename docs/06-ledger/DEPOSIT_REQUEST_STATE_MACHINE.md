# Deposit Request State Machine

## Scope

This phase adds a local manual deposit request state machine backed by the
private double-entry ledger.

It supports:

- ACTIVE user create deposit request.
- ACTIVE user cancel own REQUESTED deposit request.
- ACTIVE ADMIN AAL2 confirm REQUESTED deposit request.
- ACTIVE ADMIN AAL2 cancel REQUESTED deposit request, including inactive targets.
- Immutable deposit command audit.
- User and admin read RPCs for local operations.

It does not add real asset transfer, blockchain deposit address generation,
transaction ID storage, signature validation, webhook processing, on-chain
confirmation, service-role application access, remote Supabase, production,
mainnet, private keys, mnemonics, or client signing.

## Tables

`private.deposit_requests` stores one local request row per command outcome.
Rows are never hard-deleted. Status is constrained to:

- `REQUESTED`
- `CONFIRMED`
- `CANCELED`

The row references the request journal and, after terminal transition, exactly
one confirmation or cancellation journal.

`private.deposit_command_audit_events` is append-only. It records command ID,
action, outcome, actor, target, wallet, asset, request, resulting journal,
normalized reason, normalized request data, previous status, resulting status,
units, and occurrence time.

Browser roles have no direct table privileges for either table.

## Posting Rules

Create request posts two lines:

- Debit `SYSTEM_DEPOSIT_CLEARING`.
- Credit `USER_PENDING_DEPOSIT`.

Confirm request posts four lines:

- Debit `SYSTEM_CUSTODY`.
- Credit `SYSTEM_DEPOSIT_CLEARING`.
- Debit `USER_PENDING_DEPOSIT`.
- Credit `USER_AVAILABLE`.

Cancel request posts two lines:

- Debit `USER_PENDING_DEPOSIT`.
- Credit `SYSTEM_DEPOSIT_CLEARING`.

All postings go through `private.post_ledger_journal(...)` in the same
transaction as the state transition and audit event. No split journal/audit
commit path is introduced.

## Command RPCs

The public command RPC names intentionally avoid generic public financial
write names:

- `public.create_user_funding_request(...)`
- `public.cancel_current_user_funding_request(...)`
- `public.confirm_user_funding_request(...)`
- `public.admin_cancel_user_funding_request(...)`

The user-facing routes and documentation call the workflow Deposit Requests,
but the narrow public write function names preserve the Phase 3 ledger gate
that blocks broad `deposit`, `manual`, `posting`, `withdraw`, `stake`, and
`reward` public write RPCs.

Read RPCs are list-only:

- `public.list_current_user_deposit_requests(...)`
- `public.list_admin_deposit_requests(...)`
- `public.list_deposit_command_audit_events(...)`

All RPCs are `SECURITY DEFINER`, use empty `search_path`, and grant execute
only to `authenticated`.

## Authorization

User create requires:

- Authenticated ACTIVE profile.
- Caller-owned ACTIVE wallet account.
- ACTIVE supported asset.
- Matching wallet expected version.
- Matching asset expected version.
- Positive atomic units text.
- Command ID UUID.

User cancel requires:

- Authenticated ACTIVE profile.
- Caller-owned REQUESTED deposit request.
- Matching request expected version.
- Command ID UUID.

Admin confirm requires:

- Authenticated ACTIVE ADMIN.
- Current AAL2.
- REQUESTED deposit request.
- ACTIVE target profile.
- ACTIVE target wallet.
- ACTIVE asset.
- Matching request expected version.
- Command ID UUID.
- Normalized reason.

Admin cancel requires:

- Authenticated ACTIVE ADMIN.
- Current AAL2.
- REQUESTED deposit request.
- Matching request expected version.
- Command ID UUID.
- Normalized reason.

Admin cancel can run when the target profile, wallet, or asset has since
become inactive, because it only reverses pending-deposit and clearing
buckets.

## Idempotency And Locking

Every command uses a caller-supplied UUID command ID.

The command lock key is:

```text
staking-wallet-web:deposit-command:v1
```

Replay with the same actor, action, normalized request data, and reason
returns the existing event and journal. Reusing a command ID with different
input returns `DEPOSIT_COMMAND_ID_CONFLICT` and creates no new journal or audit
event.

Expected versions protect wallet, asset, and request state transitions.
Replay uses the original command input, not the latest row version.

## Web Boundary

User route:

```text
GET /deposits
POST /api/v1/deposits/create
POST /api/v1/deposits/cancel
```

Admin route:

```text
GET /admin/deposits
POST /api/v1/admin/deposits/confirm
POST /api/v1/admin/deposits/cancel
```

POST routes require same-origin form submissions and redirect with safe public
result or error codes only. They do not expose UUIDs, command IDs, amounts,
reasons, request data, cookies, tokens, or stack traces.

The pages do not show a deposit address or transaction ID field. They do not
accept blockchain proof, signature, RPC URL, private key, mnemonic, or wallet
adapter data.

## Remaining Work

The following remain unimplemented:

- Real deposit settlement.
- Deposit address allocation.
- Transaction ID verification.
- Webhooks or chain indexers.
- Withdrawal reservation and fulfillment.
- Staking lock.
- Reward posting.
- Automatic admin confirmation.
- Service-role application access.
- Remote Supabase, production, or mainnet connectivity.
