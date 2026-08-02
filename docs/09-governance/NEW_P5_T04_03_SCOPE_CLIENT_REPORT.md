# NEW-P5-T04-03 Scope Client Report

## 1. Baseline

| Item | Value |
| --- | --- |
| Worktree | `D:\Ai\staking-wallet-web` |
| Branch | `feat/p5-t04-custody-observer-orchestrator` |
| Start HEAD | `9f23d59c3d09c526276818502288277180fcf839` |
| Final HEAD | `9f23d59c3d09c526276818502288277180fcf839` |
| Expected parent | `43b78195299658568afd46cb466a383672054f63` |
| origin/main | `e931dd173e0ab5005a386bf91c8e1276a74bcec4` |
| Commits over origin/main | `2` |
| Remote feature branch | `absent at start` |
| PR | `absent at start` |
| Staging | `empty` |
| Commit/push/PR | `not performed` |

## 2. Changed Files

| Path | Purpose |
| --- | --- |
| `src/server/custody/balance-observer-scope-client.ts` | Direct PostgreSQL server-only scope client for the P5-T04-02 read commands. |
| `scripts/test-p5-t04-custody-observer-scope-client-runtime.mjs` | Local runtime harness for ACL, direct DB command execution, validation, error mapping, and cleanup. |
| `package.json` | Added `test:custody:balance-observer-scope-client:local`. |
| `docs/09-governance/NEW_P5_T04_03_SCOPE_CLIENT_REPORT.md` | This report. |

No `package-lock.json`, `supabase/**`, `src/types/database.types.ts`,
`src/app/**`, or `src/server/admin/**` content diff was introduced.

## 3. Scope Client Contract

| Contract | Result |
| --- | --- |
| Server-only module | `import "server-only";` first line |
| Application name | `staking-wallet-balance-observer-scope-v1` |
| Pool ownership | Dedicated scope client `Pool`; separate from the write command client |
| Connection input | Explicit config only |
| Environment fallback | `0` |
| Connection string | `0` |
| Supabase/browser client | `0` |
| Provider network/fetch | `0` |
| Retry/orchestrator/transaction logic | `0` |
| Approved list command | `private.list_balance_observer_scope_page($1::uuid, $2::uuid, $3::integer)` |
| Approved exact command | `private.read_balance_observer_scope($1::uuid, $2::uuid)` |
| Static parameterized SQL | `PASS` |
| Numeric checkpoint serialization | `expectedCheckpointVersion` remains a decimal string |

The public client exposes:

- `listBalanceObserverScopePage({ after, limit })`
- `readBalanceObserverScope({ providerId, assetId })`
- `close()`

The result shape groups trusted output into provider-plus-asset scopes while
preserving binding order from the DB command. It does not sort hostile rows to
hide ordering defects.

## 4. Validation Boundary

The client rejects invalid input before any DB call:

| Input defect | Code |
| --- | --- |
| Bad cursor object or UUID | `SCOPE_CURSOR_INVALID` |
| Bad page limit | `SCOPE_LIMIT_INVALID` |
| Bad exact provider/asset identity | `SCOPE_IDENTITY_INVALID` |

Untrusted DB rows are validated for:

- lowercase canonical UUIDs
- provider code, provider type, and capability booleans
- mandatory `BALANCE_OBSERVATION`
- asset code
- binding key and account role
- checkpoint version decimal bigint string, including max-bound checks
- provider/asset/binding ordering
- duplicate scope and duplicate binding rejection
- page metadata consistency
- exact refresh row identity consistency

The client maps DB/runtime failures to safe fixed-message errors:

| Error class | Retryable |
| --- | --- |
| `SCOPE_DB_CONNECTION_FAILED` | `true` |
| `SCOPE_DB_TIMEOUT` | `true` |
| `SCOPE_DB_UNAVAILABLE` | `true` |
| `SCOPE_COMMAND_REJECTED` | `false` |
| Result-shape and contract codes | `false` |

External error message:

```text
custody_balance_observer_scope_client_failed
```

## 5. Runtime Harness Result

Command:

```text
npm run test:custody:balance-observer-scope-client:local
```

Result:

```text
CUSTODY_BALANCE_OBSERVER_SCOPE_CLIENT_RUNTIME_PASS
SCOPE_CLIENT_RUNTIME_CASE_COUNT=88
LOCAL_POSTGRES_CONNECTIONS=5
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
```

Covered cases:

- source boundary scan
- Supabase start/reset/stop
- synthetic fixture setup and cleanup
- ephemeral scope-reader login credential set/clear
- direct `custody_observer_scope_reader` login
- fixed `application_name`
- list command execute
- exact command execute
- direct private table read rejection
- direct public table read rejection
- write command rejection
- unrelated private function rejection
- list first/second/final/terminal/large pages
- exact existing/missing/refresh-after-status-change reads
- invalid input before DB call
- hostile page result validation
- hostile exact result validation
- DB error mapping
- idle pool error sanitization
- idempotent close and closed-client rejection
- close failure sanitization
- no external/provider network
- no credential environment reads
- temporary runtime cleanup

## 6. Regression Validation

| Command | Result |
| --- | --- |
| `node --check scripts/test-p5-t04-custody-observer-scope-client-runtime.mjs` | `PASS` |
| `npm run supabase:start` | `PASS` |
| `npm run db:reset:local` | `PASS` |
| `npm run db:lint:local` | `PASS`, schema errors `0` |
| `npm run db:test:local` | `PASS`, `31 files / 1470 tests` |
| `npm run db:types:local` | `PASS` |
| `git diff -- src/types/database.types.ts` | content diff `0` |
| `node --check scripts/test-p5-t03-custody-balance-adapter-runtime.mjs` | `PASS` |
| `node --check scripts/test-p5-t03-custody-balance-observer-worker-runtime.mjs` | `PASS` |
| `node --check scripts/test-p5-t03-custody-balance-observer-resilience-runtime.mjs` | `PASS` |
| `npm run test:custody:balance-adapter:local` | `PASS`, `74 cases` |
| `npm run test:custody:balance-observer-worker:local` | `PASS`, `62 cases` |
| `npm run test:custody:balance-observer-resilience:local` | `PASS`, `62 cases` |
| `git diff --check` | `PASS`; no whitespace errors |
| `npm run lint` | `PASS`, warning `0` |
| `npm run build` | `PASS` |
| `npm run test:custody:boundary:local` | `PASS` |
| `npm audit --omit=dev` | vulnerabilities `0` |
| `npm audit` | vulnerabilities `0` |
| `npm run supabase:stop` | `PASS` |

Notes:

- Supabase CLI local startup output was not copied into this report.
- Build observed the existing local environment file by name only; no local
  environment file content was read into this report.

## 7. Restricted Diff and Cleanup

| Boundary | Result |
| --- | --- |
| `supabase/**` diff | `0` |
| `src/types/database.types.ts` diff | `0` |
| `src/app/**` diff | `0` |
| `src/server/admin/**` diff | `0` |
| `package-lock.json` diff | `0` |
| P5-T03 existing source files | `0` |
| Ports `3000,3010,55721,55722,55723,55724` listening | `0` |
| Running `staking-wallet-web` Supabase containers | `0` |
| Temporary runtime directory residue | `0` |
| Staging | `empty` |
| Commit | `0` |
| Push | `0` |
| PR | `0` |

## 8. Secret Safety

Secret scan scope:

- new scope client source
- new runtime harness
- this governance report
- current git diff

Result:

```text
ACTUAL_SECRET=0
PRIVATE_KEY=0
MNEMONIC_VALUE=0
SEED_PHRASE=0
JWT_VALUE_IN_REPORT=0
ACCESS_TOKEN_VALUE=0
REFRESH_TOKEN_VALUE=0
DB_URL_VALUE_IN_REPORT=0
COOKIE_OR_SESSION_VALUE=0
TOTP_SECRET=0
RAW_CHECKPOINT_IDENTITY_LOG=0
OBSERVATION_KEY_LOG=0
LOCAL_ENV_CONTENT_READ_INTO_REPORT=0
```

## 9. Final Status

```text
FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_SCOPE_CLIENT_READY
```
