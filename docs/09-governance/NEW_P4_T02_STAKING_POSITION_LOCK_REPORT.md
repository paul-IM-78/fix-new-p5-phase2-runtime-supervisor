# NEW-P4-T02 Staking Position Lock Report

## Baseline

- Starting branch: `feat/new-p4-staking-product-domain`
- Starting HEAD: `ec129219a911bf175a23ddb33472a00d9792933e`
- Working branch: `feat/new-p4-staking-position-lock`
- Legacy repository: checked read-only; no branch change and no file change.

## Implemented

- Added migration `20260721023627_init_staking_position_lock.sql`.
- Added `private.staking_positions` for immutable `LOCKED` positions.
- Added `private.staking_position_command_audit_events` for immutable position
  command audit.
- Added user position create RPC with principal lock posting.
- Added user position read RPC.
- Added AAL2 ADMIN position and position-audit read RPCs.
- Added `/staking` principal-lock form and owned-position list.
- Added `/admin/staking-positions` read-only operational review.
- Added same-origin POST route `/api/v1/staking/positions/create`.
- Added local E2E script `test:staking:positions:local`.

## Database Boundary

- Position table: `private.staking_positions`
- Audit table: `private.staking_position_command_audit_events`
- Status created: `LOCKED`
- Principal type: exact private atomic-unit numeric domain
- Position IDs: caller-supplied UUIDs
- Command IDs: caller-supplied UUIDs
- Direct `public`, `anon`, and `authenticated` table access: revoked
- Service Role: not added
- Browser private table access: not added

## Ledger Posting

Position creation posts one private journal:

```text
Journal type: USER_STAKING_POSITION_LOCKED
Initiator:    USER
Reference:    STAKING_POSITION
```

Entries:

```text
DEBIT  USER_AVAILABLE
CREDIT USER_LOCKED
```

Validated result:

- Available units decrease.
- Locked units increase.
- Total liability remains unchanged.
- System account entries remain zero.
- Reward expense entries remain zero.

## Controls

- Transaction advisory lock:
  `staking-wallet-web:staking-position-command:v1`
- Product expected version: enforced
- Wallet expected version: enforced
- Active product: enforced
- Open enrollment window: enforced
- Active current project token: enforced
- Per-position minimum and maximum principal: enforced
- Available balance precheck: enforced
- Multiple positions for the same user and product: allowed
- Replay: returns the original position without duplicate journal, entries, or
  audit.
- Conflict: returns `STAKING_POSITION_COMMAND_ID_CONFLICT`.

## Invariants

- Core insert validation: present.
- Position update: blocked.
- Position delete and truncate: blocked.
- Deferred position/journal invariant: present and `security definer`.
- Position audit update, delete, and truncate: blocked.
- Position, lock journal, ledger entries, and audit are created in the same
  transaction.

## Web Boundary

- `/staking` requires an authenticated active account.
- `/staking` displays products, available/locked balance summaries, and owned
  locked positions.
- `/staking` exposes no wallet address, transaction ID, reward estimate, APY,
  APR, unlock, claim, or on-chain staking control.
- `/admin/staking-positions` requires AAL2 ADMIN access and is read-only.
- Same-origin rejection was validated for missing Origin, external Origin, and
  cross-site fetch metadata.

## Validation Results

- `npm run db:reset:local`: PASS
- `npm run db:lint:local`: PASS, error 0, warning 0
- `npm run db:test:local`: PASS, 13 files / 785 tests
- `npm run db:types:local`: PASS
- `npm run lint`: PASS, warning 0
- `npm run build`: PASS
- `npm run test:phase3:closeout:local`: PASS
- `npm run test:staking:products:local`: PASS
- `npm run test:staking:positions:local`: PASS
- Final DB reset after E2E: PASS
- Final generated types: PASS
- Production smoke routes in local E2E: PASS for health, readiness, landing,
  anonymous staking redirect, and anonymous admin position redirect.

## Security Result

- Actual Secret: not added.
- Service Role key: not added.
- Database URL: not added.
- Remote Supabase: not connected.
- Mainnet or production credential: not added.
- Solana, wallet adapter, private key, mnemonic, seed phrase, and client
  signing paths: not added.
- Audit read RPCs do not expose private request data.
- Redirect queries expose only safe result or error codes.
- Deterministic pgTAP UUIDs, QA principal units, and QA rates are local test
  fixtures only.

## Advisory Result

- `npm audit --json`: moderate 2, high 0, critical 0.
- The existing moderate advisories are `next` via bundled `postcss`.
- `npm audit fix` was not run.
- Dependency versions were not changed.
- `package-lock.json` was not changed.

## Local Runtime Result

- Local Supabase stack was stopped after validation.
- Project container residue after stop: 0.
- Port listeners after stop for 3000, 3010, and 55721-55724: 0.
- Phase 3 closeout required one bounded local Kong restart and then passed.
- Docker bind warning: none observed in final validation output.

## Residual Scope

- Maturity command: not implemented.
- Principal unlock: not implemented.
- Position cancel: not implemented.
- Reward calculation: not implemented.
- Reward posting: not implemented.
- Reward claim: not implemented.
- APY/APR or expected reward display: not implemented.
- On-chain staking, wallet address collection, transaction ID storage, private
  key, mnemonic, and client signing: not implemented.

## Final Status

PASS. Commit is not performed by this task.
