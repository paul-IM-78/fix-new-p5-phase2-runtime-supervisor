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

create function pg_temp.expect_failure(
  expected_message text,
  command_sql text
)
returns void
language plpgsql
as $$
begin
  execute command_sql;
  raise exception 'expected failure: %', expected_message;
exception
  when others then
    if sqlerrm <> expected_message then
      raise;
    end if;
end;
$$;

select extensions.has_table(
  'private',
  'reconciliation_review_cases',
  'private.reconciliation_review_cases exists'
);

select extensions.has_table(
  'private',
  'reconciliation_review_case_events',
  'private.reconciliation_review_case_events exists'
);

select extensions.ok(
  to_regclass('private.reconciliation_resolutions') is null
    and to_regclass('private.reconciliation_resolution_events') is null,
  'legacy resolution table names remain absent for existing core contract compatibility'
);

select extensions.ok(
  to_regclass('public.reconciliation_review_cases') is null
    and to_regclass('public.reconciliation_review_case_events') is null
    and to_regclass('public.reconciliation_resolutions') is null
    and to_regclass('public.reconciliation_resolution_events') is null,
  'no public reconciliation review tables exist'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'reconciliation_review_cases'
      and column_name in (
        'id',
        'reconciliation_item_id',
        'status',
        'version',
        'opened_at',
        'updated_at',
        'resolved_at',
        'opened_by_profile_id',
        'last_actor_profile_id',
        'created_at'
      )
    group by table_schema, table_name
    having count(*) = 10
  ),
  'review case required columns exist'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'reconciliation_review_case_events'
      and column_name in (
        'id',
        'reconciliation_resolution_id',
        'event_version',
        'idempotency_key',
        'event_type',
        'from_status',
        'to_status',
        'actor_profile_id',
        'reason_code',
        'created_at'
      )
    group by table_schema, table_name
    having count(*) = 10
  ),
  'review event required columns exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_attribute
    where attrelid = 'private.reconciliation_review_cases'::regclass
      and attname = 'version'
      and atttypid = 'bigint'::regtype
      and attnotnull
  )
    and exists (
      select 1
      from pg_attrdef
      where adrelid = 'private.reconciliation_review_cases'::regclass
        and adnum = (
          select attnum
          from pg_attribute
          where attrelid = 'private.reconciliation_review_cases'::regclass
            and attname = 'version'
        )
        and pg_get_expr(adbin, adrelid) = '1'
    ),
  'review case version is non-null bigint with default 1'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.reconciliation_review_cases'::regclass
      and conname in (
        'reconciliation_resolutions_item_uidx',
        'reconciliation_resolutions_status_check',
        'reconciliation_resolutions_version_check',
        'reconciliation_resolutions_terminal_shape_check'
      )
    group by conrelid
    having count(*) = 4
  ),
  'review case unique status version and terminal-shape constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.reconciliation_review_case_events'::regclass
      and conname in (
        'reconciliation_resolution_events_version_uidx',
        'reconciliation_resolution_events_resolution_key_uidx',
        'reconciliation_resolution_events_key_uidx',
        'reconciliation_resolution_events_version_check',
        'reconciliation_resolution_events_event_type_check',
        'reconciliation_resolution_events_status_check',
        'reconciliation_resolution_events_reason_code_check',
        'reconciliation_resolution_events_type_status_check'
      )
    group by conrelid
    having count(*) = 8
  ),
  'review event unique version idempotency status and reason constraints exist'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_constraint
    where conrelid in (
        'private.reconciliation_review_cases'::regclass,
        'private.reconciliation_review_case_events'::regclass
      )
      and contype = 'f'
      and confdeltype = 'r'
  ) = 5
    and exists (
      select 1
      from pg_constraint
      where conrelid = 'private.reconciliation_review_cases'::regclass
        and confrelid = 'private.reconciliation_items'::regclass
    )
    and exists (
      select 1
      from pg_constraint
      where conrelid = 'private.reconciliation_review_case_events'::regclass
        and confrelid = 'private.reconciliation_review_cases'::regclass
    )
    and (
      select count(*)::integer
      from pg_constraint
      where conrelid in (
          'private.reconciliation_review_cases'::regclass,
          'private.reconciliation_review_case_events'::regclass
        )
        and confrelid = 'public.profiles'::regclass
    ) = 3,
  'review lifecycle foreign keys use ON DELETE RESTRICT'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'reconciliation_review_cases'
      and indexname in (
        'reconciliation_resolutions_item_uidx',
        'reconciliation_resolutions_status_updated_idx',
        'reconciliation_resolutions_last_actor_idx'
      )
    group by schemaname, tablename
    having count(*) = 3
  ),
  'review case lookup indexes exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'reconciliation_review_case_events'
      and indexname in (
        'reconciliation_resolution_events_version_uidx',
        'reconciliation_resolution_events_resolution_key_uidx',
        'reconciliation_resolution_events_key_uidx',
        'reconciliation_resolution_events_resolution_version_idx',
        'reconciliation_resolution_events_actor_created_idx',
        'reconciliation_resolution_events_created_idx'
      )
    group by schemaname, tablename
    having count(*) = 6
  ),
  'review event lookup and idempotency indexes exist'
);

select extensions.ok(
  obj_description('private.reconciliation_review_cases'::regclass, 'pg_class') is not null
    and obj_description('private.reconciliation_review_case_events'::regclass, 'pg_class') is not null,
  'review lifecycle tables have governance comments'
);

select extensions.ok(
  not has_table_privilege('public', 'private.reconciliation_review_cases', 'select')
    and not has_table_privilege('anon', 'private.reconciliation_review_cases', 'select')
    and not has_table_privilege('authenticated', 'private.reconciliation_review_cases', 'select')
    and not has_table_privilege('authenticated', 'private.reconciliation_review_cases', 'insert')
    and not has_table_privilege('authenticated', 'private.reconciliation_review_cases', 'update')
    and not has_table_privilege('authenticated', 'private.reconciliation_review_cases', 'delete')
    and not has_table_privilege('public', 'private.reconciliation_review_case_events', 'select')
    and not has_table_privilege('anon', 'private.reconciliation_review_case_events', 'select')
    and not has_table_privilege('authenticated', 'private.reconciliation_review_case_events', 'insert')
    and not has_table_privilege('authenticated', 'private.reconciliation_review_case_events', 'update')
    and not has_table_privilege('authenticated', 'private.reconciliation_review_case_events', 'delete'),
  'browser roles have no direct table privileges for review lifecycle data'
);

select extensions.ok(
  to_regprocedure('private.open_reconciliation_resolution(uuid, text, uuid, text)') is not null
    and to_regprocedure('private.transition_reconciliation_resolution(uuid, bigint, text, text, uuid, text)') is not null,
  'open and transition private functions exist'
);

select extensions.is(
  pg_get_function_result(
    'private.open_reconciliation_resolution(uuid, text, uuid, text)'::regprocedure
  ),
  'TABLE(reconciliation_resolution_id uuid, created boolean, status text, version bigint, event_id uuid)',
  'open function return contract is stable'
);

select extensions.is(
  pg_get_function_result(
    'private.transition_reconciliation_resolution(uuid, bigint, text, text, uuid, text)'::regprocedure
  ),
  'TABLE(reconciliation_resolution_id uuid, event_id uuid, created boolean, status text, version bigint)',
  'transition function return contract is stable'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'open_reconciliation_resolution',
        'transition_reconciliation_resolution'
      )
      and procedures.provolatile = 'v'
      and not procedures.prosecdef
    group by namespaces.nspname
    having count(*) = 2
  ),
  'open and transition functions are volatile security invoker'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'private.open_reconciliation_resolution(uuid, text, uuid, text)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'private.open_reconciliation_resolution(uuid, text, uuid, text)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.open_reconciliation_resolution(uuid, text, uuid, text)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'public',
      'private.transition_reconciliation_resolution(uuid, bigint, text, text, uuid, text)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'private.transition_reconciliation_resolution(uuid, bigint, text, text, uuid, text)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.transition_reconciliation_resolution(uuid, bigint, text, text, uuid, text)'::regprocedure,
      'execute'
    ),
  'browser roles cannot execute review lifecycle functions'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname ~ 'reconciliation_resolution'
      and procedures.prosecdef
  ),
  'review lifecycle adds no SECURITY DEFINER private function'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname ~* '(reconciliation|resolution)'
      and procedures.proname not in (
        'list_admin_reconciliation_items',
        'get_admin_reconciliation_item_detail'
      )
  ) = 0,
  'review lifecycle leaves only approved public reconciliation read RPCs'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.views
    where table_schema = 'public'
      and table_name ~* '(reconciliation|resolution)'
  ),
  'review lifecycle adds no public view'
);

select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000590001');
select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000590002');

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
select
  ('00000000-0000-4000-8000-00000059' || lpad(asset_no::text, 4, '0'))::uuid,
  format('P5REV_%s', asset_no),
  format('RV%s', asset_no),
  format('P5 Review Asset %s', asset_no),
  'NATIVE',
  9,
  null,
  'ACTIVE'
from generate_series(101, 112) as asset_no;

insert into private.custody_providers (
  id,
  provider_code,
  display_name,
  provider_type,
  supports_balance_observation
)
values (
  '00000000-0000-4000-8000-000000590201',
  'P5REV_PROVIDER',
  'P5 Review Provider',
  'MPC_CUSTODIAN',
  true
);

update private.custody_providers
set status = 'APPROVED'
where id = '00000000-0000-4000-8000-000000590201';

insert into private.custody_account_bindings (
  id,
  custody_provider_id,
  asset_id,
  binding_key,
  display_label,
  account_role
)
select
  ('00000000-0000-4000-8000-00000059' || lpad(binding_no::text, 4, '0'))::uuid,
  '00000000-0000-4000-8000-000000590201',
  ('00000000-0000-4000-8000-00000059' || lpad(asset_no::text, 4, '0'))::uuid,
  format('p5rev_binding_%s', asset_no),
  format('P5 Review Binding %s', asset_no),
  'COLLECTION'
from generate_series(101, 112) as asset_no
cross join lateral (select asset_no + 200 as binding_no) as binding_numbers;

update private.custody_account_bindings
set status = 'APPROVED'
where custody_provider_id = '00000000-0000-4000-8000-000000590201';

insert into private.external_balance_observations (
  id,
  custody_account_binding_id,
  asset_id,
  observer_kind,
  observation_key,
  observed_units,
  observed_at
)
select
  ('00000000-0000-4000-8000-00000059' || lpad((asset_no + 300)::text, 4, '0'))::uuid,
  ('00000000-0000-4000-8000-00000059' || lpad((asset_no + 200)::text, 4, '0'))::uuid,
  ('00000000-0000-4000-8000-00000059' || lpad(asset_no::text, 4, '0'))::uuid,
  'BALANCE_OBSERVER',
  format('p5rev.observation.%s', asset_no),
  case
    when asset_no = 101 then 100
    when asset_no = 102 then 103
    else 108
  end,
  '2026-07-29 02:00:00+00'::timestamptz
from generate_series(101, 112) as asset_no;

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
select
  ('00000000-0000-4000-8000-00000059' || lpad((asset_no + 500)::text, 4, '0'))::uuid,
  format('p5r07.run.%s', asset_no),
  'MANUAL',
  case when asset_no = 104 then 'PARTIAL' else 'COMPLETED' end,
  '2026-07-29 02:10:00+00'::timestamptz,
  '2026-07-29 02:11:00+00'::timestamptz,
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz
from generate_series(101, 112) as asset_no;

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
  classification
)
select
  ('00000000-0000-4000-8000-00000059' || lpad((asset_no + 600)::text, 4, '0'))::uuid,
  ('00000000-0000-4000-8000-00000059' || lpad((asset_no + 500)::text, 4, '0'))::uuid,
  ('00000000-0000-4000-8000-00000059' || lpad((asset_no + 200)::text, 4, '0'))::uuid,
  ('00000000-0000-4000-8000-00000059' || lpad(asset_no::text, 4, '0'))::uuid,
  case
    when asset_no = 104 then null
    else ('00000000-0000-4000-8000-00000059' || lpad((asset_no + 300)::text, 4, '0'))::uuid
  end,
  'BINDING',
  100,
  case
    when asset_no = 104 then null
    when asset_no = 101 then 100
    when asset_no = 102 then 103
    else 108
  end,
  case
    when asset_no = 104 then null
    when asset_no = 101 then 0
    when asset_no = 102 then 3
    else 8
  end,
  5,
  case
    when asset_no = 101 then 'MATCHED'
    when asset_no = 102 then 'WITHIN_TOLERANCE'
    when asset_no = 104 then 'OBSERVATION_FAILED'
    else 'MISMATCH'
  end
from generate_series(101, 112) as asset_no;

create temp table qa_review_side_effect_counts_before as
select
  (select count(*)::bigint from private.reconciliation_runs) as runs,
  (select count(*)::bigint from private.reconciliation_items) as items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as members,
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.external_transaction_observations) as transaction_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints,
  (select count(*)::bigint from private.ledger_accounts) as ledger_accounts,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries;

create temp table qa_review_open_mismatch as
select *
from private.open_reconciliation_resolution(
  '00000000-0000-4000-8000-000000590703',
  'p5r07.open.mismatch.0001',
  '00000000-0000-4000-8000-000000590001',
  'MISMATCH_REVIEW'
);

select extensions.ok(
  (
    select created
      and status = 'OPEN'
      and version = 1
      and reconciliation_resolution_id is not null
      and event_id is not null
    from qa_review_open_mismatch
  ),
  'MISMATCH item opens a review case at version 1 with one OPENED event'
);

select extensions.is(
  (
    select cases.status || ',' ||
      cases.version::text || ',' ||
      cases.opened_by_profile_id::text || ',' ||
      cases.last_actor_profile_id::text || ',' ||
      coalesce(cases.resolved_at::text, 'NULL')
    from private.reconciliation_review_cases as cases
    join qa_review_open_mismatch as result
      on result.reconciliation_resolution_id = cases.id
  ),
  'OPEN,1,00000000-0000-4000-8000-000000590001,00000000-0000-4000-8000-000000590001,NULL',
  'opened review case stores actor current state and no terminal timestamp'
);

select extensions.is(
  (
    select events.event_type || ',' ||
      coalesce(events.from_status, 'NULL') || ',' ||
      events.to_status || ',' ||
      events.event_version::text || ',' ||
      events.actor_profile_id::text || ',' ||
      events.reason_code
    from private.reconciliation_review_case_events as events
    join qa_review_open_mismatch as result
      on result.event_id = events.id
  ),
  'OPENED,NULL,OPEN,1,00000000-0000-4000-8000-000000590001,MISMATCH_REVIEW',
  'open appends an immutable OPENED event with safe reason code'
);

create temp table qa_review_open_replay_counts_before as
select
  (select count(*)::bigint from private.reconciliation_review_cases) as cases,
  (select count(*)::bigint from private.reconciliation_review_case_events) as events,
  (
    select opened_at
    from private.reconciliation_review_cases
    where id = (select reconciliation_resolution_id from qa_review_open_mismatch)
  ) as opened_at,
  (
    select updated_at
    from private.reconciliation_review_cases
    where id = (select reconciliation_resolution_id from qa_review_open_mismatch)
  ) as updated_at;

create temp table qa_review_open_mismatch_replay as
select *
from private.open_reconciliation_resolution(
  '00000000-0000-4000-8000-000000590703',
  'p5r07.open.mismatch.0001',
  '00000000-0000-4000-8000-000000590001',
  'MISMATCH_REVIEW'
);

select extensions.ok(
  (select not created from qa_review_open_mismatch_replay)
    and (
      select reconciliation_resolution_id
      from qa_review_open_mismatch_replay
    ) = (
      select reconciliation_resolution_id
      from qa_review_open_mismatch
    )
    and (
      select event_id
      from qa_review_open_mismatch_replay
    ) = (
      select event_id
      from qa_review_open_mismatch
    ),
  'exact open replay returns the original case and event with created false'
);

select extensions.is(
  (
    select cases::text || ',' || events::text
    from qa_review_open_replay_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.reconciliation_review_cases)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_review_case_events)::text
  ),
  'exact open replay creates no additional rows'
);

select extensions.ok(
  exists (
    select 1
    from qa_review_open_replay_counts_before as before_values
    join private.reconciliation_review_cases as cases
      on cases.id = (select reconciliation_resolution_id from qa_review_open_mismatch)
    where cases.opened_at = before_values.opened_at
      and cases.updated_at = before_values.updated_at
  ),
  'exact open replay does not mutate review case timestamps'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_idempotency_conflict',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590703',
        'p5r07.open.mismatch.0001',
        '00000000-0000-4000-8000-000000590002',
        'MISMATCH_REVIEW'
      )
    $inner$
  );
  $_$,
  'same open idempotency key with different actor is rejected'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_already_exists',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590703',
        'p5r07.open.mismatch.0002',
        '00000000-0000-4000-8000-000000590001',
        'MISMATCH_REVIEW'
      )
    $inner$
  );
  $_$,
  'same item with a different open idempotency key is rejected'
);

create temp table qa_review_open_observation_failed as
select *
from private.open_reconciliation_resolution(
  '00000000-0000-4000-8000-000000590704',
  'p5r07.open.observationfailed.0001',
  '00000000-0000-4000-8000-000000590001',
  'OBSERVATION_FAILED_REVIEW'
);

select extensions.ok(
  (
    select created
      and status = 'OPEN'
      and version = 1
    from qa_review_open_observation_failed
  ),
  'OBSERVATION_FAILED item can open a review case'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_item_not_reviewable',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590701',
        'p5r07.open.matched.0001',
        '00000000-0000-4000-8000-000000590001',
        'MATCHED_REVIEW'
      )
    $inner$
  );
  $_$,
  'MATCHED item cannot open a review case'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_item_not_reviewable',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590702',
        'p5r07.open.within.0001',
        '00000000-0000-4000-8000-000000590001',
        'WITHIN_REVIEW'
      )
    $inner$
  );
  $_$,
  'WITHIN_TOLERANCE item cannot open a review case'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_item_not_found',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000599999',
        'p5r07.open.missing.0001',
        '00000000-0000-4000-8000-000000590001',
        'MISSING_REVIEW'
      )
    $inner$
  );
  $_$,
  'missing item cannot open a review case'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_actor_not_found',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590705',
        'p5r07.open.missingactor.0001',
        '00000000-0000-4000-8000-000000599999',
        'MISMATCH_REVIEW'
      )
    $inner$
  );
  $_$,
  'missing actor profile is rejected'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_idempotency_key_invalid',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590705',
        ' ',
        '00000000-0000-4000-8000-000000590001',
        'MISMATCH_REVIEW'
      )
    $inner$
  );
  $_$,
  'blank idempotency key is rejected'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_reason_code_invalid',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590705',
        'p5r07.open.badreason.0001',
        '00000000-0000-4000-8000-000000590001',
        'bad_reason'
      )
    $inner$
  );
  $_$,
  'lowercase reason code is rejected'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_reason_code_invalid',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590705',
        'p5r07.open.spacereason.0001',
        '00000000-0000-4000-8000-000000590001',
        'BAD REASON'
      )
    $inner$
  );
  $_$,
  'reason code with whitespace is rejected'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_reason_code_invalid',
    $inner$
      select *
      from private.open_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590705',
        'p5r07.open.longreason.0001',
        '00000000-0000-4000-8000-000000590001',
        repeat('A', 65)
      )
    $inner$
  );
  $_$,
  'overlong reason code is rejected'
);

create temp table qa_review_transition_in_review as
select *
from private.transition_reconciliation_resolution(
  (select reconciliation_resolution_id from qa_review_open_mismatch),
  1,
  'IN_REVIEW',
  'p5r07.transition.inreview.0001',
  '00000000-0000-4000-8000-000000590002',
  'START_REVIEW'
);

select extensions.ok(
  (
    select created
      and status = 'IN_REVIEW'
      and version = 2
      and event_id is not null
    from qa_review_transition_in_review
  ),
  'OPEN to IN_REVIEW succeeds and increments version'
);

select extensions.is(
  (
    select cases.status || ',' ||
      cases.version::text || ',' ||
      cases.last_actor_profile_id::text || ',' ||
      coalesce(cases.resolved_at::text, 'NULL')
    from private.reconciliation_review_cases as cases
    where cases.id = (select reconciliation_resolution_id from qa_review_open_mismatch)
  ),
  'IN_REVIEW,2,00000000-0000-4000-8000-000000590002,NULL',
  'IN_REVIEW current state has version 2 no terminal timestamp'
);

select extensions.is(
  (
    select events.event_type || ',' ||
      events.from_status || ',' ||
      events.to_status || ',' ||
      events.event_version::text || ',' ||
      events.actor_profile_id::text || ',' ||
      events.reason_code
    from private.reconciliation_review_case_events as events
    join qa_review_transition_in_review as result
      on result.event_id = events.id
  ),
  'REVIEW_STARTED,OPEN,IN_REVIEW,2,00000000-0000-4000-8000-000000590002,START_REVIEW',
  'IN_REVIEW transition appends REVIEW_STARTED event'
);

create temp table qa_review_transition_replay_counts_before as
select
  (select count(*)::bigint from private.reconciliation_review_case_events) as events,
  (
    select updated_at
    from private.reconciliation_review_cases
    where id = (select reconciliation_resolution_id from qa_review_open_mismatch)
  ) as updated_at;

create temp table qa_review_transition_in_review_replay as
select *
from private.transition_reconciliation_resolution(
  (select reconciliation_resolution_id from qa_review_open_mismatch),
  1,
  'IN_REVIEW',
  'p5r07.transition.inreview.0001',
  '00000000-0000-4000-8000-000000590002',
  'START_REVIEW'
);

select extensions.ok(
  (select not created from qa_review_transition_in_review_replay)
    and (
      select event_id
      from qa_review_transition_in_review_replay
    ) = (
      select event_id
      from qa_review_transition_in_review
    )
    and (
      select version
      from qa_review_transition_in_review_replay
    ) = 2,
  'exact transition replay returns original transition event'
);

select extensions.is(
  (
    select events::text
    from qa_review_transition_replay_counts_before
  ),
  (
    select count(*)::bigint::text
    from private.reconciliation_review_case_events
  ),
  'exact transition replay creates no additional event'
);

select extensions.ok(
  exists (
    select 1
    from qa_review_transition_replay_counts_before as before_values
    join private.reconciliation_review_cases as cases
      on cases.id = (select reconciliation_resolution_id from qa_review_open_mismatch)
    where cases.updated_at = before_values.updated_at
  ),
  'exact transition replay does not mutate current-state timestamp'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_idempotency_conflict',
    $inner$
      select *
      from private.transition_reconciliation_resolution(
        (select reconciliation_resolution_id from qa_review_open_mismatch),
        1,
        'IN_REVIEW',
        'p5r07.transition.inreview.0001',
        '00000000-0000-4000-8000-000000590002',
        'DIFFERENT_REASON'
      )
    $inner$
  );
  $_$,
  'same transition idempotency key with different reason is rejected'
);

create temp table qa_review_transition_resolved_from_in_review as
select *
from private.transition_reconciliation_resolution(
  (select reconciliation_resolution_id from qa_review_open_mismatch),
  2,
  'RESOLVED',
  'p5r07.transition.resolved.0001',
  '00000000-0000-4000-8000-000000590001',
  'RESOLVED_MATCH'
);

select extensions.ok(
  (
    select created
      and status = 'RESOLVED'
      and version = 3
    from qa_review_transition_resolved_from_in_review
  ),
  'IN_REVIEW to RESOLVED succeeds and increments version'
);

select extensions.ok(
  exists (
    select 1
    from private.reconciliation_review_cases as cases
    where cases.id = (select reconciliation_resolution_id from qa_review_open_mismatch)
      and cases.status = 'RESOLVED'
      and cases.version = 3
      and cases.resolved_at is not null
  ),
  'RESOLVED terminal state requires resolved_at'
);

create temp table qa_review_open_resolved_direct as
select *
from private.open_reconciliation_resolution(
  '00000000-0000-4000-8000-000000590705',
  'p5r07.open.directresolved.0001',
  '00000000-0000-4000-8000-000000590001',
  'DIRECT_RESOLUTION'
);

create temp table qa_review_transition_resolved_direct as
select *
from private.transition_reconciliation_resolution(
  (select reconciliation_resolution_id from qa_review_open_resolved_direct),
  1,
  'RESOLVED',
  'p5r07.transition.directresolved.0001',
  '00000000-0000-4000-8000-000000590002',
  'DIRECT_RESOLUTION'
);

select extensions.ok(
  (
    select created and status = 'RESOLVED' and version = 2
    from qa_review_transition_resolved_direct
  ),
  'OPEN to RESOLVED succeeds'
);

create temp table qa_review_open_ignored_direct as
select *
from private.open_reconciliation_resolution(
  '00000000-0000-4000-8000-000000590706',
  'p5r07.open.directignored.0001',
  '00000000-0000-4000-8000-000000590001',
  'DIRECT_IGNORE'
);

create temp table qa_review_transition_ignored_direct as
select *
from private.transition_reconciliation_resolution(
  (select reconciliation_resolution_id from qa_review_open_ignored_direct),
  1,
  'IGNORED',
  'p5r07.transition.directignored.0001',
  '00000000-0000-4000-8000-000000590002',
  'DIRECT_IGNORE'
);

select extensions.ok(
  (
    select created and status = 'IGNORED' and version = 2
    from qa_review_transition_ignored_direct
  ),
  'OPEN to IGNORED succeeds'
);

create temp table qa_review_open_in_review_ignored as
select *
from private.open_reconciliation_resolution(
  '00000000-0000-4000-8000-000000590707',
  'p5r07.open.inreviewignored.0001',
  '00000000-0000-4000-8000-000000590001',
  'IGNORE_AFTER_REVIEW'
);

create temp table qa_review_transition_in_review_ignored_step as
select *
from private.transition_reconciliation_resolution(
  (select reconciliation_resolution_id from qa_review_open_in_review_ignored),
  1,
  'IN_REVIEW',
  'p5r07.transition.inreviewignored.0001',
  '00000000-0000-4000-8000-000000590002',
  'START_REVIEW'
);

create temp table qa_review_transition_ignored_from_in_review as
select *
from private.transition_reconciliation_resolution(
  (select reconciliation_resolution_id from qa_review_open_in_review_ignored),
  2,
  'IGNORED',
  'p5r07.transition.inreviewignored.0002',
  '00000000-0000-4000-8000-000000590001',
  'IGNORE_AFTER_REVIEW'
);

select extensions.ok(
  (
    select created and status = 'IGNORED' and version = 3
    from qa_review_transition_ignored_from_in_review
  ),
  'IN_REVIEW to IGNORED succeeds'
);

create temp table qa_review_open_invalid as
select *
from private.open_reconciliation_resolution(
  '00000000-0000-4000-8000-000000590708',
  'p5r07.open.invalid.0001',
  '00000000-0000-4000-8000-000000590001',
  'INVALID_MATRIX'
);

create temp table qa_review_open_invalid_in_review as
select *
from private.open_reconciliation_resolution(
  '00000000-0000-4000-8000-000000590710',
  'p5r07.open.invalidinreview.0001',
  '00000000-0000-4000-8000-000000590001',
  'INVALID_MATRIX'
);

create temp table qa_review_transition_invalid_in_review_step as
select *
from private.transition_reconciliation_resolution(
  (select reconciliation_resolution_id from qa_review_open_invalid_in_review),
  1,
  'IN_REVIEW',
  'p5r07.transition.invalidinreview.0001',
  '00000000-0000-4000-8000-000000590002',
  'START_REVIEW'
);

create temp table qa_review_invalid_counts_before as
select
  (select status from private.reconciliation_review_cases where id = (select reconciliation_resolution_id from qa_review_open_invalid)) as status,
  (select version from private.reconciliation_review_cases where id = (select reconciliation_resolution_id from qa_review_open_invalid)) as version,
  (select count(*)::bigint from private.reconciliation_review_case_events where reconciliation_resolution_id = (select reconciliation_resolution_id from qa_review_open_invalid)) as events;

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_transition_invalid',
    $inner$
      select *
      from private.transition_reconciliation_resolution(
        (select reconciliation_resolution_id from qa_review_open_invalid),
        1,
        'OPEN',
        'p5r07.transition.invalid.open.0001',
        '00000000-0000-4000-8000-000000590001',
        'INVALID_MATRIX'
      )
    $inner$
  );
  $_$,
  'OPEN to OPEN is rejected'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_transition_invalid',
    $inner$
      select *
      from private.transition_reconciliation_resolution(
        (select reconciliation_resolution_id from qa_review_open_invalid_in_review),
        2,
        'IN_REVIEW',
        'p5r07.transition.invalid.inreview.0001',
        '00000000-0000-4000-8000-000000590001',
        'INVALID_MATRIX'
      )
    $inner$
  );
  $_$,
  'IN_REVIEW to IN_REVIEW is rejected'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_version_conflict',
    $inner$
      select *
      from private.transition_reconciliation_resolution(
        (select reconciliation_resolution_id from qa_review_open_invalid),
        2,
        'RESOLVED',
        'p5r07.transition.badversion.0001',
        '00000000-0000-4000-8000-000000590001',
        'BAD_VERSION'
      )
    $inner$
  );
  $_$,
  'wrong expected version is rejected'
);

select extensions.is(
  (
    select status || ',' || version::text || ',' || events::text
    from qa_review_invalid_counts_before
  ),
  (
    select
      (select status from private.reconciliation_review_cases where id = (select reconciliation_resolution_id from qa_review_open_invalid)) || ',' ||
      (select version::text from private.reconciliation_review_cases where id = (select reconciliation_resolution_id from qa_review_open_invalid)) || ',' ||
      (select count(*)::bigint::text from private.reconciliation_review_case_events where reconciliation_resolution_id = (select reconciliation_resolution_id from qa_review_open_invalid))
  ),
  'invalid transition and version conflict leave case and events unchanged'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_terminal',
    $inner$
      select *
      from private.transition_reconciliation_resolution(
        (select reconciliation_resolution_id from qa_review_open_mismatch),
        3,
        'IGNORED',
        'p5r07.transition.terminal.resolved.0001',
        '00000000-0000-4000-8000-000000590001',
        'TERMINAL_BLOCK'
      )
    $inner$
  );
  $_$,
  'RESOLVED terminal case cannot transition to IGNORED'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_terminal',
    $inner$
      select *
      from private.transition_reconciliation_resolution(
        (select reconciliation_resolution_id from qa_review_open_ignored_direct),
        2,
        'RESOLVED',
        'p5r07.transition.terminal.ignored.0001',
        '00000000-0000-4000-8000-000000590001',
        'TERMINAL_BLOCK'
      )
    $inner$
  );
  $_$,
  'IGNORED terminal case cannot transition to RESOLVED'
);

insert into private.reconciliation_review_cases (
  id,
  reconciliation_item_id,
  status,
  version,
  opened_by_profile_id,
  last_actor_profile_id
)
values (
  '00000000-0000-4000-8000-000000590999',
  '00000000-0000-4000-8000-000000590709',
  'OPEN',
  1,
  '00000000-0000-4000-8000-000000590001',
  '00000000-0000-4000-8000-000000590001'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_existing_state_invalid',
    $inner$
      select *
      from private.transition_reconciliation_resolution(
        '00000000-0000-4000-8000-000000590999',
        1,
        'RESOLVED',
        'p5r07.transition.badstate.0001',
        '00000000-0000-4000-8000-000000590001',
        'BAD_STATE'
      )
    $inner$
  );
  $_$,
  'transition refuses an existing case with missing event history'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_event_immutable',
    $inner$
      update private.reconciliation_review_case_events
      set reason_code = 'MUTATED_REASON'
      where id = (select event_id from qa_review_open_mismatch)
    $inner$
  );
  $_$,
  'review event update is blocked by append-only trigger'
);

select extensions.lives_ok(
  $_$
  select pg_temp.expect_failure(
    'reconciliation_resolution_event_immutable',
    $inner$
      delete from private.reconciliation_review_case_events
      where id = (select event_id from qa_review_open_mismatch)
    $inner$
  );
  $_$,
  'review event delete is blocked by append-only trigger'
);

select extensions.ok(
  exists (
    select 1
    from private.reconciliation_review_case_events
    where reconciliation_resolution_id = (select reconciliation_resolution_id from qa_review_open_mismatch)
    group by reconciliation_resolution_id
    having count(*) = 3
      and min(event_version) = 1
      and max(event_version) = 3
      and string_agg(event_version::text, ',' order by event_version) = '1,2,3'
  ),
  'review event versions remain contiguous and match the current case version'
);

select extensions.ok(
  exists (
    select 1
    from private.reconciliation_review_cases as cases
    join private.reconciliation_review_case_events as events
      on events.reconciliation_resolution_id = cases.id
    where cases.id = (select reconciliation_resolution_id from qa_review_open_mismatch)
    group by cases.id, cases.status, cases.version
    having cases.status = 'RESOLVED'
      and cases.version = max(events.event_version)
      and (array_agg(events.to_status order by events.event_version desc))[1] = cases.status
  ),
  'current case version and status agree with the append-only event tail'
);

select extensions.is(
  (
    select
      runs::text || ',' ||
      items::text || ',' ||
      members::text || ',' ||
      balance_observations::text || ',' ||
      transaction_observations::text || ',' ||
      observer_checkpoints::text || ',' ||
      ledger_accounts::text || ',' ||
      ledger_journals::text || ',' ||
      ledger_entries::text
    from qa_review_side_effect_counts_before
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
      (select count(*)::bigint from private.ledger_entries)::text
  ),
  'review lifecycle leaves run item provenance observation checkpoint and ledger rows unchanged'
);

select extensions.finish();

rollback;
