import "server-only";

import { BlockList, isIP } from "node:net";

import type { ResolvedProviderAddress } from "./provider-security-types";

const IPV4_DENY_RANGES: readonly [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
];
const IPV6_DENY_RANGES: readonly [string, number][] = [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96],
  ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:2::", 48],
  ["2001:10::", 28], ["2001:20::", 28], ["2001:db8::", 32], ["2002::", 16],
  ["3ffe::", 16], ["5f00::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
];

const IPV4_BLOCK_LIST = createBlockList(IPV4_DENY_RANGES, "ipv4");
const IPV6_BLOCK_LIST = createBlockList(IPV6_DENY_RANGES, "ipv6");

function createBlockList(
  ranges: readonly [string, number][],
  family: "ipv4" | "ipv6",
): BlockList {
  const list = new BlockList();
  for (const [address, prefix] of ranges) list.addSubnet(address, prefix, family);
  return list;
}

export function validateGlobalProviderAddress(address: string): ResolvedProviderAddress | null {
  const family = isIP(address);
  if (family !== 4 && family !== 6) return null;
  if (family === 4 && IPV4_BLOCK_LIST.check(address, "ipv4")) return null;
  if (family === 6 && IPV6_BLOCK_LIST.check(address, "ipv6")) return null;
  return Object.freeze({ address, family }) as ResolvedProviderAddress;
}

export const PROVIDER_SECURITY_DENY_POLICY = Object.freeze({
  ipv4Ranges: IPV4_DENY_RANGES,
  ipv6Ranges: IPV6_DENY_RANGES,
  version: "P6_T04_V1",
});
