create table private.financial_admin_audit_events (
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

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  original_journal_id uuid null
    references private.ledger_journals (id) on delete restrict,

  resulting_journal_id uuid null
    references private.ledger_journals (id) on delete restrict,

  reason text not null,
  request_data jsonb not null,

  units private.positive_atomic_units not null,

  occurred_at timestamptz not null default clock_timestamp(),

  constraint financial_admin_audit_events_action_check
    check (action in ('POST_OPENING_BALANCE', 'REVERSE_OPENING_BALANCE')),

  constraint financial_admin_audit_events_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),

  constraint financial_admin_audit_events_shape_check
    check (
      (
        action = 'POST_OPENING_BALANCE'
        and outcome = 'APPLIED'
        and original_journal_id is null
        and resulting_journal_id is not null
      )
      or (
        action = 'REVERSE_OPENING_BALANCE'
        and outcome in ('APPLIED', 'NOOP')
        and original_journal_id is not null
        and resulting_journal_id is not null
        and original_journal_id <> resulting_journal_id
      )
    ),

  constraint financial_admin_audit_events_reason_check
    check (
      reason = pg_catalog.btrim(reason)
      and pg_catalog.char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
      and reason !~* '(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)'
    ),

  constraint financial_admin_audit_events_request_data_check
    check (
      jsonb_typeof(request_data) = 'object'
      and request_data::text !~* '(email|password|cookie|jwt|access[_ ]?token|refresh[_ ]?token|mfa[_ ]?secret|totp|user[_ ]?metadata|app[_ ]?metadata|private[_ ]?key|blockchain[_ ]?credential|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url)'
    )
);

comment on table private.financial_admin_audit_events is
  'Append-only ACTIVE ADMIN AAL2 financial command audit for one-time Opening Balance and exact Opening reversal. Expected versions, command ID idempotency, private Posting Primitive reuse, and generic manual journal exclusion are enforced; deposits, withdrawals, staking, and rewards remain unimplemented.';

create index financial_admin_audit_events_occurred_at_idx
  on private.financial_admin_audit_events (occurred_at desc, id desc);

create index financial_admin_audit_events_actor_idx
  on private.financial_admin_audit_events (actor_user_id, occurred_at desc);

create index financial_admin_audit_events_target_user_idx
  on private.financial_admin_audit_events (target_user_id, occurred_at desc);

create index financial_admin_audit_events_wallet_account_idx
  on private.financial_admin_audit_events (wallet_account_id, occurred_at desc);

create index financial_admin_audit_events_asset_idx
  on private.financial_admin_audit_events (asset_id, occurred_at desc);

create index financial_admin_audit_events_original_journal_idx
  on private.financial_admin_audit_events (original_journal_id)
  where original_journal_id is not null;

create index financial_admin_audit_events_resulting_journal_idx
  on private.financial_admin_audit_events (resulting_journal_id)
  where resulting_journal_id is not null;

create unique index financial_admin_opening_once_uidx
  on private.financial_admin_audit_events (wallet_account_id, asset_id)
  where action = 'POST_OPENING_BALANCE'
    and outcome = 'APPLIED';

create unique index financial_admin_opening_reversal_once_uidx
  on private.financial_admin_audit_events (original_journal_id)
  where action = 'REVERSE_OPENING_BALANCE'
    and outcome = 'APPLIED';

create unique index financial_admin_applied_resulting_journal_uidx
  on private.financial_admin_audit_events (resulting_journal_id)
  where outcome = 'APPLIED'
    and resulting_journal_id is not null;

revoke all privileges on table private.financial_admin_audit_events
  from public, anon, authenticated;

create or replace function private.prevent_financial_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'FINANCIAL_ADMIN_AUDIT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_financial_admin_audit_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE for append-only ACTIVE ADMIN AAL2 financial audit events without exposing UUID, unit, or reason values.';

revoke execute on function private.prevent_financial_admin_audit_mutation()
  from public, anon, authenticated;

create trigger protect_financial_admin_audit_events
  before update or delete or truncate
  on private.financial_admin_audit_events
  for each statement
  execute function private.prevent_financial_admin_audit_mutation();

create or replace function private.financial_admin_require_admin_aal2()
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
    raise exception 'FINANCIAL_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

create or replace function private.financial_admin_normalize_reason(
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

create or replace function private.financial_admin_validate_units_text(
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

create or replace function private.financial_admin_lock()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:financial-admin-command:v1',
      0
    )
  );
end;
$$;

revoke execute on function private.financial_admin_require_admin_aal2()
  from public, anon, authenticated;

revoke execute on function private.financial_admin_normalize_reason(text)
  from public, anon, authenticated;

revoke execute on function private.financial_admin_validate_units_text(text)
  from public, anon, authenticated;

revoke execute on function private.financial_admin_lock()
  from public, anon, authenticated;

create or replace function private.validate_ledger_journal_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_journal_id uuid;
  v_entry_count integer;
  v_account_count integer;
  v_debit_count integer;
  v_credit_count integer;
  v_debit_sum numeric;
  v_credit_sum numeric;
begin
  if tg_table_name = 'ledger_journals' then
    v_journal_id := new.id;
  else
    v_journal_id := new.journal_id;
  end if;

  if not exists (
    select 1
    from private.ledger_journals as journals
    where journals.id = v_journal_id
  ) then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  select
    count(*)::integer,
    count(distinct entries.ledger_account_id)::integer,
    count(*) filter (where entries.side = 'DEBIT')::integer,
    count(*) filter (where entries.side = 'CREDIT')::integer,
    coalesce(sum(entries.units) filter (where entries.side = 'DEBIT'), 0::numeric),
    coalesce(sum(entries.units) filter (where entries.side = 'CREDIT'), 0::numeric)
    into
      v_entry_count,
      v_account_count,
      v_debit_count,
      v_credit_count,
      v_debit_sum,
      v_credit_sum
  from private.ledger_entries as entries
  where entries.journal_id = v_journal_id;

  if v_entry_count < 2
    or v_account_count < 2
    or v_debit_count < 1
    or v_credit_count < 1
    or v_debit_sum <= 0
    or v_credit_sum <= 0
    or v_debit_sum <> v_credit_sum
  then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    join private.ledger_journals as journals
      on journals.id = entries.journal_id
    where entries.journal_id = v_journal_id
      and (
        accounts.status <> 'OPEN'
        or accounts.asset_id <> journals.asset_id
        or entries.units <= 0
        or entries.units <> trunc(entries.units)
        or entries.units >= power(10::numeric, 38)
      )
  ) then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from private.ledger_entries as entries
    where entries.journal_id = v_journal_id
    group by entries.ledger_account_id
    having count(*) > 1
  ) then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from private.ledger_account_balances as balances
    where balances.account_scope = 'USER'
      and balances.balance_units < 0
  ) then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function private.validate_ledger_journal_invariants() is
  'Deferred SECURITY DEFINER database invariant validator for immutable double-entry journals and entries. Re-declared by the opening balance migration so authenticated RPC posting can commit while private ledger tables remain hidden.';

revoke execute on function private.validate_ledger_journal_invariants()
  from public, anon, authenticated;

create or replace function public.post_opening_balance(
  p_wallet_account_id uuid,
  p_wallet_expected_version bigint,
  p_asset_id uuid,
  p_asset_expected_version bigint,
  p_units text,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  journal_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  units text,
  posted_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_reason text;
  v_units_text text;
  v_units numeric;
  v_request_data jsonb;
  v_existing_event private.financial_admin_audit_events%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_profile_status text;
  v_asset public.supported_assets%rowtype;
  v_user_available_account_id uuid;
  v_system_custody_account_id uuid;
  v_resulting_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
begin
  v_actor_user_id := private.financial_admin_require_admin_aal2();
  v_reason := private.financial_admin_normalize_reason(p_reason);
  v_units_text := private.financial_admin_validate_units_text(p_units);

  if p_wallet_account_id is null
    or p_wallet_expected_version is null
    or p_wallet_expected_version < 1
    or p_asset_id is null
    or p_asset_expected_version is null
    or p_asset_expected_version < 1
    or p_command_id is null
    or v_reason is null
    or v_units_text is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::timestamptz;
    return;
  end if;

  v_units := v_units_text::numeric;
  v_request_data := jsonb_build_object(
    'wallet_account_id', p_wallet_account_id::text,
    'wallet_expected_version', p_wallet_expected_version,
    'asset_id', p_asset_id::text,
    'asset_expected_version', p_asset_expected_version,
    'units', v_units_text,
    'reason', v_reason
  );

  perform private.financial_admin_lock();

  select events.* into v_existing_event
  from private.financial_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'POST_OPENING_BALANCE'
      and v_existing_event.wallet_account_id = p_wallet_account_id
      and v_existing_event.asset_id = p_asset_id
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select
        v_existing_event.outcome,
        true,
        v_existing_event.id,
        v_existing_event.command_id,
        v_existing_event.resulting_journal_id,
        v_existing_event.wallet_account_id,
        v_existing_event.asset_id,
        v_existing_event.units::text,
        journals.posted_at
      from private.ledger_journals as journals
      where journals.id = v_existing_event.resulting_journal_id;
      return;
    end if;

    return query select 'FINANCIAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'FINANCIAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::timestamptz;
    return;
  end if;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = p_wallet_account_id
  for update;

  if not found then
    return query select 'OPENING_WALLET_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, p_wallet_account_id, p_asset_id, null::text, null::timestamptz;
    return;
  end if;

  select profiles.account_status into v_profile_status
  from public.profiles as profiles
  where profiles.id = v_wallet.user_id
  for update;

  if v_wallet.version <> p_wallet_expected_version then
    return query select 'OPENING_WALLET_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, v_wallet.id, p_asset_id, null::text, null::timestamptz;
    return;
  end if;

  if v_wallet.status <> 'ACTIVE' then
    return query select 'OPENING_WALLET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, null::uuid, v_wallet.id, p_asset_id, null::text, null::timestamptz;
    return;
  end if;

  if v_profile_status <> 'ACTIVE' then
    return query select 'OPENING_PROFILE_NOT_ACTIVE'::text, false, null::uuid, p_command_id, null::uuid, v_wallet.id, p_asset_id, null::text, null::timestamptz;
    return;
  end if;

  select assets.* into v_asset
  from public.supported_assets as assets
  where assets.id = p_asset_id
  for update;

  if not found then
    return query select 'OPENING_ASSET_NOT_FOUND'::text, false, null::uuid, p_command_id, null::uuid, v_wallet.id, p_asset_id, null::text, null::timestamptz;
    return;
  end if;

  if v_asset.version <> p_asset_expected_version then
    return query select 'OPENING_ASSET_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, null::uuid, v_wallet.id, v_asset.id, null::text, null::timestamptz;
    return;
  end if;

  if v_asset.status <> 'ACTIVE'
    or v_asset.network <> 'SOLANA'
    or v_asset.asset_type not in ('NATIVE', 'SPL_TOKEN')
  then
    return query select 'OPENING_ASSET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, null::uuid, v_wallet.id, v_asset.id, null::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.financial_admin_audit_events as events
    where events.action = 'POST_OPENING_BALANCE'
      and events.outcome = 'APPLIED'
      and events.wallet_account_id = v_wallet.id
      and events.asset_id = v_asset.id
  ) then
    return query select 'OPENING_BALANCE_ALREADY_POSTED'::text, false, null::uuid, p_command_id, null::uuid, v_wallet.id, v_asset.id, null::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where accounts.wallet_account_id = v_wallet.id
      and accounts.asset_id = v_asset.id
  ) then
    return query select 'OPENING_LEDGER_ACTIVITY_EXISTS'::text, false, null::uuid, p_command_id, null::uuid, v_wallet.id, v_asset.id, null::text, null::timestamptz;
    return;
  end if;

  select accounts.ledger_account_id
    into v_user_available_account_id
  from private.ensure_wallet_asset_ledger_accounts(v_wallet.id, v_asset.id) as accounts
  where accounts.account_purpose = 'USER_AVAILABLE';

  select accounts.ledger_account_id
    into v_system_custody_account_id
  from private.ensure_system_ledger_accounts(v_asset.id) as accounts
  where accounts.account_purpose = 'SYSTEM_CUSTODY';

  select posted.journal_id, posted.posted_at
    into v_resulting_journal_id, v_posted_at
  from private.post_ledger_journal(
    p_command_id,
    v_asset.id,
    'ADMIN_OPENING_BALANCE',
    'ADMIN',
    v_actor_user_id,
    'WALLET_ACCOUNT',
    v_wallet.id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_system_custody_account_id::text,
        'side', 'DEBIT',
        'units', v_units_text
      ),
      jsonb_build_object(
        'account_id', v_user_available_account_id::text,
        'side', 'CREDIT',
        'units', v_units_text
      )
    )
  ) as posted;

  insert into private.financial_admin_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    target_user_id,
    wallet_account_id,
    asset_id,
    original_journal_id,
    resulting_journal_id,
    reason,
    request_data,
    units
  )
  values (
    p_command_id,
    'POST_OPENING_BALANCE',
    'APPLIED',
    v_actor_user_id,
    v_wallet.user_id,
    v_wallet.id,
    v_asset.id,
    null,
    v_resulting_journal_id,
    v_reason,
    v_request_data,
    v_units::private.positive_atomic_units
  )
  returning id into v_event_id;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, v_resulting_journal_id, v_wallet.id, v_asset.id, v_units_text, v_posted_at;
end;
$$;

comment on function public.post_opening_balance(uuid, bigint, uuid, bigint, text, uuid, text) is
  'ACTIVE ADMIN AAL2 Opening Balance command. One APPLIED opening per wallet and asset is enforced with expected wallet and asset versions, exact Atomic Unit string validation, command ID idempotency, financial-admin advisory lock before private Posting Primitive lock, append-only audit, and no generic manual journal, deposit, withdrawal, staking, reward, service-role, or production path.';

create or replace function public.reverse_opening_balance(
  p_original_journal_id uuid,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  original_journal_id uuid,
  reversal_journal_id uuid,
  wallet_account_id uuid,
  asset_id uuid,
  units text,
  posted_at timestamptz
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
  v_existing_event private.financial_admin_audit_events%rowtype;
  v_original_journal private.ledger_journals%rowtype;
  v_opening_event private.financial_admin_audit_events%rowtype;
  v_existing_reversal private.financial_admin_audit_events%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_entry_count integer;
  v_debit_count integer;
  v_credit_count integer;
  v_distinct_units integer;
  v_units numeric;
  v_units_text text;
  v_user_available_account_id uuid;
  v_system_custody_account_id uuid;
  v_available_units numeric;
  v_reversal_journal_id uuid;
  v_posted_at timestamptz;
  v_event_id uuid;
begin
  v_actor_user_id := private.financial_admin_require_admin_aal2();
  v_reason := private.financial_admin_normalize_reason(p_reason);

  if p_original_journal_id is null
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'original_journal_id', p_original_journal_id::text,
    'reason', v_reason
  );

  perform private.financial_admin_lock();

  select events.* into v_existing_event
  from private.financial_admin_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'REVERSE_OPENING_BALANCE'
      and v_existing_event.original_journal_id = p_original_journal_id
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query select
        v_existing_event.outcome,
        true,
        v_existing_event.id,
        v_existing_event.command_id,
        v_existing_event.original_journal_id,
        v_existing_event.resulting_journal_id,
        v_existing_event.wallet_account_id,
        v_existing_event.asset_id,
        v_existing_event.units::text,
        journals.posted_at
      from private.ledger_journals as journals
      where journals.id = v_existing_event.resulting_journal_id;
      return;
    end if;

    return query select 'FINANCIAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'FINANCIAL_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  select journals.* into v_original_journal
  from private.ledger_journals as journals
  where journals.id = p_original_journal_id
  for update;

  if not found then
    return query select 'OPENING_JOURNAL_NOT_FOUND'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  if v_original_journal.journal_type <> 'ADMIN_OPENING_BALANCE'
    or v_original_journal.initiator_type <> 'ADMIN'
    or v_original_journal.initiator_user_id is null
    or v_original_journal.reference_type <> 'WALLET_ACCOUNT'
    or v_original_journal.reference_id is null
  then
    return query select 'OPENING_JOURNAL_INVALID'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, null::uuid, v_original_journal.asset_id, null::text, null::timestamptz;
    return;
  end if;

  select events.* into v_opening_event
  from private.financial_admin_audit_events as events
  where events.action = 'POST_OPENING_BALANCE'
    and events.outcome = 'APPLIED'
    and events.resulting_journal_id = p_original_journal_id
  for update;

  if not found then
    return query select 'OPENING_JOURNAL_NOT_REVERSIBLE'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, null::uuid, v_original_journal.asset_id, null::text, null::timestamptz;
    return;
  end if;

  select wallet_accounts.* into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_original_journal.reference_id
  for update;

  if not found
    or v_wallet.id <> v_opening_event.wallet_account_id
    or v_wallet.user_id <> v_opening_event.target_user_id
    or v_opening_event.asset_id <> v_original_journal.asset_id
  then
    return query select 'OPENING_JOURNAL_INVALID'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, v_opening_event.wallet_account_id, v_original_journal.asset_id, null::text, null::timestamptz;
    return;
  end if;

  perform assets.id
  from public.supported_assets as assets
  where assets.id = v_original_journal.asset_id
  for update;

  if not found then
    return query select 'OPENING_JOURNAL_INVALID'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, v_wallet.id, v_original_journal.asset_id, null::text, null::timestamptz;
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where entries.side = 'DEBIT'
        and accounts.account_scope = 'SYSTEM'
        and accounts.account_purpose = 'SYSTEM_CUSTODY'
        and accounts.asset_id = v_original_journal.asset_id
        and accounts.wallet_account_id is null
    )::integer,
    count(*) filter (
      where entries.side = 'CREDIT'
        and accounts.account_scope = 'USER'
        and accounts.account_purpose = 'USER_AVAILABLE'
        and accounts.asset_id = v_original_journal.asset_id
        and accounts.wallet_account_id = v_wallet.id
    )::integer,
    count(distinct entries.units)::integer,
    min(entries.units)::numeric,
    (max(accounts.id::text) filter (
      where entries.side = 'CREDIT'
        and accounts.account_scope = 'USER'
        and accounts.account_purpose = 'USER_AVAILABLE'
        and accounts.asset_id = v_original_journal.asset_id
        and accounts.wallet_account_id = v_wallet.id
    ))::uuid,
    (max(accounts.id::text) filter (
      where entries.side = 'DEBIT'
        and accounts.account_scope = 'SYSTEM'
        and accounts.account_purpose = 'SYSTEM_CUSTODY'
        and accounts.asset_id = v_original_journal.asset_id
        and accounts.wallet_account_id is null
    ))::uuid
    into
      v_entry_count,
      v_debit_count,
      v_credit_count,
      v_distinct_units,
      v_units,
      v_user_available_account_id,
      v_system_custody_account_id
  from private.ledger_entries as entries
  join private.ledger_accounts as accounts
    on accounts.id = entries.ledger_account_id
  where entries.journal_id = p_original_journal_id;

  if v_entry_count <> 2
    or v_debit_count <> 1
    or v_credit_count <> 1
    or v_distinct_units <> 1
    or v_units is null
    or v_units <= 0
    or v_user_available_account_id is null
    or v_system_custody_account_id is null
  then
    return query select 'OPENING_JOURNAL_INVALID'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, v_wallet.id, v_original_journal.asset_id, null::text, null::timestamptz;
    return;
  end if;

  v_units_text := (v_units::private.positive_atomic_units)::text;

  select events.* into v_existing_reversal
  from private.financial_admin_audit_events as events
  where events.action = 'REVERSE_OPENING_BALANCE'
    and events.outcome = 'APPLIED'
    and events.original_journal_id = p_original_journal_id
  for update;

  if found then
    select journals.posted_at into v_posted_at
    from private.ledger_journals as journals
    where journals.id = v_existing_reversal.resulting_journal_id;

    insert into private.financial_admin_audit_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      target_user_id,
      wallet_account_id,
      asset_id,
      original_journal_id,
      resulting_journal_id,
      reason,
      request_data,
      units
    )
    values (
      p_command_id,
      'REVERSE_OPENING_BALANCE',
      'NOOP',
      v_actor_user_id,
      v_opening_event.target_user_id,
      v_wallet.id,
      v_original_journal.asset_id,
      p_original_journal_id,
      v_existing_reversal.resulting_journal_id,
      v_reason,
      v_request_data,
      v_units::private.positive_atomic_units
    )
    returning id into v_event_id;

    return query select 'NOOP'::text, false, v_event_id, p_command_id, p_original_journal_id, v_existing_reversal.resulting_journal_id, v_wallet.id, v_original_journal.asset_id, v_units_text, v_posted_at;
    return;
  end if;

  perform accounts.id
  from private.ledger_accounts as accounts
  where accounts.id in (v_user_available_account_id, v_system_custody_account_id)
  order by accounts.id
  for update;

  select balances.balance_units into v_available_units
  from private.ledger_account_balances as balances
  where balances.ledger_account_id = v_user_available_account_id;

  if coalesce(v_available_units, 0::numeric) < v_units then
    return query select 'OPENING_REVERSAL_INSUFFICIENT_AVAILABLE'::text, false, null::uuid, p_command_id, p_original_journal_id, null::uuid, v_wallet.id, v_original_journal.asset_id, v_units_text, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_reversal_journal_id, v_posted_at
  from private.post_ledger_journal(
    p_command_id,
    v_original_journal.asset_id,
    'ADMIN_OPENING_BALANCE_REVERSAL',
    'ADMIN',
    v_actor_user_id,
    'LEDGER_JOURNAL',
    p_original_journal_id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_user_available_account_id::text,
        'side', 'DEBIT',
        'units', v_units_text
      ),
      jsonb_build_object(
        'account_id', v_system_custody_account_id::text,
        'side', 'CREDIT',
        'units', v_units_text
      )
    )
  ) as posted;

  insert into private.financial_admin_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    target_user_id,
    wallet_account_id,
    asset_id,
    original_journal_id,
    resulting_journal_id,
    reason,
    request_data,
    units
  )
  values (
    p_command_id,
    'REVERSE_OPENING_BALANCE',
    'APPLIED',
    v_actor_user_id,
    v_opening_event.target_user_id,
    v_wallet.id,
    v_original_journal.asset_id,
    p_original_journal_id,
    v_reversal_journal_id,
    v_reason,
    v_request_data,
    v_units::private.positive_atomic_units
  )
  returning id into v_event_id;

  return query select 'APPLIED'::text, false, v_event_id, p_command_id, p_original_journal_id, v_reversal_journal_id, v_wallet.id, v_original_journal.asset_id, v_units_text, v_posted_at;
end;
$$;

comment on function public.reverse_opening_balance(uuid, uuid, text) is
  'ACTIVE ADMIN AAL2 exact reversal command for an original ADMIN_OPENING_BALANCE journal only. It derives account, side, and Atomic Unit lines from immutable entries, enforces one APPLIED reversal per original opening, supports command replay and post-reversal NOOP audit, blocks insufficient USER_AVAILABLE balance, reuses the private Posting Primitive, and does not implement generic manual journal, deposits, withdrawals, staking, rewards, service-role access, or production connectivity.';

create or replace function public.list_admin_wallet_asset_ledger_balances(
  p_limit integer default 100
)
returns table (
  wallet_account_id uuid,
  target_user_id uuid,
  wallet_status text,
  profile_status text,
  asset_id uuid,
  asset_code text,
  symbol text,
  decimals smallint,
  available_units text,
  locked_units text,
  pending_deposit_units text,
  pending_withdrawal_units text,
  total_liability_units text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform private.financial_admin_require_admin_aal2();

  v_limit := coalesce(p_limit, 100);

  if v_limit < 1 or v_limit > 200 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select
      balances.wallet_account_id,
      wallet_accounts.user_id,
      wallet_accounts.status,
      profiles.account_status,
      balances.asset_id,
      assets.asset_code,
      assets.symbol,
      assets.decimals,
      balances.available_units::text,
      balances.locked_units::text,
      balances.pending_deposit_units::text,
      balances.pending_withdrawal_units::text,
      balances.total_liability_units::text
    from private.wallet_asset_ledger_balances as balances
    join public.wallet_accounts as wallet_accounts
      on wallet_accounts.id = balances.wallet_account_id
    join public.profiles as profiles
      on profiles.id = wallet_accounts.user_id
    join public.supported_assets as assets
      on assets.id = balances.asset_id
    order by wallet_accounts.created_at desc, balances.wallet_account_id, assets.asset_code, balances.asset_id
    limit v_limit;
end;
$$;

comment on function public.list_admin_wallet_asset_ledger_balances(integer) is
  'ACTIVE ADMIN AAL2 read RPC for text Atomic Unit wallet-asset balances calculated from private ledger entries. It exposes no email, display name, ledger account IDs, credentials, user balance UI, or financial write path.';

create or replace function public.list_admin_ledger_journals(
  p_limit integer default 50,
  p_before_journal_id uuid default null
)
returns table (
  journal_id uuid,
  command_id uuid,
  asset_id uuid,
  asset_code text,
  symbol text,
  journal_type text,
  initiator_type text,
  initiator_user_id uuid,
  reference_type text,
  reference_id uuid,
  reason text,
  debit_total_units text,
  credit_total_units text,
  entry_count integer,
  posted_at timestamptz,
  reversed boolean,
  reversal_journal_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_before_posted_at timestamptz;
  v_before_id uuid;
begin
  perform private.financial_admin_require_admin_aal2();

  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_journal_id is not null then
    select journals.posted_at, journals.id
      into v_before_posted_at, v_before_id
    from private.ledger_journals as journals
    where journals.id = p_before_journal_id;

    if not found then
      return;
    end if;
  end if;

  return query
    select
      journals.id,
      journals.command_id,
      journals.asset_id,
      assets.asset_code,
      assets.symbol,
      journals.journal_type,
      journals.initiator_type,
      journals.initiator_user_id,
      journals.reference_type,
      journals.reference_id,
      journals.reason,
      coalesce(sum(entries.units::numeric) filter (where entries.side = 'DEBIT'), 0::numeric)::text,
      coalesce(sum(entries.units::numeric) filter (where entries.side = 'CREDIT'), 0::numeric)::text,
      count(entries.id)::integer,
      journals.posted_at,
      reversal_events.resulting_journal_id is not null,
      reversal_events.resulting_journal_id
    from private.ledger_journals as journals
    join public.supported_assets as assets
      on assets.id = journals.asset_id
    join private.ledger_entries as entries
      on entries.journal_id = journals.id
    left join private.financial_admin_audit_events as reversal_events
      on reversal_events.action = 'REVERSE_OPENING_BALANCE'
      and reversal_events.outcome = 'APPLIED'
      and reversal_events.original_journal_id = journals.id
    where p_before_journal_id is null
      or journals.posted_at < v_before_posted_at
      or (
        journals.posted_at = v_before_posted_at
        and journals.id < v_before_id
      )
    group by
      journals.id,
      assets.asset_code,
      assets.symbol,
      reversal_events.resulting_journal_id
    order by journals.posted_at desc, journals.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_ledger_journals(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for immutable ledger journal summaries with cursor pagination. It returns text Atomic Unit totals, reversal status from financial audit, and no entry-line dump, request_data, cookie, JWT, MFA material, generic manual journal, or service-role path.';

create or replace function public.list_financial_admin_audit_events(
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
  asset_id uuid,
  original_journal_id uuid,
  resulting_journal_id uuid,
  reason text,
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
  perform private.financial_admin_require_admin_aal2();

  v_limit := coalesce(p_limit, 50);

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_event_id is not null then
    select events.occurred_at, events.id
      into v_before_occurred_at, v_before_id
    from private.financial_admin_audit_events as events
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
      events.asset_id,
      events.original_journal_id,
      events.resulting_journal_id,
      events.reason,
      events.units::text,
      events.occurred_at
    from private.financial_admin_audit_events as events
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

comment on function public.list_financial_admin_audit_events(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for append-only financial audit events. It exposes safe command outcome fields only, not request_data, auth metadata, cookie, token, MFA, credential, service-role, or production data.';

revoke execute on function public.post_opening_balance(uuid, bigint, uuid, bigint, text, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.reverse_opening_balance(uuid, uuid, text)
  from public, anon, authenticated;

revoke execute on function public.list_admin_wallet_asset_ledger_balances(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_ledger_journals(integer, uuid)
  from public, anon, authenticated;

revoke execute on function public.list_financial_admin_audit_events(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.post_opening_balance(uuid, bigint, uuid, bigint, text, uuid, text)
  to authenticated;

grant execute on function public.reverse_opening_balance(uuid, uuid, text)
  to authenticated;

grant execute on function public.list_admin_wallet_asset_ledger_balances(integer)
  to authenticated;

grant execute on function public.list_admin_ledger_journals(integer, uuid)
  to authenticated;

grant execute on function public.list_financial_admin_audit_events(integer, uuid)
  to authenticated;
