do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'custody_observer_worker'
  ) then
    create role custody_observer_worker
      with login
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'custody_observer_worker'
      and not (
        rolcanlogin
        and not rolinherit
        and not rolsuper
        and not rolcreatedb
        and not rolcreaterole
        and not rolreplication
        and not rolbypassrls
      )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members as members
    where members.member = (
      select roles.oid
      from pg_catalog.pg_roles as roles
      where roles.rolname = 'custody_observer_worker'
    )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as classes
    where classes.relowner = (
      select roles.oid
      from pg_catalog.pg_roles as roles
      where roles.rolname = 'custody_observer_worker'
    )
  )
    or exists (
      select 1
      from pg_catalog.pg_proc as procedures
      where procedures.proowner = (
        select roles.oid
        from pg_catalog.pg_roles as roles
        where roles.rolname = 'custody_observer_worker'
      )
    )
    or exists (
      select 1
      from pg_catalog.pg_type as types
      where types.typowner = (
        select roles.oid
        from pg_catalog.pg_roles as roles
        where roles.rolname = 'custody_observer_worker'
      )
    )
    or exists (
      select 1
      from pg_catalog.pg_namespace as namespaces
      where namespaces.nspowner = (
        select roles.oid
        from pg_catalog.pg_roles as roles
        where roles.rolname = 'custody_observer_worker'
      )
    )
  then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;
end;
$$;

grant connect on database postgres
  to custody_observer_worker;

grant usage on schema private
  to custody_observer_worker;

create or replace function private.record_balance_observation_and_advance_checkpoint(
  p_custody_account_binding_id uuid,
  p_observer_kind text,
  p_observation_key text,
  p_observed_atomic_units numeric,
  p_observed_at timestamptz,
  p_expected_checkpoint_version bigint,
  p_next_checkpoint_value text,
  p_next_checkpoint_observed_at timestamptz
)
returns table (
  external_balance_observation_id uuid,
  observation_created boolean,
  observer_checkpoint_id uuid,
  checkpoint_created boolean,
  checkpoint_advanced boolean,
  checkpoint_version bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_observer_kind text;
  v_observation_key text;
  v_checkpoint_value text;
  v_checkpoint private.observer_checkpoints%rowtype;
  v_checkpoint_found boolean := false;
  v_existing_observation private.external_balance_observations%rowtype;
  v_existing_observation_found boolean := false;
  v_existing_observation_exact boolean := false;
  v_observation_id uuid;
  v_observation_created boolean;
  v_checkpoint_id uuid;
  v_checkpoint_version bigint;
begin
  v_observer_kind := pg_catalog.btrim(p_observer_kind);
  v_observation_key := pg_catalog.btrim(p_observation_key);
  v_checkpoint_value := pg_catalog.btrim(p_next_checkpoint_value);

  if p_observer_kind is null
    or v_observer_kind is distinct from p_observer_kind
    or v_observer_kind <> 'BALANCE_OBSERVER_V1'
  then
    raise exception 'observer_kind_invalid'
      using errcode = '22023';
  end if;

  if p_observation_key is null
    or v_observation_key is distinct from p_observation_key
    or v_observation_key !~ '^balobs:v1:[nkc]:[0-9a-f]{64}$'
  then
    raise exception 'observation_key_invalid'
      using errcode = '22023';
  end if;

  if p_observed_atomic_units is null
    or p_observed_atomic_units::text in ('NaN', 'Infinity', '-Infinity')
    or p_observed_atomic_units < 0
    or p_observed_atomic_units <> pg_catalog.trunc(p_observed_atomic_units)
    or p_observed_atomic_units::text !~ '^(0|[1-9][0-9]{0,37})$'
    or p_observed_atomic_units >= pg_catalog.power(10::numeric, 38)
  then
    raise exception 'observation_amount_invalid'
      using errcode = '22023';
  end if;

  if p_observed_at is null then
    raise exception 'observation_timestamp_invalid'
      using errcode = '22023';
  end if;

  if p_expected_checkpoint_version is null
    or p_expected_checkpoint_version < 0
  then
    raise exception 'observer_checkpoint_version_invalid'
      using errcode = '22023';
  end if;

  if p_next_checkpoint_value is null
    or v_checkpoint_value is distinct from p_next_checkpoint_value
    or v_checkpoint_value = ''
    or pg_catalog.char_length(v_checkpoint_value) > 200
    or v_checkpoint_value ~ '[[:cntrl:]]'
    or v_checkpoint_value ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
  then
    raise exception 'observer_checkpoint_value_invalid'
      using errcode = '22023';
  end if;

  if p_next_checkpoint_observed_at is null then
    raise exception 'observer_checkpoint_timestamp_invalid'
      using errcode = '22023';
  end if;

  if p_next_checkpoint_observed_at is distinct from p_observed_at then
    raise exception 'observer_checkpoint_timestamp_mismatch'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'custody-balance-observer-v1:' ||
      p_custody_account_binding_id::text ||
      ':' ||
      v_observer_kind,
      0
    )
  );

  select checkpoints.*
    into v_checkpoint
  from private.observer_checkpoints as checkpoints
  where checkpoints.custody_account_binding_id = p_custody_account_binding_id
    and checkpoints.observer_kind = v_observer_kind
  for update;

  v_checkpoint_found := found;

  select observations.*
    into v_existing_observation
  from private.external_balance_observations as observations
  where observations.custody_account_binding_id = p_custody_account_binding_id
    and observations.observer_kind = v_observer_kind
    and observations.observation_key = v_observation_key;

  v_existing_observation_found := found;

  if v_existing_observation_found then
    v_existing_observation_exact :=
      v_existing_observation.observed_units = p_observed_atomic_units
      and v_existing_observation.observed_at = p_observed_at
      and v_existing_observation.checkpoint_reference = v_checkpoint_value;

    if not v_existing_observation_exact then
      raise exception 'observation_idempotency_conflict'
        using errcode = '23505';
    end if;
  end if;

  if v_checkpoint_found
    and v_existing_observation_exact
    and (
      v_checkpoint.checkpoint_observed_at > p_observed_at
      or (
        v_checkpoint.checkpoint_observed_at = p_observed_at
        and v_checkpoint.checkpoint_value = v_checkpoint_value
      )
    )
  then
    return query
      select
        v_existing_observation.id,
        false,
        v_checkpoint.id,
        false,
        false,
        v_checkpoint.version;
    return;
  end if;

  if not v_checkpoint_found then
    if p_expected_checkpoint_version <> 0 then
      raise exception 'observer_checkpoint_version_conflict'
        using errcode = '40001';
    end if;

    select recorded.external_balance_observation_id,
           recorded.created
      into v_observation_id,
           v_observation_created
    from private.record_external_balance_observation(
      p_custody_account_binding_id,
      v_observer_kind,
      v_observation_key,
      p_observed_atomic_units,
      p_observed_at,
      v_checkpoint_value
    ) as recorded;

    insert into private.observer_checkpoints (
      custody_account_binding_id,
      observer_kind,
      checkpoint_value,
      checkpoint_observed_at,
      version
    )
    values (
      p_custody_account_binding_id,
      v_observer_kind,
      v_checkpoint_value,
      p_observed_at,
      1
    )
    returning id, version
      into v_checkpoint_id, v_checkpoint_version;

    return query
      select
        v_observation_id,
        v_observation_created,
        v_checkpoint_id,
        true,
        false,
        v_checkpoint_version;
    return;
  end if;

  if p_observed_at < v_checkpoint.checkpoint_observed_at then
    raise exception 'observer_checkpoint_regression'
      using errcode = '22023';
  end if;

  if p_observed_at = v_checkpoint.checkpoint_observed_at then
    raise exception 'observer_checkpoint_position_conflict'
      using errcode = '23505';
  end if;

  if p_expected_checkpoint_version <> v_checkpoint.version then
    raise exception 'observer_checkpoint_version_conflict'
      using errcode = '40001';
  end if;

  select recorded.external_balance_observation_id,
         recorded.created
    into v_observation_id,
         v_observation_created
  from private.record_external_balance_observation(
    p_custody_account_binding_id,
    v_observer_kind,
    v_observation_key,
    p_observed_atomic_units,
    p_observed_at,
    v_checkpoint_value
  ) as recorded;

  update private.observer_checkpoints
  set checkpoint_value = v_checkpoint_value,
      checkpoint_observed_at = p_observed_at,
      version = private.observer_checkpoints.version + 1,
      updated_at = pg_catalog.clock_timestamp()
  where id = v_checkpoint.id
    and version = p_expected_checkpoint_version
  returning id, version
    into v_checkpoint_id, v_checkpoint_version;

  if not found then
    raise exception 'observer_checkpoint_version_conflict'
      using errcode = '40001';
  end if;

  return query
    select
      v_observation_id,
      v_observation_created,
      v_checkpoint_id,
      false,
      true,
      v_checkpoint_version;
end;
$$;

comment on function private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamptz, bigint, text, timestamptz) is
  'Dedicated worker-only SECURITY DEFINER command for atomically recording one safe custody balance observation and creating or advancing the binding-scoped observer checkpoint with advisory locking, exact replay handling, and checkpoint version CAS.';

revoke execute on function private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamptz, bigint, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamptz, bigint, text, timestamptz)
  to custody_observer_worker;
