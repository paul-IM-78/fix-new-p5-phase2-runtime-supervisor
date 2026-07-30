begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.has_column(
  'private',
  'reconciliation_items',
  'scope_kind',
  'reconciliation items expose scope kind'
);

select extensions.has_table(
  'private',
  'reconciliation_item_binding_observations',
  'asset aggregate provenance table exists'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'reconciliation_items'
      and column_name = 'custody_account_binding_id'
      and is_nullable = 'YES'
  )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'private'
        and table_name = 'reconciliation_items'
        and column_name = 'scope_kind'
        and is_nullable = 'NO'
        and column_default = '''BINDING''::text'
    ),
  'binding id is nullable and scope kind defaults to binding'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.reconciliation_items'::regclass
      and conname in (
        'reconciliation_items_scope_kind_check',
        'reconciliation_items_scope_consistency_check',
        'reconciliation_items_observation_shape_check'
      )
    group by conrelid
    having count(*) = 3
  ),
  'reconciliation item scope and observation shape constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'reconciliation_items'
      and indexname in (
        'reconciliation_items_run_asset_aggregate_uidx',
        'reconciliation_items_scope_asset_idx'
      )
    group by schemaname, tablename
    having count(*) = 2
  ),
  'asset aggregate item unique and scope lookup indexes exist'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'reconciliation_item_binding_observations'
      and column_name in (
        'reconciliation_item_id',
        'custody_account_binding_id',
        'external_balance_observation_id',
        'membership_status',
        'created_at'
      )
    group by table_schema, table_name
    having count(*) = 5
  )
    and (
      select count(*)::integer
      from information_schema.columns
      where table_schema = 'private'
        and table_name = 'reconciliation_item_binding_observations'
        and column_name in (
          'reconciliation_item_id',
          'custody_account_binding_id',
          'membership_status',
          'created_at'
        )
        and is_nullable = 'NO'
    ) = 4
    and (
      select count(*)::integer
      from information_schema.columns
      where table_schema = 'private'
        and table_name = 'reconciliation_item_binding_observations'
        and column_name = 'external_balance_observation_id'
        and is_nullable = 'YES'
    ) = 1,
  'provenance table columns and nullability are safe'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.reconciliation_item_binding_observations'::regclass
      and conname in (
        'reconciliation_item_binding_observations_pkey',
        'reconciliation_item_binding_observations_status_check',
        'reconciliation_item_binding_observations_shape_check'
      )
    group by conrelid
    having count(*) = 3
  ),
  'provenance primary key and membership status constraints exist'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_constraint
    where contype = 'f'
      and conrelid = 'private.reconciliation_item_binding_observations'::regclass
      and confdeltype = 'r'
  ) = 3,
  'provenance FKs use ON DELETE RESTRICT'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'reconciliation_item_binding_observations'
      and indexname in (
        'reconciliation_item_binding_observations_pkey',
        'reconciliation_item_binding_observations_item_idx',
        'reconciliation_item_binding_observations_binding_idx',
        'reconciliation_item_binding_observations_observation_idx'
      )
    group by schemaname, tablename
    having count(*) = 4
  ),
  'provenance lookup indexes exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.reconciliation_item_binding_observations'::regclass
      and tgname = 'validate_reconciliation_item_binding_observation'
      and not tgisinternal
  )
    and exists (
      select 1
      from pg_trigger
      where tgrelid = 'private.reconciliation_items'::regclass
        and tgname = 'validate_reconciliation_asset_item_completeness'
        and tgdeferrable
        and tginitdeferred
        and not tgisinternal
    )
    and exists (
      select 1
      from pg_trigger
      where tgrelid = 'private.reconciliation_item_binding_observations'::regclass
        and tgname = 'validate_reconciliation_asset_member_completeness'
        and tgdeferrable
        and tginitdeferred
        and not tgisinternal
    ),
  'provenance and deferred completeness triggers exist'
);

select extensions.ok(
  obj_description('private.reconciliation_item_binding_observations'::regclass, 'pg_class') is not null
    and col_description(
      'private.reconciliation_items'::regclass,
      (
        select attnum
        from pg_attribute
        where attrelid = 'private.reconciliation_items'::regclass
          and attname = 'scope_kind'
      )
    ) is not null
    and obj_description('private.validate_reconciliation_item_binding_observation()'::regprocedure, 'pg_proc') is not null
    and obj_description('private.validate_reconciliation_asset_aggregate_completeness()'::regprocedure, 'pg_proc') is not null,
  'asset aggregate scope objects have comments'
);

select extensions.ok(
  not has_table_privilege('public', 'private.reconciliation_item_binding_observations', 'select')
    and not has_table_privilege('anon', 'private.reconciliation_item_binding_observations', 'select')
    and not has_table_privilege('authenticated', 'private.reconciliation_item_binding_observations', 'select')
    and not has_table_privilege('authenticated', 'private.reconciliation_item_binding_observations', 'insert')
    and not has_table_privilege('authenticated', 'private.reconciliation_item_binding_observations', 'update')
    and not has_table_privilege('authenticated', 'private.reconciliation_item_binding_observations', 'delete'),
  'browser roles cannot access provenance table directly'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'private.validate_reconciliation_item_binding_observation()'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'private.validate_reconciliation_item_binding_observation()'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.validate_reconciliation_item_binding_observation()'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'public',
      'private.validate_reconciliation_asset_aggregate_completeness()'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'private.validate_reconciliation_asset_aggregate_completeness()'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.validate_reconciliation_asset_aggregate_completeness()'::regprocedure,
      'execute'
    ),
  'private asset aggregate validators are not executable by browser roles'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname ~* '(reconciliation|external_balance|external_transaction|observer_checkpoint|observer_checkpoints)'
      and procedures.proname not in (
        'list_admin_reconciliation_items',
        'get_admin_reconciliation_item_detail'
      )
  ) = 0,
  'asset aggregate scope leaves only approved public reconciliation read RPCs'
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
    '00000000-0000-4000-8000-000000550101',
    'P5AGG_ASSET_A',
    'P5AA',
    'P5 Aggregate Asset A',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111171',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000550102',
    'P5AGG_ASSET_B',
    'P5AB',
    'P5 Aggregate Asset B',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111172',
    'ACTIVE'
  );

insert into private.custody_providers (
  id,
  provider_code,
  display_name,
  provider_type,
  supports_balance_observation
)
values (
  '00000000-0000-4000-8000-000000550201',
  'P5AGG_PROVIDER',
  'P5 Aggregate Provider',
  'MPC_CUSTODIAN',
  true
);

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
    '00000000-0000-4000-8000-000000550301',
    '00000000-0000-4000-8000-000000550201',
    '00000000-0000-4000-8000-000000550101',
    'p5agg_collection_a',
    'P5 Aggregate Collection A',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000550302',
    '00000000-0000-4000-8000-000000550201',
    '00000000-0000-4000-8000-000000550101',
    'p5agg_payout_a',
    'P5 Aggregate Payout A',
    'PAYOUT'
  ),
  (
    '00000000-0000-4000-8000-000000550303',
    '00000000-0000-4000-8000-000000550201',
    '00000000-0000-4000-8000-000000550102',
    'p5agg_collection_b',
    'P5 Aggregate Collection B',
    'COLLECTION'
  );

insert into private.external_balance_observations (
  id,
  custody_account_binding_id,
  asset_id,
  observer_kind,
  observation_key,
  observed_units,
  observed_at
)
values
  (
    '00000000-0000-4000-8000-000000550401',
    '00000000-0000-4000-8000-000000550301',
    '00000000-0000-4000-8000-000000550101',
    'BALANCE_OBSERVER',
    'agg.balance:0001',
    60,
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000550402',
    '00000000-0000-4000-8000-000000550302',
    '00000000-0000-4000-8000-000000550101',
    'BALANCE_OBSERVER',
    'agg.balance:0002',
    40,
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000550403',
    '00000000-0000-4000-8000-000000550303',
    '00000000-0000-4000-8000-000000550102',
    'BALANCE_OBSERVER',
    'agg.balance:0003',
    20,
    clock_timestamp()
  );

insert into private.reconciliation_runs (
  id,
  idempotency_key,
  trigger_source,
  status,
  started_at,
  completed_at
)
values
  (
    '00000000-0000-4000-8000-000000550601',
    'agg.run:complete',
    'MANUAL',
    'COMPLETED',
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000550602',
    'agg.run:failed',
    'MANUAL',
    'PARTIAL',
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000550603',
    'agg.run:binding-compat',
    'MANUAL',
    'COMPLETED',
    clock_timestamp(),
    clock_timestamp()
  );

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_items (
      id,
      reconciliation_run_id,
      asset_id,
      scope_kind,
      expected_units,
      observed_units,
      difference_units,
      tolerance_units,
      classification
    )
    values (
      '00000000-0000-4000-8000-000000550701',
      '00000000-0000-4000-8000-000000550601',
      '00000000-0000-4000-8000-000000550101',
      'ASSET_AGGREGATE',
      100,
      100,
      0,
      0,
      'MATCHED'
    );

    insert into private.reconciliation_item_binding_observations (
      reconciliation_item_id,
      custody_account_binding_id,
      external_balance_observation_id,
      membership_status
    )
    values
      (
        '00000000-0000-4000-8000-000000550701',
        '00000000-0000-4000-8000-000000550301',
        '00000000-0000-4000-8000-000000550401',
        'OBSERVED'
      ),
      (
        '00000000-0000-4000-8000-000000550701',
        '00000000-0000-4000-8000-000000550302',
        '00000000-0000-4000-8000-000000550402',
        'OBSERVED'
      );

    set constraints all immediate;
    set constraints all deferred;
  end;
  $$;
  $_$,
  'asset aggregate item accepts null binding and observed membership snapshot'
);

select extensions.is(
  (
    select coalesce(custody_account_binding_id::text, 'NULL') || ',' ||
      coalesce(external_balance_observation_id::text, 'NULL') || ',' ||
      scope_kind
    from private.reconciliation_items
    where id = '00000000-0000-4000-8000-000000550701'
  ),
  'NULL,NULL,ASSET_AGGREGATE',
  'asset aggregate item stores null binding and null single observation'
);

select extensions.is(
  (
    select count(*)::integer
    from private.reconciliation_item_binding_observations
    where reconciliation_item_id = '00000000-0000-4000-8000-000000550701'
      and membership_status = 'OBSERVED'
  ),
  2,
  'asset aggregate provenance stores all observed binding members'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_items (
      reconciliation_run_id,
      custody_account_binding_id,
      asset_id,
      scope_kind,
      expected_units,
      observed_units,
      difference_units,
      tolerance_units,
      classification
    )
    values (
      '00000000-0000-4000-8000-000000550601',
      '00000000-0000-4000-8000-000000550301',
      '00000000-0000-4000-8000-000000550101',
      'ASSET_AGGREGATE',
      100,
      100,
      0,
      0,
      'MATCHED'
    );
    raise exception 'expected asset aggregate binding failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'asset aggregate item rejects non-null binding'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_items (
      reconciliation_run_id,
      asset_id,
      scope_kind,
      expected_units,
      observed_units,
      difference_units,
      tolerance_units,
      classification
    )
    values (
      '00000000-0000-4000-8000-000000550601',
      '00000000-0000-4000-8000-000000550101',
      'ASSET_AGGREGATE',
      100,
      100,
      0,
      0,
      'MATCHED'
    );
    raise exception 'expected duplicate asset aggregate item failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'duplicate run asset aggregate item is blocked'
);

select extensions.lives_ok(
  $_$
  insert into private.reconciliation_items (
    id,
    reconciliation_run_id,
    asset_id,
    scope_kind,
    expected_units,
    tolerance_units,
    classification
  )
  values (
    '00000000-0000-4000-8000-000000550702',
    '00000000-0000-4000-8000-000000550602',
    '00000000-0000-4000-8000-000000550102',
    'ASSET_AGGREGATE',
    20,
    0,
    'OBSERVATION_FAILED'
  )
  $_$,
  'other asset aggregate item is allowed'
);

select extensions.lives_ok(
  $_$
  insert into private.reconciliation_item_binding_observations (
    reconciliation_item_id,
    custody_account_binding_id,
    membership_status
  )
  values (
    '00000000-0000-4000-8000-000000550702',
    '00000000-0000-4000-8000-000000550303',
    'MISSING_OBSERVATION'
  )
  $_$,
  'missing observation member accepts null observation'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_item_binding_observations (
      reconciliation_item_id,
      custody_account_binding_id,
      membership_status
    )
    values (
      '00000000-0000-4000-8000-000000550702',
      '00000000-0000-4000-8000-000000550303',
      'OBSERVATION_FAILED'
    );
    raise exception 'expected duplicate membership failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'duplicate item binding membership is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_item_binding_observations (
      reconciliation_item_id,
      custody_account_binding_id,
      membership_status
    )
    values (
      '00000000-0000-4000-8000-000000550701',
      '00000000-0000-4000-8000-000000550303',
      'OBSERVED'
    );
    raise exception 'expected observed null observation failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'observed member requires observation FK'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_item_binding_observations (
      reconciliation_item_id,
      custody_account_binding_id,
      external_balance_observation_id,
      membership_status
    )
    values (
      '00000000-0000-4000-8000-000000550702',
      '00000000-0000-4000-8000-000000550303',
      '00000000-0000-4000-8000-000000550403',
      'MISSING_OBSERVATION'
    );
    raise exception 'expected missing observation FK failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'missing member rejects observation FK'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_item_binding_observations (
      reconciliation_item_id,
      custody_account_binding_id,
      external_balance_observation_id,
      membership_status
    )
    values (
      '00000000-0000-4000-8000-000000550701',
      '00000000-0000-4000-8000-000000550302',
      '00000000-0000-4000-8000-000000550401',
      'OBSERVED'
    );
    raise exception 'expected observation binding mismatch failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'observation binding must match membership binding'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_item_binding_observations (
      reconciliation_item_id,
      custody_account_binding_id,
      external_balance_observation_id,
      membership_status
    )
    values (
      '00000000-0000-4000-8000-000000550701',
      '00000000-0000-4000-8000-000000550303',
      '00000000-0000-4000-8000-000000550403',
      'OBSERVED'
    );
    raise exception 'expected observation asset mismatch failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'observation asset must match aggregate item asset'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_items (
      reconciliation_run_id,
      asset_id,
      scope_kind,
      external_balance_observation_id,
      expected_units,
      observed_units,
      difference_units,
      tolerance_units,
      classification
    )
    values (
      '00000000-0000-4000-8000-000000550602',
      '00000000-0000-4000-8000-000000550101',
      'ASSET_AGGREGATE',
      '00000000-0000-4000-8000-000000550401',
      100,
      100,
      0,
      0,
      'MATCHED'
    );
    raise exception 'expected asset item single observation failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'asset aggregate item rejects single observation FK'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_items (
      id,
      reconciliation_run_id,
      asset_id,
      scope_kind,
      expected_units,
      observed_units,
      difference_units,
      tolerance_units,
      classification
    )
    values (
      '00000000-0000-4000-8000-000000550704',
      '00000000-0000-4000-8000-000000550602',
      '00000000-0000-4000-8000-000000550101',
      'ASSET_AGGREGATE',
      100,
      100,
      0,
      0,
      'MATCHED'
    );

    insert into private.reconciliation_item_binding_observations (
      reconciliation_item_id,
      custody_account_binding_id,
      membership_status
    )
    values (
      '00000000-0000-4000-8000-000000550704',
      '00000000-0000-4000-8000-000000550301',
      'MISSING_OBSERVATION'
    );

    set constraints all immediate;
    raise exception 'expected incomplete normal classification failure';
  exception
    when check_violation then
      set constraints all deferred;
  end;
  $$;
  $_$,
  'normal aggregate classifications reject incomplete member snapshots'
);

select extensions.lives_ok(
  $_$
  insert into private.reconciliation_items (
    reconciliation_run_id,
    custody_account_binding_id,
    asset_id,
    external_balance_observation_id,
    expected_units,
    observed_units,
    difference_units,
    tolerance_units,
    classification
  )
  values (
    '00000000-0000-4000-8000-000000550603',
    '00000000-0000-4000-8000-000000550301',
    '00000000-0000-4000-8000-000000550101',
    '00000000-0000-4000-8000-000000550401',
    60,
    60,
    0,
    0,
    'MATCHED'
  )
  $_$,
  'binding scoped reconciliation item remains backward compatible'
);

select extensions.is(
  (
    select scope_kind
    from private.reconciliation_items
    where reconciliation_run_id = '00000000-0000-4000-8000-000000550603'
      and custody_account_binding_id = '00000000-0000-4000-8000-000000550301'
  ),
  'BINDING',
  'binding scoped item uses default binding scope'
);

select * from extensions.finish();

rollback;
