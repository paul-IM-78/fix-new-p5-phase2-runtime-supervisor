# ADMIN Role Commands And Audit

## Scope

This document defines the local ADMIN role grant and revoke boundary for the
managed staking wallet web app.

The feature is an operator command surface, not a financial command surface.
It does not implement user lookup, email search, production ADMIN bootstrap,
break-glass recovery, service-role application access, assets, balances,
ledger entries, staking, withdrawals, or mainnet integration.

## Source Of Truth

Application ADMIN state is stored in `public.user_roles`.

An active ADMIN role means:

```text
role = ADMIN
revoked_at is null
```

Auth metadata, browser flags, query parameters, cookies, localStorage,
`getSession()` payloads, and UI state are not trusted for role authority.

## Authorization Boundary

The application server guard protects `/admin/roles` and the POST routes, but
the database command functions perform the final check again.

Every role mutation command requires:

- `auth.uid()` exists
- `public.is_current_user_admin_aal2()` returns `true`
- The actor profile is ACTIVE
- The actor has an active ADMIN role
- The current JWT has AAL2

The command functions are `SECURITY DEFINER`, use `search_path = ''`, and grant
`EXECUTE` only to `authenticated`. `PUBLIC` and `anon` execute privileges are
revoked.

## Grant Command

`public.grant_admin_role(uuid, uuid, text)` grants ADMIN to a target user.

Rules:

- Target profile must exist
- Target profile must be ACTIVE
- Existing active ADMIN role is a no-op
- Existing active USER role is preserved
- `granted_by` is the current actor
- Reason is trimmed and validated
- Command ID is required
- APPLIED and NOOP outcomes are audited

Inactive targets return a safe result and do not mutate roles or audit rows.

## Revoke Command

`public.revoke_admin_role(uuid, uuid, text)` revokes ADMIN from a target user.

Rules:

- Target profile must exist
- Target may be ACTIVE, RESTRICTED, SUSPENDED, or WITHDRAWN
- Self-revoke is blocked
- Missing active ADMIN role is a no-op
- Active ADMIN role is revoked immediately
- `revoked_by`, `revoked_at`, `revoke_reason`, and `version` are updated
- APPLIED and NOOP outcomes are audited

Role revocation is rechecked on each admin request, so an existing AAL2 session
loses admin access without waiting for a token refresh.

## Idempotency

Every command uses a caller-provided command ID. The audit table has a unique
constraint on `command_id`.

Replay is allowed only when all of these match the original event:

- Actor
- Action
- Target
- Trimmed reason

Replay returns the original event and does not add another role row or audit
row.

Reusing a command ID with different actor, action, target, or reason returns a
safe conflict result and does not mutate roles or audit rows.

## Concurrency

Both command functions take a global transaction advisory lock:

```text
staking-wallet-web:admin-role-command:v1
```

This serializes ADMIN role mutations and prevents duplicate role or audit rows
when the same command is submitted concurrently.

The existing partial unique index on active roles remains the database-level
duplicate role guard:

```text
user_roles_active_role_uidx
```

## Immutable Audit

`private.admin_role_audit_events` is the append-only audit table.

Stored fields include command ID, action, outcome, actor user ID, target user
ID, role, role record ID, reason, target account status, state transition,
role version, and timestamp.

Stored fields do not include email, password, JWT, cookie, refresh token, MFA
secret, TOTP code, QR data, IP address, user agent, auth metadata, full
profile JSON, or full role JSON.

The table is private. Direct privileges are revoked from `PUBLIC`, `anon`, and
`authenticated`.

`private.prevent_admin_role_audit_mutation()` blocks UPDATE, DELETE, and
TRUNCATE with the fixed error:

```text
ADMIN_AUDIT_IMMUTABLE
```

## Audit Read

`public.list_admin_role_audit_events(integer, uuid)` is the only application
audit read path in this phase.

It requires ACTIVE ADMIN AAL2 inside the function, returns recent audit rows,
uses keyset-style pagination, and does not return credentials, cookies, MFA
material, auth metadata, IP addresses, user agents, or profile JSON.

The `/admin/roles` page shows only recent command outcomes and shortened actor
and target UUIDs.

## Web Boundary

`GET /admin/roles` requires the same AAL2 ADMIN guard as `/admin`.

POST routes:

- `POST /api/v1/admin/roles/grant`
- `POST /api/v1/admin/roles/revoke`

Both routes require same-origin form submission, validate target UUID, command
ID, and reason, and redirect with safe public result codes. They do not expose
raw database errors, target details, command IDs, reasons, tokens, cookies, or
SQL details.

## Current Limitations

The page accepts a target UUID from a trusted operator. The following are
future tasks:

- User list
- Email-based lookup
- User detail page
- Initial production ADMIN bootstrap
- Break-glass recovery
- MFA factor removal
- Financial administrator commands
- Rate limiting
- Two-person approval
- Remote Supabase workflow

Future financial administrator commands should reuse the same pattern:
server guard, database AAL2 ADMIN recheck, command ID idempotency, advisory
locking where needed, and immutable audit.
