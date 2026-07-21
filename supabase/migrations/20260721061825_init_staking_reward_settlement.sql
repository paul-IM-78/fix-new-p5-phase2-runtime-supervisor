create or replace function private.calculate_staking_reward_units(
  p_principal_units numeric,
  p_term_reward_rate_ppm integer,
  p_rounding_mode text
)
returns numeric
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_reward_units numeric;
begin
  if p_principal_units is null
    or p_principal_units <= 0
    or p_principal_units <> pg_catalog.trunc(p_principal_units)
    or p_principal_units >= pg_catalog.power(10::numeric, 38)
    or p_principal_units::text !~ '^[1-9][0-9]{0,37}$'
    or p_term_reward_rate_ppm is null
    or p_term_reward_rate_ppm < 1
    or p_term_reward_rate_ppm > 1000000
    or p_rounding_mode <> 'FLOOR'
  then
    raise exception 'STAKING_REWARD_CALCULATION_INVALID'
      using errcode = '22023';
  end if;

  v_reward_units := pg_catalog.floor(
    p_principal_units
    * p_term_reward_rate_ppm::numeric
    / 1000000::numeric
  );

  if v_reward_units < 0
    or v_reward_units <> pg_catalog.trunc(v_reward_units)
    or v_reward_units >= pg_catalog.power(10::numeric, 38)
    or v_reward_units::text !~ '^(0|[1-9][0-9]{0,37})$'
  then
    raise exception 'STAKING_REWARD_CALCULATION_INVALID'
      using errcode = '22023';
  end if;

  return v_reward_units;
end;
$$;

comment on function private.calculate_staking_reward_units(numeric, integer, text) is
  'Calculates one-shot staking reward Atomic Units from the immutable position principal and term reward rate snapshot using exact numeric FLOOR arithmetic. It does not use current product rates, JavaScript Number, APY, APR, compounding, or on-chain data.';

revoke execute on function private.calculate_staking_reward_units(numeric, integer, text)
  from public, anon, authenticated;

create table private.staking_position_reward_settlements (
  id uuid primary key default gen_random_uuid(),

  staking_position_id uuid not null unique
    references private.staking_positions (id) on delete restrict,

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

  position_version_snapshot bigint not null,

  principal_units private.positive_atomic_units not null,
  term_reward_rate_ppm_snapshot integer not null,
  reward_rounding_mode_snapshot text not null,

  reward_units numeric(38, 0) not null,

  outcome text not null,

  reward_journal_id uuid null unique
    references private.ledger_journals (id) on delete restrict,

  settled_by uuid not null
    references public.profiles (id) on delete restrict,

  actor_type text not null,

  settled_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),

  constraint staking_reward_position_version_snapshot_check
    check (position_version_snapshot >= 1),

  constraint staking_reward_rate_snapshot_check
    check (term_reward_rate_ppm_snapshot between 1 and 1000000),

  constraint staking_reward_rounding_snapshot_check
    check (reward_rounding_mode_snapshot = 'FLOOR'),

  constraint staking_reward_units_check
    check (
      reward_units >= 0
      and reward_units = pg_catalog.trunc(reward_units)
      and reward_units < pg_catalog.power(10::numeric, 38)
      and reward_units::text ~ '^(0|[1-9][0-9]{0,37})$'
    ),

  constraint staking_reward_outcome_check
    check (outcome in ('PAID', 'ZERO')),

  constraint staking_reward_actor_type_check
    check (actor_type in ('USER', 'ADMIN')),

  constraint staking_reward_outcome_shape_check
    check (
      (
        outcome = 'PAID'
        and reward_units > 0
        and reward_journal_id is not null
      )
      or (
        outcome = 'ZERO'
        and reward_units = 0
        and reward_journal_id is null
      )
    )
);

comment on table private.staking_position_reward_settlements is
  'Immutable one-shot staking reward settlement for an UNLOCKED position. Reward units are calculated from the stored position snapshot only; PAID creates one internal reward journal and ZERO creates no journal.';

create index staking_reward_settlements_user_idx
  on private.staking_position_reward_settlements (user_id, settled_at desc, id desc);

create index staking_reward_settlements_wallet_idx
  on private.staking_position_reward_settlements (wallet_account_id, settled_at desc, id desc);

create index staking_reward_settlements_product_idx
  on private.staking_position_reward_settlements (staking_product_id, settled_at desc, id desc);

create index staking_reward_settlements_asset_idx
  on private.staking_position_reward_settlements (asset_id, settled_at desc, id desc);

create index staking_reward_settlements_outcome_idx
  on private.staking_position_reward_settlements (outcome, settled_at desc, id desc);

create index staking_reward_settlements_settled_by_idx
  on private.staking_position_reward_settlements (settled_by, settled_at desc, id desc);

create table private.staking_reward_command_audit_events (
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

  staking_product_id uuid not null
    references private.staking_products (id) on delete restrict,

  staking_position_id uuid not null
    references private.staking_positions (id) on delete restrict,

  reward_settlement_id uuid not null
    references private.staking_position_reward_settlements (id) on delete restrict,

  project_id uuid not null
    references public.projects (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  resulting_journal_id uuid null
    references private.ledger_journals (id) on delete restrict,

  reason text not null,
  request_data jsonb not null,

  reward_units numeric(38, 0) not null,
  settlement_outcome text not null,

  occurred_at timestamptz not null default clock_timestamp(),

  constraint staking_reward_audit_action_check
    check (action = 'SETTLE_STAKING_REWARD'),

  constraint staking_reward_audit_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),

  constraint staking_reward_audit_actor_type_check
    check (actor_type in ('USER', 'ADMIN')),

  constraint staking_reward_audit_settlement_outcome_check
    check (settlement_outcome in ('PAID', 'ZERO')),

  constraint staking_reward_audit_reward_units_check
    check (
      reward_units >= 0
      and reward_units = pg_catalog.trunc(reward_units)
      and reward_units < pg_catalog.power(10::numeric, 38)
      and reward_units::text ~ '^(0|[1-9][0-9]{0,37})$'
    ),

  constraint staking_reward_audit_shape_check
    check (
      (
        settlement_outcome = 'PAID'
        and reward_units > 0
        and resulting_journal_id is not null
      )
      or (
        settlement_outcome = 'ZERO'
        and reward_units = 0
        and resulting_journal_id is null
      )
    ),

  constraint staking_reward_audit_reason_check
    check (
      (
        actor_type = 'USER'
        and reason = 'USER_STAKING_REWARD_SETTLEMENT'
      )
      or (
        actor_type = 'ADMIN'
        and reason = pg_catalog.btrim(reason)
        and pg_catalog.char_length(reason) between 1 and 500
        and reason !~ '[[:cntrl:]]'
        and reason !~* '(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)'
      )
    ),

  constraint staking_reward_audit_request_data_check
    check (
      jsonb_typeof(request_data) = 'object'
      and request_data::text !~* '(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)'
    )
);

comment on table private.staking_reward_command_audit_events is
  'Append-only audit for staking reward settlement commands. It stores command boundaries and reward units as structured data while omitting credentials, wallet addresses, transactions, user metadata, and balance snapshots.';

create index staking_reward_audit_occurred_idx
  on private.staking_reward_command_audit_events (occurred_at desc, id desc);

create index staking_reward_audit_actor_idx
  on private.staking_reward_command_audit_events (actor_user_id, occurred_at desc);

create index staking_reward_audit_target_idx
  on private.staking_reward_command_audit_events (target_user_id, occurred_at desc);

create index staking_reward_audit_wallet_idx
  on private.staking_reward_command_audit_events (wallet_account_id, occurred_at desc);

create index staking_reward_audit_position_idx
  on private.staking_reward_command_audit_events (staking_position_id, occurred_at desc);

create index staking_reward_audit_settlement_idx
  on private.staking_reward_command_audit_events (reward_settlement_id);

create index staking_reward_audit_asset_idx
  on private.staking_reward_command_audit_events (asset_id, occurred_at desc);

create or replace function private.prevent_staking_reward_settlement_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'STAKING_REWARD_SETTLEMENT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_staking_reward_settlement_mutation() is
  'Blocks update, delete, and truncate of immutable staking reward settlement rows without exposing identifiers, rates, or reward values.';

revoke execute on function private.prevent_staking_reward_settlement_mutation()
  from public, anon, authenticated;

create trigger protect_staking_position_reward_settlements
  before update or delete or truncate on private.staking_position_reward_settlements
  for each statement
  execute function private.prevent_staking_reward_settlement_mutation();

create or replace function private.prevent_staking_reward_command_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'STAKING_REWARD_AUDIT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_staking_reward_command_audit_mutation() is
  'Blocks update, delete, and truncate of staking reward command audit rows without exposing identifiers, rates, reasons, or reward values.';

revoke execute on function private.prevent_staking_reward_command_audit_mutation()
  from public, anon, authenticated;

create trigger protect_staking_reward_command_audit_events
  before update or delete or truncate on private.staking_reward_command_audit_events
  for each statement
  execute function private.prevent_staking_reward_command_audit_mutation();

create or replace function private.ensure_staking_reward_expense_account(
  p_asset_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  if p_asset_id is null then
    raise exception 'STAKING_REWARD_ACCOUNT_UNAVAILABLE'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:ledger-provisioning:v1',
      0
    )
  );

  if not exists (
    select 1
    from public.supported_assets as assets
    where assets.id = p_asset_id
  ) then
    raise exception 'STAKING_REWARD_ACCOUNT_UNAVAILABLE'
      using errcode = '23503';
  end if;

  insert into private.ledger_accounts (
    asset_id,
    wallet_account_id,
    account_scope,
    account_class,
    account_purpose,
    normal_side
  )
  values (
    p_asset_id,
    null,
    'SYSTEM',
    'EXPENSE',
    'SYSTEM_REWARD_EXPENSE',
    'DEBIT'
  )
  on conflict do nothing;

  select accounts.id
    into v_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'SYSTEM'
    and accounts.asset_id = p_asset_id
    and accounts.wallet_account_id is null
    and accounts.account_class = 'EXPENSE'
    and accounts.normal_side = 'DEBIT'
    and accounts.account_purpose = 'SYSTEM_REWARD_EXPENSE'
    and accounts.status = 'OPEN'
  for update;

  if v_account_id is null then
    raise exception 'STAKING_REWARD_ACCOUNT_UNAVAILABLE'
      using errcode = '23514';
  end if;

  return v_account_id;
end;
$$;

comment on function private.ensure_staking_reward_expense_account(uuid) is
  'Idempotently ensures the SYSTEM_REWARD_EXPENSE ledger account for one asset so existing position reward obligations can be settled even when current catalog status has changed.';

revoke execute on function private.ensure_staking_reward_expense_account(uuid)
  from public, anon, authenticated;

create or replace function private.staking_reward_normalize_admin_reason(
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

revoke execute on function private.staking_reward_normalize_admin_reason(text)
  from public, anon, authenticated;

create or replace function private.validate_staking_reward_settlement_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position private.staking_positions%rowtype;
  v_expected_reward numeric;
  v_journal private.ledger_journals%rowtype;
  v_entry_count integer;
  v_reward_debit_count integer;
  v_available_credit_count integer;
  v_debit_units numeric;
  v_credit_units numeric;
begin
  select positions.*
    into v_position
  from private.staking_positions as positions
  where positions.id = new.staking_position_id;

  if not found
    or v_position.status <> 'UNLOCKED'
    or new.staking_product_id <> v_position.staking_product_id
    or new.project_id <> v_position.project_id
    or new.asset_id <> v_position.asset_id
    or new.wallet_account_id <> v_position.wallet_account_id
    or new.user_id <> v_position.user_id
    or new.position_version_snapshot < 1
    or new.principal_units <> v_position.principal_units
    or new.term_reward_rate_ppm_snapshot <> v_position.term_reward_rate_ppm_snapshot
    or new.reward_rounding_mode_snapshot <> v_position.reward_rounding_mode_snapshot
  then
    raise exception 'STAKING_REWARD_SETTLEMENT_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  v_expected_reward := private.calculate_staking_reward_units(
    v_position.principal_units,
    v_position.term_reward_rate_ppm_snapshot,
    v_position.reward_rounding_mode_snapshot
  );

  if new.reward_units <> v_expected_reward then
    raise exception 'STAKING_REWARD_SETTLEMENT_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if new.outcome = 'ZERO' then
    if new.reward_units <> 0
      or new.reward_journal_id is not null
      or not exists (
        select 1
        from private.staking_reward_command_audit_events as events
        where events.reward_settlement_id = new.id
          and events.action = 'SETTLE_STAKING_REWARD'
          and events.outcome = 'APPLIED'
          and events.settlement_outcome = 'ZERO'
      )
    then
      raise exception 'STAKING_REWARD_SETTLEMENT_INVARIANT_VIOLATION'
        using errcode = '23514';
    end if;

    return new;
  end if;

  select journals.*
    into v_journal
  from private.ledger_journals as journals
  where journals.id = new.reward_journal_id;

  if not found
    or new.reward_units <= 0
    or v_journal.asset_id <> v_position.asset_id
    or v_journal.reference_type <> 'STAKING_REWARD_SETTLEMENT'
    or v_journal.reference_id <> new.id
    or v_journal.initiator_type <> new.actor_type
    or v_journal.initiator_user_id <> new.settled_by
    or new.settled_at <> v_journal.posted_at
    or (
      new.actor_type = 'USER'
      and v_journal.journal_type <> 'USER_STAKING_REWARD_PAID'
    )
    or (
      new.actor_type = 'ADMIN'
      and v_journal.journal_type <> 'ADMIN_STAKING_REWARD_PAID'
    )
  then
    raise exception 'STAKING_REWARD_SETTLEMENT_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where entries.side = 'DEBIT'
        and accounts.account_scope = 'SYSTEM'
        and accounts.account_class = 'EXPENSE'
        and accounts.normal_side = 'DEBIT'
        and accounts.account_purpose = 'SYSTEM_REWARD_EXPENSE'
        and accounts.wallet_account_id is null
        and accounts.asset_id = v_position.asset_id
    )::integer,
    count(*) filter (
      where entries.side = 'CREDIT'
        and accounts.account_scope = 'USER'
        and accounts.account_class = 'LIABILITY'
        and accounts.normal_side = 'CREDIT'
        and accounts.account_purpose = 'USER_AVAILABLE'
        and accounts.wallet_account_id = v_position.wallet_account_id
        and accounts.asset_id = v_position.asset_id
    )::integer,
    coalesce(sum(entries.units::numeric) filter (where entries.side = 'DEBIT'), 0::numeric),
    coalesce(sum(entries.units::numeric) filter (where entries.side = 'CREDIT'), 0::numeric)
    into
      v_entry_count,
      v_reward_debit_count,
      v_available_credit_count,
      v_debit_units,
      v_credit_units
  from private.ledger_entries as entries
  join private.ledger_accounts as accounts
    on accounts.id = entries.ledger_account_id
  where entries.journal_id = new.reward_journal_id;

  if v_entry_count <> 2
    or v_reward_debit_count <> 1
    or v_available_credit_count <> 1
    or v_debit_units <> new.reward_units
    or v_credit_units <> new.reward_units
    or not exists (
      select 1
      from private.staking_reward_command_audit_events as events
      where events.reward_settlement_id = new.id
        and events.action = 'SETTLE_STAKING_REWARD'
        and events.outcome = 'APPLIED'
        and events.settlement_outcome = 'PAID'
        and events.resulting_journal_id = new.reward_journal_id
    )
  then
    raise exception 'STAKING_REWARD_SETTLEMENT_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function private.validate_staking_reward_settlement_invariants() is
  'Deferred invariant tying a reward settlement to an UNLOCKED position snapshot and, for PAID outcomes, exactly one SYSTEM_REWARD_EXPENSE to USER_AVAILABLE journal.';

revoke execute on function private.validate_staking_reward_settlement_invariants()
  from public, anon, authenticated;

create constraint trigger validate_staking_reward_settlement_invariants
  after insert on private.staking_position_reward_settlements
  deferrable initially deferred
  for each row
  execute function private.validate_staking_reward_settlement_invariants();

drop function public.list_current_user_staking_positions(integer);

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
  maturity_state text,
  product_version_snapshot bigint,
  lock_duration_days_snapshot integer,
  term_reward_rate_ppm_snapshot integer,
  reward_rounding_mode_snapshot text,
  locked_at timestamptz,
  matures_at timestamptz,
  unlocked_at timestamptz,
  unlock_actor_type text,
  position_version bigint,
  reward_state text,
  calculated_reward_units text,
  reward_settled_at timestamptz,
  reward_actor_type text
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
      private.staking_position_maturity_state(
        positions.status,
        positions.matures_at
      ),
      positions.product_version_snapshot,
      positions.lock_duration_days_snapshot,
      positions.term_reward_rate_ppm_snapshot,
      positions.reward_rounding_mode_snapshot,
      positions.locked_at,
      positions.matures_at,
      positions.unlocked_at,
      positions.unlock_actor_type,
      positions.version,
      case
        when positions.status <> 'UNLOCKED' then 'NOT_ELIGIBLE'
        when settlements.id is null then 'CLAIMABLE'
        else settlements.outcome
      end,
      private.calculate_staking_reward_units(
        positions.principal_units,
        positions.term_reward_rate_ppm_snapshot,
        positions.reward_rounding_mode_snapshot
      )::text,
      settlements.settled_at,
      settlements.actor_type
    from private.staking_positions as positions
    join private.staking_products as products
      on products.id = positions.staking_product_id
    join public.projects as projects
      on projects.id = positions.project_id
    join public.supported_assets as assets
      on assets.id = positions.asset_id
    left join private.staking_position_reward_settlements as settlements
      on settlements.staking_position_id = positions.id
    where positions.user_id = v_user_id
    order by positions.locked_at desc, positions.id desc
    limit v_limit;
end;
$$;

comment on function public.list_current_user_staking_positions(integer) is
  'Authenticated ACTIVE user read RPC for caller-owned staking positions. Reward state and calculated reward units are derived from immutable position snapshots; user output omits settlement IDs, journal IDs, settled_by IDs, audit payloads, wallet addresses, transactions, and on-chain data.';

drop function public.list_admin_staking_positions(integer, text);

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
  maturity_state text,
  unlock_actor_type text,
  unlocked_by uuid,
  unlocked_at timestamptz,
  product_version_snapshot bigint,
  lock_duration_days_snapshot integer,
  term_reward_rate_ppm_snapshot integer,
  reward_rounding_mode_snapshot text,
  locked_at timestamptz,
  matures_at timestamptz,
  position_version bigint,
  wallet_status text,
  profile_status text,
  reward_state text,
  calculated_reward_units text,
  reward_settlement_id uuid,
  settlement_outcome text,
  reward_actor_type text,
  settled_by uuid,
  reward_settled_at timestamptz,
  reward_journal_id uuid
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

  if v_status is not null and v_status not in ('LOCKED', 'UNLOCKED') then
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
      private.staking_position_maturity_state(
        positions.status,
        positions.matures_at
      ),
      positions.unlock_actor_type,
      positions.unlocked_by,
      positions.unlocked_at,
      positions.product_version_snapshot,
      positions.lock_duration_days_snapshot,
      positions.term_reward_rate_ppm_snapshot,
      positions.reward_rounding_mode_snapshot,
      positions.locked_at,
      positions.matures_at,
      positions.version,
      wallet_accounts.status,
      profiles.account_status,
      case
        when positions.status <> 'UNLOCKED' then 'NOT_ELIGIBLE'
        when settlements.id is null then 'CLAIMABLE'
        else settlements.outcome
      end,
      private.calculate_staking_reward_units(
        positions.principal_units,
        positions.term_reward_rate_ppm_snapshot,
        positions.reward_rounding_mode_snapshot
      )::text,
      settlements.id,
      settlements.outcome,
      settlements.actor_type,
      settlements.settled_by,
      settlements.settled_at,
      settlements.reward_journal_id
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
    left join private.staking_position_reward_settlements as settlements
      on settlements.staking_position_id = positions.id
    where v_status is null or positions.status = v_status
    order by positions.locked_at desc, positions.id desc
    limit v_limit;
end;
$$;

comment on function public.list_admin_staking_positions(integer, text) is
  'ACTIVE ADMIN AAL2 read RPC for staking position review. It exposes principal unlock and reward settlement summaries without full request data, ledger lines, credentials, wallet addresses, transactions, or on-chain data.';

create or replace function public.list_staking_reward_command_audit_events(
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
  staking_product_id uuid,
  staking_position_id uuid,
  reward_settlement_id uuid,
  project_id uuid,
  asset_id uuid,
  resulting_journal_id uuid,
  reward_units text,
  settlement_outcome text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_before private.staking_reward_command_audit_events%rowtype;
begin
  if not public.is_current_user_admin_aal2() then
    raise exception 'STAKING_REWARD_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  if p_before_event_id is not null then
    select events.*
      into v_before
    from private.staking_reward_command_audit_events as events
    where events.id = p_before_event_id;
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
      events.staking_product_id,
      events.staking_position_id,
      events.reward_settlement_id,
      events.project_id,
      events.asset_id,
      events.resulting_journal_id,
      events.reward_units::text,
      events.settlement_outcome,
      events.occurred_at
    from private.staking_reward_command_audit_events as events
    where p_before_event_id is null
      or v_before.id is null
      or (events.occurred_at, events.id) < (v_before.occurred_at, v_before.id)
    order by events.occurred_at desc, events.id desc
    limit v_limit;
end;
$$;

comment on function public.list_staking_reward_command_audit_events(integer, uuid) is
  'ACTIVE ADMIN AAL2 read RPC for staking reward command audit summaries. It returns command metadata and reward units while intentionally omitting request_data and ledger entry payloads.';

create or replace function public.settle_current_user_staking_reward(
  p_staking_position_id uuid,
  p_position_expected_version bigint,
  p_wallet_expected_version bigint,
  p_command_id uuid
)
returns table (
  result_code text,
  replayed boolean,
  staking_position_id uuid,
  reward_settlement_id uuid,
  reward_state text,
  settlement_outcome text,
  reward_units text,
  settled_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_request_data jsonb;
  v_existing_event private.staking_reward_command_audit_events%rowtype;
  v_existing_settlement private.staking_position_reward_settlements%rowtype;
  v_position private.staking_positions%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_available_account_id uuid;
  v_reward_expense_account_id uuid;
  v_reward_units numeric;
  v_settlement_id uuid;
  v_settlement_outcome text;
  v_reward_journal_id uuid;
  v_settled_at timestamptz;
begin
  v_actor_user_id := private.staking_product_require_active_user();

  if p_staking_position_id is null
    or p_position_expected_version is null
    or p_position_expected_version < 1
    or p_wallet_expected_version is null
    or p_wallet_expected_version < 1
    or p_command_id is null
  then
    return query select 'INVALID_INPUT'::text, false, p_staking_position_id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'SETTLE_STAKING_REWARD',
    'actor_user_id', v_actor_user_id::text,
    'actor_type', 'USER',
    'staking_position_id', p_staking_position_id::text,
    'position_expected_version', p_position_expected_version,
    'wallet_expected_version', p_wallet_expected_version,
    'reason', 'USER_STAKING_REWARD_SETTLEMENT'
  );

  perform private.staking_position_lock();

  select events.*
    into v_existing_event
  from private.staking_reward_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'USER'
      and v_existing_event.action = 'SETTLE_STAKING_REWARD'
      and v_existing_event.staking_position_id = p_staking_position_id
      and v_existing_event.reason = 'USER_STAKING_REWARD_SETTLEMENT'
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          settlements.staking_position_id,
          settlements.id,
          settlements.outcome,
          settlements.outcome,
          settlements.reward_units::text,
          settlements.settled_at
        from private.staking_position_reward_settlements as settlements
        where settlements.id = v_existing_event.reward_settlement_id;
      return;
    end if;

    return query select 'STAKING_REWARD_COMMAND_ID_CONFLICT'::text, false, p_staking_position_id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.staking_position_command_audit_events as events
    where events.command_id = p_command_id
  )
    or exists (
      select 1
      from private.ledger_journals as journals
      where journals.command_id = p_command_id
    )
  then
    return query select 'STAKING_REWARD_COMMAND_ID_CONFLICT'::text, false, p_staking_position_id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select positions.*
    into v_position
  from private.staking_positions as positions
  where positions.id = p_staking_position_id
  for update;

  if not found then
    return query select 'STAKING_REWARD_POSITION_NOT_FOUND'::text, false, p_staking_position_id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_position.user_id <> v_actor_user_id then
    return query select 'STAKING_REWARD_FORBIDDEN'::text, false, v_position.id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_position.version <> p_position_expected_version then
    return query select 'STAKING_REWARD_POSITION_VERSION_CONFLICT'::text, false, v_position.id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_position.status <> 'UNLOCKED' then
    return query select 'STAKING_REWARD_POSITION_NOT_UNLOCKED'::text, false, v_position.id, null::uuid, 'NOT_ELIGIBLE'::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select wallet_accounts.*
    into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_position.wallet_account_id
  for update;

  if not found then
    return query select 'STAKING_REWARD_WALLET_NOT_FOUND'::text, false, v_position.id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_wallet.user_id <> v_actor_user_id
    or v_wallet.custody_model <> 'MANAGED'
  then
    return query select 'STAKING_REWARD_FORBIDDEN'::text, false, v_position.id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_wallet.version <> p_wallet_expected_version then
    return query select 'STAKING_REWARD_WALLET_VERSION_CONFLICT'::text, false, v_position.id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_wallet.status <> 'ACTIVE' then
    return query select 'STAKING_REWARD_WALLET_NOT_ACTIVE'::text, false, v_position.id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select settlements.*
    into v_existing_settlement
  from private.staking_position_reward_settlements as settlements
  where settlements.staking_position_id = v_position.id
  for update;

  if found then
    insert into private.staking_reward_command_audit_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      actor_type,
      target_user_id,
      wallet_account_id,
      staking_product_id,
      staking_position_id,
      reward_settlement_id,
      project_id,
      asset_id,
      resulting_journal_id,
      reason,
      request_data,
      reward_units,
      settlement_outcome
    )
    values (
      p_command_id,
      'SETTLE_STAKING_REWARD',
      'NOOP',
      v_actor_user_id,
      'USER',
      v_position.user_id,
      v_position.wallet_account_id,
      v_position.staking_product_id,
      v_position.id,
      v_existing_settlement.id,
      v_position.project_id,
      v_position.asset_id,
      v_existing_settlement.reward_journal_id,
      'USER_STAKING_REWARD_SETTLEMENT',
      v_request_data,
      v_existing_settlement.reward_units,
      v_existing_settlement.outcome
    );

    return query select 'NOOP'::text, false, v_position.id, v_existing_settlement.id, v_existing_settlement.outcome, v_existing_settlement.outcome, v_existing_settlement.reward_units::text, v_existing_settlement.settled_at;
    return;
  end if;

  v_reward_units := private.calculate_staking_reward_units(
    v_position.principal_units,
    v_position.term_reward_rate_ppm_snapshot,
    v_position.reward_rounding_mode_snapshot
  );

  select accounts.id
    into v_available_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.account_class = 'LIABILITY'
    and accounts.normal_side = 'CREDIT'
    and accounts.account_purpose = 'USER_AVAILABLE'
    and accounts.wallet_account_id = v_position.wallet_account_id
    and accounts.asset_id = v_position.asset_id
    and accounts.status = 'OPEN'
  for update;

  if v_available_account_id is null then
    return query select 'STAKING_REWARD_ACCOUNT_UNAVAILABLE'::text, false, v_position.id, null::uuid, 'CLAIMABLE'::text, null::text, v_reward_units::text, null::timestamptz;
    return;
  end if;

  v_settlement_id := gen_random_uuid();
  v_settlement_outcome := case when v_reward_units = 0 then 'ZERO' else 'PAID' end;

  if v_reward_units > 0 then
    v_reward_expense_account_id := private.ensure_staking_reward_expense_account(v_position.asset_id);

    perform accounts.id
    from private.ledger_accounts as accounts
    where accounts.id in (v_available_account_id, v_reward_expense_account_id)
    order by accounts.id
    for update;

    select posted.journal_id, posted.posted_at
      into v_reward_journal_id, v_settled_at
    from private.post_ledger_journal(
      p_command_id,
      v_position.asset_id,
      'USER_STAKING_REWARD_PAID',
      'USER',
      v_actor_user_id,
      'STAKING_REWARD_SETTLEMENT',
      v_settlement_id,
      'USER_STAKING_REWARD_SETTLEMENT',
      jsonb_build_array(
        jsonb_build_object(
          'account_id', v_reward_expense_account_id::text,
          'side', 'DEBIT',
          'units', v_reward_units::text
        ),
        jsonb_build_object(
          'account_id', v_available_account_id::text,
          'side', 'CREDIT',
          'units', v_reward_units::text
        )
      )
    ) as posted;
  else
    v_reward_journal_id := null;
    v_settled_at := clock_timestamp();
  end if;

  insert into private.staking_position_reward_settlements (
    id,
    staking_position_id,
    staking_product_id,
    project_id,
    asset_id,
    wallet_account_id,
    user_id,
    position_version_snapshot,
    principal_units,
    term_reward_rate_ppm_snapshot,
    reward_rounding_mode_snapshot,
    reward_units,
    outcome,
    reward_journal_id,
    settled_by,
    actor_type,
    settled_at,
    created_at
  )
  values (
    v_settlement_id,
    v_position.id,
    v_position.staking_product_id,
    v_position.project_id,
    v_position.asset_id,
    v_position.wallet_account_id,
    v_position.user_id,
    v_position.version,
    v_position.principal_units,
    v_position.term_reward_rate_ppm_snapshot,
    v_position.reward_rounding_mode_snapshot,
    v_reward_units,
    v_settlement_outcome,
    v_reward_journal_id,
    v_actor_user_id,
    'USER',
    v_settled_at,
    v_settled_at
  );

  insert into private.staking_reward_command_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    actor_type,
    target_user_id,
    wallet_account_id,
    staking_product_id,
    staking_position_id,
    reward_settlement_id,
    project_id,
    asset_id,
    resulting_journal_id,
    reason,
    request_data,
    reward_units,
    settlement_outcome
  )
  values (
    p_command_id,
    'SETTLE_STAKING_REWARD',
    'APPLIED',
    v_actor_user_id,
    'USER',
    v_position.user_id,
    v_position.wallet_account_id,
    v_position.staking_product_id,
    v_position.id,
    v_settlement_id,
    v_position.project_id,
    v_position.asset_id,
    v_reward_journal_id,
    'USER_STAKING_REWARD_SETTLEMENT',
    v_request_data,
    v_reward_units,
    v_settlement_outcome
  );

  return query select 'APPLIED'::text, false, v_position.id, v_settlement_id, v_settlement_outcome, v_settlement_outcome, v_reward_units::text, v_settled_at;
end;
$$;

comment on function public.settle_current_user_staking_reward(uuid, bigint, bigint, uuid) is
  'ACTIVE user command to settle one already UNLOCKED owned staking position reward from immutable position snapshots. Positive rewards post SYSTEM_REWARD_EXPENSE to USER_AVAILABLE; zero rewards create no journal.';

create or replace function public.settle_staking_reward_as_admin(
  p_staking_position_id uuid,
  p_position_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  staking_position_id uuid,
  reward_settlement_id uuid,
  reward_state text,
  settlement_outcome text,
  reward_units text,
  settled_at timestamptz
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
  v_existing_event private.staking_reward_command_audit_events%rowtype;
  v_existing_settlement private.staking_position_reward_settlements%rowtype;
  v_position private.staking_positions%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_available_account_id uuid;
  v_reward_expense_account_id uuid;
  v_reward_units numeric;
  v_settlement_id uuid;
  v_settlement_outcome text;
  v_reward_journal_id uuid;
  v_settled_at timestamptz;
begin
  v_actor_user_id := (select auth.uid());
  v_reason := private.staking_reward_normalize_admin_reason(p_reason);

  if v_actor_user_id is null or not public.is_current_user_admin_aal2() then
    raise exception 'STAKING_REWARD_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  if p_staking_position_id is null
    or p_position_expected_version is null
    or p_position_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, p_staking_position_id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'SETTLE_STAKING_REWARD',
    'actor_user_id', v_actor_user_id::text,
    'actor_type', 'ADMIN',
    'staking_position_id', p_staking_position_id::text,
    'position_expected_version', p_position_expected_version,
    'wallet_expected_version', null,
    'reason', v_reason
  );

  perform private.staking_position_lock();

  select events.*
    into v_existing_event
  from private.staking_reward_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'ADMIN'
      and v_existing_event.action = 'SETTLE_STAKING_REWARD'
      and v_existing_event.staking_position_id = p_staking_position_id
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          settlements.staking_position_id,
          settlements.id,
          settlements.outcome,
          settlements.outcome,
          settlements.reward_units::text,
          settlements.settled_at
        from private.staking_position_reward_settlements as settlements
        where settlements.id = v_existing_event.reward_settlement_id;
      return;
    end if;

    return query select 'STAKING_REWARD_COMMAND_ID_CONFLICT'::text, false, p_staking_position_id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.staking_position_command_audit_events as events
    where events.command_id = p_command_id
  )
    or exists (
      select 1
      from private.ledger_journals as journals
      where journals.command_id = p_command_id
    )
  then
    return query select 'STAKING_REWARD_COMMAND_ID_CONFLICT'::text, false, p_staking_position_id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select positions.*
    into v_position
  from private.staking_positions as positions
  where positions.id = p_staking_position_id
  for update;

  if not found then
    return query select 'STAKING_REWARD_POSITION_NOT_FOUND'::text, false, p_staking_position_id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_position.version <> p_position_expected_version then
    return query select 'STAKING_REWARD_POSITION_VERSION_CONFLICT'::text, false, v_position.id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_position.status <> 'UNLOCKED' then
    return query select 'STAKING_REWARD_POSITION_NOT_UNLOCKED'::text, false, v_position.id, null::uuid, 'NOT_ELIGIBLE'::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select wallet_accounts.*
    into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_position.wallet_account_id
  for update;

  if not found
    or v_wallet.user_id <> v_position.user_id
    or v_wallet.custody_model <> 'MANAGED'
  then
    return query select 'STAKING_REWARD_WALLET_NOT_FOUND'::text, false, v_position.id, null::uuid, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select settlements.*
    into v_existing_settlement
  from private.staking_position_reward_settlements as settlements
  where settlements.staking_position_id = v_position.id
  for update;

  if found then
    insert into private.staking_reward_command_audit_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      actor_type,
      target_user_id,
      wallet_account_id,
      staking_product_id,
      staking_position_id,
      reward_settlement_id,
      project_id,
      asset_id,
      resulting_journal_id,
      reason,
      request_data,
      reward_units,
      settlement_outcome
    )
    values (
      p_command_id,
      'SETTLE_STAKING_REWARD',
      'NOOP',
      v_actor_user_id,
      'ADMIN',
      v_position.user_id,
      v_position.wallet_account_id,
      v_position.staking_product_id,
      v_position.id,
      v_existing_settlement.id,
      v_position.project_id,
      v_position.asset_id,
      v_existing_settlement.reward_journal_id,
      v_reason,
      v_request_data,
      v_existing_settlement.reward_units,
      v_existing_settlement.outcome
    );

    return query select 'NOOP'::text, false, v_position.id, v_existing_settlement.id, v_existing_settlement.outcome, v_existing_settlement.outcome, v_existing_settlement.reward_units::text, v_existing_settlement.settled_at;
    return;
  end if;

  v_reward_units := private.calculate_staking_reward_units(
    v_position.principal_units,
    v_position.term_reward_rate_ppm_snapshot,
    v_position.reward_rounding_mode_snapshot
  );

  select accounts.id
    into v_available_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.account_class = 'LIABILITY'
    and accounts.normal_side = 'CREDIT'
    and accounts.account_purpose = 'USER_AVAILABLE'
    and accounts.wallet_account_id = v_position.wallet_account_id
    and accounts.asset_id = v_position.asset_id
    and accounts.status = 'OPEN'
  for update;

  if v_available_account_id is null then
    return query select 'STAKING_REWARD_ACCOUNT_UNAVAILABLE'::text, false, v_position.id, null::uuid, 'CLAIMABLE'::text, null::text, v_reward_units::text, null::timestamptz;
    return;
  end if;

  v_settlement_id := gen_random_uuid();
  v_settlement_outcome := case when v_reward_units = 0 then 'ZERO' else 'PAID' end;

  if v_reward_units > 0 then
    v_reward_expense_account_id := private.ensure_staking_reward_expense_account(v_position.asset_id);

    perform accounts.id
    from private.ledger_accounts as accounts
    where accounts.id in (v_available_account_id, v_reward_expense_account_id)
    order by accounts.id
    for update;

    select posted.journal_id, posted.posted_at
      into v_reward_journal_id, v_settled_at
    from private.post_ledger_journal(
      p_command_id,
      v_position.asset_id,
      'ADMIN_STAKING_REWARD_PAID',
      'ADMIN',
      v_actor_user_id,
      'STAKING_REWARD_SETTLEMENT',
      v_settlement_id,
      v_reason,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', v_reward_expense_account_id::text,
          'side', 'DEBIT',
          'units', v_reward_units::text
        ),
        jsonb_build_object(
          'account_id', v_available_account_id::text,
          'side', 'CREDIT',
          'units', v_reward_units::text
        )
      )
    ) as posted;
  else
    v_reward_journal_id := null;
    v_settled_at := clock_timestamp();
  end if;

  insert into private.staking_position_reward_settlements (
    id,
    staking_position_id,
    staking_product_id,
    project_id,
    asset_id,
    wallet_account_id,
    user_id,
    position_version_snapshot,
    principal_units,
    term_reward_rate_ppm_snapshot,
    reward_rounding_mode_snapshot,
    reward_units,
    outcome,
    reward_journal_id,
    settled_by,
    actor_type,
    settled_at,
    created_at
  )
  values (
    v_settlement_id,
    v_position.id,
    v_position.staking_product_id,
    v_position.project_id,
    v_position.asset_id,
    v_position.wallet_account_id,
    v_position.user_id,
    v_position.version,
    v_position.principal_units,
    v_position.term_reward_rate_ppm_snapshot,
    v_position.reward_rounding_mode_snapshot,
    v_reward_units,
    v_settlement_outcome,
    v_reward_journal_id,
    v_actor_user_id,
    'ADMIN',
    v_settled_at,
    v_settled_at
  );

  insert into private.staking_reward_command_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    actor_type,
    target_user_id,
    wallet_account_id,
    staking_product_id,
    staking_position_id,
    reward_settlement_id,
    project_id,
    asset_id,
    resulting_journal_id,
    reason,
    request_data,
    reward_units,
    settlement_outcome
  )
  values (
    p_command_id,
    'SETTLE_STAKING_REWARD',
    'APPLIED',
    v_actor_user_id,
    'ADMIN',
    v_position.user_id,
    v_position.wallet_account_id,
    v_position.staking_product_id,
    v_position.id,
    v_settlement_id,
    v_position.project_id,
    v_position.asset_id,
    v_reward_journal_id,
    v_reason,
    v_request_data,
    v_reward_units,
    v_settlement_outcome
  );

  return query select 'APPLIED'::text, false, v_position.id, v_settlement_id, v_settlement_outcome, v_settlement_outcome, v_reward_units::text, v_settled_at;
end;
$$;

comment on function public.settle_staking_reward_as_admin(uuid, bigint, uuid, text) is
  'ACTIVE ADMIN AAL2 command to settle one already UNLOCKED staking position reward from immutable position snapshots. It permits inactive target catalog/profile/wallet states when ledger accounts remain valid.';

revoke all privileges on table private.staking_position_reward_settlements
  from public, anon, authenticated;

revoke all privileges on table private.staking_reward_command_audit_events
  from public, anon, authenticated;

revoke execute on function public.list_current_user_staking_positions(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_staking_positions(integer, text)
  from public, anon, authenticated;

revoke execute on function public.list_staking_reward_command_audit_events(integer, uuid)
  from public, anon, authenticated;

revoke execute on function public.settle_current_user_staking_reward(uuid, bigint, bigint, uuid)
  from public, anon, authenticated;

revoke execute on function public.settle_staking_reward_as_admin(uuid, bigint, uuid, text)
  from public, anon, authenticated;

grant execute on function public.list_current_user_staking_positions(integer)
  to authenticated;

grant execute on function public.list_admin_staking_positions(integer, text)
  to authenticated;

grant execute on function public.list_staking_reward_command_audit_events(integer, uuid)
  to authenticated;

grant execute on function public.settle_current_user_staking_reward(uuid, bigint, bigint, uuid)
  to authenticated;

grant execute on function public.settle_staking_reward_as_admin(uuid, bigint, uuid, text)
  to authenticated;
