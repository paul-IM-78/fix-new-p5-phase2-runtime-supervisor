# NEW-P3-T01 Double-Entry Ledger Core Report

## Baseline

- Start branch: `feat/new-p2-user-dashboard-closeout`
- Start commit: `eaf666fcd3c90f0fca39dc15d2b728596040149a`
- Work branch: `feat/new-p3-double-entry-ledger-core`
- Legacy repository: clean, read-only checked

## Files

- `package.json`
- `README.md`
- `supabase/migrations/20260720090000_init_double_entry_ledger_core.sql`
- `supabase/tests/database/double_entry_ledger_core.test.sql`
- `src/types/database.types.ts`
- `scripts/ledger/ledger-core.local.mjs`
- `docs/06-ledger/DOUBLE_ENTRY_LEDGER_CORE.md`
- `docs/05-operations/PHASE3_LEDGER_GATE.md`
- `docs/09-governance/NEW_P3_T01_DOUBLE_ENTRY_LEDGER_CORE_REPORT.md`

## Ledger Objects

- Atomic unit domain: implemented as `private.positive_atomic_units`
- Ledger accounts: implemented as `private.ledger_accounts`
- Journals: implemented as `private.ledger_journals`
- Entries: implemented as `private.ledger_entries`
- Account balance view: implemented as `private.ledger_account_balances`
- Wallet asset balance view: implemented as `private.wallet_asset_ledger_balances`
- User account provisioning: implemented as `private.ensure_wallet_asset_ledger_accounts(uuid, uuid)`
- System account provisioning: implemented as `private.ensure_system_ledger_accounts(uuid)`
- Posting primitive: implemented as `private.post_ledger_journal(...)`
- Current user balance RPC: implemented as `public.list_current_user_ledger_balances()`

## Controls

- Amount boundary: decimal digit strings at RPC/script boundaries
- Precision: exact PostgreSQL numeric, positive integer, maximum 38 digits
- JavaScript `Number` for posting amounts: not used
- Canonical request: command ID plus canonical line order
- Replay: same command and canonical request returns the existing journal
- Conflict: same command with different data is rejected
- Advisory lock: global transaction advisory lock for posting
- Row lock: account rows locked in sorted UUID order
- Debit and credit: at least one of each, sums must match
- Single asset: all accounts must match the journal asset
- Negative user balance: rejected before insert and by deferred invariant
- Journal and entry mutation: blocked by immutable triggers
- Deferred constraint: validates invalid owner-level direct inserts

## Access Boundary

- Private ledger table direct grants to `anon`: none
- Private ledger table direct grants to `authenticated`: none
- Private helper execute grants to `anon`: none
- Private helper execute grants to `authenticated`: none
- Public financial write RPC: none
- Balance read RPC: `authenticated` only
- Service role client: not added
- Remote Supabase: not connected
- Mainnet: not connected
- Real asset seed data: not added

## Validation

- Baseline DB reset before work: PASS
- Baseline DB lint before work: PASS
- Baseline pgTAP before work: PASS, 6 files / 425 tests
- New DB lint after migration: PASS, warning 0
- New pgTAP after migration: PASS, 7 files / 501 tests
- Generated public database types: PASS
- Private ledger tables/functions in generated public types: not present
- Ledger core E2E: PASS
- Existing E2E suite: PASS
  - Auth Route E2E: PASS
  - ADMIN MFA E2E: PASS
  - ADMIN Role Command E2E: PASS
  - Domain Lifecycle E2E: PASS
  - Wallet Status E2E: PASS
  - Phase 2 Closeout E2E: PASS
- Next.js lint: PASS, warning 0
- Next.js build: PASS, warning 0
- Production route smoke: PASS
- Final DB reset: PASS after one transient retry while the local project vector container restarted
- Final DB lint: PASS, warning 0
- Final pgTAP: PASS, 7 files / 501 tests
- Final generated types: PASS
- Final QA database residue: 0 auth users, 0 profiles, 0 roles, 0 projects, 0 assets, 0 assignments, 0 wallets, 0 ledger accounts, 0 journals, 0 entries
- Local stack shutdown: PASS, no project containers remaining and no LISTEN state on port 3000 or 55721-55724
- npm audit status: 0 low, 2 moderate, 0 high, 0 critical

## Known Non-Implemented Items

- Deposit request schema
- Deposit confirmation command
- Withdrawal request
- Withdrawal reservation
- Staking lock command
- Reward posting command
- Balance UI
- Production asset seed data
- On-chain settlement

## Security Scan

No actual email, password, token, cookie, private key, mnemonic, service-role
key, database URL, mainnet identifier, real wallet address, transaction ID,
operating amount, balance, or APY is intentionally written to tracked files.
QA UUIDs, QA asset codes, `example.test` addresses, and QA atomic unit strings
are deterministic local test fixtures only.

Secret scan false positives are marker strings used by tests and reports to
assert that secrets are absent. No actual secret value was found.

## Gate

Phase 3 ledger gate: PASS.

Commit status: not staged and not committed.
