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
  'staking_products',
  'staking products table exists'
);

select extensions.has_table(
  'private',
  'staking_product_admin_audit_events',
  'staking product audit table exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.staking_products'::regclass
      and tgname = 'validate_staking_product_transition'
      and not tgisinternal
  )
    and exists (
      select 1
      from pg_trigger
      where tgrelid = 'private.staking_product_admin_audit_events'::regclass
        and tgname = 'protect_staking_product_admin_audit_events'
        and not tgisinternal
    ),
  'staking product transition and audit immutability triggers exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'staking_products'
      and indexname = 'staking_products_active_term_uidx'
  )
    and exists (
      select 1
      from pg_indexes
      where schemaname = 'private'
        and tablename = 'staking_product_admin_audit_events'
        and indexname = 'staking_product_admin_audit_events_occurred_at_idx'
    ),
  'staking product unique term and audit cursor indexes exist'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_staking_product',
        'update_staking_product_draft',
        'transition_staking_product_status',
        'list_current_staking_products',
        'list_admin_staking_products',
        'list_staking_product_admin_audit_events'
      )
  ) = 6,
  'staking command and read RPCs exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_staking_product',
        'update_staking_product_draft',
        'transition_staking_product_status',
        'list_current_staking_products',
        'list_admin_staking_products',
        'list_staking_product_admin_audit_events'
      )
      and not prosecdef
  ),
  'staking RPCs are security definer'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_staking_product',
        'update_staking_product_draft',
        'transition_staking_product_status',
        'list_current_staking_products',
        'list_admin_staking_products',
        'list_staking_product_admin_audit_events'
      )
      and coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
  ),
  'staking RPCs use empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.create_staking_product(uuid, uuid, text, text, text, integer, text, text, integer, timestamptz, timestamptz, uuid, text)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.create_staking_product(uuid, uuid, text, text, text, integer, text, text, integer, timestamptz, timestamptz, uuid, text)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.list_current_staking_products(integer)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.list_current_staking_products(integer)'::regprocedure,
      'execute'
    ),
  'staking RPC execute grants are authenticated-only'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.staking_products', 'select')
    and not has_table_privilege('authenticated', 'private.staking_products', 'insert')
    and not has_table_privilege('anon', 'private.staking_product_admin_audit_events', 'select'),
  'staking private table direct access is blocked'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000030001',
  'staking-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000030002',
  'staking-user@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000030001',
  'ADMIN',
  'staking product pgTAP fixture'
);

insert into public.projects (
  id,
  project_code,
  display_name,
  description,
  status
)
values
  (
    '00000000-0000-4000-8000-000000031001',
    'STAKEP1',
    'Stake Project One',
    'staking project fixture',
    'DRAFT'
  ),
  (
    '00000000-0000-4000-8000-000000031002',
    'STAKEP2',
    'Stake Project Two',
    null,
    'DRAFT'
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
    '00000000-0000-4000-8000-000000032001',
    'STAKESPL1',
    'SP1',
    'Stake SPL One',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111131',
    'DRAFT'
  ),
  (
    '00000000-0000-4000-8000-000000032002',
    'STAKESPL2',
    'SP2',
    'Stake SPL Two',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111132',
    'DRAFT'
  ),
  (
    '00000000-0000-4000-8000-000000032003',
    'STAKENAT',
    'SOLX',
    'Stake Native',
    'NATIVE',
    9,
    null,
    'DRAFT'
  );

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000030002', 'aal2');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000031001',
      '00000000-0000-4000-8000-000000032001',
      'USER_BLOCK_STAKE',
      'User Block Stake',
      null,
      30,
      '1000',
      null,
      1000,
      now() + interval '1 day',
      now() + interval '30 days',
      '00000000-0000-4000-8000-000000033001',
      'blocked user staking command'
    );
    raise exception 'expected user denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'general USER cannot execute staking command'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000030001', 'aal1');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000031001',
      '00000000-0000-4000-8000-000000032001',
      'AAL1_BLOCK_STAKE',
      'AAL1 Block Stake',
      null,
      30,
      '1000',
      null,
      1000,
      now() + interval '1 day',
      now() + interval '30 days',
      '00000000-0000-4000-8000-000000033002',
      'blocked aal1 staking command'
    );
    raise exception 'expected aal1 denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'AAL1 ADMIN cannot execute staking command'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000030001', 'aal2');

create temp table staking_product_result as
select *
from public.create_staking_product(
  '00000000-0000-4000-8000-000000031001',
  '00000000-0000-4000-8000-000000032001',
  'STAKE_PRODUCT_A',
  'Stake Product A',
  'Draft staking product',
  30,
  '1000',
  '9000',
  25000,
  now() + interval '1 day',
  now() + interval '30 days',
  '00000000-0000-4000-8000-000000033010',
  'create staking product a'
);

select extensions.is(
  (select result_code from staking_product_result),
  'APPLIED',
  'staking product create applied'
);

select extensions.is(
  (
    select status
    from private.staking_products
    where product_code = 'STAKE_PRODUCT_A'
  ),
  'DRAFT',
  'staking product starts draft'
);

select extensions.is(
  (
    select result_code
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000031001',
      '00000000-0000-4000-8000-000000032001',
      'STAKE_PRODUCT_A',
      'Stake Product A',
      'Draft staking product',
      30,
      '1000',
      '9000',
      25000,
      (select enrollment_starts_at from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
      (select enrollment_ends_at from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
      '00000000-0000-4000-8000-000000033010',
      'create staking product a'
    )
  ),
  'APPLIED',
  'staking create replay returns original outcome'
);

select extensions.is(
  (
    select replayed
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000031001',
      '00000000-0000-4000-8000-000000032001',
      'STAKE_PRODUCT_A',
      'Stake Product A',
      'Draft staking product',
      30,
      '1000',
      '9000',
      25000,
      (select enrollment_starts_at from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
      (select enrollment_ends_at from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
      '00000000-0000-4000-8000-000000033010',
      'create staking product a'
    )
  ),
  true,
  'staking create replay is marked'
);

select extensions.is(
  (
    select result_code
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000031001',
      '00000000-0000-4000-8000-000000032001',
      'STAKE_PRODUCT_CONFLICT',
      'Stake Product Conflict',
      null,
      31,
      '1000',
      null,
      25000,
      now() + interval '1 day',
      now() + interval '31 days',
      '00000000-0000-4000-8000-000000033010',
      'different staking request'
    )
  ),
  'STAKING_PRODUCT_COMMAND_ID_CONFLICT',
  'staking command id conflict is blocked'
);

select extensions.is(
  (
    select result_code
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000031001',
      '00000000-0000-4000-8000-000000032001',
      'STAKE_PRODUCT_A',
      'Duplicate Code',
      null,
      31,
      '1000',
      null,
      25000,
      now() + interval '1 day',
      now() + interval '31 days',
      '00000000-0000-4000-8000-000000033011',
      'duplicate code'
    )
  ),
  'STAKING_PRODUCT_CODE_EXISTS',
  'staking product code is globally unique'
);

select extensions.is(
  (
    select result_code
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000031001',
      '00000000-0000-4000-8000-000000032001',
      'STAKE_PRODUCT_DUP',
      'Duplicate Term',
      null,
      30,
      '2000',
      null,
      30000,
      now() + interval '1 day',
      now() + interval '31 days',
      '00000000-0000-4000-8000-000000033012',
      'duplicate term'
    )
  ),
  'STAKING_PRODUCT_DUPLICATE_TERM',
  'unarchived duplicate project asset duration is blocked'
);

create temp table staking_product_ids as
select id, version
from private.staking_products
where product_code = 'STAKE_PRODUCT_A';

select extensions.is(
  (
    select result_code
    from public.transition_staking_product_status(
      (select id from staking_product_ids),
      (select version from staking_product_ids),
      'ACTIVE',
      '00000000-0000-4000-8000-000000033020',
      'activate before active boundary'
    )
  ),
  'STAKING_PROJECT_NOT_ACTIVE',
  'activation blocks inactive project'
);

reset role;

update public.projects
set status = 'ACTIVE'
where id = '00000000-0000-4000-8000-000000031001';

update public.supported_assets
set status = 'ACTIVE'
where id in (
  '00000000-0000-4000-8000-000000032001',
  '00000000-0000-4000-8000-000000032002',
  '00000000-0000-4000-8000-000000032003'
);

insert into public.project_token_assignments (
  project_id,
  asset_id
)
values (
  '00000000-0000-4000-8000-000000031001',
  '00000000-0000-4000-8000-000000032001'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000030001', 'aal2');

create temp table staking_update_result as
select *
from public.update_staking_product_draft(
  (select id from staking_product_ids),
  (select version from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
  '00000000-0000-4000-8000-000000031001',
  '00000000-0000-4000-8000-000000032001',
  'Stake Product A Updated',
  'Updated draft staking product',
  31,
  '1100',
  '9900',
  26000,
  now() + interval '2 days',
  now() + interval '32 days',
  '00000000-0000-4000-8000-000000033021',
  'update staking product draft'
);

select extensions.is(
  (select result_code from staking_update_result),
  'APPLIED',
  'draft update applied'
);

select extensions.is(
  (
    select result_code
    from public.update_staking_product_draft(
      (select id from staking_product_ids),
      1,
      '00000000-0000-4000-8000-000000031001',
      '00000000-0000-4000-8000-000000032001',
      'Stake Product A Stale',
      null,
      31,
      '1100',
      null,
      26000,
      now() + interval '2 days',
      now() + interval '32 days',
      '00000000-0000-4000-8000-000000033022',
      'stale draft update'
    )
  ),
  'STAKING_PRODUCT_VERSION_CONFLICT',
  'draft update expected version is enforced'
);

create temp table staking_activate_result as
select *
from public.transition_staking_product_status(
  (select id from staking_product_ids),
  (select version from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
  'ACTIVE',
  '00000000-0000-4000-8000-000000033023',
  'activate staking product'
);

select extensions.is(
  (select result_code from staking_activate_result),
  'APPLIED',
  'staking product activation applied'
);

select extensions.ok(
  (
    select activated_at is not null and status = 'ACTIVE'
    from private.staking_products
    where product_code = 'STAKE_PRODUCT_A'
  ),
  'activation stamps activated_at'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_journals
  ),
  0,
  'staking product commands do not post ledger journals'
);

select extensions.is(
  (
    select result_code
    from public.update_staking_product_draft(
      (select id from staking_product_ids),
      (select version from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
      '00000000-0000-4000-8000-000000031001',
      '00000000-0000-4000-8000-000000032001',
      'Should Not Update',
      null,
      31,
      '1100',
      null,
      26000,
      now() + interval '2 days',
      now() + interval '32 days',
      '00000000-0000-4000-8000-000000033024',
      'blocked activated update'
    )
  ),
  'STAKING_PRODUCT_NOT_DRAFT',
  'activated product draft update is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.staking_products
    set display_name = 'Direct Mutated Name'
    where product_code = 'STAKE_PRODUCT_A';
    raise exception 'expected term lock';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'direct term mutation after activation is blocked'
);

select extensions.is(
  (
    select result_code
    from public.transition_staking_product_status(
      (select id from staking_product_ids),
      (select version from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
      'ACTIVE',
      '00000000-0000-4000-8000-000000033025',
      'same status noop'
    )
  ),
  'NOOP',
  'same status transition is noop'
);

select extensions.is(
  (
    select result_code
    from public.transition_staking_product_status(
      (select id from staking_product_ids),
      (select version from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
      'ARCHIVED',
      '00000000-0000-4000-8000-000000033026',
      'active archive invalid'
    )
  ),
  'STAKING_PRODUCT_TRANSITION_INVALID',
  'ACTIVE to ARCHIVED is blocked'
);

select public.transition_staking_product_status(
  (select id from staking_product_ids),
  (select version from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
  'SUSPENDED',
  '00000000-0000-4000-8000-000000033027',
  'suspend staking product'
);

select public.transition_staking_product_status(
  (select id from staking_product_ids),
  (select version from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
  'ACTIVE',
  '00000000-0000-4000-8000-000000033028',
  'resume staking product'
);

select public.transition_staking_product_status(
  (select id from staking_product_ids),
  (select version from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
  'SUSPENDED',
  '00000000-0000-4000-8000-000000033029',
  'suspend before archive'
);

create temp table archive_result as
select *
from public.transition_staking_product_status(
  (select id from staking_product_ids),
  (select version from private.staking_products where product_code = 'STAKE_PRODUCT_A'),
  'ARCHIVED',
  '00000000-0000-4000-8000-000000033030',
  'archive suspended product'
);

select extensions.is(
  (select result_code from archive_result),
  'APPLIED',
  'SUSPENDED to ARCHIVED is allowed'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.staking_products
    set status = 'ACTIVE'
    where product_code = 'STAKE_PRODUCT_A';
    raise exception 'expected archived terminal block';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'archived product is terminal'
);

select extensions.is(
  (
    select count(*)::integer
    from private.staking_product_admin_audit_events
    where outcome = 'APPLIED'
  ) > 0,
  true,
  'staking audit stores applied events'
);

select extensions.is(
  (
    select count(*)::integer
    from private.staking_product_admin_audit_events
    where outcome = 'NOOP'
  ) > 0,
  true,
  'staking audit stores noop events'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.staking_product_admin_audit_events
    set reason = 'changed';
    raise exception 'expected audit update failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'staking audit update is blocked'
);

create temp table product_native as
select *
from public.create_staking_product(
  '00000000-0000-4000-8000-000000031001',
  '00000000-0000-4000-8000-000000032003',
  'STAKE_PRODUCT_NATIVE',
  'Native Product',
  null,
  40,
  '1000',
  null,
  20000,
  now() + interval '1 day',
  now() + interval '40 days',
  '00000000-0000-4000-8000-000000033040',
  'create native product'
);

select extensions.is(
  (
    select result_code
    from public.transition_staking_product_status(
      (select staking_product_id from product_native),
      1,
      'ACTIVE',
      '00000000-0000-4000-8000-000000033041',
      'activate native product'
    )
  ),
  'STAKING_ASSET_NOT_PROJECT_TOKEN',
  'native asset cannot activate as staking token'
);

create temp table product_non_current as
select *
from public.create_staking_product(
  '00000000-0000-4000-8000-000000031001',
  '00000000-0000-4000-8000-000000032002',
  'STAKE_PRODUCT_OTHER_SPL',
  'Other SPL Product',
  null,
  41,
  '1000',
  null,
  20000,
  now() + interval '1 day',
  now() + interval '41 days',
  '00000000-0000-4000-8000-000000033042',
  'create non current product'
);

select extensions.is(
  (
    select result_code
    from public.transition_staking_product_status(
      (select staking_product_id from product_non_current),
      1,
      'ACTIVE',
      '00000000-0000-4000-8000-000000033043',
      'activate non current token product'
    )
  ),
  'STAKING_ASSET_NOT_PROJECT_TOKEN',
  'non-current SPL token cannot activate'
);

create temp table product_expired as
select *
from public.create_staking_product(
  '00000000-0000-4000-8000-000000031001',
  '00000000-0000-4000-8000-000000032001',
  'STAKE_PRODUCT_EXPIRED',
  'Expired Product',
  null,
  42,
  '1000',
  null,
  20000,
  now() - interval '10 days',
  now() - interval '1 day',
  '00000000-0000-4000-8000-000000033044',
  'create expired product'
);

select extensions.is(
  (
    select result_code
    from public.transition_staking_product_status(
      (select staking_product_id from product_expired),
      1,
      'ACTIVE',
      '00000000-0000-4000-8000-000000033045',
      'activate expired product'
    )
  ),
  'STAKING_ENROLLMENT_EXPIRED',
  'expired enrollment cannot activate'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000030002', 'aal1');
set local role authenticated;

select extensions.ok(
  (
    select count(*)::integer
    from public.list_current_staking_products(100)
  ) >= 0,
  'active user can execute public staking product read RPC'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000030001', 'aal2');

select extensions.ok(
  (
    select count(*)::integer
    from public.list_admin_staking_products(100, null)
  ) >= 1
    and (
      select count(*)::integer
      from public.list_staking_product_admin_audit_events(50, null)
    ) >= 1,
  'AAL2 admin staking reads return rows'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema in ('public', 'private')
      and table_name in (
        'staking_products',
        'staking_product_admin_audit_events'
      )
      and lower(column_name) in (
        'balance',
        'available_balance',
        'locked_balance',
        'deposit_address',
        'withdrawal_address',
        'wallet_address',
        'private_key',
        'mnemonic',
        'seed_phrase',
        'transaction_id',
        'signature'
      )
  ),
  'staking product schema excludes balances, addresses, credentials, and transaction fields'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_journals
  ),
  0,
  'staking product lifecycle leaves ledger journals empty'
);

select * from extensions.finish();

rollback;
