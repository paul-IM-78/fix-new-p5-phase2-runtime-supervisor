create index external_balance_observations_latest_selector_idx
  on private.external_balance_observations (
    custody_account_binding_id,
    observer_kind,
    observed_at desc,
    created_at desc,
    id desc
  );

create or replace function private.select_latest_external_balance_observations(
  p_asset_id uuid,
  p_observer_kind text,
  p_observed_at_or_before timestamptz
)
returns table (
  custody_account_binding_id uuid,
  external_balance_observation_id uuid,
  observed_atomic_units numeric,
  observed_at timestamptz,
  membership_status text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_observer_kind text;
  v_asset_exists boolean;
  v_target_binding_count bigint;
begin
  v_observer_kind := pg_catalog.btrim(p_observer_kind);

  if v_observer_kind is null
    or v_observer_kind = ''
    or v_observer_kind !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
  then
    raise exception 'observer_kind_invalid'
      using errcode = '22023';
  end if;

  if p_observed_at_or_before is null then
    raise exception 'observation_cutoff_invalid'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.supported_assets as assets
    where assets.id = p_asset_id
  )
    into v_asset_exists;

  if not v_asset_exists then
    raise exception 'asset_not_found'
      using errcode = '23503';
  end if;

  select count(*)::bigint
    into v_target_binding_count
  from private.custody_account_bindings as bindings
  join private.custody_providers as providers
    on providers.id = bindings.custody_provider_id
  join public.supported_assets as assets
    on assets.id = bindings.asset_id
  where bindings.asset_id = p_asset_id
    and bindings.status = 'APPROVED'
    and bindings.account_role in ('COLLECTION', 'PAYOUT', 'TREASURY', 'FEE')
    and providers.status = 'APPROVED'
    and providers.supports_balance_observation
    and assets.status = 'ACTIVE';

  if v_target_binding_count = 0 then
    raise exception 'observable_binding_not_found'
      using errcode = '23514';
  end if;

  return query
  with target_bindings as (
    select bindings.id
    from private.custody_account_bindings as bindings
    join private.custody_providers as providers
      on providers.id = bindings.custody_provider_id
    join public.supported_assets as assets
      on assets.id = bindings.asset_id
    where bindings.asset_id = p_asset_id
      and bindings.status = 'APPROVED'
      and bindings.account_role in ('COLLECTION', 'PAYOUT', 'TREASURY', 'FEE')
      and providers.status = 'APPROVED'
      and providers.supports_balance_observation
      and assets.status = 'ACTIVE'
  ),
  latest_observations as (
    select distinct on (observations.custody_account_binding_id)
      observations.custody_account_binding_id,
      observations.id,
      observations.observed_units,
      observations.observed_at
    from private.external_balance_observations as observations
    join target_bindings
      on target_bindings.id = observations.custody_account_binding_id
    where observations.asset_id = p_asset_id
      and observations.observer_kind = v_observer_kind
      and observations.observed_at <= p_observed_at_or_before
    order by
      observations.custody_account_binding_id,
      observations.observed_at desc,
      observations.created_at desc,
      observations.id desc
  )
  select
    target_bindings.id,
    latest_observations.id,
    latest_observations.observed_units,
    latest_observations.observed_at,
    case
      when latest_observations.id is null then 'MISSING_OBSERVATION'
      else 'OBSERVED'
    end
  from target_bindings
  left join latest_observations
    on latest_observations.custody_account_binding_id = target_bindings.id
  order by target_bindings.id;
end;
$$;

comment on function private.select_latest_external_balance_observations(uuid, text, timestamptz) is
  'Private side-effect-free selector for P5-T02 asset aggregate reconciliation. It returns one membership row for every currently observable approved custody binding for an asset, selecting the latest cutoff-bound balance observation by observed_at, created_at, and id, and preserving missing observations instead of treating them as zero.';

revoke execute on function private.select_latest_external_balance_observations(uuid, text, timestamptz)
  from public, anon, authenticated;

create or replace function private.calculate_observed_external_balance_atomic_units(
  p_asset_id uuid,
  p_observer_kind text,
  p_observed_at_or_before timestamptz
)
returns table (
  observed_atomic_units numeric,
  target_binding_count bigint,
  observed_binding_count bigint,
  missing_binding_count bigint,
  is_complete boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_observed_atomic_units numeric;
  v_target_binding_count bigint;
  v_observed_binding_count bigint;
  v_missing_binding_count bigint;
begin
  select
    pg_catalog.sum(selected.observed_atomic_units) filter (
      where selected.membership_status = 'OBSERVED'
    ),
    count(*)::bigint,
    count(*) filter (
      where selected.membership_status = 'OBSERVED'
    )::bigint,
    count(*) filter (
      where selected.membership_status = 'MISSING_OBSERVATION'
    )::bigint
    into
      v_observed_atomic_units,
      v_target_binding_count,
      v_observed_binding_count,
      v_missing_binding_count
  from private.select_latest_external_balance_observations(
    p_asset_id,
    p_observer_kind,
    p_observed_at_or_before
  ) as selected;

  if v_target_binding_count = 0 then
    raise exception 'observable_binding_not_found'
      using errcode = '23514';
  end if;

  if v_missing_binding_count = 0 then
    v_observed_atomic_units := coalesce(v_observed_atomic_units, 0);

    if v_observed_atomic_units::text in ('NaN', 'Infinity', '-Infinity')
      or v_observed_atomic_units < 0
      or v_observed_atomic_units <> pg_catalog.trunc(v_observed_atomic_units)
      or v_observed_atomic_units >= pg_catalog.power(10::numeric, 38)
    then
      raise exception 'observed_balance_invalid'
        using errcode = '23514';
    end if;

    return query select
      v_observed_atomic_units,
      v_target_binding_count,
      v_observed_binding_count,
      v_missing_binding_count,
      true;
    return;
  end if;

  return query select
    null::numeric,
    v_target_binding_count,
    v_observed_binding_count,
    v_missing_binding_count,
    false;
end;
$$;

comment on function private.calculate_observed_external_balance_atomic_units(uuid, text, timestamptz) is
  'Private side-effect-free observed external balance aggregate for P5-T02 asset aggregate reconciliation. It sums binding latest observations only when every currently observable target binding has a cutoff-bound observation; incomplete membership returns NULL observed units and never hides missing bindings as zero.';

revoke execute on function private.calculate_observed_external_balance_atomic_units(uuid, text, timestamptz)
  from public, anon, authenticated;
