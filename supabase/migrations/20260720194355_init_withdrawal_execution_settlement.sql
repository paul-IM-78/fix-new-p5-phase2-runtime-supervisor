create table private.withdrawal_execution_attempts (
  id uuid primary key default gen_random_uuid(),

  withdrawal_request_id uuid not null
    references private.withdrawal_requests (id) on delete restrict,

  attempt_no integer not null,
  status text not null default 'STARTED',
  evidence_reference_sha256 text not null,

  started_by uuid not null
    references public.profiles (id) on delete restrict,

  completed_by uuid null
    references public.profiles (id) on delete restrict,

  settlement_journal_id uuid null unique
    references private.ledger_journals (id) on delete restrict,

  failure_code text null,
  failure_reason text null,

  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint withdrawal_execution_attempts_attempt_no_check
    check (attempt_no >= 1),

  constraint withdrawal_execution_attempts_status_check
    check (status in ('STARTED', 'FAILED', 'SETTLED')),

  constraint withdrawal_execution_attempts_evidence_digest_check
    check (evidence_reference_sha256 ~ '^[0-9a-f]{64}$'),

  constraint withdrawal_execution_attempts_failure_code_check
    check (
      failure_code is null
      or (
        failure_code = pg_catalog.btrim(failure_code)
        and pg_catalog.char_length(failure_code) between 2 and 64
        and failure_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
      )
    ),

  constraint withdrawal_execution_attempts_failure_reason_check
    check (
      failure_reason is null
      or (
        failure_reason = pg_catalog.btrim(failure_reason)
        and pg_catalog.char_length(failure_reason) between 1 and 500
        and failure_reason !~ '[[:cntrl:]]'
        and failure_reason !~* '(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret|transaction[_ ]?id|transaction[_ ]?hash|signature|blockchain[_ ]?address|wallet[_ ]?address|withdrawal[_ ]?address|destination[_ ]?address|provider[_ ]?response)'
      )
    ),

  constraint withdrawal_execution_attempts_version_check
    check (version >= 1),

  constraint withdrawal_execution_attempts_time_check
    check (
      completed_at is null
      or completed_at >= started_at
    ),

  constraint withdrawal_execution_attempts_status_shape_check
    check (
      (
        status = 'STARTED'
        and completed_by is null
        and completed_at is null
        and settlement_journal_id is null
        and failure_code is null
        and failure_reason is null
      )
      or (
        status = 'FAILED'
        and completed_by is not null
        and completed_at is not null
        and settlement_journal_id is null
        and failure_code is not null
        and failure_reason is not null
      )
      or (
        status = 'SETTLED'
        and completed_by is not null
        and completed_at is not null
        and settlement_journal_id is not null
        and failure_code is null
        and failure_reason is null
      )
    )
);

comment on table private.withdrawal_execution_attempts is
  'Private local manual withdrawal execution attempt history. Raw external evidence references are never stored; only a global SHA-256 digest is retained.';

create unique index withdrawal_execution_attempts_request_attempt_no_uidx
  on private.withdrawal_execution_attempts (withdrawal_request_id, attempt_no);

create unique index withdrawal_execution_attempts_evidence_digest_uidx
  on private.withdrawal_execution_attempts (evidence_reference_sha256);

create unique index withdrawal_execution_attempts_active_uidx
  on private.withdrawal_execution_attempts (withdrawal_request_id)
  where status = 'STARTED';

create index withdrawal_execution_attempts_request_started_idx
  on private.withdrawal_execution_attempts (withdrawal_request_id, started_at desc, id desc);

create index withdrawal_execution_attempts_status_started_idx
  on private.withdrawal_execution_attempts (status, started_at desc, id desc);

revoke all privileges on table private.withdrawal_execution_attempts
  from public, anon, authenticated;

create or replace function private.withdrawal_evidence_reference_sha256(
  p_evidence_reference text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reference text;
begin
  if p_evidence_reference is null then
    return null;
  end if;

  v_reference := p_evidence_reference;

  if v_reference <> pg_catalog.btrim(v_reference)
    or pg_catalog.char_length(v_reference) < 8
    or pg_catalog.char_length(v_reference) > 200
    or v_reference ~ '[[:space:]]'
    or v_reference ~ '[[:cntrl:]]'
    or v_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$'
  then
    return null;
  end if;

  return encode(
    extensions.digest(
      pg_catalog.convert_to(v_reference, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
end;
$$;

create or replace function private.withdrawal_normalize_failure_code(
  p_failure_code text
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_failure_code text;
begin
  v_failure_code := pg_catalog.btrim(p_failure_code);

  if v_failure_code is null
    or v_failure_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
    or pg_catalog.char_length(v_failure_code) < 2
    or pg_catalog.char_length(v_failure_code) > 64
  then
    return null;
  end if;

  return v_failure_code;
end;
$$;

create or replace function private.withdrawal_normalize_failure_reason(
  p_failure_reason text
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_failure_reason text;
begin
  v_failure_reason := pg_catalog.btrim(p_failure_reason);

  if v_failure_reason is null
    or v_failure_reason = ''
    or pg_catalog.char_length(v_failure_reason) > 500
    or v_failure_reason ~ '[[:cntrl:]]'
    or v_failure_reason ~* '(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret|transaction[_ ]?id|transaction[_ ]?hash|signature|blockchain[_ ]?address|wallet[_ ]?address|withdrawal[_ ]?address|destination[_ ]?address|provider[_ ]?response)'
  then
    return null;
  end if;

  return v_failure_reason;
end;
$$;

revoke execute on function private.withdrawal_evidence_reference_sha256(text)
  from public, anon, authenticated;

revoke execute on function private.withdrawal_normalize_failure_code(text)
  from public, anon, authenticated;

revoke execute on function private.withdrawal_normalize_failure_reason(text)
  from public, anon, authenticated;

create or replace function private.validate_withdrawal_execution_attempt_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.withdrawal_request_id is distinct from old.withdrawal_request_id
    or new.attempt_no is distinct from old.attempt_no
    or new.evidence_reference_sha256 is distinct from old.evidence_reference_sha256
    or new.started_by is distinct from old.started_by
    or new.started_at is distinct from old.started_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'WITHDRAWAL_EXECUTION_ATTEMPT_TRANSITION_INVALID'
      using errcode = '23514';
  end if;

  if old.status in ('FAILED', 'SETTLED')
    or new.status = old.status
    or new.status not in ('FAILED', 'SETTLED')
  then
    raise exception 'WITHDRAWAL_EXECUTION_ATTEMPT_TRANSITION_INVALID'
      using errcode = '23514';
  end if;

  if old.status = 'STARTED' and new.status = 'FAILED' then
    if new.completed_by is null
      or new.completed_at is null
      or new.settlement_journal_id is not null
      or new.failure_code is null
      or new.failure_reason is null
    then
      raise exception 'WITHDRAWAL_EXECUTION_ATTEMPT_TRANSITION_INVALID'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'STARTED' and new.status = 'SETTLED' then
    if new.completed_by is null
      or new.completed_at is null
      or new.settlement_journal_id is null
      or new.failure_code is not null
      or new.failure_reason is not null
    then
      raise exception 'WITHDRAWAL_EXECUTION_ATTEMPT_TRANSITION_INVALID'
        using errcode = '23514';
    end if;

    return new;
  end if;

  raise exception 'WITHDRAWAL_EXECUTION_ATTEMPT_TRANSITION_INVALID'
    using errcode = '23514';
end;
$$;

comment on function private.validate_withdrawal_execution_attempt_transition() is
  'Protects local withdrawal execution attempts. STARTED may become FAILED or SETTLED exactly once; evidence digest and start metadata cannot be rewritten.';

revoke execute on function private.validate_withdrawal_execution_attempt_transition()
  from public, anon, authenticated;

create trigger touch_withdrawal_execution_attempts_version
  before update on private.withdrawal_execution_attempts
  for each row
  execute function private.touch_versioned_record();

create trigger validate_withdrawal_execution_attempt_transition
  before update on private.withdrawal_execution_attempts
  for each row
  execute function private.validate_withdrawal_execution_attempt_transition();

create or replace function private.prevent_withdrawal_execution_attempt_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'WITHDRAWAL_EXECUTION_ATTEMPT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_withdrawal_execution_attempt_deletion() is
  'Blocks DELETE and TRUNCATE for immutable withdrawal execution attempt history without exposing digests or request identifiers.';

revoke execute on function private.prevent_withdrawal_execution_attempt_deletion()
  from public, anon, authenticated;

create trigger protect_withdrawal_execution_attempts
  before delete or truncate
  on private.withdrawal_execution_attempts
  for each statement
  execute function private.prevent_withdrawal_execution_attempt_deletion();

alter table private.withdrawal_requests
  add column latest_execution_attempt_id uuid null,
  add column settlement_journal_id uuid null unique;

alter table private.withdrawal_requests
  add constraint withdrawal_requests_latest_execution_attempt_fk
    foreign key (latest_execution_attempt_id)
    references private.withdrawal_execution_attempts (id)
    on delete restrict,
  add constraint withdrawal_requests_settlement_journal_fk
    foreign key (settlement_journal_id)
    references private.ledger_journals (id)
    on delete restrict;

drop index private.withdrawal_requests_open_wallet_asset_uidx;

create unique index withdrawal_requests_open_wallet_asset_uidx
  on private.withdrawal_requests (wallet_account_id, asset_id)
  where status in ('REQUESTED', 'RESERVED', 'APPROVED', 'EXECUTING', 'FAILED');

alter table private.withdrawal_requests
  drop constraint withdrawal_requests_status_check,
  drop constraint withdrawal_requests_canceled_from_status_check,
  drop constraint withdrawal_requests_time_check,
  drop constraint withdrawal_requests_status_shape_check,
  add constraint withdrawal_requests_status_check
    check (status in ('REQUESTED', 'RESERVED', 'APPROVED', 'EXECUTING', 'FAILED', 'SETTLED', 'CANCELED')),
  add constraint withdrawal_requests_canceled_from_status_check
    check (
      canceled_from_status is null
      or canceled_from_status in ('REQUESTED', 'RESERVED', 'APPROVED', 'FAILED')
    ),
  add constraint withdrawal_requests_time_check
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
      and (
        canceled_from_status <> 'FAILED'
        or approved_at is not null and canceled_at >= approved_at
      )
    ),
  add constraint withdrawal_requests_status_shape_check
    check (
      (
        status = 'REQUESTED'
        and reservation_journal_id is null
        and approval_journal_id is null
        and cancellation_journal_id is null
        and settlement_journal_id is null
        and latest_execution_attempt_id is null
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
        and settlement_journal_id is null
        and latest_execution_attempt_id is null
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
        and settlement_journal_id is null
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
        status = 'EXECUTING'
        and reservation_journal_id is not null
        and approval_journal_id is not null
        and cancellation_journal_id is null
        and settlement_journal_id is null
        and latest_execution_attempt_id is not null
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
        status = 'FAILED'
        and reservation_journal_id is not null
        and approval_journal_id is not null
        and cancellation_journal_id is null
        and settlement_journal_id is null
        and latest_execution_attempt_id is not null
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
        status = 'SETTLED'
        and reservation_journal_id is not null
        and approval_journal_id is not null
        and cancellation_journal_id is null
        and settlement_journal_id is not null
        and latest_execution_attempt_id is not null
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
        and settlement_journal_id is null
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
            and latest_execution_attempt_id is null
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
            and latest_execution_attempt_id is null
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
            and latest_execution_attempt_id is null
            and reserved_by is not null
            and approved_by is not null
            and reserved_at is not null
            and approved_at is not null
          )
          or (
            canceled_from_status = 'FAILED'
            and reservation_journal_id is not null
            and approval_journal_id is not null
            and cancellation_journal_id is not null
            and latest_execution_attempt_id is not null
            and reserved_by is not null
            and approved_by is not null
            and reserved_at is not null
            and approved_at is not null
          )
        )
      )
    );

comment on table private.withdrawal_requests is
  'Private local manual withdrawal request state machine. APPROVED may enter EXECUTING, FAILED can retry or cancel, and SETTLED records internal ledger settlement without storing raw evidence or claiming blockchain verification.';

alter table private.withdrawal_command_audit_events
  add column execution_attempt_id uuid null
    references private.withdrawal_execution_attempts (id) on delete restrict;

create index withdrawal_command_audit_execution_attempt_idx
  on private.withdrawal_command_audit_events (execution_attempt_id)
  where execution_attempt_id is not null;

alter table private.withdrawal_command_audit_events
  drop constraint withdrawal_command_audit_events_action_check,
  drop constraint withdrawal_command_audit_events_status_check,
  drop constraint withdrawal_command_audit_events_shape_check,
  add constraint withdrawal_command_audit_events_action_check
    check (action in (
      'CREATE_WITHDRAWAL_REQUEST',
      'RESERVE_WITHDRAWAL_REQUEST',
      'APPROVE_WITHDRAWAL_REQUEST',
      'CANCEL_WITHDRAWAL_REQUEST',
      'START_WITHDRAWAL_EXECUTION',
      'FAIL_WITHDRAWAL_EXECUTION',
      'SETTLE_WITHDRAWAL_EXECUTION'
    )),
  add constraint withdrawal_command_audit_events_status_check
    check (
      (previous_status is null or previous_status in ('REQUESTED', 'RESERVED', 'APPROVED', 'EXECUTING', 'FAILED', 'SETTLED', 'CANCELED'))
      and resulting_status in ('REQUESTED', 'RESERVED', 'APPROVED', 'EXECUTING', 'FAILED', 'SETTLED', 'CANCELED')
    ),
  add constraint withdrawal_command_audit_events_shape_check
    check (
      (
        action = 'CREATE_WITHDRAWAL_REQUEST'
        and execution_attempt_id is null
        and actor_type = 'USER'
        and outcome = 'APPLIED'
        and previous_status is null
        and resulting_status = 'REQUESTED'
        and resulting_journal_id is null
      )
      or (
        action = 'RESERVE_WITHDRAWAL_REQUEST'
        and execution_attempt_id is null
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
        and execution_attempt_id is null
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
        and execution_attempt_id is null
        and (
          (
            outcome = 'APPLIED'
            and previous_status in ('REQUESTED', 'RESERVED', 'APPROVED', 'FAILED')
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
      or (
        action = 'START_WITHDRAWAL_EXECUTION'
        and actor_type = 'ADMIN'
        and execution_attempt_id is not null
        and resulting_journal_id is null
        and (
          (
            outcome = 'APPLIED'
            and previous_status in ('APPROVED', 'FAILED')
            and resulting_status = 'EXECUTING'
          )
          or (
            outcome = 'NOOP'
            and previous_status = 'EXECUTING'
            and resulting_status = 'EXECUTING'
          )
        )
      )
      or (
        action = 'FAIL_WITHDRAWAL_EXECUTION'
        and actor_type = 'ADMIN'
        and execution_attempt_id is not null
        and resulting_journal_id is null
        and (
          (
            outcome = 'APPLIED'
            and previous_status = 'EXECUTING'
            and resulting_status = 'FAILED'
          )
          or (
            outcome = 'NOOP'
            and previous_status = 'FAILED'
            and resulting_status = 'FAILED'
          )
        )
      )
      or (
        action = 'SETTLE_WITHDRAWAL_EXECUTION'
        and actor_type = 'ADMIN'
        and execution_attempt_id is not null
        and resulting_journal_id is not null
        and (
          (
            outcome = 'APPLIED'
            and previous_status = 'EXECUTING'
            and resulting_status = 'SETTLED'
          )
          or (
            outcome = 'NOOP'
            and previous_status = 'SETTLED'
            and resulting_status = 'SETTLED'
          )
        )
      )
    );

comment on table private.withdrawal_command_audit_events is
  'Append-only local manual withdrawal command audit. It records request, execution, failure, settlement, and no-op outcomes without raw evidence, headers, credentials, blockchain identifiers, transaction IDs, addresses, or service-role data.';

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

  if old.status in ('CANCELED', 'SETTLED')
    or new.status = old.status
    or new.status not in ('RESERVED', 'APPROVED', 'EXECUTING', 'FAILED', 'SETTLED', 'CANCELED')
  then
    raise exception 'WITHDRAWAL_REQUEST_TRANSITION_INVALID'
      using errcode = '23514';
  end if;

  if old.status = 'REQUESTED' and new.status = 'RESERVED' then
    if old.reservation_journal_id is not null
      or old.approval_journal_id is not null
      or old.cancellation_journal_id is not null
      or old.settlement_journal_id is not null
      or old.latest_execution_attempt_id is not null
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
      or new.settlement_journal_id is not null
      or new.latest_execution_attempt_id is not null
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
      or new.settlement_journal_id is not null
      or new.latest_execution_attempt_id is not null
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

  if old.status in ('APPROVED', 'FAILED') and new.status = 'EXECUTING' then
    if new.reservation_journal_id is distinct from old.reservation_journal_id
      or new.approval_journal_id is distinct from old.approval_journal_id
      or new.cancellation_journal_id is not null
      or new.settlement_journal_id is not null
      or new.latest_execution_attempt_id is null
      or new.reserved_by is distinct from old.reserved_by
      or new.approved_by is distinct from old.approved_by
      or new.reserved_at is distinct from old.reserved_at
      or new.approved_at is distinct from old.approved_at
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

  if old.status = 'EXECUTING' and new.status = 'FAILED' then
    if new.reservation_journal_id is distinct from old.reservation_journal_id
      or new.approval_journal_id is distinct from old.approval_journal_id
      or new.cancellation_journal_id is not null
      or new.settlement_journal_id is not null
      or new.latest_execution_attempt_id is distinct from old.latest_execution_attempt_id
      or new.reserved_by is distinct from old.reserved_by
      or new.approved_by is distinct from old.approved_by
      or new.reserved_at is distinct from old.reserved_at
      or new.approved_at is distinct from old.approved_at
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

  if old.status = 'EXECUTING' and new.status = 'SETTLED' then
    if new.reservation_journal_id is distinct from old.reservation_journal_id
      or new.approval_journal_id is distinct from old.approval_journal_id
      or new.cancellation_journal_id is not null
      or new.settlement_journal_id is null
      or new.latest_execution_attempt_id is distinct from old.latest_execution_attempt_id
      or new.reserved_by is distinct from old.reserved_by
      or new.approved_by is distinct from old.approved_by
      or new.reserved_at is distinct from old.reserved_at
      or new.approved_at is distinct from old.approved_at
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
    and old.status in ('REQUESTED', 'RESERVED', 'APPROVED', 'FAILED')
  then
    if new.canceled_by is null
      or new.canceled_at is null
      or new.cancellation_actor_type not in ('USER', 'ADMIN')
      or new.canceled_from_status is distinct from old.status
      or new.settlement_journal_id is not null
      or (
        old.status = 'REQUESTED'
        and (
          new.reservation_journal_id is not null
          or new.approval_journal_id is not null
          or new.cancellation_journal_id is not null
          or new.latest_execution_attempt_id is not null
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
          or new.latest_execution_attempt_id is not null
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
          or new.latest_execution_attempt_id is not null
          or new.cancellation_journal_id is null
        )
      )
      or (
        old.status = 'FAILED'
        and (
          new.reservation_journal_id is distinct from old.reservation_journal_id
          or new.approval_journal_id is distinct from old.approval_journal_id
          or new.reserved_by is distinct from old.reserved_by
          or new.approved_by is distinct from old.approved_by
          or new.reserved_at is distinct from old.reserved_at
          or new.approved_at is distinct from old.approved_at
          or new.latest_execution_attempt_id is distinct from old.latest_execution_attempt_id
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
  'Protects withdrawal request transitions through execution and settlement. SETTLED and CANCELED are terminal, EXECUTING cannot be canceled directly, and core fields cannot be rewritten.';

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

  if new.status in ('RESERVED', 'APPROVED', 'EXECUTING', 'FAILED', 'SETTLED')
    or (
      new.status = 'CANCELED'
      and new.canceled_from_status in ('RESERVED', 'APPROVED', 'FAILED')
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

  if new.status in ('APPROVED', 'EXECUTING', 'FAILED', 'SETTLED')
    or (
      new.status = 'CANCELED'
      and new.canceled_from_status in ('APPROVED', 'FAILED')
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
  elsif new.status = 'CANCELED' and new.canceled_from_status = 'APPROVED' then
    v_cancel_lines := jsonb_build_array(
      jsonb_build_object('side', 'DEBIT', 'account_scope', 'SYSTEM', 'account_purpose', 'SYSTEM_WITHDRAWAL_CLEARING'),
      jsonb_build_object('side', 'CREDIT', 'account_scope', 'USER', 'account_purpose', 'USER_AVAILABLE')
    );
    v_cancel_journal_type := 'ADMIN_WITHDRAWAL_APPROVAL_CANCELED';
  elsif new.status = 'CANCELED' and new.canceled_from_status = 'FAILED' then
    v_cancel_lines := jsonb_build_array(
      jsonb_build_object('side', 'DEBIT', 'account_scope', 'SYSTEM', 'account_purpose', 'SYSTEM_WITHDRAWAL_CLEARING'),
      jsonb_build_object('side', 'CREDIT', 'account_scope', 'USER', 'account_purpose', 'USER_AVAILABLE')
    );
    v_cancel_journal_type := 'ADMIN_WITHDRAWAL_FAILED_CANCELED';
  end if;

  if v_cancel_lines is not null
    and not private.withdrawal_journal_shape_matches(
      new.cancellation_journal_id,
      new.id,
      new.wallet_account_id,
      new.asset_id,
      new.requested_units,
      v_cancel_journal_type,
      'ADMIN',
      new.canceled_by,
      v_cancel_lines
    )
  then
    raise exception 'WITHDRAWAL_REQUEST_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function private.validate_withdrawal_request_invariants() is
  'Deferred validator for local withdrawal request ledger shapes including execution, settlement, and FAILED cancellation extensions.';

create or replace function private.withdrawal_execution_journal_shape_matches(
  p_journal_id uuid,
  p_execution_attempt_id uuid,
  p_asset_id uuid,
  p_units private.positive_atomic_units,
  p_initiator_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actual_count integer;
begin
  if p_journal_id is null
    or p_execution_attempt_id is null
    or p_asset_id is null
    or p_units is null
    or p_initiator_user_id is null
  then
    return false;
  end if;

  if not exists (
    select 1
    from private.ledger_journals as journals
    where journals.id = p_journal_id
      and journals.asset_id = p_asset_id
      and journals.journal_type = 'ADMIN_WITHDRAWAL_SETTLED'
      and journals.initiator_type = 'ADMIN'
      and journals.initiator_user_id = p_initiator_user_id
      and journals.reference_type = 'WITHDRAWAL_EXECUTION_ATTEMPT'
      and journals.reference_id = p_execution_attempt_id
  ) then
    return false;
  end if;

  select count(*)::integer
    into v_actual_count
  from private.ledger_entries as entries
  where entries.journal_id = p_journal_id;

  if v_actual_count <> 2 then
    return false;
  end if;

  return exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = p_journal_id
      and entries.side = 'DEBIT'
      and entries.units = p_units
      and accounts.asset_id = p_asset_id
      and accounts.account_scope = 'SYSTEM'
      and accounts.wallet_account_id is null
      and accounts.account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = p_journal_id
      and entries.side = 'CREDIT'
      and entries.units = p_units
      and accounts.asset_id = p_asset_id
      and accounts.account_scope = 'SYSTEM'
      and accounts.wallet_account_id is null
      and accounts.account_purpose = 'SYSTEM_CUSTODY'
  )
  and not exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = p_journal_id
      and accounts.account_scope = 'USER'
  );
end;
$$;

revoke execute on function private.withdrawal_execution_journal_shape_matches(uuid, uuid, uuid, private.positive_atomic_units, uuid)
  from public, anon, authenticated;

create or replace function private.validate_withdrawal_execution_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.withdrawal_requests%rowtype;
  v_attempt private.withdrawal_execution_attempts%rowtype;
begin
  if tg_table_name = 'withdrawal_requests' then
    v_request := new;
  else
    select requests.*
      into v_request
    from private.withdrawal_requests as requests
    where requests.id = new.withdrawal_request_id;
  end if;

  if v_request.id is null then
    raise exception 'WITHDRAWAL_EXECUTION_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if v_request.status not in ('EXECUTING', 'FAILED', 'SETTLED')
    and not (
      v_request.status = 'CANCELED'
      and v_request.canceled_from_status = 'FAILED'
    )
  then
    return new;
  end if;

  if v_request.latest_execution_attempt_id is null then
    raise exception 'WITHDRAWAL_EXECUTION_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  select attempts.*
    into v_attempt
  from private.withdrawal_execution_attempts as attempts
  where attempts.id = v_request.latest_execution_attempt_id;

  if not found or v_attempt.withdrawal_request_id <> v_request.id then
    raise exception 'WITHDRAWAL_EXECUTION_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if v_request.status = 'EXECUTING' then
    if v_attempt.status <> 'STARTED'
      or v_request.settlement_journal_id is not null
      or v_request.reservation_journal_id is null
      or v_request.approval_journal_id is null
    then
      raise exception 'WITHDRAWAL_EXECUTION_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  elsif v_request.status = 'FAILED' then
    if v_attempt.status <> 'FAILED'
      or v_request.settlement_journal_id is not null
      or v_request.reservation_journal_id is null
      or v_request.approval_journal_id is null
    then
      raise exception 'WITHDRAWAL_EXECUTION_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  elsif v_request.status = 'SETTLED' then
    if v_attempt.status <> 'SETTLED'
      or v_request.settlement_journal_id is null
      or v_attempt.settlement_journal_id is distinct from v_request.settlement_journal_id
      or v_request.reservation_journal_id is null
      or v_request.approval_journal_id is null
      or v_request.cancellation_journal_id is not null
      or not private.withdrawal_execution_journal_shape_matches(
        v_request.settlement_journal_id,
        v_attempt.id,
        v_request.asset_id,
        v_request.requested_units,
        v_attempt.completed_by
      )
    then
      raise exception 'WITHDRAWAL_EXECUTION_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  elsif v_request.status = 'CANCELED' and v_request.canceled_from_status = 'FAILED' then
    if v_attempt.status <> 'FAILED'
      or v_request.settlement_journal_id is not null
      or v_request.cancellation_journal_id is null
    then
      raise exception 'WITHDRAWAL_EXECUTION_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.validate_withdrawal_execution_invariants() is
  'Deferred validator tying withdrawal EXECUTING, FAILED, SETTLED, and FAILED-canceled states to immutable execution attempts and exact settlement journal shape.';

revoke execute on function private.validate_withdrawal_execution_invariants()
  from public, anon, authenticated;

create constraint trigger validate_withdrawal_execution_request_invariants
  after insert or update on private.withdrawal_requests
  deferrable initially deferred
  for each row
  execute function private.validate_withdrawal_execution_invariants();

create constraint trigger validate_withdrawal_execution_attempt_invariants
  after insert or update on private.withdrawal_execution_attempts
  deferrable initially deferred
  for each row
  execute function private.validate_withdrawal_execution_invariants();

create or replace function private.withdrawal_system_balance_units(
  p_asset_id uuid,
  p_account_purpose text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(balances.balance_units), 0::numeric)
  from private.ledger_account_balances as balances
  where balances.asset_id = p_asset_id
    and balances.account_scope = 'SYSTEM'
    and balances.wallet_account_id is null
    and balances.account_purpose = p_account_purpose;
$$;

revoke execute on function private.withdrawal_system_balance_units(uuid, text)
  from public, anon, authenticated;

create or replace function public.start_user_payout_execution(
  p_withdrawal_request_id uuid,
  p_request_expected_version bigint,
  p_command_id uuid,
  p_reason text,
  p_evidence_reference text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  withdrawal_request_id uuid,
  execution_attempt_id uuid,
  journal_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  units text,
  status text,
  request_version bigint,
  attempt_version bigint,
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
  v_evidence_digest text;
  v_request_data jsonb;
  v_existing_event private.withdrawal_command_audit_events%rowtype;
  v_request private.withdrawal_requests%rowtype;
  v_attempt private.withdrawal_execution_attempts%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_profile public.profiles%rowtype;
  v_asset public.supported_assets%rowtype;
  v_attempt_no integer;
  v_custody_units numeric;
  v_clearing_exposure numeric;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.withdrawal_require_admin_aal2();
  v_reason := private.withdrawal_normalize_reason(p_reason);
  v_evidence_digest := private.withdrawal_evidence_reference_sha256(p_evidence_reference);

  if p_withdrawal_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_command_id is null
    or v_reason is null
    or v_evidence_digest is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'START_WITHDRAWAL_EXECUTION',
    'actor_type', 'ADMIN',
    'withdrawal_request_id', p_withdrawal_request_id::text,
    'request_expected_version', p_request_expected_version,
    'reason', v_reason,
    'evidence_reference_sha256', v_evidence_digest
  );

  perform private.withdrawal_lock();

  select events.* into v_existing_event
  from private.withdrawal_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'ADMIN'
      and v_existing_event.action = 'START_WITHDRAWAL_EXECUTION'
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
          attempts.id,
          null::uuid,
          requests.wallet_account_id,
          requests.asset_id,
          requests.requested_units::text,
          requests.status,
          requests.version,
          attempts.version,
          v_existing_event.occurred_at
        from private.withdrawal_requests as requests
        join private.withdrawal_execution_attempts as attempts
          on attempts.id = v_existing_event.execution_attempt_id
        where requests.id = v_existing_event.withdrawal_request_id;
      return;
    end if;

    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.withdrawal_execution_attempts as attempts
    where attempts.evidence_reference_sha256 = v_evidence_digest
  ) then
    return query select 'WITHDRAWAL_EVIDENCE_REFERENCE_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.withdrawal_requests as requests
  where requests.id = p_withdrawal_request_id
  for update;

  if not found then
    return query select 'WITHDRAWAL_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  if v_request.version <> p_request_expected_version then
    return query select 'WITHDRAWAL_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
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
    return query select 'WITHDRAWAL_TARGET_PROFILE_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  if v_wallet.id is null or v_wallet.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_WALLET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  if v_asset.id is null or v_asset.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_ASSET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  if v_request.status not in ('APPROVED', 'FAILED') then
    return query select 'WITHDRAWAL_REQUEST_NOT_EXECUTABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  perform private.ensure_system_ledger_accounts(v_request.asset_id);

  v_custody_units := private.withdrawal_system_balance_units(v_request.asset_id, 'SYSTEM_CUSTODY');
  v_clearing_exposure := greatest(
    -private.withdrawal_system_balance_units(v_request.asset_id, 'SYSTEM_WITHDRAWAL_CLEARING'),
    0::numeric
  );

  if v_custody_units < v_request.requested_units then
    return query select 'WITHDRAWAL_SETTLEMENT_INSUFFICIENT_CUSTODY'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  if v_clearing_exposure < v_request.requested_units then
    return query select 'WITHDRAWAL_SETTLEMENT_CLEARING_MISMATCH'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  select coalesce(max(attempts.attempt_no), 0) + 1
    into v_attempt_no
  from private.withdrawal_execution_attempts as attempts
  where attempts.withdrawal_request_id = v_request.id;

  insert into private.withdrawal_execution_attempts (
    withdrawal_request_id,
    attempt_no,
    evidence_reference_sha256,
    started_by
  )
  values (
    v_request.id,
    v_attempt_no,
    v_evidence_digest,
    v_actor_user_id
  )
  returning * into v_attempt;

  update private.withdrawal_requests as requests
  set
    status = 'EXECUTING',
    latest_execution_attempt_id = v_attempt.id
  where requests.id = v_request.id
  returning * into v_request;

  insert into private.withdrawal_command_audit_events as inserted_events (
    command_id, action, outcome, actor_user_id, actor_type, target_user_id,
    wallet_account_id, asset_id, withdrawal_request_id, execution_attempt_id,
    resulting_journal_id, reason, request_data, previous_status, resulting_status, units
  )
  values (
    p_command_id, 'START_WITHDRAWAL_EXECUTION', 'APPLIED', v_actor_user_id, 'ADMIN', v_request.requested_by,
    v_request.wallet_account_id, v_request.asset_id, v_request.id, v_attempt.id,
    null, v_reason, v_request_data,
    case when v_attempt_no = 1 then 'APPROVED' else 'FAILED' end,
    'EXECUTING',
    v_request.requested_units
  )
  returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_occurred_at;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_attempt.version, v_occurred_at;
end;
$$;

comment on function public.start_user_payout_execution(uuid, bigint, uuid, text, text) is
  'ACTIVE ADMIN AAL2 command to start a local manual withdrawal execution attempt from APPROVED or FAILED state. It stores only a SHA-256 evidence digest and posts no ledger journal.';

create or replace function public.fail_user_payout_execution(
  p_withdrawal_request_id uuid,
  p_request_expected_version bigint,
  p_execution_attempt_id uuid,
  p_attempt_expected_version bigint,
  p_command_id uuid,
  p_failure_code text,
  p_failure_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  withdrawal_request_id uuid,
  execution_attempt_id uuid,
  journal_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  units text,
  status text,
  request_version bigint,
  attempt_version bigint,
  occurred_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_failure_code text;
  v_failure_reason text;
  v_request_data jsonb;
  v_existing_event private.withdrawal_command_audit_events%rowtype;
  v_request private.withdrawal_requests%rowtype;
  v_attempt private.withdrawal_execution_attempts%rowtype;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  v_actor_user_id := private.withdrawal_require_admin_aal2();
  v_failure_code := private.withdrawal_normalize_failure_code(p_failure_code);
  v_failure_reason := private.withdrawal_normalize_failure_reason(p_failure_reason);

  if p_withdrawal_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_execution_attempt_id is null
    or p_attempt_expected_version is null
    or p_attempt_expected_version < 1
    or p_command_id is null
    or v_failure_code is null
    or v_failure_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, p_execution_attempt_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'FAIL_WITHDRAWAL_EXECUTION',
    'actor_type', 'ADMIN',
    'withdrawal_request_id', p_withdrawal_request_id::text,
    'request_expected_version', p_request_expected_version,
    'execution_attempt_id', p_execution_attempt_id::text,
    'attempt_expected_version', p_attempt_expected_version,
    'failure_code', v_failure_code,
    'failure_reason', v_failure_reason
  );

  perform private.withdrawal_lock();

  select events.* into v_existing_event
  from private.withdrawal_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'ADMIN'
      and v_existing_event.action = 'FAIL_WITHDRAWAL_EXECUTION'
      and v_existing_event.withdrawal_request_id = p_withdrawal_request_id
      and v_existing_event.execution_attempt_id = p_execution_attempt_id
      and v_existing_event.reason = v_failure_reason
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          v_existing_event.id,
          v_existing_event.command_id,
          requests.id,
          attempts.id,
          null::uuid,
          requests.wallet_account_id,
          requests.asset_id,
          requests.requested_units::text,
          requests.status,
          requests.version,
          attempts.version,
          v_existing_event.occurred_at
        from private.withdrawal_requests as requests
        join private.withdrawal_execution_attempts as attempts
          on attempts.id = v_existing_event.execution_attempt_id
        where requests.id = v_existing_event.withdrawal_request_id;
      return;
    end if;

    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, p_execution_attempt_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, p_execution_attempt_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.withdrawal_requests as requests
  where requests.id = p_withdrawal_request_id
  for update;

  if not found then
    return query select 'WITHDRAWAL_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, p_execution_attempt_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  if v_request.version <> p_request_expected_version then
    return query select 'WITHDRAWAL_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, p_execution_attempt_id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  select attempts.* into v_attempt
  from private.withdrawal_execution_attempts as attempts
  where attempts.id = p_execution_attempt_id
  for update;

  if not found or v_attempt.withdrawal_request_id <> v_request.id then
    return query select 'WITHDRAWAL_EXECUTION_ATTEMPT_NOT_FOUND'::text, false, null::uuid, p_command_id, v_request.id, p_execution_attempt_id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  if v_request.latest_execution_attempt_id is distinct from v_attempt.id then
    return query select 'WITHDRAWAL_EXECUTION_ATTEMPT_MISMATCH'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  if v_attempt.version <> p_attempt_expected_version then
    return query select 'WITHDRAWAL_EXECUTION_ATTEMPT_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  if v_request.status = 'FAILED' and v_attempt.status = 'FAILED' then
    insert into private.withdrawal_command_audit_events as inserted_events (
      command_id, action, outcome, actor_user_id, actor_type, target_user_id,
      wallet_account_id, asset_id, withdrawal_request_id, execution_attempt_id,
      resulting_journal_id, reason, request_data, previous_status, resulting_status, units
    )
    values (
      p_command_id, 'FAIL_WITHDRAWAL_EXECUTION', 'NOOP', v_actor_user_id, 'ADMIN', v_request.requested_by,
      v_request.wallet_account_id, v_request.asset_id, v_request.id, v_attempt.id,
      null, v_failure_reason, v_request_data, 'FAILED', 'FAILED', v_request.requested_units
    )
    returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_occurred_at;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_attempt.version, v_occurred_at;
    return;
  end if;

  if v_request.status <> 'EXECUTING' or v_attempt.status <> 'STARTED' then
    return query select 'WITHDRAWAL_EXECUTION_NOT_FAILABLE'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  update private.withdrawal_execution_attempts as attempts
  set
    status = 'FAILED',
    completed_by = v_actor_user_id,
    completed_at = clock_timestamp(),
    failure_code = v_failure_code,
    failure_reason = v_failure_reason
  where attempts.id = v_attempt.id
  returning * into v_attempt;

  update private.withdrawal_requests as requests
  set status = 'FAILED'
  where requests.id = v_request.id
  returning * into v_request;

  insert into private.withdrawal_command_audit_events as inserted_events (
    command_id, action, outcome, actor_user_id, actor_type, target_user_id,
    wallet_account_id, asset_id, withdrawal_request_id, execution_attempt_id,
    resulting_journal_id, reason, request_data, previous_status, resulting_status, units
  )
  values (
    p_command_id, 'FAIL_WITHDRAWAL_EXECUTION', 'APPLIED', v_actor_user_id, 'ADMIN', v_request.requested_by,
    v_request.wallet_account_id, v_request.asset_id, v_request.id, v_attempt.id,
    null, v_failure_reason, v_request_data, 'EXECUTING', 'FAILED', v_request.requested_units
  )
  returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_occurred_at;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_attempt.version, v_occurred_at;
end;
$$;

comment on function public.fail_user_payout_execution(uuid, bigint, uuid, bigint, uuid, text, text) is
  'ACTIVE ADMIN AAL2 command to mark a STARTED local withdrawal execution attempt as FAILED without posting a ledger journal or storing provider responses.';

create or replace function public.settle_user_payout_execution(
  p_withdrawal_request_id uuid,
  p_request_expected_version bigint,
  p_execution_attempt_id uuid,
  p_attempt_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  withdrawal_request_id uuid,
  execution_attempt_id uuid,
  journal_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  units text,
  status text,
  request_version bigint,
  attempt_version bigint,
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
  v_attempt private.withdrawal_execution_attempts%rowtype;
  v_profile public.profiles%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_asset public.supported_assets%rowtype;
  v_system_clearing_account_id uuid;
  v_system_custody_account_id uuid;
  v_custody_units numeric;
  v_clearing_exposure numeric;
  v_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
begin
  v_actor_user_id := private.withdrawal_require_admin_aal2();
  v_reason := private.withdrawal_normalize_reason(p_reason);

  if p_withdrawal_request_id is null
    or p_request_expected_version is null
    or p_request_expected_version < 1
    or p_execution_attempt_id is null
    or p_attempt_expected_version is null
    or p_attempt_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, p_execution_attempt_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'SETTLE_WITHDRAWAL_EXECUTION',
    'actor_type', 'ADMIN',
    'withdrawal_request_id', p_withdrawal_request_id::text,
    'request_expected_version', p_request_expected_version,
    'execution_attempt_id', p_execution_attempt_id::text,
    'attempt_expected_version', p_attempt_expected_version,
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
      and v_existing_event.action = 'SETTLE_WITHDRAWAL_EXECUTION'
      and v_existing_event.withdrawal_request_id = p_withdrawal_request_id
      and v_existing_event.execution_attempt_id = p_execution_attempt_id
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
          attempts.id,
          v_existing_event.resulting_journal_id,
          requests.wallet_account_id,
          requests.asset_id,
          requests.requested_units::text,
          requests.status,
          requests.version,
          attempts.version,
          v_existing_event.occurred_at
        from private.withdrawal_requests as requests
        join private.withdrawal_execution_attempts as attempts
          on attempts.id = v_existing_event.execution_attempt_id
        where requests.id = v_existing_event.withdrawal_request_id;
      return;
    end if;

    return query select 'WITHDRAWAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, p_execution_attempt_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  select requests.* into v_request
  from private.withdrawal_requests as requests
  where requests.id = p_withdrawal_request_id
  for update;

  if not found then
    return query select 'WITHDRAWAL_REQUEST_NOT_FOUND'::text, false, null::uuid, p_command_id, p_withdrawal_request_id, p_execution_attempt_id, null::uuid, null::uuid, null::uuid, null::text, null::text, null::bigint, null::bigint, null::timestamptz;
    return;
  end if;

  if v_request.version <> p_request_expected_version then
    return query select 'WITHDRAWAL_REQUEST_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, p_execution_attempt_id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  select attempts.* into v_attempt
  from private.withdrawal_execution_attempts as attempts
  where attempts.id = p_execution_attempt_id
  for update;

  if not found or v_attempt.withdrawal_request_id <> v_request.id then
    return query select 'WITHDRAWAL_EXECUTION_ATTEMPT_NOT_FOUND'::text, false, null::uuid, p_command_id, v_request.id, p_execution_attempt_id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::bigint, null::timestamptz;
    return;
  end if;

  if v_request.latest_execution_attempt_id is distinct from v_attempt.id then
    return query select 'WITHDRAWAL_EXECUTION_ATTEMPT_MISMATCH'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  if v_attempt.version <> p_attempt_expected_version then
    return query select 'WITHDRAWAL_EXECUTION_ATTEMPT_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  if v_request.status = 'SETTLED' and v_attempt.status = 'SETTLED' then
    insert into private.withdrawal_command_audit_events as inserted_events (
      command_id, action, outcome, actor_user_id, actor_type, target_user_id,
      wallet_account_id, asset_id, withdrawal_request_id, execution_attempt_id,
      resulting_journal_id, reason, request_data, previous_status, resulting_status, units
    )
    values (
      p_command_id, 'SETTLE_WITHDRAWAL_EXECUTION', 'NOOP', v_actor_user_id, 'ADMIN', v_request.requested_by,
      v_request.wallet_account_id, v_request.asset_id, v_request.id, v_attempt.id,
      v_request.settlement_journal_id, v_reason, v_request_data, 'SETTLED', 'SETTLED', v_request.requested_units
    )
    returning inserted_events.id, inserted_events.occurred_at into v_event_id, v_posted_at;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, v_request.id, v_attempt.id, v_request.settlement_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_attempt.version, v_posted_at;
    return;
  end if;

  if v_request.status <> 'EXECUTING' or v_attempt.status <> 'STARTED' then
    return query select 'WITHDRAWAL_EXECUTION_NOT_SETTLEABLE'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
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
    return query select 'WITHDRAWAL_TARGET_PROFILE_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  if v_wallet.id is null or v_wallet.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_WALLET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  if v_asset.id is null or v_asset.status <> 'ACTIVE' then
    return query select 'WITHDRAWAL_TARGET_ASSET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  perform private.ensure_system_ledger_accounts(v_request.asset_id);

  select
    (max(accounts.id::text) filter (where accounts.account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'))::uuid,
    (max(accounts.id::text) filter (where accounts.account_purpose = 'SYSTEM_CUSTODY'))::uuid
    into v_system_clearing_account_id, v_system_custody_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'SYSTEM'
    and accounts.wallet_account_id is null
    and accounts.asset_id = v_request.asset_id
    and accounts.account_purpose in ('SYSTEM_WITHDRAWAL_CLEARING', 'SYSTEM_CUSTODY');

  if v_system_clearing_account_id is null or v_system_custody_account_id is null then
    return query select 'WITHDRAWAL_LEDGER_UNAVAILABLE'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  v_custody_units := private.withdrawal_system_balance_units(v_request.asset_id, 'SYSTEM_CUSTODY');
  v_clearing_exposure := greatest(
    -private.withdrawal_system_balance_units(v_request.asset_id, 'SYSTEM_WITHDRAWAL_CLEARING'),
    0::numeric
  );

  if v_custody_units < v_request.requested_units then
    return query select 'WITHDRAWAL_SETTLEMENT_INSUFFICIENT_CUSTODY'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  if v_clearing_exposure < v_request.requested_units then
    return query select 'WITHDRAWAL_SETTLEMENT_CLEARING_MISMATCH'::text, false, null::uuid, p_command_id, v_request.id, v_attempt.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_attempt.version, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_journal_id, v_posted_at
  from private.post_ledger_journal(
    p_command_id,
    v_request.asset_id,
    'ADMIN_WITHDRAWAL_SETTLED',
    'ADMIN',
    v_actor_user_id,
    'WITHDRAWAL_EXECUTION_ATTEMPT',
    v_attempt.id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object('account_id', v_system_clearing_account_id::text, 'side', 'DEBIT', 'units', v_request.requested_units::text),
      jsonb_build_object('account_id', v_system_custody_account_id::text, 'side', 'CREDIT', 'units', v_request.requested_units::text)
    )
  ) as posted;

  update private.withdrawal_execution_attempts as attempts
  set
    status = 'SETTLED',
    completed_by = v_actor_user_id,
    completed_at = clock_timestamp(),
    settlement_journal_id = v_journal_id
  where attempts.id = v_attempt.id
  returning * into v_attempt;

  update private.withdrawal_requests as requests
  set
    status = 'SETTLED',
    settlement_journal_id = v_journal_id
  where requests.id = v_request.id
  returning * into v_request;

  insert into private.withdrawal_command_audit_events as inserted_events (
    command_id, action, outcome, actor_user_id, actor_type, target_user_id,
    wallet_account_id, asset_id, withdrawal_request_id, execution_attempt_id,
    resulting_journal_id, reason, request_data, previous_status, resulting_status, units
  )
  values (
    p_command_id, 'SETTLE_WITHDRAWAL_EXECUTION', 'APPLIED', v_actor_user_id, 'ADMIN', v_request.requested_by,
    v_request.wallet_account_id, v_request.asset_id, v_request.id, v_attempt.id,
    v_journal_id, v_reason, v_request_data, 'EXECUTING', 'SETTLED', v_request.requested_units
  )
  returning inserted_events.id into v_event_id;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_request.id, v_attempt.id, v_journal_id, v_request.wallet_account_id, v_request.asset_id, v_request.requested_units::text, v_request.status, v_request.version, v_attempt.version, v_posted_at;
end;
$$;

comment on function public.settle_user_payout_execution(uuid, bigint, uuid, bigint, uuid, text) is
  'ACTIVE ADMIN AAL2 command to record internal settlement for a STARTED local withdrawal execution attempt. It posts clearing to custody and does not verify blockchain data.';

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

  if v_request.status not in ('REQUESTED', 'RESERVED', 'APPROVED', 'FAILED') then
    return query select 'WITHDRAWAL_REQUEST_NOT_CANCELABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
    return;
  end if;

  v_previous_status := v_request.status;

  if v_previous_status in ('RESERVED', 'APPROVED', 'FAILED') then
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
        v_previous_status in ('APPROVED', 'FAILED')
        and v_system_clearing_account_id is null
      )
    then
      return query select 'WITHDRAWAL_LEDGER_UNAVAILABLE'::text, false, null::uuid, p_command_id, v_request.id, null::uuid, v_request.wallet_account_id, v_request.asset_id, null::text, v_request.status, v_request.version, null::timestamptz;
      return;
    end if;

    v_journal_type := case
      when v_previous_status = 'RESERVED' then 'ADMIN_WITHDRAWAL_CANCELED'
      when v_previous_status = 'FAILED' then 'ADMIN_WITHDRAWAL_FAILED_CANCELED'
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
  'ACTIVE ADMIN AAL2 command to cancel REQUESTED, RESERVED, APPROVED, or FAILED local manual withdrawals. FAILED cancellation restores withdrawal clearing to available without custody settlement.';

drop function public.list_current_user_withdrawal_requests(integer);

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
  settlement_journal_id uuid,
  cancellation_actor_type text,
  canceled_from_status text,
  latest_execution_status text,
  latest_execution_attempt_no integer,
  requested_at timestamptz,
  reserved_at timestamptz,
  approved_at timestamptz,
  canceled_at timestamptz,
  execution_completed_at timestamptz,
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
      requests.settlement_journal_id,
      requests.cancellation_actor_type,
      requests.canceled_from_status,
      attempts.status,
      attempts.attempt_no,
      requests.requested_at,
      requests.reserved_at,
      requests.approved_at,
      requests.canceled_at,
      attempts.completed_at,
      requests.version
    from private.withdrawal_requests as requests
    join public.supported_assets as assets
      on assets.id = requests.asset_id
    left join private.withdrawal_execution_attempts as attempts
      on attempts.id = requests.latest_execution_attempt_id
    where requests.wallet_account_id = v_wallet_account_id
    order by requests.requested_at desc, requests.id desc
    limit v_limit;
end;
$$;

comment on function public.list_current_user_withdrawal_requests(integer) is
  'Authenticated ACTIVE user read RPC for caller-owned local manual withdrawal requests. It returns safe status and text unit fields only; no raw evidence, digest, addresses, transaction IDs, cookies, tokens, or ledger account IDs are exposed.';

drop function public.list_admin_withdrawal_requests(integer, uuid);

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
  settlement_journal_id uuid,
  latest_execution_attempt_id uuid,
  latest_execution_status text,
  latest_execution_attempt_no integer,
  latest_execution_attempt_version bigint,
  reserved_by uuid,
  approved_by uuid,
  canceled_by uuid,
  cancellation_actor_type text,
  canceled_from_status text,
  requested_at timestamptz,
  reserved_at timestamptz,
  approved_at timestamptz,
  canceled_at timestamptz,
  execution_completed_at timestamptz,
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
      requests.settlement_journal_id,
      requests.latest_execution_attempt_id,
      attempts.status,
      attempts.attempt_no,
      attempts.version,
      requests.reserved_by,
      requests.approved_by,
      requests.canceled_by,
      requests.cancellation_actor_type,
      requests.canceled_from_status,
      requests.requested_at,
      requests.reserved_at,
      requests.approved_at,
      requests.canceled_at,
      attempts.completed_at,
      requests.version
    from private.withdrawal_requests as requests
    join public.wallet_accounts as wallet_accounts
      on wallet_accounts.id = requests.wallet_account_id
    join public.profiles as profiles
      on profiles.id = requests.requested_by
    join public.supported_assets as assets
      on assets.id = requests.asset_id
    left join private.withdrawal_execution_attempts as attempts
      on attempts.id = requests.latest_execution_attempt_id
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
  'ACTIVE ADMIN AAL2 read RPC for local manual withdrawal requests. It exposes execution state and journal IDs for audit workflows, but no raw evidence, digests, request_data, headers, credentials, blockchain address, withdrawal address, transaction ID, or settlement proof.';

drop function public.list_withdrawal_command_audit_events(integer, uuid);

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
  execution_attempt_id uuid,
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
      events.execution_attempt_id,
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
  'ACTIVE ADMIN AAL2 read RPC for append-only withdrawal command audit events. The returned shape excludes request_data, raw evidence, evidence digests, cookies, tokens, credentials, addresses, blockchain identifiers, transaction IDs, and settlement proof.';

create or replace function public.list_withdrawal_execution_attempts(
  p_limit integer default 100,
  p_before_execution_attempt_id uuid default null
)
returns table (
  execution_attempt_id uuid,
  withdrawal_request_id uuid,
  attempt_no integer,
  status text,
  settlement_journal_id uuid,
  failure_code text,
  failure_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_before_started_at timestamptz;
  v_before_id uuid;
begin
  perform private.withdrawal_require_admin_aal2();
  v_limit := coalesce(p_limit, 100);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_execution_attempt_id is not null then
    select attempts.started_at, attempts.id
      into v_before_started_at, v_before_id
    from private.withdrawal_execution_attempts as attempts
    where attempts.id = p_before_execution_attempt_id;

    if not found then
      return;
    end if;
  end if;

  return query
    select
      attempts.id,
      attempts.withdrawal_request_id,
      attempts.attempt_no,
      attempts.status,
      attempts.settlement_journal_id,
      attempts.failure_code,
      attempts.failure_reason,
      attempts.started_at,
      attempts.completed_at,
      attempts.version
    from private.withdrawal_execution_attempts as attempts
    where p_before_execution_attempt_id is null
      or attempts.started_at < v_before_started_at
      or (
        attempts.started_at = v_before_started_at
        and attempts.id < v_before_id
      )
    order by attempts.started_at desc, attempts.id desc
    limit v_limit;
end;
$$;

comment on function public.list_withdrawal_execution_attempts(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for local withdrawal execution attempt history. It excludes raw evidence and full evidence digests.';

revoke execute on function public.start_user_payout_execution(uuid, bigint, uuid, text, text)
  from public, anon, authenticated;

revoke execute on function public.fail_user_payout_execution(uuid, bigint, uuid, bigint, uuid, text, text)
  from public, anon, authenticated;

revoke execute on function public.settle_user_payout_execution(uuid, bigint, uuid, bigint, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.list_current_user_withdrawal_requests(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_withdrawal_requests(integer, uuid)
  from public, anon, authenticated;

revoke execute on function public.list_withdrawal_command_audit_events(integer, uuid)
  from public, anon, authenticated;

revoke execute on function public.list_withdrawal_execution_attempts(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.start_user_payout_execution(uuid, bigint, uuid, text, text)
  to authenticated;

grant execute on function public.fail_user_payout_execution(uuid, bigint, uuid, bigint, uuid, text, text)
  to authenticated;

grant execute on function public.settle_user_payout_execution(uuid, bigint, uuid, bigint, uuid, text)
  to authenticated;

grant execute on function public.list_current_user_withdrawal_requests(integer)
  to authenticated;

grant execute on function public.list_admin_withdrawal_requests(integer, uuid)
  to authenticated;

grant execute on function public.list_withdrawal_command_audit_events(integer, uuid)
  to authenticated;

grant execute on function public.list_withdrawal_execution_attempts(integer, uuid)
  to authenticated;
