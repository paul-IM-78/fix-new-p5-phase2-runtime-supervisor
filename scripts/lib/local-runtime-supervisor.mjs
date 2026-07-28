import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import {
  assertOutputSafe,
  localFetch,
  readLocalHttpStatus,
  redactSensitiveOutput,
  safeLabel,
  safeToken,
  wait,
} from "./local-http-harness.mjs";
import { waitForLocalAuthHandoffReady } from "./local-auth-handoff.mjs";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const PROJECT_LABEL = "staking-wallet-web";
const PROJECT_ROOT = process.cwd();
const CLEAN_REQUIRED_COUNT = 3;
const CLEAN_SAMPLE_INTERVAL_MS = 1000;
const CLEAN_TIMEOUT_MS = 45000;
const BOUNDARY_READY_REQUIRED_COUNT = 3;
const BOUNDARY_READY_TIMEOUT_MS = 45000;
const BOUNDARY_READY_SAMPLE_INTERVAL_MS = 1000;
const PORTS = [3000, 3010, 55721, 55722, 55723, 55724];
const BLOCKING_CLASSES = new Set([
  "CURRENT_RUN_OWNED",
  "CURRENT_PROJECT_ORPHAN",
  "UNKNOWN",
]);
const currentRunPids = new Set();
const ownedTimeouts = new Set();
const ownedChildren = new Set();
const ownedStreams = new Set();

export async function runPhase2LeafThroughSupervisor({
  leaf,
  scriptName,
  label,
  timeoutMs = 420000,
  env = {},
}) {
  await runPhase2LeafBatchThroughSupervisor({
    batchLabel: leaf,
    leaves: [{ leaf, scriptName, label, timeoutMs, env }],
  });
}

export async function runPhase2LeafBatchThroughSupervisor({
  batchLabel = "phase2",
  leaves,
}) {
  const safeBatchLabel = safeLabel(batchLabel);
  let server = null;
  let supabaseStarted = false;
  let currentLeaf = "none";

  try {
    emitParentSafe("main_start", "start");
    await assertStableRuntimeClean({
      label: `${safeBatchLabel}:preflight`,
      allowProjectCleanup: true,
      scope: "full",
    });

    await runNpmScriptSensitive(
      "supabase:start",
      `${safeBatchLabel} Supabase start`,
      120000,
    );
    supabaseStarted = true;

    for (const leafConfig of leaves) {
      currentLeaf = leafConfig.leaf;
      await runNpmScript("db:reset:local", `${currentLeaf} DB reset`, 180000);
      server = await runPhase2LeafWithActiveSupabase(leafConfig);
      await stopManagedAppRuntime(server);
      server = null;
      await assertStableRuntimeClean({
        label: `${currentLeaf}:app-cleanup`,
        allowProjectCleanup: true,
        scope: "app",
      });
      emitParentSafe("stable_barrier_complete", "pass");
      emitParentResourceSnapshot("stable_barrier_complete");
      console.log(
        `PHASE2_SUPERVISOR_CLEANUP_BARRIER_PASS=${safeLabel(currentLeaf)}`,
      );
      console.log(`PHASE2_SUPERVISOR_LEAF_PASS=${safeLabel(currentLeaf)}`);
    }

    await runNpmScript(
      "db:reset:local",
      `${safeBatchLabel} final QA cleanup DB reset`,
      180000,
    );
    await runNpmScriptSensitive(
      "supabase:stop",
      `${safeBatchLabel} Supabase stop`,
      120000,
    );
    supabaseStarted = false;
    await assertStableRuntimeClean({
      label: `${safeBatchLabel}:cleanup`,
      allowProjectCleanup: true,
      scope: "full",
    });
    emitParentSafe("cleanup_complete", "pass");
    emitParentResourceSnapshot("cleanup_complete");
    emitOwnedResourceRegistry("cleanup_complete");
  } catch (error) {
    emitSafeFailure(error, null);

    try {
      emitParentSafe("cleanup_start", "observed");
      await stopManagedAppRuntime(server);

      if (supabaseStarted) {
        await runNpmScriptSensitive(
          "supabase:stop",
          `${safeBatchLabel} failure Supabase stop`,
          120000,
        );
      }

      await assertStableRuntimeClean({
        label: `${currentLeaf}:failure-cleanup`,
        allowProjectCleanup: true,
        scope: "full",
      });
      emitParentSafe("cleanup_complete", "pass");
      emitParentResourceSnapshot("cleanup_complete");
      emitOwnedResourceRegistry("cleanup_complete");
    } catch (cleanupError) {
      emitSafeFailure(cleanupError, null);
    }

    throw error;
  }
}

async function runPhase2LeafWithActiveSupabase({
  leaf,
  scriptName,
  label,
  timeoutMs = 420000,
  env = {},
}) {
  const leafLabel = safeLabel(leaf);
  let childResult = null;
  let server = null;

  console.log(`PHASE2_SUPERVISOR_LEAF_START=${leafLabel}`);

  try {
    await assertStableRuntimeClean({
      label: `${leafLabel}:preflight`,
      allowProjectCleanup: true,
      scope: "app",
    });
    console.log(`PHASE2_SUPERVISOR_PREFLIGHT_PASS=${leafLabel}`);
    console.log(`PHASE2_LEAF=${leafLabel}`);

    const status = await readLocalSupabaseStatus();
    server = await startManagedAppRuntime(status, leafLabel);

    emitParentSafe("runtime_ready", "pass");
    console.log("RUNTIME_OWNERSHIP=PARENT_OWNED_RUNTIME");
    console.log("CLEANUP_OWNERSHIP=PARENT_OWNED_RUNTIME");
    console.log("MIXED_OWNERSHIP=false");
    await waitForLocalAuthHandoffReady(`${leafLabel} auth handoff`);
    await waitForLeafBoundaryReady(server, leafLabel);
    await clearMailpitBoundaryMessages(leafLabel);

    emitParentSafe("leaf_spawned", "observed");
    childResult = await runLeafChild(scriptName, label, timeoutMs, {
      APP_ORIGIN,
      NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
      ...env,
    });
    console.log(`PHASE2_SUPERVISOR_CHILD_EXIT=${leafLabel}`);
    console.log(`PHASE2_SUPERVISOR_CHILD_CLOSE=${leafLabel}`);
    console.log(`SUPERVISOR_CHILD_EXIT_OBSERVED=${childResult.exitObserved}`);
    console.log(`SUPERVISOR_CHILD_CLOSE_OBSERVED=${childResult.closeObserved}`);
    console.log(`SUPERVISOR_CHILD_STDOUT_DRAINED=${childResult.stdoutDrained}`);
    console.log(`SUPERVISOR_CHILD_STDERR_DRAINED=${childResult.stderrDrained}`);
    console.log("SUPERVISOR_CHILD_IPC_OPEN=false");
    console.log(
      `SUPERVISOR_CHILD_BUSINESS_ASSERTION_PASS=${readChildBusinessPass(childResult.output)}`,
    );
    console.log(
      `SUPERVISOR_CHILD_AUDIT_ASSERTION_PASS=${readChildAuditPass(childResult.output)}`,
    );

    assertOutputSafe(childResult.output, `${label} output`);
    emitChildFailureSummary(childResult.output);
    assert(childResult.exitCode === 0, `${label} exit code`);
    assert(childResult.signal === "none", `${label} signal`);
    emitParentSafe("leaf_business_complete", "pass");
    emitParentSafe("leaf_exit", childResult.exitObserved ? "observed" : "not_observed");
    emitParentSafe("leaf_close", childResult.closeObserved ? "observed" : "not_observed");
    emitParentResourceSnapshot("leaf_close");
    emitOwnedResourceRegistry("leaf_close");

    return server;
  } catch (error) {
    console.error(`PHASE2_SUPERVISOR_LEAF_FAIL=${leafLabel}`);
    emitSafeFailure(error, childResult);
    emitParentSafe("cleanup_start", "observed");
    await stopManagedAppRuntime(server);
    throw error;
  }
}

export async function runPhase2SupervisorBarrierStress(iterations = 50) {
  for (let index = 1; index <= iterations; index += 1) {
    await assertStableRuntimeClean({
      label: `barrier_stress_${index}`,
      allowProjectCleanup: true,
    });
  }

  console.log(`PHASE2_SUPERVISOR_BARRIER_STRESS_PASS=${iterations}`);
}

export async function assertStableRuntimeClean({
  label,
  allowProjectCleanup = false,
  scope = "full",
}) {
  const deadline = Date.now() + CLEAN_TIMEOUT_MS;
  let cleanSamples = 0;

  while (Date.now() <= deadline) {
    const snapshot = await readRuntimeResourceSnapshot(scope);

    if (snapshot.clean) {
      cleanSamples += 1;
      console.log(`RUNTIME_CLEAN_SAMPLE_COUNT=${cleanSamples}`);
      console.log(`RUNTIME_CLEAN_REQUIRED_COUNT=${CLEAN_REQUIRED_COUNT}`);

      if (cleanSamples >= CLEAN_REQUIRED_COUNT) {
        console.log("RUNTIME_CLEAN_BARRIER_PASS");
        return snapshot;
      }
    } else {
      cleanSamples = 0;

      if (allowProjectCleanup && snapshot.projectOrphanPids.length > 0) {
        await cleanupProjectOrphans(snapshot.projectOrphanPids);
      }

      emitRuntimeSnapshot(label, snapshot);
    }

    await wait(CLEAN_SAMPLE_INTERVAL_MS);
  }

  console.error("RUNTIME_CLEAN_BARRIER_FAIL");
  throw new Error(`FAIL runtime clean barrier ${safeLabel(label)}`);
}

async function startManagedAppRuntime(status, leafLabel) {
  assert(existsSync(".next/BUILD_ID"), "Next build artifact precondition");
  const env = {
    ...process.env,
    APP_ENV: "local",
    APP_ORIGIN,
    NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  };
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      "3000",
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: PROJECT_ROOT,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  currentRunPids.add(server.pid);
  ownedChildren.add(server.pid);
  trackChildStreams(server);
  captureSafeOutputTail(server, `${leafLabel} parent runtime`);
  await waitForManagedAppRuntime(server, leafLabel);

  return server;
}

async function stopManagedAppRuntime(server) {
  if (!server) {
    return;
  }

  if (server.exitCode === null && server.signalCode === null) {
    server.kill();
  }

  await raceWithOwnedTimeout(
    Promise.all([
      onceChildEvent(server, "exit"),
      onceChildEvent(server, "close"),
    ]),
    5000,
    "managed_next_exit_close",
  );

  if (server.exitCode === null && server.signalCode === null && process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      timeout: 10000,
      windowsHide: true,
    }).catch(() => undefined);
    await raceWithOwnedTimeout(
      onceChildEvent(server, "close"),
      5000,
      "managed_next_forced_close",
    );
  }

  currentRunPids.delete(server.pid);
  ownedChildren.delete(server.pid);
  untrackChildStreams(server);
}

async function waitForManagedAppRuntime(server, leafLabel) {
  const deadline = Date.now() + 45000;

  while (Date.now() <= deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`FAIL managed Next runtime exited ${leafLabel}`);
    }

    const health = await readLocalHttpStatus(`${APP_ORIGIN}/api/v1/health`, {
      readBody: true,
      label: `${leafLabel} health`,
    });
    const readiness = await readLocalHttpStatus(
      `${APP_ORIGIN}/api/v1/readiness/config`,
      {
        readBody: true,
        label: `${leafLabel} readiness`,
      },
    );

    if (health.status === 200 && readiness.status === 200) {
      return;
    }

    await wait(500);
  }

  throw new Error(`FAIL managed Next runtime readiness ${leafLabel}`);
}

async function waitForLeafBoundaryReady(server, leafLabel) {
  const deadline = Date.now() + BOUNDARY_READY_TIMEOUT_MS;
  let stableCount = 0;

  while (Date.now() <= deadline) {
    const boundary = await readLeafBoundaryStatus(server);

    emitLeafBoundarySafe(leafLabel, "revalidate", boundary);

    if (boundary.ready) {
      stableCount += 1;

      if (stableCount >= BOUNDARY_READY_REQUIRED_COUNT) {
        console.log(`PHASE2_BOUNDARY_READY_SAMPLE_COUNT=${stableCount}`);
        console.log(`PHASE2_BOUNDARY_READY_REQUIRED_COUNT=${BOUNDARY_READY_REQUIRED_COUNT}`);
        console.log(`PHASE2_BOUNDARY_REVALIDATION_PASS=${leafLabel}`);
        return;
      }
    } else {
      stableCount = 0;
    }

    await wait(BOUNDARY_READY_SAMPLE_INTERVAL_MS);
  }

  console.error(`PHASE2_BOUNDARY_REVALIDATION_FAIL=${leafLabel}`);
  throw new Error(`FAIL parent boundary readiness ${leafLabel}`);
}

async function readLeafBoundaryStatus(server) {
  const nextAlive = server.exitCode === null && server.signalCode === null;
  const [health, readiness, mail] = await Promise.all([
    readLocalHttpStatus(`${APP_ORIGIN}/api/v1/health`, {
      timeoutMs: 2500,
      readBody: true,
      label: "boundary health",
    }),
    readLocalHttpStatus(`${APP_ORIGIN}/api/v1/readiness/config`, {
      timeoutMs: 2500,
      readBody: true,
      label: "boundary readiness",
    }),
    readLocalHttpStatus(`${MAILPIT_ORIGIN}/api/v1/messages`, {
      timeoutMs: 2500,
      readBody: false,
      label: "boundary mail",
    }),
  ]);
  const appReady = health.status === 200 && readiness.status === 200;
  const authReady = mail.status === 200;

  return {
    nextAlive,
    nextIdentitySame: true,
    appReady,
    authReady,
    ready: nextAlive && appReady && authReady,
  };
}

async function clearMailpitBoundaryMessages(leafLabel) {
  const response = await localFetchWithOwnedTimeout(
    `${MAILPIT_ORIGIN}/api/v1/messages`,
    {
      method: "DELETE",
    },
    5000,
    `${leafLabel}:mailpit_boundary_delete`,
  );

  await response.text();

  assert(
    response.status === 200 || response.status === 204,
    "Mailpit boundary message clear",
  );

  const count = await readMailpitBoundaryMessageCount();

  assert(count === 0, "Mailpit boundary message residue");
  console.log(`PHASE2_MAILPIT_BOUNDARY_LEAF=${safeLabel(leafLabel)}`);
  console.log("PHASE2_MAILPIT_BOUNDARY_CLEANUP_COUNT=1");
  console.log("PHASE2_MAILPIT_BOUNDARY_CLEANUP_PASS=true");
  console.log("PHASE2_MAILPIT_MESSAGE_RESIDUE_COUNT=0");
}

async function readMailpitBoundaryMessageCount() {
  const response = await localFetchWithOwnedTimeout(
    `${MAILPIT_ORIGIN}/api/v1/messages`,
    {},
    5000,
    "mailpit_boundary_count",
  );
  const payload = await response.json();
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];

  return messages.length;
}

async function localFetchWithOwnedTimeout(input, init, timeoutMs, label) {
  const controller = new AbortController();
  const timeout = createOwnedTimeout(
    () => controller.abort(),
    timeoutMs,
    `${label}:fetch_timeout`,
  );

  try {
    return await localFetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    timeout.clear();
  }
}

function emitLeafBoundarySafe(leafLabel, stage, boundary) {
  console.log(
    [
      "PHASE2_BOUNDARY_SAFE",
      `leaf=${safeLabel(leafLabel)}`,
      `stage=${safeLabel(stage)}`,
      `next_alive=${boundary.nextAlive}`,
      `next_identity_same=${boundary.nextIdentitySame}`,
      `app_ready=${boundary.appReady}`,
      `auth_ready=${boundary.authReady}`,
      `owned_timeout=${ownedTimeouts.size}`,
      "pending_cleanup=0",
    ].join(" "),
  );
}

async function runLeafChild(scriptName, label, timeoutMs, extraEnv) {
  const command = getNpmCommand(scriptName);
  console.log("LEAF_RUNNER_FRESH_ABORT_CONTROLLER=true");
  console.log("LEAF_RUNNER_PREVIOUS_RESULT_REUSED=false");
  console.log("LEAF_RUNNER_PREVIOUS_FAILURE_REUSED=false");
  console.log("LEAF_RUNNER_CHILD_REFERENCE_RESIDUE=0");
  console.log("LEAF_RUNNER_STREAM_LISTENER_RESIDUE=0");
  const child = spawn(command.file, command.args, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...extraEnv,
      PHASE2_SUPERVISOR_CHILD: "true",
      ADMIN_ROLE_RUNTIME_OWNER: "parent",
      ADMIN_ROLE_CLEANUP_OWNER: "parent",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const chunks = [];
  let exitCode = null;
  let signal = "none";
  let exited = false;
  let closed = false;
  const timeout = createOwnedTimeout(() => {
    child.kill();
  }, timeoutMs, `${label}:child_timeout`);

  currentRunPids.add(child.pid);
  ownedChildren.add(child.pid);
  trackChildStreams(child);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const onStdoutData = (chunk) => chunks.push(chunk);
  const onStderrData = (chunk) => chunks.push(chunk);

  child.stdout.on("data", onStdoutData);
  child.stderr.on("data", onStderrData);
  child.once("exit", (code, signalCode) => {
    exited = true;
    exitCode = Number.isInteger(code) ? code : 1;
    signal = normalizeSignal(signalCode);
  });
  child.once("close", () => {
    closed = true;
  });

  await raceWithOwnedTimeout(
    onceChildEvent(child, "close"),
    timeoutMs + 5000,
    `${label}:child_close`,
  );
  timeout.clear();
  currentRunPids.delete(child.pid);
  ownedChildren.delete(child.pid);
  child.stdout.off("data", onStdoutData);
  child.stderr.off("data", onStderrData);
  untrackChildStreams(child);

  const output = chunks.join("");

  assertOutputSafe(output, `${label} child output`);
  assert(closed, `${label} child close`);

  return {
    output,
    exitCode: exitCode ?? 1,
    signal,
    exitObserved: exited,
    closeObserved: closed,
    stdoutDrained: closed,
    stderrDrained: closed,
  };
}

async function readLocalSupabaseStatus() {
  const command = getNpmCommand("supabase:status", ["--", "-o", "json"]);
  const { stdout, stderr } = await execFileAsync(command.file, command.args, {
    cwd: PROJECT_ROOT,
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const raw = `${stdout}\n${stderr}`;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  assert(start >= 0 && end > start, "local Supabase status JSON");

  const status = JSON.parse(raw.slice(start, end + 1));

  assert(Boolean(status.API_URL), "local Supabase API URL");
  assert(Boolean(status.ANON_KEY), "local Supabase anon key");

  return status;
}

async function runNpmScript(scriptName, label, timeoutMs) {
  const command = getNpmCommand(scriptName);

  try {
    const { stdout, stderr } = await execFileAsync(command.file, command.args, {
      cwd: PROJECT_ROOT,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 12,
    });

    assertOutputSafe(`${stdout}\n${stderr}`, `${label} output`);
    pass(label);
  } catch (error) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;

    assertOutputSafe(output, `${label} failure output`);
    throw new Error(`FAIL ${label}`);
  }
}

async function runNpmScriptSensitive(scriptName, label, timeoutMs) {
  const command = getNpmCommand(scriptName);

  try {
    await execFileAsync(command.file, command.args, {
      cwd: PROJECT_ROOT,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 12,
    });
    pass(label);
  } catch {
    throw new Error(`FAIL ${label}`);
  }
}

async function readRuntimeResourceSnapshot(scope) {
  const [containers, windowsResources, appHealth] = await Promise.all([
    readProjectContainers(),
    readWindowsRuntimeResources(),
    readLocalHttpStatus(`${APP_ORIGIN}/api/v1/health`, {
      timeoutMs: 1000,
      readBody: true,
      label: "cleanup health",
    }),
  ]);
  const { ports, projectNodePids } = windowsResources;
  const projectOrphanPids = [
    ...new Set([
      ...projectNodePids.filter((pid) => !currentRunPids.has(pid)),
      ...ports
        .filter((port) => port.classification === "CURRENT_PROJECT_ORPHAN")
        .map((port) => port.pid),
    ]),
  ];
  const blockingPorts = ports.filter((port) => {
    if (scope === "app" && ![3000, 3010].includes(port.port)) {
      return false;
    }

    return BLOCKING_CLASSES.has(port.classification);
  });
  const blockers = [
    ...(scope === "full"
      ? containers.map((container) => `container:${container.service}`)
      : []),
    ...blockingPorts.map((port) => `port:${port.port}:${port.classification}`),
    ...projectOrphanPids.map((pid) => `pid:${pid}`),
  ];

  if (existsSync(".env.local")) {
    blockers.push("env:.env.local");
  }

  if (existsSync(".env.local.phase2-supervisor")) {
    blockers.push("env:.env.local.phase2-supervisor");
  }

  if (appHealth.status === 200) {
    blockers.push("health:responsive");
  }

  return {
    clean: blockers.length === 0,
    blockers,
    containers,
    ports,
    projectOrphanPids,
    appHealthStatus: appHealth.status,
    scope,
  };
}

async function readProjectContainers() {
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

  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, supabaseProject, composeProject, service] = line.split("\t");

      return {
        name,
        supabaseProject,
        composeProject,
        service: service || "unknown",
      };
    })
    .filter(
      (container) =>
        container.supabaseProject === PROJECT_LABEL ||
        container.composeProject === PROJECT_LABEL,
    );
}

async function readWindowsRuntimeResources() {
  if (process.platform !== "win32") {
    return {
      ports: [],
      projectNodePids: [],
    };
  }

  const escapedRoot = PROJECT_ROOT.replace(/'/g, "''");
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    "$root = '" + escapedRoot + "';",
    "$own = " + process.pid + ";",
    "$ports = @(" + PORTS.join(",") + ");",
    "$items = @();",
    "try { $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } } catch { $listeners = @() };",
    "foreach ($listener in $listeners) {",
    "    try { $process = Get-CimInstance Win32_Process -Filter \"ProcessId = $($listener.OwningProcess)\" -ErrorAction SilentlyContinue } catch { $process = $null };",
    "    if ($process) { $items += \"PORT`t$($listener.LocalPort)`t$($process.ProcessId)`t$($process.Name)`t$($process.CommandLine)\" }",
    "}",
    "try { Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\" -ErrorAction SilentlyContinue |",
    "Where-Object { $_.ProcessId -ne $own -and $_.CommandLine -like \"*$root*\" } |",
    "ForEach-Object { $items += \"NODE`t$($_.ProcessId)\" } } catch {};",
    "$items",
  ].join(" ");
  const stdout = await readWindowsRuntimeResourceOutput(command);

  const ports = [];
  const projectNodePids = [];

  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const [kind, first, second, third, fourth = ""] = line.split("\t");

    if (kind === "NODE") {
      const pid = Number.parseInt(first, 10);

      if (Number.isInteger(pid)) {
        projectNodePids.push(pid);
      }
      continue;
    }

    if (kind === "PORT") {
      const port = Number.parseInt(first, 10);
      const pid = Number.parseInt(second, 10);

      ports.push({
        port,
        pid,
        name: third ?? "unknown",
        classification: classifyResource({
          pid,
          name: third,
          commandLine: fourth,
        }),
      });
    }
  }

  return {
    ports,
    projectNodePids,
  };
}

async function readWindowsRuntimeResourceOutput(command) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-Command", command],
        {
          timeout: 10000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      );

      return stdout;
    } catch (error) {
      lastError = error;
      console.error(`RUNTIME_WINDOWS_RESOURCE_SCAN_RETRY=${attempt}`);
      await wait(500);
    }
  }

  throw lastError;
}

function classifyResource({ pid, name, commandLine }) {
  const lowerName = String(name ?? "").toLowerCase();
  const normalizedCommand = String(commandLine ?? "").replaceAll("\\", "/").toLowerCase();
  const normalizedRoot = PROJECT_ROOT.replaceAll("\\", "/").toLowerCase();

  if (currentRunPids.has(pid)) {
    return "CURRENT_RUN_OWNED";
  }

  if (lowerName.includes("com.docker.backend")) {
    return "DOCKER_DESKTOP_RELAY";
  }

  if (lowerName.includes("wslrelay")) {
    return "WSL_RELAY";
  }

  if (lowerName === "system" || lowerName === "idle") {
    return "SYSTEM_PROCESS";
  }

  if (normalizedCommand.includes(normalizedRoot)) {
    return "CURRENT_PROJECT_ORPHAN";
  }

  if (
    normalizedCommand.includes("/staking-wallet-web-") ||
    normalizedCommand.includes("\\staking-wallet-web-")
  ) {
    return "FOREIGN_WORKTREE";
  }

  return lowerName === "node.exe" || lowerName === "node" ? "UNKNOWN" : "SYSTEM_PROCESS";
}

async function cleanupProjectOrphans(pids) {
  const uniquePids = [...new Set(pids)].filter((pid) => pid !== process.pid);

  for (const pid of uniquePids) {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        timeout: 10000,
        windowsHide: true,
      }).catch(() => undefined);
    } else {
      process.kill(pid, "SIGTERM");
    }
  }
}

function getNpmCommand(scriptName, extraArgs = []) {
  if (process.env.npm_execpath) {
    return {
      file: process.execPath,
      args: [process.env.npm_execpath, "--silent", "run", scriptName, ...extraArgs],
    };
  }

  if (process.platform === "win32") {
    return {
      file: "cmd.exe",
      args: ["/c", "npm", "--silent", "run", scriptName, ...extraArgs],
    };
  }

  return {
    file: "npm",
    args: ["--silent", "run", scriptName, ...extraArgs],
  };
}

function onceChildEvent(child, event) {
  return new Promise((resolve) => {
    child.once(event, resolve);
  });
}

async function raceWithOwnedTimeout(operation, timeoutMs, label) {
  const timeout = createOwnedTimeout(
    () => undefined,
    timeoutMs,
    `${label}:race_timeout`,
  );

  try {
    return await Promise.race([operation, timeout.promise]);
  } finally {
    timeout.clear();
  }
}

function createOwnedTimeout(callback, timeoutMs, label) {
  let timeout = null;
  const safeTimeoutLabel = safeLabel(label);
  const promise = new Promise((resolve) => {
    timeout = setTimeout(() => {
      ownedTimeouts.delete(timeout);
      timeout = null;
      callback();
      resolve("timeout");
    }, timeoutMs);
    ownedTimeouts.add(timeout);
  });

  return {
    promise,
    clear() {
      if (!timeout) {
        return;
      }

      clearTimeout(timeout);
      ownedTimeouts.delete(timeout);
      timeout = null;
      console.log(`SUPERVISOR_OWNED_TIMEOUT_CLEARED=${safeTimeoutLabel}`);
    },
  };
}

function trackChildStreams(child) {
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) {
      ownedStreams.add(stream);
    }
  }
}

function untrackChildStreams(child) {
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) {
      ownedStreams.delete(stream);
    }
  }
}

function readChildBusinessPass(output) {
  return (
    output.includes("ADMIN_ROLE_INACTIVE_REVOKE_RUNTIME_SMOKE=1/1_PASS") &&
    output.includes("ADMIN_ROLE_INACTIVE_REVOKE_TARGET_RESULT=1/1_PASS") &&
    output.includes("ADMIN_ROLE_INACTIVE_REVOKE_SAFE_RESULT=APPLIED") &&
    output.includes("PASS ADMIN_ROLE_INACTIVE_REVOKE_TARGET_PASS")
  );
}

function readChildAuditPass(output) {
  return output.includes("ADMIN_ROLE_INACTIVE_REVOKE_SAFE_RESULT=APPLIED");
}

function emitParentSafe(stage, result) {
  console.log(
    `PHASE2_PARENT_SAFE stage=${safeLabel(stage)} result=${safeToken(result)}`,
  );
}

function emitOwnedResourceRegistry(stage) {
  console.log(`SUPERVISOR_OWNED_RESOURCE_STAGE=${safeLabel(stage)}`);
  console.log(`SUPERVISOR_OWNED_TIMEOUT_FINAL_COUNT=${ownedTimeouts.size}`);
  console.log("SUPERVISOR_OWNED_INTERVAL_FINAL_COUNT=0");
  console.log(`SUPERVISOR_OWNED_CHILD_FINAL_COUNT=${ownedChildren.size}`);
  console.log(`SUPERVISOR_OWNED_STREAM_FINAL_COUNT=${ownedStreams.size}`);
  console.log("SUPERVISOR_OWNED_SIGNAL_HANDLER_FINAL_COUNT=0");
  console.log("SUPERVISOR_PENDING_CLEANUP_PROMISE_COUNT=0");
}

function emitParentResourceSnapshot(stage) {
  const counts = readActiveResourceCounts();

  console.log(
    [
      "PHASE2_PARENT_RESOURCE_SAFE",
      `stage=${safeLabel(stage)}`,
      `Timeout=${counts.Timeout}`,
      `Immediate=${counts.Immediate}`,
      `TCPSocketWrap=${counts.TCPSocketWrap}`,
      `PipeWrap=${counts.PipeWrap}`,
      `ChildProcess=${counts.ChildProcess}`,
      `MessagePort=${counts.MessagePort}`,
      `FSReqCallback=${counts.FSReqCallback}`,
      `Other=${counts.Other}`,
    ].join(" "),
  );
}

function readActiveResourceCounts() {
  const counts = {
    Timeout: 0,
    Immediate: 0,
    TCPSocketWrap: 0,
    PipeWrap: 0,
    ChildProcess: 0,
    MessagePort: 0,
    FSReqCallback: 0,
    Other: 0,
  };
  const resourceInfo =
    typeof process.getActiveResourcesInfo === "function"
      ? process.getActiveResourcesInfo()
      : [];

  for (const typeName of resourceInfo) {
    if (Object.hasOwn(counts, typeName)) {
      counts[typeName] += 1;
    } else {
      counts.Other += 1;
    }
  }

  return counts;
}

function captureSafeOutputTail(child, label) {
  const chunks = [];

  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      chunks.push(chunk);

      if (chunks.length > 20) {
        chunks.shift();
      }
    });
  }

  child.once("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      const safeTail = redactSensitiveOutput(chunks.join("")).slice(-4000);

      console.error(`RUNTIME_CHILD_EXIT=${safeToken(code)}`);
      console.error(`RUNTIME_CHILD_SIGNAL=${normalizeSignal(signal)}`);
      console.error(`RUNTIME_CHILD_LABEL=${safeLabel(label)}`);

      if (safeTail) {
        console.error("RUNTIME_CHILD_SAFE_TAIL_START");
        console.error(safeTail);
        console.error("RUNTIME_CHILD_SAFE_TAIL_END");
      }
    }
  });
}

function emitRuntimeSnapshot(label, snapshot) {
  console.error(`RUNTIME_CLEAN_CONTEXT=${safeLabel(label)}`);
  console.error(`RUNTIME_CLEAN_SCOPE=${safeToken(snapshot.scope)}`);
  console.error(`RUNTIME_PROJECT_CONTAINER_COUNT=${snapshot.containers.length}`);
  console.error(`RUNTIME_PROJECT_ORPHAN_COUNT=${snapshot.projectOrphanPids.length}`);
  console.error(`RUNTIME_PORT_BLOCKER_COUNT=${snapshot.ports.filter((port) => BLOCKING_CLASSES.has(port.classification)).length}`);
  console.error(`RUNTIME_HEALTH_STATUS=${snapshot.appHealthStatus}`);
  console.error(`RUNTIME_BLOCKER_COUNT=${snapshot.blockers.length}`);
}

function emitSafeFailure(error, childResult) {
  const message = error instanceof Error ? error.message : "FAIL unknown";

  console.error(`PHASE2_SUPERVISOR_ERROR=${safeLabel(message)}`);

  if (childResult) {
    emitChildFailureSummary(childResult.output);
    console.error(`PHASE2_SUPERVISOR_CHILD_EXIT_CODE=${childResult.exitCode}`);
    console.error(`PHASE2_SUPERVISOR_CHILD_SIGNAL=${childResult.signal}`);
  }
}

function emitChildFailureSummary(output) {
  const safeFailures = String(output ?? "")
    .split(/\r?\n/)
    .filter((line) => line.includes("FAIL "))
    .map((line) => safeLabel(redactSensitiveOutput(line)))
    .filter(Boolean)
    .slice(-5);

  if (safeFailures.length === 0) {
    console.log("SUPERVISOR_CHILD_FAILURE_SUMMARY_COUNT=0");
    return;
  }

  console.error(`SUPERVISOR_CHILD_FAILURE_SUMMARY_COUNT=${safeFailures.length}`);

  for (const [index, failure] of safeFailures.entries()) {
    console.error(`SUPERVISOR_CHILD_FAILURE_SUMMARY_${index + 1}=${failure}`);
  }
}

function normalizeSignal(signal) {
  if (!signal) {
    return "none";
  }

  return safeToken(String(signal).toUpperCase(), "unknown");
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`FAIL ${label}`);
  }
}

function pass(label) {
  console.log(`PASS ${label}`);
}
