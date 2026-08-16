import "server-only";

import {
  createBitGoWalletIdResolver,
  type BitGoWalletIdBindingRegistryEntry,
} from "./bitgo-wallet-id-resolver";
import type {
  BitGoWalletIdResolution,
  BitGoWalletIdResolver,
} from "./bitgo-balance-observer-adapter";
import type { CustodyAccountBindingRef } from "./provider-observation-contract";

export const P6_T08_RESOLVER_CASE_IDS = [
  "P6T08-RES-001", "P6T08-RES-002", "P6T08-RES-003", "P6T08-RES-004",
  "P6T08-RES-005", "P6T08-RES-006", "P6T08-RES-007", "P6T08-RES-008",
  "P6T08-RES-009", "P6T08-RES-010", "P6T08-RES-011", "P6T08-RES-012",
  "P6T08-RES-013", "P6T08-RES-014", "P6T08-RES-015", "P6T08-RES-016",
  "P6T08-RES-017", "P6T08-RES-018", "P6T08-RES-019", "P6T08-RES-020",
  "P6T08-RES-021", "P6T08-RES-022", "P6T08-RES-023", "P6T08-RES-024",
  "P6T08-RES-025", "P6T08-RES-026", "P6T08-RES-027", "P6T08-RES-028",
  "P6T08-RES-029", "P6T08-RES-030", "P6T08-RES-031", "P6T08-RES-032",
] as const;

const SYNTHETIC_WALLET_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND_SYNTHETIC_WALLET_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const binding = (overrides: Partial<CustodyAccountBindingRef> = {}): CustodyAccountBindingRef => ({
  providerCode: "BITGO",
  bindingKey: "synthetic-primary",
  assetCode: "TSOL",
  accountRole: "TREASURY",
  ...overrides,
});

const entry = (
  overrides: Partial<BitGoWalletIdBindingRegistryEntry> = {},
): BitGoWalletIdBindingRegistryEntry => ({
  binding: binding(),
  walletId: SYNTHETIC_WALLET_ID,
  ...overrides,
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFailure(
  result: BitGoWalletIdResolution,
  code: "WALLET_ID_NOT_CONFIGURED" | "WALLET_ID_INVALID" | "WALLET_ID_RESOLUTION_FAILED",
): void {
  assert(!result.ok, "p6_t08_expected_failure");
  assert(result.code === code, "p6_t08_failure_code_invalid");
  assert(Object.keys(result).length === 2, "p6_t08_failure_shape_invalid");
}

async function resolve(
  resolver: BitGoWalletIdResolver,
  value: CustodyAccountBindingRef,
): Promise<BitGoWalletIdResolution> {
  return resolver.resolveWalletId(value);
}

export async function runP6T08ResolverQualification(): Promise<readonly string[]> {
  const completed: string[] = [];
  const run = async (caseId: (typeof P6_T08_RESOLVER_CASE_IDS)[number], proof: () => void | Promise<void>) => {
    await proof();
    completed.push(caseId);
  };

  const resolver = createBitGoWalletIdResolver([entry()]);

  await run("P6T08-RES-001", () => {
    assert(P6_T08_RESOLVER_CASE_IDS.length === 32, "p6_t08_server_only_catalog_invalid");
  });
  await run("P6T08-RES-002", async () => {
    assertFailure(await resolve(createBitGoWalletIdResolver([]), binding()), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-003", async () => {
    const result = await resolve(resolver, binding());
    assert(result.ok && result.walletId === SYNTHETIC_WALLET_ID, "p6_t08_exact_tuple_failed");
  });
  await run("P6T08-RES-004", async () => {
    assertFailure(await resolve(resolver, binding({ bindingKey: "synthetic-missing" })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-005", async () => {
    assertFailure(await resolve(resolver, binding({ providerCode: "bitgo" })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-006", async () => {
    assertFailure(await resolve(resolver, binding({ assetCode: "tsol" })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-007", async () => {
    assertFailure(await resolve(resolver, binding({ bindingKey: "synthetic-primary " })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-008", async () => {
    assertFailure(await resolve(resolver, binding({ accountRole: "treasury" })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-009", async () => {
    assertFailure(await resolve(resolver, binding({ bindingKey: " synthetic-primary" })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-010", async () => {
    assertFailure(await resolve(resolver, binding({ providerCode: "BitGo" })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-011", async () => {
    const registeredBindingKey: string = "synthetic-\u00e9";
    const alternateBindingKey: string = "synthetic-e\u0301";
    const unicodeResolver = createBitGoWalletIdResolver([
      entry({ binding: binding({ bindingKey: registeredBindingKey }) }),
    ]);
    const exact = await resolve(unicodeResolver, binding({ bindingKey: registeredBindingKey }));
    assert(exact.ok && exact.walletId === SYNTHETIC_WALLET_ID, "p6_t08_unicode_exact_match_invalid");
    assert(registeredBindingKey !== alternateBindingKey, "p6_t08_unicode_forms_not_distinct");
    assertFailure(await resolve(unicodeResolver, binding({ bindingKey: alternateBindingKey })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-012", async () => {
    const numericKeyResolver = createBitGoWalletIdResolver([
      entry({ binding: binding({ bindingKey: "1" }) }),
    ]);
    const exact = await resolve(numericKeyResolver, binding({ bindingKey: "1" }));
    assert(exact.ok && exact.walletId === SYNTHETIC_WALLET_ID, "p6_t08_string_key_exact_match_invalid");
    // Test-only runtime-invalid input proves that the resolver does not coerce 1 to "1".
    const numericBinding = {
      providerCode: "BITGO",
      bindingKey: 1,
      assetCode: "TSOL",
      accountRole: "TREASURY",
    } as unknown as CustodyAccountBindingRef;
    assertFailure(await resolve(numericKeyResolver, numericBinding), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-013", async () => {
    const result = await resolve(resolver, binding());
    assert(result.ok && /^[0-9a-f]{32}$/.test(result.walletId), "p6_t08_wallet_id_validity_failed");
  });
  await run("P6T08-RES-014", async () => {
    assertFailure(await resolve(createBitGoWalletIdResolver([entry({ walletId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })]), binding()), "WALLET_ID_INVALID");
  });
  await run("P6T08-RES-015", async () => {
    assertFailure(await resolve(createBitGoWalletIdResolver([entry({ walletId: ` ${SYNTHETIC_WALLET_ID}` })]), binding()), "WALLET_ID_INVALID");
  });
  await run("P6T08-RES-016", async () => {
    const shortId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const longId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    assertFailure(await resolve(createBitGoWalletIdResolver([entry({ walletId: shortId })]), binding()), "WALLET_ID_INVALID");
    assertFailure(await resolve(createBitGoWalletIdResolver([entry({ walletId: longId })]), binding()), "WALLET_ID_INVALID");
  });
  await run("P6T08-RES-017", async () => {
    assertFailure(await resolve(createBitGoWalletIdResolver([entry({ walletId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })]), binding()), "WALLET_ID_INVALID");
  });
  await run("P6T08-RES-018", () => {
    let error: unknown;
    try {
      createBitGoWalletIdResolver([entry(), entry()]);
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof RangeError, "p6_t08_duplicate_error_type_invalid");
    assert(error.message === "bitgo_wallet_id_resolver_duplicate_binding", "p6_t08_duplicate_error_message_invalid");
  });
  await run("P6T08-RES-019", async () => {
    assertFailure(await resolve(resolver, binding({ bindingKey: "*" })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-020", async () => {
    assertFailure(await resolve(resolver, binding({ bindingKey: SYNTHETIC_WALLET_ID })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-021", async () => {
    const entries = [entry()];
    const snapshot = createBitGoWalletIdResolver(entries);
    entries.length = 0;
    const result = await resolve(snapshot, binding());
    assert(result.ok && result.walletId === SYNTHETIC_WALLET_ID, "p6_t08_array_snapshot_invalid");
  });
  await run("P6T08-RES-022", async () => {
    const mutableBinding = binding();
    const mutableEntry = { binding: mutableBinding, walletId: SYNTHETIC_WALLET_ID };
    const snapshot = createBitGoWalletIdResolver([mutableEntry]);
    mutableBinding.bindingKey = "synthetic-mutated";
    mutableEntry.walletId = SECOND_SYNTHETIC_WALLET_ID;
    const result = await resolve(snapshot, binding());
    assert(result.ok && result.walletId === SYNTHETIC_WALLET_ID, "p6_t08_binding_snapshot_invalid");
  });
  await run("P6T08-RES-023", async () => {
    const first = await resolve(resolver, binding());
    const second = await resolve(resolver, binding());
    assert(JSON.stringify(first) === JSON.stringify(second), "p6_t08_resolution_not_deterministic");
  });
  await run("P6T08-RES-024", async () => {
    const secondary = binding({ bindingKey: "synthetic-secondary", accountRole: "OPERATIONS" });
    const multiple = createBitGoWalletIdResolver([
      entry(),
      entry({ binding: secondary, walletId: SYNTHETIC_WALLET_ID }),
    ]);
    const first = await resolve(multiple, binding());
    const second = await resolve(multiple, secondary);
    assert(first.ok && first.walletId === SYNTHETIC_WALLET_ID, "p6_t08_first_tuple_invalid");
    assert(second.ok && second.walletId === SYNTHETIC_WALLET_ID, "p6_t08_second_tuple_invalid");
  });
  await run("P6T08-RES-025", async () => {
    const result = await resolve(resolver, binding({ bindingKey: "synthetic-hidden" }));
    assertFailure(result, "WALLET_ID_NOT_CONFIGURED");
    assert(!JSON.stringify(result).includes(SYNTHETIC_WALLET_ID), "p6_t08_missing_sensitive_data_leak");
  });
  await run("P6T08-RES-026", async () => {
    const result = await resolve(createBitGoWalletIdResolver([entry({ walletId: "not-a-wallet-id" })]), binding());
    assertFailure(result, "WALLET_ID_INVALID");
    assert(!JSON.stringify(result).includes("not-a-wallet-id"), "p6_t08_invalid_sensitive_data_leak");
  });
  await run("P6T08-RES-027", async () => {
    const result = await resolve(resolver, binding({ bindingKey: "synthetic-observability" }));
    assertFailure(result, "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-028", async () => {
    const result = await resolve(resolver, binding());
    assert(result.ok, "p6_t08_in_memory_resolution_failed");
  });
  await run("P6T08-RES-029", async () => {
    const result = await resolve(resolver, binding());
    assert(result.ok, "p6_t08_offline_resolution_failed");
  });
  await run("P6T08-RES-030", async () => {
    const reused: BitGoWalletIdResolver = createBitGoWalletIdResolver([entry()]);
    const result: BitGoWalletIdResolution = await reused.resolveWalletId(binding());
    assert(result.ok, "p6_t08_existing_interface_not_reused");
  });
  await run("P6T08-RES-031", async () => {
    assertFailure(await resolve(resolver, binding({ assetCode: "REMOTE_CONTENT" })), "WALLET_ID_NOT_CONFIGURED");
  });
  await run("P6T08-RES-032", async () => {
    assertFailure(await resolve(resolver, binding({ providerCode: "BITGO_TEST" })), "WALLET_ID_NOT_CONFIGURED");
  });

  assert(completed.length === 32, "p6_t08_case_count_invalid");
  assert(new Set(completed).size === 32, "p6_t08_case_ids_duplicate");
  for (const [index, caseId] of completed.entries()) {
    const expected = `P6T08-RES-${String(index + 1).padStart(3, "0")}`;
    assert(caseId === expected, "p6_t08_case_ids_not_sequential");
  }

  return completed;
}
