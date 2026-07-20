create table private.wallet_account_admin_audit_events (
  id uuid primary key default gen_random_uuid(),

  command_id uuid not null unique,

  action text not null,
  outcome text not null,

  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,

  target_user_id uuid not null
    references public.profiles (id) on delete restrict,

  wallet_account_id uuid not null
    references public.wallet_accounts (id) on delete restrict,

  reason text not null,
  request_data jsonb not null,

  target_profile_status text not null,
  previous_status text not null,
  resulting_status text not null,
  previous_closed_at timestamptz null,
  resulting_closed_at timestamptz null,

  entity_version bigint not null,

  occurred_at timestamptz not null default clock_timestamp(),

  constraint wallet_account_admin_audit_events_action_check
    check (action = 'TRANSITION_WALLET_ACCOUNT_STATUS'),

  constraint wallet_account_admin_audit_events_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),

  constraint wallet_account_admin_audit_events_reason_check
    check (
      reason = pg_catalog.btrim(reason)
      and pg_catalog.char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
    ),

  constraint wallet_account_admin_audit_events_request_data_check
    check (jsonb_typeof(request_data) = 'object'),

  constraint wallet_account_admin_audit_events_profile_status_check
    check (target_profile_status in ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'WITHDRAWN')),

  constraint wallet_account_admin_audit_events_status_check
    check (
      previous_status in ('ACTIVE', 'FROZEN', 'CLOSED')
      and resulting_status in ('ACTIVE', 'FROZEN', 'CLOSED')
    ),

  constraint wallet_account_admin_audit_events_outcome_status_check
    check (
      (outcome = 'APPLIED' and previous_status <> resulting_status)
      or (outcome = 'NOOP' and previous_status = resulting_status)
    ),

  constraint wallet_account_admin_audit_events_closed_at_check
    check (
      (previous_status <> 'CLOSED' or previous_closed_at is not null)
      and (
        (resulting_status = 'CLOSED' and resulting_closed_at is not null)
        or (resulting_status in ('ACTIVE', 'FROZEN') and resulting_closed_at is null)
      )
    ),

  constraint wallet_account_admin_audit_events_entity_version_check
    check (entity_version >= 1)
);

comment on table private.wallet_account_admin_audit_events is
  'Append-only audit events for ACTIVE ADMIN AAL2 wallet account status commands; command id idempotency, expected-version concurrency, and browser direct writes are enforced. Wallet state is not a financial amount.';

create index wallet_account_admin_audit_events_occurred_at_idx
  on private.wallet_account_admin_audit_events (occurred_at desc, id desc);

create index wallet_account_admin_audit_events_actor_idx
  on private.wallet_account_admin_audit_events (actor_user_id, occurred_at desc);

create index wallet_account_admin_audit_events_target_user_idx
  on private.wallet_account_admin_audit_events (target_user_id, occurred_at desc);

create index wallet_account_admin_audit_events_wallet_account_idx
  on private.wallet_account_admin_audit_events (wallet_account_id, occurred_at desc);

revoke all privileges on table private.wallet_account_admin_audit_events
  from public, anon, authenticated;

create or replace function private.prevent_wallet_account_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'WALLET_ACCOUNT_AUDIT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_wallet_account_admin_audit_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE for append-only wallet account administrator audit events.';

revoke execute on function private.prevent_wallet_account_admin_audit_mutation()
  from public, anon, authenticated;

create trigger protect_wallet_account_admin_audit_events
  before update or delete or truncate
  on private.wallet_account_admin_audit_events
  for each statement
  execute function private.prevent_wallet_account_admin_audit_mutation();

create or replace function private.wallet_account_require_admin_aal2()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
begin
  v_actor_user_id := (select auth.uid());

  if v_actor_user_id is null or not public.is_current_user_admin_aal2() then
    raise exception 'WALLET_ACCOUNT_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

create or replace function private.wallet_account_normalize_reason(
  p_reason text
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  v_reason := pg_catalog.btrim(p_reason);

  if v_reason is null
    or v_reason = ''
    or pg_catalog.char_length(v_reason) > 500
    or v_reason ~ '[[:cntrl:]]'
  then
    return null;
  end if;

  return v_reason;
end;
$$;

create or replace function private.record_wallet_account_admin_audit_event(
  p_command_id uuid,
  p_outcome text,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_wallet_account_id uuid,
  p_reason text,
  p_request_data jsonb,
  p_target_profile_status text,
  p_previous_status text,
  p_resulting_status text,
  p_previous_closed_at timestamptz,
  p_resulting_closed_at timestamptz,
  p_entity_version bigint
)
returns table (
  out_event_id uuid,
  out_occurred_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into private.wallet_account_admin_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    target_user_id,
    wallet_account_id,
    reason,
    request_data,
    target_profile_status,
    previous_status,
    resulting_status,
    previous_closed_at,
    resulting_closed_at,
    entity_version
  )
  values (
    p_command_id,
    'TRANSITION_WALLET_ACCOUNT_STATUS',
    p_outcome,
    p_actor_user_id,
    p_target_user_id,
    p_wallet_account_id,
    p_reason,
    p_request_data,
    p_target_profile_status,
    p_previous_status,
    p_resulting_status,
    p_previous_closed_at,
    p_resulting_closed_at,
    p_entity_version
  )
  returning id, occurred_at
    into out_event_id, out_occurred_at;

  return next;
end;
$$;

revoke execute on function private.wallet_account_require_admin_aal2()
  from public, anon, authenticated;

revoke execute on function private.wallet_account_normalize_reason(text)
  from public, anon, authenticated;

revoke execute on function private.record_wallet_account_admin_audit_event(
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  bigint
) from public, anon, authenticated;

create or replace function public.transition_wallet_account_status(
  p_wallet_account_id uuid,
  p_expected_version bigint,
  p_new_status text,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  wallet_account_id uuid,
  target_user_id uuid,
  entity_version bigint,
  occurred_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_reason text;
  v_new_status text;
  v_request_data jsonb;
  v_existing_event private.wallet_account_admin_audit_events%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_profile_status text;
  v_previous_status text;
  v_previous_closed_at timestamptz;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.wallet_account_require_admin_aal2();
  v_reason := private.wallet_account_normalize_reason(p_reason);
  v_new_status := pg_catalog.btrim(p_new_status);

  if p_wallet_account_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_command_id is null
    or v_reason is null
    or v_new_status not in ('ACTIVE', 'FROZEN', 'CLOSED')
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_wallet_account_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'wallet_account_id', p_wallet_account_id,
    'expected_version', p_expected_version,
    'new_status', v_new_status
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:wallet-account-command:v1', 0));

  select events.* into v_existing_event
  from private.wallet_account_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'TRANSITION_WALLET_ACCOUNT_STATUS'
      and v_existing_event.wallet_account_id = p_wallet_account_id
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select
        v_existing_event.outcome,
        true,
        v_existing_event.id,
        v_existing_event.command_id,
        v_existing_event.wallet_account_id,
        v_existing_event.target_user_id,
        v_existing_event.entity_version,
        v_existing_event.occurred_at;
      return;
    end if;

    return query select 'COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_wallet_account_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = p_wallet_account_id
  for update;

  if not found then
    return query select 'WALLET_ACCOUNT_NOT_FOUND'::text, false, null::uuid, p_command_id, p_wallet_account_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_wallet.version <> p_expected_version then
    return query select 'WALLET_ACCOUNT_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, p_wallet_account_id, v_wallet.user_id, v_wallet.version, null::timestamptz;
    return;
  end if;

  if v_wallet.status = v_new_status then
    v_outcome := 'NOOP';
  elsif not (
    (v_wallet.status = 'ACTIVE' and v_new_status = 'FROZEN')
    or (v_wallet.status = 'FROZEN' and v_new_status in ('ACTIVE', 'CLOSED'))
  ) then
    return query select 'WALLET_ACCOUNT_TRANSITION_INVALID'::text, false, null::uuid, p_command_id, p_wallet_account_id, v_wallet.user_id, v_wallet.version, null::timestamptz;
    return;
  else
    if v_wallet.status = 'FROZEN' and v_new_status = 'ACTIVE' then
      select profiles.account_status into v_profile_status
      from public.profiles as profiles
      where profiles.id = v_wallet.user_id
      for update;

      if v_profile_status is distinct from 'ACTIVE' then
        return query select 'TARGET_PROFILE_INACTIVE'::text, false, null::uuid, p_command_id, p_wallet_account_id, v_wallet.user_id, v_wallet.version, null::timestamptz;
        return;
      end if;
    end if;

    v_previous_status := v_wallet.status;
    v_previous_closed_at := v_wallet.closed_at;

    update public.wallet_accounts as wallet_accounts
    set
      status = v_new_status,
      closed_at = case
        when v_new_status = 'CLOSED' then clock_timestamp()
        else null
      end
    where wallet_accounts.id = p_wallet_account_id
    returning wallet_accounts.*
      into v_wallet;

    v_outcome := 'APPLIED';
  end if;

  if v_profile_status is null then
    select profiles.account_status into v_profile_status
    from public.profiles as profiles
    where profiles.id = v_wallet.user_id;
  end if;

  if v_previous_status is null then
    v_previous_status := v_wallet.status;
    v_previous_closed_at := v_wallet.closed_at;
  end if;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_wallet_account_admin_audit_event(
    p_command_id,
    v_outcome,
    v_actor_user_id,
    v_wallet.user_id,
    v_wallet.id,
    v_reason,
    v_request_data,
    v_profile_status,
    v_previous_status,
    v_wallet.status,
    v_previous_closed_at,
    v_wallet.closed_at,
    v_wallet.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, v_wallet.id, v_wallet.user_id, v_wallet.version, v_occurred_at;
end;
$$;

comment on function public.transition_wallet_account_status(uuid, bigint, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to transition managed wallet account status with expected-version concurrency, command id idempotency, and append-only audit. Wallet state is not a balance or financial amount; browser direct writes are prohibited.';

create or replace function public.list_admin_wallet_accounts(
  p_limit integer default 100
)
returns table (
  wallet_account_id uuid,
  user_id uuid,
  custody_model text,
  wallet_status text,
  closed_at timestamptz,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz,
  profile_account_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform private.wallet_account_require_admin_aal2();

  v_limit := coalesce(p_limit, 100);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select
      wallet_accounts.id,
      wallet_accounts.user_id,
      wallet_accounts.custody_model,
      wallet_accounts.status,
      wallet_accounts.closed_at,
      wallet_accounts.version,
      wallet_accounts.created_at,
      wallet_accounts.updated_at,
      profiles.account_status
    from public.wallet_accounts as wallet_accounts
    join public.profiles as profiles
      on profiles.id = wallet_accounts.user_id
    order by wallet_accounts.created_at desc, wallet_accounts.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_wallet_accounts(integer) is
  'ACTIVE ADMIN AAL2 read RPC for managed wallet account operational state. It returns no email, balance, address, credential, or financial amount fields.';

create or replace function public.list_wallet_account_admin_audit_events(
  p_limit integer default 50,
  p_before_event_id uuid default null
)
returns table (
  event_id uuid,
  command_id uuid,
  action text,
  outcome text,
  actor_user_id uuid,
  target_user_id uuid,
  wallet_account_id uuid,
  reason text,
  target_profile_status text,
  previous_status text,
  resulting_status text,
  entity_version bigint,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_before_occurred_at timestamptz;
  v_before_id uuid;
begin
  perform private.wallet_account_require_admin_aal2();

  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_event_id is not null then
    select events.occurred_at, events.id
      into v_before_occurred_at, v_before_id
    from private.wallet_account_admin_audit_events as events
    where events.id = p_before_event_id;

    if not found then
      return;
    end if;
  end if;

  return query
    select
      events.id,
      events.command_id,
      events.action,
      events.outcome,
      events.actor_user_id,
      events.target_user_id,
      events.wallet_account_id,
      events.reason,
      events.target_profile_status,
      events.previous_status,
      events.resulting_status,
      events.entity_version,
      events.occurred_at
    from private.wallet_account_admin_audit_events as events
    where p_before_event_id is null
      or events.occurred_at < v_before_occurred_at
      or (
        events.occurred_at = v_before_occurred_at
        and events.id < v_before_id
      )
    order by events.occurred_at desc, events.id desc
    limit v_limit;
end;
$$;

comment on function public.list_wallet_account_admin_audit_events(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for append-only wallet account status audit events. It exposes command outcomes only, not balances, addresses, credentials, cookies, tokens, or metadata.';

revoke execute on function public.transition_wallet_account_status(uuid, bigint, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.list_admin_wallet_accounts(integer)
  from public, anon, authenticated;

revoke execute on function public.list_wallet_account_admin_audit_events(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.transition_wallet_account_status(uuid, bigint, text, uuid, text)
  to authenticated;

grant execute on function public.list_admin_wallet_accounts(integer)
  to authenticated;

grant execute on function public.list_wallet_account_admin_audit_events(integer, uuid)
  to authenticated;

drop policy projects_select_active_catalog on public.projects;

create policy projects_select_active_catalog
  on public.projects
  for select
  to authenticated
  using (
    status = 'ACTIVE'
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.id = (select auth.uid())
        and profiles.account_status = 'ACTIVE'
    )
  );

drop policy supported_assets_select_active_catalog on public.supported_assets;

create policy supported_assets_select_active_catalog
  on public.supported_assets
  for select
  to authenticated
  using (
    status = 'ACTIVE'
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.id = (select auth.uid())
        and profiles.account_status = 'ACTIVE'
    )
  );

drop policy project_token_assignments_select_active_catalog
  on public.project_token_assignments;

create policy project_token_assignments_select_active_catalog
  on public.project_token_assignments
  for select
  to authenticated
  using (
    retired_at is null
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.id = (select auth.uid())
        and profiles.account_status = 'ACTIVE'
    )
    and exists (
      select 1
      from public.projects as projects
      where projects.id = project_token_assignments.project_id
        and projects.status = 'ACTIVE'
    )
    and exists (
      select 1
      from public.supported_assets as assets
      where assets.id = project_token_assignments.asset_id
        and assets.status = 'ACTIVE'
    )
  );

drop policy wallet_accounts_select_own on public.wallet_accounts;

create policy wallet_accounts_select_own
  on public.wallet_accounts
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles as profiles
      where profiles.id = (select auth.uid())
        and profiles.account_status = 'ACTIVE'
    )
  );
