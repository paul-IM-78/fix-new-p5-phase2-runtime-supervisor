create or replace function public.list_admin_custody_observer_runs(
  p_limit integer,
  p_cutoff timestamptz,
  p_before_created_at timestamptz default null,
  p_before_run_id uuid default null,
  p_status text default null,
  p_stale boolean default null,
  p_severity text default null,
  p_alert_eligible boolean default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null or not public.is_current_user_admin_aal2() then
    raise exception 'ADMIN_AAL2_REQUIRED' using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100
    or p_cutoff is null
    or (p_before_created_at is null) <> (p_before_run_id is null)
    or (p_status is not null and p_status not in ('RUNNING','COMPLETED','PARTIAL','ABORTED','FAILED_DISCOVERY','FAILED_CLEANUP'))
    or (p_severity is not null and p_severity not in ('INFO','WARNING','CRITICAL'))
  then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  with derived as (
    select
      runs.*,
      (runs.status = 'RUNNING' and runs.started_at is not null and runs.started_at < p_cutoff) as stale,
      case
        when runs.status = 'RUNNING' and runs.started_at is not null and runs.started_at < p_cutoff then 'CRITICAL'
        when runs.status = 'PARTIAL' then 'WARNING'
        when runs.status = 'FAILED_DISCOVERY' and runs.terminal_code in (
          'ORCHESTRATOR_SCOPE_DISCOVERY_FAILED','ORCHESTRATOR_SCOPE_PAGE_INVALID','ORCHESTRATOR_SCOPE_CURSOR_LOOP',
          'ORCHESTRATOR_DISCOVERY_LIMIT_EXCEEDED','ORCHESTRATOR_SCOPE_DUPLICATE','ORCHESTRATOR_PROVIDER_REF_INVALID'
        ) then 'CRITICAL'
        when runs.status = 'FAILED_CLEANUP' and runs.terminal_code = 'ORCHESTRATOR_CLIENT_CLOSE_FAILED' then 'CRITICAL'
        else 'INFO'
      end as severity
    from private.custody_balance_observer_runs as runs
  ), filtered as (
    select * from derived
    where (p_status is null or status = p_status)
      and (p_stale is null or stale = p_stale)
      and (p_severity is null or severity = p_severity)
      and (p_alert_eligible is null or (severity in ('WARNING','CRITICAL')) = p_alert_eligible)
  ), candidates as (
    select * from filtered
    where p_before_created_at is null
      or created_at < p_before_created_at
      or (created_at = p_before_created_at and run_id < p_before_run_id)
    order by created_at desc, run_id desc
    limit p_limit + 1
  ), page as (
    select * from candidates order by created_at desc, run_id desc limit p_limit
  ), page_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'run_id', run_id,
      'status', status,
      'version', version::text,
      'terminal_code', terminal_code,
      'created_at', created_at,
      'started_at', started_at,
      'completed_at', completed_at,
      'scope_count', scopes_discovered::text,
      'success_count', scopes_completed::text,
      'failed_count', scopes_failed::text,
      'aborted_count', scopes_aborted::text,
      'binding_failure_count', bindings_failed::text,
      'stale', stale,
      'severity', severity,
      'alert_eligible', severity in ('WARNING','CRITICAL')
    ) order by created_at desc, run_id desc), '[]'::jsonb) as items
    from page
  ), cursor_row as (
    select created_at, run_id from page order by created_at asc, run_id asc limit 1
  )
  select jsonb_build_object(
    'items', page_json.items,
    'total_count', (select count(*)::text from filtered),
    'next_cursor_created_at', case when (select count(*) from candidates) > p_limit then (select created_at from cursor_row) else null end,
    'next_cursor_run_id', case when (select count(*) from candidates) > p_limit then (select run_id from cursor_row) else null end
  ) into v_result from page_json;

  return v_result;
end;
$$;

create or replace function public.get_admin_custody_observer_run_detail(
  p_run_id uuid,
  p_cutoff timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null or not public.is_current_user_admin_aal2() then
    raise exception 'ADMIN_AAL2_REQUIRED' using errcode = '42501';
  end if;
  if p_run_id is null or p_cutoff is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  with derived as (
    select runs.*,
      (runs.status = 'RUNNING' and runs.started_at is not null and runs.started_at < p_cutoff) as stale,
      case
        when runs.status = 'RUNNING' and runs.started_at is not null and runs.started_at < p_cutoff then 'CRITICAL'
        when runs.status = 'PARTIAL' then 'WARNING'
        when runs.status = 'FAILED_DISCOVERY' and runs.terminal_code in ('ORCHESTRATOR_SCOPE_DISCOVERY_FAILED','ORCHESTRATOR_SCOPE_PAGE_INVALID','ORCHESTRATOR_SCOPE_CURSOR_LOOP','ORCHESTRATOR_DISCOVERY_LIMIT_EXCEEDED','ORCHESTRATOR_SCOPE_DUPLICATE','ORCHESTRATOR_PROVIDER_REF_INVALID') then 'CRITICAL'
        when runs.status = 'FAILED_CLEANUP' and runs.terminal_code = 'ORCHESTRATOR_CLIENT_CLOSE_FAILED' then 'CRITICAL'
        else 'INFO'
      end as severity
    from private.custody_balance_observer_runs as runs
    where runs.run_id = p_run_id
  )
  select jsonb_build_object(
    'run_id', runs.run_id, 'status', runs.status, 'version', runs.version::text,
    'terminal_code', runs.terminal_code, 'created_at', runs.created_at, 'started_at', runs.started_at,
    'completed_at', runs.completed_at, 'scope_count', runs.scopes_discovered::text,
    'success_count', runs.scopes_completed::text, 'failed_count', runs.scopes_failed::text,
    'aborted_count', runs.scopes_aborted::text, 'binding_failure_count', runs.bindings_failed::text,
    'stale', runs.stale, 'severity', runs.severity, 'alert_eligible', runs.severity in ('WARNING','CRITICAL'),
    'scope_outcomes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'scope_status', outcomes.scope_status, 'scope_code', outcomes.scope_code,
        'binding_success_count', outcomes.binding_success_count::text,
        'binding_failure_count', outcomes.binding_failure_count::text,
        'binding_abort_count', outcomes.binding_abort_count::text,
        'refresh_requested', outcomes.refresh_requested, 'refresh_attempted', outcomes.refresh_attempted,
        'refresh_succeeded', outcomes.refresh_succeeded, 'refresh_failed', outcomes.refresh_failed,
        'no_longer_eligible_count', outcomes.no_longer_eligible_count::text,
        'recorded_at', outcomes.recorded_at, 'provider_name', providers.display_name,
        'asset_symbol', assets.symbol
      ) order by outcomes.recorded_at asc, outcomes.discovery_index asc)
      from private.custody_balance_observer_scope_outcomes as outcomes
      left join private.custody_providers as providers on providers.id = outcomes.provider_id
      left join public.supported_assets as assets on assets.id = outcomes.asset_id
      where outcomes.run_id = runs.run_id
    ), '[]'::jsonb),
    'binding_failures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'failure_stage', failures.failure_stage, 'failure_code', failures.safe_failure_code,
        'retryable', failures.retryable, 'requires_scope_refresh', failures.requires_scope_refresh,
        'adapter_attempts', failures.adapter_attempts::text, 'database_attempts', failures.database_attempts::text,
        'recorded_at', failures.recorded_at, 'provider_name', providers.display_name,
        'asset_symbol', assets.symbol
      ) order by failures.recorded_at asc, failures.binding_order asc, failures.binding_id asc)
      from private.custody_balance_observer_binding_failures as failures
      left join private.custody_providers as providers on providers.id = failures.provider_id
      left join public.supported_assets as assets on assets.id = failures.asset_id
      where failures.run_id = runs.run_id
    ), '[]'::jsonb)
  ) into v_result
  from derived as runs;

  return v_result;
end;
$$;

comment on function public.list_admin_custody_observer_runs(integer, timestamptz, timestamptz, uuid, text, boolean, text, boolean) is
  'ACTIVE ADMIN AAL2 read RPC for safe custody observer run summaries with keyset pagination and DB-derived operational state.';
comment on function public.get_admin_custody_observer_run_detail(uuid, timestamptz) is
  'ACTIVE ADMIN AAL2 read RPC for one safe custody observer run detail with complete safe evidence arrays.';

revoke all privileges on function public.list_admin_custody_observer_runs(integer, timestamptz, timestamptz, uuid, text, boolean, text, boolean) from public, anon, authenticated;
revoke all privileges on function public.get_admin_custody_observer_run_detail(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.list_admin_custody_observer_runs(integer, timestamptz, timestamptz, uuid, text, boolean, text, boolean) to authenticated;
grant execute on function public.get_admin_custody_observer_run_detail(uuid, timestamptz) to authenticated;
