# NEW-P4-T01 Staking Product Domain Report

## Baseline

- Starting branch: `feat/new-p3-balance-overview-closeout`
- Starting HEAD: `700775926bda0ad9ab1f02d88e6a1cc0e0879ee4`
- Working branch: `feat/new-p4-staking-product-domain`
- Legacy repository: checked read-only; no branch change and no file change.

## Implemented

- Added private staking product schema and immutable staking product admin
  audit.
- Added product lifecycle transition guard and term freeze after first
  activation.
- Added AAL2 admin command RPCs for create, draft update, and status
  transition.
- Added ACTIVE user read RPC for current staking product catalog.
- Added AAL2 admin read RPCs for product rows and audit summaries.
- Added TypeScript validation, safe result mapping, server wrappers, API
  routes, `/staking`, and `/admin/staking-products`.
- Added local E2E script `test:staking:products:local`.
- Added pgTAP coverage in `staking_product_domain.test.sql`.

## Database Boundary

- New table: `private.staking_products`
- New audit table: `private.staking_product_admin_audit_events`
- New command RPCs:
  - `public.create_staking_product`
  - `public.update_staking_product_draft`
  - `public.transition_staking_product_status`
- New read RPCs:
  - `public.list_current_staking_products`
  - `public.list_admin_staking_products`
  - `public.list_staking_product_admin_audit_events`

Direct `public`, `anon`, and `authenticated` table access is revoked.

## Status Machine

- `DRAFT -> ACTIVE`
- `DRAFT -> ARCHIVED`
- `ACTIVE -> SUSPENDED`
- `SUSPENDED -> ACTIVE`
- `SUSPENDED -> ARCHIVED`
- Same status returns `NOOP`
- `ARCHIVED` is terminal

## Ledger Result

Product commands create no ledger accounts, journals, entries, financial audit
events, deposits, withdrawals, balances, positions, or rewards.

## Validation Results

- Baseline DB reset: PASS
- Baseline DB lint: PASS, error 0, warning 0
- Baseline pgTAP: PASS, 11 files / 684 tests
- Baseline generated type diff: 0
- Baseline Next lint/build: PASS
- Final DB lint: PASS, error 0, warning 0
- Final pgTAP: PASS, 12 files / 724 tests
- Final generated types: PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run test:staking:products:local`: PASS
- `npm run test:phase3:closeout:local`: PASS

## Security Result

- Service Role: not added
- Supabase remote project: not connected
- Database URL: not added
- `.env` files: not created
- Solana or wallet packages: not added
- Wallet Adapter: not added
- Private key, mnemonic, seed phrase: not added
- Client signing or transaction sending: not added
- Mainnet or production credentials: not added
- Audit request data is not exposed by admin read RPC.
- Redirect result queries contain only safe result or error codes.

## Follow-Up Gate

Before implementing staking requests, Phase 4 must add a dedicated staking
position and principal lock state machine with double-entry ledger postings,
pgTAP invariants, and local E2E regression.

## Final Status

PASS.
