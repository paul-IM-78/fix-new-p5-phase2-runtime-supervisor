begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.has_table(
  'private',
  'external_balance_observations',
  'external balance observations table exists'
);

select extensions.has_table(
  'private',
  'external_transaction_observations',
  'external transaction observations table exists'
);

select extensions.has_table(
  'private',
  'reconciliation_runs',
  'reconciliation runs table exists'
);

select extensions.has_table(
  'private',
  'reconciliation_items',
  'reconciliation items table exists'
);

select extensions.has_table(
  'private',
  'observer_checkpoints',
  'observer checkpoints table exists'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'external_balance_observations',
        'external_transaction_observations',
        'reconciliation_runs',
        'reconciliation_items',
        'observer_checkpoints',
        'reconciliation_resolutions',
        'reconciliation_discrepancies'
      )
  ),
  'reconciliation tables are not exposed in public schema'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.tables
    where table_schema = 'private'
      and table_name in (
        'reconciliation_resolutions',
        'reconciliation_discrepancies'
      )
  ),
  'resolution and discrepancy tables are deferred'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'external_balance_observations'
      and column_name in (
        'id',
        'custody_account_binding_id',
        'asset_id',
        'observer_kind',
        'observation_key',
        'observed_units',
        'checkpoint_reference',
        'observed_at',
        'created_at'
      )
    group by table_schema, table_name
    having count(*) = 9
  ),
  'balance observation safe columns exist'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'external_transaction_observations'
      and column_name in (
        'id',
        'custody_account_binding_id',
        'asset_id',
        'observer_kind',
        'external_event_key',
        'direction',
        'external_status',
        'amount_units',
        'confirmation_context',
        'finalized_at',
        'observed_at',
        'created_at'
      )
    group by table_schema, table_name
    having count(*) = 12
  ),
  'transaction observation safe columns exist'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'reconciliation_runs'
      and column_name in (
        'id',
        'idempotency_key',
        'trigger_source',
        'status',
        'requested_by_profile_id',
        'started_at',
        'completed_at',
        'failure_code',
        'created_at'
      )
    group by table_schema, table_name
    having count(*) = 9
  ),
  'reconciliation run safe columns exist'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'reconciliation_items'
      and column_name in (
        'id',
        'reconciliation_run_id',
        'scope_kind',
        'custody_account_binding_id',
        'asset_id',
        'external_balance_observation_id',
        'expected_units',
        'observed_units',
        'difference_units',
        'tolerance_units',
        'classification',
        'created_at'
      )
    group by table_schema, table_name
    having count(*) = 12
  ),
  'reconciliation item safe columns exist'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'observer_checkpoints'
      and column_name in (
        'id',
        'custody_account_binding_id',
        'observer_kind',
        'checkpoint_value',
        'checkpoint_observed_at',
        'version',
        'created_at',
        'updated_at'
      )
    group by table_schema, table_name
    having count(*) = 8
  )
    and (
      select count(*)::integer
      from pg_constraint
      where contype = 'p'
        and conrelid in (
          'private.external_balance_observations'::regclass,
          'private.external_transaction_observations'::regclass,
          'private.reconciliation_runs'::regclass,
          'private.reconciliation_items'::regclass,
          'private.observer_checkpoints'::regclass
        )
    ) = 5
    and (
      select count(*)::integer
      from information_schema.columns
      where table_schema = 'private'
        and (
          (
            table_name = 'external_balance_observations'
            and column_name in (
              'id',
              'custody_account_binding_id',
              'asset_id',
              'observer_kind',
              'observation_key',
              'observed_units',
              'observed_at',
              'created_at'
            )
          )
          or (
            table_name = 'external_transaction_observations'
            and column_name in (
              'id',
              'custody_account_binding_id',
              'asset_id',
              'observer_kind',
              'external_event_key',
              'direction',
              'external_status',
              'amount_units',
              'observed_at',
              'created_at'
            )
          )
          or (
            table_name = 'reconciliation_runs'
            and column_name in (
              'id',
              'idempotency_key',
              'trigger_source',
              'status',
              'created_at'
            )
          )
          or (
            table_name = 'reconciliation_items'
            and column_name in (
              'id',
              'reconciliation_run_id',
              'scope_kind',
              'asset_id',
              'expected_units',
              'tolerance_units',
              'classification',
              'created_at'
            )
          )
          or (
            table_name = 'observer_checkpoints'
            and column_name in (
              'id',
              'custody_account_binding_id',
              'observer_kind',
              'checkpoint_value',
              'checkpoint_observed_at',
              'version',
              'created_at',
              'updated_at'
            )
          )
        )
        and is_nullable = 'NO'
    ) = 39
    and (
      select count(*)::integer
      from information_schema.columns
      where table_schema = 'private'
        and (
          (table_name = 'external_balance_observations' and column_name = 'checkpoint_reference')
          or (table_name = 'external_transaction_observations' and column_name in ('confirmation_context', 'finalized_at'))
          or (table_name = 'reconciliation_runs' and column_name in ('requested_by_profile_id', 'started_at', 'completed_at', 'failure_code'))
          or (table_name = 'reconciliation_items' and column_name in ('custody_account_binding_id', 'external_balance_observation_id', 'observed_units', 'difference_units'))
        )
        and is_nullable = 'YES'
    ) = 11
    and (
      select count(*)::integer
      from information_schema.columns
      where table_schema = 'private'
        and table_name in (
          'external_balance_observations',
          'external_transaction_observations',
          'reconciliation_runs',
          'reconciliation_items',
          'observer_checkpoints'
        )
        and column_name = 'id'
        and data_type = 'uuid'
        and column_default like '%gen_random_uuid%'
    ) = 5
    and (
      select count(*)::integer
      from information_schema.columns
      where table_schema = 'private'
        and table_name in (
          'external_balance_observations',
          'external_transaction_observations',
          'reconciliation_runs',
          'reconciliation_items',
          'observer_checkpoints'
        )
        and column_name = 'created_at'
        and data_type = 'timestamp with time zone'
        and column_default like '%clock_timestamp%'
    ) = 5
    and (
      select column_default
      from information_schema.columns
      where table_schema = 'private'
        and table_name = 'observer_checkpoints'
        and column_name = 'updated_at'
    ) like '%clock_timestamp%'
    and (
      select column_default
      from information_schema.columns
      where table_schema = 'private'
        and table_name = 'reconciliation_runs'
        and column_name = 'status'
    ) = '''PENDING''::text'
    and (
      select column_default
      from information_schema.columns
      where table_schema = 'private'
        and table_name = 'reconciliation_items'
        and column_name = 'tolerance_units'
    ) = '0'
    and (
      select column_default
      from information_schema.columns
      where table_schema = 'private'
        and table_name = 'reconciliation_items'
        and column_name = 'scope_kind'
    ) = '''BINDING''::text'
    and (
      select column_default
      from information_schema.columns
      where table_schema = 'private'
        and table_name = 'observer_checkpoints'
        and column_name = 'version'
    ) = '1'
    and (
      select count(*)::integer
      from information_schema.columns
      where table_schema = 'private'
        and table_name in (
          'external_balance_observations',
          'reconciliation_items'
        )
        and column_name in (
          'observed_units',
          'expected_units',
          'difference_units',
          'tolerance_units'
        )
        and data_type = 'numeric'
        and domain_name is null
    ) = 5,
  'observer checkpoint safe columns plus PK, nullability, defaults, and amount types exist'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name in (
        'external_balance_observations',
        'external_transaction_observations',
        'reconciliation_runs',
        'reconciliation_items',
        'observer_checkpoints'
      )
      and lower(column_name) in (
        'email',
        'password',
        'cookie',
        'token',
        'jwt',
        'totp_secret',
        'private_key',
        'mnemonic',
        'seed_phrase',
        'wallet_address',
        'deposit_address',
        'withdrawal_address',
        'provider_account_id',
        'external_account_id',
        'raw_payload',
        'payload',
        'metadata',
        'api_key',
        'api_secret',
        'secret_key',
        'signature'
      )
  ),
  'reconciliation core tables exclude credential, raw payload, and wallet address columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_type as types
    join pg_namespace as namespaces
      on namespaces.oid = types.typnamespace
    where namespaces.nspname = 'private'
      and types.typname = 'positive_atomic_units'
  ),
  'existing positive atomic unit domain remains available'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'external_transaction_observations'
      and column_name = 'amount_units'
      and udt_schema = 'pg_catalog'
      and udt_name = 'numeric'
      and domain_schema = 'private'
      and domain_name = 'positive_atomic_units'
  ),
  'transaction observations reuse positive atomic unit domain'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'external_balance_observations'
      and column_name = 'observed_units'
      and data_type = 'numeric'
      and domain_name is null
  ),
  'balance observations use inline non-negative numeric contract to allow zero'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.external_balance_observations'::regclass
      and conname in (
        'external_balance_observations_observer_kind_check',
        'external_balance_observations_observation_key_check',
        'external_balance_observations_units_check',
        'external_balance_observations_checkpoint_reference_check',
        'external_balance_observations_binding_observer_key_uidx',
        'external_balance_observations_binding_asset_uidx'
      )
    group by conrelid
    having count(*) = 6
  ),
  'balance observation constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.external_transaction_observations'::regclass
      and conname in (
        'external_transaction_observations_observer_kind_check',
        'external_transaction_observations_event_key_check',
        'external_transaction_observations_direction_check',
        'external_transaction_observations_status_check',
        'external_transaction_observations_confirmation_context_check',
        'external_transaction_observations_finality_check',
        'external_transaction_observations_binding_event_uidx'
      )
    group by conrelid
    having count(*) = 7
  ),
  'transaction observation constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.reconciliation_runs'::regclass
      and conname in (
        'reconciliation_runs_idempotency_key_check',
        'reconciliation_runs_trigger_source_check',
        'reconciliation_runs_status_check',
        'reconciliation_runs_failure_code_check',
        'reconciliation_runs_time_order_check',
        'reconciliation_runs_status_shape_check'
      )
    group by conrelid
    having count(*) = 6
  ),
  'reconciliation run constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.reconciliation_items'::regclass
      and conname in (
        'reconciliation_items_balance_observation_fk',
        'reconciliation_items_run_binding_asset_uidx',
        'reconciliation_items_scope_kind_check',
        'reconciliation_items_scope_consistency_check',
        'reconciliation_items_classification_check',
        'reconciliation_items_expected_units_check',
        'reconciliation_items_observed_units_check',
        'reconciliation_items_difference_units_check',
        'reconciliation_items_tolerance_units_check',
        'reconciliation_items_observation_shape_check',
        'reconciliation_items_difference_calculation_check',
        'reconciliation_items_matched_check',
        'reconciliation_items_within_tolerance_check',
        'reconciliation_items_mismatch_check'
      )
    group by conrelid
    having count(*) = 14
  ),
  'reconciliation item constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.observer_checkpoints'::regclass
      and conname in (
        'observer_checkpoints_observer_kind_check',
        'observer_checkpoints_checkpoint_value_check',
        'observer_checkpoints_version_check',
        'observer_checkpoints_binding_kind_uidx'
      )
    group by conrelid
    having count(*) = 4
  ),
  'observer checkpoint constraints exist'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_constraint
    where contype = 'f'
      and conrelid in (
        'private.external_balance_observations'::regclass,
        'private.external_transaction_observations'::regclass,
        'private.reconciliation_runs'::regclass,
        'private.reconciliation_items'::regclass,
        'private.observer_checkpoints'::regclass
      )
      and confdeltype = 'r'
  ) = 10,
  'new reconciliation FKs use ON DELETE RESTRICT'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'external_balance_observations'
      and indexname in (
        'external_balance_observations_binding_observer_key_uidx',
        'external_balance_observations_binding_asset_uidx',
        'external_balance_observations_binding_observed_idx',
        'external_balance_observations_asset_observed_idx'
      )
    group by schemaname, tablename
    having count(*) = 4
  )
    and exists (
      select 1
      from pg_indexes
      where schemaname = 'private'
        and tablename = 'external_transaction_observations'
        and indexname in (
          'external_transaction_observations_binding_event_uidx',
          'external_transaction_observations_binding_observed_idx',
          'external_transaction_observations_status_idx'
        )
      group by schemaname, tablename
      having count(*) = 3
    )
    and exists (
      select 1
      from pg_indexes
      where schemaname = 'private'
        and tablename = 'reconciliation_runs'
        and indexname in (
          'reconciliation_runs_idempotency_key_key',
          'reconciliation_runs_status_created_idx'
        )
      group by schemaname, tablename
      having count(*) = 2
    )
    and exists (
      select 1
      from pg_indexes
      where schemaname = 'private'
        and tablename = 'reconciliation_items'
        and indexname in (
          'reconciliation_items_run_binding_asset_uidx',
          'reconciliation_items_run_asset_aggregate_uidx',
          'reconciliation_items_run_idx',
          'reconciliation_items_classification_idx',
          'reconciliation_items_binding_asset_idx',
          'reconciliation_items_scope_asset_idx'
        )
      group by schemaname, tablename
      having count(*) = 6
    )
    and exists (
      select 1
      from pg_indexes
      where schemaname = 'private'
        and tablename = 'observer_checkpoints'
        and indexname in (
          'observer_checkpoints_binding_kind_uidx',
          'observer_checkpoints_observed_idx'
        )
      group by schemaname, tablename
      having count(*) = 2
    ),
  'required reconciliation lookup and idempotency indexes exist'
);

select extensions.ok(
  obj_description('private.external_balance_observations'::regclass, 'pg_class') is not null
    and obj_description('private.external_transaction_observations'::regclass, 'pg_class') is not null
    and obj_description('private.reconciliation_runs'::regclass, 'pg_class') is not null
    and obj_description('private.reconciliation_items'::regclass, 'pg_class') is not null
    and obj_description('private.observer_checkpoints'::regclass, 'pg_class') is not null,
  'reconciliation core tables have comments'
);

select extensions.ok(
  not has_table_privilege('public', 'private.external_balance_observations', 'select')
    and not has_table_privilege('public', 'private.external_transaction_observations', 'select')
    and not has_table_privilege('public', 'private.reconciliation_runs', 'select')
    and not has_table_privilege('public', 'private.reconciliation_items', 'select')
    and not has_table_privilege('public', 'private.observer_checkpoints', 'select')
    and not has_table_privilege('anon', 'private.external_balance_observations', 'select')
    and not has_table_privilege('anon', 'private.external_transaction_observations', 'select')
    and not has_table_privilege('anon', 'private.reconciliation_runs', 'select')
    and not has_table_privilege('anon', 'private.reconciliation_items', 'select')
    and not has_table_privilege('anon', 'private.observer_checkpoints', 'select')
    and not has_table_privilege('authenticated', 'private.external_balance_observations', 'select')
    and not has_table_privilege('authenticated', 'private.external_transaction_observations', 'select')
    and not has_table_privilege('authenticated', 'private.reconciliation_runs', 'select')
    and not has_table_privilege('authenticated', 'private.reconciliation_items', 'select')
    and not has_table_privilege('authenticated', 'private.observer_checkpoints', 'select'),
  'public anon and authenticated cannot select reconciliation private tables'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.external_balance_observations', 'insert')
    and not has_table_privilege('authenticated', 'private.external_balance_observations', 'update')
    and not has_table_privilege('authenticated', 'private.external_balance_observations', 'delete')
    and not has_table_privilege('authenticated', 'private.external_transaction_observations', 'insert')
    and not has_table_privilege('authenticated', 'private.external_transaction_observations', 'update')
    and not has_table_privilege('authenticated', 'private.external_transaction_observations', 'delete')
    and not has_table_privilege('authenticated', 'private.reconciliation_runs', 'insert')
    and not has_table_privilege('authenticated', 'private.reconciliation_runs', 'update')
    and not has_table_privilege('authenticated', 'private.reconciliation_runs', 'delete')
    and not has_table_privilege('authenticated', 'private.reconciliation_items', 'insert')
    and not has_table_privilege('authenticated', 'private.reconciliation_items', 'update')
    and not has_table_privilege('authenticated', 'private.reconciliation_items', 'delete')
    and not has_table_privilege('authenticated', 'private.observer_checkpoints', 'insert')
    and not has_table_privilege('authenticated', 'private.observer_checkpoints', 'update')
    and not has_table_privilege('authenticated', 'private.observer_checkpoints', 'delete'),
  'authenticated cannot write reconciliation private tables directly'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname ~* '(reconciliation|external_balance|external_transaction|observer_checkpoint|observer_checkpoints)'
  ),
  0,
  'no public reconciliation RPCs are created'
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
values (
  '00000000-0000-4000-8000-000000540101',
  'P5REC_ASSET_A',
  'P5RA',
  'P5 Reconciliation Asset A',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111161',
  'ACTIVE'
);

insert into private.custody_providers (
  id,
  provider_code,
  display_name,
  provider_type,
  supports_balance_observation,
  supports_transfer_observation
)
values (
  '00000000-0000-4000-8000-000000540201',
  'P5REC_PROVIDER',
  'P5 Reconciliation Provider',
  'MPC_CUSTODIAN',
  true,
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
values (
  '00000000-0000-4000-8000-000000540301',
  '00000000-0000-4000-8000-000000540201',
  '00000000-0000-4000-8000-000000540101',
  'p5rec_binding_a',
  'P5 Reconciliation Binding A',
  'COLLECTION'
);

select extensions.lives_ok(
  $_$
  insert into private.external_balance_observations (
    id,
    custody_account_binding_id,
    asset_id,
    observer_kind,
    observation_key,
    observed_units,
    checkpoint_reference,
    observed_at
  )
  values (
    '00000000-0000-4000-8000-000000540401',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    'BALANCE_OBSERVER',
    'balance.obs:0001',
    0,
    'cursor-0001',
    clock_timestamp()
  )
  $_$,
  'balance observation accepts zero atomic units'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.external_balance_observations (
      custody_account_binding_id,
      asset_id,
      observer_kind,
      observation_key,
      observed_units,
      observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      'BALANCE_OBSERVER',
      'balance.obs:negative',
      -1,
      clock_timestamp()
    );
    raise exception 'expected negative balance observation failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'balance observation rejects negative atomic units'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.external_balance_observations (
      custody_account_binding_id,
      asset_id,
      observer_kind,
      observation_key,
      observed_units,
      observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      'BALANCE_OBSERVER',
      'balance.obs:fractional',
      1.5,
      clock_timestamp()
    );
    raise exception 'expected fractional balance observation failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'balance observation rejects fractional atomic units'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.external_balance_observations (
      custody_account_binding_id,
      asset_id,
      observer_kind,
      observation_key,
      observed_units,
      observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      'BALANCE_OBSERVER',
      'balance.obs:0001',
      10,
      clock_timestamp()
    );
    raise exception 'expected duplicate balance observation failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'balance observation duplicate idempotency key is blocked'
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
    '00000000-0000-4000-8000-000000540402',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    'BALANCE_OBSERVER',
    'balance.obs:matched',
    100,
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000540403',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    'BALANCE_OBSERVER',
    'balance.obs:within',
    102,
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000540404',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    'BALANCE_OBSERVER',
    'balance.obs:mismatch',
    110,
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000540405',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    'BALANCE_OBSERVER',
    'balance.obs:signed',
    90,
    clock_timestamp()
  );

select extensions.lives_ok(
  $_$
  insert into private.external_transaction_observations (
    id,
    custody_account_binding_id,
    asset_id,
    observer_kind,
    external_event_key,
    direction,
    external_status,
    amount_units,
    confirmation_context,
    finalized_at,
    observed_at
  )
  values (
    '00000000-0000-4000-8000-000000540501',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    'TRANSFER_OBSERVER',
    'transfer.obs:0001',
    'INBOUND',
    'FINALIZED',
    1,
    'finality-0001',
    clock_timestamp(),
    clock_timestamp()
  )
  $_$,
  'transaction observation accepts positive atomic units and provider contract values'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.external_transaction_observations (
      custody_account_binding_id,
      asset_id,
      observer_kind,
      external_event_key,
      direction,
      external_status,
      amount_units,
      observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      'TRANSFER_OBSERVER',
      'transfer.obs:zero',
      'INBOUND',
      'PENDING_FINALITY',
      0,
      clock_timestamp()
    );
    raise exception 'expected zero transfer amount failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'transaction observation rejects zero atomic units'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.external_transaction_observations (
      custody_account_binding_id,
      asset_id,
      observer_kind,
      external_event_key,
      direction,
      external_status,
      amount_units,
      observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      'TRANSFER_OBSERVER',
      'transfer.obs:negative',
      'OUTBOUND',
      'PENDING_FINALITY',
      -1,
      clock_timestamp()
    );
    raise exception 'expected negative transfer amount failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'transaction observation rejects negative atomic units'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.external_transaction_observations (
      custody_account_binding_id,
      asset_id,
      observer_kind,
      external_event_key,
      direction,
      external_status,
      amount_units,
      observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      'TRANSFER_OBSERVER',
      'transfer.obs:bad-direction',
      'SIDEWAYS',
      'PENDING_FINALITY',
      1,
      clock_timestamp()
    );
    raise exception 'expected bad direction failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'transaction observation rejects directions outside provider contract'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.external_transaction_observations (
      custody_account_binding_id,
      asset_id,
      observer_kind,
      external_event_key,
      direction,
      external_status,
      amount_units,
      observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      'TRANSFER_OBSERVER',
      'transfer.obs:bad-status',
      'INBOUND',
      'CONFIRMED',
      1,
      clock_timestamp()
    );
    raise exception 'expected bad status failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'transaction observation rejects statuses outside provider contract'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.external_transaction_observations (
      custody_account_binding_id,
      asset_id,
      observer_kind,
      external_event_key,
      direction,
      external_status,
      amount_units,
      finalized_at,
      observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      'TRANSFER_OBSERVER',
      'transfer.obs:finality',
      'INBOUND',
      'FINALIZED',
      1,
      null,
      clock_timestamp()
    );
    raise exception 'expected finalized timestamp failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'finalized transaction observations require finalized_at'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.external_transaction_observations (
      custody_account_binding_id,
      asset_id,
      observer_kind,
      external_event_key,
      direction,
      external_status,
      amount_units,
      observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      'TRANSFER_OBSERVER',
      'transfer.obs:0001',
      'OUTBOUND',
      'PENDING_FINALITY',
      1,
      clock_timestamp()
    );
    raise exception 'expected duplicate external event failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'transaction observation duplicate external event key is blocked'
);

insert into private.reconciliation_runs (
  id,
  idempotency_key,
  trigger_source
)
values (
  '00000000-0000-4000-8000-000000540601',
  'reconcile.run:pending',
  'MANUAL'
);

select extensions.is(
  (
    select status
    from private.reconciliation_runs
    where id = '00000000-0000-4000-8000-000000540601'
  ),
  'PENDING',
  'reconciliation run defaults to pending'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_runs (
      idempotency_key,
      trigger_source
    )
    values (
      'reconcile.run:pending',
      'MANUAL'
    );
    raise exception 'expected duplicate run idempotency failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'reconciliation run duplicate idempotency key is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    begin
      insert into private.reconciliation_runs (
        idempotency_key,
        trigger_source,
        status
      )
      values (
        'reconcile.run:bad-status',
        'MANUAL',
        'BROKEN'
      );
      raise exception 'expected bad run status failure';
    exception
      when check_violation then
        null;
    end;

    begin
      insert into private.reconciliation_runs (
        idempotency_key,
        trigger_source
      )
      values (
        '        ',
        'MANUAL'
      );
      raise exception 'expected whitespace run idempotency failure';
    exception
      when check_violation then
        null;
    end;
  end;
  $$;
  $_$,
  'reconciliation run rejects invalid status and whitespace-only idempotency key'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_runs (
      idempotency_key,
      trigger_source,
      status,
      started_at,
      completed_at
    )
    values (
      'reconcile.run:bad-time',
      'MANUAL',
      'COMPLETED',
      '2026-01-02 00:00:00+00',
      '2026-01-01 00:00:00+00'
    );
    raise exception 'expected run time order failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'reconciliation run rejects completed_at before started_at'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.reconciliation_runs (
      idempotency_key,
      trigger_source,
      status,
      started_at,
      completed_at
    )
    values (
      'reconcile.run:failed-no-code',
      'SYSTEM',
      'FAILED',
      clock_timestamp(),
      clock_timestamp()
    );
    raise exception 'expected failed run without failure code failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'failed reconciliation run requires failure classification'
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
    '00000000-0000-4000-8000-000000540602',
    'reconcile.run:matched',
    'MANUAL',
    'COMPLETED',
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000540603',
    'reconcile.run:within',
    'MANUAL',
    'COMPLETED',
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000540604',
    'reconcile.run:mismatch',
    'MANUAL',
    'COMPLETED',
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000540605',
    'reconcile.run:observation-failed',
    'SYSTEM',
    'PARTIAL',
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000540606',
    'reconcile.run:signed-diff',
    'SYSTEM',
    'COMPLETED',
    clock_timestamp(),
    clock_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000540607',
    'reconcile.run:duplicate-item',
    'MANUAL',
    'COMPLETED',
    clock_timestamp(),
    clock_timestamp()
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
    '00000000-0000-4000-8000-000000540602',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    '00000000-0000-4000-8000-000000540402',
    100,
    100,
    0,
    0,
    'MATCHED'
  )
  $_$,
  'matched reconciliation item accepts zero difference'
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
    '00000000-0000-4000-8000-000000540603',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    '00000000-0000-4000-8000-000000540403',
    100,
    102,
    2,
    5,
    'WITHIN_TOLERANCE'
  )
  $_$,
  'within tolerance item accepts absolute difference inside tolerance'
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
    '00000000-0000-4000-8000-000000540604',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    '00000000-0000-4000-8000-000000540404',
    100,
    110,
    10,
    5,
    'MISMATCH'
  )
  $_$,
  'mismatch item accepts absolute difference above tolerance'
);

select extensions.lives_ok(
  $_$
  insert into private.reconciliation_items (
    reconciliation_run_id,
    custody_account_binding_id,
    asset_id,
    expected_units,
    tolerance_units,
    classification
  )
  values (
    '00000000-0000-4000-8000-000000540605',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    100,
    0,
    'OBSERVATION_FAILED'
  )
  $_$,
  'observation failed item accepts null observation values'
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
    '00000000-0000-4000-8000-000000540606',
    '00000000-0000-4000-8000-000000540301',
    '00000000-0000-4000-8000-000000540101',
    '00000000-0000-4000-8000-000000540405',
    100,
    90,
    -10,
    5,
    'MISMATCH'
  )
  $_$,
  'reconciliation item accepts signed negative difference'
);

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
  '00000000-0000-4000-8000-000000540607',
  '00000000-0000-4000-8000-000000540301',
  '00000000-0000-4000-8000-000000540101',
  '00000000-0000-4000-8000-000000540402',
  100,
  100,
  0,
  0,
  'MATCHED'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540607',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540402',
      100,
      100,
      0,
      0,
      'MATCHED'
    );
    raise exception 'expected duplicate reconciliation item failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'reconciliation item duplicate run binding asset is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540601',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540402',
      -1,
      100,
      101,
      0,
      'MISMATCH'
    );
    raise exception 'expected negative expected units failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'reconciliation item rejects negative expected units'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540601',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540402',
      100,
      -1,
      -101,
      0,
      'MISMATCH'
    );
    raise exception 'expected negative observed units failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'reconciliation item rejects negative observed units'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540601',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540402',
      100,
      100,
      0,
      -1,
      'MATCHED'
    );
    raise exception 'expected negative tolerance failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'reconciliation item rejects negative tolerance units'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540601',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540402',
      100.5,
      100,
      -0.5,
      1,
      'WITHIN_TOLERANCE'
    );
    raise exception 'expected fractional units failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'reconciliation item rejects fractional units'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540601',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540402',
      100,
      101,
      0,
      1,
      'WITHIN_TOLERANCE'
    );
    raise exception 'expected inconsistent difference failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'reconciliation item rejects inconsistent difference calculation'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540601',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540403',
      100,
      102,
      2,
      5,
      'MATCHED'
    );
    raise exception 'expected matched nonzero failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'matched item rejects non-zero difference'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540601',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540404',
      100,
      110,
      10,
      5,
      'WITHIN_TOLERANCE'
    );
    raise exception 'expected out of tolerance failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'within tolerance item rejects absolute difference above tolerance'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540601',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540403',
      100,
      102,
      2,
      5,
      'MISMATCH'
    );
    raise exception 'expected mismatch tolerance failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'mismatch item rejects difference inside tolerance'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
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
      '00000000-0000-4000-8000-000000540601',
      '00000000-0000-4000-8000-000000540301',
      '00000000-0000-4000-8000-000000540101',
      '00000000-0000-4000-8000-000000540402',
      100,
      100,
      0,
      0,
      'OBSERVATION_FAILED'
    );
    raise exception 'expected observation failed shape failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'observation failed item rejects populated observation values'
);

select extensions.lives_ok(
  $_$
  insert into private.observer_checkpoints (
    custody_account_binding_id,
    observer_kind,
    checkpoint_value,
    checkpoint_observed_at
  )
  values (
    '00000000-0000-4000-8000-000000540301',
    'BALANCE_OBSERVER',
    'checkpoint-0001',
    clock_timestamp()
  )
  $_$,
  'observer checkpoint accepts safe opaque cursor'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.observer_checkpoints (
      custody_account_binding_id,
      observer_kind,
      checkpoint_value,
      checkpoint_observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      'BALANCE_OBSERVER',
      'checkpoint-0002',
      clock_timestamp()
    );
    raise exception 'expected duplicate checkpoint failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'observer checkpoint duplicate binding kind is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.observer_checkpoints (
      custody_account_binding_id,
      observer_kind,
      checkpoint_value,
      checkpoint_observed_at
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      'TRANSFER_OBSERVER',
      '',
      clock_timestamp()
    );
    raise exception 'expected empty checkpoint failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'observer checkpoint rejects empty cursor'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.observer_checkpoints (
      custody_account_binding_id,
      observer_kind,
      checkpoint_value,
      checkpoint_observed_at,
      version
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      'TRANSFER_OBSERVER',
      'checkpoint-0003',
      clock_timestamp(),
      0
    );
    raise exception 'expected zero checkpoint version failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'observer checkpoint rejects version zero'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.observer_checkpoints (
      custody_account_binding_id,
      observer_kind,
      checkpoint_value,
      checkpoint_observed_at,
      version
    )
    values (
      '00000000-0000-4000-8000-000000540301',
      'TRANSFER_OBSERVER',
      'checkpoint-0004',
      clock_timestamp(),
      -1
    );
    raise exception 'expected negative checkpoint version failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'observer checkpoint rejects negative version'
);

select extensions.ok(
  not exists (
    select 1
    from private.external_balance_observations
    where checkpoint_reference::text ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
  )
    and not exists (
      select 1
      from private.external_transaction_observations
      where coalesce(confirmation_context, '') ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
    )
    and not exists (
      select 1
      from private.observer_checkpoints
      where checkpoint_value ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
    ),
  'stored observer checkpoint and context values exclude secret markers'
);

select * from extensions.finish();

rollback;
