import type { CustodyWalletIdRegistryPool } from "./custody-wallet-id-registry-client";
import {
  createCustodyWalletIdRegistryClient,
  CustodyWalletIdRegistryError,
} from "./custody-wallet-id-registry-client";

export const P6_T11_REGISTRY_CLIENT_CASE_IDS = [
  "P6T11-REG-017", "P6T11-REG-019", "P6T11-REG-020", "P6T11-REG-021",
] as const;

type Row = Record<string, unknown>;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function pool(rows: readonly Row[] = [], failure?: Error): CustodyWalletIdRegistryPool {
  return {
    async query() {
      if (failure) throw failure;
      return { rows } as never;
    },
    async end() {},
  };
}

async function expectCode(action: () => Promise<unknown>, code: CustodyWalletIdRegistryError["code"]): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof CustodyWalletIdRegistryError, "registry_error_type");
    assert(error.code === code, "registry_error_code");
    assert(error.message === "custody_wallet_id_registry_failed", "registry_error_message");
    return;
  }
  throw new Error("registry_error_missing");
}

const validRow = (): Row => ({
  provider_code: "BITGO",
  binding_key: "synthetic-registry",
  asset_code: "TSOL",
  account_role: "TREASURY",
  wallet_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});

export async function runP6T11RegistryClientQualification(): Promise<readonly string[]> {
  const completed: string[] = [];
  const run = async (caseId: (typeof P6_T11_REGISTRY_CLIENT_CASE_IDS)[number], proof: () => Promise<void>) => {
    await proof();
    completed.push(caseId);
  };

  await run("P6T11-REG-017", async () => {
    await expectCode(
      () => createCustodyWalletIdRegistryClient({ connection: {}, createPool: () => pool([{ ...validRow(), wallet_id: "invalid" }]) }).loadActiveCustodyWalletIdRegistrySnapshot("TEST"),
      "REGISTRY_INVALID_WALLET_ID",
    );
  });
  await run("P6T11-REG-019", async () => {
    const client = createCustodyWalletIdRegistryClient({ connection: {}, createPool: () => pool([validRow()]) });
    const snapshot = await client.loadActiveCustodyWalletIdRegistrySnapshot("TEST");
    assert(Object.isFrozen(snapshot) && Object.isFrozen(snapshot[0]) && Object.isFrozen(snapshot[0]?.binding), "registry_snapshot_immutable");
    await client.close();
  });
  await run("P6T11-REG-020", async () => {
    await expectCode(
      () => createCustodyWalletIdRegistryClient({ connection: {}, createPool: () => pool([validRow(), validRow()]) }).loadActiveCustodyWalletIdRegistrySnapshot("TEST"),
      "REGISTRY_DUPLICATE_TUPLE",
    );
  });
  await run("P6T11-REG-021", async () => {
    await expectCode(
      () => createCustodyWalletIdRegistryClient({ connection: {}, createPool: () => pool([], new Error("database unavailable")) }).loadActiveCustodyWalletIdRegistrySnapshot("TEST"),
      "REGISTRY_UNAVAILABLE",
    );
    await expectCode(
      () => createCustodyWalletIdRegistryClient({ connection: {}, createPool: () => pool() }).loadActiveCustodyWalletIdRegistrySnapshot("PRODUCTION"),
      "REGISTRY_ENVIRONMENT_INVALID",
    );
  });

  return completed;
}
