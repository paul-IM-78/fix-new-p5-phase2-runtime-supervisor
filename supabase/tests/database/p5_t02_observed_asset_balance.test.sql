begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  to_regprocedure(
    'private.select_latest_external_balance_observations(uuid, text, timestamp with time zone)'
  ) is not null,
  'latest observed balance selector exists'
);

select extensions.ok(
  to_regprocedure(
    'private.calculate_observed_external_balance_atomic_units(uuid, text, timestamp with time zone)'
  ) is not null,
  'observed asset aggregate function exists'
);

select extensions.is(
  pg_get_function_arguments(
    'private.select_latest_external_balance_observations(uuid, text, timestamp with time zone)'::regprocedure
  ),
  'p_asset_id uuid, p_observer_kind text, p_observed_at_or_before timestamp with time zone',
  'selector argument contract is asset observer kind and cutoff'
);

select extensions.is(
  pg_get_function_arguments(
    'private.calculate_observed_external_balance_atomic_units(uuid, text, timestamp with time zone)'::regprocedure
  ),
  'p_asset_id uuid, p_observer_kind text, p_observed_at_or_before timestamp with time zone',
  'aggregate argument contract is asset observer kind and cutoff'
);

select extensions.is(
  pg_get_function_result(
    'private.select_latest_external_balance_observations(uuid, text, timestamp with time zone)'::regprocedure
  ),
  'TABLE(custody_account_binding_id uuid, external_balance_observation_id uuid, observed_atomic_units numeric, observed_at timestamp with time zone, membership_status text)',
  'selector return contract preserves binding membership and missing observations'
);

select extensions.is(
  pg_get_function_result(
    'private.calculate_observed_external_balance_atomic_units(uuid, text, timestamp with time zone)'::regprocedure
  ),
  'TABLE(observed_atomic_units numeric, target_binding_count bigint, observed_binding_count bigint, missing_binding_count bigint, is_complete boolean)',
  'aggregate return contract exposes amount and completeness counts'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'select_latest_external_balance_observations',
        'calculate_observed_external_balance_atomic_units'
      )
      and procedures.provolatile = 's'
      and not procedures.prosecdef
    group by namespaces.nspname
    having count(*) = 2
  ),
  'selector and aggregate are stable security invoker functions'
);

select extensions.ok(
  obj_description(
    'private.select_latest_external_balance_observations(uuid, text, timestamp with time zone)'::regprocedure,
    'pg_proc'
  ) is not null
    and obj_description(
      'private.calculate_observed_external_balance_atomic_units(uuid, text, timestamp with time zone)'::regprocedure,
      'pg_proc'
    ) is not null,
  'selector and aggregate have comments'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'private.select_latest_external_balance_observations(uuid, text, timestamp with time zone)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'private.select_latest_external_balance_observations(uuid, text, timestamp with time zone)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.select_latest_external_balance_observations(uuid, text, timestamp with time zone)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'public',
      'private.calculate_observed_external_balance_atomic_units(uuid, text, timestamp with time zone)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'private.calculate_observed_external_balance_atomic_units(uuid, text, timestamp with time zone)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.calculate_observed_external_balance_atomic_units(uuid, text, timestamp with time zone)'::regprocedure,
      'execute'
    ),
  'browser roles cannot execute observed balance functions'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname ~* '(observed.*balance|latest.*balance|external_balance|reconciliation.*aggregate)'
  ),
  0,
  'no public observed balance wrapper rpc exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'external_balance_observations'
      and indexname = 'external_balance_observations_latest_selector_idx'
      and indexdef like '%custody_account_binding_id%'
      and indexdef like '%observer_kind%'
      and indexdef like '%observed_at DESC%'
      and indexdef like '%created_at DESC%'
      and indexdef like '%id DESC%'
  ),
  'latest observation selector supporting index exists'
);

select extensions.ok(
  pg_get_functiondef(
    'private.select_latest_external_balance_observations(uuid, text, timestamp with time zone)'::regprocedure
  ) !~* '(insert|update|delete|truncate)[[:space:]]'
    and pg_get_functiondef(
      'private.calculate_observed_external_balance_atomic_units(uuid, text, timestamp with time zone)'::regprocedure
    ) !~* '(insert|update|delete|truncate)[[:space:]]',
  'selector and aggregate function bodies have no write statements'
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
    '00000000-0000-4000-8000-000000570101',
    'P5OBA_ASSET_A',
    'OBAA',
    'P5 Observed Balance Asset A',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000570102',
    'P5OBA_MISSING',
    'OBAM',
    'P5 Observed Balance Missing',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000570103',
    'P5OBA_NOTARGET',
    'OBAN',
    'P5 Observed Balance No Target',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000570104',
    'P5OBA_LARGE',
    'OBAL',
    'P5 Observed Balance Large',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000570105',
    'P5OBA_ZERO',
    'OBAZ',
    'P5 Observed Balance Zero',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000570106',
    'P5OBA_OBSERVER',
    'OBAO',
    'P5 Observed Balance Observer',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000570107',
    'P5OBA_OTHER',
    'OBAX',
    'P5 Observed Balance Other Asset',
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
  supports_transfer_observation
)
values
  (
    '00000000-0000-4000-8000-000000570201',
    'P5OBA_PROVIDER',
    'P5 Observed Balance Provider',
    'MPC_CUSTODIAN',
    true,
    false
  ),
  (
    '00000000-0000-4000-8000-000000570202',
    'P5OBA_NOBAL',
    'P5 Observed Balance No Balance Provider',
    'MPC_CUSTODIAN',
    false,
    true
  );

update private.custody_providers
set status = 'APPROVED'
where id in (
  '00000000-0000-4000-8000-000000570201',
  '00000000-0000-4000-8000-000000570202'
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
    '00000000-0000-4000-8000-000000570301',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570101',
    'p5oba_collection',
    'P5 OBA Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000570302',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570101',
    'p5oba_treasury',
    'P5 OBA Treasury',
    'TREASURY'
  ),
  (
    '00000000-0000-4000-8000-000000570303',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570101',
    'p5oba_fee',
    'P5 OBA Fee',
    'FEE'
  ),
  (
    '00000000-0000-4000-8000-000000570304',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570101',
    'p5oba_draft',
    'P5 OBA Draft',
    'PAYOUT'
  ),
  (
    '00000000-0000-4000-8000-000000570305',
    '00000000-0000-4000-8000-000000570202',
    '00000000-0000-4000-8000-000000570101',
    'p5oba_no_balance_capability',
    'P5 OBA No Balance Capability',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000570311',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570102',
    'p5oba_missing_observed',
    'P5 OBA Missing Observed',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000570312',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570102',
    'p5oba_missing_target',
    'P5 OBA Missing Target',
    'TREASURY'
  ),
  (
    '00000000-0000-4000-8000-000000570321',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570104',
    'p5oba_large_a',
    'P5 OBA Large A',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000570322',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570104',
    'p5oba_large_b',
    'P5 OBA Large B',
    'TREASURY'
  ),
  (
    '00000000-0000-4000-8000-000000570331',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570105',
    'p5oba_zero',
    'P5 OBA Zero',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000570341',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570106',
    'p5oba_observer',
    'P5 OBA Observer',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000570351',
    '00000000-0000-4000-8000-000000570201',
    '00000000-0000-4000-8000-000000570107',
    'p5oba_other_asset',
    'P5 OBA Other Asset',
    'COLLECTION'
  );

update private.custody_account_bindings
set status = 'APPROVED'
where id in (
  '00000000-0000-4000-8000-000000570301',
  '00000000-0000-4000-8000-000000570302',
  '00000000-0000-4000-8000-000000570303',
  '00000000-0000-4000-8000-000000570305',
  '00000000-0000-4000-8000-000000570311',
  '00000000-0000-4000-8000-000000570312',
  '00000000-0000-4000-8000-000000570321',
  '00000000-0000-4000-8000-000000570322',
  '00000000-0000-4000-8000-000000570331',
  '00000000-0000-4000-8000-000000570341',
  '00000000-0000-4000-8000-000000570351'
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
    '00000000-0000-4000-8000-000000570401',
    '00000000-0000-4000-8000-000000570301',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    'p5oba.a:old',
    100,
    '2026-07-29 01:00:00+00'::timestamptz,
    '2026-07-29 01:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570402',
    '00000000-0000-4000-8000-000000570301',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    'p5oba.a:selected',
    200,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570403',
    '00000000-0000-4000-8000-000000570301',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    'p5oba.a:future',
    999,
    '2026-07-29 03:00:00+00'::timestamptz,
    '2026-07-29 03:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570404',
    '00000000-0000-4000-8000-000000570301',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER_ALT',
    'p5oba.a:alt',
    888,
    '2026-07-29 02:10:00+00'::timestamptz,
    '2026-07-29 02:11:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570410',
    '00000000-0000-4000-8000-000000570302',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    'p5oba.treasury:early-created',
    300,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:30+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570409',
    '00000000-0000-4000-8000-000000570302',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    'p5oba.treasury:late-created',
    301,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:02:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570421',
    '00000000-0000-4000-8000-000000570303',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    'p5oba.fee:low-id',
    400,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570422',
    '00000000-0000-4000-8000-000000570303',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    'p5oba.fee:high-id',
    401,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570430',
    '00000000-0000-4000-8000-000000570304',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    'p5oba.draft:ignored',
    777,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570431',
    '00000000-0000-4000-8000-000000570305',
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    'p5oba.nobal:ignored',
    778,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570441',
    '00000000-0000-4000-8000-000000570311',
    '00000000-0000-4000-8000-000000570102',
    'BALANCE_OBSERVER',
    'p5oba.missing:observed',
    10,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570451',
    '00000000-0000-4000-8000-000000570321',
    '00000000-0000-4000-8000-000000570104',
    'BALANCE_OBSERVER',
    'p5oba.large:a',
    9007199254740993,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570452',
    '00000000-0000-4000-8000-000000570322',
    '00000000-0000-4000-8000-000000570104',
    'BALANCE_OBSERVER',
    'p5oba.large:b',
    9007199254740994,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570461',
    '00000000-0000-4000-8000-000000570331',
    '00000000-0000-4000-8000-000000570105',
    'BALANCE_OBSERVER',
    'p5oba.zero:0001',
    0,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570471',
    '00000000-0000-4000-8000-000000570341',
    '00000000-0000-4000-8000-000000570106',
    'BALANCE_OBSERVER',
    'p5oba.observer:main',
    50,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570472',
    '00000000-0000-4000-8000-000000570341',
    '00000000-0000-4000-8000-000000570106',
    'BALANCE_OBSERVER_ALT',
    'p5oba.observer:alt',
    60,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000570481',
    '00000000-0000-4000-8000-000000570351',
    '00000000-0000-4000-8000-000000570107',
    'BALANCE_OBSERVER',
    'p5oba.other:0001',
    700,
    '2026-07-29 02:00:00+00'::timestamptz,
    '2026-07-29 02:00:00+00'::timestamptz
  );

create temp table qa_p5oba_selector_a as
select *
from private.select_latest_external_balance_observations(
  '00000000-0000-4000-8000-000000570101',
  'BALANCE_OBSERVER',
  '2026-07-29 02:30:00+00'::timestamptz
);

select extensions.is(
  (select count(*)::integer from qa_p5oba_selector_a),
  3,
  'selector returns every observable target binding for asset'
);

select extensions.is(
  (
    select count(*)::integer
    from qa_p5oba_selector_a
    where custody_account_binding_id in (
      '00000000-0000-4000-8000-000000570304',
      '00000000-0000-4000-8000-000000570305',
      '00000000-0000-4000-8000-000000570351'
    )
  ),
  0,
  'selector excludes draft bindings, providers without balance capability, and other assets'
);

select extensions.is(
  (
    select count(*)::integer
    from qa_p5oba_selector_a
    where membership_status = 'OBSERVED'
  ),
  3,
  'all target bindings for asset A are observed at cutoff'
);

select extensions.is(
  (
    select observed_atomic_units::text
    from qa_p5oba_selector_a
    where custody_account_binding_id = '00000000-0000-4000-8000-000000570301'
  ),
  '200',
  'selector chooses latest observed_at before cutoff for binding'
);

select extensions.is(
  (
    select external_balance_observation_id
    from qa_p5oba_selector_a
    where custody_account_binding_id = '00000000-0000-4000-8000-000000570301'
  ),
  '00000000-0000-4000-8000-000000570402'::uuid,
  'selector excludes cutoff-after observation and other observer kind'
);

select extensions.is(
  (
    select external_balance_observation_id
    from private.select_latest_external_balance_observations(
      '00000000-0000-4000-8000-000000570101',
      'BALANCE_OBSERVER',
      '2026-07-29 03:30:00+00'::timestamptz
    )
    where custody_account_binding_id = '00000000-0000-4000-8000-000000570301'
  ),
  '00000000-0000-4000-8000-000000570403'::uuid,
  'later cutoff changes selected observation without using observation key order'
);

select extensions.is(
  (
    select observed_atomic_units::text
    from qa_p5oba_selector_a
    where custody_account_binding_id = '00000000-0000-4000-8000-000000570302'
  ),
  '301',
  'selector uses created_at as same-observed_at tie-break'
);

select extensions.is(
  (
    select external_balance_observation_id
    from qa_p5oba_selector_a
    where custody_account_binding_id = '00000000-0000-4000-8000-000000570303'
  ),
  '00000000-0000-4000-8000-000000570422'::uuid,
  'selector uses deterministic id tie-break after observed_at and created_at'
);

create temp table qa_p5oba_aggregate_a as
select *
from private.calculate_observed_external_balance_atomic_units(
  '00000000-0000-4000-8000-000000570101',
  'BALANCE_OBSERVER',
  '2026-07-29 02:30:00+00'::timestamptz
);

select extensions.is(
  (
    select target_binding_count::text || ',' ||
      observed_binding_count::text || ',' ||
      missing_binding_count::text || ',' ||
      is_complete::text || ',' ||
      observed_atomic_units::text
    from qa_p5oba_aggregate_a
  ),
  '3,3,0,true,902',
  'complete asset aggregate sums all selected target binding observations'
);

select extensions.is(
  (
    select observed_atomic_units::text
    from private.calculate_observed_external_balance_atomic_units(
      '00000000-0000-4000-8000-000000570101',
      'BALANCE_OBSERVER',
      '2026-07-29 02:30:00+00'::timestamptz
    )
  ),
  (
    select observed_atomic_units::text
    from qa_p5oba_aggregate_a
  ),
  'same aggregate input returns the same deterministic result'
);

create temp table qa_p5oba_selector_missing as
select *
from private.select_latest_external_balance_observations(
  '00000000-0000-4000-8000-000000570102',
  'BALANCE_OBSERVER',
  '2026-07-29 02:30:00+00'::timestamptz
);

select extensions.is(
  (
    select count(*)::integer
    from qa_p5oba_selector_missing
  ),
  2,
  'selector returns missing target binding membership'
);

select extensions.is(
  (
    select membership_status
    from qa_p5oba_selector_missing
    where custody_account_binding_id = '00000000-0000-4000-8000-000000570312'
  ),
  'MISSING_OBSERVATION',
  'missing binding is preserved as missing observation'
);

select extensions.ok(
  exists (
    select 1
    from qa_p5oba_selector_missing
    where custody_account_binding_id = '00000000-0000-4000-8000-000000570312'
      and external_balance_observation_id is null
      and observed_atomic_units is null
      and observed_at is null
  ),
  'missing binding does not receive a zero-valued observation'
);

create temp table qa_p5oba_aggregate_missing as
select *
from private.calculate_observed_external_balance_atomic_units(
  '00000000-0000-4000-8000-000000570102',
  'BALANCE_OBSERVER',
  '2026-07-29 02:30:00+00'::timestamptz
);

select extensions.is(
  (
    select target_binding_count::text || ',' ||
      observed_binding_count::text || ',' ||
      missing_binding_count::text || ',' ||
      is_complete::text
    from qa_p5oba_aggregate_missing
  ),
  '2,1,1,false',
  'incomplete asset aggregate exposes accurate target observed and missing counts'
);

select extensions.ok(
  (select observed_atomic_units is null from qa_p5oba_aggregate_missing),
  'incomplete aggregate returns null amount instead of a partial sum'
);

create temp table qa_p5oba_aggregate_zero as
select *
from private.calculate_observed_external_balance_atomic_units(
  '00000000-0000-4000-8000-000000570105',
  'BALANCE_OBSERVER',
  '2026-07-29 02:30:00+00'::timestamptz
);

select extensions.is(
  (
    select observed_atomic_units::text || ',' ||
      target_binding_count::text || ',' ||
      observed_binding_count::text || ',' ||
      missing_binding_count::text || ',' ||
      is_complete::text
    from qa_p5oba_aggregate_zero
  ),
  '0,1,1,0,true',
  'zero observation is a complete zero only when the binding has an observation'
);

select extensions.is(
  (
    select observed_atomic_units::text
    from private.calculate_observed_external_balance_atomic_units(
      '00000000-0000-4000-8000-000000570104',
      'BALANCE_OBSERVER',
      '2026-07-29 02:30:00+00'::timestamptz
    )
  ),
  '18014398509481987',
  'large atomic-unit aggregate remains exact beyond JavaScript safe integer range'
);

select extensions.is(
  (
    select observed_atomic_units::text
    from private.calculate_observed_external_balance_atomic_units(
      '00000000-0000-4000-8000-000000570106',
      'BALANCE_OBSERVER',
      '2026-07-29 02:30:00+00'::timestamptz
    )
  ),
  '50',
  'main observer kind aggregate excludes alternate observer observations'
);

select extensions.is(
  (
    select observed_atomic_units::text
    from private.calculate_observed_external_balance_atomic_units(
      '00000000-0000-4000-8000-000000570106',
      'BALANCE_OBSERVER_ALT',
      '2026-07-29 02:30:00+00'::timestamptz
    )
  ),
  '60',
  'alternate observer kind aggregate is independent'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.select_latest_external_balance_observations(
      '00000000-0000-4000-8000-000000579999',
      'BALANCE_OBSERVER',
      '2026-07-29 02:30:00+00'::timestamptz
    );
    raise exception 'expected missing asset failure';
  exception
    when foreign_key_violation then
      if sqlerrm <> 'asset_not_found' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'missing asset raises safe failure without exposing the input'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.calculate_observed_external_balance_atomic_units(
      '00000000-0000-4000-8000-000000570101',
      'bad observer',
      '2026-07-29 02:30:00+00'::timestamptz
    );
    raise exception 'expected observer kind failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observer_kind_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'invalid observer kind raises safe failure'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.calculate_observed_external_balance_atomic_units(
      '00000000-0000-4000-8000-000000570103',
      'BALANCE_OBSERVER',
      '2026-07-29 02:30:00+00'::timestamptz
    );
    raise exception 'expected no target binding failure';
  exception
    when check_violation then
      if sqlerrm <> 'observable_binding_not_found' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'existing asset with no observable binding raises safe failure'
);

create temp table qa_p5oba_side_effect_counts_before as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.external_transaction_observations) as transaction_observations,
  (select count(*)::bigint from private.reconciliation_runs) as reconciliation_runs,
  (select count(*)::bigint from private.reconciliation_items) as reconciliation_items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as binding_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries;

select extensions.lives_ok(
  $_$
  select count(*)::bigint
  from private.select_latest_external_balance_observations(
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    '2026-07-29 02:30:00+00'::timestamptz
  );

  select count(*)::bigint
  from private.calculate_observed_external_balance_atomic_units(
    '00000000-0000-4000-8000-000000570101',
    'BALANCE_OBSERVER',
    '2026-07-29 02:30:00+00'::timestamptz
  );
  $_$,
  'selector and aggregate execute for side effect audit'
);

select extensions.is(
  (
    select
      balance_observations::text || ',' ||
      transaction_observations::text || ',' ||
      reconciliation_runs::text || ',' ||
      reconciliation_items::text || ',' ||
      binding_observations::text || ',' ||
      observer_checkpoints::text || ',' ||
      ledger_journals::text || ',' ||
      ledger_entries::text
    from qa_p5oba_side_effect_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.external_transaction_observations)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_runs)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_items)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_item_binding_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text || ',' ||
      (select count(*)::bigint from private.ledger_journals)::text || ',' ||
      (select count(*)::bigint from private.ledger_entries)::text
  ),
  'selector and aggregate have zero persistence side effects'
);

select * from extensions.finish();

rollback;
