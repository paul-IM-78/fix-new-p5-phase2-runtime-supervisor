import { NextResponse, type NextRequest } from "next/server";

import { parseAdminCustodyObserverListQuery } from "@/lib/custody/operational-read-validation";
import { listAdminCustodyObserverRuns } from "@/server/admin/custody-observer-operational-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = parseAdminCustodyObserverListQuery(
    request.nextUrl.searchParams,
  );

  if (!query.ok) {
    return jsonNoStore({ error: { code: query.error } }, 400);
  }

  const execution = await listAdminCustodyObserverRuns(query.value);

  return execution.ok
    ? jsonNoStore(execution.result, 200)
    : jsonNoStore(
        { error: { code: execution.error.code } },
        execution.error.httpStatus,
      );
}

function jsonNoStore(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");

  return response;
}
