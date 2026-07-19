import { NextResponse, type NextRequest } from "next/server";

import { validateMfaFactorId } from "@/lib/auth/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/server/config/env";
import { inspectAdminIdentity } from "@/server/auth/admin-guard";
import { isSameOriginRequest } from "@/server/http/require-same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return jsonNoStore({ status: "error", code: "request_rejected" }, 403);
  }

  const supabase = await createServerSupabaseClient();
  const identity = await inspectAdminIdentity(supabase);

  if (identity.status !== "admin") {
    return jsonNoStore(
      { status: "error", code: mapIdentityError(identity.status) },
      identity.status === "anonymous" ? 401 : 403,
    );
  }

  const currentFactors = await supabase.auth.mfa.listFactors();

  if (currentFactors.error) {
    return jsonNoStore({ status: "error", code: "mfa_unavailable" }, 503);
  }

  const allFactors = currentFactors.data?.all ?? [];

  if (allFactors.some((factor) => factor.factor_type !== "totp")) {
    return jsonNoStore(
      { status: "error", code: "mfa_state_invalid" },
      409,
    );
  }

  const verifiedTotpFactors = allFactors.filter(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  );

  if (verifiedTotpFactors.length > 0) {
    return jsonNoStore(
      { status: "error", code: "mfa_already_enrolled" },
      409,
    );
  }

  const unverifiedTotpFactors = allFactors.filter(
    (factor) =>
      factor.factor_type === "totp" && factor.status === "unverified",
  );

  for (const factor of unverifiedTotpFactors) {
    const factorId = validateMfaFactorId(factor.id);

    if (!factorId) {
      return jsonNoStore(
        { status: "error", code: "mfa_enrollment_failed" },
        409,
      );
    }

    const { error } = await supabase.auth.mfa.unenroll({ factorId });

    if (error) {
      return jsonNoStore(
        { status: "error", code: "mfa_enrollment_failed" },
        409,
      );
    }
  }

  if (unverifiedTotpFactors.length > 0) {
    const afterUnenroll = await supabase.auth.mfa.listFactors();

    if (
      afterUnenroll.error ||
      (afterUnenroll.data?.all ?? []).some(
        (factor) => factor.factor_type === "totp",
      )
    ) {
      return jsonNoStore(
        { status: "error", code: "mfa_enrollment_failed" },
        409,
      );
    }
  }

  const enrollmentResult = await enrollTotpFactor(supabase);

  if (!enrollmentResult.ok) {
    return jsonNoStore(
      { status: "error", code: "mfa_enrollment_failed" },
      503,
    );
  }

  const factorId = validateMfaFactorId(enrollmentResult.data.id);
  const qrCode = normalizeQrCode(enrollmentResult.data.totp.qr_code);
  const secret = validateTotpSecret(enrollmentResult.data.totp.secret);

  if (!factorId || !qrCode || !secret) {
    return jsonNoStore(
      { status: "error", code: "mfa_enrollment_failed" },
      503,
    );
  }

  return jsonNoStore({
    status: "enrollment_started",
    factorId,
    qrCode,
    secret,
  });
}

function mapIdentityError(
  status: Exclude<
    Awaited<ReturnType<typeof inspectAdminIdentity>>["status"],
    "admin"
  >,
): string {
  switch (status) {
    case "anonymous":
      return "invalid_credentials";
    case "inactive":
      return "account_restricted";
    case "missing_profile":
      return "account_unavailable";
    case "not_admin":
      return "admin_forbidden";
    case "unavailable":
      return "mfa_unavailable";
  }
}

async function enrollTotpFactor(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<
  | { ok: true; data: RawTotpEnrollment }
  | { ok: false; stage: string; httpStatus?: number }
> {
  const sessionResult = await supabase.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    return { ok: false, stage: "session" };
  }

  const env = getServerEnv();
  const response = await fetch(`${env.supabaseUrl}/auth/v1/factors`, {
    method: "POST",
    headers: {
      apikey: env.supabasePublishableKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      factor_type: "totp",
      friendly_name: "Admin authenticator",
    }),
  });

  if (!response.ok) {
    return { ok: false, stage: "http", httpStatus: response.status };
  }

  const payload: unknown = await response.json().catch(() => null);

  const data = readRawTotpEnrollment(payload);

  return data
    ? { ok: true, data }
    : { ok: false, stage: "shape", httpStatus: response.status };
}

type RawTotpEnrollment = {
  id: string;
  type: "totp";
  totp: {
    qr_code: string;
    secret: string;
  };
};

function readRawTotpEnrollment(
  value: unknown,
): RawTotpEnrollment | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const totp = record.totp;

  if (
    typeof record.id !== "string" ||
    record.type !== "totp" ||
    typeof totp !== "object" ||
    totp === null
  ) {
    return null;
  }

  const totpRecord = totp as Record<string, unknown>;

  if (
    typeof totpRecord.qr_code !== "string" ||
    typeof totpRecord.secret !== "string"
  ) {
    return null;
  }

  return {
    id: record.id,
    type: "totp",
    totp: {
      qr_code: totpRecord.qr_code,
      secret: totpRecord.secret,
    },
  };
}

function normalizeQrCode(value: string): string | null {
  const trimmed = value.trim();
  const base64Image = readBase64Image(trimmed);

  if (
    !trimmed.startsWith("data:image/") &&
    !trimmed.startsWith("<svg") &&
    !trimmed.startsWith("<?xml") &&
    !/^%3c(svg|%3fxml)/i.test(trimmed) &&
    !base64Image
  ) {
    return null;
  }

  const dataUri = normalizeQrDataUri(trimmed, base64Image);

  if (
    dataUri.length < 32 ||
    dataUri.length > 500000 ||
    !dataUri.startsWith("data:image/")
  ) {
    return null;
  }

  return dataUri;
}

function normalizeQrDataUri(
  value: string,
  base64Image: Base64Image | null,
): string {
  if (value.startsWith("data:image/")) {
    return value;
  }

  if (/^%3c(svg|%3fxml)/i.test(value)) {
    return `data:image/svg+xml;utf-8,${value}`;
  }

  if (base64Image) {
    return `data:image/${base64Image.kind};base64,${base64Image.value}`;
  }

  return `data:image/svg+xml;base64,${Buffer.from(value, "utf8").toString(
    "base64",
  )}`;
}

type Base64Image = {
  kind: "jpeg" | "png" | "svg+xml" | "webp";
  value: string;
};

function readBase64Image(value: string): Base64Image | null {
  const normalized = value
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  if (
    normalized.length < 16 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    return null;
  }

  const prefix = Buffer.from(normalized.slice(0, 128), "base64");
  const textPrefix = prefix.toString("utf8");

  if (textPrefix.startsWith("<svg") || textPrefix.startsWith("<?xml")) {
    return { kind: "svg+xml", value: normalized };
  }

  if (
    prefix[0] === 0x89 &&
    prefix[1] === 0x50 &&
    prefix[2] === 0x4e &&
    prefix[3] === 0x47
  ) {
    return { kind: "png", value: normalized };
  }

  if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return { kind: "jpeg", value: normalized };
  }

  if (
    prefix.toString("ascii", 0, 4) === "RIFF" &&
    prefix.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { kind: "webp", value: normalized };
  }

  return null;
}

function validateTotpSecret(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, "").toUpperCase();

  if (
    normalized.length < 16 ||
    normalized.length > 128 ||
    !/^[A-Z2-7]+=*$/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function jsonNoStore(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}
