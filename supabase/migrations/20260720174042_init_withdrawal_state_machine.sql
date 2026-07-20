create table private.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),

  wallet_account_id uuid not null
    references public.wallet_accounts (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  requested_by uuid not null
    references public.profiles (id) on delete restrict,

  requested_units private.positive_atomic_units not null,

  status text not null default 'REQUESTED',

  reservation_journal_id uuid null unique
    references private.ledger_journals (id) on delete restrict,

  approval_journal_id uuid null unique
    references private.ledger_journals (id) on delete restrict,

  cancellation_journal_id uuid null unique
    references private.ledger_journals (id) on delete restrict,

  reserved_by uuid null
    references public.profiles (id) on delete restrict,

  approved_by uuid null
    references public.profiles (id) on delete restrict,

  canceled_by uuid null
    references public.profiles (id) on delete restrict,

  cancellation_actor_type text null,
  canceled_from_status text null,

  requested_at timestamptz not null default clock_timestamp(),
  reserved_at timestamptz null,
  approved_at timestamptz null,
  canceled_at timestamptz null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint withdrawal_requests_status_check
    check (status in ('REQUESTED', 'RESERVED', 'APPROVED', 'CANCELED')),

  constraint withdrawal_requests_cancellation_actor_type_check
    check (
      cancellation_actor_type is null
      or cancellation_actor_type in ('USER', 'ADMIN')
    ),

  constraint withdrawal_requests_canceled_from_status_check
    check (
      canceled_from_status is null
      or canceled_from_status in ('REQUESTED', 'RESERVED', 'APPROVED')
    ),

  constraint withdrawal_requests_version_check
    check (version >= 1),

  constraint withdrawal_requests_time_check
    check (
      (reserved_at is null or reserved_at >= requested_at)
      and (approved_at is null or reserved_at is not null and approved_at >= reserved_at)
      and (canceled_at is null or canceled_at >= requested_at)
      and (
        canceled_from_status <> 'RESERVED'
        or reserved_at is not null and canceled_at >= reserved_at
      )
      and (
        canceled_from_status <> 'APPROVED'
        or approved_at is not null and canceled_at >= approved_at
      )
    ),

  constraint withdrawal_requests_status_shape_check
    check (
      (
        status = 'REQUESTED'
        and reservation_journal_id is null
        and approval_journal_id is null
        and cancellation_journal_id is null
        and reserved_by is null
        and approved_by is null
        and canceled_by is null
        and reserved_at is null
        and approved_at is null
        and canceled_at is null
        and cancellation_actor_type is null
        and canceled_from_status is null
      )
      or (
        status = 'RESERVED'
        and reservation_journal_id is not null
        and approval_journal_id is null
        and cancellation_journal_id is null
        and reserved_by is not null
        and approved_by is null
        and canceled_by is null
        and reserved_at is not null
        and approved_at is null
        and canceled_at is null
        and cancellation_actor_type is null
        and canceled_from_status is null
      )
      or (
        status = 'APPROVED'
        and reservation_journal_id is not null
        and approval_journal_id is not null
        and cancellation_journal_id is null
        and reserved_by is not null
        and approved_by is not null
        and canceled_by is null
        and reserved_at is not null
        and approved_at is not null
        and canceled_at is null
        and cancellation_actor_type is null
        and canceled_from_status is null
      )
      or (
        status = 'CANCELED'
        and canceled_by is not null
        and canceled_at is not null
        and cancellation_actor_type is not null
        and canceled_from_status is not null
        and (
          (
            canceled_from_status = 'REQUESTED'
            and reservation_journal_id is null
            and approval_journal_id is null
            and cancellation_journal_id is null
            and reserved_by is null
            and approved_by is null
            and reserved_at is null
            and approved_at is null
          )
          or (
            canceled_from_status = 'RESERVED'
            and reservation_journal_id is not null
            and approval_journal_id is null
            and cancellation_journal_id is not null
            and reserved_by is not null
            and approved_by is null
            and reserved_at is not null
            and approved_at is null
          )
          or (
            canceled_from_status = 'APPROVED'
            and reservation_journal_id is not null
            and approval_journal_id is not null
            and cancellation_journal_id is not null
            and reserved_by is not null
            and approved_by is not null
            and reserved_at is not null
            and approved_at is not null
          )
        )
      )
    )
);

comment on table private.withdrawal_requests is
  'Private local manual withdrawal request state machine. REQUESTED has no posting, RESERVED moves available to pending withdrawal, APPROVED moves pending withdrawal to withdrawal clearing, and cancellation remains local-only without addresses or settlement.';

create unique index withdrawal_requests_open_wallet_asset_uidx
  on private.withdrawal_requests (wallet_account_id, asset_id)
  where status in ('REQUESTED', 'RESERVED', 'APPROVED');

create index withdrawal_requests_wallet_requested_idx
  on private.withdrawal_requests (wallet_account_id, requested_at desc, id desc);

create index withdrawal_requests_asset_requested_idx
  on private.withdrawal_requests (asset_id, requested_at desc, id desc);

create index withdrawal_requests_status_requested_idx
  on private.withdrawal_requests (status, requested_at desc, id desc);

create trigger touch_withdrawal_requests_version
  before update on private.withdrawal_requests
  for each row
  execute function private.touch_versioned_record();

create table private.withdrawal_command_audit_events (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  action text not null,
  outcome text not null,
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  actor_type text not null,
  target_user_id uuid not null references public.profiles (id) on delete restrict,
  wallet_account_id uuid not null references public.wallet_accounts (id) on delete restrict,
  asset_id uuid not null references public.supported_assets (id) on delete restrict,
  withdrawal_request_id uuid not null references private.withdrawal_requests (id) on delete restrict,
  resulting_journal_id uuid null references private.ledger_journals (id) on delete restrict,
  reason text not null,
  request_data jsonb not null,
  previous_status text null,
  resulting_status text not null,
  units private.positive_atomic_units not null,
  occurred_at timestamptz not null default clock_timestamp(),

  constraint withdrawal_command_audit_events_action_check
    check (action in (
      'CREATE_WITHDRAWAL_REQUEST',
      'RESERVE_WITHDRAWAL_REQUEST',
      'APPROVE_WITHDRAWAL_REQUEST',
      'CANCEL_WITHDRAWAL_REQUEST'
    )),

  constraint withdrawal_command_audit_events_actor_type_check
    check (actor_type in ('USER', 'ADMIN')),

  constraint withdrawal_command_audit_events_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),

  constraint withdrawal_command_audit_events_status_check
    check (
      (previous_status is null or previous_status in ('REQUESTED', 'RESERVED', 'APPROVED', 'CANCELED'))
      and resulting_status in ('REQUESTED', 'RESERVED', 'APPROVED', 'CANCELED')
    ),

  constraint withdrawal_command_audit_events_shape_check
    check (
      (
        action = 'CREATE_WITHDRAWAL_REQUEST'
        and actor_type = 'USER'
        and outcome = 'APPLIED'
        and previous_status is null
        and resulting_status = 'REQUESTED'
        and resulting_journal_id is null
      )
      or (
        action = 'RESERVE_WITHDRAWAL_REQUEST'
        and actor_type = 'ADMIN'
        and (
          (
            outcome = 'APPLIED'
            and previous_status = 'REQUESTED'
            and resulting_status = 'RESERVED'
            and resulting_journal_id is not null
          )
          or (
            outcome = 'NOOP'
            and previous_status = 'RESERVED'
            and resulting_status = 'RESERVED'
            and resulting_journal_id is not null
          )
        )
      )
      or (
        action = 'APPROVE_WITHDRAWAL_REQUEST'
        and actor_type = 'ADMIN'
        and (
          (
            outcome = 'APPLIED'
            and previous_status = 'RESERVED'
            and resulting_status = 'APPROVED'
            and resulting_journal_id is not null
          )
          or (
            outcome = 'NOOP'
            and previous_status = 'APPROVED'
            and resulting_status = 'APPROVED'
            and resulting_journal_id is not null
          )
        )
      )
      or (
        action = 'CANCEL_WITHDRAWAL_REQUEST'
        and actor_type in ('USER', 'ADMIN')
        and (
          (
            outcome = 'APPLIED'
            and previous_status in ('REQUESTED', 'RESERVED', 'APPROVED')
            and resulting_status = 'CANCELED'
            and (
              previous_status = 'REQUESTED'
              or resulting_journal_id is not null
            )
          )
          or (
            outcome = 'NOOP'
            and previous_status = 'CANCELED'
            and resulting_status = 'CANCELED'
          )
        )
      )
    ),

  constraint withdrawal_command_audit_events_reason_check
    check (
      reason = pg_catalog.btrim(reason)
      and pg_catalog.char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
      and reason !~* '(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret|transaction[_ ]?id|signature|blockchain[_ ]?address|wallet[_ ]?address|withdrawal[_ ]?address)'
    ),

  constraint withdrawal_command_audit_events_request_data_check
    check (
      jsonb_typeof(request_data) = 'object'
      and request_data::text !~* '(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret|transaction[_ ]?id|signature|blockchain[_ ]?address|wallet[_ ]?address|withdrawal[_ ]?address|request[_ ]?header)'
    )
);

comment on table private.withdrawal_command_audit_events is
  'Append-only local manual withdrawal command audit. It records APPLIED and NOOP outcomes without request headers, credentials, blockchain identifiers, transaction IDs, addresses, service-role data, or settlement evidence.';

create index withdrawal_command_audit_events_occurred_at_idx
  on private.withdrawal_command_audit_events (occurred_at desc, id desc);

create index withdrawal_command_audit_events_actor_idx
  on private.withdrawal_command_audit_events (actor_user_id, occurred_at desc);

create index withdrawal_command_audit_events_target_user_idx
  on private.withdrawal_command_audit_events (target_user_id, occurred_at desc);

create index withdrawal_command_audit_events_wallet_idx
  on private.withdrawal_command_audit_events (wallet_account_id, occurred_at desc);

create index withdrawal_command_audit_events_asset_idx
  on private.withdrawal_command_audit_events (asset_id, occurred_at desc);

create index withdrawal_command_audit_events_request_idx
  on private.withdrawal_command_audit_events (withdrawal_request_id, occurred_at desc);

create unique index withdrawal_command_audit_applied_journal_uidx
  on private.withdrawal_command_audit_events (resulting_journal_id)
  where outcome = 'APPLIED' and resulting_journal_id is not null;

revoke all privileges on table private.withdrawal_requests
  from public, anon, authenticated;

revoke all privileges on table private.withdrawal_command_audit_events
  from public, anon, authenticated;

create or replace function private.prevent_withdrawal_command_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'WITHDRAWAL_COMMAND_AUDIT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_withdrawal_command_audit_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE for immutable withdrawal command audit rows without exposing request IDs, units, reasons, or actor details.';

revoke execute on function private.prevent_withdrawal_command_audit_mutation()
  from public, anon, authenticated;

create trigger protect_withdrawal_command_audit_events
  before update or delete or truncate
  on private.withdrawal_command_audit_events
  for each statement
  execute function private.prevent_withdrawal_command_audit_mutation();

create or replace function private.withdrawal_lock()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:withdrawal-command:v1',
      0
    )
  );
end;
$$;

create or replace function private.withdrawal_require_active_user()
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
    raise exception 'WITHDRAWAL_USER_REQUIRED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles as profiles
    where profiles.id = v_user_id
      and profiles.account_status = 'ACTIVE'
  ) then
    raise exception 'WITHDRAWAL_ACTIVE_USER_REQUIRED'
      using errcode = '42501';
  end if;

  return v_user_id;
end;
$$;

create or replace function private.withdrawal_require_admin_aal2()
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
    raise exception 'WITHDRAWAL_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

create or replace function private.withdrawal_normalize_reason(
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
    or v_reason ~* '(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret|transaction[_ ]?id|signature|blockchain[_ ]?address|wallet[_ ]?address|withdrawal[_ ]?address)'
  then
    return null;
  end if;

  return v_reason;
end;
$$;

create or replace function private.withdrawal_validate_units_text(
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

revoke execute on function private.withdrawal_lock()
  from public, anon, authenticated;

revoke execute on function private.withdrawal_require_active_user()
  from public, anon, authenticated;

revoke execute on function private.withdrawal_require_admin_aal2()
  from public, anon, authenticated;

revoke execute on function private.withdrawal_normalize_reason(text)
  from public, anon, authenticated;

revoke execute on function private.withdrawal_validate_units_text(text)
  from public, anon, authenticated;

create or replace function private.validate_withdrawal_request_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.wallet_account_id is distinct from old.wallet_account_id
    or new.asset_id is distinct from old.asset_id
    or new.requested_by is distinct from old.requested_by
    or new.requested_units is distinct from old.requested_units
    or new.requested_at is distinct from old.requested_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'WITHDRAWAL_REQUEST_TRANSITION_INVALID'
      using errcode = '23514';
  end if;

  if old.status = 'CANCELED'
    or new.status = old.status
    or new.status not in ('RESERVED', 'APPROVED', 'CANCELED')
  then
    raise exception 'WITHDRAWAL_REQUEST_TRANSITION_INVALID'
      using errcode = '23514';
  end if;

  if old.status = 'REQUESTED' and new.status = 'RESERVED' then
    if old.reservation_journal_id is not null
      or old.approval_journal_id is not null
      or old.cancellation_journal_id is not null
      or old.reserved_by is not null
      or old.approved_by is not null
      or old.canceled_by is not null
      or old.reserved_at is not null
      or old.approved_at is not null
      or old.canceled_at is not null
      or old.cancellation_actor_type is not null
      or old.canceled_from_status is not null
      or new.reservation_journal_id is null
      or new.reserved_by is null
      or new.reserved_at is null
      or new.approval_journal_id is not null
      or new.cancellation_journal_id is not null
      or new.approved_by is not null
      or new.canceled_by is not null
      or new.approved_at is not null
      or new.canceled_at is not null
      or new.cancellation_actor_type is not null
      or new.canceled_from_status is not null
    then
      raise exception 'WITHDRAWAL_REQUEST_TRANSITION_INVALID'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'RESERVED' and new.status = 'APPROVED' then
    if new.reservation_journal_id is distinct from old.reservation_journal_id
      or new.reserved_by is distinct from old.reserved_by
      or new.reserved_at is distinct from old.reserved_at
      or new.approval_journal_id is null
      or new.approved_by is null
      or new.approved_at is null
      or new.cancellation_journal_id is not null
      or new.canceled_by is not null
      or new.canceled_at is not null
      or new.cancellation_actor_type is not null
      or new.canceled_from_status is not null
    then
      raise exception 'WITHDRAWAL_REQUEST_TRANSITION_INVALID'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.status = 'CANCELED'
    and old.status in ('REQUESTED', 'RESERVED', 'APPROVED')
  then
    if new.canceled_by is null
      or new.canceled_at is null
      or new.cancellation_actor_type not in ('USER', 'ADMIN')
      or new.canceled_from_status is distinct from old.status
      or (
        old.status = 'REQUESTED'
        and (
          new.reservation_journal_id is not null
          or new.approval_journal_id is not null
          or new.cancellation_journal_id is not null
          or new.reserved_by is not null
          or new.approved_by is not null
          or new.reserved_at is not null
          or new.approved_at is not null
        )
      )
      or (
        old.status = 'RESERVED'
        and (
          new.reservation_journal_id is distinct from old.reservation_journal_id
          or new.reserved_by is distinct from old.reserved_by
          or new.reserved_at is distinct from old.reserved_at
          or new.approval_journal_id is not null
          or new.approved_by is not null
          or new.approved_at is not null
          or new.cancellation_journal_id is null
        )
      )
      or (
        old.status = 'APPROVED'
        and (
          new.reservation_journal_id is distinct from old.reservation_journal_id
          or new.approval_journal_id is distinct from old.approval_journal_id
          or new.reserved_by is distinct from old.reserved_by
          or new.approved_by is distinct from old.approved_by
          or new.reserved_at is distinct from old.reserved_at
          or new.approved_at is distinct from old.approved_at
          or new.cancellation_journal_id is null
        )
      )
    then
      raise exception 'WITHDRAWAL_REQUEST_TRANSITION_INVALID'
        using errcode = '23514';
    end if;

    return new;
  end if;

  raise exception 'WITHDRAWAL_REQUEST_TRANSITION_INVALID'
    using errcode = '23514';
end;
$$;

comment on function private.validate_withdrawal_request_transition() is
  'Protects withdrawal request transitions. Only REQUESTED to RESERVED or CANCELED, RESERVED to APPROVED or CANCELED, and APPROVED to CANCELED are allowed; core fields cannot be rewritten.';

revoke execute on function private.validate_withdrawal_request_transition()
  from public, anon, authenticated;

create trigger validate_withdrawal_request_transition
  before update on private.withdrawal_requests
  for each row
  execute function private.validate_withdrawal_request_transition();

create or replace function private.withdrawal_journal_shape_matches(
  p_journal_id uuid,
  p_withdrawal_request_id uuid,
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
    or p_withdrawal_request_id is null
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
      and journals.reference_type = 'WITHDRAWAL_REQUEST'
      and journals.reference_id = p_withdrawal_request_id
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

revoke execute on function private.withdrawal_journal_shape_matches(uuid, uuid, uuid, uuid, private.positive_atomic_units, text, text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function private.validate_withdrawal_request_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet public.wallet_accounts%rowtype;
  v_reserve_lines jsonb;
  v_approve_lines jsonb;
  v_cancel_lines jsonb;
  v_cancel_journal_type text;
begin
  select wallet_accounts.*
    into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = new.wallet_account_id;

  if not found or v_wallet.user_id is null or v_wallet.user_id <> new.requested_by then
    raise exception 'WITHDRAWAL_REQUEST_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  v_reserve_lines := jsonb_build_array(
    jsonb_build_object('side', 'DEBIT', 'account_scope', 'USER', 'account_purpose', 'USER_AVAILABLE'),
    jsonb_build_object('side', 'CREDIT', 'account_scope', 'USER', 'account_purpose', 'USER_PENDING_WITHDRAWAL')
  );

  v_approve_lines := jsonb_build_array(
    jsonb_build_object('side', 'DEBIT', 'account_scope', 'USER', 'account_purpose', 'USER_PENDING_WITHDRAWAL'),
    jsonb_build_object('side', 'CREDIT', 'account_scope', 'SYSTEM', 'account_purpose', 'SYSTEM_WITHDRAWAL_CLEARING')
  );

  if new.status in ('RESERVED', 'APPROVED')
    or (
      new.status = 'CANCELED'
      and new.canceled_from_status in ('RESERVED', 'APPROVED')
    )
  then
    if not private.withdrawal_journal_shape_matches(
      new.reservation_journal_id,
      new.id,
      new.wallet_account_id,
      new.asset_id,
      new.requested_units,
      'ADMIN_WITHDRAWAL_RESERVED',
      'ADMIN',
      new.reserved_by,
      v_reserve_lines
    ) then
      raise exception 'WITHDRAWAL_REQUEST_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'APPROVED'
    or (
      new.status = 'CANCELED'
      and new.canceled_from_status = 'APPROVED'
    )
  then
    if not private.withdrawal_journal_shape_matches(
      new.approval_journal_id,
      new.id,
      new.wallet_account_id,
      new.asset_id,
      new.requested_units,
      'ADMIN_WITHDRAWAL_APPROVED',
      'ADMIN',
      new.approved_by,
      v_approve_lines
    ) then
      raise exception 'WITHDRAWAL_REQUEST_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'CANCELED' and new.canceled_from_status = 'REQUESTED' then
    if new.cancellation_journal_id is not null then
      raise exception 'WITHDRAWAL_REQUEST_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  elsif new.status = 'CANCELED' and new.canceled_from_status = 'RESERVED' then
    v_cancel_lines := jsonb_build_array(
      jsonb_build_object('side', 'DEBIT', 'account_scope', 'USER', 'account_purpose', 'USER_PENDING_WITHDRAWAL'),
      jsonb_build_object('side', 'CREDIT', 'account_scope', 'USER', 'account_purpose', 'USER_AVAILABLE')
    );
    v_cancel_journal_type := 'ADMIN_WITHDRAWAL_CANCELED';

    if not private.withdrawal_journal_shape_matches(
      new.cancellation_journal_id,
      new.id,
      new.wallet_account_id,
      new.asset_id,
      new.requested_units,
      v_cancel_journal_type,
      'ADMIN',
      new.canceled_by,
      v_cancel_lines
    ) then
      raise exception 'WITHDRAWAL_REQUEST_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  elsif new.status = 'CANCELED' and new.canceled_from_status = 'APPROVED' then
    v_cancel_lines := jsonb_build_array(
      jsonb_build_object('side', 'DEBIT', 'account_scope', 'SYSTEM', 'account_purpose', 'SYSTEM_WITHDRAWAL_CLEARING'),
      jsonb_build_object('side', 'CREDIT', 'account_scope', 'USER', 'account_purpose', 'USER_AVAILABLE')
    );
    v_cancel_journal_type := 'ADMIN_WITHDRAWAL_APPROVAL_CANCELED';

    if not private.withdrawal_journal_shape_matches(
      new.cancellation_journal_id,
      new.id,
      new.wallet_account_id,
      new.asset_id,
      new.requested_units,
      v_cancel_journal_type,
      'ADMIN',
      new.canceled_by,
      v_cancel_lines
    ) then
      raise exception 'WITHDRAWAL_REQUEST_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.validate_withdrawal_request_invariants() is
  'Deferred validator for local withdrawal request ledger shapes. REQUESTED has no posting; RESERVED, APPROVED, and posted cancellations must match exact withdrawal journal lines.';

revoke execute on function private.validate_withdrawal_request_invariants()
  from public, anon, authenticated;

create constraint trigger validate_withdrawal_request_invariants
  after insert or update on private.withdrawal_requests
  deferrable initially deferred
  for each row
  execute function private.validate_withdrawal_request_invariants();

create or replace function public.create_user_payout_request(
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
  withdrawal_request_id uuid,
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
  v_units text;
  v_units_numeric numeric;
  v_request_data jsonb;
  v_existing_event private.withdrawal_command_audit_events%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_asset public.supported_assets%rowtype;
  v_available_units numeric;
  v_request private.withdrawal_requests%rowtype;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.withdrawal_require_active_user();
  v_units := private.withdrawal_validate_units_text(p_units);

  if p_wallet_account_id is null
    or p_wallet_expected_version is null
    or p_wallet_expected_version < 1
    or p_asset_id is null
    or p_asset_expected_version is null
    or p_asset_expected_version < 1
    or p_command_id is null
    or v_units is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  v_units_numeric := v_units::numeric;

  v_request_data := jsonb_build_object(
    'action', 'CREATE_WITHDRAWAL_REQUEST',
    'actor_type', 'USER',
    'wallet_account_id', p_wallet_account_id::text,
    'wallet_expected_version', p_wallet_expected_version,
    'asset_id', p_asset_id::text,
    'asset_expected_version', p_asset_expected_version,
    'units', v_units
  );

  perform private.withdrawal_lock();

  select events.* into v_existing_event
  from private.withdrawal_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'USER'
      and v_existing_event.action = 'CREATE_WITHDRAWAL_REQUEST'
      and v_existing_event.reason = 'USER_WITHDRAWAL_REQUEST'
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
        from private.withdrawal_requests as requests
        where requests.id = v_existing_event.withdrawal_request_id;
      return;
    end if;

    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = p_wallet_account_id
  for update;

  if not found or v_wallet.user_id <> v_actor_user_id then
    return query select 'WITHDRAWAL_WALLET_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_wallet.version <> p_wallet_expected_version then
    return query select 'WITHDRAWAL_WALLET_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_wallet.id is null or v_wallet.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_WALLET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select assets.* into v_asset
  from public.supported_assets as assets
  where assets.id = p_asset_id
  for update;

  if not found then
    return query select 'WITHDRAWAL_ASSET_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_asset.version <> p_asset_expected_version then
    return query select 'WITHDRAWAL_ASSET_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_asset.id is null or v_asset.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_ASSET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.withdrawal_requests as requests
    where requests.wallet_account_id = p_wallet_account_id
      and requests.asset_id = p_asset_id
      and requests.status in ('REQUESTED', 'RESERVED', 'APPROVED')
  ) then
    return query select 'WITHDRAWAL_REQUEST_ALREADY_OPEN'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, v_units, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  perform private.ensure_wallet_asset_ledger_accounts(p_wallet_account_id, p_asset_id);
  perform private.ensure_system_ledger_accounts(p_asset_id);

  select coalesce(max(balances.available_units), 0::numeric)
    into v_available_units
  from private.wallet_asset_ledger_balances as balances
  where balances.wallet_account_id = p_wallet_account_id
    and balances.asset_id = p_asset_id;

  if v_available_units < v_units_numeric::numeric then
    return query select 'WITHDRAWAL_INSUFFICIENT_AVAILABLE'::text, false, null::uuid, p_command_id, null::uuid, null::uuid, p_wallet_account_id, p_asset_id, v_units, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  insert into private.withdrawal_requests (
    wallet_account_id,
    asset_id,
    requested_by,
    requested_units
  )
  values (
    p_wallet_account_id,
    p_asset_id,
    v_actor_user_id,
    v_units_numeric::private.positive_atomic_units
  )
  returning * into v_request;

  insert into private.withdrawal_command_audit_events as inserted_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    actor_type,
    target_user_id,
    wallet_account_id,
    asset_id,
    withdrawal_request_id,
    resulting_journal_id,
    reason,
    request_data,
    previous_status,
    resulting_status,
    units
  )
  values (
    p_command_id,
    'CREATE_WITHDRAWAL_REQUEST',
    'APPLIED',
    v_actor_user_id,
    'USER',
    v_actor_user_id,
    v_request.wallet_account_id,
    v_request.asset_id,
    v_request.id,
    null,
    'USER_WITHDRAWAL_REQUEST',
    v_request_data,
    null,
    'REQUESTED',
    v_request.requested_units
  )
  returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_occurred_at;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_occurred_at;
end;
$$;

comment on function public.create_user_payout_request(uuid, bigint, uuid, bigint, text, uuid) is
  'Authenticated ACTIVE user command to create a local manual withdrawal request. It prechecks available Atomic Units but posts no ledger journal and stores no address, transaction ID, service-role data, or settlement proof.';

create or replace function public.cancel_current_user_payout_request(
  p_withdrawal_request_id uuid,
  p_request_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  withdrawal_request_id uuid,
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
  v_existing_event private.withdrawal_command_audit_events%rowtype;
  v_request private.withdrawal_requests%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.withdrawal_require_active_user();
  v_reason := private.withdrawal_normalize_reason(p_reason);

  if p_withdrawal_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'CANCEL_WITHDRAWAL_REQUEST',
    'actor_type', 'USER',
    'withdrawal_request_id', p_withdrawal_request_id::text,
    'request_expected_version', p_request_expected_version,
    'reason', v_reason
  );

  perform private.withdrawal_lock();

  select events.* into v_existing_event
  from private.withdrawal_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'USER'
      and v_existing_event.action = 'CANCEL_WITHDRAWAL_REQUEST'
      and v_existing_event.withdrawal_request_id = p_withdrawal_request_id
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
        from private.withdrawal_requests as requests
        where requests.id = v_existing_event.withdrawal_request_id;
      return;
    end if;

    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.withdrawal_requests as requests
  where requests.id = p_withdrawal_request_id
  for update;

  if not found then
    return query select 'WITHDRAWAL_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_request.wallet_account_id
  for update;

  if not found or v_wallet.user_id <> v_actor_user_id or v_request.requested_by <> v_actor_user_id then
    return query select 'WITHDRAWAL_REQUEST_FORBIDDEN'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.version <> p_request_expected_version then
    return query select 'WITHDRAWAL_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.status = 'CANCELED' then
    insert into private.withdrawal_command_audit_events as inserted_events (
      command_id, action, outcome, actor_user_id, actor_type, target_user_id,
      wallet_account_id, asset_id, withdrawal_request_id, resulting_journal_id,
      reason, request_data, previous_status, resulting_status, units
    )
    values (
      p_command_id, 'CANCEL_WITHDRAWAL_REQUEST', 'NOOP', v_actor_user_id, 'USER', v_request.requested_by,
      v_request.wallet_account_id, v_request.asset_id, v_request.id, v_request.cancellation_journal_id,
      v_reason, v_request_data, 'CANCELED', 'CANCELED', v_request.requested_units
    )
    returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_occurred_at;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, v_request.id, v_request.cancellation_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_occurred_at;
    return;
  end if;

  if v_request.status <> 'REQUESTED' then
    return query select 'WITHDRAWAL_REQUEST_NOT_USER_CANCELABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  update private.withdrawal_requests as requests
  set
    status = 'CANCELED',
    canceled_by = v_actor_user_id,
    canceled_at = clock_timestamp(),
    cancellation_actor_type = 'USER',
    canceled_from_status = 'REQUESTED'
  where requests.id = v_request.id
  returning * into v_request;

  insert into private.withdrawal_command_audit_events as inserted_events (
    command_id, action, outcome, actor_user_id, actor_type, target_user_id,
    wallet_account_id, asset_id, withdrawal_request_id, resulting_journal_id,
    reason, request_data, previous_status, resulting_status, units
  )
  values (
    p_command_id, 'CANCEL_WITHDRAWAL_REQUEST', 'APPLIED', v_actor_user_id, 'USER', v_request.requested_by,
    v_request.wallet_account_id, v_request.asset_id, v_request.id, null,
    v_reason, v_request_data, 'REQUESTED', 'CANCELED', v_request.requested_units
  )
  returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_occurred_at;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_occurred_at;
end;
$$;

comment on function public.cancel_current_user_payout_request(uuid, bigint, uuid, text) is
  'Authenticated ACTIVE user command to cancel the caller-owned REQUESTED local manual withdrawal request. User cancellation never posts ledger entries and cannot cancel reserved or approved requests.';

create or replace function public.reserve_user_payout_request(
  p_withdrawal_request_id uuid,
  p_request_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  withdrawal_request_id uuid,
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
  v_existing_event private.withdrawal_command_audit_events%rowtype;
  v_request private.withdrawal_requests%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_profile public.profiles%rowtype;
  v_asset public.supported_assets%rowtype;
  v_user_available_account_id uuid;
  v_user_pending_account_id uuid;
  v_available_units numeric;
  v_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
begin
  v_actor_user_id := private.withdrawal_require_admin_aal2();
  v_reason := private.withdrawal_normalize_reason(p_reason);

  if p_withdrawal_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'RESERVE_WITHDRAWAL_REQUEST',
    'actor_type', 'ADMIN',
    'withdrawal_request_id', p_withdrawal_request_id::text,
    'request_expected_version', p_request_expected_version,
    'reason', v_reason
  );

  perform private.withdrawal_lock();

  select events.* into v_existing_event
  from private.withdrawal_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'ADMIN'
      and v_existing_event.action = 'RESERVE_WITHDRAWAL_REQUEST'
      and v_existing_event.withdrawal_request_id = p_withdrawal_request_id
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
        from private.withdrawal_requests as requests
        where requests.id = v_existing_event.withdrawal_request_id;
      return;
    end if;

    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.withdrawal_requests as requests
  where requests.id = p_withdrawal_request_id
  for update;

  if not found then
    return query select 'WITHDRAWAL_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_request.version <> p_request_expected_version then
    return query select 'WITHDRAWAL_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select profiles.* into v_profile
  from public.profiles as profiles
  where profiles.id = v_request.requested_by;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_request.wallet_account_id
  for update;

  select assets.* into v_asset
  from public.supported_assets as assets
  where assets.id = v_request.asset_id
  for update;

  if v_profile.id is null or v_profile.account_status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_PROFILE_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_wallet.id is null or v_wallet.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_WALLET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_asset.id is null or v_asset.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_ASSET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.status = 'RESERVED' then
    insert into private.withdrawal_command_audit_events as inserted_events (
      command_id, action, outcome, actor_user_id, actor_type, target_user_id,
      wallet_account_id, asset_id, withdrawal_request_id, resulting_journal_id,
      reason, request_data, previous_status, resulting_status, units
    )
    values (
      p_command_id, 'RESERVE_WITHDRAWAL_REQUEST', 'NOOP', v_actor_user_id, 'ADMIN', v_request.requested_by,
      v_request.wallet_account_id, v_request.asset_id, v_request.id, v_request.reservation_journal_id,
      v_reason, v_request_data, 'RESERVED', 'RESERVED', v_request.requested_units
    )
    returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_posted_at;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, v_request.id, v_request.reservation_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
    return;
  end if;

  if v_request.status <> 'REQUESTED' then
    return query select 'WITHDRAWAL_REQUEST_NOT_RESERVABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  perform private.ensure_wallet_asset_ledger_accounts(v_request.wallet_account_id, v_request.asset_id);

  select
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_PENDING_WITHDRAWAL'))::uuid
    into v_user_available_account_id, v_user_pending_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = v_request.wallet_account_id
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose in ('USER_AVAILABLE', 'USER_PENDING_WITHDRAWAL');

  select coalesce(max(balances.available_units), 0::numeric)
    into v_available_units
  from private.wallet_asset_ledger_balances as balances
  where balances.wallet_account_id = v_request.wallet_account_id
    and balances.asset_id = v_request.asset_id;

  if v_user_available_account_id is null
    or v_user_pending_account_id is null
  then
    return query select 'WITHDRAWAL_LEDGER_UNAVAILABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_available_units < v_request.requested_units::numeric then
    return query select 'WITHDRAWAL_INSUFFICIENT_AVAILABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_journal_id, v_posted_at
  from private.post_ledger_journal(
    p_command_id,
    v_request.asset_id,
    'ADMIN_WITHDRAWAL_RESERVED',
    'ADMIN',
    v_actor_user_id,
    'WITHDRAWAL_REQUEST',
    v_request.id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object('account_id', v_user_available_account_id::text, 'side', 'DEBIT', 'units', v_request.requested_units::text),
      jsonb_build_object('account_id', v_user_pending_account_id::text, 'side', 'CREDIT', 'units', v_request.requested_units::text)
    )
  ) as posted;

  update private.withdrawal_requests as requests
  set
    status = 'RESERVED',
    reservation_journal_id = v_journal_id,
    reserved_by = v_actor_user_id,
    reserved_at = clock_timestamp()
  where requests.id = v_request.id
  returning * into v_request;

  insert into private.withdrawal_command_audit_events as inserted_events (
    command_id, action, outcome, actor_user_id, actor_type, target_user_id,
    wallet_account_id, asset_id, withdrawal_request_id, resulting_journal_id,
    reason, request_data, previous_status, resulting_status, units
  )
  values (
    p_command_id, 'RESERVE_WITHDRAWAL_REQUEST', 'APPLIED', v_actor_user_id, 'ADMIN', v_request.requested_by,
    v_request.wallet_account_id, v_request.asset_id, v_request.id, v_journal_id,
    v_reason, v_request_data, 'REQUESTED', 'RESERVED', v_request.requested_units
  )
  returning inserted_events.id into v_event_id;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, v_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
end;
$$;

comment on function public.reserve_user_payout_request(uuid, bigint, uuid, text) is
  'ACTIVE ADMIN AAL2 command to reserve a REQUESTED local manual withdrawal. It posts DEBIT USER_AVAILABLE and CREDIT USER_PENDING_WITHDRAWAL, with no address, transaction ID, custody decrease, or settlement path.';

create or replace function public.approve_user_payout_request(
  p_withdrawal_request_id uuid,
  p_request_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  withdrawal_request_id uuid,
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
  v_existing_event private.withdrawal_command_audit_events%rowtype;
  v_request private.withdrawal_requests%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_profile public.profiles%rowtype;
  v_asset public.supported_assets%rowtype;
  v_user_pending_account_id uuid;
  v_system_clearing_account_id uuid;
  v_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
begin
  v_actor_user_id := private.withdrawal_require_admin_aal2();
  v_reason := private.withdrawal_normalize_reason(p_reason);

  if p_withdrawal_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'APPROVE_WITHDRAWAL_REQUEST',
    'actor_type', 'ADMIN',
    'withdrawal_request_id', p_withdrawal_request_id::text,
    'request_expected_version', p_request_expected_version,
    'reason', v_reason
  );

  perform private.withdrawal_lock();

  select events.* into v_existing_event
  from private.withdrawal_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'ADMIN'
      and v_existing_event.action = 'APPROVE_WITHDRAWAL_REQUEST'
      and v_existing_event.withdrawal_request_id = p_withdrawal_request_id
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
        from private.withdrawal_requests as requests
        where requests.id = v_existing_event.withdrawal_request_id;
      return;
    end if;

    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.withdrawal_requests as requests
  where requests.id = p_withdrawal_request_id
  for update;

  if not found then
    return query select 'WITHDRAWAL_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_request.version <> p_request_expected_version then
    return query select 'WITHDRAWAL_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select profiles.* into v_profile
  from public.profiles as profiles
  where profiles.id = v_request.requested_by;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_request.wallet_account_id
  for update;

  select assets.* into v_asset
  from public.supported_assets as assets
  where assets.id = v_request.asset_id
  for update;

  if v_profile.id is null or v_profile.account_status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_PROFILE_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_wallet.id is null or v_wallet.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_WALLET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_asset.id is null or v_asset.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_ASSET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.status = 'APPROVED' then
    insert into private.withdrawal_command_audit_events as inserted_events (
      command_id, action, outcome, actor_user_id, actor_type, target_user_id,
      wallet_account_id, asset_id, withdrawal_request_id, resulting_journal_id,
      reason, request_data, previous_status, resulting_status, units
    )
    values (
      p_command_id, 'APPROVE_WITHDRAWAL_REQUEST', 'NOOP', v_actor_user_id, 'ADMIN', v_request.requested_by,
      v_request.wallet_account_id, v_request.asset_id, v_request.id, v_request.approval_journal_id,
      v_reason, v_request_data, 'APPROVED', 'APPROVED', v_request.requested_units
    )
    returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_posted_at;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, v_request.id, v_request.approval_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
    return;
  end if;

  if v_request.status <> 'RESERVED' then
    return query select 'WITHDRAWAL_REQUEST_NOT_APPROVABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  perform private.ensure_wallet_asset_ledger_accounts(v_request.wallet_account_id, v_request.asset_id);
  perform private.ensure_system_ledger_accounts(v_request.asset_id);

  select accounts.id into v_user_pending_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = v_request.wallet_account_id
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose = 'USER_PENDING_WITHDRAWAL';

  select accounts.id into v_system_clearing_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'SYSTEM'
    and accounts.wallet_account_id is null
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING';

  if v_user_pending_account_id is null or v_system_clearing_account_id is null then
    return query select 'WITHDRAWAL_LEDGER_UNAVAILABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_journal_id, v_posted_at
  from private.post_ledger_journal(
    p_command_id,
    v_request.asset_id,
    'ADMIN_WITHDRAWAL_APPROVED',
    'ADMIN',
    v_actor_user_id,
    'WITHDRAWAL_REQUEST',
    v_request.id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object('account_id', v_user_pending_account_id::text, 'side', 'DEBIT', 'units', v_request.requested_units::text),
      jsonb_build_object('account_id', v_system_clearing_account_id::text, 'side', 'CREDIT', 'units', v_request.requested_units::text)
    )
  ) as posted;

  update private.withdrawal_requests as requests
  set
    status = 'APPROVED',
    approval_journal_id = v_journal_id,
    approved_by = v_actor_user_id,
    approved_at = clock_timestamp()
  where requests.id = v_request.id
  returning * into v_request;

  insert into private.withdrawal_command_audit_events as inserted_events (
    command_id, action, outcome, actor_user_id, actor_type, target_user_id,
    wallet_account_id, asset_id, withdrawal_request_id, resulting_journal_id,
    reason, request_data, previous_status, resulting_status, units
  )
  values (
    p_command_id, 'APPROVE_WITHDRAWAL_REQUEST', 'APPLIED', v_actor_user_id, 'ADMIN', v_request.requested_by,
    v_request.wallet_account_id, v_request.asset_id, v_request.id, v_journal_id,
    v_reason, v_request_data, 'RESERVED', 'APPROVED', v_request.requested_units
  )
  returning inserted_events.id into v_event_id;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, v_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
end;
$$;

comment on function public.approve_user_payout_request(uuid, bigint, uuid, text) is
  'ACTIVE ADMIN AAL2 command to approve a RESERVED local manual withdrawal. Approval moves pending withdrawal to withdrawal clearing, does not decrease custody, and is not blockchain settlement.';

create or replace function public.admin_cancel_user_payout_request(
  p_withdrawal_request_id uuid,
  p_request_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  withdrawal_request_id uuid,
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
  v_existing_event private.withdrawal_command_audit_events%rowtype;
  v_request private.withdrawal_requests%rowtype;
  v_user_available_account_id uuid;
  v_user_pending_account_id uuid;
  v_system_clearing_account_id uuid;
  v_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
  v_previous_status text;
  v_journal_type text;
begin
  v_actor_user_id := private.withdrawal_require_admin_aal2();
  v_reason := private.withdrawal_normalize_reason(p_reason);

  if p_withdrawal_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'CANCEL_WITHDRAWAL_REQUEST',
    'actor_type', 'ADMIN',
    'withdrawal_request_id', p_withdrawal_request_id::text,
    'request_expected_version', p_request_expected_version,
    'reason', v_reason
  );

  perform private.withdrawal_lock();

  select events.* into v_existing_event
  from private.withdrawal_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'ADMIN'
      and v_existing_event.action = 'CANCEL_WITHDRAWAL_REQUEST'
      and v_existing_event.withdrawal_request_id = p_withdrawal_request_id
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
        from private.withdrawal_requests as requests
        where requests.id = v_existing_event.withdrawal_request_id;
      return;
    end if;

    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.withdrawal_requests as requests
  where requests.id = p_withdrawal_request_id
  for update;

  if not found then
    return query select 'WITHDRAWAL_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz;
    return;
  end if;

  if v_request.version <> p_request_expected_version then
    return query select 'WITHDRAWAL_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  if v_request.status = 'CANCELED' then
    insert into private.withdrawal_command_audit_events as inserted_events (
      command_id, action, outcome, actor_user_id, actor_type, target_user_id,
      wallet_account_id, asset_id, withdrawal_request_id, resulting_journal_id,
      reason, request_data, previous_status, resulting_status, units
    )
    values (
      p_command_id, 'CANCEL_WITHDRAWAL_REQUEST', 'NOOP', v_actor_user_id, 'ADMIN', v_request.requested_by,
      v_request.wallet_account_id, v_request.asset_id, v_request.id, v_request.cancellation_journal_id,
      v_reason, v_request_data, 'CANCELED', 'CANCELED', v_request.requested_units
    )
    returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_posted_at;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, v_request.id, v_request.cancellation_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
    return;
  end if;

  if v_request.status not in ('REQUESTED', 'RESERVED', 'APPROVED') then
    return query select 'WITHDRAWAL_REQUEST_NOT_CANCELABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  v_previous_status := v_request.status;

  if v_previous_status in ('RESERVED', 'APPROVED') then
    perform private.ensure_wallet_asset_ledger_accounts(v_request.wallet_account_id, v_request.asset_id);
    perform private.ensure_system_ledger_accounts(v_request.asset_id);

    select
      (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
      (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_PENDING_WITHDRAWAL'))::uuid
      into v_user_available_account_id, v_user_pending_account_id
    from private.ledger_accounts as accounts
    where accounts.account_scope = 'USER'
      and accounts.wallet_account_id = v_request.wallet_account_id
      and accounts.asset_id = v_request.asset_id
      and accounts.account_purpose in ('USER_AVAILABLE', 'USER_PENDING_WITHDRAWAL');

    select accounts.id into v_system_clearing_account_id
    from private.ledger_accounts as accounts
    where accounts.account_scope = 'SYSTEM'
      and accounts.wallet_account_id is null
      and accounts.asset_id = v_request.asset_id
      and accounts.account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING';

    if v_user_available_account_id is null
      or v_user_pending_account_id is null
      or (
        v_previous_status = 'APPROVED'
        and v_system_clearing_account_id is null
      )
    then
      return query select 'WITHDRAWAL_LEDGER_UNAVAILABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
      return;
    end if;

    v_journal_type := case
      when v_previous_status = 'RESERVED' then 'ADMIN_WITHDRAWAL_CANCELED'
      else 'ADMIN_WITHDRAWAL_APPROVAL_CANCELED'
    end;

    select posted.journal_id, posted.posted_at
      into v_journal_id, v_posted_at
    from private.post_ledger_journal(
      p_command_id,
      v_request.asset_id,
      v_journal_type,
      'ADMIN',
      v_actor_user_id,
      'WITHDRAWAL_REQUEST',
      v_request.id,
      v_reason,
      case
        when v_previous_status = 'RESERVED' then jsonb_build_array(
          jsonb_build_object('account_id', v_user_pending_account_id::text, 'side', 'DEBIT', 'units', v_request.requested_units::text),
          jsonb_build_object('account_id', v_user_available_account_id::text, 'side', 'CREDIT', 'units', v_request.requested_units::text)
        )
        else jsonb_build_array(
          jsonb_build_object('account_id', v_system_clearing_account_id::text, 'side', 'DEBIT', 'units', v_request.requested_units::text),
          jsonb_build_object('account_id', v_user_available_account_id::text, 'side', 'CREDIT', 'units', v_request.requested_units::text)
        )
      end
    ) as posted;
  end if;

  update private.withdrawal_requests as requests
  set
    status = 'CANCELED',
    cancellation_journal_id = v_journal_id,
    canceled_by = v_actor_user_id,
    canceled_at = clock_timestamp(),
    cancellation_actor_type = 'ADMIN',
    canceled_from_status = v_previous_status
  where requests.id = v_request.id
  returning * into v_request;

  insert into private.withdrawal_command_audit_events as inserted_events (
    command_id, action, outcome, actor_user_id, actor_type, target_user_id,
    wallet_account_id, asset_id, withdrawal_request_id, resulting_journal_id,
    reason, request_data, previous_status, resulting_status, units
  )
  values (
    p_command_id, 'CANCEL_WITHDRAWAL_REQUEST', 'APPLIED', v_actor_user_id, 'ADMIN', v_request.requested_by,
    v_request.wallet_account_id, v_request.asset_id, v_request.id, v_journal_id,
    v_reason, v_request_data, v_previous_status, 'CANCELED', v_request.requested_units
  )
  returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_posted_at;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, v_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_posted_at;
end;
$$;

comment on function public.admin_cancel_user_payout_request(uuid, bigint, uuid, text) is
  'ACTIVE ADMIN AAL2 command to cancel REQUESTED, RESERVED, or APPROVED local manual withdrawals. REQUESTED cancel has no posting, RESERVED restores pending withdrawal to available, and APPROVED restores withdrawal clearing to available without custody settlement.';

create or replace function public.list_current_user_withdrawal_requests(
  p_limit integer default 50
)
returns table (
  withdrawal_request_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  asset_code text,
  symbol text,
  decimals smallint,
  requested_units text,
  status text,
  reservation_journal_id uuid,
  approval_journal_id uuid,
  cancellation_journal_id uuid,
  cancellation_actor_type text,
  canceled_from_status text,
  requested_at timestamptz,
  reserved_at timestamptz,
  approved_at timestamptz,
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
  v_user_id := private.withdrawal_require_active_user();
  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  select wallet_accounts.id into v_wallet_account_id
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.user_id = v_user_id;

  if not found then
    raise exception 'WITHDRAWAL_READ_FORBIDDEN'
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
      requests.reservation_journal_id,
      requests.approval_journal_id,
      requests.cancellation_journal_id,
      requests.cancellation_actor_type,
      requests.canceled_from_status,
      requests.requested_at,
      requests.reserved_at,
      requests.approved_at,
      requests.canceled_at,
      requests.version
    from private.withdrawal_requests as requests
    join public.supported_assets as assets
      on assets.id = requests.asset_id
    where requests.wallet_account_id = v_wallet_account_id
    order by requests.requested_at desc, requests.id desc
    limit v_limit;
end;
$$;

comment on function public.list_current_user_withdrawal_requests(integer) is
  'Authenticated ACTIVE user read RPC for caller-owned local manual withdrawal requests. It returns safe status and text unit fields only; no addresses, transaction IDs, cookies, tokens, or ledger account IDs are exposed.';

create or replace function public.list_admin_withdrawal_requests(
  p_limit integer default 100,
  p_before_withdrawal_request_id uuid default null
)
returns table (
  withdrawal_request_id uuid,
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
  reservation_journal_id uuid,
  approval_journal_id uuid,
  cancellation_journal_id uuid,
  reserved_by uuid,
  approved_by uuid,
  canceled_by uuid,
  cancellation_actor_type text,
  canceled_from_status text,
  requested_at timestamptz,
  reserved_at timestamptz,
  approved_at timestamptz,
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
  perform private.withdrawal_require_admin_aal2();
  v_limit := coalesce(p_limit, 100);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_withdrawal_request_id is not null then
    select requests.requested_at, requests.id
      into v_before_requested_at, v_before_id
    from private.withdrawal_requests as requests
    where requests.id = p_before_withdrawal_request_id;

    if not found then
      return;
    end if;
  end if;

  return query
    select
      requests.id,
      requests.requested_by,
      profiles.account_status,
      requests.wallet_account_id,
      wallet_accounts.status,
      requests.asset_id,
      assets.asset_code,
      assets.symbol,
      assets.decimals,
      requests.requested_units::text,
      requests.status,
      requests.reservation_journal_id,
      requests.approval_journal_id,
      requests.cancellation_journal_id,
      requests.reserved_by,
      requests.approved_by,
      requests.canceled_by,
      requests.cancellation_actor_type,
      requests.canceled_from_status,
      requests.requested_at,
      requests.reserved_at,
      requests.approved_at,
      requests.canceled_at,
      requests.version
    from private.withdrawal_requests as requests
    join public.wallet_accounts as wallet_accounts
      on wallet_accounts.id = requests.wallet_account_id
    join public.profiles as profiles
      on profiles.id = requests.requested_by
    join public.supported_assets as assets
      on assets.id = requests.asset_id
    where p_before_withdrawal_request_id is null
      or requests.requested_at < v_before_requested_at
      or (
        requests.requested_at = v_before_requested_at
        and requests.id < v_before_id
      )
    order by requests.requested_at desc, requests.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_withdrawal_requests(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for local manual withdrawal requests. It exposes request state and journal IDs for audit workflows, but no request_data, headers, credentials, blockchain address, withdrawal address, transaction ID, or settlement proof.';

create or replace function public.list_withdrawal_command_audit_events(
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
  withdrawal_request_id uuid,
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
  perform private.withdrawal_require_admin_aal2();
  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_event_id is not null then
    select events.occurred_at, events.id
      into v_before_occurred_at, v_before_id
    from private.withdrawal_command_audit_events as events
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
      events.withdrawal_request_id,
      events.resulting_journal_id,
      events.reason,
      events.previous_status,
      events.resulting_status,
      events.units::text,
      events.occurred_at
    from private.withdrawal_command_audit_events as events
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

comment on function public.list_withdrawal_command_audit_events(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for append-only withdrawal command audit events. The returned shape excludes request_data, cookies, tokens, credentials, addresses, blockchain identifiers, transaction IDs, and settlement proof.';

revoke execute on function public.create_user_payout_request(uuid, bigint, uuid, bigint, text, uuid)
  from public, anon, authenticated;

revoke execute on function public.cancel_current_user_payout_request(uuid, bigint, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.reserve_user_payout_request(uuid, bigint, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.approve_user_payout_request(uuid, bigint, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.admin_cancel_user_payout_request(uuid, bigint, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.list_current_user_withdrawal_requests(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_withdrawal_requests(integer, uuid)
  from public, anon, authenticated;

revoke execute on function public.list_withdrawal_command_audit_events(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.create_user_payout_request(uuid, bigint, uuid, bigint, text, uuid)
  to authenticated;

grant execute on function public.cancel_current_user_payout_request(uuid, bigint, uuid, text)
  to authenticated;

grant execute on function public.reserve_user_payout_request(uuid, bigint, uuid, text)
  to authenticated;

grant execute on function public.approve_user_payout_request(uuid, bigint, uuid, text)
  to authenticated;

grant execute on function public.admin_cancel_user_payout_request(uuid, bigint, uuid, text)
  to authenticated;

grant execute on function public.list_current_user_withdrawal_requests(integer)
  to authenticated;

grant execute on function public.list_admin_withdrawal_requests(integer, uuid)
  to authenticated;

grant execute on function public.list_withdrawal_command_audit_events(integer, uuid)
  to authenticated;
