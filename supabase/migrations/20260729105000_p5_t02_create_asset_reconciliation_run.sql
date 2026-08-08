alter table private.reconciliation_runs
  add column observer_kind text null,
  add column observation_cutoff_at timestamptz null;

alter table private.reconciliation_runs
  add constraint reconciliation_runs_observer_kind_check
    check (
      observer_kind is null
      or (
        observer_kind = pg_catalog.btrim(observer_kind)
        and observer_kind ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
      )
    ),
  add constraint reconciliation_runs_observation_cutoff_check
    check (
      observation_cutoff_at is null
      or observation_cutoff_at::text not in ('infinity', '-infinity')
    ),
  add constraint reconciliation_runs_observation_metadata_pair_check
    check (
      (
        observer_kind is null
        and observation_cutoff_at is null
      )
      or (
        observer_kind is not null
        and observation_cutoff_at is not null
      )
    );

comment on column private.reconciliation_runs.observer_kind is
  'Observer kind used for a reconciliation run. Legacy manually inserted rows may be null; canonical asset reconciliation writer rows must persist a validated observer kind.';

comment on column private.reconciliation_runs.observation_cutoff_at is
  'Cutoff timestamp used to select external balance observations. Legacy manually inserted rows may be null; canonical asset reconciliation writer rows must persist this value.';

create index reconciliation_runs_observation_metadata_idx
  on private.reconciliation_runs (
    observer_kind,
    observation_cutoff_at desc,
    id desc
  )
  where observer_kind is not null;

create or replace function private.create_asset_reconciliation_run(
  p_idempotency_key text,
  p_asset_id uuid,
  p_observer_kind text,
  p_observed_at_or_before timestamptz,
  p_tolerance_atomic_units numeric,
  p_trigger_source text default 'MANUAL',
  p_requested_by_profile_id uuid default null
)
returns table (
  reconciliation_run_id uuid,
  reconciliation_item_id uuid,
  created boolean,
  run_status text,
  item_classification text,
  expected_atomic_units numeric,
  observed_atomic_units numeric,
  difference_atomic_units numeric,
  target_binding_count bigint,
  observed_binding_count bigint,
  missing_binding_count bigint
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_idempotency_key text;
  v_observer_kind text;
  v_trigger_source text;
  v_tolerance_atomic_units numeric;
  v_started_at timestamptz;
  v_returned_rows bigint;
  v_existing_run private.reconciliation_runs%rowtype;
  v_existing_item private.reconciliation_items%rowtype;
  v_total_item_count bigint;
  v_member_count bigint;
  v_observed_member_count bigint;
  v_missing_member_count bigint;
begin
  v_idempotency_key := pg_catalog.btrim(p_idempotency_key);
  v_observer_kind := pg_catalog.btrim(p_observer_kind);
  v_trigger_source := pg_catalog.btrim(p_trigger_source);
  v_tolerance_atomic_units := p_tolerance_atomic_units;

  if v_idempotency_key is null
    or v_idempotency_key = ''
    or pg_catalog.char_length(v_idempotency_key) > 200
    or v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or v_idempotency_key ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
  then
    raise exception 'reconciliation_idempotency_key_invalid'
      using errcode = '22023';
  end if;

  if v_observer_kind is null
    or v_observer_kind = ''
    or v_observer_kind !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
  then
    raise exception 'observer_kind_invalid'
      using errcode = '22023';
  end if;

  if p_observed_at_or_before is null
    or p_observed_at_or_before::text in ('infinity', '-infinity')
  then
    raise exception 'observation_cutoff_invalid'
      using errcode = '22023';
  end if;

  if v_tolerance_atomic_units is null
    or v_tolerance_atomic_units::text in ('NaN', 'Infinity', '-Infinity')
    or v_tolerance_atomic_units < 0
    or v_tolerance_atomic_units <> pg_catalog.trunc(v_tolerance_atomic_units)
    or v_tolerance_atomic_units >= pg_catalog.power(10::numeric, 38)
  then
    raise exception 'tolerance_invalid'
      using errcode = '22023';
  end if;

  if v_trigger_source is null
    or v_trigger_source not in ('MANUAL', 'SYSTEM', 'SCHEDULED', 'BACKFILL')
  then
    raise exception 'reconciliation_trigger_source_invalid'
      using errcode = '22023';
  end if;

  if p_asset_id is null
    or not exists (
      select 1
      from public.supported_assets as assets
      where assets.id = p_asset_id
    )
  then
    raise exception 'asset_not_found'
      using errcode = '23503';
  end if;

  if p_requested_by_profile_id is not null
    and not exists (
      select 1
      from public.profiles as profiles
      where profiles.id = p_requested_by_profile_id
    )
  then
    raise exception 'requested_profile_not_found'
      using errcode = '23503';
  end if;

  select runs.*
    into v_existing_run
  from private.reconciliation_runs as runs
  where runs.idempotency_key = v_idempotency_key;

  if not found then
    v_started_at := pg_catalog.clock_timestamp();

    return query
    with expected_balance as materialized (
      select private.calculate_expected_external_balance_atomic_units(
        p_asset_id
      ) as expected_atomic_units
    ),
    selected_observations as materialized (
      select *
      from private.select_latest_external_balance_observations(
        p_asset_id,
        v_observer_kind,
        p_observed_at_or_before
      )
    ),
    observed_balance as materialized (
      select *
      from private.calculate_observed_external_balance_atomic_units(
        p_asset_id,
        v_observer_kind,
        p_observed_at_or_before
      )
    ),
    calculation as materialized (
      select
        expected_balance.expected_atomic_units,
        observed_balance.observed_atomic_units,
        case
          when observed_balance.is_complete then
            observed_balance.observed_atomic_units
            - expected_balance.expected_atomic_units
          else null::numeric
        end as difference_atomic_units,
        observed_balance.target_binding_count,
        observed_balance.observed_binding_count,
        observed_balance.missing_binding_count,
        case
          when not observed_balance.is_complete then 'OBSERVATION_FAILED'
          when observed_balance.observed_atomic_units
            - expected_balance.expected_atomic_units = 0
            then 'MATCHED'
          when pg_catalog.abs(
            observed_balance.observed_atomic_units
            - expected_balance.expected_atomic_units
          ) <= v_tolerance_atomic_units
            then 'WITHIN_TOLERANCE'
          else 'MISMATCH'
        end as item_classification,
        case
          when observed_balance.is_complete then 'COMPLETED'
          else 'PARTIAL'
        end as run_status
      from expected_balance
      cross join observed_balance
    ),
    inserted_run as (
      insert into private.reconciliation_runs (
        idempotency_key,
        trigger_source,
        status,
        requested_by_profile_id,
        started_at,
        completed_at,
        observer_kind,
        observation_cutoff_at
      )
      select
        v_idempotency_key,
        v_trigger_source,
        calculation.run_status,
        p_requested_by_profile_id,
        v_started_at,
        pg_catalog.clock_timestamp(),
        v_observer_kind,
        p_observed_at_or_before
      from calculation
      on conflict (idempotency_key) do nothing
      returning
        reconciliation_runs.id,
        reconciliation_runs.status
    ),
    inserted_item as (
      insert into private.reconciliation_items (
        reconciliation_run_id,
        asset_id,
        scope_kind,
        expected_units,
        observed_units,
        difference_units,
        tolerance_units,
        classification
      )
      select
        inserted_run.id,
        p_asset_id,
        'ASSET_AGGREGATE',
        calculation.expected_atomic_units,
        calculation.observed_atomic_units,
        calculation.difference_atomic_units,
        v_tolerance_atomic_units,
        calculation.item_classification
      from inserted_run
      cross join calculation
      returning
        reconciliation_items.id,
        reconciliation_items.classification,
        reconciliation_items.expected_units,
        reconciliation_items.observed_units,
        reconciliation_items.difference_units
    ),
    inserted_members as (
      insert into private.reconciliation_item_binding_observations (
        reconciliation_item_id,
        custody_account_binding_id,
        external_balance_observation_id,
        membership_status
      )
      select
        inserted_item.id,
        selected_observations.custody_account_binding_id,
        selected_observations.external_balance_observation_id,
        selected_observations.membership_status
      from inserted_item
      cross join selected_observations
      returning 1
    )
    select
      inserted_run.id,
      inserted_item.id,
      true,
      inserted_run.status,
      inserted_item.classification,
      inserted_item.expected_units,
      inserted_item.observed_units,
      inserted_item.difference_units,
      calculation.target_binding_count,
      calculation.observed_binding_count,
      calculation.missing_binding_count
    from inserted_run
    cross join inserted_item
    cross join calculation
    where (
      select count(*)::bigint
      from inserted_members
    ) = calculation.target_binding_count;

    get diagnostics v_returned_rows = row_count;

    if v_returned_rows > 0 then
      return;
    end if;

    select runs.*
      into v_existing_run
    from private.reconciliation_runs as runs
    where runs.idempotency_key = v_idempotency_key;

    if not found then
      raise exception 'reconciliation_existing_state_invalid'
        using errcode = '23514';
    end if;
  end if;

  if v_existing_run.trigger_source <> v_trigger_source
    or v_existing_run.requested_by_profile_id is distinct from p_requested_by_profile_id
    or v_existing_run.observer_kind is distinct from v_observer_kind
    or v_existing_run.observation_cutoff_at is distinct from p_observed_at_or_before
  then
    raise exception 'reconciliation_idempotency_conflict'
      using errcode = '23505';
  end if;

  select count(*)::bigint
    into v_total_item_count
  from private.reconciliation_items as items
  where items.reconciliation_run_id = v_existing_run.id;

  if v_total_item_count <> 1 then
    raise exception 'reconciliation_existing_state_invalid'
      using errcode = '23514';
  end if;

  select items.*
    into v_existing_item
  from private.reconciliation_items as items
  where items.reconciliation_run_id = v_existing_run.id
    and items.scope_kind = 'ASSET_AGGREGATE';

  if not found
    or v_existing_item.asset_id <> p_asset_id
    or v_existing_item.custody_account_binding_id is not null
    or v_existing_item.external_balance_observation_id is not null
    or v_existing_item.tolerance_units <> v_tolerance_atomic_units
  then
    if found then
      raise exception 'reconciliation_idempotency_conflict'
        using errcode = '23505';
    end if;

    raise exception 'reconciliation_existing_state_invalid'
      using errcode = '23514';
  end if;

  select
    count(*)::bigint,
    count(*) filter (
      where members.membership_status = 'OBSERVED'
    )::bigint,
    count(*) filter (
      where members.membership_status = 'MISSING_OBSERVATION'
    )::bigint
    into
      v_member_count,
      v_observed_member_count,
      v_missing_member_count
  from private.reconciliation_item_binding_observations as members
  where members.reconciliation_item_id = v_existing_item.id;

  if v_member_count = 0
    or v_member_count <> v_observed_member_count + v_missing_member_count
  then
    raise exception 'reconciliation_existing_state_invalid'
      using errcode = '23514';
  end if;

  if (
    v_existing_item.classification in ('MATCHED', 'WITHIN_TOLERANCE', 'MISMATCH')
    and (
      v_existing_run.status <> 'COMPLETED'
      or v_missing_member_count <> 0
      or v_observed_member_count <> v_member_count
      or v_existing_item.observed_units is null
      or v_existing_item.difference_units is null
    )
  )
    or (
      v_existing_item.classification = 'OBSERVATION_FAILED'
      and (
        v_existing_run.status <> 'PARTIAL'
        or v_missing_member_count = 0
        or v_existing_item.observed_units is not null
        or v_existing_item.difference_units is not null
      )
    )
    or v_existing_item.classification = 'REVIEW_REQUIRED'
  then
    raise exception 'reconciliation_existing_state_invalid'
      using errcode = '23514';
  end if;

  return query select
    v_existing_run.id,
    v_existing_item.id,
    false,
    v_existing_run.status,
    v_existing_item.classification,
    v_existing_item.expected_units,
    v_existing_item.observed_units,
    v_existing_item.difference_units,
    v_member_count,
    v_observed_member_count,
    v_missing_member_count;
end;
$$;

comment on function private.create_asset_reconciliation_run(text, uuid, text, timestamptz, numeric, text, uuid) is
  'Private single-asset asset aggregate reconciliation run writer. It persists observer kind and cutoff metadata, reuses private expected and observed calculation functions, snapshots binding observation provenance, writes the run, item, and members atomically, supports exact idempotent replay, stores incomplete observation membership as a partial result, and does not write observations, checkpoints, ledger rows, audit events, provider payloads, credentials, or public RPC state.';

revoke execute on function private.create_asset_reconciliation_run(text, uuid, text, timestamptz, numeric, text, uuid)
  from public, anon, authenticated;
