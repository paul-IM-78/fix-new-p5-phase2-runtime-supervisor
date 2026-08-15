# P6-T06 First Real BitGo TEST Read Qualification Contract

## Status And Authority

- Task ID: `P6-T06`
- Task name: `First Real BitGo TEST Read Qualification`
- Classification: `PHASE6_FIRST_REAL_BITGO_TEST_READ_QUALIFICATION_GATE`
- Type: `REAL_PROVIDER_READ_QUALIFICATION_TASK_WITH_FROZEN_EXECUTION_CONTRACT`
- Proposed semantic: `FIRST_REAL_BITGO_TEST_READ_QUALIFIED_WITHOUT_EXPANDING_WRITE_OR_PRODUCTION_AUTHORITY`
- Current state: `DEFINED_NOT_STARTED`
- Current execution authority: governance only. This document authorizes no network request, credential read, wallet lookup, token provisioning, implementation, branch, commit, or pull request.

This is a frozen execution contract for a single future, explicitly authorized, real provider read. It does not activate provider access. An authorization of a later gate is required before any implementation or real request.

## Canonical Baseline And Frozen Predecessors

- Canonical branch: `fix/new-p5-phase2-runtime-supervisor`
- Canonical baseline commit: `c9e55c943275925f73797ffe3871cbc9e157967b`
- P6-T04 conclusion: `P6_T06_REUSES_P6_T04_WITHOUT_SECURITY_INFRASTRUCTURE_CHANGE`
- P6-T05 conclusion: `DEDICATED_ONE_SHOT_REAL_READ_QUALIFICATION_RUNNER_REQUIRED`
- P6-T05 is a semantic adapter with injected executor support and deterministic fake-runtime coverage. It has no normal runtime, observer, scheduler, or orchestration wiring that may perform this qualification request.

The following P6-T05 artifacts are frozen predecessors; this task neither edits nor requalifies them:

| Artifact | SHA-256 |
| --- | --- |
| Implementation contract | `5FBC39E1090B96A9ABD0EC858F938388B8AA01050D30EBC78E249C6898A7EB53` |
| Implementation report | `8AEA45DDB65DD0D9433EEAAE249FE6FB10DEF3C10A1BB5CB76AC98B721FEB775` |
| Qualification report | `0CE448EB90B5A5ED63ED27170AE67D94111029439DD486B76FA230979BD9F60A` |
| Semantic adapter source (raw canonical Git blob `1d7f644d09f3f5f9bbf5d106ce7dbf4e3a266e87`) | `3584573C032544546C10514FF40B6044EE014B0B8D459F2960C3D8CFDD5B5AFC` |
| Semantic adapter test | `E6639380B0FCB46B022DA0A2B53A61CE4404F4E47956236F8EED59B9B74BB2EE` |
| Semantic adapter harness | `11E6EA902A610788787E9B2B9E2EDF40DFB0C7A1FA37CC2BBA334B40D315CDD0` |

The authoritative P6-T05 source identity is the raw canonical Git blob bytes for `src/server/custody/bitgo-read-only-semantic-adapter.ts` at canonical merge `c9e55c943275925f73797ffe3871cbc9e157967b`. A future runner must verify that identity using a binary-safe Git object read, or an equivalent read of the same blob bytes, with no source rewriting or line-ending normalization before hashing. Platform-specific working-tree bytes after checkout conversion, including Windows CRLF representations, are not an authority identity. `P6_T05_CANONICAL_SOURCE_EVIDENCE_REMAINS_VALID = true`.

The table is an integrity reference only. It contains no wallet, token, balance, credential, or provider response value.

## Official Source Basis

- Source: `https://developers.bitgo.com/docs/solana/`
- Retrieval date: `2026-08-15`
- Solana TEST coin: `tsol`
- Production coin: `sol`
- Balance fields selected for semantic validation: `balanceString` and `spendableBalanceString`

The future runner uses the already frozen P6-T05 descriptor semantics:

```text
GET /api/v2/tsol/wallet/{walletId}?includeBalance=true
```

The `{walletId}` text is a placeholder, never an actual identifier in governance evidence.

## Provider Scope And Non-Expansion

The only permitted future provider scope is `BITGO`, `SOLANA`, environment `BITGO_TEST`, coin `tsol`, and one wallet balance observation. It is read-only and must produce only the canonical `BALANCE_OBSERVATION` semantic result.

P6-T04 remains the only network and credential authority. Its endpoint registry permits `BITGO_TEST` at `app.bitgo-test.com` and keeps production `app.bitgo.com` inactive. P6-T04 enforces server-only execution, approved destination before credential resolution, DNS connection planning, global-address validation, TLS/SNI/certificate verification, no proxy agent, redirect rejection, bounded JSON handling, credential isolation/redaction, and bounded retry behavior.

Production is prohibited: `app.bitgo.com`, `sol`, production environment selection, production token selection, production fallback, and any production switch are outside P6-T06.

## First Real Read Definition And Budgets

`FIRST_REAL_READ` means the first future network execution using the canonical P6-T04 transport and the P6-T05 adapter against the approved TEST endpoint for this qualification only.

- `MAX_LOGICAL_QUALIFICATION_INVOCATIONS = 1`
- One logical adapter invocation is permitted after a distinct authorization gate.
- P6-T04's existing `MAX_TOTAL_ATTEMPTS = 3` transport ceiling is the only retry policy.
- The runner must add no retry loop, rerun control, fallback request, duplicate validation request, or alternate endpoint request.
- A clean pass requires one transport attempt. A retry-success result is evidence requiring governance review; it is not a clean pass.
- Any transport attempt count greater than one, any failure, any malformed result, or any policy denial stops the runner and prohibits a same-session retry.

## Wallet Boundary And Runtime Injection

The future runner accepts one later-injected environment slot, `BITGO_TEST_WALLET_ID`. This contract does not request, read, validate against, or record its value.

- The wallet identifier is runtime-only and must never be committed, printed, included in a report, used as a correlation ID, or placed in a fixture.
- Future durable evidence may contain only `SHA-256(walletId)` and fixed safe metadata.
- The runner must reject absent, malformed, whitespace-padded, or noncanonical wallet input before credential resolution and before network access.
- No wallet listing, discovery, search, generation, creation, address creation, transfer, transaction request, or write is permitted.

## Token Provisioning And Credential Boundary

The intended future token scope is only `wallet_view:<walletId>`. Broad viewing, wallet spend, wallet manage, transaction, transfer, address, policy, webhook, administrative, user-management, and any other scope are prohibited.

Token provisioning is user-controlled and out of band. The P6-T06 runner and application path do not create, request, read, activate, paste, rotate, revoke, inspect, or transmit a token. They prohibit `POST /api/v2/user/accesstoken`, login automation, OTP automation, token extraction, and token disclosure in chat, except for the separately governed prerequisite defined in the amendment below.

The future runtime secret slot is `BITGO_TEST_ACCESS_TOKEN`. Only the P6-T04 credential resolver may resolve it. The future runner and P6-T05 adapter must not read it directly, serialize it, construct an Authorization header, log it, hash it, or expose it to a test harness.

### P6-T06 Token Provisioning Prerequisite Amendment

- Prior canonical contract SHA-256: `577C67F07780EBF26DDA902B235DCFEFFEAD74902928B5700E955728D6FBF359`
- Prior canonical merge SHA: `376c5c55dc2089a85e5a39e543911609ec3a4d16`
- Reopen governance: `P6_T06_CONTRACT_REOPEN_GOVERNANCE_DEFINED`
- Reopen reason: `CURRENT_BITGO_WEB_UI_DOES_NOT_EXPOSE_FROZEN_WALLET_SPECIFIC_VIEW_SCOPE_AND_CANONICAL_CONTRACT_BLOCKS_OFFICIAL_MANUAL_API_PROVISIONING`
- Amendment scope: `TOKEN_PROVISIONING_PREREQUISITE_ONLY`
- Target semantic: `P6_T06_MANUAL_TEST_TOKEN_PROVISIONING_PREREQUISITE_ALLOWED_BUT_REAL_READ_NOT_AUTHORIZED`

`OPERATOR_CONTROLLED_TEST_TOKEN_PROVISIONING` is a separately governed prerequisite action performed directly by an authorized operator outside the P6-T06 qualification runner and application path. It may use only the BitGo TEST authentication and token-management endpoints necessary to obtain one least-privilege P6-T06 qualification credential. It is not qualification execution, wallet observation, balance observation, runner behavior, application integration, unattended provisioning, or production provisioning.

The runner, application code, Codex-controlled processes, repository scripts, and services MUST NOT create tokens. Automated or unattended provisioning and production token creation remain prohibited. A separately authorized `OPERATOR_CONTROLLED_TEST_TOKEN_PROVISIONING` step MAY invoke the BitGo TEST Create Access Token endpoint exactly once. This amendment alone does not authorize that provisioning step.

Runner login, application login, Codex-controlled login, unattended login, automated login, and production login are prohibited. A separately authorized operator-controlled local TEST provisioning step MAY perform only the minimum manual TEST authentication required to obtain short-lived authorization for token creation. OTP automation, script reading or generation of OTP, Codex receipt of OTP, and governance output containing OTP are prohibited. The operator may manually enter authentication material locally only when separately authorized.

When separately authorized, provisioning may use only the BitGo TEST authentication endpoint necessary for short-lived authorization and the BitGo TEST Create Access Token endpoint. It MUST NOT call `GET /api/v2/tsol/wallet/{walletId}`, wallet-listing, balance, transaction, withdrawal, address-generation, staking, Solana RPC, or production endpoints. No provider wallet-read authority is created.

- `LOGIN_LOGICAL_PROVISIONING_ATTEMPTS_MAX = 1`
- `CREATE_TOKEN_LOGICAL_PROVISIONING_ATTEMPTS_MAX = 1`
- Automatic retry and immediate manual retry under the same provisioning authorization are prohibited.
- Any provisioning failure requires `STOP_FOR_GOVERNANCE_REVIEW`.
- Token provisioning does not consume `MAX_LOGICAL_QUALIFICATION_INVOCATIONS`; after either provisioning success or failure, the qualification-read budget remains `1 / 0 / 1`.

The primary token scope remains exactly `wallet_view:<authorizedWalletId>`. `wallet_view_all`, `wallet_view_enterprise`, `all`, and any broader wallet-view authority are prohibited. `permittedWallets` MUST NOT substitute for the primary scope requirement. The token must have `admin = false`; wallet spend, manage, create, edit, approve, freeze, stake, trade execution, settlement write, enterprise administration, and production authority are prohibited.

- `MAX_QUALIFICATION_TOKEN_DURATION_SECONDS = 86400` (24 hours maximum). A duration rejection requires `STOP_FOR_GOVERNANCE_REVIEW`; it must not be increased automatically.
- TEST qualification-token IP restriction is optional. Its absence alone does not invalidate P6-T06 and has no production-policy implication.

Account identifier or email, password, OTP, short-lived authentication token, long-lived qualification token, Authorization header, and raw token-creation response are protected secret material. They MUST NOT enter ChatGPT, Codex-visible output, Git, repository files, reports, stdout, stderr, or persistent logs.

Authorized provisioning, if later granted, occurs only in a dedicated operator-controlled local process or session. Secret input is manual only and secret storage is process or session memory only. `.env`, repository secret files, and permanent user or machine environment persistence are prohibited unless separately re-governed.

`SHORT_LIVED_TOKEN_TRANSIENT_ONLY` applies: the short-lived token is never printed or persisted, is used only for one token-creation request, is cleared immediately afterward, is never passed to the P6-T06 runner, and is never assigned to `BITGO_TEST_ACCESS_TOKEN`. The resulting least-privilege qualification token may be placed directly into `BITGO_TEST_ACCESS_TOKEN` only inside the dedicated operator session. It is never printed, persisted, sent to governance, or raw-response serialized; temporary response and token intermediaries are cleared. P6-T04 credential resolution MUST NOT be invoked during provisioning.

The separately authorized operator process MAY validate locally and in memory that the returned scope equals the exact expected wallet-specific scope and, if exposed, that `admin == false`. Governance output may contain only sanitized confirmations such as `TOKEN_SCOPE_EXACT=CONFIRMED` and `TOKEN_ADMIN_FALSE=CONFIRMED`; no raw token or raw scope representation containing a wallet identifier may be persisted.

Authentication failure, token-creation failure, scope mismatch, admin mismatch, or secret-handling failure requires a stop, transient-secret cleanup where possible, no broader UI-permission fallback, no retry, and no qualification-runner execution. The BitGo web UI exposing `Wallet - View all` does not authorize its use for P6-T06.

For this amendment, out of band means outside the qualification runner and application path, under direct operator control, and separately governed. It does not require zero network activity and does not permit unattended automation. The runner command `node --conditions=react-server scripts/qualify-p6-t06-first-bitgo-test-read.mjs` MUST NOT log in, create or refresh tokens, inspect token scope, receive password or OTP, accept token-creation parameters, or perform provisioning retries. It continues to consume only the symbolic credential reference through canonical P6-T04 during a later explicitly authorized real execution.

Successful provisioning alone does not authorize the P6-T06 runner, P6-T04 credential resolver, wallet GET, balance observation, provider DNS/TLS/HTTP for the qualification read, production, writes, or signing. A later explicit execution authorization remains mandatory.

## Required Future Runner

The required future execution surface is a dedicated server-only one-shot runner at:

```text
scripts/qualify-p6-t06-first-bitgo-test-read.mjs
```

This exact path is frozen after repository convention inspection: existing qualification runners are executable Node `.mjs` programs under `scripts/`, including P6-T04 and P6-T05 qualification harnesses.

The runner must call the canonical P6-T05 adapter and P6-T04 transport. It must not own or bypass endpoint selection, DNS, connection plan, TLS, SNI, certificate validation, authentication header creation, credential resolution, retry implementation, raw response parsing, or provider security audit normalization.

The runner must not use direct `fetch`, Axios, curl, BitGoJS, direct `https` requests, a direct provider SDK, or Solana RPC. It must not invoke any endpoint other than the frozen P6-T05 descriptor through P6-T04.

## Preflight Contract

Before any credential resolution or network attempt, the future runner must prove all of the following in memory and emit only sanitized booleans/codes:

1. Explicit later authorization marker is supplied.
2. In-process one-shot guard is unused and then atomically consumed.
3. Environment is TEST, provider is BITGO, chain is SOLANA, and coin is `tsol`.
4. Production endpoint, production environment, and `sol` are absent from the execution path.
5. `BITGO_TEST_WALLET_ID` is present, trimmed, and matches the P6-T05 canonical wallet shape.
6. Credential reference is TEST-only, provider-bound, active or rotating, and present without reading a secret.
7. The P6-T04 endpoint registry resolves `BITGO_TEST` only.
8. P6-T05 and P6-T04 predecessor hashes match the frozen values recorded by the later execution gate.
9. No direct network client, proxy override, redirect option, or provider SDK is configured.
10. Sanitized output destination is available and cannot contain raw provider values.

Preflight failure produces no credential resolution and no network attempt.

## Network Security And Success Semantics

The sole future request must retain P6-T04 properties: destination allowlisting before credential resolution, DNS resolution and global-address validation, pinned connection lookup, TLS with SNI and certificate validation, no proxy agent, no redirects, bounded response parsing, secret redaction, bounded audit metadata, and no caller-created Authorization header.

Clean success requires all of the following:

1. one logical invocation and one P6-T04 transport attempt;
2. HTTP success accepted by P6-T04;
3. response identity exactly matches the runtime wallet identifier without printing either value;
4. response coin is exactly `tsol`;
5. `balanceString` and `spendableBalanceString` are canonical nonnegative atomic-unit strings accepted by P6-T05;
6. provider health becomes `AVAILABLE`;
7. the only created semantic value is `BALANCE_OBSERVATION`;
8. no write, signing, transfer, wallet mutation, token mutation, or production contact occurs.

No balance relation beyond P6-T05 validation is asserted. The runner must not treat a balance as a financial reconciliation, custody approval, or authorization for further work.

## Privacy, Evidence, And Failure Handling

Raw wallet identifiers, access tokens, Authorization values, provider bodies, provider raw errors, balances, headers, private keys, seed phrases, and correlation identifiers are prohibited from stdout, stderr, files, Git, reports, and chat.

Permitted evidence is limited to sanitized outcome code, attempt count, endpoint ID, environment class, coin class, response semantic field-presence booleans, provider health class, error class/code, safe status class, byte-count class, and `SHA-256(walletId)` after the future call. No raw balance may be persisted or reported.

Any non-clean outcome is a stop condition: preflight failure, credential failure, policy denial, DNS/TLS/redirect failure, timeout, retry, HTTP failure, malformed response, mismatched identity, wrong coin, malformed amount, unexpected output, or cleanup failure. There is no retry, no scope broadening, no production fallback, and no automatic successor task.

The runner's stdout schema must be a single sanitized structured record containing: task ID, result classification, logical invocation count, transport attempt count, endpoint class, environment class, coin class, wallet hash presence, health class, semantic result class, safe error code or null, and cleanup result. Values outside this allowlist are forbidden.

The later report path is frozen as:

```text
docs/09-governance/P6_T06_FIRST_REAL_BITGO_TEST_READ_QUALIFICATION_REPORT.md
```

That report must not be created by this step. A later report may record only permitted sanitized evidence and the wallet SHA-256 digest.

## Future Gate Sequence

The only allowed ordering is:

1. P6-T06 contract definition.
2. Dedicated runner design.
3. Dedicated runner implementation.
4. Offline qualification.
5. Execution-readiness review.
6. Explicit first-call authorization.
7. One real TEST read.
8. Sanitized evidence review and report.
9. `POST_FIRST_REAL_READ_INTEGRATION_GOVERNANCE_ONLY`.

Successful execution creates no successor task ID and grants no normal runtime integration, periodic job, observer activation, production authority, write authority, token expansion, or wallet discovery authority.

## Dependency And Database Policy

- Package changes: `0`.
- Dependency additions or upgrades: `0`.
- Database calls, migrations, resets, fixtures, or writes: `0`.
- Supabase use: `0`.
- Production application source changes in this contract-definition step: `0`.

## Contract Invariants

- R01. Environment is TEST only.
- R02. Provider is BITGO only.
- R03. Chain is SOLANA only.
- R04. Coin is `tsol` only.
- R05. Production host use is prohibited.
- R06. Production coin `sol` is prohibited.
- R07. One logical invocation is the maximum.
- R08. P6-T04 `MAX_TOTAL_ATTEMPTS = 3` is the only retry ceiling.
- R09. A retry-success outcome is not a clean pass.
- R10. No runner-owned retry loop is allowed.
- R11. Only the frozen GET descriptor is allowed.
- R12. Only `BALANCE_OBSERVATION` semantic output is allowed.
- R13. No write, signing, transfer, payout, or withdrawal is allowed.
- R14. No wallet discovery or wallet mutation is allowed.
- R15. The wallet identifier is runtime-only.
- R16. Evidence uses only `SHA-256(walletId)` for wallet identity.
- R17. No raw balance is stored or printed.
- R18. No raw provider body or raw error is stored or printed.
- R19. Token provisioning is out of band and user-controlled.
- R20. `BITGO_TEST_ACCESS_TOKEN` is resolver-only.
- R21. The runner never creates an Authorization header.
- R22. Destination validation precedes credential resolution.
- R23. P6-T04 DNS, TLS/SNI, certificate, redirect, proxy, and bounded-response controls remain mandatory.
- R24. No direct HTTP client, BitGo SDK, or Solana RPC is allowed.
- R25. Preflight failure makes zero credential reads and zero network attempts.
- R26. A failure stops execution with no automatic retry or fallback.
- R27. The runner is server-only and one-shot guarded in process.
- R28. Stdout/stderr use the sanitization allowlist only.
- R29. No database, dependency, or package work belongs to P6-T06 execution.
- R30. A successful read grants no production, write, or normal runtime authority.

## Exit Criteria

1. This file is the only artifact created by the contract-definition step.
2. The task ID is exactly `P6-T06`.
3. The task state is `DEFINED_NOT_STARTED`.
4. The scope identifies BITGO, SOLANA, BITGO_TEST, and `tsol`.
5. The official source URL and retrieval date are recorded.
6. The endpoint descriptor is frozen as GET wallet with `includeBalance=true`.
7. The descriptor contains a placeholder, not a real wallet identifier.
8. The first-read definition allows one logical invocation.
9. The maximum logical invocation constant is recorded as one.
10. The P6-T04 transport cap is recorded as three.
11. No additional retry is permitted.
12. Clean pass requires one transport attempt.
13. Retry success is routed to review rather than clean success.
14. The wallet runtime slot name is recorded without a value.
15. Wallet SHA-256 evidence is permitted only after a future call.
16. Raw wallet evidence is prohibited.
17. Token scope is narrowed to the intended wallet-view template.
18. Broad view scope is prohibited.
19. Spend and management scope are prohibited.
20. Runner and application token-creation endpoint use is prohibited; only the separately governed operator-controlled TEST prerequisite may be authorized.
21. Login and OTP automation are prohibited.
22. Token disclosure in chat is prohibited.
23. The runtime token slot is named without a value.
24. P6-T04 is the sole credential resolver authority.
25. Direct Authorization construction is prohibited.
26. Production hostname use is prohibited.
27. Production coin use is prohibited.
28. Production fallback is prohibited.
29. The runner path is frozen.
30. The runner is server-only.
31. The runner must call P6-T05.
32. The runner must call P6-T04.
33. The runner cannot own endpoint selection.
34. The runner cannot own DNS or TLS.
35. The runner cannot own response parsing.
36. Direct provider HTTP clients are prohibited.
37. Solana RPC is prohibited.
38. Preflight precedes credential resolution.
39. Preflight precedes network access.
40. Destination validation precedes credential resolution.
41. DNS global-address validation remains required.
42. TLS/SNI/certificate validation remains required.
43. Redirects remain blocked.
44. Proxy use remains blocked.
45. Successful response identity must match without disclosure.
46. Successful response coin must equal `tsol`.
47. Balance fields must preserve string semantics.
48. Provider health must be `AVAILABLE` for clean success.
49. Only `BALANCE_OBSERVATION` is accepted as semantic output.
50. Raw balance persistence is prohibited.
51. Raw provider response persistence is prohibited.
52. Raw provider error persistence is prohibited.
53. Sanitized stdout schema is defined.
54. Any failure is terminal for the session.
55. Scope broadening is prohibited after failure.
56. One-shot guard use is required.
57. The later report path is frozen but absent now.
58. Post-success direction remains governance-only.
59. No successor task ID is created by success.
60. Dependencies and database work remain zero.
61. P6-T04 reuse is recorded as unchanged.
62. P6-T05 runtime wiring gap is recorded.
63. All R01-R30 invariants are present.
64. Any later change, including formatting, requires governance reopen after the contract hash is recorded.

## Immutability

After this document's SHA-256 is recorded, it is immutable. Any content change, including whitespace, formatting, links, headings, or metadata, requires an explicit governance reopen and a newly approved contract hash. This rule prevents a later execution gate from silently changing authority, evidence, or invocation limits.

## Contract-Definition Completion Marker

When this document alone is created, validated for the stated invariants and exit criteria, and found free of actual wallet identifiers, token values, Authorization values, private keys, seed phrases, and real balance values, the correct marker is:

```text
PASS_PHASE6_FIRST_REAL_BITGO_TEST_READ_GOVERNANCE_STEP_15_P6_T06_CONTRACT_DEFINED
```

The next allowed direction is:

```text
READY_FOR_PHASE6_FIRST_REAL_BITGO_TEST_READ_GOVERNANCE_STEP_16_RUNNER_DESIGN
```
