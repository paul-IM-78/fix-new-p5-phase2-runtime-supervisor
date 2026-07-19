create table public.profiles (
  id uuid primary key
    references auth.users (id) on delete restrict,

  display_name text null,

  account_status text not null default 'ACTIVE',

  terms_version text null,
  terms_accepted_at timestamptz null,

  version bigint not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_account_status_check
    check (account_status in ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'WITHDRAWN')),

  constraint profiles_display_name_check
    check (
      display_name is null
      or (
        display_name = btrim(display_name)
        and char_length(display_name) between 1 and 80
        and display_name !~ '[[:cntrl:]]'
      )
    ),

  constraint profiles_terms_pair_check
    check (
      (terms_version is null and terms_accepted_at is null)
      or (terms_version is not null and terms_accepted_at is not null)
    ),

  constraint profiles_version_check
    check (version >= 1)
);

comment on table public.profiles is
  'Application profile identity linked one-to-one with auth.users; hard deletes are restricted for audit retention.';

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles (id) on delete restrict,

  role text not null,

  granted_by uuid null
    references auth.users (id) on delete set null,

  granted_at timestamptz not null default now(),
  grant_reason text null,

  revoked_by uuid null
    references auth.users (id) on delete set null,

  revoked_at timestamptz null,
  revoke_reason text null,

  version bigint not null default 1,
  created_at timestamptz not null default now(),

  constraint user_roles_role_check
    check (role in ('USER', 'ADMIN')),

  constraint user_roles_version_check
    check (version >= 1),

  constraint user_roles_grant_reason_length_check
    check (grant_reason is null or char_length(grant_reason) <= 500),

  constraint user_roles_revoke_reason_length_check
    check (revoke_reason is null or char_length(revoke_reason) <= 500),

  constraint user_roles_revoke_details_check
    check (
      (revoked_by is null and revoke_reason is null)
      or revoked_at is not null
    ),

  constraint user_roles_revoked_at_check
    check (revoked_at is null or revoked_at >= granted_at)
);

comment on table public.user_roles is
  'Role grant history for application users; active roles are rows where revoked_at is null.';

create unique index user_roles_active_role_uidx
  on public.user_roles (user_id, role)
  where revoked_at is null;

create index user_roles_user_id_idx
  on public.user_roles (user_id);

create index user_roles_granted_by_idx
  on public.user_roles (granted_by);

create index user_roles_revoked_by_idx
  on public.user_roles (revoked_by);

create or replace function private.ensure_auth_user_provisioned(
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_metadata jsonb;
  candidate_display_name text;
  safe_display_name text;
begin
  select users.raw_user_meta_data
    into user_metadata
  from auth.users as users
  where users.id = target_user_id;

  if not found then
    raise exception 'auth user not found'
      using errcode = '23503';
  end if;

  candidate_display_name := pg_catalog.btrim(user_metadata ->> 'display_name');

  if candidate_display_name is not null
    and candidate_display_name <> ''
    and pg_catalog.char_length(candidate_display_name) <= 80
    and candidate_display_name !~ '[[:cntrl:]]'
  then
    safe_display_name := candidate_display_name;
  else
    safe_display_name := null;
  end if;

  insert into public.profiles (id, display_name)
  values (target_user_id, safe_display_name)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role, grant_reason)
  values (target_user_id, 'USER', 'auth signup provisioning')
  on conflict (user_id, role) where revoked_at is null do nothing;
end;
$$;

comment on function private.ensure_auth_user_provisioned(uuid) is
  'Idempotently provisions an application profile and default USER role for an auth user.';

create or replace function private.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_auth_user_provisioned(new.id);
  return new;
end;
$$;

comment on function private.handle_auth_user_created() is
  'Auth users insert trigger handler for profile and default USER role provisioning.';

revoke execute on function private.ensure_auth_user_provisioned(uuid)
  from public, anon, authenticated;

revoke execute on function private.handle_auth_user_created()
  from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_auth_user_created();

revoke all privileges on table public.profiles
  from anon, authenticated;

grant select on table public.profiles
  to authenticated;

revoke all privileges on table public.user_roles
  from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) = id
  );
