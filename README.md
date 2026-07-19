# Staking Wallet Web

Managed staking wallet web application baseline.

Current phase: New Project Baseline.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- ESLint
- npm

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

- Supabase
- Auth
- Database
- Row-Level Security
- Ledger
- Financial features
- Production deployment
- Mainnet integration
