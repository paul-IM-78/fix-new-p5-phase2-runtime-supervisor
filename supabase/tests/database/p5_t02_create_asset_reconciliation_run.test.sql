begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  to_regprocedure(
    'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'
  ) is not null,
  'asset reconciliation run writer exists'
);

select extensions.ok(
  pg_get_function_arguments(
    'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure
  ) like 'p_idempotency_key text, p_asset_id uuid, p_observer_kind text, p_observed_at_or_before timestamp with time zone, p_tolerance_atomic_units numeric, p_trigger_source text DEFAULT %MANUAL% p_requested_by_profile_id uuid DEFAULT NULL::uuid',
  'writer argument contract includes idempotency asset observer cutoff tolerance trigger and actor'
);

select extensions.is(
  pg_get_function_result(
    'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure
  ),
  'TABLE(reconciliation_run_id uuid, reconciliation_item_id uuid, created boolean, run_status text, item_classification text, expected_atomic_units numeric, observed_atomic_units numeric, difference_atomic_units numeric, target_binding_count bigint, observed_binding_count bigint, missing_binding_count bigint)',
  'writer return contract exposes run item status amounts and membership counts'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname = 'create_asset_reconciliation_run'
      and procedures.provolatile = 'v'
      and not procedures.prosecdef
  ),
  'writer is volatile security invoker'
);

select extensions.ok(
  obj_description(
    'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure,
    'pg_proc'
  ) is not null,
  'writer has a governance comment'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'reconciliation_runs'
      and column_name in ('observer_kind', 'observation_cutoff_at')
    group by table_schema, table_name
    having count(*) = 2
  ),
  'run metadata columns exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.reconciliation_runs'::regclass
      and conname in (
        'reconciliation_runs_observer_kind_check',
        'reconciliation_runs_observation_cutoff_check',
        'reconciliation_runs_observation_metadata_pair_check'
      )
    group by conrelid
    having count(*) = 3
  ),
  'run metadata constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'reconciliation_runs'
      and indexname in (
        'reconciliation_runs_idempotency_key_key',
        'reconciliation_runs_observation_metadata_idx'
      )
    group by schemaname, tablename
    having count(*) = 2
  ),
  'run idempotency and observation metadata indexes exist'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure,
      'execute'
    ),
  'browser roles cannot execute the private writer'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname ~* '(reconciliation|external_balance|external_transaction|observer_checkpoint)'
      and procedures.proname not in (
        'list_admin_reconciliation_items',
        'get_admin_reconciliation_item_detail'
      )
  ) = 0,
  'writer leaves only approved public reconciliation read RPCs'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.views
    where table_schema = 'public'
      and table_name ~* '(reconciliation|external_balance|external_transaction|observer_checkpoint)'
  ),
  'writer adds no public reconciliation view'
);

select extensions.ok(
  lower(pg_get_functiondef(
    'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure
  )) like '%on conflict (idempotency_key) do nothing%'
    and pg_get_functiondef(
      'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure
    ) !~* 'on conflict[[:space:][:print:]]+do update'
    and pg_get_functiondef(
      'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure
    ) !~* 'advisory'
    and pg_get_functiondef(
      'private.create_asset_reconciliation_run(text, uuid, text, timestamp with time zone, numeric, text, uuid)'::regprocedure
    ) !~* '(delete|truncate)[[:space:]]',
  'writer uses unique idempotency without update conflict path advisory locks delete or truncate'
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
    '00000000-0000-4000-8000-000000580101',
    'P5RUN_MATCHED',
    'RMA',
    'P5 Run Matched',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000580102',
    'P5RUN_WITHIN',
    'RWI',
    'P5 Run Within',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000580103',
    'P5RUN_MISMATCH',
    'RMM',
    'P5 Run Mismatch',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000580104',
    'P5RUN_INCOMPLETE',
    'RIN',
    'P5 Run Incomplete',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000580105',
    'P5RUN_ZERO',
    'RZE',
    'P5 Run Zero',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000580106',
    'P5RUN_LARGE',
    'RLG',
    'P5 Run Large',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000580107',
    'P5RUN_NO_ACCOUNT',
    'RNA',
    'P5 Run No Account',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000580108',
    'P5RUN_NO_TARGET',
    'RNT',
    'P5 Run No Target',
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
  supports_balance_observation
)
values (
  '00000000-0000-4000-8000-000000580201',
  'P5RUN_PROVIDER',
  'P5 Run Provider',
  'MPC_CUSTODIAN',
  true
);

update private.custody_providers
set status = 'APPROVED'
where id = '00000000-0000-4000-8000-000000580201';

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
    '00000000-0000-4000-8000-000000580301',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580101',
    'p5run_matched_collection',
    'P5 Run Matched Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000580302',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580101',
    'p5run_matched_treasury',
    'P5 Run Matched Treasury',
    'TREASURY'
  ),
  (
    '00000000-0000-4000-8000-000000580311',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580102',
    'p5run_within_collection',
    'P5 Run Within Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000580321',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580103',
    'p5run_mismatch_collection',
    'P5 Run Mismatch Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000580331',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580104',
    'p5run_incomplete_collection',
    'P5 Run Incomplete Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000580332',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580104',
    'p5run_incomplete_treasury',
    'P5 Run Incomplete Treasury',
    'TREASURY'
  ),
  (
    '00000000-0000-4000-8000-000000580341',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580105',
    'p5run_zero_collection',
    'P5 Run Zero Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000580351',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580106',
    'p5run_large_collection',
    'P5 Run Large Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000580361',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580107',
    'p5run_no_account_collection',
    'P5 Run No Account Collection',
    'COLLECTION'
  );

update private.custody_account_bindings
set status = 'APPROVED'
where id in (
  '00000000-0000-4000-8000-000000580301',
  '00000000-0000-4000-8000-000000580302',
  '00000000-0000-4000-8000-000000580311',
  '00000000-0000-4000-8000-000000580321',
  '00000000-0000-4000-8000-000000580331',
  '00000000-0000-4000-8000-000000580332',
  '00000000-0000-4000-8000-000000580341',
  '00000000-0000-4000-8000-000000580351',
  '00000000-0000-4000-8000-000000580361'
);

create temp table qa_p5run_system_accounts as
select
  assets.asset_id,
  accounts.account_purpose,
  accounts.ledger_account_id
from (
  values
    ('00000000-0000-4000-8000-000000580101'::uuid),
    ('00000000-0000-4000-8000-000000580102'::uuid),
    ('00000000-0000-4000-8000-000000580103'::uuid),
    ('00000000-0000-4000-8000-000000580104'::uuid),
    ('00000000-0000-4000-8000-000000580105'::uuid),
    ('00000000-0000-4000-8000-000000580106'::uuid),
    ('00000000-0000-4000-8000-000000580108'::uuid)
) as assets(asset_id)
cross join lateral private.ensure_system_ledger_accounts(assets.asset_id) as accounts;

create temp table qa_p5run_post_matched as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000580901',
  '00000000-0000-4000-8000-000000580101',
  'P5_RUN_EXPECTED',
  'SYSTEM',
  null,
  null,
  null,
  'p5 reconciliation matched expected',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580101' and account_purpose = 'SYSTEM_CUSTODY'),
      'side',
      'DEBIT',
      'units',
      '100'
    ),
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580101' and account_purpose = 'SYSTEM_TOKEN_ISSUANCE'),
      'side',
      'CREDIT',
      'units',
      '100'
    )
  )
);

create temp table qa_p5run_post_within as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000580902',
  '00000000-0000-4000-8000-000000580102',
  'P5_RUN_EXPECTED',
  'SYSTEM',
  null,
  null,
  null,
  'p5 reconciliation within expected',
  jsonb_build_array(
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580102' and account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '100'),
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580102' and account_purpose = 'SYSTEM_TOKEN_ISSUANCE'), 'side', 'CREDIT', 'units', '100')
  )
);

create temp table qa_p5run_post_mismatch as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000580903',
  '00000000-0000-4000-8000-000000580103',
  'P5_RUN_EXPECTED',
  'SYSTEM',
  null,
  null,
  null,
  'p5 reconciliation mismatch expected',
  jsonb_build_array(
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580103' and account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '100'),
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580103' and account_purpose = 'SYSTEM_TOKEN_ISSUANCE'), 'side', 'CREDIT', 'units', '100')
  )
);

create temp table qa_p5run_post_incomplete as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000580904',
  '00000000-0000-4000-8000-000000580104',
  'P5_RUN_EXPECTED',
  'SYSTEM',
  null,
  null,
  null,
  'p5 reconciliation incomplete expected',
  jsonb_build_array(
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580104' and account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '100'),
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580104' and account_purpose = 'SYSTEM_TOKEN_ISSUANCE'), 'side', 'CREDIT', 'units', '100')
  )
);

create temp table qa_p5run_post_large as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000580906',
  '00000000-0000-4000-8000-000000580106',
  'P5_RUN_EXPECTED',
  'SYSTEM',
  null,
  null,
  null,
  'p5 reconciliation large expected',
  jsonb_build_array(
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580106' and account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '9007199254740993'),
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580106' and account_purpose = 'SYSTEM_TOKEN_ISSUANCE'), 'side', 'CREDIT', 'units', '9007199254740993')
  )
);

create temp table qa_p5run_post_no_target as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000580908',
  '00000000-0000-4000-8000-000000580108',
  'P5_RUN_EXPECTED',
  'SYSTEM',
  null,
  null,
  null,
  'p5 reconciliation no target expected',
  jsonb_build_array(
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580108' and account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '1'),
    jsonb_build_object('account_id', (select ledger_account_id::text from qa_p5run_system_accounts where asset_id = '00000000-0000-4000-8000-000000580108' and account_purpose = 'SYSTEM_TOKEN_ISSUANCE'), 'side', 'CREDIT', 'units', '1')
  )
);

insert into private.external_balance_observations (
  id,
  custody_account_binding_id,
  asset_id,
  observer_kind,
  observation_key,
  observed_units,
  observed_at,
  created_at
)
values
  (
    '00000000-0000-4000-8000-000000580401',
    '00000000-0000-4000-8000-000000580301',
    '00000000-0000-4000-8000-000000580101',
    'BALANCE_OBSERVER',
    'p5run.matched.a',
    60,
    '2026-07-29 01:00:00+00'::timestamptz,
    '2026-07-29 01:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000580402',
    '00000000-0000-4000-8000-000000580302',
    '00000000-0000-4000-8000-000000580101',
    'BALANCE_OBSERVER',
    'p5run.matched.b',
    40,
    '2026-07-29 01:00:00+00'::timestamptz,
    '2026-07-29 01:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000580403',
    '00000000-0000-4000-8000-000000580301',
    '00000000-0000-4000-8000-000000580101',
    'BALANCE_OBSERVER',
    'p5run.matched.future',
    999,
    '2026-07-29 03:00:00+00'::timestamptz,
    '2026-07-29 03:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000580404',
    '00000000-0000-4000-8000-000000580301',
    '00000000-0000-4000-8000-000000580101',
    'BALANCE_OBSERVER_ALT',
    'p5run.matched.alt',
    777,
    '2026-07-29 01:30:00+00'::timestamptz,
    '2026-07-29 01:31:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000580411',
    '00000000-0000-4000-8000-000000580311',
    '00000000-0000-4000-8000-000000580102',
    'BALANCE_OBSERVER',
    'p5run.within.a',
    103,
    '2026-07-29 01:00:00+00'::timestamptz,
    '2026-07-29 01:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000580421',
    '00000000-0000-4000-8000-000000580321',
    '00000000-0000-4000-8000-000000580103',
    'BALANCE_OBSERVER',
    'p5run.mismatch.a',
    108,
    '2026-07-29 01:00:00+00'::timestamptz,
    '2026-07-29 01:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000580431',
    '00000000-0000-4000-8000-000000580331',
    '00000000-0000-4000-8000-000000580104',
    'BALANCE_OBSERVER',
    'p5run.incomplete.a',
    60,
    '2026-07-29 01:00:00+00'::timestamptz,
    '2026-07-29 01:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000580441',
    '00000000-0000-4000-8000-000000580341',
    '00000000-0000-4000-8000-000000580105',
    'BALANCE_OBSERVER',
    'p5run.zero.a',
    0,
    '2026-07-29 01:00:00+00'::timestamptz,
    '2026-07-29 01:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000580451',
    '00000000-0000-4000-8000-000000580351',
    '00000000-0000-4000-8000-000000580106',
    'BALANCE_OBSERVER',
    'p5run.large.a',
    9007199254740995,
    '2026-07-29 01:00:00+00'::timestamptz,
    '2026-07-29 01:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000580461',
    '00000000-0000-4000-8000-000000580361',
    '00000000-0000-4000-8000-000000580107',
    'BALANCE_OBSERVER',
    'p5run.noaccount.a',
    5,
    '2026-07-29 01:00:00+00'::timestamptz,
    '2026-07-29 01:01:00+00'::timestamptz
  );

create temp table qa_p5run_side_effect_counts_before as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.external_transaction_observations) as transaction_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints,
  (select count(*)::bigint from private.ledger_accounts) as ledger_accounts,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries;

create temp table qa_p5run_matched as
select *
from private.create_asset_reconciliation_run(
  'p5r06.matched.0001',
  '00000000-0000-4000-8000-000000580101',
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz,
  0,
  'MANUAL',
  null
);

select extensions.is(
  (
    select created::text || ',' ||
      run_status || ',' ||
      item_classification || ',' ||
      expected_atomic_units::text || ',' ||
      observed_atomic_units::text || ',' ||
      difference_atomic_units::text || ',' ||
      target_binding_count::text || ',' ||
      observed_binding_count::text || ',' ||
      missing_binding_count::text
    from qa_p5run_matched
  ),
  'true,COMPLETED,MATCHED,100,100,0,2,2,0',
  'matched run returns completed matched aggregate result'
);

select extensions.is(
  (
    select runs.observer_kind || ',' ||
      runs.observation_cutoff_at::text || ',' ||
      runs.trigger_source || ',' ||
      runs.status
    from private.reconciliation_runs as runs
    join qa_p5run_matched as result
      on result.reconciliation_run_id = runs.id
  ),
  'BALANCE_OBSERVER,2026-07-29 02:00:00+00,MANUAL,COMPLETED',
  'run persists observer cutoff trigger and completed status'
);

select extensions.is(
  (
    select items.scope_kind || ',' ||
      coalesce(items.custody_account_binding_id::text, 'NULL') || ',' ||
      coalesce(items.external_balance_observation_id::text, 'NULL') || ',' ||
      items.classification
    from private.reconciliation_items as items
    join qa_p5run_matched as result
      on result.reconciliation_item_id = items.id
  ),
  'ASSET_AGGREGATE,NULL,NULL,MATCHED',
  'writer creates one asset aggregate item without binding or single observation fk'
);

select extensions.is(
  (
    select count(*)::integer
    from private.reconciliation_item_binding_observations as members
    join qa_p5run_matched as result
      on result.reconciliation_item_id = members.reconciliation_item_id
  ),
  2,
  'writer snapshots one provenance row per target binding'
);

select extensions.ok(
  exists (
    select 1
    from private.reconciliation_item_binding_observations as members
    join qa_p5run_matched as result
      on result.reconciliation_item_id = members.reconciliation_item_id
    where members.custody_account_binding_id = '00000000-0000-4000-8000-000000580301'
      and members.external_balance_observation_id = '00000000-0000-4000-8000-000000580401'
      and members.membership_status = 'OBSERVED'
  )
    and not exists (
      select 1
      from private.reconciliation_item_binding_observations as members
      join qa_p5run_matched as result
        on result.reconciliation_item_id = members.reconciliation_item_id
      where members.external_balance_observation_id in (
        '00000000-0000-4000-8000-000000580403',
        '00000000-0000-4000-8000-000000580404'
      )
    ),
  'provenance uses cutoff-bound input observer kind and excludes future or alternate observations'
);

create temp table qa_p5run_matched_timestamp_before as
select runs.started_at, runs.completed_at
from private.reconciliation_runs as runs
join qa_p5run_matched as result
  on result.reconciliation_run_id = runs.id;

create temp table qa_p5run_replay_counts_before as
select
  (select count(*)::bigint from private.reconciliation_runs) as runs,
  (select count(*)::bigint from private.reconciliation_items) as items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as members;

create temp table qa_p5run_matched_replay as
select *
from private.create_asset_reconciliation_run(
  'p5r06.matched.0001',
  '00000000-0000-4000-8000-000000580101',
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz,
  0,
  'MANUAL',
  null
);

select extensions.ok(
  (select not created from qa_p5run_matched_replay)
    and (
      select reconciliation_run_id
      from qa_p5run_matched_replay
    ) = (
      select reconciliation_run_id
      from qa_p5run_matched
    )
    and (
      select reconciliation_item_id
      from qa_p5run_matched_replay
    ) = (
      select reconciliation_item_id
      from qa_p5run_matched
    ),
  'exact replay returns existing run and item with created false'
);

select extensions.is(
  (
    select runs::text || ',' || items::text || ',' || members::text
    from qa_p5run_replay_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.reconciliation_runs)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_items)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_item_binding_observations)::text
  ),
  'exact replay creates no extra run item or provenance rows'
);

select extensions.ok(
  exists (
    select 1
    from qa_p5run_matched_timestamp_before as before_values
    join private.reconciliation_runs as runs
      on runs.id = (select reconciliation_run_id from qa_p5run_matched)
    where runs.started_at = before_values.started_at
      and runs.completed_at = before_values.completed_at
  ),
  'exact replay does not mutate existing timestamps'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.matched.0001',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER_ALT',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected observer conflict';
  exception
    when unique_violation then
      if sqlerrm <> 'reconciliation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same idempotency key with different observer kind is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.matched.0001',
      '00000000-0000-4000-8000-000000580102',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected asset conflict';
  exception
    when unique_violation then
      if sqlerrm <> 'reconciliation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same idempotency key with different asset is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.matched.0001',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER',
      '2026-07-29 02:30:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected cutoff conflict';
  exception
    when unique_violation then
      if sqlerrm <> 'reconciliation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same idempotency key with different cutoff is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.matched.0001',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      1,
      'MANUAL',
      null
    );
    raise exception 'expected tolerance conflict';
  exception
    when unique_violation then
      if sqlerrm <> 'reconciliation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same idempotency key with different tolerance is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.matched.0001',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'SYSTEM',
      null
    );
    raise exception 'expected trigger conflict';
  exception
    when unique_violation then
      if sqlerrm <> 'reconciliation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same idempotency key with different trigger source is blocked'
);

create temp table qa_p5run_within as
select *
from private.create_asset_reconciliation_run(
  'p5r06.within.0001',
  '00000000-0000-4000-8000-000000580102',
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz,
  5,
  'SYSTEM',
  null
);

select extensions.is(
  (
    select run_status || ',' ||
      item_classification || ',' ||
      expected_atomic_units::text || ',' ||
      observed_atomic_units::text || ',' ||
      difference_atomic_units::text
    from qa_p5run_within
  ),
  'COMPLETED,WITHIN_TOLERANCE,100,103,3',
  'within tolerance run stores nonzero in-tolerance difference'
);

create temp table qa_p5run_mismatch as
select *
from private.create_asset_reconciliation_run(
  'p5r06.mismatch.0001',
  '00000000-0000-4000-8000-000000580103',
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz,
  5,
  'SCHEDULED',
  null
);

select extensions.is(
  (
    select run_status || ',' ||
      item_classification || ',' ||
      expected_atomic_units::text || ',' ||
      observed_atomic_units::text || ',' ||
      difference_atomic_units::text
    from qa_p5run_mismatch
  ),
  'COMPLETED,MISMATCH,100,108,8',
  'mismatch run stores out-of-tolerance difference'
);

create temp table qa_p5run_incomplete as
select *
from private.create_asset_reconciliation_run(
  'p5r06.incomplete.0001',
  '00000000-0000-4000-8000-000000580104',
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz,
  0,
  'BACKFILL',
  null
);

select extensions.is(
  (
    select run_status || ',' ||
      item_classification || ',' ||
      expected_atomic_units::text || ',' ||
      coalesce(observed_atomic_units::text, 'NULL') || ',' ||
      coalesce(difference_atomic_units::text, 'NULL') || ',' ||
      target_binding_count::text || ',' ||
      observed_binding_count::text || ',' ||
      missing_binding_count::text
    from qa_p5run_incomplete
  ),
  'PARTIAL,OBSERVATION_FAILED,100,NULL,NULL,2,1,1',
  'incomplete observation membership returns partial failed item with null observed and difference'
);

select extensions.ok(
  exists (
    select 1
    from private.reconciliation_item_binding_observations as members
    join qa_p5run_incomplete as result
      on result.reconciliation_item_id = members.reconciliation_item_id
    where members.custody_account_binding_id = '00000000-0000-4000-8000-000000580332'
      and members.external_balance_observation_id is null
      and members.membership_status = 'MISSING_OBSERVATION'
  )
    and exists (
      select 1
      from private.reconciliation_item_binding_observations as members
      join qa_p5run_incomplete as result
        on result.reconciliation_item_id = members.reconciliation_item_id
      where members.custody_account_binding_id = '00000000-0000-4000-8000-000000580331'
        and members.external_balance_observation_id = '00000000-0000-4000-8000-000000580431'
        and members.membership_status = 'OBSERVED'
    ),
  'incomplete run snapshots observed and missing binding provenance without zero fill'
);

create temp table qa_p5run_zero as
select *
from private.create_asset_reconciliation_run(
  'p5r06.zero.0001',
  '00000000-0000-4000-8000-000000580105',
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz,
  0,
  'MANUAL',
  null
);

select extensions.is(
  (
    select item_classification || ',' ||
      expected_atomic_units::text || ',' ||
      observed_atomic_units::text || ',' ||
      difference_atomic_units::text || ',' ||
      missing_binding_count::text
    from qa_p5run_zero
  ),
  'MATCHED,0,0,0,0',
  'zero observed balance is distinct from missing observation membership'
);

create temp table qa_p5run_large as
select *
from private.create_asset_reconciliation_run(
  'p5r06.large.0001',
  '00000000-0000-4000-8000-000000580106',
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz,
  2,
  'MANUAL',
  null
);

select extensions.is(
  (
    select item_classification || ',' ||
      expected_atomic_units::text || ',' ||
      observed_atomic_units::text || ',' ||
      difference_atomic_units::text
    from qa_p5run_large
  ),
  'WITHIN_TOLERANCE,9007199254740993,9007199254740995,2',
  'large atomic-unit expected observed and difference remain exact'
);

create temp table qa_p5run_failure_counts_before as
select
  (select count(*)::bigint from private.reconciliation_runs) as runs,
  (select count(*)::bigint from private.reconciliation_items) as items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as members,
  (select count(*)::bigint from private.external_balance_observations) as observations,
  (select count(*)::bigint from private.ledger_journals) as journals;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      '',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected empty key failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'reconciliation_idempotency_key_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'empty idempotency key is rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      '        ',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected whitespace key failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'reconciliation_idempotency_key_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'whitespace idempotency key is rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.badobserver.0001',
      '00000000-0000-4000-8000-000000580101',
      'bad observer',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected observer failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observer_kind_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'invalid observer kind is rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.nullcutoff.0001',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER',
      null,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected cutoff failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observation_cutoff_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'null cutoff is rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.negtolerance.0001',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      -1,
      'MANUAL',
      null
    );
    raise exception 'expected tolerance failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'tolerance_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'negative tolerance is rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.fractolerance.0001',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      1.5,
      'MANUAL',
      null
    );
    raise exception 'expected tolerance failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'tolerance_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'fractional tolerance is rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.missingasset.0001',
      '00000000-0000-4000-8000-000000589999',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected asset failure';
  exception
    when foreign_key_violation then
      if sqlerrm <> 'asset_not_found' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'missing asset is rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.noaccount.0001',
      '00000000-0000-4000-8000-000000580107',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected system custody missing failure';
  exception
    when check_violation then
      if sqlerrm <> 'system_custody_account_missing' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'missing system custody account rolls back safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.notarget.0001',
      '00000000-0000-4000-8000-000000580108',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected target failure';
  exception
    when check_violation then
      if sqlerrm <> 'observable_binding_not_found' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'asset with no observable target binding rolls back safely'
);

select extensions.is(
  (
    select runs::text || ',' ||
      items::text || ',' ||
      members::text || ',' ||
      observations::text || ',' ||
      journals::text
    from qa_p5run_failure_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.reconciliation_runs)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_items)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_item_binding_observations)::text || ',' ||
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.ledger_journals)::text
  ),
  'failed writer attempts create no partial reconciliation observation or ledger rows'
);

insert into private.reconciliation_runs (
  id,
  idempotency_key,
  trigger_source,
  status,
  started_at,
  completed_at,
  observer_kind,
  observation_cutoff_at
)
values (
  '00000000-0000-4000-8000-000000580601',
  'p5r06.corrupt.0001',
  'MANUAL',
  'COMPLETED',
  '2026-07-29 02:00:00+00'::timestamptz,
  '2026-07-29 02:00:01+00'::timestamptz,
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.create_asset_reconciliation_run(
      'p5r06.corrupt.0001',
      '00000000-0000-4000-8000-000000580101',
      'BALANCE_OBSERVER',
      '2026-07-29 02:00:00+00'::timestamptz,
      0,
      'MANUAL',
      null
    );
    raise exception 'expected existing state failure';
  exception
    when check_violation then
      if sqlerrm <> 'reconciliation_existing_state_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'existing run without one asset aggregate item is rejected on replay'
);

select extensions.is(
  (
    select
      balance_observations::text || ',' ||
      transaction_observations::text || ',' ||
      observer_checkpoints::text || ',' ||
      ledger_accounts::text || ',' ||
      ledger_journals::text || ',' ||
      ledger_entries::text
    from qa_p5run_side_effect_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.external_transaction_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text || ',' ||
      (select count(*)::bigint from private.ledger_accounts)::text || ',' ||
      (select count(*)::bigint from private.ledger_journals)::text || ',' ||
      (select count(*)::bigint from private.ledger_entries)::text
  ),
  'writer changes no observation checkpoint or ledger state after fixture setup'
);

select * from extensions.finish();

rollback;
