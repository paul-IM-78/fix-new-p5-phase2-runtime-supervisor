# NEW-P4-T04 Staking Reward Settlement Report

## Baseline

- Start branch: `feat/new-p4-staking-position-unlock`
- Start commit: `dd9b1229c242fef202350d1da829075c28357169`
- Work branch: `feat/new-p4-staking-reward-settlement`
- Legacy repository: `D:\Ai\Staking-Wallet`
- Legacy repository change: none

## Migration

- Migration file:
  `supabase/migrations/20260721061825_init_staking_reward_settlement.sql`
- Existing migrations were not modified.
- Supabase remote, production, mainnet, and service-role application access
  were not used.

## Reward Calculation

- Function:
  `private.calculate_staking_reward_units(numeric, integer, text)`
- Arithmetic: PostgreSQL exact `numeric`
- Formula:
  `floor(principal_units * term_reward_rate_ppm_snapshot / 1,000,000)`
- Rounding: `FLOOR` only
- Source: immutable `private.staking_positions` snapshot fields only
- JavaScript `Number`: not used for reward calculation
- Current product status, current product version, current enrollment state,
  and current product reward rate are not used for settlement calculation.

## Settlement Model

- Table: `private.staking_position_reward_settlements`
- Position uniqueness: `staking_position_id unique`
- Outcomes: `PAID`, `ZERO`
- Actor types: `USER`, `ADMIN`
- Positive reward posting:

```text
DEBIT  SYSTEM_REWARD_EXPENSE
CREDIT USER_AVAILABLE
```

- Zero reward creates a settlement row without a journal or ledger entries.
- Principal and locked units remain unchanged by reward settlement.
- User available units and total liability increase only for positive rewards.
- `private.ensure_staking_reward_expense_account(uuid)` provisions or returns
  the `SYSTEM_REWARD_EXPENSE` account independently of current asset status.

## Invariants And Immutability

- Settlement invariant trigger:
  `private.validate_staking_reward_settlement_invariants()`
- Settlement mutation guard:
  `private.prevent_staking_reward_settlement_mutation()`
- Audit mutation guard:
  `private.prevent_staking_reward_command_audit_mutation()`
- Settlement update, delete, and truncate are blocked.
- Reward audit update, delete, and truncate are blocked.
- Deferred invariant validates:
  position status `UNLOCKED`, immutable snapshots, formula result, journal type,
  initiator, reference, asset, accounts, line count, line sides, units, and
  matching immutable audit.

## Audit

- Table: `private.staking_reward_command_audit_events`
- Action: `SETTLE_STAKING_REWARD`
- Outcomes: `APPLIED`, `NOOP`
- Request data excludes credentials, cookies, tokens, emails, MFA material,
  wallet addresses, transaction identifiers, private keys, mnemonics, and raw
  balance snapshots.
- Read RPC:
  `public.list_staking_reward_command_audit_events(integer, uuid)`
- Admin reward audit read requires AAL2.

## Commands

- User RPC:
  `public.settle_current_user_staking_reward(uuid, bigint, bigint, uuid)`
- Admin RPC:
  `public.settle_staking_reward_as_admin(uuid, bigint, uuid, text)`
- Both are `SECURITY DEFINER` with explicit `search_path = ''`.
- Both are granted to `authenticated` only.
- Both reuse the existing staking position advisory lock namespace:
  `staking-wallet-web:staking-position-command:v1`
- User command requires active profile, caller-owned position, active managed
  wallet, position expected version, and wallet expected version.
- Admin command requires active ADMIN plus AAL2 and position expected version.
- Admin settlement is allowed for inactive target profile, frozen target wallet,
  suspended product, suspended project, and suspended asset when existing
  ledger accounts remain valid.
- Replay, NOOP, conflict, concurrent replay, and cross-boundary command ID
  collision were validated.

## Read And UI

- `public.list_current_user_staking_positions(integer)` now returns reward
  state, calculated reward units, reward settled timestamp, and actor type.
- User read omits reward settlement ID, reward journal ID, settled-by ID,
  request data, and private ledger account IDs.
- `public.list_admin_staking_positions(integer, text)` now returns settlement,
  outcome, actor, settled-by, and journal identifiers for AAL2 operational
  review.
- `/staking` shows reward state and database-calculated reward units.
- `/staking` exposes a same-origin reward settlement form only for
  `UNLOCKED` and `CLAIMABLE` positions with an ACTIVE managed wallet.
- `/admin/staking-positions` shows reward state, reward audit summaries, and
  an AAL2 admin settlement form for `UNLOCKED` and `CLAIMABLE` positions.
- Reward units and reward rate input fields were not added.
- Projected yield display, partial rewards, repeated claims, reward reversal,
  daily accrual, compound reward, and on-chain reward were not implemented.

## API

- User API:
  `POST /api/v1/staking/positions/settle-reward`
- Admin API:
  `POST /api/v1/admin/staking-positions/settle-reward`
- Both routes use Node runtime, dynamic execution, same-origin form POST
  validation, and no-store 303 redirects.
- Redirects expose public result or error codes only.
- Redirect query strings do not include IDs, command IDs, versions, units,
  journal IDs, balances, reasons, tokens, cookies, or database errors.

## Test Scope

- Added pgTAP:
  `supabase/tests/database/staking_reward_settlement.test.sql`
- Existing pgTAP guard updated:
  `supabase/tests/database/double_entry_ledger_core.test.sql`
- Reason for existing test update: the prior generic public financial write
  RPC deny-list was name-based and matched the two required public reward
  settlement RPC names.
- R1 added explicit stale-assertion coverage instead of weakening the guard.
- Added local E2E:
  `scripts/staking/staking-rewards.local.mjs`
- Added npm script:
  `test:staking:rewards:local`

## R1 Ledger Core Stale Assertion Review

- Changed test file:
  `supabase/tests/database/double_entry_ledger_core.test.sql`
- Existing assertion name:
  `generic public financial write RPCs stay absent and ledger invariant trigger is hardened`
- Existing assertion line after R1:
  `1670`
- Existing name filter:

```sql
where namespaces.nspname = 'public'
  and procedures.proname !~* '^(list_|post_opening_balance$|reverse_opening_balance$)'
  and procedures.proname ~* '(post_ledger|ledger_post|ledger_journal|ledger_entry|deposit|withdraw|stake|reward)'
```

- Existing expectation before Reward RPCs: no matching public generic
  financial write function.
- Actual result after Reward RPCs:
  `settle_current_user_staking_reward,settle_staking_reward_as_admin`
- Stale function names:
  `settle_current_user_staking_reward`,
  `settle_staking_reward_as_admin`
- Stale assertion determination: yes. The hit was caused by a broad
  `stake|reward` name filter, not by a newly exposed generic ledger posting
  wrapper.

R1 added two narrow pgTAP assertions:

- Line `1596`:
  `legacy public financial write name filter matches only narrow staking reward settlement commands`
- Line `1629`:
  `reward settlement RPCs are narrow authenticated security definer commands, not generic ledger posting wrappers`

The amended generic financial write assertion still allows only:

```text
list_*
post_opening_balance
reverse_opening_balance
settle_current_user_staking_reward
settle_staking_reward_as_admin
```

No broad `staking`, `reward`, `settle`, or authenticated write wildcard was
introduced.

## R1 Reward RPC Security Contract

The two allowed Reward RPCs were verified as narrow product commands:

- `public.settle_current_user_staking_reward(uuid, bigint, bigint, uuid)`
- `public.settle_staking_reward_as_admin(uuid, bigint, uuid, text)`

They do not accept arbitrary:

- Ledger account ID
- Debit or credit side
- Entry line JSON
- Journal type
- Asset ID
- Principal units
- Reward units
- Reward rate
- Balance adjustment value

Both Reward RPCs are:

- `VOLATILE`
- `SECURITY DEFINER`
- `search_path = ''`
- granted to `authenticated`
- not executable by `public`
- not executable by `anon`
- not explicitly granted to service-role

Ledger core boundaries remain intact:

- `private.post_ledger_journal(...)` is not executable by `anon` or
  `authenticated`.
- Private ledger tables are not selectable or writable by browser roles.
- `private.validate_ledger_journal_invariants()` remains
  `SECURITY DEFINER`, `search_path = ''`, and not executable by
  `public`, `anon`, or `authenticated`.
- Generic/manual public ledger posting, manual journal, arbitrary transfer,
  and arbitrary balance adjustment RPCs remain absent.

## Validation

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- Single ledger core pgTAP:
  `npx supabase test db --local supabase/tests/database/double_entry_ledger_core.test.sql`
  PASS, 1 file / 78 tests
- `npm run db:test:local`: PASS, 15 files / 848 tests
- `npm run db:types:local`: PASS
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS, warning 0
- `npm run test:phase3:closeout:local`: PASS
- `npm run test:staking:products:local`: PASS
- `npm run test:staking:positions:local`: PASS
- `npm run test:staking:position-unlock:local`: PASS
- `npm run test:staking:rewards:local`: PASS
- Production smoke:
  health 200, readiness 200, landing 200, protected pages redirect to sign-in.
- Final DB reset/lint/test/types: PASS
- Final QA data residue:
  auth users 0, reward settlements 0, reward audit 0, ledger journals 0,
  ledger entries 0

## Security And Boundary Checks

- Service-role application client: 0
- Service-role key: 0
- Database URL: 0
- JWT, cookie, token, TOTP secret, private key, mnemonic: 0 actual values
- Remote Supabase connection: 0
- Mainnet or production connection: 0
- Solana or wallet package addition: 0
- `package-lock.json` change: 0
- `.env.example`, `.env.local`, `supabase/config.toml`, `supabase/seed.sql`
  change: 0
- Secret marker scan found existing deny-list strings and local test fixture
  markers only; no real secret value was added.
- R1 local Supabase start printed default local development keys. They were
  not copied into source, docs, report output, or environment files and must be
  treated as `[REDACTED]`.

## Advisory And Runtime Notes

- `npm audit --audit-level=high`: PASS for high/critical threshold.
- Existing advisory state remains 2 moderate PostCSS findings through Next.js.
- `npm audit fix` was not run.
- Phase 3 closeout required a bounded Kong restart during readiness checks and
  completed successfully.
- During R1, a db lint and pgTAP test were accidentally run in parallel. That
  concurrent run caused lint to inspect transient pgTAP extension state and
  was discarded. The sequential final run passed with error 0 and warning 0.
- Docker bind warning: not observed during this task.

## Git State

- Staging: not performed
- Commit: not performed
- Push: not performed
- Pull request: not performed
- Commit candidate: yes, after review

## Final Status

PASS
