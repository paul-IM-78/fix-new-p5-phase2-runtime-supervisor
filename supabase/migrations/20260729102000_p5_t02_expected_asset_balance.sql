create or replace function private.calculate_expected_external_balance_atomic_units(
  p_asset_id uuid
)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_asset_exists boolean;
  v_account_count integer;
  v_balance_units numeric;
begin
  if p_asset_id is null then
    raise exception 'asset_not_found'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.supported_assets as assets
    where assets.id = p_asset_id
  )
    into v_asset_exists;

  if not v_asset_exists then
    raise exception 'asset_not_found'
      using errcode = '23503';
  end if;

  select count(*)::integer
    into v_account_count
  from private.ledger_accounts as accounts
  where accounts.asset_id = p_asset_id
    and accounts.wallet_account_id is null
    and accounts.account_scope = 'SYSTEM'
    and accounts.account_class = 'ASSET'
    and accounts.account_purpose = 'SYSTEM_CUSTODY'
    and accounts.normal_side = 'DEBIT'
    and accounts.status = 'OPEN';

  if v_account_count = 0 then
    raise exception 'system_custody_account_missing'
      using errcode = '23514';
  end if;

  if v_account_count > 1 then
    raise exception 'system_custody_account_ambiguous'
      using errcode = '23514';
  end if;

  select balances.balance_units
    into v_balance_units
  from private.ledger_account_balances as balances
  join private.ledger_accounts as accounts
    on accounts.id = balances.ledger_account_id
  where accounts.asset_id = p_asset_id
    and accounts.wallet_account_id is null
    and accounts.account_scope = 'SYSTEM'
    and accounts.account_class = 'ASSET'
    and accounts.account_purpose = 'SYSTEM_CUSTODY'
    and accounts.normal_side = 'DEBIT'
    and accounts.status = 'OPEN';

  if v_balance_units is null
    or v_balance_units::text in ('NaN', 'Infinity', '-Infinity')
    or v_balance_units < 0
    or v_balance_units <> trunc(v_balance_units)
    or v_balance_units >= power(10::numeric, 38)
  then
    raise exception 'system_custody_balance_invalid'
      using errcode = '23514';
  end if;

  return v_balance_units;
end;
$$;

comment on function private.calculate_expected_external_balance_atomic_units(uuid) is
  'Private read-only expected balance function for asset aggregate custody reconciliation. It returns the exact integer Atomic Unit balance of the asset-level SYSTEM_CUSTODY account, distinguishes zero balance from missing account state, excludes liabilities and observations, and performs no writes.';

revoke execute on function private.calculate_expected_external_balance_atomic_units(uuid)
  from public, anon, authenticated;
