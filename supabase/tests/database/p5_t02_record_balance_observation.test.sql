begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  to_regprocedure(
    'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'
  ) is not null,
  'record balance observation function exists'
);

select extensions.is(
  pg_get_function_identity_arguments(
    'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure
  ),
  'p_custody_account_binding_id uuid, p_observer_kind text, p_observation_key text, p_observed_atomic_units numeric, p_observed_at timestamp with time zone, p_checkpoint_reference text',
  'record balance observation function has the expected argument contract'
);

select extensions.is(
  pg_get_function_result(
    'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure
  ),
  'TABLE(external_balance_observation_id uuid, created boolean)',
  'record balance observation function returns id and created flag'
);

select extensions.ok(
  exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'private'
      and procedures.proname = 'record_external_balance_observation'
      and procedures.provolatile = 'v'
      and not procedures.prosecdef
  ),
  'record balance observation function is volatile and security invoker'
);

select extensions.ok(
  obj_description(
    'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure,
    'pg_proc'
  ) is not null,
  'record balance observation function has a comment'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure,
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure,
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure,
      'execute'
    ),
  'record balance observation function is not executable by browser roles'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname ~* '(record.*balance.*observation|external_balance|balance_observation)'
  ),
  0,
  'no public balance observation rpc exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.external_balance_observations'::regclass
      and conname = 'external_balance_observations_binding_observer_key_uidx'
  ),
  'existing balance observation unique key remains the concurrency boundary'
);

select extensions.ok(
  pg_get_functiondef(
    'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure
  ) !~* 'on[[:space:]]+conflict[[:space:]]+do[[:space:]]+update'
    and pg_get_functiondef(
      'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure
    ) !~* 'update[[:space:]]+private[.]external_balance_observations'
    and pg_get_functiondef(
      'private.record_external_balance_observation(uuid, text, text, numeric, timestamp with time zone, text)'::regprocedure
    ) !~* 'delete[[:space:]]+from[[:space:]]+private[.]external_balance_observations',
  'record function has no upsert update, update, or delete path'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_external_balance_observation(
      '00000000-0000-4000-8000-000000569999',
      'BALANCE_OBSERVER',
      'p5obs.missing:0001',
      0,
      '2026-07-29 00:00:00+00'::timestamptz,
      null
    );
    raise exception 'expected missing binding failure';
  exception
    when foreign_key_violation then
      if sqlerrm <> 'binding_not_found' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'missing binding raises a safe error'
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
  '00000000-0000-4000-8000-000000560101',
  'P5OBS_ASSET_A',
  'P5OA',
  'P5 Observation Asset A',
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
    '00000000-0000-4000-8000-000000560201',
    'P5OBS_PROVIDER',
    'P5 Observation Provider',
    'MPC_CUSTODIAN',
    true,
    false
  ),
  (
    '00000000-0000-4000-8000-000000560202',
    'P5OBS_NOBAL',
    'P5 Observation Transfer Only Provider',
    'MPC_CUSTODIAN',
    false,
    true
  );

update private.custody_providers
set status = 'APPROVED'
where id in (
  '00000000-0000-4000-8000-000000560201',
  '00000000-0000-4000-8000-000000560202'
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
    '00000000-0000-4000-8000-000000560301',
    '00000000-0000-4000-8000-000000560201',
    '00000000-0000-4000-8000-000000560101',
    'p5obs_collection',
    'P5 Observation Collection',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-000000560302',
    '00000000-0000-4000-8000-000000560201',
    '00000000-0000-4000-8000-000000560101',
    'p5obs_treasury',
    'P5 Observation Treasury',
    'TREASURY'
  ),
  (
    '00000000-0000-4000-8000-000000560303',
    '00000000-0000-4000-8000-000000560202',
    '00000000-0000-4000-8000-000000560101',
    'p5obs_no_balance',
    'P5 Observation No Balance Capability',
    'COLLECTION'
  );

update private.custody_account_bindings
set status = 'APPROVED'
where id in (
  '00000000-0000-4000-8000-000000560301',
  '00000000-0000-4000-8000-000000560302',
  '00000000-0000-4000-8000-000000560303'
);

create temp table qa_p5obs_counts_before as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.external_transaction_observations) as transaction_observations,
  (select count(*)::bigint from private.reconciliation_runs) as reconciliation_runs,
  (select count(*)::bigint from private.reconciliation_items) as reconciliation_items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as binding_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries;

create temp table qa_p5obs_first as
select *
from private.record_external_balance_observation(
  '00000000-0000-4000-8000-000000560301',
  'BALANCE_OBSERVER',
  'p5obs.local:0001',
  0,
  '2026-07-29 01:02:03+00'::timestamptz,
  'p5obs-cursor-0001'
);

select extensions.is(
  (select count(*)::integer from qa_p5obs_first),
  1,
  'first zero balance observation returns one result row'
);

select extensions.is(
  (select created from qa_p5obs_first),
  true,
  'first zero balance observation reports created'
);

select extensions.is(
  (
    select (count(*) - (select balance_observations from qa_p5obs_counts_before))::integer
    from private.external_balance_observations
  ),
  1,
  'first zero balance observation appends exactly one balance row'
);

select extensions.is(
  (
    select observed_units::text
    from private.external_balance_observations
    where id = (select external_balance_observation_id from qa_p5obs_first)
  ),
  '0',
  'zero atomic unit balance is preserved'
);

select extensions.is(
  (
    select observations.asset_id
    from private.external_balance_observations as observations
    where observations.id = (select external_balance_observation_id from qa_p5obs_first)
  ),
  '00000000-0000-4000-8000-000000560101'::uuid,
  'observation asset is derived from the custody binding'
);

select extensions.ok(
  exists (
    select 1
    from private.external_balance_observations as observations
    join private.custody_account_bindings as bindings
      on bindings.id = observations.custody_account_binding_id
    join private.custody_providers as providers
      on providers.id = bindings.custody_provider_id
    where observations.id = (select external_balance_observation_id from qa_p5obs_first)
      and providers.provider_code = 'P5OBS_PROVIDER'
      and providers.status = 'APPROVED'
      and providers.supports_balance_observation
  ),
  'provider classification is resolved through the custody binding'
);

select extensions.is(
  (
    select observed_at
    from private.external_balance_observations
    where id = (select external_balance_observation_id from qa_p5obs_first)
  ),
  '2026-07-29 01:02:03+00'::timestamptz,
  'observed_at is preserved exactly'
);

select extensions.ok(
  (
    select created_at is not null
    from private.external_balance_observations
    where id = (select external_balance_observation_id from qa_p5obs_first)
  ),
  'created_at is generated by the database'
);

select extensions.is(
  (
    select
      transaction_observations::text || ',' ||
      reconciliation_runs::text || ',' ||
      reconciliation_items::text || ',' ||
      binding_observations::text || ',' ||
      observer_checkpoints::text || ',' ||
      ledger_journals::text || ',' ||
      ledger_entries::text
    from qa_p5obs_counts_before
  ),
  (
    select
      (select count(*)::bigint from private.external_transaction_observations)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_runs)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_items)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_item_binding_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text || ',' ||
      (select count(*)::bigint from private.ledger_journals)::text || ',' ||
      (select count(*)::bigint from private.ledger_entries)::text
  ),
  'first insert has no transaction, reconciliation, checkpoint, or ledger side effects'
);

create temp table qa_p5obs_after_first as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.external_transaction_observations) as transaction_observations,
  (select count(*)::bigint from private.reconciliation_runs) as reconciliation_runs,
  (select count(*)::bigint from private.reconciliation_items) as reconciliation_items,
  (select count(*)::bigint from private.reconciliation_item_binding_observations) as binding_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints,
  (select count(*)::bigint from private.ledger_journals) as ledger_journals,
  (select count(*)::bigint from private.ledger_entries) as ledger_entries;

create temp table qa_p5obs_replay as
select *
from private.record_external_balance_observation(
  '00000000-0000-4000-8000-000000560301',
  'BALANCE_OBSERVER',
  'p5obs.local:0001',
  0,
  '2026-07-29 01:02:03+00'::timestamptz,
  'p5obs-cursor-0001'
);

select extensions.is(
  (select external_balance_observation_id from qa_p5obs_replay),
  (select external_balance_observation_id from qa_p5obs_first),
  'identical replay returns the same observation id'
);

select extensions.is(
  (select created from qa_p5obs_replay),
  false,
  'identical replay reports not created'
);

select extensions.is(
  (
    select count(*)::bigint
    from private.external_balance_observations
  ),
  (select balance_observations from qa_p5obs_after_first),
  'identical replay appends no new balance row'
);

select extensions.is(
  (
    select
      transaction_observations::text || ',' ||
      reconciliation_runs::text || ',' ||
      reconciliation_items::text || ',' ||
      binding_observations::text || ',' ||
      observer_checkpoints::text || ',' ||
      ledger_journals::text || ',' ||
      ledger_entries::text
    from qa_p5obs_after_first
  ),
  (
    select
      (select count(*)::bigint from private.external_transaction_observations)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_runs)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_items)::text || ',' ||
      (select count(*)::bigint from private.reconciliation_item_binding_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text || ',' ||
      (select count(*)::bigint from private.ledger_journals)::text || ',' ||
      (select count(*)::bigint from private.ledger_entries)::text
  ),
  'identical replay has no non-balance side effects'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_external_balance_observation(
      '00000000-0000-4000-8000-000000560301',
      'BALANCE_OBSERVER',
      'p5obs.local:0001',
      1,
      '2026-07-29 01:02:03+00'::timestamptz,
      'p5obs-cursor-0001'
    );
    raise exception 'expected amount conflict failure';
  exception
    when unique_violation then
      if sqlerrm <> 'observation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same key with different amount raises safe conflict'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_external_balance_observation(
      '00000000-0000-4000-8000-000000560301',
      'BALANCE_OBSERVER',
      'p5obs.local:0001',
      0,
      '2026-07-29 01:02:04+00'::timestamptz,
      'p5obs-cursor-0001'
    );
    raise exception 'expected timestamp conflict failure';
  exception
    when unique_violation then
      if sqlerrm <> 'observation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same key with different observed_at raises safe conflict'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_external_balance_observation(
      '00000000-0000-4000-8000-000000560301',
      'BALANCE_OBSERVER',
      'p5obs.local:0001',
      0,
      '2026-07-29 01:02:03+00'::timestamptz,
      'p5obs-cursor-conflict'
    );
    raise exception 'expected checkpoint conflict failure';
  exception
    when unique_violation then
      if sqlerrm <> 'observation_idempotency_conflict' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'same key with different checkpoint raises safe conflict'
);

select extensions.is(
  (
    select count(*)::bigint
    from private.external_balance_observations
  ),
  (select balance_observations from qa_p5obs_after_first),
  'conflicting replays append no balance rows'
);

select extensions.ok(
  exists (
    select 1
    from private.external_balance_observations
    where id = (select external_balance_observation_id from qa_p5obs_first)
      and observed_units = 0
      and observed_at = '2026-07-29 01:02:03+00'::timestamptz
      and checkpoint_reference = 'p5obs-cursor-0001'
  ),
  'conflicting replays leave the original observation unchanged'
);

create temp table qa_p5obs_positive as
select *
from private.record_external_balance_observation(
  '00000000-0000-4000-8000-000000560301',
  'BALANCE_OBSERVER',
  'p5obs.local:0002',
  123456789,
  '2026-07-29 01:03:03+00'::timestamptz,
  null
);

select extensions.is(
  (
    select observed_units::text
    from private.external_balance_observations
    where id = (select external_balance_observation_id from qa_p5obs_positive)
  ),
  '123456789',
  'positive integer atomic units are preserved exactly'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_external_balance_observation(
      '00000000-0000-4000-8000-000000560301',
      'BALANCE_OBSERVER',
      'p5obs.local:neg',
      -1,
      '2026-07-29 01:04:03+00'::timestamptz,
      null
    );
    raise exception 'expected negative amount failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observation_amount_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'negative atomic units are rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_external_balance_observation(
      '00000000-0000-4000-8000-000000560301',
      'BALANCE_OBSERVER',
      'p5obs.local:frac',
      1.5,
      '2026-07-29 01:04:04+00'::timestamptz,
      null
    );
    raise exception 'expected fractional amount failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observation_amount_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'fractional atomic units are rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_external_balance_observation(
      '00000000-0000-4000-8000-000000560301',
      'BALANCE_OBSERVER',
      '',
      1,
      '2026-07-29 01:05:03+00'::timestamptz,
      null
    );
    raise exception 'expected empty key failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observation_key_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'empty observation key is rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_external_balance_observation(
      '00000000-0000-4000-8000-000000560301',
      'BALANCE_OBSERVER',
      '        ',
      1,
      '2026-07-29 01:05:04+00'::timestamptz,
      null
    );
    raise exception 'expected whitespace key failure';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'observation_key_invalid' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'whitespace-only observation key is rejected safely'
);

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_external_balance_observation(
      '00000000-0000-4000-8000-000000560303',
      'BALANCE_OBSERVER',
      'p5obs.local:nobal',
      1,
      '2026-07-29 01:06:03+00'::timestamptz,
      null
    );
    raise exception 'expected non-observable binding failure';
  exception
    when check_violation then
      if sqlerrm <> 'binding_not_observable' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'binding without balance observation capability is rejected safely'
);

create temp table qa_p5obs_same_key_different_binding as
select *
from private.record_external_balance_observation(
  '00000000-0000-4000-8000-000000560302',
  'BALANCE_OBSERVER',
  'p5obs.local:0001',
  0,
  '2026-07-29 01:02:03+00'::timestamptz,
  'p5obs-cursor-0001'
);

select extensions.isnt(
  (select external_balance_observation_id from qa_p5obs_same_key_different_binding),
  (select external_balance_observation_id from qa_p5obs_first),
  'same key on a different binding creates an independent observation'
);

create temp table qa_p5obs_same_key_different_observer as
select *
from private.record_external_balance_observation(
  '00000000-0000-4000-8000-000000560301',
  'BALANCE_OBSERVER_ALT',
  'p5obs.local:0001',
  0,
  '2026-07-29 01:02:03+00'::timestamptz,
  'p5obs-cursor-0001'
);

select extensions.isnt(
  (select external_balance_observation_id from qa_p5obs_same_key_different_observer),
  (select external_balance_observation_id from qa_p5obs_first),
  'same key with a different observer kind creates an independent observation'
);

select extensions.is(
  (
    select count(*)::integer
    from private.observer_checkpoints
  ),
  (select observer_checkpoints::integer from qa_p5obs_after_first),
  'observer checkpoints are not inserted or advanced'
);

select extensions.is(
  (
    select count(*)::integer
    from private.reconciliation_runs
  ),
  (select reconciliation_runs::integer from qa_p5obs_after_first),
  'reconciliation runs are not created'
);

select extensions.is(
  (
    select count(*)::integer
    from private.reconciliation_items
  ),
  (select reconciliation_items::integer from qa_p5obs_after_first),
  'reconciliation items are not created'
);

select extensions.is(
  (
    select count(*)::integer
    from private.reconciliation_item_binding_observations
  ),
  (select binding_observations::integer from qa_p5obs_after_first),
  'reconciliation binding provenance rows are not created'
);

select extensions.is(
  (
    select count(*)::integer
    from private.external_transaction_observations
  ),
  (select transaction_observations::integer from qa_p5obs_after_first),
  'external transaction observations are not created'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_journals
  ),
  (select ledger_journals::integer from qa_p5obs_after_first),
  'ledger journals are not created'
);

select extensions.is(
  (
    select count(*)::integer
    from private.ledger_entries
  ),
  (select ledger_entries::integer from qa_p5obs_after_first),
  'ledger entries are not created'
);

select * from extensions.finish();

rollback;
