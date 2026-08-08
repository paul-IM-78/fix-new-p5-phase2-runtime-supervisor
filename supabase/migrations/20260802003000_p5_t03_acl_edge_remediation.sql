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
      'connect with grant option'
    )
    or pg_catalog.has_database_privilege(
      'custody_observer_worker',
      pg_catalog.current_database(),
      'create'
    )
    or pg_catalog.has_database_privilege(
      'custody_observer_worker',
      pg_catalog.current_database(),
      'create with grant option'
    )
  then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_database as databases
    cross join lateral pg_catalog.aclexplode(databases.datacl) as acl
    where databases.datname = pg_catalog.current_database()
      and databases.datacl is not null
      and acl.grantee = v_worker_oid
      and acl.privilege_type = 'TEMPORARY'
  ) then
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
      'usage with grant option'
    )
    or pg_catalog.has_schema_privilege(
      'custody_observer_worker',
      'private',
      'create'
    )
    or pg_catalog.has_schema_privilege(
      'custody_observer_worker',
      'private',
      'create with grant option'
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
      and (
        pg_catalog.has_schema_privilege(
          'custody_observer_worker',
          namespaces.oid,
          'create'
        )
        or pg_catalog.has_schema_privilege(
          'custody_observer_worker',
          namespaces.oid,
          'create with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_namespace as namespaces
    cross join lateral pg_catalog.aclexplode(namespaces.nspacl) as acl
    where namespaces.nspname !~ '^pg_'
      and namespaces.nspname <> 'information_schema'
      and namespaces.nspacl is not null
      and acl.grantee = v_worker_oid
      and (
        (acl.privilege_type = 'USAGE' and acl.is_grantable)
        or acl.privilege_type = 'CREATE'
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

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedures
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedures.proacl,
        pg_catalog.acldefault('f', procedures.proowner)
      )
    ) as acl
    where procedures.oid = v_atomic_command
      and acl.grantee = v_worker_oid
      and acl.privilege_type = 'EXECUTE'
      and not acl.is_grantable
  )
    or exists (
      select 1
      from pg_catalog.pg_proc as procedures
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedures.proacl,
          pg_catalog.acldefault('f', procedures.proowner)
        )
      ) as acl
      where procedures.oid = v_atomic_command
        and acl.privilege_type = 'EXECUTE'
        and (
          (acl.grantee = v_worker_oid and acl.is_grantable)
          or acl.grantee not in (v_worker_oid, procedures.proowner)
        )
    )
  then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname in ('private', 'public')
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
          'custody_observer_worker',
          classes.oid,
          table_privileges.privilege_name
        )
        or pg_catalog.has_table_privilege(
          'custody_observer_worker',
          classes.oid,
          table_privileges.privilege_name || ' with grant option'
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
          'custody_observer_worker',
          classes.oid,
          column_privileges.privilege_name
        )
        or pg_catalog.has_any_column_privilege(
          'custody_observer_worker',
          classes.oid,
          column_privileges.privilege_name || ' with grant option'
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
          'custody_observer_worker',
          pg_catalog.format('%I.%I', namespaces.nspname, classes.relname),
          sequence_privileges.privilege_name
        )
        or pg_catalog.has_sequence_privilege(
          'custody_observer_worker',
          pg_catalog.format('%I.%I', namespaces.nspname, classes.relname),
          sequence_privileges.privilege_name || ' with grant option'
        )
      )
  ) then
    raise exception 'custody_observer_worker_role_contract_invalid'
      using errcode = '42501';
  end if;
end;
$$;

comment on function private.assert_custody_observer_worker_role_contract() is
  'Private migration/test assertion for the closed-world custody observer worker role ACL contract. The worker may connect, use private schema, and execute exactly the atomic balance observer command; direct TEMP grants, grant options, public/private table, column, or sequence privileges, public functions, unrelated private functions, ownership, membership, database create, and effective schema create fail closed.';

revoke execute on function private.assert_custody_observer_worker_role_contract()
  from public, anon, authenticated, service_role, custody_observer_worker;

select private.assert_custody_observer_worker_role_contract();
