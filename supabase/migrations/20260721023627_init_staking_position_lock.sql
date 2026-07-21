create table private.staking_positions (
  id uuid primary key default gen_random_uuid(),

  staking_product_id uuid not null
    references private.staking_products (id) on delete restrict,

  project_id uuid not null
    references public.projects (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  wallet_account_id uuid not null
    references public.wallet_accounts (id) on delete restrict,

  user_id uuid not null
    references public.profiles (id) on delete restrict,

  principal_units private.positive_atomic_units not null,

  status text not null default 'LOCKED',

  lock_journal_id uuid not null unique
    references private.ledger_journals (id) on delete restrict,

  product_version_snapshot bigint not null,
  lock_duration_days_snapshot integer not null,
  term_reward_rate_ppm_snapshot integer not null,
  reward_rounding_mode_snapshot text not null,

  locked_at timestamptz not null,
  matures_at timestamptz not null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint staking_positions_status_check
    check (status = 'LOCKED'),

  constraint staking_positions_product_version_snapshot_check
    check (product_version_snapshot >= 1),

  constraint staking_positions_lock_duration_snapshot_check
    check (lock_duration_days_snapshot between 1 and 3650),

  constraint staking_positions_reward_rate_snapshot_check
    check (term_reward_rate_ppm_snapshot between 1 and 1000000),

  constraint staking_positions_reward_rounding_snapshot_check
    check (reward_rounding_mode_snapshot = 'FLOOR'),

  constraint staking_positions_maturity_check
    check (matures_at > locked_at),

  constraint staking_positions_version_check
    check (version >= 1)
);

comment on table private.staking_positions is
  'Private immutable staking position core. This phase only creates LOCKED positions and atomically moves principal from USER_AVAILABLE to USER_LOCKED; unlocks, rewards, claims, on-chain delegation, and service-role paths are out of scope.';

create index staking_positions_wallet_locked_idx
  on private.staking_positions (wallet_account_id, locked_at desc, id desc);

create index staking_positions_user_locked_idx
  on private.staking_positions (user_id, locked_at desc, id desc);

create index staking_positions_product_locked_idx
  on private.staking_positions (staking_product_id, locked_at desc, id desc);

create index staking_positions_asset_locked_idx
  on private.staking_positions (asset_id, locked_at desc, id desc);

create index staking_positions_matures_idx
  on private.staking_positions (matures_at, id);

create index staking_positions_status_matures_idx
  on private.staking_positions (status, matures_at, id);

create table private.staking_position_command_audit_events (
  id uuid primary key default gen_random_uuid(),

  command_id uuid not null unique,

  action text not null,
  outcome text not null,

  actor_user_id uuid not null
    references public.profiles (id) on delete restrict,

  wallet_account_id uuid not null
    references public.wallet_accounts (id) on delete restrict,

  staking_product_id uuid not null
    references private.staking_products (id) on delete restrict,

  staking_position_id uuid not null
    references private.staking_positions (id) on delete restrict,

  project_id uuid not null
    references public.projects (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  resulting_journal_id uuid not null
    references private.ledger_journals (id) on delete restrict,

  reason text not null,
  request_data jsonb not null,

  principal_units private.positive_atomic_units not null,
  resulting_status text not null,
  entity_version bigint not null,

  occurred_at timestamptz not null default clock_timestamp(),

  constraint staking_position_audit_action_check
    check (action = 'CREATE_STAKING_POSITION'),

  constraint staking_position_audit_outcome_check
    check (outcome = 'APPLIED'),

  constraint staking_position_audit_reason_check
    check (reason = 'USER_STAKING_POSITION'),

  constraint staking_position_audit_request_data_check
    check (
      jsonb_typeof(request_data) = 'object'
      and request_data::text !~* '(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)'
    ),

  constraint staking_position_audit_status_check
    check (resulting_status = 'LOCKED'),

  constraint staking_position_audit_entity_version_check
    check (entity_version >= 1)
);

comment on table private.staking_position_command_audit_events is
  'Append-only audit for user staking position principal-lock commands. Request data stores only deterministic command boundaries and omits credentials, wallet addresses, transactions, user metadata, balances, and reward material.';

create index staking_position_audit_occurred_idx
  on private.staking_position_command_audit_events (occurred_at desc, id desc);

create index staking_position_audit_actor_idx
  on private.staking_position_command_audit_events (actor_user_id, occurred_at desc);

create index staking_position_audit_wallet_idx
  on private.staking_position_command_audit_events (wallet_account_id, occurred_at desc);

create index staking_position_audit_product_idx
  on private.staking_position_command_audit_events (staking_product_id, occurred_at desc);

create index staking_position_audit_position_idx
  on private.staking_position_command_audit_events (staking_position_id);

create index staking_position_audit_asset_idx
  on private.staking_position_command_audit_events (asset_id, occurred_at desc);

create or replace function private.validate_staking_position_core()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'STAKING_POSITION_UPDATE_NOT_SUPPORTED'
      using errcode = '23514';
  end if;

  if new.status <> 'LOCKED'
    or new.version <> 1
    or new.id is null
    or new.staking_product_id is null
    or new.project_id is null
    or new.asset_id is null
    or new.wallet_account_id is null
    or new.user_id is null
    or new.principal_units is null
    or new.lock_journal_id is null
    or new.product_version_snapshot is null
    or new.product_version_snapshot < 1
    or new.lock_duration_days_snapshot is null
    or new.lock_duration_days_snapshot not between 1 and 3650
    or new.term_reward_rate_ppm_snapshot is null
    or new.term_reward_rate_ppm_snapshot not between 1 and 1000000
    or new.reward_rounding_mode_snapshot <> 'FLOOR'
    or new.locked_at is null
    or new.matures_at is null
    or new.matures_at <= new.locked_at
    or new.created_at is null
    or new.updated_at is null
  then
    raise exception 'STAKING_POSITION_INVALID_CORE'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function private.validate_staking_position_core() is
  'Validates immutable LOCKED staking position core fields. This phase blocks all position updates until a forward-only maturity or unlock migration replaces the trigger.';

revoke execute on function private.validate_staking_position_core()
  from public, anon, authenticated;

create trigger validate_staking_position_core
  before insert or update on private.staking_positions
  for each row
  execute function private.validate_staking_position_core();

create or replace function private.prevent_staking_position_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'STAKING_POSITION_IMMUTABLE'
    using errcode = '23514';
end;
$$;

comment on function private.prevent_staking_position_deletion() is
  'Blocks deleting or truncating staking position rows so the principal lock record remains available for future unlock and audit invariants.';

revoke execute on function private.prevent_staking_position_deletion()
  from public, anon, authenticated;

create trigger prevent_staking_position_delete
  before delete on private.staking_positions
  for each row
  execute function private.prevent_staking_position_deletion();

create trigger prevent_staking_position_truncate
  before truncate on private.staking_positions
  for each statement
  execute function private.prevent_staking_position_deletion();

create or replace function private.validate_staking_position_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product private.staking_products%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_journal private.ledger_journals%rowtype;
  v_entry_count integer;
  v_debit_count integer;
  v_credit_count integer;
  v_debit_units numeric;
  v_credit_units numeric;
  v_system_count integer;
begin
  select products.*
    into v_product
  from private.staking_products as products
  where products.id = new.staking_product_id;

  select wallet_accounts.*
    into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = new.wallet_account_id;

  select journals.*
    into v_journal
  from private.ledger_journals as journals
  where journals.id = new.lock_journal_id;

  if not found
    or v_product.id is null
    or v_wallet.id is null
    or v_journal.id is null
    or v_wallet.user_id <> new.user_id
    or v_wallet.custody_model <> 'MANAGED'
    or v_product.project_id <> new.project_id
    or v_product.asset_id <> new.asset_id
    or v_product.activated_at is null
    or new.product_version_snapshot < 1
    or new.lock_duration_days_snapshot <> v_product.lock_duration_days
    or new.term_reward_rate_ppm_snapshot <> v_product.term_reward_rate_ppm
    or new.reward_rounding_mode_snapshot <> v_product.reward_rounding_mode
    or v_journal.journal_type <> 'USER_STAKING_POSITION_LOCKED'
    or v_journal.initiator_type <> 'USER'
    or v_journal.initiator_user_id <> new.user_id
    or v_journal.reference_type <> 'STAKING_POSITION'
    or v_journal.reference_id <> new.id
    or v_journal.asset_id <> new.asset_id
    or new.locked_at <> v_journal.posted_at
    or new.matures_at <> new.locked_at + (new.lock_duration_days_snapshot * interval '1 day')
  then
    raise exception 'STAKING_POSITION_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where entries.side = 'DEBIT'
        and accounts.account_scope = 'USER'
        and accounts.account_purpose = 'USER_AVAILABLE'
        and accounts.wallet_account_id = new.wallet_account_id
        and accounts.asset_id = new.asset_id
        and entries.units = new.principal_units
    )::integer,
    count(*) filter (
      where entries.side = 'CREDIT'
        and accounts.account_scope = 'USER'
        and accounts.account_purpose = 'USER_LOCKED'
        and accounts.wallet_account_id = new.wallet_account_id
        and accounts.asset_id = new.asset_id
        and entries.units = new.principal_units
    )::integer,
    coalesce(sum(entries.units) filter (where entries.side = 'DEBIT'), 0::numeric),
    coalesce(sum(entries.units) filter (where entries.side = 'CREDIT'), 0::numeric),
    count(*) filter (where accounts.account_scope = 'SYSTEM')::integer
    into
      v_entry_count,
      v_debit_count,
      v_credit_count,
      v_debit_units,
      v_credit_units,
      v_system_count
  from private.ledger_entries as entries
  join private.ledger_accounts as accounts
    on accounts.id = entries.ledger_account_id
  where entries.journal_id = new.lock_journal_id;

  if v_entry_count <> 2
    or v_debit_count <> 1
    or v_credit_count <> 1
    or v_debit_units <> new.principal_units
    or v_credit_units <> new.principal_units
    or v_system_count <> 0
  then
    raise exception 'STAKING_POSITION_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function private.validate_staking_position_invariants() is
  'Deferred invariant tying every staking position to exactly one USER_STAKING_POSITION_LOCKED journal and two user liability entries: DEBIT USER_AVAILABLE and CREDIT USER_LOCKED for the exact principal units.';

revoke execute on function private.validate_staking_position_invariants()
  from public, anon, authenticated;

create constraint trigger validate_staking_position_invariants
  after insert on private.staking_positions
  deferrable initially deferred
  for each row
  execute function private.validate_staking_position_invariants();

create or replace function private.prevent_staking_position_command_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'STAKING_POSITION_AUDIT_IMMUTABLE'
    using errcode = '23514';
end;
$$;

comment on function private.prevent_staking_position_command_audit_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE against staking position command audit rows.';

revoke execute on function private.prevent_staking_position_command_audit_mutation()
  from public, anon, authenticated;

create trigger protect_staking_position_command_audit_update_delete
  before update or delete on private.staking_position_command_audit_events
  for each row
  execute function private.prevent_staking_position_command_audit_mutation();

create trigger protect_staking_position_command_audit_truncate
  before truncate on private.staking_position_command_audit_events
  for each statement
  execute function private.prevent_staking_position_command_audit_mutation();

create or replace function private.staking_position_lock()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:staking-position-command:v1',
      0
    )
  );
end;
$$;

comment on function private.staking_position_lock() is
  'Transaction-scoped advisory lock for staking position creation commands before product, wallet, ledger posting, position, and audit writes.';

revoke execute on function private.staking_position_lock()
  from public, anon, authenticated;

create or replace function public.create_user_staking_position(
  p_staking_product_id uuid,
  p_product_expected_version bigint,
  p_wallet_account_id uuid,
  p_wallet_expected_version bigint,
  p_principal_units text,
  p_position_id uuid,
  p_command_id uuid
)
returns table (
  result_code text,
  replayed boolean,
  event_id uuid,
  command_id uuid,
  staking_position_id uuid,
  lock_journal_id uuid,
  wallet_account_id uuid,
  staking_product_id uuid,
  project_id uuid,
  asset_id uuid,
  principal_units text,
  resulting_status text,
  entity_version bigint,
  locked_at timestamptz,
  matures_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_product private.staking_products%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_profile public.profiles%rowtype;
  v_principal_units text;
  v_request_data jsonb;
  v_existing_event private.staking_position_command_audit_events%rowtype;
  v_available_account_id uuid;
  v_locked_account_id uuid;
  v_available_units numeric;
  v_boundary_code text;
  v_lock_journal_id uuid;
  v_locked_at timestamptz;
  v_event_id uuid;
begin
  v_actor_user_id := private.staking_product_require_active_user();
  v_principal_units := private.staking_product_validate_units_text(p_principal_units);

  if p_staking_product_id is null
    or p_product_expected_version is null
    or p_product_expected_version < 1
    or p_wallet_account_id is null
    or p_wallet_expected_version is null
    or p_wallet_expected_version < 1
    or p_position_id is null
    or p_command_id is null
    or v_principal_units is null
  then
    return query select 'INVALID_INPUT'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, p_staking_product_id, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'CREATE_STAKING_POSITION',
    'actor_user_id', v_actor_user_id::text,
    'staking_product_id', p_staking_product_id::text,
    'product_expected_version', p_product_expected_version,
    'wallet_account_id', p_wallet_account_id::text,
    'wallet_expected_version', p_wallet_expected_version,
    'principal_units', v_principal_units,
    'position_id', p_position_id::text,
    'reason', 'USER_STAKING_POSITION'
  );

  perform private.staking_position_lock();

  select events.*
    into v_existing_event
  from private.staking_position_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.action = 'CREATE_STAKING_POSITION'
      and v_existing_event.wallet_account_id = p_wallet_account_id
      and v_existing_event.staking_product_id = p_staking_product_id
      and v_existing_event.staking_position_id = p_position_id
      and v_existing_event.reason = 'USER_STAKING_POSITION'
      and v_existing_event.request_data = v_request_data
      and v_existing_event.principal_units::text = v_principal_units
    then
      return query
        select
          v_existing_event.outcome,
          true,
          v_existing_event.id,
          v_existing_event.command_id,
          positions.id,
          positions.lock_journal_id,
          positions.wallet_account_id,
          positions.staking_product_id,
          positions.project_id,
          positions.asset_id,
          positions.principal_units::text,
          positions.status,
          positions.version,
          positions.locked_at,
          positions.matures_at
        from private.staking_positions as positions
        where positions.id = v_existing_event.staking_position_id;
      return;
    end if;

    return query select 'STAKING_POSITION_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, p_staking_product_id, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'STAKING_POSITION_COMMAND_ID_CONFLICT'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, p_staking_product_id, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz, null::timestamptz;
    return;
  end if;

  select products.*
    into v_product
  from private.staking_products as products
  where products.id = p_staking_product_id
  for update;

  if not found then
    return query select 'STAKING_PRODUCT_NOT_FOUND'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, p_staking_product_id, null::uuid, null::uuid, null::text, null::text, null::bigint, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_product.version <> p_product_expected_version then
    return query select 'STAKING_PRODUCT_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, v_product.id, v_product.project_id, v_product.asset_id, null::text, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_product.status <> 'ACTIVE' then
    return query select 'STAKING_PRODUCT_NOT_ACTIVE'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, v_product.id, v_product.project_id, v_product.asset_id, null::text, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  if now() < v_product.enrollment_starts_at
    or now() >= v_product.enrollment_ends_at
  then
    return query select 'STAKING_ENROLLMENT_NOT_OPEN'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, v_product.id, v_product.project_id, v_product.asset_id, null::text, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_boundary_code := private.staking_product_activation_boundary_code(
    v_product.project_id,
    v_product.asset_id,
    v_product.enrollment_ends_at
  );

  if v_boundary_code is not null then
    return query select v_boundary_code, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, v_product.id, v_product.project_id, v_product.asset_id, null::text, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_principal_units::numeric < v_product.min_stake_units then
    return query select 'STAKING_POSITION_BELOW_MINIMUM'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, v_product.id, v_product.project_id, v_product.asset_id, v_principal_units, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_product.max_stake_units is not null
    and v_principal_units::numeric > v_product.max_stake_units
  then
    return query select 'STAKING_POSITION_ABOVE_MAXIMUM'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, v_product.id, v_product.project_id, v_product.asset_id, v_principal_units, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  select wallet_accounts.*
    into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = p_wallet_account_id
  for update;

  if not found then
    return query select 'STAKING_WALLET_NOT_FOUND'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, p_wallet_account_id, v_product.id, v_product.project_id, v_product.asset_id, v_principal_units, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_wallet.user_id <> v_actor_user_id then
    return query select 'STAKING_WALLET_FORBIDDEN'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, v_wallet.id, v_product.id, v_product.project_id, v_product.asset_id, v_principal_units, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_wallet.version <> p_wallet_expected_version then
    return query select 'STAKING_WALLET_VERSION_CONFLICT'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, v_wallet.id, v_product.id, v_product.project_id, v_product.asset_id, v_principal_units, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_wallet.custody_model <> 'MANAGED'
    or v_wallet.status <> 'ACTIVE'
  then
    return query select 'STAKING_WALLET_NOT_ACTIVE'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, v_wallet.id, v_product.id, v_product.project_id, v_product.asset_id, v_principal_units, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  select profiles.*
    into v_profile
  from public.profiles as profiles
  where profiles.id = v_actor_user_id
  for update;

  if not found or v_profile.account_status <> 'ACTIVE' then
    return query select 'STAKING_PROFILE_NOT_ACTIVE'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, v_wallet.id, v_product.id, v_product.project_id, v_product.asset_id, v_principal_units, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  perform private.ensure_wallet_asset_ledger_accounts(v_wallet.id, v_product.asset_id);

  select
    (max(accounts.ledger_account_id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
    (max(accounts.ledger_account_id::text) filter (where accounts.account_purpose = 'USER_LOCKED'))::uuid
    into v_available_account_id, v_locked_account_id
  from private.ensure_wallet_asset_ledger_accounts(v_wallet.id, v_product.asset_id) as accounts;

  if v_available_account_id is null or v_locked_account_id is null then
    return query select 'STAKING_POSITION_LEDGER_UNAVAILABLE'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, v_wallet.id, v_product.id, v_product.project_id, v_product.asset_id, v_principal_units, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  perform accounts.id
  from private.ledger_accounts as accounts
  where accounts.id in (v_available_account_id, v_locked_account_id)
  order by accounts.id
  for update;

  select coalesce(balances.balance_units, 0::numeric)
    into v_available_units
  from private.ledger_account_balances as balances
  where balances.ledger_account_id = v_available_account_id;

  v_available_units := coalesce(v_available_units, 0::numeric);

  if v_available_units < v_principal_units::numeric then
    return query select 'STAKING_POSITION_INSUFFICIENT_AVAILABLE'::text, false, null::uuid, p_command_id, p_position_id, null::uuid, v_wallet.id, v_product.id, v_product.project_id, v_product.asset_id, v_principal_units, null::text, v_product.version, null::timestamptz, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_lock_journal_id, v_locked_at
  from private.post_ledger_journal(
    p_command_id,
    v_product.asset_id,
    'USER_STAKING_POSITION_LOCKED',
    'USER',
    v_actor_user_id,
    'STAKING_POSITION',
    p_position_id,
    'USER_STAKING_POSITION',
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_available_account_id::text,
        'side', 'DEBIT',
        'units', v_principal_units
      ),
      jsonb_build_object(
        'account_id', v_locked_account_id::text,
        'side', 'CREDIT',
        'units', v_principal_units
      )
    )
  ) as posted;

  insert into private.staking_positions (
    id,
    staking_product_id,
    project_id,
    asset_id,
    wallet_account_id,
    user_id,
    principal_units,
    status,
    lock_journal_id,
    product_version_snapshot,
    lock_duration_days_snapshot,
    term_reward_rate_ppm_snapshot,
    reward_rounding_mode_snapshot,
    locked_at,
    matures_at
  )
  values (
    p_position_id,
    v_product.id,
    v_product.project_id,
    v_product.asset_id,
    v_wallet.id,
    v_actor_user_id,
    v_principal_units::numeric::private.positive_atomic_units,
    'LOCKED',
    v_lock_journal_id,
    v_product.version,
    v_product.lock_duration_days,
    v_product.term_reward_rate_ppm,
    v_product.reward_rounding_mode,
    v_locked_at,
    v_locked_at + (v_product.lock_duration_days * interval '1 day')
  );

  insert into private.staking_position_command_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    wallet_account_id,
    staking_product_id,
    staking_position_id,
    project_id,
    asset_id,
    resulting_journal_id,
    reason,
    request_data,
    principal_units,
    resulting_status,
    entity_version
  )
  values (
    p_command_id,
    'CREATE_STAKING_POSITION',
    'APPLIED',
    v_actor_user_id,
    v_wallet.id,
    v_product.id,
    p_position_id,
    v_product.project_id,
    v_product.asset_id,
    v_lock_journal_id,
    'USER_STAKING_POSITION',
    v_request_data,
    v_principal_units::numeric::private.positive_atomic_units,
    'LOCKED',
    1
  )
  returning id into v_event_id;

  return query
    select
      'APPLIED'::text,
      false,
      v_event_id,
      p_command_id,
      positions.id,
      positions.lock_journal_id,
      positions.wallet_account_id,
      positions.staking_product_id,
      positions.project_id,
      positions.asset_id,
      positions.principal_units::text,
      positions.status,
      positions.version,
      positions.locked_at,
      positions.matures_at
    from private.staking_positions as positions
    where positions.id = p_position_id;
end;
$$;

comment on function public.create_user_staking_position(uuid, bigint, uuid, bigint, text, uuid, uuid) is
  'ACTIVE user command to create one LOCKED staking position and atomically post principal from USER_AVAILABLE to USER_LOCKED. It enforces product and wallet expected versions, project-token enrollment boundaries, exact Atomic Unit strings, idempotency, immutable audit, and no unlock, reward, wallet address, transaction ID, service-role, remote, mainnet, or on-chain behavior.';

create or replace function public.list_current_user_staking_positions(
  p_limit integer default 100
)
returns table (
  staking_position_id uuid,
  staking_product_id uuid,
  product_code text,
  product_display_name text,
  project_id uuid,
  project_code text,
  project_display_name text,
  asset_id uuid,
  asset_code text,
  asset_symbol text,
  asset_decimals smallint,
  principal_units text,
  status text,
  product_version_snapshot bigint,
  lock_duration_days_snapshot integer,
  term_reward_rate_ppm_snapshot integer,
  reward_rounding_mode_snapshot text,
  locked_at timestamptz,
  matures_at timestamptz,
  position_version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_limit integer;
begin
  v_user_id := private.staking_product_require_active_user();
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 200);

  return query
    select
      positions.id,
      positions.staking_product_id,
      products.product_code,
      products.display_name,
      positions.project_id,
      projects.project_code,
      projects.display_name,
      positions.asset_id,
      assets.asset_code,
      assets.symbol,
      assets.decimals,
      positions.principal_units::text,
      positions.status,
      positions.product_version_snapshot,
      positions.lock_duration_days_snapshot,
      positions.term_reward_rate_ppm_snapshot,
      positions.reward_rounding_mode_snapshot,
      positions.locked_at,
      positions.matures_at,
      positions.version
    from private.staking_positions as positions
    join private.staking_products as products
      on products.id = positions.staking_product_id
    join public.projects as projects
      on projects.id = positions.project_id
    join public.supported_assets as assets
      on assets.id = positions.asset_id
    where positions.user_id = v_user_id
    order by positions.locked_at desc, positions.id desc
    limit v_limit;
end;
$$;

comment on function public.list_current_user_staking_positions(integer) is
  'Authenticated ACTIVE user read RPC for the caller owned staking positions. It exposes product snapshots and principal Atomic Unit text only; no journal ID, wallet address, transaction ID, reward calculation, claim, unlock, or on-chain data is returned.';

create or replace function public.list_admin_staking_positions(
  p_limit integer default 100,
  p_status text default null
)
returns table (
  staking_position_id uuid,
  staking_product_id uuid,
  product_code text,
  project_id uuid,
  project_code text,
  asset_id uuid,
  asset_code text,
  asset_symbol text,
  asset_decimals smallint,
  wallet_account_id uuid,
  user_id uuid,
  principal_units text,
  status text,
  product_version_snapshot bigint,
  lock_duration_days_snapshot integer,
  term_reward_rate_ppm_snapshot integer,
  reward_rounding_mode_snapshot text,
  locked_at timestamptz,
  matures_at timestamptz,
  position_version bigint,
  wallet_status text,
  profile_status text
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
  if not public.is_current_user_admin_aal2() then
    raise exception 'STAKING_POSITION_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_status := nullif(pg_catalog.btrim(p_status), '');

  if v_status is not null and v_status <> 'LOCKED' then
    raise exception 'STAKING_POSITION_INVALID_STATUS_FILTER'
      using errcode = '22023';
  end if;

  return query
    select
      positions.id,
      positions.staking_product_id,
      products.product_code,
      positions.project_id,
      projects.project_code,
      positions.asset_id,
      assets.asset_code,
      assets.symbol,
      assets.decimals,
      positions.wallet_account_id,
      positions.user_id,
      positions.principal_units::text,
      positions.status,
      positions.product_version_snapshot,
      positions.lock_duration_days_snapshot,
      positions.term_reward_rate_ppm_snapshot,
      positions.reward_rounding_mode_snapshot,
      positions.locked_at,
      positions.matures_at,
      positions.version,
      wallet_accounts.status,
      profiles.account_status
    from private.staking_positions as positions
    join private.staking_products as products
      on products.id = positions.staking_product_id
    join public.projects as projects
      on projects.id = positions.project_id
    join public.supported_assets as assets
      on assets.id = positions.asset_id
    join public.wallet_accounts as wallet_accounts
      on wallet_accounts.id = positions.wallet_account_id
    join public.profiles as profiles
      on profiles.id = positions.user_id
    where v_status is null or positions.status = v_status
    order by positions.locked_at desc, positions.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_staking_positions(integer, text) is
  'ACTIVE ADMIN AAL2 read RPC for staking position operational review. It exposes principal lock state and snapshots but no private journal payloads, credentials, wallet addresses, transactions, rewards, unlocks, or on-chain data.';

create or replace function public.list_staking_position_command_audit_events(
  p_limit integer default 100,
  p_before_event_id uuid default null
)
returns table (
  event_id uuid,
  command_id uuid,
  action text,
  outcome text,
  actor_user_id uuid,
  wallet_account_id uuid,
  staking_product_id uuid,
  staking_position_id uuid,
  project_id uuid,
  asset_id uuid,
  reason text,
  principal_units text,
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
  v_before private.staking_position_command_audit_events%rowtype;
begin
  if not public.is_current_user_admin_aal2() then
    raise exception 'STAKING_POSITION_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 200);

  if p_before_event_id is not null then
    select events.*
      into v_before
    from private.staking_position_command_audit_events as events
    where events.id = p_before_event_id;
  end if;

  return query
    select
      events.id,
      events.command_id,
      events.action,
      events.outcome,
      events.actor_user_id,
      events.wallet_account_id,
      events.staking_product_id,
      events.staking_position_id,
      events.project_id,
      events.asset_id,
      events.reason,
      events.principal_units::text,
      events.resulting_status,
      events.entity_version,
      events.occurred_at
    from private.staking_position_command_audit_events as events
    where p_before_event_id is null
      or v_before.id is null
      or (events.occurred_at, events.id) < (v_before.occurred_at, v_before.id)
    order by events.occurred_at desc, events.id desc
    limit v_limit;
end;
$$;

comment on function public.list_staking_position_command_audit_events(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for staking position command audit summaries. It intentionally omits request_data and resulting journal payloads.';

revoke all privileges on table private.staking_positions
  from public, anon, authenticated;

revoke all privileges on table private.staking_position_command_audit_events
  from public, anon, authenticated;

revoke execute on function public.create_user_staking_position(uuid, bigint, uuid, bigint, text, uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.list_current_user_staking_positions(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_staking_positions(integer, text)
  from public, anon, authenticated;

revoke execute on function public.list_staking_position_command_audit_events(integer, uuid)
  from public, anon, authenticated;

grant execute on function public.create_user_staking_position(uuid, bigint, uuid, bigint, text, uuid, uuid)
  to authenticated;

grant execute on function public.list_current_user_staking_positions(integer)
  to authenticated;

grant execute on function public.list_admin_staking_positions(integer, text)
  to authenticated;

grant execute on function public.list_staking_position_command_audit_events(integer, uuid)
  to authenticated;
