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
    with provenance_rows as (
      select
        members.reconciliation_item_id,
        members.membership_status
      from private.reconciliation_item_binding_observations as members

      union all

      select
        binding_items.id as reconciliation_item_id,
        case
          when binding_items.external_balance_observation_id is null then 'OBSERVATION_FAILED'
          else 'OBSERVED'
        end::text as membership_status
      from private.reconciliation_items as binding_items
      where binding_items.scope_kind = 'BINDING'
        and binding_items.custody_account_binding_id is not null
    ),
    provenance_counts as (
      select
        rows.reconciliation_item_id,
        count(*)::bigint as target_binding_count,
        count(*) filter (
          where rows.membership_status = 'OBSERVED'
        )::bigint as observed_binding_count,
        count(*) filter (
          where rows.membership_status = 'MISSING_OBSERVATION'
        )::bigint as missing_binding_count,
        count(*) filter (
          where rows.membership_status = 'OBSERVATION_FAILED'
        )::bigint as failed_binding_count
      from provenance_rows as rows
      group by rows.reconciliation_item_id
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
  'ACTIVE ADMIN AAL2 read RPC for reconciliation item summaries. It uses compound created_at/id cursor pagination, returns exact Atomic Unit values as text, and counts BINDING and ASSET_AGGREGATE provenance consistently with the detail payload while excluding idempotency keys, actor profile IDs, raw provider payloads, checkpoints, JWT/session data, and service-role access.';

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
