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

select extensions.has_column(
  'private',
  'staking_positions',
  'unlock_journal_id',
  'staking position unlock journal column exists'
);

select extensions.has_column(
  'private',
  'staking_positions',
  'unlocked_at',
  'staking position unlocked timestamp column exists'
);

select extensions.has_function(
  'public',
  'unlock_current_user_staking_position',
  array['uuid', 'bigint', 'bigint', 'uuid'],
  'user unlock RPC exists'
);

select extensions.has_function(
  'public',
  'unlock_staking_position_as_admin',
  array['uuid', 'bigint', 'uuid', 'text'],
  'admin unlock RPC exists'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.unlock_current_user_staking_position(uuid, bigint, bigint, uuid)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.unlock_current_user_staking_position(uuid, bigint, bigint, uuid)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.unlock_staking_position_as_admin(uuid, bigint, uuid, text)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.unlock_staking_position_as_admin(uuid, bigint, uuid, text)'::regprocedure,
      'execute'
    ),
  'unlock RPC execute grants are authenticated-only'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'unlock_current_user_staking_position',
        'unlock_staking_position_as_admin'
      )
      and (
        not prosecdef
        or coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
      )
  ),
  'unlock RPCs are security definer with empty search_path'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'staking_position_command_audit_events'
      and indexname = 'staking_position_audit_unlock_applied_once_uidx'
  ),
  'unlock audit applied-once index exists'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000070001',
  'staking-unlock-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000070002',
  'staking-unlock-user@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000070003',
  'staking-unlock-other@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000070001',
  'ADMIN',
  'staking position unlock pgTAP fixture'
);

insert into public.projects (
  id,
  project_code,
  display_name,
  description,
  status
)
values (
  '00000000-0000-4000-8000-000000071001',
  'UNLOCKPROJECT',
  'Unlock Project',
  'staking position unlock fixture',
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
  '00000000-0000-4000-8000-000000072001',
  'UNLOCKSPL',
  'ULK',
  'Unlock SPL',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111171',
  'ACTIVE'
);

insert into public.project_token_assignments (project_id, asset_id)
values (
  '00000000-0000-4000-8000-000000071001',
  '00000000-0000-4000-8000-000000072001'
);

create temp table staking_position_unlock_wallet_fixture as
select
  wallet_accounts.user_id,
  wallet_accounts.id as wallet_account_id,
  wallet_accounts.version
from public.wallet_accounts as wallet_accounts
where wallet_accounts.user_id = '00000000-0000-4000-8000-000000070002';

grant select on staking_position_unlock_wallet_fixture to authenticated;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000070001', 'aal2');
set local role authenticated;

create temp table staking_position_unlock_product_result as
select *
from public.create_staking_product(
  '00000000-0000-4000-8000-000000071001',
  '00000000-0000-4000-8000-000000072001',
  'UNLOCK_PRODUCT_A',
  'Unlock Product A',
  'unlock staking product',
  1,
  '1000',
  '9000',
  25000,
  now() - interval '1 hour',
  now() + interval '30 days',
  '00000000-0000-4000-8000-000000073001',
  'create unlock position product'
);

create temp table staking_position_unlock_product_active_result as
select *
from public.transition_staking_product_status(
  (select staking_product_id from staking_position_unlock_product_result),
  1,
  'ACTIVE',
  '00000000-0000-4000-8000-000000073002',
  'activate unlock position product'
);

create temp table staking_position_unlock_opening_result as
select *
from public.post_opening_balance(
  (
    select wallet_account_id
    from staking_position_unlock_wallet_fixture
    where user_id = '00000000-0000-4000-8000-000000070002'
  ),
  1,
  '00000000-0000-4000-8000-000000072001',
  1,
  '10000',
  '00000000-0000-4000-8000-000000073003',
  'opening for staking unlock'
);

reset role;

create function pg_temp.insert_matured_position(
  test_position_id uuid,
  test_lock_journal_id uuid,
  test_command_id uuid,
  test_units text
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
  from staking_position_unlock_wallet_fixture
  where user_id = '00000000-0000-4000-8000-000000070002';

  select staking_product_id, entity_version
    into v_staking_product_id, v_product_version
  from staking_position_unlock_product_active_result;

  perform private.ensure_wallet_asset_ledger_accounts(
    v_wallet_account_id,
    '00000000-0000-4000-8000-000000072001'
  );

  select
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_LOCKED'))::uuid
    into v_available_account_id, v_locked_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = v_wallet_account_id
    and accounts.asset_id = '00000000-0000-4000-8000-000000072001'
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
    '00000000-0000-4000-8000-000000072001',
    'USER_STAKING_POSITION_LOCKED',
    'USER',
    '00000000-0000-4000-8000-000000070002',
    'STAKING_POSITION',
    test_position_id,
    'USER_STAKING_POSITION',
    jsonb_build_object('fixture', 'staking_position_unlock'),
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
    '00000000-0000-4000-8000-000000071001',
    '00000000-0000-4000-8000-000000072001',
    v_wallet_account_id,
    '00000000-0000-4000-8000-000000070002',
    test_units::numeric::private.positive_atomic_units,
    'LOCKED',
    test_lock_journal_id,
    v_product_version,
    1,
    25000,
    'FLOOR',
    v_locked_at,
    v_locked_at + interval '1 day'
  );
end;
$$;

select pg_temp.insert_matured_position(
  '00000000-0000-4000-8000-000000074001',
  '00000000-0000-4000-8000-000000073004',
  '00000000-0000-4000-8000-000000073005',
  '2000'
);

set constraints all immediate;
set constraints all deferred;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000070003', 'aal1');
set local role authenticated;

create temp table staking_position_unlock_forbidden_result as
select *
from public.unlock_current_user_staking_position(
  '00000000-0000-4000-8000-000000074001',
  1,
  1,
  '00000000-0000-4000-8000-000000073006'
);

reset role;

select extensions.is(
  (select result_code from staking_position_unlock_forbidden_result),
  'STAKING_POSITION_FORBIDDEN',
  'other user cannot unlock a position'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000070002', 'aal1');
set local role authenticated;

create temp table staking_position_unlock_user_result as
select *
from public.unlock_current_user_staking_position(
  '00000000-0000-4000-8000-000000074001',
  1,
  1,
  '00000000-0000-4000-8000-000000073007'
);

create temp table staking_position_unlock_user_replay_result as
select *
from public.unlock_current_user_staking_position(
  '00000000-0000-4000-8000-000000074001',
  1,
  1,
  '00000000-0000-4000-8000-000000073007'
);

create temp table staking_position_unlock_user_noop_result as
select *
from public.unlock_current_user_staking_position(
  '00000000-0000-4000-8000-000000074001',
  2,
  1,
  '00000000-0000-4000-8000-000000073008'
);

create temp table staking_position_unlock_user_conflict_result as
select *
from public.unlock_current_user_staking_position(
  '00000000-0000-4000-8000-000000074001',
  2,
  1,
  '00000000-0000-4000-8000-000000073007'
);

reset role;

select extensions.is(
  (select result_code from staking_position_unlock_user_result),
  'APPLIED',
  'active user can unlock matured principal'
);

select extensions.is(
  (select position_status from staking_position_unlock_user_result),
  'UNLOCKED',
  'user unlock returns unlocked status'
);

select extensions.is(
  (select maturity_state from staking_position_unlock_user_result),
  'UNLOCKED',
  'user unlock returns unlocked maturity state'
);

select extensions.is(
  (select position_version from staking_position_unlock_user_result),
  2::bigint,
  'user unlock increments position version once'
);

select extensions.ok(
  (
    select unlock_journal_id is not null
      and unlock_actor_type = 'USER'
      and unlocked_by = user_id
      and unlocked_at >= matures_at
    from private.staking_positions
    where id = '00000000-0000-4000-8000-000000074001'
  ),
  'user unlock connects actor, journal, and database timestamp'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    join private.staking_positions as positions
      on positions.unlock_journal_id = entries.journal_id
    where positions.id = '00000000-0000-4000-8000-000000074001'
      and entries.units = 2000
      and (
        (
          entries.side = 'DEBIT'
          and accounts.account_purpose = 'USER_LOCKED'
        )
        or (
          entries.side = 'CREDIT'
          and accounts.account_purpose = 'USER_AVAILABLE'
        )
      )
  ),
  2,
  'user unlock journal moves principal from locked to available'
);

select extensions.is(
  (select replayed from staking_position_unlock_user_replay_result),
  true,
  'same user unlock command replays'
);

select extensions.is(
  (select result_code from staking_position_unlock_user_noop_result),
  'NOOP',
  'new command on already unlocked position records noop'
);

select extensions.is(
  (select result_code from staking_position_unlock_user_conflict_result),
  'STAKING_POSITION_COMMAND_ID_CONFLICT',
  'same command id with different boundary conflicts'
);

select extensions.is(
  (
    select count(*)::integer
    from private.staking_position_command_audit_events
    where staking_position_id = '00000000-0000-4000-8000-000000074001'
      and action = 'UNLOCK_STAKING_POSITION'
      and outcome = 'APPLIED'
  ),
  1,
  'only one applied unlock audit row exists per position'
);

select pg_temp.insert_matured_position(
  '00000000-0000-4000-8000-000000074002',
  '00000000-0000-4000-8000-000000073009',
  '00000000-0000-4000-8000-000000073010',
  '1000'
);

update public.profiles
set account_status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-000000070002';

update public.wallet_accounts
set status = 'FROZEN'
where user_id = '00000000-0000-4000-8000-000000070002';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000070001', 'aal1');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.unlock_staking_position_as_admin(
      '00000000-0000-4000-8000-000000074002',
      1,
      '00000000-0000-4000-8000-000000073011',
      'admin aal1 blocked'
    );
    raise exception 'expected aal2 denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'admin unlock requires AAL2'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000070001', 'aal2');
set local role authenticated;

create temp table staking_position_unlock_admin_result as
select *
from public.unlock_staking_position_as_admin(
  '00000000-0000-4000-8000-000000074002',
  1,
  '00000000-0000-4000-8000-000000073012',
  'admin matured target cleanup'
);

create temp table staking_position_unlock_admin_noop_result as
select *
from public.unlock_staking_position_as_admin(
  '00000000-0000-4000-8000-000000074002',
  2,
  '00000000-0000-4000-8000-000000073013',
  'admin matured target cleanup noop'
);

reset role;

select extensions.is(
  (select result_code from staking_position_unlock_admin_result),
  'APPLIED',
  'AAL2 admin can unlock matured inactive target'
);

select extensions.ok(
  (
    select unlock_actor_type = 'ADMIN'
      and unlocked_by = '00000000-0000-4000-8000-000000070001'
      and status = 'UNLOCKED'
    from private.staking_positions
    where id = '00000000-0000-4000-8000-000000074002'
  ),
  'admin unlock records admin actor'
);

select extensions.is(
  (select result_code from staking_position_unlock_admin_noop_result),
  'NOOP',
  'admin new command on already unlocked position records noop'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000070001', 'aal2');
set local role authenticated;

select extensions.ok(
  exists (
    select 1
    from public.list_admin_staking_positions(100, 'UNLOCKED') as positions
    where positions.staking_position_id = '00000000-0000-4000-8000-000000074002'
      and positions.maturity_state = 'UNLOCKED'
      and positions.unlock_actor_type = 'ADMIN'
      and positions.unlocked_by = '00000000-0000-4000-8000-000000070001'
  ),
  'admin read exposes unlock summary'
);

select extensions.ok(
  exists (
    select 1
    from public.list_staking_position_command_audit_events(100, null) as events
    where events.action = 'UNLOCK_STAKING_POSITION'
      and events.actor_type = 'ADMIN'
      and events.previous_status = 'LOCKED'
      and events.resulting_status = 'UNLOCKED'
      and events.resulting_journal_id is not null
  ),
  'admin audit read exposes unlock summary without request data'
);

reset role;

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.staking_positions
    set status = 'LOCKED'
    where id = '00000000-0000-4000-8000-000000074002';
    raise exception 'expected unlocked immutability block';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'unlocked position cannot transition back to locked'
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
  'principal unlock does not post rewards'
);

select * from extensions.finish();

rollback;
