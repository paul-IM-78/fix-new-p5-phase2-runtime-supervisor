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
  'staking_positions',
  'staking positions table exists'
);

select extensions.has_table(
  'private',
  'staking_position_command_audit_events',
  'staking position audit table exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.staking_positions'::regclass
      and tgname = 'validate_staking_position_core'
      and not tgisinternal
  )
    and exists (
      select 1
      from pg_trigger
      where tgrelid = 'private.staking_positions'::regclass
        and tgname = 'validate_staking_position_invariants'
        and tgdeferrable
        and tginitdeferred
        and not tgisinternal
    )
    and exists (
      select 1
      from pg_trigger
      where tgrelid = 'private.staking_position_command_audit_events'::regclass
        and tgname = 'protect_staking_position_command_audit_update_delete'
        and not tgisinternal
    ),
  'staking position core, deferred invariant, and audit triggers exist'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'staking_positions'
      and indexname in (
        'staking_positions_wallet_locked_idx',
        'staking_positions_user_locked_idx',
        'staking_positions_product_locked_idx',
        'staking_positions_asset_locked_idx',
        'staking_positions_matures_idx',
        'staking_positions_status_matures_idx'
      )
  ) = 6,
  'staking position indexes exist'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_user_staking_position',
        'list_current_user_staking_positions',
        'list_admin_staking_positions',
        'list_staking_position_command_audit_events'
      )
  ) = 4,
  'staking position command and read RPCs exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_user_staking_position',
        'list_current_user_staking_positions',
        'list_admin_staking_positions',
        'list_staking_position_command_audit_events'
      )
      and not prosecdef
  ),
  'staking position RPCs are security definer'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_user_staking_position',
        'list_current_user_staking_positions',
        'list_admin_staking_positions',
        'list_staking_position_command_audit_events'
      )
      and coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
  ),
  'staking position RPCs use empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.create_user_staking_position(uuid, bigint, uuid, bigint, text, uuid, uuid)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.create_user_staking_position(uuid, bigint, uuid, bigint, text, uuid, uuid)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.list_current_user_staking_positions(integer)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.list_current_user_staking_positions(integer)'::regprocedure,
      'execute'
    ),
  'staking position RPC execute grants are authenticated-only'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.staking_positions', 'select')
    and not has_table_privilege('authenticated', 'private.staking_positions', 'insert')
    and not has_table_privilege('anon', 'private.staking_position_command_audit_events', 'select'),
  'staking position private table direct access is blocked'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc
    join pg_namespace
      on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private'
      and pg_proc.proname = 'validate_staking_position_invariants'
      and pg_proc.prosecdef
  ),
  'staking position deferred invariant trigger function is security definer'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000050001',
  'staking-position-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000050002',
  'staking-position-user@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000050003',
  'staking-position-other@example.test'
);

create temp table staking_position_wallet_fixture as
select
  wallet_accounts.user_id,
  wallet_accounts.id as wallet_account_id,
  wallet_accounts.version
from public.wallet_accounts as wallet_accounts
where wallet_accounts.user_id in (
  '00000000-0000-4000-8000-000000050002',
  '00000000-0000-4000-8000-000000050003'
);

grant select on staking_position_wallet_fixture to authenticated;

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000050001',
  'ADMIN',
  'staking position pgTAP fixture'
);

insert into public.projects (
  id,
  project_code,
  display_name,
  description,
  status
)
values (
  '00000000-0000-4000-8000-000000051001',
  'POSPROJECT',
  'Position Project',
  'staking position fixture',
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
values
  (
    '00000000-0000-4000-8000-000000052001',
    'POSSPL1',
    'PS1',
    'Position SPL One',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111151',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000052002',
    'POSSPL2',
    'PS2',
    'Position SPL Two',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111152',
    'ACTIVE'
  );

insert into public.project_token_assignments (project_id, asset_id)
values (
  '00000000-0000-4000-8000-000000051001',
  '00000000-0000-4000-8000-000000052001'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050001', 'aal2');
set local role authenticated;

create temp table staking_position_product_result as
select *
from public.create_staking_product(
  '00000000-0000-4000-8000-000000051001',
  '00000000-0000-4000-8000-000000052001',
  'POSITION_PRODUCT_A',
  'Position Product A',
  'position staking product',
  30,
  '1000',
  '9000',
  25000,
  now() - interval '1 hour',
  now() + interval '30 days',
  '00000000-0000-4000-8000-000000053001',
  'create position product'
);

create temp table staking_position_product_active_result as
select *
from public.transition_staking_product_status(
  (select staking_product_id from staking_position_product_result),
  1,
  'ACTIVE',
  '00000000-0000-4000-8000-000000053002',
  'activate position product'
);

create temp table staking_position_opening_result as
select *
from public.post_opening_balance(
  (
    select wallet_account_id
    from staking_position_wallet_fixture
    where user_id = '00000000-0000-4000-8000-000000050002'
  ),
  1,
  '00000000-0000-4000-8000-000000052001',
  1,
  '10000',
  '00000000-0000-4000-8000-000000053003',
  'opening for staking position'
);

select extensions.is(
  (select result_code from staking_position_opening_result),
  'APPLIED',
  'opening balance fixture applied'
);

reset role;

set local role anon;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '2000',
      '00000000-0000-4000-8000-000000054001',
      '00000000-0000-4000-8000-000000053004'
    );
    raise exception 'expected anon denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'anon cannot execute staking position create'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050002', 'aal1');
set local role authenticated;

create temp table staking_position_create_result as
select *
from public.create_user_staking_position(
  (select staking_product_id from staking_position_product_active_result),
  2,
  (
    select wallet_account_id
    from staking_position_wallet_fixture
    where user_id = '00000000-0000-4000-8000-000000050002'
  ),
  1,
  '2000',
  '00000000-0000-4000-8000-000000054001',
  '00000000-0000-4000-8000-000000053004'
);

reset role;

select extensions.is(
  (select result_code from staking_position_create_result),
  'APPLIED',
  'active user can create staking position'
);

select extensions.is(
  (select replayed from staking_position_create_result),
  false,
  'first position command is not replay'
);

select extensions.is(
  (
    select status
    from private.staking_positions
    where id = '00000000-0000-4000-8000-000000054001'
  ),
  'LOCKED',
  'position status is locked'
);

select extensions.is(
  (
    select principal_units::text
    from private.staking_positions
    where id = '00000000-0000-4000-8000-000000054001'
  ),
  '2000',
  'position stores principal as exact atomic units'
);

select extensions.is(
  (
    select product_version_snapshot
    from private.staking_positions
    where id = '00000000-0000-4000-8000-000000054001'
  ),
  2::bigint,
  'position snapshots product version'
);

select extensions.is(
  (
    select lock_duration_days_snapshot
    from private.staking_positions
    where id = '00000000-0000-4000-8000-000000054001'
  ),
  30,
  'position snapshots lock duration'
);

select extensions.is(
  (
    select term_reward_rate_ppm_snapshot
    from private.staking_positions
    where id = '00000000-0000-4000-8000-000000054001'
  ),
  25000,
  'position snapshots reward rate ppm'
);

select extensions.is(
  (
    select reward_rounding_mode_snapshot
    from private.staking_positions
    where id = '00000000-0000-4000-8000-000000054001'
  ),
  'FLOOR',
  'position snapshots rounding mode'
);

select extensions.ok(
  (
    select positions.locked_at = journals.posted_at
      and positions.matures_at = positions.locked_at + (positions.lock_duration_days_snapshot * interval '1 day')
    from private.staking_positions as positions
    join private.ledger_journals as journals
      on journals.id = positions.lock_journal_id
    where positions.id = '00000000-0000-4000-8000-000000054001'
  ),
  'position locked and maturity timestamps derive from journal'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_journals as journals
    where journals.id = (select lock_journal_id from staking_position_create_result)
      and journals.journal_type = 'USER_STAKING_POSITION_LOCKED'
      and journals.initiator_type = 'USER'
      and journals.initiator_user_id = '00000000-0000-4000-8000-000000050002'
      and journals.reference_type = 'STAKING_POSITION'
      and journals.reference_id = '00000000-0000-4000-8000-000000054001'
      and journals.asset_id = '00000000-0000-4000-8000-000000052001'
  ),
  'lock journal is connected to position'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select lock_journal_id from staking_position_create_result)
      and accounts.account_scope = 'USER'
      and accounts.account_purpose in ('USER_AVAILABLE', 'USER_LOCKED')
      and entries.units = 2000
  ),
  2,
  'lock journal has two exact user entries'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select lock_journal_id from staking_position_create_result)
      and entries.side = 'DEBIT'
      and accounts.account_purpose = 'USER_AVAILABLE'
  ),
  1,
  'principal lock debits user available'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select lock_journal_id from staking_position_create_result)
      and entries.side = 'CREDIT'
      and accounts.account_purpose = 'USER_LOCKED'
  ),
  1,
  'principal lock credits user locked'
);

select extensions.is(
  (
    select available_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (
      select wallet_account_id
      from staking_position_wallet_fixture
      where user_id = '00000000-0000-4000-8000-000000050002'
    )
      and asset_id = '00000000-0000-4000-8000-000000052001'
  ),
  '8000',
  'available balance decreases'
);

select extensions.is(
  (
    select locked_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (
      select wallet_account_id
      from staking_position_wallet_fixture
      where user_id = '00000000-0000-4000-8000-000000050002'
    )
      and asset_id = '00000000-0000-4000-8000-000000052001'
  ),
  '2000',
  'locked balance increases'
);

select extensions.is(
  (
    select total_liability_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (
      select wallet_account_id
      from staking_position_wallet_fixture
      where user_id = '00000000-0000-4000-8000-000000050002'
    )
      and asset_id = '00000000-0000-4000-8000-000000052001'
  ),
  '10000',
  'total liability is unchanged'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select lock_journal_id from staking_position_create_result)
      and accounts.account_scope = 'SYSTEM'
  ),
  0,
  'principal lock uses no system account'
);

select extensions.is(
  (
    select count(*)::integer
    from private.staking_position_command_audit_events
    where staking_position_id = '00000000-0000-4000-8000-000000054001'
      and action = 'CREATE_STAKING_POSITION'
      and outcome = 'APPLIED'
      and reason = 'USER_STAKING_POSITION'
  ),
  1,
  'position command audit applied'
);

select extensions.is(
  (
    select request_data ? 'principal_units'
      and not (request_data ? 'balance_snapshot')
    from private.staking_position_command_audit_events
    where staking_position_id = '00000000-0000-4000-8000-000000054001'
  ),
  true,
  'audit request data stores command boundary without balance snapshot'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050002', 'aal1');
set local role authenticated;

select extensions.is(
  (
    select replayed
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '2000',
      '00000000-0000-4000-8000-000000054001',
      '00000000-0000-4000-8000-000000053004'
    )
  ),
  true,
  'same command replays existing position'
);

reset role;

select extensions.is(
  (
    select count(*)::integer
    from private.staking_positions
    where id = '00000000-0000-4000-8000-000000054001'
  ),
  1,
  'replay creates no duplicate position'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050002', 'aal1');
set local role authenticated;

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '3000',
      '00000000-0000-4000-8000-000000054002',
      '00000000-0000-4000-8000-000000053004'
    )
  ),
  'STAKING_POSITION_COMMAND_ID_CONFLICT',
  'different payload with same command conflicts'
);

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '3000',
      '00000000-0000-4000-8000-000000054003',
      '00000000-0000-4000-8000-000000053005'
    )
  ),
  'APPLIED',
  'same user can create a second position for the product'
);

reset role;

select extensions.is(
  (
    select count(*)::integer
    from private.staking_positions
    where user_id = '00000000-0000-4000-8000-000000050002'
      and staking_product_id = (select staking_product_id from staking_position_product_active_result)
  ),
  2,
  'multiple positions per user and product are allowed'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050002', 'aal1');
set local role authenticated;

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '999',
      '00000000-0000-4000-8000-000000054004',
      '00000000-0000-4000-8000-000000053006'
    )
  ),
  'STAKING_POSITION_BELOW_MINIMUM',
  'position principal minimum is enforced per position'
);

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '9500',
      '00000000-0000-4000-8000-000000054005',
      '00000000-0000-4000-8000-000000053007'
    )
  ),
  'STAKING_POSITION_ABOVE_MAXIMUM',
  'position principal maximum is enforced per position'
);

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '6000',
      '00000000-0000-4000-8000-000000054006',
      '00000000-0000-4000-8000-000000053008'
    )
  ),
  'STAKING_POSITION_INSUFFICIENT_AVAILABLE',
  'available balance precheck is enforced'
);

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      999,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '1000',
      '00000000-0000-4000-8000-000000054007',
      '00000000-0000-4000-8000-000000053009'
    )
  ),
  'STAKING_PRODUCT_VERSION_CONFLICT',
  'product expected version is enforced'
);

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      999,
      '1000',
      '00000000-0000-4000-8000-000000054008',
      '00000000-0000-4000-8000-000000053010'
    )
  ),
  'STAKING_WALLET_VERSION_CONFLICT',
  'wallet expected version is enforced'
);

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050003'
      ),
      1,
      '1000',
      '00000000-0000-4000-8000-000000054009',
      '00000000-0000-4000-8000-000000053011'
    )
  ),
  'STAKING_WALLET_FORBIDDEN',
  'user cannot submit another wallet'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050001', 'aal2');

select extensions.is(
  (
    select result_code
    from public.transition_staking_product_status(
      (select staking_product_id from staking_position_product_active_result),
      2,
      'SUSPENDED',
      '00000000-0000-4000-8000-000000053012',
      'suspend product for position boundary'
    )
  ),
  'APPLIED',
  'fixture product suspended'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050002', 'aal1');

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_product_active_result),
      3,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '1000',
      '00000000-0000-4000-8000-000000054010',
      '00000000-0000-4000-8000-000000053013'
    )
  ),
  'STAKING_PRODUCT_NOT_ACTIVE',
  'suspended product cannot create new position'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050001', 'aal2');

create temp table staking_position_upcoming_product as
select *
from public.create_staking_product(
  '00000000-0000-4000-8000-000000051001',
  '00000000-0000-4000-8000-000000052001',
  'POSITION_UPCOMING',
  'Position Upcoming',
  null,
  45,
  '1000',
  null,
  15000,
  now() + interval '1 day',
  now() + interval '45 days',
  '00000000-0000-4000-8000-000000053014',
  'create upcoming product'
);

select extensions.is(
  (
    select result_code
    from public.transition_staking_product_status(
      (select staking_product_id from staking_position_upcoming_product),
      1,
      'ACTIVE',
      '00000000-0000-4000-8000-000000053015',
      'activate upcoming product'
    )
  ),
  'APPLIED',
  'upcoming product activates'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050002', 'aal1');

select extensions.is(
  (
    select result_code
    from public.create_user_staking_position(
      (select staking_product_id from staking_position_upcoming_product),
      2,
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      1,
      '1000',
      '00000000-0000-4000-8000-000000054011',
      '00000000-0000-4000-8000-000000053016'
    )
  ),
  'STAKING_ENROLLMENT_NOT_OPEN',
  'upcoming enrollment cannot create position'
);

select extensions.is(
  (
    select count(*)::integer
    from public.list_current_user_staking_positions(100)
  ),
  2,
  'user read returns own positions'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050003', 'aal1');

select extensions.is(
  (
    select count(*)::integer
    from public.list_current_user_staking_positions(100)
  ),
  0,
  'user read hides other positions'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050002', 'aal2');

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.list_admin_staking_positions(100);
    raise exception 'expected user admin read denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'user cannot read admin position catalog'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050001', 'aal1');

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.list_admin_staking_positions(100);
    raise exception 'expected aal1 admin read denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'AAL1 admin cannot read admin position catalog'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050001', 'aal2');

select extensions.is(
  (
    select count(*)::integer
    from public.list_admin_staking_positions(100)
  ),
  2,
  'AAL2 admin can read positions'
);

select extensions.is(
  (
    select count(*)::integer
    from public.list_staking_position_command_audit_events(100)
  ),
  2,
  'AAL2 admin can read position audit summaries'
);

select extensions.ok(
  not exists (
    select 1
    from public.list_staking_position_command_audit_events(100) as events
    where events.reason <> 'USER_STAKING_POSITION'
      or events.principal_units is null
      or events.resulting_status <> 'LOCKED'
  ),
  'audit read exposes safe summary fields'
);

reset role;

set constraints all immediate;

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.staking_positions
    set status = 'LOCKED'
    where id = '00000000-0000-4000-8000-000000054001';
    raise exception 'expected update denial';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'position update is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    delete from private.staking_positions
    where id = '00000000-0000-4000-8000-000000054001';
    raise exception 'expected delete denial';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'position delete is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    truncate private.staking_positions cascade;
    raise exception 'expected truncate denial';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'position truncate is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.staking_position_command_audit_events
    set outcome = 'APPLIED';
    raise exception 'expected audit update denial';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'position audit update is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    delete from private.staking_position_command_audit_events;
    raise exception 'expected audit delete denial';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'position audit delete is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    truncate private.staking_position_command_audit_events;
    raise exception 'expected audit truncate denial';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'position audit truncate is blocked'
);

set constraints all deferred;

select extensions.lives_ok(
  $_$
  do $$
  declare
    bad_journal_id uuid;
    bad_posted_at timestamptz;
    available_account_id uuid;
    locked_account_id uuid;
  begin
    select
      (max(accounts.ledger_account_id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
      (max(accounts.ledger_account_id::text) filter (where accounts.account_purpose = 'USER_LOCKED'))::uuid
      into available_account_id, locked_account_id
    from private.ensure_wallet_asset_ledger_accounts(
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      '00000000-0000-4000-8000-000000052001'
    ) as accounts;

    select posted.journal_id, posted.posted_at
      into bad_journal_id, bad_posted_at
    from private.post_ledger_journal(
      '00000000-0000-4000-8000-000000053017',
      '00000000-0000-4000-8000-000000052001',
      'BAD_STAKING_POSITION_LOCK',
      'USER',
      '00000000-0000-4000-8000-000000050002',
      'STAKING_POSITION',
      '00000000-0000-4000-8000-000000054012',
      'USER_STAKING_POSITION',
      jsonb_build_array(
        jsonb_build_object('account_id', available_account_id::text, 'side', 'DEBIT', 'units', '1000'),
        jsonb_build_object('account_id', locked_account_id::text, 'side', 'CREDIT', 'units', '1000')
      )
    ) as posted;

    insert into private.staking_positions (
      id,
      staking_product_id,
      project_id,
      asset_id,
      wallet_account_id,
      user_id,
      principal_units,
      lock_journal_id,
      product_version_snapshot,
      lock_duration_days_snapshot,
      term_reward_rate_ppm_snapshot,
      reward_rounding_mode_snapshot,
      locked_at,
      matures_at
    )
    values (
      '00000000-0000-4000-8000-000000054012',
      (select staking_product_id from staking_position_product_active_result),
      '00000000-0000-4000-8000-000000051001',
      '00000000-0000-4000-8000-000000052001',
      (
        select wallet_account_id
        from staking_position_wallet_fixture
        where user_id = '00000000-0000-4000-8000-000000050002'
      ),
      '00000000-0000-4000-8000-000000050002',
      '1000',
      bad_journal_id,
      2,
      30,
      25000,
      'FLOOR',
      bad_posted_at,
      bad_posted_at + interval '30 days'
    );

    set constraints private.validate_staking_position_invariants immediate;
    raise exception 'expected invariant denial';
  exception
    when check_violation then
      set constraints all immediate;
  end;
  $$;
  $_$,
  'deferred position invariant blocks wrong journal type'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where accounts.account_purpose = 'SYSTEM_REWARD_EXPENSE'
  ),
  0,
  'reward expense posting remains zero'
);

select * from extensions.finish();

rollback;
