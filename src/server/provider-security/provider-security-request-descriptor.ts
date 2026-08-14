import "server-only";

import type { ApprovedProviderRequestDescriptor, ProviderEndpoint } from "./provider-security-types";

const METHOD_SET = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const OPERATION_ID_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export function validateApprovedProviderRequestDescriptor(
  value: ApprovedProviderRequestDescriptor,
): ApprovedProviderRequestDescriptor {
  if (!OPERATION_ID_PATTERN.test(value.operationId) || !METHOD_SET.has(value.method)) {
    throw new RangeError("provider_request_descriptor_invalid");
  }

  if (
    !value.relativePath.startsWith("/") ||
    value.relativePath.startsWith("//") ||
    value.relativePath.includes("\\") ||
    value.relativePath.includes("#") ||
    value.relativePath.includes("?") ||
    /%2f|%5c/i.test(value.relativePath)
  ) {
    throw new RangeError("provider_request_path_invalid");
  }

  for (const [key, item] of Object.entries(value.query)) {
    if (!key || !item || /[&#]/.test(key) || /[\r\n]/.test(item)) {
      throw new RangeError("provider_request_query_invalid");
    }
  }

  return value;
}

export function buildApprovedProviderUrl(
  endpoint: ProviderEndpoint,
  descriptor: ApprovedProviderRequestDescriptor,
): URL {
  validateApprovedProviderRequestDescriptor(descriptor);
  const url = new URL(descriptor.relativePath, `${endpoint.scheme}//${endpoint.hostname}:${endpoint.port}`);

  for (const [key, value] of Object.entries(descriptor.query)) {
    url.searchParams.append(key, value);
  }

  if (
    url.protocol !== endpoint.scheme ||
    url.hostname !== endpoint.hostname ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password ||
    url.hash ||
    url.hostname.endsWith(".")
  ) {
    throw new RangeError("provider_request_url_not_allowed");
  }

  return url;
}
