create or replace function public.list_admin_reconciliation_items(
  p_limit integer default 100,
  p_before_created_at timestamptz default null,
  p_before_item_id uuid default null,
  p_asset_id uuid default null,
  p_run_status text default null,
  p_classification text default null,
  p_review_state text default null,
  p_observer_kind text default null,
  p_cutoff_from timestamptz default null,
  p_cutoff_to timestamptz default null
)
returns table (
  reconciliation_item_id uuid,
  reconciliation_run_id uuid,
  asset_id uuid,
  asset_code text,
  asset_symbol text,
  asset_display_name text,
  asset_decimals smallint,
  scope_kind text,
  run_status text,
  trigger_source text,
  observer_kind text,
  observation_cutoff_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  run_created_at timestamptz,
  item_created_at timestamptz,
  failure_code text,
  classification text,
  review_status text,
  review_version bigint,
  expected_units text,
  observed_units text,
  difference_units text,
  tolerance_units text,
  target_binding_count bigint,
  observed_binding_count bigint,
  missing_binding_count bigint,
  failed_binding_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_db_limit integer;
  v_run_status text;
  v_classification text;
  v_review_state text;
  v_observer_kind text;
begin
  if (select auth.uid()) is null or not public.is_current_user_admin_aal2() then
    raise exception 'ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  v_limit := coalesce(p_limit, 100);
  v_run_status := nullif(pg_catalog.btrim(p_run_status), '');
  v_classification := nullif(pg_catalog.btrim(p_classification), '');
  v_review_state := nullif(pg_catalog.btrim(p_review_state), '');
  v_observer_kind := nullif(pg_catalog.btrim(p_observer_kind), '');

  if v_limit < 1 or v_limit > 100 then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if (p_before_created_at is null) <> (p_before_item_id is null) then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_before_created_at is not null
    and p_before_created_at::text in ('infinity', '-infinity')
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_cutoff_from is not null
    and p_cutoff_from::text in ('infinity', '-infinity')
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_cutoff_to is not null
    and p_cutoff_to::text in ('infinity', '-infinity')
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_cutoff_from is not null
    and p_cutoff_to is not null
    and p_cutoff_to <= p_cutoff_from
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if v_run_status is not null
    and v_run_status not in ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if v_classification is not null
    and v_classification not in (
      'MATCHED',
      'WITHIN_TOLERANCE',
      'MISMATCH',
      'OBSERVATION_FAILED',
      'REVIEW_REQUIRED'
    )
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if v_review_state is not null
    and v_review_state <> 'NONE'
    and v_review_state not in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED')
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  if v_observer_kind is not null
    and v_observer_kind !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
  then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  v_db_limit := v_limit + 1;

  return query
    with provenance_counts as (
      select
        members.reconciliation_item_id,
        count(*)::bigint as target_binding_count,
        count(*) filter (
          where members.membership_status = 'OBSERVED'
        )::bigint as observed_binding_count,
        count(*) filter (
          where members.membership_status = 'MISSING_OBSERVATION'
        )::bigint as missing_binding_count,
        count(*) filter (
          where members.membership_status = 'OBSERVATION_FAILED'
        )::bigint as failed_binding_count
      from private.reconciliation_item_binding_observations as members
      group by members.reconciliation_item_id
    )
    select
      items.id as reconciliation_item_id,
      runs.id as reconciliation_run_id,
      assets.id as asset_id,
      assets.asset_code,
      assets.symbol as asset_symbol,
      assets.display_name as asset_display_name,
      assets.decimals as asset_decimals,
      items.scope_kind,
      runs.status as run_status,
      runs.trigger_source,
      runs.observer_kind,
      runs.observation_cutoff_at,
      runs.started_at,
      runs.completed_at,
      runs.created_at as run_created_at,
      items.created_at as item_created_at,
      runs.failure_code,
      items.classification,
      review_cases.status as review_status,
      review_cases.version as review_version,
      items.expected_units::text as expected_units,
      case
        when items.observed_units is null then null::text
        else items.observed_units::text
      end as observed_units,
      case
        when items.difference_units is null then null::text
        else items.difference_units::text
      end as difference_units,
      items.tolerance_units::text as tolerance_units,
      coalesce(provenance_counts.target_binding_count, 0::bigint)
        as target_binding_count,
      coalesce(provenance_counts.observed_binding_count, 0::bigint)
        as observed_binding_count,
      coalesce(provenance_counts.missing_binding_count, 0::bigint)
        as missing_binding_count,
      coalesce(provenance_counts.failed_binding_count, 0::bigint)
        as failed_binding_count
    from private.reconciliation_items as items
    join private.reconciliation_runs as runs
      on runs.id = items.reconciliation_run_id
    join public.supported_assets as assets
      on assets.id = items.asset_id
    left join private.reconciliation_review_cases as review_cases
      on review_cases.reconciliation_item_id = items.id
    left join provenance_counts
      on provenance_counts.reconciliation_item_id = items.id
    where (
        p_before_created_at is null
        or (items.created_at, items.id) < (p_before_created_at, p_before_item_id)
      )
      and (p_asset_id is null or items.asset_id = p_asset_id)
      and (v_run_status is null or runs.status = v_run_status)
      and (v_classification is null or items.classification = v_classification)
      and (
        v_review_state is null
        or (
          v_review_state = 'NONE'
          and review_cases.id is null
        )
        or review_cases.status = v_review_state
      )
      and (v_observer_kind is null or runs.observer_kind = v_observer_kind)
      and (
        p_cutoff_from is null
        or runs.observation_cutoff_at >= p_cutoff_from
      )
      and (
        p_cutoff_to is null
        or runs.observation_cutoff_at < p_cutoff_to
      )
    order by items.created_at desc, items.id desc
    limit v_db_limit;
end;
$$;

comment on function public.list_admin_reconciliation_items(
  integer,
  timestamp with time zone,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  timestamp with time zone
) is
  'ACTIVE ADMIN AAL2 read RPC for reconciliation item summaries. It uses compound created_at/id cursor pagination, returns exact Atomic Unit values as text, and excludes idempotency keys, actor profile IDs, raw provider payloads, checkpoints, JWT/session data, and service-role access.';

create or replace function public.get_admin_reconciliation_item_detail(
  p_reconciliation_item_id uuid
)
returns table (
  payload jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_current_user_admin_aal2() then
    raise exception 'ADMIN_AAL2_REQUIRED'
      using errcode = '42501';
  end if;

  if p_reconciliation_item_id is null then
    raise exception 'INVALID_INPUT'
      using errcode = '22023';
  end if;

  return query
    select jsonb_build_object(
      'run',
      jsonb_build_object(
        'id', runs.id,
        'status', runs.status,
        'triggerSource', runs.trigger_source,
        'observerKind', runs.observer_kind,
        'observationCutoffAt', runs.observation_cutoff_at,
        'startedAt', runs.started_at,
        'completedAt', runs.completed_at,
        'createdAt', runs.created_at,
        'failureCode', runs.failure_code
      ),
      'item',
      jsonb_build_object(
        'id', items.id,
        'scopeKind', items.scope_kind,
        'asset',
        jsonb_build_object(
          'id', assets.id,
          'assetCode', assets.asset_code,
          'symbol', assets.symbol,
          'displayName', assets.display_name,
          'decimals', assets.decimals
        ),
        'expectedUnits', items.expected_units::text,
        'observedUnits',
          case
            when items.observed_units is null then null::text
            else items.observed_units::text
          end,
        'differenceUnits',
          case
            when items.difference_units is null then null::text
            else items.difference_units::text
          end,
        'toleranceUnits', items.tolerance_units::text,
        'classification', items.classification,
        'createdAt', items.created_at
      ),
      'provenance',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'custodyAccountBindingId', provenance_rows.custody_account_binding_id,
              'providerCode', providers.provider_code,
              'providerDisplayName', providers.display_name,
              'bindingLabel', bindings.display_label,
              'bindingRole', bindings.account_role,
              'membershipStatus', provenance_rows.membership_status,
              'externalBalanceObservationId', observations.id,
              'observedUnits',
                case
                  when observations.observed_units is null then null::text
                  else observations.observed_units::text
                end,
              'observedAt', observations.observed_at,
              'createdAt', provenance_rows.created_at
            )
            order by
              providers.provider_code asc,
              bindings.display_label asc,
              provenance_rows.custody_account_binding_id asc
          )
          from (
            select
              members.custody_account_binding_id,
              members.external_balance_observation_id,
              members.membership_status,
              members.created_at
            from private.reconciliation_item_binding_observations as members
            where members.reconciliation_item_id = items.id

            union all

            select
              items.custody_account_binding_id,
              items.external_balance_observation_id,
              case
                when items.external_balance_observation_id is null then 'OBSERVATION_FAILED'
                else 'OBSERVED'
              end::text,
              items.created_at
            where items.scope_kind = 'BINDING'
              and items.custody_account_binding_id is not null
          ) as provenance_rows
          join private.custody_account_bindings as bindings
            on bindings.id = provenance_rows.custody_account_binding_id
          join private.custody_providers as providers
            on providers.id = bindings.custody_provider_id
          left join private.external_balance_observations as observations
            on observations.id = provenance_rows.external_balance_observation_id
        ),
        '[]'::jsonb
      ),
      'reviewCase',
      case
        when review_cases.id is null then null::jsonb
        else jsonb_build_object(
          'id', review_cases.id,
          'status', review_cases.status,
          'version', review_cases.version,
          'openedAt', review_cases.opened_at,
          'updatedAt', review_cases.updated_at,
          'resolvedAt', review_cases.resolved_at
        )
      end,
      'reviewEvents',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'eventVersion', events.event_version,
              'eventType', events.event_type,
              'fromStatus', events.from_status,
              'toStatus', events.to_status,
              'reasonCode', events.reason_code,
              'createdAt', events.created_at
            )
            order by
              events.event_version asc,
              events.created_at asc,
              events.id asc
          )
          from private.reconciliation_review_case_events as events
          where events.reconciliation_resolution_id = review_cases.id
        ),
        '[]'::jsonb
      )
    )
    from private.reconciliation_items as items
    join private.reconciliation_runs as runs
      on runs.id = items.reconciliation_run_id
    join public.supported_assets as assets
      on assets.id = items.asset_id
    left join private.reconciliation_review_cases as review_cases
      on review_cases.reconciliation_item_id = items.id
    where items.id = p_reconciliation_item_id;
end;
$$;

comment on function public.get_admin_reconciliation_item_detail(uuid) is
  'ACTIVE ADMIN AAL2 read RPC for one reconciliation item detail payload. It returns safe nested run, item, provenance, review case, and review event fields with exact Atomic Unit values as text and omits idempotency keys, actor profile IDs, raw provider payloads, checkpoints, JWT/session data, and service-role access.';

revoke all privileges on function public.list_admin_reconciliation_items(
  integer,
  timestamp with time zone,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated;

revoke all privileges on function public.get_admin_reconciliation_item_detail(uuid)
  from public, anon, authenticated;

grant execute on function public.list_admin_reconciliation_items(
  integer,
  timestamp with time zone,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  timestamp with time zone
) to authenticated;

grant execute on function public.get_admin_reconciliation_item_detail(uuid)
  to authenticated;
