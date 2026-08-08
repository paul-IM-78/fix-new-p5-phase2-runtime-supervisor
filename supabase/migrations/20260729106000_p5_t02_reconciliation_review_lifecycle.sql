create table private.reconciliation_review_cases (
  id uuid primary key default gen_random_uuid(),

  reconciliation_item_id uuid not null
    references private.reconciliation_items (id) on delete restrict,

  status text not null,
  version bigint not null default 1,

  opened_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz null,

  opened_by_profile_id uuid not null
    references public.profiles (id) on delete restrict,

  last_actor_profile_id uuid not null
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default clock_timestamp(),

  constraint reconciliation_resolutions_item_uidx
    unique (reconciliation_item_id),

  constraint reconciliation_resolutions_status_check
    check (status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED')),

  constraint reconciliation_resolutions_version_check
    check (version >= 1),

  constraint reconciliation_resolutions_time_order_check
    check (
      updated_at >= opened_at
      and (
        resolved_at is null
        or resolved_at >= opened_at
      )
    ),

  constraint reconciliation_resolutions_terminal_shape_check
    check (
      (
        status in ('OPEN', 'IN_REVIEW')
        and resolved_at is null
      )
      or (
        status in ('RESOLVED', 'IGNORED')
        and resolved_at is not null
      )
    )
);

comment on table private.reconciliation_review_cases is
  'Private current-state review cases for reconciliation items. The referenced reconciliation item remains the source of truth for expected, observed, difference, tolerance, classification, scope, and asset data.';

comment on column private.reconciliation_review_cases.reconciliation_item_id is
  'Reconciliation item under review. Only MISMATCH and OBSERVATION_FAILED items are reviewable by the private open function.';

comment on column private.reconciliation_review_cases.version is
  'Optimistic concurrency version for the current review case; it starts at 1 and increments once per appended review case event.';

create index reconciliation_resolutions_status_updated_idx
  on private.reconciliation_review_cases (
    status,
    updated_at desc,
    id desc
  );

create index reconciliation_resolutions_last_actor_idx
  on private.reconciliation_review_cases (
    last_actor_profile_id,
    updated_at desc
  );

create table private.reconciliation_review_case_events (
  id uuid primary key default gen_random_uuid(),

  reconciliation_resolution_id uuid not null
    references private.reconciliation_review_cases (id) on delete restrict,

  event_version bigint not null,
  idempotency_key text not null,

  event_type text not null,
  from_status text null,
  to_status text not null,

  actor_profile_id uuid not null
    references public.profiles (id) on delete restrict,

  reason_code text not null,

  created_at timestamptz not null default clock_timestamp(),

  constraint reconciliation_resolution_events_version_uidx
    unique (reconciliation_resolution_id, event_version),

  constraint reconciliation_resolution_events_resolution_key_uidx
    unique (reconciliation_resolution_id, idempotency_key),

  constraint reconciliation_resolution_events_key_uidx
    unique (idempotency_key),

  constraint reconciliation_resolution_events_version_check
    check (event_version >= 1),

  constraint reconciliation_resolution_events_idempotency_key_check
    check (
      idempotency_key = pg_catalog.btrim(idempotency_key)
      and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
      and idempotency_key !~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
    ),

  constraint reconciliation_resolution_events_event_type_check
    check (event_type in ('OPENED', 'REVIEW_STARTED', 'RESOLVED', 'IGNORED')),

  constraint reconciliation_resolution_events_status_check
    check (
      (from_status is null or from_status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED'))
      and to_status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED')
    ),

  constraint reconciliation_resolution_events_reason_code_check
    check (
      reason_code = pg_catalog.btrim(reason_code)
      and reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
    ),

  constraint reconciliation_resolution_events_type_status_check
    check (
      (
        event_type = 'OPENED'
        and event_version = 1
        and from_status is null
        and to_status = 'OPEN'
      )
      or (
        event_type = 'REVIEW_STARTED'
        and from_status = 'OPEN'
        and to_status = 'IN_REVIEW'
      )
      or (
        event_type = 'RESOLVED'
        and from_status in ('OPEN', 'IN_REVIEW')
        and to_status = 'RESOLVED'
      )
      or (
        event_type = 'IGNORED'
        and from_status in ('OPEN', 'IN_REVIEW')
        and to_status = 'IGNORED'
      )
    )
);

comment on table private.reconciliation_review_case_events is
  'Append-only private audit history for reconciliation review case opens and status transitions. It stores safe reason codes only and never stores free-text notes, raw provider payloads, credentials, wallet identifiers, or financial postings.';

comment on column private.reconciliation_review_case_events.event_version is
  'Review-case-local event sequence. The event version equals the resulting reconciliation_review_cases.version.';

comment on column private.reconciliation_review_case_events.idempotency_key is
  'Non-secret idempotency key for exactly one review lifecycle event request.';

comment on column private.reconciliation_review_case_events.reason_code is
  'Safe bounded uppercase reason code. Product-specific resolution taxonomy is deferred to the future AAL2 ADMIN command boundary.';

create index reconciliation_resolution_events_resolution_version_idx
  on private.reconciliation_review_case_events (
    reconciliation_resolution_id,
    event_version desc
  );

create index reconciliation_resolution_events_actor_created_idx
  on private.reconciliation_review_case_events (
    actor_profile_id,
    created_at desc
  );

create index reconciliation_resolution_events_created_idx
  on private.reconciliation_review_case_events (
    created_at desc,
    id desc
  );

revoke all privileges on table private.reconciliation_review_cases
  from public, anon, authenticated;

revoke all privileges on table private.reconciliation_review_case_events
  from public, anon, authenticated;

create or replace function private.prevent_reconciliation_resolution_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'reconciliation_resolution_event_immutable'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_reconciliation_resolution_event_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE on append-only reconciliation resolution events.';

revoke execute on function private.prevent_reconciliation_resolution_event_mutation()
  from public, anon, authenticated;

create trigger protect_reconciliation_resolution_events
  before update or delete or truncate
  on private.reconciliation_review_case_events
  for each statement
  execute function private.prevent_reconciliation_resolution_event_mutation();

create or replace function private.normalize_reconciliation_resolution_idempotency_key(
  p_idempotency_key text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_idempotency_key text;
begin
  v_idempotency_key := pg_catalog.btrim(p_idempotency_key);

  if v_idempotency_key is null
    or v_idempotency_key = ''
    or pg_catalog.char_length(v_idempotency_key) > 200
    or v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or v_idempotency_key ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
  then
    raise exception 'reconciliation_resolution_idempotency_key_invalid'
      using errcode = '22023';
  end if;

  return v_idempotency_key;
end;
$$;

comment on function private.normalize_reconciliation_resolution_idempotency_key(text) is
  'Normalizes and validates non-secret reconciliation review lifecycle idempotency keys.';

revoke execute on function private.normalize_reconciliation_resolution_idempotency_key(text)
  from public, anon, authenticated;

create or replace function private.normalize_reconciliation_resolution_reason_code(
  p_reason_code text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_reason_code text;
begin
  v_reason_code := pg_catalog.btrim(p_reason_code);

  if v_reason_code is null
    or v_reason_code = ''
    or v_reason_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
  then
    raise exception 'reconciliation_resolution_reason_code_invalid'
      using errcode = '22023';
  end if;

  return v_reason_code;
end;
$$;

comment on function private.normalize_reconciliation_resolution_reason_code(text) is
  'Normalizes and validates safe uppercase reconciliation review lifecycle reason codes; free-text notes and taxonomy-specific resolution codes are deferred.';

revoke execute on function private.normalize_reconciliation_resolution_reason_code(text)
  from public, anon, authenticated;

create or replace function private.assert_reconciliation_resolution_integrity(
  p_reconciliation_resolution_id uuid
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_resolution private.reconciliation_review_cases%rowtype;
  v_event_count bigint;
  v_distinct_version_count bigint;
  v_max_event_version bigint;
  v_first_event private.reconciliation_review_case_events%rowtype;
  v_last_event private.reconciliation_review_case_events%rowtype;
begin
  select resolutions.*
    into v_resolution
  from private.reconciliation_review_cases as resolutions
  where resolutions.id = p_reconciliation_resolution_id;

  if not found then
    raise exception 'reconciliation_resolution_existing_state_invalid'
      using errcode = '23514';
  end if;

  select
    count(*)::bigint,
    count(distinct events.event_version)::bigint,
    max(events.event_version)::bigint
    into
      v_event_count,
      v_distinct_version_count,
      v_max_event_version
  from private.reconciliation_review_case_events as events
  where events.reconciliation_resolution_id = v_resolution.id;

  select events.*
    into v_first_event
  from private.reconciliation_review_case_events as events
  where events.reconciliation_resolution_id = v_resolution.id
  order by events.event_version asc, events.id asc
  limit 1;

  select events.*
    into v_last_event
  from private.reconciliation_review_case_events as events
  where events.reconciliation_resolution_id = v_resolution.id
  order by events.event_version desc, events.id desc
  limit 1;

  if v_event_count = 0
    or v_event_count <> v_distinct_version_count
    or v_event_count <> v_resolution.version
    or v_max_event_version <> v_resolution.version
    or v_first_event.event_version <> 1
    or v_first_event.event_type <> 'OPENED'
    or v_first_event.from_status is not null
    or v_first_event.to_status <> 'OPEN'
    or v_last_event.to_status <> v_resolution.status
    or (
      v_resolution.status in ('OPEN', 'IN_REVIEW')
      and v_resolution.resolved_at is not null
    )
    or (
      v_resolution.status in ('RESOLVED', 'IGNORED')
      and v_resolution.resolved_at is null
    )
  then
    raise exception 'reconciliation_resolution_existing_state_invalid'
      using errcode = '23514';
  end if;
end;
$$;

comment on function private.assert_reconciliation_resolution_integrity(uuid) is
  'Validates reconciliation review case and append-only event consistency before idempotent replay or status transition processing.';

revoke execute on function private.assert_reconciliation_resolution_integrity(uuid)
  from public, anon, authenticated;

create or replace function private.open_reconciliation_resolution(
  p_reconciliation_item_id uuid,
  p_idempotency_key text,
  p_actor_profile_id uuid,
  p_reason_code text
)
returns table (
  reconciliation_resolution_id uuid,
  created boolean,
  status text,
  version bigint,
  event_id uuid
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_idempotency_key text;
  v_reason_code text;
  v_item private.reconciliation_items%rowtype;
  v_resolution private.reconciliation_review_cases%rowtype;
  v_existing_resolution private.reconciliation_review_cases%rowtype;
  v_existing_event private.reconciliation_review_case_events%rowtype;
  v_event_id uuid;
  v_opened_at timestamptz;
begin
  v_idempotency_key := private.normalize_reconciliation_resolution_idempotency_key(
    p_idempotency_key
  );
  v_reason_code := private.normalize_reconciliation_resolution_reason_code(
    p_reason_code
  );

  if p_actor_profile_id is null
    or not exists (
      select 1
      from public.profiles as profiles
      where profiles.id = p_actor_profile_id
    )
  then
    raise exception 'reconciliation_resolution_actor_not_found'
      using errcode = '23503';
  end if;

  select events.*
    into v_existing_event
  from private.reconciliation_review_case_events as events
  where events.idempotency_key = v_idempotency_key;

  if found then
    select resolutions.*
      into v_existing_resolution
    from private.reconciliation_review_cases as resolutions
    where resolutions.id = v_existing_event.reconciliation_resolution_id;

    if not found then
      raise exception 'reconciliation_resolution_existing_state_invalid'
        using errcode = '23514';
    end if;

    perform private.assert_reconciliation_resolution_integrity(
      v_existing_resolution.id
    );

    if v_existing_event.event_type <> 'OPENED'
      or v_existing_event.event_version <> 1
      or v_existing_event.from_status is not null
      or v_existing_event.to_status <> 'OPEN'
      or v_existing_resolution.reconciliation_item_id <> p_reconciliation_item_id
      or v_existing_event.actor_profile_id <> p_actor_profile_id
      or v_existing_event.reason_code <> v_reason_code
    then
      raise exception 'reconciliation_resolution_idempotency_conflict'
        using errcode = '23505';
    end if;

    return query select
      v_existing_resolution.id,
      false,
      v_existing_event.to_status,
      v_existing_event.event_version,
      v_existing_event.id;
    return;
  end if;

  select items.*
    into v_item
  from private.reconciliation_items as items
  where items.id = p_reconciliation_item_id;

  if not found then
    raise exception 'reconciliation_item_not_found'
      using errcode = '23503';
  end if;

  if v_item.classification not in ('MISMATCH', 'OBSERVATION_FAILED') then
    raise exception 'reconciliation_item_not_reviewable'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from private.reconciliation_review_cases as resolutions
    where resolutions.reconciliation_item_id = p_reconciliation_item_id
  ) then
    raise exception 'reconciliation_resolution_already_exists'
      using errcode = '23514';
  end if;

  v_opened_at := pg_catalog.clock_timestamp();

  insert into private.reconciliation_review_cases (
    reconciliation_item_id,
    status,
    version,
    opened_at,
    updated_at,
    opened_by_profile_id,
    last_actor_profile_id
  )
  values (
    p_reconciliation_item_id,
    'OPEN',
    1,
    v_opened_at,
    v_opened_at,
    p_actor_profile_id,
    p_actor_profile_id
  )
  on conflict (reconciliation_item_id) do nothing
  returning *
    into v_resolution;

  if not found then
    raise exception 'reconciliation_resolution_already_exists'
      using errcode = '23514';
  end if;

  insert into private.reconciliation_review_case_events (
    reconciliation_resolution_id,
    event_version,
    idempotency_key,
    event_type,
    from_status,
    to_status,
    actor_profile_id,
    reason_code,
    created_at
  )
  values (
    v_resolution.id,
    1,
    v_idempotency_key,
    'OPENED',
    null,
    'OPEN',
    p_actor_profile_id,
    v_reason_code,
    v_opened_at
  )
  returning id
    into v_event_id;

  return query select
    v_resolution.id,
    true,
    'OPEN'::text,
    1::bigint,
    v_event_id;
exception
  when unique_violation then
    raise exception 'reconciliation_resolution_idempotency_conflict'
      using errcode = '23505';
end;
$$;

comment on function private.open_reconciliation_resolution(uuid, text, uuid, text) is
  'Private reconciliation review case opener for MISMATCH and OBSERVATION_FAILED items. It creates one current-state case plus one append-only OPENED event atomically, supports exact idempotent replay, and leaves reconciliation run, item, provenance, observation, checkpoint, and ledger rows unchanged. AAL2 ADMIN authorization is deferred to the future command/API boundary.';

revoke execute on function private.open_reconciliation_resolution(uuid, text, uuid, text)
  from public, anon, authenticated;

create or replace function private.transition_reconciliation_resolution(
  p_reconciliation_resolution_id uuid,
  p_expected_version bigint,
  p_target_status text,
  p_idempotency_key text,
  p_actor_profile_id uuid,
  p_reason_code text
)
returns table (
  reconciliation_resolution_id uuid,
  event_id uuid,
  created boolean,
  status text,
  version bigint
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_idempotency_key text;
  v_reason_code text;
  v_target_status text;
  v_event_type text;
  v_resolution private.reconciliation_review_cases%rowtype;
  v_existing_event private.reconciliation_review_case_events%rowtype;
  v_event_id uuid;
  v_next_version bigint;
  v_transitioned_at timestamptz;
begin
  v_idempotency_key := private.normalize_reconciliation_resolution_idempotency_key(
    p_idempotency_key
  );
  v_reason_code := private.normalize_reconciliation_resolution_reason_code(
    p_reason_code
  );
  v_target_status := pg_catalog.btrim(p_target_status);

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'reconciliation_resolution_expected_version_invalid'
      using errcode = '22023';
  end if;

  if v_target_status is null
    or v_target_status not in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED')
  then
    raise exception 'reconciliation_resolution_status_invalid'
      using errcode = '22023';
  end if;

  if p_actor_profile_id is null
    or not exists (
      select 1
      from public.profiles as profiles
      where profiles.id = p_actor_profile_id
    )
  then
    raise exception 'reconciliation_resolution_actor_not_found'
      using errcode = '23503';
  end if;

  select events.*
    into v_existing_event
  from private.reconciliation_review_case_events as events
  where events.idempotency_key = v_idempotency_key;

  if found then
    if v_existing_event.reconciliation_resolution_id <> p_reconciliation_resolution_id
      or v_existing_event.event_version <> p_expected_version + 1
      or v_existing_event.to_status <> v_target_status
      or v_existing_event.actor_profile_id <> p_actor_profile_id
      or v_existing_event.reason_code <> v_reason_code
      or v_existing_event.event_type = 'OPENED'
    then
      raise exception 'reconciliation_resolution_idempotency_conflict'
        using errcode = '23505';
    end if;

    perform private.assert_reconciliation_resolution_integrity(
      p_reconciliation_resolution_id
    );

    return query select
      v_existing_event.reconciliation_resolution_id,
      v_existing_event.id,
      false,
      v_existing_event.to_status,
      v_existing_event.event_version;
    return;
  end if;

  select resolutions.*
    into v_resolution
  from private.reconciliation_review_cases as resolutions
  where resolutions.id = p_reconciliation_resolution_id
  for update;

  if not found then
    raise exception 'reconciliation_resolution_not_found'
      using errcode = '23503';
  end if;

  perform private.assert_reconciliation_resolution_integrity(
    v_resolution.id
  );

  if v_resolution.status in ('RESOLVED', 'IGNORED') then
    raise exception 'reconciliation_resolution_terminal'
      using errcode = '23514';
  end if;

  if v_resolution.version <> p_expected_version then
    raise exception 'reconciliation_resolution_version_conflict'
      using errcode = '40001';
  end if;

  if not (
    (
      v_resolution.status = 'OPEN'
      and v_target_status in ('IN_REVIEW', 'RESOLVED', 'IGNORED')
    )
    or (
      v_resolution.status = 'IN_REVIEW'
      and v_target_status in ('RESOLVED', 'IGNORED')
    )
  ) then
    raise exception 'reconciliation_resolution_transition_invalid'
      using errcode = '23514';
  end if;

  v_event_type := case v_target_status
    when 'IN_REVIEW' then 'REVIEW_STARTED'
    when 'RESOLVED' then 'RESOLVED'
    when 'IGNORED' then 'IGNORED'
    else null
  end;

  v_next_version := v_resolution.version + 1;
  v_transitioned_at := pg_catalog.clock_timestamp();

  update private.reconciliation_review_cases
  set
    status = v_target_status,
    version = v_next_version,
    updated_at = v_transitioned_at,
    resolved_at = case
      when v_target_status in ('RESOLVED', 'IGNORED') then v_transitioned_at
      else null
    end,
    last_actor_profile_id = p_actor_profile_id
  where id = v_resolution.id
    and private.reconciliation_review_cases.version = p_expected_version;

  if not found then
    raise exception 'reconciliation_resolution_version_conflict'
      using errcode = '40001';
  end if;

  insert into private.reconciliation_review_case_events (
    reconciliation_resolution_id,
    event_version,
    idempotency_key,
    event_type,
    from_status,
    to_status,
    actor_profile_id,
    reason_code,
    created_at
  )
  values (
    v_resolution.id,
    v_next_version,
    v_idempotency_key,
    v_event_type,
    v_resolution.status,
    v_target_status,
    p_actor_profile_id,
    v_reason_code,
    v_transitioned_at
  )
  returning id
    into v_event_id;

  return query select
    v_resolution.id,
    v_event_id,
    true,
    v_target_status,
    v_next_version;
exception
  when unique_violation then
    raise exception 'reconciliation_resolution_idempotency_conflict'
      using errcode = '23505';
end;
$$;

comment on function private.transition_reconciliation_resolution(uuid, bigint, text, text, uuid, text) is
  'Private reconciliation review status transition writer with expected-version concurrency, exact idempotent replay, terminal state protection, and append-only event history. It updates only the current-state review case table and appends review case events; financial resolution posting, AAL2 ADMIN authorization, reopen workflow, notifications, and public RPC are deferred.';

revoke execute on function private.transition_reconciliation_resolution(uuid, bigint, text, text, uuid, text)
  from public, anon, authenticated;
