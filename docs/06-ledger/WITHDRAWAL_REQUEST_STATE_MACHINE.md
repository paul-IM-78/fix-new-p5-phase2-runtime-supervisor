# Withdrawal Request State Machine

NEW-P3-T04 adds a local manual withdrawal request state machine for managed
wallet ledger validation. It is not a blockchain payout system.

## Boundary

The workflow supports:

- User withdrawal request creation.
- User cancellation while the request is still `REQUESTED`.
- AAL2 administrator reservation.
- AAL2 administrator approval.
- AAL2 administrator execution start from `APPROVED` or `FAILED`.
- AAL2 administrator execution failure from `EXECUTING`.
- AAL2 administrator internal settlement from `EXECUTING`.
- AAL2 administrator cancellation from `REQUESTED`, `RESERVED`, `APPROVED`, or `FAILED`.
- User and administrator read RPCs.
- Immutable command audit events.

The workflow does not support withdrawal addresses, wallet addresses,
transaction signatures, transaction IDs, block confirmations, chain scanners,
webhooks, automatic payout fulfillment, partial approval, partial settlement,
partial cancellation, service-role application clients, mainnet, or production
connectivity.

## States

States:

```text
REQUESTED
RESERVED
APPROVED
EXECUTING
FAILED
SETTLED
CANCELED
```

Allowed transitions:

```text
REQUESTED -> RESERVED
REQUESTED -> CANCELED
RESERVED -> APPROVED
RESERVED -> CANCELED
APPROVED -> EXECUTING
APPROVED -> CANCELED
EXECUTING -> FAILED
EXECUTING -> SETTLED
FAILED -> EXECUTING
FAILED -> CANCELED
```

`SETTLED` and `CANCELED` are terminal. `EXECUTING` cannot be canceled directly.
The state trigger blocks same-state row updates, backward transitions, core
field mutation, and journal, actor, timestamp, or canceled-from rewrites after
those fields are set.

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

Approval is not settlement. `SYSTEM_CUSTODY` is not debited at approval.

Internal settlement from `EXECUTING`:

```text
DEBIT  SYSTEM_WITHDRAWAL_CLEARING
CREDIT SYSTEM_CUSTODY
```

Execution start and execution failure post no ledger journal. Settlement
requires enough `SYSTEM_CUSTODY` units and enough outstanding
`SYSTEM_WITHDRAWAL_CLEARING` exposure for the requested units.

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

Admin cancellation from `FAILED` uses the same clearing-to-available reversal.

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

The open-request unique index allows only one `REQUESTED`, `RESERVED`,
`APPROVED`, `EXECUTING`, or `FAILED` request for the same wallet and asset.
`SETTLED` and `CANCELED` rows permit a new request.

## Audit

`private.withdrawal_command_audit_events` records append-only command events
with APPLIED or NOOP outcomes. Direct browser access to the private withdrawal
tables is blocked. Read RPCs expose safe status and text-unit fields only and
do not expose request_data, cookies, tokens, credentials, addresses,
transaction identifiers, or settlement proof.

`private.withdrawal_execution_attempts` records immutable execution attempts.
It stores only a lowercase SHA-256 digest of the operator-supplied evidence
reference. Raw evidence, provider responses, scanner payloads, destination
addresses, and full digest values are not exposed through read RPCs.

## Public RPC Naming

The public write RPC names use `*_user_payout_request` rather than generic
`withdraw`, `manual`, or `posting` names. This preserves the Phase 3 gate that
blocks generic public financial write RPC naming while still providing a
user-facing Withdrawal Requests workflow.
