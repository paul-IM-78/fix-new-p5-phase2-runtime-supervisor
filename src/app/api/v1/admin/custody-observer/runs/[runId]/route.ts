import { NextResponse, type NextRequest } from "next/server";

import { parseCustodyObserverRunId } from "@/lib/custody/operational-read-validation";
import { getAdminCustodyObserverRunDetail } from "@/server/admin/custody-observer-operational-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { runId } = await context.params;
  const parsedRunId = parseCustodyObserverRunId(runId);

  if (!parsedRunId.ok) {
    return jsonNoStore({ error: { code: parsedRunId.error } }, 400);
  }

  const execution = await getAdminCustodyObserverRunDetail(parsedRunId.value);

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
