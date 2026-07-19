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

select extensions.ok(
  to_regclass('private.admin_role_audit_events') is not null,
  'admin role audit table exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_attribute
    where attrelid = 'private.admin_role_audit_events'::regclass
      and attname in (
        'id',
        'command_id',
        'action',
        'outcome',
        'actor_user_id',
        'target_user_id',
        'role',
        'role_record_id',
        'reason',
        'target_account_status',
        'previously_active',
        'resulting_active',
        'role_version',
        'occurred_at'
      )
      and not attisdropped
    group by attrelid
    having count(*) = 14
  ),
  'admin role audit table has required columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.admin_role_audit_events'::regclass
      and contype = 'p'
  ),
  'admin role audit table has primary key'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.admin_role_audit_events'::regclass
      and conname = 'admin_role_audit_events_command_id_key'
      and contype = 'u'
  ),
  'admin role audit command_id is unique'
);

select extensions.ok(
  (
    select count(*)
    from pg_constraint
    where conrelid = 'private.admin_role_audit_events'::regclass
      and contype = 'f'
  ) >= 3,
  'admin role audit table has foreign keys'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.admin_role_audit_events'::regclass
      and conname = 'admin_role_audit_events_state_check'
  ),
  'admin role audit table has state consistency check'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'admin_role_audit_events'
      and indexname = 'admin_role_audit_events_occurred_at_idx'
  ),
  'admin role audit table has occurred_at index'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.admin_role_audit_events'::regclass
      and tgname = 'protect_admin_role_audit_events'
      and not tgisinternal
  ),
  'admin role audit mutation trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc
    where oid = 'public.grant_admin_role(uuid,uuid,text)'::regprocedure
      and pronargs = 3
  ),
  'grant_admin_role exists with expected signature'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc
    where oid = 'public.revoke_admin_role(uuid,uuid,text)'::regprocedure
      and pronargs = 3
  ),
  'revoke_admin_role exists with expected signature'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc
    where oid = 'public.list_admin_role_audit_events(integer,uuid)'::regprocedure
      and pronargs = 2
  ),
  'list_admin_role_audit_events exists with expected signature'
);

select extensions.ok(
  (select prosecdef from pg_proc where oid = 'public.grant_admin_role(uuid,uuid,text)'::regprocedure),
  'grant_admin_role is security definer'
);

select extensions.ok(
  (select prosecdef from pg_proc where oid = 'public.revoke_admin_role(uuid,uuid,text)'::regprocedure),
  'revoke_admin_role is security definer'
);

select extensions.ok(
  (select prosecdef from pg_proc where oid = 'public.list_admin_role_audit_events(integer,uuid)'::regprocedure),
  'list_admin_role_audit_events is security definer'
);

select extensions.ok(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.grant_admin_role(uuid,uuid,text)'::regprocedure)
    in ('search_path=', 'search_path=""'),
  'grant_admin_role has empty search_path'
);

select extensions.ok(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.revoke_admin_role(uuid,uuid,text)'::regprocedure)
    in ('search_path=', 'search_path=""'),
  'revoke_admin_role has empty search_path'
);

select extensions.ok(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.list_admin_role_audit_events(integer,uuid)'::regprocedure)
    in ('search_path=', 'search_path=""'),
  'list_admin_role_audit_events has empty search_path'
);

select extensions.ok(
  obj_description('private.admin_role_audit_events'::regclass, 'pg_class') is not null,
  'admin role audit table has comment'
);

select extensions.ok(
  obj_description('private.prevent_admin_role_audit_mutation()'::regprocedure, 'pg_proc') is not null,
  'audit mutation trigger function has comment'
);

select extensions.ok(
  obj_description('public.grant_admin_role(uuid,uuid,text)'::regprocedure, 'pg_proc') is not null,
  'grant_admin_role has comment'
);

select extensions.ok(
  obj_description('public.revoke_admin_role(uuid,uuid,text)'::regprocedure, 'pg_proc') is not null,
  'revoke_admin_role has comment'
);

select extensions.ok(
  obj_description('public.list_admin_role_audit_events(integer,uuid)'::regprocedure, 'pg_proc') is not null,
  'audit list function has comment'
);

select extensions.ok(
  not has_table_privilege('anon', 'private.admin_role_audit_events', 'select'),
  'anon cannot select audit table'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.admin_role_audit_events', 'select'),
  'authenticated cannot select audit table'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.admin_role_audit_events', 'insert'),
  'authenticated cannot insert audit table directly'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.admin_role_audit_events', 'update'),
  'authenticated cannot update audit table directly'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.admin_role_audit_events', 'delete'),
  'authenticated cannot delete audit table directly'
);

select extensions.ok(
  not has_function_privilege('anon', 'public.grant_admin_role(uuid,uuid,text)'::regprocedure, 'execute'),
  'anon cannot execute grant command'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.grant_admin_role(uuid,uuid,text)'::regprocedure, 'execute'),
  'authenticated can execute grant command'
);

select extensions.ok(
  not has_function_privilege('anon', 'public.revoke_admin_role(uuid,uuid,text)'::regprocedure, 'execute'),
  'anon cannot execute revoke command'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.revoke_admin_role(uuid,uuid,text)'::regprocedure, 'execute'),
  'authenticated can execute revoke command'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.list_admin_role_audit_events(integer,uuid)'::regprocedure, 'execute'),
  'authenticated can execute audit list'
);

select extensions.ok(
  not has_function_privilege('authenticated', 'private.prevent_admin_role_audit_mutation()'::regprocedure, 'execute'),
  'authenticated cannot execute audit mutation trigger function'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.user_roles', 'select'),
  'authenticated still cannot select user_roles'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000002001',
  'admin-role-actor@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000002002',
  'admin-role-user@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000002003',
  'admin-role-target@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000002004',
  'admin-role-target-two@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000002005',
  'admin-role-restricted@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000002006',
  'admin-role-suspended@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000002007',
  'admin-role-withdrawn@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000002008',
  'admin-role-metadata@example.test',
  '{"role":"ADMIN","is_admin":true}'::jsonb,
  '{"role":"ADMIN","is_admin":true}'::jsonb
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000002001',
  'ADMIN',
  'local pgTAP admin role command fixture'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000002005',
  'ADMIN',
  'local pgTAP inactive revoke fixture'
);

update public.profiles
set account_status = 'RESTRICTED'
where id = '00000000-0000-4000-8000-000000002005';

update public.profiles
set account_status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000002006';

update public.profiles
set account_status = 'WITHDRAWN'
where id = '00000000-0000-4000-8000-000000002007';

set local role authenticated;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002002', 'aal2');

select extensions.throws_ok(
  $$select * from public.grant_admin_role('00000000-0000-4000-8000-000000002003', '10000000-0000-4000-8000-000000000001', 'user cannot grant')$$,
  '42501'::character(5),
  null,
  'active USER with aal2 cannot grant admin'
);

select extensions.throws_ok(
  $$select * from public.revoke_admin_role('00000000-0000-4000-8000-000000002003', '10000000-0000-4000-8000-000000000002', 'user cannot revoke')$$,
  '42501'::character(5),
  null,
  'active USER with aal2 cannot revoke admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal1');

select extensions.throws_ok(
  $$select * from public.grant_admin_role('00000000-0000-4000-8000-000000002003', '10000000-0000-4000-8000-000000000003', 'aal1 cannot grant')$$,
  '42501'::character(5),
  null,
  'ADMIN with aal1 cannot grant admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002005', 'aal2');

select extensions.throws_ok(
  $$select * from public.grant_admin_role('00000000-0000-4000-8000-000000002003', '10000000-0000-4000-8000-000000000004', 'inactive cannot grant')$$,
  '42501'::character(5),
  null,
  'inactive ADMIN with aal2 cannot grant admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002008', 'aal2');

select extensions.throws_ok(
  $$select * from public.grant_admin_role('00000000-0000-4000-8000-000000002003', '10000000-0000-4000-8000-000000000005', 'metadata cannot grant')$$,
  '42501'::character(5),
  null,
  'metadata ADMIN without role cannot grant admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table grant_applied as
select *
from public.grant_admin_role(
  '00000000-0000-4000-8000-000000002003',
  '10000000-0000-4000-8000-000000000010',
  '  promote target for local pgTAP  '
);

reset role;

select extensions.is(
  (select result_code from grant_applied),
  'APPLIED',
  'grant returns APPLIED'
);

select extensions.is(
  (select replayed from grant_applied),
  false,
  'first grant is not replayed'
);

select extensions.is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = '00000000-0000-4000-8000-000000002003'
      and role = 'ADMIN'
      and revoked_at is null
  ),
  1,
  'grant creates one active ADMIN role'
);

select extensions.is(
  (
    select granted_by
    from public.user_roles
    where id = (select role_record_id from grant_applied)
  ),
  '00000000-0000-4000-8000-000000002001'::uuid,
  'grant records actor'
);

select extensions.is(
  (
    select grant_reason
    from public.user_roles
    where id = (select role_record_id from grant_applied)
  ),
  'promote target for local pgTAP',
  'grant trims and stores reason'
);

select extensions.is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = '00000000-0000-4000-8000-000000002003'
      and role = 'USER'
      and revoked_at is null
  ),
  1,
  'grant preserves USER role'
);

select extensions.is(
  (
    select action || ',' || outcome || ',' || previously_active::text || ',' || resulting_active::text
    from private.admin_role_audit_events
    where command_id = '10000000-0000-4000-8000-000000000010'
  ),
  'GRANT_ADMIN,APPLIED,false,true',
  'grant writes APPLIED audit event'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table grant_replay as
select *
from public.grant_admin_role(
  '00000000-0000-4000-8000-000000002003',
  '10000000-0000-4000-8000-000000000010',
  'promote target for local pgTAP'
);

reset role;

select extensions.is(
  (select result_code from grant_replay),
  'APPLIED',
  'grant replay returns original result'
);

select extensions.is(
  (select replayed from grant_replay),
  true,
  'grant replay is marked replayed'
);

select extensions.is(
  (
    select count(*)::integer
    from private.admin_role_audit_events
    where command_id = '10000000-0000-4000-8000-000000000010'
  ),
  1,
  'grant replay does not duplicate audit'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table grant_conflict as
select *
from public.grant_admin_role(
  '00000000-0000-4000-8000-000000002004',
  '10000000-0000-4000-8000-000000000010',
  'different target conflict'
);

reset role;

select extensions.is(
  (select result_code from grant_conflict),
  'COMMAND_ID_CONFLICT',
  'grant command id conflict is detected'
);

select extensions.is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = '00000000-0000-4000-8000-000000002004'
      and role = 'ADMIN'
      and revoked_at is null
  ),
  0,
  'grant conflict does not mutate target'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table grant_noop as
select *
from public.grant_admin_role(
  '00000000-0000-4000-8000-000000002003',
  '10000000-0000-4000-8000-000000000011',
  'target is already admin'
);

reset role;

select extensions.is(
  (select result_code from grant_noop),
  'NOOP',
  'grant existing active ADMIN returns NOOP'
);

select extensions.is(
  (
    select action || ',' || outcome || ',' || previously_active::text || ',' || resulting_active::text
    from private.admin_role_audit_events
    where command_id = '10000000-0000-4000-8000-000000000011'
  ),
  'GRANT_ADMIN,NOOP,true,true',
  'grant no-op writes NOOP audit event'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table grant_missing as
select *
from public.grant_admin_role(
  '00000000-0000-4000-8000-000000009999',
  '10000000-0000-4000-8000-000000000012',
  'missing target'
);

select extensions.is(
  (select result_code from grant_missing),
  'TARGET_NOT_FOUND',
  'grant missing target is rejected'
);

create temporary table grant_restricted as
select *
from public.grant_admin_role(
  '00000000-0000-4000-8000-000000002005',
  '10000000-0000-4000-8000-000000000013',
  'restricted target'
);

select extensions.is(
  (select result_code from grant_restricted),
  'TARGET_INACTIVE',
  'grant restricted target is rejected'
);

create temporary table grant_suspended as
select *
from public.grant_admin_role(
  '00000000-0000-4000-8000-000000002006',
  '10000000-0000-4000-8000-000000000014',
  'suspended target'
);

select extensions.is(
  (select result_code from grant_suspended),
  'TARGET_INACTIVE',
  'grant suspended target is rejected'
);

create temporary table grant_withdrawn as
select *
from public.grant_admin_role(
  '00000000-0000-4000-8000-000000002007',
  '10000000-0000-4000-8000-000000000015',
  'withdrawn target'
);

select extensions.is(
  (select result_code from grant_withdrawn),
  'TARGET_INACTIVE',
  'grant withdrawn target is rejected'
);

reset role;

select extensions.is(
  (
    select count(*)::integer
    from private.admin_role_audit_events
    where command_id in (
      '10000000-0000-4000-8000-000000000012',
      '10000000-0000-4000-8000-000000000013',
      '10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000015'
    )
  ),
  0,
  'grant target validation failures do not write audit'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table self_revoke as
select *
from public.revoke_admin_role(
  '00000000-0000-4000-8000-000000002001',
  '10000000-0000-4000-8000-000000000020',
  'self revoke forbidden'
);

reset role;

select extensions.is(
  (select result_code from self_revoke),
  'SELF_REVOKE_FORBIDDEN',
  'self revoke is rejected'
);

select extensions.is(
  (
    select count(*)::integer
    from private.admin_role_audit_events
    where command_id = '10000000-0000-4000-8000-000000000020'
  ),
  0,
  'self revoke does not write audit'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table revoke_applied as
select *
from public.revoke_admin_role(
  '00000000-0000-4000-8000-000000002003',
  '10000000-0000-4000-8000-000000000021',
  'remove target admin'
);

reset role;

select extensions.is(
  (select result_code from revoke_applied),
  'APPLIED',
  'revoke active ADMIN returns APPLIED'
);

select extensions.is(
  (
    select revoked_by
    from public.user_roles
    where id = (select role_record_id from revoke_applied)
  ),
  '00000000-0000-4000-8000-000000002001'::uuid,
  'revoke records actor'
);

select extensions.ok(
  (
    select revoked_at is not null
    from public.user_roles
    where id = (select role_record_id from revoke_applied)
  ),
  'revoke records timestamp'
);

select extensions.is(
  (
    select revoke_reason
    from public.user_roles
    where id = (select role_record_id from revoke_applied)
  ),
  'remove target admin',
  'revoke records reason'
);

select extensions.is(
  (
    select version
    from public.user_roles
    where id = (select role_record_id from revoke_applied)
  ),
  2::bigint,
  'revoke increments version'
);

select extensions.is(
  (
    select action || ',' || outcome || ',' || previously_active::text || ',' || resulting_active::text
    from private.admin_role_audit_events
    where command_id = '10000000-0000-4000-8000-000000000021'
  ),
  'REVOKE_ADMIN,APPLIED,true,false',
  'revoke writes APPLIED audit event'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

select extensions.is(
  public.is_current_user_admin_aal2(),
  true,
  'actor remains admin aal2 after revoking another admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002003', 'aal2');

select extensions.is(
  public.is_current_user_admin(),
  false,
  'revoked target is immediately not admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table revoke_replay as
select *
from public.revoke_admin_role(
  '00000000-0000-4000-8000-000000002003',
  '10000000-0000-4000-8000-000000000021',
  'remove target admin'
);

reset role;

select extensions.is(
  (select result_code from revoke_replay),
  'APPLIED',
  'revoke replay returns original result'
);

select extensions.is(
  (select replayed from revoke_replay),
  true,
  'revoke replay is marked replayed'
);

select extensions.is(
  (
    select version
    from public.user_roles
    where id = (select role_record_id from revoke_applied)
  ),
  2::bigint,
  'revoke replay does not increment version'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table revoke_noop as
select *
from public.revoke_admin_role(
  '00000000-0000-4000-8000-000000002003',
  '10000000-0000-4000-8000-000000000022',
  'target already not admin'
);

reset role;

select extensions.is(
  (select result_code from revoke_noop),
  'NOOP',
  'revoke target without active ADMIN returns NOOP'
);

select extensions.is(
  (
    select action || ',' || outcome || ',' || previously_active::text || ',' || resulting_active::text
    from private.admin_role_audit_events
    where command_id = '10000000-0000-4000-8000-000000000022'
  ),
  'REVOKE_ADMIN,NOOP,false,false',
  'revoke no-op writes NOOP audit event'
);

set local role authenticated;
select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal2');

create temporary table revoke_inactive_admin as
select *
from public.revoke_admin_role(
  '00000000-0000-4000-8000-000000002005',
  '10000000-0000-4000-8000-000000000023',
  'remove inactive admin'
);

select extensions.is(
  (select result_code from revoke_inactive_admin),
  'APPLIED',
  'revoke inactive target admin is allowed'
);

create temporary table audit_list as
select *
from public.list_admin_role_audit_events(25, null);

select extensions.ok(
  (select count(*) from audit_list) >= 5,
  'AAL2 admin can list audit events'
);

select extensions.ok(
  not exists (
    select 1
    from audit_list
    where action not in ('GRANT_ADMIN', 'REVOKE_ADMIN')
      or outcome not in ('APPLIED', 'NOOP')
  ),
  'audit list returns safe action and outcome values'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002001', 'aal1');

select extensions.throws_ok(
  $$select * from public.list_admin_role_audit_events(25, null)$$,
  '42501'::character(5),
  null,
  'AAL1 admin cannot list audit events'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000002002', 'aal2');

select extensions.throws_ok(
  $$select * from public.list_admin_role_audit_events(25, null)$$,
  '42501'::character(5),
  null,
  'USER cannot list audit events'
);

reset role;

select extensions.throws_ok(
  $$update private.admin_role_audit_events set reason = reason$$,
  '55000'::character(5),
  'ADMIN_AUDIT_IMMUTABLE',
  'audit update is blocked'
);

select extensions.throws_ok(
  $$delete from private.admin_role_audit_events where false$$,
  '55000'::character(5),
  'ADMIN_AUDIT_IMMUTABLE',
  'audit delete is blocked'
);

select extensions.throws_ok(
  $$truncate private.admin_role_audit_events$$,
  '55000'::character(5),
  'ADMIN_AUDIT_IMMUTABLE',
  'audit truncate is blocked'
);

set local role anon;

select extensions.throws_ok(
  $$select * from public.grant_admin_role('00000000-0000-4000-8000-000000002003', '10000000-0000-4000-8000-000000000090', 'anon cannot grant')$$,
  '42501'::character(5),
  'permission denied for function grant_admin_role',
  'anon cannot execute grant command through SQL'
);

reset role;

select * from extensions.finish();

rollback;
