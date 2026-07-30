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
  pg_get_functiondef(
    'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure
  ) like '%current_setting(''request.method'', true)%'
    and pg_get_functiondef(
      'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure
    ) like '%SQLERRM = ''reconciliation_resolution_version_conflict''%'
    and pg_get_functiondef(
      'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure
    ) like '%errcode = ''PT409''%',
  'transition admin wrapper translates only exact PostgREST version conflicts'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure,
      'execute'
    ),
  'transport-safe transition command remains authenticated-only'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.transition_reconciliation_resolution(uuid, bigint, text, text, uuid, text)'::regprocedure,
    'execute'
  ),
  'private transition lifecycle remains browser-execute blocked'
);

select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000690001');
select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000690002');

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000690001',
  'ADMIN',
  'local pgtap reconciliation transport admin fixture'
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
  '00000000-0000-4000-8000-000000690101',
  'P5TR_REVIEW',
  'P5TR',
  'P5 Transport Review Asset',
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
  status
)
values (
  '00000000-0000-4000-8000-000000690201',
  'P5TR_PROVIDER',
  'P5 Transport Provider',
  'MPC_CUSTODIAN',
  true,
  'DRAFT'
);

update private.custody_providers
set
  status = 'APPROVED',
  approved_at = now(),
  version = version + 1
where id = '00000000-0000-4000-8000-000000690201';

insert into private.custody_account_bindings (
  id,
  custody_provider_id,
  asset_id,
  binding_key,
  display_label,
  account_role,
  status
)
values (
  '00000000-0000-4000-8000-000000690301',
  '00000000-0000-4000-8000-000000690201',
  '00000000-0000-4000-8000-000000690101',
  'p5tr_review_binding',
  'P5 Transport Review Binding',
  'COLLECTION',
  'DRAFT'
);

update private.custody_account_bindings
set
  status = 'APPROVED',
  approved_at = now(),
  version = version + 1
where id = '00000000-0000-4000-8000-000000690301';

insert into private.external_balance_observations (
  id,
  custody_account_binding_id,
  asset_id,
  observer_kind,
  observation_key,
  observed_units,
  observed_at
)
values (
  '00000000-0000-4000-8000-000000690401',
  '00000000-0000-4000-8000-000000690301',
  '00000000-0000-4000-8000-000000690101',
  'BALANCE_OBSERVER',
  'p5tr.review.observation.0001',
  108,
  '2026-07-29 03:00:00+00'::timestamptz
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
  '00000000-0000-4000-8000-000000690501',
  'p5tr.review.run.0001',
  'MANUAL',
  'COMPLETED',
  '2026-07-29 03:10:00+00'::timestamptz,
  '2026-07-29 03:11:00+00'::timestamptz,
  'BALANCE_OBSERVER',
  '2026-07-29 03:00:00+00'::timestamptz
);

insert into private.reconciliation_items (
  id,
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
  '00000000-0000-4000-8000-000000690601',
  '00000000-0000-4000-8000-000000690501',
  '00000000-0000-4000-8000-000000690301',
  '00000000-0000-4000-8000-000000690101',
  '00000000-0000-4000-8000-000000690401',
  100,
  108,
  8,
  5,
  'MISMATCH'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000690001', 'aal2');

create temporary table qa_transport_review_open as
select *
from public.admin_open_review_case(
  '00000000-0000-4000-8000-000000690601',
  'p5tr.open.admin.0001',
  'MISMATCH_REVIEW'
);

create temporary table qa_transport_review_transition as
select *
from public.admin_transition_review_case(
  (select review_case_id from qa_transport_review_open),
  1,
  'IN_REVIEW',
  'p5tr.transition.inreview.0001',
  'START_REVIEW'
);

reset role;

create temporary table qa_transport_review_counts_before as
select
  (select count(*)::bigint from private.reconciliation_review_cases) as cases,
  (select count(*)::bigint from private.reconciliation_review_case_events) as events;

reset role;
reset "request.jwt.claim.sub";
reset "request.jwt.claims";

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case('00000000-0000-4000-8000-000000690701', 1, 'RESOLVED', 'p5tr.public.unauth.0001', 'BAD_VERSION')$$,
  '42501'::character(5),
  null,
  'unauthenticated transport transition remains blocked'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000690002', 'aal2');

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case('00000000-0000-4000-8000-000000690701', 1, 'RESOLVED', 'p5tr.public.user.0001', 'BAD_VERSION')$$,
  '42501'::character(5),
  null,
  'non-admin aal2 transport transition remains blocked'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000690001', 'aal1');

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case('00000000-0000-4000-8000-000000690701', 1, 'RESOLVED', 'p5tr.public.aal1.0001', 'BAD_VERSION')$$,
  '42501'::character(5),
  null,
  'admin aal1 transport transition remains blocked'
);

reset role;

select extensions.throws_ok(
  $$select * from private.transition_reconciliation_resolution((select review_case_id from qa_transport_review_open), 1, 'RESOLVED', 'p5tr.private.badversion.0001', '00000000-0000-4000-8000-000000690001', 'BAD_VERSION')$$,
  '40001'::character(5),
  'reconciliation_resolution_version_conflict',
  'private transition version conflict keeps 40001 contract'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000690001', 'aal2');

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case((select review_case_id from qa_transport_review_open), 1, 'RESOLVED', 'p5tr.public.badversion.direct.0001', 'BAD_VERSION')$$,
  '40001'::character(5),
  'reconciliation_resolution_version_conflict',
  'direct database public transition preserves 40001 contract'
);

select set_config('request.method', 'POST', true);

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case((select review_case_id from qa_transport_review_open), 1, 'RESOLVED', 'p5tr.public.badversion.postgrest.0001', 'BAD_VERSION')$$,
  'PT409'::character(5),
  'reconciliation_resolution_version_conflict',
  'PostgREST public transition translates exact version conflict to PT409'
);

reset role;

select extensions.is(
  (
    select cases::text || ',' || events::text
    from qa_transport_review_counts_before
  ),
  (
    select
      (select count(*)::bigint::text from private.reconciliation_review_cases) || ',' ||
      (select count(*)::bigint::text from private.reconciliation_review_case_events)
  ),
  'private and public transport conflicts leave review state unchanged'
);

select * from extensions.finish();

rollback;
