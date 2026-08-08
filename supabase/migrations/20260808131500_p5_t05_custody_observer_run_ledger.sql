do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'custody_observer_run_writer'
  ) then
    create role custody_observer_run_writer
      with login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end;
$$;

do $$
begin
  execute pg_catalog.format(
    'grant connect on database %I to custody_observer_run_writer',
    pg_catalog.current_database()
  );
end;
$$;

grant usage on schema private to custody_observer_run_writer;

create table private.custody_balance_observer_runs (
  run_id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  trigger_source text not null,
  identity_policy text not null,
  invocation_contract_version text not null,
  status text not null default 'RUNNING',
  terminal_code text null,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,
  version bigint not null default 1,
  pages_read bigint not null default 0,
  scopes_discovered bigint not null default 0,
  providers_discovered bigint not null default 0,
  bindings_discovered bigint not null default 0,
  scopes_started bigint not null default 0,
  scopes_completed bigint not null default 0,
  scopes_failed bigint not null default 0,
  scopes_aborted bigint not null default 0,
  bindings_succeeded bigint not null default 0,
  bindings_failed bigint not null default 0,
  bindings_aborted bigint not null default 0,
  adapter_factory_calls bigint not null default 0,
  adapter_factory_failures bigint not null default 0,
  scope_refresh_requested bigint not null default 0,
  scope_refresh_attempted bigint not null default 0,
  scope_refresh_succeeded bigint not null default 0,
  scope_refresh_failed bigint not null default 0,
  scope_no_longer_eligible bigint not null default 0,
  scope_read_attempts bigint not null default 0,
  scope_read_retry_attempts bigint not null default 0,
  worker_adapter_attempts bigint not null default 0,
  worker_database_attempts bigint not null default 0,
  worker_adapter_retry_attempts bigint not null default 0,
  worker_database_retry_attempts bigint not null default 0,
  client_close_attempts bigint not null default 0,
  client_close_failures bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint custody_balance_observer_runs_key_check check (
    run_key ~ '^obsrun:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  constraint custody_balance_observer_runs_trigger_check check (
    trigger_source in ('MANUAL','SCHEDULED','BACKFILL','RECOVERY')
  ),
  constraint custody_balance_observer_runs_identity_check check (
    identity_policy in ('PRODUCTION','LOCAL_MOCK')
  ),
  constraint custody_balance_observer_runs_contract_check check (
    invocation_contract_version = 'P5_T05_V1'
  ),
  constraint custody_balance_observer_runs_status_check check (
    status in ('RUNNING','COMPLETED','PARTIAL','ABORTED','FAILED_DISCOVERY','FAILED_CLEANUP')
  ),
  constraint custody_balance_observer_runs_terminal_code_check check (
    terminal_code is null or (
      terminal_code = pg_catalog.btrim(terminal_code)
      and terminal_code ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
    )
  ),
  constraint custody_balance_observer_runs_lifecycle_check check (
    (status = 'RUNNING' and completed_at is null and terminal_code is null and version = 1)
    or (status <> 'RUNNING' and completed_at is not null and completed_at >= started_at and version = 2)
  ),
  constraint custody_balance_observer_runs_counts_check check (
    pages_read >= 0 and scopes_discovered >= 0 and providers_discovered >= 0
    and bindings_discovered >= 0 and scopes_started >= 0 and scopes_completed >= 0
    and scopes_failed >= 0 and scopes_aborted >= 0 and bindings_succeeded >= 0
    and bindings_failed >= 0 and bindings_aborted >= 0 and adapter_factory_calls >= 0
    and adapter_factory_failures >= 0 and scope_refresh_requested >= 0
    and scope_refresh_attempted >= 0 and scope_refresh_succeeded >= 0
    and scope_refresh_failed >= 0 and scope_no_longer_eligible >= 0
    and scope_read_attempts >= 0 and scope_read_retry_attempts >= 0
    and worker_adapter_attempts >= 0 and worker_database_attempts >= 0
    and worker_adapter_retry_attempts >= 0 and worker_database_retry_attempts >= 0
    and client_close_attempts >= 0 and client_close_failures >= 0
    and scopes_completed + scopes_failed + scopes_aborted <= scopes_started
    and scopes_started <= scopes_discovered
    and bindings_succeeded + bindings_failed + bindings_aborted <= bindings_discovered
    and scope_refresh_succeeded + scope_refresh_failed <= scope_refresh_attempted
    and scope_refresh_attempted <= scope_refresh_requested
    and worker_adapter_retry_attempts <= worker_adapter_attempts
    and worker_database_retry_attempts <= worker_database_attempts
    and adapter_factory_failures <= adapter_factory_calls
    and client_close_failures <= client_close_attempts
  )
);

create table private.custody_balance_observer_scope_outcomes (
  run_id uuid not null references private.custody_balance_observer_runs(run_id) on delete restrict,
  discovery_index integer not null,
  provider_id uuid not null references private.custody_providers(id) on delete restrict,
  asset_id uuid not null references public.supported_assets(id) on delete restrict,
  scope_status text not null,
  binding_success_count bigint not null,
  binding_failure_count bigint not null,
  binding_abort_count bigint not null,
  refresh_requested boolean not null,
  refresh_attempted boolean not null,
  refresh_succeeded boolean not null,
  refresh_failed boolean not null,
  no_longer_eligible_count bigint not null,
  scope_code text null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (run_id, provider_id, asset_id),
  unique (run_id, discovery_index),
  constraint custody_balance_observer_scope_status_check check (
    scope_status in ('SUCCEEDED','PARTIAL','FAILED','ABORTED')
  ),
  constraint custody_balance_observer_scope_counts_check check (
    discovery_index >= 0 and binding_success_count >= 0 and binding_failure_count >= 0
    and binding_abort_count >= 0 and no_longer_eligible_count >= 0
  ),
  constraint custody_balance_observer_scope_refresh_check check (
    (not refresh_succeeded or refresh_attempted)
    and (not refresh_failed or refresh_attempted)
    and (not refresh_attempted or refresh_requested)
    and not (refresh_succeeded and refresh_failed)
  ),
  constraint custody_balance_observer_scope_code_check check (
    scope_code is null or (scope_code = pg_catalog.btrim(scope_code) and scope_code ~ '^[A-Z0-9][A-Z0-9_]{1,63}$')
  )
);

create table private.custody_balance_observer_binding_failures (
  run_id uuid not null references private.custody_balance_observer_runs(run_id) on delete restrict,
  provider_id uuid not null references private.custody_providers(id) on delete restrict,
  asset_id uuid not null references public.supported_assets(id) on delete restrict,
  binding_id uuid not null references private.custody_account_bindings(id) on delete restrict,
  binding_order integer not null,
  failure_stage text not null,
  safe_failure_code text not null,
  retryable boolean not null,
  adapter_attempts bigint not null,
  database_attempts bigint not null,
  retry_exhausted boolean not null,
  retry_deferred boolean not null,
  requires_scope_refresh boolean not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (run_id, binding_id),
  constraint custody_balance_observer_failure_order_check check (binding_order >= 0),
  constraint custody_balance_observer_failure_stage_check check (
    failure_stage in ('DISCOVERY','FACTORY','ADAPTER','VALIDATION','IDENTITY','DATABASE','REFRESH','WORKER','CLEANUP','ABORTED')
  ),
  constraint custody_balance_observer_failure_code_check check (
    safe_failure_code = pg_catalog.btrim(safe_failure_code)
    and safe_failure_code ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
  ),
  constraint custody_balance_observer_failure_attempts_check check (
    adapter_attempts >= 0 and database_attempts >= 0
  )
);

create index custody_balance_observer_runs_status_started_idx
  on private.custody_balance_observer_runs (status, started_at, run_id);
create index custody_balance_observer_scope_outcomes_run_index
  on private.custody_balance_observer_scope_outcomes (run_id, discovery_index);
create index custody_balance_observer_binding_failures_run_index
  on private.custody_balance_observer_binding_failures (run_id, binding_order);

revoke all on table private.custody_balance_observer_runs,
  private.custody_balance_observer_scope_outcomes,
  private.custody_balance_observer_binding_failures
  from public, anon, authenticated, service_role, custody_observer_scope_reader,
       custody_observer_worker, custody_observer_run_writer;

create or replace function private.begin_balance_observer_run(
  p_run_key text,
  p_trigger_source text,
  p_identity_policy text,
  p_invocation_contract_version text
)
returns table(run_id uuid, created boolean, version bigint, status text, started_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_existing private.custody_balance_observer_runs%rowtype;
begin
  if p_run_key is null or p_run_key !~ '^obsrun:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_trigger_source not in ('MANUAL','SCHEDULED','BACKFILL','RECOVERY')
    or p_identity_policy not in ('PRODUCTION','LOCAL_MOCK')
    or p_invocation_contract_version <> 'P5_T05_V1'
  then
    raise exception 'run_ledger_input_invalid' using errcode = '22023';
  end if;

  select * into v_existing
  from private.custody_balance_observer_runs
  where custody_balance_observer_runs.run_key = p_run_key
  for update;

  if found then
    if v_existing.trigger_source <> p_trigger_source
      or v_existing.identity_policy <> p_identity_policy
      or v_existing.invocation_contract_version <> p_invocation_contract_version
    then
      raise exception 'observer_run_idempotency_conflict' using errcode = '23505';
    end if;
    return query select v_existing.run_id, false, v_existing.version, v_existing.status, v_existing.started_at;
    return;
  end if;

  insert into private.custody_balance_observer_runs (
    run_key, trigger_source, identity_policy, invocation_contract_version
  ) values (
    p_run_key, p_trigger_source, p_identity_policy, p_invocation_contract_version
  ) returning custody_balance_observer_runs.run_id, custody_balance_observer_runs.version,
    custody_balance_observer_runs.status, custody_balance_observer_runs.started_at
    into v_existing.run_id, v_existing.version, v_existing.status, v_existing.started_at;

  return query select v_existing.run_id, true, v_existing.version, v_existing.status, v_existing.started_at;
exception when unique_violation then
  raise exception 'observer_run_idempotency_conflict' using errcode = '23505';
end;
$$;

create or replace function private.record_balance_observer_scope_outcome(
  p_run_id uuid, p_discovery_index integer, p_provider_id uuid, p_asset_id uuid,
  p_scope_status text, p_binding_success_count bigint, p_binding_failure_count bigint,
  p_binding_abort_count bigint, p_refresh_requested boolean, p_refresh_attempted boolean,
  p_refresh_succeeded boolean, p_refresh_failed boolean, p_no_longer_eligible_count bigint,
  p_scope_code text, p_failure_binding_ids uuid[], p_failure_binding_orders integer[],
  p_failure_stages text[], p_failure_codes text[], p_failure_retryable boolean[],
  p_failure_adapter_attempts bigint[], p_failure_database_attempts bigint[],
  p_failure_retry_exhausted boolean[], p_failure_retry_deferred boolean[],
  p_failure_requires_scope_refresh boolean[]
)
returns table(created boolean)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_run private.custody_balance_observer_runs%rowtype;
  v_existing_scope private.custody_balance_observer_scope_outcomes%rowtype;
  v_count integer;
begin
  select * into v_run from private.custody_balance_observer_runs as runs
  where runs.run_id = p_run_id for update;
  if not found then raise exception 'run_not_found' using errcode = '23503'; end if;
  if v_run.status <> 'RUNNING' then raise exception 'run_not_running' using errcode = '23514'; end if;

  if p_discovery_index is null or p_discovery_index < 0 or p_provider_id is null or p_asset_id is null
    or p_scope_status not in ('SUCCEEDED','PARTIAL','FAILED','ABORTED')
    or p_binding_success_count < 0 or p_binding_failure_count < 0 or p_binding_abort_count < 0
    or p_no_longer_eligible_count < 0
    or (p_scope_code is not null and (p_scope_code !~ '^[A-Z0-9][A-Z0-9_]{1,63}$' or p_scope_code <> pg_catalog.btrim(p_scope_code)))
    or (p_refresh_succeeded and not p_refresh_attempted)
    or (p_refresh_failed and not p_refresh_attempted)
    or (p_refresh_attempted and not p_refresh_requested)
    or (p_refresh_succeeded and p_refresh_failed)
  then raise exception 'run_scope_summary_invalid' using errcode = '22023'; end if;

  if not exists (select 1 from private.custody_providers where id = p_provider_id)
    or not exists (select 1 from public.supported_assets where id = p_asset_id)
  then raise exception 'run_scope_provider_asset_invalid' using errcode = '23503'; end if;

  v_count := coalesce(cardinality(p_failure_binding_ids), 0);
  if coalesce(cardinality(p_failure_binding_orders), 0) <> v_count
    or coalesce(cardinality(p_failure_stages), 0) <> v_count
    or coalesce(cardinality(p_failure_codes), 0) <> v_count
    or coalesce(cardinality(p_failure_retryable), 0) <> v_count
    or coalesce(cardinality(p_failure_adapter_attempts), 0) <> v_count
    or coalesce(cardinality(p_failure_database_attempts), 0) <> v_count
    or coalesce(cardinality(p_failure_retry_exhausted), 0) <> v_count
    or coalesce(cardinality(p_failure_retry_deferred), 0) <> v_count
    or coalesce(cardinality(p_failure_requires_scope_refresh), 0) <> v_count
    or p_binding_failure_count <> v_count
  then raise exception 'run_binding_failure_invalid' using errcode = '22023'; end if;

  if exists (
    select 1 from unnest(p_failure_binding_ids, p_failure_binding_orders, p_failure_stages,
      p_failure_codes, p_failure_retryable, p_failure_adapter_attempts, p_failure_database_attempts,
      p_failure_retry_exhausted, p_failure_retry_deferred, p_failure_requires_scope_refresh)
      as f(binding_id, binding_order, failure_stage, safe_failure_code, retryable, adapter_attempts,
        database_attempts, retry_exhausted, retry_deferred, requires_scope_refresh)
    left join private.custody_account_bindings as b on b.id = f.binding_id
    where f.binding_id is null or f.binding_order is null or f.binding_order < 0
      or f.failure_stage not in ('DISCOVERY','FACTORY','ADAPTER','VALIDATION','IDENTITY','DATABASE','REFRESH','WORKER','CLEANUP','ABORTED')
      or f.safe_failure_code is null or f.safe_failure_code !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
      or f.adapter_attempts is null or f.adapter_attempts < 0 or f.database_attempts is null or f.database_attempts < 0
      or f.retryable is null or f.retry_exhausted is null or f.retry_deferred is null or f.requires_scope_refresh is null
      or b.id is null or b.custody_provider_id <> p_provider_id or b.asset_id <> p_asset_id
  ) or v_count <> (select count(distinct x) from unnest(p_failure_binding_ids) as x)
  then raise exception 'run_binding_failure_invalid' using errcode = '22023'; end if;

  select * into v_existing_scope
    from private.custody_balance_observer_scope_outcomes as outcomes
    where outcomes.run_id = p_run_id
      and outcomes.provider_id = p_provider_id
      and outcomes.asset_id = p_asset_id
    for update;

  if found then
    if v_existing_scope.discovery_index = p_discovery_index
      and v_existing_scope.scope_status = p_scope_status
      and v_existing_scope.binding_success_count = p_binding_success_count
      and v_existing_scope.binding_failure_count = p_binding_failure_count
      and v_existing_scope.binding_abort_count = p_binding_abort_count
      and v_existing_scope.refresh_requested = p_refresh_requested
      and v_existing_scope.refresh_attempted = p_refresh_attempted
      and v_existing_scope.refresh_succeeded = p_refresh_succeeded
      and v_existing_scope.refresh_failed = p_refresh_failed
      and v_existing_scope.no_longer_eligible_count = p_no_longer_eligible_count
      and v_existing_scope.scope_code is not distinct from p_scope_code
      and v_count = (
        select count(*) from private.custody_balance_observer_binding_failures as failures
        where failures.run_id = p_run_id
          and failures.provider_id = p_provider_id
          and failures.asset_id = p_asset_id
      )
      and not exists (
        (
          select failures.binding_id, failures.binding_order, failures.failure_stage,
            failures.safe_failure_code, failures.retryable, failures.adapter_attempts,
            failures.database_attempts, failures.retry_exhausted, failures.retry_deferred,
            failures.requires_scope_refresh
          from private.custody_balance_observer_binding_failures as failures
          where failures.run_id = p_run_id
            and failures.provider_id = p_provider_id
            and failures.asset_id = p_asset_id
          except all
          select f.binding_id, f.binding_order, f.failure_stage, f.safe_failure_code,
            f.retryable, f.adapter_attempts, f.database_attempts, f.retry_exhausted,
            f.retry_deferred, f.requires_scope_refresh
          from unnest(p_failure_binding_ids, p_failure_binding_orders, p_failure_stages,
            p_failure_codes, p_failure_retryable, p_failure_adapter_attempts,
            p_failure_database_attempts, p_failure_retry_exhausted,
            p_failure_retry_deferred, p_failure_requires_scope_refresh)
            as f(binding_id, binding_order, failure_stage, safe_failure_code, retryable,
              adapter_attempts, database_attempts, retry_exhausted, retry_deferred,
              requires_scope_refresh)
        )
        union all
        (
          select f.binding_id, f.binding_order, f.failure_stage, f.safe_failure_code,
            f.retryable, f.adapter_attempts, f.database_attempts, f.retry_exhausted,
            f.retry_deferred, f.requires_scope_refresh
          from unnest(p_failure_binding_ids, p_failure_binding_orders, p_failure_stages,
            p_failure_codes, p_failure_retryable, p_failure_adapter_attempts,
            p_failure_database_attempts, p_failure_retry_exhausted,
            p_failure_retry_deferred, p_failure_requires_scope_refresh)
            as f(binding_id, binding_order, failure_stage, safe_failure_code, retryable,
              adapter_attempts, database_attempts, retry_exhausted, retry_deferred,
              requires_scope_refresh)
          except all
          select failures.binding_id, failures.binding_order, failures.failure_stage,
            failures.safe_failure_code, failures.retryable, failures.adapter_attempts,
            failures.database_attempts, failures.retry_exhausted, failures.retry_deferred,
            failures.requires_scope_refresh
          from private.custody_balance_observer_binding_failures as failures
          where failures.run_id = p_run_id
            and failures.provider_id = p_provider_id
            and failures.asset_id = p_asset_id
        )
      )
    then
      return query select false;
      return;
    end if;
    raise exception 'run_scope_idempotency_conflict' using errcode = '23505';
  end if;

  insert into private.custody_balance_observer_scope_outcomes (
    run_id, discovery_index, provider_id, asset_id, scope_status, binding_success_count,
    binding_failure_count, binding_abort_count, refresh_requested, refresh_attempted,
    refresh_succeeded, refresh_failed, no_longer_eligible_count, scope_code
  ) values (
    p_run_id, p_discovery_index, p_provider_id, p_asset_id, p_scope_status, p_binding_success_count,
    p_binding_failure_count, p_binding_abort_count, p_refresh_requested, p_refresh_attempted,
    p_refresh_succeeded, p_refresh_failed, p_no_longer_eligible_count, p_scope_code
  );

  insert into private.custody_balance_observer_binding_failures (
    run_id, provider_id, asset_id, binding_id, binding_order, failure_stage, safe_failure_code,
    retryable, adapter_attempts, database_attempts, retry_exhausted, retry_deferred, requires_scope_refresh
  )
  select p_run_id, p_provider_id, p_asset_id, f.binding_id, f.binding_order, f.failure_stage,
    f.safe_failure_code, f.retryable, f.adapter_attempts, f.database_attempts, f.retry_exhausted,
    f.retry_deferred, f.requires_scope_refresh
  from unnest(p_failure_binding_ids, p_failure_binding_orders, p_failure_stages, p_failure_codes,
    p_failure_retryable, p_failure_adapter_attempts, p_failure_database_attempts,
    p_failure_retry_exhausted, p_failure_retry_deferred, p_failure_requires_scope_refresh)
    as f(binding_id, binding_order, failure_stage, safe_failure_code, retryable, adapter_attempts,
      database_attempts, retry_exhausted, retry_deferred, requires_scope_refresh);

  return query select true;
exception when unique_violation then
  raise exception 'run_scope_idempotency_conflict' using errcode = '23505';
end;
$$;

create or replace function private.finalize_balance_observer_run(
  p_run_id uuid, p_expected_version bigint, p_terminal_status text, p_terminal_code text,
  p_pages_read bigint, p_scopes_discovered bigint, p_providers_discovered bigint, p_bindings_discovered bigint,
  p_scopes_started bigint, p_scopes_completed bigint, p_scopes_failed bigint, p_scopes_aborted bigint,
  p_bindings_succeeded bigint, p_bindings_failed bigint, p_bindings_aborted bigint,
  p_adapter_factory_calls bigint, p_adapter_factory_failures bigint, p_scope_refresh_requested bigint,
  p_scope_refresh_attempted bigint, p_scope_refresh_succeeded bigint, p_scope_refresh_failed bigint,
  p_scope_no_longer_eligible bigint, p_scope_read_attempts bigint, p_scope_read_retry_attempts bigint,
  p_worker_adapter_attempts bigint, p_worker_database_attempts bigint, p_worker_adapter_retry_attempts bigint,
  p_worker_database_retry_attempts bigint, p_client_close_attempts bigint, p_client_close_failures bigint
)
returns table(run_id uuid, finalized boolean, version bigint, status text, completed_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare v_run private.custody_balance_observer_runs%rowtype; v_completed timestamptz;
begin
  select * into v_run from private.custody_balance_observer_runs as runs
  where runs.run_id = p_run_id for update;
  if not found then raise exception 'run_not_found' using errcode = '23503'; end if;

  if v_run.status <> 'RUNNING' then
    if v_run.status = p_terminal_status and v_run.terminal_code is not distinct from p_terminal_code
      and (v_run.pages_read, v_run.scopes_discovered, v_run.providers_discovered, v_run.bindings_discovered,
        v_run.scopes_started, v_run.scopes_completed, v_run.scopes_failed, v_run.scopes_aborted,
        v_run.bindings_succeeded, v_run.bindings_failed, v_run.bindings_aborted, v_run.adapter_factory_calls,
        v_run.adapter_factory_failures, v_run.scope_refresh_requested, v_run.scope_refresh_attempted,
        v_run.scope_refresh_succeeded, v_run.scope_refresh_failed, v_run.scope_no_longer_eligible,
        v_run.scope_read_attempts, v_run.scope_read_retry_attempts, v_run.worker_adapter_attempts,
        v_run.worker_database_attempts, v_run.worker_adapter_retry_attempts, v_run.worker_database_retry_attempts,
        v_run.client_close_attempts, v_run.client_close_failures)
        = (p_pages_read, p_scopes_discovered, p_providers_discovered, p_bindings_discovered,
        p_scopes_started, p_scopes_completed, p_scopes_failed, p_scopes_aborted,
        p_bindings_succeeded, p_bindings_failed, p_bindings_aborted, p_adapter_factory_calls,
        p_adapter_factory_failures, p_scope_refresh_requested, p_scope_refresh_attempted,
        p_scope_refresh_succeeded, p_scope_refresh_failed, p_scope_no_longer_eligible,
        p_scope_read_attempts, p_scope_read_retry_attempts, p_worker_adapter_attempts,
        p_worker_database_attempts, p_worker_adapter_retry_attempts, p_worker_database_retry_attempts,
        p_client_close_attempts, p_client_close_failures)
    then return query select v_run.run_id, false, v_run.version, v_run.status, v_run.completed_at; return; end if;
    raise exception 'run_finalization_conflict' using errcode = '23505';
  end if;

  if p_expected_version <> v_run.version then raise exception 'run_version_conflict' using errcode = '40001'; end if;
  if p_terminal_status not in ('COMPLETED','PARTIAL','ABORTED','FAILED_DISCOVERY','FAILED_CLEANUP')
    or (p_terminal_code is not null and (p_terminal_code !~ '^[A-Z0-9][A-Z0-9_]{1,63}$' or p_terminal_code <> pg_catalog.btrim(p_terminal_code)))
    or p_pages_read < 0 or p_scopes_discovered < 0 or p_providers_discovered < 0 or p_bindings_discovered < 0
    or p_scopes_started < 0 or p_scopes_completed < 0 or p_scopes_failed < 0 or p_scopes_aborted < 0
    or p_bindings_succeeded < 0 or p_bindings_failed < 0 or p_bindings_aborted < 0
    or p_adapter_factory_calls < 0 or p_adapter_factory_failures < 0 or p_scope_refresh_requested < 0
    or p_scope_refresh_attempted < 0 or p_scope_refresh_succeeded < 0 or p_scope_refresh_failed < 0
    or p_scope_no_longer_eligible < 0 or p_scope_read_attempts < 0 or p_scope_read_retry_attempts < 0
    or p_worker_adapter_attempts < 0 or p_worker_database_attempts < 0 or p_worker_adapter_retry_attempts < 0
    or p_worker_database_retry_attempts < 0 or p_client_close_attempts < 0 or p_client_close_failures < 0
    or p_scopes_completed + p_scopes_failed + p_scopes_aborted > p_scopes_started
    or p_scopes_started > p_scopes_discovered
    or p_bindings_succeeded + p_bindings_failed + p_bindings_aborted > p_bindings_discovered
    or p_scope_refresh_succeeded + p_scope_refresh_failed > p_scope_refresh_attempted
    or p_scope_refresh_attempted > p_scope_refresh_requested
    or p_worker_adapter_retry_attempts > p_worker_adapter_attempts
    or p_worker_database_retry_attempts > p_worker_database_attempts
    or p_adapter_factory_failures > p_adapter_factory_calls
    or p_client_close_failures > p_client_close_attempts
  then raise exception 'run_final_summary_invalid' using errcode = '22023'; end if;

  v_completed := pg_catalog.clock_timestamp();
  update private.custody_balance_observer_runs set
    status = p_terminal_status, terminal_code = p_terminal_code, completed_at = v_completed,
    version = custody_balance_observer_runs.version + 1,
    pages_read = p_pages_read, scopes_discovered = p_scopes_discovered, providers_discovered = p_providers_discovered,
    bindings_discovered = p_bindings_discovered, scopes_started = p_scopes_started, scopes_completed = p_scopes_completed,
    scopes_failed = p_scopes_failed, scopes_aborted = p_scopes_aborted, bindings_succeeded = p_bindings_succeeded,
    bindings_failed = p_bindings_failed, bindings_aborted = p_bindings_aborted, adapter_factory_calls = p_adapter_factory_calls,
    adapter_factory_failures = p_adapter_factory_failures, scope_refresh_requested = p_scope_refresh_requested,
    scope_refresh_attempted = p_scope_refresh_attempted, scope_refresh_succeeded = p_scope_refresh_succeeded,
    scope_refresh_failed = p_scope_refresh_failed, scope_no_longer_eligible = p_scope_no_longer_eligible,
    scope_read_attempts = p_scope_read_attempts, scope_read_retry_attempts = p_scope_read_retry_attempts,
    worker_adapter_attempts = p_worker_adapter_attempts, worker_database_attempts = p_worker_database_attempts,
    worker_adapter_retry_attempts = p_worker_adapter_retry_attempts, worker_database_retry_attempts = p_worker_database_retry_attempts,
    client_close_attempts = p_client_close_attempts, client_close_failures = p_client_close_failures, updated_at = v_completed
  where custody_balance_observer_runs.run_id = p_run_id;
  return query select v_run.run_id, true, 2::bigint, p_terminal_status, v_completed;
end;
$$;

revoke execute on function private.begin_balance_observer_run(text,text,text,text) from public, anon, authenticated, service_role, custody_observer_scope_reader, custody_observer_worker;
revoke execute on function private.record_balance_observer_scope_outcome(uuid,integer,uuid,uuid,text,bigint,bigint,bigint,boolean,boolean,boolean,boolean,bigint,text,uuid[],integer[],text[],text[],boolean[],bigint[],bigint[],boolean[],boolean[],boolean[]) from public, anon, authenticated, service_role, custody_observer_scope_reader, custody_observer_worker;
revoke execute on function private.finalize_balance_observer_run(uuid,bigint,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) from public, anon, authenticated, service_role, custody_observer_scope_reader, custody_observer_worker;
grant execute on function private.begin_balance_observer_run(text,text,text,text) to custody_observer_run_writer;
grant execute on function private.record_balance_observer_scope_outcome(uuid,integer,uuid,uuid,text,bigint,bigint,bigint,boolean,boolean,boolean,boolean,bigint,text,uuid[],integer[],text[],text[],boolean[],bigint[],bigint[],boolean[],boolean[],boolean[]) to custody_observer_run_writer;
grant execute on function private.finalize_balance_observer_run(uuid,bigint,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) to custody_observer_run_writer;

create or replace function private.assert_custody_observer_run_writer_role_contract()
returns void language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role oid;
  v_allowed regprocedure[] := array[
    'private.begin_balance_observer_run(text, text, text, text)'::regprocedure,
    'private.record_balance_observer_scope_outcome(uuid, integer, uuid, uuid, text, bigint, bigint, bigint, boolean, boolean, boolean, boolean, bigint, text, uuid[], integer[], text[], text[], boolean[], bigint[], bigint[], boolean[], boolean[], boolean[])'::regprocedure,
    'private.finalize_balance_observer_run(uuid, bigint, text, text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint)'::regprocedure
  ];
begin
  select oid into v_role from pg_catalog.pg_roles where rolname = 'custody_observer_run_writer';
  if v_role is null or exists (select 1 from pg_catalog.pg_roles where oid = v_role and not (rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls))
    or exists (select 1 from pg_catalog.pg_authid where oid = v_role and rolpassword is not null)
    or exists (select 1 from pg_catalog.pg_auth_members where member = v_role or (roleid = v_role and member <> 'postgres'::regrole))
    or exists (select 1 from pg_catalog.pg_class where relowner = v_role)
    or not pg_catalog.has_database_privilege('custody_observer_run_writer', pg_catalog.current_database(), 'connect')
    or pg_catalog.has_database_privilege('custody_observer_run_writer', pg_catalog.current_database(), 'connect with grant option')
    or not pg_catalog.has_schema_privilege('custody_observer_run_writer', 'private', 'usage')
    or pg_catalog.has_schema_privilege('custody_observer_run_writer', 'private', 'usage with grant option')
  then raise exception 'custody_observer_run_writer_role_contract_invalid' using errcode='42501'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('private','public') and (p.oid <> all(v_allowed))
      and pg_catalog.has_function_privilege('custody_observer_run_writer', p.oid, 'execute')
  ) or exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('private','public') and c.relkind in ('r','p','v','m','f')
      and (pg_catalog.has_table_privilege('custody_observer_run_writer', c.oid, 'select')
        or pg_catalog.has_table_privilege('custody_observer_run_writer', c.oid, 'insert')
        or pg_catalog.has_table_privilege('custody_observer_run_writer', c.oid, 'update')
        or pg_catalog.has_table_privilege('custody_observer_run_writer', c.oid, 'delete'))
  ) then raise exception 'custody_observer_run_writer_role_contract_invalid' using errcode='42501'; end if;
  if not (select bool_and(pg_catalog.has_function_privilege('custody_observer_run_writer', p, 'execute') and not pg_catalog.has_function_privilege('custody_observer_run_writer', p, 'execute with grant option')) from unnest(v_allowed) p)
  then raise exception 'custody_observer_run_writer_role_contract_invalid' using errcode='42501'; end if;
end;
$$;

revoke execute on function private.assert_custody_observer_run_writer_role_contract()
  from public, anon, authenticated, service_role, custody_observer_scope_reader, custody_observer_worker, custody_observer_run_writer;

select private.assert_custody_observer_scope_reader_role_contract();
select private.assert_custody_observer_worker_role_contract();
select private.assert_custody_observer_run_writer_role_contract();
