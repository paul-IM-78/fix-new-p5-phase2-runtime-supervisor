begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  to_regrole('custody_observer_scope_reader') is not null,
  'scope reader role exists'
);

select extensions.ok(
  (
    select roles.rolcanlogin
      and not roles.rolinherit
      and not roles.rolsuper
      and not roles.rolcreatedb
      and not roles.rolcreaterole
      and not roles.rolreplication
      and not roles.rolbypassrls
    from pg_catalog.pg_roles as roles
    where roles.rolname = 'custody_observer_scope_reader'
  ),
  'scope reader role has login-only non-privileged attributes'
);

select extensions.is(
  (
    select auth_roles.rolpassword
    from pg_catalog.pg_authid as auth_roles
    where auth_roles.rolname = 'custody_observer_scope_reader'
  ),
  null,
  'scope reader role has no stored password'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_auth_members as members
    where members.member = 'custody_observer_scope_reader'::regrole
       or (
         members.roleid = 'custody_observer_scope_reader'::regrole
         and members.member <> 'postgres'::regrole
       )
  ),
  0,
  'scope reader role has no memberships'
);

select extensions.is(
  (
    select count(*)::integer
    from (
      select 1
      from pg_catalog.pg_class as classes
      where classes.relowner = 'custody_observer_scope_reader'::regrole
      union all
      select 1
      from pg_catalog.pg_proc as procedures
      where procedures.proowner = 'custody_observer_scope_reader'::regrole
      union all
      select 1
      from pg_catalog.pg_type as types
      where types.typowner = 'custody_observer_scope_reader'::regrole
      union all
      select 1
      from pg_catalog.pg_namespace as namespaces
      where namespaces.nspowner = 'custody_observer_scope_reader'::regrole
    ) as owned_objects
  ),
  0,
  'scope reader role owns no database objects'
);

select extensions.ok(
  to_regprocedure(
    'private.list_balance_observer_scope_page(uuid, uuid, integer)'
  ) is not null,
  'scope list command exists'
);

select extensions.ok(
  to_regprocedure('private.read_balance_observer_scope(uuid, uuid)') is not null,
  'scope exact refresh command exists'
);

select extensions.is(
  pg_catalog.pg_get_function_identity_arguments(
    'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure
  ),
  'p_after_provider_id uuid, p_after_asset_id uuid, p_scope_limit integer',
  'scope list command has exact identity arguments'
);

select extensions.is(
  pg_catalog.pg_get_function_identity_arguments(
    'private.read_balance_observer_scope(uuid, uuid)'::regprocedure
  ),
  'p_provider_id uuid, p_asset_id uuid',
  'scope exact refresh command has exact identity arguments'
);

select extensions.ok(
  pg_catalog.pg_get_function_result(
    'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure
  ) like 'TABLE(provider_id uuid, provider_code text, provider_type text, supports_balance_observation boolean,%'
    and pg_catalog.pg_get_function_result(
      'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure
    ) like '%expected_checkpoint_version bigint, page_scope_count integer, has_more boolean, next_provider_id uuid, next_asset_id uuid)',
  'scope list command returns the expected safe page row contract'
);

select extensions.ok(
  pg_catalog.pg_get_function_result(
    'private.read_balance_observer_scope(uuid, uuid)'::regprocedure
  ) like 'TABLE(provider_id uuid, provider_code text, provider_type text, supports_balance_observation boolean,%'
    and pg_catalog.pg_get_function_result(
      'private.read_balance_observer_scope(uuid, uuid)'::regprocedure
    ) like '%binding_key text, account_role text, expected_checkpoint_version bigint)',
  'scope exact refresh command returns the expected safe row contract'
);

select extensions.ok(
  (
    select procedures.provolatile = 's'
      and procedures.prosecdef
      and coalesce(array_to_string(procedures.proconfig, ','), '') in (
        'search_path=',
        'search_path=""'
      )
      and procedures.proowner not in (
        'custody_observer_scope_reader'::regrole,
        'custody_observer_worker'::regrole
      )
    from pg_catalog.pg_proc as procedures
    where procedures.oid =
      'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure
  ),
  'scope list command is stable security definer with empty search_path and safe owner'
);

select extensions.ok(
  (
    select procedures.provolatile = 's'
      and procedures.prosecdef
      and coalesce(array_to_string(procedures.proconfig, ','), '') in (
        'search_path=',
        'search_path=""'
      )
      and procedures.proowner not in (
        'custody_observer_scope_reader'::regrole,
        'custody_observer_worker'::regrole
      )
    from pg_catalog.pg_proc as procedures
    where procedures.oid =
      'private.read_balance_observer_scope(uuid, uuid)'::regprocedure
  ),
  'scope exact refresh command is stable security definer with empty search_path and safe owner'
);

select extensions.ok(
  pg_catalog.obj_description(
    'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure,
    'pg_proc'
  ) is not null
    and pg_catalog.obj_description(
      'private.read_balance_observer_scope(uuid, uuid)'::regprocedure,
      'pg_proc'
    ) is not null,
  'scope read commands are documented'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname in (
        'list_balance_observer_scope_page',
        'read_balance_observer_scope'
      )
  ),
  0,
  'scope read commands have no public wrappers'
);

select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure
  ) !~* '\moffset\M'
    and pg_catalog.pg_get_functiondef(
      'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure
    ) !~* '\m(insert|update|delete|truncate|execute|commit|rollback)\M'
    and pg_catalog.pg_get_functiondef(
      'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure
    ) !~* 'pg_advisory',
  'scope list command definition is keyset read-only without OFFSET dynamic SQL locks or DML'
);

select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'private.read_balance_observer_scope(uuid, uuid)'::regprocedure
  ) !~* '\moffset\M'
    and pg_catalog.pg_get_functiondef(
      'private.read_balance_observer_scope(uuid, uuid)'::regprocedure
    ) !~* '\m(insert|update|delete|truncate|execute|commit|rollback)\M'
    and pg_catalog.pg_get_functiondef(
      'private.read_balance_observer_scope(uuid, uuid)'::regprocedure
    ) !~* 'pg_advisory',
  'scope exact refresh command definition is read-only without OFFSET dynamic SQL locks or DML'
);

select extensions.ok(
  pg_catalog.pg_get_function_result(
    'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure
  ) !~* '(display_name|mint_address|raw|checkpoint_value|checkpoint_observed_at|observed_units|observation_key|endpoint|credential|profile|user_id)',
  'scope list command omits forbidden provider asset checkpoint amount and identity fields'
);

select extensions.ok(
  pg_catalog.pg_get_function_result(
    'private.read_balance_observer_scope(uuid, uuid)'::regprocedure
  ) !~* '(display_name|mint_address|raw|checkpoint_value|checkpoint_observed_at|observed_units|observation_key|endpoint|credential|profile|user_id)',
  'scope exact refresh command omits forbidden provider asset checkpoint amount and identity fields'
);

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'baseline scope reader ACL contract passes'
);

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'baseline existing worker ACL contract still passes'
);

select extensions.ok(
  pg_catalog.has_database_privilege(
    'custody_observer_scope_reader',
    pg_catalog.current_database(),
    'connect'
  )
    and not pg_catalog.has_database_privilege(
      'custody_observer_scope_reader',
      pg_catalog.current_database(),
      'connect with grant option'
    )
    and not pg_catalog.has_database_privilege(
      'custody_observer_scope_reader',
      pg_catalog.current_database(),
      'create'
    )
    and not exists (
      select 1
      from pg_catalog.pg_database as databases
      cross join lateral pg_catalog.aclexplode(databases.datacl) as acl
      where databases.datname = pg_catalog.current_database()
        and databases.datacl is not null
        and acl.grantee = 'custody_observer_scope_reader'::regrole
        and acl.privilege_type = 'TEMPORARY'
    ),
  'scope reader has database CONNECT only with no grant option create or direct temp'
);

select extensions.ok(
  pg_catalog.has_schema_privilege(
    'custody_observer_scope_reader',
    'private',
    'usage'
  )
    and not pg_catalog.has_schema_privilege(
      'custody_observer_scope_reader',
      'private',
      'usage with grant option'
    )
    and not pg_catalog.has_schema_privilege(
      'custody_observer_scope_reader',
      'private',
      'create'
    ),
  'scope reader has private schema USAGE only'
);

select extensions.is(
  (
    select count(*)::integer
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
      and pg_catalog.has_table_privilege(
        'custody_observer_scope_reader',
        classes.oid,
        table_privileges.privilege_name
      )
  ),
  0,
  'scope reader has no public or private table privileges'
);

select extensions.is(
  (
    select count(*)::integer
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
      and pg_catalog.has_any_column_privilege(
        'custody_observer_scope_reader',
        classes.oid,
        column_privileges.privilege_name
      )
  ),
  0,
  'scope reader has no public or private column privileges'
);

select extensions.is(
  (
    select count(*)::integer
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
      and pg_catalog.has_sequence_privilege(
        'custody_observer_scope_reader',
        pg_catalog.format('%I.%I', namespaces.nspname, classes.relname),
        sequence_privileges.privilege_name
      )
  ),
  0,
  'scope reader has no public or private sequence privileges'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'custody_observer_scope_reader',
    'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure,
    'execute'
  )
    and pg_catalog.has_function_privilege(
      'custody_observer_scope_reader',
      'private.read_balance_observer_scope(uuid, uuid)'::regprocedure,
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'custody_observer_scope_reader',
      'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure,
      'execute with grant option'
    )
    and not pg_catalog.has_function_privilege(
      'custody_observer_scope_reader',
      'private.read_balance_observer_scope(uuid, uuid)'::regprocedure,
      'execute with grant option'
    ),
  'scope reader can execute exactly the two scope read commands without grant option'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'custody_observer_worker',
    'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure,
    'execute'
  )
    and not pg_catalog.has_function_privilege(
      'custody_observer_worker',
      'private.read_balance_observer_scope(uuid, uuid)'::regprocedure,
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'public',
      'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure,
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure,
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure,
      'execute'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure,
      'execute'
    ),
  'worker public anon authenticated and service_role cannot execute scope list command'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'custody_observer_scope_reader',
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure,
    'execute'
  )
    and not pg_catalog.has_function_privilege(
      'custody_observer_scope_reader',
      'private.assert_custody_observer_scope_reader_role_contract()'::regprocedure,
      'execute'
    ),
  'scope reader cannot execute atomic write command or private assertion'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as procedures
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname in ('private', 'public')
      and procedures.oid not in (
        'private.list_balance_observer_scope_page(uuid, uuid, integer)'::regprocedure,
        'private.read_balance_observer_scope(uuid, uuid)'::regprocedure
      )
      and pg_catalog.has_function_privilege(
        'custody_observer_scope_reader',
        procedures.oid,
        'execute'
      )
  ),
  0,
  'scope reader cannot execute any other public or private function'
);

insert into public.supported_assets (
  id,
  asset_code,
  symbol,
  display_name,
  asset_type,
  decimals,
  mint_address,
  status
)
values
  (
    '00000000-0000-4000-8000-000000740101',
    'P5T04_SCOPE_A',
    'P4SA',
    'P5 T04 Scope Asset A',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000740102',
    'P5T04_SCOPE_B',
    'P4SB',
    'P5 T04 Scope Asset B',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000740103',
    'P5T04_SCOPE_C',
    'P4SC',
    'P5 T04 Scope Asset C',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000740104',
    'P5T04_SCOPE_D',
    'P4SD',
    'P5 T04 Scope Asset D',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  );

insert into private.custody_providers (
  id,
  provider_code,
  display_name,
  provider_type,
  supports_balance_observation,
  supports_transfer_observation,
  supports_transfer_lookup,
  supports_payout_submission,
  supports_webhook_ingestion
)
values
  (
    '00000000-0000-4000-8000-000000740201',
    'P5T04_SCOPE_PROVIDER_A',
    'P5 T04 Scope Provider A',
    'MPC_CUSTODIAN',
    true,
    true,
    false,
    false,
    true
  ),
  (
    '00000000-0000-4000-8000-000000740202',
    'P5T04_SCOPE_PROVIDER_B',
    'P5 T04 Scope Provider B',
    'QUALIFIED_CUSTODIAN',
    true,
    false,
    true,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000740203',
    'P5T04_SCOPE_PROVIDER_NO_BAL',
    'P5 T04 Scope Provider No Balance',
    'MPC_CUSTODIAN',
    false,
    true,
    false,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000740204',
    'P5T04_SCOPE_PROVIDER_DRAFT',
    'P5 T04 Scope Provider Draft',
    'MPC_CUSTODIAN',
    true,
    false,
    false,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000740205',
    'P5T04_SCOPE_PROVIDER_SUSP',
    'P5 T04 Scope Provider Suspended',
    'MPC_CUSTODIAN',
    true,
    false,
    false,
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000740206',
    'P5T04_SCOPE_PROVIDER_RET',
    'P5 T04 Scope Provider Retired',
    'MPC_CUSTODIAN',
    true,
    false,
    false,
    false,
    false
  );

update private.custody_providers
set status = 'APPROVED'
where id in (
  '00000000-0000-4000-8000-000000740201',
  '00000000-0000-4000-8000-000000740202',
  '00000000-0000-4000-8000-000000740203',
  '00000000-0000-4000-8000-000000740205',
  '00000000-0000-4000-8000-000000740206'
);

update private.custody_providers
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000740205';

update private.custody_providers
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000740206';

update private.custody_providers
set status = 'RETIRED'
where id = '00000000-0000-4000-8000-000000740206';

insert into private.custody_account_bindings (
  id,
  custody_provider_id,
  asset_id,
  binding_key,
  display_label,
  account_role
)
values
  (
    '00000000-0000-4000-8000-000000740301',
    '00000000-0000-4000-8000-000000740201',
    '00000000-0000-4000-8000-000000740101',
    'p5t04_scope_a_collection',
    'P5 T04 Scope A Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000740302',
    '00000000-0000-4000-8000-000000740201',
    '00000000-0000-4000-8000-000000740101',
    'p5t04_scope_a_treasury',
    'P5 T04 Scope A Treasury',
    'TREASURY'
  ),
  (
    '00000000-0000-4000-8000-000000740303',
    '00000000-0000-4000-8000-000000740201',
    '00000000-0000-4000-8000-000000740102',
    'p5t04_scope_b_collection',
    'P5 T04 Scope B Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000740304',
    '00000000-0000-4000-8000-000000740202',
    '00000000-0000-4000-8000-000000740101',
    'p5t04_scope_c_collection',
    'P5 T04 Scope C Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000740305',
    '00000000-0000-4000-8000-000000740203',
    '00000000-0000-4000-8000-000000740101',
    'p5t04_scope_provider_not_supported',
    'P5 T04 Scope Provider Not Supported',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000740306',
    '00000000-0000-4000-8000-000000740204',
    '00000000-0000-4000-8000-000000740101',
    'p5t04_scope_provider_draft',
    'P5 T04 Scope Provider Draft',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000740307',
    '00000000-0000-4000-8000-000000740205',
    '00000000-0000-4000-8000-000000740101',
    'p5t04_scope_provider_suspended',
    'P5 T04 Scope Provider Suspended',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000740308',
    '00000000-0000-4000-8000-000000740206',
    '00000000-0000-4000-8000-000000740101',
    'p5t04_scope_provider_retired',
    'P5 T04 Scope Provider Retired',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000740309',
    '00000000-0000-4000-8000-000000740201',
    '00000000-0000-4000-8000-000000740103',
    'p5t04_scope_binding_draft',
    'P5 T04 Scope Binding Draft',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000740310',
    '00000000-0000-4000-8000-000000740201',
    '00000000-0000-4000-8000-000000740103',
    'p5t04_scope_binding_suspended',
    'P5 T04 Scope Binding Suspended',
    'PAYOUT'
  ),
  (
    '00000000-0000-4000-8000-000000740311',
    '00000000-0000-4000-8000-000000740201',
    '00000000-0000-4000-8000-000000740103',
    'p5t04_scope_binding_retired',
    'P5 T04 Scope Binding Retired',
    'TREASURY'
  ),
  (
    '00000000-0000-4000-8000-000000740312',
    '00000000-0000-4000-8000-000000740201',
    '00000000-0000-4000-8000-000000740104',
    'p5t04_scope_asset_suspended',
    'P5 T04 Scope Asset Suspended',
    'COLLECTION'
  );

update private.custody_account_bindings
set status = 'APPROVED'
where id in (
  '00000000-0000-4000-8000-000000740301',
  '00000000-0000-4000-8000-000000740302',
  '00000000-0000-4000-8000-000000740303',
  '00000000-0000-4000-8000-000000740304',
  '00000000-0000-4000-8000-000000740305',
  '00000000-0000-4000-8000-000000740310',
  '00000000-0000-4000-8000-000000740311',
  '00000000-0000-4000-8000-000000740312'
);

update private.custody_account_bindings
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000740310';

update private.custody_account_bindings
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000740311';

update private.custody_account_bindings
set status = 'RETIRED'
where id = '00000000-0000-4000-8000-000000740311';

update public.supported_assets
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000740104';

insert into private.observer_checkpoints (
  id,
  custody_account_binding_id,
  observer_kind,
  checkpoint_value,
  checkpoint_observed_at,
  version
)
values
  (
    '00000000-0000-4000-8000-000000740401',
    '00000000-0000-4000-8000-000000740301',
    'BALANCE_OBSERVER_V1',
    'p5t04-scope-cursor-a',
    '2026-08-02 00:00:00+00'::timestamptz,
    7
  ),
  (
    '00000000-0000-4000-8000-000000740402',
    '00000000-0000-4000-8000-000000740302',
    'TRANSFER_OBSERVER_V1',
    'p5t04-scope-transfer-cursor',
    '2026-08-02 00:00:00+00'::timestamptz,
    11
  );

create temporary table qa_scope_counts_before as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints,
  (select count(*)::bigint from private.reconciliation_runs) as reconciliation_runs,
  (select count(*)::bigint from private.reconciliation_items) as reconciliation_items,
  (select count(*)::bigint from private.custody_config_audit_events) as custody_config_audit_events,
  (select count(*)::bigint from private.ledger_accounts) as ledger_accounts,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries;

create temporary table qa_scope_page_all as
select *
from private.list_balance_observer_scope_page(null, null, 200);

select extensions.is(
  (select count(*)::integer from qa_scope_page_all),
  4,
  'scope list returns all eligible binding rows for all eligible scopes'
);

select extensions.is(
  (select max(page_scope_count) from qa_scope_page_all),
  3,
  'scope list page scope count is based on provider plus asset scopes not binding rows'
);

select extensions.is(
  (
    select string_agg(binding_id::text, ',' order by provider_id, asset_id, binding_id)
    from qa_scope_page_all
  ),
  '00000000-0000-4000-8000-000000740301,00000000-0000-4000-8000-000000740302,00000000-0000-4000-8000-000000740303,00000000-0000-4000-8000-000000740304',
  'scope list filters out ineligible providers bindings and assets'
);

select extensions.ok(
  (
    select every(supports_balance_observation)
      and bool_or(supports_transfer_observation)
      and bool_or(supports_transfer_lookup)
      and bool_or(supports_webhook_ingestion)
    from qa_scope_page_all
  ),
  'scope list returns safe provider capability flags'
);

select extensions.is(
  (
    select string_agg(
      binding_id::text || ':' || expected_checkpoint_version::text,
      ','
      order by binding_id
    )
    from qa_scope_page_all
    where provider_id = '00000000-0000-4000-8000-000000740201'
      and asset_id = '00000000-0000-4000-8000-000000740101'
  ),
  '00000000-0000-4000-8000-000000740301:7,00000000-0000-4000-8000-000000740302:0',
  'scope list maps balance checkpoint version and ignores other observer kinds'
);

select extensions.ok(
  not (select has_more from qa_scope_page_all limit 1)
    and (select next_provider_id is null and next_asset_id is null from qa_scope_page_all limit 1),
  'scope list final large page has no next cursor'
);

create temporary table qa_scope_page_first as
select *
from private.list_balance_observer_scope_page(null, null, 1);

select extensions.is(
  (select count(*)::integer from qa_scope_page_first),
  2,
  'scope list limit one still returns every binding for the selected scope'
);

select extensions.ok(
  (
    select every(page_scope_count = 1)
      and every(has_more)
      and every(next_provider_id = provider_id)
      and every(next_asset_id = asset_id)
    from qa_scope_page_first
  ),
  'scope list repeats stable first-page metadata on every binding row'
);

select extensions.is(
  (
    select string_agg(binding_id::text, ',' order by binding_id)
    from qa_scope_page_first
  ),
  '00000000-0000-4000-8000-000000740301,00000000-0000-4000-8000-000000740302',
  'scope list does not split one provider-asset scope across pages'
);

create temporary table qa_scope_page_second as
select *
from private.list_balance_observer_scope_page(
  '00000000-0000-4000-8000-000000740201',
  '00000000-0000-4000-8000-000000740101',
  1
);

select extensions.is(
  (
    select string_agg(binding_id::text, ',' order by provider_id, asset_id, binding_id)
    from qa_scope_page_second
  ),
  '00000000-0000-4000-8000-000000740303',
  'scope list second page starts strictly after the compound cursor'
);

select extensions.ok(
  (
    select every(page_scope_count = 1)
      and every(has_more)
      and every(next_provider_id = provider_id)
      and every(next_asset_id = asset_id)
    from qa_scope_page_second
  ),
  'scope list second page metadata uses the second page last scope as next cursor'
);

create temporary table qa_scope_page_final as
select *
from private.list_balance_observer_scope_page(
  '00000000-0000-4000-8000-000000740201',
  '00000000-0000-4000-8000-000000740102',
  1
);

select extensions.is(
  (
    select string_agg(binding_id::text, ',' order by provider_id, asset_id, binding_id)
    from qa_scope_page_final
  ),
  '00000000-0000-4000-8000-000000740304',
  'scope list final page returns the remaining scope only'
);

select extensions.ok(
  (
    select every(page_scope_count = 1)
      and not bool_or(has_more)
      and every(next_provider_id is null)
      and every(next_asset_id is null)
    from qa_scope_page_final
  ),
  'scope list final page metadata clears the next cursor'
);

select extensions.is(
  (
    select count(*)::integer
    from private.list_balance_observer_scope_page(
      '00000000-0000-4000-8000-000000740202',
      '00000000-0000-4000-8000-000000740101',
      1
    )
  ),
  0,
  'scope list terminal cursor returns zero rows'
);

select extensions.throws_ok(
  $$select * from private.list_balance_observer_scope_page('00000000-0000-4000-8000-000000740201', null, 1)$$,
  '22023'::character(5),
  'scope_cursor_invalid',
  'scope list rejects partial compound cursor'
);

select extensions.throws_ok(
  $$select * from private.list_balance_observer_scope_page(null, null, null)$$,
  '22023'::character(5),
  'scope_limit_invalid',
  'scope list rejects null limit'
);

select extensions.throws_ok(
  $$select * from private.list_balance_observer_scope_page(null, null, 0)$$,
  '22023'::character(5),
  'scope_limit_invalid',
  'scope list rejects zero limit'
);

select extensions.throws_ok(
  $$select * from private.list_balance_observer_scope_page(null, null, -1)$$,
  '22023'::character(5),
  'scope_limit_invalid',
  'scope list rejects negative limit'
);

select extensions.throws_ok(
  $$select * from private.list_balance_observer_scope_page(null, null, 201)$$,
  '22023'::character(5),
  'scope_limit_invalid',
  'scope list rejects limit above maximum'
);

create temporary table qa_scope_refresh_a as
select *
from private.read_balance_observer_scope(
  '00000000-0000-4000-8000-000000740201',
  '00000000-0000-4000-8000-000000740101'
);

select extensions.is(
  (
    select string_agg(
      binding_id::text || ':' || binding_key || ':' || account_role || ':' ||
        asset_code || ':' || expected_checkpoint_version::text,
      ','
      order by binding_id
    )
    from qa_scope_refresh_a
  ),
  '00000000-0000-4000-8000-000000740301:p5t04_scope_a_collection:COLLECTION:P5T04_SCOPE_A:7,00000000-0000-4000-8000-000000740302:p5t04_scope_a_treasury:TREASURY:P5T04_SCOPE_A:0',
  'scope exact refresh returns only current eligible rows for the requested provider asset'
);

select extensions.is(
  (
    select count(*)::integer
    from private.read_balance_observer_scope(
      '00000000-0000-4000-8000-000000740202',
      '00000000-0000-4000-8000-000000740102'
    )
  ),
  0,
  'scope exact refresh returns zero rows for missing provider asset scope'
);

select extensions.throws_ok(
  $$select * from private.read_balance_observer_scope(null, '00000000-0000-4000-8000-000000740101')$$,
  '22023'::character(5),
  'scope_identity_invalid',
  'scope exact refresh rejects null provider id'
);

select extensions.throws_ok(
  $$select * from private.read_balance_observer_scope('00000000-0000-4000-8000-000000740201', null)$$,
  '22023'::character(5),
  'scope_identity_invalid',
  'scope exact refresh rejects null asset id'
);

update private.custody_account_bindings
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000740302';

select extensions.is(
  (
    select string_agg(binding_id::text, ',' order by binding_id)
    from private.read_balance_observer_scope(
      '00000000-0000-4000-8000-000000740201',
      '00000000-0000-4000-8000-000000740101'
    )
  ),
  '00000000-0000-4000-8000-000000740301',
  'scope exact refresh excludes a binding after current binding suspension'
);

update private.custody_account_bindings
set status = 'APPROVED'
where id = '00000000-0000-4000-8000-000000740302';

update public.supported_assets
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000740101';

select extensions.is(
  (
    select count(*)::integer
    from private.read_balance_observer_scope(
      '00000000-0000-4000-8000-000000740201',
      '00000000-0000-4000-8000-000000740101'
    )
  ),
  0,
  'scope exact refresh returns zero rows after current asset suspension'
);

update public.supported_assets
set status = 'ACTIVE'
where id = '00000000-0000-4000-8000-000000740101';

update private.custody_providers
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000740201';

select extensions.is(
  (
    select count(*)::integer
    from private.read_balance_observer_scope(
      '00000000-0000-4000-8000-000000740201',
      '00000000-0000-4000-8000-000000740101'
    )
  ),
  0,
  'scope exact refresh returns zero rows after current provider suspension'
);

update private.custody_providers
set status = 'APPROVED'
where id = '00000000-0000-4000-8000-000000740201';

select extensions.is(
  (
    select
      balance_observations::text || ',' ||
      observer_checkpoints::text || ',' ||
      reconciliation_runs::text || ',' ||
      reconciliation_items::text || ',' ||
      custody_config_audit_events::text || ',' ||
      ledger_accounts::text || ',' ||
      ledger_journals::text || ',' ||
      ledger_entries::text
    from qa_scope_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_runs)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_items)::text || ',' ||
      (select count(*)::bigint from private.custody_config_audit_events)::text || ',' ||
      (select count(*)::bigint from private.ledger_accounts)::text || ',' ||
      (select count(*)::bigint from private.ledger_journals)::text || ',' ||
      (select count(*)::bigint from private.ledger_entries)::text
  ),
  'scope read commands do not mutate observations checkpoints reconciliation audit or ledger tables'
);

do $$
begin
  execute pg_catalog.format(
    'grant connect on database %I to custody_observer_scope_reader with grant option',
    pg_catalog.current_database()
  );
end;
$$;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects database CONNECT grant option contamination'
);

do $$
begin
  execute pg_catalog.format(
    'revoke connect on database %I from custody_observer_scope_reader',
    pg_catalog.current_database()
  );
  execute pg_catalog.format(
    'grant connect on database %I to custody_observer_scope_reader',
    pg_catalog.current_database()
  );
end;
$$;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after database CONNECT grant option cleanup'
);

do $$
begin
  execute pg_catalog.format(
    'grant temporary on database %I to custody_observer_scope_reader',
    pg_catalog.current_database()
  );
end;
$$;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects direct database TEMP contamination'
);

do $$
begin
  execute pg_catalog.format(
    'revoke temporary on database %I from custody_observer_scope_reader',
    pg_catalog.current_database()
  );
end;
$$;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after direct database TEMP cleanup'
);

grant usage on schema private
  to custody_observer_scope_reader with grant option;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects private schema USAGE grant option contamination'
);

revoke grant option for usage on schema private
  from custody_observer_scope_reader;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after private schema grant option cleanup'
);

grant create on schema public
  to custody_observer_scope_reader;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects public schema CREATE contamination'
);

revoke create on schema public
  from custody_observer_scope_reader;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after public schema CREATE cleanup'
);

grant select on private.custody_providers
  to custody_observer_scope_reader;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects private table SELECT contamination'
);

revoke select on private.custody_providers
  from custody_observer_scope_reader;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after private table SELECT cleanup'
);

create table public.p5t04_scope_reader_column_fixture (
  id integer primary key
);

revoke all on public.p5t04_scope_reader_column_fixture
  from public;

grant select (id) on public.p5t04_scope_reader_column_fixture
  to custody_observer_scope_reader;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects public column SELECT contamination'
);

revoke select (id) on public.p5t04_scope_reader_column_fixture
  from custody_observer_scope_reader;

drop table public.p5t04_scope_reader_column_fixture;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after public column SELECT cleanup'
);

create sequence private.p5t04_scope_reader_sequence_fixture;

grant usage on sequence private.p5t04_scope_reader_sequence_fixture
  to custody_observer_scope_reader;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects private sequence USAGE contamination'
);

revoke usage on sequence private.p5t04_scope_reader_sequence_fixture
  from custody_observer_scope_reader;

drop sequence private.p5t04_scope_reader_sequence_fixture;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after private sequence USAGE cleanup'
);

create function private.p5t04_scope_reader_unrelated_fixture()
returns integer
language sql
stable
set search_path = ''
as $$
  select 1;
$$;

revoke execute on function private.p5t04_scope_reader_unrelated_fixture()
  from public;

grant execute on function private.p5t04_scope_reader_unrelated_fixture()
  to custody_observer_scope_reader;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects unrelated private function EXECUTE contamination'
);

revoke execute on function private.p5t04_scope_reader_unrelated_fixture()
  from custody_observer_scope_reader;

drop function private.p5t04_scope_reader_unrelated_fixture();

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after unrelated private function cleanup'
);

grant execute on function private.record_balance_observation_and_advance_checkpoint(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  bigint,
  text,
  timestamptz
) to custody_observer_scope_reader;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects atomic write command EXECUTE contamination'
);

revoke execute on function private.record_balance_observation_and_advance_checkpoint(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  bigint,
  text,
  timestamptz
) from custody_observer_scope_reader;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after atomic write command cleanup'
);

grant execute on function private.list_balance_observer_scope_page(uuid, uuid, integer)
  to custody_observer_scope_reader with grant option;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects scope list EXECUTE grant option contamination'
);

revoke grant option for execute on function private.list_balance_observer_scope_page(uuid, uuid, integer)
  from custody_observer_scope_reader;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after scope list grant option cleanup'
);

grant execute on function private.read_balance_observer_scope(uuid, uuid)
  to authenticated;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects unexpected refresh command grantee contamination'
);

revoke execute on function private.read_balance_observer_scope(uuid, uuid)
  from authenticated;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after unexpected refresh grantee cleanup'
);

grant authenticated to custody_observer_scope_reader;

select extensions.throws_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  '42501'::character(5),
  'custody_observer_scope_reader_role_contract_invalid',
  'scope reader assertion rejects role membership contamination'
);

revoke authenticated from custody_observer_scope_reader;

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'scope reader assertion passes after role membership cleanup'
);

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'existing worker ACL contract passes after scope reader contamination cleanup'
);

select extensions.lives_ok(
  $$select private.assert_custody_observer_scope_reader_role_contract()$$,
  'final scope reader ACL contract passes'
);

select * from extensions.finish();

rollback;
