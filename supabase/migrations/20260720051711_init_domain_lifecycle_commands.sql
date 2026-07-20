create table private.domain_admin_audit_events (
  id uuid primary key default gen_random_uuid(),

  command_id uuid not null unique,

  action text not null,
  outcome text not null,

  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,

  project_id uuid null
    references public.projects (id) on delete restrict,

  asset_id uuid null
    references public.supported_assets (id) on delete restrict,

  assignment_id uuid null
    references public.project_token_assignments (id) on delete restrict,

  reason text not null,

  request_data jsonb not null,
  before_state jsonb null,
  after_state jsonb null,

  entity_version bigint null,

  occurred_at timestamptz not null default clock_timestamp(),

  constraint domain_admin_audit_events_action_check
    check (
      action in (
        'CREATE_PROJECT',
        'UPDATE_PROJECT_DETAILS',
        'TRANSITION_PROJECT_STATUS',
        'CREATE_ASSET',
        'UPDATE_ASSET_DETAILS',
        'TRANSITION_ASSET_STATUS',
        'ASSIGN_PROJECT_TOKEN',
        'RETIRE_PROJECT_TOKEN'
      )
    ),

  constraint domain_admin_audit_events_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),

  constraint domain_admin_audit_events_reason_check
    check (
      reason = pg_catalog.btrim(reason)
      and pg_catalog.char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
    ),

  constraint domain_admin_audit_events_request_data_check
    check (jsonb_typeof(request_data) = 'object'),

  constraint domain_admin_audit_events_state_shape_check
    check (
      (before_state is null or jsonb_typeof(before_state) = 'object')
      and (after_state is null or jsonb_typeof(after_state) = 'object')
    ),

  constraint domain_admin_audit_events_entity_version_check
    check (entity_version is null or entity_version >= 1),

  constraint domain_admin_audit_events_entity_fk_check
    check (
      (
        action in (
          'CREATE_PROJECT',
          'UPDATE_PROJECT_DETAILS',
          'TRANSITION_PROJECT_STATUS'
        )
        and project_id is not null
        and asset_id is null
        and assignment_id is null
        and entity_version is not null
      )
      or (
        action in (
          'CREATE_ASSET',
          'UPDATE_ASSET_DETAILS',
          'TRANSITION_ASSET_STATUS'
        )
        and project_id is null
        and asset_id is not null
        and assignment_id is null
        and entity_version is not null
      )
      or (
        action in (
          'ASSIGN_PROJECT_TOKEN',
          'RETIRE_PROJECT_TOKEN'
        )
        and project_id is not null
        and asset_id is not null
        and assignment_id is not null
        and entity_version is not null
      )
    )
);

comment on table private.domain_admin_audit_events is
  'Append-only audit events for ACTIVE ADMIN AAL2 project, asset, and project-token lifecycle commands; browser direct table access is prohibited.';

create index domain_admin_audit_events_occurred_at_idx
  on private.domain_admin_audit_events (occurred_at desc, id desc);

create index domain_admin_audit_events_actor_idx
  on private.domain_admin_audit_events (actor_user_id, occurred_at desc);

create index domain_admin_audit_events_project_idx
  on private.domain_admin_audit_events (project_id, occurred_at desc)
  where project_id is not null;

create index domain_admin_audit_events_asset_idx
  on private.domain_admin_audit_events (asset_id, occurred_at desc)
  where asset_id is not null;

create index domain_admin_audit_events_assignment_idx
  on private.domain_admin_audit_events (assignment_id, occurred_at desc)
  where assignment_id is not null;

revoke all privileges on table private.domain_admin_audit_events
  from public, anon, authenticated;

create or replace function private.prevent_domain_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'DOMAIN_AUDIT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_domain_admin_audit_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE on append-only domain lifecycle audit events.';

revoke execute on function private.prevent_domain_admin_audit_mutation()
  from public, anon, authenticated;

create trigger protect_domain_admin_audit_events
  before update or delete or truncate
  on private.domain_admin_audit_events
  for each statement
  execute function private.prevent_domain_admin_audit_mutation();

create or replace function private.domain_require_admin_aal2()
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
    raise exception 'DOMAIN_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

create or replace function private.domain_normalize_reason(
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

create or replace function private.domain_project_snapshot(
  p_project_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', projects.id,
    'project_code', projects.project_code,
    'display_name', projects.display_name,
    'description', projects.description,
    'status', projects.status,
    'version', projects.version,
    'created_at', projects.created_at,
    'updated_at', projects.updated_at
  )
  from public.projects as projects
  where projects.id = p_project_id;
$$;

create or replace function private.domain_asset_snapshot(
  p_asset_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', assets.id,
    'asset_code', assets.asset_code,
    'symbol', assets.symbol,
    'display_name', assets.display_name,
    'network', assets.network,
    'asset_type', assets.asset_type,
    'decimals', assets.decimals,
    'mint_address', assets.mint_address,
    'status', assets.status,
    'version', assets.version,
    'created_at', assets.created_at,
    'updated_at', assets.updated_at
  )
  from public.supported_assets as assets
  where assets.id = p_asset_id;
$$;

create or replace function private.domain_assignment_snapshot(
  p_assignment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', assignments.id,
    'project_id', assignments.project_id,
    'asset_id', assignments.asset_id,
    'assigned_at', assignments.assigned_at,
    'retired_at', assignments.retired_at,
    'version', assignments.version,
    'created_at', assignments.created_at,
    'updated_at', assignments.updated_at
  )
  from public.project_token_assignments as assignments
  where assignments.id = p_assignment_id;
$$;

create or replace function private.record_domain_admin_audit_event(
  p_command_id uuid,
  p_action text,
  p_outcome text,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_asset_id uuid,
  p_assignment_id uuid,
  p_reason text,
  p_request_data jsonb,
  p_before_state jsonb,
  p_after_state jsonb,
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
  insert into private.domain_admin_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    project_id,
    asset_id,
    assignment_id,
    reason,
    request_data,
    before_state,
    after_state,
    entity_version
  )
  values (
    p_command_id,
    p_action,
    p_outcome,
    p_actor_user_id,
    p_project_id,
    p_asset_id,
    p_assignment_id,
    p_reason,
    p_request_data,
    p_before_state,
    p_after_state,
    p_entity_version
  )
  returning id, occurred_at
    into out_event_id, out_occurred_at;

  return next;
end;
$$;

revoke execute on function private.domain_require_admin_aal2()
  from public, anon, authenticated;

revoke execute on function private.domain_normalize_reason(text)
  from public, anon, authenticated;

revoke execute on function private.domain_project_snapshot(uuid)
  from public, anon, authenticated;

revoke execute on function private.domain_asset_snapshot(uuid)
  from public, anon, authenticated;

revoke execute on function private.domain_assignment_snapshot(uuid)
  from public, anon, authenticated;

revoke execute on function private.record_domain_admin_audit_event(
  uuid,
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  bigint
) from public, anon, authenticated;

create or replace function public.create_project(
  p_project_code text,
  p_display_name text,
  p_description text,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  project_id uuid,
  asset_id uuid,
  assignment_id uuid,
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
  v_project_code text;
  v_display_name text;
  v_description text;
  v_request_data jsonb;
  v_existing_event private.domain_admin_audit_events%rowtype;
  v_project_id uuid;
  v_project_version bigint;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.domain_require_admin_aal2();
  v_reason := private.domain_normalize_reason(p_reason);
  v_project_code := pg_catalog.btrim(p_project_code);
  v_display_name := pg_catalog.btrim(p_display_name);
  v_description := nullif(pg_catalog.btrim(p_description), '');

  if p_command_id is null
    or v_reason is null
    or v_project_code is null
    or v_project_code !~ '^[A-Z0-9][A-Z0-9_]{1,31}$'
    or v_display_name is null
    or pg_catalog.char_length(v_display_name) not between 1 and 100
    or v_display_name ~ '[[:cntrl:]]'
    or (
      v_description is not null
      and (
        pg_catalog.char_length(v_description) not between 1 and 2000
        or v_description ~ '[[:cntrl:]]'
      )
    )
  then
    return query
      select
        'INVALID_INPUT'::text,
        false,
        null::uuid,
        p_command_id,
        null::uuid,
        null::uuid,
        null::uuid,
        null::bigint,
        null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'project_code', v_project_code,
    'display_name', v_display_name,
    'description', v_description
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:domain-lifecycle-command:v1',
      0
    )
  );

  select events.*
    into v_existing_event
  from private.domain_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'CREATE_PROJECT'
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          v_existing_event.id,
          v_existing_event.command_id,
          v_existing_event.project_id,
          v_existing_event.asset_id,
          v_existing_event.assignment_id,
          v_existing_event.entity_version,
          v_existing_event.occurred_at;
      return;
    end if;

    return query
      select
        'COMMAND_ID_CONFLICT'::text,
        false,
        null::uuid,
        p_command_id,
        null::uuid,
        null::uuid,
        null::uuid,
        null::bigint,
        null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from public.projects as projects
    where projects.project_code = v_project_code
  ) then
    return query
      select
        'PROJECT_CODE_EXISTS'::text,
        false,
        null::uuid,
        p_command_id,
        null::uuid,
        null::uuid,
        null::uuid,
        null::bigint,
        null::timestamptz;
    return;
  end if;

  insert into public.projects (
    project_code,
    display_name,
    description,
    status
  )
  values (
    v_project_code,
    v_display_name,
    v_description,
    'DRAFT'
  )
  returning id, version
    into v_project_id, v_project_version;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_domain_admin_audit_event(
    p_command_id,
    'CREATE_PROJECT',
    'APPLIED',
    v_actor_user_id,
    v_project_id,
    null,
    null,
    v_reason,
    v_request_data,
    null,
    private.domain_project_snapshot(v_project_id),
    v_project_version
  ) as audit;

  return query
    select
      'APPLIED'::text,
      false,
      v_event_id,
      p_command_id,
      v_project_id,
      null::uuid,
      null::uuid,
      v_project_version,
      v_occurred_at;
end;
$$;

comment on function public.create_project(text, text, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to create a DRAFT project with command-id idempotency and append-only domain audit.';

create or replace function public.update_project_details(
  p_project_id uuid,
  p_expected_version bigint,
  p_display_name text,
  p_description text,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  project_id uuid,
  asset_id uuid,
  assignment_id uuid,
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
  v_display_name text;
  v_description text;
  v_request_data jsonb;
  v_existing_event private.domain_admin_audit_events%rowtype;
  v_project public.projects%rowtype;
  v_before_state jsonb;
  v_after_state jsonb;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.domain_require_admin_aal2();
  v_reason := private.domain_normalize_reason(p_reason);
  v_display_name := pg_catalog.btrim(p_display_name);
  v_description := nullif(pg_catalog.btrim(p_description), '');

  if p_project_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_command_id is null
    or v_reason is null
    or v_display_name is null
    or pg_catalog.char_length(v_display_name) not between 1 and 100
    or v_display_name ~ '[[:cntrl:]]'
    or (
      v_description is not null
      and (
        pg_catalog.char_length(v_description) not between 1 and 2000
        or v_description ~ '[[:cntrl:]]'
      )
    )
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'project_id', p_project_id,
    'expected_version', p_expected_version,
    'display_name', v_display_name,
    'description', v_description
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:domain-lifecycle-command:v1', 0));

  select events.* into v_existing_event
  from private.domain_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id and v_existing_event.action = 'UPDATE_PROJECT_DETAILS' and v_existing_event.reason = v_reason and v_existing_event.request_data = v_request_data then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.assignment_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  select projects.* into v_project
  from public.projects as projects
  where projects.id = p_project_id
  for update;

  if not found then
    return query select 'PROJECT_NOT_FOUND'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_project.version <> p_expected_version then
    return query select 'PROJECT_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, v_project.version, null::timestamptz;
    return;
  end if;

  if v_project.status = 'ARCHIVED' then
    return query select 'PROJECT_TRANSITION_INVALID'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, v_project.version, null::timestamptz;
    return;
  end if;

  v_before_state := private.domain_project_snapshot(p_project_id);

  if v_project.display_name = v_display_name
    and v_project.description is not distinct from v_description
  then
    v_outcome := 'NOOP';
  else
    update public.projects as projects
    set display_name = v_display_name,
      description = v_description
    where projects.id = p_project_id
    returning projects.*
      into v_project;

    v_outcome := 'APPLIED';
  end if;

  v_after_state := private.domain_project_snapshot(p_project_id);

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_domain_admin_audit_event(
    p_command_id,
    'UPDATE_PROJECT_DETAILS',
    v_outcome,
    v_actor_user_id,
    p_project_id,
    null,
    null,
    v_reason,
    v_request_data,
    v_before_state,
    v_after_state,
    v_project.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, p_project_id, null::uuid, null::uuid, v_project.version, v_occurred_at;
end;
$$;

comment on function public.update_project_details(uuid, bigint, text, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to update project display metadata with expected-version concurrency and append-only domain audit.';

create or replace function public.transition_project_status(
  p_project_id uuid,
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
  project_id uuid,
  asset_id uuid,
  assignment_id uuid,
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
  v_existing_event private.domain_admin_audit_events%rowtype;
  v_project public.projects%rowtype;
  v_before_state jsonb;
  v_after_state jsonb;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.domain_require_admin_aal2();
  v_reason := private.domain_normalize_reason(p_reason);
  v_new_status := pg_catalog.btrim(p_new_status);

  if p_project_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_command_id is null
    or v_reason is null
    or v_new_status not in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'project_id', p_project_id,
    'expected_version', p_expected_version,
    'new_status', v_new_status
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:domain-lifecycle-command:v1', 0));

  select events.* into v_existing_event
  from private.domain_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id and v_existing_event.action = 'TRANSITION_PROJECT_STATUS' and v_existing_event.reason = v_reason and v_existing_event.request_data = v_request_data then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.assignment_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  select projects.* into v_project
  from public.projects as projects
  where projects.id = p_project_id
  for update;

  if not found then
    return query select 'PROJECT_NOT_FOUND'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_project.version <> p_expected_version then
    return query select 'PROJECT_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, v_project.version, null::timestamptz;
    return;
  end if;

  if v_project.status = v_new_status then
    v_outcome := 'NOOP';
  elsif not (
    (v_project.status = 'DRAFT' and v_new_status in ('ACTIVE', 'ARCHIVED'))
    or (v_project.status = 'ACTIVE' and v_new_status = 'SUSPENDED')
    or (v_project.status = 'SUSPENDED' and v_new_status in ('ACTIVE', 'ARCHIVED'))
  ) then
    return query select 'PROJECT_TRANSITION_INVALID'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, v_project.version, null::timestamptz;
    return;
  else
    if v_new_status = 'ACTIVE' then
      if exists (
        select 1
        from public.projects as other_projects
        where other_projects.status = 'ACTIVE'
          and other_projects.id <> p_project_id
      ) then
        return query select 'ACTIVE_PROJECT_CONFLICT'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, v_project.version, null::timestamptz;
        return;
      end if;

      if not exists (
        select 1
        from public.project_token_assignments as assignments
        join public.supported_assets as assets
          on assets.id = assignments.asset_id
        where assignments.project_id = p_project_id
          and assignments.retired_at is null
          and assets.status = 'ACTIVE'
          and assets.asset_type = 'SPL_TOKEN'
          and assets.network = 'SOLANA'
          and assets.mint_address is not null
      ) then
        return query select 'PROJECT_ACTIVATION_NOT_READY'::text, false, null::uuid, p_command_id, p_project_id, null::uuid, null::uuid, v_project.version, null::timestamptz;
        return;
      end if;
    end if;

    v_before_state := private.domain_project_snapshot(p_project_id);

    update public.projects as projects
    set status = v_new_status
    where projects.id = p_project_id
    returning projects.*
      into v_project;

    v_outcome := 'APPLIED';
  end if;

  if v_before_state is null then
    v_before_state := private.domain_project_snapshot(p_project_id);
  end if;

  v_after_state := private.domain_project_snapshot(p_project_id);

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_domain_admin_audit_event(
    p_command_id,
    'TRANSITION_PROJECT_STATUS',
    v_outcome,
    v_actor_user_id,
    p_project_id,
    null,
    null,
    v_reason,
    v_request_data,
    v_before_state,
    v_after_state,
    v_project.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, p_project_id, null::uuid, null::uuid, v_project.version, v_occurred_at;
end;
$$;

comment on function public.transition_project_status(uuid, bigint, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to transition project status with activation readiness checks, expected-version concurrency, and append-only audit.';

create or replace function public.create_supported_asset(
  p_asset_code text,
  p_symbol text,
  p_display_name text,
  p_asset_type text,
  p_decimals smallint,
  p_mint_address text,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  project_id uuid,
  asset_id uuid,
  assignment_id uuid,
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
  v_asset_code text;
  v_symbol text;
  v_display_name text;
  v_asset_type text;
  v_mint_address text;
  v_request_data jsonb;
  v_existing_event private.domain_admin_audit_events%rowtype;
  v_asset_id uuid;
  v_asset_version bigint;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.domain_require_admin_aal2();
  v_reason := private.domain_normalize_reason(p_reason);
  v_asset_code := pg_catalog.btrim(p_asset_code);
  v_symbol := pg_catalog.btrim(p_symbol);
  v_display_name := pg_catalog.btrim(p_display_name);
  v_asset_type := pg_catalog.btrim(p_asset_type);
  v_mint_address := nullif(pg_catalog.btrim(p_mint_address), '');

  if p_command_id is null
    or v_reason is null
    or v_asset_code is null
    or v_asset_code !~ '^[A-Z0-9][A-Z0-9_]{1,31}$'
    or v_symbol is null
    or v_symbol !~ '^[A-Z0-9]{1,16}$'
    or v_display_name is null
    or pg_catalog.char_length(v_display_name) not between 1 and 100
    or v_display_name ~ '[[:cntrl:]]'
    or v_asset_type not in ('NATIVE', 'SPL_TOKEN')
    or p_decimals is null
    or p_decimals not between 0 and 18
    or (
      v_asset_type = 'NATIVE'
      and v_mint_address is not null
    )
    or (
      v_asset_type = 'SPL_TOKEN'
      and (
        v_mint_address is null
        or pg_catalog.char_length(v_mint_address) not between 32 and 44
        or v_mint_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
      )
    )
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'asset_code', v_asset_code,
    'symbol', v_symbol,
    'display_name', v_display_name,
    'asset_type', v_asset_type,
    'decimals', p_decimals,
    'mint_address', v_mint_address
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:domain-lifecycle-command:v1', 0));

  select events.* into v_existing_event
  from private.domain_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id and v_existing_event.action = 'CREATE_ASSET' and v_existing_event.reason = v_reason and v_existing_event.request_data = v_request_data then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.assignment_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (select 1 from public.supported_assets as assets where assets.asset_code = v_asset_code) then
    return query select 'ASSET_CODE_EXISTS'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_mint_address is not null
    and exists (
      select 1
      from public.supported_assets as assets
      where assets.network = 'SOLANA'
        and assets.mint_address = v_mint_address
    )
  then
    return query select 'ASSET_MINT_EXISTS'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_asset_type = 'NATIVE'
    and exists (
      select 1
      from public.supported_assets as assets
      where assets.network = 'SOLANA'
        and assets.asset_type = 'NATIVE'
        and assets.symbol = v_symbol
    )
  then
    return query select 'ASSET_NATIVE_SYMBOL_EXISTS'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

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
    v_asset_code,
    v_symbol,
    v_display_name,
    'SOLANA',
    v_asset_type,
    p_decimals,
    v_mint_address,
    'DRAFT'
  )
  returning id, version
    into v_asset_id, v_asset_version;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_domain_admin_audit_event(
    p_command_id,
    'CREATE_ASSET',
    'APPLIED',
    v_actor_user_id,
    null,
    v_asset_id,
    null,
    v_reason,
    v_request_data,
    null,
    private.domain_asset_snapshot(v_asset_id),
    v_asset_version
  ) as audit;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, null::uuid, v_asset_id, null::uuid, v_asset_version, v_occurred_at;
end;
$$;

comment on function public.create_supported_asset(text, text, text, text, smallint, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to create a DRAFT SOLANA supported asset without seeding real operational data.';

create or replace function public.update_supported_asset_details(
  p_asset_id uuid,
  p_expected_version bigint,
  p_symbol text,
  p_display_name text,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  project_id uuid,
  asset_id uuid,
  assignment_id uuid,
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
  v_symbol text;
  v_display_name text;
  v_request_data jsonb;
  v_existing_event private.domain_admin_audit_events%rowtype;
  v_asset public.supported_assets%rowtype;
  v_before_state jsonb;
  v_after_state jsonb;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.domain_require_admin_aal2();
  v_reason := private.domain_normalize_reason(p_reason);
  v_symbol := pg_catalog.btrim(p_symbol);
  v_display_name := pg_catalog.btrim(p_display_name);

  if p_asset_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_command_id is null
    or v_reason is null
    or v_symbol is null
    or v_symbol !~ '^[A-Z0-9]{1,16}$'
    or v_display_name is null
    or pg_catalog.char_length(v_display_name) not between 1 and 100
    or v_display_name ~ '[[:cntrl:]]'
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'asset_id', p_asset_id,
    'expected_version', p_expected_version,
    'symbol', v_symbol,
    'display_name', v_display_name
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:domain-lifecycle-command:v1', 0));

  select events.* into v_existing_event
  from private.domain_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id and v_existing_event.action = 'UPDATE_ASSET_DETAILS' and v_existing_event.reason = v_reason and v_existing_event.request_data = v_request_data then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.assignment_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  select assets.* into v_asset
  from public.supported_assets as assets
  where assets.id = p_asset_id
  for update;

  if not found then
    return query select 'ASSET_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_asset.version <> p_expected_version then
    return query select 'ASSET_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, v_asset.version, null::timestamptz;
    return;
  end if;

  if v_asset.status not in ('DRAFT', 'SUSPENDED') then
    return query select 'ASSET_TRANSITION_INVALID'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, v_asset.version, null::timestamptz;
    return;
  end if;

  if v_asset.asset_type = 'NATIVE'
    and v_symbol <> v_asset.symbol
    and exists (
      select 1
      from public.supported_assets as other_assets
      where other_assets.network = v_asset.network
        and other_assets.asset_type = 'NATIVE'
        and other_assets.symbol = v_symbol
        and other_assets.id <> p_asset_id
    )
  then
    return query select 'ASSET_NATIVE_SYMBOL_EXISTS'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, v_asset.version, null::timestamptz;
    return;
  end if;

  v_before_state := private.domain_asset_snapshot(p_asset_id);

  if v_asset.symbol = v_symbol
    and v_asset.display_name = v_display_name
  then
    v_outcome := 'NOOP';
  else
    update public.supported_assets as assets
    set symbol = v_symbol,
      display_name = v_display_name
    where assets.id = p_asset_id
    returning assets.*
      into v_asset;

    v_outcome := 'APPLIED';
  end if;

  v_after_state := private.domain_asset_snapshot(p_asset_id);

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_domain_admin_audit_event(
    p_command_id,
    'UPDATE_ASSET_DETAILS',
    v_outcome,
    v_actor_user_id,
    null,
    p_asset_id,
    null,
    v_reason,
    v_request_data,
    v_before_state,
    v_after_state,
    v_asset.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, null::uuid, p_asset_id, null::uuid, v_asset.version, v_occurred_at;
end;
$$;

comment on function public.update_supported_asset_details(uuid, bigint, text, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to update mutable supported asset display metadata while preserving core token identity.';

create or replace function public.transition_supported_asset_status(
  p_asset_id uuid,
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
  project_id uuid,
  asset_id uuid,
  assignment_id uuid,
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
  v_existing_event private.domain_admin_audit_events%rowtype;
  v_asset public.supported_assets%rowtype;
  v_before_state jsonb;
  v_after_state jsonb;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.domain_require_admin_aal2();
  v_reason := private.domain_normalize_reason(p_reason);
  v_new_status := pg_catalog.btrim(p_new_status);

  if p_asset_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_command_id is null
    or v_reason is null
    or v_new_status not in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'asset_id', p_asset_id,
    'expected_version', p_expected_version,
    'new_status', v_new_status
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:domain-lifecycle-command:v1', 0));

  select events.* into v_existing_event
  from private.domain_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id and v_existing_event.action = 'TRANSITION_ASSET_STATUS' and v_existing_event.reason = v_reason and v_existing_event.request_data = v_request_data then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.assignment_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  select assets.* into v_asset
  from public.supported_assets as assets
  where assets.id = p_asset_id
  for update;

  if not found then
    return query select 'ASSET_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_asset.version <> p_expected_version then
    return query select 'ASSET_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, v_asset.version, null::timestamptz;
    return;
  end if;

  if v_asset.status = v_new_status then
    v_outcome := 'NOOP';
  elsif not (
    (v_asset.status = 'DRAFT' and v_new_status in ('ACTIVE', 'ARCHIVED'))
    or (v_asset.status = 'ACTIVE' and v_new_status = 'SUSPENDED')
    or (v_asset.status = 'SUSPENDED' and v_new_status in ('ACTIVE', 'ARCHIVED'))
  ) then
    return query select 'ASSET_TRANSITION_INVALID'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, v_asset.version, null::timestamptz;
    return;
  else
    if v_new_status in ('SUSPENDED', 'ARCHIVED')
      and exists (
        select 1
        from public.project_token_assignments as assignments
        join public.projects as projects
          on projects.id = assignments.project_id
        where assignments.asset_id = p_asset_id
          and assignments.retired_at is null
          and projects.status = 'ACTIVE'
      )
    then
      return query select 'ASSET_IN_USE_BY_ACTIVE_PROJECT'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, v_asset.version, null::timestamptz;
      return;
    end if;

    if v_new_status = 'ARCHIVED'
      and exists (
        select 1
        from public.project_token_assignments as assignments
        where assignments.asset_id = p_asset_id
          and assignments.retired_at is null
      )
    then
      return query select 'ASSET_HAS_CURRENT_ASSIGNMENT'::text, false, null::uuid, p_command_id, null::uuid, p_asset_id, null::uuid, v_asset.version, null::timestamptz;
      return;
    end if;

    v_before_state := private.domain_asset_snapshot(p_asset_id);

    update public.supported_assets as assets
    set status = v_new_status
    where assets.id = p_asset_id
    returning assets.*
      into v_asset;

    v_outcome := 'APPLIED';
  end if;

  if v_before_state is null then
    v_before_state := private.domain_asset_snapshot(p_asset_id);
  end if;

  v_after_state := private.domain_asset_snapshot(p_asset_id);

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_domain_admin_audit_event(
    p_command_id,
    'TRANSITION_ASSET_STATUS',
    v_outcome,
    v_actor_user_id,
    null,
    p_asset_id,
    null,
    v_reason,
    v_request_data,
    v_before_state,
    v_after_state,
    v_asset.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, null::uuid, p_asset_id, null::uuid, v_asset.version, v_occurred_at;
end;
$$;

comment on function public.transition_supported_asset_status(uuid, bigint, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to transition supported asset status while protecting active project-token use.';

create or replace function public.assign_project_token(
  p_project_id uuid,
  p_asset_id uuid,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  project_id uuid,
  asset_id uuid,
  assignment_id uuid,
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
  v_request_data jsonb;
  v_existing_event private.domain_admin_audit_events%rowtype;
  v_project public.projects%rowtype;
  v_asset public.supported_assets%rowtype;
  v_current_for_project public.project_token_assignments%rowtype;
  v_current_for_asset public.project_token_assignments%rowtype;
  v_assignment_id uuid;
  v_assignment_version bigint;
  v_before_state jsonb;
  v_after_state jsonb;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.domain_require_admin_aal2();
  v_reason := private.domain_normalize_reason(p_reason);

  if p_project_id is null
    or p_asset_id is null
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_project_id, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'project_id', p_project_id,
    'asset_id', p_asset_id
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:domain-lifecycle-command:v1', 0));

  select events.* into v_existing_event
  from private.domain_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id and v_existing_event.action = 'ASSIGN_PROJECT_TOKEN' and v_existing_event.reason = v_reason and v_existing_event.request_data = v_request_data then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.assignment_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_project_id, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  select projects.* into v_project
  from public.projects as projects
  where projects.id = p_project_id
  for update;

  if not found then
    return query select 'PROJECT_NOT_FOUND'::text, false, null::uuid, p_command_id, p_project_id, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_project.status not in ('DRAFT', 'SUSPENDED') then
    return query select 'PROJECT_TOKEN_ASSIGNMENT_NOT_ALLOWED'::text, false, null::uuid, p_command_id, p_project_id, p_asset_id, null::uuid, v_project.version, null::timestamptz;
    return;
  end if;

  select assets.* into v_asset
  from public.supported_assets as assets
  where assets.id = p_asset_id
  for update;

  if not found then
    return query select 'ASSET_NOT_FOUND'::text, false, null::uuid, p_command_id, p_project_id, p_asset_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_asset.network <> 'SOLANA'
    or v_asset.asset_type <> 'SPL_TOKEN'
    or v_asset.status <> 'ACTIVE'
    or v_asset.mint_address is null
  then
    return query select 'ASSET_NOT_READY'::text, false, null::uuid, p_command_id, p_project_id, p_asset_id, null::uuid, v_asset.version, null::timestamptz;
    return;
  end if;

  select assignments.* into v_current_for_project
  from public.project_token_assignments as assignments
  where assignments.project_id = p_project_id
    and assignments.retired_at is null
  for update;

  if found then
    if v_current_for_project.asset_id = p_asset_id then
      v_assignment_id := v_current_for_project.id;
      v_assignment_version := v_current_for_project.version;
      v_outcome := 'NOOP';
      v_before_state := private.domain_assignment_snapshot(v_assignment_id);
      v_after_state := v_before_state;
    else
      return query select 'PROJECT_ALREADY_HAS_CURRENT_TOKEN'::text, false, null::uuid, p_command_id, p_project_id, p_asset_id, v_current_for_project.id, v_current_for_project.version, null::timestamptz;
      return;
    end if;
  else
    select assignments.* into v_current_for_asset
    from public.project_token_assignments as assignments
    where assignments.asset_id = p_asset_id
      and assignments.retired_at is null
    for update;

    if found then
      return query select 'ASSET_ALREADY_ASSIGNED'::text, false, null::uuid, p_command_id, p_project_id, p_asset_id, v_current_for_asset.id, v_current_for_asset.version, null::timestamptz;
      return;
    end if;

    insert into public.project_token_assignments (
      project_id,
      asset_id
    )
    values (
      p_project_id,
      p_asset_id
    )
    returning id, version
      into v_assignment_id, v_assignment_version;

    v_before_state := null;
    v_after_state := private.domain_assignment_snapshot(v_assignment_id);
    v_outcome := 'APPLIED';
  end if;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_domain_admin_audit_event(
    p_command_id,
    'ASSIGN_PROJECT_TOKEN',
    v_outcome,
    v_actor_user_id,
    p_project_id,
    p_asset_id,
    v_assignment_id,
    v_reason,
    v_request_data,
    v_before_state,
    v_after_state,
    v_assignment_version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, p_project_id, p_asset_id, v_assignment_id, v_assignment_version, v_occurred_at;
end;
$$;

comment on function public.assign_project_token(uuid, uuid, uuid, text) is
  'ACTIVE ADMIN AAL2 command to assign an ACTIVE SOLANA SPL token to a DRAFT or SUSPENDED project while preserving assignment history.';

create or replace function public.retire_project_token(
  p_assignment_id uuid,
  p_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  project_id uuid,
  asset_id uuid,
  assignment_id uuid,
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
  v_request_data jsonb;
  v_existing_event private.domain_admin_audit_events%rowtype;
  v_assignment public.project_token_assignments%rowtype;
  v_project public.projects%rowtype;
  v_before_state jsonb;
  v_after_state jsonb;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.domain_require_admin_aal2();
  v_reason := private.domain_normalize_reason(p_reason);

  if p_assignment_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_assignment_id, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'assignment_id', p_assignment_id,
    'expected_version', p_expected_version
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:domain-lifecycle-command:v1', 0));

  select events.* into v_existing_event
  from private.domain_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id and v_existing_event.action = 'RETIRE_PROJECT_TOKEN' and v_existing_event.reason = v_reason and v_existing_event.request_data = v_request_data then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.assignment_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_assignment_id, null::bigint, null::timestamptz;
    return;
  end if;

  select assignments.* into v_assignment
  from public.project_token_assignments as assignments
  where assignments.id = p_assignment_id
  for update;

  if not found then
    return query select 'ASSIGNMENT_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_assignment_id, null::bigint, null::timestamptz;
    return;
  end if;

  if v_assignment.version <> p_expected_version then
    return query select 'ASSIGNMENT_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_assignment.project_id, v_assignment.asset_id, p_assignment_id, v_assignment.version, null::timestamptz;
    return;
  end if;

  select projects.* into v_project
  from public.projects as projects
  where projects.id = v_assignment.project_id
  for update;

  if v_project.status = 'ACTIVE' then
    return query select 'ACTIVE_PROJECT_TOKEN_RETIRE_FORBIDDEN'::text, false, null::uuid, p_command_id, v_assignment.project_id, v_assignment.asset_id, p_assignment_id, v_assignment.version, null::timestamptz;
    return;
  end if;

  v_before_state := private.domain_assignment_snapshot(p_assignment_id);

  if v_assignment.retired_at is not null then
    v_outcome := 'NOOP';
  else
    update public.project_token_assignments as assignments
    set retired_at = clock_timestamp()
    where assignments.id = p_assignment_id
    returning assignments.*
      into v_assignment;

    v_outcome := 'APPLIED';
  end if;

  v_after_state := private.domain_assignment_snapshot(p_assignment_id);

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_domain_admin_audit_event(
    p_command_id,
    'RETIRE_PROJECT_TOKEN',
    v_outcome,
    v_actor_user_id,
    v_assignment.project_id,
    v_assignment.asset_id,
    p_assignment_id,
    v_reason,
    v_request_data,
    v_before_state,
    v_after_state,
    v_assignment.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, v_assignment.project_id, v_assignment.asset_id, p_assignment_id, v_assignment.version, v_occurred_at;
end;
$$;

comment on function public.retire_project_token(uuid, bigint, uuid, text) is
  'ACTIVE ADMIN AAL2 command to retire a project token assignment after the project is no longer ACTIVE.';

create or replace function public.list_admin_projects(
  p_limit integer default 100
)
returns table (
  project_id uuid,
  project_code text,
  display_name text,
  description text,
  status text,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform private.domain_require_admin_aal2();

  v_limit := coalesce(p_limit, 100);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select
      projects.id,
      projects.project_code,
      projects.display_name,
      projects.description,
      projects.status,
      projects.version,
      projects.created_at,
      projects.updated_at
    from public.projects as projects
    order by projects.created_at desc, projects.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_projects(integer) is
  'ACTIVE ADMIN AAL2 read RPC for project catalog rows, including draft and archived lifecycle states.';

create or replace function public.list_admin_supported_assets(
  p_limit integer default 100
)
returns table (
  asset_id uuid,
  asset_code text,
  symbol text,
  display_name text,
  network text,
  asset_type text,
  decimals smallint,
  mint_address text,
  status text,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform private.domain_require_admin_aal2();

  v_limit := coalesce(p_limit, 100);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select
      assets.id,
      assets.asset_code,
      assets.symbol,
      assets.display_name,
      assets.network,
      assets.asset_type,
      assets.decimals,
      assets.mint_address,
      assets.status,
      assets.version,
      assets.created_at,
      assets.updated_at
    from public.supported_assets as assets
    order by assets.created_at desc, assets.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_supported_assets(integer) is
  'ACTIVE ADMIN AAL2 read RPC for supported asset catalog rows without direct table access.';

create or replace function public.list_admin_project_token_assignments(
  p_limit integer default 100,
  p_include_retired boolean default true
)
returns table (
  assignment_id uuid,
  project_id uuid,
  project_code text,
  project_display_name text,
  asset_id uuid,
  asset_code text,
  asset_symbol text,
  assigned_at timestamptz,
  retired_at timestamptz,
  version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform private.domain_require_admin_aal2();

  v_limit := coalesce(p_limit, 100);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select
      assignments.id,
      assignments.project_id,
      projects.project_code,
      projects.display_name,
      assignments.asset_id,
      assets.asset_code,
      assets.symbol,
      assignments.assigned_at,
      assignments.retired_at,
      assignments.version
    from public.project_token_assignments as assignments
    join public.projects as projects
      on projects.id = assignments.project_id
    join public.supported_assets as assets
      on assets.id = assignments.asset_id
    where coalesce(p_include_retired, true)
      or assignments.retired_at is null
    order by assignments.assigned_at desc, assignments.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_project_token_assignments(integer, boolean) is
  'ACTIVE ADMIN AAL2 read RPC for current and historical project token assignments.';

create or replace function public.list_domain_admin_audit_events(
  p_limit integer default 50,
  p_before_event_id uuid default null
)
returns table (
  event_id uuid,
  command_id uuid,
  action text,
  outcome text,
  actor_user_id uuid,
  project_id uuid,
  asset_id uuid,
  assignment_id uuid,
  reason text,
  before_state jsonb,
  after_state jsonb,
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
  perform private.domain_require_admin_aal2();

  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_event_id is not null then
    select events.occurred_at, events.id
      into v_before_occurred_at, v_before_id
    from private.domain_admin_audit_events as events
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
      events.project_id,
      events.asset_id,
      events.assignment_id,
      events.reason,
      events.before_state,
      events.after_state,
      events.entity_version,
      events.occurred_at
    from private.domain_admin_audit_events as events
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

comment on function public.list_domain_admin_audit_events(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for append-only domain lifecycle audit events with cursor pagination and safe snapshots.';

revoke execute on function public.create_project(text, text, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.update_project_details(uuid, bigint, text, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.transition_project_status(uuid, bigint, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.create_supported_asset(text, text, text, text, smallint, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.update_supported_asset_details(uuid, bigint, text, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.transition_supported_asset_status(uuid, bigint, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.assign_project_token(uuid, uuid, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.retire_project_token(uuid, bigint, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.list_admin_projects(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_supported_assets(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_project_token_assignments(integer, boolean)
  from public, anon, authenticated;

revoke execute on function public.list_domain_admin_audit_events(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.create_project(text, text, text, uuid, text)
  to authenticated;

grant execute on function public.update_project_details(uuid, bigint, text, text, uuid, text)
  to authenticated;

grant execute on function public.transition_project_status(uuid, bigint, text, uuid, text)
  to authenticated;

grant execute on function public.create_supported_asset(text, text, text, text, smallint, text, uuid, text)
  to authenticated;

grant execute on function public.update_supported_asset_details(uuid, bigint, text, text, uuid, text)
  to authenticated;

grant execute on function public.transition_supported_asset_status(uuid, bigint, text, uuid, text)
  to authenticated;

grant execute on function public.assign_project_token(uuid, uuid, uuid, text)
  to authenticated;

grant execute on function public.retire_project_token(uuid, bigint, uuid, text)
  to authenticated;

grant execute on function public.list_admin_projects(integer)
  to authenticated;

grant execute on function public.list_admin_supported_assets(integer)
  to authenticated;

grant execute on function public.list_admin_project_token_assignments(integer, boolean)
  to authenticated;

grant execute on function public.list_domain_admin_audit_events(integer, uuid)
  to authenticated;
