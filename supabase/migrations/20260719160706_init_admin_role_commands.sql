create table private.admin_role_audit_events (
  id uuid primary key default gen_random_uuid(),

  command_id uuid not null unique,

  action text not null,
  outcome text not null,

  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,

  target_user_id uuid not null
    references public.profiles (id) on delete restrict,

  role text not null default 'ADMIN',

  role_record_id uuid null
    references public.user_roles (id) on delete restrict,

  reason text not null,

  target_account_status text not null,

  previously_active boolean not null,
  resulting_active boolean not null,

  role_version bigint null,

  occurred_at timestamptz not null default clock_timestamp(),

  constraint admin_role_audit_events_action_check
    check (action in ('GRANT_ADMIN', 'REVOKE_ADMIN')),

  constraint admin_role_audit_events_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),

  constraint admin_role_audit_events_role_check
    check (role = 'ADMIN'),

  constraint admin_role_audit_events_reason_check
    check (
      reason = btrim(reason)
      and char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
    ),

  constraint admin_role_audit_events_target_status_check
    check (target_account_status in ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'WITHDRAWN')),

  constraint admin_role_audit_events_role_version_check
    check (role_version is null or role_version >= 1),

  constraint admin_role_audit_events_state_check
    check (
      (
        action = 'GRANT_ADMIN'
        and outcome = 'APPLIED'
        and previously_active = false
        and resulting_active = true
      )
      or (
        action = 'GRANT_ADMIN'
        and outcome = 'NOOP'
        and previously_active = true
        and resulting_active = true
      )
      or (
        action = 'REVOKE_ADMIN'
        and outcome = 'APPLIED'
        and previously_active = true
        and resulting_active = false
      )
      or (
        action = 'REVOKE_ADMIN'
        and outcome = 'NOOP'
        and previously_active = false
        and resulting_active = false
      )
    )
);

comment on table private.admin_role_audit_events is
  'Append-only audit events for AAL2 ADMIN role commands; command IDs provide idempotency and direct role table writes remain prohibited.';

create index admin_role_audit_events_occurred_at_idx
  on private.admin_role_audit_events (occurred_at desc, id desc);

create index admin_role_audit_events_actor_idx
  on private.admin_role_audit_events (actor_user_id, occurred_at desc);

create index admin_role_audit_events_target_idx
  on private.admin_role_audit_events (target_user_id, occurred_at desc);

create index admin_role_audit_events_role_record_idx
  on private.admin_role_audit_events (role_record_id);

revoke all privileges on table private.admin_role_audit_events
  from public, anon, authenticated;

create or replace function private.prevent_admin_role_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ADMIN_AUDIT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_admin_role_audit_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE on append-only ADMIN role audit events.';

revoke execute on function private.prevent_admin_role_audit_mutation()
  from public, anon, authenticated;

create trigger protect_admin_role_audit_events
  before update or delete or truncate
  on private.admin_role_audit_events
  for each statement
  execute function private.prevent_admin_role_audit_mutation();

create or replace function public.grant_admin_role(
  p_target_user_id uuid,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  target_user_id uuid,
  role_record_id uuid,
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
  v_target_account_status text;
  v_existing_event private.admin_role_audit_events%rowtype;
  v_role_record_id uuid;
  v_role_version bigint;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := (select auth.uid());

  if v_actor_user_id is null or not public.is_current_user_admin_aal2() then
    raise exception 'ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  v_reason := pg_catalog.btrim(p_reason);

  if p_target_user_id is null
    or p_command_id is null
    or v_reason is null
    or v_reason = ''
    or pg_catalog.char_length(v_reason) > 500
    or v_reason ~ '[[:cntrl:]]'
  then
    return query
      select
        'INVALID_INPUT'::text,
        false,
        null::uuid,
        p_command_id,
        p_target_user_id,
        null::uuid,
        null::timestamptz;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:admin-role-command:v1',
      0
    )
  );

  select events.*
    into v_existing_event
  from private.admin_role_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'GRANT_ADMIN'
      and v_existing_event.target_user_id = p_target_user_id
      and v_existing_event.reason = v_reason
    then
      return query
        select
          v_existing_event.outcome,
          true,
          v_existing_event.id,
          v_existing_event.command_id,
          v_existing_event.target_user_id,
          v_existing_event.role_record_id,
          v_existing_event.occurred_at;
      return;
    end if;

    return query
      select
        'COMMAND_ID_CONFLICT'::text,
        false,
        null::uuid,
        p_command_id,
        p_target_user_id,
        null::uuid,
        null::timestamptz;
    return;
  end if;

  select profiles.account_status
    into v_target_account_status
  from public.profiles as profiles
  where profiles.id = p_target_user_id
  for update;

  if not found then
    return query
      select
        'TARGET_NOT_FOUND'::text,
        false,
        null::uuid,
        p_command_id,
        p_target_user_id,
        null::uuid,
        null::timestamptz;
    return;
  end if;

  if v_target_account_status <> 'ACTIVE' then
    return query
      select
        'TARGET_INACTIVE'::text,
        false,
        null::uuid,
        p_command_id,
        p_target_user_id,
        null::uuid,
        null::timestamptz;
    return;
  end if;

  select roles.id, roles.version
    into v_role_record_id, v_role_version
  from public.user_roles as roles
  where roles.user_id = p_target_user_id
    and roles.role = 'ADMIN'
    and roles.revoked_at is null
  for update;

  if found then
    insert into private.admin_role_audit_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      target_user_id,
      role_record_id,
      reason,
      target_account_status,
      previously_active,
      resulting_active,
      role_version
    )
    values (
      p_command_id,
      'GRANT_ADMIN',
      'NOOP',
      v_actor_user_id,
      p_target_user_id,
      v_role_record_id,
      v_reason,
      v_target_account_status,
      true,
      true,
      v_role_version
    )
    returning
      private.admin_role_audit_events.id,
      private.admin_role_audit_events.occurred_at
      into v_event_id, v_occurred_at;

    return query
      select
        'NOOP'::text,
        false,
        v_event_id,
        p_command_id,
        p_target_user_id,
        v_role_record_id,
        v_occurred_at;
    return;
  end if;

  insert into public.user_roles (
    user_id,
    role,
    granted_by,
    grant_reason
  )
  values (
    p_target_user_id,
    'ADMIN',
    v_actor_user_id,
    v_reason
  )
  returning id, version
    into v_role_record_id, v_role_version;

  insert into private.admin_role_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    target_user_id,
    role_record_id,
    reason,
    target_account_status,
    previously_active,
    resulting_active,
    role_version
  )
  values (
    p_command_id,
    'GRANT_ADMIN',
    'APPLIED',
    v_actor_user_id,
    p_target_user_id,
    v_role_record_id,
    v_reason,
    v_target_account_status,
    false,
    true,
    v_role_version
  )
  returning
    private.admin_role_audit_events.id,
    private.admin_role_audit_events.occurred_at
    into v_event_id, v_occurred_at;

  return query
    select
      'APPLIED'::text,
      false,
      v_event_id,
      p_command_id,
      p_target_user_id,
      v_role_record_id,
      v_occurred_at;
end;
$$;

comment on function public.grant_admin_role(uuid, uuid, text) is
  'AAL2 ADMIN command to idempotently grant ADMIN, recording APPLIED or NOOP in append-only audit.';

create or replace function public.revoke_admin_role(
  p_target_user_id uuid,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  target_user_id uuid,
  role_record_id uuid,
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
  v_target_account_status text;
  v_existing_event private.admin_role_audit_events%rowtype;
  v_role_record_id uuid;
  v_role_version bigint;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := (select auth.uid());

  if v_actor_user_id is null or not public.is_current_user_admin_aal2() then
    raise exception 'ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  v_reason := pg_catalog.btrim(p_reason);

  if p_target_user_id is null
    or p_command_id is null
    or v_reason is null
    or v_reason = ''
    or pg_catalog.char_length(v_reason) > 500
    or v_reason ~ '[[:cntrl:]]'
  then
    return query
      select
        'INVALID_INPUT'::text,
        false,
        null::uuid,
        p_command_id,
        p_target_user_id,
        null::uuid,
        null::timestamptz;
    return;
  end if;

  if p_target_user_id = v_actor_user_id then
    return query
      select
        'SELF_REVOKE_FORBIDDEN'::text,
        false,
        null::uuid,
        p_command_id,
        p_target_user_id,
        null::uuid,
        null::timestamptz;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:admin-role-command:v1',
      0
    )
  );

  select events.*
    into v_existing_event
  from private.admin_role_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'REVOKE_ADMIN'
      and v_existing_event.target_user_id = p_target_user_id
      and v_existing_event.reason = v_reason
    then
      return query
        select
          v_existing_event.outcome,
          true,
          v_existing_event.id,
          v_existing_event.command_id,
          v_existing_event.target_user_id,
          v_existing_event.role_record_id,
          v_existing_event.occurred_at;
      return;
    end if;

    return query
      select
        'COMMAND_ID_CONFLICT'::text,
        false,
        null::uuid,
        p_command_id,
        p_target_user_id,
        null::uuid,
        null::timestamptz;
    return;
  end if;

  select profiles.account_status
    into v_target_account_status
  from public.profiles as profiles
  where profiles.id = p_target_user_id
  for update;

  if not found then
    return query
      select
        'TARGET_NOT_FOUND'::text,
        false,
        null::uuid,
        p_command_id,
        p_target_user_id,
        null::uuid,
        null::timestamptz;
    return;
  end if;

  select roles.id, roles.version
    into v_role_record_id, v_role_version
  from public.user_roles as roles
  where roles.user_id = p_target_user_id
    and roles.role = 'ADMIN'
    and roles.revoked_at is null
  for update;

  if not found then
    insert into private.admin_role_audit_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      target_user_id,
      role_record_id,
      reason,
      target_account_status,
      previously_active,
      resulting_active,
      role_version
    )
    values (
      p_command_id,
      'REVOKE_ADMIN',
      'NOOP',
      v_actor_user_id,
      p_target_user_id,
      null,
      v_reason,
      v_target_account_status,
      false,
      false,
      null
    )
    returning
      private.admin_role_audit_events.id,
      private.admin_role_audit_events.occurred_at
      into v_event_id, v_occurred_at;

    return query
      select
        'NOOP'::text,
        false,
        v_event_id,
        p_command_id,
        p_target_user_id,
        null::uuid,
        v_occurred_at;
    return;
  end if;

  update public.user_roles as roles
  set revoked_by = v_actor_user_id,
    revoked_at = clock_timestamp(),
    revoke_reason = v_reason,
    version = roles.version + 1
  where roles.id = v_role_record_id
  returning roles.version
    into v_role_version;

  insert into private.admin_role_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    target_user_id,
    role_record_id,
    reason,
    target_account_status,
    previously_active,
    resulting_active,
    role_version
  )
  values (
    p_command_id,
    'REVOKE_ADMIN',
    'APPLIED',
    v_actor_user_id,
    p_target_user_id,
    v_role_record_id,
    v_reason,
    v_target_account_status,
    true,
    false,
    v_role_version
  )
  returning
    private.admin_role_audit_events.id,
    private.admin_role_audit_events.occurred_at
    into v_event_id, v_occurred_at;

  return query
    select
      'APPLIED'::text,
      false,
      v_event_id,
      p_command_id,
      p_target_user_id,
      v_role_record_id,
      v_occurred_at;
end;
$$;

comment on function public.revoke_admin_role(uuid, uuid, text) is
  'AAL2 ADMIN command to idempotently revoke ADMIN, blocking self-revoke and recording APPLIED or NOOP in append-only audit.';

create or replace function public.list_admin_role_audit_events(
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
  role text,
  role_record_id uuid,
  reason text,
  target_account_status text,
  previously_active boolean,
  resulting_active boolean,
  role_version bigint,
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
  if not public.is_current_user_admin_aal2() then
    raise exception 'ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_event_id is not null then
    select events.occurred_at, events.id
      into v_before_occurred_at, v_before_id
    from private.admin_role_audit_events as events
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
      events.role,
      events.role_record_id,
      events.reason,
      events.target_account_status,
      events.previously_active,
      events.resulting_active,
      events.role_version,
      events.occurred_at
    from private.admin_role_audit_events as events
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

comment on function public.list_admin_role_audit_events(integer, uuid) is
  'AAL2 ADMIN-only append-only ADMIN role audit listing with cursor pagination; direct role table reads remain prohibited.';

revoke execute on function public.grant_admin_role(uuid, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.revoke_admin_role(uuid, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.list_admin_role_audit_events(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.grant_admin_role(uuid, uuid, text)
  to authenticated;

grant execute on function public.revoke_admin_role(uuid, uuid, text)
  to authenticated;

grant execute on function public.list_admin_role_audit_events(integer, uuid)
  to authenticated;
