# NEW-P5-T03-02 Mock Custody Balance Adapter Report

## 1. Status

This task implements the P5-T03-02 mock custody balance adapter and canonical
normalization baseline only.

No real provider network call, provider credential, DB write, checkpoint
command, worker orchestration, scheduler, staging, commit, push, or PR was
performed.

Final status:

```text
FINAL_STATUS=PASS_MOCK_CUSTODY_BALANCE_ADAPTER_READY
```

## 2. Worktree / Branch / HEAD

```text
Worktree: D:\Ai\staking-wallet-web
Branch: feat/p5-t03-custody-observer-runtime
Start HEAD: ac914ba55c96e0cd5f5be61ebe7a43ef96a59567
Final HEAD: ac914ba55c96e0cd5f5be61ebe7a43ef96a59567
origin/main: f327ad817787a636ee50d5ddb9c8f11bdb4a3125
P5-T03-01 baseline commit: ac914ba55c96e0cd5f5be61ebe7a43ef96a59567
P5-T03-01 baseline status: PASS_CUSTODY_BALANCE_OBSERVER_CONTRACT_READY
```

Start-state checks passed:

- branch matched `feat/p5-t03-custody-observer-runtime`
- HEAD matched `ac914ba55c96e0cd5f5be61ebe7a43ef96a59567`
- working tree was clean
- staging was empty
- `origin/main` matched `f327ad817787a636ee50d5ddb9c8f11bdb4a3125`

## 3. Changed Files

```text
package.json
src/server/custody/provider-observation-contract.ts
src/server/custody/balance-observation-normalization.ts
src/server/custody/mock-balance-observation-adapter.ts
scripts/test-p5-t03-custody-balance-adapter-runtime.mjs
docs/09-governance/NEW_P5_T03_02_MOCK_CUSTODY_BALANCE_ADAPTER_REPORT.md
```

Unchanged by contract:

```text
supabase/** diff: 0
src/types/database.types.ts diff: 0
package-lock.json diff: 0
src/app/** diff: 0
src/server/admin/** diff: 0
existing API routes diff: 0
existing runtime harness files diff: 0
existing governance reports diff: 0
```

`package.json` changed only to add:

```text
test:custody:balance-adapter:local
```

No dependency or lockfile change was made.

## 4. Provider Contract Extension

File:

```text
src/server/custody/provider-observation-contract.ts
```

Added:

- `CustodyBalanceObservationIdentity`
- `CustodyBalanceObservationErrorCode`
- `CustodyBalanceObservationError`
- `CustodyBalanceObservationResult`

Balance observations now carry per-binding identity material:

```text
NATIVE(value)
CHECKPOINT(value)
CONTENT
```

`readBalances()` now returns a per-binding success/error union:

```text
Promise<readonly CustodyBalanceObservationResult[]>
```

Error catalog:

```text
TIMEOUT
RATE_LIMITED
PROVIDER_UNAVAILABLE
UNSUPPORTED_ASSET
MALFORMED_AMOUNT
MALFORMED_TIMESTAMP
MISSING_RESULT
DUPLICATE_RESULT
UNEXPECTED_RESULT
```

Error payload contract:

- `code`
- `retryable`
- `retryAfterMs`

The error shape does not include raw provider messages, stacks, endpoints,
request/response bodies, credentials, account identifiers, wallet addresses, or
provider payloads.

Existing search result:

```text
PRODUCTION_READ_BALANCES_USAGE=0
```

No production adapter or worker currently uses the old success-array signature.

## 5. Observer Kind V1

No central observer-kind catalog exists in the repository.

P5-T03-02 defines:

```text
CUSTODY_BALANCE_OBSERVER_KIND_V1=BALANCE_OBSERVER_V1
```

Contract:

- uppercase DB-safe pattern
- provider code excluded
- host/process/version hash excluded
- balance observer purpose only
- exported once from the shared server helper

## 6. Canonical Normalization Helper

File:

```text
src/server/custody/balance-observation-normalization.ts
```

Exports:

- `normalizeAtomicUnits`
- `normalizeUtcMicrosecondTimestamp`
- `normalizeCanonicalUuid`
- `normalizeObservationIdentityValue`
- `createBalanceObservationKeyV1`
- `createBalanceObservationKeyDetailsV1`
- `CUSTODY_BALANCE_OBSERVER_KIND_V1`

Runtime boundaries:

- server-only module
- Node standard library only
- DB calls 0
- provider network calls 0
- environment reads 0
- browser/client import not introduced

## 7. Amount Normalization

Contract:

```text
AMOUNT_NORMALIZATION_OWNER=ADAPTER
BALANCE_VALUE_SEMANTICS=TOTAL
```

Allowed:

- `"0"`
- positive integer strings with no leading zero
- up to 38 digits, matching the existing DB `< 10^38` contract

Rejected:

- empty or whitespace-bearing values
- sign, negative, fraction, decimal, scientific notation
- `NaN`, `Infinity`
- 39 digits or more
- JavaScript number, bigint, object coercion

The helper does not convert Atomic Unit strings through JavaScript `Number`,
`parseInt`, or `parseFloat`.

## 8. Timestamp Normalization

Contract:

```text
OBSERVATION_TIMESTAMP_CANONICAL_FORMAT=UTC_MICROSECONDS
OBSERVATION_TIMESTAMP_CANONICAL_SHAPE=YYYY-MM-DDTHH:mm:ss.ffffffZ
```

Behavior:

- accepts explicit `Z` timezone
- accepts explicit positive or negative timezone offsets
- accepts fractional seconds with 0 to 6 digits
- normalizes to UTC
- right-pads fractional seconds to exactly six digits
- preserves microseconds without silent millisecond truncation
- rejects timezone-missing, invalid calendar, leap second, whitespace, control
  character, Date object, and numeric epoch input

## 9. UUID And Identity Normalization

UUID contract:

- accepts canonical lowercase hyphenated UUID strings
- rejects uppercase, braces, compact UUID, non-string, and invalid shapes
- does not silently correct caller input

Identity value contract:

- string only
- no leading/trailing whitespace
- Unicode NFC canonical return value
- non-empty
- bounded length
- no control characters
- credential marker, URL-like, wallet-address-like, and
  transaction-signature-like values rejected

The rules intentionally do not reject ordinary provider sequence labels merely
because they contain short hexadecimal-looking or numeric portions.

## 10. Observation Key V1

Helper:

```text
createBalanceObservationKeyV1(...)
```

Format:

```text
balobs:v1:<mode>:<64-lowercase-hex>
```

Mode mapping:

```text
NATIVE -> n
CHECKPOINT -> k
CONTENT -> c
```

Digest:

```text
SHA-256(UTF8(JSON.stringify(canonicalOrderedStringArray)))
```

Canonical field arrays:

```text
NATIVE:
BALANCE_OBSERVATION, v1, native, providerCode, bindingId, assetId,
observerKind, nativeObservationId

CHECKPOINT:
BALANCE_OBSERVATION, v1, checkpoint, providerCode, bindingId, assetId,
observerKind, checkpointReference

CONTENT:
BALANCE_OBSERVATION, v1, content, providerCode, bindingId, assetId,
observerKind, observedTotalUnits, observedAtUtcMicroseconds
```

Rules verified:

- available units are excluded from all modes
- amount/time are included only in CONTENT mode
- NATIVE/CHECKPOINT payload changes keep the same key
- CONTENT total or timestamp changes produce a different key
- random UUID, process ID, host name, retry count, worker execution time,
  endpoint URL, credential, raw provider payload, and raw identity are excluded
  from the observation key text

## 11. Known Digest Vectors

The runtime harness contains three fixed synthetic vectors:

- NATIVE vector: 1
- CHECKPOINT vector: 1
- CONTENT vector: 1

For each vector the harness hard-codes:

- canonical input fields
- canonical JSON string
- expected digest
- expected full observation key

The expected values were calculated independently before being fixed in the
harness. They are not generated dynamically from the production helper during
the assertion.

The report does not print full digest, full key, or raw identity values. The
fixtures are synthetic sentinels and are not provider credentials, wallet
addresses, provider endpoints, native production IDs, or checkpoints.

## 12. Deterministic Mock Adapter

File:

```text
src/server/custody/mock-balance-observation-adapter.ts
```

Factory exports:

- `createMockCustodyObservationAdapter`
- `createMockCustodyObservationAdapterFactory`

Mock scenarios verified:

- NATIVE success
- CHECKPOINT success
- CONTENT success
- zero balance
- 38-digit safe large balance
- available balance different from total balance
- TIMEOUT
- RATE_LIMITED
- PROVIDER_UNAVAILABLE
- UNSUPPORTED_ASSET
- MALFORMED_AMOUNT
- MALFORMED_TIMESTAMP
- MISSING_RESULT
- DUPLICATE_RESULT

Result contract:

- exactly one result per requested binding
- result order matches request order
- success/error union per binding
- partial binding failures do not reject the whole batch
- fatal provider network behavior is not implemented in the mock
- deterministic replay returns the same result

Mock health:

- deterministic `AVAILABLE`, `DEGRADED`, or `UNAVAILABLE`
- `checkedAt` supplied by fixture and normalized canonically
- no `Date.now()` or worker execution timestamp

Transfer boundary:

- existing interface compatibility preserved
- deterministic empty transfer page supported
- no new transfer observer logic implemented

## 13. Production / Mock Separation

Production boundary:

- mock adapter is not auto-registered in a production factory registry
- no environment variable enables production mock behavior
- no public API route imports the mock
- no client component imports the mock
- no provider SDK imported
- no network fallback implemented
- no build-time credential introduced

Mock selection requires explicit fixture construction by server-side test or
future worker code.

## 14. Runtime Execution Method

Runtime harness:

```text
scripts/test-p5-t03-custody-balance-adapter-runtime.mjs
```

Execution method:

- reads selected TypeScript source modules
- strips only the `server-only` marker in the isolated test loader
- transpiles selected modules with the repository's local `typescript`
  dependency into a temporary directory
- runs the emitted JavaScript with Node
- executes the actual helper and mock adapter code
- removes the temporary directory at the end

No production source is rewritten for runtime execution.

Runtime result:

```text
RUNTIME_CASE_COUNT=72
EXTERNAL_NETWORK_CALLS=0
CREDENTIAL_ENV_READS=0
CUSTODY_BALANCE_ADAPTER_RUNTIME_PASS
```

## 15. Validation

Commands executed:

```text
git diff --check
node --check scripts/test-p5-t03-custody-balance-adapter-runtime.mjs
npm run test:custody:balance-adapter:local
npm run lint
npm run build
npm run test:custody:boundary:local
```

Results:

```text
GIT_DIFF_CHECK=PASS
NODE_CHECK=PASS
BALANCE_ADAPTER_RUNTIME=PASS_CASES_72
LINT=PASS_WARNING_0
BUILD=PASS
CUSTODY_BOUNDARY_REGRESSION=PASS
```

Build noted that `.env.local` exists as a local environment file, but no
`.env.local` contents were read, printed, modified, moved, staged, or committed
by this task.

Existing custody boundary regression result:

```text
CUSTODY_BOUNDARY_PASS
```

The existing runtime started and stopped its local Supabase/App resources and
reported process cleanup PASS.

## 16. Cleanup

New adapter runtime:

```text
TEMP_TRANSPILE_DIRECTORY_RESIDUE=0
CHILD_PROCESS_RESIDUE=0
EXTERNAL_NETWORK_CALLS=0
FIXTURE_RESIDUE=0
```

Existing custody boundary runtime:

```text
PORT_3000_LISTENER_RESIDUE=0
PORT_3010_LISTENER_RESIDUE=0
PORT_55721_55724_LISTENER_RESIDUE=0
PROJECT_NODE_PROCESS_RESIDUE=0
PROJECT_SUPABASE_CONTAINER_RESIDUE=0
QUARANTINE_RESIDUE=0
ENV_LOCAL_CHANGE=0
```

No other project directories were accessed for cleanup.

## 17. Secret Scan

Secret scan scope:

- new and modified source
- runtime harness
- governance report
- working tree diff

Expected result:

```text
SECRET_SCAN_ACTUAL_VALUES=0
BROAD_COOKIE_LABEL_FALSE_POSITIVE=1
SYNTHETIC_64_HEX_TEST_SENTINELS=6
```

This task added no actual DB credential, connection string, JWT, Supabase key,
service-role key, provider API key, provider secret, cookie/session value,
private key, mnemonic, seed phrase, wallet address, provider endpoint, native
production observation ID, production checkpoint, or `.env.local` content.

Synthetic UUIDs, provider codes, identity labels, digest constants, and
observation-key constants are deterministic test sentinels only.

The broad cookie-label match is the existing `package.json` script name
`test:http:cookie-jar:local`, not a cookie/session value.

## 18. Git

```text
STAGING=0
COMMIT=0
PUSH=0
PR=0
```

All changes remain unstaged.

## 19. Next Step

Recommended next task:

```text
P5-T03-03 Balance Observation DB Command and Checkpoint Atomicity
```

That task should implement the private worker DB function boundary for atomic
observation insert plus checkpoint advancement. This task intentionally does
not implement DB writes, checkpoint CAS, worker orchestration, provider network,
or scheduler behavior.
