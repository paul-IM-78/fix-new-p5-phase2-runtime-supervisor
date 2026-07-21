create table private.staking_products (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  product_code text not null unique,
  display_name text not null,
  description text null,

  lock_duration_days integer not null,
  min_stake_units private.positive_atomic_units not null,
  max_stake_units numeric null,
  term_reward_rate_ppm integer not null,
  reward_rounding_mode text not null default 'FLOOR',

  enrollment_starts_at timestamptz not null,
  enrollment_ends_at timestamptz not null,

  status text not null default 'DRAFT',
  activated_at timestamptz null,
  suspended_at timestamptz null,
  archived_at timestamptz null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint staking_products_product_code_check
    check (
      product_code = pg_catalog.btrim(product_code)
      and product_code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'
      and product_code !~ '[[:cntrl:]]'
    ),

  constraint staking_products_display_name_check
    check (
      display_name = pg_catalog.btrim(display_name)
      and pg_catalog.char_length(display_name) between 1 and 100
      and display_name !~ '[[:cntrl:]]'
    ),

  constraint staking_products_description_check
    check (
      description is null
      or (
        description = pg_catalog.btrim(description)
        and pg_catalog.char_length(description) between 1 and 1000
        and description !~ '[[:cntrl:]]'
      )
    ),

  constraint staking_products_lock_duration_days_check
    check (lock_duration_days between 1 and 3650),

  constraint staking_products_units_check
    check (
      max_stake_units is null
      or (
        max_stake_units > 0
        and max_stake_units::text ~ '^[1-9][0-9]{0,37}$'
        and max_stake_units = trunc(max_stake_units)
        and max_stake_units < power(10::numeric, 38)
        and max_stake_units >= min_stake_units
      )
    ),

  constraint staking_products_reward_rate_check
    check (term_reward_rate_ppm between 1 and 1000000),

  constraint staking_products_reward_rounding_mode_check
    check (reward_rounding_mode = 'FLOOR'),

  constraint staking_products_enrollment_window_check
    check (enrollment_ends_at > enrollment_starts_at),

  constraint staking_products_status_check
    check (status in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),

  constraint staking_products_status_shape_check
    check (
      (
        status = 'DRAFT'
        and activated_at is null
        and suspended_at is null
        and archived_at is null
      )
      or (
        status = 'ACTIVE'
        and activated_at is not null
        and suspended_at is null
        and archived_at is null
      )
      or (
        status = 'SUSPENDED'
        and activated_at is not null
        and suspended_at is not null
        and archived_at is null
      )
      or (
        status = 'ARCHIVED'
        and archived_at is not null
      )
    ),

  constraint staking_products_version_check
    check (version >= 1)
);

comment on table private.staking_products is
  'Private staking product terms and lifecycle state. Products define metadata and future staking boundaries only; commands do not post ledger entries, create positions, or calculate rewards.';

create unique index staking_products_active_term_uidx
  on private.staking_products (project_id, asset_id, lock_duration_days)
  where status <> 'ARCHIVED';

create index staking_products_status_enrollment_idx
  on private.staking_products (status, enrollment_ends_at, enrollment_starts_at);

create index staking_products_project_idx
  on private.staking_products (project_id, created_at desc);

create index staking_products_asset_idx
  on private.staking_products (asset_id, created_at desc);

create table private.staking_product_admin_audit_events (
  id uuid primary key default gen_random_uuid(),

  command_id uuid not null unique,

  action text not null,
  outcome text not null,

  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,

  staking_product_id uuid not null
    references private.staking_products (id) on delete restrict,

  project_id uuid not null
    references public.projects (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  reason text not null,
  request_data jsonb not null,

  previous_status text null,
  resulting_status text not null,

  entity_version bigint not null,

  occurred_at timestamptz not null default clock_timestamp(),

  constraint staking_product_admin_audit_events_action_check
    check (
      action in (
        'CREATE_STAKING_PRODUCT',
        'UPDATE_STAKING_PRODUCT_DRAFT',
        'TRANSITION_STAKING_PRODUCT_STATUS'
      )
    ),

  constraint staking_product_admin_audit_events_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),

  constraint staking_product_admin_audit_events_reason_check
    check (
      reason = pg_catalog.btrim(reason)
      and pg_catalog.char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
      and reason !~* '(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)'
    ),

  constraint staking_product_admin_audit_events_request_data_check
    check (
      jsonb_typeof(request_data) = 'object'
      and request_data::text !~* '(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)'
    ),

  constraint staking_product_admin_audit_events_status_check
    check (
      (previous_status is null or previous_status in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'))
      and resulting_status in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')
    ),

  constraint staking_product_admin_audit_events_entity_version_check
    check (entity_version >= 1)
);

comment on table private.staking_product_admin_audit_events is
  'Append-only audit events for ACTIVE ADMIN AAL2 staking product commands. Full request_data remains private and read RPCs expose only safe summary fields.';

create index staking_product_admin_audit_events_occurred_at_idx
  on private.staking_product_admin_audit_events (occurred_at desc, id desc);

create index staking_product_admin_audit_events_actor_idx
  on private.staking_product_admin_audit_events (actor_user_id, occurred_at desc);

create index staking_product_admin_audit_events_product_idx
  on private.staking_product_admin_audit_events (staking_product_id, occurred_at desc);

create index staking_product_admin_audit_events_project_idx
  on private.staking_product_admin_audit_events (project_id, occurred_at desc);

create index staking_product_admin_audit_events_asset_idx
  on private.staking_product_admin_audit_events (asset_id, occurred_at desc);

revoke all privileges on table private.staking_products
  from public, anon, authenticated;

revoke all privileges on table private.staking_product_admin_audit_events
  from public, anon, authenticated;

create trigger touch_staking_products_version
  before update on private.staking_products
  for each row
  execute function private.touch_versioned_record();

create or replace function private.validate_staking_product_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.product_code is distinct from new.product_code then
      raise exception 'STAKING_PRODUCT_CODE_IMMUTABLE'
        using errcode = '23514';
    end if;

    if old.status = 'ARCHIVED'
      and row(old.*) is distinct from row(new.*)
    then
      raise exception 'STAKING_PRODUCT_ARCHIVED_TERMINAL'
        using errcode = '23514';
    end if;

    if old.activated_at is not null
      and (
        old.project_id is distinct from new.project_id
        or old.asset_id is distinct from new.asset_id
        or old.display_name is distinct from new.display_name
        or old.description is distinct from new.description
        or old.lock_duration_days is distinct from new.lock_duration_days
        or old.min_stake_units is distinct from new.min_stake_units
        or old.max_stake_units is distinct from new.max_stake_units
        or old.term_reward_rate_ppm is distinct from new.term_reward_rate_ppm
        or old.reward_rounding_mode is distinct from new.reward_rounding_mode
        or old.enrollment_starts_at is distinct from new.enrollment_starts_at
        or old.enrollment_ends_at is distinct from new.enrollment_ends_at
        or old.activated_at is distinct from new.activated_at
      )
    then
      raise exception 'STAKING_PRODUCT_TERMS_LOCKED'
        using errcode = '23514';
    end if;

    if old.status is distinct from new.status then
      if not (
        (old.status = 'DRAFT' and new.status in ('ACTIVE', 'ARCHIVED'))
        or (old.status = 'ACTIVE' and new.status = 'SUSPENDED')
        or (old.status = 'SUSPENDED' and new.status in ('ACTIVE', 'ARCHIVED'))
      ) then
        raise exception 'STAKING_PRODUCT_TRANSITION_INVALID'
          using errcode = '23514';
      end if;

      if old.status = 'DRAFT'
        and new.status = 'ACTIVE'
        and new.activated_at is null
      then
        raise exception 'STAKING_PRODUCT_ACTIVATION_TIMESTAMP_REQUIRED'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function private.validate_staking_product_transition() is
  'Enforces staking product status transitions, product code immutability, archived terminal state, and term freeze after first activation.';

revoke execute on function private.validate_staking_product_transition()
  from public, anon, authenticated;

create trigger validate_staking_product_transition
  before update on private.staking_products
  for each row
  execute function private.validate_staking_product_transition();

create or replace function private.prevent_staking_product_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'STAKING_PRODUCT_AUDIT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_staking_product_admin_audit_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE on append-only staking product audit events.';

revoke execute on function private.prevent_staking_product_admin_audit_mutation()
  from public, anon, authenticated;

create trigger protect_staking_product_admin_audit_events
  before update or delete or truncate
  on private.staking_product_admin_audit_events
  for each statement
  execute function private.prevent_staking_product_admin_audit_mutation();

create or replace function private.staking_product_require_admin_aal2()
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
    raise exception 'STAKING_PRODUCT_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

create or replace function private.staking_product_require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null
    or not exists (
      select 1
      from public.profiles as profiles
      where profiles.id = v_user_id
        and profiles.account_status = 'ACTIVE'
    )
  then
    raise exception 'STAKING_PRODUCT_ACTIVE_USER_REQUIRED'
      using errcode = '42501';
  end if;

  return v_user_id;
end;
$$;

create or replace function private.staking_product_normalize_reason(
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
    or v_reason ~* '(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)'
  then
    return null;
  end if;

  return v_reason;
end;
$$;

create or replace function private.staking_product_validate_units_text(
  p_units text
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_units is null or p_units !~ '^[1-9][0-9]{0,37}$' then
    return null;
  end if;

  return (p_units::numeric::private.positive_atomic_units)::text;
exception
  when others then
    return null;
end;
$$;

create or replace function private.staking_product_lock()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:staking-product-command:v1',
      0
    )
  );
end;
$$;

create or replace function private.staking_product_activation_boundary_code(
  p_project_id uuid,
  p_asset_id uuid,
  p_enrollment_ends_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_asset public.supported_assets%rowtype;
  v_assignment_count integer;
begin
  select projects.*
    into v_project
  from public.projects as projects
  where projects.id = p_project_id;

  if not found or v_project.status <> 'ACTIVE' then
    return 'STAKING_PROJECT_NOT_ACTIVE';
  end if;

  select assets.*
    into v_asset
  from public.supported_assets as assets
  where assets.id = p_asset_id;

  if not found or v_asset.status <> 'ACTIVE' then
    return 'STAKING_ASSET_NOT_ACTIVE';
  end if;

  if v_asset.network <> 'SOLANA' or v_asset.asset_type <> 'SPL_TOKEN' then
    return 'STAKING_ASSET_NOT_PROJECT_TOKEN';
  end if;

  select count(*)::integer
    into v_assignment_count
  from public.project_token_assignments as assignments
  where assignments.project_id = p_project_id
    and assignments.asset_id = p_asset_id
    and assignments.retired_at is null;

  if v_assignment_count <> 1 then
    return 'STAKING_ASSET_NOT_PROJECT_TOKEN';
  end if;

  if p_enrollment_ends_at <= now() then
    return 'STAKING_ENROLLMENT_EXPIRED';
  end if;

  return null;
end;
$$;

create or replace function private.record_staking_product_admin_audit_event(
  p_command_id uuid,
  p_action text,
  p_outcome text,
  p_actor_user_id uuid,
  p_staking_product_id uuid,
  p_project_id uuid,
  p_asset_id uuid,
  p_reason text,
  p_request_data jsonb,
  p_previous_status text,
  p_resulting_status text,
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
  insert into private.staking_product_admin_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    staking_product_id,
    project_id,
    asset_id,
    reason,
    request_data,
    previous_status,
    resulting_status,
    entity_version
  )
  values (
    p_command_id,
    p_action,
    p_outcome,
    p_actor_user_id,
    p_staking_product_id,
    p_project_id,
    p_asset_id,
    p_reason,
    p_request_data,
    p_previous_status,
    p_resulting_status,
    p_entity_version
  )
  returning id, occurred_at
    into out_event_id, out_occurred_at;

  return next;
end;
$$;

revoke execute on function private.staking_product_require_admin_aal2()
  from public, anon, authenticated;

revoke execute on function private.staking_product_require_active_user()
  from public, anon, authenticated;

revoke execute on function private.staking_product_normalize_reason(text)
  from public, anon, authenticated;

revoke execute on function private.staking_product_validate_units_text(text)
  from public, anon, authenticated;

revoke execute on function private.staking_product_lock()
  from public, anon, authenticated;

revoke execute on function private.staking_product_activation_boundary_code(uuid, uuid, timestamptz)
  from public, anon, authenticated;

revoke execute on function private.record_staking_product_admin_audit_event(
  uuid,
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  bigint
) from public, anon, authenticated;

create or replace function public.create_staking_product(
  p_project_id uuid,
  p_asset_id uuid,
  p_product_code text,
  p_display_name text,
  p_description text,
  p_lock_duration_days integer,
  p_min_stake_units text,
  p_max_stake_units text,
  p_term_reward_rate_ppm integer,
  p_enrollment_starts_at timestamptz,
  p_enrollment_ends_at timestamptz,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  staking_product_id uuid,
  project_id uuid,
  asset_id uuid,
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
  v_product_code text;
  v_display_name text;
  v_description text;
  v_min_units_text text;
  v_max_units_text text;
  v_request_data jsonb;
  v_existing_event private.staking_product_admin_audit_events%rowtype;
  v_product_id uuid;
  v_product_version bigint;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.staking_product_require_admin_aal2();
  v_reason := private.staking_product_normalize_reason(p_reason);
  v_product_code := pg_catalog.btrim(p_product_code);
  v_display_name := pg_catalog.btrim(p_display_name);
  v_description := nullif(pg_catalog.btrim(p_description), '');
  v_min_units_text := private.staking_product_validate_units_text(p_min_stake_units);
  v_max_units_text := case
    when p_max_stake_units is null or pg_catalog.btrim(p_max_stake_units) = '' then null
    else private.staking_product_validate_units_text(p_max_stake_units)
  end;

  if p_command_id is null
    or p_project_id is null
    or p_asset_id is null
    or v_reason is null
    or v_product_code is null
    or v_product_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'
    or v_display_name is null
    or pg_catalog.char_length(v_display_name) not between 1 and 100
    or v_display_name ~ '[[:cntrl:]]'
    or (
      v_description is not null
      and (
        pg_catalog.char_length(v_description) not between 1 and 1000
        or v_description ~ '[[:cntrl:]]'
      )
    )
    or p_lock_duration_days is null
    or p_lock_duration_days not between 1 and 3650
    or v_min_units_text is null
    or (
      p_max_stake_units is not null
      and pg_catalog.btrim(p_max_stake_units) <> ''
      and v_max_units_text is null
    )
    or (
      v_max_units_text is not null
      and v_max_units_text::numeric < v_min_units_text::numeric
    )
    or p_term_reward_rate_ppm is null
    or p_term_reward_rate_ppm not between 1 and 1000000
    or p_enrollment_starts_at is null
    or p_enrollment_ends_at is null
    or p_enrollment_ends_at <= p_enrollment_starts_at
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, null::uuid, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'project_id', p_project_id::text,
    'asset_id', p_asset_id::text,
    'product_code', v_product_code,
    'display_name', v_display_name,
    'description', v_description,
    'lock_duration_days', p_lock_duration_days,
    'min_stake_units', v_min_units_text,
    'max_stake_units', v_max_units_text,
    'term_reward_rate_ppm', p_term_reward_rate_ppm,
    'reward_rounding_mode', 'FLOOR',
    'enrollment_starts_at', p_enrollment_starts_at,
    'enrollment_ends_at', p_enrollment_ends_at
  );

  perform private.staking_product_lock();

  select events.*
    into v_existing_event
  from private.staking_product_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'CREATE_STAKING_PRODUCT'
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.staking_product_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'STAKING_PRODUCT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.projects as projects where projects.id = p_project_id) then
    return query select 'STAKING_PROJECT_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.supported_assets as assets where assets.id = p_asset_id) then
    return query select 'STAKING_ASSET_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.staking_products as products
    where products.product_code = v_product_code
  ) then
    return query select 'STAKING_PRODUCT_CODE_EXISTS'::text, false, null::uuid, p_command_id, null::uuid, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.staking_products as products
    where products.project_id = p_project_id
      and products.asset_id = p_asset_id
      and products.lock_duration_days = p_lock_duration_days
      and products.status <> 'ARCHIVED'
  ) then
    return query select 'STAKING_PRODUCT_DUPLICATE_TERM'::text, false, null::uuid, p_command_id, null::uuid, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  insert into private.staking_products (
    project_id,
    asset_id,
    product_code,
    display_name,
    description,
    lock_duration_days,
    min_stake_units,
    max_stake_units,
    term_reward_rate_ppm,
    reward_rounding_mode,
    enrollment_starts_at,
    enrollment_ends_at,
    status
  )
  values (
    p_project_id,
    p_asset_id,
    v_product_code,
    v_display_name,
    v_description,
    p_lock_duration_days,
    v_min_units_text::numeric::private.positive_atomic_units,
    case
      when v_max_units_text is null then null
      else v_max_units_text::numeric
    end,
    p_term_reward_rate_ppm,
    'FLOOR',
    p_enrollment_starts_at,
    p_enrollment_ends_at,
    'DRAFT'
  )
  returning id, version
    into v_product_id, v_product_version;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_staking_product_admin_audit_event(
    p_command_id,
    'CREATE_STAKING_PRODUCT',
    'APPLIED',
    v_actor_user_id,
    v_product_id,
    p_project_id,
    p_asset_id,
    v_reason,
    v_request_data,
    null,
    'DRAFT',
    v_product_version
  ) as audit;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_product_id, p_project_id, p_asset_id, v_product_version, v_occurred_at;
end;
$$;

comment on function public.create_staking_product(uuid, uuid, text, text, text, integer, text, text, integer, timestamptz, timestamptz, uuid, text) is
  'ACTIVE ADMIN AAL2 command to create a DRAFT staking product. It creates no ledger accounts, positions, balances, rewards, or blockchain activity.';

create or replace function public.update_staking_product_draft(
  p_staking_product_id uuid,
  p_expected_version bigint,
  p_project_id uuid,
  p_asset_id uuid,
  p_display_name text,
  p_description text,
  p_lock_duration_days integer,
  p_min_stake_units text,
  p_max_stake_units text,
  p_term_reward_rate_ppm integer,
  p_enrollment_starts_at timestamptz,
  p_enrollment_ends_at timestamptz,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  staking_product_id uuid,
  project_id uuid,
  asset_id uuid,
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
  v_min_units_text text;
  v_max_units_text text;
  v_request_data jsonb;
  v_existing_event private.staking_product_admin_audit_events%rowtype;
  v_product private.staking_products%rowtype;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.staking_product_require_admin_aal2();
  v_reason := private.staking_product_normalize_reason(p_reason);
  v_display_name := pg_catalog.btrim(p_display_name);
  v_description := nullif(pg_catalog.btrim(p_description), '');
  v_min_units_text := private.staking_product_validate_units_text(p_min_stake_units);
  v_max_units_text := case
    when p_max_stake_units is null or pg_catalog.btrim(p_max_stake_units) = '' then null
    else private.staking_product_validate_units_text(p_max_stake_units)
  end;

  if p_command_id is null
    or p_staking_product_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_project_id is null
    or p_asset_id is null
    or v_reason is null
    or v_display_name is null
    or pg_catalog.char_length(v_display_name) not between 1 and 100
    or v_display_name ~ '[[:cntrl:]]'
    or (
      v_description is not null
      and (
        pg_catalog.char_length(v_description) not between 1 and 1000
        or v_description ~ '[[:cntrl:]]'
      )
    )
    or p_lock_duration_days is null
    or p_lock_duration_days not between 1 and 3650
    or v_min_units_text is null
    or (
      p_max_stake_units is not null
      and pg_catalog.btrim(p_max_stake_units) <> ''
      and v_max_units_text is null
    )
    or (
      v_max_units_text is not null
      and v_max_units_text::numeric < v_min_units_text::numeric
    )
    or p_term_reward_rate_ppm is null
    or p_term_reward_rate_ppm not between 1 and 1000000
    or p_enrollment_starts_at is null
    or p_enrollment_ends_at is null
    or p_enrollment_ends_at <= p_enrollment_starts_at
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_staking_product_id, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'staking_product_id', p_staking_product_id::text,
    'expected_version', p_expected_version,
    'project_id', p_project_id::text,
    'asset_id', p_asset_id::text,
    'display_name', v_display_name,
    'description', v_description,
    'lock_duration_days', p_lock_duration_days,
    'min_stake_units', v_min_units_text,
    'max_stake_units', v_max_units_text,
    'term_reward_rate_ppm', p_term_reward_rate_ppm,
    'reward_rounding_mode', 'FLOOR',
    'enrollment_starts_at', p_enrollment_starts_at,
    'enrollment_ends_at', p_enrollment_ends_at
  );

  perform private.staking_product_lock();

  select events.*
    into v_existing_event
  from private.staking_product_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'UPDATE_STAKING_PRODUCT_DRAFT'
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.staking_product_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'STAKING_PRODUCT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_staking_product_id, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  select products.*
    into v_product
  from private.staking_products as products
  where products.id = p_staking_product_id
  for update;

  if not found then
    return query select 'STAKING_PRODUCT_NOT_FOUND'::text, false, null::uuid, p_command_id, p_staking_product_id, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if v_product.version <> p_expected_version then
    return query select 'STAKING_PRODUCT_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, p_staking_product_id, v_product.project_id, v_product.asset_id, v_product.version, null::timestamptz;
    return;
  end if;

  if v_product.status <> 'DRAFT' or v_product.activated_at is not null then
    return query select 'STAKING_PRODUCT_NOT_DRAFT'::text, false, null::uuid, p_command_id, p_staking_product_id, v_product.project_id, v_product.asset_id, v_product.version, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.projects as projects where projects.id = p_project_id) then
    return query select 'STAKING_PROJECT_NOT_FOUND'::text, false, null::uuid, p_command_id, p_staking_product_id, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if not exists (select 1 from public.supported_assets as assets where assets.id = p_asset_id) then
    return query select 'STAKING_ASSET_NOT_FOUND'::text, false, null::uuid, p_command_id, p_staking_product_id, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.staking_products as products
    where products.id <> p_staking_product_id
      and products.project_id = p_project_id
      and products.asset_id = p_asset_id
      and products.lock_duration_days = p_lock_duration_days
      and products.status <> 'ARCHIVED'
  ) then
    return query select 'STAKING_PRODUCT_DUPLICATE_TERM'::text, false, null::uuid, p_command_id, p_staking_product_id, p_project_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if v_product.project_id = p_project_id
    and v_product.asset_id = p_asset_id
    and v_product.display_name = v_display_name
    and v_product.description is not distinct from v_description
    and v_product.lock_duration_days = p_lock_duration_days
    and v_product.min_stake_units::text = v_min_units_text
    and v_product.max_stake_units::text is not distinct from v_max_units_text
    and v_product.term_reward_rate_ppm = p_term_reward_rate_ppm
    and v_product.enrollment_starts_at = p_enrollment_starts_at
    and v_product.enrollment_ends_at = p_enrollment_ends_at
  then
    v_outcome := 'NOOP';
  else
    update private.staking_products as products
    set
      project_id = p_project_id,
      asset_id = p_asset_id,
      display_name = v_display_name,
      description = v_description,
      lock_duration_days = p_lock_duration_days,
    min_stake_units = v_min_units_text::numeric::private.positive_atomic_units,
    max_stake_units = case
      when v_max_units_text is null then null
      else v_max_units_text::numeric
    end,
      term_reward_rate_ppm = p_term_reward_rate_ppm,
      reward_rounding_mode = 'FLOOR',
      enrollment_starts_at = p_enrollment_starts_at,
      enrollment_ends_at = p_enrollment_ends_at
    where products.id = p_staking_product_id
    returning products.*
      into v_product;

    v_outcome := 'APPLIED';
  end if;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_staking_product_admin_audit_event(
    p_command_id,
    'UPDATE_STAKING_PRODUCT_DRAFT',
    v_outcome,
    v_actor_user_id,
    v_product.id,
    v_product.project_id,
    v_product.asset_id,
    v_reason,
    v_request_data,
    'DRAFT',
    v_product.status,
    v_product.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, v_product.id, v_product.project_id, v_product.asset_id, v_product.version, v_occurred_at;
end;
$$;

comment on function public.update_staking_product_draft(uuid, bigint, uuid, uuid, text, text, integer, text, text, integer, timestamptz, timestamptz, uuid, text) is
  'ACTIVE ADMIN AAL2 command to edit a DRAFT staking product before first activation. Product code and activated product terms are immutable.';

create or replace function public.transition_staking_product_status(
  p_staking_product_id uuid,
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
  staking_product_id uuid,
  project_id uuid,
  asset_id uuid,
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
  v_existing_event private.staking_product_admin_audit_events%rowtype;
  v_product private.staking_products%rowtype;
  v_previous_status text;
  v_outcome text;
  v_boundary_code text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.staking_product_require_admin_aal2();
  v_reason := private.staking_product_normalize_reason(p_reason);
  v_new_status := pg_catalog.btrim(p_new_status);

  if p_command_id is null
    or p_staking_product_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or v_reason is null
    or v_new_status not in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_staking_product_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'staking_product_id', p_staking_product_id::text,
    'expected_version', p_expected_version,
    'new_status', v_new_status
  );

  perform private.staking_product_lock();

  select events.*
    into v_existing_event
  from private.staking_product_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'TRANSITION_STAKING_PRODUCT_STATUS'
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.staking_product_id, v_existing_event.project_id, v_existing_event.asset_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'STAKING_PRODUCT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_staking_product_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  select products.*
    into v_product
  from private.staking_products as products
  where products.id = p_staking_product_id
  for update;

  if not found then
    return query select 'STAKING_PRODUCT_NOT_FOUND'::text, false, null::uuid, p_command_id, p_staking_product_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_product.version <> p_expected_version then
    return query select 'STAKING_PRODUCT_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, p_staking_product_id, v_product.project_id, v_product.asset_id, v_product.version, null::timestamptz;
    return;
  end if;

  v_previous_status := v_product.status;

  if v_previous_status = v_new_status then
    v_outcome := 'NOOP';
  elsif v_previous_status = 'DRAFT' and v_new_status = 'ACTIVE'
    or v_previous_status = 'DRAFT' and v_new_status = 'ARCHIVED'
    or v_previous_status = 'ACTIVE' and v_new_status = 'SUSPENDED'
    or v_previous_status = 'SUSPENDED' and v_new_status = 'ACTIVE'
    or v_previous_status = 'SUSPENDED' and v_new_status = 'ARCHIVED'
  then
    if v_new_status = 'ACTIVE' then
      v_boundary_code := private.staking_product_activation_boundary_code(
        v_product.project_id,
        v_product.asset_id,
        v_product.enrollment_ends_at
      );

      if v_boundary_code is not null then
        return query select v_boundary_code, false, null::uuid, p_command_id, v_product.id, v_product.project_id, v_product.asset_id, v_product.version, null::timestamptz;
        return;
      end if;
    end if;

    update private.staking_products as products
    set
      status = v_new_status,
      activated_at = case
        when v_new_status = 'ACTIVE' and products.activated_at is null then clock_timestamp()
        else products.activated_at
      end,
      suspended_at = case
        when v_new_status = 'SUSPENDED' then clock_timestamp()
        when v_new_status = 'ACTIVE' then null
        else products.suspended_at
      end,
      archived_at = case
        when v_new_status = 'ARCHIVED' then clock_timestamp()
        else products.archived_at
      end
    where products.id = v_product.id
    returning products.*
      into v_product;

    v_outcome := 'APPLIED';
  else
    return query select 'STAKING_PRODUCT_TRANSITION_INVALID'::text, false, null::uuid, p_command_id, v_product.id, v_product.project_id, v_product.asset_id, v_product.version, null::timestamptz;
    return;
  end if;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_staking_product_admin_audit_event(
    p_command_id,
    'TRANSITION_STAKING_PRODUCT_STATUS',
    v_outcome,
    v_actor_user_id,
    v_product.id,
    v_product.project_id,
    v_product.asset_id,
    v_reason,
    v_request_data,
    v_previous_status,
    v_product.status,
    v_product.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, v_product.id, v_product.project_id, v_product.asset_id, v_product.version, v_occurred_at;
end;
$$;

comment on function public.transition_staking_product_status(uuid, bigint, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to transition staking product status. Activation validates active project, active SOLANA SPL project token assignment, and non-expired enrollment; same-status commands are NOOP.';

create or replace function public.list_current_staking_products(
  p_limit integer default 50
)
returns table (
  staking_product_id uuid,
  product_code text,
  display_name text,
  description text,
  project_id uuid,
  project_code text,
  project_display_name text,
  asset_id uuid,
  asset_code text,
  asset_symbol text,
  asset_decimals smallint,
  lock_duration_days integer,
  min_stake_units text,
  max_stake_units text,
  term_reward_rate_ppm integer,
  reward_rounding_mode text,
  enrollment_starts_at timestamptz,
  enrollment_ends_at timestamptz,
  enrollment_state text,
  product_version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform private.staking_product_require_active_user();

  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select
      products.id,
      products.product_code,
      products.display_name,
      products.description,
      projects.id,
      projects.project_code,
      projects.display_name,
      assets.id,
      assets.asset_code,
      assets.symbol,
      assets.decimals,
      products.lock_duration_days,
      products.min_stake_units::text,
      products.max_stake_units::text,
      products.term_reward_rate_ppm,
      products.reward_rounding_mode,
      products.enrollment_starts_at,
      products.enrollment_ends_at,
      case
        when products.enrollment_starts_at > now() then 'UPCOMING'
        else 'OPEN'
      end,
      products.version
    from private.staking_products as products
    join public.projects as projects
      on projects.id = products.project_id
    join public.supported_assets as assets
      on assets.id = products.asset_id
    join public.project_token_assignments as assignments
      on assignments.project_id = products.project_id
      and assignments.asset_id = products.asset_id
      and assignments.retired_at is null
    where products.status = 'ACTIVE'
      and projects.status = 'ACTIVE'
      and assets.status = 'ACTIVE'
      and assets.network = 'SOLANA'
      and assets.asset_type = 'SPL_TOKEN'
      and products.enrollment_ends_at > now()
    order by products.enrollment_starts_at asc, products.created_at desc, products.id desc
    limit v_limit;
end;
$$;

comment on function public.list_current_staking_products(integer) is
  'ACTIVE user read RPC for currently publishable staking products. It exposes product terms only and performs no staking request, reward calculation, ledger posting, wallet signing, or blockchain lookup.';

create or replace function public.list_admin_staking_products(
  p_limit integer default 100,
  p_status text default null
)
returns table (
  staking_product_id uuid,
  product_code text,
  display_name text,
  description text,
  project_id uuid,
  project_code text,
  project_display_name text,
  project_status text,
  asset_id uuid,
  asset_code text,
  asset_symbol text,
  asset_decimals smallint,
  asset_status text,
  asset_network text,
  asset_type text,
  lock_duration_days integer,
  min_stake_units text,
  max_stake_units text,
  term_reward_rate_ppm integer,
  reward_rounding_mode text,
  enrollment_starts_at timestamptz,
  enrollment_ends_at timestamptz,
  enrollment_state text,
  status text,
  version bigint,
  activated_at timestamptz,
  suspended_at timestamptz,
  archived_at timestamptz,
  current_project_token boolean,
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
  v_status text;
begin
  perform private.staking_product_require_admin_aal2();

  v_limit := coalesce(p_limit, 100);
  v_status := nullif(pg_catalog.btrim(p_status), '');

  if v_limit < 1 or v_limit > 200
    or (
      v_status is not null
      and v_status not in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')
    )
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select
      products.id,
      products.product_code,
      products.display_name,
      products.description,
      projects.id,
      projects.project_code,
      projects.display_name,
      projects.status,
      assets.id,
      assets.asset_code,
      assets.symbol,
      assets.decimals,
      assets.status,
      assets.network,
      assets.asset_type,
      products.lock_duration_days,
      products.min_stake_units::text,
      products.max_stake_units::text,
      products.term_reward_rate_ppm,
      products.reward_rounding_mode,
      products.enrollment_starts_at,
      products.enrollment_ends_at,
      case
        when products.enrollment_ends_at <= now() then 'CLOSED'
        when products.enrollment_starts_at > now() then 'UPCOMING'
        else 'OPEN'
      end,
      products.status,
      products.version,
      products.activated_at,
      products.suspended_at,
      products.archived_at,
      exists (
        select 1
        from public.project_token_assignments as assignments
        where assignments.project_id = products.project_id
          and assignments.asset_id = products.asset_id
          and assignments.retired_at is null
      ),
      products.created_at,
      products.updated_at
    from private.staking_products as products
    join public.projects as projects
      on projects.id = products.project_id
    join public.supported_assets as assets
      on assets.id = products.asset_id
    where v_status is null or products.status = v_status
    order by products.created_at desc, products.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_staking_products(integer, text) is
  'ACTIVE ADMIN AAL2 read RPC for staking product lifecycle rows, current token boundary state, and safe product terms.';

create or replace function public.list_staking_product_admin_audit_events(
  p_limit integer default 50,
  p_before_event_id uuid default null
)
returns table (
  event_id uuid,
  command_id uuid,
  action text,
  outcome text,
  actor_user_id uuid,
  staking_product_id uuid,
  project_id uuid,
  asset_id uuid,
  reason text,
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
  perform private.staking_product_require_admin_aal2();

  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_event_id is not null then
    select events.occurred_at, events.id
      into v_before_occurred_at, v_before_id
    from private.staking_product_admin_audit_events as events
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
      events.staking_product_id,
      events.project_id,
      events.asset_id,
      events.reason,
      events.previous_status,
      events.resulting_status,
      events.entity_version,
      events.occurred_at
    from private.staking_product_admin_audit_events as events
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

comment on function public.list_staking_product_admin_audit_events(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for staking product audit summaries. It intentionally omits request_data and does not expose raw command payloads.';

revoke execute on function public.create_staking_product(uuid, uuid, text, text, text, integer, text, text, integer, timestamptz, timestamptz, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.update_staking_product_draft(uuid, bigint, uuid, uuid, text, text, integer, text, text, integer, timestamptz, timestamptz, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.transition_staking_product_status(uuid, bigint, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.list_current_staking_products(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_staking_products(integer, text)
  from public, anon, authenticated;

revoke execute on function public.list_staking_product_admin_audit_events(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.create_staking_product(uuid, uuid, text, text, text, integer, text, text, integer, timestamptz, timestamptz, uuid, text)
  to authenticated;

grant execute on function public.update_staking_product_draft(uuid, bigint, uuid, uuid, text, text, integer, text, text, integer, timestamptz, timestamptz, uuid, text)
  to authenticated;

grant execute on function public.transition_staking_product_status(uuid, bigint, text, uuid, text)
  to authenticated;

grant execute on function public.list_current_staking_products(integer)
  to authenticated;

grant execute on function public.list_admin_staking_products(integer, text)
  to authenticated;

grant execute on function public.list_staking_product_admin_audit_events(integer, uuid)
  to authenticated;
