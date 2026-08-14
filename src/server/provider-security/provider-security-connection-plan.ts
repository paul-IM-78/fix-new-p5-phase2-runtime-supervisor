import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";

import { validateGlobalProviderAddress } from "./provider-security-egress-policy";
import type { ConnectionPlan, ProviderEndpoint, ResolvedProviderAddress } from "./provider-security-types";

export type ProviderDnsResolver = Readonly<{
  resolveAll(hostname: string): Promise<readonly ResolvedProviderAddress[]>;
}>;

export function createDefaultProviderDnsResolver(): ProviderDnsResolver {
  return {
    async resolveAll(hostname) {
      const values = await dnsLookup(hostname, { all: true, verbatim: true });
      return values.map((item) => ({
        address: item.address,
        family: item.family === 6 ? 6 : 4,
      }));
    },
  };
}

export async function createConnectionPlan({
  endpoint,
  resolver,
  signal,
}: {
  endpoint: ProviderEndpoint;
  resolver: ProviderDnsResolver;
  signal?: AbortSignal;
}): Promise<ConnectionPlan> {
  throwIfAborted(signal);
  const candidates = await resolver.resolveAll(endpoint.hostname);
  throwIfAborted(signal);
  const addresses = normalizeAddresses(candidates);
  if (addresses.length === 0) throw new RangeError("provider_dns_result_invalid");

  for (const candidate of addresses) {
    if (!validateGlobalProviderAddress(candidate.address)) {
      throw new RangeError("provider_dns_address_not_allowed");
    }
  }

  const selected = addresses[0];
  return Object.freeze({
    endpointId: endpoint.id,
    provider: endpoint.provider,
    environment: endpoint.environment,
    scheme: endpoint.scheme,
    hostname: endpoint.hostname,
    port: endpoint.port,
    addresses: Object.freeze(addresses),
    selectedAddress: selected.address,
    selectedFamily: selected.family,
    servername: endpoint.hostname,
    policyVersion: "P6_T04_V1",
  });
}

export function createConnectionPlanLookup(plan: ConnectionPlan): LookupFunction {
  return (hostname, options, callback) => {
    if (hostname !== plan.hostname) {
      callback(new Error("provider_lookup_hostname_mismatch"), "", 0);
      return;
    }
    const requestedFamily = options.family === 4 || options.family === 6 ? options.family : undefined;
    const candidates = plan.addresses.filter((item) => !requestedFamily || item.family === requestedFamily);
    if (candidates.length === 0) {
      callback(new Error("provider_lookup_family_not_planned"), "", 0);
      return;
    }
    if (options.all) {
      callback(null, candidates.map((item) => ({ address: item.address, family: item.family })));
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
}

function normalizeAddresses(values: readonly ResolvedProviderAddress[]): ResolvedProviderAddress[] {
  const unique = new Map<string, ResolvedProviderAddress>();
  for (const value of values) {
    const normalized = validateGlobalProviderAddress(value.address);
    if (!normalized || normalized.family !== value.family) {
      throw new RangeError("provider_dns_address_not_allowed");
    }
    unique.set(`${normalized.family}:${normalized.address}`, normalized);
  }
  return [...unique.values()];
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("provider_operation_aborted");
}
