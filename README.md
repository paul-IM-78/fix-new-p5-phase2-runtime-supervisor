# Staking Wallet Web

Managed staking wallet web application baseline.

Current phase: Supabase client boundary scaffold.

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
- Public environment validator: `src/lib/config/public-env.ts`
- Server-only environment validator: `src/server/config/env.ts`

Client components may use the browser client scaffold. Server components, route handlers, and future server actions may use the server client scaffold. Client components must not import server-only modules.

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
- Auth proxy and session refresh
- Sign up and login
- Auth callback
- Database
- Row-Level Security
- Profiles and roles
- Ledger
- Financial features
- Production deployment
- Mainnet integration
