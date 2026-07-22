# Custody Provider And Account Boundary

## Scope

NEW-P5-T01 introduces the configuration domain for future production custody
integration. It does not connect to a custody vendor, blockchain RPC, webhook,
worker, queue, cron, or payout rail.

The implemented boundary is:

- `private.custody_providers`
- `private.custody_account_bindings`
- `private.custody_config_audit_events`
- AAL2 ADMIN command RPCs for provider and binding draft/upsert and lifecycle
  transitions
- AAL2 ADMIN read RPCs for provider, binding, and audit summaries
- `/admin/custody` and four same-origin admin POST routes

## Provider Registry

Provider rows store non-secret metadata only:

- Provider code
- Display name
- Provider type
- Observation and future capability flags
- Lifecycle status
- Version and timestamps

Provider rows do not store API keys, API secrets, tenant IDs, external account
IDs, URLs, webhook secrets, private keys, seed phrases, wallet addresses, or
transaction identifiers.

Allowed provider types:

- `MPC_CUSTODIAN`
- `QUALIFIED_CUSTODIAN`
- `EXCHANGE_CUSTODY`
- `INTERNAL_HSM`

Allowed statuses:

- `DRAFT`
- `APPROVED`
- `SUSPENDED`
- `RETIRED`

Allowed provider transitions:

- `DRAFT -> APPROVED`
- `DRAFT -> RETIRED`
- `APPROVED -> SUSPENDED`
- `SUSPENDED -> APPROVED`
- `SUSPENDED -> RETIRED`

`APPROVED -> RETIRED` is intentionally blocked. A provider must be suspended
before retirement.

Provider approval requires at least one capability flag. Once a provider has
ever been approved, provider code, display name, provider type, and capability
flags are frozen.

## Account Bindings

Binding rows are internal aliases that connect a provider configuration to a
supported asset and operational role. Binding keys are not external custody
account IDs, wallet addresses, blockchain addresses, transaction IDs,
signatures, hashes, Secret Manager values, or credentials.

Allowed account roles:

- `COLLECTION`
- `PAYOUT`
- `TREASURY`
- `FEE`

Allowed binding statuses match provider statuses:

- `DRAFT`
- `APPROVED`
- `SUSPENDED`
- `RETIRED`

Allowed binding transitions:

- `DRAFT -> APPROVED`
- `DRAFT -> RETIRED`
- `APPROVED -> SUSPENDED`
- `SUSPENDED -> APPROVED`
- `SUSPENDED -> RETIRED`

Binding approval requires:

- Provider status `APPROVED`
- Asset status `ACTIVE`
- Asset network `SOLANA`
- Asset type `NATIVE` or `SPL_TOKEN`

The existing asset schema only permits `SOLANA`, so unsupported networks are
blocked before custody binding approval.

At most one non-retired binding can exist for the same provider, asset, and
role. Retired bindings preserve history and allow a replacement binding.

## Command Boundary

All write commands are public RPCs with:

- `SECURITY DEFINER`
- `search_path = ''`
- Authenticated execute grant only
- ACTIVE ADMIN plus AAL2 revalidation inside PostgreSQL
- Caller-supplied command ID
- Expected-version concurrency
- Transaction advisory lock
- Idempotent replay
- Command ID conflict detection
- Immutable audit

The browser never writes private tables directly.

## Audit Boundary

`private.custody_config_audit_events` is append-only. UPDATE, DELETE, and
TRUNCATE are blocked.

Audit stores normalized non-secret request metadata. AAL2 read RPCs return
audit summaries and intentionally omit `request_data`.

Audit request data must not include credentials, service-role keys, database
URLs, private keys, mnemonics, provider account IDs, deposit or wallet
addresses, transaction IDs, hashes, signatures, RPC URLs, or HTTP URLs.

## Explicit Non-Goals

This phase does not implement:

- Provider SDK integration
- Blockchain SDK integration
- Provider API calls
- Blockchain RPC calls
- Webhook ingestion
- Worker, queue, cron, or scheduler
- Deposit address allocation
- External custody account storage
- Transaction hash or signature storage
- Payout submission
- Ledger posting
- User balance mutation
- Deposit, withdrawal, or staking status changes
- Service-role application client
- Mainnet or production connection
