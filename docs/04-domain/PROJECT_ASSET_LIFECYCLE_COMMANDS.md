# Project And Asset Lifecycle Commands

This document defines the Phase 2 lifecycle command boundary for project
metadata, supported asset metadata, and project token assignment history.

## Access Boundary

All lifecycle command and administrator catalog read RPCs require both:

- an authenticated Supabase user
- an ACTIVE ADMIN account with a current AAL2 session

The web application guard is not the final authorization boundary. Every
command and read RPC repeats the ADMIN plus AAL2 check inside PostgreSQL with
`public.is_current_user_admin_aal2()`.

The browser does not submit or supply trusted role, AAL, account status, RLS,
or command authorization state.

## Implemented Commands

The following public RPCs are implemented as `security definer` functions with
an empty `search_path` and authenticated-only execute grants:

- `public.create_project`
- `public.update_project_details`
- `public.transition_project_status`
- `public.create_supported_asset`
- `public.update_supported_asset_details`
- `public.transition_supported_asset_status`
- `public.assign_project_token`
- `public.retire_project_token`

The following AAL2 administrator read RPCs are implemented:

- `public.list_admin_projects`
- `public.list_admin_supported_assets`
- `public.list_admin_project_token_assignments`
- `public.list_domain_admin_audit_events`

Direct browser table writes remain blocked. Administrator UI and route handlers
call RPCs; they do not write domain tables directly.

## Project Lifecycle

New projects are created as `DRAFT` with `version = 1`.

Allowed project status transitions:

- `DRAFT` to `ACTIVE`
- `DRAFT` to `ARCHIVED`
- `ACTIVE` to `SUSPENDED`
- `SUSPENDED` to `ACTIVE`
- `SUSPENDED` to `ARCHIVED`

Terminal and prohibited transitions:

- `ARCHIVED` to any status
- `ACTIVE` to `ARCHIVED`
- `DRAFT` to `SUSPENDED`
- `ACTIVE` to `DRAFT`
- `SUSPENDED` to `DRAFT`

Changing to the same status records a `NOOP` audit event and does not increase
the row version.

Project activation requires exactly one current token assignment whose asset is
an `ACTIVE` `SOLANA` `SPL_TOKEN`. The global database constraint allowing at
most one `ACTIVE` project remains the final guard against concurrent
activation.

## Asset Lifecycle

New supported assets are created as `DRAFT` with `network = SOLANA` and
`version = 1`.

Allowed asset status transitions:

- `DRAFT` to `ACTIVE`
- `DRAFT` to `ARCHIVED`
- `ACTIVE` to `SUSPENDED`
- `SUSPENDED` to `ACTIVE`
- `SUSPENDED` to `ARCHIVED`

Terminal and prohibited transitions mirror the project matrix. Changing to the
same status records `NOOP`.

Asset core identity is immutable after creation:

- `asset_code`
- `network`
- `asset_type`
- `decimals`
- `mint_address`

Only `symbol` and `display_name` can be updated, and only while the asset is
`DRAFT` or `SUSPENDED`.

`NATIVE` assets require `mint_address = null`. `SPL_TOKEN` assets require a
Base58-shaped mint address, but this phase does not seed real SOL, USDT, or
project-token mint rows.

## Project Token Assignment

Project token replacement is modeled as:

1. suspend the project
2. retire the current assignment
3. create or select another active SPL token asset
4. assign the replacement token
5. reactivate the project

The assignment row's project, asset, and assignment timestamp are immutable.
Retired assignments cannot be reactivated. Historical assignment rows are
preserved.

An `ACTIVE` project token assignment cannot be retired. The project must first
transition to `SUSPENDED`.

## Idempotency And Concurrency

Every command requires a caller-supplied `command_id` UUID.

If the same `command_id` is replayed with the same actor, action, normalized
reason, and normalized request data, the prior audit event is returned with
`replayed = true`. No new domain mutation or audit row is created.

If the same `command_id` is reused with different command data, the command
returns `COMMAND_ID_CONFLICT` and does not mutate domain state.

Mutating commands use a global transaction advisory lock:

```text
staking-wallet-web:domain-lifecycle-command:v1
```

Commands that modify existing rows also require `expected_version`. Version
conflicts return a safe result code and do not create audit rows.

## Immutable Domain Audit

`private.domain_admin_audit_events` stores append-only domain command audit
events for `APPLIED` and `NOOP` outcomes.

Audit records include safe domain snapshots only. They must not include:

- email
- password
- cookie
- JWT
- access or refresh token
- MFA secret
- TOTP code
- request header
- user metadata
- app metadata
- IP address
- user agent
- private key
- mnemonic
- financial amount

Direct privileges on the audit table are revoked from `public`, `anon`, and
`authenticated`. A trigger blocks `UPDATE`, `DELETE`, and `TRUNCATE` with
`DOMAIN_AUDIT_IMMUTABLE`.

## Web Boundary

`/admin/catalog` is an AAL2-only server-rendered administrator page. It uses
only the administrator read RPCs and renders shortened IDs and summarized
audit state changes.

The command endpoints are POST-only same-origin form handlers:

- `/api/v1/admin/domain/projects/create`
- `/api/v1/admin/domain/projects/update`
- `/api/v1/admin/domain/projects/transition`
- `/api/v1/admin/domain/assets/create`
- `/api/v1/admin/domain/assets/update`
- `/api/v1/admin/domain/assets/transition`
- `/api/v1/admin/domain/project-token/assign`
- `/api/v1/admin/domain/project-token/retire`

They redirect with safe `result` or `error` codes only. Redirect query strings
must not contain project IDs, asset IDs, assignment IDs, command IDs, expected
versions, reasons, mint addresses, or raw database errors.

## Out Of Scope

This phase does not implement:

- real SOL, USDT, project-token, project, or production seed data
- wallet status commands
- ledger tables
- balance calculation
- deposits
- withdrawals
- staking products
- APY
- blockchain addresses
- on-chain transactions
- private keys
- mnemonics
- service-role application clients
- remote Supabase connections
- mainnet or production connectivity
