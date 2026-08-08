do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles as roles
    where roles.rolname = 'custody_observer_scope_reader'
  ) then
    create role custody_observer_scope_reader
      with login
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end;
$$;

do $$
begin
  execute pg_catalog.format(
    'grant connect on database %I to custody_observer_scope_reader',
    pg_catalog.current_database()
  );
end;
$$;

grant usage on schema private
  to custody_observer_scope_reader;

create index custody_account_bindings_balance_observer_scope_idx
  on private.custody_account_bindings (
    custody_provider_id,
    asset_id,
    id
  )
  where status = 'APPROVED';

create or replace function private.list_balance_observer_scope_page(
  p_after_provider_id uuid default null,
  p_after_asset_id uuid default null,
  p_scope_limit integer default 50
)
returns table (
  provider_id uuid,
  provider_code text,
  provider_type text,
  supports_balance_observation boolean,
  supports_transfer_observation boolean,
  supports_transfer_lookup boolean,
  supports_payout_submission boolean,
  supports_webhook_ingestion boolean,
  asset_id uuid,
  asset_code text,
  binding_id uuid,
  binding_key text,
  account_role text,
  expected_checkpoint_version bigint,
  page_scope_count integer,
  has_more boolean,
  next_provider_id uuid,
  next_asset_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (p_after_provider_id is null) is distinct from (p_after_asset_id is null) then
    raise exception 'scope_cursor_invalid'
      using errcode = '22023';
  end if;

  if p_scope_limit is null
    or p_scope_limit < 1
    or p_scope_limit > 200
  then
    raise exception 'scope_limit_invalid'
      using errcode = '22023';
  end if;

  return query
    with eligible_scope_keys as (
      select distinct
        providers.id as provider_id,
        assets.id as asset_id
      from private.custody_providers as providers
      join private.custody_account_bindings as bindings
        on bindings.custody_provider_id = providers.id
      join public.supported_assets as assets
        on assets.id = bindings.asset_id
      where providers.status = 'APPROVED'
        and providers.supports_balance_observation
        and bindings.status = 'APPROVED'
        and assets.status = 'ACTIVE'
    ),
    cursor_scope_keys as (
      select
        scope_keys.provider_id,
        scope_keys.asset_id
      from eligible_scope_keys as scope_keys
      where p_after_provider_id is null
         or (scope_keys.provider_id, scope_keys.asset_id) >
            (p_after_provider_id, p_after_asset_id)
      order by scope_keys.provider_id, scope_keys.asset_id
      limit p_scope_limit + 1
    ),
    numbered_scope_keys as (
      select
        cursor_scope_keys.provider_id,
        cursor_scope_keys.asset_id,
        pg_catalog.row_number() over (
          order by cursor_scope_keys.provider_id, cursor_scope_keys.asset_id
        )::integer as scope_row_number
      from cursor_scope_keys
    ),
    page_scope_keys as (
      select
        numbered_scope_keys.provider_id,
        numbered_scope_keys.asset_id,
        numbered_scope_keys.scope_row_number
      from numbered_scope_keys
      where numbered_scope_keys.scope_row_number <= p_scope_limit
    ),
    page_metadata as (
      select
        pg_catalog.count(*)::integer as page_scope_count,
        exists (
          select 1
          from numbered_scope_keys
          where numbered_scope_keys.scope_row_number = p_scope_limit + 1
        ) as has_more
      from page_scope_keys
    ),
    last_page_scope as (
      select
        page_scope_keys.provider_id,
        page_scope_keys.asset_id
      from page_scope_keys
      order by page_scope_keys.provider_id desc, page_scope_keys.asset_id desc
      limit 1
    )
    select
      providers.id,
      providers.provider_code,
      providers.provider_type,
      providers.supports_balance_observation,
      providers.supports_transfer_observation,
      providers.supports_transfer_lookup,
      providers.supports_payout_submission,
      providers.supports_webhook_ingestion,
      assets.id,
      assets.asset_code,
      bindings.id,
      bindings.binding_key,
      bindings.account_role,
      coalesce(checkpoints.version, 0::bigint),
      page_metadata.page_scope_count,
      page_metadata.has_more,
      case
        when page_metadata.has_more then last_page_scope.provider_id
        else null::uuid
      end,
      case
        when page_metadata.has_more then last_page_scope.asset_id
        else null::uuid
      end
    from page_scope_keys
    join private.custody_providers as providers
      on providers.id = page_scope_keys.provider_id
    join public.supported_assets as assets
      on assets.id = page_scope_keys.asset_id
    join private.custody_account_bindings as bindings
      on bindings.custody_provider_id = providers.id
     and bindings.asset_id = assets.id
     and bindings.status = 'APPROVED'
    left join private.observer_checkpoints as checkpoints
      on checkpoints.custody_account_binding_id = bindings.id
     and checkpoints.observer_kind = 'BALANCE_OBSERVER_V1'
    cross join page_metadata
    left join last_page_scope
      on true
    where providers.status = 'APPROVED'
      and providers.supports_balance_observation
      and assets.status = 'ACTIVE'
    order by providers.id, assets.id, bindings.id;
end;
$$;

comment on function private.list_balance_observer_scope_page(uuid, uuid, integer) is
  'Dedicated scope-reader SECURITY DEFINER read command for deterministic provider-plus-asset keyset custody balance observer scope discovery. It returns eligible binding rows with safe provider, asset, capability, checkpoint-version, and page metadata only.';

create or replace function private.read_balance_observer_scope(
  p_provider_id uuid,
  p_asset_id uuid
)
returns table (
  provider_id uuid,
  provider_code text,
  provider_type text,
  supports_balance_observation boolean,
  supports_transfer_observation boolean,
  supports_transfer_lookup boolean,
  supports_payout_submission boolean,
  supports_webhook_ingestion boolean,
  asset_id uuid,
  asset_code text,
  binding_id uuid,
  binding_key text,
  account_role text,
  expected_checkpoint_version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_provider_id is null
    or p_asset_id is null
  then
    raise exception 'scope_identity_invalid'
      using errcode = '22023';
  end if;

  return query
    select
      providers.id,
      providers.provider_code,
      providers.provider_type,
      providers.supports_balance_observation,
      providers.supports_transfer_observation,
      providers.supports_transfer_lookup,
      providers.supports_payout_submission,
      providers.supports_webhook_ingestion,
      assets.id,
      assets.asset_code,
      bindings.id,
      bindings.binding_key,
      bindings.account_role,
      coalesce(checkpoints.version, 0::bigint)
    from private.custody_providers as providers
    join private.custody_account_bindings as bindings
      on bindings.custody_provider_id = providers.id
    join public.supported_assets as assets
      on assets.id = bindings.asset_id
    left join private.observer_checkpoints as checkpoints
      on checkpoints.custody_account_binding_id = bindings.id
     and checkpoints.observer_kind = 'BALANCE_OBSERVER_V1'
    where providers.id = p_provider_id
      and assets.id = p_asset_id
      and providers.status = 'APPROVED'
      and providers.supports_balance_observation
      and bindings.status = 'APPROVED'
      and assets.status = 'ACTIVE'
    order by providers.id, assets.id, bindings.id;
end;
$$;

comment on function private.read_balance_observer_scope(uuid, uuid) is
  'Dedicated scope-reader SECURITY DEFINER exact provider-plus-asset read command for refreshing current custody balance observer scope after checkpoint conflicts. It returns safe eligible binding rows and latest checkpoint versions only.';

revoke execute on function private.list_balance_observer_scope_page(uuid, uuid, integer)
  from public, anon, authenticated, service_role, custody_observer_worker;

revoke execute on function private.read_balance_observer_scope(uuid, uuid)
  from public, anon, authenticated, service_role, custody_observer_worker;

grant execute on function private.list_balance_observer_scope_page(uuid, uuid, integer)
  to custody_observer_scope_reader;

grant execute on function private.read_balance_observer_scope(uuid, uuid)
  to custody_observer_scope_reader;

create or replace function private.assert_custody_observer_scope_reader_role_contract()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reader_oid oid;
  v_scope_list_command regprocedure :=
    'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure;
  v_scope_refresh_command regprocedure :=
    'private.read_balance_observer_scope(uuid, uuid)'::regprocedure;
  v_atomic_command regprocedure :=
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure;
begin
  select roles.oid
    into v_reader_oid
  from pg_catalog.pg_roles as roles
  where roles.rolname = 'custody_observer_scope_reader';

  if v_reader_oid is null then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles as roles
    where roles.oid = v_reader_oid
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
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_authid as auth_roles
    where auth_roles.oid = v_reader_oid
      and auth_roles.rolpassword is not null
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members as members
    where members.member = v_reader_oid
       or (
         members.roleid = v_reader_oid
         and members.member <> 'postgres'::regrole
       )
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as classes
    where classes.relowner = v_reader_oid
    union all
    select 1
    from pg_catalog.pg_proc as procedures
    where procedures.proowner = v_reader_oid
    union all
    select 1
    from pg_catalog.pg_type as types
    where types.typowner = v_reader_oid
    union all
    select 1
    from pg_catalog.pg_namespace as namespaces
    where namespaces.nspowner = v_reader_oid
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if not pg_catalog.has_database_privilege(
    'custody_observer_scope_reader',
    pg_catalog.current_database(),
    'connect'
  )
    or pg_catalog.has_database_privilege(
      'custody_observer_scope_reader',
      pg_catalog.current_database(),
      'connect with grant option'
    )
    or pg_catalog.has_database_privilege(
      'custody_observer_scope_reader',
      pg_catalog.current_database(),
      'create'
    )
    or pg_catalog.has_database_privilege(
      'custody_observer_scope_reader',
      pg_catalog.current_database(),
      'create with grant option'
    )
  then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_database as databases
    cross join lateral pg_catalog.aclexplode(databases.datacl) as acl
    where databases.datname = pg_catalog.current_database()
      and databases.datacl is not null
      and acl.grantee = v_reader_oid
      and acl.privilege_type = 'TEMPORARY'
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if not pg_catalog.has_schema_privilege(
    'custody_observer_scope_reader',
    'private',
    'usage'
  )
    or pg_catalog.has_schema_privilege(
      'custody_observer_scope_reader',
      'private',
      'usage with grant option'
    )
    or pg_catalog.has_schema_privilege(
      'custody_observer_scope_reader',
      'private',
      'create'
    )
    or pg_catalog.has_schema_privilege(
      'custody_observer_scope_reader',
      'private',
      'create with grant option'
    )
  then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_namespace as namespaces
    where namespaces.nspname !~ '^pg_'
      and namespaces.nspname <> 'information_schema'
      and (
        pg_catalog.has_schema_privilege(
          'custody_observer_scope_reader',
          namespaces.oid,
          'create'
        )
        or pg_catalog.has_schema_privilege(
          'custody_observer_scope_reader',
          namespaces.oid,
          'create with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_namespace as namespaces
    cross join lateral pg_catalog.aclexplode(namespaces.nspacl) as acl
    where namespaces.nspname !~ '^pg_'
      and namespaces.nspname <> 'information_schema'
      and namespaces.nspacl is not null
      and acl.grantee = v_reader_oid
      and (
        (acl.privilege_type = 'USAGE' and acl.is_grantable)
        or acl.privilege_type = 'CREATE'
      )
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if not pg_catalog.has_function_privilege(
    'custody_observer_scope_reader',
    v_scope_list_command,
    'execute'
  )
    or pg_catalog.has_function_privilege(
      'custody_observer_scope_reader',
      v_scope_list_command,
      'execute with grant option'
    )
    or not pg_catalog.has_function_privilege(
      'custody_observer_scope_reader',
      v_scope_refresh_command,
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'custody_observer_scope_reader',
      v_scope_refresh_command,
      'execute with grant option'
    )
    or pg_catalog.has_function_privilege(
      'custody_observer_scope_reader',
      v_atomic_command,
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'custody_observer_scope_reader',
      v_atomic_command,
      'execute with grant option'
    )
  then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedures
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedures.proacl,
        pg_catalog.acldefault('f', procedures.proowner)
      )
    ) as acl
    where procedures.oid in (v_scope_list_command, v_scope_refresh_command)
      and acl.privilege_type = 'EXECUTE'
      and (
        (acl.grantee = v_reader_oid and acl.is_grantable)
        or acl.grantee not in (v_reader_oid, procedures.proowner)
      )
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedures
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedures.proacl,
        pg_catalog.acldefault('f', procedures.proowner)
      )
    ) as acl
    where procedures.oid = v_scope_list_command
      and acl.grantee = v_reader_oid
      and acl.privilege_type = 'EXECUTE'
      and not acl.is_grantable
  )
    or not exists (
      select 1
      from pg_catalog.pg_proc as procedures
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedures.proacl,
          pg_catalog.acldefault('f', procedures.proowner)
        )
      ) as acl
      where procedures.oid = v_scope_refresh_command
        and acl.grantee = v_reader_oid
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    )
  then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname in ('private', 'public')
      and procedures.oid not in (v_scope_list_command, v_scope_refresh_command)
      and (
        pg_catalog.has_function_privilege(
          'custody_observer_scope_reader',
          procedures.oid,
          'execute'
        )
        or pg_catalog.has_function_privilege(
          'custody_observer_scope_reader',
          procedures.oid,
          'execute with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as classes
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
    cross join (
      values
        ('select'),
        ('insert'),
        ('update'),
        ('delete'),
        ('truncate'),
        ('references'),
        ('trigger')
    ) as table_privileges(privilege_name)
    where namespaces.nspname in ('private', 'public')
      and classes.relkind in ('r', 'p', 'v', 'm', 'f')
      and (
        pg_catalog.has_table_privilege(
          'custody_observer_scope_reader',
          classes.oid,
          table_privileges.privilege_name
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_scope_reader',
          classes.oid,
          table_privileges.privilege_name || ' with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as classes
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
    cross join (
      values
        ('select'),
        ('insert'),
        ('update'),
        ('references')
    ) as column_privileges(privilege_name)
    where namespaces.nspname in ('private', 'public')
      and classes.relkind in ('r', 'p', 'v', 'm', 'f')
      and (
        pg_catalog.has_any_column_privilege(
          'custody_observer_scope_reader',
          classes.oid,
          column_privileges.privilege_name
        )
        or pg_catalog.has_any_column_privilege(
          'custody_observer_scope_reader',
          classes.oid,
          column_privileges.privilege_name || ' with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as classes
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
    cross join (
      values
        ('usage'),
        ('select'),
        ('update')
    ) as sequence_privileges(privilege_name)
    where namespaces.nspname in ('private', 'public')
      and classes.relkind = 'S'
      and (
        pg_catalog.has_sequence_privilege(
          'custody_observer_scope_reader',
          pg_catalog.format('%I.%I', namespaces.nspname, classes.relname),
          sequence_privileges.privilege_name
        )
        or pg_catalog.has_sequence_privilege(
          'custody_observer_scope_reader',
          pg_catalog.format('%I.%I', namespaces.nspname, classes.relname),
          sequence_privileges.privilege_name || ' with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_scope_reader_role_contract_invalid'
      using errcode = '42501';
  end if;
end;
$$;

comment on function private.assert_custody_observer_scope_reader_role_contract() is
  'Private migration/test assertion for the closed-world custody observer scope reader ACL contract. The reader may connect, use private schema, and execute exactly the two balance observer scope read commands; write commands, direct data privileges, grant options, ownership, membership, unrelated functions, and effective schema create fail closed.';

revoke execute on function private.assert_custody_observer_scope_reader_role_contract()
  from public, anon, authenticated, service_role, custody_observer_worker,
       custody_observer_scope_reader;

select private.assert_custody_observer_scope_reader_role_contract();
select private.assert_custody_observer_worker_role_contract();
