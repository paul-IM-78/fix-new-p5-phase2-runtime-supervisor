do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'custody_wallet_id_registry_reader') then
    create role custody_wallet_id_registry_reader with login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'custody_wallet_id_registry_provisioner') then
    create role custody_wallet_id_registry_provisioner with login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end;
$$;

do $$
begin
  execute pg_catalog.format('grant connect on database %I to custody_wallet_id_registry_reader, custody_wallet_id_registry_provisioner', pg_catalog.current_database());
end;
$$;

grant usage on schema private to custody_wallet_id_registry_reader, custody_wallet_id_registry_provisioner;

create table private.custody_wallet_id_registry (
  id uuid primary key default gen_random_uuid(),
  custody_account_binding_id uuid not null references private.custody_account_bindings(id) on delete restrict,
  provider_environment text not null,
  wallet_id text not null,
  version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deactivated_at timestamptz null,
  constraint custody_wallet_id_registry_environment_check check (provider_environment in ('TEST', 'PRODUCTION')),
  constraint custody_wallet_id_registry_wallet_id_check check (wallet_id ~ '^[0-9a-f]{32}$'),
  constraint custody_wallet_id_registry_version_check check (version >= 1)
);

create unique index custody_wallet_id_registry_active_binding_environment_key
  on private.custody_wallet_id_registry (custody_account_binding_id, provider_environment)
  where deactivated_at is null;

create table private.custody_wallet_id_registry_audit_events (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid not null references private.custody_wallet_id_registry(id) on delete restrict,
  custody_account_binding_id uuid not null references private.custody_account_bindings(id) on delete restrict,
  provider_environment text not null,
  operation text not null,
  registry_version bigint not null,
  command_id uuid not null unique,
  actor_role text not null,
  reason text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint custody_wallet_id_registry_audit_environment_check check (provider_environment in ('TEST', 'PRODUCTION')),
  constraint custody_wallet_id_registry_audit_operation_check check (operation in ('PROVISION', 'REPLACE', 'DEACTIVATE')),
  constraint custody_wallet_id_registry_audit_version_check check (registry_version >= 1),
  constraint custody_wallet_id_registry_audit_reason_check check (reason = pg_catalog.btrim(reason) and reason ~ '^[A-Z0-9][A-Z0-9_]{1,63}$')
);

revoke all on table private.custody_wallet_id_registry, private.custody_wallet_id_registry_audit_events
  from public, anon, authenticated, service_role, custody_wallet_id_registry_reader, custody_wallet_id_registry_provisioner;

create or replace function private.record_custody_wallet_id_registry_audit_event(
  p_registry_id uuid,
  p_custody_account_binding_id uuid,
  p_provider_environment text,
  p_operation text,
  p_registry_version bigint,
  p_command_id uuid,
  p_reason text
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_registry_id is null or p_custody_account_binding_id is null
    or p_provider_environment not in ('TEST', 'PRODUCTION')
    or p_operation not in ('PROVISION', 'REPLACE', 'DEACTIVATE')
    or p_registry_version is null or p_registry_version < 1
    or p_command_id is null
    or p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
    or p_reason !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
  then
    raise exception 'wallet_registry_audit_input_invalid' using errcode = '22023';
  end if;

  insert into private.custody_wallet_id_registry_audit_events (
    registry_id, custody_account_binding_id, provider_environment, operation,
    registry_version, command_id, actor_role, reason
  ) values (
    p_registry_id, p_custody_account_binding_id, p_provider_environment, p_operation,
    p_registry_version, p_command_id, session_user, p_reason
  );
end;
$$;

create or replace function private.load_active_custody_wallet_id_registry(p_provider_environment text)
returns table(provider_code text, binding_key text, asset_code text, account_role text, wallet_id text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_provider_environment <> 'TEST' then
    raise exception 'wallet_registry_read_not_authorized' using errcode = '42501';
  end if;

  return query
  select providers.provider_code, bindings.binding_key, assets.asset_code, bindings.account_role, registry.wallet_id
  from private.custody_wallet_id_registry as registry
  join private.custody_account_bindings as bindings on bindings.id = registry.custody_account_binding_id
  join private.custody_providers as providers on providers.id = bindings.custody_provider_id
  join public.supported_assets as assets on assets.id = bindings.asset_id
  where registry.provider_environment = p_provider_environment
    and registry.deactivated_at is null
  order by providers.provider_code, bindings.binding_key, assets.asset_code, bindings.account_role, registry.id;
end;
$$;

create or replace function private.provision_custody_wallet_id_registry(
  p_custody_account_binding_id uuid, p_provider_environment text, p_wallet_id text,
  p_command_id uuid, p_reason text
)
returns table(registry_id uuid, version bigint)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_registry private.custody_wallet_id_registry%rowtype;
begin
  if p_custody_account_binding_id is null or p_provider_environment <> 'TEST'
    or p_wallet_id is null or p_wallet_id !~ '^[0-9a-f]{32}$'
    or p_command_id is null or p_reason is null or p_reason <> pg_catalog.btrim(p_reason)
    or p_reason !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
  then raise exception 'wallet_registry_provision_input_invalid' using errcode = '22023'; end if;
  if not exists (select 1 from private.custody_account_bindings where id = p_custody_account_binding_id) then
    raise exception 'wallet_registry_binding_not_found' using errcode = '23503';
  end if;
  insert into private.custody_wallet_id_registry (custody_account_binding_id, provider_environment, wallet_id)
  values (p_custody_account_binding_id, p_provider_environment, p_wallet_id)
  returning * into v_registry;
  perform private.record_custody_wallet_id_registry_audit_event(v_registry.id, v_registry.custody_account_binding_id,
    v_registry.provider_environment, 'PROVISION', v_registry.version, p_command_id, p_reason);
  return query select v_registry.id, v_registry.version;
exception when unique_violation then
  raise exception 'wallet_registry_active_binding_exists' using errcode = '23505';
end;
$$;

create or replace function private.replace_custody_wallet_id_registry(
  p_registry_id uuid, p_expected_version bigint, p_wallet_id text, p_command_id uuid, p_reason text
)
returns table(registry_id uuid, version bigint)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_registry private.custody_wallet_id_registry%rowtype;
begin
  if p_registry_id is null or p_expected_version is null or p_expected_version < 1
    or p_wallet_id is null or p_wallet_id !~ '^[0-9a-f]{32}$' or p_command_id is null
    or p_reason is null or p_reason <> pg_catalog.btrim(p_reason) or p_reason !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
  then raise exception 'wallet_registry_replace_input_invalid' using errcode = '22023'; end if;
  select * into v_registry from private.custody_wallet_id_registry where id = p_registry_id for update;
  if not found or v_registry.deactivated_at is not null then raise exception 'wallet_registry_not_active' using errcode = '23514'; end if;
  if v_registry.version <> p_expected_version then raise exception 'wallet_registry_version_conflict' using errcode = '23514'; end if;
  update private.custody_wallet_id_registry as registry
    set wallet_id = p_wallet_id, version = registry.version + 1, updated_at = clock_timestamp()
    where registry.id = p_registry_id returning * into v_registry;
  perform private.record_custody_wallet_id_registry_audit_event(v_registry.id, v_registry.custody_account_binding_id,
    v_registry.provider_environment, 'REPLACE', v_registry.version, p_command_id, p_reason);
  return query select v_registry.id, v_registry.version;
end;
$$;

create or replace function private.deactivate_custody_wallet_id_registry(
  p_registry_id uuid, p_expected_version bigint, p_command_id uuid, p_reason text
)
returns table(registry_id uuid, version bigint)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_registry private.custody_wallet_id_registry%rowtype;
begin
  if p_registry_id is null or p_expected_version is null or p_expected_version < 1 or p_command_id is null
    or p_reason is null or p_reason <> pg_catalog.btrim(p_reason) or p_reason !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
  then raise exception 'wallet_registry_deactivate_input_invalid' using errcode = '22023'; end if;
  select * into v_registry from private.custody_wallet_id_registry where id = p_registry_id for update;
  if not found or v_registry.deactivated_at is not null then raise exception 'wallet_registry_not_active' using errcode = '23514'; end if;
  if v_registry.version <> p_expected_version then raise exception 'wallet_registry_version_conflict' using errcode = '23514'; end if;
  update private.custody_wallet_id_registry as registry
    set version = registry.version + 1, updated_at = clock_timestamp(), deactivated_at = clock_timestamp()
    where registry.id = p_registry_id returning * into v_registry;
  perform private.record_custody_wallet_id_registry_audit_event(v_registry.id, v_registry.custody_account_binding_id,
    v_registry.provider_environment, 'DEACTIVATE', v_registry.version, p_command_id, p_reason);
  return query select v_registry.id, v_registry.version;
end;
$$;

revoke all on function private.record_custody_wallet_id_registry_audit_event(uuid, uuid, text, text, bigint, uuid, text) from public, anon, authenticated, service_role, custody_wallet_id_registry_reader, custody_wallet_id_registry_provisioner;
revoke all on function private.load_active_custody_wallet_id_registry(text) from public, anon, authenticated, service_role, custody_wallet_id_registry_provisioner;
revoke all on function private.provision_custody_wallet_id_registry(uuid, text, text, uuid, text) from public, anon, authenticated, service_role, custody_wallet_id_registry_reader;
revoke all on function private.replace_custody_wallet_id_registry(uuid, bigint, text, uuid, text) from public, anon, authenticated, service_role, custody_wallet_id_registry_reader;
revoke all on function private.deactivate_custody_wallet_id_registry(uuid, bigint, uuid, text) from public, anon, authenticated, service_role, custody_wallet_id_registry_reader;

grant execute on function private.load_active_custody_wallet_id_registry(text) to custody_wallet_id_registry_reader;
grant execute on function private.provision_custody_wallet_id_registry(uuid, text, text, uuid, text) to custody_wallet_id_registry_provisioner;
grant execute on function private.replace_custody_wallet_id_registry(uuid, bigint, text, uuid, text) to custody_wallet_id_registry_provisioner;
grant execute on function private.deactivate_custody_wallet_id_registry(uuid, bigint, uuid, text) to custody_wallet_id_registry_provisioner;
