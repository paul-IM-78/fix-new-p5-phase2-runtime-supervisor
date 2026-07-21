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

select extensions.has_function(
  'private',
  'calculate_staking_reward_units',
  array['numeric', 'integer', 'text'],
  'reward calculation function exists'
);

select extensions.has_table(
  'private',
  'staking_position_reward_settlements',
  'reward settlement table exists'
);

select extensions.has_table(
  'private',
  'staking_reward_command_audit_events',
  'reward command audit table exists'
);

select extensions.has_function(
  'public',
  'settle_current_user_staking_reward',
  array['uuid', 'bigint', 'bigint', 'uuid'],
  'user reward settlement RPC exists'
);

select extensions.has_function(
  'public',
  'settle_staking_reward_as_admin',
  array['uuid', 'bigint', 'uuid', 'text'],
  'admin reward settlement RPC exists'
);

select extensions.has_function(
  'public',
  'list_staking_reward_command_audit_events',
  array['integer', 'uuid'],
  'reward audit read RPC exists'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.settle_current_user_staking_reward(uuid, bigint, bigint, uuid)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.settle_current_user_staking_reward(uuid, bigint, bigint, uuid)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.settle_staking_reward_as_admin(uuid, bigint, uuid, text)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.settle_staking_reward_as_admin(uuid, bigint, uuid, text)'::regprocedure,
      'execute'
    ),
  'reward settlement RPC grants are authenticated-only'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and proname in (
        'calculate_staking_reward_units',
        'ensure_staking_reward_expense_account',
        'settle_current_user_staking_reward',
        'settle_staking_reward_as_admin',
        'list_staking_reward_command_audit_events'
      )
      and (
        not prosecdef
        or coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
      )
  ),
  'reward functions are security definer with empty search_path'
);

select extensions.is(
  private.calculate_staking_reward_units(2000, 250000, 'FLOOR'),
  500::numeric,
  'reward formula uses floor principal times ppm'
);

select extensions.is(
  private.calculate_staking_reward_units(3, 333333, 'FLOOR'),
  0::numeric,
  'reward formula permits zero reward after floor'
);

select extensions.is(
  private.calculate_staking_reward_units(9007199254740993, 1000000, 'FLOOR'),
  9007199254740993::numeric,
  'reward formula supports values above JavaScript safe integer'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000080001',
  'staking-reward-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000080002',
  'staking-reward-user@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000080003',
  'staking-reward-other@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000080001',
  'ADMIN',
  'staking reward pgTAP fixture'
);

insert into public.projects (
  id,
  project_code,
  display_name,
  description,
  status
)
values (
  '00000000-0000-4000-8000-000000081001',
  'REWARDPROJECT',
  'Reward Project',
  'staking reward fixture',
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
  '00000000-0000-4000-8000-000000082001',
  'REWARDSPL',
  'RWD',
  'Reward SPL',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111181',
  'ACTIVE'
);

insert into public.project_token_assignments (project_id, asset_id)
values (
  '00000000-0000-4000-8000-000000081001',
  '00000000-0000-4000-8000-000000082001'
);

create temp table staking_reward_wallet_fixture as
select
  wallet_accounts.user_id,
  wallet_accounts.id as wallet_account_id,
  wallet_accounts.version
from public.wallet_accounts as wallet_accounts
where wallet_accounts.user_id in (
  '00000000-0000-4000-8000-000000080002',
  '00000000-0000-4000-8000-000000080003'
);

grant select on staking_reward_wallet_fixture to authenticated;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000080001', 'aal2');
set local role authenticated;

create temp table staking_reward_product_result as
select *
from public.create_staking_product(
  '00000000-0000-4000-8000-000000081001',
  '00000000-0000-4000-8000-000000082001',
  'REWARD_PRODUCT_A',
  'Reward Product A',
  'reward staking product',
  1,
  '1',
  '99999999999999999999999999999999999999',
  250000,
  now() - interval '1 hour',
  now() + interval '30 days',
  '00000000-0000-4000-8000-000000083001',
  'create reward product'
);

create temp table staking_reward_product_active_result as
select *
from public.transition_staking_product_status(
  (select staking_product_id from staking_reward_product_result),
  1,
  'ACTIVE',
  '00000000-0000-4000-8000-000000083002',
  'activate reward product'
);

create temp table staking_reward_opening_result as
select *
from public.post_opening_balance(
  (
    select wallet_account_id
    from staking_reward_wallet_fixture
    where user_id = '00000000-0000-4000-8000-000000080002'
  ),
  1,
  '00000000-0000-4000-8000-000000082001',
  1,
  '100000',
  '00000000-0000-4000-8000-000000083003',
  'opening for staking reward'
);

reset role;

create function pg_temp.insert_matured_position(
  test_position_id uuid,
  test_lock_journal_id uuid,
  test_command_id uuid,
  test_units text,
  test_reward_rate_ppm integer,
  test_user_id uuid default '00000000-0000-4000-8000-000000080002'
)
returns void
language plpgsql
as $$
declare
  v_wallet_account_id uuid;
  v_staking_product_id uuid;
  v_product_version bigint;
  v_available_account_id uuid;
  v_locked_account_id uuid;
  v_locked_at timestamptz;
begin
  select wallet_account_id
    into v_wallet_account_id
  from staking_reward_wallet_fixture
  where user_id = test_user_id;

  select staking_product_id, entity_version
    into v_staking_product_id, v_product_version
  from staking_reward_product_active_result;

  perform private.ensure_wallet_asset_ledger_accounts(
    v_wallet_account_id,
    '00000000-0000-4000-8000-000000082001'
  );

  select
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_LOCKED'))::uuid
    into v_available_account_id, v_locked_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = v_wallet_account_id
    and accounts.asset_id = '00000000-0000-4000-8000-000000082001'
    and accounts.account_purpose in ('USER_AVAILABLE', 'USER_LOCKED');

  v_locked_at := clock_timestamp() - interval '2 days';

  insert into private.ledger_journals (
    id,
    command_id,
    asset_id,
    journal_type,
    initiator_type,
    initiator_user_id,
    reference_type,
    reference_id,
    reason,
    request_data,
    posted_at
  )
  values (
    test_lock_journal_id,
    test_command_id,
    '00000000-0000-4000-8000-000000082001',
    'USER_STAKING_POSITION_LOCKED',
    'USER',
    test_user_id,
    'STAKING_POSITION',
    test_position_id,
    'USER_STAKING_POSITION',
    jsonb_build_object('fixture', 'staking_reward_settlement'),
    v_locked_at
  );

  insert into private.ledger_entries (
    journal_id,
    line_no,
    ledger_account_id,
    side,
    units
  )
  values
    (
      test_lock_journal_id,
      1,
      v_available_account_id,
      'DEBIT',
      test_units::numeric::private.positive_atomic_units
    ),
    (
      test_lock_journal_id,
      2,
      v_locked_account_id,
      'CREDIT',
      test_units::numeric::private.positive_atomic_units
    );

  insert into private.staking_positions (
    id,
    staking_product_id,
    project_id,
    asset_id,
    wallet_account_id,
    user_id,
    principal_units,
    status,
    lock_journal_id,
    product_version_snapshot,
    lock_duration_days_snapshot,
    term_reward_rate_ppm_snapshot,
    reward_rounding_mode_snapshot,
    locked_at,
    matures_at
  )
  values (
    test_position_id,
    v_staking_product_id,
    '00000000-0000-4000-8000-000000081001',
    '00000000-0000-4000-8000-000000082001',
    v_wallet_account_id,
    test_user_id,
    test_units::numeric::private.positive_atomic_units,
    'LOCKED',
    test_lock_journal_id,
    v_product_version,
    1,
    test_reward_rate_ppm,
    'FLOOR',
    v_locked_at,
    v_locked_at + interval '1 day'
  );
end;
$$;

select pg_temp.insert_matured_position(
  '00000000-0000-4000-8000-000000084001',
  '00000000-0000-4000-8000-000000083004',
  '00000000-0000-4000-8000-000000083005',
  '2000',
  250000
);

select pg_temp.insert_matured_position(
  '00000000-0000-4000-8000-000000084002',
  '00000000-0000-4000-8000-000000083006',
  '00000000-0000-4000-8000-000000083007',
  '3',
  250000
);

select pg_temp.insert_matured_position(
  '00000000-0000-4000-8000-000000084003',
  '00000000-0000-4000-8000-000000083008',
  '00000000-0000-4000-8000-000000083009',
  '1000',
  250000
);

set constraints all immediate;
set constraints all deferred;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000080002', 'aal1');
set local role authenticated;

create temp table staking_reward_unlock_positive as
select *
from public.unlock_current_user_staking_position(
  '00000000-0000-4000-8000-000000084001',
  1,
  1,
  '00000000-0000-4000-8000-000000083010'
);

create temp table staking_reward_unlock_zero as
select *
from public.unlock_current_user_staking_position(
  '00000000-0000-4000-8000-000000084002',
  1,
  1,
  '00000000-0000-4000-8000-000000083011'
);

reset role;

create temp table staking_reward_balance_before as
select available_units, locked_units, total_liability_units
from private.wallet_asset_ledger_balances
where wallet_account_id = (
  select wallet_account_id
  from staking_reward_wallet_fixture
  where user_id = '00000000-0000-4000-8000-000000080002'
)
  and asset_id = '00000000-0000-4000-8000-000000082001';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000080002', 'aal1');
set local role authenticated;

create temp table staking_reward_user_positive_result as
select *
from public.settle_current_user_staking_reward(
  '00000000-0000-4000-8000-000000084001',
  2,
  1,
  '00000000-0000-4000-8000-000000083012'
);

create temp table staking_reward_user_positive_replay_result as
select *
from public.settle_current_user_staking_reward(
  '00000000-0000-4000-8000-000000084001',
  2,
  1,
  '00000000-0000-4000-8000-000000083012'
);

create temp table staking_reward_user_positive_noop_result as
select *
from public.settle_current_user_staking_reward(
  '00000000-0000-4000-8000-000000084001',
  2,
  1,
  '00000000-0000-4000-8000-000000083013'
);

create temp table staking_reward_user_positive_conflict_result as
select *
from public.settle_current_user_staking_reward(
  '00000000-0000-4000-8000-000000084002',
  2,
  1,
  '00000000-0000-4000-8000-000000083012'
);

create temp table staking_reward_user_zero_result as
select *
from public.settle_current_user_staking_reward(
  '00000000-0000-4000-8000-000000084002',
  2,
  1,
  '00000000-0000-4000-8000-000000083014'
);

create temp table staking_reward_locked_result as
select *
from public.settle_current_user_staking_reward(
  '00000000-0000-4000-8000-000000084003',
  1,
  1,
  '00000000-0000-4000-8000-000000083015'
);

create temp table staking_reward_position_command_collision_result as
select *
from public.settle_current_user_staking_reward(
  '00000000-0000-4000-8000-000000084003',
  1,
  1,
  '00000000-0000-4000-8000-000000083010'
);

reset role;

select extensions.is(
  (select result_code from staking_reward_user_positive_result),
  'APPLIED',
  'user reward settlement applies'
);

select extensions.is(
  (select settlement_outcome from staking_reward_user_positive_result),
  'PAID',
  'positive reward settlement outcome is paid'
);

select extensions.is(
  (select reward_units from staking_reward_user_positive_result),
  '500',
  'positive reward units come from snapshot formula'
);

select extensions.is(
  (select replayed from staking_reward_user_positive_replay_result),
  true,
  'same reward command replays'
);

select extensions.is(
  (select result_code from staking_reward_user_positive_noop_result),
  'NOOP',
  'new command on already settled reward records noop'
);

select extensions.is(
  (select result_code from staking_reward_user_positive_conflict_result),
  'STAKING_REWARD_COMMAND_ID_CONFLICT',
  'same reward command id with different boundary conflicts'
);

select extensions.is(
  (select settlement_outcome from staking_reward_user_zero_result),
  'ZERO',
  'zero reward settlement is final without error'
);

select extensions.is(
  (select reward_units from staking_reward_user_zero_result),
  '0',
  'zero reward returns zero atomic units'
);

select extensions.is(
  (
    select count(*)::integer
    from private.staking_position_reward_settlements
    where staking_position_id = '00000000-0000-4000-8000-000000084001'
  ),
  1,
  'position has at most one reward settlement'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    join private.staking_position_reward_settlements as settlements
      on settlements.reward_journal_id = entries.journal_id
    where settlements.staking_position_id = '00000000-0000-4000-8000-000000084001'
      and entries.units = 500
      and (
        (
          entries.side = 'DEBIT'
          and accounts.account_purpose = 'SYSTEM_REWARD_EXPENSE'
        )
        or (
          entries.side = 'CREDIT'
          and accounts.account_purpose = 'USER_AVAILABLE'
        )
      )
  ),
  2,
  'positive reward posts reward expense to user available'
);

select extensions.is(
  (
    select count(*)::integer
    from private.staking_position_reward_settlements
    where staking_position_id = '00000000-0000-4000-8000-000000084002'
      and outcome = 'ZERO'
      and reward_journal_id is null
  ),
  1,
  'zero reward settlement has no journal'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries as entries
    join private.staking_position_reward_settlements as settlements
      on settlements.reward_journal_id = entries.journal_id
    where settlements.staking_position_id = '00000000-0000-4000-8000-000000084002'
  ),
  0,
  'zero reward creates no ledger entries'
);

select extensions.ok(
  (
    select balances.available_units = before.available_units + 500
      and balances.total_liability_units = before.total_liability_units + 500
      and balances.locked_units = before.locked_units
    from private.wallet_asset_ledger_balances as balances
    cross join staking_reward_balance_before as before
    where balances.wallet_account_id = (
      select wallet_account_id
      from staking_reward_wallet_fixture
      where user_id = '00000000-0000-4000-8000-000000080002'
    )
      and balances.asset_id = '00000000-0000-4000-8000-000000082001'
  ),
  'reward increases available and total liability without changing locked'
);

select extensions.is(
  (select result_code from staking_reward_locked_result),
  'STAKING_REWARD_POSITION_NOT_UNLOCKED',
  'locked position cannot settle reward'
);

select extensions.is(
  (select result_code from staking_reward_position_command_collision_result),
  'STAKING_REWARD_COMMAND_ID_CONFLICT',
  'position command id collision is blocked'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000080003', 'aal1');
set local role authenticated;

create temp table staking_reward_forbidden_result as
select *
from public.settle_current_user_staking_reward(
  '00000000-0000-4000-8000-000000084003',
  1,
  1,
  '00000000-0000-4000-8000-000000083016'
);

reset role;

select extensions.is(
  (select result_code from staking_reward_forbidden_result),
  'STAKING_REWARD_FORBIDDEN',
  'other user cannot settle reward'
);

select pg_temp.insert_matured_position(
  '00000000-0000-4000-8000-000000084004',
  '00000000-0000-4000-8000-000000083017',
  '00000000-0000-4000-8000-000000083018',
  '1000',
  250000
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000080002', 'aal1');
set local role authenticated;

create temp table staking_reward_unlock_admin_target as
select *
from public.unlock_current_user_staking_position(
  '00000000-0000-4000-8000-000000084004',
  1,
  1,
  '00000000-0000-4000-8000-000000083019'
);

reset role;

update public.profiles
set account_status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000080002';

update public.wallet_accounts
set status = 'FROZEN'
where user_id = '00000000-0000-4000-8000-000000080002';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000080001', 'aal2');
set local role authenticated;

create temp table staking_reward_product_suspended_result as
select *
from public.transition_staking_product_status(
  (select staking_product_id from staking_reward_product_active_result),
  (select entity_version from staking_reward_product_active_result),
  'SUSPENDED',
  '00000000-0000-4000-8000-000000083022',
  'suspend reward product for admin settlement fixture'
);

reset role;

update public.projects
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000081001';

update public.supported_assets
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000082001';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000080001', 'aal1');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.settle_staking_reward_as_admin(
      '00000000-0000-4000-8000-000000084004',
      2,
      '00000000-0000-4000-8000-000000083020',
      'admin aal1 blocked'
    );
    raise exception 'expected aal2 denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'admin reward settlement requires AAL2'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000080001', 'aal2');
set local role authenticated;

create temp table staking_reward_admin_result as
select *
from public.settle_staking_reward_as_admin(
  '00000000-0000-4000-8000-000000084004',
  2,
  '00000000-0000-4000-8000-000000083021',
  'admin inactive target reward cleanup'
);

reset role;

select extensions.is(
  (select result_code from staking_reward_admin_result),
  'APPLIED',
  'AAL2 admin settles inactive target reward'
);

select extensions.is(
  (select settlement_outcome from staking_reward_admin_result),
  'PAID',
  'admin positive reward settlement is paid'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000080001', 'aal2');
set local role authenticated;

select extensions.ok(
  exists (
    select 1
    from public.list_admin_staking_positions(100, 'UNLOCKED') as positions
    where positions.staking_position_id = '00000000-0000-4000-8000-000000084004'
      and positions.reward_state = 'PAID'
      and positions.reward_settlement_id is not null
      and positions.reward_journal_id is not null
      and positions.reward_actor_type = 'ADMIN'
      and positions.calculated_reward_units = '250'
  ),
  'admin position read exposes reward settlement summary'
);

select extensions.ok(
  exists (
    select 1
    from public.list_staking_reward_command_audit_events(25, null) as events
    where events.action = 'SETTLE_STAKING_REWARD'
      and events.outcome = 'APPLIED'
      and events.actor_type = 'ADMIN'
      and events.settlement_outcome = 'PAID'
      and events.reward_units = '250'
  ),
  'admin reward audit read exposes safe reward summary'
);

reset role;

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.staking_position_reward_settlements
    set outcome = 'ZERO'
    where staking_position_id = '00000000-0000-4000-8000-000000084004';
    raise exception 'expected settlement immutability block';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'reward settlement is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    delete from private.staking_reward_command_audit_events
    where staking_position_id = '00000000-0000-4000-8000-000000084004';
    raise exception 'expected audit immutability block';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'reward audit is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  declare
    v_settlement private.staking_position_reward_settlements%rowtype;
  begin
    select *
      into v_settlement
    from private.staking_position_reward_settlements
    where staking_position_id = '00000000-0000-4000-8000-000000084004';

    insert into private.staking_position_reward_settlements (
      staking_position_id,
      staking_product_id,
      project_id,
      asset_id,
      wallet_account_id,
      user_id,
      position_version_snapshot,
      principal_units,
      term_reward_rate_ppm_snapshot,
      reward_rounding_mode_snapshot,
      reward_units,
      outcome,
      reward_journal_id,
      settled_by,
      actor_type
    )
    values (
      v_settlement.staking_position_id,
      v_settlement.staking_product_id,
      v_settlement.project_id,
      v_settlement.asset_id,
      v_settlement.wallet_account_id,
      v_settlement.user_id,
      v_settlement.position_version_snapshot,
      v_settlement.principal_units,
      v_settlement.term_reward_rate_ppm_snapshot,
      v_settlement.reward_rounding_mode_snapshot,
      v_settlement.reward_units,
      v_settlement.outcome,
      v_settlement.reward_journal_id,
      v_settlement.settled_by,
      v_settlement.actor_type
    );
    raise exception 'expected duplicate settlement block';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'position cannot receive a second reward settlement'
);

select * from extensions.finish();

rollback;
