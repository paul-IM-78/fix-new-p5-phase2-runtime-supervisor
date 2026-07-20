create domain private.positive_atomic_units as numeric
  constraint positive_atomic_units_check
  check (
    value is not null
    and value::text not in ('NaN', 'Infinity', '-Infinity')
    and value > 0
    and value::text ~ '^[1-9][0-9]{0,37}$'
    and value = trunc(value)
    and value < power(10::numeric, 38)
  );

comment on domain private.positive_atomic_units is
  'Atomic Unit exact numeric domain for double-entry ledger posting. Values are positive integer strings at boundaries; JavaScript Number and fractional financial amounts are prohibited.';

create table private.ledger_accounts (
  id uuid primary key default gen_random_uuid(),

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  wallet_account_id uuid null
    references public.wallet_accounts (id) on delete restrict,

  account_scope text not null,
  account_class text not null,
  account_purpose text not null,
  normal_side text not null,

  status text not null default 'OPEN',

  version bigint not null default 1,

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint ledger_accounts_scope_check
    check (account_scope in ('USER', 'SYSTEM')),

  constraint ledger_accounts_class_check
    check (account_class in ('ASSET', 'LIABILITY', 'EQUITY', 'EXPENSE', 'CLEARING')),

  constraint ledger_accounts_normal_side_check
    check (normal_side in ('DEBIT', 'CREDIT')),

  constraint ledger_accounts_status_check
    check (status in ('OPEN', 'CLOSED')),

  constraint ledger_accounts_version_check
    check (version >= 1),

  constraint ledger_accounts_mapping_check
    check (
      (
        account_scope = 'USER'
        and wallet_account_id is not null
        and account_class = 'LIABILITY'
        and normal_side = 'CREDIT'
        and account_purpose in (
          'USER_AVAILABLE',
          'USER_LOCKED',
          'USER_PENDING_DEPOSIT',
          'USER_PENDING_WITHDRAWAL'
        )
      )
      or (
        account_scope = 'SYSTEM'
        and wallet_account_id is null
        and (
          (
            account_purpose = 'SYSTEM_CUSTODY'
            and account_class = 'ASSET'
            and normal_side = 'DEBIT'
          )
          or (
            account_purpose = 'SYSTEM_DEPOSIT_CLEARING'
            and account_class = 'CLEARING'
            and normal_side = 'DEBIT'
          )
          or (
            account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
            and account_class = 'CLEARING'
            and normal_side = 'DEBIT'
          )
          or (
            account_purpose = 'SYSTEM_REWARD_EXPENSE'
            and account_class = 'EXPENSE'
            and normal_side = 'DEBIT'
          )
          or (
            account_purpose = 'SYSTEM_TOKEN_ISSUANCE'
            and account_class = 'EQUITY'
            and normal_side = 'CREDIT'
          )
          or (
            account_purpose = 'SYSTEM_SUSPENSE'
            and account_class = 'CLEARING'
            and normal_side = 'DEBIT'
          )
        )
      )
    )
);

comment on table private.ledger_accounts is
  'Private double-entry ledger account catalog. User liability buckets and system accounts are exact numeric Atomic Unit containers; balances are calculated from immutable entries.';

create unique index ledger_accounts_user_purpose_uidx
  on private.ledger_accounts (wallet_account_id, asset_id, account_purpose)
  where account_scope = 'USER';

create unique index ledger_accounts_system_purpose_uidx
  on private.ledger_accounts (asset_id, account_purpose)
  where account_scope = 'SYSTEM';

create index ledger_accounts_asset_idx
  on private.ledger_accounts (asset_id);

create index ledger_accounts_wallet_idx
  on private.ledger_accounts (wallet_account_id)
  where wallet_account_id is not null;

create trigger touch_ledger_accounts_version
  before update on private.ledger_accounts
  for each row
  execute function private.touch_versioned_record();

create table private.ledger_journals (
  id uuid primary key default gen_random_uuid(),

  command_id uuid not null unique,

  asset_id uuid not null
    references public.supported_assets (id) on delete restrict,

  journal_type text not null,
  initiator_type text not null,
  initiator_user_id uuid null
    references public.profiles (id) on delete restrict,

  reference_type text null,
  reference_id uuid null,

  reason text not null,
  request_data jsonb not null,

  posted_at timestamptz not null default clock_timestamp(),

  constraint ledger_journals_journal_type_check
    check (
      journal_type = pg_catalog.btrim(journal_type)
      and journal_type ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
    ),

  constraint ledger_journals_initiator_check
    check (
      (
        initiator_type in ('USER', 'ADMIN')
        and initiator_user_id is not null
      )
      or (
        initiator_type = 'SYSTEM'
        and initiator_user_id is null
      )
    ),

  constraint ledger_journals_reference_pair_check
    check (
      (reference_type is null and reference_id is null)
      or (
        reference_type is not null
        and reference_id is not null
        and reference_type = pg_catalog.btrim(reference_type)
        and reference_type ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
      )
    ),

  constraint ledger_journals_reason_check
    check (
      reason = pg_catalog.btrim(reason)
      and pg_catalog.char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
      and reason !~* '(access_token|refresh_token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database_url|direct_database_url|secret)'
    ),

  constraint ledger_journals_request_data_check
    check (
      jsonb_typeof(request_data) = 'object'
      and request_data::text !~* '(access_token|refresh_token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database_url|direct_database_url|secret)'
    )
);

comment on table private.ledger_journals is
  'Immutable posted double-entry journal header. A command ID and canonical request enforce idempotency; there is no pending or draft journal state.';

create index ledger_journals_asset_posted_idx
  on private.ledger_journals (asset_id, posted_at desc, id desc);

create index ledger_journals_initiator_idx
  on private.ledger_journals (initiator_user_id, posted_at desc)
  where initiator_user_id is not null;

create table private.ledger_entries (
  id uuid primary key default gen_random_uuid(),

  journal_id uuid not null
    references private.ledger_journals (id) on delete restrict,

  line_no smallint not null,

  ledger_account_id uuid not null
    references private.ledger_accounts (id) on delete restrict,

  side text not null,
  units private.positive_atomic_units not null,

  created_at timestamptz not null default clock_timestamp(),

  constraint ledger_entries_side_check
    check (side in ('DEBIT', 'CREDIT')),

  constraint ledger_entries_line_no_check
    check (line_no between 1 and 32),

  constraint ledger_entries_line_no_uidx
    unique (journal_id, line_no),

  constraint ledger_entries_account_uidx
    unique (journal_id, ledger_account_id)
);

comment on table private.ledger_entries is
  'Immutable double-entry ledger lines. Units are exact Atomic Unit numerics, never JavaScript Number values, and balances are derived only from entries.';

create index ledger_entries_account_idx
  on private.ledger_entries (ledger_account_id, created_at desc);

create or replace function private.prevent_ledger_journal_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LEDGER_JOURNAL_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_ledger_journal_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE for immutable double-entry ledger journals.';

create or replace function private.prevent_ledger_entry_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LEDGER_ENTRY_IMMUTABLE'
    using errcode = '55000';
end;
$$;

comment on function private.prevent_ledger_entry_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE for immutable double-entry ledger entries.';

revoke execute on function private.prevent_ledger_journal_mutation()
  from public, anon, authenticated;

revoke execute on function private.prevent_ledger_entry_mutation()
  from public, anon, authenticated;

create trigger protect_ledger_journals
  before update or delete or truncate
  on private.ledger_journals
  for each statement
  execute function private.prevent_ledger_journal_mutation();

create trigger protect_ledger_entries
  before update or delete or truncate
  on private.ledger_entries
  for each statement
  execute function private.prevent_ledger_entry_mutation();

create view private.ledger_account_balances as
select
  accounts.id as ledger_account_id,
  accounts.asset_id,
  accounts.wallet_account_id,
  accounts.account_scope,
  accounts.account_class,
  accounts.account_purpose,
  accounts.normal_side,
  accounts.status as account_status,
  coalesce(
    sum(entries.units) filter (where entries.side = 'DEBIT'),
    0::numeric
  ) as debit_units,
  coalesce(
    sum(entries.units) filter (where entries.side = 'CREDIT'),
    0::numeric
  ) as credit_units,
  case accounts.normal_side
    when 'DEBIT' then
      coalesce(sum(entries.units) filter (where entries.side = 'DEBIT'), 0::numeric)
      - coalesce(sum(entries.units) filter (where entries.side = 'CREDIT'), 0::numeric)
    else
      coalesce(sum(entries.units) filter (where entries.side = 'CREDIT'), 0::numeric)
      - coalesce(sum(entries.units) filter (where entries.side = 'DEBIT'), 0::numeric)
  end as balance_units
from private.ledger_accounts as accounts
left join private.ledger_entries as entries
  on entries.ledger_account_id = accounts.id
group by
  accounts.id,
  accounts.asset_id,
  accounts.wallet_account_id,
  accounts.account_scope,
  accounts.account_class,
  accounts.account_purpose,
  accounts.normal_side,
  accounts.status;

comment on view private.ledger_account_balances is
  'Private exact numeric balance view calculated from immutable double-entry entries. Entryless accounts return zero and no public financial write path exists.';

create view private.wallet_asset_ledger_balances as
select
  balances.wallet_account_id,
  balances.asset_id,
  coalesce(
    sum(balances.balance_units) filter (where balances.account_purpose = 'USER_AVAILABLE'),
    0::numeric
  ) as available_units,
  coalesce(
    sum(balances.balance_units) filter (where balances.account_purpose = 'USER_LOCKED'),
    0::numeric
  ) as locked_units,
  coalesce(
    sum(balances.balance_units) filter (where balances.account_purpose = 'USER_PENDING_DEPOSIT'),
    0::numeric
  ) as pending_deposit_units,
  coalesce(
    sum(balances.balance_units) filter (where balances.account_purpose = 'USER_PENDING_WITHDRAWAL'),
    0::numeric
  ) as pending_withdrawal_units,
  coalesce(sum(balances.balance_units), 0::numeric) as total_liability_units
from private.ledger_account_balances as balances
where balances.account_scope = 'USER'
group by balances.wallet_account_id, balances.asset_id;

comment on view private.wallet_asset_ledger_balances is
  'Private wallet and asset balance buckets for managed user liabilities. Amounts are exact Atomic Units and are calculated from ledger entries only.';

create or replace function private.ensure_wallet_asset_ledger_accounts(
  target_wallet_account_id uuid,
  target_asset_id uuid
)
returns table (
  account_purpose text,
  ledger_account_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_wallet public.wallet_accounts%rowtype;
  v_asset public.supported_assets%rowtype;
  v_existing_count integer;
begin
  if target_wallet_account_id is null or target_asset_id is null then
    raise exception 'LEDGER_INVALID_INPUT'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:ledger-provisioning:v1',
      0
    )
  );

  select wallet_accounts.*
    into v_wallet
  from public.wallet_accounts as wallet_accounts
  where wallet_accounts.id = target_wallet_account_id
  for update;

  if not found then
    raise exception 'LEDGER_WALLET_NOT_FOUND'
      using errcode = '23503';
  end if;

  select assets.*
    into v_asset
  from public.supported_assets as assets
  where assets.id = target_asset_id
  for update;

  if not found then
    raise exception 'LEDGER_ASSET_NOT_FOUND'
      using errcode = '23503';
  end if;

  select count(*)::integer
    into v_existing_count
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'USER'
    and accounts.wallet_account_id = target_wallet_account_id
    and accounts.asset_id = target_asset_id
    and accounts.account_purpose in (
      'USER_AVAILABLE',
      'USER_LOCKED',
      'USER_PENDING_DEPOSIT',
      'USER_PENDING_WITHDRAWAL'
    );

  if v_existing_count < 4 and v_wallet.status = 'CLOSED' then
    raise exception 'LEDGER_WALLET_CLOSED'
      using errcode = '23514';
  end if;

  if v_existing_count < 4 and v_asset.status = 'ARCHIVED' then
    raise exception 'LEDGER_ASSET_ARCHIVED'
      using errcode = '23514';
  end if;

  insert into private.ledger_accounts (
    asset_id,
    wallet_account_id,
    account_scope,
    account_class,
    account_purpose,
    normal_side
  )
  select
    target_asset_id,
    target_wallet_account_id,
    'USER',
    'LIABILITY',
    purposes.account_purpose,
    'CREDIT'
  from (
    values
      ('USER_AVAILABLE'),
      ('USER_LOCKED'),
      ('USER_PENDING_DEPOSIT'),
      ('USER_PENDING_WITHDRAWAL')
  ) as purposes(account_purpose)
  on conflict do nothing;

  if exists (
    select 1
    from private.ledger_accounts as accounts
    where accounts.account_scope = 'USER'
      and accounts.wallet_account_id = target_wallet_account_id
      and accounts.asset_id = target_asset_id
      and accounts.account_purpose in (
        'USER_AVAILABLE',
        'USER_LOCKED',
        'USER_PENDING_DEPOSIT',
        'USER_PENDING_WITHDRAWAL'
      )
      and accounts.status <> 'OPEN'
  ) then
    raise exception 'LEDGER_ACCOUNT_CLOSED'
      using errcode = '23514';
  end if;

  return query
    select
      accounts.account_purpose,
      accounts.id
    from private.ledger_accounts as accounts
    where accounts.account_scope = 'USER'
      and accounts.wallet_account_id = target_wallet_account_id
      and accounts.asset_id = target_asset_id
      and accounts.account_purpose in (
        'USER_AVAILABLE',
        'USER_LOCKED',
        'USER_PENDING_DEPOSIT',
        'USER_PENDING_WITHDRAWAL'
      )
    order by accounts.account_purpose;
end;
$$;

comment on function private.ensure_wallet_asset_ledger_accounts(uuid, uuid) is
  'Private provisioning helper that idempotently creates the four managed user liability ledger buckets for one wallet and asset using exact Atomic Unit accounting boundaries.';

create or replace function private.ensure_system_ledger_accounts(
  target_asset_id uuid
)
returns table (
  account_purpose text,
  ledger_account_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_asset public.supported_assets%rowtype;
  v_existing_count integer;
begin
  if target_asset_id is null then
    raise exception 'LEDGER_INVALID_INPUT'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:ledger-provisioning:v1',
      0
    )
  );

  select assets.*
    into v_asset
  from public.supported_assets as assets
  where assets.id = target_asset_id
  for update;

  if not found then
    raise exception 'LEDGER_ASSET_NOT_FOUND'
      using errcode = '23503';
  end if;

  select count(*)::integer
    into v_existing_count
  from private.ledger_accounts as accounts
  where accounts.account_scope = 'SYSTEM'
    and accounts.asset_id = target_asset_id
    and accounts.account_purpose in (
      'SYSTEM_CUSTODY',
      'SYSTEM_DEPOSIT_CLEARING',
      'SYSTEM_WITHDRAWAL_CLEARING',
      'SYSTEM_REWARD_EXPENSE',
      'SYSTEM_TOKEN_ISSUANCE',
      'SYSTEM_SUSPENSE'
    );

  if v_existing_count < 6 and v_asset.status = 'ARCHIVED' then
    raise exception 'LEDGER_ASSET_ARCHIVED'
      using errcode = '23514';
  end if;

  insert into private.ledger_accounts (
    asset_id,
    wallet_account_id,
    account_scope,
    account_class,
    account_purpose,
    normal_side
  )
  select
    target_asset_id,
    null,
    'SYSTEM',
    purposes.account_class,
    purposes.account_purpose,
    purposes.normal_side
  from (
    values
      ('SYSTEM_CUSTODY', 'ASSET', 'DEBIT'),
      ('SYSTEM_DEPOSIT_CLEARING', 'CLEARING', 'DEBIT'),
      ('SYSTEM_WITHDRAWAL_CLEARING', 'CLEARING', 'DEBIT'),
      ('SYSTEM_REWARD_EXPENSE', 'EXPENSE', 'DEBIT'),
      ('SYSTEM_TOKEN_ISSUANCE', 'EQUITY', 'CREDIT'),
      ('SYSTEM_SUSPENSE', 'CLEARING', 'DEBIT')
  ) as purposes(account_purpose, account_class, normal_side)
  on conflict do nothing;

  if exists (
    select 1
    from private.ledger_accounts as accounts
    where accounts.account_scope = 'SYSTEM'
      and accounts.asset_id = target_asset_id
      and accounts.account_purpose in (
        'SYSTEM_CUSTODY',
        'SYSTEM_DEPOSIT_CLEARING',
        'SYSTEM_WITHDRAWAL_CLEARING',
        'SYSTEM_REWARD_EXPENSE',
        'SYSTEM_TOKEN_ISSUANCE',
        'SYSTEM_SUSPENSE'
      )
      and accounts.status <> 'OPEN'
  ) then
    raise exception 'LEDGER_ACCOUNT_CLOSED'
      using errcode = '23514';
  end if;

  return query
    select
      accounts.account_purpose,
      accounts.id
    from private.ledger_accounts as accounts
    where accounts.account_scope = 'SYSTEM'
      and accounts.asset_id = target_asset_id
      and accounts.account_purpose in (
        'SYSTEM_CUSTODY',
        'SYSTEM_DEPOSIT_CLEARING',
        'SYSTEM_WITHDRAWAL_CLEARING',
        'SYSTEM_REWARD_EXPENSE',
        'SYSTEM_TOKEN_ISSUANCE',
        'SYSTEM_SUSPENSE'
      )
    order by accounts.account_purpose;
end;
$$;

comment on function private.ensure_system_ledger_accounts(uuid) is
  'Private provisioning helper that idempotently creates system ledger accounts for a supported asset. No browser write or service-role application path is exposed.';

create or replace function private.post_ledger_journal(
  p_command_id uuid,
  p_asset_id uuid,
  p_journal_type text,
  p_initiator_type text,
  p_initiator_user_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_reason text,
  p_lines jsonb
)
returns table (
  journal_id uuid,
  replayed boolean,
  posted_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_journal_type text;
  v_initiator_type text;
  v_reference_type text;
  v_reason text;
  v_line jsonb;
  v_line_count integer;
  v_account_id_text text;
  v_side text;
  v_units_text text;
  v_debit_count integer;
  v_credit_count integer;
  v_debit_sum numeric;
  v_credit_sum numeric;
  v_account_count integer;
  v_existing_journal private.ledger_journals%rowtype;
  v_request_data jsonb;
  v_canonical_lines jsonb := '[]'::jsonb;
begin
  if p_command_id is null or p_asset_id is null then
    raise exception 'LEDGER_INVALID_INPUT'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.supported_assets as assets
    where assets.id = p_asset_id
  ) then
    raise exception 'LEDGER_ASSET_NOT_FOUND'
      using errcode = '23503';
  end if;

  v_journal_type := pg_catalog.btrim(p_journal_type);
  v_initiator_type := pg_catalog.btrim(p_initiator_type);
  v_reference_type := nullif(pg_catalog.btrim(p_reference_type), '');
  v_reason := pg_catalog.btrim(p_reason);

  if v_journal_type is null
    or v_journal_type !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
    or v_initiator_type not in ('USER', 'ADMIN', 'SYSTEM')
    or (
      v_initiator_type in ('USER', 'ADMIN')
      and p_initiator_user_id is null
    )
    or (
      v_initiator_type = 'SYSTEM'
      and p_initiator_user_id is not null
    )
    or (
      (v_reference_type is null) <> (p_reference_id is null)
    )
    or (
      v_reference_type is not null
      and v_reference_type !~ '^[A-Z0-9][A-Z0-9_]{1,63}$'
    )
    or v_reason is null
    or v_reason = ''
    or pg_catalog.char_length(v_reason) > 500
    or v_reason ~ '[[:cntrl:]]'
    or v_reason ~* '(access_token|refresh_token|password|cookie|jwt|private[_ ]?key|mnemonic|seed[_ ]?phrase|service[_ ]?role|database_url|direct_database_url|secret)'
  then
    raise exception 'LEDGER_INVALID_INPUT'
      using errcode = '22023';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'LEDGER_INVALID_LINES'
      using errcode = '22023';
  end if;

  v_line_count := jsonb_array_length(p_lines);

  if v_line_count < 2 or v_line_count > 32 then
    raise exception 'LEDGER_INVALID_LINES'
      using errcode = '22023';
  end if;

  for v_line in
    select elements.value
    from jsonb_array_elements(p_lines) as elements(value)
  loop
    if jsonb_typeof(v_line) <> 'object'
      or (
        select count(*)::integer
        from jsonb_object_keys(v_line)
      ) <> 3
      or not (v_line ? 'account_id')
      or not (v_line ? 'side')
      or not (v_line ? 'units')
      or jsonb_typeof(v_line -> 'account_id') <> 'string'
      or jsonb_typeof(v_line -> 'side') <> 'string'
      or jsonb_typeof(v_line -> 'units') <> 'string'
    then
      raise exception 'LEDGER_INVALID_LINE'
        using errcode = '22023';
    end if;

    v_account_id_text := v_line ->> 'account_id';
    v_side := v_line ->> 'side';
    v_units_text := v_line ->> 'units';

    if v_account_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or v_side not in ('DEBIT', 'CREDIT')
      or v_units_text !~ '^[1-9][0-9]{0,37}$'
    then
      raise exception 'LEDGER_INVALID_LINE'
        using errcode = '22023';
    end if;

    v_canonical_lines := v_canonical_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id',
        v_account_id_text::uuid::text,
        'side',
        v_side,
        'units',
        (v_units_text::numeric::private.positive_atomic_units)::text
      )
    );
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(v_canonical_lines) as lines(
      account_id text,
      side text,
      units text
    )
    group by lines.account_id
    having count(*) > 1
  ) then
    raise exception 'LEDGER_DUPLICATE_ACCOUNT'
      using errcode = '23505';
  end if;

  select
    count(*) filter (where lines.side = 'DEBIT')::integer,
    count(*) filter (where lines.side = 'CREDIT')::integer,
    coalesce(sum(lines.units::numeric) filter (where lines.side = 'DEBIT'), 0::numeric),
    coalesce(sum(lines.units::numeric) filter (where lines.side = 'CREDIT'), 0::numeric)
    into v_debit_count, v_credit_count, v_debit_sum, v_credit_sum
  from jsonb_to_recordset(v_canonical_lines) as lines(
    account_id text,
    side text,
    units text
  );

  if v_debit_count < 1
    or v_credit_count < 1
    or v_debit_sum <= 0
    or v_credit_sum <= 0
    or v_debit_sum <> v_credit_sum
  then
    raise exception 'LEDGER_UNBALANCED'
      using errcode = '23514';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'account_id', lines.account_id,
      'side', lines.side,
      'units', lines.units
    )
    order by lines.account_id
  )
    into v_canonical_lines
  from jsonb_to_recordset(v_canonical_lines) as lines(
    account_id text,
    side text,
    units text
  );

  v_request_data := jsonb_build_object(
    'asset_id', p_asset_id::text,
    'journal_type', v_journal_type,
    'initiator_type', v_initiator_type,
    'initiator_user_id', p_initiator_user_id,
    'reference_type', v_reference_type,
    'reference_id', p_reference_id,
    'reason', v_reason,
    'lines', v_canonical_lines
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'staking-wallet-web:ledger-posting:v1',
      0
    )
  );

  select journals.*
    into v_existing_journal
  from private.ledger_journals as journals
  where journals.command_id = p_command_id
  for update;

  if found then
    if v_existing_journal.asset_id = p_asset_id
      and v_existing_journal.journal_type = v_journal_type
      and v_existing_journal.initiator_type = v_initiator_type
      and v_existing_journal.initiator_user_id is not distinct from p_initiator_user_id
      and v_existing_journal.reference_type is not distinct from v_reference_type
      and v_existing_journal.reference_id is not distinct from p_reference_id
      and v_existing_journal.reason = v_reason
      and v_existing_journal.request_data = v_request_data
    then
      journal_id := v_existing_journal.id;
      replayed := true;
      posted_at := v_existing_journal.posted_at;
      return next;
      return;
    end if;

    raise exception 'LEDGER_COMMAND_ID_CONFLICT'
      using errcode = '23505';
  end if;

  select count(*)::integer
    into v_account_count
  from private.ledger_accounts as accounts
  join jsonb_to_recordset(v_canonical_lines) as lines(
    account_id text,
    side text,
    units text
  )
    on lines.account_id::uuid = accounts.id;

  if v_account_count <> v_line_count then
    raise exception 'LEDGER_ACCOUNT_NOT_FOUND'
      using errcode = '23503';
  end if;

  perform accounts.id
  from private.ledger_accounts as accounts
  join jsonb_to_recordset(v_canonical_lines) as lines(
    account_id text,
    side text,
    units text
  )
    on lines.account_id::uuid = accounts.id
  order by accounts.id
  for update of accounts;

  if exists (
    select 1
  from private.ledger_accounts as accounts
    join jsonb_to_recordset(v_canonical_lines) as lines(
      account_id text,
      side text,
      units text
    )
      on lines.account_id::uuid = accounts.id
    where accounts.status <> 'OPEN'
  ) then
    raise exception 'LEDGER_ACCOUNT_CLOSED'
      using errcode = '23514';
  end if;

  if exists (
    select 1
  from private.ledger_accounts as accounts
    join jsonb_to_recordset(v_canonical_lines) as lines(
      account_id text,
      side text,
      units text
    )
      on lines.account_id::uuid = accounts.id
    where accounts.asset_id <> p_asset_id
  ) then
    raise exception 'LEDGER_ASSET_MISMATCH'
      using errcode = '23514';
  end if;

  if exists (
    with line_deltas as (
      select
        lines.account_id::uuid as account_id,
        coalesce(sum(lines.units::numeric) filter (where lines.side = 'DEBIT'), 0::numeric) as debit_units,
        coalesce(sum(lines.units::numeric) filter (where lines.side = 'CREDIT'), 0::numeric) as credit_units
      from jsonb_to_recordset(v_canonical_lines) as lines(
        account_id text,
        side text,
        units text
      )
      group by lines.account_id
    )
    select 1
    from private.ledger_accounts as accounts
    join private.ledger_account_balances as balances
      on balances.ledger_account_id = accounts.id
    join line_deltas as deltas
      on deltas.account_id = accounts.id
    where accounts.account_scope = 'USER'
      and (
        case accounts.normal_side
          when 'DEBIT' then
            balances.balance_units + deltas.debit_units - deltas.credit_units
          else
            balances.balance_units + deltas.credit_units - deltas.debit_units
        end
      ) < 0
  ) then
    raise exception 'LEDGER_INSUFFICIENT_BALANCE'
      using errcode = '23514';
  end if;

  insert into private.ledger_journals as inserted_journals (
    command_id,
    asset_id,
    journal_type,
    initiator_type,
    initiator_user_id,
    reference_type,
    reference_id,
    reason,
    request_data
  )
  values (
    p_command_id,
    p_asset_id,
    v_journal_type,
    v_initiator_type,
    p_initiator_user_id,
    v_reference_type,
    p_reference_id,
    v_reason,
    v_request_data
  )
  returning inserted_journals.id, inserted_journals.posted_at
    into journal_id, posted_at;

  insert into private.ledger_entries (
    journal_id,
    line_no,
    ledger_account_id,
    side,
    units
  )
  select
    journal_id,
    row_number() over (order by lines.account_id)::smallint,
    lines.account_id::uuid,
    lines.side,
    lines.units::numeric::private.positive_atomic_units
  from jsonb_to_recordset(v_canonical_lines) as lines(
    account_id text,
    side text,
    units text
  )
  order by lines.account_id;

  replayed := false;
  return next;
end;
$$;

comment on function private.post_ledger_journal(uuid, uuid, text, text, uuid, text, uuid, text, jsonb) is
  'Private Posting Primitive for immutable single-asset double-entry journals. Amounts must be Atomic Unit strings; command ID idempotency, canonical lines, advisory lock, account row locks, and user liability non-negative checks are enforced.';

create or replace function private.validate_ledger_journal_invariants()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_journal_id uuid;
  v_entry_count integer;
  v_account_count integer;
  v_debit_count integer;
  v_credit_count integer;
  v_debit_sum numeric;
  v_credit_sum numeric;
begin
  if tg_table_name = 'ledger_journals' then
    v_journal_id := new.id;
  else
    v_journal_id := new.journal_id;
  end if;

  if not exists (
    select 1
    from private.ledger_journals as journals
    where journals.id = v_journal_id
  ) then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  select
    count(*)::integer,
    count(distinct entries.ledger_account_id)::integer,
    count(*) filter (where entries.side = 'DEBIT')::integer,
    count(*) filter (where entries.side = 'CREDIT')::integer,
    coalesce(sum(entries.units) filter (where entries.side = 'DEBIT'), 0::numeric),
    coalesce(sum(entries.units) filter (where entries.side = 'CREDIT'), 0::numeric)
    into
      v_entry_count,
      v_account_count,
      v_debit_count,
      v_credit_count,
      v_debit_sum,
      v_credit_sum
  from private.ledger_entries as entries
  where entries.journal_id = v_journal_id;

  if v_entry_count < 2
    or v_account_count < 2
    or v_debit_count < 1
    or v_credit_count < 1
    or v_debit_sum <= 0
    or v_credit_sum <= 0
    or v_debit_sum <> v_credit_sum
  then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    join private.ledger_journals as journals
      on journals.id = entries.journal_id
    where entries.journal_id = v_journal_id
      and (
        accounts.status <> 'OPEN'
        or accounts.asset_id <> journals.asset_id
        or entries.units <= 0
        or entries.units <> trunc(entries.units)
        or entries.units >= power(10::numeric, 38)
      )
  ) then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from private.ledger_entries as entries
    where entries.journal_id = v_journal_id
    group by entries.ledger_account_id
    having count(*) > 1
  ) then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from private.ledger_account_balances as balances
    where balances.account_scope = 'USER'
      and balances.balance_units < 0
  ) then
    raise exception 'LEDGER_INVARIANT_VIOLATION'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function private.validate_ledger_journal_invariants() is
  'Deferred database invariant validator for immutable double-entry journals and entries: at least two lines, debit equals credit, single asset, open accounts, no duplicate account, and non-negative user liabilities.';

revoke execute on function private.validate_ledger_journal_invariants()
  from public, anon, authenticated;

create constraint trigger validate_ledger_journal_after_insert
  after insert on private.ledger_journals
  deferrable initially deferred
  for each row
  execute function private.validate_ledger_journal_invariants();

create constraint trigger validate_ledger_entry_after_insert
  after insert on private.ledger_entries
  deferrable initially deferred
  for each row
  execute function private.validate_ledger_journal_invariants();

create or replace function public.list_current_user_ledger_balances()
returns table (
  asset_id uuid,
  asset_code text,
  symbol text,
  decimals smallint,
  available_units text,
  locked_units text,
  pending_deposit_units text,
  pending_withdrawal_units text,
  total_liability_units text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_wallet_account_id uuid;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception 'LEDGER_BALANCE_ACCESS_FORBIDDEN'
      using errcode = '42501';
  end if;

  select wallet_accounts.id
    into v_wallet_account_id
  from public.profiles as profiles
  join public.wallet_accounts as wallet_accounts
    on wallet_accounts.user_id = profiles.id
  where profiles.id = v_user_id
    and profiles.account_status = 'ACTIVE';

  if not found then
    raise exception 'LEDGER_BALANCE_ACCESS_FORBIDDEN'
      using errcode = '42501';
  end if;

  return query
    select
      balances.asset_id,
      assets.asset_code,
      assets.symbol,
      assets.decimals,
      balances.available_units::text,
      balances.locked_units::text,
      balances.pending_deposit_units::text,
      balances.pending_withdrawal_units::text,
      balances.total_liability_units::text
    from private.wallet_asset_ledger_balances as balances
    join public.supported_assets as assets
      on assets.id = balances.asset_id
    where balances.wallet_account_id = v_wallet_account_id
    order by assets.asset_code, balances.asset_id;
end;
$$;

comment on function public.list_current_user_ledger_balances() is
  'Authenticated read-only current user balance RPC. It returns text Atomic Unit buckets calculated from private double-entry entries and exposes no ledger account IDs, journal rows, credentials, or public financial write path.';

revoke all privileges on table private.ledger_accounts
  from public, anon, authenticated;

revoke all privileges on table private.ledger_journals
  from public, anon, authenticated;

revoke all privileges on table private.ledger_entries
  from public, anon, authenticated;

revoke all privileges on table private.ledger_account_balances
  from public, anon, authenticated;

revoke all privileges on table private.wallet_asset_ledger_balances
  from public, anon, authenticated;

revoke execute on function private.ensure_wallet_asset_ledger_accounts(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function private.ensure_system_ledger_accounts(uuid)
  from public, anon, authenticated;

revoke execute on function private.post_ledger_journal(uuid, uuid, text, text, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;

revoke execute on function public.list_current_user_ledger_balances()
  from public, anon, authenticated;

grant execute on function public.list_current_user_ledger_balances()
  to authenticated;
