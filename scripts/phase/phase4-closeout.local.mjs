import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const LOCAL_SUPABASE_API_ORIGIN = "http://127.0.0.1:55721";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const PROJECT_LABEL = "staking-wallet-web";
const NPM_EXEC_PATH = process.env.npm_execpath;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const READINESS_ATTEMPTS = 18;
const LOCAL_AUTH_STABILITY_DELAY_MS = 8000;
const PHASE4_DB_BASELINE_FILES = 15;
const PHASE4_DB_BASELINE_TESTS = 848;
const PHASE4_BASELINE_DB_TEST_FILES = [
  "supabase/tests/database/admin_authorization.test.sql",
  "supabase/tests/database/admin_role_commands.test.sql",
  "supabase/tests/database/auth_identity.test.sql",
  "supabase/tests/database/deposit_state_machine.test.sql",
  "supabase/tests/database/domain_lifecycle_commands.test.sql",
  "supabase/tests/database/double_entry_ledger_core.test.sql",
  "supabase/tests/database/opening_balance_corrections.test.sql",
  "supabase/tests/database/project_asset_wallet_domain.test.sql",
  "supabase/tests/database/staking_position_lock.test.sql",
  "supabase/tests/database/staking_position_unlock.test.sql",
  "supabase/tests/database/staking_product_domain.test.sql",
  "supabase/tests/database/staking_reward_settlement.test.sql",
  "supabase/tests/database/wallet_account_status_commands.test.sql",
  "supabase/tests/database/withdrawal_execution_settlement.test.sql",
  "supabase/tests/database/withdrawal_state_machine.test.sql",
];

async function main() {
  let server = null;

  try {
    await assertLocalPreconditions();
    await runNpmScriptSensitive("supabase:start", "Supabase start", 120000);
    await waitForLocalSupabaseReadiness("Initial Supabase readiness");
    await runNpmScript("db:reset:local", "Initial DB reset", 180000);
    await runNpmScript("build", "Initial Next.js build", 240000);

    server = await startProductionServer();
    await assertProductionSmoke();

    await runPhase4Suites();

    await runNpmScript("db:reset:local", "Closeout DB reset", 180000);
    await runNpmScript("db:lint:local", "Closeout DB lint", 180000);
    assertPhase4BaselineDbTestFiles();
    const dbTestOutput = await runNpmScript(
      "db:test:local",
      "Closeout pgTAP",
      300000,
    );
    assertPgTapBaseline(dbTestOutput);
    const generatedTypesBefore = readFileSync(
      "src/types/database.types.ts",
      "utf8",
    );
    await runNpmScript("db:types:local", "Closeout DB types", 180000);
    assertGeneratedTypeDiff(generatedTypesBefore);
    await assertQaResidue();

    await stopProductionServer(server);
    server = null;

    await runNpmScript("lint", "Closeout Next.js lint", 180000);
    await runNpmScript("build", "Closeout Next.js build", 240000);
    server = await startProductionServer();
    await assertProductionSmoke();

    await assertSecretAndFinancialMarkers();
    await assertPackageLockClean();
    await stopProductionServer(server);
    server = null;
    await runNpmScriptSensitive("supabase:stop", "Supabase stop", 120000);
    await assertProcessCleanup();

    pass("Phase 4 closeout cleanup");
    console.log("PHASE4_CLOSEOUT_PASS");
  } catch (error) {
    if (server) {
      await stopProductionServer(server).catch(() => undefined);
    }

    await runNpmScriptSensitive("supabase:stop", "Supabase stop", 120000)
      .catch(() => undefined);

    throw error;
  }
}

async function assertLocalPreconditions() {
  assert(existsSync(".env.local"), ".env.local precondition");
  await assertProjectScope();
  pass("Phase 4 local preconditions");
}

async function runPhase4Suites() {
  const suites = [
    ["test:phase3:closeout:local", "Phase 3 Closeout", 1800000, false],
    ["test:staking:products:local", "Staking Product", 420000, true],
    ["test:staking:positions:local", "Position Lock", 420000, true],
    ["test:staking:position-unlock:local", "Position Unlock", 420000, true],
    ["test:staking:rewards:local", "Reward Settlement", 420000, true],
    ["test:staking:lifecycle:local", "Integrated Lifecycle", 420000, true],
  ];

  for (const [scriptName, label, timeout, resetBefore] of suites) {
    if (resetBefore) {
      await runNpmScript("db:reset:local", `${label} reset`, 180000);
      await waitForLocalSupabaseReadiness(`${label} readiness`);
      await wait(LOCAL_AUTH_STABILITY_DELAY_MS);
    } else {
      await waitForLocalSupabaseReadiness(`${label} readiness`);
      await wait(LOCAL_AUTH_STABILITY_DELAY_MS);
    }

    await runSuiteScript(scriptName, label, timeout);
    await waitForLocalSupabaseReadiness(`${label} post readiness`);
  }
}

async function runSuiteScript(scriptName, label, timeout) {
  try {
    return await runNpmScript(scriptName, label, timeout);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== `FAIL ${label}`) {
      throw error;
    }

    await waitForLocalSupabaseReadiness(`${label} retry readiness`);
    await wait(LOCAL_AUTH_STABILITY_DELAY_MS);

    return await runNpmScript(scriptName, label, timeout);
  }
}

function assertPhase4BaselineDbTestFiles() {
  const seen = new Set();

  assert(
    PHASE4_BASELINE_DB_TEST_FILES.length === PHASE4_DB_BASELINE_FILES,
    "Phase 4 baseline DB test count",
  );

  for (const filePath of PHASE4_BASELINE_DB_TEST_FILES) {
    assert(!seen.has(filePath), "Phase 4 baseline DB test duplicate");
    assert(filePath.endsWith(".test.sql"), "Phase 4 baseline DB test extension");
    assert(existsSync(filePath), "PHASE4_BASELINE_DB_TEST_MISSING");
    assert(statSync(filePath).isFile(), "Phase 4 baseline DB test file");
    seen.add(filePath);
  }

  console.log(`PHASE4_DB_BASELINE_FILES=${PHASE4_DB_BASELINE_FILES}`);
  console.log(`PHASE4_DB_BASELINE_TESTS=${PHASE4_DB_BASELINE_TESTS}`);
  pass("Phase 4 baseline DB test files");
}

function assertPgTapBaseline(output) {
  const summary = parsePgTapSummary(output);

  console.log(`DB_OBSERVED_FILES=${summary.files}`);
  console.log(`DB_OBSERVED_TESTS=${summary.tests}`);

  assert(summary.files >= PHASE4_DB_BASELINE_FILES, "Closeout pgTAP files");
  assert(summary.tests >= PHASE4_DB_BASELINE_TESTS, "Closeout pgTAP tests");
  assert(summary.resultPass, "Closeout pgTAP result");
  assert(summary.skipCount === 0, "Closeout pgTAP skip");
  pass("PHASE4_DB_BASELINE_PASS");
}

function parsePgTapSummary(output) {
  const summaryMatch = output.match(/Files=(\d+),\s*Tests=(\d+)/);

  assert(Boolean(summaryMatch), "Closeout pgTAP summary parse");

  const explicitSkipMatches = [
    ...output.matchAll(/\b(?:Skipped|Skip)=(\d+)\b/gi),
  ];
  const skipCount = explicitSkipMatches.reduce(
    (total, match) => total + Number(match[1]),
    0,
  );

  assert(
    explicitSkipMatches.length > 0 || !/#\s*SKIP\b/i.test(output),
    "Closeout pgTAP skip parse",
  );

  return {
    files: Number(summaryMatch[1]),
    tests: Number(summaryMatch[2]),
    resultPass: /Result:\s*PASS\b/.test(output),
    skipCount,
  };
}

async function assertProductionSmoke() {
  const expected = [
    ["/api/v1/health", 200],
    ["/api/v1/readiness/config", 200],
    ["/", 200],
  ];

  for (const [path, status] of expected) {
    await assertStatus(path, status, `${path} smoke`);
  }

  for (const path of [
    "/dashboard",
    "/account",
    "/wallet",
    "/balances",
    "/deposits",
    "/staking",
    "/admin",
    "/admin/staking-products",
    "/admin/staking-positions",
  ]) {
    const response = await fetch(`${APP_ORIGIN}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.text();

    assertOutputSafe(body, `${path} smoke body`);
    assert(response.status >= 300 && response.status < 400, `${path} guard`);
  }

  pass("Production smoke");
}

async function assertStatus(path, status, label) {
  const response = await fetch(`${APP_ORIGIN}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.text();

  assert(response.status === status, label);
  assertOutputSafe(body, `${label} body`);
}

function assertGeneratedTypeDiff(expectedContent) {
  const currentContent = readFileSync(
    "src/types/database.types.ts",
    "utf8",
  );

  assert(currentContent === expectedContent, "Generated type diff");
  pass("Generated type diff 0");
}

async function assertQaResidue() {
  const residue = await sqlScalar(`
    select
      (select count(*) from auth.users)::text || ',' ||
      (select count(*) from public.profiles)::text || ',' ||
      (select count(*) from public.projects)::text || ',' ||
      (select count(*) from public.supported_assets)::text || ',' ||
      (select count(*) from public.wallet_accounts)::text || ',' ||
      (select count(*) from private.staking_products)::text || ',' ||
      (select count(*) from private.staking_product_admin_audit_events)::text || ',' ||
      (select count(*) from private.staking_positions)::text || ',' ||
      (select count(*) from private.staking_position_command_audit_events)::text || ',' ||
      (select count(*) from private.staking_position_reward_settlements)::text || ',' ||
      (select count(*) from private.staking_reward_command_audit_events)::text || ',' ||
      (select count(*) from private.ledger_journals)::text || ',' ||
      (select count(*) from private.ledger_entries)::text;
  `);

  assert(
    residue.split(",").every((count) => count === "0"),
    "QA residue 0",
  );
  pass("QA residue 0");
}

async function assertSecretAndFinancialMarkers() {
  const files = [
    ...(await gitDiffNames()),
    ...(await gitUntrackedNames()),
  ];
  let jwtCount = 0;
  let privateKeyCount = 0;
  let secretAssignmentCount = 0;
  let localKeyCount = 0;

  for (const file of files) {
    const content = await readWorkingFile(file);

    jwtCount += countMatches(content, JWT_PATTERN);
    privateKeyCount += countMatches(
      content,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    );
    secretAssignmentCount += countMatches(
      content,
      /^(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_URL|DIRECT_DATABASE_URL|JWT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|PRIVATE_KEY|MNEMONIC|SEED_PHRASE)=.+$/gim,
    );
    localKeyCount += countMatches(
      content,
      /sb_secret_[A-Za-z0-9_-]{16,}|sb_publishable_[A-Za-z0-9_-]{16,}/g,
    );
  }

  assert(jwtCount === 0, "Secret scan JWT");
  assert(privateKeyCount === 0, "Secret scan private key");
  assert(secretAssignmentCount === 0, "Secret scan env assignments");
  assert(localKeyCount === 0, "Secret scan local keys");
  pass("Secret and financial marker scan");
}

async function assertPackageLockClean() {
  const clean = await gitPathClean("package-lock.json");

  assert(clean, "Package lock clean");
  pass("Package lock unchanged");
}

async function assertProcessCleanup() {
  const portOutput = await execText("netstat", ["-ano"], 10000);
  const blockedPorts = [":3000", ":3010", ":55721", ":55722", ":55723", ":55724"];
  const listening = [];
  const listenerLines = portOutput
    .split(/\r?\n/)
    .filter((line) => line.includes("LISTENING"))
    .filter((line) => blockedPorts.some((port) => line.includes(port)));

  for (const line of listenerLines) {
    const processId = line.trim().split(/\s+/).at(-1) ?? "";
    const processName = await readProcessName(processId).catch(() => "");

    if (
      line.includes(":3000") &&
      (processName === "com.docker.backend.exe" ||
        processName === "wslrelay.exe")
    ) {
      continue;
    }

    listening.push(line);
  }

  const containers = await readProjectContainers();

  assert(listening.length === 0, "Port listener cleanup");
  assert(containers.length === 0, "Supabase container cleanup");
  pass("Process cleanup");
}

async function waitForLocalSupabaseReadiness(label) {
  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    const ready =
      (await fetchStatus(`${LOCAL_SUPABASE_API_ORIGIN}/auth/v1/health`)) >=
        200 &&
      (await fetchStatus(`${LOCAL_SUPABASE_API_ORIGIN}/rest/v1/`)) >= 200 &&
      (await fetchStatus(`${MAILPIT_ORIGIN}/api/v1/messages`)) === 200 &&
      (await readDatabaseReady());

    if (ready) {
      pass(label);
      return;
    }

    await wait(Math.min(500 + attempt * 250, 2500));
  }

  const kong = await readProjectKongContainerName();
  await execFileAsync("docker", ["restart", kong], {
    timeout: 30000,
    windowsHide: true,
  });

  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    const ready =
      (await fetchStatus(`${LOCAL_SUPABASE_API_ORIGIN}/auth/v1/health`)) >=
        200 &&
      (await fetchStatus(`${LOCAL_SUPABASE_API_ORIGIN}/rest/v1/`)) >= 200 &&
      (await fetchStatus(`${MAILPIT_ORIGIN}/api/v1/messages`)) === 200 &&
      (await readDatabaseReady());

    if (ready) {
      pass(`${label} after bounded Kong restart`);
      return;
    }

    await wait(Math.min(500 + attempt * 250, 2500));
  }

  throw new Error(`FAIL ${label}`);
}

async function readDatabaseReady() {
  try {
    return (await sqlScalar("select 'ready';")) === "ready";
  } catch {
    return false;
  }
}

async function fetchStatus(url) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });

    return response.status;
  } catch {
    return 0;
  }
}

async function startProductionServer() {
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
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ORIGIN,
        NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
      },
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    },
  );

  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error("FAIL production server exited");
    }

    try {
      const response = await fetch(`${APP_ORIGIN}/api/v1/health`, {
        redirect: "manual",
      });

      if (response.status === 200) {
        pass("Production server readiness");
        return server;
      }
    } catch {
      await wait(500);
    }
  }

  throw new Error("FAIL production server readiness");
}

async function stopProductionServer(server) {
  if (!server || server.exitCode !== null) {
    return;
  }

  server.kill();
  await Promise.race([
    new Promise((resolve) => {
      server.once("exit", resolve);
    }),
    wait(5000),
  ]);
}

async function assertProjectScope() {
  const containers = await readProjectContainers();

  for (const container of containers) {
    assert(
      container.supabaseProject === PROJECT_LABEL ||
        container.composeProject === PROJECT_LABEL,
      "Project container scope",
    );
  }
}

async function readProjectKongContainerName() {
  const containers = await readProjectContainers();
  const kongContainers = containers.filter(
    (container) => container.composeService === "kong",
  );

  assert(kongContainers.length === 1, "Project Kong container scope");

  return kongContainers[0].name;
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
        container.supabaseProject === PROJECT_LABEL ||
        container.composeProject === PROJECT_LABEL ||
        container.name.endsWith(`_${PROJECT_LABEL}`),
    );
}

async function runNpmScript(scriptName, label, timeout) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      getNpmArgs(scriptName),
      {
        env: {
          ...process.env,
          APP_ORIGIN,
          NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
        },
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 20,
      },
    );
    const output = `${stdout}\n${stderr}`;

    assertOutputSafe(output, `${label} output`);
    pass(label);

    return output;
  } catch (error) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;

    assertOutputSafe(output, `${label} failure output`);
    throw new Error(`FAIL ${label}`);
  }
}

async function runNpmScriptSensitive(scriptName, label, timeout) {
  await execFileAsync(process.execPath, getNpmArgs(scriptName), {
    env: {
      ...process.env,
      APP_ORIGIN,
      NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
    },
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
  });
  pass(label);
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

async function readProcessName(processId) {
  const output = await execText(
    "tasklist",
    ["/FI", `PID eq ${processId}`, "/FO", "CSV", "/NH"],
    10000,
  );
  const firstLine = output.trim().split(/\r?\n/)[0] ?? "";
  const match = firstLine.match(/^"([^"]+)"/);

  return match?.[1] ?? "";
}

async function gitDiffNames(pathspec) {
  const args = ["diff", "--name-only"];

  if (pathspec) {
    args.push("--", pathspec);
  }

  const output = await execText("git", args, 10000);

  return parseGitPathOutput(output);
}

async function gitUntrackedNames() {
  const output = await execText(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    10000,
  );

  return parseGitPathOutput(output);
}

function parseGitPathOutput(output) {
  return output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith("warning: "));
}

async function gitPathClean(pathspec) {
  try {
    await execFileAsync("git", ["diff", "--quiet", "--", pathspec], {
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    });

    return true;
  } catch (error) {
    const output = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;

    assertOutputSafe(output, `git diff ${pathspec} output`);

    if (error?.code === 1) {
      return false;
    }

    throw error;
  }
}

async function readWorkingFile(path) {
  return readFileSync(path, "utf8");
}

async function execText(command, args, timeout) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
  });
  const output = `${stdout}${stderr}`;

  assertOutputSafe(output, `${command} output`);

  return output;
}

function getNpmArgs(scriptName) {
  assert(Boolean(NPM_EXEC_PATH), "npm exec path");

  return [NPM_EXEC_PATH, "--silent", "run", scriptName];
}

function countMatches(value, pattern) {
  const globalPattern = pattern.global
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`);

  return [...value.matchAll(globalPattern)].length;
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
    "otpauth://",
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
    console.error(redactDiagnostic(`FAIL phase 4 closeout ${message}`));
  }

  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]");
}
