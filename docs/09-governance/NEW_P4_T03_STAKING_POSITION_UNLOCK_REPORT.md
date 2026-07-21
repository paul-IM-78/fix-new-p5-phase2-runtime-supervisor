# NEW-P4-T03 Staking Position Unlock Report

## Baseline

- Repository: `D:\Ai\staking-wallet-web`
- Start branch: `feat/new-p4-staking-position-lock`
- Start HEAD: `b3f51bb814a8f206239049d58193f44bd9882078`
- Work branch: `feat/new-p4-staking-position-unlock`
- Legacy repository: `D:\Ai\Staking-Wallet`
- Legacy access: read-only clean-state check only

## Implemented

- Added forward-only migration `20260721042827_init_staking_position_unlock.sql`.
- Extended `private.staking_positions` with unlock journal, actor, and timestamp
  fields.
- Added the only supported position transition: `LOCKED -> UNLOCKED`.
- Added `USER_STAKING_POSITION_UNLOCKED` and
  `ADMIN_STAKING_POSITION_UNLOCKED` posting paths through the existing private
  posting primitive.
- Reused the existing staking position command advisory lock namespace:
  `staking-wallet-web:staking-position-command:v1`.
- Extended immutable staking position command audit with actor type, previous
  status, APPLIED unlock, and NOOP unlock events.
- Added user and AAL2 admin unlock RPCs.
- Extended user/admin read RPCs with database-derived maturity state and unlock
  summaries.
- Added generated public database types for the new RPC surface.
- Added server-only user/admin RPC wrappers.
- Added same-origin POST routes for user and admin unlock commands.
- Updated `/staking` and `/admin/staking-positions` to show maturity and
  unlock controls only when eligible.
- Added pgTAP and local E2E coverage for maturity unlock.

## Files Changed

- `package.json`
- `README.md`
- `supabase/migrations/20260721042827_init_staking_position_unlock.sql`
- `supabase/tests/database/staking_position_unlock.test.sql`
- `src/types/database.types.ts`
- `src/lib/staking/validation.ts`
- `src/lib/staking/public-results.ts`
- `src/server/staking/current-staking.ts`
- `src/server/staking/staking-position-commands.ts`
- `src/server/admin/staking-position-reads.ts`
- `src/server/admin/staking-position-commands.ts`
- `src/app/staking/page.tsx`
- `src/app/admin/staking-positions/page.tsx`
- `src/app/api/v1/staking/positions/unlock/route.ts`
- `src/app/api/v1/admin/staking-positions/unlock/route.ts`
- `scripts/staking/staking-position-unlock.local.mjs`
- `docs/07-staking/STAKING_POSITION_AND_PRINCIPAL_LOCK.md`
- `docs/07-staking/STAKING_POSITION_MATURITY_AND_UNLOCK.md`
- `docs/05-operations/PHASE4_STAKING_GATE.md`
- `docs/09-governance/NEW_P4_T03_STAKING_POSITION_UNLOCK_REPORT.md`

No existing migration was modified. `supabase/tests/database/staking_position_lock.test.sql`
was not modified because the existing test continued to pass.

## Security Boundary

- No Service Role client was added.
- No direct browser access to private ledger or staking tables was added.
- No remote Supabase project was linked.
- No production credential was created or changed.
- No Solana, wallet adapter, private key, mnemonic, client signing, or mainnet
  path was added.
- Redirect query strings use safe public result codes only.
- Maturity is decided in PostgreSQL database time.
- Unlock commands do not accept principal units, account IDs, ledger sides,
  timestamps, maturity flags, journal IDs, or balances from the browser.

## Validation

- Baseline before changes: `npm run db:test:local` PASS, 13 files / 785 tests.
- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, warning 0
- `npm run db:test:local`: PASS, 14 files / 811 tests
- `npm run db:types:local`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run test:phase3:closeout:local`: PASS
- `npm run test:staking:products:local`: PASS
- `npm run test:staking:positions:local`: PASS
- `npm run test:staking:position-unlock:local`: PASS
- Production smoke: PASS
  - `/api/v1/health`
  - `/api/v1/readiness/config`
  - `/`
  - `/dashboard`
  - `/account`
  - `/balances`
  - `/staking`
  - `/admin`
  - `/admin/staking-products`
  - `/admin/staking-positions`

## Notes

- The first pgTAP attempt exposed a test fixture issue: constraints were set to
  immediate and not returned to deferred before invoking the posting primitive.
  The test fixture was corrected; the migration itself reset and linted cleanly.
- Local Supabase CLI start output includes local development default keys. They
  were not copied into source files or documentation.
- The Node-based regression runner used `npm-cli.js` directly because Windows
  Node `execFile('npm.cmd')` returned `spawn EINVAL` in this environment.

## Remaining Out Of Scope

- Reward calculation
- Reward posting
- Reward claim
- APY/APR or expected reward display
- Early unlock
- Partial unlock
- Position cancellation
- Unstaking
- External custody proof
- On-chain staking
- Remote Supabase
- Production deployment

## Final Status

PASS. The change is ready for review and later commit approval. No staging,
commit, push, pull request, or main merge was performed.
