import "server-only";

import { Pool, type PoolConfig } from "pg";

import type { BitGoWalletIdBindingRegistryEntry } from "./bitgo-wallet-id-resolver";
import type { CustodyAccountBindingRef } from "./provider-observation-contract";

const WALLET_ID_PATTERN = /^[0-9a-f]{32}$/;
const MAX_SNAPSHOT_ROWS = 1_000;

export type CustodyWalletIdRegistryEnvironment = "TEST" | "PRODUCTION";

export type CustodyWalletIdRegistryPool = Pick<Pool, "query" | "end">;

export type CustodyWalletIdRegistryClientConfig = Readonly<{
  connection: Readonly<PoolConfig>;
  createPool?: (config: PoolConfig) => CustodyWalletIdRegistryPool;
}>;

type RegistryRow = Readonly<{
  provider_code: unknown;
  binding_key: unknown;
  asset_code: unknown;
  account_role: unknown;
  wallet_id: unknown;
}>;

export class CustodyWalletIdRegistryError extends Error {
  readonly code:
    | "REGISTRY_UNAVAILABLE"
    | "REGISTRY_INVALID_ROW"
    | "REGISTRY_INVALID_WALLET_ID"
    | "REGISTRY_DUPLICATE_TUPLE"
    | "REGISTRY_ENVIRONMENT_INVALID"
    | "REGISTRY_CLIENT_CLOSED";

  constructor(code: CustodyWalletIdRegistryError["code"]) {
    super("custody_wallet_id_registry_failed");
    this.name = "CustodyWalletIdRegistryError";
    this.code = code;
  }
}

export type CustodyWalletIdRegistryClient = Readonly<{
  loadActiveCustodyWalletIdRegistrySnapshot(
    environment: CustodyWalletIdRegistryEnvironment,
  ): Promise<readonly BitGoWalletIdBindingRegistryEntry[]>;
  close(): Promise<void>;
}>;

function tupleKey(binding: CustodyAccountBindingRef): string {
  return [binding.providerCode, binding.bindingKey, binding.assetCode, binding.accountRole].join("\u0000");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function toEntry(row: RegistryRow): BitGoWalletIdBindingRegistryEntry {
  if (!isNonEmptyString(row.provider_code) || !isNonEmptyString(row.binding_key) || !isNonEmptyString(row.asset_code) || !isNonEmptyString(row.account_role)) {
    throw new CustodyWalletIdRegistryError("REGISTRY_INVALID_ROW");
  }
  if (!isNonEmptyString(row.wallet_id) || !WALLET_ID_PATTERN.test(row.wallet_id)) {
    throw new CustodyWalletIdRegistryError("REGISTRY_INVALID_WALLET_ID");
  }
  const binding = Object.freeze({
    providerCode: row.provider_code,
    bindingKey: row.binding_key,
    assetCode: row.asset_code,
    accountRole: row.account_role,
  });
  return Object.freeze({ binding, walletId: row.wallet_id });
}

export function createCustodyWalletIdRegistryClient(
  config: CustodyWalletIdRegistryClientConfig,
): CustodyWalletIdRegistryClient {
  const pool = (config.createPool ?? ((poolConfig: PoolConfig) => new Pool(poolConfig)))(config.connection);
  let closed = false;

  return Object.freeze({
    async loadActiveCustodyWalletIdRegistrySnapshot(environment) {
      if (closed) throw new CustodyWalletIdRegistryError("REGISTRY_CLIENT_CLOSED");
      if (environment !== "TEST") throw new CustodyWalletIdRegistryError("REGISTRY_ENVIRONMENT_INVALID");
      let result: { rows: readonly RegistryRow[] };
      try {
        result = await pool.query<RegistryRow>(
          "select provider_code, binding_key, asset_code, account_role, wallet_id from private.load_active_custody_wallet_id_registry($1::text)",
          [environment],
        );
      } catch {
        throw new CustodyWalletIdRegistryError("REGISTRY_UNAVAILABLE");
      }
      if (result.rows.length > MAX_SNAPSHOT_ROWS) throw new CustodyWalletIdRegistryError("REGISTRY_INVALID_ROW");
      const seen = new Set<string>();
      const entries = result.rows.map((row) => {
        const entry = toEntry(row);
        const key = tupleKey(entry.binding);
        if (seen.has(key)) throw new CustodyWalletIdRegistryError("REGISTRY_DUPLICATE_TUPLE");
        seen.add(key);
        return entry;
      });
      return Object.freeze(entries);
    },
    async close() {
      if (!closed) {
        closed = true;
        await pool.end();
      }
    },
  });
}

export async function loadActiveCustodyWalletIdRegistrySnapshot(
  config: CustodyWalletIdRegistryClientConfig,
  environment: CustodyWalletIdRegistryEnvironment,
): Promise<readonly BitGoWalletIdBindingRegistryEntry[]> {
  const client = createCustodyWalletIdRegistryClient(config);
  try {
    return await client.loadActiveCustodyWalletIdRegistrySnapshot(environment);
  } finally {
    await client.close();
  }
}
