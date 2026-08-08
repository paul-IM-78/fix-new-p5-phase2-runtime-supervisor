import { NextResponse, type NextRequest } from "next/server";

import { parseReconciliationItemId } from "@/lib/reconciliation/validation";
import { getAdminReconciliationItemDetail } from "@/server/admin/reconciliation-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    reconciliationItemId: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { reconciliationItemId } = await context.params;
  const itemId = parseReconciliationItemId(reconciliationItemId);

  if (!itemId) {
    return jsonNoStore(
      { ok: false, error: { code: "invalid_request" } },
      400,
    );
  }

  const execution = await getAdminReconciliationItemDetail(itemId);

  if (!execution.ok) {
    return jsonNoStore(
      { ok: false, error: { code: execution.error.code } },
      execution.error.httpStatus,
    );
  }

  return jsonNoStore({ ok: true, result: execution.result }, 200);
}

function jsonNoStore(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");

  return response;
}
