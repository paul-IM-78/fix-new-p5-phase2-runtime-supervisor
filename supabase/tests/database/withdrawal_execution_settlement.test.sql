begin;

create extension if not exists pgtap with schema extensions;

select * from extensions.no_plan();

create function pg_temp.insert_auth_user(
  test_user_id uuid,
  test_email text
)
returns void
language sql
as $$
  insert into auth.users (
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    test_user_id,
    'authenticated',
    'authenticated',
    test_email,
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );
$$;

create function pg_temp.set_auth_context(
  test_user_id uuid,
  test_aal text default 'aal2'
)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', test_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', test_user_id::text, 'aal', test_aal)::text,
    true
  );
end;
$$;

select extensions.has_table(
  'private',
  'withdrawal_execution_attempts',
  'withdrawal execution attempt table exists'
);

select extensions.ok(
  exists (
    select 1
    from pg_extension as extensions
    join pg_namespace as namespaces
      on namespaces.oid = extensions.extnamespace
    where extensions.extname = 'pgcrypto'
      and namespaces.nspname = 'extensions'
  ),
  'pgcrypto is installed in the extensions schema'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'withdrawal_execution_attempts'
      and column_name in (
        'id',
        'withdrawal_request_id',
        'attempt_no',
        'status',
        'evidence_reference_sha256',
        'started_by',
        'completed_by',
        'settlement_journal_id',
        'failure_code',
        'failure_reason',
        'started_at',
        'completed_at',
        'version',
        'created_at',
        'updated_at'
      )
    group by table_schema, table_name
    having count(*) = 15
  ),
  'withdrawal execution attempt safe columns exist'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema in ('private', 'public')
      and table_name in ('withdrawal_execution_attempts', 'withdrawal_requests', 'withdrawal_command_audit_events')
      and lower(column_name) in (
        'raw_evidence',
        'provider_response',
        'webhook_payload',
        'scanner_payload',
        'destination_address',
        'withdrawal_address',
        'wallet_address',
        'transaction_id',
        'transaction_hash',
        'signature',
        'private_key',
        'mnemonic'
      )
  ),
  'withdrawal execution schema excludes raw evidence and blockchain identifier columns'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'private.withdrawal_execution_attempts'::regclass
      and conname in (
        'withdrawal_execution_attempts_attempt_no_check',
        'withdrawal_execution_attempts_status_check',
        'withdrawal_execution_attempts_evidence_digest_check',
        'withdrawal_execution_attempts_failure_code_check',
        'withdrawal_execution_attempts_failure_reason_check',
        'withdrawal_execution_attempts_status_shape_check'
      )
    group by conrelid
    having count(*) = 6
  ),
  'withdrawal execution attempt constraints exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'withdrawal_execution_attempts'
      and indexname in (
        'withdrawal_execution_attempts_request_attempt_no_uidx',
        'withdrawal_execution_attempts_evidence_digest_uidx',
        'withdrawal_execution_attempts_active_uidx'
      )
    group by schemaname, tablename
    having count(*) = 3
  ),
  'withdrawal execution attempt uniqueness indexes exist'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.withdrawal_execution_attempts'::regclass
      and tgname in (
        'touch_withdrawal_execution_attempts_version',
        'validate_withdrawal_execution_attempt_transition',
        'protect_withdrawal_execution_attempts'
      )
      and not tgisinternal
    group by tgrelid
    having count(*) = 3
  ),
  'withdrawal execution attempt version, transition, and immutability triggers exist'
);

select extensions.ok(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'start_user_payout_execution',
        'fail_user_payout_execution',
        'settle_user_payout_execution',
        'list_withdrawal_execution_attempts'
      )
  ) = 4,
  'withdrawal execution command and read RPCs exist'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'start_user_payout_execution',
        'fail_user_payout_execution',
        'settle_user_payout_execution',
        'list_withdrawal_execution_attempts'
      )
      and (
        not prosecdef
        or coalesce(array_to_string(proconfig, ','), '') not like '%search_path=""%'
      )
  ),
  'withdrawal execution public RPCs are security definer with empty search_path'
);

select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.start_user_payout_execution(uuid, bigint, uuid, text, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.fail_user_payout_execution(uuid, bigint, uuid, bigint, uuid, text, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.settle_user_payout_execution(uuid, bigint, uuid, bigint, uuid, text)'::regprocedure,
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_withdrawal_execution_attempts(integer, uuid)'::regprocedure,
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.start_user_payout_execution(uuid, bigint, uuid, text, text)'::regprocedure,
    'execute'
  ),
  'authenticated can execute withdrawal execution RPCs and anon cannot'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'private.withdrawal_execution_attempts', 'select')
    and not has_table_privilege('authenticated', 'private.withdrawal_execution_attempts', 'insert')
    and not has_table_privilege('authenticated', 'private.withdrawal_execution_attempts', 'update')
    and not has_table_privilege('authenticated', 'private.withdrawal_execution_attempts', 'delete'),
  'browser roles cannot access private withdrawal execution attempts directly'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000120001',
  'withdrawal-execution-admin@example.test'
);

select pg_temp.insert_auth_user(
  '00000000-0000-4000-8000-000000120002',
  'withdrawal-execution-user@example.test'
);

insert into public.user_roles (user_id, role, grant_reason)
values (
  '00000000-0000-4000-8000-000000120001',
  'ADMIN',
  'withdrawal execution settlement test admin'
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
  '00000000-0000-4000-8000-000000120101',
  'WITHDRAWAL_EXEC_TEST',
  'WEX',
  'Withdrawal Execution Test Asset',
  'SPL_TOKEN',
  6,
  '11111111111111111111111111111161',
  'ACTIVE'
);

create temporary table pg_temp.execution_fixture as
select
  wallet_accounts.id as wallet_id,
  wallet_accounts.user_id,
  wallet_accounts.version as wallet_version,
  supported_assets.id as asset_id,
  supported_assets.version as asset_version
from public.wallet_accounts
cross join public.supported_assets
where wallet_accounts.user_id = '00000000-0000-4000-8000-000000120002'
  and supported_assets.id = '00000000-0000-4000-8000-000000120101';

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000120001');

create temporary table pg_temp.execution_opening_result as
select *
from public.post_opening_balance(
  (select wallet_id from pg_temp.execution_fixture),
  (select wallet_version from pg_temp.execution_fixture),
  (select asset_id from pg_temp.execution_fixture),
  (select asset_version from pg_temp.execution_fixture),
  '1000',
  '00000000-0000-4000-8000-000000120201',
  'withdrawal execution opening balance'
);

select extensions.is(
  (select result_code from pg_temp.execution_opening_result),
  'APPLIED',
  'opening balance fixture is applied'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000120002');

create temporary table pg_temp.execution_request_result as
select *
from public.create_user_payout_request(
  (select wallet_id from pg_temp.execution_fixture),
  (select wallet_version from pg_temp.execution_fixture),
  (select asset_id from pg_temp.execution_fixture),
  (select asset_version from pg_temp.execution_fixture),
  '300',
  '00000000-0000-4000-8000-000000120301'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000120001');

create temporary table pg_temp.execution_reserve_result as
select *
from public.reserve_user_payout_request(
  (select withdrawal_request_id from pg_temp.execution_request_result),
  (select request_version from pg_temp.execution_request_result),
  '00000000-0000-4000-8000-000000120302',
  'reserve before local execution'
);

create temporary table pg_temp.execution_approve_result as
select *
from public.approve_user_payout_request(
  (select withdrawal_request_id from pg_temp.execution_reserve_result),
  (select request_version from pg_temp.execution_reserve_result),
  '00000000-0000-4000-8000-000000120303',
  'approve before local execution'
);

create temporary table pg_temp.execution_start_result as
select *
from public.start_user_payout_execution(
  (select withdrawal_request_id from pg_temp.execution_approve_result),
  (select request_version from pg_temp.execution_approve_result),
  '00000000-0000-4000-8000-000000120304',
  'start local execution attempt',
  'QA-REF-START-0001'
);

select extensions.ok(
  (select result_code from pg_temp.execution_start_result) = 'APPLIED'
    and (select status from pg_temp.execution_start_result) = 'EXECUTING'
    and (select execution_attempt_id from pg_temp.execution_start_result) is not null,
  'approved withdrawal starts execution without a ledger posting'
);

select extensions.ok(
  exists (
    select 1
    from private.withdrawal_execution_attempts
    where id = (select execution_attempt_id from pg_temp.execution_start_result)
      and withdrawal_request_id = (select withdrawal_request_id from pg_temp.execution_start_result)
      and attempt_no = 1
      and status = 'STARTED'
      and evidence_reference_sha256 ~ '^[0-9a-f]{64}$'
  ),
  'execution attempt stores only a lowercase sha256 evidence reference digest'
);

select extensions.ok(
  not exists (
    select 1
    from private.withdrawal_execution_attempts
    where evidence_reference_sha256 like '%QA-REF-START-0001%'
  )
  and not exists (
    select 1
    from private.withdrawal_command_audit_events
    where request_data::text like '%QA-REF-START-0001%'
  ),
  'raw external evidence reference is not stored in attempts or audit request data'
);

select extensions.is(
  (
    select result_code
    from public.start_user_payout_execution(
      (select withdrawal_request_id from pg_temp.execution_start_result),
      (select request_version from pg_temp.execution_start_result),
      '00000000-0000-4000-8000-000000120305',
      'duplicate local execution reference',
      'QA-REF-START-0001'
    )
  ),
  'WITHDRAWAL_EVIDENCE_REFERENCE_CONFLICT',
  'same evidence reference with a different command is blocked'
);

create temporary table pg_temp.execution_fail_result as
select *
from public.fail_user_payout_execution(
  (select withdrawal_request_id from pg_temp.execution_start_result),
  (select request_version from pg_temp.execution_start_result),
  (select execution_attempt_id from pg_temp.execution_start_result),
  (select attempt_version from pg_temp.execution_start_result),
  '00000000-0000-4000-8000-000000120306',
  'LOCAL_REVIEW_FAILED',
  'mark local execution attempt failed'
);

select extensions.ok(
  (select result_code from pg_temp.execution_fail_result) = 'APPLIED'
    and (select status from pg_temp.execution_fail_result) = 'FAILED'
    and (select journal_id from pg_temp.execution_fail_result) is null,
  'execution failure records failed state without posting a ledger journal'
);

select extensions.is(
  (
    select balance_units::text
    from private.ledger_account_balances
    where asset_id = (select asset_id from pg_temp.execution_fixture)
      and account_scope = 'SYSTEM'
      and account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
  ),
  '-300',
  'failed execution leaves withdrawal clearing exposure unchanged'
);

select extensions.is(
  (
    select balance_units::text
    from private.ledger_account_balances
    where asset_id = (select asset_id from pg_temp.execution_fixture)
      and account_scope = 'SYSTEM'
      and account_purpose = 'SYSTEM_CUSTODY'
  ),
  '1000',
  'failed execution leaves custody unchanged'
);

create temporary table pg_temp.execution_retry_start_result as
select *
from public.start_user_payout_execution(
  (select withdrawal_request_id from pg_temp.execution_fail_result),
  (select request_version from pg_temp.execution_fail_result),
  '00000000-0000-4000-8000-000000120307',
  'retry local execution attempt',
  'QA-REF-RETRY-0001'
);

select extensions.ok(
  (select result_code from pg_temp.execution_retry_start_result) = 'APPLIED'
    and (select status from pg_temp.execution_retry_start_result) = 'EXECUTING'
    and exists (
      select 1
      from private.withdrawal_execution_attempts
      where id = (select execution_attempt_id from pg_temp.execution_retry_start_result)
        and attempt_no = 2
        and status = 'STARTED'
    ),
  'failed withdrawal can retry with a new execution attempt'
);

create temporary table pg_temp.execution_settle_result as
select *
from public.settle_user_payout_execution(
  (select withdrawal_request_id from pg_temp.execution_retry_start_result),
  (select request_version from pg_temp.execution_retry_start_result),
  (select execution_attempt_id from pg_temp.execution_retry_start_result),
  (select attempt_version from pg_temp.execution_retry_start_result),
  '00000000-0000-4000-8000-000000120308',
  'settle local execution attempt internally'
);

select extensions.ok(
  (select result_code from pg_temp.execution_settle_result) = 'APPLIED'
    and (select status from pg_temp.execution_settle_result) = 'SETTLED'
    and (select journal_id from pg_temp.execution_settle_result) is not null,
  'executing withdrawal settles with a local ledger journal'
);

select extensions.ok(
  exists (
    select 1
    from private.ledger_journals as journals
    where journals.id = (select journal_id from pg_temp.execution_settle_result)
      and journals.journal_type = 'ADMIN_WITHDRAWAL_SETTLED'
      and journals.reference_type = 'WITHDRAWAL_EXECUTION_ATTEMPT'
      and journals.reference_id = (select execution_attempt_id from pg_temp.execution_settle_result)
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.execution_settle_result)
      and entries.side = 'DEBIT'
      and entries.units = 300
      and accounts.account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
  )
  and exists (
    select 1
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where entries.journal_id = (select journal_id from pg_temp.execution_settle_result)
      and entries.side = 'CREDIT'
      and entries.units = 300
      and accounts.account_purpose = 'SYSTEM_CUSTODY'
  ),
  'settlement journal debits clearing and credits custody exactly once'
);

select extensions.is(
  (
    select balance_units::text
    from private.ledger_account_balances
    where asset_id = (select asset_id from pg_temp.execution_fixture)
      and account_scope = 'SYSTEM'
      and account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
  ),
  '0',
  'settlement clears withdrawal clearing exposure'
);

select extensions.is(
  (
    select balance_units::text
    from private.ledger_account_balances
    where asset_id = (select asset_id from pg_temp.execution_fixture)
      and account_scope = 'SYSTEM'
      and account_purpose = 'SYSTEM_CUSTODY'
  ),
  '700',
  'settlement reduces system custody'
);

select extensions.is(
  (
    select result_code
    from public.admin_cancel_user_payout_request(
      (select withdrawal_request_id from pg_temp.execution_settle_result),
      (select request_version from pg_temp.execution_settle_result),
      '00000000-0000-4000-8000-000000120309',
      'settled withdrawal cannot cancel'
    )
  ),
  'WITHDRAWAL_REQUEST_NOT_CANCELABLE',
  'settled withdrawal cannot be canceled'
);

select extensions.ok(
  (select result_code from public.settle_user_payout_execution(
    (select withdrawal_request_id from pg_temp.execution_settle_result),
    (select request_version from pg_temp.execution_retry_start_result),
    (select execution_attempt_id from pg_temp.execution_settle_result),
    (select attempt_version from pg_temp.execution_retry_start_result),
    '00000000-0000-4000-8000-000000120308',
    'settle local execution attempt internally'
  )) = 'APPLIED'
    and (select replayed from public.settle_user_payout_execution(
      (select withdrawal_request_id from pg_temp.execution_settle_result),
      (select request_version from pg_temp.execution_retry_start_result),
      (select execution_attempt_id from pg_temp.execution_settle_result),
      (select attempt_version from pg_temp.execution_retry_start_result),
      '00000000-0000-4000-8000-000000120308',
      'settle local execution attempt internally'
    )),
  'settlement command replay returns the existing immutable result'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000120002');

create temporary table pg_temp.failed_cancel_request_result as
select *
from public.create_user_payout_request(
  (select wallet_id from pg_temp.execution_fixture),
  (select wallet_version from pg_temp.execution_fixture),
  (select asset_id from pg_temp.execution_fixture),
  (select asset_version from pg_temp.execution_fixture),
  '200',
  '00000000-0000-4000-8000-000000120310'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000120001');

create temporary table pg_temp.failed_cancel_reserve_result as
select *
from public.reserve_user_payout_request(
  (select withdrawal_request_id from pg_temp.failed_cancel_request_result),
  (select request_version from pg_temp.failed_cancel_request_result),
  '00000000-0000-4000-8000-000000120311',
  'reserve failed cancel fixture'
);

create temporary table pg_temp.failed_cancel_approve_result as
select *
from public.approve_user_payout_request(
  (select withdrawal_request_id from pg_temp.failed_cancel_reserve_result),
  (select request_version from pg_temp.failed_cancel_reserve_result),
  '00000000-0000-4000-8000-000000120312',
  'approve failed cancel fixture'
);

create temporary table pg_temp.failed_cancel_start_result as
select *
from public.start_user_payout_execution(
  (select withdrawal_request_id from pg_temp.failed_cancel_approve_result),
  (select request_version from pg_temp.failed_cancel_approve_result),
  '00000000-0000-4000-8000-000000120313',
  'start failed cancel fixture',
  'QA-REF-CANCEL-0001'
);

create temporary table pg_temp.failed_cancel_fail_result as
select *
from public.fail_user_payout_execution(
  (select withdrawal_request_id from pg_temp.failed_cancel_start_result),
  (select request_version from pg_temp.failed_cancel_start_result),
  (select execution_attempt_id from pg_temp.failed_cancel_start_result),
  (select attempt_version from pg_temp.failed_cancel_start_result),
  '00000000-0000-4000-8000-000000120314',
  'LOCAL_OPERATOR_ABORT',
  'local operator aborted execution'
);

create temporary table pg_temp.failed_cancel_result as
select *
from public.admin_cancel_user_payout_request(
  (select withdrawal_request_id from pg_temp.failed_cancel_fail_result),
  (select request_version from pg_temp.failed_cancel_fail_result),
  '00000000-0000-4000-8000-000000120315',
  'cancel failed local execution'
);

select extensions.ok(
  (select result_code from pg_temp.failed_cancel_result) = 'APPLIED'
    and (select status from pg_temp.failed_cancel_result) = 'CANCELED'
    and (select journal_id from pg_temp.failed_cancel_result) is not null,
  'failed execution can be canceled with a clearing reversal'
);

select extensions.is(
  (
    select available_units::text || ',' || pending_withdrawal_units::text || ',' || total_liability_units::text
    from private.wallet_asset_ledger_balances
    where wallet_account_id = (select wallet_id from pg_temp.execution_fixture)
      and asset_id = (select asset_id from pg_temp.execution_fixture)
  ),
  '700,0,700',
  'failed cancel restores available units after the settled withdrawal'
);

select extensions.is(
  (
    select balance_units::text
    from private.ledger_account_balances
    where asset_id = (select asset_id from pg_temp.execution_fixture)
      and account_scope = 'SYSTEM'
      and account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
  ),
  '0',
  'failed cancel clears the second withdrawal clearing exposure'
);

select extensions.is(
  (
    select result_code
    from public.start_user_payout_execution(
      (select withdrawal_request_id from pg_temp.execution_settle_result),
      (select request_version from pg_temp.execution_settle_result),
      '00000000-0000-4000-8000-000000120316',
      'invalid reference attempt',
      'bad ref'
    )
  ),
  'INVALID_INPUT',
  'invalid evidence reference is rejected before state mutation'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000120001', 'aal1');

select extensions.throws_ok(
  $$select * from public.start_user_payout_execution(
      (select withdrawal_request_id from pg_temp.execution_settle_result),
      (select request_version from pg_temp.execution_settle_result),
      '00000000-0000-4000-8000-000000120317',
      'aal1 blocked',
      'QA-REF-AAL1-0001'
    )$$,
  '42501',
  null,
  'AAL1 admin cannot start withdrawal execution'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000120001');

select extensions.throws_ok(
  $$update private.withdrawal_execution_attempts
    set evidence_reference_sha256 = repeat('a', 64)
    where id = (select execution_attempt_id from pg_temp.execution_settle_result)$$,
  '23514',
  null,
  'execution attempt evidence digest cannot be rewritten'
);

select extensions.throws_ok(
  $$delete from private.withdrawal_execution_attempts
    where id = (select execution_attempt_id from pg_temp.execution_settle_result)$$,
  '55000',
  'WITHDRAWAL_EXECUTION_ATTEMPT_IMMUTABLE',
  'execution attempt delete is blocked'
);

select extensions.ok(
  (select count(*) from public.list_withdrawal_execution_attempts(100, null)) >= 3
    and not exists (
      select 1
      from public.list_withdrawal_execution_attempts(100, null) as attempts
      where to_jsonb(attempts) ? 'evidence_reference_sha256'
        or to_jsonb(attempts) ? 'raw_evidence'
    ),
  'admin execution attempt read RPC excludes evidence digests and raw evidence'
);

select extensions.ok(
  (select count(*) from public.list_admin_withdrawal_requests(100, null) where status in ('SETTLED', 'CANCELED')) >= 2
    and (select count(*) from public.list_withdrawal_command_audit_events(100, null) where execution_attempt_id is not null) >= 4,
  'admin withdrawal read RPCs expose safe execution state and audit links'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000120002');

select extensions.ok(
  (select count(*) from public.list_current_user_withdrawal_requests(100) where status in ('SETTLED', 'CANCELED')) >= 2
    and not exists (
      select 1
      from public.list_current_user_withdrawal_requests(100) as requests
      where to_jsonb(requests)::text like '%QA-REF-%'
    ),
  'user withdrawal read RPC returns safe execution statuses without raw evidence'
);

select pg_temp.set_auth_context('00000000-0000-4000-8000-000000120001');

select extensions.throws_ok(
  $$set local role authenticated; select count(*) from private.withdrawal_execution_attempts$$,
  '42501',
  null,
  'authenticated cannot directly read withdrawal execution attempt table'
);

select extensions.ok(
  obj_description('private.withdrawal_execution_attempts'::regclass, 'pg_class') is not null
    and obj_description('public.start_user_payout_execution(uuid, bigint, uuid, text, text)'::regprocedure, 'pg_proc') is not null
    and obj_description('public.settle_user_payout_execution(uuid, bigint, uuid, bigint, uuid, text)'::regprocedure, 'pg_proc') is not null,
  'withdrawal execution settlement objects are documented'
);

select * from extensions.finish();

rollback;
