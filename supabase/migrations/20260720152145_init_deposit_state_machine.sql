create table private.deposit_requests (
  id uuid primary key default gen_random_uuid(),

  wallet_account_id uuid not null
    references public.wallet_accounts (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  requested_units private.positive_atomic_units not null,

  status text not null default 'REQUESTED',

  request_journal_id uuid not null unique
    references private.ledger_journals (id) on delete restrict,

  confirmation_journal_id uuid null unique
    references private.ledger_journals (id) on delete restrict,

  cancellation_journal_id uuid null unique
    references private.ledger_journals (id) on delete restrict,

  confirmed_by uuid null
    references public.profiles (id) on delete restrict,

  canceled_by uuid null
    references public.profiles (id) on delete restrict,

  cancellation_actor_type text null,

  requested_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz null,
  canceled_at timestamptz null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint deposit_requests_status_check
    check (status in ('REQUESTED', 'CONFIRMED', 'CANCELED')),

  constraint deposit_requests_cancellation_actor_type_check
    check (
      cancellation_actor_type is null
      or cancellation_actor_type in ('USER', 'ADMIN')
    ),

  constraint deposit_requests_version_check
    check (version >= 1),

  constraint deposit_requests_time_check
    check (
      (confirmed_at is null or confirmed_at >= requested_at)
      and (canceled_at is null or canceled_at >= requested_at)
    ),

  constraint deposit_requests_status_shape_check
    check (
      (
        status = 'REQUESTED'
        and request_journal_id is not null
        and confirmation_journal_id is null
        and cancellation_journal_id is null
        and confirmed_by is null
        and canceled_by is null
        and confirmed_at is null
        and canceled_at is null
        and cancellation_actor_type is null
      )
      or (
        status = 'CONFIRMED'
        and request_journal_id is not null
        and confirmation_journal_id is not null
        and cancellation_journal_id is null
        and confirmed_by is not null
        and canceled_by is null
        and confirmed_at is not null
        and canceled_at is null
        and cancellation_actor_type is null
      )
      or (
        status = 'CANCELED'
        and request_journal_id is not null
        and confirmation_journal_id is null
        and cancellation_journal_id is not null
        and confirmed_by is null
        and canceled_by is not null
        and confirmed_at is null
        and canceled_at is not null
        and cancellation_actor_type is not null
      )
    )
);

comment on table private.deposit_requests is
  'Private local manual deposit request state machine. REQUESTED, CONFIRMED, and CANCELED states are backed by immutable double-entry journals; no blockchain address, transaction ID, webhook, service-role client, or production path is stored.';

create index deposit_requests_wallet_requested_idx
  on private.deposit_requests (wallet_account_id, requested_at desc, id desc);

create index deposit_requests_asset_requested_idx
  on private.deposit_requests (asset_id, requested_at desc, id desc);

create index deposit_requests_status_requested_idx
  on private.deposit_requests (status, requested_at desc, id desc);

create index deposit_requests_confirmed_by_idx
  on private.deposit_requests (confirmed_by, confirmed_at desc)
  where confirmed_by is not null;

create index deposit_requests_canceled_by_idx
  on private.deposit_requests (canceled_by, canceled_at desc)
  where canceled_by is not null;

create trigger touch_deposit_requests_version
  before update on private.deposit_requests
  for each row
  execute function private.touch_versioned_record();

create table private.deposit_command_audit_events (
  id uuid primary key default gen_random_uuid(),

  command_id uuid not null unique,

  action text not null,
  outcome text not null,

  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,

  actor_type text not null,

  target_user_id uuid not null
    references public.profiles (id) on delete restrict,

  wallet_account_id uuid not null
    references public.wallet_accounts (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  deposit_request_id uuid not null
    references private.deposit_requests (id) on delete restrict,

  resulting_journal_id uuid not null
    references private.ledger_journals (id) on delete restrict,

  reason text not null,
  request_data jsonb not null,

  previous_status text null,
  resulting_status text not null,

  units private.positive_atomic_units not null,

  occurred_at timestamptz not null default clock_timestamp(),

  constraint deposit_command_audit_events_action_check
    check (action in (
      'CREATE_DEPOSIT_REQUEST',
      'CONFIRM_DEPOSIT_REQUEST',
      'CANCEL_DEPOSIT_REQUEST'
    )),

  constraint deposit_command_audit_events_actor_type_check
    check (actor_type in ('USER', 'ADMIN')),

  constraint deposit_command_audit_events_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),

  constraint deposit_command_audit_events_status_check
    check (
      (previous_status is null or previous_status in ('REQUESTED', 'CONFIRMED', 'CANCELED'))
      and resulting_status in ('REQUESTED', 'CONFIRMED', 'CANCELED')
    ),

  constraint deposit_command_audit_events_shape_check
    check (
      (
        action = 'CREATE_DEPOSIT_REQUEST'
        and actor_type = 'USER'
        and outcome = 'APPLIED'
        and previous_status is null
        and resulting_status = 'REQUESTED'
      )
      or (
        action = 'CONFIRM_DEPOSIT_REQUEST'
        and actor_type = 'ADMIN'
        and (
          (
            outcome = 'APPLIED'
            and previous_status = 'REQUESTED'
            and resulting_status = 'CONFIRMED'
          )
          or (
            outcome = 'NOOP'
            and previous_status = 'CONFIRMED'
            and resulting_status = 'CONFIRMED'
          )
        )
      )
      or (
        action = 'CANCEL_DEPOSIT_REQUEST'
        and actor_type in ('USER', 'ADMIN')
        and (
          (
            outcome = 'APPLIED'
            and previous_status = 'REQUESTED'
            and resulting_status = 'CANCELED'
          )
          or (
            outcome = 'NOOP'
            and previous_status = 'CANCELED'
            and resulting_status = 'CANCELED'
          )
        )
      )
    ),

  constraint deposit_command_audit_events_reason_check
    check (
      reason = pg_catalog.btrim(reason)
      and pg_catalog.char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
      and reason !~* '(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret|transaction[_ ]?id|signature|blockchain[_ ]?address|wallet[_ ]?address)'
    ),

  constraint deposit_command_audit_events_request_data_check
    check (
      jsonb_typeof(request_data) = 'object'
      and request_data::text !~* '(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret|transaction[_ ]?id|signature|blockchain[_ ]?address|wallet[_ ]?address|request[_ ]?header)'
    )
);

comment on table private.deposit_command_audit_events is
  'Append-only local manual deposit command audit. It records APPLIED and NOOP state-machine outcomes without request headers, credentials, blockchain identifiers, transaction IDs, or service-role data.';

create index deposit_command_audit_events_occurred_at_idx
  on private.deposit_command_audit_events (occurred_at desc, id desc);

create index deposit_command_audit_events_actor_idx
  on private.deposit_command_audit_events (actor_user_id, occurred_at desc);

create index deposit_command_audit_events_target_user_idx
  on private.deposit_command_audit_events (target_user_id, occurred_at desc);

create index deposit_command_audit_events_wallet_idx
  on private.deposit_command_audit_events (wallet_account_id, occurred_at desc);

create index deposit_command_audit_events_asset_idx
  on private.deposit_command_audit_events (asset_id, occurred_at desc);

create index deposit_command_audit_events_request_idx
  on private.deposit_command_audit_events (deposit_request_id, occurred_at desc);

create unique index deposit_command_audit_applied_journal_uidx
  on private.deposit_command_audit_events (resulting_journal_id)
  where outcome = 'APPLIED';

revoke all privileges on table private.deposit_requests
  from public, anon, authenticated;

revoke all privileges on table private.deposit_command_audit_events
  from public, anon, authenticated;

create or replace function private.prevent_deposit_command_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'DEPOSIT_COMMAND_AUDIT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_deposit_command_audit_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE for immutable deposit command audit rows without exposing request IDs, units, reasons, or actor details.';

revoke execute on function private.prevent_deposit_command_audit_mutation()
  from public, anon, authenticated;

create trigger protect_deposit_command_audit_events
  before update or delete or truncate
  on private.deposit_command_audit_events
  for each statement
  execute function private.prevent_deposit_command_audit_mutation();

create or replace function private.deposit_lock()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:deposit-command:v1',
      0
    )
  );
end;
$$;

create or replace function private.deposit_require_active_user()
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

  if v_user_id is null then
    raise exception 'DEPOSIT_USER_REQUIRED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles as profiles
    where profiles.id = v_user_id
      and profiles.account_status = 'ACTIVE'
  ) then
    raise exception 'DEPOSIT_ACTIVE_USER_REQUIRED'
      using errcode = '42501';
  end if;

  return v_user_id;
end;
$$;

create or replace function private.deposit_require_admin_aal2()
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
    raise exception 'DEPOSIT_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

create or replace function private.deposit_normalize_reason(
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
    or v_reason ~* '(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret|transaction[_ ]?id|signature|blockchain[_ ]?address|wallet[_ ]?address)'
  then
    return null;
  end if;

  return v_reason;
end;
$$;

create or replace function private.deposit_validate_units_text(
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

revoke execute on function private.deposit_lock()
  from public, anon, authenticated;

revoke execute on function private.deposit_require_active_user()
  from public, anon, authenticated;

revoke execute on function private.deposit_require_admin_aal2()
  from public, anon, authenticated;

revoke execute on function private.deposit_normalize_reason(text)
  from public, anon, authenticated;

revoke execute on function private.deposit_validate_units_text(text)
  from public, anon, authenticated;

create or replace function private.validate_deposit_request_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.wallet_account_id is distinct from old.wallet_account_id
    or new.asset_id is distinct from old.asset_id
    or new.requested_units is distinct from old.requested_units
    or new.request_journal_id is distinct from old.request_journal_id
    or new.requested_at is distinct from old.requested_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'DEPOSIT_REQUEST_TRANSITION_INVALID'
      using errcode = '23514';
  end if;

  if old.status <> 'REQUESTED' then
    raise exception 'DEPOSIT_REQUEST_TERMINAL'
      using errcode = '23514';
  end if;

  if new.status not in ('CONFIRMED', 'CANCELED') then
    raise exception 'DEPOSIT_REQUEST_TRANSITION_INVALID'
      using errcode = '23514';
  end if;

  if new.status = 'CONFIRMED' then
    if old.confirmation_journal_id is not null
      or old.cancellation_journal_id is not null
      or old.confirmed_by is not null
      or old.canceled_by is not null
      or old.confirmed_at is not null
      or old.canceled_at is not null
      or old.cancellation_actor_type is not null
      or new.confirmation_journal_id is null
      or new.confirmed_by is null
      or new.confirmed_at is null
      or new.cancellation_journal_id is not null
      or new.canceled_by is not null
      or new.canceled_at is not null
      or new.cancellation_actor_type is not null
    then
      raise exception 'DEPOSIT_REQUEST_TRANSITION_INVALID'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'CANCELED' then
    if old.confirmation_journal_id is not null
      or old.cancellation_journal_id is not null
      or old.confirmed_by is not null
      or old.canceled_by is not null
      or old.confirmed_at is not null
      or old.canceled_at is not null
      or old.cancellation_actor_type is not null
      or new.cancellation_journal_id is null
      or new.canceled_by is null
      or new.canceled_at is null
      or new.cancellation_actor_type not in ('USER', 'ADMIN')
      or new.confirmation_journal_id is not null
      or new.confirmed_by is not null
      or new.confirmed_at is not null
    then
      raise exception 'DEPOSIT_REQUEST_TRANSITION_INVALID'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.validate_deposit_request_transition() is
  'Protects deposit request state transitions. REQUESTED may become CONFIRMED or CANCELED exactly once; terminal rows and core financial fields cannot be rewritten.';

revoke execute on function private.validate_deposit_request_transition()
  from public, anon, authenticated;

create trigger validate_deposit_request_transition
  before update on private.deposit_requests
  for each row
  execute function private.validate_deposit_request_transition();

create or replace function private.deposit_journal_shape_matches(
  p_journal_id uuid,
  p_deposit_request_id uuid,
  p_wallet_account_id uuid,
  p_asset_id uuid,
  p_units private.positive_atomic_units,
  p_journal_type text,
  p_initiator_type text,
  p_initiator_user_id uuid,
  p_expected_lines jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expected_count integer;
  v_actual_count integer;
begin
  if p_journal_id is null
    or p_deposit_request_id is null
    or p_wallet_account_id is null
    or p_asset_id is null
    or p_units is null
    or p_journal_type is null
    or p_initiator_type is null
    or p_initiator_user_id is null
    or p_expected_lines is null
    or jsonb_typeof(p_expected_lines) <> 'array'
  then
    return false;
  end if;

  v_expected_count := jsonb_array_length(p_expected_lines);

  if v_expected_count < 2 then
    return false;
  end if;

  if not exists (
    select 1
    from private.ledger_journals as journals
    where journals.id = p_journal_id
      and journals.asset_id = p_asset_id
      and journals.journal_type = p_journal_type
      and journals.initiator_type = p_initiator_type
      and journals.initiator_user_id = p_initiator_user_id
      and journals.reference_type = 'DEPOSIT_REQUEST'
      and journals.reference_id = p_deposit_request_id
  ) then
    return false;
  end if;

  select count(*)::integer
    into v_actual_count
  from private.ledger_entries as entries
  where entries.journal_id = p_journal_id;

  if v_actual_count <> v_expected_count then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_expected_lines) as expected(
      side text,
      account_scope text,
      account_purpose text
    )
    where not exists (
      select 1
      from private.ledger_entries as entries
      join private.ledger_accounts as accounts
        on accounts.id = entries.ledger_account_id
      where entries.journal_id = p_journal_id
        and entries.side = expected.side
        and entries.units = p_units
        and accounts.asset_id = p_asset_id
        and accounts.account_scope = expected.account_scope
        and accounts.account_purpose = expected.account_purpose
        and (
          (
            expected.account_scope = 'USER'
            and accounts.wallet_account_id = p_wallet_account_id
          )
          or (
            expected.account_scope = 'SYSTEM'
            and accounts.wallet_account_id is null
          )
        )
    )
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke execute on function private.deposit_journal_shape_matches(uuid, uuid, uuid, uuid, private.positive_atomic_units, text, text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function private.validate_deposit_request_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet public.wallet_accounts%rowtype;
  v_request_lines jsonb;
  v_confirm_lines jsonb;
  v_cancel_lines jsonb;
  v_cancel_journal_type text;
begin
  select wallet_accounts.*
    into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = new.wallet_account_id;

  if not found or v_wallet.user_id is null then
    raise exception 'DEPOSIT_REQUEST_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  v_request_lines := jsonb_build_array(
    jsonb_build_object(
      'side', 'DEBIT',
      'account_scope', 'SYSTEM',
      'account_purpose', 'SYSTEM_DEPOSIT_CLEARING'
    ),
    jsonb_build_object(
      'side', 'CREDIT',
      'account_scope', 'USER',
      'account_purpose', 'USER_PENDING_DEPOSIT'
    )
  );

  if not private.deposit_journal_shape_matches(
    new.request_journal_id,
    new.id,
    new.wallet_account_id,
    new.asset_id,
    new.requested_units,
    'USER_DEPOSIT_REQUESTED',
    'USER',
    v_wallet.user_id,
    v_request_lines
  ) then
    raise exception 'DEPOSIT_REQUEST_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if new.status = 'CONFIRMED' then
    v_confirm_lines := jsonb_build_array(
      jsonb_build_object(
        'side', 'DEBIT',
        'account_scope', 'SYSTEM',
        'account_purpose', 'SYSTEM_CUSTODY'
      ),
      jsonb_build_object(
        'side', 'CREDIT',
        'account_scope', 'SYSTEM',
        'account_purpose', 'SYSTEM_DEPOSIT_CLEARING'
      ),
      jsonb_build_object(
        'side', 'DEBIT',
        'account_scope', 'USER',
        'account_purpose', 'USER_PENDING_DEPOSIT'
      ),
      jsonb_build_object(
        'side', 'CREDIT',
        'account_scope', 'USER',
        'account_purpose', 'USER_AVAILABLE'
      )
    );

    if not private.deposit_journal_shape_matches(
      new.confirmation_journal_id,
      new.id,
      new.wallet_account_id,
      new.asset_id,
      new.requested_units,
      'ADMIN_DEPOSIT_CONFIRMED',
      'ADMIN',
      new.confirmed_by,
      v_confirm_lines
    ) then
      raise exception 'DEPOSIT_REQUEST_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'CANCELED' then
    v_cancel_journal_type := case new.cancellation_actor_type
      when 'USER' then 'USER_DEPOSIT_CANCELED'
      when 'ADMIN' then 'ADMIN_DEPOSIT_CANCELED'
      else null
    end;
    v_cancel_lines := jsonb_build_array(
      jsonb_build_object(
        'side', 'DEBIT',
        'account_scope', 'USER',
        'account_purpose', 'USER_PENDING_DEPOSIT'
      ),
      jsonb_build_object(
        'side', 'CREDIT',
        'account_scope', 'SYSTEM',
        'account_purpose', 'SYSTEM_DEPOSIT_CLEARING'
      )
    );

    if not private.deposit_journal_shape_matches(
      new.cancellation_journal_id,
      new.id,
      new.wallet_account_id,
      new.asset_id,
      new.requested_units,
      v_cancel_journal_type,
      new.cancellation_actor_type,
      new.canceled_by,
      v_cancel_lines
    ) then
      raise exception 'DEPOSIT_REQUEST_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.validate_deposit_request_invariants() is
  'Deferred invariant validator ensuring each deposit request state references exact immutable ledger journals and entries for request, confirmation, and cancellation postings.';

revoke execute on function private.validate_deposit_request_invariants()
  from public, anon, authenticated;

create constraint trigger validate_deposit_request_invariants
  after insert or update on private.deposit_requests
  deferrable initially deferred
  for each row
  execute function private.validate_deposit_request_invariants();

create or replace function public.create_user_funding_request(
  p_wallet_account_id uuid,
  p_wallet_expected_version bigint,
  p_asset_id uuid,
  p_asset_expected_version bigint,
  p_units text,
  p_command_id uuid
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  deposit_request_id uuid,
  journal_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  units text,
  status text,
  request_version bigint,
  occurred_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_reason text := 'USER_DEPOSIT_REQUEST';
  v_units_text text;
  v_units numeric;
  v_request_data jsonb;
  v_existing_event private.deposit_command_audit_events%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_asset public.supported_assets%rowtype;
  v_request_id uuid;
  v_request_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
  v_user_pending_account_id uuid;
  v_system_clearing_account_id uuid;
begin
  v_actor_user_id := private.deposit_require_active_user();
  v_units_text := private.deposit_validate_units_text(p_units);

  if p_wallet_account_id is null
    or p_wallet_expected_version is null
    or p_wallet_expected_version < 1
    or p_asset_id is null
    or p_asset_expected_version is null
    or p_asset_expected_version < 1
    or p_command_id is null
    or v_units_text is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  v_units := v_units_text::numeric;
  v_request_data := jsonb_build_object(
    'action', 'CREATE_DEPOSIT_REQUEST',
    'actor_type', 'USER',
    'wallet_account_id', p_wallet_account_id::text,
    'wallet_expected_version', p_wallet_expected_version,
    'asset_id', p_asset_id::text,
    'asset_expected_version', p_asset_expected_version,
    'units', v_units_text
  );

  perform private.deposit_lock();

  select events.* into v_existing_event
  from private.deposit_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'USER'
      and v_existing_event.action = 'CREATE_DEPOSIT_REQUEST'
      and v_existing_event.wallet_account_id = p_wallet_account_id
      and v_existing_event.asset_id = p_asset_id
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          v_existing_event.id,
          v_existing_event.command_id,
          requests.id,
          v_existing_event.resulting_journal_id,
          requests.wallet_account_id,
          requests.asset_id,
          requests.requested_units::text,
          requests.status,
          requests.version,
          v_existing_event.occurred_at
        from private.deposit_requests as requests
        where requests.id = v_existing_event.deposit_request_id;
      return;
    end if;

    return query select 'DEPOSIT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'DEPOSIT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = p_wallet_account_id
  for update;

  if not found or v_wallet.user_id <> v_actor_user_id then
    return query select 'DEPOSIT_WALLET_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_wallet.version <> p_wallet_expected_version then
    return query select 'DEPOSIT_WALLET_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, v_wallet.id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_wallet.status <> 'ACTIVE' then
    return query select 'DEPOSIT_WALLET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, v_wallet.id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select assets.* into v_asset
  from public.supported_assets as assets
  where assets.id = p_asset_id
  for update;

  if not found then
    return query select 'DEPOSIT_ASSET_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, v_wallet.id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_asset.version <> p_asset_expected_version then
    return query select 'DEPOSIT_ASSET_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, v_wallet.id, v_asset.id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_asset.status <> 'ACTIVE'
    or v_asset.network <> 'SOLANA'
    or v_asset.asset_type not in ('NATIVE', 'SPL_TOKEN')
  then
    return query select 'DEPOSIT_ASSET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, v_wallet.id, v_asset.id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select accounts.ledger_account_id
    into v_user_pending_account_id
  from private.ensure_wallet_asset_ledger_accounts(v_wallet.id, v_asset.id) as accounts
  where accounts.account_purpose = 'USER_PENDING_DEPOSIT';

  select accounts.ledger_account_id
    into v_system_clearing_account_id
  from private.ensure_system_ledger_accounts(v_asset.id) as accounts
  where accounts.account_purpose = 'SYSTEM_DEPOSIT_CLEARING';

  v_request_id := gen_random_uuid();

  select posted.journal_id, posted.posted_at
    into v_request_journal_id, v_posted_at
  from private.post_ledger_journal(
    p_command_id,
    v_asset.id,
    'USER_DEPOSIT_REQUESTED',
    'USER',
    v_actor_user_id,
    'DEPOSIT_REQUEST',
    v_request_id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_system_clearing_account_id::text,
        'side', 'DEBIT',
        'units', v_units_text
      ),
      jsonb_build_object(
        'account_id', v_user_pending_account_id::text,
        'side', 'CREDIT',
        'units', v_units_text
      )
    )
  ) as posted;

  insert into private.deposit_requests (
    id,
    wallet_account_id,
    asset_id,
    requested_units,
    request_journal_id
  )
  values (
    v_request_id,
    v_wallet.id,
    v_asset.id,
    v_units::private.positive_atomic_units,
    v_request_journal_id
  );

  insert into private.deposit_command_audit_events as inserted_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    actor_type,
    target_user_id,
    wallet_account_id,
    asset_id,
    deposit_request_id,
    resulting_journal_id,
    reason,
    request_data,
    previous_status,
    resulting_status,
    units
  )
  values (
    p_command_id,
    'CREATE_DEPOSIT_REQUEST',
    'APPLIED',
    v_actor_user_id,
    'USER',
    v_actor_user_id,
    v_wallet.id,
    v_asset.id,
    v_request_id,
    v_request_journal_id,
    v_reason,
    v_request_data,
    null,
    'REQUESTED',
    v_units::private.positive_atomic_units
  )
  returning inserted_events.id into v_event_id;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request_id, v_request_journal_id, v_wallet.id, v_asset.id, v_units_text, 'REQUESTED'::text, 1::bigint, v_posted_at;
end;
$$;

comment on function public.create_user_funding_request(uuid, bigint, uuid, bigint, text, uuid) is
  'Authenticated ACTIVE user command to create a local manual deposit request. It posts DEBIT SYSTEM_DEPOSIT_CLEARING and CREDIT USER_PENDING_DEPOSIT in the same transaction and stores no blockchain address, transaction ID, service-role data, or production connectivity.';

create or replace function public.cancel_current_user_funding_request(
  p_deposit_request_id uuid,
  p_request_expected_version bigint,
  p_command_id uuid
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  deposit_request_id uuid,
  journal_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  units text,
  status text,
  request_version bigint,
  occurred_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_reason text := 'USER_DEPOSIT_CANCEL';
  v_request_data jsonb;
  v_existing_event private.deposit_command_audit_events%rowtype;
  v_request private.deposit_requests%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_user_pending_account_id uuid;
  v_system_clearing_account_id uuid;
  v_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
begin
  v_actor_user_id := private.deposit_require_active_user();

  if p_deposit_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_command_id is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'CANCEL_DEPOSIT_REQUEST',
    'actor_type', 'USER',
    'deposit_request_id', p_deposit_request_id::text,
    'request_expected_version', p_request_expected_version
  );

  perform private.deposit_lock();

  select events.* into v_existing_event
  from private.deposit_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'USER'
      and v_existing_event.action = 'CANCEL_DEPOSIT_REQUEST'
      and v_existing_event.deposit_request_id = p_deposit_request_id
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          v_existing_event.id,
          v_existing_event.command_id,
          requests.id,
          v_existing_event.resulting_journal_id,
          requests.wallet_account_id,
          requests.asset_id,
          requests.requested_units::text,
          requests.status,
          requests.version,
          v_existing_event.occurred_at
        from private.deposit_requests as requests
        where requests.id = v_existing_event.deposit_request_id;
      return;
    end if;

    return query select 'DEPOSIT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'DEPOSIT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.deposit_requests as requests
  where requests.id = p_deposit_request_id
  for update;

  if not found then
    return query select 'DEPOSIT_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_request.wallet_account_id
  for update;

  if not found or v_wallet.user_id <> v_actor_user_id then
    return query select 'DEPOSIT_REQUEST_FORBIDDEN'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.version <> p_request_expected_version then
    return query select 'DEPOSIT_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.status = 'CANCELED' then
    insert into private.deposit_command_audit_events as inserted_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      actor_type,
      target_user_id,
      wallet_account_id,
      asset_id,
      deposit_request_id,
      resulting_journal_id,
      reason,
      request_data,
      previous_status,
      resulting_status,
      units
    )
    values (
      p_command_id,
      'CANCEL_DEPOSIT_REQUEST',
      'NOOP',
      v_actor_user_id,
      'USER',
      v_wallet.user_id,
      v_request.wallet_account_id,
      v_request.asset_id,
      v_request.id,
      v_request.cancellation_journal_id,
      v_reason,
      v_request_data,
      'CANCELED',
      'CANCELED',
      v_request.requested_units
    )
    returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_posted_at;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, v_request.id, v_request.cancellation_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
    return;
  end if;

  if v_request.status <> 'REQUESTED' then
    return query select 'DEPOSIT_REQUEST_CONFIRMED'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select accounts.id into v_user_pending_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = v_request.wallet_account_id
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose = 'USER_PENDING_DEPOSIT';

  select accounts.id into v_system_clearing_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'SYSTEM'
    and accounts.wallet_account_id is null
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose = 'SYSTEM_DEPOSIT_CLEARING';

  if v_user_pending_account_id is null or v_system_clearing_account_id is null then
    return query select 'DEPOSIT_LEDGER_UNAVAILABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_journal_id, v_posted_at
  from private.post_ledger_journal(
    p_command_id,
    v_request.asset_id,
    'USER_DEPOSIT_CANCELED',
    'USER',
    v_actor_user_id,
    'DEPOSIT_REQUEST',
    v_request.id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_user_pending_account_id::text,
        'side', 'DEBIT',
        'units', v_request.requested_units::text
      ),
      jsonb_build_object(
        'account_id', v_system_clearing_account_id::text,
        'side', 'CREDIT',
        'units', v_request.requested_units::text
      )
    )
  ) as posted;

  update private.deposit_requests as requests
  set
    status = 'CANCELED',
    cancellation_journal_id = v_journal_id,
    canceled_by = v_actor_user_id,
    canceled_at = clock_timestamp(),
    cancellation_actor_type = 'USER'
  where requests.id = v_request.id
  returning requests.* into v_request;

  insert into private.deposit_command_audit_events as inserted_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    actor_type,
    target_user_id,
    wallet_account_id,
    asset_id,
    deposit_request_id,
    resulting_journal_id,
    reason,
    request_data,
    previous_status,
    resulting_status,
    units
  )
  values (
    p_command_id,
    'CANCEL_DEPOSIT_REQUEST',
    'APPLIED',
    v_actor_user_id,
    'USER',
    v_wallet.user_id,
    v_request.wallet_account_id,
    v_request.asset_id,
    v_request.id,
    v_journal_id,
    v_reason,
    v_request_data,
    'REQUESTED',
    'CANCELED',
    v_request.requested_units
  )
  returning inserted_events.id into v_event_id;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, v_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
end;
$$;

comment on function public.cancel_current_user_funding_request(uuid, bigint, uuid) is
  'Authenticated ACTIVE user command to cancel the caller-owned REQUESTED deposit request. Cancellation exactly reverses pending deposit and clearing buckets and remains local-only with no transaction ID or blockchain path.';

create or replace function public.confirm_user_funding_request(
  p_deposit_request_id uuid,
  p_request_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  deposit_request_id uuid,
  journal_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  units text,
  status text,
  request_version bigint,
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
  v_existing_event private.deposit_command_audit_events%rowtype;
  v_request private.deposit_requests%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_profile_status text;
  v_asset public.supported_assets%rowtype;
  v_user_pending_account_id uuid;
  v_user_available_account_id uuid;
  v_system_clearing_account_id uuid;
  v_system_custody_account_id uuid;
  v_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
begin
  v_actor_user_id := private.deposit_require_admin_aal2();
  v_reason := private.deposit_normalize_reason(p_reason);

  if p_deposit_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'CONFIRM_DEPOSIT_REQUEST',
    'actor_type', 'ADMIN',
    'deposit_request_id', p_deposit_request_id::text,
    'request_expected_version', p_request_expected_version,
    'reason', v_reason
  );

  perform private.deposit_lock();

  select events.* into v_existing_event
  from private.deposit_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'ADMIN'
      and v_existing_event.action = 'CONFIRM_DEPOSIT_REQUEST'
      and v_existing_event.deposit_request_id = p_deposit_request_id
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          v_existing_event.id,
          v_existing_event.command_id,
          requests.id,
          v_existing_event.resulting_journal_id,
          requests.wallet_account_id,
          requests.asset_id,
          requests.requested_units::text,
          requests.status,
          requests.version,
          v_existing_event.occurred_at
        from private.deposit_requests as requests
        where requests.id = v_existing_event.deposit_request_id;
      return;
    end if;

    return query select 'DEPOSIT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'DEPOSIT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.deposit_requests as requests
  where requests.id = p_deposit_request_id
  for update;

  if not found then
    return query select 'DEPOSIT_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_request.wallet_account_id
  for update;

  select profiles.account_status into v_profile_status
  from public.profiles as profiles
  where profiles.id = v_wallet.user_id
  for update;

  select assets.* into v_asset
  from public.supported_assets as assets
  where assets.id = v_request.asset_id
  for update;

  if v_request.version <> p_request_expected_version then
    return query select 'DEPOSIT_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.status = 'CONFIRMED' then
    insert into private.deposit_command_audit_events as inserted_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      actor_type,
      target_user_id,
      wallet_account_id,
      asset_id,
      deposit_request_id,
      resulting_journal_id,
      reason,
      request_data,
      previous_status,
      resulting_status,
      units
    )
    values (
      p_command_id,
      'CONFIRM_DEPOSIT_REQUEST',
      'NOOP',
      v_actor_user_id,
      'ADMIN',
      v_wallet.user_id,
      v_request.wallet_account_id,
      v_request.asset_id,
      v_request.id,
      v_request.confirmation_journal_id,
      v_reason,
      v_request_data,
      'CONFIRMED',
      'CONFIRMED',
      v_request.requested_units
    )
    returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_posted_at;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, v_request.id, v_request.confirmation_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
    return;
  end if;

  if v_request.status <> 'REQUESTED' then
    return query select 'DEPOSIT_REQUEST_CANCELED'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_profile_status <> 'ACTIVE' then
    return query select 'DEPOSIT_TARGET_PROFILE_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_wallet.status <> 'ACTIVE' then
    return query select 'DEPOSIT_TARGET_WALLET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_asset.status <> 'ACTIVE'
    or v_asset.network <> 'SOLANA'
    or v_asset.asset_type not in ('NATIVE', 'SPL_TOKEN')
  then
    return query select 'DEPOSIT_TARGET_ASSET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_PENDING_DEPOSIT'))::uuid,
         (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid
    into v_user_pending_account_id, v_user_available_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = v_request.wallet_account_id
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose in ('USER_PENDING_DEPOSIT', 'USER_AVAILABLE');

  select (max(accounts.id::text) filter (where accounts.account_purpose = 'SYSTEM_DEPOSIT_CLEARING'))::uuid,
         (max(accounts.id::text) filter (where accounts.account_purpose = 'SYSTEM_CUSTODY'))::uuid
    into v_system_clearing_account_id, v_system_custody_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'SYSTEM'
    and accounts.wallet_account_id is null
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose in ('SYSTEM_DEPOSIT_CLEARING', 'SYSTEM_CUSTODY');

  if v_user_pending_account_id is null
    or v_user_available_account_id is null
    or v_system_clearing_account_id is null
    or v_system_custody_account_id is null
  then
    return query select 'DEPOSIT_LEDGER_UNAVAILABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_journal_id, v_posted_at
  from private.post_ledger_journal(
    p_command_id,
    v_request.asset_id,
    'ADMIN_DEPOSIT_CONFIRMED',
    'ADMIN',
    v_actor_user_id,
    'DEPOSIT_REQUEST',
    v_request.id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_system_custody_account_id::text,
        'side', 'DEBIT',
        'units', v_request.requested_units::text
      ),
      jsonb_build_object(
        'account_id', v_system_clearing_account_id::text,
        'side', 'CREDIT',
        'units', v_request.requested_units::text
      ),
      jsonb_build_object(
        'account_id', v_user_pending_account_id::text,
        'side', 'DEBIT',
        'units', v_request.requested_units::text
      ),
      jsonb_build_object(
        'account_id', v_user_available_account_id::text,
        'side', 'CREDIT',
        'units', v_request.requested_units::text
      )
    )
  ) as posted;

  update private.deposit_requests as requests
  set
    status = 'CONFIRMED',
    confirmation_journal_id = v_journal_id,
    confirmed_by = v_actor_user_id,
    confirmed_at = clock_timestamp()
  where requests.id = v_request.id
  returning requests.* into v_request;

  insert into private.deposit_command_audit_events as inserted_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    actor_type,
    target_user_id,
    wallet_account_id,
    asset_id,
    deposit_request_id,
    resulting_journal_id,
    reason,
    request_data,
    previous_status,
    resulting_status,
    units
  )
  values (
    p_command_id,
    'CONFIRM_DEPOSIT_REQUEST',
    'APPLIED',
    v_actor_user_id,
    'ADMIN',
    v_wallet.user_id,
    v_request.wallet_account_id,
    v_request.asset_id,
    v_request.id,
    v_journal_id,
    v_reason,
    v_request_data,
    'REQUESTED',
    'CONFIRMED',
    v_request.requested_units
  )
  returning inserted_events.id into v_event_id;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, v_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
end;
$$;

comment on function public.confirm_user_funding_request(uuid, bigint, uuid, text) is
  'ACTIVE ADMIN AAL2 command to confirm a REQUESTED local manual deposit. It posts a four-line journal moving clearing to custody and pending deposit to available balance, with no partial confirmation, address, transaction ID, service-role, or on-chain verification path.';

create or replace function public.admin_cancel_user_funding_request(
  p_deposit_request_id uuid,
  p_request_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  deposit_request_id uuid,
  journal_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  units text,
  status text,
  request_version bigint,
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
  v_existing_event private.deposit_command_audit_events%rowtype;
  v_request private.deposit_requests%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_user_pending_account_id uuid;
  v_system_clearing_account_id uuid;
  v_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
begin
  v_actor_user_id := private.deposit_require_admin_aal2();
  v_reason := private.deposit_normalize_reason(p_reason);

  if p_deposit_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'CANCEL_DEPOSIT_REQUEST',
    'actor_type', 'ADMIN',
    'deposit_request_id', p_deposit_request_id::text,
    'request_expected_version', p_request_expected_version,
    'reason', v_reason
  );

  perform private.deposit_lock();

  select events.* into v_existing_event
  from private.deposit_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'ADMIN'
      and v_existing_event.action = 'CANCEL_DEPOSIT_REQUEST'
      and v_existing_event.deposit_request_id = p_deposit_request_id
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          v_existing_event.id,
          v_existing_event.command_id,
          requests.id,
          v_existing_event.resulting_journal_id,
          requests.wallet_account_id,
          requests.asset_id,
          requests.requested_units::text,
          requests.status,
          requests.version,
          v_existing_event.occurred_at
        from private.deposit_requests as requests
        where requests.id = v_existing_event.deposit_request_id;
      return;
    end if;

    return query select 'DEPOSIT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'DEPOSIT_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.deposit_requests as requests
  where requests.id = p_deposit_request_id
  for update;

  if not found then
    return query select 'DEPOSIT_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_deposit_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_request.wallet_account_id
  for update;

  if not found then
    return query select 'DEPOSIT_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.version <> p_request_expected_version then
    return query select 'DEPOSIT_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.status = 'CANCELED' then
    insert into private.deposit_command_audit_events as inserted_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      actor_type,
      target_user_id,
      wallet_account_id,
      asset_id,
      deposit_request_id,
      resulting_journal_id,
      reason,
      request_data,
      previous_status,
      resulting_status,
      units
    )
    values (
      p_command_id,
      'CANCEL_DEPOSIT_REQUEST',
      'NOOP',
      v_actor_user_id,
      'ADMIN',
      v_wallet.user_id,
      v_request.wallet_account_id,
      v_request.asset_id,
      v_request.id,
      v_request.cancellation_journal_id,
      v_reason,
      v_request_data,
      'CANCELED',
      'CANCELED',
      v_request.requested_units
    )
    returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_posted_at;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, v_request.id, v_request.cancellation_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
    return;
  end if;

  if v_request.status <> 'REQUESTED' then
    return query select 'DEPOSIT_REQUEST_CONFIRMED'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select accounts.id into v_user_pending_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = v_request.wallet_account_id
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose = 'USER_PENDING_DEPOSIT';

  select accounts.id into v_system_clearing_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'SYSTEM'
    and accounts.wallet_account_id is null
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose = 'SYSTEM_DEPOSIT_CLEARING';

  if v_user_pending_account_id is null or v_system_clearing_account_id is null then
    return query select 'DEPOSIT_LEDGER_UNAVAILABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_journal_id, v_posted_at
  from private.post_ledger_journal(
    p_command_id,
    v_request.asset_id,
    'ADMIN_DEPOSIT_CANCELED',
    'ADMIN',
    v_actor_user_id,
    'DEPOSIT_REQUEST',
    v_request.id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_user_pending_account_id::text,
        'side', 'DEBIT',
        'units', v_request.requested_units::text
      ),
      jsonb_build_object(
        'account_id', v_system_clearing_account_id::text,
        'side', 'CREDIT',
        'units', v_request.requested_units::text
      )
    )
  ) as posted;

  update private.deposit_requests as requests
  set
    status = 'CANCELED',
    cancellation_journal_id = v_journal_id,
    canceled_by = v_actor_user_id,
    canceled_at = clock_timestamp(),
    cancellation_actor_type = 'ADMIN'
  where requests.id = v_request.id
  returning requests.* into v_request;

  insert into private.deposit_command_audit_events as inserted_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    actor_type,
    target_user_id,
    wallet_account_id,
    asset_id,
    deposit_request_id,
    resulting_journal_id,
    reason,
    request_data,
    previous_status,
    resulting_status,
    units
  )
  values (
    p_command_id,
    'CANCEL_DEPOSIT_REQUEST',
    'APPLIED',
    v_actor_user_id,
    'ADMIN',
    v_wallet.user_id,
    v_request.wallet_account_id,
    v_request.asset_id,
    v_request.id,
    v_journal_id,
    v_reason,
    v_request_data,
    'REQUESTED',
    'CANCELED',
    v_request.requested_units
  )
  returning inserted_events.id into v_event_id;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, v_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
end;
$$;

comment on function public.admin_cancel_user_funding_request(uuid, bigint, uuid, text) is
  'ACTIVE ADMIN AAL2 command to cancel a REQUESTED local manual deposit. It is allowed for inactive target profiles, frozen or closed wallets, and suspended or archived assets because it only reverses pending deposit and clearing buckets.';

create or replace function public.list_current_user_deposit_requests(
  p_limit integer default 50
)
returns table (
  deposit_request_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  asset_code text,
  symbol text,
  decimals smallint,
  requested_units text,
  status text,
  request_journal_id uuid,
  confirmation_journal_id uuid,
  cancellation_journal_id uuid,
  cancellation_actor_type text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  canceled_at timestamptz,
  version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_wallet_account_id uuid;
  v_limit integer;
begin
  v_user_id := private.deposit_require_active_user();
  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  select wallet_accounts.id into v_wallet_account_id
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.user_id = v_user_id;

  if not found then
    raise exception 'DEPOSIT_READ_FORBIDDEN'
      using errcode = '42501';
  end if;

  return query
    select
      requests.id,
      requests.wallet_account_id,
      requests.asset_id,
      assets.asset_code,
      assets.symbol,
      assets.decimals,
      requests.requested_units::text,
      requests.status,
      requests.request_journal_id,
      requests.confirmation_journal_id,
      requests.cancellation_journal_id,
      requests.cancellation_actor_type,
      requests.requested_at,
      requests.confirmed_at,
      requests.canceled_at,
      requests.version
    from private.deposit_requests as requests
    join public.supported_assets as assets
      on assets.id = requests.asset_id
    where requests.wallet_account_id = v_wallet_account_id
    order by requests.requested_at desc, requests.id desc
    limit v_limit;
end;
$$;

comment on function public.list_current_user_deposit_requests(integer) is
  'Authenticated ACTIVE user read RPC for caller-owned local manual deposit requests. It returns safe status and text unit fields only; no address, transaction ID, cookie, token, or ledger account IDs are exposed.';

create or replace function public.list_admin_deposit_requests(
  p_limit integer default 100,
  p_before_deposit_request_id uuid default null
)
returns table (
  deposit_request_id uuid,
  target_user_id uuid,
  profile_status text,
  wallet_account_id uuid,
  wallet_status text,
  asset_id uuid,
  asset_code text,
  symbol text,
  decimals smallint,
  requested_units text,
  status text,
  request_journal_id uuid,
  confirmation_journal_id uuid,
  cancellation_journal_id uuid,
  confirmed_by uuid,
  canceled_by uuid,
  cancellation_actor_type text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  canceled_at timestamptz,
  version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_before_requested_at timestamptz;
  v_before_id uuid;
begin
  perform private.deposit_require_admin_aal2();
  v_limit := coalesce(p_limit, 100);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_deposit_request_id is not null then
    select requests.requested_at, requests.id
      into v_before_requested_at, v_before_id
    from private.deposit_requests as requests
    where requests.id = p_before_deposit_request_id;

    if not found then
      return;
    end if;
  end if;

  return query
    select
      requests.id,
      wallet_accounts.user_id,
      profiles.account_status,
      requests.wallet_account_id,
      wallet_accounts.status,
      requests.asset_id,
      assets.asset_code,
      assets.symbol,
      assets.decimals,
      requests.requested_units::text,
      requests.status,
      requests.request_journal_id,
      requests.confirmation_journal_id,
      requests.cancellation_journal_id,
      requests.confirmed_by,
      requests.canceled_by,
      requests.cancellation_actor_type,
      requests.requested_at,
      requests.confirmed_at,
      requests.canceled_at,
      requests.version
    from private.deposit_requests as requests
    join public.wallet_accounts as wallet_accounts
      on wallet_accounts.id = requests.wallet_account_id
    join public.profiles as profiles
      on profiles.id = wallet_accounts.user_id
    join public.supported_assets as assets
      on assets.id = requests.asset_id
    where p_before_deposit_request_id is null
      or requests.requested_at < v_before_requested_at
      or (
        requests.requested_at = v_before_requested_at
        and requests.id < v_before_id
      )
    order by requests.requested_at desc, requests.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_deposit_requests(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for local manual deposit requests. It exposes request state and journal IDs for audit workflows, but no request_data, headers, credentials, blockchain address, or transaction ID.';

create or replace function public.list_deposit_command_audit_events(
  p_limit integer default 50,
  p_before_event_id uuid default null
)
returns table (
  event_id uuid,
  command_id uuid,
  action text,
  outcome text,
  actor_user_id uuid,
  actor_type text,
  target_user_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  deposit_request_id uuid,
  resulting_journal_id uuid,
  reason text,
  previous_status text,
  resulting_status text,
  units_text text,
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
  perform private.deposit_require_admin_aal2();
  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_event_id is not null then
    select events.occurred_at, events.id
      into v_before_occurred_at, v_before_id
    from private.deposit_command_audit_events as events
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
      events.actor_type,
      events.target_user_id,
      events.wallet_account_id,
      events.asset_id,
      events.deposit_request_id,
      events.resulting_journal_id,
      events.reason,
      events.previous_status,
      events.resulting_status,
      events.units::text,
      events.occurred_at
    from private.deposit_command_audit_events as events
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

comment on function public.list_deposit_command_audit_events(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for append-only deposit command audit events. The returned shape excludes request_data, cookies, tokens, credentials, blockchain identifiers, and transaction IDs.';

revoke execute on function public.create_user_funding_request(uuid, bigint, uuid, bigint, text, uuid)
  from public, anon, authenticated;

revoke execute on function public.cancel_current_user_funding_request(uuid, bigint, uuid)
  from public, anon, authenticated;

revoke execute on function public.confirm_user_funding_request(uuid, bigint, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.admin_cancel_user_funding_request(uuid, bigint, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.list_current_user_deposit_requests(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_deposit_requests(integer, uuid)
  from public, anon, authenticated;

revoke execute on function public.list_deposit_command_audit_events(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.create_user_funding_request(uuid, bigint, uuid, bigint, text, uuid)
  to authenticated;

grant execute on function public.cancel_current_user_funding_request(uuid, bigint, uuid)
  to authenticated;

grant execute on function public.confirm_user_funding_request(uuid, bigint, uuid, text)
  to authenticated;

grant execute on function public.admin_cancel_user_funding_request(uuid, bigint, uuid, text)
  to authenticated;

grant execute on function public.list_current_user_deposit_requests(integer)
  to authenticated;

grant execute on function public.list_admin_deposit_requests(integer, uuid)
  to authenticated;

grant execute on function public.list_deposit_command_audit_events(integer, uuid)
  to authenticated;
