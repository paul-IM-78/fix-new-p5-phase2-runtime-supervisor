create table public.projects (
  id uuid primary key default gen_random_uuid(),

  project_code text not null unique,
  display_name text not null,
  description text null,

  status text not null default 'DRAFT',

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint projects_project_code_check
    check (
      project_code = pg_catalog.btrim(project_code)
      and project_code ~ '^[A-Z0-9][A-Z0-9_]{1,31}$'
    ),

  constraint projects_display_name_check
    check (
      display_name = pg_catalog.btrim(display_name)
      and pg_catalog.char_length(display_name) between 1 and 100
      and display_name !~ '[[:cntrl:]]'
    ),

  constraint projects_description_check
    check (
      description is null
      or (
        description = pg_catalog.btrim(description)
        and pg_catalog.char_length(description) between 1 and 2000
        and description !~ '[[:cntrl:]]'
      )
    ),

  constraint projects_status_check
    check (status in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),

  constraint projects_version_check
    check (version >= 1)
);

comment on table public.projects is
  'Project catalog domain data; at most one project may be ACTIVE and browser writes are prohibited.';

create unique index projects_one_active_idx
  on public.projects (status)
  where status = 'ACTIVE';

create table public.supported_assets (
  id uuid primary key default gen_random_uuid(),

  asset_code text not null unique,
  symbol text not null,
  display_name text not null,

  network text not null default 'SOLANA',
  asset_type text not null,

  decimals smallint not null,
  mint_address text null,

  status text not null default 'DRAFT',

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint supported_assets_asset_code_check
    check (
      asset_code = pg_catalog.btrim(asset_code)
      and asset_code ~ '^[A-Z0-9][A-Z0-9_]{1,31}$'
    ),

  constraint supported_assets_symbol_check
    check (
      symbol = pg_catalog.btrim(symbol)
      and symbol ~ '^[A-Z0-9]{1,16}$'
      and symbol !~ '[[:cntrl:]]'
    ),

  constraint supported_assets_display_name_check
    check (
      display_name = pg_catalog.btrim(display_name)
      and pg_catalog.char_length(display_name) between 1 and 100
      and display_name !~ '[[:cntrl:]]'
    ),

  constraint supported_assets_network_check
    check (network = 'SOLANA'),

  constraint supported_assets_asset_type_check
    check (asset_type in ('NATIVE', 'SPL_TOKEN')),

  constraint supported_assets_decimals_check
    check (decimals between 0 and 18),

  constraint supported_assets_mint_address_check
    check (
      (
        asset_type = 'NATIVE'
        and mint_address is null
      )
      or (
        asset_type = 'SPL_TOKEN'
        and mint_address is not null
        and mint_address = pg_catalog.btrim(mint_address)
        and pg_catalog.char_length(mint_address) between 32 and 44
        and mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
      )
    ),

  constraint supported_assets_status_check
    check (status in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),

  constraint supported_assets_version_check
    check (version >= 1)
);

comment on table public.supported_assets is
  'Supported SOLANA asset catalog metadata; real mint data is added later through administrator commands and browser writes are prohibited.';

create unique index supported_assets_mint_uidx
  on public.supported_assets (network, mint_address)
  where mint_address is not null;

create unique index supported_assets_native_network_symbol_uidx
  on public.supported_assets (network, symbol)
  where asset_type = 'NATIVE';

create table public.project_token_assignments (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  assigned_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint project_token_assignments_retired_at_check
    check (retired_at is null or retired_at >= assigned_at),

  constraint project_token_assignments_version_check
    check (version >= 1)
);

comment on table public.project_token_assignments is
  'Project token assignment history; current rows are unretired and token replacement preserves history by retire plus insert.';

create unique index project_token_assignments_current_project_uidx
  on public.project_token_assignments (project_id)
  where retired_at is null;

create unique index project_token_assignments_current_asset_uidx
  on public.project_token_assignments (asset_id)
  where retired_at is null;

create table public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null unique
    references public.profiles (id)
      on delete no action
      deferrable initially deferred,

  custody_model text not null default 'MANAGED',
  status text not null default 'ACTIVE',

  closed_at timestamptz null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint wallet_accounts_custody_model_check
    check (custody_model = 'MANAGED'),

  constraint wallet_accounts_status_check
    check (status in ('ACTIVE', 'FROZEN', 'CLOSED')),

  constraint wallet_accounts_closed_at_check
    check (
      (status = 'CLOSED' and closed_at is not null)
      or (status in ('ACTIVE', 'FROZEN') and closed_at is null)
    ),

  constraint wallet_accounts_version_check
    check (version >= 1)
);

comment on table public.wallet_accounts is
  'Managed wallet account container for each profile; financial values and blockchain credentials are intentionally stored elsewhere in future phases.';

create or replace function private.touch_versioned_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  new.version := old.version + 1;

  return new;
end;
$$;

comment on function private.touch_versioned_record() is
  'Maintains updated_at and version for domain tables; caller-supplied version values are not trusted.';

revoke execute on function private.touch_versioned_record()
  from public, anon, authenticated;

create trigger touch_projects_version
  before update on public.projects
  for each row
  execute function private.touch_versioned_record();

create trigger touch_supported_assets_version
  before update on public.supported_assets
  for each row
  execute function private.touch_versioned_record();

create trigger touch_project_token_assignments_version
  before update on public.project_token_assignments
  for each row
  execute function private.touch_versioned_record();

create trigger touch_wallet_accounts_version
  before update on public.wallet_accounts
  for each row
  execute function private.touch_versioned_record();

create or replace function private.validate_project_token_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.supported_assets%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
      or new.asset_id is distinct from old.asset_id
      or new.assigned_at is distinct from old.assigned_at
    then
      raise exception 'PROJECT_TOKEN_ASSIGNMENT_IMMUTABLE'
        using errcode = '23514';
    end if;

    if old.retired_at is not null
      and new.retired_at is distinct from old.retired_at
    then
      raise exception 'PROJECT_TOKEN_ASSIGNMENT_IMMUTABLE'
        using errcode = '23514';
    end if;

    if old.retired_at is null
      and new.retired_at is not null
      and new.retired_at < old.assigned_at
    then
      raise exception 'PROJECT_TOKEN_ASSIGNMENT_INVALID_RETIREMENT'
        using errcode = '23514';
    end if;
  end if;

  select assets.*
    into v_asset
  from public.supported_assets as assets
  where assets.id = new.asset_id;

  if not found
    or v_asset.network <> 'SOLANA'
    or v_asset.asset_type <> 'SPL_TOKEN'
    or v_asset.status = 'ARCHIVED'
    or v_asset.mint_address is null
  then
    raise exception 'PROJECT_TOKEN_ASSIGNMENT_INVALID_ASSET'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function private.validate_project_token_assignment() is
  'Protects project token assignment history and limits assignments to non-archived SOLANA SPL token assets.';

revoke execute on function private.validate_project_token_assignment()
  from public, anon, authenticated;

create trigger validate_project_token_assignment
  before insert or update on public.project_token_assignments
  for each row
  execute function private.validate_project_token_assignment();

create or replace function private.ensure_user_wallet_account(
  target_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet_account_id uuid;
begin
  if target_user_id is null
    or not exists (
      select 1
      from public.profiles as profiles
      where profiles.id = target_user_id
    )
  then
    raise exception 'WALLET_ACCOUNT_PROFILE_NOT_FOUND'
      using errcode = '23503';
  end if;

  insert into public.wallet_accounts (user_id)
  values (target_user_id)
  on conflict (user_id) do nothing
  returning id into v_wallet_account_id;

  if v_wallet_account_id is null then
    select wallet_accounts.id
      into v_wallet_account_id
    from public.wallet_accounts
    where wallet_accounts.user_id = target_user_id;
  end if;

  return v_wallet_account_id;
end;
$$;

comment on function private.ensure_user_wallet_account(uuid) is
  'Idempotently provisions one MANAGED wallet account container for an existing profile without storing financial values.';

revoke execute on function private.ensure_user_wallet_account(uuid)
  from public, anon, authenticated;

create or replace function private.handle_profile_wallet_account_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_user_wallet_account(new.id);
  return new;
end;
$$;

comment on function private.handle_profile_wallet_account_created() is
  'Profiles insert trigger handler that creates the managed wallet account container for new users.';

revoke execute on function private.handle_profile_wallet_account_created()
  from public, anon, authenticated;

create trigger on_profile_created_create_wallet_account
  after insert on public.profiles
  for each row
  execute function private.handle_profile_wallet_account_created();

insert into public.wallet_accounts (user_id)
select profiles.id
from public.profiles as profiles
on conflict (user_id) do nothing;

revoke all privileges on table public.projects
  from public, anon, authenticated;

revoke all privileges on table public.supported_assets
  from public, anon, authenticated;

revoke all privileges on table public.project_token_assignments
  from public, anon, authenticated;

revoke all privileges on table public.wallet_accounts
  from public, anon, authenticated;

grant select on table public.projects
  to authenticated;

grant select on table public.supported_assets
  to authenticated;

grant select on table public.project_token_assignments
  to authenticated;

grant select on table public.wallet_accounts
  to authenticated;

alter table public.projects enable row level security;
alter table public.supported_assets enable row level security;
alter table public.project_token_assignments enable row level security;
alter table public.wallet_accounts enable row level security;

create policy projects_select_active_catalog
  on public.projects
  for select
  to authenticated
  using (status = 'ACTIVE');

create policy supported_assets_select_active_catalog
  on public.supported_assets
  for select
  to authenticated
  using (status = 'ACTIVE');

create policy project_token_assignments_select_active_catalog
  on public.project_token_assignments
  for select
  to authenticated
  using (
    retired_at is null
    and exists (
      select 1
      from public.projects as projects
      where projects.id = project_token_assignments.project_id
        and projects.status = 'ACTIVE'
    )
    and exists (
      select 1
      from public.supported_assets as assets
      where assets.id = project_token_assignments.asset_id
        and assets.status = 'ACTIVE'
    )
  );

create policy wallet_accounts_select_own
  on public.wallet_accounts
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );
