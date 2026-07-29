create or replace function private.record_external_balance_observation(
  p_custody_account_binding_id uuid,
  p_observer_kind text,
  p_observation_key text,
  p_observed_atomic_units numeric,
  p_observed_at timestamptz,
  p_checkpoint_reference text default null
)
returns table (
  external_balance_observation_id uuid,
  created boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_binding private.custody_account_bindings%rowtype;
  v_provider private.custody_providers%rowtype;
  v_asset public.supported_assets%rowtype;
  v_observer_kind text;
  v_observation_key text;
  v_checkpoint_reference text;
  v_inserted_observation_id uuid;
  v_existing_observation private.external_balance_observations%rowtype;
begin
  v_observer_kind := pg_catalog.btrim(p_observer_kind);
  v_observation_key := pg_catalog.btrim(p_observation_key);
  v_checkpoint_reference := nullif(pg_catalog.btrim(p_checkpoint_reference), ''::text);

  if v_observer_kind is null
    or v_observer_kind = ''
    or v_observer_kind !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
  then
    raise exception 'observer_kind_invalid'
      using errcode = '22023';
  end if;

  if v_observation_key is null
    or v_observation_key = ''
    or v_observation_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or v_observation_key ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
  then
    raise exception 'observation_key_invalid'
      using errcode = '22023';
  end if;

  if p_observed_atomic_units is null
    or p_observed_atomic_units::text in ('NaN', 'Infinity', '-Infinity')
    or p_observed_atomic_units < 0
    or p_observed_atomic_units <> pg_catalog.trunc(p_observed_atomic_units)
    or p_observed_atomic_units::text !~ '^(0|[1-9][0-9]{0,37})$'
    or p_observed_atomic_units >= pg_catalog.power(10::numeric, 38)
  then
    raise exception 'observation_amount_invalid'
      using errcode = '22023';
  end if;

  if p_observed_at is null then
    raise exception 'observation_timestamp_invalid'
      using errcode = '22023';
  end if;

  if v_checkpoint_reference is not null
    and (
      pg_catalog.char_length(v_checkpoint_reference) > 200
      or v_checkpoint_reference ~ '[[:cntrl:]]'
      or v_checkpoint_reference ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
    )
  then
    raise exception 'observation_checkpoint_invalid'
      using errcode = '22023';
  end if;

  select bindings.*
    into v_binding
  from private.custody_account_bindings as bindings
  where bindings.id = p_custody_account_binding_id;

  if not found then
    raise exception 'binding_not_found'
      using errcode = '23503';
  end if;

  select providers.*
    into v_provider
  from private.custody_providers as providers
  where providers.id = v_binding.custody_provider_id;

  select assets.*
    into v_asset
  from public.supported_assets as assets
  where assets.id = v_binding.asset_id;

  if v_provider.id is null or v_asset.id is null then
    raise exception 'binding_contract_invalid'
      using errcode = '23514';
  end if;

  if v_provider.status <> 'APPROVED'
    or not v_provider.supports_balance_observation
    or v_binding.status <> 'APPROVED'
    or v_binding.account_role not in ('COLLECTION', 'PAYOUT', 'TREASURY', 'FEE')
    or v_asset.status <> 'ACTIVE'
  then
    raise exception 'binding_not_observable'
      using errcode = '23514';
  end if;

  insert into private.external_balance_observations (
    custody_account_binding_id,
    asset_id,
    observer_kind,
    observation_key,
    observed_units,
    checkpoint_reference,
    observed_at
  )
  values (
    v_binding.id,
    v_binding.asset_id,
    v_observer_kind,
    v_observation_key,
    p_observed_atomic_units,
    v_checkpoint_reference,
    p_observed_at
  )
  on conflict on constraint external_balance_observations_binding_observer_key_uidx
  do nothing
  returning id into v_inserted_observation_id;

  if v_inserted_observation_id is not null then
    return query select v_inserted_observation_id, true;
    return;
  end if;

  select observations.*
    into v_existing_observation
  from private.external_balance_observations as observations
  where observations.custody_account_binding_id = v_binding.id
    and observations.observer_kind = v_observer_kind
    and observations.observation_key = v_observation_key;

  if not found
    or v_existing_observation.asset_id <> v_binding.asset_id
    or v_existing_observation.observed_units <> p_observed_atomic_units
    or v_existing_observation.observed_at <> p_observed_at
    or v_existing_observation.checkpoint_reference is distinct from v_checkpoint_reference
  then
    raise exception 'observation_idempotency_conflict'
      using errcode = '23505';
  end if;

  return query select v_existing_observation.id, false;
end;
$$;

comment on function private.record_external_balance_observation(uuid, text, text, numeric, timestamptz, text) is
  'Private append-only ingestion function for local fixed-fixture custody balance observations. It derives asset identity from the approved custody binding, accepts exact non-negative integer Atomic Units including zero, verifies idempotent replay, rejects conflicting replay, and performs no checkpoint, reconciliation, ledger, provider network, or public RPC side effects.';

revoke execute on function private.record_external_balance_observation(uuid, text, text, numeric, timestamptz, text)
  from public, anon, authenticated;
