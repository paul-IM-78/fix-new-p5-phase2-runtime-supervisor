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
  'wallet_account_admin_audit_events',
  'wallet account audit table exists'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'wallet_account_admin_audit_events'
      and column_name in (
        'id',
        'command_id',
        'action',
        'outcome',
        'actor_user_id',
        'target_user_id',
        'wallet_account_id',
        'reason',
        'target_profile_status',
        'previous_status',
        'resulting_status',
        'previous_closed_at',
        'resulting_closed_at',
        'entity_version',
        'occurred_at'
      )
    group by table_schema, table_name
    having count(*) = 15
  ),
  'wallet account audit safe columns exist'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'wallet_account_admin_audit_events'
      and column_name in (
        'email',
        'password',
        'cookie',
        'token',
        'jwt',
        'mfa_secret',
        'balance',
        'amount',
        'address',
        'metadata'
      )
  ),
  'wallet account audit excludes credentials and financial columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.wallet_account_admin_audit_events'::regclass
      and conname in (
        'wallet_account_admin_audit_events_command_id_key',
        'wallet_account_admin_audit_events_action_check',
        'wallet_account_admin_audit_events_outcome_check',
        'wallet_account_admin_audit_events_reason_check',
        'wallet_account_admin_audit_events_outcome_status_check',
        'wallet_account_admin_audit_events_closed_at_check'
      )
    group by conrelid
    having count(*) = 6
  ),
  'wallet account audit constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'wallet_account_admin_audit_events'
      and indexname in (
        'wallet_account_admin_audit_events_occurred_at_idx',
        'wallet_account_admin_audit_events_actor_idx',
        'wallet_account_admin_audit_events_target_user_idx',
        'wallet_account_admin_audit_events_wallet_account_idx'
      )
    group by schemaname, tablename
    having count(*) = 4
  ),
  'wallet account audit indexes exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.wallet_account_admin_audit_events'::regclass
      and tgname = 'protect_wallet_account_admin_audit_events'
      and not tgisinternal
  ),
  'wallet account audit immutability trigger exists'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'transition_wallet_account_status',
        'list_admin_wallet_accounts',
        'list_wallet_account_admin_audit_events'
      )
  ) = 3,
  'wallet account command and read RPCs exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'transition_wallet_account_status',
        'list_admin_wallet_accounts',
        'list_wallet_account_admin_audit_events'
      )
      and not prosecdef
  ),
  'wallet account RPCs are security definer'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'transition_wallet_account_status',
        'list_admin_wallet_accounts',
        'list_wallet_account_admin_audit_events'
      )
      and coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
  ),
  'wallet account RPCs use empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.transition_wallet_account_status(uuid, bigint, text, uuid, text)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.transition_wallet_account_status(uuid, bigint, text, uuid, text)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.list_admin_wallet_accounts(integer)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.list_admin_wallet_accounts(integer)'::regprocedure,
      'execute'
    ),
  'wallet account RPC execute grants are authenticated-only'
);

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'private.wallet_account_admin_audit_events',
    'select'
  )
    and not has_table_privilege(
      'authenticated',
      'private.wallet_account_admin_audit_events',
      'insert'
    )
    and not has_table_privilege(
      'anon',
      'private.wallet_account_admin_audit_events',
      'select'
    ),
  'wallet account audit table direct access is blocked'
);

select extensions.ok(
  (
    select pg_get_functiondef(
      'public.transition_wallet_account_status(uuid, bigint, text, uuid, text)'::regprocedure
    ) like '%staking-wallet-web:wallet-account-command:v1%'
  ),
  'wallet account command uses advisory lock namespace'
);

select extensions.ok(
  exists (
    select 1
    from pg_description
    where objoid = 'private.wallet_account_admin_audit_events'::regclass
  )
    and exists (
      select 1
      from pg_description
      where objoid = 'private.prevent_wallet_account_admin_audit_mutation()'::regprocedure
    )
    and exists (
      select 1
      from pg_description
      where objoid = 'public.transition_wallet_account_status(uuid, bigint, text, uuid, text)'::regprocedure
    )
    and exists (
      select 1
      from pg_description
      where objoid = 'public.list_admin_wallet_accounts(integer)'::regprocedure
    )
    and exists (
      select 1
      from pg_description
      where objoid = 'public.list_wallet_account_admin_audit_events(integer, uuid)'::regprocedure
    ),
  'wallet account table and RPC comments exist'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000006001',
  'wallet-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000006002',
  'wallet-user@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000006003',
  'wallet-user-b@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000006004',
  'wallet-inactive-admin@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values
  ('00000000-0000-4000-8000-000000006001', 'ADMIN', 'local wallet command fixture'),
  ('00000000-0000-4000-8000-000000006004', 'ADMIN', 'local wallet command fixture');

update public.profiles
set account_status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000006004';

create temp table wallet_fixture as
select id, user_id, status, version
from public.wallet_accounts
where user_id = '00000000-0000-4000-8000-000000006002';

create temp table second_wallet_fixture as
select id, user_id, status, version
from public.wallet_accounts
where user_id = '00000000-0000-4000-8000-000000006003';

grant select on wallet_fixture to authenticated;
grant select on second_wallet_fixture to authenticated;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000006002', 'aal2');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      1,
      'FROZEN',
      '00000000-0000-4000-8000-000000006101',
      'blocked user command'
    );
    raise exception 'expected user denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'general USER cannot execute wallet status command'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.list_admin_wallet_accounts(10);
    raise exception 'expected user read denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'general USER cannot execute admin wallet read RPC'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update public.wallet_accounts
    set status = 'FROZEN'
    where id = (select id from wallet_fixture);
    raise exception 'expected wallet update denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'browser wallet direct update is blocked'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000006001', 'aal1');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      1,
      'FROZEN',
      '00000000-0000-4000-8000-000000006102',
      'blocked aal1 command'
    );
    raise exception 'expected aal1 denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'AAL1 ADMIN cannot execute wallet status command'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000006004', 'aal2');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      1,
      'FROZEN',
      '00000000-0000-4000-8000-000000006103',
      'blocked inactive admin command'
    );
    raise exception 'expected inactive admin denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'inactive AAL2 ADMIN cannot execute wallet status command'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000006001', 'aal2');

select extensions.is(
  (
    select count(*)::integer
    from public.list_admin_wallet_accounts(10)
  ),
  4,
  'AAL2 ADMIN can read wallet account list'
);

create temp table freeze_result as
select *
from public.transition_wallet_account_status(
  (select id from wallet_fixture),
  (select version from wallet_fixture),
  'FROZEN',
  '00000000-0000-4000-8000-000000006110',
  'freeze wallet account'
);

select extensions.is(
  (select result_code from freeze_result),
  'APPLIED',
  'ACTIVE to FROZEN is applied'
);

select extensions.is(
  (
    select version::integer
    from public.wallet_accounts
    where id = (select id from wallet_fixture)
  ),
  (select version::integer + 1 from wallet_fixture),
  'APPLIED increments wallet version exactly once'
);

select extensions.is(
  (
    select count(*)::integer
    from private.wallet_account_admin_audit_events
    where command_id = '00000000-0000-4000-8000-000000006110'
      and outcome = 'APPLIED'
      and previous_status = 'ACTIVE'
      and resulting_status = 'FROZEN'
  ),
  1,
  'wallet freeze audit recorded'
);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      (select version from wallet_fixture),
      'FROZEN',
      '00000000-0000-4000-8000-000000006110',
      'freeze wallet account'
    )
  ),
  'APPLIED',
  'wallet command replay returns original result'
);

select extensions.is(
  (
    select replayed
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      (select version from wallet_fixture),
      'FROZEN',
      '00000000-0000-4000-8000-000000006110',
      'freeze wallet account'
    )
  ),
  true,
  'wallet command replay is marked'
);

select extensions.is(
  (
    select count(*)::integer
    from private.wallet_account_admin_audit_events
    where command_id = '00000000-0000-4000-8000-000000006110'
  ),
  1,
  'wallet command replay does not duplicate audit'
);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      (select version from public.wallet_accounts where id = (select id from wallet_fixture)),
      'ACTIVE',
      '00000000-0000-4000-8000-000000006111',
      'reactivate wallet account'
    )
  ),
  'APPLIED',
  'FROZEN to ACTIVE is applied for ACTIVE profile'
);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      (select version from public.wallet_accounts where id = (select id from wallet_fixture)),
      'CLOSED',
      '00000000-0000-4000-8000-000000006112',
      'active close blocked'
    )
  ),
  'WALLET_ACCOUNT_TRANSITION_INVALID',
  'ACTIVE to CLOSED is blocked'
);

select public.transition_wallet_account_status(
  (select id from wallet_fixture),
  (select version from public.wallet_accounts where id = (select id from wallet_fixture)),
  'FROZEN',
  '00000000-0000-4000-8000-000000006113',
  'freeze before profile check'
);

update public.profiles
set account_status = 'RESTRICTED'
where id = (select user_id from wallet_fixture);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      (select version from public.wallet_accounts where id = (select id from wallet_fixture)),
      'ACTIVE',
      '00000000-0000-4000-8000-000000006114',
      'inactive profile active blocked'
    )
  ),
  'TARGET_PROFILE_INACTIVE',
  'FROZEN to ACTIVE is blocked for inactive profile'
);

select extensions.is(
  (
    select status
    from public.wallet_accounts
    where id = (select id from wallet_fixture)
  ),
  'FROZEN',
  'profile restriction does not auto-change wallet state'
);

select extensions.is(
  (
    select count(*)::integer
    from private.wallet_account_admin_audit_events
    where command_id = '00000000-0000-4000-8000-000000006114'
  ),
  0,
  'inactive profile block creates no audit'
);

update public.profiles
set account_status = 'ACTIVE'
where id = (select user_id from wallet_fixture);

select public.transition_wallet_account_status(
  (select id from wallet_fixture),
  (select version from public.wallet_accounts where id = (select id from wallet_fixture)),
  'ACTIVE',
  '00000000-0000-4000-8000-000000006115',
  'restore active wallet'
);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      1,
      'FROZEN',
      '00000000-0000-4000-8000-000000006116',
      'stale wallet version'
    )
  ),
  'WALLET_ACCOUNT_VERSION_CONFLICT',
  'stale expected version is blocked'
);

select public.transition_wallet_account_status(
  (select id from wallet_fixture),
  (select version from public.wallet_accounts where id = (select id from wallet_fixture)),
  'FROZEN',
  '00000000-0000-4000-8000-000000006117',
  'freeze before close'
);

create temp table closed_version_before as
select version
from public.wallet_accounts
where id = (select id from wallet_fixture);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      (select version from closed_version_before),
      'CLOSED',
      '00000000-0000-4000-8000-000000006118',
      'close wallet account'
    )
  ),
  'APPLIED',
  'FROZEN to CLOSED is applied'
);

select extensions.ok(
  (
    select closed_at is not null
    from public.wallet_accounts
    where id = (select id from wallet_fixture)
  ),
  'CLOSED wallet has closed_at'
);

create temp table closed_wallet_state as
select version, closed_at
from public.wallet_accounts
where id = (select id from wallet_fixture);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      (select version from closed_wallet_state),
      'CLOSED',
      '00000000-0000-4000-8000-000000006119',
      'closed noop'
    )
  ),
  'NOOP',
  'CLOSED to CLOSED is NOOP'
);

select extensions.is(
  (
    select version::integer
    from public.wallet_accounts
    where id = (select id from wallet_fixture)
  ),
  (select version::integer from closed_wallet_state),
  'NOOP does not increment wallet version'
);

select extensions.is(
  (
    select closed_at
    from public.wallet_accounts
    where id = (select id from wallet_fixture)
  ),
  (select closed_at from closed_wallet_state),
  'CLOSED NOOP preserves closed_at'
);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      (select version from closed_wallet_state),
      'ACTIVE',
      '00000000-0000-4000-8000-000000006120',
      'closed active blocked'
    )
  ),
  'WALLET_ACCOUNT_TRANSITION_INVALID',
  'CLOSED to ACTIVE is blocked'
);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from wallet_fixture),
      (select version from closed_wallet_state),
      'FROZEN',
      '00000000-0000-4000-8000-000000006121',
      'closed frozen blocked'
    )
  ),
  'WALLET_ACCOUNT_TRANSITION_INVALID',
  'CLOSED to FROZEN is blocked'
);

select public.transition_wallet_account_status(
  (select id from second_wallet_fixture),
  (select version from second_wallet_fixture),
  'FROZEN',
  '00000000-0000-4000-8000-000000006122',
  'freeze second wallet'
);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from second_wallet_fixture),
      (select version from second_wallet_fixture),
      'ACTIVE',
      '00000000-0000-4000-8000-000000006122',
      'different replay data'
    )
  ),
  'COMMAND_ID_CONFLICT',
  'same command id with different request conflicts'
);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      '00000000-0000-4000-8000-000000006999',
      1,
      'FROZEN',
      '00000000-0000-4000-8000-000000006123',
      'missing wallet'
    )
  ),
  'WALLET_ACCOUNT_NOT_FOUND',
  'missing wallet returns safe code'
);

select extensions.is(
  (
    select result_code
    from public.transition_wallet_account_status(
      (select id from second_wallet_fixture),
      (select version from public.wallet_accounts where id = (select id from second_wallet_fixture)),
      'BROKEN',
      '00000000-0000-4000-8000-000000006124',
      'bad status'
    )
  ),
  'INVALID_INPUT',
  'invalid wallet status is rejected'
);

select extensions.is(
  (
    select count(*)::integer
    from public.list_wallet_account_admin_audit_events(50)
  ),
  (
    select count(*)::integer
    from private.wallet_account_admin_audit_events
  ),
  'AAL2 ADMIN can read wallet audit through RPC'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000006002', 'aal2');
set local role authenticated;

select extensions.is(
  (
    select count(*)::integer
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000006002'
  ),
  1,
  'ACTIVE profile can read own CLOSED wallet'
);

select extensions.is(
  (
    select count(*)::integer
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000006003'
  ),
  0,
  'ACTIVE profile cannot read another wallet'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.wallet_accounts (user_id)
    values ('00000000-0000-4000-8000-000000006002');
    raise exception 'expected wallet insert denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'browser wallet direct insert is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    delete from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000006002';
    raise exception 'expected wallet delete denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'browser wallet direct delete is blocked'
);

reset role;

insert into public.projects (
  id,
  project_code,
  display_name,
  status
)
values (
  '00000000-0000-4000-8000-000000006201',
  'WALLET_ACTIVE_PROJECT',
  'Wallet Active Project',
  'ACTIVE'
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
  '00000000-0000-4000-8000-000000006202',
  'WALLET_ACTIVE_ASSET',
  'WAT',
  'Wallet Active Asset',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111131',
  'ACTIVE'
);

insert into public.project_token_assignments (
  id,
  project_id,
  asset_id
)
values (
  '00000000-0000-4000-8000-000000006203',
  '00000000-0000-4000-8000-000000006201',
  '00000000-0000-4000-8000-000000006202'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000006002', 'aal2');
set local role authenticated;

select extensions.is(
  (select count(*)::integer from public.projects),
  1,
  'ACTIVE profile can read active project catalog'
);

select extensions.is(
  (select count(*)::integer from public.supported_assets),
  1,
  'ACTIVE profile can read active asset catalog'
);

select extensions.is(
  (select count(*)::integer from public.project_token_assignments),
  1,
  'ACTIVE profile can read current active assignment catalog'
);

reset role;

update public.profiles
set account_status = 'WITHDRAWN'
where id = '00000000-0000-4000-8000-000000006002';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000006002', 'aal2');
set local role authenticated;

select extensions.is(
  (select count(*)::integer from public.projects),
  0,
  'inactive profile reads zero project catalog rows'
);

select extensions.is(
  (select count(*)::integer from public.supported_assets),
  0,
  'inactive profile reads zero asset catalog rows'
);

select extensions.is(
  (select count(*)::integer from public.project_token_assignments),
  0,
  'inactive profile reads zero assignment catalog rows'
);

select extensions.is(
  (select count(*)::integer from public.wallet_accounts),
  0,
  'inactive profile reads zero own wallet rows'
);

reset role;

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.wallet_account_admin_audit_events
    set reason = 'blocked';
    raise exception 'expected audit update denial';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'wallet audit update is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    delete from private.wallet_account_admin_audit_events;
    raise exception 'expected audit delete denial';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'wallet audit delete is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    truncate private.wallet_account_admin_audit_events;
    raise exception 'expected audit truncate denial';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'wallet audit truncate is blocked'
);

select * from extensions.finish();

rollback;
