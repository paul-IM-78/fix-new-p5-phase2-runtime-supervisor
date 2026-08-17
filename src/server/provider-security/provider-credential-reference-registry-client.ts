import "server-only";

import { Pool, type PoolConfig } from "pg";

import type { CredentialReference, ProviderEnvironment, ProviderId } from "./provider-security-types";

export type ProviderCredentialReferenceRegistryPool = Pick<Pool, "query" | "end">;
export type ProviderCredentialReferenceRegistryClientConfig = Readonly<{ connection: Readonly<PoolConfig>; createPool?: (config: PoolConfig) => ProviderCredentialReferenceRegistryPool }>;
type Row = Readonly<{ provider: unknown; provider_environment: unknown; reference_id: unknown; version: unknown; lifecycle: unknown }>;
const lifecycles = new Set(["ACTIVE", "ROTATING", "REVOKED", "DISABLED"]);

export class ProviderCredentialReferenceRegistryError extends Error {
  readonly code: "REGISTRY_UNAVAILABLE" | "REGISTRY_INVALID_ROW" | "REGISTRY_REFERENCE_MISSING" | "REGISTRY_REFERENCE_AMBIGUOUS" | "REGISTRY_ENVIRONMENT_INVALID" | "REGISTRY_CLIENT_CLOSED";
  constructor(code: ProviderCredentialReferenceRegistryError["code"]) { super("provider_credential_reference_registry_failed"); this.name = "ProviderCredentialReferenceRegistryError"; this.code = code; }
}

function rowToReference(row: Row, provider: ProviderId, environment: ProviderEnvironment): CredentialReference {
  if (row.provider !== provider || row.provider_environment !== environment || typeof row.reference_id !== "string" || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(row.reference_id) || typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 1 || typeof row.lifecycle !== "string" || !lifecycles.has(row.lifecycle)) throw new ProviderCredentialReferenceRegistryError("REGISTRY_INVALID_ROW");
  return Object.freeze({ provider, environment, referenceId: row.reference_id, version: String(row.version), lifecycle: row.lifecycle as CredentialReference["lifecycle"] });
}

export function createProviderCredentialReferenceRegistryClient(config: ProviderCredentialReferenceRegistryClientConfig) {
  const pool = (config.createPool ?? ((value: PoolConfig) => new Pool(value)))(config.connection); let closed = false;
  return Object.freeze({
    async loadActiveProviderCredentialReference(provider: ProviderId, environment: ProviderEnvironment): Promise<CredentialReference> {
      if (closed) throw new ProviderCredentialReferenceRegistryError("REGISTRY_CLIENT_CLOSED");
      if (provider !== "BITGO" || environment !== "TEST") throw new ProviderCredentialReferenceRegistryError("REGISTRY_ENVIRONMENT_INVALID");
      let rows: readonly Row[]; try { rows = (await pool.query<Row>("select provider, provider_environment, reference_id, version, lifecycle from private.load_active_provider_credential_reference($1::text,$2::text)", [provider, environment])).rows; } catch { throw new ProviderCredentialReferenceRegistryError("REGISTRY_UNAVAILABLE"); }
      if (rows.length === 0) throw new ProviderCredentialReferenceRegistryError("REGISTRY_REFERENCE_MISSING");
      if (rows.length !== 1) throw new ProviderCredentialReferenceRegistryError("REGISTRY_REFERENCE_AMBIGUOUS");
      return rowToReference(rows[0], provider, environment);
    },
    async close(): Promise<void> { if (!closed) { closed = true; await pool.end(); } },
  });
}

export async function loadActiveProviderCredentialReference(config: ProviderCredentialReferenceRegistryClientConfig, provider: ProviderId, environment: ProviderEnvironment): Promise<CredentialReference> {
  const client = createProviderCredentialReferenceRegistryClient(config); try { return await client.loadActiveProviderCredentialReference(provider, environment); } finally { await client.close(); }
}
