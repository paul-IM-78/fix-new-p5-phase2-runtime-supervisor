begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

create function pg_temp.insert_auth_user(
  test_user_id uuid,
  test_email text,
  test_metadata jsonb default '{}'::jsonb
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
    '{"provider":"email","providers":["email"]}'::jsonb,
    coalesce(test_metadata, '{}'::jsonb),
    now(),
    now()
  );
$$;

select extensions.has_table('public', 'profiles', 'public.profiles exists');
select extensions.has_table('public', 'user_roles', 'public.user_roles exists');

select extensions.has_column('public', 'profiles', 'id', 'profiles.id exists');
select extensions.has_column('public', 'profiles', 'display_name', 'profiles.display_name exists');
select extensions.has_column('public', 'profiles', 'account_status', 'profiles.account_status exists');
select extensions.has_column('public', 'profiles', 'terms_version', 'profiles.terms_version exists');
select extensions.has_column('public', 'profiles', 'terms_accepted_at', 'profiles.terms_accepted_at exists');
select extensions.has_column('public', 'profiles', 'version', 'profiles.version exists');
select extensions.has_column('public', 'profiles', 'created_at', 'profiles.created_at exists');
select extensions.has_column('public', 'profiles', 'updated_at', 'profiles.updated_at exists');

select extensions.has_column('public', 'user_roles', 'id', 'user_roles.id exists');
select extensions.has_column('public', 'user_roles', 'user_id', 'user_roles.user_id exists');
select extensions.has_column('public', 'user_roles', 'role', 'user_roles.role exists');
select extensions.has_column('public', 'user_roles', 'granted_by', 'user_roles.granted_by exists');
select extensions.has_column('public', 'user_roles', 'granted_at', 'user_roles.granted_at exists');
select extensions.has_column('public', 'user_roles', 'grant_reason', 'user_roles.grant_reason exists');
select extensions.has_column('public', 'user_roles', 'revoked_by', 'user_roles.revoked_by exists');
select extensions.has_column('public', 'user_roles', 'revoked_at', 'user_roles.revoked_at exists');
select extensions.has_column('public', 'user_roles', 'revoke_reason', 'user_roles.revoke_reason exists');
select extensions.has_column('public', 'user_roles', 'version', 'user_roles.version exists');
select extensions.has_column('public', 'user_roles', 'created_at', 'user_roles.created_at exists');

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'p'
  ),
  'profiles primary key exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_roles'::regclass
      and contype = 'p'
  ),
  'user_roles primary key exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and confdeltype = 'r'
  ),
  'profiles references auth.users with ON DELETE RESTRICT'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_roles'::regclass
      and contype = 'f'
      and confrelid = 'public.profiles'::regclass
      and confdeltype = 'r'
  ),
  'user_roles references profiles with ON DELETE RESTRICT'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'profiles_account_status_check'
      and conrelid = 'public.profiles'::regclass
      and contype = 'c'
  ),
  'profiles account status check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'profiles_display_name_check'
      and conrelid = 'public.profiles'::regclass
      and contype = 'c'
  ),
  'profiles display name check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'profiles_terms_pair_check'
      and conrelid = 'public.profiles'::regclass
      and contype = 'c'
  ),
  'profiles terms pair check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'profiles_version_check'
      and conrelid = 'public.profiles'::regclass
      and contype = 'c'
  ),
  'profiles version check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'user_roles_role_check'
      and conrelid = 'public.user_roles'::regclass
      and contype = 'c'
  ),
  'user_roles role check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'user_roles_version_check'
      and conrelid = 'public.user_roles'::regclass
      and contype = 'c'
  ),
  'user_roles version check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'user_roles_grant_reason_length_check'
      and conrelid = 'public.user_roles'::regclass
      and contype = 'c'
  ),
  'user_roles grant reason length check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'user_roles_revoke_reason_length_check'
      and conrelid = 'public.user_roles'::regclass
      and contype = 'c'
  ),
  'user_roles revoke reason length check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'user_roles_revoke_details_check'
      and conrelid = 'public.user_roles'::regclass
      and contype = 'c'
  ),
  'user_roles revoke details check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'user_roles_revoked_at_check'
      and conrelid = 'public.user_roles'::regclass
      and contype = 'c'
  ),
  'user_roles revoked_at check exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'user_roles'
      and indexname = 'user_roles_active_role_uidx'
      and indexdef ilike '%WHERE (revoked_at IS NULL)%'
  ),
  'active user role partial unique index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'user_roles'
      and indexname = 'user_roles_user_id_idx'
  ),
  'user_roles user_id index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'user_roles'
      and indexname = 'user_roles_granted_by_idx'
  ),
  'user_roles granted_by index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'user_roles'
      and indexname = 'user_roles_revoked_by_idx'
  ),
  'user_roles revoked_by index exists'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles RLS enabled'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.user_roles'::regclass),
  'user_roles RLS enabled'
);

select extensions.ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_select_own'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  ),
  'profiles own select policy exists'
);

select extensions.ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'profiles has no write policy'
);

select extensions.ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_roles'
  ),
  'user_roles has no browser policy'
);

select extensions.ok(
  has_table_privilege('authenticated', 'public.profiles', 'select'),
  'authenticated has profile select grant'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anon has no profile select grant'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.profiles', 'insert'),
  'authenticated has no profile insert grant'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.profiles', 'update'),
  'authenticated has no profile update grant'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.profiles', 'delete'),
  'authenticated has no profile delete grant'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.user_roles', 'select'),
  'authenticated has no user_roles select grant'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.user_roles', 'select'),
  'anon has no user_roles select grant'
);

select extensions.ok(
  (select prosecdef from pg_proc where oid = 'private.ensure_auth_user_provisioned(uuid)'::regprocedure),
  'ensure_auth_user_provisioned is security definer'
);

select extensions.ok(
  (select prosecdef from pg_proc where oid = 'private.handle_auth_user_created()'::regprocedure),
  'handle_auth_user_created is security definer'
);

select extensions.ok(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'private.ensure_auth_user_provisioned(uuid)'::regprocedure)
    in ('search_path=', 'search_path=""'),
  'ensure_auth_user_provisioned has empty search_path'
);

select extensions.ok(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'private.handle_auth_user_created()'::regprocedure)
    in ('search_path=', 'search_path=""'),
  'handle_auth_user_created has empty search_path'
);

select extensions.ok(
  not has_function_privilege('public', 'private.ensure_auth_user_provisioned(uuid)'::regprocedure, 'execute'),
  'PUBLIC cannot execute ensure_auth_user_provisioned'
);

select extensions.ok(
  not has_function_privilege('anon', 'private.ensure_auth_user_provisioned(uuid)'::regprocedure, 'execute'),
  'anon cannot execute ensure_auth_user_provisioned'
);

select extensions.ok(
  not has_function_privilege('authenticated', 'private.ensure_auth_user_provisioned(uuid)'::regprocedure, 'execute'),
  'authenticated cannot execute ensure_auth_user_provisioned'
);

select extensions.ok(
  not has_function_privilege('public', 'private.handle_auth_user_created()'::regprocedure, 'execute'),
  'PUBLIC cannot execute handle_auth_user_created'
);

select extensions.ok(
  not has_function_privilege('anon', 'private.handle_auth_user_created()'::regprocedure, 'execute'),
  'anon cannot execute handle_auth_user_created'
);

select extensions.ok(
  not has_function_privilege('authenticated', 'private.handle_auth_user_created()'::regprocedure, 'execute'),
  'authenticated cannot execute handle_auth_user_created'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
  ),
  'auth user created trigger exists'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000000001',
  'user-a@example.test',
  '{}'::jsonb
);

select extensions.is(
  (select count(*)::integer from public.profiles where id = '00000000-0000-4000-8000-000000000001'),
  1,
  'trigger creates profile'
);

select extensions.is(
  (select account_status from public.profiles where id = '00000000-0000-4000-8000-000000000001'),
  'ACTIVE',
  'trigger creates active profile'
);

select extensions.is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = '00000000-0000-4000-8000-000000000001'
      and role = 'USER'
      and revoked_at is null
  ),
  1,
  'trigger creates one active USER role'
);

select extensions.is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = '00000000-0000-4000-8000-000000000001'
      and role = 'ADMIN'
      and revoked_at is null
  ),
  0,
  'trigger does not create ADMIN role'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000000002',
  'metadata-admin@example.test',
  '{
    "display_name": "QA User",
    "role": "ADMIN",
    "is_admin": true,
    "account_status": "SUSPENDED"
  }'::jsonb
);

select extensions.is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-000000000002'),
  'QA User',
  'metadata display_name is copied as non-authority text'
);

select extensions.is(
  (select account_status from public.profiles where id = '00000000-0000-4000-8000-000000000002'),
  'ACTIVE',
  'metadata cannot override account_status'
);

select extensions.is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = '00000000-0000-4000-8000-000000000002'
      and role = 'USER'
      and revoked_at is null
  ),
  1,
  'metadata user receives one USER role'
);

select extensions.is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = '00000000-0000-4000-8000-000000000002'
      and role = 'ADMIN'
      and revoked_at is null
  ),
  0,
  'metadata cannot create ADMIN role'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000000003',
  'blank-display@example.test',
  '{"display_name": ""}'::jsonb
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000000004',
  'space-display@example.test',
  '{"display_name": "   "}'::jsonb
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000000005',
  'long-display@example.test',
  jsonb_build_object('display_name', repeat('A', 81))
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000000006',
  'control-display@example.test',
  jsonb_build_object('display_name', E'QA\nUser')
);

select extensions.is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-000000000003'),
  null,
  'blank display_name is stored as null'
);

select extensions.is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-000000000004'),
  null,
  'space-only display_name is stored as null'
);

select extensions.is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-000000000005'),
  null,
  'overlong display_name is stored as null'
);

select extensions.is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-000000000006'),
  null,
  'control-character display_name is stored as null'
);

select private.ensure_auth_user_provisioned('00000000-0000-4000-8000-000000000001');
select private.ensure_auth_user_provisioned('00000000-0000-4000-8000-000000000001');

select extensions.is(
  (select count(*)::integer from public.profiles where id = '00000000-0000-4000-8000-000000000001'),
  1,
  'provisioning is idempotent for profiles'
);

select extensions.is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = '00000000-0000-4000-8000-000000000001'
      and role = 'USER'
      and revoked_at is null
  ),
  1,
  'provisioning is idempotent for active USER role'
);

select extensions.is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id = '00000000-0000-4000-8000-000000000001'
      and role = 'ADMIN'
      and revoked_at is null
  ),
  0,
  'provisioning remains free of active ADMIN role'
);

select extensions.throws_ok(
  $$select private.ensure_auth_user_provisioned('00000000-0000-4000-8000-000000009999')$$,
  '23503'::character(5),
  'auth user not found',
  'missing auth user fails safely'
);

select extensions.throws_ok(
  $$insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-000000000001', 'USER')$$,
  '23505'::character(5),
  'duplicate key value violates unique constraint "user_roles_active_role_uidx"',
  'duplicate active USER role is blocked'
);

select extensions.throws_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-000000000001'$$,
  '23503'::character(5),
  'update or delete on table "users" violates foreign key constraint "profiles_id_fkey" on table "profiles"',
  'profile FK restricts auth user hard delete'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

select extensions.is(
  (select count(*)::integer from public.profiles),
  1,
  'authenticated user sees only own profile'
);

select extensions.is(
  (
    select count(*)::integer
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000002'
  ),
  0,
  'authenticated user cannot select another profile'
);

select extensions.throws_ok(
  $$insert into public.profiles (id) values ('00000000-0000-4000-8000-000000000010')$$,
  '42501'::character(5),
  'permission denied for table profiles',
  'authenticated user cannot insert profiles'
);

select extensions.throws_ok(
  $$update public.profiles set display_name = 'Changed' where id = '00000000-0000-4000-8000-000000000001'$$,
  '42501'::character(5),
  'permission denied for table profiles',
  'authenticated user cannot update profiles'
);

select extensions.throws_ok(
  $$delete from public.profiles where id = '00000000-0000-4000-8000-000000000001'$$,
  '42501'::character(5),
  'permission denied for table profiles',
  'authenticated user cannot delete profiles'
);

select extensions.throws_ok(
  $$select count(*) from public.user_roles$$,
  '42501'::character(5),
  'permission denied for table user_roles',
  'authenticated user cannot select user_roles'
);

reset role;

set local role anon;

select extensions.throws_ok(
  $$select count(*) from public.profiles$$,
  '42501'::character(5),
  'permission denied for table profiles',
  'anon cannot select profiles'
);

select extensions.throws_ok(
  $$select count(*) from public.user_roles$$,
  '42501'::character(5),
  'permission denied for table user_roles',
  'anon cannot select user_roles'
);

reset role;

select * from extensions.finish();

rollback;
