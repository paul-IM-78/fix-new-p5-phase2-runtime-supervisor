import { NextResponse, type NextRequest } from "next/server";

import {
  isPlainJsonObject,
  parseReconciliationReviewOpenDto,
} from "@/lib/reconciliation/validation";
import { executeReconciliationReviewAdminCommand } from "@/server/admin/reconciliation-review-commands";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_JSON_BYTES = 4096;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return jsonNoStore(
      { ok: false, error: { code: "request_rejected" } },
      403,
    );
  }

  const body = await readJsonObject(request);

  if (!body.ok) {
    return jsonNoStore(
      { ok: false, error: { code: "invalid_request" } },
      400,
    );
  }

  const dto = parseReconciliationReviewOpenDto(body.value);

  if (!dto) {
    return jsonNoStore(
      { ok: false, error: { code: "invalid_request" } },
      400,
    );
  }

  const execution = await executeReconciliationReviewAdminCommand({
    action: "open_review",
    ...dto,
  });

  if (!execution.ok) {
    return jsonNoStore(
      { ok: false, error: { code: execution.error.code } },
      execution.error.httpStatus,
    );
  }

  return jsonNoStore({ ok: true, result: execution.result }, 200);
}

async function readJsonObject(
  request: NextRequest,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    return { ok: false };
  }

  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).length > MAX_JSON_BYTES) {
    return { ok: false };
  }

  try {
    const parsed: unknown = JSON.parse(rawBody);

    return isPlainJsonObject(parsed)
      ? { ok: true, value: parsed }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

function jsonNoStore(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");

  return response;
}
