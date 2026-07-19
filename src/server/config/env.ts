import "server-only";

import {
  EnvironmentConfigurationError,
  getPublicEnv,
  type PublicEnv,
} from "@/lib/config/public-env";

const APP_ENVIRONMENTS = ["local", "preview", "production"] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export type ServerEnv = PublicEnv & {
  appEnv: AppEnvironment;
};

export function getServerEnv(): ServerEnv {
  return {
    appEnv: getAppEnvironment(process.env.APP_ENV),
    ...getPublicEnv(),
  };
}

function getAppEnvironment(value: string | undefined): AppEnvironment {
  const normalized = value?.trim();

  if (!normalized || !isAppEnvironment(normalized)) {
    throw new EnvironmentConfigurationError();
  }

  return normalized;
}

function isAppEnvironment(value: string): value is AppEnvironment {
  return (APP_ENVIRONMENTS as readonly string[]).includes(value);
}
