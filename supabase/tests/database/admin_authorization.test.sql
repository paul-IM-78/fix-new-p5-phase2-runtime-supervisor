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
  exists (
    select 1
    from pg_proc
    where oid = 'public.is_current_user_admin()'::regprocedure
      and pronargs = 0
  ),
  'is_current_user_admin exists with no arguments'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc
    where oid = 'public.is_current_user_admin_aal2()'::regprocedure
      and pronargs = 0
  ),
  'is_current_user_admin_aal2 exists with no arguments'
);

select extensions.ok(
  (
    select prorettype
    from pg_proc
    where oid = 'public.is_current_user_admin()'::regprocedure
  ) = 'boolean'::regtype,
  'is_current_user_admin returns boolean'
);

select extensions.ok(
  (
    select prorettype
    from pg_proc
    where oid = 'public.is_current_user_admin_aal2()'::regprocedure
  ) = 'boolean'::regtype,
  'is_current_user_admin_aal2 returns boolean'
);

select extensions.ok(
  (select prosecdef from pg_proc where oid = 'public.is_current_user_admin()'::regprocedure),
  'is_current_user_admin is security definer'
);

select extensions.ok(
  (select prosecdef from pg_proc where oid = 'public.is_current_user_admin_aal2()'::regprocedure),
  'is_current_user_admin_aal2 is security definer'
);

select extensions.ok(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.is_current_user_admin()'::regprocedure)
    in ('search_path=', 'search_path=""'),
  'is_current_user_admin has empty search_path'
);

select extensions.ok(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'public.is_current_user_admin_aal2()'::regprocedure)
    in ('search_path=', 'search_path=""'),
  'is_current_user_admin_aal2 has empty search_path'
);

select extensions.ok(
  obj_description('public.is_current_user_admin()'::regprocedure, 'pg_proc') is not null,
  'is_current_user_admin has comment'
);

select extensions.ok(
  obj_description('public.is_current_user_admin_aal2()'::regprocedure, 'pg_proc') is not null,
  'is_current_user_admin_aal2 has comment'
);

select extensions.ok(
  not has_function_privilege('public', 'public.is_current_user_admin()'::regprocedure, 'execute'),
  'PUBLIC cannot execute is_current_user_admin'
);

select extensions.ok(
  not has_function_privilege('anon', 'public.is_current_user_admin()'::regprocedure, 'execute'),
  'anon cannot execute is_current_user_admin'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.is_current_user_admin()'::regprocedure, 'execute'),
  'authenticated can execute is_current_user_admin'
);

select extensions.ok(
  not has_function_privilege('public', 'public.is_current_user_admin_aal2()'::regprocedure, 'execute'),
  'PUBLIC cannot execute is_current_user_admin_aal2'
);

select extensions.ok(
  not has_function_privilege('anon', 'public.is_current_user_admin_aal2()'::regprocedure, 'execute'),
  'anon cannot execute is_current_user_admin_aal2'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.is_current_user_admin_aal2()'::regprocedure, 'execute'),
  'authenticated can execute is_current_user_admin_aal2'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.user_roles', 'select'),
  'authenticated still cannot select user_roles'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.user_roles', 'select'),
  'anon still cannot select user_roles'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('is_current_user_admin', 'is_current_user_admin_aal2')
      and pronargs <> 0
  ),
  'admin authorization functions have no user-id overloads'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000001001',
  'active-user-admin-test@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000001002',
  'active-admin-admin-test@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000001002',
  'ADMIN',
  'local pgTAP admin fixture'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000001003',
  'revoked-admin-admin-test@example.test'
);

insert into public.user_roles (
  user_id,
  role,
  grant_reason,
  revoked_at,
  revoke_reason
)
values (
  '00000000-0000-4000-8000-000000001003',
  'ADMIN',
  'local pgTAP revoked admin fixture',
  now(),
  'local pgTAP revoke'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000001004',
  'restricted-admin-admin-test@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000001004',
  'ADMIN',
  'local pgTAP restricted admin fixture'
);

update public.profiles
set account_status = 'RESTRICTED'
where id = '00000000-0000-4000-8000-000000001004';

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000001005',
  'suspended-admin-admin-test@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000001005',
  'ADMIN',
  'local pgTAP suspended admin fixture'
);

update public.profiles
set account_status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000001005';

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000001006',
  'withdrawn-admin-admin-test@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000001006',
  'ADMIN',
  'local pgTAP withdrawn admin fixture'
);

update public.profiles
set account_status = 'WITHDRAWN'
where id = '00000000-0000-4000-8000-000000001006';

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000001007',
  'missing-profile-admin-test@example.test'
);

delete from public.user_roles
where user_id = '00000000-0000-4000-8000-000000001007';

delete from public.profiles
where id = '00000000-0000-4000-8000-000000001007';

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000001008',
  'metadata-admin-admin-test@example.test',
  '{"role":"ADMIN","is_admin":true}'::jsonb,
  '{"role":"ADMIN","is_admin":true}'::jsonb
);

set local role authenticated;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001001', 'aal1');

select extensions.is(
  public.is_current_user_admin(),
  false,
  'active USER is not admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001002', 'aal1');

select extensions.is(
  public.is_current_user_admin(),
  true,
  'active ADMIN is admin'
);

select extensions.is(
  public.is_current_user_admin_aal2(),
  false,
  'active ADMIN with aal1 is not admin aal2'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001002');

select extensions.is(
  public.is_current_user_admin_aal2(),
  false,
  'active ADMIN without aal claim is not admin aal2'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001002', 'aal2');

select extensions.is(
  public.is_current_user_admin_aal2(),
  true,
  'active ADMIN with aal2 is admin aal2'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001001', 'aal2');

select extensions.is(
  public.is_current_user_admin_aal2(),
  false,
  'active USER with aal2 is not admin aal2'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001003', 'aal2');

select extensions.is(
  public.is_current_user_admin(),
  false,
  'revoked ADMIN is not admin'
);

select extensions.is(
  public.is_current_user_admin_aal2(),
  false,
  'revoked ADMIN with aal2 is not admin aal2'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001004', 'aal2');

select extensions.is(
  public.is_current_user_admin(),
  false,
  'restricted ADMIN is not admin'
);

select extensions.is(
  public.is_current_user_admin_aal2(),
  false,
  'restricted ADMIN with aal2 is not admin aal2'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001005', 'aal2');

select extensions.is(
  public.is_current_user_admin(),
  false,
  'suspended ADMIN is not admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001006', 'aal2');

select extensions.is(
  public.is_current_user_admin(),
  false,
  'withdrawn ADMIN is not admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001007', 'aal2');

select extensions.is(
  public.is_current_user_admin(),
  false,
  'missing profile is not admin'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000001008', 'aal2');

select extensions.is(
  public.is_current_user_admin(),
  false,
  'metadata ADMIN without role row is not admin'
);

select extensions.throws_ok(
  $$select count(*) from public.user_roles$$,
  '42501'::character(5),
  'permission denied for table user_roles',
  'function does not grant direct user_roles visibility'
);

reset role;

select extensions.is(
  public.is_current_user_admin(),
  false,
  'no auth context returns false for admin function'
);

set local role anon;

select extensions.throws_ok(
  $$select public.is_current_user_admin()$$,
  '42501'::character(5),
  'permission denied for function is_current_user_admin',
  'anon cannot execute admin function'
);

select extensions.throws_ok(
  $$select public.is_current_user_admin_aal2()$$,
  '42501'::character(5),
  'permission denied for function is_current_user_admin_aal2',
  'anon cannot execute admin aal2 function'
);

reset role;

select * from extensions.finish();

rollback;
