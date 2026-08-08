begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

select extensions.ok(
  to_regprocedure('private.assert_custody_observer_worker_role_contract()') is not null,
  'custody observer worker role assertion exists'
);

select extensions.ok(
  not has_function_privilege(
    'custody_observer_worker',
    'private.assert_custody_observer_worker_role_contract()'::regprocedure,
    'execute'
  ),
  'custody observer worker cannot execute its private ACL assertion'
);

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'baseline custody observer worker ACL contract passes'
);

grant select on private.custody_providers
  to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects direct private table SELECT contamination'
);

revoke select on private.custody_providers
  from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after private table SELECT contamination is revoked'
);

grant execute on function private.record_external_balance_observation(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  text
) to custody_observer_worker;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects lower primitive EXECUTE contamination'
);

revoke execute on function private.record_external_balance_observation(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  text
) from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after lower primitive EXECUTE contamination is revoked'
);

grant execute on function private.record_balance_observation_and_advance_checkpoint(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  bigint,
  text,
  timestamptz
) to custody_observer_worker with grant option;

select extensions.throws_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  '42501'::character(5),
  'custody_observer_worker_role_contract_invalid',
  'role assertion rejects atomic command GRANT OPTION contamination'
);

revoke grant option for execute on function private.record_balance_observation_and_advance_checkpoint(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  bigint,
  text,
  timestamptz
) from custody_observer_worker;

select extensions.lives_ok(
  $$select private.assert_custody_observer_worker_role_contract()$$,
  'role assertion passes after atomic command GRANT OPTION contamination is revoked'
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
values
  (
    '00000000-0000-4000-8000-0000005a0101',
    'P5T03_RR_ASSET_A',
    'P5RA',
    'P5 T03 Review Remediation Asset A',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-0000005a0102',
    'P5T03_RR_ASSET_B',
    'P5RB',
    'P5 T03 Review Remediation Asset B',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-0000005a0103',
    'P5T03_RR_ASSET_C',
    'P5RC',
    'P5 T03 Review Remediation Asset C',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-0000005a0104',
    'P5T03_RR_ASSET_D',
    'P5RD',
    'P5 T03 Review Remediation Asset D',
    'NATIVE',
    9,
    null,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-0000005a0105',
    'P5T03_RR_ASSET_E',
    'P5RE',
    'P5 T03 Review Remediation Asset E',
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
    '00000000-0000-4000-8000-0000005a0201',
    'P5T03_RR_PROVIDER_A',
    'P5 T03 Review Remediation Provider A',
    'MPC_CUSTODIAN',
    true,
    false
  ),
  (
    '00000000-0000-4000-8000-0000005a0202',
    'P5T03_RR_PROVIDER_B',
    'P5 T03 Review Remediation Provider B',
    'MPC_CUSTODIAN',
    true,
    false
  ),
  (
    '00000000-0000-4000-8000-0000005a0203',
    'P5T03_RR_PROVIDER_C',
    'P5 T03 Review Remediation Provider C',
    'MPC_CUSTODIAN',
    true,
    false
  ),
  (
    '00000000-0000-4000-8000-0000005a0204',
    'P5T03_RR_PROVIDER_D',
    'P5 T03 Review Remediation Provider D',
    'MPC_CUSTODIAN',
    true,
    false
  ),
  (
    '00000000-0000-4000-8000-0000005a0205',
    'P5T03_RR_PROVIDER_E',
    'P5 T03 Review Remediation Provider E',
    'MPC_CUSTODIAN',
    true,
    false
  );

update private.custody_providers
set status = 'APPROVED'
where provider_code like 'P5T03_RR_PROVIDER_%';

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
    '00000000-0000-4000-8000-0000005a0301',
    '00000000-0000-4000-8000-0000005a0201',
    '00000000-0000-4000-8000-0000005a0101',
    'p5t03_rr_provider_disabled',
    'P5 T03 RR Provider Disabled',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-0000005a0302',
    '00000000-0000-4000-8000-0000005a0202',
    '00000000-0000-4000-8000-0000005a0102',
    'p5t03_rr_binding_disabled',
    'P5 T03 RR Binding Disabled',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-0000005a0303',
    '00000000-0000-4000-8000-0000005a0203',
    '00000000-0000-4000-8000-0000005a0103',
    'p5t03_rr_asset_disabled',
    'P5 T03 RR Asset Disabled',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-0000005a0304',
    '00000000-0000-4000-8000-0000005a0204',
    '00000000-0000-4000-8000-0000005a0104',
    'p5t03_rr_old_replay',
    'P5 T03 RR Old Replay',
    'COLLECTION'
  ),
  (
    '00000000-0000-4000-8000-0000005a0305',
    '00000000-0000-4000-8000-0000005a0205',
    '00000000-0000-4000-8000-0000005a0105',
    'p5t03_rr_legacy',
    'P5 T03 RR Legacy',
    'COLLECTION'
  );

update private.custody_account_bindings
set status = 'APPROVED'
where binding_key like 'p5t03_rr_%';

create temp table qa_rr_provider_initial as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-0000005a0301',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('a', 64),
  10,
  '2026-08-01 10:00:00+00'::timestamptz,
  0,
  'p5t03-rr-provider-cursor',
  '2026-08-01 10:00:00+00'::timestamptz
);

create temp table qa_rr_provider_counts as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints;

update private.custody_providers
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-0000005a0201';

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-0000005a0301',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('a', 64),
      10,
      '2026-08-01 10:00:00+00'::timestamptz,
      1,
      'p5t03-rr-provider-cursor',
      '2026-08-01 10:00:00+00'::timestamptz
    );
    raise exception 'expected provider-disabled exact replay rejection';
  exception
    when check_violation then
      if sqlerrm <> 'binding_not_observable' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'provider-disabled exact replay is rejected as not observable'
);

select extensions.is(
  (
    select
      balance_observations::text || ',' || observer_checkpoints::text
    from qa_rr_provider_counts
  ),
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text
  ),
  'provider-disabled exact replay leaves observation and checkpoint tables unchanged'
);

create temp table qa_rr_binding_initial as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-0000005a0302',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('b', 64),
  20,
  '2026-08-01 11:00:00+00'::timestamptz,
  0,
  'p5t03-rr-binding-cursor',
  '2026-08-01 11:00:00+00'::timestamptz
);

create temp table qa_rr_binding_counts as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints;

update private.custody_account_bindings
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-0000005a0302';

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-0000005a0302',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('b', 64),
      20,
      '2026-08-01 11:00:00+00'::timestamptz,
      1,
      'p5t03-rr-binding-cursor',
      '2026-08-01 11:00:00+00'::timestamptz
    );
    raise exception 'expected binding-disabled exact replay rejection';
  exception
    when check_violation then
      if sqlerrm <> 'binding_not_observable' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'binding-disabled exact replay is rejected as not observable'
);

select extensions.is(
  (
    select
      balance_observations::text || ',' || observer_checkpoints::text
    from qa_rr_binding_counts
  ),
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text
  ),
  'binding-disabled exact replay leaves observation and checkpoint tables unchanged'
);

create temp table qa_rr_asset_initial as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-0000005a0303',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('c', 64),
  30,
  '2026-08-01 12:00:00+00'::timestamptz,
  0,
  'p5t03-rr-asset-cursor',
  '2026-08-01 12:00:00+00'::timestamptz
);

create temp table qa_rr_asset_counts as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints;

update public.supported_assets
set status = 'SUSPENDED'
where id = '00000000-0000-4000-8000-0000005a0103';

select extensions.lives_ok(
  $_$
  do $$
  begin
    perform *
    from private.record_balance_observation_and_advance_checkpoint(
      '00000000-0000-4000-8000-0000005a0303',
      'BALANCE_OBSERVER_V1',
      'balobs:v1:c:' || repeat('c', 64),
      30,
      '2026-08-01 12:00:00+00'::timestamptz,
      1,
      'p5t03-rr-asset-cursor',
      '2026-08-01 12:00:00+00'::timestamptz
    );
    raise exception 'expected asset-disabled exact replay rejection';
  exception
    when check_violation then
      if sqlerrm <> 'binding_not_observable' then
        raise;
      end if;
  end;
  $$;
  $_$,
  'asset-disabled exact replay is rejected as not observable'
);

select extensions.is(
  (
    select
      balance_observations::text || ',' || observer_checkpoints::text
    from qa_rr_asset_counts
  ),
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text
  ),
  'asset-disabled exact replay leaves observation and checkpoint tables unchanged'
);

create temp table qa_rr_old_initial as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-0000005a0304',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('d', 64),
  40,
  '2026-08-01 13:00:00+00'::timestamptz,
  0,
  'p5t03-rr-old-cursor-1',
  '2026-08-01 13:00:00+00'::timestamptz
);

create temp table qa_rr_old_advance as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-0000005a0304',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('e', 64),
  41,
  '2026-08-01 14:00:00+00'::timestamptz,
  1,
  'p5t03-rr-old-cursor-2',
  '2026-08-01 14:00:00+00'::timestamptz
);

create temp table qa_rr_old_counts as
select
  (select count(*)::bigint from private.external_balance_observations) as balance_observations,
  (select count(*)::bigint from private.observer_checkpoints) as observer_checkpoints;

create temp table qa_rr_old_replay as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-0000005a0304',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('d', 64),
  40,
  '2026-08-01 13:00:00+00'::timestamptz,
  1,
  'p5t03-rr-old-cursor-1',
  '2026-08-01 13:00:00+00'::timestamptz
);

select extensions.ok(
  (select external_balance_observation_id from qa_rr_old_replay) =
    (select external_balance_observation_id from qa_rr_old_initial)
    and not (select observation_created from qa_rr_old_replay)
    and not (select checkpoint_created from qa_rr_old_replay)
    and not (select checkpoint_advanced from qa_rr_old_replay)
    and (select checkpoint_version from qa_rr_old_replay) = 2,
  'observable old exact replay after later checkpoint remains safe no-op'
);

select extensions.is(
  (
    select
      balance_observations::text || ',' || observer_checkpoints::text
    from qa_rr_old_counts
  ),
  (
    select
      (select count(*)::bigint from private.external_balance_observations)::text || ',' ||
      (select count(*)::bigint from private.observer_checkpoints)::text
  ),
  'observable old exact replay creates no additional side effects'
);

create temp table qa_rr_legacy_observation as
select *
from private.record_external_balance_observation(
  '00000000-0000-4000-8000-0000005a0305',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('f', 64),
  50,
  '2026-08-01 15:00:00+00'::timestamptz,
  'p5t03-rr-legacy-cursor'
);

create temp table qa_rr_legacy_catchup as
select *
from private.record_balance_observation_and_advance_checkpoint(
  '00000000-0000-4000-8000-0000005a0305',
  'BALANCE_OBSERVER_V1',
  'balobs:v1:c:' || repeat('f', 64),
  50,
  '2026-08-01 15:00:00+00'::timestamptz,
  0,
  'p5t03-rr-legacy-cursor',
  '2026-08-01 15:00:00+00'::timestamptz
);

select extensions.ok(
  not (select observation_created from qa_rr_legacy_catchup)
    and (select checkpoint_created from qa_rr_legacy_catchup)
    and not (select checkpoint_advanced from qa_rr_legacy_catchup)
    and (select external_balance_observation_id from qa_rr_legacy_catchup) =
      (select external_balance_observation_id from qa_rr_legacy_observation)
    and (select checkpoint_version from qa_rr_legacy_catchup) = 1,
  'observable legacy catch-up contract is preserved'
);

select * from extensions.finish();

rollback;
