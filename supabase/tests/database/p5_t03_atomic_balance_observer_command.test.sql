begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'custody_observer_worker'
      and rolcanlogin
      and not rolinherit
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolreplication
      and not rolbypassrls
  )
    and exists (
      select 1
      from pg_catalog.pg_authid as auth_roles
      where auth_roles.rolname = 'custody_observer_worker'
        and auth_roles.rolpassword is null
  ),
  'custody observer worker role exists with dedicated login-only safe attributes and no password in migration'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_auth_members as members
    where members.member = 'custody_observer_worker'::regrole
  ),
  0,
  'custody observer worker role has no role memberships'
);

select extensions.is(
  (
    select count(*)::integer
    from (
      select 1
      from pg_catalog.pg_class as classes
      where classes.relowner = 'custody_observer_worker'::regrole
      union all
      select 1
      from pg_catalog.pg_proc as procedures
      where procedures.proowner = 'custody_observer_worker'::regrole
      union all
      select 1
      from pg_catalog.pg_type as types
      where types.typowner = 'custody_observer_worker'::regrole
      union all
      select 1
      from pg_catalog.pg_namespace as namespaces
      where namespaces.nspowner = 'custody_observer_worker'::regrole
    ) as owned_objects
  ),
  0,
  'custody observer worker role owns no database objects'
);

select extensions.ok(
  has_database_privilege(
    'custody_observer_worker',
    current_database(),
    'connect'
  )
    and has_schema_privilege(
      'custody_observer_worker',
      'private',
      'usage'
    ),
  'custody observer worker role has only database connect and private schema usage as ambient privileges'
);

select extensions.ok(
  to_regprocedure(
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'
  ) is not null,
  'atomic balance observer command exists'
);

select extensions.is(
  pg_get_function_identity_arguments(
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
  ),
  'p_custody_account_binding_id uuid, p_observer_kind text, p_observation_key text, p_observed_atomic_units numeric, p_observed_at timestamp with time zone, p_expected_checkpoint_version bigint, p_next_checkpoint_value text, p_next_checkpoint_observed_at timestamp with time zone',
  'atomic balance observer command has the expected argument contract'
);

select extensions.is(
  pg_get_function_result(
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
  ),
  'TABLE(external_balance_observation_id uuid, observation_created boolean, observer_checkpoint_id uuid, checkpoint_created boolean, checkpoint_advanced boolean, checkpoint_version bigint)',
  'atomic balance observer command returns observation and checkpoint flags'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedures
    where procedures.oid =
      'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
      and procedures.provolatile = 'v'
      and procedures.prosecdef
      and procedures.proowner <> 'custody_observer_worker'::regrole
      and array_to_string(procedures.proconfig, ',') in ('search_path=', 'search_path=""')
  ),
  'atomic balance observer command is volatile SECURITY DEFINER with empty search_path and non-worker owner'
);

select extensions.ok(
  obj_description(
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure,
    'pg_proc'
  ) is not null,
  'atomic balance observer command has a comment'
);

select extensions.ok(
  has_function_privilege(
    'custody_observer_worker',
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'public',
      'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'service_role',
      'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure,
      'execute'
    ),
  'atomic command execute is granted only to the dedicated worker role among non-owner roles'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as procedures
    where procedures.pronamespace = 'private'::regnamespace
      and procedures.oid <>
        'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
      and has_function_privilege(
        'custody_observer_worker',
        procedures.oid,
        'execute'
      )
  ),
  0,
  'custody observer worker cannot effectively execute other private functions'
);

select extensions.ok(
  not has_function_privilege(
    'custody_observer_worker',
    'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure,
    'execute'
  ),
  'custody observer worker cannot directly execute the lower-level observation primitive'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as procedures
    where procedures.pronamespace = 'public'::regnamespace
      and procedures.proname ~* '^(grant|revoke|upsert|transition|create|cancel|reserve|approve|admin_|post|settle|unlock|assign|retire|fail|start)'
      and has_function_privilege(
        'custody_observer_worker',
        procedures.oid,
        'execute'
      )
  ),
  0,
  'custody observer worker cannot execute public write/admin command RPCs'
);

select extensions.is(
  (
    select count(*)::integer
    from information_schema.tables as tables
    where tables.table_schema = 'private'
      and (
        has_table_privilege(
          'custody_observer_worker',
          'private.' || tables.table_name,
          'select'
        )
        or has_table_privilege(
          'custody_observer_worker',
          'private.' || tables.table_name,
          'insert'
        )
        or has_table_privilege(
          'custody_observer_worker',
          'private.' || tables.table_name,
          'update'
        )
        or has_table_privilege(
          'custody_observer_worker',
          'private.' || tables.table_name,
          'delete'
        )
      )
  ),
  0,
  'custody observer worker has no direct private table privileges'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_class as classes
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'private'
      and classes.relkind = 'S'
      and (
        has_sequence_privilege(
          'custody_observer_worker',
          classes.oid,
          'usage'
        )
        or has_sequence_privilege(
          'custody_observer_worker',
          classes.oid,
          'select'
        )
        or has_sequence_privilege(
          'custody_observer_worker',
          classes.oid,
          'update'
        )
      )
  ),
  0,
  'custody observer worker has no direct private sequence privileges'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc as procedures
    where procedures.pronamespace = 'public'::regnamespace
      and procedures.proname ~* '(record.*balance.*observation|advance.*checkpoint|observer.*checkpoint)'
  ),
  0,
  'no public wrapper exists for balance observation checkpoint mutation'
);

select extensions.ok(
  pg_get_functiondef(
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
  ) ~ 'pg_advisory_xact_lock'
    and pg_get_functiondef(
      'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
    ) !~ 'pg_advisory_lock[[:space:]]*[(]'
    and pg_get_functiondef(
      'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
    ) !~* '(binding_key|provider_account|credential|https?://|execute[[:space:]])',
  'atomic command uses transaction advisory lock without session lock, raw provider identity, or dynamic SQL'
);

select extensions.ok(
  pg_get_functiondef(
    'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
  ) !~* 'on[[:space:]]+conflict[[:space:]]+do[[:space:]]+update'
    and pg_get_functiondef(
      'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
    ) !~* 'update[[:space:]]+private[.]external_balance_observations'
    and pg_get_functiondef(
      'private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamp with time zone, bigint, text, timestamp with time zone)'::regprocedure
    ) !~* 'delete[[:space:]]+from[[:space:]]+private[.]external_balance_observations',
  'atomic command does not update or delete external balance observations'
);

insert into public.supported_assets (
  id,
  asset_code,
  symbol,
  display_name,
  asset_type,
  decimals,
  mint_address,
  status
)
values (
  '00000000-0000-4000-8000-000000580101',
  'P5T03_DB_ASSET_A',
  'P5DA',
  'P5 T03 DB Asset A',
  'NATIVE',
  9,
  null,
  'ACTIVE'
);

insert into private.custody_providers (
  id,
  provider_code,
  display_name,
  provider_type,
  supports_balance_observation,
  supports_transfer_observation
)
values
  (
    '00000000-0000-4000-8000-000000580201',
    'P5T03_DB_PROVIDER',
    'P5 T03 DB Provider',
    'MPC_CUSTODIAN',
    true,
    false
  ),
  (
    '00000000-0000-4000-8000-000000580202',
    'P5T03_DB_NO_BALANCE',
    'P5 T03 DB No Balance Provider',
    'MPC_CUSTODIAN',
    false,
    true
  );

update private.custody_providers
set status = 'APPROVED'
where id in (
  '00000000-0000-4000-8000-000000580201',
  '00000000-0000-4000-8000-000000580202'
);

insert into private.custody_account_bindings (
  id,
  custody_provider_id,
  asset_id,
  binding_key,
  display_label,
  account_role
)
values
  (
    '00000000-0000-4000-8000-000000580301',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580101',
    'p5t03_atomic_primary',
    'P5 T03 Atomic Primary',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000580302',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580101',
    'p5t03_atomic_initial_conflict',
    'P5 T03 Atomic Initial Conflict',
    'TREASURY'
  ),
  (
    '00000000-0000-4000-8000-000000580303',
    '00000000-0000-4000-8000-000000580201',
    '00000000-0000-4000-8000-000000580101',
    'p5t03_atomic_legacy',
    'P5 T03 Atomic Legacy',
    'PAYOUT'
  ),
  (
    '00000000-0000-4000-8000-000000580304',
    '00000000-0000-4000-8000-000000580202',
    '00000000-0000-4000-8000-000000580101',
    'p5t03_atomic_non_observable',
    'P5 T03 Atomic Non Observable',
    'COLLECTION'
  );

update private.custody_account_bindings
set status = 'APPROVED'
where id in (
  '00000000-0000-4000-8000-000000580301',
  '00000000-0000-4000-8000-000000580302',
  '00000000-0000-4000-8000-000000580303',
  '00000000-0000-4000-8000-000000580304'
);

create temp table qa_forbidden_counts_before as
select
  (select count(*)::bigint from private.external_transaction_observations) as transaction_observations,
  (select count(*)::bigint from private.reconciliation_runs) as reconciliation_runs,
  (select count(*)::bigint from private.reconciliation_items) as reconciliation_items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as binding_observations,
  (select count(*)::bigint from private.reconciliation_review_cases) as review_cases,
  (select count(*)::bigint from private.reconciliation_review_case_events) as review_case_events,
  (select count(*)::bigint from private.ledger_accounts) as ledger_accounts,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries,
  (select count(*)::bigint from private.custody_providers) as custody_providers,
  (select count(*)::bigint from private.custody_account_bindings) as custody_account_bindings,
  (select count(*)::bigint from public.supported_assets) as supported_assets;

create temp table qa_initial as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-000000580301',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('a', 64),
  0,
  '2026-08-01 01:00:00+00'::timestamptz,
  0,
  'p5t03-cursor-0001',
  '2026-08-01 01:00:00+00'::timestamptz
);

select extensions.is(
  (select count(*)::integer from qa_initial),
  1,
  'initial atomic command returns one row'
);

select extensions.ok(
  (select observation_created from qa_initial)
    and (select checkpoint_created from qa_initial)
    and not (select checkpoint_advanced from qa_initial)
    and (select checkpoint_version from qa_initial) = 1,
  'initial atomic command creates observation and checkpoint version 1'
);

select extensions.ok(
  exists (
    select 1
    from private.external_balance_observations as observations
    join private.observer_checkpoints as checkpoints
      on checkpoints.id = (select observer_checkpoint_id from qa_initial)
    where observations.id = (select external_balance_observation_id from qa_initial)
      and observations.custody_account_binding_id = '00000000-0000-4000-8000-000000580301'
      and observations.asset_id = '00000000-0000-4000-8000-000000580101'
      and observations.observer_kind = 'BALANCE_OBSERVER_V1'
      and observations.observed_units = 0
      and observations.observed_at = '2026-08-01 01:00:00+00'::timestamptz
      and observations.checkpoint_reference = 'p5t03-cursor-0001'
      and checkpoints.custody_account_binding_id = observations.custody_account_binding_id
      and checkpoints.observer_kind = observations.observer_kind
      and checkpoints.checkpoint_value = 'p5t03-cursor-0001'
      and checkpoints.checkpoint_observed_at = observations.observed_at
      and checkpoints.version = 1
  ),
  'initial atomic command derives asset and aligns checkpoint value and observed timestamp'
);

create temp table qa_replay as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-000000580301',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('a', 64),
  0,
  '2026-08-01 01:00:00+00'::timestamptz,
  1,
  'p5t03-cursor-0001',
  '2026-08-01 01:00:00+00'::timestamptz
);

select extensions.ok(
  (select external_balance_observation_id from qa_replay) =
    (select external_balance_observation_id from qa_initial)
    and (select observer_checkpoint_id from qa_replay) =
      (select observer_checkpoint_id from qa_initial)
    and not (select observation_created from qa_replay)
    and not (select checkpoint_created from qa_replay)
    and not (select checkpoint_advanced from qa_replay)
    and (select checkpoint_version from qa_replay) = 1,
  'exact replay returns existing ids with no checkpoint version increase'
);

create temp table qa_advance as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-000000580301',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('b', 64),
  100,
  '2026-08-01 02:00:00+00'::timestamptz,
  1,
  'p5t03-cursor-0002',
  '2026-08-01 02:00:00+00'::timestamptz
);

select extensions.ok(
  (select observation_created from qa_advance)
    and not (select checkpoint_created from qa_advance)
    and (select checkpoint_advanced from qa_advance)
    and (select observer_checkpoint_id from qa_advance) =
      (select observer_checkpoint_id from qa_initial)
    and (select checkpoint_version from qa_advance) = 2,
  'advance creates a new observation and advances existing checkpoint to version 2'
);

select extensions.ok(
  exists (
    select 1
    from private.observer_checkpoints as checkpoints
    where checkpoints.id = (select observer_checkpoint_id from qa_initial)
      and checkpoints.checkpoint_value = 'p5t03-cursor-0002'
      and checkpoints.checkpoint_observed_at = '2026-08-01 02:00:00+00'::timestamptz
      and checkpoints.version = 2
  ),
  'advance updates checkpoint value, timestamp, and version'
);

create temp table qa_allowed_counts_after_advance as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('c', 64),
      101,
      '2026-08-01 03:00:00+00'::timestamptz,
      1,
      'p5t03-cursor-0003',
      '2026-08-01 03:00:00+00'::timestamptz
    );
    raise exception 'expected stale version conflict';
  exception
    when serialization_failure then
      if sqlerrm <> 'observer_checkpoint_version_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'stale checkpoint version raises safe conflict before side effects'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580302',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('d', 64),
      1,
      '2026-08-01 01:00:00+00'::timestamptz,
      1,
      'p5t03-cursor-initial-conflict',
      '2026-08-01 01:00:00+00'::timestamptz
    );
    raise exception 'expected initial version conflict';
  exception
    when serialization_failure then
      if sqlerrm <> 'observer_checkpoint_version_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'initial checkpoint requires expected version 0'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('a', 64),
      1,
      '2026-08-01 01:00:00+00'::timestamptz,
      2,
      'p5t03-cursor-0001',
      '2026-08-01 01:00:00+00'::timestamptz
    );
    raise exception 'expected amount replay conflict';
  exception
    when unique_violation then
      if sqlerrm <> 'observation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same observation key with changed amount raises safe idempotency conflict'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('a', 64),
      0,
      '2026-08-01 01:00:01+00'::timestamptz,
      2,
      'p5t03-cursor-0001',
      '2026-08-01 01:00:01+00'::timestamptz
    );
    raise exception 'expected timestamp replay conflict';
  exception
    when unique_violation then
      if sqlerrm <> 'observation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same observation key with changed timestamp raises safe idempotency conflict'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('a', 64),
      0,
      '2026-08-01 01:00:00+00'::timestamptz,
      2,
      'p5t03-cursor-conflict',
      '2026-08-01 01:00:00+00'::timestamptz
    );
    raise exception 'expected checkpoint replay conflict';
  exception
    when unique_violation then
      if sqlerrm <> 'observation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same observation key with changed checkpoint value raises safe idempotency conflict'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('e', 64),
      99,
      '2026-08-01 01:30:00+00'::timestamptz,
      2,
      'p5t03-cursor-regression',
      '2026-08-01 01:30:00+00'::timestamptz
    );
    raise exception 'expected checkpoint regression';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observer_checkpoint_regression' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'older checkpoint timestamp raises safe regression and rolls back observation'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('f', 64),
      101,
      '2026-08-01 02:00:00+00'::timestamptz,
      2,
      'p5t03-cursor-0002',
      '2026-08-01 02:00:00+00'::timestamptz
    );
    raise exception 'expected position conflict';
  exception
    when unique_violation then
      if sqlerrm <> 'observer_checkpoint_position_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same checkpoint timestamp with a different observation identity is blocked'
);

select extensions.is(
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text
  ),
  (
    select balance_observations::text || ',' || observer_checkpoints::text
    from qa_allowed_counts_after_advance
  ),
  'failed CAS, conflict, regression, and position attempts leave allowed tables unchanged'
);

create temp table qa_old_replay_after_advance as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-000000580301',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('a', 64),
  0,
  '2026-08-01 01:00:00+00'::timestamptz,
  1,
  'p5t03-cursor-0001',
  '2026-08-01 01:00:00+00'::timestamptz
);

select extensions.ok(
  (select external_balance_observation_id from qa_old_replay_after_advance) =
    (select external_balance_observation_id from qa_initial)
    and (select observer_checkpoint_id from qa_old_replay_after_advance) =
      (select observer_checkpoint_id from qa_initial)
    and not (select observation_created from qa_old_replay_after_advance)
    and not (select checkpoint_created from qa_old_replay_after_advance)
    and not (select checkpoint_advanced from qa_old_replay_after_advance)
    and (select checkpoint_version from qa_old_replay_after_advance) = 2,
  'old exact replay after later checkpoint is a safe no-op returning current checkpoint version'
);

create temp table qa_legacy_observation as
select *
from private.record_external_balance_observation(
  '00000000-0000-4000-8000-000000580303',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('1', 64),
  55,
  '2026-08-01 01:15:00+00'::timestamptz,
  'p5t03-cursor-legacy'
);

create temp table qa_legacy_catchup as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-000000580303',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('1', 64),
  55,
  '2026-08-01 01:15:00+00'::timestamptz,
  0,
  'p5t03-cursor-legacy',
  '2026-08-01 01:15:00+00'::timestamptz
);

select extensions.ok(
  not (select observation_created from qa_legacy_catchup)
    and (select checkpoint_created from qa_legacy_catchup)
    and not (select checkpoint_advanced from qa_legacy_catchup)
    and (select external_balance_observation_id from qa_legacy_catchup) =
      (select external_balance_observation_id from qa_legacy_observation)
    and (select checkpoint_version from qa_legacy_catchup) = 1,
  'legacy catch-up creates checkpoint for existing exact observation without appending a new observation'
);

create temp table qa_allowed_counts_after_legacy as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints;

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER',
      'balobs:v1:c:' || repeat('2', 64),
      1,
      '2026-08-01 04:00:00+00'::timestamptz,
      2,
      'p5t03-cursor-invalid-kind',
      '2026-08-01 04:00:00+00'::timestamptz
    );
    raise exception 'expected observer kind invalid';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observer_kind_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command rejects non-v1 observer kind'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'p5obs.local:bad',
      1,
      '2026-08-01 04:00:00+00'::timestamptz,
      2,
      'p5t03-cursor-invalid-key',
      '2026-08-01 04:00:00+00'::timestamptz
    );
    raise exception 'expected observation key invalid';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observation_key_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command rejects non-v1 observation key shape'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('3', 64),
      -1,
      '2026-08-01 04:00:00+00'::timestamptz,
      2,
      'p5t03-cursor-invalid-amount',
      '2026-08-01 04:00:00+00'::timestamptz
    );
    raise exception 'expected observation amount invalid';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observation_amount_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command rejects invalid amount'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('4', 64),
      1,
      '2026-08-01 04:00:00+00'::timestamptz,
      null,
      'p5t03-cursor-null-version',
      '2026-08-01 04:00:00+00'::timestamptz
    );
    raise exception 'expected checkpoint version invalid';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observer_checkpoint_version_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command rejects null expected checkpoint version'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('5', 64),
      1,
      '2026-08-01 04:00:00+00'::timestamptz,
      -1,
      'p5t03-cursor-negative-version',
      '2026-08-01 04:00:00+00'::timestamptz
    );
    raise exception 'expected negative checkpoint version invalid';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observer_checkpoint_version_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command rejects negative expected checkpoint version'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('6', 64),
      1,
      '2026-08-01 04:00:00+00'::timestamptz,
      2,
      '',
      '2026-08-01 04:00:00+00'::timestamptz
    );
    raise exception 'expected checkpoint value invalid';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observer_checkpoint_value_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command rejects empty checkpoint value'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('7', 64),
      1,
      '2026-08-01 04:00:00+00'::timestamptz,
      2,
      'bearer-marker',
      '2026-08-01 04:00:00+00'::timestamptz
    );
    raise exception 'expected checkpoint value invalid';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observer_checkpoint_value_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command rejects credential-like checkpoint value'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('8', 64),
      1,
      '2026-08-01 04:00:00+00'::timestamptz,
      2,
      'p5t03-cursor-mismatch',
      '2026-08-01 04:00:01+00'::timestamptz
    );
    raise exception 'expected checkpoint timestamp mismatch';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observer_checkpoint_timestamp_mismatch' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command requires checkpoint observed_at to equal observation observed_at'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000589999',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('9', 64),
      1,
      '2026-08-01 04:00:00+00'::timestamptz,
      0,
      'p5t03-cursor-missing-binding',
      '2026-08-01 04:00:00+00'::timestamptz
    );
    raise exception 'expected binding not found';
  exception
    when foreign_key_violation then
      if sqlerrm <> 'binding_not_found' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command preserves missing binding safe error'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-000000580304',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('0', 64),
      1,
      '2026-08-01 04:00:00+00'::timestamptz,
      0,
      'p5t03-cursor-non-observable',
      '2026-08-01 04:00:00+00'::timestamptz
    );
    raise exception 'expected binding not observable';
  exception
    when check_violation then
      if sqlerrm <> 'binding_not_observable' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'atomic command preserves non-observable binding safe error'
);

select extensions.is(
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text
  ),
  (
    select balance_observations::text || ',' || observer_checkpoints::text
    from qa_allowed_counts_after_legacy
  ),
  'input validation, missing binding, and non-observable binding attempts leave allowed tables unchanged'
);

select extensions.is(
  (
    select
      transaction_observations::text || ',' ||
      reconciliation_runs::text || ',' ||
      reconciliation_items::text || ',' ||
      binding_observations::text || ',' ||
      review_cases::text || ',' ||
      review_case_events::text || ',' ||
      ledger_accounts::text || ',' ||
      ledger_journals::text || ',' ||
      ledger_entries::text || ',' ||
      custody_providers::text || ',' ||
      custody_account_bindings::text || ',' ||
      supported_assets::text
    from qa_forbidden_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.external_transaction_observations)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_runs)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_items)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_item_binding_observations)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_review_cases)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_review_case_events)::text || ',' ||
      (select count(*)::bigint from private.ledger_accounts)::text || ',' ||
      (select count(*)::bigint from private.ledger_journals)::text || ',' ||
      (select count(*)::bigint from private.ledger_entries)::text || ',' ||
      (select count(*)::bigint from private.custody_providers)::text || ',' ||
      (select count(*)::bigint from private.custody_account_bindings)::text || ',' ||
      (select count(*)::bigint from public.supported_assets)::text
  ),
  'atomic command does not mutate transaction, reconciliation, review, ledger, custody config, or asset tables'
);

select * from extensions.finish();

rollback;
