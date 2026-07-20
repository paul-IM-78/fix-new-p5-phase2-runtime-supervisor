# Withdrawal Execution And Settlement

NEW-P3-T05 adds a local withdrawal execution boundary after administrator
approval. It is an internal accounting workflow, not blockchain payout
automation.

## Boundary

Supported:

- AAL2 admin start from `APPROVED` or `FAILED`.
- AAL2 admin failure from `EXECUTING`.
- AAL2 admin settlement from `EXECUTING`.
- AAL2 admin cancel from `FAILED`.
- Immutable execution attempt history.
- Safe admin read RPCs without raw evidence or full evidence digests.

Not supported:

- Destination address collection.
- Provider response storage.
- Blockchain transaction IDs, hashes, or signatures.
- Webhooks or scanner verification.
- Automatic payout fulfillment.
- Partial settlement, partial failure, or partial cancellation.
- Mainnet, remote Supabase, or production connectivity.

## Evidence Reference

Operators provide an external evidence reference only when starting an
execution attempt. The application validates:

```text
^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$
```

The raw reference must be 8 to 200 characters, have no trim delta, and contain
no whitespace or control characters. PostgreSQL stores only a lowercase
64-character SHA-256 digest produced with `extensions.digest()`. Raw reference
values are not stored in request rows, audit rows, journals, redirects, or read
RPCs.

## State Transitions

```text
APPROVED -> EXECUTING
FAILED   -> EXECUTING
EXECUTING -> FAILED
EXECUTING -> SETTLED
FAILED -> CANCELED
```

`EXECUTING` cannot be canceled directly. `SETTLED` is terminal. `FAILED` can be
retried with a new evidence reference or canceled by an AAL2 administrator.

## Posting Rules

Start execution:

- Creates an immutable `private.withdrawal_execution_attempts` row.
- Updates the request to `EXECUTING`.
- Writes an append-only command audit event.
- Posts no ledger journal.

Fail execution:

- Updates the latest `STARTED` attempt to `FAILED`.
- Updates the request to `FAILED`.
- Writes an append-only command audit event.
- Posts no ledger journal.

Settle execution:

```text
DEBIT  SYSTEM_WITHDRAWAL_CLEARING
CREDIT SYSTEM_CUSTODY
```

Settlement uses journal type `ADMIN_WITHDRAWAL_SETTLED`, initiator `ADMIN`,
reference type `WITHDRAWAL_EXECUTION_ATTEMPT`, and reference id equal to the
attempt id. The command requires custody units and outstanding withdrawal
clearing exposure to be at least the requested units.

Failed cancellation:

```text
DEBIT  SYSTEM_WITHDRAWAL_CLEARING
CREDIT USER_AVAILABLE
```

This restores the user's available local liability after a failed execution
attempt without changing custody.

## Invariants

- One active `STARTED` execution attempt per withdrawal request.
- Evidence digest uniqueness across attempts.
- Attempt numbers are sequential per request.
- Attempts can transition only `STARTED -> FAILED` or `STARTED -> SETTLED`.
- Terminal attempts cannot be rewritten.
- Attempt delete and truncate are blocked by trigger.
- Request `latest_execution_attempt_id` must match state-specific attempt
  shape for `EXECUTING`, `FAILED`, `SETTLED`, and failed cancellation.
- Settlement journal shape is checked by deferred database trigger.

## Read Boundary

User reads expose request status, latest execution status, attempt number, and
completion timestamp. Admin reads additionally expose safe attempt metadata,
failure code, failure reason, and settlement journal id. Neither read path
exposes raw evidence, full evidence digests, provider payloads, cookies,
tokens, secrets, or filesystem paths.
