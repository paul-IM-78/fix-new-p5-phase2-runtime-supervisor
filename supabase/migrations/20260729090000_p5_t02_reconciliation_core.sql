create table private.external_balance_observations (
  id uuid primary key default gen_random_uuid(),

  custody_account_binding_id uuid not null
    references private.custody_account_bindings (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  observer_kind text not null,
  observation_key text not null,

  observed_units numeric not null,

  checkpoint_reference text null,

  observed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),

  constraint external_balance_observations_observer_kind_check
    check (
      observer_kind = pg_catalog.btrim(observer_kind)
      and observer_kind ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
    ),

  constraint external_balance_observations_observation_key_check
    check (
      observation_key = pg_catalog.btrim(observation_key)
      and observation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
      and observation_key !~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
    ),

  constraint external_balance_observations_units_check
    check (
      observed_units::text not in ('NaN', 'Infinity', '-Infinity')
      and observed_units >= 0
      and observed_units = trunc(observed_units)
      and observed_units::text ~ '^(0|[1-9][0-9]{0,37})$'
      and observed_units < power(10::numeric, 38)
    ),

  constraint external_balance_observations_checkpoint_reference_check
    check (
      checkpoint_reference is null
      or (
        checkpoint_reference = pg_catalog.btrim(checkpoint_reference)
        and pg_catalog.char_length(checkpoint_reference) between 1 and 200
        and checkpoint_reference !~ '[[:cntrl:]]'
        and checkpoint_reference !~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
      )
    ),

  constraint external_balance_observations_binding_observer_key_uidx
    unique (custody_account_binding_id, observer_kind, observation_key),

  constraint external_balance_observations_binding_asset_uidx
    unique (id, custody_account_binding_id, asset_id)
);

comment on table private.external_balance_observations is
  'Append-only custody balance observations. Amounts are exact non-negative integer Atomic Units; raw provider payloads, credentials, wallet addresses, and secrets are not stored.';

comment on column private.external_balance_observations.observed_units is
  'Observed external balance in non-negative integer Atomic Units; zero is allowed and fractional or JavaScript Number amounts are prohibited.';

comment on column private.external_balance_observations.checkpoint_reference is
  'Optional safe opaque checkpoint reference; it must not contain provider credentials, raw API responses, network URLs, addresses, or secrets.';

create index external_balance_observations_binding_observed_idx
  on private.external_balance_observations (
    custody_account_binding_id,
    observed_at desc,
    id desc
  );

create index external_balance_observations_asset_observed_idx
  on private.external_balance_observations (
    asset_id,
    observed_at desc,
    id desc
  );

create table private.external_transaction_observations (
  id uuid primary key default gen_random_uuid(),

  custody_account_binding_id uuid not null
    references private.custody_account_bindings (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  observer_kind text not null,
  external_event_key text not null,

  direction text not null,
  external_status text not null,
  amount_units private.positive_atomic_units not null,

  confirmation_context text null,
  finalized_at timestamptz null,

  observed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),

  constraint external_transaction_observations_observer_kind_check
    check (
      observer_kind = pg_catalog.btrim(observer_kind)
      and observer_kind ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
    ),

  constraint external_transaction_observations_event_key_check
    check (
      external_event_key = pg_catalog.btrim(external_event_key)
      and external_event_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
      and external_event_key !~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
    ),

  constraint external_transaction_observations_direction_check
    check (direction in ('INBOUND', 'OUTBOUND')),

  constraint external_transaction_observations_status_check
    check (external_status in ('PENDING_FINALITY', 'FINALIZED', 'FAILED')),

  constraint external_transaction_observations_confirmation_context_check
    check (
      confirmation_context is null
      or (
        confirmation_context = pg_catalog.btrim(confirmation_context)
        and pg_catalog.char_length(confirmation_context) between 1 and 200
        and confirmation_context !~ '[[:cntrl:]]'
        and confirmation_context !~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
      )
    ),

  constraint external_transaction_observations_finality_check
    check (
      (external_status = 'FINALIZED' and finalized_at is not null)
      or (external_status in ('PENDING_FINALITY', 'FAILED'))
    ),

  constraint external_transaction_observations_binding_event_uidx
    unique (custody_account_binding_id, observer_kind, external_event_key)
);

comment on table private.external_transaction_observations is
  'Append-only provider-neutral custody transfer observations. Direction and status follow the server custody observation contract; raw transaction payloads, credentials, wallet addresses, and signatures are not stored.';

comment on column private.external_transaction_observations.amount_units is
  'Observed transfer amount in positive integer Atomic Units using the existing private.positive_atomic_units domain.';

comment on column private.external_transaction_observations.confirmation_context is
  'Optional safe opaque finality context; it must not contain raw provider payloads, transaction signatures, addresses, URLs, or secrets.';

create index external_transaction_observations_binding_observed_idx
  on private.external_transaction_observations (
    custody_account_binding_id,
    observed_at desc,
    id desc
  );

create index external_transaction_observations_status_idx
  on private.external_transaction_observations (
    external_status,
    observed_at desc,
    id desc
  );

create table private.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),

  idempotency_key text not null unique,
  trigger_source text not null,
  status text not null default 'PENDING',

  requested_by_profile_id uuid null
    references public.profiles (id) on delete restrict,

  started_at timestamptz null,
  completed_at timestamptz null,

  failure_code text null,

  created_at timestamptz not null default clock_timestamp(),

  constraint reconciliation_runs_idempotency_key_check
    check (
      idempotency_key = pg_catalog.btrim(idempotency_key)
      and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
      and idempotency_key !~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
    ),

  constraint reconciliation_runs_trigger_source_check
    check (trigger_source in ('MANUAL', 'SYSTEM', 'SCHEDULED', 'BACKFILL')),

  constraint reconciliation_runs_status_check
    check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),

  constraint reconciliation_runs_failure_code_check
    check (
      failure_code is null
      or (
        failure_code = pg_catalog.btrim(failure_code)
        and failure_code ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
      )
    ),

  constraint reconciliation_runs_time_order_check
    check (
      completed_at is null
      or started_at is null
      or completed_at >= started_at
    ),

  constraint reconciliation_runs_status_shape_check
    check (
      (
        status = 'PENDING'
        and started_at is null
        and completed_at is null
        and failure_code is null
      )
      or (
        status = 'RUNNING'
        and started_at is not null
        and completed_at is null
        and failure_code is null
      )
      or (
        status in ('COMPLETED', 'PARTIAL')
        and started_at is not null
        and completed_at is not null
        and failure_code is null
      )
      or (
        status = 'FAILED'
        and started_at is not null
        and completed_at is not null
        and failure_code is not null
      )
    )
);

comment on table private.reconciliation_runs is
  'Private reconciliation run ledger for comparing internal expected balances with external observations. It records execution metadata only; no RPC state transition or provider network call is created here.';

comment on column private.reconciliation_runs.idempotency_key is
  'Non-secret idempotency key for exactly one reconciliation run request.';

comment on column private.reconciliation_runs.failure_code is
  'Safe failure classification for terminal FAILED runs; stack traces, tokens, URLs, and raw provider errors are prohibited.';

create index reconciliation_runs_status_created_idx
  on private.reconciliation_runs (status, created_at desc, id desc);

create table private.reconciliation_items (
  id uuid primary key default gen_random_uuid(),

  reconciliation_run_id uuid not null
    references private.reconciliation_runs (id) on delete restrict,

  custody_account_binding_id uuid not null
    references private.custody_account_bindings (id) on delete restrict,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  external_balance_observation_id uuid null,

  expected_units numeric not null,
  observed_units numeric null,
  difference_units numeric null,
  tolerance_units numeric not null default 0,

  classification text not null,

  created_at timestamptz not null default clock_timestamp(),

  constraint reconciliation_items_balance_observation_fk
    foreign key (
      external_balance_observation_id,
      custody_account_binding_id,
      asset_id
    )
    references private.external_balance_observations (
      id,
      custody_account_binding_id,
      asset_id
    ) on delete restrict,

  constraint reconciliation_items_run_binding_asset_uidx
    unique (reconciliation_run_id, custody_account_binding_id, asset_id),

  constraint reconciliation_items_classification_check
    check (
      classification in (
        'MATCHED',
        'WITHIN_TOLERANCE',
        'MISMATCH',
        'OBSERVATION_FAILED',
        'REVIEW_REQUIRED'
      )
    ),

  constraint reconciliation_items_expected_units_check
    check (
      expected_units::text not in ('NaN', 'Infinity', '-Infinity')
      and expected_units >= 0
      and expected_units = trunc(expected_units)
      and expected_units::text ~ '^(0|[1-9][0-9]{0,37})$'
      and expected_units < power(10::numeric, 38)
    ),

  constraint reconciliation_items_observed_units_check
    check (
      observed_units is null
      or (
        observed_units::text not in ('NaN', 'Infinity', '-Infinity')
        and observed_units >= 0
        and observed_units = trunc(observed_units)
        and observed_units::text ~ '^(0|[1-9][0-9]{0,37})$'
        and observed_units < power(10::numeric, 38)
      )
    ),

  constraint reconciliation_items_difference_units_check
    check (
      difference_units is null
      or (
        difference_units::text not in ('NaN', 'Infinity', '-Infinity')
        and difference_units = trunc(difference_units)
        and difference_units::text ~ '^-?(0|[1-9][0-9]{0,37})$'
        and abs(difference_units) < power(10::numeric, 38)
      )
    ),

  constraint reconciliation_items_tolerance_units_check
    check (
      tolerance_units::text not in ('NaN', 'Infinity', '-Infinity')
      and tolerance_units >= 0
      and tolerance_units = trunc(tolerance_units)
      and tolerance_units::text ~ '^(0|[1-9][0-9]{0,37})$'
      and tolerance_units < power(10::numeric, 38)
    ),

  constraint reconciliation_items_observation_shape_check
    check (
      (
        classification = 'OBSERVATION_FAILED'
        and external_balance_observation_id is null
        and observed_units is null
        and difference_units is null
      )
      or (
        classification <> 'OBSERVATION_FAILED'
        and external_balance_observation_id is not null
        and observed_units is not null
        and difference_units is not null
      )
    ),

  constraint reconciliation_items_difference_calculation_check
    check (
      difference_units is null
      or difference_units = observed_units - expected_units
    ),

  constraint reconciliation_items_matched_check
    check (
      classification <> 'MATCHED'
      or difference_units = 0
    ),

  constraint reconciliation_items_within_tolerance_check
    check (
      classification <> 'WITHIN_TOLERANCE'
      or (
        difference_units <> 0
        and abs(difference_units) <= tolerance_units
      )
    ),

  constraint reconciliation_items_mismatch_check
    check (
      classification <> 'MISMATCH'
      or abs(difference_units) > tolerance_units
    )
);

comment on table private.reconciliation_items is
  'Private reconciliation comparison items. Expected and observed values are non-negative integer Atomic Units, differences are signed integer Atomic Units, and no resolution workflow is stored in this task.';

comment on column private.reconciliation_items.expected_units is
  'Internal expected balance in non-negative integer Atomic Units.';

comment on column private.reconciliation_items.observed_units is
  'External observed balance in non-negative integer Atomic Units when observation succeeded.';

comment on column private.reconciliation_items.difference_units is
  'Signed integer Atomic Unit difference calculated as observed_units minus expected_units when both values are present.';

create index reconciliation_items_run_idx
  on private.reconciliation_items (reconciliation_run_id, id);

create index reconciliation_items_classification_idx
  on private.reconciliation_items (classification, created_at desc, id desc);

create index reconciliation_items_binding_asset_idx
  on private.reconciliation_items (
    custody_account_binding_id,
    asset_id,
    created_at desc,
    id desc
  );

create table private.observer_checkpoints (
  id uuid primary key default gen_random_uuid(),

  custody_account_binding_id uuid not null
    references private.custody_account_bindings (id) on delete restrict,

  observer_kind text not null,
  checkpoint_value text not null,
  checkpoint_observed_at timestamptz not null,

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint observer_checkpoints_observer_kind_check
    check (
      observer_kind = pg_catalog.btrim(observer_kind)
      and observer_kind ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
    ),

  constraint observer_checkpoints_checkpoint_value_check
    check (
      checkpoint_value = pg_catalog.btrim(checkpoint_value)
      and pg_catalog.char_length(checkpoint_value) between 1 and 512
      and checkpoint_value !~ '[[:cntrl:]]'
      and checkpoint_value !~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|password|cookie|jwt|signature|address|https?://|rpc)'
    ),

  constraint observer_checkpoints_version_check
    check (version >= 1),

  constraint observer_checkpoints_binding_kind_uidx
    unique (custody_account_binding_id, observer_kind)
);

comment on table private.observer_checkpoints is
  'Private observer checkpoint cursor state by custody binding and observer kind. The cursor is opaque, non-secret, and never stores raw provider API responses.';

comment on column private.observer_checkpoints.checkpoint_value is
  'Safe opaque cursor value; credentials, tokens, URLs, wallet addresses, signatures, and raw provider payloads are prohibited.';

create index observer_checkpoints_observed_idx
  on private.observer_checkpoints (
    checkpoint_observed_at desc,
    id desc
  );

revoke all privileges on table private.external_balance_observations
  from public, anon, authenticated;

revoke all privileges on table private.external_transaction_observations
  from public, anon, authenticated;

revoke all privileges on table private.reconciliation_runs
  from public, anon, authenticated;

revoke all privileges on table private.reconciliation_items
  from public, anon, authenticated;

revoke all privileges on table private.observer_checkpoints
  from public, anon, authenticated;
