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
  to_regprocedure('public.admin_open_review_case(uuid, text, text)') is not null,
  'admin_open_review_case exists'
);

select extensions.ok(
  to_regprocedure('public.admin_transition_review_case(uuid, bigint, text, text, text)') is not null,
  'admin_transition_review_case exists'
);

select extensions.is(
  pg_get_function_result(
    'public.admin_open_review_case(uuid, text, text)'::regprocedure
  ),
  'TABLE(review_case_id uuid, event_id uuid, created boolean, status text, version bigint)',
  'open admin command return contract is stable'
);

select extensions.is(
  pg_get_function_result(
    'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure
  ),
  'TABLE(review_case_id uuid, event_id uuid, created boolean, status text, version bigint)',
  'transition admin command return contract is stable'
);

select extensions.ok(
  (
    select procedures.provolatile = 'v' and procedures.prosecdef
    from pg_proc as procedures
    where procedures.oid = 'public.admin_open_review_case(uuid, text, text)'::regprocedure
  ),
  'open admin command is volatile security definer'
);

select extensions.ok(
  (
    select procedures.provolatile = 'v' and procedures.prosecdef
    from pg_proc as procedures
    where procedures.oid = 'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure
  ),
  'transition admin command is volatile security definer'
);

select extensions.ok(
  (
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid = 'public.admin_open_review_case(uuid, text, text)'::regprocedure
  ) in ('search_path=', 'search_path=""'),
  'open admin command has empty search_path'
);

select extensions.ok(
  (
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid = 'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure
  ) in ('search_path=', 'search_path=""'),
  'transition admin command has empty search_path'
);

select extensions.ok(
  obj_description('public.admin_open_review_case(uuid, text, text)'::regprocedure, 'pg_proc') is not null
    and obj_description('public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure, 'pg_proc') is not null,
  'admin review command functions have governance comments'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'public.admin_open_review_case(uuid, text, text)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.admin_open_review_case(uuid, text, text)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.admin_open_review_case(uuid, text, text)'::regprocedure,
      'execute'
    ),
  'open command grants execute only to authenticated browser role'
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
  'transition command grants execute only to authenticated browser role'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.open_reconciliation_resolution(uuid, text, uuid, text)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'private.transition_reconciliation_resolution(uuid, bigint, text, text, uuid, text)'::regprocedure,
      'execute'
    ),
  'low-level private review lifecycle functions remain browser-execute blocked'
);

select extensions.ok(
  pg_get_function_arguments(
    'public.admin_open_review_case(uuid, text, text)'::regprocedure
  ) !~* '(actor|profile|user|role|aal|admin)'
    and pg_get_function_arguments(
      'public.admin_transition_review_case(uuid, bigint, text, text, text)'::regprocedure
    ) !~* '(actor|profile|user|role|aal|admin)',
  'admin review commands do not accept caller-provided actor role or aal fields'
);

select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000680001');
select pg_temp.insert_auth_user('00000000-0000-4000-8000-000000680002');

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000680001',
  'ADMIN',
  'local pgtap reconciliation review admin fixture'
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
  '00000000-0000-4000-8000-000000680101',
  'P5ADM_REVIEW',
  'P5AR',
  'P5 Admin Review Asset',
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
  '00000000-0000-4000-8000-000000680201',
  'P5ADM_PROVIDER',
  'P5 Admin Provider',
  'MPC_CUSTODIAN',
  true,
  'DRAFT'
);

update private.custody_providers
set
  status = 'APPROVED',
  approved_at = now(),
  version = version + 1
where id = '00000000-0000-4000-8000-000000680201';

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
  '00000000-0000-4000-8000-000000680301',
  '00000000-0000-4000-8000-000000680201',
  '00000000-0000-4000-8000-000000680101',
  'p5adm_review_binding',
  'P5 Admin Review Binding',
  'COLLECTION',
  'DRAFT'
);

update private.custody_account_bindings
set
  status = 'APPROVED',
  approved_at = now(),
  version = version + 1
where id = '00000000-0000-4000-8000-000000680301';

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
  '00000000-0000-4000-8000-000000680401',
  '00000000-0000-4000-8000-000000680301',
  '00000000-0000-4000-8000-000000680101',
  'BALANCE_OBSERVER',
  'p5adm.review.observation.0001',
  108,
  '2026-07-29 02:00:00+00'::timestamptz
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
  '00000000-0000-4000-8000-000000680501',
  'p5adm.review.run.0001',
  'MANUAL',
  'COMPLETED',
  '2026-07-29 02:10:00+00'::timestamptz,
  '2026-07-29 02:11:00+00'::timestamptz,
  'BALANCE_OBSERVER',
  '2026-07-29 02:00:00+00'::timestamptz
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
  '00000000-0000-4000-8000-000000680601',
  '00000000-0000-4000-8000-000000680501',
  '00000000-0000-4000-8000-000000680301',
  '00000000-0000-4000-8000-000000680101',
  '00000000-0000-4000-8000-000000680401',
  100,
  108,
  8,
  5,
  'MISMATCH'
);

create temporary table qa_admin_review_side_effect_counts_before as
select
  (select count(*)::bigint from private.reconciliation_runs) as runs,
  (select count(*)::bigint from private.reconciliation_items) as items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as item_members,
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.external_transaction_observations) as transaction_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints,
  (select count(*)::bigint from private.ledger_accounts) as ledger_accounts,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries;

select extensions.throws_ok(
  $$select * from public.admin_open_review_case('00000000-0000-4000-8000-000000680601', 'p5adm.open.unauth.0001', 'MISMATCH_REVIEW')$$,
  '42501'::character(5),
  null,
  'unauthenticated open command is rejected'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000680002', 'aal2');

select extensions.throws_ok(
  $$select * from public.admin_open_review_case('00000000-0000-4000-8000-000000680601', 'p5adm.open.user.0001', 'MISMATCH_REVIEW')$$,
  '42501'::character(5),
  null,
  'non-admin aal2 open command is rejected'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000680001', 'aal1');

select extensions.throws_ok(
  $$select * from public.admin_open_review_case('00000000-0000-4000-8000-000000680601', 'p5adm.open.aal1.0001', 'MISMATCH_REVIEW')$$,
  '42501'::character(5),
  null,
  'admin aal1 open command is rejected'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000680001', 'aal2');

create temporary table qa_admin_review_open as
select *
from public.admin_open_review_case(
  '00000000-0000-4000-8000-000000680601',
  'p5adm.open.admin.0001',
  'MISMATCH_REVIEW'
);

reset role;

select extensions.ok(
  (
    select created
      and status = 'OPEN'
      and version = 1
      and review_case_id is not null
      and event_id is not null
    from qa_admin_review_open
  ),
  'admin aal2 open command succeeds'
);

select extensions.is(
  (
    select cases.opened_by_profile_id::text || ',' ||
      cases.last_actor_profile_id::text
    from private.reconciliation_review_cases as cases
    join qa_admin_review_open as opened
      on opened.review_case_id = cases.id
  ),
  '00000000-0000-4000-8000-000000680001,00000000-0000-4000-8000-000000680001',
  'open actor is derived from authenticated admin profile'
);

select extensions.is(
  (
    select events.actor_profile_id::text || ',' || events.reason_code
    from private.reconciliation_review_case_events as events
    join qa_admin_review_open as opened
      on opened.event_id = events.id
  ),
  '00000000-0000-4000-8000-000000680001,MISMATCH_REVIEW',
  'open event stores current admin actor and safe reason code'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000680001', 'aal2');

create temporary table qa_admin_review_open_replay as
select *
from public.admin_open_review_case(
  '00000000-0000-4000-8000-000000680601',
  'p5adm.open.admin.0001',
  'MISMATCH_REVIEW'
);

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case((select review_case_id from qa_admin_review_open), 1, 'OPEN', 'p5adm.transition.open.0001', 'START_REVIEW')$$,
  '22023'::character(5),
  'reconciliation_review_target_status_invalid',
  'admin command wrapper rejects OPEN target status before low-level transition'
);

create temporary table qa_admin_review_transition as
select *
from public.admin_transition_review_case(
  (select review_case_id from qa_admin_review_open),
  1,
  'IN_REVIEW',
  'p5adm.transition.inreview.0001',
  'START_REVIEW'
);

reset role;

select extensions.ok(
  (select not created from qa_admin_review_open_replay)
    and (
      select review_case_id
      from qa_admin_review_open_replay
    ) = (
      select review_case_id
      from qa_admin_review_open
    ),
  'admin open exact replay returns original review case without duplicate create'
);

select extensions.ok(
  (
    select created
      and status = 'IN_REVIEW'
      and version = 2
      and event_id is not null
    from qa_admin_review_transition
  ),
  'admin aal2 transition to IN_REVIEW succeeds'
);

select extensions.is(
  (
    select events.actor_profile_id::text || ',' ||
      events.from_status || ',' ||
      events.to_status || ',' ||
      events.reason_code
    from private.reconciliation_review_case_events as events
    join qa_admin_review_transition as transitioned
      on transitioned.event_id = events.id
  ),
  '00000000-0000-4000-8000-000000680001,OPEN,IN_REVIEW,START_REVIEW',
  'transition event stores current admin actor and status transition'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000680002', 'aal2');

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case((select review_case_id from qa_admin_review_open), 2, 'RESOLVED', 'p5adm.transition.user.0001', 'RESOLVED_MATCH')$$,
  '42501'::character(5),
  null,
  'non-admin aal2 transition command is rejected'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000680001', 'aal1');

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case((select review_case_id from qa_admin_review_open), 2, 'RESOLVED', 'p5adm.transition.aal1.0001', 'RESOLVED_MATCH')$$,
  '42501'::character(5),
  null,
  'admin aal1 transition command is rejected'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000680001', 'aal2');

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case((select review_case_id from qa_admin_review_open), 1, 'RESOLVED', 'p5adm.transition.badversion.0001', 'BAD_VERSION')$$,
  '40001'::character(5),
  'reconciliation_resolution_version_conflict',
  'transition preserves optimistic version conflict'
);

create temporary table qa_admin_review_resolved as
select *
from public.admin_transition_review_case(
  (select review_case_id from qa_admin_review_open),
  2,
  'RESOLVED',
  'p5adm.transition.resolved.0001',
  'RESOLVED_MATCH'
);

select extensions.throws_ok(
  $$select * from public.admin_transition_review_case((select review_case_id from qa_admin_review_open), 3, 'IGNORED', 'p5adm.transition.terminal.0001', 'TERMINAL_BLOCK')$$,
  '23514'::character(5),
  'reconciliation_resolution_terminal',
  'transition preserves terminal protection'
);

reset role;

select extensions.ok(
  (
    select created and status = 'RESOLVED' and version = 3
    from qa_admin_review_resolved
  ),
  'admin aal2 transition to RESOLVED succeeds'
);

select extensions.is(
  (
    select count(*)::integer
    from private.reconciliation_review_case_events
    where reconciliation_resolution_id = (select review_case_id from qa_admin_review_open)
  ),
  3,
  'open transition and terminal transition append exactly three lifecycle events'
);

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
      ledger_entries::text
    from qa_admin_review_side_effect_counts_before
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
  'admin review commands leave reconciliation source observation checkpoint and ledger rows unchanged'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000680001', 'aal2');

select extensions.throws_ok(
  $$select * from private.open_reconciliation_resolution('00000000-0000-4000-8000-000000680601', 'p5adm.direct.private.0001', '00000000-0000-4000-8000-000000680002', 'SPOOF_ATTEMPT')$$,
  '42501'::character(5),
  null,
  'authenticated callers still cannot spoof actor by executing private open function'
);

reset role;

select * from extensions.finish();

rollback;
