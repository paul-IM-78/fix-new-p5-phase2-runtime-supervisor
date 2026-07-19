# Staking Wallet Web

Managed staking wallet web application baseline.

Current phase: Supabase proxy cookie boundary scaffold.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- ESLint
- npm
- Supabase SSR client packages

## Environment

The project currently uses placeholders only. Real local values belong in ignored local environment files and must not be committed.

```text
APP_ENV
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

`APP_ENV` must be one of `local`, `preview`, or `production`. The Supabase URL and publishable key are public browser configuration, not privileged server credentials.

No real Supabase project is connected in this phase.

## Development

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Supabase Local

Docker Engine is required for the local Supabase stack. The CLI is installed as a project dev dependency and should be run through npm scripts or `npx supabase`.

```bash
npm run supabase:start
npm run supabase:status
npm run db:reset:local
npm run db:lint:local
npm run supabase:stop
```

This project uses local Supabase ports in the `557xx` range to avoid collisions with other local projects:

```text
API: http://127.0.0.1:55721
Database: 127.0.0.1:55722
Studio: http://127.0.0.1:55723
Mailpit: http://127.0.0.1:55724
```

Local app credentials belong in `.env.local`, which is ignored by Git and must not be committed. The app uses only the local API URL and local anon key. Service-role keys, database URLs, JWT secrets, and production credentials are not application configuration in this phase.

Migrations are forward-only and live under `supabase/migrations`. Remote Supabase link, production migration, Auth UI, roles, RLS, and service-role access are not implemented yet.

## Auth Identity Schema

The local database now includes the first Auth identity migration:

- `public.profiles` stores the application identity row for each Supabase Auth user.
- `public.user_roles` stores role grant history and creates one active `USER` role during provisioning.
- An `auth.users` insert trigger provisions the profile and default role.
- Auth metadata is not trusted for account status, roles, permissions, or admin state.
- Profile self-read RLS is enabled; browser profile writes and direct role reads are blocked.

Run the local database test suite with:

```bash
npm run db:test:local
```

Auth UI, login, callbacks, ADMIN role management, service-role application access, remote Supabase, and production database workflows are still not implemented.

## Health Route

```text
GET /api/v1/health
```

The route is a liveness check only. It does not call Supabase, a database, or an external network.

## Config Readiness Route

```text
GET /api/v1/readiness/config
```

The route validates server runtime configuration and public Supabase placeholders without creating a Supabase client, reading cookies, calling Auth, querying a database, or contacting an external network.

## Supabase Client Boundary

- Browser client scaffold: `src/lib/supabase/client.ts`
- Server client scaffold: `src/lib/supabase/server.ts`
- Proxy cookie refresh scaffold: `src/proxy.ts`
- Public environment validator: `src/lib/config/public-env.ts`
- Server-only environment validator: `src/server/config/env.ts`

Client components may use the browser client scaffold. Server components, route handlers, and future server actions may use the server client scaffold. Client components must not import server-only modules.

## Auth Proxy Boundary

Next.js 16 Proxy is scaffolded to synchronize Supabase auth cookies between the request and response and to call `getClaims()` early in the request lifecycle.

The proxy is not the final authorization layer. It does not decide user identity, roles, account state, financial command permissions, RLS policy outcomes, or database business rules. Those checks belong in later route handlers, server guards, and database policies.

The proxy matcher excludes the liveness and configuration readiness routes, Next.js static assets, image optimization assets, the favicon, and common static file extensions. Real sign up, login, logout, callback, protected redirects, profile, role, and MFA flows are not implemented yet.

## Repository Boundary

Current project:

```text
D:\Ai\staking-wallet-web
```

Legacy reference project:

```text
D:\Ai\Staking-Wallet
```

The legacy repository preserves the previous Solana Wallet Adapter dApp and Expo self-custody wallet. This project must not import or copy legacy wallet adapter, Phantom, private key, mnemonic, client transaction signing, SOL transfer, mainnet default RPC, or localStorage financial-state flows.

## Not Implemented Yet

- Real Supabase project connection
- Auth
- Complete Auth proxy session policy
- Sign up and login
- Auth callback
- Ledger
- Financial features
- Production deployment
- Mainnet integration
