alter table private.reconciliation_items
  add column scope_kind text not null default 'BINDING';

alter table private.reconciliation_items
  alter column custody_account_binding_id drop not null;

alter table private.reconciliation_items
  drop constraint reconciliation_items_observation_shape_check;

alter table private.reconciliation_items
  add constraint reconciliation_items_scope_kind_check
    check (scope_kind in ('BINDING', 'ASSET_AGGREGATE')),
  add constraint reconciliation_items_scope_consistency_check
    check (
      (
        scope_kind = 'BINDING'
        and custody_account_binding_id is not null
      )
      or (
        scope_kind = 'ASSET_AGGREGATE'
        and custody_account_binding_id is null
        and external_balance_observation_id is null
      )
    ),
  add constraint reconciliation_items_observation_shape_check
    check (
      (
        classification = 'OBSERVATION_FAILED'
        and external_balance_observation_id is null
        and observed_units is null
        and difference_units is null
      )
      or (
        classification <> 'OBSERVATION_FAILED'
        and observed_units is not null
        and difference_units is not null
        and (
          (
            scope_kind = 'BINDING'
            and external_balance_observation_id is not null
          )
          or (
            scope_kind = 'ASSET_AGGREGATE'
            and external_balance_observation_id is null
          )
        )
      )
    );

comment on column private.reconciliation_items.scope_kind is
  'Comparison scope for the reconciliation item. BINDING preserves the original binding-scoped row shape; ASSET_AGGREGATE compares one asset-level expected value against the aggregate of binding observations.';

comment on column private.reconciliation_items.custody_account_binding_id is
  'Custody binding for binding-scoped reconciliation items. Asset aggregate items must leave this column null and store binding observation provenance in private.reconciliation_item_binding_observations.';

comment on column private.reconciliation_items.external_balance_observation_id is
  'Single balance observation reference for binding-scoped items. Asset aggregate items must leave this column null because their observed value is composed from multiple binding observation members.';

create unique index reconciliation_items_run_asset_aggregate_uidx
  on private.reconciliation_items (reconciliation_run_id, asset_id)
  where scope_kind = 'ASSET_AGGREGATE';

create index reconciliation_items_scope_asset_idx
  on private.reconciliation_items (
    scope_kind,
    asset_id,
    created_at desc,
    id desc
  );

create table private.reconciliation_item_binding_observations (
  reconciliation_item_id uuid not null
    references private.reconciliation_items (id) on delete restrict,

  custody_account_binding_id uuid not null
    references private.custody_account_bindings (id) on delete restrict,

  external_balance_observation_id uuid null
    references private.external_balance_observations (id) on delete restrict,

  membership_status text not null,

  created_at timestamptz not null default clock_timestamp(),

  constraint reconciliation_item_binding_observations_pkey
    primary key (reconciliation_item_id, custody_account_binding_id),

  constraint reconciliation_item_binding_observations_status_check
    check (
      membership_status in (
        'OBSERVED',
        'MISSING_OBSERVATION',
        'OBSERVATION_FAILED'
      )
    ),

  constraint reconciliation_item_binding_observations_shape_check
    check (
      (
        membership_status = 'OBSERVED'
        and external_balance_observation_id is not null
      )
      or (
        membership_status in ('MISSING_OBSERVATION', 'OBSERVATION_FAILED')
        and external_balance_observation_id is null
      )
    )
);

comment on table private.reconciliation_item_binding_observations is
  'Private provenance snapshot for asset aggregate reconciliation items. Each row records one custody binding member and the safe external balance observation used, if any.';

comment on column private.reconciliation_item_binding_observations.reconciliation_item_id is
  'Asset aggregate reconciliation item that this binding membership row explains.';

comment on column private.reconciliation_item_binding_observations.custody_account_binding_id is
  'Custody binding included in the aggregate membership snapshot.';

comment on column private.reconciliation_item_binding_observations.external_balance_observation_id is
  'Safe balance observation used for OBSERVED members. Missing and failed members leave this null.';

comment on column private.reconciliation_item_binding_observations.membership_status is
  'Snapshot status for this binding member. Missing or failed observations make normal aggregate result classifications invalid.';

create index reconciliation_item_binding_observations_item_idx
  on private.reconciliation_item_binding_observations (
    reconciliation_item_id,
    created_at desc
  );

create index reconciliation_item_binding_observations_binding_idx
  on private.reconciliation_item_binding_observations (
    custody_account_binding_id,
    created_at desc
  );

create index reconciliation_item_binding_observations_observation_idx
  on private.reconciliation_item_binding_observations (
    external_balance_observation_id
  )
  where external_balance_observation_id is not null;

create or replace function private.validate_reconciliation_item_binding_observation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item private.reconciliation_items%rowtype;
  v_observation private.external_balance_observations%rowtype;
begin
  select items.*
    into v_item
  from private.reconciliation_items as items
  where items.id = new.reconciliation_item_id;

  if not found then
    return new;
  end if;

  if v_item.scope_kind <> 'ASSET_AGGREGATE' then
    raise exception 'RECONCILIATION_ITEM_SCOPE_INVALID'
      using errcode = '23514';
  end if;

  if new.external_balance_observation_id is not null then
    select observations.*
      into v_observation
    from private.external_balance_observations as observations
    where observations.id = new.external_balance_observation_id;

    if not found then
      return new;
    end if;

    if v_observation.custody_account_binding_id <> new.custody_account_binding_id then
      raise exception 'RECONCILIATION_OBSERVATION_BINDING_MISMATCH'
        using errcode = '23514';
    end if;

    if v_observation.asset_id <> v_item.asset_id then
      raise exception 'RECONCILIATION_OBSERVATION_ASSET_MISMATCH'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.validate_reconciliation_item_binding_observation() is
  'Private trigger validator for asset aggregate reconciliation provenance. It enforces item scope and observation binding/asset consistency without calculating expected balances.';

revoke execute on function private.validate_reconciliation_item_binding_observation()
  from public, anon, authenticated;

create trigger validate_reconciliation_item_binding_observation
  before insert or update on private.reconciliation_item_binding_observations
  for each row
  execute function private.validate_reconciliation_item_binding_observation();

create or replace function private.validate_reconciliation_asset_aggregate_completeness()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item_id uuid;
  v_item private.reconciliation_items%rowtype;
  v_member_count integer;
  v_incomplete_count integer;
begin
  if tg_table_name = 'reconciliation_items' then
    v_item_id := new.id;
  elsif tg_op = 'DELETE' then
    v_item_id := old.reconciliation_item_id;
  else
    v_item_id := new.reconciliation_item_id;
  end if;

  select items.*
    into v_item
  from private.reconciliation_items as items
  where items.id = v_item_id;

  if not found or v_item.scope_kind <> 'ASSET_AGGREGATE' then
    return null;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where members.membership_status <> 'OBSERVED'
    )::integer
    into v_member_count, v_incomplete_count
  from private.reconciliation_item_binding_observations as members
  where members.reconciliation_item_id = v_item.id;

  if v_item.classification in ('MATCHED', 'WITHIN_TOLERANCE', 'MISMATCH')
    and (v_member_count = 0 or v_incomplete_count > 0)
  then
    raise exception 'RECONCILIATION_ASSET_MEMBERSHIP_INCOMPLETE'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function private.validate_reconciliation_asset_aggregate_completeness() is
  'Private deferred trigger validator for asset aggregate reconciliation completeness. Normal result classifications require observed provenance for every recorded member.';

revoke execute on function private.validate_reconciliation_asset_aggregate_completeness()
  from public, anon, authenticated;

create constraint trigger validate_reconciliation_asset_item_completeness
  after insert or update on private.reconciliation_items
  deferrable initially deferred
  for each row
  execute function private.validate_reconciliation_asset_aggregate_completeness();

create constraint trigger validate_reconciliation_asset_member_completeness
  after insert or update or delete
  on private.reconciliation_item_binding_observations
  deferrable initially deferred
  for each row
  execute function private.validate_reconciliation_asset_aggregate_completeness();

revoke all privileges on table private.reconciliation_item_binding_observations
  from public, anon, authenticated;
