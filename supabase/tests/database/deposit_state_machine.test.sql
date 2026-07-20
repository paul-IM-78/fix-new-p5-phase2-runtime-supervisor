begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

create function pg_temp.insert_auth_user(
  test_user_id uuid,
  test_email text
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
    '{}'::jsonb,
    now(),
    now()
  );
$$;

create function pg_temp.set_auth_context(
  test_user_id uuid,
  test_aal text default 'aal2'
)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', test_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', test_user_id::text, 'aal', test_aal)::text,
    true
  );
end;
$$;

select extensions.has_table(
  'private',
  'deposit_requests',
  'deposit request table exists'
);

select extensions.has_table(
  'private',
  'deposit_command_audit_events',
  'deposit audit table exists'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'deposit_requests'
      and column_name in (
        'id',
        'wallet_account_id',
        'asset_id',
        'requested_units',
        'status',
        'request_journal_id',
        'confirmation_journal_id',
        'cancellation_journal_id',
        'confirmed_by',
        'canceled_by',
        'cancellation_actor_type',
        'requested_at',
        'confirmed_at',
        'canceled_at',
        'version',
        'created_at',
        'updated_at'
      )
    group by table_schema, table_name
    having count(*) = 17
  ),
  'deposit request safe columns exist'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name in ('deposit_requests', 'deposit_command_audit_events')
      and column_name in (
        'email',
        'password',
        'cookie',
        'token',
        'jwt',
        'mfa_secret',
        'totp_code',
        'private_key',
        'wallet_address',
        'deposit_address',
        'transaction_id',
        'signature',
        'metadata'
      )
  ),
  'deposit tables exclude credential and blockchain columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.deposit_requests'::regclass
      and conname in (
        'deposit_requests_status_check',
        'deposit_requests_cancellation_actor_type_check',
        'deposit_requests_version_check',
        'deposit_requests_time_check',
        'deposit_requests_status_shape_check'
      )
    group by conrelid
    having count(*) = 5
  ),
  'deposit request state constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.deposit_requests'::regclass
      and tgname in (
        'touch_deposit_requests_version',
        'validate_deposit_request_transition',
        'validate_deposit_request_invariants'
      )
      and not tgisinternal
    group by tgrelid
    having count(*) = 3
  ),
  'deposit request version, transition, and invariant triggers exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.deposit_command_audit_events'::regclass
      and tgname = 'protect_deposit_command_audit_events'
      and not tgisinternal
  ),
  'deposit audit immutability trigger exists'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_user_funding_request',
        'cancel_current_user_funding_request',
        'confirm_user_funding_request',
        'admin_cancel_user_funding_request',
        'list_current_user_deposit_requests',
        'list_admin_deposit_requests',
        'list_deposit_command_audit_events'
      )
  ) = 7,
  'deposit command and read RPCs exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_user_funding_request',
        'cancel_current_user_funding_request',
        'confirm_user_funding_request',
        'admin_cancel_user_funding_request',
        'list_current_user_deposit_requests',
        'list_admin_deposit_requests',
        'list_deposit_command_audit_events'
      )
      and not prosecdef
  ),
  'deposit public RPCs are security definer'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_user_funding_request',
        'cancel_current_user_funding_request',
        'confirm_user_funding_request',
        'admin_cancel_user_funding_request',
        'list_current_user_deposit_requests',
        'list_admin_deposit_requests',
        'list_deposit_command_audit_events'
      )
      and coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
  ),
  'deposit public RPCs use empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.create_user_funding_request(uuid, bigint, uuid, bigint, text, uuid)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.cancel_current_user_funding_request(uuid, bigint, uuid)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.confirm_user_funding_request(uuid, bigint, uuid, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_cancel_user_funding_request(uuid, bigint, uuid, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_current_user_deposit_requests(integer)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_admin_deposit_requests(integer, uuid)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_deposit_command_audit_events(integer, uuid)'::regprocedure,
    'execute'
  ),
  'authenticated can execute deposit RPCs'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.create_user_funding_request(uuid, bigint, uuid, bigint, text, uuid)'::regprocedure,
    'execute'
  )
  and not has_function_privilege(
    'public',
    'public.admin_cancel_user_funding_request(uuid, bigint, uuid, text)'::regprocedure,
    'execute'
  )
  and not has_table_privilege('authenticated', 'private.deposit_requests', 'select')
  and not has_table_privilege('authenticated', 'private.deposit_requests', 'insert')
  and not has_table_privilege('authenticated', 'private.deposit_requests', 'update')
  and not has_table_privilege('authenticated', 'private.deposit_requests', 'delete')
  and not has_table_privilege('authenticated', 'private.deposit_command_audit_events', 'select')
  and not has_table_privilege('authenticated', 'private.deposit_command_audit_events', 'insert')
  and not has_table_privilege('authenticated', 'private.deposit_command_audit_events', 'update')
  and not has_table_privilege('authenticated', 'private.deposit_command_audit_events', 'delete'),
  'anon/public and browser direct table access are blocked'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000100001',
  'deposit-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000100002',
  'deposit-user@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000100003',
  'deposit-other@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000100001',
  'ADMIN',
  'deposit state machine test admin'
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
  '00000000-0000-4000-8000-000000100101',
  'DEPOSIT_TEST_A',
  'DPA',
  'Deposit Test Asset A',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111141',
  'ACTIVE'
);

create temporary table pg_temp.deposit_fixture as
select
  wallet_accounts.id as wallet_id,
  wallet_accounts.user_id,
  wallet_accounts.version as wallet_version,
  supported_assets.id as asset_id,
  supported_assets.version as asset_version
from public.wallet_accounts
cross join public.supported_assets
where wallet_accounts.user_id = '00000000-0000-4000-8000-000000100002'
  and supported_assets.id = '00000000-0000-4000-8000-000000100101';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000100002', 'aal2');

create temporary table pg_temp.invalid_deposit_results as
select result_code
from public.create_user_funding_request(
  (select wallet_id from pg_temp.deposit_fixture),
  0,
  (select asset_id from pg_temp.deposit_fixture),
  (select asset_version from pg_temp.deposit_fixture),
  '1',
  '00000000-0000-4000-8000-000000100110'
)
union all
select result_code
from public.create_user_funding_request(
  (select wallet_id from pg_temp.deposit_fixture),
  (select wallet_version from pg_temp.deposit_fixture),
  (select asset_id from pg_temp.deposit_fixture),
  (select asset_version from pg_temp.deposit_fixture),
  '0',
  '00000000-0000-4000-8000-000000100111'
)
union all
select result_code
from public.create_user_funding_request(
  (select wallet_id from pg_temp.deposit_fixture),
  (select wallet_version from pg_temp.deposit_fixture),
  (select asset_id from pg_temp.deposit_fixture),
  (select asset_version from pg_temp.deposit_fixture),
  '01',
  '00000000-0000-4000-8000-000000100112'
)
union all
select result_code
from public.create_user_funding_request(
  (select wallet_id from pg_temp.deposit_fixture),
  (select wallet_version from pg_temp.deposit_fixture),
  (select asset_id from pg_temp.deposit_fixture),
  (select asset_version from pg_temp.deposit_fixture),
  '1e9',
  '00000000-0000-4000-8000-000000100113'
);

select extensions.is(
  (select count(*)::integer from pg_temp.invalid_deposit_results where result_code = 'INVALID_INPUT'),
  4,
  'deposit request rejects invalid versions and unit strings'
);

select extensions.is(
  (select count(*)::integer from private.deposit_command_audit_events),
  0,
  'invalid deposit request creates no audit'
);

create temporary table pg_temp.deposit_request_result as
select *
from public.create_user_funding_request(
  (select wallet_id from pg_temp.deposit_fixture),
  (select wallet_version from pg_temp.deposit_fixture),
  (select asset_id from pg_temp.deposit_fixture),
  (select asset_version from pg_temp.deposit_fixture),
  '100',
  '00000000-0000-4000-8000-000000100120'
);

select extensions.is(
  (select result_code from pg_temp.deposit_request_result),
  'APPLIED',
  'deposit request applies'
);

select extensions.is(
  (select status from pg_temp.deposit_request_result),
  'REQUESTED',
  'deposit request starts requested'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries
    where journal_id = (select journal_id from pg_temp.deposit_request_result)
  ),
  2,
  'deposit request creates two ledger entries'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.deposit_request_result)
      and entries.side = 'DEBIT'
      and entries.units = 100
      and accounts.account_purpose = 'SYSTEM_DEPOSIT_CLEARING'
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.deposit_request_result)
      and entries.side = 'CREDIT'
      and entries.units = 100
      and accounts.account_purpose = 'USER_PENDING_DEPOSIT'
  ),
  'deposit request posts clearing debit and pending deposit credit'
);

select extensions.ok(
  (
    select pending_deposit_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.deposit_fixture)
      and asset_id = (select asset_id from pg_temp.deposit_fixture)
  ) = '100'
  and (
    select available_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.deposit_fixture)
      and asset_id = (select asset_id from pg_temp.deposit_fixture)
  ) = '0',
  'deposit request increases pending only'
);

create temporary table pg_temp.deposit_request_replay as
select *
from public.create_user_funding_request(
  (select wallet_id from pg_temp.deposit_fixture),
  (select wallet_version from pg_temp.deposit_fixture),
  (select asset_id from pg_temp.deposit_fixture),
  (select asset_version from pg_temp.deposit_fixture),
  '100',
  '00000000-0000-4000-8000-000000100120'
);

select extensions.ok(
  (select result_code from pg_temp.deposit_request_replay) = 'APPLIED'
    and (select replayed from pg_temp.deposit_request_replay),
  'deposit request replay returns existing row'
);

select extensions.is(
  (
    select count(*)::integer
    from private.deposit_command_audit_events
    where command_id = '00000000-0000-4000-8000-000000100120'
  ),
  1,
  'deposit request replay creates no duplicate audit'
);

select extensions.is(
  (
    select result_code
    from public.create_user_funding_request(
      (select wallet_id from pg_temp.deposit_fixture),
      (select wallet_version from pg_temp.deposit_fixture),
      (select asset_id from pg_temp.deposit_fixture),
      (select asset_version from pg_temp.deposit_fixture),
      '101',
      '00000000-0000-4000-8000-000000100120'
    )
  ),
  'DEPOSIT_COMMAND_ID_CONFLICT',
  'deposit request command conflict is blocked'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000100003', 'aal2');

select extensions.is(
  (
    select result_code
    from public.cancel_current_user_funding_request(
      (select deposit_request_id from pg_temp.deposit_request_result),
      (select request_version from pg_temp.deposit_request_result),
      '00000000-0000-4000-8000-000000100121'
    )
  ),
  'DEPOSIT_REQUEST_FORBIDDEN',
  'other user cannot cancel deposit request'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000100002', 'aal2');

create temporary table pg_temp.user_cancel_request as
select *
from public.create_user_funding_request(
  (select wallet_id from pg_temp.deposit_fixture),
  (select wallet_version from pg_temp.deposit_fixture),
  (select asset_id from pg_temp.deposit_fixture),
  (select asset_version from pg_temp.deposit_fixture),
  '40',
  '00000000-0000-4000-8000-000000100122'
);

create temporary table pg_temp.user_cancel_result as
select *
from public.cancel_current_user_funding_request(
  (select deposit_request_id from pg_temp.user_cancel_request),
  (select request_version from pg_temp.user_cancel_request),
  '00000000-0000-4000-8000-000000100123'
);

select extensions.ok(
  (select result_code from pg_temp.user_cancel_result) = 'APPLIED'
    and (select status from pg_temp.user_cancel_result) = 'CANCELED',
  'user cancel applies'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.user_cancel_result)
      and entries.side = 'DEBIT'
      and entries.units = 40
      and accounts.account_purpose = 'USER_PENDING_DEPOSIT'
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.user_cancel_result)
      and entries.side = 'CREDIT'
      and entries.units = 40
      and accounts.account_purpose = 'SYSTEM_DEPOSIT_CLEARING'
  ),
  'user cancel reverses pending and clearing'
);

select extensions.is(
  (
    select result_code
    from public.cancel_current_user_funding_request(
      (select deposit_request_id from pg_temp.user_cancel_result),
      (select request_version from pg_temp.user_cancel_result),
      '00000000-0000-4000-8000-000000100124'
    )
  ),
  'NOOP',
  'canceling an already canceled request records NOOP'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000100001', 'aal1');

select extensions.throws_ok(
  format(
    $sql$
    select *
    from public.confirm_user_funding_request(
      %L::uuid,
      %s,
      '00000000-0000-4000-8000-000000100125',
      'aal1 confirm blocked'
    )
    $sql$,
    (select deposit_request_id from pg_temp.deposit_request_result),
    (select request_version from pg_temp.deposit_request_result)
  ),
  '42501'::character(5),
  'DEPOSIT_ADMIN_AAL2_REQUIRED',
  'AAL1 admin cannot confirm deposit'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000100001', 'aal2');

create temporary table pg_temp.confirm_result as
select *
from public.confirm_user_funding_request(
  (select deposit_request_id from pg_temp.deposit_request_result),
  (select request_version from pg_temp.deposit_request_result),
  '00000000-0000-4000-8000-000000100126',
  'manual deposit verified'
);

select extensions.ok(
  (select result_code from pg_temp.confirm_result) = 'APPLIED'
    and (select status from pg_temp.confirm_result) = 'CONFIRMED',
  'admin confirm applies'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries
    where journal_id = (select journal_id from pg_temp.confirm_result)
  ),
  4,
  'admin confirm creates four ledger entries'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.confirm_result)
      and entries.side = 'DEBIT'
      and accounts.account_purpose = 'SYSTEM_CUSTODY'
      and entries.units = 100
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.confirm_result)
      and entries.side = 'CREDIT'
      and accounts.account_purpose = 'SYSTEM_DEPOSIT_CLEARING'
      and entries.units = 100
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.confirm_result)
      and entries.side = 'DEBIT'
      and accounts.account_purpose = 'USER_PENDING_DEPOSIT'
      and entries.units = 100
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.confirm_result)
      and entries.side = 'CREDIT'
      and accounts.account_purpose = 'USER_AVAILABLE'
      and entries.units = 100
  ),
  'admin confirm posts exact four-line journal'
);

select extensions.ok(
  (
    select pending_deposit_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.deposit_fixture)
      and asset_id = (select asset_id from pg_temp.deposit_fixture)
  ) = '0'
  and (
    select available_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.deposit_fixture)
      and asset_id = (select asset_id from pg_temp.deposit_fixture)
  ) = '100',
  'admin confirm moves requested amount out of pending and into available'
);

select extensions.is(
  (
    select result_code
    from public.confirm_user_funding_request(
      (select deposit_request_id from pg_temp.confirm_result),
      (select request_version from pg_temp.confirm_result),
      '00000000-0000-4000-8000-000000100127',
      'already confirmed noop'
    )
  ),
  'NOOP',
  'confirming an already confirmed request records NOOP'
);

select extensions.is(
  (
    select result_code
    from public.admin_cancel_user_funding_request(
      (select deposit_request_id from pg_temp.confirm_result),
      (select request_version from pg_temp.confirm_result),
      '00000000-0000-4000-8000-000000100128',
      'confirmed cancel blocked'
    )
  ),
  'DEPOSIT_REQUEST_CONFIRMED',
  'confirmed request cannot be canceled'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000100002', 'aal2');

create temporary table pg_temp.admin_cancel_request as
select *
from public.create_user_funding_request(
  (select wallet_id from pg_temp.deposit_fixture),
  (select wallet_version from pg_temp.deposit_fixture),
  (select asset_id from pg_temp.deposit_fixture),
  (select asset_version from pg_temp.deposit_fixture),
  '25',
  '00000000-0000-4000-8000-000000100129'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000100001', 'aal2');

update public.profiles
set account_status = 'RESTRICTED'
where id = '00000000-0000-4000-8000-000000100002';

update public.wallet_accounts
set status = 'CLOSED',
    closed_at = clock_timestamp()
where id = (select wallet_id from pg_temp.deposit_fixture);

update public.supported_assets
set status = 'ARCHIVED'
where id = (select asset_id from pg_temp.deposit_fixture);

select extensions.is(
  (
    select result_code
    from public.admin_cancel_user_funding_request(
      (select deposit_request_id from pg_temp.admin_cancel_request),
      (select request_version from pg_temp.admin_cancel_request),
      '00000000-0000-4000-8000-000000100130',
      'admin cancel inactive target'
    )
  ),
  'APPLIED',
  'admin cancel allows inactive target state'
);

select extensions.is(
  (
    select result_code
    from public.confirm_user_funding_request(
      (select deposit_request_id from pg_temp.admin_cancel_request),
      2,
      '00000000-0000-4000-8000-000000100131',
      'canceled confirm blocked'
    )
  ),
  'DEPOSIT_REQUEST_CANCELED',
  'canceled request cannot be confirmed'
);

select extensions.throws_ok(
  $$update private.deposit_requests set status = 'CANCELED' where status = 'CONFIRMED'$$,
  '23514'::character(5),
  'DEPOSIT_REQUEST_TERMINAL',
  'terminal deposit state cannot be rewritten'
);

select extensions.throws_ok(
  $$update private.deposit_requests set requested_units = 1 where id = (select deposit_request_id from pg_temp.confirm_result)$$,
  '23514'::character(5),
  'DEPOSIT_REQUEST_TRANSITION_INVALID',
  'deposit core fields cannot be rewritten'
);

select extensions.throws_ok(
  $$update private.deposit_command_audit_events set reason = 'blocked'$$,
  '55000'::character(5),
  'DEPOSIT_COMMAND_AUDIT_IMMUTABLE',
  'deposit audit update is blocked'
);

select extensions.throws_ok(
  $$delete from private.deposit_command_audit_events$$,
  '55000'::character(5),
  'DEPOSIT_COMMAND_AUDIT_IMMUTABLE',
  'deposit audit delete is blocked'
);

select extensions.throws_ok(
  $$truncate private.deposit_command_audit_events$$,
  '55000'::character(5),
  'DEPOSIT_COMMAND_AUDIT_IMMUTABLE',
  'deposit audit truncate is blocked'
);

select extensions.ok(
  (select count(*) from public.list_admin_deposit_requests(100, null)) >= 1
    and (select count(*) from public.list_deposit_command_audit_events(100, null)) >= 1,
  'admin deposit read RPCs return rows'
);

select extensions.ok(
  not exists (
    select 1
    from public.list_deposit_command_audit_events(100, null) as events
    where events.units_text !~ '^[1-9][0-9]*$'
      or events.action not in (
        'CREATE_DEPOSIT_REQUEST',
        'CONFIRM_DEPOSIT_REQUEST',
        'CANCEL_DEPOSIT_REQUEST'
      )
  ),
  'deposit audit read RPC returns safe unit strings and actions'
);

set local role authenticated;

select extensions.throws_ok(
  $$select count(*) from private.deposit_requests$$,
  '42501'::character(5),
  'permission denied for schema private',
  'authenticated cannot directly read deposit request table'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000100002', 'aal2');

select extensions.throws_ok(
  $$select count(*) from public.list_current_user_deposit_requests(50)$$,
  '42501'::character(5),
  'DEPOSIT_ACTIVE_USER_REQUIRED',
  'inactive user deposit read is blocked'
);

select extensions.ok(
  obj_description('private.deposit_requests'::regclass, 'pg_class') is not null
    and obj_description('private.deposit_command_audit_events'::regclass, 'pg_class') is not null
    and obj_description('public.create_user_funding_request(uuid, bigint, uuid, bigint, text, uuid)'::regprocedure, 'pg_proc') is not null
    and obj_description('public.confirm_user_funding_request(uuid, bigint, uuid, text)'::regprocedure, 'pg_proc') is not null,
  'deposit objects are documented'
);

select * from extensions.finish();

rollback;
