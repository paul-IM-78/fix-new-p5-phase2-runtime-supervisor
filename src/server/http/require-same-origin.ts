import "server-only";

import type { NextRequest } from "next/server";

export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  if (!origin) {
    return false;
  }

  const requestOrigin = new URL(request.url).origin;

  if (origin !== requestOrigin) {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");

  if (
    fetchSite &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    return false;
  }

  return true;
}
