import { ENVIRONMENT_CONFIGURATION_INVALID } from "@/lib/config/public-env";
import { getServerEnv } from "@/server/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    const env = getServerEnv();

    return Response.json(
      {
        status: "ready",
        service: "staking-wallet-web",
        environment: env.appEnv,
        supabaseConfigured: Boolean(
          env.supabaseUrl && env.supabasePublishableKey,
        ),
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      {
        status: "not_ready",
        code: ENVIRONMENT_CONFIGURATION_INVALID,
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
