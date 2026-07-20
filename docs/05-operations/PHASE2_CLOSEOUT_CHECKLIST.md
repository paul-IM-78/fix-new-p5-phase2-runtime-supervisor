# Phase 2 Closeout Checklist

## Auth

| Item | Status | Residual |
| --- | --- | --- |
| Signup | PASS | Local Supabase and Mailpit only |
| Email confirmation | PASS | One-shot token confirmation flow |
| Login | PASS | Safe redirect allowlist only |
| Logout | PASS | Same-origin POST |
| Password recovery | PASS | Recovery token consumed only in password update POST |
| Account status guard | PASS | ACTIVE profile required for protected user reads |

## Admin

| Item | Status | Residual |
| --- | --- | --- |
| ADMIN role | PASS | Local bootstrap remains a controlled test operation |
| TOTP AAL2 | PASS | Recovery codes and factor removal are not implemented |
| Role grant and revoke | PASS | AAL2 command boundary only |
| Immutable admin audit | PASS | Append-only database audit |

## Domain

| Item | Status | Residual |
| --- | --- | --- |
| Project metadata | PASS | No production catalog rows |
| Supported asset metadata | PASS | No real mint or production asset examples |
| Project token assignment | PASS | Current and retired metadata only |
| Active project invariant | PASS | Database invariant plus dashboard fail-closed check |
| Lifecycle commands | PASS | AAL2 ADMIN only |
| Domain audit | PASS | Immutable database audit |

## Wallet

| Item | Status | Residual |
| --- | --- | --- |
| Managed wallet provisioning | PASS | Auth signup provisions a container row |
| Wallet status | PASS | ACTIVE, FROZEN, and CLOSED operational states |
| Wallet audit | PASS | Immutable database audit |
| Catalog and wallet RLS | PASS | ACTIVE profile required |

## User Pages

| Item | Status | Residual |
| --- | --- | --- |
| Dashboard | PASS | Integrated profile, wallet state, active catalog, and empty states |
| Account | PASS | Navigation includes dashboard, catalog, and wallet |
| Catalog | PASS | Anonymous redirect preserves `/catalog` |
| Wallet | PASS | Anonymous redirect preserves `/wallet` |

## Security

| Item | Status | Residual |
| --- | --- | --- |
| Service role absent | PASS | No application service-role client |
| Remote Supabase absent | PASS | Local stack only |
| Mainnet absent | PASS | No production or mainnet credential |
| Private key absent | PASS | No browser or server key custody material |
| Browser financial write absent | PASS | No financial mutation UI or API |
| Same-origin POST boundary | PASS | Auth and admin commands reject cross-site forms |
| Safe redirect | PASS | `/`, `/account`, `/dashboard`, `/catalog`, `/wallet`, `/admin` only |
| AAL2 admin command | PASS | Role, domain, and wallet commands require AAL2 |
| Command ID | PASS | Idempotent command replay boundary |
| Expected version | PASS | Wallet status commands enforce concurrency |
| Append-only audit | PASS | Admin, domain, and wallet audit events are immutable |
| Active profile RLS | PASS | Inactive profiles read zero catalog and wallet rows |

## Phase 3 Entry Guard

| Item | Status | Residual |
| --- | --- | --- |
| Balance | Not implemented | Requires Phase 3 ledger design |
| Ledger | Not implemented | No journal or double-entry tables |
| Deposit | Not implemented | No deposit address or funding flow |
| Withdrawal | Not implemented | No withdrawal command or payout flow |
| Staking | Not implemented | No staking product or position model |
| Reward | Not implemented | No reward calculation |
| Blockchain transaction | Not implemented | No on-chain send or signing |
| Address | Not implemented | No blockchain address display |
| Mainnet credential | Not implemented | Local-only configuration |
