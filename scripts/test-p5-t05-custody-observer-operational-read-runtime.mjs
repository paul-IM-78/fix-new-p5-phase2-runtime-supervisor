import { execFile, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServerClient } from "@supabase/ssr";

import { createCookieJar } from "./lib/http-cookie-jar.mjs";
import {
  assertOutputSafe,
  localFetch,
  readLocalHttpStatus,
  wait,
} from "./lib/local-http-harness.mjs";

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(".");
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";
const APP_PORT = new URL(APP_ORIGIN).port;
const LOCAL_SUPABASE_API_ORIGIN = "http://127.0.0.1:55721";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const AUTH_INTERNAL_ORIGIN = "http://127.0.0.1:9999";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const PROJECT_LABEL = "staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const QUARANTINE_PARENT = "D:\\Ai\\.staking-wallet-runtime-quarantine";
const DIRECT_MANAGED_APP_HOST = "127.0.0.1";
const DIRECT_RUNTIME_READY_TIMEOUT_MS = 45000;
const DIRECT_RUNTIME_EXIT_TIMEOUT_MS = 5000;
const DIRECT_RUNTIME_PORT_RELEASE_TIMEOUT_MS = 15000;
const DIRECT_RUNTIME_CLEAN_SAMPLE_COUNT = 3;
const DIRECT_RUNTIME_CLEAN_SAMPLE_INTERVAL_MS = 1000;
const READINESS_MAX_ATTEMPTS = 45;
const READINESS_POLL_INTERVAL_MS = 1000;
const REQUIRED_STABLE_READINESS = 2;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_KEY_DENYLIST = new Set([
  "idempotencykey",
  "idempotency_key",
  "profileid",
  "profile_id",
  "actorprofileid",
  "actor_profile_id",
  "requestedbyprofileid",
  "requested_by_profile_id",
  "openedbyprofileid",
  "opened_by_profile_id",
  "lastactorprofileid",
  "last_actor_profile_id",
  "jwt",
  "token",
  "cookie",
  "rawpayload",
  "raw_payload",
  "rawresponse",
  "raw_response",
  "providercredential",
  "provider_credential",
  "checkpointcursor",
  "checkpoint_cursor",
  "observationkey",
  "observation_key",
]);
const RUNTIME_PHASE = parseRuntimePhase(process.argv.slice(2));

let passCount = 0;

async function main() {
  const suffix = randomUUID().replaceAll("-", "").toLowerCase();
  const sharedPassword = `Read-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-p5t05-admin-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const userEmail = `qa-p5t05-user-${Date.now()}-${suffix.slice(8, 16)}@example.test`;
  const restrictedEmail = `qa-p5t05-restricted-${Date.now()}-${suffix.slice(16, 24)}@example.test`;
  const missingRunId = "00000000-0000-4000-8000-000000000001";

  await withQuarantinedEnv(async () => {
    await withSelfOwnedRuntime(async () => {
      await assertPublicSmoke();
      await assertMalformedDetail();
      const fixture = await createCustodyOperationalFixture();
      const fingerprintBefore = await readCustodyOperationalFingerprint(fixture);

      let userJar = null;
      let userId = null;
      if (RUNTIME_PHASE === "foundation" || RUNTIME_PHASE === "list" || RUNTIME_PHASE === "full") {
        userJar = await signUpConfirmAndSignIn(userEmail, sharedPassword, "/account", "QA Admin Read User");
        userId = await readUserIdByEmail(userEmail);
        await assertOperationalAuth(userJar, missingRunId, 403, "admin_access_required", "USER_AAL1");
      }

      const adminJar = await signUpConfirmAndSignIn(
        adminEmail,
        sharedPassword,
        "/admin",
        "QA Admin Read Admin",
      );
      const adminUserId = await readUserIdByEmail(adminEmail);

      if (userJar && userId) {
        await bootstrapAdminRole(userId, "local custody runtime temporary user aal2 bootstrap");
        await enrollAndVerifyMfa(userJar, userId, "USER");
        await revokeTemporaryAdminRole(userId);
        await assertOperationalAuth(userJar, missingRunId, 403, "admin_access_required", "USER_AAL2");
      }

      await bootstrapAdminRole(adminUserId);
      await assertOperationalAnonymous(missingRunId);
      await assertOperationalAuth(adminJar, missingRunId, 403, "admin_aal2_required", "ADMIN_AAL1");

      await enrollAndVerifyMfa(adminJar, adminUserId, "ADMIN");
      await assertOperationalAdminAal2(adminJar, missingRunId);
      if (RUNTIME_PHASE === "foundation") return;
      if (RUNTIME_PHASE === "list") {
        await assertCustodyOperationalListDataset(adminJar, fixture);
        return;
      }
      if (RUNTIME_PHASE === "fingerprint") {
        await getOperationalList(adminJar, "?limit=2");
        await assertOperationalDetail(adminJar, fixture);
        await assertCustodyOperationalFingerprint(fingerprintBefore, await readCustodyOperationalFingerprint(fixture));
        return;
      }
      if (RUNTIME_PHASE === "full") await assertCustodyOperationalDataset(adminJar, fixture);
      else await assertOperationalDetail(adminJar, fixture);

      const restrictedJar = await signUpConfirmAndSignIn(
        restrictedEmail,
        sharedPassword,
        "/admin",
        "QA Restricted Admin",
      );
      const restrictedUserId = await readUserIdByEmail(restrictedEmail);
      await bootstrapAdminRole(restrictedUserId, "local custody runtime restricted admin bootstrap");
      await enrollAndVerifyMfa(restrictedJar, restrictedUserId, "RESTRICTED_ADMIN");
      await sqlScalar(`
        update public.profiles
        set account_status = 'RESTRICTED'
        where id = ${sqlUuid(restrictedUserId)};

        select account_status
        from public.profiles
        where id = ${sqlUuid(restrictedUserId)};
      `);
      await assertOperationalAuth(restrictedJar, fixture.detailRunId, 403, "admin_access_required", "RESTRICTED_ADMIN_AAL2");
      await assertCustodyOperationalFingerprint(fingerprintBefore, await readCustodyOperationalFingerprint(fixture));
    });
  });

  console.log(`CUSTODY_OPERATIONAL_READ_RUNTIME_TEST_CASE_COUNT=${passCount}`);
  console.log("FINAL_STATUS=PASS_CUSTODY_OPERATIONAL_READ_RUNTIME_FOUNDATION_READY");
}

function parseRuntimePhase(args) {
  const values = args.filter((arg) => arg.startsWith("--phase="));
  if (values.length > 1 || args.some((arg) => arg.startsWith("--phase=") === false)) throw finalError("REQUIRES_ACTION", "unknown runtime argument");
  const phase = values.length === 0 ? "full" : values[0].slice("--phase=".length);
  if (!["foundation", "list", "detail", "fingerprint", "full"].includes(phase)) throw finalError("REQUIRES_ACTION", `unknown runtime phase ${phase}`);
  return phase;
}

async function assertOperationalAnonymous(missingRunId) {
  await assertOperationalError(await appGet("/api/v1/admin/custody-observer/runs"), 401, "authentication_required", "anonymous list");
  await assertOperationalError(await appGet(`/api/v1/admin/custody-observer/runs/${missingRunId}`), 401, "authentication_required", "anonymous detail");
  pass("CUSTODY_OPERATIONAL_ANONYMOUS_MATRIX");
}

async function assertMalformedDetail() {
  await assertOperationalError(
    await appGet("/api/v1/admin/custody-observer/runs/not-a-uuid"),
    400,
    "invalid_run_id",
    "malformed detail",
  );
  pass("CUSTODY_OPERATIONAL_MALFORMED_DETAIL");
}

async function assertOperationalAuth(jar, missingRunId, status, code, label) {
  await assertOperationalError(await appGet("/api/v1/admin/custody-observer/runs", { jar }), status, code, `${label} list`);
  await assertOperationalError(await appGet(`/api/v1/admin/custody-observer/runs/${missingRunId}`, { jar }), status, code, `${label} detail`);
  pass(`CUSTODY_OPERATIONAL_${label}`);
}

async function assertOperationalAdminAal2(jar, missingRunId) {
  const list = await appGet("/api/v1/admin/custody-observer/runs", { jar });
  const listErrorCode =
    isPlainRecord(list.payload) &&
    isPlainRecord(list.payload.error) &&
    typeof list.payload.error.code === "string"
      ? list.payload.error.code
      : "NONE";
  assert(
    list.response.status === 200,
    `ADMIN AAL2 list HTTP 200 actual=${list.response.status} code=${listErrorCode}`,
  );
  assertNoStore(list.response, "ADMIN AAL2 list");
  assert(isPlainRecord(list.payload) && Object.keys(list.payload).toSorted().join(",") === "items,nextCursor,totalCount", "ADMIN AAL2 list safe envelope");
  assert(Array.isArray(list.payload.items) && typeof list.payload.totalCount === "string" && list.payload.nextCursor === null, "ADMIN AAL2 list public types");
  await assertOperationalError(await appGet(`/api/v1/admin/custody-observer/runs/${missingRunId}`, { jar }), 404, "custody_observer_run_not_found", "ADMIN AAL2 missing detail");
  pass("CUSTODY_OPERATIONAL_ADMIN_AAL2_SMOKE");
}

async function assertOperationalError(result, expectedStatus, expectedCode, label) {
  assertNoStore(result.response, label);
  const actualCode =
    isPlainRecord(result.payload) &&
    isPlainRecord(result.payload.error) &&
    typeof result.payload.error.code === "string"
      ? result.payload.error.code
      : "NON_CODE_ENVELOPE";
  assert(
    isPlainRecord(result.payload) &&
      Object.keys(result.payload).join(",") === "error" &&
      isPlainRecord(result.payload.error) &&
      Object.keys(result.payload.error).join(",") === "code" &&
      result.payload.error.code === expectedCode,
    `${label} safe error envelope expected=${expectedCode} actual=${actualCode}`,
  );
  assert(
    result.response.status === expectedStatus,
    `${label} HTTP status expected=${expectedStatus} actual=${result.response.status}`,
  );
}

async function withQuarantinedEnv(action) {
  const envPath = join(REPO_ROOT, ".env.local");
  const supervisorEnvPath = join(REPO_ROOT, ".env.local.phase2-supervisor");
  const envExists = existsSync(envPath);
  const envState = envExists ? await readEnvFileState(envPath) : null;
  let backupRoot = null;
  let backupFile = null;
  let actionError = null;

  if (envState?.tracked) {
    throw finalError("BLOCKED_TRACKED_ENV_FILE", "tracked .env.local");
  }

  if (envState) {
    backupRoot = join(QUARANTINE_PARENT, randomUUID());
    backupFile = join(backupRoot, ".env.local");
    mkdirSync(backupRoot, { recursive: true });
    renameSync(envPath, backupFile);
    console.log("ENV_LOCAL_TRACKED=false");
    console.log(`ENV_LOCAL_IGNORED=${envState.ignored}`);
    console.log("ENV_LOCAL_CONTENT_READ=false");
    console.log(`ENV_LOCAL_METADATA_LENGTH=${envState.length}`);
    console.log(`ENV_LOCAL_METADATA_LAST_WRITE_UTC=${envState.lastWriteTimeUtc}`);
    console.log("ENV_LOCAL_QUARANTINE=APPLIED");
    console.log("ENV_LOCAL_QUARANTINE_OUTSIDE_REPOSITORY=true");
  } else {
    console.log("ENV_LOCAL_PRESENT=false");
  }

  if (existsSync(supervisorEnvPath)) {
    throw finalError(
      "REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED",
      ".env.local.phase2-supervisor precondition",
    );
  }

  try {
    await action();
  } catch (error) {
    actionError = error;
  } finally {
    if (backupFile && backupRoot && envState) {
      await restoreQuarantinedEnv({ envPath, backupFile, backupRoot, envState });
    }
  }

  if (actionError) {
    throw actionError;
  }
}

async function readEnvFileState(envPath) {
  const tracked = await commandExitsZero("git", [
    "ls-files",
    "--error-unmatch",
    ".env.local",
  ]);
  const ignored = await commandExitsZero("git", ["check-ignore", ".env.local"]);
  const metadata = statSync(envPath);

  return {
    tracked,
    ignored,
    length: metadata.size,
    lastWriteTimeUtc: metadata.mtime.toISOString(),
  };
}

async function restoreQuarantinedEnv({
  envPath,
  backupFile,
  backupRoot,
  envState,
}) {
  const repoEnvExists = existsSync(envPath);
  const backupExists = existsSync(backupFile);

  if (repoEnvExists && backupExists) {
    console.log("ENV_LOCAL_RESTORE_CONFLICT=true");
    throw finalError("BLOCKED_ENV_RESTORE_CONFLICT", ".env.local restore");
  }

  if (!backupExists) {
    throw finalError("BLOCKED_ENV_RESTORE_CONFLICT", ".env.local backup missing");
  }

  renameSync(backupFile, envPath);
  const restored = statSync(envPath);
  const metadataMatch =
    restored.size === envState.length &&
    restored.mtime.toISOString() === envState.lastWriteTimeUtc;

  assert(
    metadataMatch,
    ".env.local restore metadata",
    "REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED",
  );

  console.log("ENV_LOCAL_RESTORE=PASS");
  console.log("ENV_LOCAL_RESTORE_METADATA_MATCH=true");
  rmSync(backupRoot, { recursive: true, force: true });
  console.log(`ENV_LOCAL_RESTORE_BACKUP_RESIDUE=${existsSync(backupRoot) ? 1 : 0}`);
}

async function withSelfOwnedRuntime(action, readCleanupMarker) {
  let server = null;
  let supabaseStarted = false;
  let fixtureCleanupReset = false;
  let fixtureResidue = "not_checked";
  let taskkillFallbackCount = 0;

  try {
    emitRuntimeHarnessPattern();
    await assertSelfOwnedRuntimeCleanPrecondition();
    await runNpmScriptSensitive(
      "supabase:start",
      "ADMIN_READ_RUNTIME_SUPABASE_START",
      120000,
    );
    supabaseStarted = true;

    await runNpmScriptSensitive(
      "db:reset:local",
      "ADMIN_READ_RUNTIME_DB_RESET_START",
      180000,
    );

    const status = await readLocalSupabaseStatus();

    server = await startSelfOwnedNextRuntime(status);
    await waitForAdminReadRuntimeReady();

    return await action();
  } finally {
    if (server) {
      taskkillFallbackCount = await stopSelfOwnedNextRuntime(server);
    }

    if (supabaseStarted) {
      await runNpmScriptSensitive(
        "db:reset:local",
        "ADMIN_READ_RUNTIME_FIXTURE_CLEANUP_DB_RESET",
        180000,
      );
      fixtureCleanupReset = true;

      const marker = readCleanupMarker?.();

      if (marker) {
        fixtureResidue = await readFixtureResidueCount(marker);
        assert(
          fixtureResidue === "0",
          "ADMIN read fixture cleanup residue",
          "REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED",
        );
      }

      await runNpmScriptSensitive(
        "supabase:stop",
        "ADMIN_READ_RUNTIME_SUPABASE_STOP",
        120000,
      );
    }

    console.log(`ADMIN_READ_RUNTIME_TASKKILL_FALLBACK_COUNT=${taskkillFallbackCount}`);
    console.log(`ADMIN_READ_RUNTIME_FIXTURE_CLEANUP_DB_RESET=${fixtureCleanupReset}`);
    console.log(`ADMIN_READ_RUNTIME_FIXTURE_RESIDUE=${fixtureResidue}`);
    console.log("RUNTIME_FIXTURE_CLEANUP=PASS");
    await assertSelfOwnedRuntimeCleanPostcondition();
  }
}

function emitRuntimeHarnessPattern() {
  console.log("RUNTIME_HARNESS_PATTERN=self_owned_supabase_reset_next_start");
  console.log("AUTH_FIXTURE_PATTERN=mailpit_confirmed_local_signup");
  console.log("AAL2_SESSION_PATTERN=get_preflight_then_mfa_start_verify");
  console.log("HTTP_COOKIE_PATTERN=shared_cookie_jar_get");
  console.log("DB_FIXTURE_PATTERN=local_postgres_test_only_private_tables");
  console.log("CLEANUP_PATTERN=db_reset_then_owned_runtime_stop");
  console.log("SERVICE_ROLE_PRODUCTION_USAGE=0");
  console.log(`ADMIN_READ_APP_PORT=${APP_PORT}`);
}

async function assertSelfOwnedRuntimeCleanPrecondition() {
  assert(
    (await readProjectContainerCount()) === 0,
    "ADMIN read project container precondition",
    "REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED",
  );

  for (const port of [3000, 3010, 55721, 55722, 55723, 55724]) {
    if ((await readPortListenerCount(port)) !== 0) {
      throw finalError("BLOCKED_RUNTIME_PORT_IN_USE", `port ${port}`);
    }
  }

  assert(
    !existsSync(".env.local") && !existsSync(".env.local.phase2-supervisor"),
    "ADMIN read env precondition",
    "REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED",
  );
  pass("ADMIN_READ_RUNTIME_CLEAN_PRECONDITION");
}

async function assertSelfOwnedRuntimeCleanPostcondition() {
  for (let index = 1; index <= DIRECT_RUNTIME_CLEAN_SAMPLE_COUNT; index += 1) {
    assert(
      (await readProjectContainerCount()) === 0,
      "ADMIN read project container cleanup",
      "REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED",
    );

    for (const port of [3000, 3010, 55721, 55722, 55723, 55724]) {
      assert(
        (await readPortListenerCount(port)) === 0,
        `ADMIN read port ${port} cleanup`,
        "REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED",
      );
    }

    assert(
      !existsSync(".env.local") && !existsSync(".env.local.phase2-supervisor"),
      "ADMIN read env cleanup before restore",
      "REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED",
    );
    console.log(`ADMIN_READ_RUNTIME_CLEAN_SAMPLE=${index}`);
    await wait(DIRECT_RUNTIME_CLEAN_SAMPLE_INTERVAL_MS);
  }

  pass("ADMIN_READ_RUNTIME_CLEANUP");
}

async function startSelfOwnedNextRuntime(status) {
  assert(
    existsSync(".next/BUILD_ID"),
    "ADMIN read Next build artifact",
    "REQUIRES_ACTION",
  );

  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      APP_PORT,
      "-H",
      DIRECT_MANAGED_APP_HOST,
    ],
    {
      env: {
        ...process.env,
        APP_ENV: "local",
        APP_ORIGIN,
        NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
        NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      },
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    },
  );

  await waitForSelfOwnedNextRuntime(server);

  return server;
}

async function waitForSelfOwnedNextRuntime(server) {
  const deadline = Date.now() + DIRECT_RUNTIME_READY_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw finalError(
        "REQUIRES_ACTION",
        "ADMIN read Next runtime exited",
      );
    }

    const health = await readLocalHttpStatus(`${APP_ORIGIN}/api/v1/health`, {
      timeoutMs: 2000,
      readBody: true,
      label: "ADMIN read runtime health",
    });
    const readiness = await readLocalHttpStatus(
      `${APP_ORIGIN}/api/v1/readiness/config`,
      {
        timeoutMs: 2000,
        readBody: true,
        label: "ADMIN read runtime readiness",
      },
    );

    if (health.status === 200 && readiness.status === 200) {
      pass("ADMIN_READ_RUNTIME_NEXT_READY");
      return;
    }

    await wait(500);
  }

  throw finalError("REQUIRES_ACTION", "ADMIN read Next runtime readiness");
}

async function stopSelfOwnedNextRuntime(server) {
  let fallbackCount = 0;

  if (server.exitCode === null && server.signalCode === null) {
    server.kill();
  }

  await Promise.race([
    onceChildEvent(server, "close"),
    wait(DIRECT_RUNTIME_EXIT_TIMEOUT_MS),
  ]);

  if (
    server.exitCode === null &&
    server.signalCode === null &&
    process.platform === "win32"
  ) {
    fallbackCount += 1;
    await execFileAsync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      timeout: 10000,
      windowsHide: true,
    }).catch(() => undefined);
    await Promise.race([
      onceChildEvent(server, "close"),
      wait(DIRECT_RUNTIME_EXIT_TIMEOUT_MS),
    ]);
  }

  await waitForSelfOwnedPortRelease();
  pass("ADMIN_READ_RUNTIME_NEXT_CLEANUP");

  return fallbackCount;
}

async function waitForSelfOwnedPortRelease() {
  const deadline = Date.now() + DIRECT_RUNTIME_PORT_RELEASE_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    if ((await readPortListenerCount(Number(APP_PORT))) === 0) {
      return;
    }

    await wait(250);
  }

  throw finalError("REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED", "app port cleanup");
}

async function waitForAdminReadRuntimeReady() {
  let stableCount = 0;
  let lastState = "not_checked";
  let kongRestarted = false;

  for (let attempt = 0; attempt < READINESS_MAX_ATTEMPTS; attempt += 1) {
    const status = await readAdminReadRuntimeStatus();

    if (status.ready) {
      stableCount += 1;

      if (stableCount >= REQUIRED_STABLE_READINESS) {
        pass(kongRestarted
          ? "ADMIN_READ_AUTH_HANDOFF_KONG_RECOVERY"
          : "ADMIN_READ_AUTH_HANDOFF_READY");
        return;
      }
    } else {
      stableCount = 0;
      lastState = status.state;

      if (!kongRestarted && status.safeCause === "KONG_AUTH_UPSTREAM_STALE") {
        await restartProjectKong();
        kongRestarted = true;
      }
    }

    await wait(READINESS_POLL_INTERVAL_MS);
  }

  throw finalError("REQUIRES_ACTION", `auth handoff ${lastState}`);
}

async function readAdminReadRuntimeStatus() {
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

async function assertPublicSmoke() {
  await assertHttpStatus(`${APP_ORIGIN}/api/v1/health`, 200, "health smoke");
  await assertHttpStatus(
    `${APP_ORIGIN}/api/v1/readiness/config`,
    200,
    "readiness smoke",
  );
  pass("ADMIN_READ_RUNTIME_PUBLIC_SMOKE");
}

async function createCustodyOperationalFixture() {
  const now = Date.now();
  const iso = (offsetMinutes) => new Date(now + offsetMinutes * 60_000).toISOString();
  const ids = Array.from({ length: 12 }, () => randomUUID());
  const providerId = randomUUID();
  const assetAId = randomUUID();
  const assetBId = randomUUID();
  const bindingAId = randomUUID();
  const bindingBId = randomUUID();
  const tieCreatedAt = iso(-8);
  const runs = [
    { id: ids[0], status: "RUNNING", terminalCode: null, startedAt: iso(-2), completedAt: null, createdAt: iso(-1), stale: false, severity: "INFO", alertEligible: false },
    { id: ids[1], status: "RUNNING", terminalCode: null, startedAt: iso(-120), completedAt: null, createdAt: iso(-2), stale: true, severity: "CRITICAL", alertEligible: true },
    { id: ids[2], status: "COMPLETED", terminalCode: "RUN_COMPLETE", startedAt: iso(-90), completedAt: iso(-89), createdAt: iso(-3), stale: false, severity: "INFO", alertEligible: false },
    { id: ids[3], status: "PARTIAL", terminalCode: "SCOPE_PARTIAL", startedAt: iso(-80), completedAt: iso(-79), createdAt: iso(-4), stale: false, severity: "WARNING", alertEligible: true },
    { id: ids[4], status: "ABORTED", terminalCode: "ORCHESTRATOR_ABORTED", startedAt: iso(-70), completedAt: iso(-69), createdAt: iso(-5), stale: false, severity: "INFO", alertEligible: false },
    { id: ids[5], status: "FAILED_DISCOVERY", terminalCode: "ORCHESTRATOR_SCOPE_DISCOVERY_FAILED", startedAt: iso(-60), completedAt: iso(-59), createdAt: iso(-6), stale: false, severity: "CRITICAL", alertEligible: true },
    ...ids.slice(6).map((id, index) => ({ id, status: "COMPLETED", terminalCode: "RUN_COMPLETE", startedAt: iso(-50 - index), completedAt: iso(-49 - index), createdAt: tieCreatedAt, stale: false, severity: "INFO", alertEligible: false })),
  ];
  const detailRun = runs[3];

  await sqlScalar(`
    begin;
    insert into public.supported_assets (id, asset_code, symbol, display_name, asset_type, decimals, status)
    values (${sqlUuid(assetAId)}, 'P5T05RTA', 'RTA', 'P5 T05 Runtime Asset A', 'NATIVE', 9, 'ACTIVE'),
      (${sqlUuid(assetBId)}, 'P5T05RTB', 'RTB', 'P5 T05 Runtime Asset B', 'NATIVE', 9, 'ACTIVE');
    insert into private.custody_providers (id, provider_code, display_name, provider_type, supports_balance_observation, status)
    values (${sqlUuid(providerId)}, 'P5T05RT', 'P5 T05 Runtime Provider', 'MPC_CUSTODIAN', true, 'DRAFT');
    update private.custody_providers set status = 'APPROVED', approved_at = ${sqlTimestamp(iso(-180))}, version = 2 where id = ${sqlUuid(providerId)};
    insert into private.custody_account_bindings (id, custody_provider_id, asset_id, binding_key, display_label, account_role)
    values (${sqlUuid(bindingAId)}, ${sqlUuid(providerId)}, ${sqlUuid(assetAId)}, 'p5t05_runtime_a', 'P5 T05 Runtime Binding A', 'TREASURY'),
      (${sqlUuid(bindingBId)}, ${sqlUuid(providerId)}, ${sqlUuid(assetBId)}, 'p5t05_runtime_b', 'P5 T05 Runtime Binding B', 'TREASURY');
    insert into private.custody_balance_observer_runs (
      run_id, run_key, trigger_source, identity_policy, invocation_contract_version, status, terminal_code,
      started_at, completed_at, created_at, version, scopes_discovered, scopes_started, scopes_completed,
      scopes_failed, scopes_aborted, bindings_discovered, bindings_failed
    ) values
      ${runs.map((run) => `(${sqlUuid(run.id)}, ${sqlLiteral(`obsrun:v1:${run.id}`)}, 'MANUAL', 'LOCAL_MOCK', 'P5_T05_V1', ${sqlLiteral(run.status)}, ${sqlNullableText(run.terminalCode)}, ${sqlTimestamp(run.startedAt)}, ${run.completedAt ? sqlTimestamp(run.completedAt) : 'null'}, ${sqlTimestamp(run.createdAt)}, ${run.status === 'RUNNING' ? 1 : 2}, ${run.id === detailRun.id ? 2 : 0}, ${run.id === detailRun.id ? 2 : 0}, ${run.id === detailRun.id ? 1 : 0}, ${run.id === detailRun.id ? 1 : 0}, 0, ${run.id === detailRun.id ? 2 : 0}, ${run.id === detailRun.id ? 1 : 0})`).join(',\n      ')};
    insert into private.custody_balance_observer_scope_outcomes (
      run_id, discovery_index, provider_id, asset_id, scope_status, binding_success_count, binding_failure_count,
      binding_abort_count, refresh_requested, refresh_attempted, refresh_succeeded, refresh_failed,
      no_longer_eligible_count, scope_code, recorded_at
    ) values
      (${sqlUuid(detailRun.id)}, 1, ${sqlUuid(providerId)}, ${sqlUuid(assetAId)}, 'PARTIAL', 1, 1, 0, true, true, true, false, 0, 'SCOPE_PARTIAL', ${sqlTimestamp(iso(-78))}),
      (${sqlUuid(detailRun.id)}, 2, ${sqlUuid(providerId)}, ${sqlUuid(assetBId)}, 'SUCCEEDED', 1, 0, 0, false, false, false, false, 0, null, ${sqlTimestamp(iso(-77))});
    insert into private.custody_balance_observer_binding_failures (
      run_id, provider_id, asset_id, binding_id, binding_order, failure_stage, safe_failure_code, retryable,
      adapter_attempts, database_attempts, retry_exhausted, retry_deferred, requires_scope_refresh, recorded_at
    ) values
      (${sqlUuid(detailRun.id)}, ${sqlUuid(providerId)}, ${sqlUuid(assetAId)}, ${sqlUuid(bindingAId)}, 1, 'DATABASE', 'OBSERVATION_WRITE_FAILED', true, 2, 1, false, false, true, ${sqlTimestamp(iso(-77.5))}),
      (${sqlUuid(detailRun.id)}, ${sqlUuid(providerId)}, ${sqlUuid(assetBId)}, ${sqlUuid(bindingBId)}, 2, 'ADAPTER', 'ADAPTER_BALANCE_UNAVAILABLE', false, 3, 0, true, false, false, ${sqlTimestamp(iso(-77.4))});
    commit;
    select 'ok';
  `);

  const expectedOrder = [...runs].sort(compareOperationalRuns).map((run) => run.id);
  pass("CUSTODY_OPERATIONAL_FIXTURE_SETUP");
  return { runs, expectedOrder, detailRunId: detailRun.id, providerName: "P5 T05 Runtime Provider", assetSymbols: ["RTA", "RTB"] };
}

function compareOperationalRuns(left, right) {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

async function assertCustodyOperationalDataset(jar, fixture) {
  await assertCustodyOperationalListDataset(jar, fixture);
  await assertOperationalDetail(jar, fixture);
  pass("CUSTODY_OPERATIONAL_FULL_DATASET");
}

async function assertCustodyOperationalListDataset(jar, fixture) {
  const defaultList = await getOperationalList(jar);
  assertOperationalList(defaultList, fixture, "default list");
  assertDeepEqual(defaultList.items.map((item) => item.runId), fixture.expectedOrder, "full operational ordering");
  await assertOperationalValidation(jar);
  await assertOperationalFilters(jar, fixture);
  await assertOperationalPagination(jar, fixture);
  pass("CUSTODY_OPERATIONAL_LIST_DATASET");
}

async function getOperationalList(jar, query = "") {
  const result = await appGet(`/api/v1/admin/custody-observer/runs${query}`, { jar });
  assert(result.response.status === 200, "operational list HTTP 200");
  assertNoStore(result.response, "operational list");
  assert(isPlainRecord(result.payload) && Object.keys(result.payload).toSorted().join(",") === "items,nextCursor,totalCount", "operational list top-level keys");
  assert(Array.isArray(result.payload.items) && typeof result.payload.totalCount === "string" && (result.payload.nextCursor === null || typeof result.payload.nextCursor === "string"), "operational list public types");
  return result.payload;
}

function assertOperationalList(payload, fixture, label) {
  assert(payload.totalCount === String(fixture.runs.length), `${label} total count`);
  assert(payload.items.length === fixture.runs.length && payload.nextCursor === null, `${label} default pagination`);
  for (const item of payload.items) {
    assertOperationalListItem(item, label);
  }
  assertPublicPayloadSafe(payload, label);
}

function assertOperationalListItem(item, label) {
  const keys = "abortedCount,alertEligible,bindingFailureCount,completedAt,createdAt,failedCount,runId,scopeCount,severity,stale,startedAt,status,successCount,terminalCode,version";
  assert(isPlainRecord(item) && Object.keys(item).toSorted().join(",") === keys, `${label} exact item keys`);
  assert(isUuid(item.runId) && typeof item.status === "string" && typeof item.version === "string", `${label} list identity types`);
  for (const key of ["scopeCount", "successCount", "failedCount", "abortedCount", "bindingFailureCount"]) assert(typeof item[key] === "string" && /^\d+$/.test(item[key]), `${label} ${key} string`);
  assert(typeof item.stale === "boolean" && typeof item.alertEligible === "boolean" && ["INFO", "WARNING", "CRITICAL"].includes(item.severity), `${label} derived types`);
  assert(typeof item.createdAt === "string" && (item.startedAt === null || typeof item.startedAt === "string") && (item.completedAt === null || typeof item.completedAt === "string") && (item.terminalCode === null || typeof item.terminalCode === "string"), `${label} nullable fields`);
}

async function assertOperationalValidation(jar) {
  const cases = [
    ["?foo=bar", "invalid_query"], ["?status=RUNNING&status=RUNNING", "invalid_query"],
    ["?status=", "invalid_status"], ["?stale=", "invalid_stale"], ["?severity=", "invalid_severity"], ["?alertEligible=", "invalid_alert_eligible"], ["?cursor=", "invalid_cursor"], ["?limit=", "invalid_limit"],
    ["?status=running", "invalid_status"], ["?status=UNKNOWN", "invalid_status"], ["?severity=critical", "invalid_severity"], ["?stale=TRUE", "invalid_stale"], ["?alertEligible=1", "invalid_alert_eligible"],
    ...["0", "101", "-1", "1.5", "1e2", "+25", "025"].map((value) => [`?limit=${encodeURIComponent(value)}`, "invalid_limit"]),
    ["?cursor=not_base64url!", "invalid_cursor"], ["?cursor=e30", "invalid_cursor"], ["?cursor=eyJydW5JZCI6IjAwMDAifQ", "invalid_cursor"],
  ];
  for (const [query, code] of cases) await assertOperationalError(await appGet(`/api/v1/admin/custody-observer/runs${query}`, { jar }), 400, code, `list validation ${code}`);
  for (const limit of ["1", "2", "100"]) await getOperationalList(jar, `?limit=${limit}`);
  pass("CUSTODY_OPERATIONAL_QUERY_VALIDATION");
}

async function assertOperationalFilters(jar, fixture) {
  const expectations = [
    ["?status=RUNNING", (run) => run.status === "RUNNING"], ["?stale=true", (run) => run.stale], ["?stale=false", (run) => !run.stale],
    ["?severity=INFO", (run) => run.severity === "INFO"], ["?severity=WARNING", (run) => run.severity === "WARNING"], ["?severity=CRITICAL", (run) => run.severity === "CRITICAL"],
    ["?alertEligible=true", (run) => run.alertEligible], ["?alertEligible=false", (run) => !run.alertEligible],
    ["?status=RUNNING&stale=true&severity=CRITICAL&alertEligible=true", (run) => run.status === "RUNNING" && run.stale && run.severity === "CRITICAL" && run.alertEligible],
    ["?status=COMPLETED&stale=true", () => false],
  ];
  for (const [query, predicate] of expectations) {
    const payload = await getOperationalList(jar, query);
    const expected = fixture.runs.filter(predicate).sort(compareOperationalRuns).map((run) => run.id);
    assert(payload.totalCount === String(expected.length) && payload.nextCursor === null, `filter ${query} count`);
    assertDeepEqual(payload.items.map((item) => item.runId), expected, `filter ${query} membership`);
  }
  pass("CUSTODY_OPERATIONAL_FILTERS");
}

async function assertOperationalPagination(jar, fixture) {
  const ids = [];
  let cursor = null;
  let pageCount = 0;
  do {
    const payload = await getOperationalList(jar, `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert(payload.totalCount === String(fixture.runs.length), "pagination total count stable");
    ids.push(...payload.items.map((item) => item.runId));
    cursor = payload.nextCursor;
    pageCount += 1;
    assert(pageCount < 20, "pagination terminates");
  } while (cursor !== null);
  assert(ids.length === new Set(ids).size, "pagination no repeats");
  assertDeepEqual(ids, fixture.expectedOrder, "pagination no skips and full order");
  pass("CUSTODY_OPERATIONAL_PAGINATION");
}

async function assertOperationalDetail(jar, fixture) {
  const fixtureFacts = (await sqlScalar(`
    select exists(select 1 from private.custody_balance_observer_runs where run_id = ${sqlUuid(fixture.detailRunId)})::text || '|' ||
      coalesce((select status from private.custody_balance_observer_runs where run_id = ${sqlUuid(fixture.detailRunId)}), 'NONE') || '|' ||
      (select count(*)::text from private.custody_balance_observer_scope_outcomes where run_id = ${sqlUuid(fixture.detailRunId)}) || '|' ||
      (select count(*)::text from private.custody_balance_observer_binding_failures where run_id = ${sqlUuid(fixture.detailRunId)});
  `)).split("|");
  const directRpc = await inspectOperationalDetailRpc(jar, fixture.detailRunId);

  if (directRpc.errorPresent || directRpc.dataNull) {
    throw finalError(
      "REQUIRES_ACTION_DIRECT_DETAIL_RPC",
      `detail rpc unavailable error=${directRpc.errorPresent} dataNull=${directRpc.dataNull}`,
    );
  }

  if (directRpc.firstMismatch) {
    throw finalError(
      "REQUIRES_ACTION_DETAIL_NORMALIZATION_MISMATCH",
      `detail rpc mismatch level=${directRpc.firstMismatch.level} field=${directRpc.firstMismatch.field}`,
    );
  }

  const result = await appGet(`/api/v1/admin/custody-observer/runs/${fixture.detailRunId}`, { jar });
  const errorCode = isPlainRecord(result.payload) && isPlainRecord(result.payload.error) && typeof result.payload.error.code === "string" ? result.payload.error.code : "NONE";
  const contentType = result.response.headers.get("content-type")?.split(";", 1)[0] ?? "NONE";
  const cacheControl = result.response.headers.get("cache-control") ?? "NONE";
  const topLevelKeys = isPlainRecord(result.payload) ? Object.keys(result.payload).toSorted().join(",") : "NON_OBJECT";
  console.log(`DETAIL_DIAGNOSTIC_RUN_ID=${fixture.detailRunId}`);
  console.log(`DETAIL_DIAGNOSTIC_FIXTURE_EXISTS=${fixtureFacts[0]}`);
  console.log(`DETAIL_DIAGNOSTIC_FIXTURE_STATUS=${fixtureFacts[1]}`);
  console.log(`DETAIL_DIAGNOSTIC_SCOPE_ROWS=${fixtureFacts[2]}`);
  console.log(`DETAIL_DIAGNOSTIC_FAILURE_ROWS=${fixtureFacts[3]}`);
  console.log("DETAIL_DIAGNOSTIC_AUTHENTICATED=true");
  console.log("DETAIL_DIAGNOSTIC_ADMIN=true");
  console.log("DETAIL_DIAGNOSTIC_AAL=aal2");
  console.log(`DETAIL_DIAGNOSTIC_STATUS=${result.response.status}`);
  console.log(`DETAIL_DIAGNOSTIC_ERROR_CODE=${errorCode}`);
  console.log(`DETAIL_DIAGNOSTIC_CONTENT_TYPE=${contentType}`);
  console.log(`DETAIL_DIAGNOSTIC_CACHE_CONTROL=${cacheControl}`);
  console.log(`DETAIL_DIAGNOSTIC_TOP_LEVEL_KEYS=${topLevelKeys}`);
  assert(result.response.status === 200, `detail success status actual=${result.response.status} code=${errorCode} fixtureExists=${fixtureFacts[0]} fixtureStatus=${fixtureFacts[1]} scopeRows=${fixtureFacts[2]} failureRows=${fixtureFacts[3]} authenticated=true admin=true aal=aal2`);
  assertNoStore(result.response, "detail success");
  assert(isPlainRecord(result.payload) && Object.keys(result.payload).join(",") === "item", "detail envelope");
  const item = result.payload.item;
  const detailRun = Object.fromEntries(
    Object.entries(item).filter(
      ([key]) => key !== "scopeOutcomes" && key !== "bindingFailures",
    ),
  );
  assertOperationalListItem(detailRun, "detail run");
  assert(Array.isArray(item.scopeOutcomes) && item.scopeOutcomes.length === 2 && Array.isArray(item.bindingFailures) && item.bindingFailures.length === 2, "detail complete evidence");
  assertDeepEqual(item.scopeOutcomes.map((row) => row.assetSymbol), fixture.assetSymbols, "scope timestamp ordering");
  assertDeepEqual(item.bindingFailures.map((row) => row.failureCode), ["OBSERVATION_WRITE_FAILED", "ADAPTER_BALANCE_UNAVAILABLE"], "failure ordering");
  for (const row of item.scopeOutcomes) {
    assert(isPlainRecord(row) && Object.keys(row).toSorted().join(",") === "assetSymbol,bindingAbortCount,bindingFailureCount,bindingSuccessCount,noLongerEligibleCount,providerName,recordedAt,refreshAttempted,refreshFailed,refreshRequested,refreshSucceeded,scopeCode,scopeStatus", "scope exact keys");
    assert(row.providerName === fixture.providerName && fixture.assetSymbols.includes(row.assetSymbol) && typeof row.recordedAt === "string", "scope descriptors");
  }
  for (const row of item.bindingFailures) {
    assert(isPlainRecord(row) && Object.keys(row).toSorted().join(",") === "adapterAttempts,assetSymbol,databaseAttempts,failureCode,failureStage,providerName,recordedAt,requiresScopeRefresh,retryable", "failure exact keys");
    assert(row.providerName === fixture.providerName && fixture.assetSymbols.includes(row.assetSymbol) && /^\d+$/.test(row.adapterAttempts) && /^\d+$/.test(row.databaseAttempts), "failure descriptors and attempts");
  }
  assertPublicPayloadSafe(result.payload, "detail public safety");
  pass("CUSTODY_OPERATIONAL_DETAIL");
}

async function inspectOperationalDetailRpc(jar, runId) {
  const status = await readLocalSupabaseStatus();
  const supabase = createServerClient(status.API_URL, status.ANON_KEY, {
    cookies: {
      getAll() {
        return cookieHeaderToSupabaseCookies(jar.getHeader(new URL(APP_ORIGIN)));
      },
      setAll() {},
    },
  });
  const { data, error } = await supabase.rpc(
    "get_admin_custody_observer_run_detail",
    {
      p_run_id: runId,
      p_cutoff: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    },
  );
  const topLevelKeys = isPlainRecord(data)
    ? Object.keys(data).toSorted()
    : [];

  console.log(`DETAIL_RPC_ERROR_PRESENT=${error ? "true" : "false"}`);
  console.log(`DETAIL_RPC_ERROR_CLASSIFICATION=${error ? "RPC_ERROR" : "NONE"}`);
  console.log(`DETAIL_RPC_DATA_NULL=${data === null ? "true" : "false"}`);
  console.log(`DETAIL_RPC_TOP_LEVEL_TYPE=${runtimeType(data)}`);
  console.log(`DETAIL_RPC_TOP_LEVEL_KEYS=${topLevelKeys.join(",") || "NONE"}`);

  if (error || data === null || !isPlainRecord(data)) {
    console.log("DETAIL_RPC_RESULT=STOP");
    return {
      errorPresent: Boolean(error),
      dataNull: data === null,
      firstMismatch: null,
    };
  }

  const runKeys = [
    "run_id", "status", "version", "terminal_code", "created_at", "started_at",
    "completed_at", "scope_count", "success_count", "failed_count", "aborted_count",
    "binding_failure_count", "stale", "severity", "alert_eligible",
  ];
  const scopeKeys = [
    "scope_status", "scope_code", "binding_success_count", "binding_failure_count",
    "binding_abort_count", "refresh_requested", "refresh_attempted", "refresh_succeeded",
    "refresh_failed", "no_longer_eligible_count", "recorded_at", "provider_name", "asset_symbol",
  ];
  const failureKeys = [
    "failure_stage", "failure_code", "retryable", "requires_scope_refresh", "adapter_attempts",
    "database_attempts", "recorded_at", "provider_name", "asset_symbol",
  ];
  const scopes = data.scope_outcomes;
  const failures = data.binding_failures;

  console.log(`DETAIL_RPC_RUN_KEY_TYPES=${formatKeyTypes(data, runKeys)}`);
  console.log(`DETAIL_RPC_SCOPE_ROW_1_KEYS=${formatKeys(scopes?.[0])}`);
  console.log(`DETAIL_RPC_SCOPE_ROW_1_TYPES=${formatAllKeyTypes(scopes?.[0])}`);
  console.log(`DETAIL_RPC_SCOPE_ROW_2_KEYS=${formatKeys(scopes?.[1])}`);
  console.log(`DETAIL_RPC_SCOPE_ROW_2_TYPES=${formatAllKeyTypes(scopes?.[1])}`);
  console.log(`DETAIL_RPC_FAILURE_ROW_1_KEYS=${formatKeys(failures?.[0])}`);
  console.log(`DETAIL_RPC_FAILURE_ROW_1_TYPES=${formatAllKeyTypes(failures?.[0])}`);
  console.log(`DETAIL_RPC_FAILURE_ROW_2_KEYS=${formatKeys(failures?.[1])}`);
  console.log(`DETAIL_RPC_FAILURE_ROW_2_TYPES=${formatAllKeyTypes(failures?.[1])}`);

  let firstMismatch = checkExactKeys(data, [...runKeys, "scope_outcomes", "binding_failures"], "top_level", "exact_key_set");
  if (!firstMismatch) {
    for (const field of runKeys) {
      const check = checkRunField(field, data[field]);
      console.log(`DETAIL_RPC_RUN_FIELD=${field}|TYPE=${runtimeType(data[field])}|VALUE=${safeDiagnosticValue(data[field])}|VALIDATOR_ACCEPTS=${check.accepts}|CONSTRAINT=${check.constraint}`);
      if (!check.accepts) {
        firstMismatch = { level: "run", field, ...check, actual: data[field] };
        break;
      }
    }
  }

  if (!firstMismatch) {
    firstMismatch = checkDetailRows("scope", scopes, scopeKeys, checkScopeField);
  }
  if (!firstMismatch) {
    firstMismatch = checkDetailRows("failure", failures, failureKeys, checkFailureField);
  }

  if (firstMismatch) {
    console.log(`DETAIL_RPC_FIRST_MISMATCH_LEVEL=${firstMismatch.level}`);
    console.log(`DETAIL_RPC_FIRST_MISMATCH_FIELD=${firstMismatch.field}`);
    console.log(`DETAIL_RPC_FIRST_MISMATCH_ACTUAL_TYPE=${runtimeType(firstMismatch.actual)}`);
    console.log(`DETAIL_RPC_FIRST_MISMATCH_ACTUAL_VALUE=${safeDiagnosticValue(firstMismatch.actual)}`);
    console.log(`DETAIL_RPC_FIRST_MISMATCH_EXPECTED=${firstMismatch.constraint}`);
    console.log("DETAIL_RPC_RESULT=MISMATCH");
  } else {
    console.log("DETAIL_RPC_RESULT=ALL_FIELDS_ACCEPTED");
  }

  return { errorPresent: false, dataNull: false, firstMismatch };
}

function cookieHeaderToSupabaseCookies(header) {
  return String(header ?? "")
    .split("; ")
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      return separator > 0
        ? { name: entry.slice(0, separator), value: entry.slice(separator + 1) }
        : null;
    })
    .filter(Boolean);
}

function checkDetailRows(level, rows, keys, fieldCheck) {
  if (!Array.isArray(rows)) {
    return { level, field: "rows", actual: rows, constraint: "array" };
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const keyMismatch = checkExactKeys(row, keys, level, `row_${index + 1}_exact_key_set`);
    if (keyMismatch) return keyMismatch;
    for (const field of keys) {
      const check = fieldCheck(field, row[field]);
      console.log(`DETAIL_RPC_${level.toUpperCase()}_ROW=${index + 1}|FIELD=${field}|TYPE=${runtimeType(row[field])}|VALUE=${safeDiagnosticValue(row[field])}|VALIDATOR_ACCEPTS=${check.accepts}|CONSTRAINT=${check.constraint}`);
      if (!check.accepts) return { level, field, ...check, actual: row[field] };
    }
  }
  return null;
}

function checkExactKeys(value, keys, level, field) {
  const exact = isPlainRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  return exact ? null : { level, field, actual: value, constraint: "exact_key_set" };
}

function checkRunField(field, value) {
  if (field === "run_id") return validatorCheck(isDiagnosticUuid(value), "UUID string");
  if (field === "status") return validatorCheck(["RUNNING", "COMPLETED", "PARTIAL", "ABORTED", "FAILED_DISCOVERY", "FAILED_CLEANUP"].includes(value), "nonempty permitted run-status string");
  if (field === "version" || field.endsWith("_count")) return validatorCheck(isDecimalString(value), "canonical decimal string");
  if (field === "terminal_code") return validatorCheck(isNullableText(value), "null or nonempty string");
  if (field === "created_at") return validatorCheck(isTimestamp(value), "ISO timestamp string with 0-6 fractional digits");
  if (field === "started_at" || field === "completed_at") return validatorCheck(value === null || isTimestamp(value), "null or ISO timestamp string with 0-6 fractional digits");
  if (field === "stale" || field === "alert_eligible") return validatorCheck(typeof value === "boolean", "boolean");
  if (field === "severity") return validatorCheck(["INFO", "WARNING", "CRITICAL"].includes(value), "INFO|WARNING|CRITICAL string");
  return validatorCheck(false, "unknown run field");
}

function checkScopeField(field, value) {
  if (["scope_status"].includes(field)) return validatorCheck(isText(value), "nonempty string");
  if (["scope_code", "provider_name", "asset_symbol"].includes(field)) return validatorCheck(isNullableText(value), "null or nonempty string");
  if (["binding_success_count", "binding_failure_count", "binding_abort_count", "no_longer_eligible_count"].includes(field)) return validatorCheck(isDecimalString(value), "canonical decimal string");
  if (["refresh_requested", "refresh_attempted", "refresh_succeeded", "refresh_failed"].includes(field)) return validatorCheck(typeof value === "boolean", "boolean");
  if (field === "recorded_at") return validatorCheck(isTimestamp(value), "ISO timestamp string with 0-6 fractional digits");
  return validatorCheck(false, "unknown scope field");
}

function checkFailureField(field, value) {
  if (["failure_stage", "failure_code"].includes(field)) return validatorCheck(isText(value), "nonempty string");
  if (["provider_name", "asset_symbol"].includes(field)) return validatorCheck(isNullableText(value), "null or nonempty string");
  if (["adapter_attempts", "database_attempts"].includes(field)) return validatorCheck(isDecimalString(value), "canonical decimal string");
  if (["retryable", "requires_scope_refresh"].includes(field)) return validatorCheck(typeof value === "boolean", "boolean");
  if (field === "recorded_at") return validatorCheck(isTimestamp(value), "ISO timestamp string with 0-6 fractional digits");
  return validatorCheck(false, "unknown failure field");
}

function validatorCheck(accepts, constraint) { return { accepts, constraint }; }
function isDiagnosticUuid(value) { return typeof value === "string" && UUID_PATTERN.test(value); }
function isText(value) { return typeof value === "string" && value.length > 0; }
function isNullableText(value) { return value === null || isText(value); }
function isDecimalString(value) { return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value); }
function isTimestamp(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
function runtimeType(value) { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function formatKeys(value) { return isPlainRecord(value) ? Object.keys(value).toSorted().join(",") : "NON_OBJECT"; }
function formatAllKeyTypes(value) { return isPlainRecord(value) ? Object.keys(value).toSorted().map((key) => `${key}:${runtimeType(value[key])}`).join(",") : "NON_OBJECT"; }
function formatKeyTypes(value, keys) { return keys.map((key) => `${key}:${runtimeType(value[key])}`).join(","); }
function safeDiagnosticValue(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value !== "string") return runtimeType(value);
  if (UUID_PATTERN.test(value)) return "UUID";
  return /^[A-Za-z0-9_:+.-]{1,120}$/.test(value) ? value : "SAFE_TEXT";
}

async function readCustodyOperationalFingerprint(fixture) {
  const ids = fixture.runs.map((run) => sqlUuid(run.id)).join(", ");
  return sqlScalar(`
    select coalesce(md5(string_agg(concat_ws(':',
      run_id::text, status, version::text, coalesce(terminal_code, ''),
      coalesce(created_at::text, ''), coalesce(started_at::text, ''), coalesce(completed_at::text, ''),
      scopes_discovered::text, scopes_started::text, scopes_completed::text, scopes_failed::text,
      scopes_aborted::text, bindings_discovered::text, bindings_failed::text
    ), ',' order by run_id)), 'empty') || '|' ||
      (select coalesce(md5(string_agg(concat_ws(':',
        run_id::text, discovery_index::text, scope_status, coalesce(scope_code, ''),
        binding_success_count::text, binding_failure_count::text, binding_abort_count::text,
        refresh_requested::text, refresh_attempted::text, refresh_succeeded::text, refresh_failed::text,
        no_longer_eligible_count::text, recorded_at::text
      ), ',' order by run_id, discovery_index)), 'empty')
       from private.custody_balance_observer_scope_outcomes where run_id in (${ids})) || '|' ||
      (select coalesce(md5(string_agg(concat_ws(':',
        run_id::text, binding_order::text, failure_stage, safe_failure_code, retryable::text,
        requires_scope_refresh::text, adapter_attempts::text, database_attempts::text, recorded_at::text
      ), ',' order by run_id, binding_order)), 'empty')
       from private.custody_balance_observer_binding_failures where run_id in (${ids}))
    from private.custody_balance_observer_runs where run_id in (${ids});
  `);
}

async function assertCustodyOperationalFingerprint(before, after) {
  const [runBefore, scopeBefore, failureBefore] = before.split("|");
  const [runAfter, scopeAfter, failureAfter] = after.split("|");
  console.log(`CUSTODY_OPERATIONAL_RUN_FINGERPRINT_BEFORE=${runBefore}`);
  console.log(`CUSTODY_OPERATIONAL_RUN_FINGERPRINT_AFTER=${runAfter}`);
  console.log(`CUSTODY_OPERATIONAL_SCOPE_FINGERPRINT_BEFORE=${scopeBefore}`);
  console.log(`CUSTODY_OPERATIONAL_SCOPE_FINGERPRINT_AFTER=${scopeAfter}`);
  console.log(`CUSTODY_OPERATIONAL_FAILURE_FINGERPRINT_BEFORE=${failureBefore}`);
  console.log(`CUSTODY_OPERATIONAL_FAILURE_FINGERPRINT_AFTER=${failureAfter}`);
  assert(before === after, "operational reads preserve fixture fingerprints");
  pass("CUSTODY_OPERATIONAL_READ_ONLY_FINGERPRINT");
}

function assertNoStore(response, label) {
  assert(
    response.headers.get("cache-control")?.toLowerCase().includes("no-store"),
    `${label} no-store`,
    "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
  );
}

function assertPublicPayloadSafe(value, label) {
  const forbiddenKeys = [];

  visitJson(value, (key) => {
    const normalized = key.replaceAll("-", "").replaceAll("_", "").toLowerCase();
    const lower = key.toLowerCase();

    if (PUBLIC_KEY_DENYLIST.has(normalized) || PUBLIC_KEY_DENYLIST.has(lower)) {
      forbiddenKeys.push(key);
    }
  });

  assert(
    forbiddenKeys.length === 0,
    `${label} no forbidden public keys`,
    "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
  );
}

function visitJson(value, onKey) {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitJson(item, onKey);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    onKey(key);
    visitJson(child, onKey);
  }
}

async function appGet(path, { jar } = {}) {
  return appFetch(path, { method: "GET", jar });
}

async function appJsonPost(
  path,
  {
    jar,
    body,
    includeOrigin = true,
    origin = APP_ORIGIN,
    fetchSite = "same-origin",
    redirect = "manual",
  } = {},
) {
  const requestUrl = new URL(path, APP_ORIGIN);
  const headers = new Headers({
    "content-type": "application/json",
  });

  if (includeOrigin) {
    headers.set("origin", origin);
  }

  if (fetchSite) {
    headers.set("sec-fetch-site", fetchSite);
  }

  if (jar) {
    const cookieHeader = jar.getHeader(requestUrl);

    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
  }

  const response = await localFetch(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    redirect,
    signal: AbortSignal.timeout(10000),
  });

  if (jar) {
    jar.store(response, requestUrl);
  }

  const text = await response.text();

  assertOutputSafe(text, `HTTP POST ${requestUrl.pathname}`);

  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  return { response, payload, text };
}

async function appFetch(
  path,
  {
    method = "GET",
    jar,
    body,
    includeOrigin = true,
    origin = APP_ORIGIN,
    fetchSite = "same-origin",
    redirect = "manual",
  } = {},
) {
  const requestUrl = new URL(path, APP_ORIGIN);
  const headers = new Headers();

  if (body) {
    headers.set("content-type", "application/x-www-form-urlencoded");
  }

  if (includeOrigin && method !== "GET") {
    headers.set("origin", origin);
  }

  if (fetchSite && method !== "GET") {
    headers.set("sec-fetch-site", fetchSite);
  }

  if (jar) {
    const cookieHeader = jar.getHeader(requestUrl);

    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
  }

  const response = await localFetch(requestUrl, {
    method,
    headers,
    body: body ? new URLSearchParams(body) : undefined,
    redirect,
    signal: AbortSignal.timeout(10000),
  });

  if (jar) {
    jar.store(response, requestUrl);
  }

  const text = await response.text();

  assertOutputSafe(text, `HTTP ${method} ${requestUrl.pathname}`);

  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  return { response, payload, text };
}

async function signUpConfirmAndSignIn(email, password, nextPath, displayName) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: displayName,
      password,
      password_confirm: password,
    },
    redirect: "manual",
  });

  assertRedirectPath(signup.response, "/auth/check-email", "Signup redirect");

  const confirmationLink = await pollMailpitLink(
    email,
    CONFIRMATION_SUBJECT,
    "/auth/confirm",
  );
  const confirmationUrl = new URL(confirmationLink);
  const tokenHash = confirmationUrl.searchParams.get("token_hash");

  assert(Boolean(tokenHash), "Confirmation token");

  const confirmJar = createCookieJar();
  const confirm = await appFetch("/api/v1/auth/confirm", {
    method: "POST",
    jar: confirmJar,
    body: {
      token_hash: tokenHash,
      type: "email",
      next: "/account",
    },
    redirect: "manual",
  });

  assertRedirectPath(confirm.response, "/auth/verified", "Confirmation redirect");
  await logout(confirmJar);

  return signIn(email, password, nextPath);
}

async function signIn(email, password, nextPath) {
  const jar = createCookieJar();
  const response = await appFetch("/api/v1/auth/sign-in", {
    method: "POST",
    jar,
    body: {
      email,
      password,
      next: nextPath,
    },
    redirect: "manual",
  });

  assertRedirectPath(response.response, nextPath, "Sign-in redirect");
  assert(jar.hasSessionCookie(), "Sign-in session cookie");

  return jar;
}

async function logout(jar) {
  await appFetch("/api/v1/auth/sign-out", {
    method: "POST",
    jar,
    redirect: "manual",
  });
}

async function pollMailpitLink(email, subject, expectedPath) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const payload = await (
      await localFetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
        redirect: "manual",
      })
    ).json();

    for (const message of getMailpitMessages(payload)) {
      if (!mailpitMessageMatches(message, email, subject)) {
        continue;
      }

      const id = getMailpitMessageId(message);

      if (!id) {
        continue;
      }

      const html = await (
        await localFetch(`${MAILPIT_ORIGIN}/view/${encodeURIComponent(id)}.html`, {
          redirect: "manual",
        })
      ).text();
      const link = extractLinks(html).find((candidate) => {
        try {
          const url = new URL(candidate);

          return url.pathname === expectedPath;
        } catch {
          return false;
        }
      });

      if (link) {
        return link;
      }
    }

    await wait(300);
  }

  throw finalError("REQUIRES_ACTION", "confirmation mail");
}

function getMailpitMessages(payload) {
  const messages = Array.isArray(payload?.messages)
    ? payload.messages
    : Array.isArray(payload?.Messages)
      ? payload.Messages
      : Array.isArray(payload)
        ? payload
        : [];

  return messages.toReversed();
}

function mailpitMessageMatches(message, email, subject) {
  return (
    getMailpitSubject(message) === subject &&
    getMailpitRecipients(message).includes(email)
  );
}

function getMailpitSubject(message) {
  return typeof message?.Subject === "string"
    ? message.Subject
    : message?.subject;
}

function getMailpitMessageId(message) {
  return message?.ID ?? message?.Id ?? message?.id;
}

function getMailpitRecipients(message) {
  const candidates = [
    message?.To,
    message?.to,
    message?.Recipients,
    message?.recipients,
  ];
  const recipients = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    for (const item of candidate) {
      if (typeof item === "string") {
        recipients.push(item.toLowerCase());
      } else if (typeof item?.Address === "string") {
        recipients.push(item.Address.toLowerCase());
      } else if (typeof item?.address === "string") {
        recipients.push(item.address.toLowerCase());
      }
    }
  }

  return recipients;
}

function extractLinks(html) {
  return [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => decodeHtmlEntities(match[1]))
    .map((href) => new URL(href, APP_ORIGIN).toString());
}

async function enrollAndVerifyMfa(jar, userId, label) {
  const enrollment = await startEnrollment(jar, { userId, label });

  await verifyEnrollment(jar, enrollment);
  pass(`ADMIN_READ_${label}_AAL2_READY`);
}

async function startEnrollment(jar, { userId, label }) {
  await assertMfaEnrollmentPreflight(userId, jar, label);

  const response = await appJsonPost("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
  });
  const payload = response.payload;

  assert(response.response.status === 200, `${label} enrollment start status`);
  assert(payload?.status === "enrollment_started", `${label} enrollment started`);
  assert(isUuid(payload.factorId), `${label} enrollment factor id`);
  assert(
    typeof payload.qrCode === "string" &&
      payload.qrCode.startsWith("data:image/") &&
      payload.qrCode.length < 500000,
    `${label} enrollment QR data`,
  );
  assert(isBase32Secret(payload.secret), `${label} enrollment secret shape`);

  return {
    factorId: payload.factorId,
    secret: payload.secret,
  };
}

async function assertMfaEnrollmentPreflight(userId, jar, label) {
  assert(userId, `${label} MFA preflight current user`);

  const requestUrl = new URL("/auth/mfa/enroll", APP_ORIGIN);
  const beforeHasSession = jar.hasSessionCookie(requestUrl);
  const beforeFactors = await mfaFactorCountsByUserId(userId);
  const response = await appFetch("/auth/mfa/enroll", {
    method: "GET",
    jar,
    redirect: "manual",
  });
  const afterFactors = await mfaFactorCountsByUserId(userId);

  assert(beforeHasSession, `${label} MFA preflight session before`);
  assert(jar.hasSessionCookie(requestUrl), `${label} MFA preflight session after`);
  assert(response.response.status === 200, `${label} MFA preflight status`);
  assert(!response.text.includes("otpauth://"), `${label} MFA preflight no secret`);
  assert(beforeFactors.total === afterFactors.total, `${label} MFA preflight no factor mutation`);
  assert(beforeFactors.verified === afterFactors.verified, `${label} MFA preflight no verification`);
  assert(beforeFactors.unverified === afterFactors.unverified, `${label} MFA preflight no unverified factor`);
}

async function verifyEnrollment(jar, enrollment) {
  const response = await appJsonPost("/api/v1/auth/mfa/enroll/verify", {
    jar,
    body: {
      factor_id: enrollment.factorId,
      code: await currentTotpCode(enrollment.secret),
    },
  });

  assert(response.response.status === 200, "Enrollment verify status");
  assert(response.payload?.status === "verified", "Enrollment verified");
}

async function currentTotpCode(secret) {
  const remaining = 30000 - (Date.now() % 30000);

  if (remaining < 5000) {
    await wait(remaining + 500);
  }

  return generateTotpCode(secret);
}

function generateTotpCode(secret) {
  const key = decodeBase32(secret);
  const counter = Math.floor(Date.now() / 30000);
  const buffer = Buffer.alloc(8);

  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

function decodeBase32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.toUpperCase().replace(/=+$/g, "");
  const bytes = [];
  let bits = 0;
  let value = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);

    if (index < 0) {
      throw finalError("REQUIRES_ACTION", "TOTP secret shape");
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

async function readUserIdByEmail(email) {
  const rawUserId = await sqlScalar(`
    select users.id::text
    from auth.users as users
    where users.email = ${sqlLiteral(email)};
  `);

  assert(isUuid(rawUserId), "Auth user id");

  return rawUserId;
}

async function bootstrapAdminRole(
  userId,
  reason = "local admin read runtime bootstrap",
) {
  const count = await sqlScalar(`
    insert into public.user_roles (user_id, role, grant_reason)
    values (${sqlUuid(userId)}, 'ADMIN', ${sqlLiteral(reason)})
    on conflict (user_id, role) where revoked_at is null do nothing;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlUuid(userId)}
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === "1", "Bootstrap ADMIN role");
}

async function revokeTemporaryAdminRole(userId) {
  const count = await sqlScalar(`
    update public.user_roles
    set
      revoked_at = now(),
      revoke_reason = 'local admin read runtime temporary role revoked',
      version = version + 1
    where user_id = ${sqlUuid(userId)}
      and role = 'ADMIN'
      and revoked_at is null;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlUuid(userId)}
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === "0", "Temporary ADMIN role revoked");
}

async function mfaFactorCountsByUserId(userId) {
  const result = await sqlScalar(`
    select
      count(*)::text || ',' ||
      count(*) filter (where factors.status = 'verified')::text || ',' ||
      count(*) filter (where factors.status = 'unverified')::text
    from auth.mfa_factors as factors
    where factors.user_id = ${sqlUuid(userId)}
      and factors.factor_type = 'totp';
  `);
  const [total, verified, unverified] = result.split(",");

  return { total, verified, unverified };
}

async function readFixtureResidueCount(marker) {
  return sqlScalar(`
    select (
      (select count(*) from public.supported_assets where asset_code like ${sqlLiteral(markerToSqlLike(marker))}) +
      (select count(*) from private.custody_providers where provider_code like ${sqlLiteral(markerToSqlLike(marker))}) +
      (select count(*) from private.reconciliation_runs where idempotency_key like ${sqlLiteral(`${marker}.%`)}) +
      (select count(*) from private.reconciliation_review_case_events where idempotency_key like ${sqlLiteral(`${marker}.%`)})
    )::text;
  `);
}

function markerToSqlLike(marker) {
  const normalized = marker.replaceAll(".", "%").toUpperCase();

  return `%${normalized}%`;
}

async function readLocalSupabaseStatus() {
  const command = getNpmCommand("supabase:status", ["--", "-o", "json"]);
  const { stdout, stderr } = await execFileAsync(command.file, command.args, {
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const raw = `${stdout}\n${stderr}`;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  assert(start >= 0 && end > start, "Local Supabase status JSON");

  const status = JSON.parse(raw.slice(start, end + 1));

  assert(Boolean(status.API_URL), "Local Supabase URL");
  assert(Boolean(status.ANON_KEY), "Local Supabase key");

  return status;
}

async function runNpmScriptSensitive(scriptName, label, timeoutMs) {
  const command = getNpmCommand(scriptName);

  try {
    await execFileAsync(command.file, command.args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 12,
    });
    pass(label);
  } catch {
    throw finalError("REQUIRES_ACTION", label);
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

async function assertHttpStatus(url, expectedStatus, label) {
  const response = await readLocalHttpStatus(url, {
    timeoutMs: 2000,
    readBody: true,
    label,
  });

  assert(response.status === expectedStatus, label);
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

async function readProjectContainerCount() {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "ps",
      "--format",
      "{{.Label \"com.supabase.cli.project\"}}\t{{.Label \"com.docker.compose.project\"}}",
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
    .filter((line) => {
      const [supabaseProject, composeProject] = line.split("\t");

      return supabaseProject === PROJECT_LABEL || composeProject === PROJECT_LABEL;
    }).length;
}

async function readPortListenerCount(port) {
  if (process.platform !== "win32") {
    return 0;
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$connections = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; @($connections).Count`,
    ],
    {
      timeout: 10000,
      windowsHide: true,
    },
  );
  const count = Number.parseInt(stdout.trim(), 10);

  return Number.isInteger(count) ? count : 0;
}

async function sqlScalar(sql) {
  try {
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
        timeout: 20000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    );

    return stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  } catch (error) {
    const output = `${error?.message ?? ""}\n${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;

    console.error(`ADMIN_READ_SQL_FAILURE_CLASS=${classifySqlFailure(output)}`);
    console.error(`ADMIN_READ_SQL_FAILURE_CONSTRAINT=${readSafeConstraintName(output)}`);
    console.error(`ADMIN_READ_SQL_FAILURE_CODE=${readSafeProcessFailureCode(error)}`);
    console.error(`ADMIN_READ_SQL_FAILURE_DETAIL=${readSafeSqlFailureDetail(error)}`);
    throw finalError(
      "REQUIRES_ACTION_DATABASE_READ_RUNTIME_DEFECT",
      "ADMIN read runtime SQL",
    );
  }
}

async function commandExitsZero(file, args) {
  try {
    await execFileAsync(file, args, {
      cwd: REPO_ROOT,
      timeout: 10000,
      windowsHide: true,
    });

    return true;
  } catch {
    return false;
  }
}

function assertRedirectPath(response, expectedPath, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const location = response.headers.get("location");
  const actual = location ? new URL(location, APP_ORIGIN) : null;

  assert(Boolean(location), `${label} location`);
  assert(actual?.pathname === expectedPath, `${label} path`);
}

function assertDeepEqual(actual, expected, label, finalStatus = "REQUIRES_ACTION") {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  assert(actualJson === expectedJson, label, finalStatus);
}

function sqlUuid(value) {
  return `${sqlLiteral(value)}::uuid`;
}

function sqlTimestamp(value) {
  return `${sqlLiteral(value)}::timestamptz`;
}

function sqlNullableText(value) {
  return value === null ? "null" : sqlLiteral(value);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function isPlainRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isBase32Secret(value) {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 128 &&
    /^[A-Z2-7]+=*$/i.test(value)
  );
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function onceChildEvent(child, event) {
  return new Promise((resolvePromise) => {
    child.once(event, resolvePromise);
  });
}

function assert(condition, label, finalStatus = "REQUIRES_ACTION") {
  if (!condition) {
    throw finalError(finalStatus, label);
  }
}

function pass(label) {
  passCount += 1;
  console.log(`PASS ${label}`);
}

function finalError(finalStatus, label) {
  const error = new Error(`FAIL ${label}`);

  error.finalStatus = finalStatus;

  return error;
}

main().catch((error) => {
  const finalStatus =
    typeof error?.finalStatus === "string" ? error.finalStatus : "REQUIRES_ACTION";
  const message = error instanceof Error ? error.message : "FAIL unknown";

  if (message.startsWith("FAIL ")) {
    console.error(message);
  } else {
    console.error(`ADMIN_READ_RUNTIME_FAILURE_CLASS=${classifyFailureMessage(message)}`);
    console.error(`ADMIN_READ_RUNTIME_FAILURE_MESSAGE=${redactSensitiveText(message)}`);
    console.error("FAIL admin reconciliation read runtime");
  }

  console.error(`FINAL_STATUS=${finalStatus}`);
  process.exitCode = 1;
});

function classifyFailureMessage(message) {
  if (message.includes("fetch failed")) {
    return "fetch_failed";
  }

  if (message.includes("Body is unusable")) {
    return "response_body_reuse";
  }

  if (message.includes("Invalid URL")) {
    return "invalid_url";
  }

  if (message.includes("ENOENT")) {
    return "missing_file";
  }

  if (message.includes("permission")) {
    return "permission";
  }

  return "unclassified";
}

function classifySqlFailure(output) {
  const normalized = String(output).toLowerCase();

  if (normalized.includes("timed out")) {
    return "timeout";
  }

  if (normalized.includes("duplicate key value")) {
    return "unique_violation";
  }

  if (normalized.includes("violates check constraint")) {
    return "check_violation";
  }

  if (normalized.includes("violates foreign key constraint")) {
    return "foreign_key_violation";
  }

  if (normalized.includes("syntax error")) {
    return "sql_syntax";
  }

  if (normalized.includes("permission denied")) {
    return "permission_denied";
  }

  if (normalized.includes("does not exist")) {
    return "missing_relation_or_column";
  }

  return "unclassified";
}

function readSafeConstraintName(output) {
  const match = String(output).match(/constraint "([A-Za-z0-9_]+)"/);
  const constraint = match?.[1] ?? "none";

  return /^[A-Za-z0-9_]+$/.test(constraint) ? constraint : "redacted";
}

function readSafeProcessFailureCode(error) {
  const code = error?.code ?? error?.signal ?? "none";
  const value = String(code);

  return /^[A-Za-z0-9_:-]+$/.test(value) ? value : "redacted";
}

function readSafeSqlFailureDetail(error) {
  const output = `${error?.stderr ?? ""}\n${error?.stdout ?? ""}\n${error?.message ?? ""}`;
  const diagnosticLines = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      /^(ERROR|DETAIL|HINT|CONTEXT|FATAL|psql):|constraint|violates|syntax|does not exist|permission denied|timed out/i.test(
        line,
      ),
    );
  const selected =
    diagnosticLines.length > 0
      ? diagnosticLines.slice(-6).join(" | ")
      : String(output).split(/\r?\n/).slice(-6).join(" | ");

  return redactSensitiveText(selected);
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
      "[REDACTED_UUID]",
    )
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(
      /(access_token|refresh_token|cookie|set-cookie|secret|key|password)\s*[:=]\s*[^,\s]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 300);
}
