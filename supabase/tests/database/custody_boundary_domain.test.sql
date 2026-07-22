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
  'custody_providers',
  'custody providers table exists'
);

select extensions.has_table(
  'private',
  'custody_account_bindings',
  'custody account bindings table exists'
);

select extensions.has_table(
  'private',
  'custody_config_audit_events',
  'custody configuration audit table exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.custody_providers'::regclass
      and tgname = 'validate_custody_provider_transition'
      and not tgisinternal
  )
    and exists (
      select 1
      from pg_trigger
      where tgrelid = 'private.custody_account_bindings'::regclass
        and tgname = 'validate_custody_account_binding_transition'
        and not tgisinternal
    )
    and exists (
      select 1
      from pg_trigger
      where tgrelid = 'private.custody_config_audit_events'::regclass
        and tgname = 'protect_custody_config_audit_events'
        and not tgisinternal
    ),
  'custody lifecycle and audit immutability triggers exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'custody_account_bindings'
      and indexname = 'custody_account_bindings_active_role_uidx'
  )
    and exists (
      select 1
      from pg_indexes
      where schemaname = 'private'
        and tablename = 'custody_config_audit_events'
        and indexname = 'custody_config_audit_events_occurred_at_idx'
    ),
  'custody duplicate role and audit cursor indexes exist'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'upsert_custody_provider_draft',
        'transition_custody_provider_status',
        'upsert_custody_account_binding_draft',
        'transition_custody_account_binding_status',
        'list_admin_custody_providers',
        'list_admin_custody_account_bindings',
        'list_custody_config_audit_events'
      )
  ) = 7,
  'custody command and read RPCs exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'upsert_custody_provider_draft',
        'transition_custody_provider_status',
        'upsert_custody_account_binding_draft',
        'transition_custody_account_binding_status',
        'list_admin_custody_providers',
        'list_admin_custody_account_bindings',
        'list_custody_config_audit_events'
      )
      and not prosecdef
  ),
  'custody RPCs are security definer'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'upsert_custody_provider_draft',
        'transition_custody_provider_status',
        'upsert_custody_account_binding_draft',
        'transition_custody_account_binding_status',
        'list_admin_custody_providers',
        'list_admin_custody_account_bindings',
        'list_custody_config_audit_events'
      )
      and coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
  ),
  'custody RPCs use empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_custody_provider_draft(uuid, bigint, text, text, text, boolean, boolean, boolean, boolean, boolean, uuid, text)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.upsert_custody_provider_draft(uuid, bigint, text, text, text, boolean, boolean, boolean, boolean, boolean, uuid, text)'::regprocedure,
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.list_admin_custody_providers(integer, text)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.list_admin_custody_providers(integer, text)'::regprocedure,
      'execute'
    ),
  'custody RPC execute grants are authenticated-only'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    cross join lateral aclexplode(coalesce(pg_proc.proacl, acldefault('f', pg_proc.proowner))) as grants
    where pg_proc.pronamespace = 'public'::regnamespace
      and pg_proc.proname like '%custody%'
      and grants.grantee = 'service_role'::regrole
  ),
  'custody RPCs have no explicit service-role grants'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.custody_providers', 'select')
    and not has_table_privilege('authenticated', 'private.custody_account_bindings', 'insert')
    and not has_table_privilege('anon', 'private.custody_config_audit_events', 'select'),
  'custody private table direct access is blocked'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000050001',
  'custody-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000050002',
  'custody-user@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000050001',
  'ADMIN',
  'custody boundary pgTAP fixture'
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
    'CUSTSPL1',
    'CS1',
    'Custody SPL One',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111151',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000052002',
    'CUSTNAT1',
    'CSOL',
    'Custody Native One',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000052003',
    'CUSTSUS1',
    'CSS',
    'Custody Suspended SPL',
    'SPL_TOKEN',
    6,
    '11111111111111111111111111111152',
    'SUSPENDED'
  );

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050002', 'aal2');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.upsert_custody_provider_draft(
      null,
      null,
      'USER_PROVIDER',
      'User Provider',
      'MPC_CUSTODIAN',
      true,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000053001',
      'blocked user custody command'
    );
    raise exception 'expected user denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'general USER cannot execute custody command'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050001', 'aal1');
set local role authenticated;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from public.upsert_custody_provider_draft(
      null,
      null,
      'AAL1_PROVIDER',
      'AAL1 Provider',
      'MPC_CUSTODIAN',
      true,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000053002',
      'blocked aal1 custody command'
    );
    raise exception 'expected aal1 denial';
  exception
    when insufficient_privilege then
      null;
  end;
  $$;
  $_$,
  'AAL1 ADMIN cannot execute custody command'
);

reset role;

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000050001', 'aal2');

create temp table custody_provider_create as
select *
from public.upsert_custody_provider_draft(
  null,
  null,
  'QA_CUSTODY_A',
  'QA Custody A',
  'MPC_CUSTODIAN',
  false,
  false,
  false,
  false,
  false,
  '00000000-0000-4000-8000-000000053010',
  'create custody provider draft'
);

select extensions.is(
  (select result_code from custody_provider_create),
  'APPLIED',
  'custody provider draft create applied'
);

select extensions.is(
  (
    select status
    from private.custody_providers
    where provider_code = 'QA_CUSTODY_A'
  ),
  'DRAFT',
  'custody provider starts draft'
);

select extensions.is(
  (
    select result_code
    from public.upsert_custody_provider_draft(
      null,
      null,
      'QA_CUSTODY_A',
      'QA Custody A',
      'MPC_CUSTODIAN',
      false,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000053010',
      'create custody provider draft'
    )
  ),
  'APPLIED',
  'custody provider create replay returns original outcome'
);

select extensions.is(
  (
    select replayed
    from public.upsert_custody_provider_draft(
      null,
      null,
      'QA_CUSTODY_A',
      'QA Custody A',
      'MPC_CUSTODIAN',
      false,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000053010',
      'create custody provider draft'
    )
  ),
  true,
  'custody provider create replay is marked'
);

select extensions.is(
  (
    select result_code
    from public.upsert_custody_provider_draft(
      null,
      null,
      'QA_CUSTODY_CONFLICT',
      'QA Custody Conflict',
      'MPC_CUSTODIAN',
      true,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000053010',
      'different custody provider request'
    )
  ),
  'CUSTODY_CONFIG_COMMAND_ID_CONFLICT',
  'custody provider command id conflict is blocked'
);

select extensions.is(
  (
    select result_code
    from public.transition_custody_provider_status(
      (select custody_provider_id from custody_provider_create),
      (select entity_version from custody_provider_create),
      'APPROVED',
      '00000000-0000-4000-8000-000000053011',
      'approve custody provider without capability'
    )
  ),
  'CUSTODY_PROVIDER_CAPABILITY_REQUIRED',
  'provider approval requires at least one capability'
);

create temp table custody_provider_update as
select *
from public.upsert_custody_provider_draft(
  (select custody_provider_id from custody_provider_create),
  (select version from private.custody_providers where provider_code = 'QA_CUSTODY_A'),
  'QA_CUSTODY_A',
  'QA Custody A Updated',
  'MPC_CUSTODIAN',
  true,
  true,
  true,
  false,
  false,
  '00000000-0000-4000-8000-000000053012',
  'update custody provider capabilities'
);

select extensions.is(
  (select result_code from custody_provider_update),
  'APPLIED',
  'custody provider draft update applied'
);

select extensions.is(
  (
    select result_code
    from public.upsert_custody_provider_draft(
      (select custody_provider_id from custody_provider_create),
      1,
      'QA_CUSTODY_A',
      'QA Custody A Stale',
      'MPC_CUSTODIAN',
      true,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000053013',
      'stale provider update'
    )
  ),
  'CUSTODY_PROVIDER_VERSION_CONFLICT',
  'provider expected version is enforced'
);

create temp table custody_provider_approve as
select *
from public.transition_custody_provider_status(
  (select custody_provider_id from custody_provider_create),
  (select version from private.custody_providers where provider_code = 'QA_CUSTODY_A'),
  'APPROVED',
  '00000000-0000-4000-8000-000000053014',
  'approve custody provider'
);

select extensions.is(
  (select result_code from custody_provider_approve),
  'APPLIED',
  'custody provider approval applied'
);

select extensions.ok(
  (
    select approved_at is not null and status = 'APPROVED'
    from private.custody_providers
    where provider_code = 'QA_CUSTODY_A'
  ),
  'provider approval stamps approved_at'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.custody_providers
    set display_name = 'Direct Mutated Custody'
    where provider_code = 'QA_CUSTODY_A';
    raise exception 'expected provider term freeze';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'approved provider term mutation is blocked'
);

select extensions.is(
  (
    select result_code
    from public.transition_custody_provider_status(
      (select custody_provider_id from custody_provider_create),
      (select version from private.custody_providers where provider_code = 'QA_CUSTODY_A'),
      'APPROVED',
      '00000000-0000-4000-8000-000000053015',
      'same provider status noop'
    )
  ),
  'NOOP',
  'same provider status transition is noop'
);

select extensions.is(
  (
    select result_code
    from public.transition_custody_provider_status(
      (select custody_provider_id from custody_provider_create),
      (select version from private.custody_providers where provider_code = 'QA_CUSTODY_A'),
      'RETIRED',
      '00000000-0000-4000-8000-000000053016',
      'approved provider retire invalid'
    )
  ),
  'CUSTODY_PROVIDER_TRANSITION_INVALID',
  'APPROVED to RETIRED provider transition is blocked'
);

select public.transition_custody_provider_status(
  (select custody_provider_id from custody_provider_create),
  (select version from private.custody_providers where provider_code = 'QA_CUSTODY_A'),
  'SUSPENDED',
  '00000000-0000-4000-8000-000000053017',
  'suspend custody provider'
);

select public.transition_custody_provider_status(
  (select custody_provider_id from custody_provider_create),
  (select version from private.custody_providers where provider_code = 'QA_CUSTODY_A'),
  'APPROVED',
  '00000000-0000-4000-8000-000000053018',
  'resume custody provider'
);

create temp table custody_binding_create as
select *
from public.upsert_custody_account_binding_draft(
  null,
  null,
  (select custody_provider_id from custody_provider_create),
  '00000000-0000-4000-8000-000000052001',
  'qa_collection_spl',
  'QA Collection SPL',
  'COLLECTION',
  '00000000-0000-4000-8000-000000053020',
  'create custody account binding'
);

select extensions.is(
  (select result_code from custody_binding_create),
  'APPLIED',
  'custody binding draft create applied'
);

select extensions.is(
  (
    select result_code
    from public.upsert_custody_account_binding_draft(
      null,
      null,
      (select custody_provider_id from custody_provider_create),
      '00000000-0000-4000-8000-000000052001',
      'qa_collection_spl',
      'Duplicate Binding',
      'TREASURY',
      '00000000-0000-4000-8000-000000053021',
      'duplicate binding key'
    )
  ),
  'CUSTODY_BINDING_KEY_EXISTS',
  'binding key is unique per provider'
);

select extensions.is(
  (
    select result_code
    from public.upsert_custody_account_binding_draft(
      null,
      null,
      (select custody_provider_id from custody_provider_create),
      '00000000-0000-4000-8000-000000052001',
      'qa_collection_spl_other',
      'Duplicate Role',
      'COLLECTION',
      '00000000-0000-4000-8000-000000053022',
      'duplicate active role'
    )
  ),
  'CUSTODY_BINDING_DUPLICATE_ACTIVE_ROLE',
  'provider asset role duplicate is blocked while not retired'
);

select extensions.is(
  (
    select result_code
    from public.upsert_custody_account_binding_draft(
      (select custody_account_binding_id from custody_binding_create),
      999,
      (select custody_provider_id from custody_provider_create),
      '00000000-0000-4000-8000-000000052001',
      'qa_collection_spl',
      'Stale Binding',
      'COLLECTION',
      '00000000-0000-4000-8000-000000053023',
      'stale binding update'
    )
  ),
  'CUSTODY_BINDING_VERSION_CONFLICT',
  'binding expected version is enforced'
);

select public.transition_custody_provider_status(
  (select custody_provider_id from custody_provider_create),
  (select version from private.custody_providers where provider_code = 'QA_CUSTODY_A'),
  'SUSPENDED',
  '00000000-0000-4000-8000-000000053024',
  'suspend provider before binding approval block'
);

select extensions.is(
  (
    select result_code
    from public.transition_custody_account_binding_status(
      (select custody_account_binding_id from custody_binding_create),
      (select version from private.custody_account_bindings where binding_key = 'qa_collection_spl'),
      'APPROVED',
      '00000000-0000-4000-8000-000000053025',
      'approve binding with suspended provider'
    )
  ),
  'CUSTODY_BINDING_PROVIDER_NOT_APPROVED',
  'binding approval requires approved provider'
);

select public.transition_custody_provider_status(
  (select custody_provider_id from custody_provider_create),
  (select version from private.custody_providers where provider_code = 'QA_CUSTODY_A'),
  'APPROVED',
  '00000000-0000-4000-8000-000000053026',
  'resume provider before binding approval'
);

create temp table custody_binding_inactive as
select *
from public.upsert_custody_account_binding_draft(
  null,
  null,
  (select custody_provider_id from custody_provider_create),
  '00000000-0000-4000-8000-000000052003',
  'qa_inactive_spl',
  'QA Inactive SPL',
  'TREASURY',
  '00000000-0000-4000-8000-000000053027',
  'create inactive asset binding'
);

select extensions.is(
  (
    select result_code
    from public.transition_custody_account_binding_status(
      (select custody_account_binding_id from custody_binding_inactive),
      (select version from private.custody_account_bindings where binding_key = 'qa_inactive_spl'),
      'APPROVED',
      '00000000-0000-4000-8000-000000053028',
      'approve inactive asset binding'
    )
  ),
  'CUSTODY_BINDING_ASSET_NOT_READY',
  'binding approval requires ACTIVE asset'
);

create temp table custody_binding_approve as
select *
from public.transition_custody_account_binding_status(
  (select custody_account_binding_id from custody_binding_create),
  (select version from private.custody_account_bindings where binding_key = 'qa_collection_spl'),
  'APPROVED',
  '00000000-0000-4000-8000-000000053029',
  'approve custody binding'
);

select extensions.is(
  (select result_code from custody_binding_approve),
  'APPLIED',
  'SPL binding approval applied'
);

select extensions.ok(
  (
    select approved_at is not null and status = 'APPROVED'
    from private.custody_account_bindings
    where binding_key = 'qa_collection_spl'
  ),
  'binding approval stamps approved_at'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.custody_account_bindings
    set display_label = 'Direct Mutated Binding'
    where binding_key = 'qa_collection_spl';
    raise exception 'expected binding term freeze';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'approved binding term mutation is blocked'
);

create temp table custody_binding_native as
select *
from public.upsert_custody_account_binding_draft(
  null,
  null,
  (select custody_provider_id from custody_provider_create),
  '00000000-0000-4000-8000-000000052002',
  'qa_treasury_native',
  'QA Treasury Native',
  'TREASURY',
  '00000000-0000-4000-8000-000000053030',
  'create native custody binding'
);

select extensions.is(
  (
    select result_code
    from public.transition_custody_account_binding_status(
      (select custody_account_binding_id from custody_binding_native),
      (select version from private.custody_account_bindings where binding_key = 'qa_treasury_native'),
      'APPROVED',
      '00000000-0000-4000-8000-000000053031',
      'approve native custody binding'
    )
  ),
  'APPLIED',
  'NATIVE binding approval is allowed'
);

select public.transition_custody_account_binding_status(
  (select custody_account_binding_id from custody_binding_create),
  (select version from private.custody_account_bindings where binding_key = 'qa_collection_spl'),
  'SUSPENDED',
  '00000000-0000-4000-8000-000000053032',
  'suspend custody binding'
);

select public.transition_custody_account_binding_status(
  (select custody_account_binding_id from custody_binding_create),
  (select version from private.custody_account_bindings where binding_key = 'qa_collection_spl'),
  'RETIRED',
  '00000000-0000-4000-8000-000000053033',
  'retire custody binding'
);

select extensions.is(
  (
    select result_code
    from public.upsert_custody_account_binding_draft(
      null,
      null,
      (select custody_provider_id from custody_provider_create),
      '00000000-0000-4000-8000-000000052001',
      'qa_collection_spl_replacement',
      'QA Collection SPL Replacement',
      'COLLECTION',
      '00000000-0000-4000-8000-000000053034',
      'create replacement after retire'
    )
  ),
  'APPLIED',
  'retired binding allows replacement provider asset role'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    insert into private.custody_account_bindings (
      custody_provider_id,
      asset_id,
      binding_key,
      display_label,
      account_role
    )
    values (
      (select custody_provider_id from custody_provider_create),
      '00000000-0000-4000-8000-000000052001',
      'https://not_allowed',
      'Bad Binding',
      'FEE'
    );
    raise exception 'expected invalid binding key';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'invalid binding insert is blocked by check constraint'
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
      mint_address,
      status
    )
    values (
      'CUSTETH1',
      'CET',
      'Custody Unsupported Network',
      'ETHEREUM',
      'SPL_TOKEN',
      6,
      '11111111111111111111111111111153',
      'ACTIVE'
    );
    raise exception 'expected unsupported network block';
  exception
    when check_violation then
      null;
  end;
  $$;
  $_$,
  'unsupported asset network is blocked by domain schema'
);

select extensions.ok(
  (
    select count(*)::integer
    from public.list_admin_custody_providers(100, null)
  ) >= 1
    and (
      select count(*)::integer
      from public.list_admin_custody_account_bindings(100, null)
    ) >= 1
    and (
      select count(*)::integer
      from public.list_custody_config_audit_events(50, null)
    ) >= 1,
  'AAL2 admin custody reads return rows'
);

select extensions.ok(
  not exists (
    select 1
    from private.custody_config_audit_events
    where request_data::text ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|provider[[:space:]_-]*account|deposit[[:space:]_-]*address|wallet[[:space:]_-]*address|signature|transaction[[:space:]_-]*(id|hash|signature)|tx[[:space:]_-]*(id|hash|signature)|https?://|rpc)'
  ),
  'custody audit request_data excludes credential, address, provider-account, and transaction markers'
);

select extensions.ok(
  (
    select count(*)::integer
    from private.custody_config_audit_events
    where outcome = 'APPLIED'
  ) > 0
    and (
      select count(*)::integer
      from private.custody_config_audit_events
      where outcome = 'NOOP'
    ) > 0,
  'custody audit stores applied and noop events'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    update private.custody_config_audit_events
    set reason = 'changed';
    raise exception 'expected audit update failure';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;
  $$;
  $_$,
  'custody audit update is blocked'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema in ('public', 'private')
      and table_name in (
        'custody_providers',
        'custody_account_bindings',
        'custody_config_audit_events'
      )
      and lower(column_name) in (
        'balance',
        'available_balance',
        'locked_balance',
        'provider_account_id',
        'external_account_id',
        'deposit_address',
        'withdrawal_address',
        'wallet_address',
        'blockchain_address',
        'private_key',
        'mnemonic',
        'seed_phrase',
        'transaction_id',
        'transaction_hash',
        'tx_hash',
        'signature',
        'rpc_url',
        'api_key',
        'api_secret'
      )
  ),
  'custody schema excludes balances, credentials, addresses, and transaction identifiers'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_journals
  ),
  0,
  'custody configuration commands do not post ledger journals'
);

select * from extensions.finish();

rollback;
