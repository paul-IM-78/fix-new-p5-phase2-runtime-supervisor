import { NextResponse, type NextRequest } from "next/server";

import { parseAdminReconciliationListQuery } from "@/lib/reconciliation/validation";
import { listAdminReconciliationItems } from "@/server/admin/reconciliation-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = parseAdminReconciliationListQuery(
    request.nextUrl.searchParams,
  );

  if (!query) {
    return jsonNoStore(
      { ok: false, error: { code: "invalid_request" } },
      400,
    );
  }

  const execution = await listAdminReconciliationItems(query);

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
