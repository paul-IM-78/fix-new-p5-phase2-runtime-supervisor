# Local Migration Workflow

## Scope

This project uses Supabase CLI local development for Docker-backed Postgres, Auth, Studio, and Mailpit. The local workflow is intentionally separate from any hosted Supabase project.

Remote commands are out of scope until a later production migration phase.

## Files

- `supabase/config.toml`: local Supabase service configuration
- `supabase/migrations`: versioned SQL migrations
- `supabase/seed.sql`: local seed data entrypoint
- `.env.local`: ignored local app environment file

## Local Ports

The project uses `557xx` local ports to avoid collisions with other running Supabase projects:

- API: `127.0.0.1:55721`
- Database: `127.0.0.1:55722`
- Studio: `127.0.0.1:55723`
- Mailpit: `127.0.0.1:55724`
- Analytics: `127.0.0.1:55727`

Supabase CLI may print a local development security notice on Windows because Docker-published service ports can bind to all host interfaces. This is not a remote Supabase link, but it should still be treated as a local-network exposure risk.

## Naming

Migration files must use the Supabase CLI timestamp format:

```text
<UTC timestamp>_<snake_case_name>.sql
```

Create a new migration with:

```bash
npm run db:migration:new -- <snake_case_name>
```

Do not edit an already-applied or committed migration. Use a forward migration for every schema change.

## Reset

Use local reset only:

```bash
npm run db:reset:local
```

This applies migrations and then runs `supabase/seed.sql` against the local database only.

Do not use linked reset, remote push, remote pull, migration repair, or hosted project commands in this phase.

## Lint

Use local lint only:

```bash
npm run db:lint:local
```

The script keeps `--fail-on error` enabled. Warnings must be reported instead of hidden.

## Seed

`supabase/seed.sql` is reserved for local seed data after schemas and policies are approved.

Seed rules:

- Do not define schema DDL in seed files
- Do not create Auth users in this phase
- Do not create admin users in this phase
- Do not insert financial fixtures in this phase
- Do not store real email addresses
- Do not store secrets

## Configuration

`supabase/config.toml` keeps local development settings only.

Do not hardcode:

- Service-role credentials
- Database passwords
- JWT secrets
- SMTP passwords
- OAuth provider secrets
- Private keys
- Mnemonics
- Mainnet RPC credentials

## Remote Boundary

The following commands are explicitly out of scope for this phase:

```text
supabase login
supabase link
supabase db pull
supabase db push
supabase migration repair --linked
supabase secrets set
```

Production migration rules will be defined in a separate phase.
