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

select extensions.has_table('public', 'projects', 'projects table exists');
select extensions.has_table('public', 'supported_assets', 'supported_assets table exists');
select extensions.has_table('public', 'project_token_assignments', 'project_token_assignments table exists');
select extensions.has_table('public', 'wallet_accounts', 'wallet_accounts table exists');

select extensions.ok(
  exists (
    select 1
    from pg_attribute
    where attrelid = 'public.projects'::regclass
      and attname in (
        'id',
        'project_code',
        'display_name',
        'description',
        'status',
        'version',
        'created_at',
        'updated_at'
      )
      and not attisdropped
    group by attrelid
    having count(*) = 8
  ),
  'projects has required columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_attribute
    where attrelid = 'public.supported_assets'::regclass
      and attname in (
        'id',
        'asset_code',
        'symbol',
        'display_name',
        'network',
        'asset_type',
        'decimals',
        'mint_address',
        'status',
        'version',
        'created_at',
        'updated_at'
      )
      and not attisdropped
    group by attrelid
    having count(*) = 12
  ),
  'supported_assets has required columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_attribute
    where attrelid = 'public.project_token_assignments'::regclass
      and attname in (
        'id',
        'project_id',
        'asset_id',
        'assigned_at',
        'retired_at',
        'version',
        'created_at',
        'updated_at'
      )
      and not attisdropped
    group by attrelid
    having count(*) = 8
  ),
  'project_token_assignments has required columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_attribute
    where attrelid = 'public.wallet_accounts'::regclass
      and attname in (
        'id',
        'user_id',
        'custody_model',
        'status',
        'closed_at',
        'version',
        'created_at',
        'updated_at'
      )
      and not attisdropped
    group by attrelid
    having count(*) = 8
  ),
  'wallet_accounts has required columns'
);

select extensions.ok(
  (
    select count(*)
    from pg_constraint
    where conrelid in (
      'public.projects'::regclass,
      'public.supported_assets'::regclass,
      'public.project_token_assignments'::regclass,
      'public.wallet_accounts'::regclass
    )
      and contype = 'p'
  ) = 4,
  'all domain tables have primary keys'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_token_assignments'::regclass
      and confrelid = 'public.projects'::regclass
      and confdeltype = 'r'
  ),
  'project token assignments reference projects with restrict'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_token_assignments'::regclass
      and confrelid = 'public.supported_assets'::regclass
      and confdeltype = 'r'
  ),
  'project token assignments reference supported assets with restrict'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.wallet_accounts'::regclass
      and confrelid = 'public.profiles'::regclass
      and confdeltype = 'a'
      and condeferrable
      and condeferred
  ),
  'wallet accounts reference profiles with deferred delete restriction'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'projects'
      and indexname = 'projects_one_active_idx'
  ),
  'one active project partial unique index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'supported_assets'
      and indexname = 'supported_assets_mint_uidx'
  ),
  'supported asset mint partial unique index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'supported_assets'
      and indexname = 'supported_assets_native_network_symbol_uidx'
  ),
  'native network symbol partial unique index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'project_token_assignments'
      and indexname = 'project_token_assignments_current_project_uidx'
  ),
  'current project assignment partial unique index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'project_token_assignments'
      and indexname = 'project_token_assignments_current_asset_uidx'
  ),
  'current asset assignment partial unique index exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname in (
        'projects_project_code_check',
        'projects_display_name_check',
        'projects_description_check',
        'projects_status_check',
        'projects_version_check'
      )
    group by conrelid
    having count(*) = 5
  ),
  'project checks exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.supported_assets'::regclass
      and conname in (
        'supported_assets_asset_code_check',
        'supported_assets_symbol_check',
        'supported_assets_display_name_check',
        'supported_assets_network_check',
        'supported_assets_asset_type_check',
        'supported_assets_decimals_check',
        'supported_assets_mint_address_check',
        'supported_assets_status_check',
        'supported_assets_version_check'
      )
    group by conrelid
    having count(*) = 9
  ),
  'supported asset checks exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_token_assignments'::regclass
      and conname in (
        'project_token_assignments_retired_at_check',
        'project_token_assignments_version_check'
      )
    group by conrelid
    having count(*) = 2
  ),
  'assignment checks exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.wallet_accounts'::regclass
      and conname in (
        'wallet_accounts_custody_model_check',
        'wallet_accounts_status_check',
        'wallet_accounts_closed_at_check',
        'wallet_accounts_version_check'
      )
    group by conrelid
    having count(*) = 4
  ),
  'wallet account checks exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.projects'::regclass
      and tgname = 'touch_projects_version'
      and not tgisinternal
  ),
  'project version trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.supported_assets'::regclass
      and tgname = 'touch_supported_assets_version'
      and not tgisinternal
  ),
  'supported asset version trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.project_token_assignments'::regclass
      and tgname = 'touch_project_token_assignments_version'
      and not tgisinternal
  ),
  'assignment version trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.wallet_accounts'::regclass
      and tgname = 'touch_wallet_accounts_version'
      and not tgisinternal
  ),
  'wallet version trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.project_token_assignments'::regclass
      and tgname = 'validate_project_token_assignment'
      and not tgisinternal
  ),
  'assignment validation trigger exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'on_profile_created_create_wallet_account'
      and not tgisinternal
  ),
  'profile wallet provisioning trigger exists'
);

select extensions.ok(
  obj_description('public.projects'::regclass, 'pg_class') is not null,
  'projects table has comment'
);

select extensions.ok(
  obj_description('public.supported_assets'::regclass, 'pg_class') is not null,
  'supported_assets table has comment'
);

select extensions.ok(
  obj_description('public.project_token_assignments'::regclass, 'pg_class') is not null,
  'project_token_assignments table has comment'
);

select extensions.ok(
  obj_description('public.wallet_accounts'::regclass, 'pg_class') is not null,
  'wallet_accounts table has comment'
);

select extensions.ok(
  obj_description('private.touch_versioned_record()'::regprocedure, 'pg_proc') is not null,
  'touch_versioned_record has comment'
);

select extensions.ok(
  obj_description('private.validate_project_token_assignment()'::regprocedure, 'pg_proc') is not null,
  'validate_project_token_assignment has comment'
);

select extensions.ok(
  obj_description('private.ensure_user_wallet_account(uuid)'::regprocedure, 'pg_proc') is not null,
  'ensure_user_wallet_account has comment'
);

select extensions.ok(
  obj_description('private.handle_profile_wallet_account_created()'::regprocedure, 'pg_proc') is not null,
  'profile wallet trigger handler has comment'
);

select extensions.ok(
  (
    select count(*)
    from pg_class
    where oid in (
      'public.projects'::regclass,
      'public.supported_assets'::regclass,
      'public.project_token_assignments'::regclass,
      'public.wallet_accounts'::regclass
    )
      and relrowsecurity
  ) = 4,
  'all domain tables have RLS enabled'
);

select extensions.ok(
  exists (
    select 1
    from pg_policy
    where polrelid = 'public.projects'::regclass
      and polname = 'projects_select_active_catalog'
  ),
  'projects active catalog policy exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_policy
    where polrelid = 'public.supported_assets'::regclass
      and polname = 'supported_assets_select_active_catalog'
  ),
  'supported assets active catalog policy exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_policy
    where polrelid = 'public.project_token_assignments'::regclass
      and polname = 'project_token_assignments_select_active_catalog'
  ),
  'active assignment catalog policy exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_policy
    where polrelid = 'public.wallet_accounts'::regclass
      and polname = 'wallet_accounts_select_own'
  ),
  'wallet own select policy exists'
);

select extensions.ok(
  (
    select count(*)
    from pg_policy
    where polrelid in (
      'public.projects'::regclass,
      'public.supported_assets'::regclass,
      'public.project_token_assignments'::regclass,
      'public.wallet_accounts'::regclass
    )
      and polcmd in ('a', 'w', 'd')
  ) = 0,
  'no insert update delete policies exist for domain tables'
);

insert into public.projects (project_code, display_name, status)
values
  ('PROJ_DRAFT', 'Draft project', 'DRAFT'),
  ('PROJ_ACTIVE', 'Active project', 'ACTIVE'),
  ('PROJ_SUSPENDED', 'Suspended project', 'SUSPENDED'),
  ('PROJ_ARCHIVED', 'Archived project', 'ARCHIVED'),
  ('PROJ_OTHER_DRAFT', 'Other draft project', 'DRAFT');

select extensions.is(
  (select count(*)::integer from public.projects where status = 'ACTIVE'),
  1,
  'one active project can exist'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.projects (project_code, display_name, status)
    values ('PROJ_ACTIVE_2', 'Second active project', 'ACTIVE');
    raise exception 'expected active uniqueness failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'second active project is blocked'
);

select extensions.lives_ok(
  $_$
  insert into public.projects (project_code, display_name, status)
  values ('PROJ_DRAFT_2', 'Second draft project', 'DRAFT'),
    ('PROJ_SUSPENDED_2', 'Second suspended project', 'SUSPENDED'),
    ('PROJ_ARCHIVED_2', 'Second archived project', 'ARCHIVED');
  $_$,
  'multiple inactive project states are allowed'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.projects (project_code, display_name)
    values ('lower_code', 'Bad project code');
    raise exception 'expected project code failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'project code format is enforced'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.projects (project_code, display_name)
    values ('BAD_NAME', ' bad display name ');
    raise exception 'expected display name failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'project display name trim is enforced'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.projects (project_code, display_name, description)
    values ('BAD_DESC', 'Bad description project', repeat('x', 2001));
    raise exception 'expected description length failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'project description length is enforced'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.projects (project_code, display_name, status)
    values ('BAD_STATUS', 'Bad status project', 'DELETED');
    raise exception 'expected project status failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'project status is enforced'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.projects (project_code, display_name, version)
    values ('BAD_VERSION', 'Bad version project', 0);
    raise exception 'expected project version failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'project version is enforced'
);

insert into public.supported_assets (
  asset_code,
  symbol,
  display_name,
  asset_type,
  decimals,
  mint_address,
  status
)
values
  ('SOL_NATIVE', 'SOL', 'Solana', 'NATIVE', 9, null, 'ACTIVE'),
  ('PROJECT_TOKEN_A', 'PTA', 'Project Token A', 'SPL_TOKEN', 6, '11111111111111111111111111111112', 'ACTIVE'),
  ('PROJECT_TOKEN_B', 'PTB', 'Project Token B', 'SPL_TOKEN', 6, '11111111111111111111111111111113', 'ACTIVE'),
  ('PROJECT_TOKEN_ARCHIVED', 'PTX', 'Project Token Archived', 'SPL_TOKEN', 6, '11111111111111111111111111111114', 'ARCHIVED'),
  ('PROJECT_TOKEN_DRAFT', 'PTD', 'Project Token Draft', 'SPL_TOKEN', 6, '11111111111111111111111111111115', 'DRAFT'),
  ('PROJECT_TOKEN_SUSPENDED', 'PTS', 'Project Token Suspended', 'SPL_TOKEN', 6, '11111111111111111111111111111116', 'SUSPENDED');

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.supported_assets (
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals,
      mint_address
    )
    values ('BAD_NATIVE', 'SOLX', 'Bad Native', 'NATIVE', 9, '11111111111111111111111111111117');
    raise exception 'expected native mint failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'native asset mint is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.supported_assets (
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals
    )
    values ('BAD_SPL_NULL', 'BSN', 'Bad SPL', 'SPL_TOKEN', 6);
    raise exception 'expected SPL mint failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'SPL token mint is required'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.supported_assets (
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals,
      mint_address
    )
    values ('BAD_BASE58', 'BB58', 'Bad Base58', 'SPL_TOKEN', 6, '00000000000000000000000000000000');
    raise exception 'expected base58 failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'invalid base58 mint is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.supported_assets (
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals,
      mint_address
    )
    values ('BAD_MINT_LEN', 'BML', 'Bad Mint Length', 'SPL_TOKEN', 6, '1111111111111111111111111111111');
    raise exception 'expected mint length failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'mint length is enforced'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.supported_assets (
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals,
      mint_address
    )
    values ('BAD_DECIMAL_LOW', 'BDL', 'Bad Decimal Low', 'SPL_TOKEN', -1, '11111111111111111111111111111118');
    raise exception 'expected low decimal failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'negative decimals are blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.supported_assets (
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals,
      mint_address
    )
    values ('BAD_DECIMAL_HIGH', 'BDH', 'Bad Decimal High', 'SPL_TOKEN', 19, '11111111111111111111111111111119');
    raise exception 'expected high decimal failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'decimals above eighteen are blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.supported_assets (
      asset_code,
      symbol,
      display_name,
      network,
      asset_type,
      decimals,
      mint_address
    )
    values ('BAD_NETWORK', 'BNET', 'Bad Network', 'ETHEREUM', 'SPL_TOKEN', 6, '1111111111111111111111111111111A');
    raise exception 'expected network failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'non SOLANA network is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.supported_assets (
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals,
      mint_address
    )
    values ('BAD_DUP_MINT', 'BDM', 'Bad Duplicate Mint', 'SPL_TOKEN', 6, '11111111111111111111111111111112');
    raise exception 'expected duplicate mint failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'duplicate SPL mint is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.supported_assets (
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals
    )
    values ('BAD_DUP_NATIVE', 'SOL', 'Bad Duplicate Native', 'NATIVE', 9);
    raise exception 'expected duplicate native failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'duplicate native network symbol is blocked'
);

insert into public.project_token_assignments (project_id, asset_id)
select projects.id, assets.id
from public.projects as projects
cross join public.supported_assets as assets
where projects.project_code = 'PROJ_ACTIVE'
  and assets.asset_code = 'PROJECT_TOKEN_A';

select extensions.is(
  (select count(*)::integer from public.project_token_assignments where retired_at is null),
  1,
  'active SPL token assignment is allowed'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.project_token_assignments (project_id, asset_id)
    select projects.id, assets.id
    from public.projects as projects
    cross join public.supported_assets as assets
    where projects.project_code = 'PROJ_DRAFT'
      and assets.asset_code = 'SOL_NATIVE';
    raise exception 'expected native assignment failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'native project token assignment is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.project_token_assignments (project_id, asset_id)
    select projects.id, assets.id
    from public.projects as projects
    cross join public.supported_assets as assets
    where projects.project_code = 'PROJ_DRAFT'
      and assets.asset_code = 'PROJECT_TOKEN_ARCHIVED';
    raise exception 'expected archived asset assignment failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'archived asset assignment is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.project_token_assignments (project_id, asset_id)
    select projects.id, assets.id
    from public.projects as projects
    cross join public.supported_assets as assets
    where projects.project_code = 'PROJ_ACTIVE'
      and assets.asset_code = 'PROJECT_TOKEN_B';
    raise exception 'expected project active assignment failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'project cannot have two current token assignments'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.project_token_assignments (project_id, asset_id)
    select projects.id, assets.id
    from public.projects as projects
    cross join public.supported_assets as assets
    where projects.project_code = 'PROJ_DRAFT'
      and assets.asset_code = 'PROJECT_TOKEN_A';
    raise exception 'expected asset active assignment failure';
  exception
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'asset cannot be assigned to two current projects'
);

update public.project_token_assignments
set retired_at = clock_timestamp()
where id = (
  select assignments.id
  from public.project_token_assignments as assignments
  join public.projects as projects
    on projects.id = assignments.project_id
  where projects.project_code = 'PROJ_ACTIVE'
    and assignments.retired_at is null
);

insert into public.project_token_assignments (project_id, asset_id)
select projects.id, assets.id
from public.projects as projects
cross join public.supported_assets as assets
where projects.project_code = 'PROJ_ACTIVE'
  and assets.asset_code = 'PROJECT_TOKEN_B';

select extensions.is(
  (select count(*)::integer from public.project_token_assignments),
  2,
  'retire plus insert preserves assignment history'
);

select extensions.is(
  (select count(*)::integer from public.project_token_assignments where retired_at is null),
  1,
  'exactly one current assignment remains after replacement'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update public.project_token_assignments
    set project_id = (
      select id from public.projects where project_code = 'PROJ_DRAFT'
    )
    where retired_at is null;
    raise exception 'expected project mutation failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'assignment project_id is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update public.project_token_assignments
    set asset_id = (
      select id from public.supported_assets where asset_code = 'PROJECT_TOKEN_A'
    )
    where retired_at is null;
    raise exception 'expected asset mutation failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'assignment asset_id is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update public.project_token_assignments
    set assigned_at = assigned_at + interval '1 second'
    where retired_at is null;
    raise exception 'expected assigned_at mutation failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'assignment assigned_at is immutable'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update public.project_token_assignments
    set retired_at = null
    where retired_at is not null;
    raise exception 'expected retired assignment reactivation failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'retired assignment cannot be reactivated'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update public.project_token_assignments
    set retired_at = retired_at + interval '1 second'
    where retired_at is not null;
    raise exception 'expected retired_at change failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'retired_at cannot be changed after retirement'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000003001',
  'domain-user-a@example.test',
  '{"display_name":"Domain User A"}'::jsonb
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000003002',
  'domain-user-b@example.test',
  '{"display_name":"Domain User B"}'::jsonb
);

select extensions.is(
  (
    select count(*)::integer
    from public.wallet_accounts
    where user_id in (
      '00000000-0000-4000-8000-000000003001',
      '00000000-0000-4000-8000-000000003002'
    )
  ),
  2,
  'auth provisioning creates wallet accounts'
);

select extensions.is(
  (
    select count(*)::integer
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003001'
      and status = 'ACTIVE'
      and custody_model = 'MANAGED'
      and closed_at is null
      and version = 1
  ),
  1,
  'wallet account defaults are applied'
);

select extensions.is(
  private.ensure_user_wallet_account('00000000-0000-4000-8000-000000003001'),
  (
    select id
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003001'
  ),
  'wallet provisioning helper returns existing id'
);

select extensions.is(
  (
    select count(*)::integer
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003001'
  ),
  1,
  'wallet provisioning helper remains idempotent'
);

select extensions.is(
  (
    select version::integer
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003001'
  ),
  1,
  'idempotent wallet helper does not bump version'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform private.ensure_user_wallet_account('00000000-0000-4000-8000-000000009999');
    raise exception 'expected missing profile failure';
  exception
    when foreign_key_violation then
      null;
  end;
  $$;
  $_$,
  'wallet helper rejects missing profile'
);

select extensions.is(
  (select count(*)::integer from public.profiles),
  (select count(*)::integer from public.wallet_accounts),
  'profile backfill and trigger keep wallet count aligned'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.wallet_accounts (user_id, custody_model)
    values ('00000000-0000-4000-8000-000000003001', 'SELF_CUSTODY');
    raise exception 'expected custody model failure';
  exception
    when check_violation then
      null;
    when unique_violation then
      null;
  end;
  $$;
  $_$,
  'unsupported custody model is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update public.wallet_accounts
    set status = 'CLOSED'
    where user_id = '00000000-0000-4000-8000-000000003001';
    raise exception 'expected closed_at failure';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'closed wallet requires closed_at'
);

select extensions.lives_ok(
  $_$
  update public.wallet_accounts
  set status = 'FROZEN'
  where user_id = '00000000-0000-4000-8000-000000003001';
  $_$,
  'wallet can transition to frozen'
);

select extensions.is(
  (
    select status
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003001'
  ),
  'FROZEN',
  'wallet frozen status is stored'
);

select extensions.lives_ok(
  $_$
  update public.wallet_accounts
  set status = 'CLOSED',
    closed_at = clock_timestamp()
  where user_id = '00000000-0000-4000-8000-000000003001';
  $_$,
  'wallet can close with closed_at'
);

select extensions.is(
  (
    select status
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003001'
  ),
  'CLOSED',
  'wallet closed status is stored'
);

create temp table wallet_version_input_probe as
select version
from public.wallet_accounts
where user_id = '00000000-0000-4000-8000-000000003002';

update public.wallet_accounts
set version = 0
where user_id = '00000000-0000-4000-8000-000000003002';

select extensions.is(
  (
    select version::integer
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003002'
  ),
  (select version::integer + 1 from wallet_version_input_probe),
  'caller supplied wallet version is ignored'
);

create temp table version_probe as
select
  (select version from public.projects where project_code = 'PROJ_DRAFT') as project_version,
  (select updated_at from public.projects where project_code = 'PROJ_DRAFT') as project_updated_at,
  (select version from public.supported_assets where asset_code = 'PROJECT_TOKEN_DRAFT') as asset_version,
  (select updated_at from public.supported_assets where asset_code = 'PROJECT_TOKEN_DRAFT') as asset_updated_at,
  (
    select version
    from public.project_token_assignments
    where retired_at is null
  ) as assignment_version,
  (
    select updated_at
    from public.project_token_assignments
    where retired_at is null
  ) as assignment_updated_at,
  (
    select version
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003002'
  ) as wallet_version,
  (
    select updated_at
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003002'
  ) as wallet_updated_at;

select pg_sleep(0.01);

update public.projects
set display_name = 'Draft project updated',
  version = 100
where project_code = 'PROJ_DRAFT';

update public.supported_assets
set display_name = 'Project Token Draft Updated',
  version = 100
where asset_code = 'PROJECT_TOKEN_DRAFT';

update public.project_token_assignments
set retired_at = clock_timestamp(),
  version = 100
where retired_at is null;

update public.wallet_accounts
set status = 'FROZEN',
  version = 100
where user_id = '00000000-0000-4000-8000-000000003002';

select extensions.is(
  (
    select version::integer
    from public.projects
    where project_code = 'PROJ_DRAFT'
  ),
  (select project_version::integer + 1 from version_probe),
  'project version increments by one'
);

select extensions.ok(
  (
    select updated_at
    from public.projects
    where project_code = 'PROJ_DRAFT'
  ) > (select project_updated_at from version_probe),
  'project updated_at increases'
);

select extensions.is(
  (
    select version::integer
    from public.supported_assets
    where asset_code = 'PROJECT_TOKEN_DRAFT'
  ),
  (select asset_version::integer + 1 from version_probe),
  'asset version increments by one'
);

select extensions.ok(
  (
    select updated_at
    from public.supported_assets
    where asset_code = 'PROJECT_TOKEN_DRAFT'
  ) > (select asset_updated_at from version_probe),
  'asset updated_at increases'
);

select extensions.is(
  (
    select max(version)::integer
    from public.project_token_assignments
    where retired_at is not null
  ),
  (select assignment_version::integer + 1 from version_probe),
  'assignment version increments by one'
);

select extensions.ok(
  exists (
    select 1
    from public.project_token_assignments
    where retired_at is not null
      and updated_at > (select assignment_updated_at from version_probe)
  ),
  'assignment updated_at increases'
);

select extensions.is(
  (
    select version::integer
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003002'
  ),
  (select wallet_version::integer + 1 from version_probe),
  'wallet version increments by one'
);

select extensions.ok(
  (
    select updated_at
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003002'
  ) > (select wallet_updated_at from version_probe),
  'wallet updated_at increases'
);

select extensions.ok(
  has_table_privilege('authenticated', 'public.projects', 'select')
    and has_table_privilege('authenticated', 'public.supported_assets', 'select')
    and has_table_privilege('authenticated', 'public.project_token_assignments', 'select')
    and has_table_privilege('authenticated', 'public.wallet_accounts', 'select'),
  'authenticated has select grants on domain tables'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.projects', 'select')
    and not has_table_privilege('anon', 'public.supported_assets', 'select')
    and not has_table_privilege('anon', 'public.project_token_assignments', 'select')
    and not has_table_privilege('anon', 'public.wallet_accounts', 'select'),
  'anon has no select grants on domain tables'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'public.projects', 'insert')
    and not has_table_privilege('authenticated', 'public.supported_assets', 'insert')
    and not has_table_privilege('authenticated', 'public.project_token_assignments', 'insert')
    and not has_table_privilege('authenticated', 'public.wallet_accounts', 'insert')
    and not has_table_privilege('authenticated', 'public.projects', 'update')
    and not has_table_privilege('authenticated', 'public.supported_assets', 'update')
    and not has_table_privilege('authenticated', 'public.project_token_assignments', 'update')
    and not has_table_privilege('authenticated', 'public.wallet_accounts', 'update')
    and not has_table_privilege('authenticated', 'public.projects', 'delete')
    and not has_table_privilege('authenticated', 'public.supported_assets', 'delete')
    and not has_table_privilege('authenticated', 'public.project_token_assignments', 'delete')
    and not has_table_privilege('authenticated', 'public.wallet_accounts', 'delete'),
  'authenticated cannot write domain tables directly'
);

select extensions.ok(
  not has_function_privilege('authenticated', 'private.ensure_user_wallet_account(uuid)'::regprocedure, 'execute')
    and not has_function_privilege('authenticated', 'private.touch_versioned_record()'::regprocedure, 'execute')
    and not has_function_privilege('authenticated', 'private.validate_project_token_assignment()'::regprocedure, 'execute')
    and not has_function_privilege('authenticated', 'private.handle_profile_wallet_account_created()'::regprocedure, 'execute'),
  'authenticated cannot execute private domain helper functions'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000003001', 'aal2');
set local role authenticated;

select extensions.is(
  (select count(*)::integer from public.projects),
  1,
  'authenticated sees only active projects'
);

select extensions.is(
  (select count(*)::integer from public.supported_assets),
  3,
  'authenticated sees only active assets'
);

select extensions.is(
  (select count(*)::integer from public.project_token_assignments),
  0,
  'authenticated does not see retired assignment'
);

select extensions.is(
  (select count(*)::integer from public.wallet_accounts),
  1,
  'authenticated sees own wallet account only'
);

select extensions.is(
  (
    select custody_model
    from public.wallet_accounts
    where user_id = '00000000-0000-4000-8000-000000003001'
  ),
  'MANAGED',
  'authenticated own wallet custody is visible'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into public.projects (project_code, display_name)
    values ('BROWSER_INSERT', 'Browser Insert');
    raise exception 'expected browser insert failure';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'browser project insert is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update public.wallet_accounts
    set status = 'FROZEN';
    raise exception 'expected browser update failure';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'browser wallet update is blocked'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    delete from public.wallet_accounts;
    raise exception 'expected browser delete failure';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'browser wallet delete is blocked'
);

reset role;

select extensions.ok(
  not has_table_privilege('authenticated', 'public.user_roles', 'select'),
  'authenticated still cannot select user_roles directly'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'projects',
        'supported_assets',
        'project_token_assignments',
        'wallet_accounts'
      )
      and lower(column_name) in (
        'balance',
        'available_balance',
        'locked_balance',
        'pending_balance',
        'amount',
        'quantity',
        'principal',
        'reward',
        'apy',
        'private_key',
        'mnemonic',
        'seed_phrase',
        'deposit_address',
        'withdrawal_address',
        'wallet_address',
        'blockchain_address',
        'transaction_id'
      )
  ),
  'financial and wallet credential columns are absent'
);

select extensions.is(
  (select count(*)::integer from public.projects where project_code like 'QA_%'),
  0,
  'no QA projects are persisted inside test transaction'
);

select * from extensions.finish();

rollback;
