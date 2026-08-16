import "server-only";

import type {
  BitGoWalletIdResolution,
  BitGoWalletIdResolver,
} from "./bitgo-balance-observer-adapter";
import type { CustodyAccountBindingRef } from "./provider-observation-contract";

const BITGO_PROVIDER_CODE = "BITGO";
const BITGO_ASSET_CODE = "TSOL";
const WALLET_ID_PATTERN = /^[0-9a-f]{32}$/;

export type BitGoWalletIdBindingRegistryEntry = Readonly<{
  binding: CustodyAccountBindingRef;
  walletId: string;
}>;

type WalletIdByRole = Map<string, string>;
type WalletIdByAsset = Map<string, WalletIdByRole>;
type WalletIdByBindingKey = Map<string, WalletIdByAsset>;
type WalletIdByProvider = Map<string, WalletIdByBindingKey>;

const notConfigured = (): BitGoWalletIdResolution => ({
  ok: false,
  code: "WALLET_ID_NOT_CONFIGURED",
});

const invalid = (): BitGoWalletIdResolution => ({
  ok: false,
  code: "WALLET_ID_INVALID",
});

const failed = (): BitGoWalletIdResolution => ({
  ok: false,
  code: "WALLET_ID_RESOLUTION_FAILED",
});

function createRegistry(
  entries: readonly BitGoWalletIdBindingRegistryEntry[],
): WalletIdByProvider {
  const registry: WalletIdByProvider = new Map();

  for (const entry of entries) {
    const providerCode = entry.binding.providerCode;
    const bindingKey = entry.binding.bindingKey;
    const assetCode = entry.binding.assetCode;
    const accountRole = entry.binding.accountRole;
    const walletId = entry.walletId;

    let byBindingKey = registry.get(providerCode);
    if (!byBindingKey) {
      byBindingKey = new Map();
      registry.set(providerCode, byBindingKey);
    }

    let byAsset = byBindingKey.get(bindingKey);
    if (!byAsset) {
      byAsset = new Map();
      byBindingKey.set(bindingKey, byAsset);
    }

    let byRole = byAsset.get(assetCode);
    if (!byRole) {
      byRole = new Map();
      byAsset.set(assetCode, byRole);
    }

    if (byRole.has(accountRole)) {
      throw new RangeError("bitgo_wallet_id_resolver_duplicate_binding");
    }

    byRole.set(accountRole, walletId);
  }

  return registry;
}

function resolveWalletId(
  registry: WalletIdByProvider,
  binding: CustodyAccountBindingRef,
): BitGoWalletIdResolution {
  if (
    binding.providerCode !== BITGO_PROVIDER_CODE ||
    binding.assetCode !== BITGO_ASSET_CODE
  ) {
    return notConfigured();
  }

  const walletId = registry
    .get(binding.providerCode)
    ?.get(binding.bindingKey)
    ?.get(binding.assetCode)
    ?.get(binding.accountRole);

  if (walletId === undefined) {
    return notConfigured();
  }

  if (!WALLET_ID_PATTERN.test(walletId)) {
    return invalid();
  }

  return { ok: true, walletId };
}

export function createBitGoWalletIdResolver(
  entries: readonly BitGoWalletIdBindingRegistryEntry[],
): BitGoWalletIdResolver {
  const registry = createRegistry(entries);

  return {
    async resolveWalletId(binding, options) {
      void options;

      try {
        return resolveWalletId(registry, binding);
      } catch {
        return failed();
      }
    },
  };
}
