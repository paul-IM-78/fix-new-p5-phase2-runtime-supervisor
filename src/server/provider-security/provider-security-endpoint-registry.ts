import "server-only";

import type { ProviderEndpoint, ProviderEnvironment, ProviderId } from "./provider-security-types";

const ENDPOINTS: readonly ProviderEndpoint[] = [
  {
    id: "BITGO_TEST",
    provider: "BITGO",
    environment: "TEST",
    scheme: "https:",
    hostname: "app.bitgo-test.com",
    port: 443,
    active: true,
  },
  {
    id: "BITGO_PRODUCTION",
    provider: "BITGO",
    environment: "PRODUCTION",
    scheme: "https:",
    hostname: "app.bitgo.com",
    port: 443,
    active: false,
  },
];

export function getProviderEndpoint(
  provider: ProviderId,
  environment: ProviderEnvironment,
): ProviderEndpoint | null {
  const endpoint = ENDPOINTS.find(
    (candidate) => candidate.provider === provider && candidate.environment === environment,
  );

  return endpoint?.active ? endpoint : null;
}
