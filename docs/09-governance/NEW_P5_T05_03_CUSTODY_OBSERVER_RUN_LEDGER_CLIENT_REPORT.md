# P5-T05-03 Custody Observer Run-Ledger Client Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `feat/p5-t05-custody-observer-run-ledger`
- Start HEAD: `5224a392228675d26162fd4e30d90c0805ce1d13`
- Sources: P5-T05-01/R1 contract and P5-T05-02 migration, pgTAP, and DB report.
- This task adds a server-only direct PostgreSQL client, a local runtime harness, one package script, and this report. It does not alter migrations, pgTAP, orchestrator, scheduler, provider adapters, or reconciliation.

## Client Boundary

- Source: `src/server/custody/balance-observer-run-ledger-client.ts`.
- Dedicated role: `custody_observer_run_writer`.
- Dedicated application name: `staking-wallet-balance-observer-run-ledger-v1`.
- Uses a distinct `pg` Pool with explicit caller-provided host, port, database, user, password/password callback, SSL, timeout, lifetime, and pool settings.
- No environment lookup, connection string, Supabase client, service role, browser access, provider network, generic SQL API, transaction statement, or internal retry is present.
- Approved SQL is limited to `private.begin_balance_observer_run`, `private.record_balance_observer_scope_outcome`, and `private.finalize_balance_observer_run`.

## Contract Handling

- Begin validates canonical run keys, trigger source, identity policy, and the exact invocation version before a query.
- Scope input projects ergonomic failure objects into the migration's typed parallel arrays only after UUID, enum, boolean, count, duplicate, and refresh-consistency validation.
- Finalization accepts a typed durable summary and converts only safe integer numbers or canonical bigint strings. Bigint values remain strings across the client boundary.
- Result rows are validated as untrusted data: exactly one row, UUIDs, booleans, closed status catalogs, positive bigint text, and timestamp text are required.
- The client never increments or calculates lifecycle version: it passes the begin result's version to finalize. Scope writes keep version `1`; first terminal finalization yields `2`.
- Error messages are fixed public-safe text. Only SQLSTATE and exact allowlisted safe database tokens participate in mapping; raw PostgreSQL diagnostics are not exposed.

## Runtime Evidence

- Runtime: `scripts/test-p5-t05-custody-observer-run-ledger-client-runtime.mjs`.
- Local direct run-writer login executed the three allowed commands and verified denial of scope read, atomic observation, and direct ledger-table access.
- Real DB lifecycle passed: begin, exact begin replay, conflicting begin, two scope outcomes including typed failure evidence, exact/conflicting scope replay, terminal finalize, exact/conflicting finalization replay, and late-scope rejection.
- Hostile configuration/input/result/error/close tests passed. The harness uses a cryptographically random local-only role password, does not print or persist it, clears it in `finally`, resets the local DB, stops Supabase, and removes its temporary transpilation directory.

## Machine-Checkable Markers

```text
RUN_LEDGER_CLIENT_RUNTIME=SERVER_ONLY_NODE
RUN_LEDGER_CLIENT_DB_CONNECTION=DIRECT_POSTGRES
RUN_LEDGER_CLIENT_ROLE=custody_observer_run_writer
RUN_LEDGER_CLIENT_APPLICATION_NAME=staking-wallet-balance-observer-run-ledger-v1
RUN_LEDGER_CLIENT_POOL_ISOLATION=DEDICATED
RUN_LEDGER_CLIENT_ENV_FALLBACK=0
RUN_LEDGER_CLIENT_CONNECTION_STRING=0
RUN_LEDGER_CLIENT_SERVICE_ROLE_USAGE=0
RUN_LEDGER_CLIENT_BROWSER_SUPABASE_USAGE=0
RUN_LEDGER_CLIENT_TRANSACTION_COUNT=0
RUN_LEDGER_CLIENT_INTERNAL_RETRY=0
RUN_LEDGER_CLIENT_APPROVED_COMMAND_COUNT=3
RUN_LEDGER_CLIENT_DIRECT_TABLE_SQL=0
RUN_LEDGER_CLIENT_UNRELATED_PROJECT_COMMANDS=0

RUN_VERSION_SEMANTICS=LIFECYCLE_ONLY
RUN_VERSION_INITIAL=1
RUN_VERSION_SCOPE_OUTCOME_INCREMENT=false
RUN_FINALIZE_EXPECTED_VERSION_SOURCE=BEGIN_RESULT_VERSION
RUN_FINALIZE_SUCCESS_VERSION_INCREMENT=1
RUN_VERSION_FIRST_TERMINAL=2

DIRECT_RUN_WRITER_LOGIN=PASS
RUN_WRITER_SCOPE_READ_EXECUTE=0
RUN_WRITER_OBSERVATION_WRITE_EXECUTE=0
RUN_WRITER_DIRECT_TABLE_PRIVILEGES=0
REAL_DB_BEGIN_CREATED=true
REAL_DB_BEGIN_VERSION=1
REAL_DB_BEGIN_EXACT_REPLAY=PASS
REAL_DB_BEGIN_CONFLICT=PASS
REAL_DB_SCOPE_PERSISTENCE=PASS
REAL_DB_SCOPE_VERSION_DELTA=0
REAL_DB_SCOPE_EXACT_REPLAY=PASS
REAL_DB_SCOPE_CONFLICT=PASS
REAL_DB_FINALIZE=PASS
REAL_DB_FIRST_TERMINAL_VERSION=2
REAL_DB_FINALIZE_EXACT_REPLAY=PASS
REAL_DB_FINALIZE_CONFLICT=PASS
REAL_DB_LATE_SCOPE_REJECTED=PASS

RUN_LEDGER_CLIENT_RUNTIME_CASE_COUNT=44
LOCAL_POSTGRES_CONNECTIONS=13
EXTERNAL_NETWORK_CALLS=0
PROVIDER_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
SERVICE_ROLE_APPLICATION_USAGE=0
RUN_WRITER_EPHEMERAL_PASSWORD_OUTPUT=0

FINAL_DB_FILE_COUNT=32
FINAL_DB_TEST_COUNT=1496
FINAL_DB_FAILURES=0
FINAL_DB_SKIPS=0
GENERATED_DATABASE_TYPE_DIFF=0
BALANCE_ADAPTER_RUNTIME_CASES=74
BALANCE_OBSERVER_WORKER_RUNTIME_CASES=62
BALANCE_OBSERVER_RESILIENCE_RUNTIME_CASES=62
BALANCE_OBSERVER_SCOPE_CLIENT_RUNTIME_CASES=88
BALANCE_OBSERVER_ORCHESTRATOR_RUNTIME_CASES=269

PACKAGE_SCRIPT_ADDITIONS=1
DEPENDENCY_CHANGE_IN_P5_T05_03=false
PACKAGE_LOCK_DIFF=0
PRODUCTION_AUDIT_VULNERABILITIES=3
FULL_AUDIT_VULNERABILITIES=5
AUDIT_FINDINGS_DISCLOSED=true
```

## Validation And Cleanup

- The client runtime passed 44 cases with 13 local PostgreSQL connections, zero external/provider network calls, zero credential-environment reads, zero service-role application usage, and zero password output.
- P5-T05-02 DB regression, existing custody runtimes, TypeScript, lint, build, custody boundary, and audits are re-run before task closeout. Current audit disclosure remains production 3 and full 5 findings without package or lockfile remediation.
- Cleanup requires no Supabase container or watched-port residue, no temporary runtime directory, no fixture residue after final reset, and no staged change.

## Next Step

Integrate this client as the injected P5-T05 lifecycle reporter in the one-shot custody observer orchestration layer without introducing scheduler or provider integration.

## Final Status

FINAL_STATUS=PASS_CUSTODY_BALANCE_OBSERVER_RUN_LEDGER_CLIENT_READY
