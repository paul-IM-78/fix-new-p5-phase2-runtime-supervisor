begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

create function pg_temp.insert_auth_user(test_user_id uuid)
returns void
language sql
as $$
  insert into auth.users (
    id,
    aud,
    role,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    test_user_id,
    'authenticated',
    'authenticated',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );
$$;

create function pg_temp.set_auth_context(
  test_user_id uuid,
  test_aal text default null
)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', test_user_id::text, true);

  if test_aal is null then
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', test_user_id::text)::text,
      true
    );
  else
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', test_user_id::text, 'aal', test_aal)::text,
      true
    );
  end if;
end;
$$;

select extensions.ok(
  to_regprocedure(
    'public.list_admin_reconciliation_items(integer, timestamp with time zone, uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone)'
  ) is not null,
  'list_admin_reconciliation_items exists'
);

select extensions.ok(
  to_regprocedure('public.get_admin_reconciliation_item_detail(uuid)') is not null,
  'get_admin_reconciliation_item_detail exists'
);

select extensions.is(
  pg_get_function_result(
    'public.list_admin_reconciliation_items(integer, timestamp with time zone, uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone)'::regprocedure
  ),
  'TABLE(reconciliation_item_id uuid, reconciliation_run_id uuid, asset_id uuid, asset_code text, asset_symbol text, asset_display_name text, asset_decimals smallint, scope_kind text, run_status text, trigger_source text, observer_kind text, observation_cutoff_at timestamp with time zone, started_at timestamp with time zone, completed_at timestamp with time zone, run_created_at timestamp with time zone, item_created_at timestamp with time zone, failure_code text, classification text, review_status text, review_version bigint, expected_units text, observed_units text, difference_units text, tolerance_units text, target_binding_count bigint, observed_binding_count bigint, missing_binding_count bigint, failed_binding_count bigint)',
  'list read model return contract is stable'
);

select extensions.is(
  pg_get_function_result(
    'public.get_admin_reconciliation_item_detail(uuid)'::regprocedure
  ),
  'TABLE(payload jsonb)',
  'detail read model returns one jsonb payload column'
);

select extensions.ok(
  (
    select procedures.provolatile = 's' and procedures.prosecdef
    from pg_proc as procedures
    where procedures.oid =
      'public.list_admin_reconciliation_items(integer, timestamp with time zone, uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone)'::regprocedure
  ),
  'list read model is stable security definer'
);

select extensions.ok(
  (
    select procedures.provolatile = 's' and procedures.prosecdef
    from pg_proc as procedures
    where procedures.oid =
      'public.get_admin_reconciliation_item_detail(uuid)'::regprocedure
  ),
  'detail read model is stable security definer'
);

select extensions.ok(
  (
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid =
      'public.list_admin_reconciliation_items(integer, timestamp with time zone, uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone)'::regprocedure
  ) in ('search_path=', 'search_path=""')
    and (
      select array_to_string(proconfig, ',')
      from pg_proc
      where oid = 'public.get_admin_reconciliation_item_detail(uuid)'::regprocedure
    ) in ('search_path=', 'search_path=""'),
  'read model functions have empty search_path'
);

select extensions.ok(
  obj_description(
    'public.list_admin_reconciliation_items(integer, timestamp with time zone, uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone)'::regprocedure,
    'pg_proc'
  ) is not null
    and obj_description(
      'public.get_admin_reconciliation_item_detail(uuid)'::regprocedure,
      'pg_proc'
    ) is not null,
  'read model functions have governance comments'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'public.list_admin_reconciliation_items(integer, timestamp with time zone, uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.list_admin_reconciliation_items(integer, timestamp with time zone, uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.list_admin_reconciliation_items(integer, timestamp with time zone, uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'public',
      'public.get_admin_reconciliation_item_detail(uuid)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.get_admin_reconciliation_item_detail(uuid)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.get_admin_reconciliation_item_detail(uuid)'::regprocedure,
      'execute'
    ),
  'read model grants execute only to authenticated browser role'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'private.reconciliation_runs',
    'select'
  )
    and not has_table_privilege(
      'authenticated',
      'private.reconciliation_items',
      'select'
    )
    and not has_table_privilege(
      'authenticated',
      'private.reconciliation_item_binding_observations',
      'select'
    )
    and not has_table_privilege(
      'authenticated',
      'private.reconciliation_review_cases',
      'select'
    )
    and not has_table_privilege(
      'authenticated',
      'private.reconciliation_review_case_events',
      'select'
    ),
  'authenticated cannot select reconciliation private tables directly'
);

select extensions.ok(
  pg_get_function_arguments(
    'public.list_admin_reconciliation_items(integer, timestamp with time zone, uuid, uuid, text, text, text, text, timestamp with time zone, timestamp with time zone)'::regprocedure
  ) !~* '(actor|profile|user|role|aal|admin)'
    and pg_get_function_arguments(
      'public.get_admin_reconciliation_item_detail(uuid)'::regprocedure
    ) !~* '(actor|profile|user|role|aal|admin)',
  'read model functions accept no caller-provided actor role or aal fields'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.views
    where table_schema = 'public'
      and table_name ~* '(reconciliation|external_balance|external_transaction|observer_checkpoint|observer_checkpoints)'
  ),
  'read model adds no public reconciliation view'
);

select extensions.is(
  (
    select coalesce(string_agg(procedures.proname::text, ',' order by procedures.proname), '')
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname ~* '(reconciliation|review_case|resolution)'
  ),
  'admin_open_review_case,admin_transition_review_case,get_admin_reconciliation_item_detail,list_admin_reconciliation_items',
  'public reconciliation and review-case RPC inventory is exact'
);

select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000710001');
select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000710002');

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000710001',
  'ADMIN',
  'local pgtap admin reconciliation read model fixture'
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
    '00000000-0000-4000-8000-000000710101',
    'P5READ_A',
    'P5RA',
    'P5 Read Asset A',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000710102',
    'P5READ_B',
    'P5RB',
    'P5 Read Asset B',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111711',
    'ACTIVE'
  );

insert into private.custody_providers (
  id,
  provider_code,
  display_name,
  provider_type,
  supports_balance_observation,
  status
)
values (
  '00000000-0000-4000-8000-000000710201',
  'P5READ_PROVIDER',
  'P5 Read Provider',
  'MPC_CUSTODIAN',
  true,
  'DRAFT'
);

update private.custody_providers
set
  status = 'APPROVED',
  approved_at = '2026-07-30 00:10:00+00'::timestamptz,
  version = version + 1
where id = '00000000-0000-4000-8000-000000710201';

insert into private.custody_account_bindings (
  id,
  custody_provider_id,
  asset_id,
  binding_key,
  display_label,
  account_role,
  status
)
values
  (
    '00000000-0000-4000-8000-000000710301',
    '00000000-0000-4000-8000-000000710201',
    '00000000-0000-4000-8000-000000710101',
    'p5read_collection_a',
    'P5 Read Collection A',
    'COLLECTION',
    'DRAFT'
  ),
  (
    '00000000-0000-4000-8000-000000710302',
    '00000000-0000-4000-8000-000000710201',
    '00000000-0000-4000-8000-000000710101',
    'p5read_payout_a',
    'P5 Read Payout A',
    'PAYOUT',
    'DRAFT'
  ),
  (
    '00000000-0000-4000-8000-000000710303',
    '00000000-0000-4000-8000-000000710201',
    '00000000-0000-4000-8000-000000710102',
    'p5read_collection_b',
    'P5 Read Collection B',
    'COLLECTION',
    'DRAFT'
  );

update private.custody_account_bindings
set
  status = 'APPROVED',
  approved_at = '2026-07-30 00:20:00+00'::timestamptz,
  version = version + 1
where id in (
  '00000000-0000-4000-8000-000000710301',
  '00000000-0000-4000-8000-000000710302',
  '00000000-0000-4000-8000-000000710303'
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
    '00000000-0000-4000-8000-000000710401',
    '00000000-0000-4000-8000-000000710301',
    '00000000-0000-4000-8000-000000710101',
    'BALANCE_OBSERVER',
    'p5read.balance.0001',
    60,
    '2026-07-30 00:55:00+00'::timestamptz,
    '2026-07-30 00:56:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710402',
    '00000000-0000-4000-8000-000000710302',
    '00000000-0000-4000-8000-000000710101',
    'BALANCE_OBSERVER',
    'p5read.balance.0002',
    48,
    '2026-07-30 00:56:00+00'::timestamptz,
    '2026-07-30 00:57:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710403',
    '00000000-0000-4000-8000-000000710303',
    '00000000-0000-4000-8000-000000710102',
    'BALANCE_OBSERVER',
    'p5read.balance.0003',
    99999999999999999999999999999999999999,
    '2026-07-30 00:57:00+00'::timestamptz,
    '2026-07-30 00:58:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710404',
    '00000000-0000-4000-8000-000000710301',
    '00000000-0000-4000-8000-000000710101',
    'BALANCE_OBSERVER',
    'p5read.balance.0004',
    52,
    '2026-07-30 02:25:00+00'::timestamptz,
    '2026-07-30 02:26:00+00'::timestamptz
  );

insert into private.reconciliation_runs (
  id,
  idempotency_key,
  trigger_source,
  status,
  started_at,
  completed_at,
  observer_kind,
  observation_cutoff_at,
  created_at
)
values
  (
    '00000000-0000-4000-8000-000000710501',
    'p5read.run.main.0001',
    'MANUAL',
    'COMPLETED',
    '2026-07-30 01:01:00+00'::timestamptz,
    '2026-07-30 01:02:00+00'::timestamptz,
    'BALANCE_OBSERVER',
    '2026-07-30 01:00:00+00'::timestamptz,
    '2026-07-30 01:03:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710502',
    'p5read.run.matched.0001',
    'SYSTEM',
    'COMPLETED',
    '2026-07-30 01:04:00+00'::timestamptz,
    '2026-07-30 01:05:00+00'::timestamptz,
    'BALANCE_OBSERVER',
    '2026-07-30 01:00:00+00'::timestamptz,
    '2026-07-30 01:06:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710503',
    'p5read.run.failed.0001',
    'BACKFILL',
    'PARTIAL',
    '2026-07-30 03:01:00+00'::timestamptz,
    '2026-07-30 03:02:00+00'::timestamptz,
    'BALANCE_OBSERVER',
    '2026-07-30 03:00:00+00'::timestamptz,
    '2026-07-30 03:03:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710504',
    'p5read.run.binding.0001',
    'MANUAL',
    'COMPLETED',
    '2026-07-30 02:20:00+00'::timestamptz,
    '2026-07-30 02:21:00+00'::timestamptz,
    'BALANCE_OBSERVER',
    '2026-07-30 02:30:00+00'::timestamptz,
    '2026-07-30 02:31:00+00'::timestamptz
  );

insert into private.reconciliation_items (
  id,
  reconciliation_run_id,
  asset_id,
  scope_kind,
  expected_units,
  observed_units,
  difference_units,
  tolerance_units,
  classification,
  created_at
)
values
  (
    '00000000-0000-4000-8000-000000710601',
    '00000000-0000-4000-8000-000000710502',
    '00000000-0000-4000-8000-000000710102',
    'ASSET_AGGREGATE',
    99999999999999999999999999999999999999,
    99999999999999999999999999999999999999,
    0,
    0,
    'MATCHED',
    '2026-07-30 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710602',
    '00000000-0000-4000-8000-000000710501',
    '00000000-0000-4000-8000-000000710101',
    'ASSET_AGGREGATE',
    100,
    108,
    8,
    5,
    'MISMATCH',
    '2026-07-30 02:00:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710603',
    '00000000-0000-4000-8000-000000710503',
    '00000000-0000-4000-8000-000000710101',
    'ASSET_AGGREGATE',
    100,
    null,
    null,
    0,
    'OBSERVATION_FAILED',
    '2026-07-30 03:10:00+00'::timestamptz
  );

insert into private.reconciliation_items (
  id,
  reconciliation_run_id,
  custody_account_binding_id,
  asset_id,
  external_balance_observation_id,
  scope_kind,
  expected_units,
  observed_units,
  difference_units,
  tolerance_units,
  classification,
  created_at
)
values (
  '00000000-0000-4000-8000-000000710604',
  '00000000-0000-4000-8000-000000710504',
  '00000000-0000-4000-8000-000000710301',
  '00000000-0000-4000-8000-000000710101',
  '00000000-0000-4000-8000-000000710404',
  'BINDING',
  50,
  52,
  2,
  5,
  'WITHIN_TOLERANCE',
  '2026-07-30 02:32:00+00'::timestamptz
);

insert into private.reconciliation_item_binding_observations (
  reconciliation_item_id,
  custody_account_binding_id,
  external_balance_observation_id,
  membership_status,
  created_at
)
values
  (
    '00000000-0000-4000-8000-000000710601',
    '00000000-0000-4000-8000-000000710303',
    '00000000-0000-4000-8000-000000710403',
    'OBSERVED',
    '2026-07-30 02:00:30+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710602',
    '00000000-0000-4000-8000-000000710301',
    '00000000-0000-4000-8000-000000710401',
    'OBSERVED',
    '2026-07-30 02:01:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710602',
    '00000000-0000-4000-8000-000000710302',
    '00000000-0000-4000-8000-000000710402',
    'OBSERVED',
    '2026-07-30 02:01:01+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710603',
    '00000000-0000-4000-8000-000000710301',
    null,
    'MISSING_OBSERVATION',
    '2026-07-30 03:11:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710603',
    '00000000-0000-4000-8000-000000710302',
    null,
    'OBSERVATION_FAILED',
    '2026-07-30 03:11:01+00'::timestamptz
  );

insert into private.reconciliation_review_cases (
  id,
  reconciliation_item_id,
  status,
  version,
  opened_at,
  updated_at,
  opened_by_profile_id,
  last_actor_profile_id,
  created_at
)
values (
  '00000000-0000-4000-8000-000000710701',
  '00000000-0000-4000-8000-000000710602',
  'IN_REVIEW',
  2,
  '2026-07-30 02:05:00+00'::timestamptz,
  '2026-07-30 02:06:00+00'::timestamptz,
  '00000000-0000-4000-8000-000000710001',
  '00000000-0000-4000-8000-000000710001',
  '2026-07-30 02:05:00+00'::timestamptz
);

insert into private.reconciliation_review_case_events (
  id,
  reconciliation_resolution_id,
  event_version,
  idempotency_key,
  event_type,
  from_status,
  to_status,
  actor_profile_id,
  reason_code,
  created_at
)
values
  (
    '00000000-0000-4000-8000-000000710801',
    '00000000-0000-4000-8000-000000710701',
    1,
    'p5read.review.open.0001',
    'OPENED',
    null,
    'OPEN',
    '00000000-0000-4000-8000-000000710001',
    'MISMATCH_REVIEW',
    '2026-07-30 02:05:00+00'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000710802',
    '00000000-0000-4000-8000-000000710701',
    2,
    'p5read.review.start.0001',
    'REVIEW_STARTED',
    'OPEN',
    'IN_REVIEW',
    '00000000-0000-4000-8000-000000710001',
    'START_REVIEW',
    '2026-07-30 02:06:00+00'::timestamptz
  );

create temporary table qa_reconciliation_read_counts_before as
select
  (select count(*)::bigint from private.reconciliation_runs) as runs,
  (select count(*)::bigint from private.reconciliation_items) as items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as item_members,
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.external_transaction_observations) as transaction_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints,
  (select count(*)::bigint from private.ledger_accounts) as ledger_accounts,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries,
  (select count(*)::bigint from private.reconciliation_review_cases) as review_cases,
  (select count(*)::bigint from private.reconciliation_review_case_events) as review_events;

reset role;
reset "request.jwt.claim.sub";
reset "request.jwt.claims";

select extensions.throws_ok(
  $$select * from public.list_admin_reconciliation_items(100, null, null, null, null, null, null, null, null, null)$$,
  '42501'::character(5),
  null,
  'unauthenticated list read is rejected'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000710002', 'aal2');

select extensions.throws_ok(
  $$select * from public.list_admin_reconciliation_items(100, null, null, null, null, null, null, null, null, null)$$,
  '42501'::character(5),
  null,
  'non-admin aal2 list read is rejected'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000710001', 'aal1');

select extensions.throws_ok(
  $$select * from public.get_admin_reconciliation_item_detail('00000000-0000-4000-8000-000000710602')$$,
  '42501'::character(5),
  null,
  'admin aal1 detail read is rejected'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000710001', 'aal2');

create temporary table qa_reconciliation_page_one as
select *
from public.list_admin_reconciliation_items(
  p_limit => 1,
  p_cutoff_from => '2026-07-30 00:00:00+00'::timestamptz,
  p_cutoff_to => '2026-07-30 02:00:00+00'::timestamptz
);

select extensions.is(
  (select count(*)::integer from qa_reconciliation_page_one),
  2,
  'list read returns caller limit plus one row for DB lookahead'
);

select extensions.is(
  (
    select string_agg(reconciliation_item_id::text, ',' order by item_created_at desc, reconciliation_item_id desc)
    from qa_reconciliation_page_one
  ),
  '00000000-0000-4000-8000-000000710602,00000000-0000-4000-8000-000000710601',
  'list read orders by item_created_at desc and item id desc'
);

create temporary table qa_reconciliation_after_cursor as
select *
from public.list_admin_reconciliation_items(
  p_limit => 100,
  p_before_created_at => '2026-07-30 02:00:00+00'::timestamptz,
  p_before_item_id => '00000000-0000-4000-8000-000000710602',
  p_cutoff_from => '2026-07-30 00:00:00+00'::timestamptz,
  p_cutoff_to => '2026-07-30 02:00:00+00'::timestamptz
);

select extensions.is(
  (select string_agg(reconciliation_item_id::text, ',' order by item_created_at desc, reconciliation_item_id desc) from qa_reconciliation_after_cursor),
  '00000000-0000-4000-8000-000000710601',
  'compound cursor pages after the created_at/id pair'
);

select extensions.is(
  (
    select reconciliation_item_id::text || ',' ||
      target_binding_count::text || ',' ||
      observed_binding_count::text || ',' ||
      missing_binding_count::text || ',' ||
      failed_binding_count::text
    from public.list_admin_reconciliation_items(
      p_limit => 100,
      p_classification => 'OBSERVATION_FAILED'
    )
    where reconciliation_item_id = '00000000-0000-4000-8000-000000710603'
  ),
  '00000000-0000-4000-8000-000000710603,2,0,1,1',
  'provenance counts distinguish target observed missing and failed members'
);

create temporary table qa_reconciliation_binding_list as
select *
from public.list_admin_reconciliation_items(
  p_limit => 100,
  p_classification => 'WITHIN_TOLERANCE'
)
where reconciliation_item_id = '00000000-0000-4000-8000-000000710604';

create temporary table qa_reconciliation_binding_detail as
select payload
from public.get_admin_reconciliation_item_detail(
  '00000000-0000-4000-8000-000000710604'
);

select extensions.is(
  (
    select target_binding_count::text || ',' ||
      observed_binding_count::text || ',' ||
      missing_binding_count::text || ',' ||
      failed_binding_count::text
    from qa_reconciliation_binding_list
  ),
  '1,1,0,0',
  'BINDING list read counts direct binding provenance'
);

select extensions.is(
  (
    select target_binding_count::text || ',' ||
      observed_binding_count::text || ',' ||
      missing_binding_count::text || ',' ||
      failed_binding_count::text
    from qa_reconciliation_binding_list
  ),
  (
    select jsonb_array_length(payload -> 'provenance')::text || ',' ||
      (
        select count(*)::text
        from jsonb_array_elements(payload -> 'provenance') as entry
        where entry ->> 'membershipStatus' = 'OBSERVED'
      ) || ',' ||
      (
        select count(*)::text
        from jsonb_array_elements(payload -> 'provenance') as entry
        where entry ->> 'membershipStatus' = 'MISSING_OBSERVATION'
      ) || ',' ||
      (
        select count(*)::text
        from jsonb_array_elements(payload -> 'provenance') as entry
        where entry ->> 'membershipStatus' = 'OBSERVATION_FAILED'
      )
    from qa_reconciliation_binding_detail
  ),
  'BINDING list provenance counts match detail provenance statuses'
);

select extensions.is(
  (
    select string_agg(reconciliation_item_id::text, ',' order by reconciliation_item_id)
    from public.list_admin_reconciliation_items(
      p_limit => 100,
      p_asset_id => '00000000-0000-4000-8000-000000710101',
      p_run_status => 'COMPLETED',
      p_classification => 'MISMATCH',
      p_review_state => 'IN_REVIEW',
      p_observer_kind => 'BALANCE_OBSERVER',
      p_cutoff_from => '2026-07-30 00:00:00+00'::timestamptz,
      p_cutoff_to => '2026-07-30 02:00:00+00'::timestamptz
    )
  ),
  '00000000-0000-4000-8000-000000710602',
  'asset run classification review observer and cutoff filters compose'
);

select extensions.is(
  (
    select string_agg(reconciliation_item_id::text, ',' order by reconciliation_item_id)
    from public.list_admin_reconciliation_items(
      p_limit => 100,
      p_classification => 'MATCHED',
      p_review_state => 'NONE'
    )
  ),
  '00000000-0000-4000-8000-000000710601',
  'review_state NONE returns items without review cases'
);

select extensions.is(
  (
    select expected_units || ',' ||
      coalesce(observed_units, 'NULL') || ',' ||
      coalesce(difference_units, 'NULL') || ',' ||
      tolerance_units
    from public.list_admin_reconciliation_items(
      p_limit => 100,
      p_asset_id => '00000000-0000-4000-8000-000000710102'
    )
    where reconciliation_item_id = '00000000-0000-4000-8000-000000710601'
  ),
  '99999999999999999999999999999999999999,99999999999999999999999999999999999999,0,0',
  'list read serializes exact numeric values as text'
);

select extensions.is(
  (
    select coalesce(observed_units, 'NULL') || ',' ||
      coalesce(difference_units, 'NULL')
    from public.list_admin_reconciliation_items(
      p_limit => 100,
      p_classification => 'OBSERVATION_FAILED'
    )
    where reconciliation_item_id = '00000000-0000-4000-8000-000000710603'
  ),
  'NULL,NULL',
  'list read preserves null observed and difference units'
);

select extensions.throws_ok(
  $$select * from public.list_admin_reconciliation_items(0, null, null, null, null, null, null, null, null, null)$$,
  '22023'::character(5),
  'INVALID_INPUT',
  'list read rejects limit below public range'
);

select extensions.throws_ok(
  $$select * from public.list_admin_reconciliation_items(101, null, null, null, null, null, null, null, null, null)$$,
  '22023'::character(5),
  'INVALID_INPUT',
  'list read rejects limit above public range'
);

select extensions.throws_ok(
  $$select * from public.list_admin_reconciliation_items(100, null, '00000000-0000-4000-8000-000000710602', null, null, null, null, null, null, null)$$,
  '22023'::character(5),
  'INVALID_INPUT',
  'list read rejects partial compound cursor'
);

select extensions.throws_ok(
  $$select * from public.list_admin_reconciliation_items(100, null, null, null, null, null, null, 'balance_observer', null, null)$$,
  '22023'::character(5),
  'INVALID_INPUT',
  'list read rejects invalid observer kind filter'
);

create temporary table qa_reconciliation_detail as
select payload
from public.get_admin_reconciliation_item_detail(
  '00000000-0000-4000-8000-000000710602'
);

select extensions.ok(
  (
    select payload #>> '{run,id}' = '00000000-0000-4000-8000-000000710501'
      and payload #>> '{run,status}' = 'COMPLETED'
      and payload #>> '{item,id}' = '00000000-0000-4000-8000-000000710602'
      and payload #>> '{item,asset,assetCode}' = 'P5READ_A'
      and payload #>> '{item,expectedUnits}' = '100'
      and payload #>> '{item,observedUnits}' = '108'
      and payload #>> '{item,differenceUnits}' = '8'
      and payload #>> '{item,toleranceUnits}' = '5'
    from qa_reconciliation_detail
  ),
  'detail read returns safe run item asset and numeric fields'
);

select extensions.ok(
  (
    select jsonb_array_length(payload -> 'provenance') = 2
      and payload #>> '{provenance,0,custodyAccountBindingId}' =
        '00000000-0000-4000-8000-000000710301'
      and payload #>> '{provenance,0,providerCode}' = 'P5READ_PROVIDER'
      and payload #>> '{provenance,0,bindingRole}' = 'COLLECTION'
      and payload #>> '{provenance,0,membershipStatus}' = 'OBSERVED'
      and payload #>> '{provenance,0,observedUnits}' = '60'
      and payload #>> '{provenance,1,bindingRole}' = 'PAYOUT'
      and payload #>> '{provenance,1,observedUnits}' = '48'
    from qa_reconciliation_detail
  ),
  'detail provenance exposes safe ordered binding observation metadata'
);

select extensions.ok(
  (
    select payload #>> '{reviewCase,id}' = '00000000-0000-4000-8000-000000710701'
      and payload #>> '{reviewCase,status}' = 'IN_REVIEW'
      and payload #>> '{reviewCase,version}' = '2'
      and jsonb_array_length(payload -> 'reviewEvents') = 2
      and payload #>> '{reviewEvents,0,eventVersion}' = '1'
      and payload #>> '{reviewEvents,0,eventType}' = 'OPENED'
      and payload #>> '{reviewEvents,1,eventVersion}' = '2'
      and payload #>> '{reviewEvents,1,eventType}' = 'REVIEW_STARTED'
    from qa_reconciliation_detail
  ),
  'detail review case and event history are ordered and safe'
);

select extensions.ok(
  (
    select payload::text !~* '(idempotency|actorProfile|openedByProfile|lastActorProfile|requestedByProfile|observationKey|checkpoint|jwt|cookie|service[[:space:]_-]*role|mnemonic|private[[:space:]_-]*key)'
    from qa_reconciliation_detail
  ),
  'detail payload excludes forbidden identity idempotency raw provider and session fields'
);

select extensions.is(
  (
    select count(*)::integer
    from public.get_admin_reconciliation_item_detail(
      '00000000-0000-4000-8000-000000710999'
    )
  ),
  0,
  'detail read returns zero rows for missing item'
);

select extensions.throws_ok(
  $$select * from public.get_admin_reconciliation_item_detail(null)$$,
  '22023'::character(5),
  'INVALID_INPUT',
  'detail read rejects null item id'
);

reset role;

select extensions.is(
  (
    select
      runs::text || ',' ||
      items::text || ',' ||
      item_members::text || ',' ||
      balance_observations::text || ',' ||
      transaction_observations::text || ',' ||
      observer_checkpoints::text || ',' ||
      ledger_accounts::text || ',' ||
      ledger_journals::text || ',' ||
      ledger_entries::text || ',' ||
      review_cases::text || ',' ||
      review_events::text
    from qa_reconciliation_read_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.reconciliation_runs)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_items)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_item_binding_observations)::text || ',' ||
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.external_transaction_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text || ',' ||
      (select count(*)::bigint from private.ledger_accounts)::text || ',' ||
      (select count(*)::bigint from private.ledger_journals)::text || ',' ||
      (select count(*)::bigint from private.ledger_entries)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_review_cases)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_review_case_events)::text
  ),
  'read model RPCs leave reconciliation observation checkpoint ledger and review rows unchanged'
);

select * from extensions.finish();

rollback;
