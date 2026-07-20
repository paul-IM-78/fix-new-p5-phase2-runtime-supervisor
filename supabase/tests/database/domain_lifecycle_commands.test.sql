begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

create function pg_temp.insert_auth_user(
  test_user_id uuid,
  test_email text,
  test_user_metadata jsonb default '{}'::jsonb,
  test_app_metadata jsonb default '{"provider":"email","providers":["email"]}'::jsonb
)
returns void
language sql
as $$
  insert into auth.users (
    id,
    aud,
    role,
    email,
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
    test_email,
    now(),
    coalesce(test_app_metadata, '{}'::jsonb),
    coalesce(test_user_metadata, '{}'::jsonb),
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

select extensions.has_table(
  'private',
  'domain_admin_audit_events',
  'domain audit table exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.domain_admin_audit_events'::regclass
      and conname in (
        'domain_admin_audit_events_command_id_key',
        'domain_admin_audit_events_action_check',
        'domain_admin_audit_events_outcome_check',
        'domain_admin_audit_events_reason_check',
        'domain_admin_audit_events_entity_fk_check'
      )
    group by conrelid
    having count(*) = 5
  ),
  'domain audit constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.domain_admin_audit_events'::regclass
      and tgname = 'protect_domain_admin_audit_events'
      and not tgisinternal
  ),
  'domain audit immutability trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'domain_admin_audit_events'
      and indexname in (
        'domain_admin_audit_events_occurred_at_idx',
        'domain_admin_audit_events_actor_idx',
        'domain_admin_audit_events_project_idx',
        'domain_admin_audit_events_asset_idx',
        'domain_admin_audit_events_assignment_idx'
      )
    group by schemaname, tablename
    having count(*) = 5
  ),
  'domain audit indexes exist'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_project',
        'update_project_details',
        'transition_project_status',
        'create_supported_asset',
        'update_supported_asset_details',
        'transition_supported_asset_status',
        'assign_project_token',
        'retire_project_token',
        'list_admin_projects',
        'list_admin_supported_assets',
        'list_admin_project_token_assignments',
        'list_domain_admin_audit_events'
      )
  ) = 12,
  'eight lifecycle command RPCs and four read RPCs exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_project',
        'update_project_details',
        'transition_project_status',
        'create_supported_asset',
        'update_supported_asset_details',
        'transition_supported_asset_status',
        'assign_project_token',
        'retire_project_token',
        'list_admin_projects',
        'list_admin_supported_assets',
        'list_admin_project_token_assignments',
        'list_domain_admin_audit_events'
      )
      and not prosecdef
  ),
  'domain RPCs are security definer'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_project',
        'update_project_details',
        'transition_project_status',
        'create_supported_asset',
        'update_supported_asset_details',
        'transition_supported_asset_status',
        'assign_project_token',
        'retire_project_token',
        'list_admin_projects',
        'list_admin_supported_assets',
        'list_admin_project_token_assignments',
        'list_domain_admin_audit_events'
      )
      and coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
  ),
  'domain RPCs use empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.create_project(text, text, text, uuid, text)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.create_project(text, text, text, uuid, text)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.list_admin_projects(integer)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.list_admin_projects(integer)'::regprocedure,
      'execute'
    ),
  'domain RPC execute grants are authenticated-only'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'private.domain_admin_audit_events',
    'select'
  )
    and not has_table_privilege(
      'authenticated',
      'private.domain_admin_audit_events',
      'insert'
    )
    and not has_table_privilege(
      'anon',
      'private.domain_admin_audit_events',
      'select'
    ),
  'domain audit table direct access is blocked'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000004001',
  'domain-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000004002',
  'domain-user@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000004003',
  'domain-inactive-admin@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values
  ('00000000-0000-4000-8000-000000004001', 'ADMIN', 'local domain command fixture'),
  ('00000000-0000-4000-8000-000000004003', 'ADMIN', 'local domain command fixture');

update public.profiles
set account_status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000004003';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000004002', 'aal2');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.create_project(
      'USER_BLOCK',
      'User Blocked',
      null,
      '00000000-0000-4000-8000-000000005001',
      'blocked user command'
    );
    raise exception 'expected user denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'general USER cannot execute domain command'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.list_admin_projects(10);
    raise exception 'expected user read denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'general USER cannot execute admin domain read RPC'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000004001', 'aal1');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.create_project(
      'AAL1_BLOCK',
      'AAL1 Blocked',
      null,
      '00000000-0000-4000-8000-000000005002',
      'blocked aal1 command'
    );
    raise exception 'expected aal1 denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'AAL1 ADMIN cannot execute domain command'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000004003', 'aal2');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.create_project(
      'INACTIVE_BLOCK',
      'Inactive Blocked',
      null,
      '00000000-0000-4000-8000-000000005003',
      'blocked inactive admin command'
    );
    raise exception 'expected inactive admin denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'inactive AAL2 ADMIN cannot execute domain command'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000004001', 'aal2');

create temp table command_result as
select *
from public.create_project(
  'QA_PROJECT_A',
  'QA Project A',
  'Local domain lifecycle project',
  '00000000-0000-4000-8000-000000005010',
  'create project a'
);

select extensions.is(
  (select result_code from command_result),
  'APPLIED',
  'project create applied'
);

select extensions.is(
  (
    select status
    from public.projects
    where project_code = 'QA_PROJECT_A'
  ),
  'DRAFT',
  'project create starts as draft'
);

select extensions.is(
  (
    select count(*)::integer
    from private.domain_admin_audit_events
    where action = 'CREATE_PROJECT'
      and outcome = 'APPLIED'
  ),
  1,
  'project create audit applied'
);

select extensions.is(
  (
    select result_code
    from public.create_project(
      'QA_PROJECT_A',
      'QA Project A',
      'Local domain lifecycle project',
      '00000000-0000-4000-8000-000000005010',
      'create project a'
    )
  ),
  'APPLIED',
  'project create replay returns original outcome'
);

select extensions.is(
  (
    select replayed
    from public.create_project(
      'QA_PROJECT_A',
      'QA Project A',
      'Local domain lifecycle project',
      '00000000-0000-4000-8000-000000005010',
      'create project a'
    )
  ),
  true,
  'project create replay is marked'
);

select extensions.is(
  (
    select result_code
    from public.create_project(
      'QA_PROJECT_CONFLICT',
      'QA Project Conflict',
      null,
      '00000000-0000-4000-8000-000000005010',
      'different request'
    )
  ),
  'COMMAND_ID_CONFLICT',
  'command id conflict is blocked'
);

select extensions.is(
  (
    select result_code
    from public.create_project(
      'QA_PROJECT_A',
      'Duplicate Project',
      null,
      '00000000-0000-4000-8000-000000005011',
      'duplicate project code'
    )
  ),
  'PROJECT_CODE_EXISTS',
  'duplicate project code is blocked without audit'
);

select extensions.is(
  (
    select result_code
    from public.create_project(
      'bad_code',
      'Bad Code',
      null,
      '00000000-0000-4000-8000-000000005012',
      'bad project code'
    )
  ),
  'INVALID_INPUT',
  'project input validation rejects bad code'
);

create temp table project_ids as
select id, version
from public.projects
where project_code = 'QA_PROJECT_A';

create temp table update_result as
select *
from public.update_project_details(
  (select id from project_ids),
  (select version from project_ids),
  'QA Project A Updated',
  'Updated local project',
  '00000000-0000-4000-8000-000000005020',
  'update project details'
);

select extensions.is(
  (select result_code from update_result),
  'APPLIED',
  'project details update applied'
);

select extensions.is(
  (
    select version::integer
    from public.projects
    where project_code = 'QA_PROJECT_A'
  ),
  (select version::integer + 1 from project_ids),
  'project update increments version'
);

select extensions.is(
  (
    select result_code
    from public.update_project_details(
      (select id from project_ids),
      1,
      'QA Project A Updated Again',
      null,
      '00000000-0000-4000-8000-000000005021',
      'stale project update'
    )
  ),
  'PROJECT_VERSION_CONFLICT',
  'project stale expected version is blocked'
);

create temp table project_after_update as
select id, version, display_name, description
from public.projects
where project_code = 'QA_PROJECT_A';

select extensions.is(
  (
    select result_code
    from public.update_project_details(
      (select id from project_after_update),
      (select version from project_after_update),
      (select display_name from project_after_update),
      (select description from project_after_update),
      '00000000-0000-4000-8000-000000005022',
      'noop project update'
    )
  ),
  'NOOP',
  'project details same value records noop'
);

select extensions.is(
  (
    select result_code
    from public.transition_project_status(
      (select id from project_after_update),
      (select version from project_after_update),
      'ACTIVE',
      '00000000-0000-4000-8000-000000005030',
      'activate without token'
    )
  ),
  'PROJECT_ACTIVATION_NOT_READY',
  'project activation without current active token is blocked'
);

create temp table native_asset_result as
select *
from public.create_supported_asset(
  'QA_NATIVE_A',
  'QAN',
  'QA Native A',
  'NATIVE',
  9::smallint,
  null,
  '00000000-0000-4000-8000-000000005040',
  'create native asset'
);

select extensions.is(
  (select result_code from native_asset_result),
  'APPLIED',
  'native asset create applied'
);

create temp table spl_asset_result as
select *
from public.create_supported_asset(
  'QA_SPL_A',
  'QAA',
  'QA SPL A',
  'SPL_TOKEN',
  6::smallint,
  '11111111111111111111111111111121',
  '00000000-0000-4000-8000-000000005041',
  'create spl asset'
);

select extensions.is(
  (select result_code from spl_asset_result),
  'APPLIED',
  'spl asset create applied'
);

select extensions.is(
  (
    select result_code
    from public.create_supported_asset(
      'QA_BAD_NATIVE',
      'QANX',
      'Bad Native',
      'NATIVE',
      9::smallint,
      '11111111111111111111111111111122',
      '00000000-0000-4000-8000-000000005042',
      'bad native mint'
    )
  ),
  'INVALID_INPUT',
  'native asset rejects mint'
);

select extensions.is(
  (
    select result_code
    from public.create_supported_asset(
      'QA_SPL_DUP_MINT',
      'QAD',
      'QA Duplicate Mint',
      'SPL_TOKEN',
      6::smallint,
      '11111111111111111111111111111121',
      '00000000-0000-4000-8000-000000005043',
      'duplicate mint'
    )
  ),
  'ASSET_MINT_EXISTS',
  'duplicate SPL mint is blocked'
);

select extensions.is(
  (
    select result_code
    from public.assign_project_token(
      (select id from project_after_update),
      (select asset_id from spl_asset_result),
      '00000000-0000-4000-8000-000000005044',
      'assign draft asset'
    )
  ),
  'ASSET_NOT_READY',
  'draft SPL asset cannot be assigned'
);

create temp table spl_active_result as
select *
from public.transition_supported_asset_status(
  (select asset_id from spl_asset_result),
  (select version from public.supported_assets where asset_code = 'QA_SPL_A'),
  'ACTIVE',
  '00000000-0000-4000-8000-000000005045',
  'activate spl asset'
);

select extensions.is(
  (select result_code from spl_active_result),
  'APPLIED',
  'asset activation applied'
);

select extensions.is(
  (
    select result_code
    from public.update_supported_asset_details(
      (select asset_id from spl_asset_result),
      (select version from public.supported_assets where asset_code = 'QA_SPL_A'),
      'QAA2',
      'QA SPL A Active Update',
      '00000000-0000-4000-8000-000000005046',
      'active asset update'
    )
  ),
  'ASSET_TRANSITION_INVALID',
  'active asset display update is blocked'
);

create temp table assign_result as
select *
from public.assign_project_token(
  (select id from project_after_update),
  (select asset_id from spl_asset_result),
  '00000000-0000-4000-8000-000000005050',
  'assign project token'
);

select extensions.is(
  (select result_code from assign_result),
  'APPLIED',
  'project token assignment applied'
);

select extensions.is(
  (
    select result_code
    from public.assign_project_token(
      (select id from project_after_update),
      (select asset_id from spl_asset_result),
      '00000000-0000-4000-8000-000000005051',
      'assign same project token'
    )
  ),
  'NOOP',
  'same current token assignment is noop'
);

select extensions.is(
  (
    select result_code
    from public.assign_project_token(
      (select id from project_after_update),
      (select asset_id from native_asset_result),
      '00000000-0000-4000-8000-000000005052',
      'assign native token'
    )
  ),
  'ASSET_NOT_READY',
  'native asset assignment is blocked'
);

create temp table project_activate_result as
select *
from public.transition_project_status(
  (select id from project_after_update),
  (select version from public.projects where project_code = 'QA_PROJECT_A'),
  'ACTIVE',
  '00000000-0000-4000-8000-000000005060',
  'activate project'
);

select extensions.is(
  (select result_code from project_activate_result),
  'APPLIED',
  'ready project activation applied'
);

select extensions.is(
  (
    select result_code
    from public.transition_supported_asset_status(
      (select asset_id from spl_asset_result),
      (select version from public.supported_assets where asset_code = 'QA_SPL_A'),
      'SUSPENDED',
      '00000000-0000-4000-8000-000000005061',
      'suspend active token asset'
    )
  ),
  'ASSET_IN_USE_BY_ACTIVE_PROJECT',
  'asset in use by active project cannot suspend'
);

select extensions.is(
  (
    select result_code
    from public.retire_project_token(
      (select assignment_id from assign_result),
      (select version from public.project_token_assignments where id = (select assignment_id from assign_result)),
      '00000000-0000-4000-8000-000000005062',
      'retire active project token'
    )
  ),
  'ACTIVE_PROJECT_TOKEN_RETIRE_FORBIDDEN',
  'active project token cannot be retired'
);

create temp table second_project as
select *
from public.create_project(
  'QA_PROJECT_B',
  'QA Project B',
  null,
  '00000000-0000-4000-8000-000000005063',
  'create project b'
);

create temp table second_spl as
select *
from public.create_supported_asset(
  'QA_SPL_B',
  'QAB',
  'QA SPL B',
  'SPL_TOKEN',
  6::smallint,
  '11111111111111111111111111111123',
  '00000000-0000-4000-8000-000000005064',
  'create second spl asset'
);

select public.transition_supported_asset_status(
  (select asset_id from second_spl),
  (select version from public.supported_assets where asset_code = 'QA_SPL_B'),
  'ACTIVE',
  '00000000-0000-4000-8000-000000005065',
  'activate second spl asset'
);

select public.assign_project_token(
  (select project_id from second_project),
  (select asset_id from second_spl),
  '00000000-0000-4000-8000-000000005066',
  'assign second project token'
);

select extensions.is(
  (
    select result_code
    from public.transition_project_status(
      (select project_id from second_project),
      (select version from public.projects where project_code = 'QA_PROJECT_B'),
      'ACTIVE',
      '00000000-0000-4000-8000-000000005067',
      'activate second project'
    )
  ),
  'ACTIVE_PROJECT_CONFLICT',
  'second active project is blocked'
);

create temp table suspend_project as
select *
from public.transition_project_status(
  (select id from project_after_update),
  (select version from public.projects where project_code = 'QA_PROJECT_A'),
  'SUSPENDED',
  '00000000-0000-4000-8000-000000005070',
  'suspend project before token replacement'
);

select extensions.is(
  (select result_code from suspend_project),
  'APPLIED',
  'active project can suspend'
);

create temp table retire_result as
select *
from public.retire_project_token(
  (select assignment_id from assign_result),
  (select version from public.project_token_assignments where id = (select assignment_id from assign_result)),
  '00000000-0000-4000-8000-000000005071',
  'retire token after suspend'
);

select extensions.is(
  (select result_code from retire_result),
  'APPLIED',
  'token retire applied after project suspend'
);

select extensions.is(
  (
    select result_code
    from public.retire_project_token(
      (select assignment_id from assign_result),
      (select version from public.project_token_assignments where id = (select assignment_id from assign_result)),
      '00000000-0000-4000-8000-000000005072',
      'retire token noop'
    )
  ),
  'NOOP',
  'already retired assignment is noop'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update public.project_token_assignments
    set retired_at = null
    where id = (select assignment_id from assign_result);
    raise exception 'expected retired assignment reactivation failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'retired assignment cannot be reactivated after command retire'
);

create temp table replacement_spl as
select *
from public.create_supported_asset(
  'QA_SPL_C',
  'QAC',
  'QA SPL C',
  'SPL_TOKEN',
  6::smallint,
  '11111111111111111111111111111124',
  '00000000-0000-4000-8000-000000005073',
  'create replacement spl asset'
);

select public.transition_supported_asset_status(
  (select asset_id from replacement_spl),
  (select version from public.supported_assets where asset_code = 'QA_SPL_C'),
  'ACTIVE',
  '00000000-0000-4000-8000-000000005074',
  'activate replacement spl asset'
);

create temp table replacement_assign as
select *
from public.assign_project_token(
  (select id from project_after_update),
  (select asset_id from replacement_spl),
  '00000000-0000-4000-8000-000000005075',
  'assign replacement token'
);

select extensions.is(
  (select result_code from replacement_assign),
  'APPLIED',
  'replacement token assignment applied'
);

select extensions.is(
  (
    select count(*)::integer
    from public.project_token_assignments
    where project_id = (select id from project_after_update)
      and retired_at is null
  ),
  1,
  'replacement preserves exactly one current assignment'
);

select extensions.is(
  (
    select count(*)::integer
    from public.project_token_assignments
    where project_id = (select id from project_after_update)
  ),
  2,
  'token replacement preserves assignment history'
);

select extensions.is(
  (
    select result_code
    from public.transition_project_status(
      (select id from project_after_update),
      (select version from public.projects where project_code = 'QA_PROJECT_A'),
      'ACTIVE',
      '00000000-0000-4000-8000-000000005076',
      'reactivate project after replacement'
    )
  ),
  'APPLIED',
  'project reactivation after token replacement applied'
);

select extensions.ok(
  (
    select count(*)::integer
    from private.domain_admin_audit_events
    where outcome = 'APPLIED'
  ) > 0
    and (
      select count(*)::integer
      from private.domain_admin_audit_events
      where outcome = 'NOOP'
    ) > 0,
  'audit stores APPLIED and NOOP events'
);

select extensions.is(
  (
    select count(*)::integer
    from private.domain_admin_audit_events
    where command_id = '00000000-0000-4000-8000-000000005010'
  ),
  1,
  'command replay does not duplicate audit'
);

select extensions.ok(
  (
    select count(*)::integer
    from public.list_admin_projects(100)
  ) >= 2
    and (
      select count(*)::integer
      from public.list_admin_supported_assets(100)
    ) >= 3
    and (
      select count(*)::integer
      from public.list_admin_project_token_assignments(100, true)
    ) >= 3
    and (
      select count(*)::integer
      from public.list_domain_admin_audit_events(50, null)
    ) >= 1,
  'AAL2 admin read RPCs return domain rows'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.domain_admin_audit_events
    set reason = 'changed';
    raise exception 'expected audit update failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'domain audit update is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    delete from private.domain_admin_audit_events;
    raise exception 'expected audit delete failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'domain audit delete is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    truncate private.domain_admin_audit_events;
    raise exception 'expected audit truncate failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'domain audit truncate is blocked'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema in ('public', 'private')
      and table_name in (
        'projects',
        'supported_assets',
        'project_token_assignments',
        'wallet_accounts',
        'domain_admin_audit_events'
      )
      and lower(column_name) in (
        'balance',
        'available_balance',
        'locked_balance',
        'pending_balance',
        'amount',
        'quantity',
        'principal',
        'reward',
        'apy',
        'deposit_address',
        'withdrawal_address',
        'wallet_address',
        'private_key',
        'mnemonic',
        'seed_phrase',
        'transaction_id'
      )
  ),
  'financial and credential columns remain absent'
);

reset role;

select * from extensions.finish();

rollback;
