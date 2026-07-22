create table private.custody_providers (
  id uuid primary key default gen_random_uuid(),

  provider_code text not null unique,
  display_name text not null,
  provider_type text not null,

  supports_balance_observation boolean not null default false,
  supports_transfer_observation boolean not null default false,
  supports_transfer_lookup boolean not null default false,
  supports_payout_submission boolean not null default false,
  supports_webhook_ingestion boolean not null default false,

  status text not null default 'DRAFT',

  approved_at timestamptz null,
  suspended_at timestamptz null,
  retired_at timestamptz null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint custody_providers_provider_code_check
    check (
      provider_code = pg_catalog.btrim(provider_code)
      and provider_code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'
    ),

  constraint custody_providers_display_name_check
    check (
      display_name = pg_catalog.btrim(display_name)
      and pg_catalog.char_length(display_name) between 1 and 100
      and display_name !~ '[[:cntrl:]]'
    ),

  constraint custody_providers_provider_type_check
    check (
      provider_type in (
        'MPC_CUSTODIAN',
        'QUALIFIED_CUSTODIAN',
        'EXCHANGE_CUSTODY',
        'INTERNAL_HSM'
      )
    ),

  constraint custody_providers_status_check
    check (status in ('DRAFT', 'APPROVED', 'SUSPENDED', 'RETIRED')),

  constraint custody_providers_version_check
    check (version >= 1)
);

comment on table private.custody_providers is
  'Private custody provider configuration registry; stores non-secret provider metadata and capability flags only.';

create table private.custody_account_bindings (
  id uuid primary key default gen_random_uuid(),

  custody_provider_id uuid not null
    references private.custody_providers (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  binding_key text not null,
  display_label text not null,
  account_role text not null,

  status text not null default 'DRAFT',

  approved_at timestamptz null,
  suspended_at timestamptz null,
  retired_at timestamptz null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint custody_account_bindings_binding_key_check
    check (
      binding_key = pg_catalog.btrim(binding_key)
      and binding_key ~ '^[a-z0-9][a-z0-9_-]{2,63}$'
      and binding_key !~ '[[:space:]/\\:@]'
      and binding_key !~* '(https?://|bearer|begin[[:space:]_-]*private[[:space:]_-]*key|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|api[[:space:]_-]*key|api[[:space:]_-]*secret|address|signature|transaction|tx[[:space:]_-]*(id|hash)|provider[[:space:]_-]*account)'
    ),

  constraint custody_account_bindings_display_label_check
    check (
      display_label = pg_catalog.btrim(display_label)
      and pg_catalog.char_length(display_label) between 1 and 100
      and display_label !~ '[[:cntrl:]]'
    ),

  constraint custody_account_bindings_account_role_check
    check (account_role in ('COLLECTION', 'PAYOUT', 'TREASURY', 'FEE')),

  constraint custody_account_bindings_status_check
    check (status in ('DRAFT', 'APPROVED', 'SUSPENDED', 'RETIRED')),

  constraint custody_account_bindings_version_check
    check (version >= 1)
);

comment on table private.custody_account_bindings is
  'Private internal account binding aliases for custody provider and asset combinations; no blockchain address, external account ID, credential, or transaction identifier is stored.';

create unique index custody_account_bindings_provider_key_uidx
  on private.custody_account_bindings (custody_provider_id, binding_key);

create unique index custody_account_bindings_active_role_uidx
  on private.custody_account_bindings (
    custody_provider_id,
    asset_id,
    account_role
  )
  where status <> 'RETIRED';

create table private.custody_config_audit_events (
  id uuid primary key default gen_random_uuid(),

  command_id uuid not null unique,

  action text not null,
  outcome text not null,
  entity_type text not null,

  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,

  custody_provider_id uuid not null
    references private.custody_providers (id) on delete restrict,

  custody_account_binding_id uuid null
    references private.custody_account_bindings (id) on delete restrict,

  asset_id uuid null
    references public.supported_assets (id) on delete restrict,

  reason text not null,
  request_data jsonb not null,

  previous_status text null,
  resulting_status text not null,
  entity_version bigint not null,

  occurred_at timestamptz not null default clock_timestamp(),

  constraint custody_config_audit_events_action_check
    check (
      action in (
        'CREATE_PROVIDER_DRAFT',
        'UPDATE_PROVIDER_DRAFT',
        'TRANSITION_PROVIDER_STATUS',
        'CREATE_ACCOUNT_BINDING_DRAFT',
        'UPDATE_ACCOUNT_BINDING_DRAFT',
        'TRANSITION_ACCOUNT_BINDING_STATUS'
      )
    ),

  constraint custody_config_audit_events_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),

  constraint custody_config_audit_events_entity_type_check
    check (entity_type in ('PROVIDER', 'ACCOUNT_BINDING')),

  constraint custody_config_audit_events_reason_check
    check (
      reason = pg_catalog.btrim(reason)
      and pg_catalog.char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
      and reason !~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|https?://)'
    ),

  constraint custody_config_audit_events_request_data_check
    check (
      jsonb_typeof(request_data) = 'object'
      and request_data::text !~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|provider[[:space:]_-]*account|deposit[[:space:]_-]*address|wallet[[:space:]_-]*address|address|signature|transaction[[:space:]_-]*(id|hash|signature)|tx[[:space:]_-]*(id|hash|signature)|https?://|rpc)'
    ),

  constraint custody_config_audit_events_version_check
    check (entity_version >= 1),

  constraint custody_config_audit_events_entity_fk_check
    check (
      (
        entity_type = 'PROVIDER'
        and custody_account_binding_id is null
        and asset_id is null
      )
      or (
        entity_type = 'ACCOUNT_BINDING'
        and custody_account_binding_id is not null
        and asset_id is not null
      )
    )
);

comment on table private.custody_config_audit_events is
  'Append-only audit events for AAL2 custody provider and account binding configuration commands; request_data stores normalized non-secret command metadata only.';

create index custody_config_audit_events_occurred_at_idx
  on private.custody_config_audit_events (occurred_at desc, id desc);

create index custody_config_audit_events_actor_idx
  on private.custody_config_audit_events (actor_user_id, occurred_at desc);

create index custody_config_audit_events_provider_idx
  on private.custody_config_audit_events (
    custody_provider_id,
    occurred_at desc
  );

create index custody_config_audit_events_binding_idx
  on private.custody_config_audit_events (
    custody_account_binding_id,
    occurred_at desc
  )
  where custody_account_binding_id is not null;

revoke all privileges on table private.custody_providers
  from public, anon, authenticated;

revoke all privileges on table private.custody_account_bindings
  from public, anon, authenticated;

revoke all privileges on table private.custody_config_audit_events
  from public, anon, authenticated;

create trigger touch_custody_providers_version
  before update on private.custody_providers
  for each row
  execute function private.touch_versioned_record();

create trigger touch_custody_account_bindings_version
  before update on private.custody_account_bindings
  for each row
  execute function private.touch_versioned_record();

create or replace function private.prevent_custody_config_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CUSTODY_CONFIG_AUDIT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_custody_config_audit_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE on append-only custody configuration audit events.';

revoke execute on function private.prevent_custody_config_audit_mutation()
  from public, anon, authenticated;

create trigger protect_custody_config_audit_events
  before update or delete or truncate
  on private.custody_config_audit_events
  for each statement
  execute function private.prevent_custody_config_audit_mutation();

create or replace function private.validate_custody_provider_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT'
      or new.approved_at is not null
      or new.suspended_at is not null
      or new.retired_at is not null
    then
      raise exception 'CUSTODY_PROVIDER_INITIAL_STATE_INVALID'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.provider_code is distinct from old.provider_code then
    raise exception 'CUSTODY_PROVIDER_CODE_IMMUTABLE'
      using errcode = '23514';
  end if;

  if old.approved_at is not null
    and (
      new.display_name is distinct from old.display_name
      or new.provider_type is distinct from old.provider_type
      or new.supports_balance_observation is distinct from old.supports_balance_observation
      or new.supports_transfer_observation is distinct from old.supports_transfer_observation
      or new.supports_transfer_lookup is distinct from old.supports_transfer_lookup
      or new.supports_payout_submission is distinct from old.supports_payout_submission
      or new.supports_webhook_ingestion is distinct from old.supports_webhook_ingestion
    )
  then
    raise exception 'CUSTODY_PROVIDER_TERMS_IMMUTABLE'
      using errcode = '23514';
  end if;

  if old.status = 'RETIRED'
    and new.status is distinct from old.status
  then
    raise exception 'CUSTODY_PROVIDER_TRANSITION_INVALID'
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'DRAFT' and new.status in ('APPROVED', 'RETIRED'))
      or (old.status = 'APPROVED' and new.status = 'SUSPENDED')
      or (old.status = 'SUSPENDED' and new.status in ('APPROVED', 'RETIRED'))
    ) then
      raise exception 'CUSTODY_PROVIDER_TRANSITION_INVALID'
        using errcode = '23514';
    end if;

    if new.status = 'APPROVED' then
      if not (
        new.supports_balance_observation
        or new.supports_transfer_observation
        or new.supports_transfer_lookup
        or new.supports_payout_submission
        or new.supports_webhook_ingestion
      ) then
        raise exception 'CUSTODY_PROVIDER_CAPABILITY_REQUIRED'
          using errcode = '23514';
      end if;

      if old.approved_at is null then
        new.approved_at := clock_timestamp();
      else
        new.approved_at := old.approved_at;
      end if;
    else
      new.approved_at := old.approved_at;
    end if;

    if new.status = 'SUSPENDED' then
      new.suspended_at := clock_timestamp();
    else
      new.suspended_at := old.suspended_at;
    end if;

    if new.status = 'RETIRED' then
      new.retired_at := clock_timestamp();
    else
      new.retired_at := old.retired_at;
    end if;
  else
    new.approved_at := old.approved_at;
    new.suspended_at := old.suspended_at;
    new.retired_at := old.retired_at;
  end if;

  return new;
end;
$$;

comment on function private.validate_custody_provider_transition() is
  'Enforces custody provider lifecycle matrix, initial DRAFT state, capability requirement, and term freeze after first approval.';

revoke execute on function private.validate_custody_provider_transition()
  from public, anon, authenticated;

create trigger validate_custody_provider_transition
  before insert or update on private.custody_providers
  for each row
  execute function private.validate_custody_provider_transition();

create or replace function private.validate_custody_account_binding_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider private.custody_providers%rowtype;
  v_asset public.supported_assets%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT'
      or new.approved_at is not null
      or new.suspended_at is not null
      or new.retired_at is not null
    then
      raise exception 'CUSTODY_BINDING_INITIAL_STATE_INVALID'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.approved_at is not null
    and (
      new.custody_provider_id is distinct from old.custody_provider_id
      or new.asset_id is distinct from old.asset_id
      or new.binding_key is distinct from old.binding_key
      or new.display_label is distinct from old.display_label
      or new.account_role is distinct from old.account_role
    )
  then
    raise exception 'CUSTODY_BINDING_TERMS_IMMUTABLE'
      using errcode = '23514';
  end if;

  if new.binding_key is distinct from old.binding_key then
    raise exception 'CUSTODY_BINDING_KEY_IMMUTABLE'
      using errcode = '23514';
  end if;

  if old.status = 'RETIRED'
    and new.status is distinct from old.status
  then
    raise exception 'CUSTODY_BINDING_TRANSITION_INVALID'
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'DRAFT' and new.status in ('APPROVED', 'RETIRED'))
      or (old.status = 'APPROVED' and new.status = 'SUSPENDED')
      or (old.status = 'SUSPENDED' and new.status in ('APPROVED', 'RETIRED'))
    ) then
      raise exception 'CUSTODY_BINDING_TRANSITION_INVALID'
        using errcode = '23514';
    end if;

    if new.status = 'APPROVED' then
      select providers.*
        into v_provider
      from private.custody_providers as providers
      where providers.id = new.custody_provider_id;

      if not found or v_provider.status <> 'APPROVED' then
        raise exception 'CUSTODY_BINDING_PROVIDER_NOT_APPROVED'
          using errcode = '23514';
      end if;

      select assets.*
        into v_asset
      from public.supported_assets as assets
      where assets.id = new.asset_id;

      if not found
        or v_asset.status <> 'ACTIVE'
        or v_asset.network <> 'SOLANA'
        or v_asset.asset_type not in ('NATIVE', 'SPL_TOKEN')
      then
        raise exception 'CUSTODY_BINDING_ASSET_NOT_READY'
          using errcode = '23514';
      end if;

      if old.approved_at is null then
        new.approved_at := clock_timestamp();
      else
        new.approved_at := old.approved_at;
      end if;
    else
      new.approved_at := old.approved_at;
    end if;

    if new.status = 'SUSPENDED' then
      new.suspended_at := clock_timestamp();
    else
      new.suspended_at := old.suspended_at;
    end if;

    if new.status = 'RETIRED' then
      new.retired_at := clock_timestamp();
    else
      new.retired_at := old.retired_at;
    end if;
  else
    new.approved_at := old.approved_at;
    new.suspended_at := old.suspended_at;
    new.retired_at := old.retired_at;
  end if;

  return new;
end;
$$;

comment on function private.validate_custody_account_binding_transition() is
  'Enforces custody account binding lifecycle matrix, approved provider and ACTIVE SOLANA asset prerequisites, internal binding key constraints, and term freeze after first approval.';

revoke execute on function private.validate_custody_account_binding_transition()
  from public, anon, authenticated;

create trigger validate_custody_account_binding_transition
  before insert or update on private.custody_account_bindings
  for each row
  execute function private.validate_custody_account_binding_transition();

create or replace function private.custody_config_require_admin_aal2()
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
    raise exception 'CUSTODY_CONFIG_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

comment on function private.custody_config_require_admin_aal2() is
  'Returns the current ACTIVE ADMIN user id only when the request is authenticated at AAL2.';

create or replace function private.custody_config_normalize_reason(
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
    or v_reason ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|https?://)'
  then
    return null;
  end if;

  return v_reason;
end;
$$;

create or replace function private.custody_config_is_provider_code(
  p_value text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_value is not null
    and p_value = pg_catalog.btrim(p_value)
    and p_value ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$';
$$;

create or replace function private.custody_config_is_binding_key(
  p_value text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_value is not null
    and p_value = pg_catalog.btrim(p_value)
    and p_value ~ '^[a-z0-9][a-z0-9_-]{2,63}$'
    and p_value !~ '[[:space:]/\\:@]'
    and p_value !~* '(https?://|bearer|begin[[:space:]_-]*private[[:space:]_-]*key|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|api[[:space:]_-]*key|api[[:space:]_-]*secret|address|signature|transaction|tx[[:space:]_-]*(id|hash)|provider[[:space:]_-]*account)';
$$;

create or replace function private.custody_config_is_display_text(
  p_value text
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_value is not null
    and p_value = pg_catalog.btrim(p_value)
    and pg_catalog.char_length(p_value) between 1 and 100
    and p_value !~ '[[:cntrl:]]';
$$;

create or replace function private.custody_provider_snapshot(
  p_custody_provider_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', providers.id,
    'provider_code', providers.provider_code,
    'display_name', providers.display_name,
    'provider_type', providers.provider_type,
    'supports_balance_observation', providers.supports_balance_observation,
    'supports_transfer_observation', providers.supports_transfer_observation,
    'supports_transfer_lookup', providers.supports_transfer_lookup,
    'supports_payout_submission', providers.supports_payout_submission,
    'supports_webhook_ingestion', providers.supports_webhook_ingestion,
    'status', providers.status,
    'approved_at', providers.approved_at,
    'suspended_at', providers.suspended_at,
    'retired_at', providers.retired_at,
    'version', providers.version
  )
  from private.custody_providers as providers
  where providers.id = p_custody_provider_id;
$$;

create or replace function private.custody_account_binding_snapshot(
  p_custody_account_binding_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', bindings.id,
    'custody_provider_id', bindings.custody_provider_id,
    'asset_id', bindings.asset_id,
    'binding_key', bindings.binding_key,
    'display_label', bindings.display_label,
    'account_role', bindings.account_role,
    'status', bindings.status,
    'approved_at', bindings.approved_at,
    'suspended_at', bindings.suspended_at,
    'retired_at', bindings.retired_at,
    'version', bindings.version
  )
  from private.custody_account_bindings as bindings
  where bindings.id = p_custody_account_binding_id;
$$;

create or replace function private.record_custody_config_audit_event(
  p_command_id uuid,
  p_action text,
  p_outcome text,
  p_entity_type text,
  p_actor_user_id uuid,
  p_custody_provider_id uuid,
  p_custody_account_binding_id uuid,
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
  insert into private.custody_config_audit_events (
    command_id,
    action,
    outcome,
    entity_type,
    actor_user_id,
    custody_provider_id,
    custody_account_binding_id,
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
    p_entity_type,
    p_actor_user_id,
    p_custody_provider_id,
    p_custody_account_binding_id,
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

revoke execute on function private.custody_config_require_admin_aal2()
  from public, anon, authenticated;

revoke execute on function private.custody_config_normalize_reason(text)
  from public, anon, authenticated;

revoke execute on function private.custody_config_is_provider_code(text)
  from public, anon, authenticated;

revoke execute on function private.custody_config_is_binding_key(text)
  from public, anon, authenticated;

revoke execute on function private.custody_config_is_display_text(text)
  from public, anon, authenticated;

revoke execute on function private.custody_provider_snapshot(uuid)
  from public, anon, authenticated;

revoke execute on function private.custody_account_binding_snapshot(uuid)
  from public, anon, authenticated;

revoke execute on function private.record_custody_config_audit_event(
  uuid,
  text,
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

create or replace function public.upsert_custody_provider_draft(
  p_custody_provider_id uuid default null,
  p_expected_version bigint default null,
  p_provider_code text default null,
  p_display_name text default null,
  p_provider_type text default null,
  p_supports_balance_observation boolean default false,
  p_supports_transfer_observation boolean default false,
  p_supports_transfer_lookup boolean default false,
  p_supports_payout_submission boolean default false,
  p_supports_webhook_ingestion boolean default false,
  p_command_id uuid default null,
  p_reason text default null
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  custody_provider_id uuid,
  custody_account_binding_id uuid,
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
  v_provider_code text;
  v_display_name text;
  v_provider_type text;
  v_request_data jsonb;
  v_existing_event private.custody_config_audit_events%rowtype;
  v_provider private.custody_providers%rowtype;
  v_action text;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.custody_config_require_admin_aal2();
  v_reason := private.custody_config_normalize_reason(p_reason);
  v_provider_code := pg_catalog.btrim(p_provider_code);
  v_display_name := pg_catalog.btrim(p_display_name);
  v_provider_type := pg_catalog.btrim(p_provider_type);
  v_action := case
    when p_custody_provider_id is null then 'CREATE_PROVIDER_DRAFT'
    else 'UPDATE_PROVIDER_DRAFT'
  end;

  if p_command_id is null
    or v_reason is null
    or not private.custody_config_is_provider_code(v_provider_code)
    or not private.custody_config_is_display_text(v_display_name)
    or v_provider_type not in (
      'MPC_CUSTODIAN',
      'QUALIFIED_CUSTODIAN',
      'EXCHANGE_CUSTODY',
      'INTERNAL_HSM'
    )
    or (
      p_custody_provider_id is null
      and p_expected_version is not null
    )
    or (
      p_custody_provider_id is not null
      and (
        p_expected_version is null
        or p_expected_version < 1
      )
    )
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'custody_provider_id', p_custody_provider_id,
    'expected_version', p_expected_version,
    'provider_code', v_provider_code,
    'display_name', v_display_name,
    'provider_type', v_provider_type,
    'supports_balance_observation', coalesce(p_supports_balance_observation, false),
    'supports_transfer_observation', coalesce(p_supports_transfer_observation, false),
    'supports_transfer_lookup', coalesce(p_supports_transfer_lookup, false),
    'supports_payout_submission', coalesce(p_supports_payout_submission, false),
    'supports_webhook_ingestion', coalesce(p_supports_webhook_ingestion, false)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:custody-config-command:v1',
      0
    )
  );

  select events.* into v_existing_event
  from private.custody_config_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = v_action
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.custody_provider_id, v_existing_event.custody_account_binding_id, v_existing_event.asset_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'CUSTODY_CONFIG_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if p_custody_provider_id is null then
    if exists (
      select 1
      from private.custody_providers as providers
      where providers.provider_code = v_provider_code
    ) then
      return query select 'CUSTODY_PROVIDER_CODE_EXISTS'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, null::uuid, null::bigint, null::timestamptz;
      return;
    end if;

    insert into private.custody_providers (
      provider_code,
      display_name,
      provider_type,
      supports_balance_observation,
      supports_transfer_observation,
      supports_transfer_lookup,
      supports_payout_submission,
      supports_webhook_ingestion
    )
    values (
      v_provider_code,
      v_display_name,
      v_provider_type,
      coalesce(p_supports_balance_observation, false),
      coalesce(p_supports_transfer_observation, false),
      coalesce(p_supports_transfer_lookup, false),
      coalesce(p_supports_payout_submission, false),
      coalesce(p_supports_webhook_ingestion, false)
    )
    returning * into v_provider;

    v_outcome := 'APPLIED';
  else
    select providers.* into v_provider
    from private.custody_providers as providers
    where providers.id = p_custody_provider_id
    for update;

    if not found then
      return query select 'CUSTODY_PROVIDER_NOT_FOUND'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
      return;
    end if;

    if v_provider.version <> p_expected_version then
      return query select 'CUSTODY_PROVIDER_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, v_provider.version, null::timestamptz;
      return;
    end if;

    if v_provider.status <> 'DRAFT' or v_provider.approved_at is not null then
      return query select 'CUSTODY_PROVIDER_NOT_DRAFT'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, v_provider.version, null::timestamptz;
      return;
    end if;

    if v_provider.provider_code <> v_provider_code then
      return query select 'CUSTODY_PROVIDER_TERMS_IMMUTABLE'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, v_provider.version, null::timestamptz;
      return;
    end if;

    if v_provider.display_name = v_display_name
      and v_provider.provider_type = v_provider_type
      and v_provider.supports_balance_observation = coalesce(p_supports_balance_observation, false)
      and v_provider.supports_transfer_observation = coalesce(p_supports_transfer_observation, false)
      and v_provider.supports_transfer_lookup = coalesce(p_supports_transfer_lookup, false)
      and v_provider.supports_payout_submission = coalesce(p_supports_payout_submission, false)
      and v_provider.supports_webhook_ingestion = coalesce(p_supports_webhook_ingestion, false)
    then
      v_outcome := 'NOOP';
    else
      update private.custody_providers as providers
      set display_name = v_display_name,
        provider_type = v_provider_type,
        supports_balance_observation = coalesce(p_supports_balance_observation, false),
        supports_transfer_observation = coalesce(p_supports_transfer_observation, false),
        supports_transfer_lookup = coalesce(p_supports_transfer_lookup, false),
        supports_payout_submission = coalesce(p_supports_payout_submission, false),
        supports_webhook_ingestion = coalesce(p_supports_webhook_ingestion, false)
      where providers.id = p_custody_provider_id
      returning * into v_provider;

      v_outcome := 'APPLIED';
    end if;
  end if;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_custody_config_audit_event(
    p_command_id,
    v_action,
    v_outcome,
    'PROVIDER',
    v_actor_user_id,
    v_provider.id,
    null,
    null,
    v_reason,
    v_request_data,
    case when v_action = 'CREATE_PROVIDER_DRAFT' then null else v_provider.status end,
    v_provider.status,
    v_provider.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, v_provider.id, null::uuid, null::uuid, v_provider.version, v_occurred_at;
end;
$$;

comment on function public.upsert_custody_provider_draft(uuid, bigint, text, text, text, boolean, boolean, boolean, boolean, boolean, uuid, text) is
  'ACTIVE ADMIN AAL2 command to create or update DRAFT custody provider metadata without credentials, provider SDKs, or network access.';

create or replace function public.transition_custody_provider_status(
  p_custody_provider_id uuid,
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
  custody_provider_id uuid,
  custody_account_binding_id uuid,
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
  v_existing_event private.custody_config_audit_events%rowtype;
  v_provider private.custody_providers%rowtype;
  v_previous_status text;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.custody_config_require_admin_aal2();
  v_reason := private.custody_config_normalize_reason(p_reason);
  v_new_status := pg_catalog.btrim(p_new_status);

  if p_custody_provider_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_command_id is null
    or v_reason is null
    or v_new_status not in ('DRAFT', 'APPROVED', 'SUSPENDED', 'RETIRED')
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'custody_provider_id', p_custody_provider_id,
    'expected_version', p_expected_version,
    'new_status', v_new_status
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:custody-config-command:v1', 0));

  select events.* into v_existing_event
  from private.custody_config_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'TRANSITION_PROVIDER_STATUS'
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.custody_provider_id, v_existing_event.custody_account_binding_id, v_existing_event.asset_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'CUSTODY_CONFIG_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  select providers.* into v_provider
  from private.custody_providers as providers
  where providers.id = p_custody_provider_id
  for update;

  if not found then
    return query select 'CUSTODY_PROVIDER_NOT_FOUND'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_provider.version <> p_expected_version then
    return query select 'CUSTODY_PROVIDER_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, v_provider.version, null::timestamptz;
    return;
  end if;

  if v_new_status = 'APPROVED'
    and not (
      v_provider.supports_balance_observation
      or v_provider.supports_transfer_observation
      or v_provider.supports_transfer_lookup
      or v_provider.supports_payout_submission
      or v_provider.supports_webhook_ingestion
    )
  then
    return query select 'CUSTODY_PROVIDER_CAPABILITY_REQUIRED'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, v_provider.version, null::timestamptz;
    return;
  end if;

  if v_provider.status = v_new_status then
    v_previous_status := v_provider.status;
    v_outcome := 'NOOP';
  elsif (
      (v_provider.status = 'DRAFT' and v_new_status in ('APPROVED', 'RETIRED'))
      or (v_provider.status = 'APPROVED' and v_new_status = 'SUSPENDED')
      or (v_provider.status = 'SUSPENDED' and v_new_status in ('APPROVED', 'RETIRED'))
    ) then
    v_previous_status := v_provider.status;

    update private.custody_providers as providers
    set status = v_new_status
    where providers.id = p_custody_provider_id
    returning * into v_provider;

    v_outcome := 'APPLIED';
  else
    return query select 'CUSTODY_PROVIDER_TRANSITION_INVALID'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, null::uuid, v_provider.version, null::timestamptz;
    return;
  end if;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_custody_config_audit_event(
    p_command_id,
    'TRANSITION_PROVIDER_STATUS',
    v_outcome,
    'PROVIDER',
    v_actor_user_id,
    v_provider.id,
    null,
    null,
    v_reason,
    v_request_data,
    v_previous_status,
    v_provider.status,
    v_provider.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, v_provider.id, null::uuid, null::uuid, v_provider.version, v_occurred_at;
end;
$$;

comment on function public.transition_custody_provider_status(uuid, bigint, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to transition custody provider lifecycle status with expected-version concurrency and append-only audit.';

create or replace function public.upsert_custody_account_binding_draft(
  p_custody_account_binding_id uuid default null,
  p_expected_version bigint default null,
  p_custody_provider_id uuid default null,
  p_asset_id uuid default null,
  p_binding_key text default null,
  p_display_label text default null,
  p_account_role text default null,
  p_command_id uuid default null,
  p_reason text default null
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  custody_provider_id uuid,
  custody_account_binding_id uuid,
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
  v_binding_key text;
  v_display_label text;
  v_account_role text;
  v_request_data jsonb;
  v_existing_event private.custody_config_audit_events%rowtype;
  v_binding private.custody_account_bindings%rowtype;
  v_action text;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.custody_config_require_admin_aal2();
  v_reason := private.custody_config_normalize_reason(p_reason);
  v_binding_key := pg_catalog.btrim(p_binding_key);
  v_display_label := pg_catalog.btrim(p_display_label);
  v_account_role := pg_catalog.btrim(p_account_role);
  v_action := case
    when p_custody_account_binding_id is null then 'CREATE_ACCOUNT_BINDING_DRAFT'
    else 'UPDATE_ACCOUNT_BINDING_DRAFT'
  end;

  if p_command_id is null
    or v_reason is null
    or p_custody_provider_id is null
    or p_asset_id is null
    or not private.custody_config_is_binding_key(v_binding_key)
    or not private.custody_config_is_display_text(v_display_label)
    or v_account_role not in ('COLLECTION', 'PAYOUT', 'TREASURY', 'FEE')
    or (
      p_custody_account_binding_id is null
      and p_expected_version is not null
    )
    or (
      p_custody_account_binding_id is not null
      and (
        p_expected_version is null
        or p_expected_version < 1
      )
    )
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_custody_provider_id, p_custody_account_binding_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'custody_account_binding_id', p_custody_account_binding_id,
    'expected_version', p_expected_version,
    'custody_provider_id', p_custody_provider_id,
    'asset_id', p_asset_id,
    'binding_key', v_binding_key,
    'display_label', v_display_label,
    'account_role', v_account_role
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:custody-config-command:v1', 0));

  select events.* into v_existing_event
  from private.custody_config_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = v_action
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.custody_provider_id, v_existing_event.custody_account_binding_id, v_existing_event.asset_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'CUSTODY_CONFIG_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_custody_provider_id, p_custody_account_binding_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1
    from private.custody_providers as providers
    where providers.id = p_custody_provider_id
  ) then
    return query select 'CUSTODY_PROVIDER_NOT_FOUND'::text, false, null::uuid, p_command_id, p_custody_provider_id, p_custody_account_binding_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1
    from public.supported_assets as assets
    where assets.id = p_asset_id
  ) then
    return query select 'ASSET_NOT_FOUND'::text, false, null::uuid, p_command_id, p_custody_provider_id, p_custody_account_binding_id, p_asset_id, null::bigint, null::timestamptz;
    return;
  end if;

  if p_custody_account_binding_id is null then
    if exists (
      select 1
      from private.custody_account_bindings as bindings
      where bindings.custody_provider_id = p_custody_provider_id
        and bindings.binding_key = v_binding_key
    ) then
      return query select 'CUSTODY_BINDING_KEY_EXISTS'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, p_asset_id, null::bigint, null::timestamptz;
      return;
    end if;

    if exists (
      select 1
      from private.custody_account_bindings as bindings
      where bindings.custody_provider_id = p_custody_provider_id
        and bindings.asset_id = p_asset_id
        and bindings.account_role = v_account_role
        and bindings.status <> 'RETIRED'
    ) then
      return query select 'CUSTODY_BINDING_DUPLICATE_ACTIVE_ROLE'::text, false, null::uuid, p_command_id, p_custody_provider_id, null::uuid, p_asset_id, null::bigint, null::timestamptz;
      return;
    end if;

    insert into private.custody_account_bindings (
      custody_provider_id,
      asset_id,
      binding_key,
      display_label,
      account_role
    )
    values (
      p_custody_provider_id,
      p_asset_id,
      v_binding_key,
      v_display_label,
      v_account_role
    )
    returning * into v_binding;

    v_outcome := 'APPLIED';
  else
    select bindings.* into v_binding
    from private.custody_account_bindings as bindings
    where bindings.id = p_custody_account_binding_id
    for update;

    if not found then
      return query select 'CUSTODY_BINDING_NOT_FOUND'::text, false, null::uuid, p_command_id, p_custody_provider_id, p_custody_account_binding_id, p_asset_id, null::bigint, null::timestamptz;
      return;
    end if;

    if v_binding.version <> p_expected_version then
      return query select 'CUSTODY_BINDING_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, null::timestamptz;
      return;
    end if;

    if v_binding.status <> 'DRAFT' or v_binding.approved_at is not null then
      return query select 'CUSTODY_BINDING_NOT_DRAFT'::text, false, null::uuid, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, null::timestamptz;
      return;
    end if;

    if v_binding.binding_key <> v_binding_key then
      return query select 'CUSTODY_BINDING_TERMS_IMMUTABLE'::text, false, null::uuid, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, null::timestamptz;
      return;
    end if;

    if exists (
      select 1
      from private.custody_account_bindings as bindings
      where bindings.id <> p_custody_account_binding_id
        and bindings.custody_provider_id = p_custody_provider_id
        and bindings.asset_id = p_asset_id
        and bindings.account_role = v_account_role
        and bindings.status <> 'RETIRED'
    ) then
      return query select 'CUSTODY_BINDING_DUPLICATE_ACTIVE_ROLE'::text, false, null::uuid, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, null::timestamptz;
      return;
    end if;

    if v_binding.custody_provider_id = p_custody_provider_id
      and v_binding.asset_id = p_asset_id
      and v_binding.display_label = v_display_label
      and v_binding.account_role = v_account_role
    then
      v_outcome := 'NOOP';
    else
      update private.custody_account_bindings as bindings
      set custody_provider_id = p_custody_provider_id,
        asset_id = p_asset_id,
        display_label = v_display_label,
        account_role = v_account_role
      where bindings.id = p_custody_account_binding_id
      returning * into v_binding;

      v_outcome := 'APPLIED';
    end if;
  end if;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_custody_config_audit_event(
    p_command_id,
    v_action,
    v_outcome,
    'ACCOUNT_BINDING',
    v_actor_user_id,
    v_binding.custody_provider_id,
    v_binding.id,
    v_binding.asset_id,
    v_reason,
    v_request_data,
    case when v_action = 'CREATE_ACCOUNT_BINDING_DRAFT' then null else v_binding.status end,
    v_binding.status,
    v_binding.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, v_occurred_at;
end;
$$;

comment on function public.upsert_custody_account_binding_draft(uuid, bigint, uuid, uuid, text, text, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to create or update DRAFT internal custody account binding aliases without provider account IDs, addresses, credentials, or network access.';

create or replace function public.transition_custody_account_binding_status(
  p_custody_account_binding_id uuid,
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
  custody_provider_id uuid,
  custody_account_binding_id uuid,
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
  v_existing_event private.custody_config_audit_events%rowtype;
  v_binding private.custody_account_bindings%rowtype;
  v_provider private.custody_providers%rowtype;
  v_asset public.supported_assets%rowtype;
  v_previous_status text;
  v_outcome text;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.custody_config_require_admin_aal2();
  v_reason := private.custody_config_normalize_reason(p_reason);
  v_new_status := pg_catalog.btrim(p_new_status);

  if p_custody_account_binding_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_command_id is null
    or v_reason is null
    or v_new_status not in ('DRAFT', 'APPROVED', 'SUSPENDED', 'RETIRED')
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, null::uuid, p_custody_account_binding_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'custody_account_binding_id', p_custody_account_binding_id,
    'expected_version', p_expected_version,
    'new_status', v_new_status
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staking-wallet-web:custody-config-command:v1', 0));

  select events.* into v_existing_event
  from private.custody_config_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'TRANSITION_ACCOUNT_BINDING_STATUS'
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select v_existing_event.outcome, true, v_existing_event.id, v_existing_event.command_id, v_existing_event.custody_provider_id, v_existing_event.custody_account_binding_id, v_existing_event.asset_id, v_existing_event.entity_version, v_existing_event.occurred_at;
      return;
    end if;

    return query select 'CUSTODY_CONFIG_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, p_custody_account_binding_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  select bindings.* into v_binding
  from private.custody_account_bindings as bindings
  where bindings.id = p_custody_account_binding_id
  for update;

  if not found then
    return query select 'CUSTODY_BINDING_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, p_custody_account_binding_id, null::uuid, null::bigint, null::timestamptz;
    return;
  end if;

  if v_binding.version <> p_expected_version then
    return query select 'CUSTODY_BINDING_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, null::timestamptz;
    return;
  end if;

  if v_new_status = 'APPROVED' then
    select providers.* into v_provider
    from private.custody_providers as providers
    where providers.id = v_binding.custody_provider_id;

    if not found or v_provider.status <> 'APPROVED' then
      return query select 'CUSTODY_BINDING_PROVIDER_NOT_APPROVED'::text, false, null::uuid, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, null::timestamptz;
      return;
    end if;

    select assets.* into v_asset
    from public.supported_assets as assets
    where assets.id = v_binding.asset_id;

    if not found
      or v_asset.status <> 'ACTIVE'
      or v_asset.network <> 'SOLANA'
      or v_asset.asset_type not in ('NATIVE', 'SPL_TOKEN')
    then
      return query select 'CUSTODY_BINDING_ASSET_NOT_READY'::text, false, null::uuid, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, null::timestamptz;
      return;
    end if;
  end if;

  if v_binding.status = v_new_status then
    v_previous_status := v_binding.status;
    v_outcome := 'NOOP';
  elsif (
      (v_binding.status = 'DRAFT' and v_new_status in ('APPROVED', 'RETIRED'))
      or (v_binding.status = 'APPROVED' and v_new_status = 'SUSPENDED')
      or (v_binding.status = 'SUSPENDED' and v_new_status in ('APPROVED', 'RETIRED'))
    ) then
    v_previous_status := v_binding.status;

    update private.custody_account_bindings as bindings
    set status = v_new_status
    where bindings.id = p_custody_account_binding_id
    returning * into v_binding;

    v_outcome := 'APPLIED';
  else
    return query select 'CUSTODY_BINDING_TRANSITION_INVALID'::text, false, null::uuid, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, null::timestamptz;
    return;
  end if;

  select audit.out_event_id, audit.out_occurred_at
    into v_event_id, v_occurred_at
  from private.record_custody_config_audit_event(
    p_command_id,
    'TRANSITION_ACCOUNT_BINDING_STATUS',
    v_outcome,
    'ACCOUNT_BINDING',
    v_actor_user_id,
    v_binding.custody_provider_id,
    v_binding.id,
    v_binding.asset_id,
    v_reason,
    v_request_data,
    v_previous_status,
    v_binding.status,
    v_binding.version
  ) as audit;

  return query select v_outcome, false, v_event_id, p_command_id, v_binding.custody_provider_id, v_binding.id, v_binding.asset_id, v_binding.version, v_occurred_at;
end;
$$;

comment on function public.transition_custody_account_binding_status(uuid, bigint, text, uuid, text) is
  'ACTIVE ADMIN AAL2 command to transition internal custody account binding lifecycle status with provider and asset readiness checks before approval.';

create or replace function public.list_admin_custody_providers(
  p_limit integer default 100,
  p_status text default null
)
returns table (
  custody_provider_id uuid,
  provider_code text,
  display_name text,
  provider_type text,
  supports_balance_observation boolean,
  supports_transfer_observation boolean,
  supports_transfer_lookup boolean,
  supports_payout_submission boolean,
  supports_webhook_ingestion boolean,
  status text,
  approved_at timestamptz,
  suspended_at timestamptz,
  retired_at timestamptz,
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
  v_status text;
begin
  perform private.custody_config_require_admin_aal2();

  v_limit := coalesce(p_limit, 100);
  v_status := nullif(pg_catalog.btrim(p_status), '');

  if v_limit < 1 or v_limit > 200
    or (
      v_status is not null
      and v_status not in ('DRAFT', 'APPROVED', 'SUSPENDED', 'RETIRED')
    )
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select
      providers.id,
      providers.provider_code,
      providers.display_name,
      providers.provider_type,
      providers.supports_balance_observation,
      providers.supports_transfer_observation,
      providers.supports_transfer_lookup,
      providers.supports_payout_submission,
      providers.supports_webhook_ingestion,
      providers.status,
      providers.approved_at,
      providers.suspended_at,
      providers.retired_at,
      providers.version,
      providers.created_at,
      providers.updated_at
    from private.custody_providers as providers
    where v_status is null or providers.status = v_status
    order by providers.created_at desc, providers.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_custody_providers(integer, text) is
  'ACTIVE ADMIN AAL2 read RPC for non-secret custody provider configuration metadata.';

create or replace function public.list_admin_custody_account_bindings(
  p_limit integer default 100,
  p_status text default null
)
returns table (
  custody_account_binding_id uuid,
  custody_provider_id uuid,
  provider_code text,
  asset_id uuid,
  asset_code text,
  asset_symbol text,
  asset_type text,
  asset_status text,
  binding_key text,
  display_label text,
  account_role text,
  status text,
  approved_at timestamptz,
  suspended_at timestamptz,
  retired_at timestamptz,
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
  v_status text;
begin
  perform private.custody_config_require_admin_aal2();

  v_limit := coalesce(p_limit, 100);
  v_status := nullif(pg_catalog.btrim(p_status), '');

  if v_limit < 1 or v_limit > 200
    or (
      v_status is not null
      and v_status not in ('DRAFT', 'APPROVED', 'SUSPENDED', 'RETIRED')
    )
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select
      bindings.id,
      bindings.custody_provider_id,
      providers.provider_code,
      bindings.asset_id,
      assets.asset_code,
      assets.symbol,
      assets.asset_type,
      assets.status,
      bindings.binding_key,
      bindings.display_label,
      bindings.account_role,
      bindings.status,
      bindings.approved_at,
      bindings.suspended_at,
      bindings.retired_at,
      bindings.version,
      bindings.created_at,
      bindings.updated_at
    from private.custody_account_bindings as bindings
    join private.custody_providers as providers
      on providers.id = bindings.custody_provider_id
    join public.supported_assets as assets
      on assets.id = bindings.asset_id
    where v_status is null or bindings.status = v_status
    order by bindings.created_at desc, bindings.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_custody_account_bindings(integer, text) is
  'ACTIVE ADMIN AAL2 read RPC for internal custody account binding aliases without external account IDs, addresses, credentials, or transaction identifiers.';

create or replace function public.list_custody_config_audit_events(
  p_limit integer default 50,
  p_before_event_id uuid default null
)
returns table (
  event_id uuid,
  command_id uuid,
  action text,
  outcome text,
  entity_type text,
  actor_user_id uuid,
  custody_provider_id uuid,
  custody_account_binding_id uuid,
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
  perform private.custody_config_require_admin_aal2();

  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_event_id is not null then
    select events.occurred_at, events.id
      into v_before_occurred_at, v_before_id
    from private.custody_config_audit_events as events
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
      events.entity_type,
      events.actor_user_id,
      events.custody_provider_id,
      events.custody_account_binding_id,
      events.asset_id,
      events.reason,
      events.previous_status,
      events.resulting_status,
      events.entity_version,
      events.occurred_at
    from private.custody_config_audit_events as events
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

comment on function public.list_custody_config_audit_events(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for custody configuration audit summaries; request_data is intentionally omitted.';

revoke execute on function public.upsert_custody_provider_draft(uuid, bigint, text, text, text, boolean, boolean, boolean, boolean, boolean, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.transition_custody_provider_status(uuid, bigint, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.upsert_custody_account_binding_draft(uuid, bigint, uuid, uuid, text, text, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.transition_custody_account_binding_status(uuid, bigint, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.list_admin_custody_providers(integer, text)
  from public, anon, authenticated;

revoke execute on function public.list_admin_custody_account_bindings(integer, text)
  from public, anon, authenticated;

revoke execute on function public.list_custody_config_audit_events(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.upsert_custody_provider_draft(uuid, bigint, text, text, text, boolean, boolean, boolean, boolean, boolean, uuid, text)
  to authenticated;

grant execute on function public.transition_custody_provider_status(uuid, bigint, text, uuid, text)
  to authenticated;

grant execute on function public.upsert_custody_account_binding_draft(uuid, bigint, uuid, uuid, text, text, text, uuid, text)
  to authenticated;

grant execute on function public.transition_custody_account_binding_status(uuid, bigint, text, uuid, text)
  to authenticated;

grant execute on function public.list_admin_custody_providers(integer, text)
  to authenticated;

grant execute on function public.list_admin_custody_account_bindings(integer, text)
  to authenticated;

grant execute on function public.list_custody_config_audit_events(integer, uuid)
  to authenticated;
