export const ENVIRONMENT_CONFIGURATION_INVALID =
  "ENVIRONMENT_CONFIGURATION_INVALID";

export type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export class EnvironmentConfigurationError extends Error {
  readonly code = ENVIRONMENT_CONFIGURATION_INVALID;

  constructor() {
    super(ENVIRONMENT_CONFIGURATION_INVALID);
    this.name = "EnvironmentConfigurationError";
  }
}

export function getPublicEnv(): PublicEnv {
  return {
    supabaseUrl: normalizeSupabaseUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    supabasePublishableKey: getRequiredString(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}

function getRequiredString(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new EnvironmentConfigurationError();
  }

  return normalized;
}

function normalizeSupabaseUrl(value: string | undefined): string {
  const candidate = getRequiredString(value);
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(candidate);
  } catch {
    throw new EnvironmentConfigurationError();
  }

  const isLocalHttpHost =
    parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname === "127.0.0.1";

  if (parsedUrl.username || parsedUrl.password) {
    throw new EnvironmentConfigurationError();
  }

  if (parsedUrl.search || parsedUrl.hash) {
    throw new EnvironmentConfigurationError();
  }

  if (parsedUrl.protocol === "http:" && !isLocalHttpHost) {
    throw new EnvironmentConfigurationError();
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new EnvironmentConfigurationError();
  }

  const pathname =
    parsedUrl.pathname === "/"
      ? ""
      : parsedUrl.pathname.replace(/\/+$/, "");

  return `${parsedUrl.origin}${pathname}`;
}
