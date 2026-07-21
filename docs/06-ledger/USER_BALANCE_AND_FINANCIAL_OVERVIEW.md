# User Balance And Financial Overview

## Scope

`/balances` is the Phase 3 user-facing read view for internal managed-wallet
ledger state. It combines existing read-only RPCs and account guards without
adding new database objects.

The page displays one row per asset with existing user ledger activity. It does
not create zero-balance rows for every supported asset.

## Data Sources

- `public.list_current_user_ledger_balances()`
- `public.list_current_user_deposit_requests(p_limit)`
- `public.list_current_user_withdrawal_requests(p_limit)`
- The current user's managed wallet account row
- The centralized account guard

The application uses one server Supabase client for the overview read. Browser
clients, service-role clients, admin RPCs, role lookups, and direct private
ledger table reads are not used by the page.

## Balance Buckets

All unit values are decimal digit strings at application boundaries.

- Available Atomic Units: internal user liability bucket available for future
  financial commands.
- Locked Atomic Units: internal user liability bucket reserved for future
  staking principal.
- Pending Deposit Atomic Units: local manual deposit requests waiting for
  administrator confirmation.
- Pending Withdrawal Atomic Units: local withdrawal requests reserved for
  administrator processing.
- Total Liability Atomic Units: the internal double-entry ledger sum of the
  user buckets for one asset.

For each asset, the server helper validates:

```text
available + locked + pending deposit + pending withdrawal = total liability
```

If a row is malformed or the bucket sum does not match, the helper fails closed
and the page redirects to the existing safe error route.

## Atomic Unit Rules

Valid application unit strings match:

```text
^(0|[1-9][0-9]{0,37})$
```

JavaScript `Number`, `Number()`, `parseInt()`, `parseFloat()`, unary plus,
floating point values, PostgreSQL `money`, locale numeric formatting, and JSON
numeric amount payloads are prohibited for financial units.

`BigInt` is limited to same-asset validation and fixture math. Results are
converted back to decimal strings before return or display.

## Asset Boundary

Assets are displayed independently. The page does not calculate a portfolio
total, cross-asset total, external value, yield estimate, or currency
conversion. `decimals` is displayed as metadata only; it does not convert
atomic units into decimal token units.

## Deposit And Withdrawal State Integration

The page shows recent local deposit and withdrawal request statuses by reading
existing current-user RPCs. It does not expose administrator identifiers,
journal identifiers, execution attempt identifiers, raw evidence, evidence
digests, destination details, provider payloads, or private ledger account IDs.

Deposit statuses:

- `REQUESTED`
- `CONFIRMED`
- `CANCELED`

Withdrawal statuses:

- `REQUESTED`
- `RESERVED`
- `APPROVED`
- `EXECUTING`
- `FAILED`
- `SETTLED`
- `CANCELED`

`SETTLED` means internal accounting settlement only. It does not prove external
asset movement.

## Wallet And Account Boundary

Only ACTIVE profiles can read `/balances`. Anonymous users are redirected to
sign in with `next=/balances`; inactive profiles are redirected to the
account-unavailable route.

Managed wallet states are readable while the profile is ACTIVE:

- `ACTIVE`
- `FROZEN`
- `CLOSED`

FROZEN and CLOSED wallet states remain read-only historical views. New
financial mutations are governed by their own command state machines.

## Explicit Non-Goals

- External asset holding proof
- Destination address display
- Transaction identifier display
- Explorer links
- Provider confirmation
- Raw evidence display
- Custody proof claim
- Fiat valuation
- APY or reward projection
- Staking lock or reward accounting
- Service-role application access
- Remote Supabase or mainnet connectivity
