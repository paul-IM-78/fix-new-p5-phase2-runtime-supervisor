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
    from pg_type as types
    join pg_namespace as namespaces
      on namespaces.oid = types.typnamespace
    where namespaces.nspname = 'private'
      and types.typname = 'positive_atomic_units'
  ),
  'positive atomic unit domain exists'
);

select extensions.has_table('private', 'ledger_accounts', 'ledger accounts table exists');
select extensions.has_table('private', 'ledger_journals', 'ledger journals table exists');
select extensions.has_table('private', 'ledger_entries', 'ledger entries table exists');

select extensions.ok(
  exists (
    select 1
    from information_schema.views
    where table_schema = 'private'
      and table_name = 'ledger_account_balances'
  ),
  'ledger account balance view exists'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.views
    where table_schema = 'private'
      and table_name = 'wallet_asset_ledger_balances'
  ),
  'wallet asset balance view exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname in (
        'ensure_wallet_asset_ledger_accounts',
        'ensure_system_ledger_accounts',
        'post_ledger_journal',
        'validate_ledger_journal_invariants'
      )
    group by namespaces.nspname
    having count(*) = 4
  ),
  'private ledger helper functions exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = 'list_current_user_ledger_balances'
  ),
  'current user ledger balance rpc exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'ledger_accounts'
      and indexname = 'ledger_accounts_user_purpose_uidx'
  ),
  'user ledger account partial unique index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'ledger_accounts'
      and indexname = 'ledger_accounts_system_purpose_uidx'
  ),
  'system ledger account partial unique index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.ledger_journals'::regclass
      and conname = 'ledger_journals_command_id_key'
      and contype = 'u'
  ),
  'journal command id is unique'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.ledger_entries'::regclass
      and conname in (
        'ledger_entries_line_no_uidx',
        'ledger_entries_account_uidx'
      )
    group by conrelid
    having count(*) = 2
  ),
  'ledger entry line and account uniqueness exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.ledger_journals'::regclass
      and tgname = 'protect_ledger_journals'
      and not tgisinternal
  ),
  'journal immutability trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.ledger_entries'::regclass
      and tgname = 'protect_ledger_entries'
      and not tgisinternal
  ),
  'entry immutability trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.ledger_journals'::regclass
      and tgname = 'validate_ledger_journal_after_insert'
      and tgdeferrable
      and tginitdeferred
      and not tgisinternal
  ),
  'journal deferred invariant trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.ledger_entries'::regclass
      and tgname = 'validate_ledger_entry_after_insert'
      and tgdeferrable
      and tginitdeferred
      and not tgisinternal
  ),
  'entry deferred invariant trigger exists'
);

select extensions.ok(
  obj_description('private.positive_atomic_units'::regtype::oid, 'pg_type') is not null
    and obj_description('private.ledger_accounts'::regclass, 'pg_class') is not null
    and obj_description('private.ledger_journals'::regclass, 'pg_class') is not null
    and obj_description('private.ledger_entries'::regclass, 'pg_class') is not null
    and obj_description('private.ensure_wallet_asset_ledger_accounts(uuid, uuid)'::regprocedure, 'pg_proc') is not null
    and obj_description('private.ensure_system_ledger_accounts(uuid)'::regprocedure, 'pg_proc') is not null
    and obj_description('private.post_ledger_journal(uuid, uuid, text, text, uuid, text, uuid, text, jsonb)'::regprocedure, 'pg_proc') is not null
    and obj_description('private.validate_ledger_journal_invariants()'::regprocedure, 'pg_proc') is not null
    and obj_description('public.list_current_user_ledger_balances()'::regprocedure, 'pg_proc') is not null,
  'ledger objects have comments'
);

select extensions.lives_ok(
  $_$
  select '1'::numeric::private.positive_atomic_units;
  select '12345678901234567890'::numeric::private.positive_atomic_units;
  select '99999999999999999999999999999999999999'::numeric::private.positive_atomic_units;
  $_$,
  'positive atomic units accept valid integer values'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform '0'::numeric::private.positive_atomic_units;
    raise exception 'expected zero failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'atomic units reject zero'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform '-1'::numeric::private.positive_atomic_units;
    raise exception 'expected negative failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'atomic units reject negative values'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform '1.0'::numeric::private.positive_atomic_units;
    raise exception 'expected fractional scale failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'atomic units reject decimal text scale'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform 'NaN'::numeric::private.positive_atomic_units;
    raise exception 'expected nan failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'atomic units reject NaN'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform 'Infinity'::numeric::private.positive_atomic_units;
    raise exception 'expected infinity failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'atomic units reject infinity'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform '100000000000000000000000000000000000000'::numeric::private.positive_atomic_units;
    raise exception 'expected 39 digit failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'atomic units reject 39 digit values'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000010001',
  'ledger-user-a@example.test',
  '{"display_name":"Ledger User A"}'::jsonb
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000010002',
  'ledger-user-b@example.test',
  '{"display_name":"Ledger User B"}'::jsonb
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000010003',
  'ledger-user-closed@example.test',
  '{"display_name":"Ledger Closed User"}'::jsonb
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
values
  (
    '00000000-0000-4000-8000-000000010101',
    'LEDGER_QA_ASSET_A',
    'LQA',
    'Ledger QA Asset A',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111133',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000010102',
    'LEDGER_QA_ASSET_B',
    'LQB',
    'Ledger QA Asset B',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111134',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000010103',
    'LEDGER_QA_ARCHIVED',
    'LQX',
    'Ledger QA Archived',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111135',
    'ARCHIVED'
  );

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.ledger_accounts (
      asset_id,
      wallet_account_id,
      account_scope,
      account_class,
      account_purpose,
      normal_side
    )
    values (
      '00000000-0000-4000-8000-000000010101',
      null,
      'USER',
      'LIABILITY',
      'USER_AVAILABLE',
      'CREDIT'
    );
    raise exception 'expected user wallet failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'user ledger account requires wallet'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.ledger_accounts (
      asset_id,
      wallet_account_id,
      account_scope,
      account_class,
      account_purpose,
      normal_side
    )
    values (
      '00000000-0000-4000-8000-000000010101',
      (select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010001'),
      'SYSTEM',
      'ASSET',
      'SYSTEM_CUSTODY',
      'DEBIT'
    );
    raise exception 'expected system wallet failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'system ledger account forbids wallet'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.ledger_accounts (
      asset_id,
      wallet_account_id,
      account_scope,
      account_class,
      account_purpose,
      normal_side
    )
    values (
      '00000000-0000-4000-8000-000000010101',
      (select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010001'),
      'USER',
      'ASSET',
      'USER_AVAILABLE',
      'DEBIT'
    );
    raise exception 'expected user mapping failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'user account class and normal side mapping is enforced'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.ledger_accounts (
      asset_id,
      wallet_account_id,
      account_scope,
      account_class,
      account_purpose,
      normal_side
    )
    values (
      '00000000-0000-4000-8000-000000010101',
      null,
      'SYSTEM',
      'LIABILITY',
      'SYSTEM_CUSTODY',
      'CREDIT'
    );
    raise exception 'expected system mapping failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'system account purpose mapping is enforced'
);

create temp table qa_user_accounts as
select *
from private.ensure_wallet_asset_ledger_accounts(
  (select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010001'),
  '00000000-0000-4000-8000-000000010101'
);

create temp table qa_system_accounts as
select *
from private.ensure_system_ledger_accounts(
  '00000000-0000-4000-8000-000000010101'
);

select extensions.is(
  (select count(*)::integer from qa_user_accounts),
  4,
  'wallet asset provisioning creates four user accounts'
);

select extensions.is(
  (select count(*)::integer from qa_system_accounts),
  6,
  'system provisioning creates six accounts'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_accounts
    where wallet_account_id = (select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010001')
      and asset_id = '00000000-0000-4000-8000-000000010101'
      and account_scope = 'USER'
      and account_class = 'LIABILITY'
      and normal_side = 'CREDIT'
      and status = 'OPEN'
    group by wallet_account_id, asset_id
    having count(*) = 4
  ),
  'user account mapping and open status are stored'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_accounts
    where wallet_account_id is null
      and asset_id = '00000000-0000-4000-8000-000000010101'
      and account_scope = 'SYSTEM'
      and status = 'OPEN'
    group by asset_id
    having count(*) = 6
  ),
  'system account mapping and open status are stored'
);

create temp table qa_user_accounts_replay as
select *
from private.ensure_wallet_asset_ledger_accounts(
  (select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010001'),
  '00000000-0000-4000-8000-000000010101'
);

select extensions.is(
  (
    select string_agg(account_purpose || ':' || ledger_account_id::text, ',' order by account_purpose)
    from qa_user_accounts
  ),
  (
    select string_agg(account_purpose || ':' || ledger_account_id::text, ',' order by account_purpose)
    from qa_user_accounts_replay
  ),
  'wallet provisioning is idempotent and preserves account ids'
);

select extensions.is(
  (
    select max(version)::integer
    from private.ledger_accounts
    where id in (select ledger_account_id from qa_user_accounts)
  ),
  1,
  'idempotent provisioning does not bump version'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.ensure_wallet_asset_ledger_accounts(
      '00000000-0000-4000-8000-000000019999',
      '00000000-0000-4000-8000-000000010101'
    );
    raise exception 'expected missing wallet failure';
  exception
    when foreign_key_violation then
      null;
  end;
  $$;
  $_$,
  'wallet provisioning rejects missing wallet'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.ensure_wallet_asset_ledger_accounts(
      (select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010001'),
      '00000000-0000-4000-8000-000000019999'
    );
    raise exception 'expected missing asset failure';
  exception
    when foreign_key_violation then
      null;
  end;
  $$;
  $_$,
  'wallet provisioning rejects missing asset'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.ensure_wallet_asset_ledger_accounts(
      (select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010002'),
      '00000000-0000-4000-8000-000000010103'
    );
    raise exception 'expected archived asset failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'wallet provisioning rejects archived asset'
);

update public.wallet_accounts
set status = 'CLOSED',
  closed_at = clock_timestamp()
where user_id = '00000000-0000-4000-8000-000000010003';

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.ensure_wallet_asset_ledger_accounts(
      (select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010003'),
      '00000000-0000-4000-8000-000000010101'
    );
    raise exception 'expected closed wallet failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'wallet provisioning rejects closed wallet when creating accounts'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.ensure_system_ledger_accounts(
      '00000000-0000-4000-8000-000000010103'
    );
    raise exception 'expected archived system asset failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'system provisioning rejects archived asset'
);

create temp table qa_account_ids as
select account_purpose, ledger_account_id
from qa_user_accounts
union all
select account_purpose, ledger_account_id
from qa_system_accounts;

create temp table qa_deposit as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000011001',
  '00000000-0000-4000-8000-000000010101',
  'QA_DEPOSIT',
  'USER',
  '00000000-0000-4000-8000-000000010001',
  'QA_REFERENCE',
  '00000000-0000-4000-8000-000000011101',
  'qa deposit posting',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'),
      'side',
      'DEBIT',
      'units',
      '100'
    ),
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'),
      'side',
      'CREDIT',
      'units',
      '100'
    )
  )
);

select extensions.is(
  (select replayed::text from qa_deposit),
  'false',
  'initial deposit posting is applied'
);

select extensions.is(
  (select count(*)::integer from private.ledger_journals),
  1,
  'deposit creates one journal'
);

select extensions.is(
  (select count(*)::integer from private.ledger_entries),
  2,
  'deposit creates two entries'
);

select extensions.is(
  (
    select debit_units::text || ',' || credit_units::text
    from private.ledger_account_balances
    where ledger_account_id = (
      select ledger_account_id from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'
    )
  ),
  '100,0',
  'system custody debit balance stores deposit'
);

select extensions.is(
  (
    select available_units::text || ',' || total_liability_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (
      select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010001'
    )
      and asset_id = '00000000-0000-4000-8000-000000010101'
  ),
  '100,100',
  'wallet asset available and total balance after deposit'
);

create temp table qa_lock as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000011002',
  '00000000-0000-4000-8000-000000010101',
  'QA_LOCK',
  'USER',
  '00000000-0000-4000-8000-000000010001',
  'QA_REFERENCE',
  '00000000-0000-4000-8000-000000011102',
  'qa lock posting',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'),
      'side',
      'DEBIT',
      'units',
      '40'
    ),
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_LOCKED'),
      'side',
      'CREDIT',
      'units',
      '40'
    )
  )
);

create temp table qa_pending_withdrawal as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000011003',
  '00000000-0000-4000-8000-000000010101',
  'QA_WITHDRAWAL_PENDING',
  'USER',
  '00000000-0000-4000-8000-000000010001',
  'QA_REFERENCE',
  '00000000-0000-4000-8000-000000011103',
  'qa pending withdrawal posting',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'),
      'side',
      'DEBIT',
      'units',
      '10'
    ),
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_PENDING_WITHDRAWAL'),
      'side',
      'CREDIT',
      'units',
      '10'
    )
  )
);

select extensions.is(
  (
    select
      available_units::text || ',' ||
      locked_units::text || ',' ||
      pending_deposit_units::text || ',' ||
      pending_withdrawal_units::text || ',' ||
      total_liability_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (
      select id from public.wallet_accounts where user_id = '00000000-0000-4000-8000-000000010001'
    )
      and asset_id = '00000000-0000-4000-8000-000000010101'
  ),
  '50,40,0,10,100',
  'wallet asset balance buckets after lock and pending withdrawal'
);

select extensions.is(
  (
    select balance_units::text
    from private.ledger_account_balances
    where ledger_account_id = (
      select ledger_account_id from qa_account_ids where account_purpose = 'USER_PENDING_DEPOSIT'
    )
  ),
  '0',
  'entryless user bucket returns zero'
);

create temp table qa_replay as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000011001',
  '00000000-0000-4000-8000-000000010101',
  'QA_DEPOSIT',
  'USER',
  '00000000-0000-4000-8000-000000010001',
  'QA_REFERENCE',
  '00000000-0000-4000-8000-000000011101',
  'qa deposit posting',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'),
      'side',
      'CREDIT',
      'units',
      '100'
    ),
    jsonb_build_object(
      'account_id',
      (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'),
      'side',
      'DEBIT',
      'units',
      '100'
    )
  )
);

select extensions.is(
  (select replayed::text from qa_replay),
  'true',
  'same command and canonical lines replay'
);

select extensions.is(
  (select count(*)::integer from private.ledger_journals where command_id = '00000000-0000-4000-8000-000000011001'),
  1,
  'replay does not duplicate journal'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.post_ledger_journal(
      '00000000-0000-4000-8000-000000011001',
      '00000000-0000-4000-8000-000000010101',
      'QA_DEPOSIT',
      'USER',
      '00000000-0000-4000-8000-000000010001',
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011101',
      'qa deposit posting changed',
      jsonb_build_array(
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '100'),
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '100')
      )
    );
    raise exception 'expected command conflict';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'same command id with changed reason conflicts'
);

select extensions.is(
  (select count(*)::integer from private.ledger_journals),
  3,
  'conflict creates no extra journal'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.post_ledger_journal(
      '00000000-0000-4000-8000-000000011004',
      '00000000-0000-4000-8000-000000010101',
      'QA_OVERDRAW',
      'USER',
      '00000000-0000-4000-8000-000000010001',
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011104',
      'qa overdraw available',
      jsonb_build_array(
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'DEBIT', 'units', '51'),
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_LOCKED'), 'side', 'CREDIT', 'units', '51')
      )
    );
    raise exception 'expected overdraw failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'posting blocks negative available balance'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.post_ledger_journal(
      '00000000-0000-4000-8000-000000011005',
      '00000000-0000-4000-8000-000000010101',
      'QA_OVERDRAW_LOCKED',
      'USER',
      '00000000-0000-4000-8000-000000010001',
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011105',
      'qa overdraw locked',
      jsonb_build_array(
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_LOCKED'), 'side', 'DEBIT', 'units', '41'),
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '41')
      )
    );
    raise exception 'expected locked overdraw failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'posting blocks negative locked balance'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.post_ledger_journal(
      '00000000-0000-4000-8000-000000011006',
      '00000000-0000-4000-8000-000000010101',
      'QA_UNBALANCED',
      'USER',
      '00000000-0000-4000-8000-000000010001',
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011106',
      'qa unbalanced',
      jsonb_build_array(
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '2'),
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1')
      )
    );
    raise exception 'expected unbalanced failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'posting blocks unbalanced journal'
);

create temp table qa_asset_b_system_accounts as
select *
from private.ensure_system_ledger_accounts(
  '00000000-0000-4000-8000-000000010102'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.post_ledger_journal(
      '00000000-0000-4000-8000-000000011007',
      '00000000-0000-4000-8000-000000010101',
      'QA_CROSS_ASSET',
      'USER',
      '00000000-0000-4000-8000-000000010001',
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011107',
      'qa cross asset',
      jsonb_build_array(
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'DEBIT', 'units', '1'),
        jsonb_build_object('account_id', (select id::text from private.ledger_accounts where asset_id = '00000000-0000-4000-8000-000000010102' and account_purpose = 'SYSTEM_CUSTODY'), 'side', 'CREDIT', 'units', '1')
      )
    );
    raise exception 'expected cross asset failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'posting blocks cross-asset lines'
);

update private.ledger_accounts
set status = 'CLOSED'
where id = (
  select ledger_account_id
  from qa_account_ids
  where account_purpose = 'SYSTEM_SUSPENSE'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.post_ledger_journal(
      '00000000-0000-4000-8000-000000011008',
      '00000000-0000-4000-8000-000000010101',
      'QA_CLOSED_ACCOUNT',
      'USER',
      '00000000-0000-4000-8000-000000010001',
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011108',
      'qa closed account',
      jsonb_build_array(
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_SUSPENSE'), 'side', 'DEBIT', 'units', '1'),
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1')
      )
    );
    raise exception 'expected closed account failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'posting blocks closed ledger accounts'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.post_ledger_journal(
      '00000000-0000-4000-8000-000000011009',
      '00000000-0000-4000-8000-000000010101',
      'QA_DUPLICATE',
      'USER',
      '00000000-0000-4000-8000-000000010001',
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011109',
      'qa duplicate account',
      jsonb_build_array(
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'DEBIT', 'units', '1'),
        jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1')
      )
    );
    raise exception 'expected duplicate account failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'posting blocks duplicate account lines'
);

select extensions.lives_ok(
  $_$
  do $$
  declare
    v_case jsonb;
  begin
    foreach v_case in array array[
      jsonb_build_array(jsonb_build_object('account_id', 'not-a-uuid', 'side', 'DEBIT', 'units', '1'), jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1')),
      jsonb_build_array(jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'), 'side', 'BROKEN', 'units', '1'), jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1')),
      jsonb_build_array(jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', 1), jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1')),
      jsonb_build_array(jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '1.0'), jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1')),
      jsonb_build_array(jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '01'), jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1')),
      jsonb_build_array(jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '1e3'), jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1000')),
      jsonb_build_array(jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'), 'side', 'DEBIT', 'units', '1', 'extra', 'blocked'), jsonb_build_object('account_id', (select ledger_account_id::text from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'side', 'CREDIT', 'units', '1'))
    ]
    loop
      begin
        perform *
        from private.post_ledger_journal(
          gen_random_uuid(),
          '00000000-0000-4000-8000-000000010101',
          'QA_INVALID_LINE',
          'USER',
          '00000000-0000-4000-8000-000000010001',
          'QA_REFERENCE',
          gen_random_uuid(),
          'qa invalid line',
          v_case
        );
        raise exception 'expected invalid line failure';
      exception
        when invalid_parameter_value then
          null;
      end;
    end loop;
  end;
  $$;
  $_$,
  'posting rejects invalid UUID, side, numeric JSON, decimal, leading zero, scientific notation, and extra keys'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.post_ledger_journal(
      '00000000-0000-4000-8000-000000011010',
      '00000000-0000-4000-8000-000000010101',
      'QA_TOO_MANY_LINES',
      'USER',
      '00000000-0000-4000-8000-000000010001',
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011110',
      'qa too many lines',
      (
        select jsonb_agg(
          jsonb_build_object(
            'account_id',
            gen_random_uuid()::text,
            'side',
            case when series % 2 = 0 then 'DEBIT' else 'CREDIT' end,
            'units',
            '1'
          )
        )
        from generate_series(1, 33) as series
      )
    );
    raise exception 'expected line count failure';
  exception
    when invalid_parameter_value then
      null;
  end;
  $$;
  $_$,
  'posting rejects more than thirty-two lines'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.ledger_journals
    set reason = 'blocked';
    raise exception 'expected journal update failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'journal update is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    delete from private.ledger_journals;
    raise exception 'expected journal delete failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'journal delete is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    truncate private.ledger_journals;
    raise exception 'expected journal truncate failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'journal truncate is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.ledger_entries
    set side = 'DEBIT';
    raise exception 'expected entry update failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'entry update is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    delete from private.ledger_entries;
    raise exception 'expected entry delete failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'entry delete is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    truncate private.ledger_entries;
    raise exception 'expected entry truncate failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'entry truncate is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.ledger_journals (
      command_id,
      asset_id,
      journal_type,
      initiator_type,
      initiator_user_id,
      reference_type,
      reference_id,
      reason,
      request_data
    )
    values (
      '00000000-0000-4000-8000-000000011201',
      '00000000-0000-4000-8000-000000010101',
      'QA_DEFERRED_EMPTY',
      'SYSTEM',
      null,
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011301',
      'qa deferred empty',
      '{}'::jsonb
    );
    set constraints private.validate_ledger_journal_after_insert immediate;
    raise exception 'expected deferred empty journal failure';
  exception
    when check_violation then
      set constraints all deferred;
  end;
  $$;
  $_$,
  'deferred invariant blocks journal without entries'
);

select extensions.lives_ok(
  $_$
  do $$
  declare
    v_journal_id uuid;
  begin
    insert into private.ledger_journals (
      command_id,
      asset_id,
      journal_type,
      initiator_type,
      initiator_user_id,
      reference_type,
      reference_id,
      reason,
      request_data
    )
    values (
      '00000000-0000-4000-8000-000000011202',
      '00000000-0000-4000-8000-000000010101',
      'QA_DEFERRED_UNBALANCED',
      'SYSTEM',
      null,
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011302',
      'qa deferred unbalanced',
      '{}'::jsonb
    )
    returning id into v_journal_id;

    insert into private.ledger_entries (journal_id, line_no, ledger_account_id, side, units)
    values
      (v_journal_id, 1, (select ledger_account_id from qa_account_ids where account_purpose = 'SYSTEM_CUSTODY'), 'DEBIT', '2'),
      (v_journal_id, 2, (select ledger_account_id from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'CREDIT', '1');

    set constraints private.validate_ledger_entry_after_insert immediate;
    raise exception 'expected deferred unbalanced failure';
  exception
    when check_violation then
      set constraints all deferred;
  end;
  $$;
  $_$,
  'deferred invariant blocks unbalanced owner insert'
);

select extensions.lives_ok(
  $_$
  do $$
  declare
    v_journal_id uuid;
  begin
    insert into private.ledger_journals (
      command_id,
      asset_id,
      journal_type,
      initiator_type,
      initiator_user_id,
      reference_type,
      reference_id,
      reason,
      request_data
    )
    values (
      '00000000-0000-4000-8000-000000011203',
      '00000000-0000-4000-8000-000000010101',
      'QA_DEFERRED_CROSS',
      'SYSTEM',
      null,
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011303',
      'qa deferred cross',
      '{}'::jsonb
    )
    returning id into v_journal_id;

    insert into private.ledger_entries (journal_id, line_no, ledger_account_id, side, units)
    values
      (v_journal_id, 1, (select ledger_account_id from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'DEBIT', '1'),
      (v_journal_id, 2, (select id from private.ledger_accounts where asset_id = '00000000-0000-4000-8000-000000010102' and account_purpose = 'SYSTEM_CUSTODY'), 'CREDIT', '1');

    set constraints private.validate_ledger_entry_after_insert immediate;
    raise exception 'expected deferred cross asset failure';
  exception
    when check_violation then
      set constraints all deferred;
  end;
  $$;
  $_$,
  'deferred invariant blocks cross-asset owner insert'
);

select extensions.lives_ok(
  $_$
  do $$
  declare
    v_journal_id uuid;
  begin
    insert into private.ledger_journals (
      command_id,
      asset_id,
      journal_type,
      initiator_type,
      initiator_user_id,
      reference_type,
      reference_id,
      reason,
      request_data
    )
    values (
      '00000000-0000-4000-8000-000000011204',
      '00000000-0000-4000-8000-000000010101',
      'QA_DEFERRED_NEGATIVE',
      'SYSTEM',
      null,
      'QA_REFERENCE',
      '00000000-0000-4000-8000-000000011304',
      'qa deferred negative',
      '{}'::jsonb
    )
    returning id into v_journal_id;

    insert into private.ledger_entries (journal_id, line_no, ledger_account_id, side, units)
    values
      (v_journal_id, 1, (select ledger_account_id from qa_account_ids where account_purpose = 'USER_AVAILABLE'), 'DEBIT', '51'),
      (v_journal_id, 2, (select ledger_account_id from qa_account_ids where account_purpose = 'SYSTEM_TOKEN_ISSUANCE'), 'CREDIT', '51');

    set constraints private.validate_ledger_entry_after_insert immediate;
    raise exception 'expected deferred negative balance failure';
  exception
    when check_violation then
      set constraints all deferred;
  end;
  $$;
  $_$,
  'deferred invariant blocks negative user liability owner insert'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000010001', 'aal1');
set local role authenticated;

select extensions.is(
  (
    select
      available_units || ',' ||
      locked_units || ',' ||
      pending_deposit_units || ',' ||
      pending_withdrawal_units || ',' ||
      total_liability_units
    from public.list_current_user_ledger_balances()
  ),
  '50,40,0,10,100',
  'authenticated user balance rpc returns text bucket values'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000010002', 'aal1');
set local role authenticated;

select extensions.is(
  (select count(*)::integer from public.list_current_user_ledger_balances()),
  0,
  'other user balance rpc does not expose balances'
);

reset role;

select extensions.lives_ok(
  $_$
  do $$
  declare
    v_status text;
  begin
    foreach v_status in array array['RESTRICTED', 'SUSPENDED', 'WITHDRAWN']
    loop
      update public.profiles
      set account_status = v_status
      where id = '00000000-0000-4000-8000-000000010001';

      perform pg_temp.set_auth_context('00000000-0000-4000-8000-000000010001', 'aal1');
      set local role authenticated;

      begin
        perform * from public.list_current_user_ledger_balances();
        raise exception 'expected inactive profile failure';
      exception
        when insufficient_privilege then
          null;
      end;

      reset role;
    end loop;
  end;
  $$;
  $_$,
  'inactive profiles cannot read ledger balance rpc'
);

reset role;

select extensions.ok(
  not has_table_privilege('anon', 'private.ledger_accounts', 'select')
    and not has_table_privilege('anon', 'private.ledger_journals', 'select')
    and not has_table_privilege('anon', 'private.ledger_entries', 'select')
    and not has_table_privilege('authenticated', 'private.ledger_accounts', 'select')
    and not has_table_privilege('authenticated', 'private.ledger_journals', 'select')
    and not has_table_privilege('authenticated', 'private.ledger_entries', 'select'),
  'anon and authenticated cannot select private ledger tables'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.ledger_accounts', 'insert')
    and not has_table_privilege('authenticated', 'private.ledger_journals', 'insert')
    and not has_table_privilege('authenticated', 'private.ledger_entries', 'insert')
    and not has_table_privilege('authenticated', 'private.ledger_accounts', 'update')
    and not has_table_privilege('authenticated', 'private.ledger_journals', 'update')
    and not has_table_privilege('authenticated', 'private.ledger_entries', 'update')
    and not has_table_privilege('authenticated', 'private.ledger_accounts', 'delete')
    and not has_table_privilege('authenticated', 'private.ledger_journals', 'delete')
    and not has_table_privilege('authenticated', 'private.ledger_entries', 'delete'),
  'authenticated cannot write private ledger tables directly'
);

select extensions.ok(
  not has_function_privilege('anon', 'private.post_ledger_journal(uuid, uuid, text, text, uuid, text, uuid, text, jsonb)'::regprocedure, 'execute')
    and not has_function_privilege('authenticated', 'private.post_ledger_journal(uuid, uuid, text, text, uuid, text, uuid, text, jsonb)'::regprocedure, 'execute')
    and not has_function_privilege('authenticated', 'private.ensure_wallet_asset_ledger_accounts(uuid, uuid)'::regprocedure, 'execute')
    and not has_function_privilege('authenticated', 'private.ensure_system_ledger_accounts(uuid)'::regprocedure, 'execute')
    and has_function_privilege('authenticated', 'public.list_current_user_ledger_balances()'::regprocedure, 'execute')
    and not has_function_privilege('anon', 'public.list_current_user_ledger_balances()'::regprocedure, 'execute'),
  'private helpers are not executable by browser roles and balance rpc is authenticated only'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname ~* '(post_ledger|ledger_post|ledger_journal|ledger_entry|deposit|withdraw|stake|reward)'
      and procedures.proname <> 'list_current_user_ledger_balances'
  ),
  'no public financial write rpc exists'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema in ('private', 'public')
      and lower(column_name) in (
        'private_key',
        'mnemonic',
        'seed_phrase',
        'wallet_address',
        'deposit_address',
        'withdrawal_address',
        'transaction_id',
        'apy'
      )
  ),
  'ledger schema does not introduce wallet credentials or product financial columns'
);

select * from extensions.finish();

rollback;
