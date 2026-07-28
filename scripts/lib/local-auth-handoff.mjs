import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const LOCAL_SUPABASE_API_ORIGIN = "http://127.0.0.1:55721";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const PROJECT_LABEL = "staking-wallet-web";
const AUTH_INTERNAL_ORIGIN = "http://127.0.0.1:9999";
const REQUIRED_STABLE_READINESS = 2;
const MAX_ATTEMPTS = 45;
const POLL_INTERVAL_MS = 1000;

let activeReadinessPromise = null;

export async function waitForLocalAuthHandoffReady(label = "Auth handoff") {
  if (!activeReadinessPromise) {
    activeReadinessPromise = waitForLocalAuthHandoffReadyUnlocked(label).finally(
      () => {
        activeReadinessPromise = null;
      },
    );
  }

  return activeReadinessPromise;
}

async function waitForLocalAuthHandoffReadyUnlocked(label) {
  const warmup = await waitForStableReadiness({ allowKongRestart: true });

  if (warmup.ready) {
    const marker = warmup.kongRestarted
      ? "KONG_AUTH_UPSTREAM_RECOVERY_PASS"
      : "AUTH_HANDOFF_READY";

    pass(`${label} ${marker}`);
    return warmup;
  }

  throw new Error(`FAIL ${label} ${warmup.state}`);
}

async function waitForStableReadiness({ allowKongRestart }) {
  let stableCount = 0;
  let lastState = "not_checked";
  let kongRestarted = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const status = await readLocalAuthHandoffStatus();

    if (status.ready) {
      stableCount += 1;

      if (stableCount >= REQUIRED_STABLE_READINESS) {
        return {
          ready: true,
          state: status.state,
          kongRestarted,
        };
      }
    } else {
      stableCount = 0;
      lastState = status.state;

      if (
        allowKongRestart &&
        !kongRestarted &&
        status.safeCause === "KONG_AUTH_UPSTREAM_STALE"
      ) {
        await restartProjectKong();
        kongRestarted = true;
        stableCount = 0;
      }
    }

    await wait(POLL_INTERVAL_MS);
  }

  return {
    ready: false,
    state: `LOCAL_AUTH_HANDOFF_READINESS_TIMEOUT ${lastState}`,
    kongRestarted,
  };
}

async function readLocalAuthHandoffStatus() {
  const [dbReady, authContainer, kongContainer] = await Promise.all([
    readDatabaseReady(),
    readProjectServiceContainer("auth", `supabase_auth_${PROJECT_LABEL}`),
    readProjectServiceContainer("kong", `supabase_kong_${PROJECT_LABEL}`),
  ]);
  const authInternalStatus = authContainer
    ? await readAuthInternalStatus(authContainer.name)
    : { ready: false, status: 0 };
  const authRouteStatus = await fetchStatus(
    `${LOCAL_SUPABASE_API_ORIGIN}/auth/v1/health`,
  );
  const restStatus = await fetchStatus(`${LOCAL_SUPABASE_API_ORIGIN}/rest/v1/`);
  const appHealthStatus = await fetchStatus(`${APP_ORIGIN}/api/v1/health`);
  const appConfigStatus = await fetchStatus(
    `${APP_ORIGIN}/api/v1/readiness/config`,
  );
  const mailStatus = await fetchStatus(`${MAILPIT_ORIGIN}/api/v1/messages`);
  const authRunning = authContainer?.status === "running";
  const kongRunning = kongContainer?.status === "running";
  const authHealthy = authContainer?.health !== "unhealthy";
  const kongHealthy = kongContainer?.health !== "unhealthy";
  const authRouteReady = authRouteStatus > 0 && authRouteStatus < 500;
  const ready =
    dbReady &&
    authRunning &&
    authHealthy &&
    authInternalStatus.ready &&
    kongRunning &&
    kongHealthy &&
    authRouteReady &&
    restStatus > 0 &&
    restStatus < 500 &&
    appHealthStatus === 200 &&
    appConfigStatus === 200 &&
    mailStatus === 200;
  const safeCause =
    authRunning &&
    authInternalStatus.ready &&
    kongRunning &&
    (authRouteStatus === 0 || authRouteStatus >= 500)
      ? "KONG_AUTH_UPSTREAM_STALE"
      : "AUTH_HANDOFF_NOT_READY";

  return {
    ready,
    safeCause,
    state: [
      `cause:${ready ? "AUTH_HANDOFF_READY" : safeCause}`,
      `db:${dbReady ? "ok" : "fail"}`,
      `auth:${authRunning ? "running" : "missing"}/${authContainer?.health ?? "none"}`,
      `auth-internal:${authInternalStatus.status}`,
      `kong:${kongRunning ? "running" : "missing"}/${kongContainer?.health ?? "none"}`,
      `auth-route:${authRouteStatus}`,
      `rest:${restStatus}`,
      `app:${appHealthStatus}/${appConfigStatus}`,
      `mail:${mailStatus}`,
    ].join(" "),
  };
}

async function readDatabaseReady() {
  const dbContainer = await readProjectServiceContainer(
    "db",
    `supabase_db_${PROJECT_LABEL}`,
  );

  if (!dbContainer || dbContainer.status !== "running") {
    return false;
  }

  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "exec",
        dbContainer.name,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "select 'ready';",
      ],
      {
        timeout: 5000,
        windowsHide: true,
      },
    );

    return stdout.trim().split(/\r?\n/).at(-1)?.trim() === "ready";
  } catch {
    return false;
  }
}

async function readAuthInternalStatus(authContainerName) {
  try {
    await execFileAsync(
      "docker",
      [
        "exec",
        authContainerName,
        "sh",
        "-lc",
        `wget -qO- --timeout=2 ${AUTH_INTERNAL_ORIGIN}/health >/dev/null`,
      ],
      {
        timeout: 5000,
        windowsHide: true,
      },
    );

    return {
      ready: true,
      status: 200,
    };
  } catch {
    return {
      ready: false,
      status: 0,
    };
  }
}

async function fetchStatus(url) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(2000),
    });

    return response.status;
  } catch {
    return 0;
  }
}

async function restartProjectKong() {
  const kongContainer = await readProjectServiceContainer(
    "kong",
    `supabase_kong_${PROJECT_LABEL}`,
  );

  assert(Boolean(kongContainer), "Project kong container scope");

  await execFileAsync("docker", ["restart", kongContainer.name], {
    timeout: 30000,
    windowsHide: true,
  });
}

async function readProjectServiceContainer(composeServiceName, fallbackName) {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "ps",
      "--format",
      "{{.Names}}\t{{.Status}}\t{{.Label \"com.supabase.cli.project\"}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Label \"com.docker.compose.service\"}}",
    ],
    {
      timeout: 10000,
      windowsHide: true,
    },
  );
  const containers = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, statusText, supabaseProject, composeProject, composeService] =
        line.split("\t");

      return {
        name,
        status: statusText.toLowerCase().startsWith("up")
          ? "running"
          : "not_running",
        health: parseHealth(statusText),
        supabaseProject,
        composeProject,
        composeService,
      };
    })
    .filter(
      (container) =>
        (container.composeService === composeServiceName ||
          container.name === fallbackName) &&
        (container.supabaseProject === PROJECT_LABEL ||
          container.composeProject === PROJECT_LABEL),
    );

  assert(
    containers.length <= 1,
    `Project ${composeServiceName} container scope`,
  );

  return containers[0] ?? null;
}

function parseHealth(statusText) {
  const normalized = statusText.toLowerCase();

  if (normalized.includes("unhealthy")) {
    return "unhealthy";
  }

  if (normalized.includes("healthy")) {
    return "healthy";
  }

  if (normalized.includes("health: starting")) {
    return "starting";
  }

  return "none";
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`FAIL ${label}`);
  }
}

function pass(label) {
  console.log(`PASS ${label}`);
}
