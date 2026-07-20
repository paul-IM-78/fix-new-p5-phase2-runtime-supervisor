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
  'withdrawal_requests',
  'withdrawal request table exists'
);

select extensions.has_table(
  'private',
  'withdrawal_command_audit_events',
  'withdrawal audit table exists'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'withdrawal_requests'
      and column_name in (
        'id',
        'wallet_account_id',
        'asset_id',
        'requested_by',
        'requested_units',
        'status',
        'reservation_journal_id',
        'approval_journal_id',
        'cancellation_journal_id',
        'reserved_by',
        'approved_by',
        'canceled_by',
        'cancellation_actor_type',
        'canceled_from_status',
        'requested_at',
        'reserved_at',
        'approved_at',
        'canceled_at',
        'version',
        'created_at',
        'updated_at'
      )
    group by table_schema, table_name
    having count(*) = 21
  ),
  'withdrawal request safe columns exist'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name in ('withdrawal_requests', 'withdrawal_command_audit_events')
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
        'withdrawal_address',
        'transaction_id',
        'signature',
        'metadata'
      )
  ),
  'withdrawal tables exclude credential and blockchain columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.withdrawal_requests'::regclass
      and conname in (
        'withdrawal_requests_status_check',
        'withdrawal_requests_cancellation_actor_type_check',
        'withdrawal_requests_canceled_from_status_check',
        'withdrawal_requests_version_check',
        'withdrawal_requests_time_check',
        'withdrawal_requests_status_shape_check'
      )
    group by conrelid
    having count(*) = 6
  ),
  'withdrawal request state constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'withdrawal_requests'
      and indexname = 'withdrawal_requests_open_wallet_asset_uidx'
      and indexdef like '%REQUESTED%'
      and indexdef like '%RESERVED%'
      and indexdef like '%APPROVED%'
  ),
  'withdrawal open request partial unique index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.withdrawal_requests'::regclass
      and tgname in (
        'touch_withdrawal_requests_version',
        'validate_withdrawal_request_transition',
        'validate_withdrawal_request_invariants'
      )
      and not tgisinternal
    group by tgrelid
    having count(*) = 3
  ),
  'withdrawal version, transition, and invariant triggers exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.withdrawal_command_audit_events'::regclass
      and tgname = 'protect_withdrawal_command_audit_events'
      and not tgisinternal
  ),
  'withdrawal audit immutability trigger exists'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_user_payout_request',
        'cancel_current_user_payout_request',
        'reserve_user_payout_request',
        'approve_user_payout_request',
        'admin_cancel_user_payout_request',
        'list_current_user_withdrawal_requests',
        'list_admin_withdrawal_requests',
        'list_withdrawal_command_audit_events'
      )
  ) = 8,
  'withdrawal command and read RPCs exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_user_payout_request',
        'cancel_current_user_payout_request',
        'reserve_user_payout_request',
        'approve_user_payout_request',
        'admin_cancel_user_payout_request',
        'list_current_user_withdrawal_requests',
        'list_admin_withdrawal_requests',
        'list_withdrawal_command_audit_events'
      )
      and not prosecdef
  ),
  'withdrawal public RPCs are security definer'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_user_payout_request',
        'cancel_current_user_payout_request',
        'reserve_user_payout_request',
        'approve_user_payout_request',
        'admin_cancel_user_payout_request',
        'list_current_user_withdrawal_requests',
        'list_admin_withdrawal_requests',
        'list_withdrawal_command_audit_events'
      )
      and coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
  ),
  'withdrawal public RPCs use empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.create_user_payout_request(uuid, bigint, uuid, bigint, text, uuid)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.cancel_current_user_payout_request(uuid, bigint, uuid, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.reserve_user_payout_request(uuid, bigint, uuid, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.approve_user_payout_request(uuid, bigint, uuid, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_cancel_user_payout_request(uuid, bigint, uuid, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_current_user_withdrawal_requests(integer)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_admin_withdrawal_requests(integer, uuid)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_withdrawal_command_audit_events(integer, uuid)'::regprocedure,
    'execute'
  ),
  'authenticated can execute withdrawal RPCs'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.create_user_payout_request(uuid, bigint, uuid, bigint, text, uuid)'::regprocedure,
    'execute'
  )
  and not has_function_privilege(
    'public',
    'public.admin_cancel_user_payout_request(uuid, bigint, uuid, text)'::regprocedure,
    'execute'
  )
  and not has_table_privilege('authenticated', 'private.withdrawal_requests', 'select')
  and not has_table_privilege('authenticated', 'private.withdrawal_requests', 'insert')
  and not has_table_privilege('authenticated', 'private.withdrawal_requests', 'update')
  and not has_table_privilege('authenticated', 'private.withdrawal_requests', 'delete')
  and not has_table_privilege('authenticated', 'private.withdrawal_command_audit_events', 'select')
  and not has_table_privilege('authenticated', 'private.withdrawal_command_audit_events', 'insert')
  and not has_table_privilege('authenticated', 'private.withdrawal_command_audit_events', 'update')
  and not has_table_privilege('authenticated', 'private.withdrawal_command_audit_events', 'delete'),
  'anon/public and browser direct withdrawal table access are blocked'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000110001',
  'withdrawal-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000110002',
  'withdrawal-user@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000110003',
  'withdrawal-other@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000110001',
  'ADMIN',
  'withdrawal state machine test admin'
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
  '00000000-0000-4000-8000-000000110101',
  'WITHDRAWAL_TEST_A',
  'WDA',
  'Withdrawal Test Asset A',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111151',
  'ACTIVE'
);

create temporary table pg_temp.withdrawal_fixture as
select
  wallet_accounts.id as wallet_id,
  wallet_accounts.user_id,
  wallet_accounts.version as wallet_version,
  supported_assets.id as asset_id,
  supported_assets.version as asset_version
from public.wallet_accounts
cross join public.supported_assets
where wallet_accounts.user_id = '00000000-0000-4000-8000-000000110002'
  and supported_assets.id = '00000000-0000-4000-8000-000000110101';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110001');

create temporary table pg_temp.opening_result as
select *
from public.post_opening_balance(
  (select wallet_id from pg_temp.withdrawal_fixture),
  (select wallet_version from pg_temp.withdrawal_fixture),
  (select asset_id from pg_temp.withdrawal_fixture),
  (select asset_version from pg_temp.withdrawal_fixture),
  '1000',
  '00000000-0000-4000-8000-000000110201',
  'withdrawal state machine opening balance'
);

select extensions.is(
  (select result_code from pg_temp.opening_result),
  'APPLIED',
  'opening balance fixture is applied'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110002');

create temporary table pg_temp.invalid_withdrawal_results as
select *
from public.create_user_payout_request(
  (select wallet_id from pg_temp.withdrawal_fixture),
  0,
  (select asset_id from pg_temp.withdrawal_fixture),
  (select asset_version from pg_temp.withdrawal_fixture),
  '1',
  '00000000-0000-4000-8000-000000110301'
)
union all
select *
from public.create_user_payout_request(
  (select wallet_id from pg_temp.withdrawal_fixture),
  (select wallet_version from pg_temp.withdrawal_fixture),
  (select asset_id from pg_temp.withdrawal_fixture),
  (select asset_version from pg_temp.withdrawal_fixture),
  '01',
  '00000000-0000-4000-8000-000000110302'
)
union all
select *
from public.create_user_payout_request(
  (select wallet_id from pg_temp.withdrawal_fixture),
  (select wallet_version from pg_temp.withdrawal_fixture),
  (select asset_id from pg_temp.withdrawal_fixture),
  (select asset_version from pg_temp.withdrawal_fixture),
  '1001',
  '00000000-0000-4000-8000-000000110303'
);

select extensions.ok(
  (select count(*)::integer from pg_temp.invalid_withdrawal_results where result_code = 'INVALID_INPUT') = 2
    and (select count(*)::integer from pg_temp.invalid_withdrawal_results where result_code = 'WITHDRAWAL_INSUFFICIENT_AVAILABLE') = 1,
  'withdrawal request rejects invalid inputs and insufficient available balance'
);

select extensions.is(
  (select count(*)::integer from private.withdrawal_command_audit_events),
  0,
  'invalid withdrawal requests create no audit'
);

create temporary table pg_temp.withdrawal_request_result as
select *
from public.create_user_payout_request(
  (select wallet_id from pg_temp.withdrawal_fixture),
  (select wallet_version from pg_temp.withdrawal_fixture),
  (select asset_id from pg_temp.withdrawal_fixture),
  (select asset_version from pg_temp.withdrawal_fixture),
  '300',
  '00000000-0000-4000-8000-000000110304'
);

select extensions.is(
  (select result_code from pg_temp.withdrawal_request_result),
  'APPLIED',
  'withdrawal request applies'
);

select extensions.ok(
  (select journal_id from pg_temp.withdrawal_request_result) is null
    and (select count(*)::integer from private.ledger_journals where reference_type = 'WITHDRAWAL_REQUEST') = 0
    and (select count(*)::integer from private.ledger_entries as entries join private.ledger_journals as journals on journals.id = entries.journal_id where journals.reference_type = 'WITHDRAWAL_REQUEST') = 0,
  'withdrawal request creates no ledger posting'
);

select extensions.is(
  (
    select available_units::text || ',' || pending_withdrawal_units::text || ',' || total_liability_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.withdrawal_fixture)
      and asset_id = (select asset_id from pg_temp.withdrawal_fixture)
  ),
  '1000,0,1000',
  'withdrawal request leaves balances unchanged'
);

create temporary table pg_temp.withdrawal_request_replay as
select *
from public.create_user_payout_request(
  (select wallet_id from pg_temp.withdrawal_fixture),
  (select wallet_version from pg_temp.withdrawal_fixture),
  (select asset_id from pg_temp.withdrawal_fixture),
  (select asset_version from pg_temp.withdrawal_fixture),
  '300',
  '00000000-0000-4000-8000-000000110304'
);

select extensions.ok(
  (select result_code from pg_temp.withdrawal_request_replay) = 'APPLIED'
    and (select replayed from pg_temp.withdrawal_request_replay),
  'withdrawal request replay returns existing row'
);

select extensions.is(
  (select count(*)::integer from private.withdrawal_command_audit_events),
  1,
  'withdrawal request replay creates no duplicate audit'
);

select extensions.is(
  (
    select result_code
    from public.create_user_payout_request(
      (select wallet_id from pg_temp.withdrawal_fixture),
      (select wallet_version from pg_temp.withdrawal_fixture),
      (select asset_id from pg_temp.withdrawal_fixture),
      (select asset_version from pg_temp.withdrawal_fixture),
      '301',
      '00000000-0000-4000-8000-000000110304'
    )
  ),
  'WITHDRAWAL_COMMAND_ID_CONFLICT',
  'withdrawal command conflict is blocked'
);

select extensions.is(
  (
    select result_code
    from public.create_user_payout_request(
      (select wallet_id from pg_temp.withdrawal_fixture),
      (select wallet_version from pg_temp.withdrawal_fixture),
      (select asset_id from pg_temp.withdrawal_fixture),
      (select asset_version from pg_temp.withdrawal_fixture),
      '100',
      '00000000-0000-4000-8000-000000110305'
    )
  ),
  'WITHDRAWAL_REQUEST_ALREADY_OPEN',
  'only one open withdrawal request per wallet asset is allowed'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110003');

select extensions.is(
  (
    select result_code
    from public.cancel_current_user_payout_request(
      (select withdrawal_request_id from pg_temp.withdrawal_request_result),
      (select request_version from pg_temp.withdrawal_request_result),
      '00000000-0000-4000-8000-000000110306',
      'other user cancel attempt'
    )
  ),
  'WITHDRAWAL_REQUEST_FORBIDDEN',
  'other user cannot cancel withdrawal request'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110001', 'aal1');

select extensions.throws_ok(
  $$select * from public.reserve_user_payout_request(
      (select withdrawal_request_id from pg_temp.withdrawal_request_result),
      (select request_version from pg_temp.withdrawal_request_result),
      '00000000-0000-4000-8000-000000110307',
      'aal1 reserve attempt'
    )$$,
  '42501',
  null,
  'AAL1 admin cannot reserve withdrawal'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110001');

create temporary table pg_temp.reserve_result as
select *
from public.reserve_user_payout_request(
  (select withdrawal_request_id from pg_temp.withdrawal_request_result),
  (select request_version from pg_temp.withdrawal_request_result),
  '00000000-0000-4000-8000-000000110308',
  'reserve local withdrawal'
);

select extensions.is(
  (select result_code from pg_temp.reserve_result),
  'APPLIED',
  'admin reserves withdrawal'
);

select extensions.is(
  (
    select available_units::text || ',' || pending_withdrawal_units::text || ',' || total_liability_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.withdrawal_fixture)
      and asset_id = (select asset_id from pg_temp.withdrawal_fixture)
  ),
  '700,300,1000',
  'reserve moves available to pending withdrawal'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.reserve_result)
      and entries.side = 'DEBIT'
      and entries.units = 300
      and accounts.account_purpose = 'USER_AVAILABLE'
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.reserve_result)
      and entries.side = 'CREDIT'
      and entries.units = 300
      and accounts.account_purpose = 'USER_PENDING_WITHDRAWAL'
  ),
  'reserve posts available debit and pending withdrawal credit'
);

create temporary table pg_temp.reserve_replay as
select *
from public.reserve_user_payout_request(
  (select withdrawal_request_id from pg_temp.reserve_result),
  (select request_version from pg_temp.withdrawal_request_result),
  '00000000-0000-4000-8000-000000110308',
  'reserve local withdrawal'
);

select extensions.ok(
  (select result_code from pg_temp.reserve_replay) = 'APPLIED'
    and (select replayed from pg_temp.reserve_replay),
  'reserve replay returns existing result'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110002');

select extensions.is(
  (
    select result_code
    from public.cancel_current_user_payout_request(
      (select withdrawal_request_id from pg_temp.reserve_result),
      (select request_version from pg_temp.reserve_result),
      '00000000-0000-4000-8000-000000110309',
      'user cannot cancel reserved'
    )
  ),
  'WITHDRAWAL_REQUEST_NOT_USER_CANCELABLE',
  'user cannot cancel reserved withdrawal'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110001');

create temporary table pg_temp.approve_result as
select *
from public.approve_user_payout_request(
  (select withdrawal_request_id from pg_temp.reserve_result),
  (select request_version from pg_temp.reserve_result),
  '00000000-0000-4000-8000-000000110310',
  'approve local withdrawal'
);

select extensions.is(
  (select result_code from pg_temp.approve_result),
  'APPLIED',
  'admin approves withdrawal'
);

select extensions.is(
  (
    select available_units::text || ',' || pending_withdrawal_units::text || ',' || total_liability_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.withdrawal_fixture)
      and asset_id = (select asset_id from pg_temp.withdrawal_fixture)
  ),
  '700,0,700',
  'approval clears pending withdrawal and reduces user liability'
);

select extensions.is(
  (
    select balance_units::text
    from private.ledger_account_balances
    where asset_id = (select asset_id from pg_temp.withdrawal_fixture)
      and account_scope = 'SYSTEM'
      and account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
  ),
  '-300',
  'approval credits withdrawal clearing without custody settlement'
);

select extensions.is(
  (
    select balance_units::text
    from private.ledger_account_balances
    where asset_id = (select asset_id from pg_temp.withdrawal_fixture)
      and account_scope = 'SYSTEM'
      and account_purpose = 'SYSTEM_CUSTODY'
  ),
  '1000',
  'approval leaves custody unchanged'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.approve_result)
      and entries.side = 'DEBIT'
      and entries.units = 300
      and accounts.account_purpose = 'USER_PENDING_WITHDRAWAL'
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.approve_result)
      and entries.side = 'CREDIT'
      and entries.units = 300
      and accounts.account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
  )
  and not exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.approve_result)
      and accounts.account_purpose = 'SYSTEM_CUSTODY'
  ),
  'approval posts pending withdrawal to clearing and excludes custody'
);

create temporary table pg_temp.approve_replay as
select *
from public.approve_user_payout_request(
  (select withdrawal_request_id from pg_temp.approve_result),
  (select request_version from pg_temp.reserve_result),
  '00000000-0000-4000-8000-000000110310',
  'approve local withdrawal'
);

select extensions.ok(
  (select result_code from pg_temp.approve_replay) = 'APPLIED'
    and (select replayed from pg_temp.approve_replay),
  'approve replay returns existing result'
);

create temporary table pg_temp.cancel_approved_result as
select *
from public.admin_cancel_user_payout_request(
  (select withdrawal_request_id from pg_temp.approve_result),
  (select request_version from pg_temp.approve_result),
  '00000000-0000-4000-8000-000000110311',
  'cancel approved local withdrawal'
);

select extensions.is(
  (select result_code from pg_temp.cancel_approved_result),
  'APPLIED',
  'admin cancels approved withdrawal'
);

select extensions.is(
  (
    select available_units::text || ',' || pending_withdrawal_units::text || ',' || total_liability_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.withdrawal_fixture)
      and asset_id = (select asset_id from pg_temp.withdrawal_fixture)
  ),
  '1000,0,1000',
  'approved cancel restores available balance'
);

select extensions.is(
  (
    select balance_units::text
    from private.ledger_account_balances
    where asset_id = (select asset_id from pg_temp.withdrawal_fixture)
      and account_scope = 'SYSTEM'
      and account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
  ),
  '0',
  'approved cancel reverses withdrawal clearing'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110002');

create temporary table pg_temp.user_cancel_request as
select *
from public.create_user_payout_request(
  (select wallet_id from pg_temp.withdrawal_fixture),
  (select wallet_version from pg_temp.withdrawal_fixture),
  (select asset_id from pg_temp.withdrawal_fixture),
  (select asset_version from pg_temp.withdrawal_fixture),
  '100',
  '00000000-0000-4000-8000-000000110312'
);

create temporary table pg_temp.user_cancel_result as
select *
from public.cancel_current_user_payout_request(
  (select withdrawal_request_id from pg_temp.user_cancel_request),
  (select request_version from pg_temp.user_cancel_request),
  '00000000-0000-4000-8000-000000110313',
  'user requested cancel'
);

select extensions.ok(
  (select result_code from pg_temp.user_cancel_result) = 'APPLIED'
    and (select journal_id from pg_temp.user_cancel_result) is null,
  'user cancels requested withdrawal without posting'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110002');

create temporary table pg_temp.reserved_cancel_request as
select *
from public.create_user_payout_request(
  (select wallet_id from pg_temp.withdrawal_fixture),
  (select wallet_version from pg_temp.withdrawal_fixture),
  (select asset_id from pg_temp.withdrawal_fixture),
  (select asset_version from pg_temp.withdrawal_fixture),
  '200',
  '00000000-0000-4000-8000-000000110314'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110001');

create temporary table pg_temp.reserved_cancel_reserve as
select *
from public.reserve_user_payout_request(
  (select withdrawal_request_id from pg_temp.reserved_cancel_request),
  (select request_version from pg_temp.reserved_cancel_request),
  '00000000-0000-4000-8000-000000110315',
  'reserve before cancel'
);

create temporary table pg_temp.cancel_reserved_result as
select *
from public.admin_cancel_user_payout_request(
  (select withdrawal_request_id from pg_temp.reserved_cancel_reserve),
  (select request_version from pg_temp.reserved_cancel_reserve),
  '00000000-0000-4000-8000-000000110316',
  'cancel reserved local withdrawal'
);

select extensions.ok(
  (select result_code from pg_temp.cancel_reserved_result) = 'APPLIED'
    and (select journal_id from pg_temp.cancel_reserved_result) is not null,
  'admin cancels reserved withdrawal with reversal posting'
);

select extensions.is(
  (
    select available_units::text || ',' || pending_withdrawal_units::text || ',' || total_liability_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.withdrawal_fixture)
      and asset_id = (select asset_id from pg_temp.withdrawal_fixture)
  ),
  '1000,0,1000',
  'reserved cancel restores available and pending buckets'
);

select extensions.throws_ok(
  $$update private.withdrawal_requests set status = 'REQUESTED' where status = 'CANCELED'$$,
  '23514',
  null,
  'terminal withdrawal state cannot be rewritten'
);

select extensions.throws_ok(
  $$update private.withdrawal_requests set requested_units = 1 where id = (select withdrawal_request_id from pg_temp.cancel_approved_result)$$,
  '23514',
  null,
  'withdrawal core fields cannot be rewritten'
);

select extensions.throws_ok(
  $$update private.withdrawal_command_audit_events set reason = 'blocked'$$,
  '55000',
  'WITHDRAWAL_COMMAND_AUDIT_IMMUTABLE',
  'withdrawal audit update is blocked'
);

select extensions.throws_ok(
  $$delete from private.withdrawal_command_audit_events$$,
  '55000',
  'WITHDRAWAL_COMMAND_AUDIT_IMMUTABLE',
  'withdrawal audit delete is blocked'
);

select extensions.throws_ok(
  $$truncate private.withdrawal_command_audit_events$$,
  '55000',
  'WITHDRAWAL_COMMAND_AUDIT_IMMUTABLE',
  'withdrawal audit truncate is blocked'
);

select extensions.ok(
  (select count(*) from public.list_admin_withdrawal_requests(100, null)) >= 1
    and (select count(*) from public.list_withdrawal_command_audit_events(100, null)) >= 1,
  'admin withdrawal read RPCs return rows'
);

select extensions.ok(
  not exists (
    select 1
    from public.list_withdrawal_command_audit_events(100, null) as events
    where events.units_text !~ '^[1-9][0-9]{0,37}$'
      or events.action not in (
        'CREATE_WITHDRAWAL_REQUEST',
        'RESERVE_WITHDRAWAL_REQUEST',
        'APPROVE_WITHDRAWAL_REQUEST',
        'CANCEL_WITHDRAWAL_REQUEST'
      )
  ),
  'withdrawal audit read RPC returns safe unit strings and actions'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110003');

select extensions.throws_ok(
  $$set local role authenticated; select count(*) from private.withdrawal_requests$$,
  '42501',
  null,
  'authenticated cannot directly read withdrawal request table'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000110002');

update public.profiles
set account_status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000110002';

select extensions.throws_ok(
  $$select count(*) from public.list_current_user_withdrawal_requests(50)$$,
  '42501',
  null,
  'inactive user withdrawal read is blocked'
);

select extensions.ok(
  obj_description('private.withdrawal_requests'::regclass, 'pg_class') is not null
    and obj_description('private.withdrawal_command_audit_events'::regclass, 'pg_class') is not null,
  'withdrawal objects are documented'
);

select * from extensions.finish();

rollback;
