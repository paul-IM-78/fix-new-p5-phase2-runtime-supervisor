begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  to_regprocedure('private.calculate_expected_external_balance_atomic_units(uuid)') is not null,
  'expected asset balance function exists'
);

select extensions.is(
  pg_get_function_arguments('private.calculate_expected_external_balance_atomic_units(uuid)'::regprocedure),
  'p_asset_id uuid',
  'expected asset balance function accepts one asset uuid'
);

select extensions.is(
  pg_get_function_result('private.calculate_expected_external_balance_atomic_units(uuid)'::regprocedure),
  'numeric',
  'expected asset balance function returns numeric atomic units'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname = 'calculate_expected_external_balance_atomic_units'
      and procedures.provolatile = 's'
      and not procedures.prosecdef
  ),
  'expected asset balance function is stable and security invoker'
);

select extensions.ok(
  obj_description(
    'private.calculate_expected_external_balance_atomic_units(uuid)'::regprocedure,
    'pg_proc'
  ) is not null,
  'expected asset balance function has a comment'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'private.calculate_expected_external_balance_atomic_units(uuid)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'private.calculate_expected_external_balance_atomic_units(uuid)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.calculate_expected_external_balance_atomic_units(uuid)'::regprocedure,
      'execute'
    ),
  'expected asset balance function is not executable by browser roles'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname ~* '(expected.*balance|calculate_expected|external_balance)'
  ),
  0,
  'no public expected balance wrapper rpc exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'ledger_accounts'
      and indexname = 'ledger_accounts_system_purpose_uidx'
  ),
  'system custody account uniqueness uses existing system purpose index'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'ledger_account_balances'
      and column_name = 'balance_units'
      and data_type = 'numeric'
      and domain_name is null
  ),
  'expected balance source exposes numeric balance_units'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'ledger_entries'
      and column_name = 'units'
      and udt_schema = 'pg_catalog'
      and udt_name = 'numeric'
      and domain_schema = 'private'
      and domain_name = 'positive_atomic_units'
  ),
  'ledger entries enforce positive integer atomic unit domain'
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
    '00000000-0000-4000-8000-000000550101',
    'P5EAB_ASSET_A',
    'P5EA',
    'P5 Expected Balance Asset A',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111171',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000550102',
    'P5EAB_ASSET_B',
    'P5EB',
    'P5 Expected Balance Asset B',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111172',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000550103',
    'P5EAB_NO_ACCOUNT',
    'P5EC',
    'P5 Expected Balance No Account',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111173',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000550104',
    'P5EAB_NEGATIVE',
    'P5ED',
    'P5 Expected Balance Negative',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111174',
    'ACTIVE'
  );

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform private.calculate_expected_external_balance_atomic_units(
      '00000000-0000-4000-8000-000000559999'
    );
    raise exception 'expected missing asset failure';
  exception
    when foreign_key_violation then
      if sqlerrm <> 'asset_not_found' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'missing asset raises a safe error'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform private.calculate_expected_external_balance_atomic_units(
      '00000000-0000-4000-8000-000000550103'
    );
    raise exception 'expected missing system custody failure';
  exception
    when check_violation then
      if sqlerrm <> 'system_custody_account_missing' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'existing asset without system custody account raises a safe error'
);

create temp table qa_expected_asset_a_system_accounts as
select *
from private.ensure_system_ledger_accounts(
  '00000000-0000-4000-8000-000000550101'
);

select extensions.is(
  (
    select count(*)::integer
    from qa_expected_asset_a_system_accounts
    where account_purpose = 'SYSTEM_CUSTODY'
  ),
  1,
  'system custody provisioning creates one custody account for asset'
);

select extensions.is(
  private.calculate_expected_external_balance_atomic_units(
    '00000000-0000-4000-8000-000000550101'
  )::text,
  '0',
  'entryless system custody account returns zero'
);

create temp table qa_expected_asset_a_account_ids as
select account_purpose, ledger_account_id
from qa_expected_asset_a_system_accounts;

create temp table qa_expected_asset_a_custody_post as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000550901',
  '00000000-0000-4000-8000-000000550101',
  'P5_EXPECTED_CUSTODY',
  'SYSTEM',
  null,
  null,
  null,
  'p5 expected custody posting',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_asset_a_account_ids
        where account_purpose = 'SYSTEM_CUSTODY'
      ),
      'side',
      'DEBIT',
      'units',
      '123'
    ),
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_asset_a_account_ids
        where account_purpose = 'SYSTEM_TOKEN_ISSUANCE'
      ),
      'side',
      'CREDIT',
      'units',
      '123'
    )
  )
);

select extensions.is(
  private.calculate_expected_external_balance_atomic_units(
    '00000000-0000-4000-8000-000000550101'
  )::text,
  '123',
  'system custody debit balance is the expected external balance'
);

create temp table qa_expected_asset_b_system_accounts as
select *
from private.ensure_system_ledger_accounts(
  '00000000-0000-4000-8000-000000550102'
);

create temp table qa_expected_asset_b_post as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000550902',
  '00000000-0000-4000-8000-000000550102',
  'P5_EXPECTED_OTHER_ASSET',
  'SYSTEM',
  null,
  null,
  null,
  'p5 expected other asset posting',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_asset_b_system_accounts
        where account_purpose = 'SYSTEM_CUSTODY'
      ),
      'side',
      'DEBIT',
      'units',
      '777'
    ),
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_asset_b_system_accounts
        where account_purpose = 'SYSTEM_TOKEN_ISSUANCE'
      ),
      'side',
      'CREDIT',
      'units',
      '777'
    )
  )
);

select extensions.is(
  private.calculate_expected_external_balance_atomic_units(
    '00000000-0000-4000-8000-000000550101'
  )::text,
  '123',
  'other asset system custody balance is excluded'
);

create temp table qa_expected_non_custody_post as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000550903',
  '00000000-0000-4000-8000-000000550101',
  'P5_EXPECTED_NON_CUSTODY',
  'SYSTEM',
  null,
  null,
  null,
  'p5 expected non custody posting',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_asset_a_account_ids
        where account_purpose = 'SYSTEM_DEPOSIT_CLEARING'
      ),
      'side',
      'DEBIT',
      'units',
      '45'
    ),
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_asset_a_account_ids
        where account_purpose = 'SYSTEM_TOKEN_ISSUANCE'
      ),
      'side',
      'CREDIT',
      'units',
      '45'
    )
  )
);

select extensions.is(
  private.calculate_expected_external_balance_atomic_units(
    '00000000-0000-4000-8000-000000550101'
  )::text,
  '123',
  'internal non-custody system balances are excluded'
);

insert into auth.users (
  id,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000550001',
  'authenticated',
  'authenticated',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

create temp table qa_expected_user_accounts as
select *
from private.ensure_wallet_asset_ledger_accounts(
  (
    select id
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000550001'
  ),
  '00000000-0000-4000-8000-000000550101'
);

create temp table qa_expected_user_liability_post as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000550904',
  '00000000-0000-4000-8000-000000550101',
  'P5_EXPECTED_LIABILITY',
  'SYSTEM',
  null,
  null,
  null,
  'p5 expected liability posting',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_asset_a_account_ids
        where account_purpose = 'SYSTEM_DEPOSIT_CLEARING'
      ),
      'side',
      'DEBIT',
      'units',
      '55'
    ),
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_user_accounts
        where account_purpose = 'USER_AVAILABLE'
      ),
      'side',
      'CREDIT',
      'units',
      '55'
    )
  )
);

select extensions.is(
  private.calculate_expected_external_balance_atomic_units(
    '00000000-0000-4000-8000-000000550101'
  )::text,
  '123',
  'user liability balances are excluded'
);

select extensions.is(
  private.calculate_expected_external_balance_atomic_units(
    '00000000-0000-4000-8000-000000550101'
  )::text,
  private.calculate_expected_external_balance_atomic_units(
    '00000000-0000-4000-8000-000000550101'
  )::text,
  'same asset input returns the same deterministic result'
);

create temp table qa_expected_negative_system_accounts as
select *
from private.ensure_system_ledger_accounts(
  '00000000-0000-4000-8000-000000550104'
);

create temp table qa_expected_negative_post as
select *
from private.post_ledger_journal(
  '00000000-0000-4000-8000-000000550905',
  '00000000-0000-4000-8000-000000550104',
  'P5_EXPECTED_NEGATIVE',
  'SYSTEM',
  null,
  null,
  null,
  'p5 expected negative custody posting',
  jsonb_build_array(
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_negative_system_accounts
        where account_purpose = 'SYSTEM_TOKEN_ISSUANCE'
      ),
      'side',
      'DEBIT',
      'units',
      '1'
    ),
    jsonb_build_object(
      'account_id',
      (
        select ledger_account_id::text
        from qa_expected_negative_system_accounts
        where account_purpose = 'SYSTEM_CUSTODY'
      ),
      'side',
      'CREDIT',
      'units',
      '1'
    )
  )
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform private.calculate_expected_external_balance_atomic_units(
      '00000000-0000-4000-8000-000000550104'
    );
    raise exception 'expected invalid negative custody balance failure';
  exception
    when check_violation then
      if sqlerrm <> 'system_custody_balance_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'negative system custody balance raises a safe invariant error'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform '1.5'::numeric::private.positive_atomic_units;
    raise exception 'expected fractional atomic unit failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'fractional atomic units are rejected before expected balance calculation'
);

create temp table qa_expected_side_effect_counts_before as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.external_transaction_observations) as transaction_observations,
  (select count(*)::bigint from private.reconciliation_runs) as reconciliation_runs,
  (select count(*)::bigint from private.reconciliation_items) as reconciliation_items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as binding_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries;

select private.calculate_expected_external_balance_atomic_units(
  '00000000-0000-4000-8000-000000550101'
);

select extensions.is(
  (
    select
      balance_observations::text || ',' ||
      transaction_observations::text || ',' ||
      reconciliation_runs::text || ',' ||
      reconciliation_items::text || ',' ||
      binding_observations::text || ',' ||
      observer_checkpoints::text || ',' ||
      ledger_journals::text || ',' ||
      ledger_entries::text
    from qa_expected_side_effect_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.external_transaction_observations)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_runs)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_items)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_item_binding_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text || ',' ||
      (select count(*)::bigint from private.ledger_journals)::text || ',' ||
      (select count(*)::bigint from private.ledger_entries)::text
  ),
  'expected balance function has no persistence side effects'
);

select * from extensions.finish();

rollback;
