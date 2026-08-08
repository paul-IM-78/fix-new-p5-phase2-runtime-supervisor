revoke create on schema public from public;

create or replace function private.assert_custody_observer_worker_role_contract()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_worker_oid oid;
  v_atomic_command regprocedure :=
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure;
begin
  select roles.oid
    into v_worker_oid
  from pg_catalog.pg_roles as roles
  where roles.rolname = 'custody_observer_worker';

  if v_worker_oid is null then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles as roles
    where roles.oid = v_worker_oid
      and not (
        roles.rolcanlogin
        and not roles.rolinherit
        and not roles.rolsuper
        and not roles.rolcreatedb
        and not roles.rolcreaterole
        and not roles.rolreplication
        and not roles.rolbypassrls
      )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members as members
    where members.member = v_worker_oid
       or (
         members.roleid = v_worker_oid
         and members.member <> 'postgres'::regrole
       )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as classes
    where classes.relowner = v_worker_oid
    union all
    select 1
    from pg_catalog.pg_proc as procedures
    where procedures.proowner = v_worker_oid
    union all
    select 1
    from pg_catalog.pg_type as types
    where types.typowner = v_worker_oid
    union all
    select 1
    from pg_catalog.pg_namespace as namespaces
    where namespaces.nspowner = v_worker_oid
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if not pg_catalog.has_database_privilege(
    'custody_observer_worker',
    pg_catalog.current_database(),
    'connect'
  )
    or pg_catalog.has_database_privilege(
      'custody_observer_worker',
      pg_catalog.current_database(),
      'create'
    )
  then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if not pg_catalog.has_schema_privilege(
    'custody_observer_worker',
    'private',
    'usage'
  )
    or pg_catalog.has_schema_privilege(
      'custody_observer_worker',
      'private',
      'create'
    )
  then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_namespace as namespaces
    where namespaces.nspname !~ '^pg_'
      and namespaces.nspname <> 'information_schema'
      and pg_catalog.has_schema_privilege(
        'custody_observer_worker',
        namespaces.oid,
        'create'
      )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if not pg_catalog.has_function_privilege(
    'custody_observer_worker',
    v_atomic_command,
    'execute'
  )
    or pg_catalog.has_function_privilege(
      'custody_observer_worker',
      v_atomic_command,
      'execute with grant option'
    )
  then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedures
    where procedures.pronamespace = 'private'::regnamespace
      and procedures.oid <> v_atomic_command
      and (
        pg_catalog.has_function_privilege(
          'custody_observer_worker',
          procedures.oid,
          'execute'
        )
        or pg_catalog.has_function_privilege(
          'custody_observer_worker',
          procedures.oid,
          'execute with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedures
    where procedures.pronamespace = 'public'::regnamespace
      and procedures.proname ~* '^(grant|revoke|upsert|transition|create|cancel|reserve|approve|admin_|post|settle|unlock|assign|retire|fail|start)'
      and pg_catalog.has_function_privilege(
        'custody_observer_worker',
        procedures.oid,
        'execute'
      )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as classes
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'private'
      and classes.relkind in ('r', 'p', 'v', 'm', 'f')
      and (
        pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'select'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'insert'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'update'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'delete'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'truncate'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'references'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'trigger'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'select with grant option'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'insert with grant option'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'update with grant option'
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          'delete with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as classes
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'private'
      and classes.relkind = 'S'
      and (
        pg_catalog.has_sequence_privilege(
          'custody_observer_worker',
          pg_catalog.format('%I.%I', namespaces.nspname, classes.relname),
          'usage'
        )
        or pg_catalog.has_sequence_privilege(
          'custody_observer_worker',
          pg_catalog.format('%I.%I', namespaces.nspname, classes.relname),
          'select'
        )
        or pg_catalog.has_sequence_privilege(
          'custody_observer_worker',
          pg_catalog.format('%I.%I', namespaces.nspname, classes.relname),
          'update'
        )
        or pg_catalog.has_sequence_privilege(
          'custody_observer_worker',
          pg_catalog.format('%I.%I', namespaces.nspname, classes.relname),
          'usage with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;
end;
$$;

comment on function private.assert_custody_observer_worker_role_contract() is
  'Private migration/test assertion for the effective custody observer worker role ACL contract. The worker may connect, use private schema, and execute exactly the atomic balance observer command; broad table, sequence, function, ownership, membership, database create, schema create, or grant-option privileges fail closed.';

revoke execute on function private.assert_custody_observer_worker_role_contract()
  from public, anon, authenticated, service_role, custody_observer_worker;

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

  if v_checkpoint_found
    and not v_observation_created
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
        v_observation_id,
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
  'Dedicated worker-only SECURITY DEFINER command for atomically recording one safe custody balance observation and creating or advancing the binding-scoped observer checkpoint with advisory locking, current observability validation on every success path, exact replay handling, and checkpoint version CAS.';

revoke execute on function private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamptz, bigint, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamptz, bigint, text, timestamptz)
  to custody_observer_worker;

select private.assert_custody_observer_worker_role_contract();
