# NEW-P5-T04-02 Scope Discovery DB Report

## Status

P5-T04-02 implements the custody balance observer scope discovery database
boundary only. No TypeScript scope client, orchestrator, runtime harness,
package, generated type, staging, commit, push, remote branch, or PR change was
made.

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_SCOPE_DISCOVERY_DB_READY

## Worktree / Branch / HEAD

```text
WORKTREE=D:\Ai\staking-wallet-web
BRANCH=feat/p5-t04-custody-observer-orchestrator
START_HEAD=43b78195299658568afd46cb466a383672054f63
FINAL_HEAD=43b78195299658568afd46cb466a383672054f63
P5_T04_01_COMMIT=43b78195299658568afd46cb466a383672054f63
PARENT=e931dd173e0ab5005a386bf91c8e1276a74bcec4
ORIGIN_MAIN=e931dd173e0ab5005a386bf91c8e1276a74bcec4
COMMITS_OVER_ORIGIN_MAIN=1
REMOTE_FEATURE_BRANCH=NONE
PR=NONE
```

## P5-T04-01 Contract Baseline

Reviewed contract:

```text
docs/09-governance/NEW_P5_T04_01_CUSTODY_OBSERVER_ORCHESTRATOR_CONTRACT.md
```

Contract markers preserved as implementation inputs:

```text
SCOPE_OFFSET_PAGINATION=PROHIBITED
ORCHESTRATOR_WHOLE_RUN_TRANSACTION=PROHIBITED
SCOPE_READER_DATABASE_PRIVILEGE=CONNECT_ONLY
SCOPE_READER_PRIVATE_SCHEMA_PRIVILEGE=USAGE_ONLY
WRITE_ROLE_SCOPE_LIST_EXECUTE=PROHIBITED
WRITE_ROLE_SCOPE_REFRESH_EXECUTE=PROHIBITED
```

## Reviewed Repository Evidence

Reviewed existing custody, reconciliation, and worker ACL sources:

```text
supabase/migrations/20260719192022_init_project_asset_wallet_domain.sql
supabase/migrations/20260722000527_init_custody_boundary_domain.sql
supabase/migrations/20260729090000_p5_t02_reconciliation_core.sql
supabase/migrations/20260729103000_p5_t02_record_balance_observation.sql
supabase/migrations/20260801071426_p5_t03_atomic_balance_observer_command.sql
supabase/migrations/20260801120000_p5_t03_observer_review_remediation.sql
supabase/migrations/20260801153000_p5_t03_final_review_remediation.sql
supabase/migrations/20260802003000_p5_t03_acl_edge_remediation.sql
supabase/tests/database/p5_t03_atomic_balance_observer_command.test.sql
supabase/tests/database/p5_t03_observer_review_remediation.test.sql
supabase/tests/database/p5_t03_final_review_remediation.test.sql
supabase/tests/database/p5_t03_acl_edge_remediation.test.sql
```

## Changed Files

```text
supabase/migrations/20260802090000_p5_t04_scope_discovery.sql
supabase/tests/database/p5_t04_scope_discovery.test.sql
docs/09-governance/NEW_P5_T04_02_SCOPE_DISCOVERY_DB_REPORT.md
```

Existing migrations, existing pgTAP files, P5-T04-01 contract, TypeScript
source, scripts, package files, generated types, app routes, and admin server
code were not edited.

## Scope Reader Role

Implemented PostgreSQL login role:

```text
custody_observer_scope_reader
```

Role attributes:

```text
LOGIN
NOINHERIT
NOSUPERUSER
NOCREATEDB
NOCREATEROLE
NOREPLICATION
NOBYPASSRLS
PASSWORD_STORED=NO
ROLE_MEMBERSHIP=PROHIBITED
OBJECT_OWNERSHIP=PROHIBITED
```

Allowed privileges:

```text
DATABASE_CONNECT=YES
PRIVATE_SCHEMA_USAGE=YES
SCOPE_LIST_EXECUTE=YES
SCOPE_REFRESH_EXECUTE=YES
```

Denied privileges:

```text
DATABASE_CREATE=NO
DATABASE_CONNECT_GRANT_OPTION=NO
DIRECT_TEMP=NO
SCHEMA_CREATE=NO
SCHEMA_USAGE_GRANT_OPTION=NO
PUBLIC_PRIVATE_TABLE_PRIVILEGE=NO
PUBLIC_PRIVATE_COLUMN_PRIVILEGE=NO
PUBLIC_PRIVATE_SEQUENCE_PRIVILEGE=NO
ATOMIC_WRITE_COMMAND_EXECUTE=NO
OTHER_PUBLIC_PRIVATE_FUNCTION_EXECUTE=NO
ASSERTION_FUNCTION_EXECUTE=NO
GRANT_OPTION=NO
```

The migration grants database CONNECT through quoted `current_database()` and
uses dynamic SQL only for the migration-time database GRANT identifier.

## Read / Write Role Separation

Scope reader can execute only:

```text
private.list_balance_observer_scope_page(uuid, uuid, integer)
private.read_balance_observer_scope(uuid, uuid)
```

Worker role cannot execute scope reads:

```text
custody_observer_worker -> scope list execute: false
custody_observer_worker -> scope refresh execute: false
```

Scope reader cannot execute the worker write command:

```text
private.record_balance_observation_and_advance_checkpoint(
  uuid,
  text,
  text,
  numeric,
  timestamptz,
  bigint,
  text,
  timestamptz
)
```

Existing worker closed-world assertion still passes after the new functions.

## Scope Page Command

Implemented:

```text
private.list_balance_observer_scope_page(
  p_after_provider_id uuid default null,
  p_after_asset_id uuid default null,
  p_scope_limit integer default 50
)
```

Function attributes:

```text
LANGUAGE=plpgsql
VOLATILITY=STABLE
SECURITY_DEFINER=YES
SEARCH_PATH_EMPTY=YES
DYNAMIC_SQL_IN_BODY=NO
DML_IN_BODY=NO
ADVISORY_LOCK_IN_BODY=NO
OFFSET_IN_BODY=NO
```

Return columns:

```text
provider_id uuid
provider_code text
provider_type text
supports_balance_observation boolean
supports_transfer_observation boolean
supports_transfer_lookup boolean
supports_payout_submission boolean
supports_webhook_ingestion boolean
asset_id uuid
asset_code text
binding_id uuid
binding_key text
account_role text
expected_checkpoint_version bigint
page_scope_count integer
has_more boolean
next_provider_id uuid
next_asset_id uuid
```

Pagination:

```text
UNIT=provider_id + asset_id
ORDER=provider_id ASC, asset_id ASC, binding_id ASC
KEYSET=(provider_id, asset_id) > (p_after_provider_id, p_after_asset_id)
LIMIT_UNIT=scope count, not binding row count
HAS_MORE=p_scope_limit + 1 scope probe
OFFSET=0
SCOPE_SPLIT=0
```

Cursor and limit validation:

```text
PARTIAL_CURSOR=scope_cursor_invalid / 22023
LIMIT_NULL=scope_limit_invalid / 22023
LIMIT_ZERO=scope_limit_invalid / 22023
LIMIT_NEGATIVE=scope_limit_invalid / 22023
LIMIT_201=scope_limit_invalid / 22023
```

## Exact Refresh Command

Implemented:

```text
private.read_balance_observer_scope(
  p_provider_id uuid,
  p_asset_id uuid
)
```

Function attributes:

```text
LANGUAGE=plpgsql
VOLATILITY=STABLE
SECURITY_DEFINER=YES
SEARCH_PATH_EMPTY=YES
DYNAMIC_SQL_IN_BODY=NO
DML_IN_BODY=NO
ADVISORY_LOCK_IN_BODY=NO
OFFSET_IN_BODY=NO
```

Return columns:

```text
provider_id uuid
provider_code text
provider_type text
supports_balance_observation boolean
supports_transfer_observation boolean
supports_transfer_lookup boolean
supports_payout_submission boolean
supports_webhook_ingestion boolean
asset_id uuid
asset_code text
binding_id uuid
binding_key text
account_role text
expected_checkpoint_version bigint
```

Input validation:

```text
NULL_PROVIDER_ID=scope_identity_invalid / 22023
NULL_ASSET_ID=scope_identity_invalid / 22023
```

## Eligibility

Included:

```text
provider.status = APPROVED
provider.supports_balance_observation = true
binding.status = APPROVED
asset.status = ACTIVE
```

Excluded and pgTAP-covered:

```text
DRAFT_PROVIDER
SUSPENDED_PROVIDER
RETIRED_PROVIDER
BALANCE_CAPABILITY_FALSE_PROVIDER
DRAFT_BINDING
SUSPENDED_BINDING
RETIRED_BINDING
NON_ACTIVE_ASSET
MISSING_PROVIDER_ASSET_SCOPE
```

## Capability Flags

Returned safe provider capability flags:

```text
supports_balance_observation
supports_transfer_observation
supports_transfer_lookup
supports_payout_submission
supports_webhook_ingestion
```

The DB command does not build capability arrays. That remains a P5-T04-03
TypeScript scope client concern.

## Checkpoint Version Mapping

Checkpoint join:

```text
observer_kind = BALANCE_OBSERVER_V1
```

Mapping:

```text
NO_CHECKPOINT -> expected_checkpoint_version = 0
BALANCE_CHECKPOINT -> expected_checkpoint_version = current version
OTHER_OBSERVER_KIND_CHECKPOINT -> ignored
```

Forbidden fields are not returned:

```text
checkpoint_value
checkpoint_observed_at
observation_key
observed_units
raw identity
amount
provider endpoint
credential
wallet or blockchain address
profile/user/session/JWT/cookie data
```

## Closed-World Reader Assertion

Implemented:

```text
private.assert_custody_observer_scope_reader_role_contract()
```

Function attributes:

```text
RETURNS=void
VOLATILITY=STABLE
SECURITY_DEFINER=YES
SEARCH_PATH_EMPTY=YES
EXECUTE_REVOKED_FROM_PUBLIC=YES
EXECUTE_REVOKED_FROM_READER=YES
EXECUTE_REVOKED_FROM_WORKER=YES
```

Assertion failure:

```text
ERROR=custody_observer_scope_reader_role_contract_invalid
SQLSTATE=42501
```

It verifies role existence, safe role attributes, no stored password, no unsafe
membership, no object/schema/type/function ownership, database CONNECT only,
private schema USAGE only, no database/schema grant options, no direct TEMP, no
effective schema CREATE, exact scope read EXECUTE only, no atomic write command
EXECUTE, no unrelated public/private function EXECUTE, no table privilege, no
column privilege, no sequence privilege, and no assertion EXECUTE.

The existing worker assertion is also executed at migration end:

```text
select private.assert_custody_observer_scope_reader_role_contract();
select private.assert_custody_observer_worker_role_contract();
```

## Index Decision

Added the targeted partial index:

```text
private.custody_account_bindings(
  custody_provider_id,
  asset_id,
  id
)
WHERE status = 'APPROVED'
```

No equivalent existing index covered provider+asset scope discovery with
approved binding filtering and deterministic binding order.

## pgTAP Coverage

New pgTAP file:

```text
supabase/tests/database/p5_t04_scope_discovery.test.sql
```

New P5-T04-02 assertions:

```text
P5_T04_02_PGTAP_ASSERTIONS=83
```

Covered:

```text
role existence and safe attributes
password absence
membership and ownership baseline
function identity arguments
function return contracts
STABLE / SECURITY DEFINER / search_path=''
function comments
public wrapper absence
read-only function body scan
forbidden return-field absence
baseline reader assertion
baseline worker assertion
database and schema privilege contract
table/column/sequence privilege absence
scope read EXECUTE grants
worker/public/anon/authenticated/service_role read EXECUTE denial
atomic write command denial
other public/private function denial
eligibility fixtures through real lifecycle transitions
capability flag return
checkpoint version mapping
scope-count pagination
scope split prevention
stable keyset ordering
terminal cursor
cursor and limit validation
exact refresh filtering
current provider/binding/asset status revalidation
read-only side-effect checks
ACL contamination and cleanup
final reader assertion
final worker assertion
```

ACL contamination cases covered:

```text
database CONNECT WITH GRANT OPTION
direct database TEMP
private schema USAGE WITH GRANT OPTION
public schema CREATE
private table SELECT
public column SELECT
private sequence USAGE
unrelated private function EXECUTE
atomic write command EXECUTE
scope list EXECUTE WITH GRANT OPTION
scope refresh unexpected grantee
role membership
```

Not directly injected:

```text
SET_ROLE_RUNTIME_EXECUTION=NOT_USED
OBJECT_OWNERSHIP_CONTAMINATION=NOT_INJECTED
```

Reason: the Supabase DB test runner is not a member of
`custody_observer_scope_reader`, and adding durable membership or ownership
transfer capability would weaken the role contract under test. The baseline
catalog checks and closed-world assertion still verify role membership and
ownership remain zero/unsafe-free.

## DB Validation

First clean DB validation:

```text
npm run db:reset:local -> PASS
npm run db:lint:local -> PASS, errors 0
npm run db:test:local -> PASS
PGTAP_FILES=31
PGTAP_TESTS=1470
PGTAP_FAILURES=0
PGTAP_SKIPS=0
npm run db:types:local -> PASS
GENERATED_TYPE_DIFF=0
```

Repeated DB validation:

```text
npm run db:reset:local -> PASS
npm run db:lint:local -> PASS, errors 0
npm run db:test:local -> PASS
PGTAP_FILES=31
PGTAP_TESTS=1470
PGTAP_FAILURES=0
PGTAP_SKIPS=0
```

## Runtime Regressions

Syntax checks:

```text
node --check scripts/test-p5-t03-custody-balance-adapter-runtime.mjs -> PASS
node --check scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs -> PASS
node --check scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs -> PASS
```

Runtime harness results:

```text
npm run test:custody:balance-adapter:local -> PASS
ADAPTER_RUNTIME_CASE_COUNT=74
ADAPTER_EXTERNAL_NETWORK_CALLS=0
ADAPTER_CREDENTIAL_ENV_READS=0

npm run test:custody:balance-observer-worker:local -> PASS
WORKER_RUNTIME_CASE_COUNT=62
WORKER_LOCAL_POSTGRES_CONNECTIONS=5
WORKER_EXTERNAL_NETWORK_CALLS=0
WORKER_PROVIDER_NETWORK_CALLS=0
WORKER_CREDENTIAL_ENV_READS=0
WORKER_SERVICE_ROLE_USAGE=0

npm run test:custody:balance-observer-resilience:local -> PASS
RESILIENCE_RUNTIME_CASE_COUNT=62
RESILIENCE_LOCAL_POSTGRES_CONNECTIONS=20
RESILIENCE_EXTERNAL_NETWORK_CALLS=0
RESILIENCE_PROVIDER_NETWORK_CALLS=0
RESILIENCE_CREDENTIAL_ENV_READS=0
```

## Lint / Build / Boundary / Audits

```text
npm run lint -> PASS, warnings 0
npm run build -> PASS
npm run test:custody:boundary:local -> PASS
npm audit --omit=dev -> vulnerabilities 0
npm audit -> vulnerabilities 0
```

Next build detected `.env.local` as an environment file, but no `.env*` file
content was manually read, copied, or written into this report.

## Read-Only Invariants

Read command source and pgTAP side-effect checks confirm:

```text
INSERT=0
UPDATE=0
DELETE=0
TRUNCATE=0
ADVISORY_LOCK=0
DYNAMIC_SQL_IN_READ_BODY=0
TRANSACTION_CONTROL=0
ATOMIC_WRITE_COMMAND_CALL=0
```

Durable row-count delta after read function execution:

```text
external_balance_observations=0
observer_checkpoints=0
reconciliation_runs=0
reconciliation_items=0
custody_config_audit_events=0
ledger_accounts=0
ledger_journals=0
ledger_entries=0
```

## Network / Credential Boundary

```text
EXTERNAL_PROVIDER_NETWORK_CALLS=0
PRODUCTION_PROVIDER_ADAPTER_CALLS=0
PROVIDER_CREDENTIAL_READS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_CLIENT=0
BROWSER_SUPABASE_CLIENT=0
PUBLIC_API_ROUTE_CHANGES=0
ADMIN_UI_CHANGES=0
```

The Supabase CLI printed local development connection metadata during startup;
no such values were copied into files, staged, committed, or recorded here.

## Cleanup

Final cleanup command:

```text
npm run supabase:stop -> PASS
```

Runtime harness cleanup gates passed:

```text
adapter temp runtime cleanup -> PASS
worker fixture cleanup -> PASS
worker temp runtime cleanup -> PASS
resilience fixture cleanup -> PASS
resilience temp runtime cleanup -> PASS
custody boundary process cleanup -> PASS
custody boundary final DB reset -> PASS
custody boundary Supabase stop -> PASS
```

## Secret Scan

Scan scope:

```text
new migration
new pgTAP
new governance report
working-tree diff
```

Findings:

```text
POSTGRES_PASSWORD=0
DB_CONNECTION_STRING=0
PRODUCTION_DB_HOST=0
JWT=0
SUPABASE_KEY=0
SERVICE_ROLE_KEY=0
PROVIDER_CREDENTIAL=0
ACCESS_REFRESH_TOKEN=0
COOKIE_SESSION=0
PRIVATE_KEY=0
MNEMONIC=0
SEED_PHRASE=0
WALLET_ADDRESS=0
PROVIDER_ENDPOINT=0
RAW_CHECKPOINT_VALUE=0
RAW_OBSERVATION_IDENTITY=0
FULL_OBSERVATION_KEY=0
ENV_LOCAL_CONTENT=0
```

Synthetic UUIDs, role names, function names, and fixture keys are not secrets.

## Git Status

Expected changed files:

```text
NEW_FILE_COUNT=3
supabase/migrations/20260802090000_p5_t04_scope_discovery.sql
supabase/tests/database/p5_t04_scope_discovery.test.sql
docs/09-governance/NEW_P5_T04_02_SCOPE_DISCOVERY_DB_REPORT.md
```

Restricted path status:

```text
package.json diff=0
package-lock.json diff=0
src diff=0
scripts diff=0
src/types/database.types.ts content diff=0
src/app diff=0
src/server/admin diff=0
```

Git action status:

```text
STAGING=EMPTY
COMMIT=NO
PUSH=NO
REMOTE_BRANCH_CREATED=NO
PR_CREATED=NO
```

## Next Step

Proceed to P5-T04-03 for the TypeScript scope client and one-shot
orchestrator integration, using only the two private read commands and the
dedicated `custody_observer_scope_reader` DB role contract from this task.
