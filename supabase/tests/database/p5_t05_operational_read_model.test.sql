begin;

create extension if not exists pgtap with schema extensions;
select * from extensions.no_plan();

create function pg_temp.insert_auth_user(test_user_id uuid)
returns void language sql as $$
  insert into auth.users (id, aud, role, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (test_user_id, 'authenticated', 'authenticated', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
$$;

create function pg_temp.set_auth_context(test_user_id uuid, test_aal text default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', test_user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', test_user_id, 'aal', test_aal)::text, true);
end;
$$;

select extensions.ok(to_regprocedure('public.list_admin_custody_observer_runs(integer,timestamp with time zone,timestamp with time zone,uuid,text,boolean,text,boolean)') is not null, 'list RPC exists');
select extensions.ok(to_regprocedure('public.get_admin_custody_observer_run_detail(uuid,timestamp with time zone)') is not null, 'detail RPC exists');
select extensions.ok((select prosecdef from pg_proc where oid = 'public.list_admin_custody_observer_runs(integer,timestamp with time zone,timestamp with time zone,uuid,text,boolean,text,boolean)'::regprocedure), 'list is security definer');
select extensions.ok((select prosecdef from pg_proc where oid = 'public.get_admin_custody_observer_run_detail(uuid,timestamp with time zone)'::regprocedure), 'detail is security definer');
select extensions.ok((select array_to_string(proconfig, ',') from pg_proc where oid = 'public.list_admin_custody_observer_runs(integer,timestamp with time zone,timestamp with time zone,uuid,text,boolean,text,boolean)'::regprocedure) like '%search_path=%', 'list has fixed search path');
select extensions.ok(not has_function_privilege('public', 'public.list_admin_custody_observer_runs(integer,timestamp with time zone,timestamp with time zone,uuid,text,boolean,text,boolean)'::regprocedure, 'execute'), 'PUBLIC cannot execute list');
select extensions.ok(not has_function_privilege('anon', 'public.get_admin_custody_observer_run_detail(uuid,timestamp with time zone)'::regprocedure, 'execute'), 'anon cannot execute detail');
select extensions.ok(has_function_privilege('authenticated', 'public.list_admin_custody_observer_runs(integer,timestamp with time zone,timestamp with time zone,uuid,text,boolean,text,boolean)'::regprocedure, 'execute'), 'authenticated can execute list');
select extensions.ok(not has_table_privilege('authenticated', 'private.custody_balance_observer_runs', 'select'), 'authenticated cannot select private runs');

select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000750001');
select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000750002');
insert into public.user_roles (user_id, role, grant_reason) values ('00000000-0000-4000-8000-000000750001', 'ADMIN', 'p5 t05 operational read fixture');

insert into private.custody_balance_observer_runs (run_id, run_key, trigger_source, identity_policy, invocation_contract_version, status, started_at, created_at)
values
  ('00000000-0000-4000-8000-000000750101', 'obsrun:v1:00000000-0000-4000-8000-000000750101', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1', 'RUNNING', '2026-08-09 00:00:00+00', '2026-08-09 00:00:00+00'),
  ('00000000-0000-4000-8000-000000750102', 'obsrun:v1:00000000-0000-4000-8000-000000750102', 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1', 'RUNNING', '2026-08-09 00:15:00+00', '2026-08-09 00:00:00+00');

insert into private.custody_balance_observer_runs (
  run_id, run_key, trigger_source, identity_policy, invocation_contract_version, status,
  started_at, completed_at, created_at, version, scopes_discovered, scopes_started,
  scopes_completed, scopes_failed, scopes_aborted, bindings_discovered, bindings_failed
)
values (
  '00000000-0000-4000-8000-000000750103',
  'obsrun:v1:00000000-0000-4000-8000-000000750103',
  'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1', 'PARTIAL',
  '2026-08-08 00:00:00+00', '2026-08-08 01:00:00+00', '2026-08-08 01:00:00+00',
  2, 3, 3, 1, 1, 1, 1, 1
);

insert into public.supported_assets (id, asset_code, symbol, display_name, asset_type, decimals, status)
values
  ('00000000-0000-4000-8000-000000750201', 'P5T05READ', 'P5R', 'P5 T05 Read Asset', 'NATIVE', 9, 'ACTIVE'),
  ('00000000-0000-4000-8000-000000750204', 'P5T05READ2', 'P5S', 'P5 T05 Read Asset Two', 'NATIVE', 9, 'ACTIVE');
insert into private.custody_providers (id, provider_code, display_name, provider_type, supports_balance_observation, status)
values ('00000000-0000-4000-8000-000000750202', 'P5T05READ', 'P5 T05 Read Provider', 'MPC_CUSTODIAN', true, 'DRAFT');
update private.custody_providers set status = 'APPROVED', approved_at = '2026-08-01 00:00:00+00', version = 2
where id = '00000000-0000-4000-8000-000000750202';
insert into private.custody_account_bindings (id, custody_provider_id, asset_id, binding_key, display_label, account_role)
values ('00000000-0000-4000-8000-000000750203', '00000000-0000-4000-8000-000000750202', '00000000-0000-4000-8000-000000750201', 'p5t05read_binding', 'P5 T05 Read Binding', 'TREASURY');

insert into private.custody_balance_observer_scope_outcomes (
  run_id, discovery_index, provider_id, asset_id, scope_status, binding_success_count, binding_failure_count,
  binding_abort_count, refresh_requested, refresh_attempted, refresh_succeeded, refresh_failed,
  no_longer_eligible_count, scope_code, recorded_at
) values
  ('00000000-0000-4000-8000-000000750103', 1, '00000000-0000-4000-8000-000000750202', '00000000-0000-4000-8000-000000750201', 'PARTIAL', 1, 1, 0, true, true, true, false, 0, 'SCOPE_PARTIAL', '2026-08-08 00:01:00+00'),
  ('00000000-0000-4000-8000-000000750103', 2, '00000000-0000-4000-8000-000000750202', '00000000-0000-4000-8000-000000750204', 'SUCCEEDED', 1, 0, 0, false, false, false, false, 0, null, '2026-08-08 00:02:00+00');
insert into private.custody_balance_observer_binding_failures (
  run_id, provider_id, asset_id, binding_id, binding_order, failure_stage, safe_failure_code, retryable,
  adapter_attempts, database_attempts, retry_exhausted, retry_deferred, requires_scope_refresh, recorded_at
) values (
  '00000000-0000-4000-8000-000000750103', '00000000-0000-4000-8000-000000750202',
  '00000000-0000-4000-8000-000000750201', '00000000-0000-4000-8000-000000750203', 1,
  'DATABASE', 'OBSERVATION_WRITE_FAILED', true, 2, 1, false, false, true, '2026-08-08 00:01:30+00'
);

insert into private.custody_balance_observer_runs (
  run_id, run_key, trigger_source, identity_policy, invocation_contract_version, status, terminal_code,
  started_at, completed_at, created_at, version
)
select id, 'obsrun:v1:' || id::text, 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1', status, code,
  '2026-08-07 00:00:00+00', '2026-08-07 01:00:00+00', '2026-08-07 01:00:00+00', 2
from (values
  ('00000000-0000-4000-8000-000000750301'::uuid, 'FAILED_DISCOVERY'::text, 'ORCHESTRATOR_SCOPE_DISCOVERY_FAILED'::text),
  ('00000000-0000-4000-8000-000000750302'::uuid, 'FAILED_DISCOVERY'::text, 'ORCHESTRATOR_SCOPE_PAGE_INVALID'::text),
  ('00000000-0000-4000-8000-000000750303'::uuid, 'FAILED_DISCOVERY'::text, 'ORCHESTRATOR_SCOPE_CURSOR_LOOP'::text),
  ('00000000-0000-4000-8000-000000750304'::uuid, 'FAILED_DISCOVERY'::text, 'ORCHESTRATOR_DISCOVERY_LIMIT_EXCEEDED'::text),
  ('00000000-0000-4000-8000-000000750305'::uuid, 'FAILED_DISCOVERY'::text, 'ORCHESTRATOR_SCOPE_DUPLICATE'::text),
  ('00000000-0000-4000-8000-000000750306'::uuid, 'FAILED_DISCOVERY'::text, 'ORCHESTRATOR_PROVIDER_REF_INVALID'::text),
  ('00000000-0000-4000-8000-000000750307'::uuid, 'FAILED_CLEANUP'::text, 'ORCHESTRATOR_CLIENT_CLOSE_FAILED'::text),
  ('00000000-0000-4000-8000-000000750308'::uuid, 'ABORTED'::text, 'ORCHESTRATOR_ABORTED'::text),
  ('00000000-0000-4000-8000-000000750309'::uuid, 'COMPLETED'::text, 'RUN_COMPLETE'::text)
) as fixtures(id, status, code);

-- R2 controlled fixtures: four completed rows exercise keyset traversal, including a timestamp tie.
insert into private.custody_balance_observer_runs (
  run_id, run_key, trigger_source, identity_policy, invocation_contract_version, status, terminal_code,
  started_at, completed_at, created_at, version
)
select id, 'obsrun:v1:' || id::text, 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1', 'COMPLETED', 'RUN_COMPLETE',
  '2026-08-06 00:00:00+00', '2026-08-06 01:00:00+00', created_at, 2
from (values
  ('00000000-0000-4000-8000-000000750401'::uuid, '2026-08-11 00:00:00+00'::timestamptz),
  ('00000000-0000-4000-8000-000000750402'::uuid, '2026-08-11 00:00:00+00'::timestamptz),
  ('00000000-0000-4000-8000-000000750403'::uuid, '2026-08-11 00:00:00+00'::timestamptz),
  ('00000000-0000-4000-8000-000000750404'::uuid, '2026-08-12 00:00:00+00'::timestamptz)
) as fixtures(id, created_at);

insert into public.supported_assets (id, asset_code, symbol, display_name, asset_type, decimals, status)
values ('00000000-0000-4000-8000-000000750205', 'P5T05READ3', 'P5T', 'P5 T05 Read Asset Three', 'NATIVE', 9, 'ACTIVE');
insert into private.custody_account_bindings (id, custody_provider_id, asset_id, binding_key, display_label, account_role)
values ('00000000-0000-4000-8000-000000750206', '00000000-0000-4000-8000-000000750202', '00000000-0000-4000-8000-000000750205', 'p5t05read_binding_two', 'P5 T05 Read Binding Two', 'TREASURY');
insert into private.custody_balance_observer_binding_failures (
  run_id, provider_id, asset_id, binding_id, binding_order, failure_stage, safe_failure_code, retryable,
  adapter_attempts, database_attempts, retry_exhausted, retry_deferred, requires_scope_refresh, recorded_at
) values (
  '00000000-0000-4000-8000-000000750103', '00000000-0000-4000-8000-000000750202',
  '00000000-0000-4000-8000-000000750205', '00000000-0000-4000-8000-000000750206', 2,
  'ADAPTER', 'ADAPTER_BALANCE_UNAVAILABLE', false, 3, 0, true, false, false, '2026-08-08 00:01:31+00'
);

select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000750003');
insert into public.user_roles (user_id, role, grant_reason)
values ('00000000-0000-4000-8000-000000750003', 'ADMIN', 'p5 t05 inactive admin fixture');
update public.profiles set account_status = 'RESTRICTED'
where id = '00000000-0000-4000-8000-000000750003';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000750002', 'aal2');
select extensions.throws_ok($$select public.list_admin_custody_observer_runs(25, '2026-08-09 00:15:00+00', null, null, null, null, null, null)$$, '42501', 'ADMIN_AAL2_REQUIRED', 'non-admin AAL2 denied');
select pg_temp.set_auth_context(null, null);
select extensions.throws_ok($$select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750101', '2026-08-09 00:15:00+00')$$, '42501', 'ADMIN_AAL2_REQUIRED', 'anonymous detail denied');
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000750002', 'aal1');
select extensions.throws_ok($$select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750101', '2026-08-09 00:15:00+00')$$, '42501', 'ADMIN_AAL2_REQUIRED', 'non-admin AAL1 detail denied');
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000750001', 'aal1');
select extensions.throws_ok($$select public.list_admin_custody_observer_runs(25, '2026-08-09 00:15:00+00', null, null, null, null, null, null)$$, '42501', 'ADMIN_AAL2_REQUIRED', 'admin AAL1 denied');
select extensions.throws_ok($$select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750101', '2026-08-09 00:15:00+00')$$, '42501', 'ADMIN_AAL2_REQUIRED', 'admin AAL1 detail denied');
select pg_temp.set_auth_context(null, null);
select extensions.throws_ok($$select public.list_admin_custody_observer_runs(25, '2026-08-09 00:15:00+00', null, null, null, null, null, null)$$, '42501', 'ADMIN_AAL2_REQUIRED', 'anonymous list denied distinctly from empty result');
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000750002', 'aal1');
select extensions.throws_ok($$select public.list_admin_custody_observer_runs(25, '2026-08-09 00:15:00+00', null, null, null, null, null, null)$$, '42501', 'ADMIN_AAL2_REQUIRED', 'non-admin AAL1 list denied');
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000750002', 'aal2');
select extensions.throws_ok($$select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750101', '2026-08-09 00:15:00+00')$$, '42501', 'ADMIN_AAL2_REQUIRED', 'non-admin AAL2 detail denied');
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000750003', 'aal2');
select extensions.throws_ok($$select public.list_admin_custody_observer_runs(25, '2026-08-09 00:15:00+00', null, null, null, null, null, null)$$, '42501', 'ADMIN_AAL2_REQUIRED', 'restricted admin list denied');
select extensions.throws_ok($$select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750101', '2026-08-09 00:15:00+00')$$, '42501', 'ADMIN_AAL2_REQUIRED', 'restricted admin detail denied');
select extensions.ok((select not public.is_current_user_admin_aal2()), 'restricted profile cannot be an ADMIN AAL2 principal');
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000750001', 'aal2');
select extensions.ok(public.list_admin_custody_observer_runs(1, '2026-08-09 00:15:00+00', null, null, null, null, null, null) is not null, 'active admin AAL2 list allowed');
select extensions.ok(public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750101', '2026-08-09 00:15:00+00') is not null, 'active admin AAL2 detail allowed');

create temporary table qa_before as
select count(*)::text || ':' || coalesce(string_agg(run_id::text || ':' || version::text || ':' || status || ':' || coalesce(terminal_code, ''), ',' order by run_id), '') as fingerprint
from private.custody_balance_observer_runs;
create temporary table qa_scope_before as
select count(*)::text || ':' || coalesce(string_agg(run_id::text || ':' || discovery_index::text || ':' || scope_status || ':' || coalesce(scope_code, ''), ',' order by run_id, discovery_index), '') as fingerprint
from private.custody_balance_observer_scope_outcomes;
create temporary table qa_failure_before as
select count(*)::text || ':' || coalesce(string_agg(run_id::text || ':' || binding_order::text || ':' || failure_stage || ':' || safe_failure_code, ',' order by run_id, binding_order, binding_id), '') as fingerprint
from private.custody_balance_observer_binding_failures;

create temporary table qa_list as select public.list_admin_custody_observer_runs(1, '2026-08-09 00:15:00+00', null, null, 'RUNNING', null, null, null) as payload;
select extensions.is((select jsonb_typeof(payload->'items') from qa_list), 'array', 'list items is array');
select extensions.is((select jsonb_typeof(payload->'total_count') from qa_list), 'string', 'total count is string');
select extensions.is((select payload->'items'->0->>'severity' from qa_list), 'INFO', 'exact cutoff running row is info');
select extensions.is((select payload->'items'->0->>'stale' from qa_list), 'false', 'cutoff equality is not stale');
select extensions.ok((select not (payload->'items'->0 ? 'run_key') and not (payload->'items'->0 ? 'updated_at') from qa_list), 'list excludes private fields');
select extensions.is((select payload->'items'->0->>'version' from qa_list), '1', 'version is string');
select extensions.ok((select payload->>'next_cursor_created_at' is not null and payload->>'next_cursor_run_id' is not null from qa_list), 'lookahead returns typed cursor components');
select extensions.throws_ok($$select public.list_admin_custody_observer_runs(0, '2026-08-09 00:15:00+00', null, null, null, null, null, null)$$, '22023', 'INVALID_INPUT', 'invalid DB limit rejected');
select extensions.throws_ok($$select public.list_admin_custody_observer_runs(25, '2026-08-09 00:15:00+00', '2026-08-09 00:00:00+00', null, null, null, null, null)$$, '22023', 'INVALID_INPUT', 'partial cursor rejected');
select extensions.is((select (public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750103', '2026-08-09 00:15:00+00')->>'severity')), 'WARNING', 'partial is warning');
select extensions.is((select (public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750101', '2026-08-09 00:15:00+00')->>'severity')), 'CRITICAL', 'strictly older running row is critical');
select extensions.is((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000759999', '2026-08-09 00:15:00+00')), null, 'missing detail is SQL NULL');
select extensions.ok((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750101', '2026-08-09 00:15:00+00') ? 'scope_outcomes'), 'detail includes evidence arrays');
select extensions.is((select (public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750101', '2026-08-09 00:15:00+00')->'scope_outcomes')::text), '[]', 'empty scope evidence is safe array');
select extensions.is((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750103', '2026-08-09 00:15:00+00')->'scope_outcomes'->0->>'provider_name'), 'P5 T05 Read Provider', 'scope provider descriptor joined');
select extensions.is((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750103', '2026-08-09 00:15:00+00')->'scope_outcomes'->0->>'asset_symbol'), 'P5R', 'scope asset descriptor joined');
select extensions.is((select jsonb_array_length(public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750103', '2026-08-09 00:15:00+00')->'scope_outcomes')), 2, 'full scope array returned');
select extensions.is((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750103', '2026-08-09 00:15:00+00')->'binding_failures'->0->>'failure_code'), 'OBSERVATION_WRITE_FAILED', 'safe failure code returned');
select extensions.is((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750103', '2026-08-09 00:15:00+00')->'binding_failures'->0->>'adapter_attempts'), '2', 'failure attempts are strings');
select extensions.ok((select not (public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750103', '2026-08-09 00:15:00+00')->'binding_failures'->0 ? 'binding_id')), 'failure binding id excluded');
select extensions.is((select count(*) from jsonb_array_elements((public.list_admin_custody_observer_runs(100, '2026-08-09 00:15:00+00', null, null, 'FAILED_DISCOVERY', null, 'CRITICAL', true))->'items')), 6::bigint, 'all discovery allowlist rows are critical');
select extensions.is((select count(*) from jsonb_array_elements((public.list_admin_custody_observer_runs(100, '2026-08-09 00:15:00+00', null, null, 'FAILED_CLEANUP', null, 'CRITICAL', true))->'items')), 1::bigint, 'cleanup allowlist row is critical');
select extensions.is((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750308', '2026-08-09 00:15:00+00')->>'severity'), 'INFO', 'aborted is info');
select extensions.is((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750309', '2026-08-09 00:15:00+00')->>'severity'), 'INFO', 'completed is info');
select extensions.is((select (public.list_admin_custody_observer_runs(25, '2026-08-09 00:15:00+00', null, null, 'COMPLETED', true, null, null))->>'total_count'), '0', 'contradictory filters return empty normal result');
select extensions.is((select count(*)::text || ':' || coalesce(string_agg(run_id::text || ':' || version::text || ':' || status || ':' || coalesce(terminal_code, ''), ',' order by run_id), '') from private.custody_balance_observer_runs), (select fingerprint from qa_before), 'read RPC calls leave durable rows unchanged');

-- R2: explicit ordering, keyset pagination, filters, total-count, and safe projection qualification.
create temporary table qa_completed_all as
select public.list_admin_custody_observer_runs(100, '2026-08-13 00:00:00+00', null, null, 'COMPLETED', null, null, null) as payload;
select extensions.is(
  (select string_agg(item->>'run_id', ',' order by ordinality)
   from qa_completed_all, jsonb_array_elements(payload->'items') with ordinality as entries(item, ordinality)),
  '00000000-0000-4000-8000-000000750404,00000000-0000-4000-8000-000000750403,00000000-0000-4000-8000-000000750402,00000000-0000-4000-8000-000000750401,00000000-0000-4000-8000-000000750309',
  'full completed list is ordered by created_at DESC then run_id DESC'
);
select extensions.is((select jsonb_array_length(payload->'items') from qa_completed_all), 5, 'limit 100 is accepted and returns all matching fixtures');
select extensions.throws_ok($$select public.list_admin_custody_observer_runs(101, '2026-08-13 00:00:00+00', null, null, null, null, null, null)$$, '22023', 'INVALID_INPUT', 'limit 101 rejected');

create temporary table qa_page_1 as
select public.list_admin_custody_observer_runs(2, '2026-08-13 00:00:00+00', null, null, 'COMPLETED', null, null, null) as payload;
create temporary table qa_page_2 as
select public.list_admin_custody_observer_runs(2, '2026-08-13 00:00:00+00', (payload->>'next_cursor_created_at')::timestamptz, (payload->>'next_cursor_run_id')::uuid, 'COMPLETED', null, null, null) as payload from qa_page_1;
create temporary table qa_page_3 as
select public.list_admin_custody_observer_runs(2, '2026-08-13 00:00:00+00', (payload->>'next_cursor_created_at')::timestamptz, (payload->>'next_cursor_run_id')::uuid, 'COMPLETED', null, null, null) as payload from qa_page_2;
select extensions.is((select string_agg(item->>'run_id', ',' order by ordinality) from qa_page_1, jsonb_array_elements(payload->'items') with ordinality as entries(item, ordinality)), '00000000-0000-4000-8000-000000750404,00000000-0000-4000-8000-000000750403', 'page one ordered items and lookahead exclusion');
select extensions.is((select payload->>'next_cursor_run_id' from qa_page_1), '00000000-0000-4000-8000-000000750403', 'page one cursor is last returned run');
select extensions.ok((select payload->>'next_cursor_created_at' is not null and payload->>'next_cursor_run_id' is not null from qa_page_1), 'page one cursor has typed timestamp and UUID components');
select extensions.is((select string_agg(item->>'run_id', ',' order by ordinality) from qa_page_2, jsonb_array_elements(payload->'items') with ordinality as entries(item, ordinality)), '00000000-0000-4000-8000-000000750402,00000000-0000-4000-8000-000000750401', 'same timestamp page crossing retains strict UUID descending tie order');
select extensions.is((select string_agg(item->>'run_id', ',' order by ordinality) from qa_page_3, jsonb_array_elements(payload->'items') with ordinality as entries(item, ordinality)), '00000000-0000-4000-8000-000000750309', 'final page returns remaining row without skip');
select extensions.ok((select payload->>'next_cursor_created_at' is null and payload->>'next_cursor_run_id' is null from qa_page_3), 'last page cursor components are both null');
select extensions.is((select count(*) from (select item->>'run_id' as id from qa_page_1, jsonb_array_elements(payload->'items') as item intersect select item->>'run_id' from qa_page_2, jsonb_array_elements(payload->'items') as item) as overlap), 0::bigint, 'cursor pages have no repeated IDs');
select extensions.is((select string_agg(id, ',' order by page_no, ordinality) from (select 1 page_no, ordinality, item->>'run_id' id from qa_page_1, jsonb_array_elements(payload->'items') with ordinality as e(item, ordinality) union all select 2, ordinality, item->>'run_id' from qa_page_2, jsonb_array_elements(payload->'items') with ordinality as e(item, ordinality) union all select 3, ordinality, item->>'run_id' from qa_page_3, jsonb_array_elements(payload->'items') with ordinality as e(item, ordinality)) as all_pages), '00000000-0000-4000-8000-000000750404,00000000-0000-4000-8000-000000750403,00000000-0000-4000-8000-000000750402,00000000-0000-4000-8000-000000750401,00000000-0000-4000-8000-000000750309', 'cursor union equals complete ordered dataset exactly once');
select extensions.is((select payload->>'total_count' from qa_page_1), '5', 'total count is full filtered count rather than page length');
select extensions.is((select payload->>'total_count' from qa_page_2), '5', 'total count is cursor independent');

create temporary table qa_stale as select public.list_admin_custody_observer_runs(100, '2026-08-09 00:15:00+00', null, null, 'RUNNING', true, 'CRITICAL', true) as payload;
select extensions.is((select payload->>'total_count' from qa_stale), '1', 'positive AND filter returns exact stale critical alert row');
select extensions.is((select payload->'items'->0->>'run_id' from qa_stale), '00000000-0000-4000-8000-000000750101', 'stale filter excludes exact-cutoff non-stale running row');
select extensions.is((select (public.list_admin_custody_observer_runs(100, '2026-08-09 00:15:00+00', null, null, 'RUNNING', false, 'INFO', false))->>'total_count'), '1', 'stale=false filter returns exact-cutoff running row');
select extensions.is((select (public.list_admin_custody_observer_runs(100, '2026-08-09 00:15:00+00', null, null, 'PARTIAL', null, 'WARNING', true))->>'total_count'), '1', 'status severity and alert filters intersect for partial warning');
select extensions.is((select (public.list_admin_custody_observer_runs(100, '2026-08-09 00:15:00+00', null, null, 'ABORTED', null, 'INFO', false))->>'total_count'), '1', 'severity INFO and alert false filter return aborted fixture');

create temporary table qa_detail as select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750103', '2026-08-09 00:15:00+00') as payload;
select extensions.is((select payload->'scope_outcomes'->0->>'scope_status' from qa_detail), 'PARTIAL', 'scope status projected');
select extensions.is((select payload->'scope_outcomes'->0->>'scope_code' from qa_detail), 'SCOPE_PARTIAL', 'scope safe code projected');
select extensions.is((select payload->'scope_outcomes'->0->>'binding_success_count' from qa_detail), '1', 'scope count is JSON string');
select extensions.is((select payload->'scope_outcomes'->0->>'refresh_requested' from qa_detail), 'true', 'scope refresh flag is JSON boolean');
select extensions.is((select payload->'scope_outcomes'->0->>'recorded_at' from qa_detail), '2026-08-08T00:01:00+00:00', 'scope recorded timestamp projected');
select extensions.is((select string_agg(item->>'asset_symbol', ',' order by ordinality) from qa_detail, jsonb_array_elements(payload->'scope_outcomes') with ordinality as e(item, ordinality)), 'P5R,P5S', 'scope outcomes ordered by recorded timestamp then discovery index');
select extensions.ok((select not exists (select 1 from jsonb_array_elements(payload->'scope_outcomes') as item where item ?| array['provider_id','asset_id','run_id','binding_id','discovery_index','message','description','payload']) from qa_detail), 'scope JSON excludes private identifiers messages and payloads');
select extensions.is((select jsonb_array_length(payload->'binding_failures') from qa_detail), 2, 'complete binding failure array projected');
select extensions.is((select payload->'binding_failures'->0->>'failure_stage' from qa_detail), 'DATABASE', 'failure stage projected');
select extensions.is((select payload->'binding_failures'->0->>'retryable' from qa_detail), 'true', 'failure retryable is JSON boolean');
select extensions.is((select payload->'binding_failures'->0->>'requires_scope_refresh' from qa_detail), 'true', 'failure refresh flag is JSON boolean');
select extensions.is((select payload->'binding_failures'->0->>'recorded_at' from qa_detail), '2026-08-08T00:01:30+00:00', 'failure timestamp projected');
select extensions.is((select payload->'binding_failures'->1->>'provider_name' from qa_detail), 'P5 T05 Read Provider', 'failure provider descriptor projected');
select extensions.is((select payload->'binding_failures'->1->>'asset_symbol' from qa_detail), 'P5T', 'failure asset descriptor projected');
select extensions.is((select string_agg(item->>'failure_code', ',' order by ordinality) from qa_detail, jsonb_array_elements(payload->'binding_failures') with ordinality as e(item, ordinality)), 'OBSERVATION_WRITE_FAILED,ADAPTER_BALANCE_UNAVAILABLE', 'failure array ordered by timestamp then binding order');
select extensions.ok((select not exists (select 1 from jsonb_array_elements(payload->'binding_failures') as item where item ?| array['binding_id','provider_id','asset_id','run_id','message','error','payload','endpoint','credential','session']) from qa_detail), 'failure JSON excludes private identifiers diagnostics and credentials');
select extensions.ok((select not (payload ?| array['run_key','updated_at','provider_id','asset_id','binding_id','payload','error','endpoint','credential']) from qa_detail), 'detail run excludes all applicable private keys');
select extensions.ok((select not exists (select 1 from jsonb_array_elements(payload->'items') as item where item ?| array['run_key','updated_at','provider_id','asset_id','binding_id','payload','error','endpoint','credential']) from qa_completed_all), 'all list items exclude applicable private keys');

select extensions.ok((select pg_get_functiondef('public.get_admin_custody_observer_run_detail(uuid,timestamp with time zone)'::regprocedure) like '%left join private.custody_providers%' and pg_get_functiondef('public.get_admin_custody_observer_run_detail(uuid,timestamp with time zone)'::regprocedure) like '%left join public.supported_assets%'), 'detail uses LEFT JOIN descriptor resolution');
select extensions.ok((select pg_get_functiondef('public.get_admin_custody_observer_run_detail(uuid,timestamp with time zone)'::regprocedure) not like '%coalesce(%id::text%' and pg_get_functiondef('public.get_admin_custody_observer_run_detail(uuid,timestamp with time zone)'::regprocedure) not like '%Unknown%'), 'detail has no internal-ID or placeholder descriptor fallback');
select extensions.is((select count(*) from pg_constraint where conrelid = 'private.custody_balance_observer_scope_outcomes'::regclass and contype = 'f' and confdeltype = 'r'), 3::bigint, 'scope evidence has three restrict foreign keys');
select extensions.is((select count(*) from pg_constraint where conrelid = 'private.custody_balance_observer_binding_failures'::regclass and contype = 'f' and confdeltype = 'r'), 4::bigint, 'failure evidence has four restrict foreign keys');
select extensions.ok((select attnotnull from pg_attribute where attrelid = 'private.custody_balance_observer_runs'::regclass and attname = 'started_at' and not attisdropped), 'running null started_at is schema-unreachable');
select extensions.ok((select pg_get_constraintdef(oid) like '%completed_at IS NULL%' and pg_get_constraintdef(oid) like '%terminal_code IS NULL%' and pg_get_constraintdef(oid) like '%completed_at >= started_at%' from pg_constraint where conname = 'custody_balance_observer_runs_lifecycle_check'), 'lifecycle constraint structurally separates running and terminal states');
select extensions.ok((select pg_get_functiondef('public.list_admin_custody_observer_runs(integer,timestamp with time zone,timestamp with time zone,uuid,text,boolean,text,boolean)'::regprocedure) like '%when runs.status = ''RUNNING''%' and pg_get_functiondef('public.list_admin_custody_observer_runs(integer,timestamp with time zone,timestamp with time zone,uuid,text,boolean,text,boolean)'::regprocedure) like '%when runs.status = ''PARTIAL''%' and pg_get_functiondef('public.list_admin_custody_observer_runs(integer,timestamp with time zone,timestamp with time zone,uuid,text,boolean,text,boolean)'::regprocedure) like '%terminal_code in (%'), 'severity uses explicit ordered status and terminal-code allowlists');
select extensions.is((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750308', '2026-08-09 00:15:00+00')->>'terminal_code'), 'ORCHESTRATOR_ABORTED', 'valid non-allowlist terminal code is safely represented');
select extensions.is((select public.get_admin_custody_observer_run_detail('00000000-0000-4000-8000-000000750308', '2026-08-09 00:15:00+00')->>'severity'), 'INFO', 'valid non-allowlist terminal code does not infer critical severity');
select extensions.is((select count(*)::text || ':' || coalesce(string_agg(run_id::text || ':' || discovery_index::text || ':' || scope_status || ':' || coalesce(scope_code, ''), ',' order by run_id, discovery_index), '') from private.custody_balance_observer_scope_outcomes), (select fingerprint from qa_scope_before), 'read RPC calls leave scope evidence unchanged');
select extensions.is((select count(*)::text || ':' || coalesce(string_agg(run_id::text || ':' || binding_order::text || ':' || failure_stage || ':' || safe_failure_code, ',' order by run_id, binding_order, binding_id), '') from private.custody_balance_observer_binding_failures), (select fingerprint from qa_failure_before), 'read RPC calls leave failure evidence unchanged');

select * from extensions.finish();
rollback;
