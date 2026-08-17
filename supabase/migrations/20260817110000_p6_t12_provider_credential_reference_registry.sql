do $$ begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'provider_credential_reference_reader') then
    create role provider_credential_reference_reader with login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'provider_credential_reference_provisioner') then
    create role provider_credential_reference_provisioner with login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;

do $$ begin
  execute pg_catalog.format('grant connect on database %I to provider_credential_reference_reader, provider_credential_reference_provisioner', pg_catalog.current_database());
end $$;
grant usage on schema private to provider_credential_reference_reader, provider_credential_reference_provisioner;

create table private.provider_credential_references (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_environment text not null,
  reference_id text not null,
  lifecycle text not null,
  version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deactivated_at timestamptz null,
  constraint provider_credential_references_provider_check check (provider = 'BITGO'),
  constraint provider_credential_references_environment_check check (provider_environment in ('TEST', 'PRODUCTION')),
  constraint provider_credential_references_reference_check check (reference_id = pg_catalog.btrim(reference_id) and reference_id ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  constraint provider_credential_references_lifecycle_check check (lifecycle in ('ACTIVE', 'ROTATING', 'REVOKED', 'DISABLED')),
  constraint provider_credential_references_version_check check (version >= 1)
);
create unique index provider_credential_references_current_key on private.provider_credential_references(provider, provider_environment) where deactivated_at is null;

create table private.provider_credential_reference_audit_events (
  id uuid primary key default gen_random_uuid(),
  credential_reference_id uuid not null references private.provider_credential_references(id) on delete restrict,
  provider text not null, provider_environment text not null, reference_id text not null,
  lifecycle text not null, registry_version bigint not null, operation text not null,
  command_id uuid not null unique, actor_role text not null, reason text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint provider_credential_reference_audit_operation_check check (operation in ('PROVISION', 'ROTATE', 'REVOKE', 'DISABLE')),
  constraint provider_credential_reference_audit_reason_check check (reason = pg_catalog.btrim(reason) and reason ~ '^[A-Z0-9][A-Z0-9_]{1,63}$')
);
revoke all on table private.provider_credential_references, private.provider_credential_reference_audit_events from public, anon, authenticated, service_role, provider_credential_reference_reader, provider_credential_reference_provisioner;

create or replace function private.record_provider_credential_reference_audit_event(p_id uuid, p_operation text, p_command_id uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_row private.provider_credential_references%rowtype;
begin
  select * into v_row from private.provider_credential_references where id = p_id;
  if not found or p_operation not in ('PROVISION','ROTATE','REVOKE','DISABLE') or p_command_id is null or p_reason is null or p_reason <> pg_catalog.btrim(p_reason) or p_reason !~ '^[A-Z0-9][A-Z0-9_]{1,63}$' then raise exception 'credential_reference_audit_input_invalid' using errcode = '22023'; end if;
  insert into private.provider_credential_reference_audit_events(credential_reference_id,provider,provider_environment,reference_id,lifecycle,registry_version,operation,command_id,actor_role,reason)
  values(v_row.id,v_row.provider,v_row.provider_environment,v_row.reference_id,v_row.lifecycle,v_row.version,p_operation,p_command_id,session_user,p_reason);
end $$;

create or replace function private.load_active_provider_credential_reference(p_provider text, p_environment text)
returns table(provider text, provider_environment text, reference_id text, version bigint, lifecycle text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_provider <> 'BITGO' or p_environment <> 'TEST' then raise exception 'credential_reference_read_not_authorized' using errcode = '42501'; end if;
  return query select r.provider,r.provider_environment,r.reference_id,r.version,r.lifecycle from private.provider_credential_references r where r.provider=p_provider and r.provider_environment=p_environment and r.deactivated_at is null and r.lifecycle in ('ACTIVE','ROTATING');
end $$;

create or replace function private.provision_provider_credential_reference(p_provider text,p_environment text,p_reference_id text,p_command_id uuid,p_reason text)
returns table(registry_id uuid,version bigint) language plpgsql volatile security definer set search_path = '' as $$ declare v private.provider_credential_references%rowtype; begin
  if p_provider <> 'BITGO' or p_environment <> 'TEST' or p_reference_id is null or p_reference_id <> pg_catalog.btrim(p_reference_id) or p_reference_id !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$' then raise exception 'credential_reference_provision_input_invalid' using errcode='22023'; end if;
  insert into private.provider_credential_references(provider,provider_environment,reference_id,lifecycle) values(p_provider,p_environment,p_reference_id,'ACTIVE') returning * into v;
  perform private.record_provider_credential_reference_audit_event(v.id,'PROVISION',p_command_id,p_reason); return query select v.id,v.version;
exception when unique_violation then raise exception 'credential_reference_current_exists' using errcode='23505'; end $$;

create or replace function private.rotate_provider_credential_reference(p_id uuid,p_expected_version bigint,p_reference_id text,p_command_id uuid,p_reason text)
returns table(registry_id uuid,version bigint) language plpgsql volatile security definer set search_path = '' as $$ declare v private.provider_credential_references%rowtype; begin
  select * into v from private.provider_credential_references where id=p_id for update;
  if not found or v.deactivated_at is not null or v.version <> p_expected_version or p_reference_id is null or p_reference_id <> pg_catalog.btrim(p_reference_id) or p_reference_id !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$' then raise exception 'credential_reference_version_conflict' using errcode='23514'; end if;
  update private.provider_credential_references as r set reference_id=p_reference_id,lifecycle='ROTATING',version=r.version+1,updated_at=clock_timestamp() where r.id=p_id returning * into v;
  perform private.record_provider_credential_reference_audit_event(v.id,'ROTATE',p_command_id,p_reason); return query select v.id,v.version; end $$;

create or replace function private.revoke_provider_credential_reference(p_id uuid,p_expected_version bigint,p_command_id uuid,p_reason text)
returns table(registry_id uuid,version bigint) language plpgsql volatile security definer set search_path = '' as $$ declare v private.provider_credential_references%rowtype; begin
  select * into v from private.provider_credential_references where id=p_id for update; if not found or v.deactivated_at is not null or v.version <> p_expected_version then raise exception 'credential_reference_version_conflict' using errcode='23514'; end if;
  update private.provider_credential_references as r set lifecycle='REVOKED',version=r.version+1,updated_at=clock_timestamp(),deactivated_at=clock_timestamp() where r.id=p_id returning * into v; perform private.record_provider_credential_reference_audit_event(v.id,'REVOKE',p_command_id,p_reason); return query select v.id,v.version; end $$;

create or replace function private.disable_provider_credential_reference(p_id uuid,p_expected_version bigint,p_command_id uuid,p_reason text)
returns table(registry_id uuid,version bigint) language plpgsql volatile security definer set search_path = '' as $$ declare v private.provider_credential_references%rowtype; begin
  select * into v from private.provider_credential_references where id=p_id for update; if not found or v.deactivated_at is not null or v.version <> p_expected_version then raise exception 'credential_reference_version_conflict' using errcode='23514'; end if;
  update private.provider_credential_references as r set lifecycle='DISABLED',version=r.version+1,updated_at=clock_timestamp(),deactivated_at=clock_timestamp() where r.id=p_id returning * into v; perform private.record_provider_credential_reference_audit_event(v.id,'DISABLE',p_command_id,p_reason); return query select v.id,v.version; end $$;

revoke all on function private.record_provider_credential_reference_audit_event(uuid,text,uuid,text), private.load_active_provider_credential_reference(text,text), private.provision_provider_credential_reference(text,text,text,uuid,text), private.rotate_provider_credential_reference(uuid,bigint,text,uuid,text), private.revoke_provider_credential_reference(uuid,bigint,uuid,text), private.disable_provider_credential_reference(uuid,bigint,uuid,text) from public, anon, authenticated, service_role, provider_credential_reference_reader, provider_credential_reference_provisioner;
grant execute on function private.load_active_provider_credential_reference(text,text) to provider_credential_reference_reader;
grant execute on function private.provision_provider_credential_reference(text,text,text,uuid,text), private.rotate_provider_credential_reference(uuid,bigint,text,uuid,text), private.revoke_provider_credential_reference(uuid,bigint,uuid,text), private.disable_provider_credential_reference(uuid,bigint,uuid,text) to provider_credential_reference_provisioner;
