alter table private.staking_positions
  add column unlock_journal_id uuid null
    references private.ledger_journals (id) on delete restrict,
  add column unlocked_by uuid null
    references public.profiles (id) on delete restrict,
  add column unlock_actor_type text null,
  add column unlocked_at timestamptz null;

alter table private.staking_positions
  add constraint staking_positions_unlock_journal_uidx
    unique (unlock_journal_id);

alter table private.staking_positions
  drop constraint staking_positions_status_check,
  add constraint staking_positions_status_check
    check (status in ('LOCKED', 'UNLOCKED')),
  add constraint staking_positions_unlock_actor_type_check
    check (unlock_actor_type is null or unlock_actor_type in ('USER', 'ADMIN')),
  add constraint staking_positions_unlock_state_check
    check (
      (
        status = 'LOCKED'
        and unlock_journal_id is null
        and unlocked_by is null
        and unlock_actor_type is null
        and unlocked_at is null
      )
      or (
        status = 'UNLOCKED'
        and unlock_journal_id is not null
        and unlocked_by is not null
        and unlock_actor_type in ('USER', 'ADMIN')
        and unlocked_at is not null
        and unlocked_at >= matures_at
      )
    );

comment on column private.staking_positions.unlock_journal_id is
  'Principal unlock journal. It is set exactly once by the maturity unlock command and cannot be replaced.';

comment on column private.staking_positions.unlock_actor_type is
  'Principal unlock actor boundary. USER means self-service matured unlock; ADMIN means AAL2 administrative matured unlock.';

comment on column private.staking_positions.unlocked_at is
  'Database posting timestamp copied from the unlock journal. It must be at or after matures_at.';

create index staking_positions_unlocked_at_idx
  on private.staking_positions (unlocked_at desc, id)
  where unlocked_at is not null;

create index staking_positions_unlocked_by_idx
  on private.staking_positions (unlocked_by, unlocked_at desc)
  where unlocked_by is not null;

alter table private.staking_position_command_audit_events
  add column actor_type text,
  add column previous_status text;

alter table private.staking_position_command_audit_events
  alter column actor_type set default 'USER';

update private.staking_position_command_audit_events
set
  actor_type = 'USER',
  previous_status = null,
  resulting_status = 'LOCKED'
where action = 'CREATE_STAKING_POSITION';

alter table private.staking_position_command_audit_events
  alter column actor_type set not null,
  drop constraint staking_position_audit_action_check,
  drop constraint staking_position_audit_outcome_check,
  drop constraint staking_position_audit_reason_check,
  drop constraint staking_position_audit_status_check,
  add constraint staking_position_audit_action_check
    check (action in ('CREATE_STAKING_POSITION', 'UNLOCK_STAKING_POSITION')),
  add constraint staking_position_audit_outcome_check
    check (outcome in ('APPLIED', 'NOOP')),
  add constraint staking_position_audit_actor_type_check
    check (actor_type in ('USER', 'ADMIN')),
  add constraint staking_position_audit_previous_status_check
    check (previous_status is null or previous_status in ('LOCKED', 'UNLOCKED')),
  add constraint staking_position_audit_status_check
    check (resulting_status in ('LOCKED', 'UNLOCKED')),
  add constraint staking_position_audit_action_shape_check
    check (
      (
        action = 'CREATE_STAKING_POSITION'
        and outcome = 'APPLIED'
        and actor_type = 'USER'
        and previous_status is null
        and resulting_status = 'LOCKED'
        and reason = 'USER_STAKING_POSITION'
      )
      or (
        action = 'UNLOCK_STAKING_POSITION'
        and outcome = 'APPLIED'
        and actor_type in ('USER', 'ADMIN')
        and previous_status = 'LOCKED'
        and resulting_status = 'UNLOCKED'
        and resulting_journal_id is not null
        and (
          (
            actor_type = 'USER'
            and reason = 'USER_STAKING_POSITION_UNLOCK'
          )
          or (
            actor_type = 'ADMIN'
            and pg_catalog.char_length(reason) between 1 and 500
            and reason !~ '[[:cntrl:]]'
            and reason !~* '(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)'
          )
        )
      )
      or (
        action = 'UNLOCK_STAKING_POSITION'
        and outcome = 'NOOP'
        and actor_type in ('USER', 'ADMIN')
        and previous_status = 'UNLOCKED'
        and resulting_status = 'UNLOCKED'
        and resulting_journal_id is not null
        and (
          (
            actor_type = 'USER'
            and reason = 'USER_STAKING_POSITION_UNLOCK'
          )
          or (
            actor_type = 'ADMIN'
            and pg_catalog.char_length(reason) between 1 and 500
            and reason !~ '[[:cntrl:]]'
            and reason !~* '(access[_ ]?token|refresh[_ ]?token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|mfa[_ ]?secret|totp|service[_ ]?role|database[_ ]?url|direct[_ ]?database[_ ]?url|secret)'
          )
        )
      )
    );

create unique index staking_position_audit_unlock_applied_once_uidx
  on private.staking_position_command_audit_events (staking_position_id)
  where action = 'UNLOCK_STAKING_POSITION'
    and outcome = 'APPLIED';

comment on column private.staking_position_command_audit_events.actor_type is
  'Command actor type for position lifecycle events. It separates self-service user unlocks from AAL2 admin unlocks.';

comment on column private.staking_position_command_audit_events.previous_status is
  'Previous position status for transition audit rows. Create events intentionally have no previous status.';

create or replace function private.staking_position_normalize_admin_reason(
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

revoke execute on function private.staking_position_normalize_admin_reason(text)
  from public, anon, authenticated;

create or replace function private.staking_position_maturity_state(
  p_status text,
  p_matures_at timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_status = 'UNLOCKED' then 'UNLOCKED'
    when clock_timestamp() >= p_matures_at then 'MATURED'
    else 'LOCKED'
  end;
$$;

revoke execute on function private.staking_position_maturity_state(text, timestamptz)
  from public, anon, authenticated;

create or replace function private.validate_staking_position_core()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'LOCKED' and new.status = 'UNLOCKED' then
      if old.id is distinct from new.id
        or old.staking_product_id is distinct from new.staking_product_id
        or old.project_id is distinct from new.project_id
        or old.asset_id is distinct from new.asset_id
        or old.wallet_account_id is distinct from new.wallet_account_id
        or old.user_id is distinct from new.user_id
        or old.principal_units is distinct from new.principal_units
        or old.lock_journal_id is distinct from new.lock_journal_id
        or old.product_version_snapshot is distinct from new.product_version_snapshot
        or old.lock_duration_days_snapshot is distinct from new.lock_duration_days_snapshot
        or old.term_reward_rate_ppm_snapshot is distinct from new.term_reward_rate_ppm_snapshot
        or old.reward_rounding_mode_snapshot is distinct from new.reward_rounding_mode_snapshot
        or old.locked_at is distinct from new.locked_at
        or old.matures_at is distinct from new.matures_at
        or old.created_at is distinct from new.created_at
        or new.version <> old.version + 1
        or new.updated_at is null
        or new.updated_at < old.updated_at
        or new.unlock_journal_id is null
        or new.unlocked_by is null
        or new.unlock_actor_type not in ('USER', 'ADMIN')
        or new.unlocked_at is null
        or new.unlocked_at < old.matures_at
      then
        raise exception 'STAKING_POSITION_CORE_IMMUTABLE'
          using errcode = '23514';
      end if;

      return new;
    end if;

    raise exception 'STAKING_POSITION_INVALID_TRANSITION'
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
    or new.unlock_journal_id is not null
    or new.unlocked_by is not null
    or new.unlock_actor_type is not null
    or new.unlocked_at is not null
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
  'Validates staking position core immutability. Inserts create LOCKED positions only; the only supported update is LOCKED to UNLOCKED with unlock journal, actor, timestamp, updated_at, and version increment.';

revoke execute on function private.validate_staking_position_core()
  from public, anon, authenticated;

drop trigger validate_staking_position_invariants
  on private.staking_positions;

create or replace function private.validate_staking_position_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product private.staking_products%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_lock_journal private.ledger_journals%rowtype;
  v_unlock_journal private.ledger_journals%rowtype;
  v_entry_count integer;
  v_debit_count integer;
  v_credit_count integer;
  v_debit_units numeric;
  v_credit_units numeric;
  v_system_count integer;
  v_closed_account_count integer;
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
    into v_lock_journal
  from private.ledger_journals as journals
  where journals.id = new.lock_journal_id;

  if not found
    or v_product.id is null
    or v_wallet.id is null
    or v_lock_journal.id is null
    or v_wallet.user_id <> new.user_id
    or v_wallet.custody_model <> 'MANAGED'
    or v_product.project_id <> new.project_id
    or v_product.asset_id <> new.asset_id
    or v_product.activated_at is null
    or new.product_version_snapshot < 1
    or new.lock_duration_days_snapshot <> v_product.lock_duration_days
    or new.term_reward_rate_ppm_snapshot <> v_product.term_reward_rate_ppm
    or new.reward_rounding_mode_snapshot <> v_product.reward_rounding_mode
    or v_lock_journal.journal_type <> 'USER_STAKING_POSITION_LOCKED'
    or v_lock_journal.initiator_type <> 'USER'
    or v_lock_journal.initiator_user_id <> new.user_id
    or v_lock_journal.reference_type <> 'STAKING_POSITION'
    or v_lock_journal.reference_id <> new.id
    or v_lock_journal.asset_id <> new.asset_id
    or new.locked_at <> v_lock_journal.posted_at
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
    count(*) filter (where accounts.account_scope = 'SYSTEM')::integer,
    count(*) filter (where accounts.status <> 'OPEN')::integer
    into
      v_entry_count,
      v_debit_count,
      v_credit_count,
      v_debit_units,
      v_credit_units,
      v_system_count,
      v_closed_account_count
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
    or v_closed_account_count <> 0
  then
    raise exception 'STAKING_POSITION_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if new.status = 'LOCKED' then
    return new;
  end if;

  select journals.*
    into v_unlock_journal
  from private.ledger_journals as journals
  where journals.id = new.unlock_journal_id;

  if not found
    or v_unlock_journal.id is null
    or v_unlock_journal.reference_type <> 'STAKING_POSITION'
    or v_unlock_journal.reference_id <> new.id
    or v_unlock_journal.asset_id <> new.asset_id
    or new.unlocked_at <> v_unlock_journal.posted_at
    or new.unlocked_at < new.matures_at
    or (
      new.unlock_actor_type = 'USER'
      and (
        new.unlocked_by <> new.user_id
        or v_unlock_journal.journal_type <> 'USER_STAKING_POSITION_UNLOCKED'
        or v_unlock_journal.initiator_type <> 'USER'
        or v_unlock_journal.initiator_user_id <> new.user_id
      )
    )
    or (
      new.unlock_actor_type = 'ADMIN'
      and (
        v_unlock_journal.journal_type <> 'ADMIN_STAKING_POSITION_UNLOCKED'
        or v_unlock_journal.initiator_type <> 'ADMIN'
        or v_unlock_journal.initiator_user_id <> new.unlocked_by
      )
    )
  then
    raise exception 'STAKING_POSITION_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where entries.side = 'DEBIT'
        and accounts.account_scope = 'USER'
        and accounts.account_purpose = 'USER_LOCKED'
        and accounts.wallet_account_id = new.wallet_account_id
        and accounts.asset_id = new.asset_id
        and entries.units = new.principal_units
    )::integer,
    count(*) filter (
      where entries.side = 'CREDIT'
        and accounts.account_scope = 'USER'
        and accounts.account_purpose = 'USER_AVAILABLE'
        and accounts.wallet_account_id = new.wallet_account_id
        and accounts.asset_id = new.asset_id
        and entries.units = new.principal_units
    )::integer,
    coalesce(sum(entries.units) filter (where entries.side = 'DEBIT'), 0::numeric),
    coalesce(sum(entries.units) filter (where entries.side = 'CREDIT'), 0::numeric),
    count(*) filter (where accounts.account_scope = 'SYSTEM')::integer,
    count(*) filter (where accounts.status <> 'OPEN')::integer
    into
      v_entry_count,
      v_debit_count,
      v_credit_count,
      v_debit_units,
      v_credit_units,
      v_system_count,
      v_closed_account_count
  from private.ledger_entries as entries
  join private.ledger_accounts as accounts
    on accounts.id = entries.ledger_account_id
  where entries.journal_id = new.unlock_journal_id;

  if v_entry_count <> 2
    or v_debit_count <> 1
    or v_credit_count <> 1
    or v_debit_units <> new.principal_units
    or v_credit_units <> new.principal_units
    or v_system_count <> 0
    or v_closed_account_count <> 0
  then
    raise exception 'STAKING_POSITION_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function private.validate_staking_position_invariants() is
  'Deferred invariant tying LOCKED positions to the original principal lock journal and UNLOCKED positions to exactly one matured principal unlock journal: DEBIT USER_LOCKED and CREDIT USER_AVAILABLE for the exact principal units.';

revoke execute on function private.validate_staking_position_invariants()
  from public, anon, authenticated;

create constraint trigger validate_staking_position_invariants
  after insert or update on private.staking_positions
  deferrable initially deferred
  for each row
  execute function private.validate_staking_position_invariants();

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
  'Authenticated ACTIVE user read RPC for caller-owned staking positions. Maturity state is derived in PostgreSQL from database time; user output omits unlock journal IDs, unlocked_by IDs, audit payloads, rewards, wallet addresses, transactions, and on-chain data.';

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
  'ACTIVE ADMIN AAL2 read RPC for staking position review. It exposes matured and unlock state summaries without full journal payloads, request data, credentials, wallet addresses, transactions, rewards, or on-chain data.';

drop function public.list_staking_position_command_audit_events(integer, uuid);

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
  actor_type text,
  wallet_account_id uuid,
  staking_product_id uuid,
  staking_position_id uuid,
  project_id uuid,
  asset_id uuid,
  resulting_journal_id uuid,
  reason text,
  previous_status text,
  resulting_status text,
  principal_units text,
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
      events.actor_type,
      events.wallet_account_id,
      events.staking_product_id,
      events.staking_position_id,
      events.project_id,
      events.asset_id,
      events.resulting_journal_id,
      events.reason,
      events.previous_status,
      events.resulting_status,
      events.principal_units::text,
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
  'ACTIVE ADMIN AAL2 read RPC for staking position command audit summaries. It returns action, outcome, actor type, previous/resulting status, journal ID, entity version, and principal Atomic Unit text while intentionally omitting request_data and journal line payloads.';

create or replace function public.unlock_current_user_staking_position(
  p_staking_position_id uuid,
  p_position_expected_version bigint,
  p_wallet_expected_version bigint,
  p_command_id uuid
)
returns table (
  result_code text,
  replayed boolean,
  staking_position_id uuid,
  position_version bigint,
  position_status text,
  maturity_state text,
  principal_units text,
  unlocked_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_request_data jsonb;
  v_existing_event private.staking_position_command_audit_events%rowtype;
  v_position private.staking_positions%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_available_account_id uuid;
  v_locked_account_id uuid;
  v_locked_units numeric;
  v_unlock_journal_id uuid;
  v_unlocked_at timestamptz;
begin
  v_actor_user_id := private.staking_product_require_active_user();

  if p_staking_position_id is null
    or p_position_expected_version is null
    or p_position_expected_version < 1
    or p_wallet_expected_version is null
    or p_wallet_expected_version < 1
    or p_command_id is null
  then
    return query select 'INVALID_INPUT'::text, false, p_staking_position_id, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'UNLOCK_STAKING_POSITION',
    'actor_user_id', v_actor_user_id::text,
    'actor_type', 'USER',
    'staking_position_id', p_staking_position_id::text,
    'position_expected_version', p_position_expected_version,
    'wallet_expected_version', p_wallet_expected_version,
    'reason', 'USER_STAKING_POSITION_UNLOCK'
  );

  perform private.staking_position_lock();

  select events.*
    into v_existing_event
  from private.staking_position_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'USER'
      and v_existing_event.action = 'UNLOCK_STAKING_POSITION'
      and v_existing_event.staking_position_id = p_staking_position_id
      and v_existing_event.reason = 'USER_STAKING_POSITION_UNLOCK'
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          positions.id,
          positions.version,
          positions.status,
          private.staking_position_maturity_state(
            positions.status,
            positions.matures_at
          ),
          positions.principal_units::text,
          positions.unlocked_at
        from private.staking_positions as positions
        where positions.id = v_existing_event.staking_position_id;
      return;
    end if;

    return query select 'STAKING_POSITION_COMMAND_ID_CONFLICT'::text, false, p_staking_position_id, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'STAKING_POSITION_COMMAND_ID_CONFLICT'::text, false, p_staking_position_id, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select positions.*
    into v_position
  from private.staking_positions as positions
  where positions.id = p_staking_position_id
  for update;

  if not found then
    return query select 'STAKING_POSITION_NOT_FOUND'::text, false, p_staking_position_id, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_position.user_id <> v_actor_user_id then
    return query select 'STAKING_POSITION_FORBIDDEN'::text, false, v_position.id, v_position.version, v_position.status, private.staking_position_maturity_state(v_position.status, v_position.matures_at), v_position.principal_units::text, v_position.unlocked_at;
    return;
  end if;

  if v_position.version <> p_position_expected_version then
    return query select 'STAKING_POSITION_VERSION_CONFLICT'::text, false, v_position.id, v_position.version, v_position.status, private.staking_position_maturity_state(v_position.status, v_position.matures_at), v_position.principal_units::text, v_position.unlocked_at;
    return;
  end if;

  select wallet_accounts.*
    into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = v_position.wallet_account_id
  for update;

  if not found then
    return query select 'STAKING_WALLET_NOT_FOUND'::text, false, v_position.id, v_position.version, v_position.status, private.staking_position_maturity_state(v_position.status, v_position.matures_at), v_position.principal_units::text, v_position.unlocked_at;
    return;
  end if;

  if v_wallet.user_id <> v_actor_user_id
    or v_wallet.custody_model <> 'MANAGED'
  then
    return query select 'STAKING_POSITION_FORBIDDEN'::text, false, v_position.id, v_position.version, v_position.status, private.staking_position_maturity_state(v_position.status, v_position.matures_at), v_position.principal_units::text, v_position.unlocked_at;
    return;
  end if;

  if v_wallet.version <> p_wallet_expected_version then
    return query select 'STAKING_WALLET_VERSION_CONFLICT'::text, false, v_position.id, v_position.version, v_position.status, private.staking_position_maturity_state(v_position.status, v_position.matures_at), v_position.principal_units::text, v_position.unlocked_at;
    return;
  end if;

  if v_wallet.status <> 'ACTIVE' then
    return query select 'STAKING_WALLET_NOT_ACTIVE'::text, false, v_position.id, v_position.version, v_position.status, private.staking_position_maturity_state(v_position.status, v_position.matures_at), v_position.principal_units::text, v_position.unlocked_at;
    return;
  end if;

  if v_position.status = 'UNLOCKED' then
    insert into private.staking_position_command_audit_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      actor_type,
      wallet_account_id,
      staking_product_id,
      staking_position_id,
      project_id,
      asset_id,
      resulting_journal_id,
      reason,
      request_data,
      previous_status,
      principal_units,
      resulting_status,
      entity_version
    )
    values (
      p_command_id,
      'UNLOCK_STAKING_POSITION',
      'NOOP',
      v_actor_user_id,
      'USER',
      v_position.wallet_account_id,
      v_position.staking_product_id,
      v_position.id,
      v_position.project_id,
      v_position.asset_id,
      v_position.unlock_journal_id,
      'USER_STAKING_POSITION_UNLOCK',
      v_request_data,
      'UNLOCKED',
      v_position.principal_units,
      'UNLOCKED',
      v_position.version
    );

    return query select 'NOOP'::text, false, v_position.id, v_position.version, v_position.status, 'UNLOCKED'::text, v_position.principal_units::text, v_position.unlocked_at;
    return;
  end if;

  if clock_timestamp() < v_position.matures_at then
    return query select 'STAKING_POSITION_NOT_MATURED'::text, false, v_position.id, v_position.version, v_position.status, 'LOCKED'::text, v_position.principal_units::text, null::timestamptz;
    return;
  end if;

  perform private.ensure_wallet_asset_ledger_accounts(v_position.wallet_account_id, v_position.asset_id);

  select
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_LOCKED'))::uuid
    into v_available_account_id, v_locked_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = v_position.wallet_account_id
    and accounts.asset_id = v_position.asset_id
    and accounts.account_purpose in ('USER_AVAILABLE', 'USER_LOCKED')
    and accounts.status = 'OPEN';

  if v_available_account_id is null or v_locked_account_id is null then
    return query select 'STAKING_POSITION_LEDGER_UNAVAILABLE'::text, false, v_position.id, v_position.version, v_position.status, 'MATURED'::text, v_position.principal_units::text, null::timestamptz;
    return;
  end if;

  perform accounts.id
  from private.ledger_accounts as accounts
  where accounts.id in (v_available_account_id, v_locked_account_id)
  order by accounts.id
  for update;

  select coalesce(balances.balance_units, 0::numeric)
    into v_locked_units
  from private.ledger_account_balances as balances
  where balances.ledger_account_id = v_locked_account_id;

  v_locked_units := coalesce(v_locked_units, 0::numeric);

  if v_locked_units < v_position.principal_units then
    return query select 'STAKING_INSUFFICIENT_LOCKED_BALANCE'::text, false, v_position.id, v_position.version, v_position.status, 'MATURED'::text, v_position.principal_units::text, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_unlock_journal_id, v_unlocked_at
  from private.post_ledger_journal(
    p_command_id,
    v_position.asset_id,
    'USER_STAKING_POSITION_UNLOCKED',
    'USER',
    v_actor_user_id,
    'STAKING_POSITION',
    v_position.id,
    'USER_STAKING_POSITION_UNLOCK',
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_locked_account_id::text,
        'side', 'DEBIT',
        'units', v_position.principal_units::text
      ),
      jsonb_build_object(
        'account_id', v_available_account_id::text,
        'side', 'CREDIT',
        'units', v_position.principal_units::text
      )
    )
  ) as posted;

  update private.staking_positions
  set
    status = 'UNLOCKED',
    unlock_journal_id = v_unlock_journal_id,
    unlocked_by = v_actor_user_id,
    unlock_actor_type = 'USER',
    unlocked_at = v_unlocked_at,
    version = v_position.version + 1,
    updated_at = clock_timestamp()
  where id = v_position.id
  returning * into v_position;

  insert into private.staking_position_command_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    actor_type,
    wallet_account_id,
    staking_product_id,
    staking_position_id,
    project_id,
    asset_id,
    resulting_journal_id,
    reason,
    request_data,
    previous_status,
    principal_units,
    resulting_status,
    entity_version
  )
  values (
    p_command_id,
    'UNLOCK_STAKING_POSITION',
    'APPLIED',
    v_actor_user_id,
    'USER',
    v_position.wallet_account_id,
    v_position.staking_product_id,
    v_position.id,
    v_position.project_id,
    v_position.asset_id,
    v_unlock_journal_id,
    'USER_STAKING_POSITION_UNLOCK',
    v_request_data,
    'LOCKED',
    v_position.principal_units,
    'UNLOCKED',
    v_position.version
  );

  return query select 'APPLIED'::text, false, v_position.id, v_position.version, v_position.status, 'UNLOCKED'::text, v_position.principal_units::text, v_position.unlocked_at;
end;
$$;

comment on function public.unlock_current_user_staking_position(uuid, bigint, bigint, uuid) is
  'ACTIVE user command to unlock one matured owned LOCKED staking position and atomically post principal from USER_LOCKED to USER_AVAILABLE. Maturity is checked in PostgreSQL database time; no client timestamp, partial unlock, reward, address, transaction, service-role, remote, mainnet, or on-chain behavior is accepted.';

create or replace function public.unlock_staking_position_as_admin(
  p_staking_position_id uuid,
  p_position_expected_version bigint,
  p_command_id uuid,
  p_reason text
)
returns table (
  result_code text,
  replayed boolean,
  staking_position_id uuid,
  position_version bigint,
  position_status text,
  maturity_state text,
  principal_units text,
  unlocked_at timestamptz
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
  v_existing_event private.staking_position_command_audit_events%rowtype;
  v_position private.staking_positions%rowtype;
  v_wallet public.wallet_accounts%rowtype;
  v_available_account_id uuid;
  v_locked_account_id uuid;
  v_locked_units numeric;
  v_unlock_journal_id uuid;
  v_unlocked_at timestamptz;
begin
  v_actor_user_id := (select auth.uid());
  v_reason := private.staking_position_normalize_admin_reason(p_reason);

  if v_actor_user_id is null or not public.is_current_user_admin_aal2() then
    raise exception 'STAKING_POSITION_ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  if p_staking_position_id is null
    or p_position_expected_version is null
    or p_position_expected_version < 1
    or p_command_id is null
    or v_reason is null
  then
    return query select 'INVALID_INPUT'::text, false, p_staking_position_id, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_request_data := jsonb_build_object(
    'action', 'UNLOCK_STAKING_POSITION',
    'actor_user_id', v_actor_user_id::text,
    'actor_type', 'ADMIN',
    'staking_position_id', p_staking_position_id::text,
    'position_expected_version', p_position_expected_version,
    'reason', v_reason
  );

  perform private.staking_position_lock();

  select events.*
    into v_existing_event
  from private.staking_position_command_audit_events as events
  where events.command_id = p_command_id
  for update;

  if found then
    if v_existing_event.actor_user_id = v_actor_user_id
      and v_existing_event.actor_type = 'ADMIN'
      and v_existing_event.action = 'UNLOCK_STAKING_POSITION'
      and v_existing_event.staking_position_id = p_staking_position_id
      and v_existing_event.reason = v_reason
      and v_existing_event.request_data = v_request_data
    then
      return query
        select
          v_existing_event.outcome,
          true,
          positions.id,
          positions.version,
          positions.status,
          private.staking_position_maturity_state(
            positions.status,
            positions.matures_at
          ),
          positions.principal_units::text,
          positions.unlocked_at
        from private.staking_positions as positions
        where positions.id = v_existing_event.staking_position_id;
      return;
    end if;

    return query select 'STAKING_POSITION_COMMAND_ID_CONFLICT'::text, false, p_staking_position_id, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from private.ledger_journals as journals
    where journals.command_id = p_command_id
  ) then
    return query select 'STAKING_POSITION_COMMAND_ID_CONFLICT'::text, false, p_staking_position_id, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select positions.*
    into v_position
  from private.staking_positions as positions
  where positions.id = p_staking_position_id
  for update;

  if not found then
    return query select 'STAKING_POSITION_NOT_FOUND'::text, false, p_staking_position_id, null::bigint, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_position.version <> p_position_expected_version then
    return query select 'STAKING_POSITION_VERSION_CONFLICT'::text, false, v_position.id, v_position.version, v_position.status, private.staking_position_maturity_state(v_position.status, v_position.matures_at), v_position.principal_units::text, v_position.unlocked_at;
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
    return query select 'STAKING_WALLET_NOT_FOUND'::text, false, v_position.id, v_position.version, v_position.status, private.staking_position_maturity_state(v_position.status, v_position.matures_at), v_position.principal_units::text, v_position.unlocked_at;
    return;
  end if;

  if v_position.status = 'UNLOCKED' then
    insert into private.staking_position_command_audit_events (
      command_id,
      action,
      outcome,
      actor_user_id,
      actor_type,
      wallet_account_id,
      staking_product_id,
      staking_position_id,
      project_id,
      asset_id,
      resulting_journal_id,
      reason,
      request_data,
      previous_status,
      principal_units,
      resulting_status,
      entity_version
    )
    values (
      p_command_id,
      'UNLOCK_STAKING_POSITION',
      'NOOP',
      v_actor_user_id,
      'ADMIN',
      v_position.wallet_account_id,
      v_position.staking_product_id,
      v_position.id,
      v_position.project_id,
      v_position.asset_id,
      v_position.unlock_journal_id,
      v_reason,
      v_request_data,
      'UNLOCKED',
      v_position.principal_units,
      'UNLOCKED',
      v_position.version
    );

    return query select 'NOOP'::text, false, v_position.id, v_position.version, v_position.status, 'UNLOCKED'::text, v_position.principal_units::text, v_position.unlocked_at;
    return;
  end if;

  if clock_timestamp() < v_position.matures_at then
    return query select 'STAKING_POSITION_NOT_MATURED'::text, false, v_position.id, v_position.version, v_position.status, 'LOCKED'::text, v_position.principal_units::text, null::timestamptz;
    return;
  end if;

  select
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
    (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_LOCKED'))::uuid
    into v_available_account_id, v_locked_account_id
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = v_position.wallet_account_id
    and accounts.asset_id = v_position.asset_id
    and accounts.account_purpose in ('USER_AVAILABLE', 'USER_LOCKED')
    and accounts.status = 'OPEN';

  if v_available_account_id is null or v_locked_account_id is null then
    return query select 'STAKING_POSITION_LEDGER_UNAVAILABLE'::text, false, v_position.id, v_position.version, v_position.status, 'MATURED'::text, v_position.principal_units::text, null::timestamptz;
    return;
  end if;

  perform accounts.id
  from private.ledger_accounts as accounts
  where accounts.id in (v_available_account_id, v_locked_account_id)
  order by accounts.id
  for update;

  select coalesce(balances.balance_units, 0::numeric)
    into v_locked_units
  from private.ledger_account_balances as balances
  where balances.ledger_account_id = v_locked_account_id;

  v_locked_units := coalesce(v_locked_units, 0::numeric);

  if v_locked_units < v_position.principal_units then
    return query select 'STAKING_INSUFFICIENT_LOCKED_BALANCE'::text, false, v_position.id, v_position.version, v_position.status, 'MATURED'::text, v_position.principal_units::text, null::timestamptz;
    return;
  end if;

  select posted.journal_id, posted.posted_at
    into v_unlock_journal_id, v_unlocked_at
  from private.post_ledger_journal(
    p_command_id,
    v_position.asset_id,
    'ADMIN_STAKING_POSITION_UNLOCKED',
    'ADMIN',
    v_actor_user_id,
    'STAKING_POSITION',
    v_position.id,
    v_reason,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_locked_account_id::text,
        'side', 'DEBIT',
        'units', v_position.principal_units::text
      ),
      jsonb_build_object(
        'account_id', v_available_account_id::text,
        'side', 'CREDIT',
        'units', v_position.principal_units::text
      )
    )
  ) as posted;

  update private.staking_positions
  set
    status = 'UNLOCKED',
    unlock_journal_id = v_unlock_journal_id,
    unlocked_by = v_actor_user_id,
    unlock_actor_type = 'ADMIN',
    unlocked_at = v_unlocked_at,
    version = v_position.version + 1,
    updated_at = clock_timestamp()
  where id = v_position.id
  returning * into v_position;

  insert into private.staking_position_command_audit_events (
    command_id,
    action,
    outcome,
    actor_user_id,
    actor_type,
    wallet_account_id,
    staking_product_id,
    staking_position_id,
    project_id,
    asset_id,
    resulting_journal_id,
    reason,
    request_data,
    previous_status,
    principal_units,
    resulting_status,
    entity_version
  )
  values (
    p_command_id,
    'UNLOCK_STAKING_POSITION',
    'APPLIED',
    v_actor_user_id,
    'ADMIN',
    v_position.wallet_account_id,
    v_position.staking_product_id,
    v_position.id,
    v_position.project_id,
    v_position.asset_id,
    v_unlock_journal_id,
    v_reason,
    v_request_data,
    'LOCKED',
    v_position.principal_units,
    'UNLOCKED',
    v_position.version
  );

  return query select 'APPLIED'::text, false, v_position.id, v_position.version, v_position.status, 'UNLOCKED'::text, v_position.principal_units::text, v_position.unlocked_at;
end;
$$;

comment on function public.unlock_staking_position_as_admin(uuid, bigint, uuid, text) is
  'ACTIVE ADMIN AAL2 command to unlock one matured staking position for operational cleanup and atomically post principal from USER_LOCKED to USER_AVAILABLE. It allows inactive target accounts and non-active target wallets when existing ledger accounts remain valid; no early unlock, reward, address, transaction, service-role, remote, mainnet, or on-chain behavior is accepted.';

revoke all privileges on table private.staking_positions
  from public, anon, authenticated;

revoke all privileges on table private.staking_position_command_audit_events
  from public, anon, authenticated;

revoke execute on function public.list_current_user_staking_positions(integer)
  from public, anon, authenticated;

revoke execute on function public.list_admin_staking_positions(integer, text)
  from public, anon, authenticated;

revoke execute on function public.list_staking_position_command_audit_events(integer, uuid)
  from public, anon, authenticated;

revoke execute on function public.unlock_current_user_staking_position(uuid, bigint, bigint, uuid)
  from public, anon, authenticated;

revoke execute on function public.unlock_staking_position_as_admin(uuid, bigint, uuid, text)
  from public, anon, authenticated;

grant execute on function public.list_current_user_staking_positions(integer)
  to authenticated;

grant execute on function public.list_admin_staking_positions(integer, text)
  to authenticated;

grant execute on function public.list_staking_position_command_audit_events(integer, uuid)
  to authenticated;

grant execute on function public.unlock_current_user_staking_position(uuid, bigint, bigint, uuid)
  to authenticated;

grant execute on function public.unlock_staking_position_as_admin(uuid, bigint, uuid, text)
  to authenticated;
