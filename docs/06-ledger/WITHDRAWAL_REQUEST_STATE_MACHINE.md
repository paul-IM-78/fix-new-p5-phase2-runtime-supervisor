# Withdrawal Request State Machine

NEW-P3-T04 adds a local manual withdrawal request state machine for managed
wallet ledger validation. It is not a blockchain payout system.

## Boundary

The workflow supports:

- User withdrawal request creation.
- User cancellation while the request is still `REQUESTED`.
- AAL2 administrator reservation.
- AAL2 administrator approval.
- AAL2 administrator cancellation from `REQUESTED`, `RESERVED`, or `APPROVED`.
- User and administrator read RPCs.
- Immutable command audit events.

The workflow does not support withdrawal addresses, wallet addresses,
transaction signatures, transaction IDs, block confirmations, chain scanners,
webhooks, actual payout settlement, custody reduction, partial approval,
partial cancellation, service-role application clients, mainnet, or production
connectivity.

## States

Only four states exist:

```text
REQUESTED
RESERVED
APPROVED
CANCELED
```

Allowed transitions:

```text
REQUESTED -> RESERVED
REQUESTED -> CANCELED
RESERVED -> APPROVED
RESERVED -> CANCELED
APPROVED -> CANCELED
```

`CANCELED` is terminal. The state trigger blocks same-state row updates,
backward transitions, core field mutation, and journal, actor, timestamp, or
canceled-from rewrites after those fields are set.

## Posting Rules

User request creation validates current Available Atomic Units and creates a
request plus audit event in the same transaction. It posts no journal.

Reservation:

```text
DEBIT  USER_AVAILABLE
CREDIT USER_PENDING_WITHDRAWAL
```

Approval:

```text
DEBIT  USER_PENDING_WITHDRAWAL
CREDIT SYSTEM_WITHDRAWAL_CLEARING
```

Approval is not settlement. `SYSTEM_CUSTODY` is not debited in this phase.
Future settlement must be modeled separately:

```text
DEBIT  SYSTEM_WITHDRAWAL_CLEARING
CREDIT SYSTEM_CUSTODY
```

Admin cancellation from `REQUESTED` posts no journal.

Admin cancellation from `RESERVED`:

```text
DEBIT  USER_PENDING_WITHDRAWAL
CREDIT USER_AVAILABLE
```

Admin cancellation from `APPROVED`:

```text
DEBIT  SYSTEM_WITHDRAWAL_CLEARING
CREDIT USER_AVAILABLE
```

## Concurrency

Commands require caller-supplied UUID command IDs and expected request or
entity versions. Exact replay returns the existing outcome without duplicate
requests, postings, or audit rows. Reusing a command ID with a different
actor, action, target, units, version, or reason is rejected as a conflict.

The command functions acquire a withdrawal-specific transaction advisory lock
before reading or mutating withdrawal state. Ledger postings continue to use
the existing private posting primitive and ledger locking.

## Invariants

`private.validate_withdrawal_request_invariants()` runs as a deferred
constraint trigger. It verifies request ownership, status-specific nullable
field shape, related journal asset, journal reference type and ID, journal
units, journal type, initiator, expected account purposes, and the absence of
custody entries on approval.

The open-request unique index allows only one `REQUESTED`, `RESERVED`, or
`APPROVED` request for the same wallet and asset. `CANCELED` rows permit a new
request.

## Audit

`private.withdrawal_command_audit_events` records append-only command events
with APPLIED or NOOP outcomes. Direct browser access to the private withdrawal
tables is blocked. Read RPCs expose safe status and text-unit fields only and
do not expose request_data, cookies, tokens, credentials, addresses,
transaction identifiers, or settlement proof.

## Public RPC Naming

The public write RPC names use `*_user_payout_request` rather than generic
`withdraw`, `manual`, or `posting` names. This preserves the Phase 3 gate that
blocks generic public financial write RPC naming while still providing a
user-facing Withdrawal Requests workflow.
