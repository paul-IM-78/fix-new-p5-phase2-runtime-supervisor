# Wallet Account Status And User Reads

This document defines the Phase 2 managed wallet account status command and
non-financial user read boundary.

## State Boundary

`public.profiles.account_status` is the application account access state.
`public.wallet_accounts.status` is the managed wallet operational state.

These states are intentionally separate:

- profile status changes do not automatically change wallet status
- wallet status changes do not automatically change profile status
- ACTIVE profiles can read their own wallet row when the wallet is ACTIVE,
  FROZEN, or CLOSED
- inactive profiles cannot read catalog rows or wallet rows through browser RLS

Wallet account status is not a balance, amount, ledger position, staking
position, address, private key, or on-chain state.

## Status Matrix

Allowed transitions:

- `ACTIVE` to `FROZEN`
- `FROZEN` to `ACTIVE`
- `FROZEN` to `CLOSED`

Same-status commands return `NOOP` and do not increment version:

- `ACTIVE` to `ACTIVE`
- `FROZEN` to `FROZEN`
- `CLOSED` to `CLOSED`

Blocked transitions:

- `ACTIVE` to `CLOSED`
- `CLOSED` to `ACTIVE`
- `CLOSED` to `FROZEN`

`FROZEN` to `ACTIVE` also requires the target profile to be `ACTIVE`.
Otherwise the command returns `TARGET_PROFILE_INACTIVE` without mutation or
audit.

`CLOSED` is terminal. Closing a wallet sets `closed_at`; a CLOSED NOOP
preserves the existing `closed_at`.

## Database RPCs

Implemented public RPCs:

- `public.transition_wallet_account_status`
- `public.list_admin_wallet_accounts`
- `public.list_wallet_account_admin_audit_events`

All three functions are `security definer`, use an empty `search_path`, and
recheck ACTIVE ADMIN plus AAL2 in PostgreSQL with
`public.is_current_user_admin_aal2()`.

The browser, metadata, cookies, query strings, and route handlers are not
trusted for final role, AAL, account, or command authorization.

## Command Safety

`public.transition_wallet_account_status` requires:

- wallet account UUID
- expected version
- target status
- command UUID
- normalized reason from 1 to 500 characters

Mutations use the transaction advisory lock namespace:

```text
staking-wallet-web:wallet-account-command:v1
```

Replay with the same actor, action, wallet account, expected version, target
status, and normalized reason returns the original audit event with
`replayed = true`.

Reusing a command ID with different command data returns
`COMMAND_ID_CONFLICT` without mutation or audit.

Expected-version conflicts return `WALLET_ACCOUNT_VERSION_CONFLICT` without
audit.

## Immutable Audit

`private.wallet_account_admin_audit_events` stores append-only `APPLIED` and
`NOOP` wallet status command events.

Audit rows include:

- command ID
- action and outcome
- actor user ID
- target user ID
- wallet account ID
- reason
- target profile status
- previous and resulting wallet status
- previous and resulting closed timestamp
- entity version
- occurrence timestamp

The audit table does not expose email, password, cookies, tokens, JWTs, MFA
material, user metadata, balances, financial amounts, addresses, private keys,
or mnemonics.

Direct table privileges are revoked from `public`, `anon`, and
`authenticated`. A trigger blocks `UPDATE`, `DELETE`, and `TRUNCATE` with
`WALLET_ACCOUNT_AUDIT_IMMUTABLE`.

## RLS Strengthening

The catalog and wallet SELECT policies were replaced in a forward-only
migration using the existing policy names:

- `projects_select_active_catalog`
- `supported_assets_select_active_catalog`
- `project_token_assignments_select_active_catalog`
- `wallet_accounts_select_own`

Catalog reads now require an authenticated ACTIVE profile. Projects and assets
must be ACTIVE. Project token assignments must be current and linked to ACTIVE
project and ACTIVE asset rows.

Wallet reads require the signed-in user to own the wallet row and have an
ACTIVE profile. The wallet row remains readable to its owner for ACTIVE,
FROZEN, and CLOSED wallet states.

No browser INSERT, UPDATE, or DELETE policies were added.

## Web Boundary

User pages:

- `/catalog`
- `/wallet`

Both are server components and use the centralized account guard. Anonymous
users are redirected to sign in. Inactive profiles are redirected to the
account-unavailable page. Data access uses the normal server Supabase client
and browser-equivalent RLS.

Administrator page:

- `/admin/wallets`

The page requires the centralized ADMIN plus AAL2 guard and uses only
administrator RPCs for wallet list and audit list data. It does not directly
select from `public.wallet_accounts` or private audit tables.

Command route:

- `POST /api/v1/admin/wallets/transition`

The route accepts same-origin form submissions only, validates all input, calls
the server command wrapper, and redirects with safe `result` or `error` codes.
Redirect queries do not include wallet IDs, user IDs, command IDs, expected
versions, reasons, raw database errors, tokens, or cookies.

## Out Of Scope

This phase does not implement:

- balances or financial amounts
- ledger or journal tables
- deposits
- withdrawals
- staking products
- APY or reward accounting
- blockchain addresses
- private keys or mnemonics
- client-side transaction signing
- on-chain transactions
- service-role application clients
- remote Supabase workflows
- mainnet or production connectivity
