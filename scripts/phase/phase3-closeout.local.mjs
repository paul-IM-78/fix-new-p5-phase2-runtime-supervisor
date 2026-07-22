import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const LOCAL_SUPABASE_API_ORIGIN = "http://127.0.0.1:55721";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const PROJECT_LABEL = "staking-wallet-web";
const NPM_EXEC_PATH = process.env.npm_execpath;
const READINESS_ATTEMPTS_BEFORE_RESTART = 12;
const READINESS_ATTEMPTS_AFTER_RESTART = 12;
const LOCAL_AUTH_STABILITY_DELAY_MS = 8000;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

async function main() {
  await assertPreconditions();
  await resetLocalDatabase("Phase 3 initial reset");
  await runPhase3RegressionScripts();
  await assertStaticFinancialBoundary();
  pass("Phase 3 closeout integration");
}

async function assertPreconditions() {
  assert(existsSync(".env.local"), ".env.local precondition");
  await waitForLocalSupabaseReadiness("Phase 3 closeout precondition readiness");
  pass("Phase 3 closeout preconditions");
}

async function runPhase3RegressionScripts() {
  const scripts = [
    ["test:phase2:closeout:local", "Phase 2 closeout", 600000, true],
    ["test:ledger:core:local", "Ledger core", 240000, false],
    ["test:ledger:opening-corrections:local", "Opening corrections", 300000, false],
    ["test:ledger:deposits:local", "Deposit state machine", 300000, false],
    ["test:ledger:withdrawals:local", "Withdrawal state machine", 360000, false],
    ["test:ledger:withdrawal-execution:local", "Withdrawal execution", 420000, false],
    ["test:ledger:balance-overview:local", "Balance overview", 240000, false],
  ];

  for (const [scriptName, label, timeout, useSharedAppOrigin] of scripts) {
    if (scriptName === "test:phase2:closeout:local") {
      await waitForLocalSupabaseReadiness(`${label} readiness`);
      await wait(LOCAL_AUTH_STABILITY_DELAY_MS);
    } else {
      await resetLocalDatabase(`${label} reset`);
    }

    await runNpmScript(scriptName, label, timeout, { useSharedAppOrigin });
    await waitForLocalSupabaseReadiness(`${label} readiness`);
  }
}

async function resetLocalDatabase(label) {
  await runNpmScriptWithoutReset("db:reset:local", label, 180000);
  await waitForLocalSupabaseReadiness(`${label} readiness`);
  await wait(LOCAL_AUTH_STABILITY_DELAY_MS);
}

async function runNpmScript(
  scriptName,
  label,
  timeout,
  { useSharedAppOrigin } = {},
) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      getNpmArgs(scriptName),
      {
        env: buildChildScriptEnv({ useSharedAppOrigin }),
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10,
      },
    );

    assertOutputSafe(`${stdout}\n${stderr}`, `${label} output`);
    pass(label);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`FAIL ${label} output`)
    ) {
      throw error;
    }

    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;

    assertOutputSafe(output, `${label} failure output`);
    throw new Error(`FAIL ${label}`);
  }
}

function buildChildScriptEnv({ useSharedAppOrigin } = {}) {
  const env = { ...process.env };

  if (useSharedAppOrigin) {
    env.APP_ORIGIN = APP_ORIGIN;
    env.NEXT_PUBLIC_SITE_URL = APP_ORIGIN;
  } else {
    delete env.APP_ORIGIN;
    delete env.NEXT_PUBLIC_SITE_URL;
  }

  return env;
}

async function runNpmScriptWithoutReset(scriptName, label, timeout) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      getNpmArgs(scriptName),
      {
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10,
      },
    );

    assertOutputSafe(`${stdout}\n${stderr}`, `${label} output`);
    pass(label);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`FAIL ${label} output`)
    ) {
      throw error;
    }

    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;

    assertOutputSafe(output, `${label} failure output`);
    throw new Error(`FAIL ${label}`);
  }
}

async function waitForLocalSupabaseReadiness(label) {
  const warmup = await waitForReadinessAttempts(
    READINESS_ATTEMPTS_BEFORE_RESTART,
  );

  if (warmup.ready) {
    pass(label);
    return;
  }

  await restartProjectKong();

  const afterRestart = await waitForReadinessAttempts(
    READINESS_ATTEMPTS_AFTER_RESTART,
  );

  if (afterRestart.ready) {
    pass(`${label} after bounded Kong restart`);
    return;
  }

  throw new Error(`FAIL ${label} ${afterRestart.state}`);
}

async function waitForReadinessAttempts(attempts) {
  let lastState = "not_checked";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await readLocalSupabaseReadiness();

    if (status.ready) {
      return status;
    }

    lastState = status.state;
    await wait(Math.min(500 + attempt * 250, 2000));
  }

  return { ready: false, state: lastState };
}

async function readLocalSupabaseReadiness() {
  const kong = await readProjectKongContainerName().catch(() => null);
  const authStatus = await fetchStatus(
    `${LOCAL_SUPABASE_API_ORIGIN}/auth/v1/health`,
  );
  const restStatus = await fetchStatus(`${LOCAL_SUPABASE_API_ORIGIN}/rest/v1/`);
  const appHealthStatus = await fetchStatus(`${APP_ORIGIN}/api/v1/health`);
  const appConfigStatus = await fetchStatus(
    `${APP_ORIGIN}/api/v1/readiness/config`,
  );
  const mailStatus = await fetchStatus(`${MAILPIT_ORIGIN}/api/v1/messages`);
  const databaseReady = await readDatabaseReady();
  const ready =
    Boolean(kong) &&
    isKongUpstreamReady(authStatus) &&
    isKongUpstreamReady(restStatus) &&
    appHealthStatus === 200 &&
    appConfigStatus === 200 &&
    mailStatus === 200 &&
    databaseReady;

  return {
    ready,
    state: `kong:${kong ? "ok" : "missing"} auth:${authStatus} rest:${restStatus} app:${appHealthStatus}/${appConfigStatus} mail:${mailStatus} db:${databaseReady ? "ok" : "fail"}`,
  };
}

async function restartProjectKong() {
  const kongContainer = await readProjectKongContainerName();

  await execFileAsync("docker", ["restart", kongContainer], {
    timeout: 30000,
    windowsHide: true,
  });
}

async function readProjectKongContainerName() {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "ps",
      "--format",
      "{{.Names}}\t{{.Label \"com.supabase.cli.project\"}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Label \"com.docker.compose.service\"}}",
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
      const [name, supabaseProject, composeProject, composeService] =
        line.split("\t");

      return {
        name,
        supabaseProject,
        composeProject,
        composeService,
      };
    })
    .filter(
      (container) =>
        (container.composeService === "kong" ||
          container.name === `supabase_kong_${PROJECT_LABEL}`) &&
        (container.supabaseProject === PROJECT_LABEL ||
          container.composeProject === PROJECT_LABEL),
    );

  assert(containers.length === 1, "Project Kong container scope");

  return containers[0].name;
}

async function assertStaticFinancialBoundary() {
  const balancePage = readFileSync("src/app/balances/page.tsx", "utf8");
  const helper = readFileSync(
    "src/server/finance/current-financial-overview.ts",
    "utf8",
  );
  const atomicHelper = readFileSync("src/lib/ledger/atomic-units.ts", "utf8");

  for (const marker of [
    "createBrowserClient",
    "service_role",
    "user_roles",
    "list_admin",
    "getSession(",
    "Address",
    "Transaction ID",
    "Explorer",
    "Private Key",
    "Mnemonic",
  ]) {
    assert(!helper.includes(marker), `Overview helper no ${marker}`);
    assert(!balancePage.includes(marker), `Balance page no ${marker}`);
  }

  for (const marker of [
    "Number(",
    "parseInt(",
    "parseFloat(",
    "toLocaleString(",
  ]) {
    assert(!helper.includes(marker), `Overview helper no ${marker}`);
    assert(!atomicHelper.includes(marker), `Atomic helper no ${marker}`);
  }

  assert(
    helper.includes("inspectAccountAccess(supabase)"),
    "Overview helper account guard",
  );
  assert(
    helper.includes('supabase.rpc("list_current_user_ledger_balances")'),
    "Overview helper balance RPC",
  );
  assert(
    balancePage.includes('redirect("/auth/sign-in?next=/balances")'),
    "Balance page safe redirect",
  );
  pass("Phase 3 static financial boundary");
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

async function readDatabaseReady() {
  try {
    return (await sqlScalar("select 'ready';")) === "ready";
  } catch {
    return false;
  }
}

async function sqlScalar(sql) {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "exec",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    {
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    },
  );

  assertOutputSafe(stdout, "SQL output");

  return stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

function isKongUpstreamReady(status) {
  return status >= 200 && status < 500;
}

function getNpmArgs(scriptName) {
  assert(Boolean(NPM_EXEC_PATH), "npm exec path");

  return [NPM_EXEC_PATH, "--silent", "run", scriptName];
}

function assertOutputSafe(output, label) {
  assert(!EMAIL_PATTERN.test(output), `${label} no email`);
  assert(!JWT_PATTERN.test(output), `${label} no jwt`);

  for (const marker of [
    "access_token",
    "refresh_token",
    "sb-access-token",
    "sb-refresh-token",
    "service_role",
    "SUPABASE_SERVICE_ROLE",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL=",
    "DIRECT_DATABASE_URL=",
    "BEGIN PRIVATE KEY",
    "PRIVATE_KEY=",
    "MNEMONIC=",
    "SEED_PHRASE=",
  ]) {
    assert(!output.includes(marker), `${label} no ${marker}`);
  }
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : "FAIL unknown";

  if (message.startsWith("FAIL ")) {
    console.error(redactDiagnostic(message));
  } else {
    console.error("FAIL phase 3 closeout");
  }

  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]");
}
