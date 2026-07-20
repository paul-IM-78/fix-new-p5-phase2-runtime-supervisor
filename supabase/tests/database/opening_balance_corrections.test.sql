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
  'financial_admin_audit_events',
  'financial admin audit table exists'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'financial_admin_audit_events'
      and column_name in (
        'id',
        'command_id',
        'action',
        'outcome',
        'actor_user_id',
        'target_user_id',
        'wallet_account_id',
        'asset_id',
        'original_journal_id',
        'resulting_journal_id',
        'reason',
        'request_data',
        'units',
        'occurred_at'
      )
    group by table_schema, table_name
    having count(*) = 14
  ),
  'financial admin audit safe columns exist'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'financial_admin_audit_events'
      and column_name in (
        'email',
        'password',
        'cookie',
        'token',
        'jwt',
        'mfa_secret',
        'totp_code',
        'private_key',
        'metadata'
      )
  ),
  'financial admin audit excludes credential columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.financial_admin_audit_events'::regclass
      and conname in (
        'financial_admin_audit_events_command_id_key',
        'financial_admin_audit_events_action_check',
        'financial_admin_audit_events_outcome_check',
        'financial_admin_audit_events_shape_check',
        'financial_admin_audit_events_reason_check',
        'financial_admin_audit_events_request_data_check'
      )
    group by conrelid
    having count(*) = 6
  ),
  'financial admin audit constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'financial_admin_audit_events'
      and indexname in (
        'financial_admin_audit_events_occurred_at_idx',
        'financial_admin_audit_events_actor_idx',
        'financial_admin_audit_events_target_user_idx',
        'financial_admin_audit_events_wallet_account_idx',
        'financial_admin_audit_events_asset_idx',
        'financial_admin_audit_events_original_journal_idx',
        'financial_admin_audit_events_resulting_journal_idx',
        'financial_admin_opening_once_uidx',
        'financial_admin_opening_reversal_once_uidx',
        'financial_admin_applied_resulting_journal_uidx'
      )
    group by schemaname, tablename
    having count(*) = 10
  ),
  'financial admin audit indexes exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.financial_admin_audit_events'::regclass
      and tgname = 'protect_financial_admin_audit_events'
      and not tgisinternal
  ),
  'financial admin audit immutability trigger exists'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'post_opening_balance',
        'reverse_opening_balance',
        'list_admin_wallet_asset_ledger_balances',
        'list_admin_ledger_journals',
        'list_financial_admin_audit_events'
      )
  ) = 5,
  'financial command and read RPCs exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'post_opening_balance',
        'reverse_opening_balance',
        'list_admin_wallet_asset_ledger_balances',
        'list_admin_ledger_journals',
        'list_financial_admin_audit_events'
      )
      and not prosecdef
  ),
  'financial RPCs are security definer'
);

select extensions.ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'private.validate_ledger_journal_invariants()'::regprocedure
  ),
  'ledger invariant trigger function is security definer for authenticated RPC commits'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'post_opening_balance',
        'reverse_opening_balance',
        'list_admin_wallet_asset_ledger_balances',
        'list_admin_ledger_journals',
        'list_financial_admin_audit_events'
      )
      and coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
  ),
  'financial RPCs use empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.post_opening_balance(uuid, bigint, uuid, bigint, text, uuid, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.reverse_opening_balance(uuid, uuid, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_admin_wallet_asset_ledger_balances(integer)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_admin_ledger_journals(integer, uuid)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_financial_admin_audit_events(integer, uuid)'::regprocedure,
    'execute'
  ),
  'authenticated can execute financial public RPCs'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.post_opening_balance(uuid, bigint, uuid, bigint, text, uuid, text)'::regprocedure,
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.reverse_opening_balance(uuid, uuid, text)'::regprocedure,
    'execute'
  )
  and not has_function_privilege(
    'public',
    'public.list_financial_admin_audit_events(integer, uuid)'::regprocedure,
    'execute'
  ),
  'anon and public cannot execute financial public RPCs'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.financial_admin_audit_events', 'select')
  and not has_table_privilege('authenticated', 'private.financial_admin_audit_events', 'insert')
  and not has_table_privilege('authenticated', 'private.financial_admin_audit_events', 'update')
  and not has_table_privilege('authenticated', 'private.financial_admin_audit_events', 'delete')
  and not has_table_privilege('authenticated', 'private.financial_admin_audit_events', 'truncate')
  and not has_table_privilege('authenticated', 'private.financial_admin_audit_events', 'references')
  and not has_table_privilege('authenticated', 'private.financial_admin_audit_events', 'trigger'),
  'authenticated has no direct financial audit table privileges'
);

select extensions.ok(
  obj_description('private.financial_admin_audit_events'::regclass, 'pg_class') is not null
    and obj_description('private.prevent_financial_admin_audit_mutation()'::regprocedure, 'pg_proc') is not null
    and obj_description('public.post_opening_balance(uuid, bigint, uuid, bigint, text, uuid, text)'::regprocedure, 'pg_proc') is not null
    and obj_description('public.reverse_opening_balance(uuid, uuid, text)'::regprocedure, 'pg_proc') is not null
    and obj_description('public.list_admin_wallet_asset_ledger_balances(integer)'::regprocedure, 'pg_proc') is not null
    and obj_description('public.list_admin_ledger_journals(integer, uuid)'::regprocedure, 'pg_proc') is not null
    and obj_description('public.list_financial_admin_audit_events(integer, uuid)'::regprocedure, 'pg_proc') is not null,
  'financial objects are documented'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname ~* '(manual|generic|posting)'
      and proname <> 'post_opening_balance'
  ),
  'no public generic manual financial write RPC exists'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000090001',
  'admin-opening@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000090002',
  'user-opening@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000090001',
  'ADMIN',
  'opening balance test admin'
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
  '00000000-0000-4000-8000-000000090101',
  'OPENING_TEST_A',
  'OPTA',
  'Opening Test Asset A',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111131',
  'ACTIVE'
);

create temporary table pg_temp.opening_fixture as
select
  wallet_accounts.id as wallet_id,
  wallet_accounts.user_id,
  wallet_accounts.version as wallet_version,
  supported_assets.id as asset_id,
  supported_assets.version as asset_version
from public.wallet_accounts
cross join public.supported_assets
where wallet_accounts.user_id = '00000000-0000-4000-8000-000000090002'
  and supported_assets.id = '00000000-0000-4000-8000-000000090101';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000090002', 'aal2');

select extensions.throws_ok(
  format(
    $sql$
    select *
    from public.post_opening_balance(
      %L::uuid,
      %s,
      %L::uuid,
      %s,
      '1',
      '00000000-0000-4000-8000-000000090110',
      'user blocked opening'
    )
    $sql$,
    (select wallet_id from pg_temp.opening_fixture),
    (select wallet_version from pg_temp.opening_fixture),
    (select asset_id from pg_temp.opening_fixture),
    (select asset_version from pg_temp.opening_fixture)
  ),
  '42501'::character(5),
  'FINANCIAL_ADMIN_AAL2_REQUIRED',
  'regular USER cannot post opening'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000090001', 'aal1');

select extensions.throws_ok(
  format(
    $sql$
    select *
    from public.post_opening_balance(
      %L::uuid,
      %s,
      %L::uuid,
      %s,
      '1',
      '00000000-0000-4000-8000-000000090111',
      'aal1 blocked opening'
    )
    $sql$,
    (select wallet_id from pg_temp.opening_fixture),
    (select wallet_version from pg_temp.opening_fixture),
    (select asset_id from pg_temp.opening_fixture),
    (select asset_version from pg_temp.opening_fixture)
  ),
  '42501'::character(5),
  'FINANCIAL_ADMIN_AAL2_REQUIRED',
  'AAL1 ADMIN cannot post opening'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000090001', 'aal2');

create temporary table pg_temp.invalid_opening_results as
select result_code
from public.post_opening_balance(
  (select wallet_id from pg_temp.opening_fixture),
  (select wallet_version from pg_temp.opening_fixture),
  (select asset_id from pg_temp.opening_fixture),
  (select asset_version from pg_temp.opening_fixture),
  '0',
  '00000000-0000-4000-8000-000000090112',
  'invalid opening units'
)
union all
select result_code
from public.post_opening_balance(
  (select wallet_id from pg_temp.opening_fixture),
  0,
  (select asset_id from pg_temp.opening_fixture),
  (select asset_version from pg_temp.opening_fixture),
  '1',
  '00000000-0000-4000-8000-000000090113',
  'invalid wallet version'
)
union all
select result_code
from public.post_opening_balance(
  (select wallet_id from pg_temp.opening_fixture),
  (select wallet_version from pg_temp.opening_fixture),
  (select asset_id from pg_temp.opening_fixture),
  (select asset_version from pg_temp.opening_fixture),
  '01',
  '00000000-0000-4000-8000-000000090114',
  'invalid leading zero'
)
union all
select result_code
from public.post_opening_balance(
  (select wallet_id from pg_temp.opening_fixture),
  (select wallet_version from pg_temp.opening_fixture),
  (select asset_id from pg_temp.opening_fixture),
  (select asset_version from pg_temp.opening_fixture),
  '1e9',
  '00000000-0000-4000-8000-000000090115',
  'invalid scientific'
);

select extensions.is(
  (select count(*)::integer from pg_temp.invalid_opening_results where result_code = 'INVALID_INPUT'),
  4,
  'opening rejects invalid units and versions'
);

select extensions.is(
  (select count(*)::integer from private.financial_admin_audit_events),
  0,
  'invalid opening inputs create no financial audit'
);

create temporary table pg_temp.opening_result as
select *
from public.post_opening_balance(
  (select wallet_id from pg_temp.opening_fixture),
  (select wallet_version from pg_temp.opening_fixture),
  (select asset_id from pg_temp.opening_fixture),
  (select asset_version from pg_temp.opening_fixture),
  '100',
  '00000000-0000-4000-8000-000000090120',
  'opening balance migration'
);

select extensions.is(
  (select result_code from pg_temp.opening_result),
  'APPLIED',
  'opening balance applies'
);

select extensions.is(
  (select replayed from pg_temp.opening_result),
  false,
  'opening balance first call is not replay'
);

select extensions.is(
  (select count(*)::integer from private.ledger_journals where journal_type = 'ADMIN_OPENING_BALANCE'),
  1,
  'opening creates one ledger journal'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries
    where journal_id = (select journal_id from pg_temp.opening_result)
  ),
  2,
  'opening creates two ledger entries'
);

select extensions.is(
  (
    select count(*)::integer
    from private.financial_admin_audit_events
    where action = 'POST_OPENING_BALANCE'
      and outcome = 'APPLIED'
      and resulting_journal_id = (select journal_id from pg_temp.opening_result)
  ),
  1,
  'opening creates applied financial audit'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.opening_result)
      and entries.side = 'DEBIT'
      and entries.units = 100
      and accounts.account_purpose = 'SYSTEM_CUSTODY'
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.opening_result)
      and entries.side = 'CREDIT'
      and entries.units = 100
      and accounts.account_purpose = 'USER_AVAILABLE'
  ),
  'opening posts debit custody and credit user available'
);

select extensions.is(
  (
    select available_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.opening_fixture)
      and asset_id = (select asset_id from pg_temp.opening_fixture)
  ),
  '100',
  'opening increases available balance'
);

create temporary table pg_temp.opening_replay_result as
select *
from public.post_opening_balance(
  (select wallet_id from pg_temp.opening_fixture),
  (select wallet_version from pg_temp.opening_fixture),
  (select asset_id from pg_temp.opening_fixture),
  (select asset_version from pg_temp.opening_fixture),
  '100',
  '00000000-0000-4000-8000-000000090120',
  'opening balance migration'
);

select extensions.ok(
  (select result_code from pg_temp.opening_replay_result) = 'APPLIED'
    and (select replayed from pg_temp.opening_replay_result),
  'opening command replay returns existing event'
);

select extensions.is(
  (select count(*)::integer from private.financial_admin_audit_events where command_id = '00000000-0000-4000-8000-000000090120'),
  1,
  'opening replay creates no duplicate audit'
);

select extensions.is(
  (
    select result_code
    from public.post_opening_balance(
      (select wallet_id from pg_temp.opening_fixture),
      (select wallet_version from pg_temp.opening_fixture),
      (select asset_id from pg_temp.opening_fixture),
      (select asset_version from pg_temp.opening_fixture),
      '100',
      '00000000-0000-4000-8000-000000090120',
      'opening changed reason'
    )
  ),
  'FINANCIAL_COMMAND_ID_CONFLICT',
  'opening command conflict is blocked'
);

select extensions.is(
  (
    select result_code
    from public.post_opening_balance(
      (select wallet_id from pg_temp.opening_fixture),
      (select wallet_version from pg_temp.opening_fixture),
      (select asset_id from pg_temp.opening_fixture),
      (select asset_version from pg_temp.opening_fixture),
      '1',
      '00000000-0000-4000-8000-000000090121',
      'second opening blocked'
    )
  ),
  'OPENING_BALANCE_ALREADY_POSTED',
  'wallet asset opening is one-time'
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
  '00000000-0000-4000-8000-000000090102',
  'OPENING_TEST_B',
  'OPTB',
  'Opening Test Asset B',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111132',
  'ACTIVE'
);

select extensions.is(
  (
    select result_code
    from public.post_opening_balance(
      (select wallet_id from pg_temp.opening_fixture),
      (select wallet_version from pg_temp.opening_fixture),
      '00000000-0000-4000-8000-000000090102',
      1,
      '1',
      '00000000-0000-4000-8000-000000090122',
      'second asset opening'
    )
  ),
  'APPLIED',
  'different asset opening is allowed when that wallet asset has no entries'
);

select extensions.throws_ok(
  $$update private.financial_admin_audit_events set reason = 'blocked'$$,
  '55000'::character(5),
  'FINANCIAL_ADMIN_AUDIT_IMMUTABLE',
  'financial audit update is blocked'
);

select extensions.throws_ok(
  $$delete from private.financial_admin_audit_events$$,
  '55000'::character(5),
  'FINANCIAL_ADMIN_AUDIT_IMMUTABLE',
  'financial audit delete is blocked'
);

create temporary table pg_temp.reversal_result as
select *
from public.reverse_opening_balance(
  (select journal_id from pg_temp.opening_result),
  '00000000-0000-4000-8000-000000090130',
  'reverse opening balance'
);

select extensions.is(
  (select result_code from pg_temp.reversal_result),
  'APPLIED',
  'opening reversal applies'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries
    where journal_id = (select reversal_journal_id from pg_temp.reversal_result)
  ),
  2,
  'reversal creates two entries'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select reversal_journal_id from pg_temp.reversal_result)
      and entries.side = 'DEBIT'
      and entries.units = 100
      and accounts.account_purpose = 'USER_AVAILABLE'
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select reversal_journal_id from pg_temp.reversal_result)
      and entries.side = 'CREDIT'
      and entries.units = 100
      and accounts.account_purpose = 'SYSTEM_CUSTODY'
  ),
  'reversal posts exact opposite entries'
);

select extensions.is(
  (
    select available_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.opening_fixture)
      and asset_id = (select asset_id from pg_temp.opening_fixture)
  ),
  '0',
  'reversal returns available balance to zero'
);

create temporary table pg_temp.reversal_replay_result as
select *
from public.reverse_opening_balance(
  (select journal_id from pg_temp.opening_result),
  '00000000-0000-4000-8000-000000090130',
  'reverse opening balance'
);

select extensions.ok(
  (select result_code from pg_temp.reversal_replay_result) = 'APPLIED'
    and (select replayed from pg_temp.reversal_replay_result),
  'reversal command replay returns existing event'
);

select extensions.is(
  (
    select result_code
    from public.reverse_opening_balance(
      (select journal_id from pg_temp.opening_result),
      '00000000-0000-4000-8000-000000090131',
      'already reversed noop'
    )
  ),
  'NOOP',
  'different command after reversal records NOOP'
);

select extensions.is(
  (
    select count(*)::integer
    from private.financial_admin_audit_events
    where original_journal_id = (select journal_id from pg_temp.opening_result)
      and action = 'REVERSE_OPENING_BALANCE'
      and outcome = 'NOOP'
  ),
  1,
  'reversal NOOP audit is recorded'
);

select extensions.is(
  (
    select result_code
    from public.reverse_opening_balance(
      (select journal_id from pg_temp.opening_result),
      '00000000-0000-4000-8000-000000090130',
      'changed reversal reason'
    )
  ),
  'FINANCIAL_COMMAND_ID_CONFLICT',
  'reversal command conflict is blocked'
);

select extensions.is(
  (
    select result_code
    from public.reverse_opening_balance(
      '00000000-0000-4000-8000-000000090999',
      '00000000-0000-4000-8000-000000090132',
      'missing journal'
    )
  ),
  'OPENING_JOURNAL_NOT_FOUND',
  'missing original journal is blocked'
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
  '00000000-0000-4000-8000-000000090103',
  'OPENING_TEST_C',
  'OPTC',
  'Opening Test Asset C',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111133',
  'ACTIVE'
);

create temporary table pg_temp.opening_insufficient as
select *
from public.post_opening_balance(
  (select wallet_id from pg_temp.opening_fixture),
  (select wallet_version from pg_temp.opening_fixture),
  '00000000-0000-4000-8000-000000090103',
  1,
  '9',
  '00000000-0000-4000-8000-000000090140',
  'opening before insufficient reversal'
);

create temporary table pg_temp.insufficient_accounts as
select *
from private.ensure_wallet_asset_ledger_accounts(
  (select wallet_id from pg_temp.opening_fixture),
  '00000000-0000-4000-8000-000000090103'
);

create temporary table pg_temp.insufficient_system_accounts as
select *
from private.ensure_system_ledger_accounts(
  '00000000-0000-4000-8000-000000090103'
);

create temporary table pg_temp.insufficient_move as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000090141',
  '00000000-0000-4000-8000-000000090103',
  'QA_MOVE_OPENING_AVAILABLE',
  'USER',
  '00000000-0000-4000-8000-000000090002',
  'QA_REFERENCE',
  '00000000-0000-4000-8000-000000090142',
  'move opening available',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from pg_temp.insufficient_accounts
        where account_purpose = 'USER_AVAILABLE'
      ),
      'side',
      'DEBIT',
      'units',
      '9'
    ),
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from pg_temp.insufficient_accounts
        where account_purpose = 'USER_LOCKED'
      ),
      'side',
      'CREDIT',
      'units',
      '9'
    )
  )
);

select extensions.is(
  (
    select result_code
    from public.reverse_opening_balance(
      (select journal_id from pg_temp.opening_insufficient),
      '00000000-0000-4000-8000-000000090143',
      'insufficient available'
    )
  ),
  'OPENING_REVERSAL_INSUFFICIENT_AVAILABLE',
  'reversal blocks insufficient available balance'
);

select extensions.is(
  (
    select count(*)::integer
    from private.financial_admin_audit_events
    where original_journal_id = (select journal_id from pg_temp.opening_insufficient)
      and action = 'REVERSE_OPENING_BALANCE'
  ),
  0,
  'insufficient reversal creates no audit'
);

select extensions.ok(
  (select count(*) from public.list_admin_wallet_asset_ledger_balances(100)) >= 1
    and (select count(*) from public.list_admin_ledger_journals(50, null)) >= 1
    and (select count(*) from public.list_financial_admin_audit_events(50, null)) >= 1,
  'AAL2 admin read RPCs return rows'
);

select extensions.ok(
  not exists (
    select 1
    from public.list_admin_wallet_asset_ledger_balances(100)
    where available_units !~ '^(0|[1-9][0-9]*)$'
      or locked_units !~ '^(0|[1-9][0-9]*)$'
      or total_liability_units !~ '^(0|[1-9][0-9]*)$'
  ),
  'admin balance RPC returns text unit strings'
);

select extensions.ok(
  not exists (
    select 1
    from public.list_financial_admin_audit_events(50, null) as events
    where events.units_text !~ '^[1-9][0-9]*$'
  ),
  'financial audit RPC returns positive unit strings'
);

set local role authenticated;

select extensions.throws_ok(
  $$select count(*) from private.financial_admin_audit_events$$,
  '42501'::character(5),
  'permission denied for schema private',
  'authenticated cannot directly read financial audit table'
);

reset role;

select * from extensions.finish();

rollback;
