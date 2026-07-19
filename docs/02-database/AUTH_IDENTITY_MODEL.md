# Auth Identity Model

## Scope

This model defines the first local Auth identity schema for the managed staking wallet web app.

It covers Supabase Auth user provisioning, application profiles, default `USER` role assignment, and browser-safe read boundaries. It does not implement Auth UI, login, callbacks, ADMIN management, service-role application access, financial tables, or production database workflows.

## Auth User Relationship

`auth.users` remains the Supabase-managed source of authentication records.

`public.profiles.id` is a one-to-one application identity key that references `auth.users.id`.

The foreign key uses `ON DELETE RESTRICT`. Hard deleting Auth users is intentionally blocked because future financial and audit records must remain attributable. User withdrawal should be modeled as `public.profiles.account_status = 'WITHDRAWN'` in a later task.

## Profiles

`public.profiles` stores the minimum non-secret application identity state:

- `id`
- `display_name`
- `account_status`
- `terms_version`
- `terms_accepted_at`
- `version`
- `created_at`
- `updated_at`

Allowed account statuses:

- `ACTIVE`
- `RESTRICTED`
- `SUSPENDED`
- `WITHDRAWN`

`display_name` is optional, trimmed during provisioning, limited to 80 characters, and rejects control characters. Email is not duplicated into the profile table.

Terms fields must both be present or both be null.

## User Roles

`public.user_roles` stores role grant history.

Allowed roles:

- `USER`
- `ADMIN`

An active role is a row where `revoked_at is null`.

A partial unique index prevents duplicate active roles for the same `(user_id, role)` pair. Historical revoked rows remain available for audit trails.

Grant and revoke actor columns reference `auth.users` and use `ON DELETE SET NULL`; the role owner references `public.profiles` with `ON DELETE RESTRICT`.

## Provisioning

Supabase Auth user creation follows this path:

```text
auth.users insert
-> private.handle_auth_user_created()
-> private.ensure_auth_user_provisioned(user_id)
-> public.profiles insert when missing
-> public.user_roles USER grant when missing
```

The helper is idempotent. Running it multiple times for the same Auth user does not create duplicate profiles or duplicate active `USER` roles, and it does not overwrite existing profile fields.

Both provisioning functions are `SECURITY DEFINER` functions with an empty `search_path`. Direct `EXECUTE` has been revoked from `PUBLIC`, `anon`, and `authenticated`.

## Metadata Boundary

Only `raw_user_meta_data ->> 'display_name'` is considered during provisioning, and only as non-authority display text.

The following metadata keys are ignored for authorization and account state:

- `role`
- `roles`
- `admin`
- `is_admin`
- `account_status`
- `permissions`
- `aal`

Metadata cannot create `ADMIN`, change `account_status`, or bypass role management rules.

## RLS And Grants

RLS is enabled on both tables.

`public.profiles` grants `authenticated` users `SELECT` only. The `profiles_select_own` policy limits reads to the current `auth.uid()`.

No profile write policies exist.

`public.user_roles` grants no browser table access to `anon` or `authenticated`, and it has no RLS policy in this task. Future role checks must use server-side guards or narrowly scoped database helpers.

## Future ADMIN Management

Granting or revoking `ADMIN` is a future high-risk server command. It must not trust browser metadata, client requests alone, or local profile writes.

That future command must define authorization, audit logging, approval boundaries, and service-role handling separately.

## Current Service Role Boundary

The application still has no service-role client and no service-role environment variable requirement.

Local Supabase may internally expose service-role credentials for local tooling, but tracked application code and documentation must not store or print those values.
