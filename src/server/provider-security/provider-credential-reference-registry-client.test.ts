import { createProviderCredentialReferenceRegistryClient, ProviderCredentialReferenceRegistryError } from "./provider-credential-reference-registry-client";
export const P6_T12_CREDENTIAL_REFERENCE_CLIENT_CASE_IDS = ["P6T12-CRED-007", "P6T12-CRED-008", "P6T12-CRED-020"] as const;
const row = { provider: "BITGO", provider_environment: "TEST", reference_id: "SYNTHETIC_REFERENCE", version: 1, lifecycle: "ACTIVE" };
const pool = (rows: readonly unknown[]) => ({ async query() { return { rows } as never; }, async end() {} });
export async function runP6T12CredentialReferenceClientQualification(): Promise<readonly string[]> {
  const client = createProviderCredentialReferenceRegistryClient({ connection: {}, createPool: () => pool([row]) }); const reference = await client.loadActiveProviderCredentialReference("BITGO", "TEST"); await client.close();
  if (reference.version !== "1" || reference.referenceId !== "SYNTHETIC_REFERENCE") throw new Error("reference_conversion_failed");
  try { await createProviderCredentialReferenceRegistryClient({ connection: {}, createPool: () => pool([row, row]) }).loadActiveProviderCredentialReference("BITGO", "TEST"); throw new Error("ambiguity_not_rejected"); } catch (error) { if (!(error instanceof ProviderCredentialReferenceRegistryError) || error.code !== "REGISTRY_REFERENCE_AMBIGUOUS") throw error; }
  return P6_T12_CREDENTIAL_REFERENCE_CLIENT_CASE_IDS;
}
