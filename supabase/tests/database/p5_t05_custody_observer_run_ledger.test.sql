begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  to_regrole('custody_observer_run_writer') is not null,
  'run writer role exists'
);

select extensions.ok(
  (
    select rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
      and not rolcreaterole and not rolreplication and not rolbypassrls
    from pg_catalog.pg_roles where rolname = 'custody_observer_run_writer'
  ),
  'run writer role is login-only and non-privileged'
);

select extensions.is(
  (select rolpassword from pg_catalog.pg_authid where rolname = 'custody_observer_run_writer'),
  null,
  'run writer has no stored password'
);

select extensions.is(
  (select count(*)::integer from pg_catalog.pg_auth_members
    where member = 'custody_observer_run_writer'::regrole
       or (roleid = 'custody_observer_run_writer'::regrole and member <> 'postgres'::regrole)),
  0,
  'run writer has no memberships'
);

select extensions.ok(
  pg_catalog.has_database_privilege('custody_observer_run_writer', pg_catalog.current_database(), 'connect')
    and not pg_catalog.has_database_privilege('custody_observer_run_writer', pg_catalog.current_database(), 'create')
    and pg_catalog.has_schema_privilege('custody_observer_run_writer', 'private', 'usage'),
  'run writer has only required database and private schema access'
);

select extensions.is(
  (select count(*)::integer from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname in ('private', 'public') and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (pg_catalog.has_table_privilege('custody_observer_run_writer', c.oid, 'select')
        or pg_catalog.has_table_privilege('custody_observer_run_writer', c.oid, 'insert')
        or pg_catalog.has_table_privilege('custody_observer_run_writer', c.oid, 'update')
        or pg_catalog.has_table_privilege('custody_observer_run_writer', c.oid, 'delete'))),
  0,
  'run writer cannot directly access private or public relations'
);

select extensions.ok(
  to_regprocedure('private.begin_balance_observer_run(text,text,text,text)') is not null
    and to_regprocedure('private.record_balance_observer_scope_outcome(uuid,integer,uuid,uuid,text,bigint,bigint,bigint,boolean,boolean,boolean,boolean,bigint,text,uuid[],integer[],text[],text[],boolean[],bigint[],bigint[],boolean[],boolean[],boolean[])') is not null
    and to_regprocedure('private.finalize_balance_observer_run(uuid,bigint,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint)') is not null,
  'all run ledger commands exist with exact signatures'
);

select extensions.is(
  (select count(*)::integer from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and pg_catalog.has_function_privilege('custody_observer_run_writer', p.oid, 'execute')),
  3,
  'run writer can execute exactly three private commands'
);

select extensions.ok(
  (select bool_and(p.prosecdef and p.provolatile = 'v'
    and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""'))
    from pg_catalog.pg_proc as p
    where p.oid in (
      'private.begin_balance_observer_run(text,text,text,text)'::regprocedure,
      'private.record_balance_observer_scope_outcome(uuid,integer,uuid,uuid,text,bigint,bigint,bigint,boolean,boolean,boolean,boolean,bigint,text,uuid[],integer[],text[],text[],boolean[],bigint[],bigint[],boolean[],boolean[],boolean[])'::regprocedure,
      'private.finalize_balance_observer_run(uuid,bigint,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure
    )),
  'all run ledger commands are volatile security definer with empty search_path'
);

select extensions.lives_ok(
  $$select private.assert_custody_observer_run_writer_role_contract()$$,
  'run writer ACL assertion passes'
);

insert into public.supported_assets (id, asset_code, symbol, display_name, asset_type, decimals, mint_address, status)
values ('00000000-0000-4000-8000-000000750101', 'P5T05_RUN', 'P5R', 'P5 T05 Run Asset', 'NATIVE', 9, null, 'ACTIVE');

insert into private.custody_providers (
  id, provider_code, display_name, provider_type, supports_balance_observation,
  supports_transfer_observation, supports_transfer_lookup, supports_payout_submission, supports_webhook_ingestion
) values (
  '00000000-0000-4000-8000-000000750201', 'P5T05_RUN_PROVIDER', 'P5 T05 Run Provider',
  'MPC_CUSTODIAN', true, false, false, false, false
);

insert into private.custody_account_bindings (
  id, custody_provider_id, asset_id, binding_key, display_label, account_role
) values (
  '00000000-0000-4000-8000-000000750301', '00000000-0000-4000-8000-000000750201',
  '00000000-0000-4000-8000-000000750101', 'p5t05_run_binding', 'P5 T05 Run Binding', 'COLLECTION'
);

insert into private.custody_account_bindings (
  id, custody_provider_id, asset_id, binding_key, display_label, account_role
) values (
  '00000000-0000-4000-8000-000000750302', '00000000-0000-4000-8000-000000750201',
  '00000000-0000-4000-8000-000000750101', 'p5t05_run_binding_abort', 'P5 T05 Run Abort Binding', 'FEE'
);

select extensions.is(
  (select created from private.begin_balance_observer_run(
    'obsrun:v1:00000000-0000-4000-8000-000000750401', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1')),
  true,
  'begin creates a RUNNING run'
);

select extensions.is(
  (select version from private.begin_balance_observer_run(
    'obsrun:v1:00000000-0000-4000-8000-000000750401', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1')),
  1::bigint,
  'exact begin replay returns lifecycle version one'
);

select extensions.is(
  (select created from private.begin_balance_observer_run(
    'obsrun:v1:00000000-0000-4000-8000-000000750401', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1')),
  false,
  'exact begin replay is non-mutating'
);

select extensions.throws_ok(
  $$select * from private.begin_balance_observer_run('bad', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1')$$,
  '22023', 'run_ledger_input_invalid', 'begin rejects malformed run key'
);

select extensions.throws_ok(
  $$select * from private.begin_balance_observer_run('obsrun:v1:00000000-0000-4000-8000-000000750401', 'RECOVERY', 'LOCAL_MOCK', 'P5_T05_V1')$$,
  '23505', 'observer_run_idempotency_conflict', 'begin rejects conflicting replay'
);

select extensions.is(
  (select created from private.record_balance_observer_scope_outcome(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401'), 0,
    '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101',
    'PARTIAL', 1, 1, 0, true, true, false, true, 0, 'SCOPE_PARTIAL',
    array['00000000-0000-4000-8000-000000750301'::uuid], array[0], array['DATABASE'], array['DB_RETRY_EXHAUSTED'],
    array[true], array[1::bigint], array[2::bigint], array[true], array[false], array[false]
  )), true, 'scope outcome and its failure are recorded atomically'
);

select extensions.is(
  (select count(*)::integer from private.custody_balance_observer_binding_failures
    where run_id = (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401')),
  1, 'scope record persists one sanitized failure row'
);

select extensions.is(
  (select created from private.record_balance_observer_scope_outcome(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401'), 0,
    '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101',
    'PARTIAL', 1, 1, 0, true, true, false, true, 0, 'SCOPE_PARTIAL',
    array['00000000-0000-4000-8000-000000750301'::uuid], array[0], array['DATABASE'], array['DB_RETRY_EXHAUSTED'],
    array[true], array[1::bigint], array[2::bigint], array[true], array[false], array[false]
  )), false, 'exact scope replay is non-mutating'
);

select extensions.throws_ok(
  $$select * from private.record_balance_observer_scope_outcome(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401'), 1,
    '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101',
    'SUCCEEDED', 0, 0, 0, false, false, false, false, 0, null,
    array[]::uuid[], array[]::integer[], array[]::text[], array[]::text[], array[]::boolean[],
    array[]::bigint[], array[]::bigint[], array[]::boolean[], array[]::boolean[], array[]::boolean[]
  )$$,
  '23505', 'run_scope_idempotency_conflict', 'scope command rejects conflicting replay'
);

select extensions.throws_ok(
  $$select * from private.record_balance_observer_scope_outcome(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401'), 1,
    '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101',
    'SUCCEEDED', 0, 1, 0, false, false, false, false, 0, null,
    array[]::uuid[], array[]::integer[], array[]::text[], array[]::text[], array[]::boolean[],
    array[]::bigint[], array[]::bigint[], array[]::boolean[], array[]::boolean[], array[]::boolean[]
  )$$,
  '22023', 'run_binding_failure_invalid', 'scope command rejects mismatched failure arrays'
);

select extensions.is(
  (select created from private.begin_balance_observer_run(
    'obsrun:v1:00000000-0000-4000-8000-000000750402', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1')),
  true,
  'aborted-only fixture run begins'
);

select extensions.is(
  (select created from private.record_balance_observer_scope_outcome(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750402'), 0,
    '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101',
    'ABORTED', 0, 0, 1, false, false, false, false, 0, 'ORCHESTRATOR_ABORTED',
    array['00000000-0000-4000-8000-000000750301'::uuid], array[0], array['ABORTED'], array['ORCHESTRATOR_ABORTED'],
    array[false], array[0::bigint], array[0::bigint], array[false], array[false], array[false]
  )), true, 'ABORTED-only scope outcome persists failure evidence'
);

select extensions.is(
  (select concat_ws('|', binding_failure_count::text, binding_abort_count::text) from private.custody_balance_observer_scope_outcomes
    where run_id = (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750402')),
  '0|1', 'ABORTED-only scope retains separate failure and abort counts'
);

select extensions.is(
  (select count(*)::integer from private.custody_balance_observer_binding_failures
    where run_id = (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750402')),
  1, 'ABORTED-only scope persists one durable failure evidence row'
);

select extensions.is(
  (select version from private.custody_balance_observer_runs
    where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750402'),
  1::bigint, 'ABORTED-only scope write preserves lifecycle version one'
);

select extensions.is(
  (select created from private.record_balance_observer_scope_outcome(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750402'), 0,
    '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101',
    'ABORTED', 0, 0, 1, false, false, false, false, 0, 'ORCHESTRATOR_ABORTED',
    array['00000000-0000-4000-8000-000000750301'::uuid], array[0], array['ABORTED'], array['ORCHESTRATOR_ABORTED'],
    array[false], array[0::bigint], array[0::bigint], array[false], array[false], array[false]
  )), false, 'ABORTED-only exact replay is non-mutating'
);

select extensions.is((select created from private.begin_balance_observer_run('obsrun:v1:00000000-0000-4000-8000-000000750403', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1')), true, 'mixed fixture run begins');
select extensions.is((select created from private.record_balance_observer_scope_outcome(
  (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750403'), 0,
  '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101', 'PARTIAL', 0, 1, 1, false, false, false, false, 0, 'SCOPE_PARTIAL',
  array['00000000-0000-4000-8000-000000750301'::uuid,'00000000-0000-4000-8000-000000750302'::uuid], array[0,1], array['DATABASE','ABORTED'], array['DB_RETRY_EXHAUSTED','ORCHESTRATOR_ABORTED'], array[true,false], array[1::bigint,0::bigint], array[2::bigint,0::bigint], array[true,false], array[false,false], array[false,false]
)), true, 'mixed FAILED and ABORTED scope persists');
select extensions.is((select count(*)::integer from private.custody_balance_observer_binding_failures where run_id = (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750403')), 2, 'mixed scope persists two failure evidence rows');
select extensions.is((select version from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750403'), 1::bigint, 'mixed scope preserves run version one');

select extensions.is((select created from private.begin_balance_observer_run('obsrun:v1:00000000-0000-4000-8000-000000750404', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1')), true, 'too-few fixture run begins');
select extensions.throws_ok($$select * from private.record_balance_observer_scope_outcome((select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750404'), 0, '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101', 'PARTIAL', 0, 1, 1, false, false, false, false, 0, 'SCOPE_PARTIAL', array['00000000-0000-4000-8000-000000750301'::uuid], array[0], array['DATABASE'], array['DB_RETRY_EXHAUSTED'], array[true], array[1::bigint], array[2::bigint], array[true], array[false], array[false])$$, '22023', 'run_binding_failure_invalid', 'too-few failure evidence is rejected');
select extensions.is((select count(*)::integer from private.custody_balance_observer_scope_outcomes where run_id = (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750404')), 0, 'too-few rejection leaves no scope row');
select extensions.is((select version from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750404'), 1::bigint, 'too-few rejection preserves version');

select extensions.is((select created from private.begin_balance_observer_run('obsrun:v1:00000000-0000-4000-8000-000000750405', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1')), true, 'too-many fixture run begins');
select extensions.throws_ok($$select * from private.record_balance_observer_scope_outcome((select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750405'), 0, '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101', 'ABORTED', 0, 0, 1, false, false, false, false, 0, 'ORCHESTRATOR_ABORTED', array['00000000-0000-4000-8000-000000750301'::uuid,'00000000-0000-4000-8000-000000750302'::uuid], array[0,1], array['ABORTED','ABORTED'], array['ORCHESTRATOR_ABORTED','ORCHESTRATOR_ABORTED'], array[false,false], array[0::bigint,0::bigint], array[0::bigint,0::bigint], array[false,false], array[false,false], array[false,false])$$, '22023', 'run_binding_failure_invalid', 'too-many failure evidence is rejected');
select extensions.is((select count(*)::integer from private.custody_balance_observer_scope_outcomes where run_id = (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750405')), 0, 'too-many rejection leaves no scope row');
select extensions.is((select version from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750405'), 1::bigint, 'too-many rejection preserves version');

select extensions.is(
  (select finalized from private.finalize_balance_observer_run(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401'), 1, 'PARTIAL', 'RUN_PARTIAL',
    1, 1, 1, 2, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 2, 0, 0, 1, 0
  )), true, 'finalize transitions the run once'
);

select extensions.is(
  (select version from private.custody_balance_observer_runs
    where run_id = (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401')),
  2::bigint, 'first terminal transition advances lifecycle version to two'
);

select extensions.is(
  (select finalized from private.finalize_balance_observer_run(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401'), 1, 'PARTIAL', 'RUN_PARTIAL',
    1, 1, 1, 2, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 2, 0, 0, 1, 0
  )), false, 'exact finalization replay is non-mutating'
);

select extensions.throws_ok(
  $$select * from private.finalize_balance_observer_run(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401'), 1, 'COMPLETED', null,
    1, 1, 1, 2, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 2, 0, 0, 1, 0
  )$$,
  '23505', 'run_finalization_conflict', 'finalize rejects conflicting terminal replay'
);

select extensions.throws_ok(
  $$select * from private.record_balance_observer_scope_outcome(
    (select run_id from private.custody_balance_observer_runs where run_key = 'obsrun:v1:00000000-0000-4000-8000-000000750401'), 1,
    '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750101',
    'SUCCEEDED', 0, 0, 0, false, false, false, false, 0, null,
    array[]::uuid[], array[]::integer[], array[]::text[], array[]::text[], array[]::boolean[],
    array[]::bigint[], array[]::bigint[], array[]::boolean[], array[]::boolean[], array[]::boolean[]
  )$$,
  '23514', 'run_not_running', 'late scope write is rejected after terminal transition'
);

select extensions.ok(
  not pg_catalog.has_function_privilege('anon', 'private.begin_balance_observer_run(text,text,text,text)'::regprocedure, 'execute')
    and not pg_catalog.has_function_privilege('authenticated', 'private.record_balance_observer_scope_outcome(uuid,integer,uuid,uuid,text,bigint,bigint,bigint,boolean,boolean,boolean,boolean,bigint,text,uuid[],integer[],text[],text[],boolean[],bigint[],bigint[],boolean[],boolean[],boolean[])'::regprocedure, 'execute')
    and not pg_catalog.has_function_privilege('service_role', 'private.finalize_balance_observer_run(uuid,bigint,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure, 'execute')
    and not pg_catalog.has_function_privilege('custody_observer_scope_reader', 'private.begin_balance_observer_run(text,text,text,text)'::regprocedure, 'execute')
    and not pg_catalog.has_function_privilege('custody_observer_worker', 'private.finalize_balance_observer_run(uuid,bigint,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure, 'execute'),
  'browser, service, scope reader, and worker roles cannot execute run commands'
);

select * from extensions.finish();

rollback;
