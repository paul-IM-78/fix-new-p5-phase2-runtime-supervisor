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
const ATOMIC_UNITS_PATTERN = /^(0|[1-9][0-9]{0,37})$/;
const SIGNED_ATOMIC_UNITS_PATTERN = /^-?(0|[1-9][0-9]{0,37})$/;
const PUBLIC_TEXT_DENYLIST = [
  "SQLSTATE",
  "private.",
  "private_",
  "stack",
  "details",
  "hint",
  "access_token",
  "refresh_token",
  "sb-access-token",
  "sb-refresh-token",
  "authorization",
  "set-cookie",
  "cookie",
  "jwt",
  "database_url",
  "service_role",
  "supabase_service_role",
  "private key",
  "mnemonic",
  "seed phrase",
];
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

let passCount = 0;

async function main() {
  const suffix = randomUUID().replaceAll("-", "").toLowerCase();
  const fixtureTag = `P5-T02-11C-${Date.now()}-${suffix.slice(0, 10)}`;
  const safePrefix = `p5c.${suffix.slice(0, 18)}`;
  const codePrefix = `P5C${suffix.slice(0, 10).toUpperCase()}`;
  const sharedPassword = `Read-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-p5c-admin-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const userEmail = `qa-p5c-user-${Date.now()}-${suffix.slice(8, 16)}@example.test`;
  let cleanupMarker = null;

  await withQuarantinedEnv(async () => {
    await withSelfOwnedRuntime(async () => {
      await assertPublicSmoke();

      const userJar = await signUpConfirmAndSignIn(
        userEmail,
        sharedPassword,
        "/account",
        "QA Admin Read User",
      );
      const userId = await readUserIdByEmail(userEmail);

      const adminJar = await signUpConfirmAndSignIn(
        adminEmail,
        sharedPassword,
        "/admin",
        "QA Admin Read Admin",
      );
      const adminUserId = await readUserIdByEmail(adminEmail);

      await bootstrapAdminRole(
        userId,
        "local admin read runtime temporary user aal2 bootstrap",
      );
      await enrollAndVerifyMfa(userJar, userId, "USER");
      await revokeTemporaryAdminRole(userId);
      await assertActiveAdminRoleCount(
        userId,
        "0",
        "USER AAL2 temporary ADMIN revoked",
      );

      await bootstrapAdminRole(adminUserId);

      const fixture = await createAdminReadFixture({
        adminUserId,
        safePrefix,
        codePrefix,
        fixtureTag,
      });
      cleanupMarker = fixture.cleanupMarker;
      const beforeSideEffects = await readSideEffectSnapshot(fixture);

      await assertAuthMatrixBeforeAdminAal2({
        userJar,
        adminJar,
        fixture,
      });

      await enrollAndVerifyMfa(adminJar, adminUserId, "ADMIN");
      await assertAuthMatrixAdminAal2({ adminJar, fixture });

      await assertListHappyPath(adminJar, fixture);
      await assertListPagination(adminJar, fixture);
      await assertListValidation(adminJar);
      await assertListFilters(adminJar, fixture);
      await assertDetailHappyPath(adminJar, fixture);
      await assertBindingProvenanceCounts(adminJar, fixture);
      await assertDetailValidation(adminJar, fixture);
      await assertMethodBoundary(adminJar, fixture);

      const afterSideEffects = await readSideEffectSnapshot(fixture);

      assertDeepEqual(
        beforeSideEffects,
        afterSideEffects,
        "READ side-effect snapshot",
        "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
      );
      pass("ADMIN_READ_SIDE_EFFECT_SNAPSHOT");
    }, () => cleanupMarker);
  });

  console.log(`ADMIN_READ_RUNTIME_TEST_CASE_COUNT=${passCount}`);
  console.log("FINAL_STATUS=PASS_ADMIN_RECONCILIATION_READ_RUNTIME_READY");
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

async function createAdminReadFixture({
  adminUserId,
  safePrefix,
  codePrefix,
  fixtureTag,
}) {
  const ids = {
    providerId: randomUUID(),
    assetAId: randomUUID(),
    assetBId: randomUUID(),
    bindingACollectionId: randomUUID(),
    bindingAPayoutId: randomUUID(),
    bindingATreasuryId: randomUUID(),
    bindingBCollectionId: randomUUID(),
    bindingBPayoutId: randomUUID(),
    runCompletedId: randomUUID(),
    runPartialId: randomUUID(),
    runFailedId: randomUUID(),
    itemHugeMatchedId: randomUUID(),
    itemZeroMismatchId: randomUUID(),
    itemMissingId: randomUUID(),
    itemToleranceId: randomUUID(),
    itemReviewRequiredId: randomUUID(),
    itemBindingDirectId: randomUUID(),
    reviewCaseId: randomUUID(),
  };
  const observations = Array.from({ length: 9 }, () => randomUUID());
  const eventIds = [randomUUID(), randomUUID()];
  const createdSame = "2026-07-30T03:00:00.123456Z";
  const createdBindingDirect = "2026-07-30T03:00:00.123400Z";
  const createdMissing = "2026-07-30T03:00:00.123300Z";
  const createdTolerance = "2026-07-30T03:00:00.123200Z";
  const createdReviewRequired = "2026-07-30T03:00:00.123100Z";
  const hugeUnits = "123456789012345678901234567890123456";
  const assetACode = `${codePrefix}A`;
  const assetBCode = `${codePrefix}B`;
  const providerCode = `${codePrefix}-P`;
  const bindingRows = [
    [ids.bindingACollectionId, ids.assetAId, `${safePrefix.replaceAll(".", "_")}_a_col`, "P5C A Collection", "COLLECTION"],
    [ids.bindingAPayoutId, ids.assetAId, `${safePrefix.replaceAll(".", "_")}_a_pay`, "P5C A Payout", "PAYOUT"],
    [ids.bindingATreasuryId, ids.assetAId, `${safePrefix.replaceAll(".", "_")}_a_treas`, "P5C A Treasury", "TREASURY"],
    [ids.bindingBCollectionId, ids.assetBId, `${safePrefix.replaceAll(".", "_")}_b_col`, "P5C B Collection", "COLLECTION"],
    [ids.bindingBPayoutId, ids.assetBId, `${safePrefix.replaceAll(".", "_")}_b_pay`, "P5C B Payout", "PAYOUT"],
  ];
  const observationRows = [
    [observations[0], ids.bindingACollectionId, ids.assetAId, "BALANCE_OBSERVER", "100000000000000000000000000000000000", "2026-07-30T02:50:00Z"],
    [observations[1], ids.bindingAPayoutId, ids.assetAId, "BALANCE_OBSERVER", "200000000000000000000000000000000000", "2026-07-30T02:51:00Z"],
    [observations[2], ids.bindingATreasuryId, ids.assetAId, "BALANCE_OBSERVER", "23456789012345678901234567890123456", "2026-07-30T02:52:00Z"],
    [observations[3], ids.bindingBCollectionId, ids.assetBId, "BALANCE_OBSERVER", "0", "2026-07-30T02:53:00Z"],
    [observations[4], ids.bindingBPayoutId, ids.assetBId, "BALANCE_OBSERVER", "0", "2026-07-30T02:54:00Z"],
    [observations[5], ids.bindingBCollectionId, ids.assetBId, "ALT_BALANCE_OBSERVER", "60", "2026-07-30T01:50:00Z"],
    [observations[6], ids.bindingBPayoutId, ids.assetBId, "ALT_BALANCE_OBSERVER", "41", "2026-07-30T01:51:00Z"],
    [observations[7], ids.bindingACollectionId, ids.assetAId, "BALANCE_OBSERVER", "220", "2026-07-30T00:20:00Z"],
    [observations[8], ids.bindingACollectionId, ids.assetAId, "BALANCE_OBSERVER", "52", "2026-07-30T02:55:00.123456Z"],
  ];
  const runRows = [
    [
      ids.runCompletedId,
      `${safePrefix}.run.completed`,
      "MANUAL",
      "COMPLETED",
      "2026-07-30T02:45:00Z",
      "2026-07-30T02:59:00Z",
      null,
      createdSame,
      "BALANCE_OBSERVER",
      "2026-07-30T03:00:00Z",
    ],
    [
      ids.runPartialId,
      `${safePrefix}.run.partial`,
      "SYSTEM",
      "PARTIAL",
      "2026-07-30T01:45:00Z",
      "2026-07-30T01:59:00Z",
      null,
      createdMissing,
      "ALT_BALANCE_OBSERVER",
      "2026-07-30T02:00:00Z",
    ],
    [
      ids.runFailedId,
      `${safePrefix}.run.failed`,
      "SCHEDULED",
      "FAILED",
      "2026-07-30T00:10:00Z",
      "2026-07-30T00:25:00Z",
      "P5C_RUNTIME_FAILURE",
      createdReviewRequired,
      "BALANCE_OBSERVER",
      "2026-07-30T01:00:00Z",
    ],
  ];
  const itemRows = [
    [
      ids.itemHugeMatchedId,
      ids.runCompletedId,
      ids.assetAId,
      hugeUnits,
      hugeUnits,
      "0",
      "0",
      "MATCHED",
      createdSame,
    ],
    [
      ids.itemZeroMismatchId,
      ids.runCompletedId,
      ids.assetBId,
      "5",
      "0",
      "-5",
      "0",
      "MISMATCH",
      createdSame,
    ],
    [
      ids.itemMissingId,
      ids.runPartialId,
      ids.assetAId,
      "777",
      null,
      null,
      "0",
      "OBSERVATION_FAILED",
      createdMissing,
    ],
    [
      ids.itemToleranceId,
      ids.runPartialId,
      ids.assetBId,
      "100",
      "101",
      "1",
      "5",
      "WITHIN_TOLERANCE",
      createdTolerance,
    ],
    [
      ids.itemReviewRequiredId,
      ids.runFailedId,
      ids.assetAId,
      "200",
      "220",
      "20",
      "10",
      "REVIEW_REQUIRED",
      createdReviewRequired,
    ],
  ];
  const memberRows = [
    [ids.itemHugeMatchedId, ids.bindingACollectionId, observations[0], "OBSERVED", createdSame],
    [ids.itemHugeMatchedId, ids.bindingAPayoutId, observations[1], "OBSERVED", createdSame],
    [ids.itemHugeMatchedId, ids.bindingATreasuryId, observations[2], "OBSERVED", createdSame],
    [ids.itemZeroMismatchId, ids.bindingBCollectionId, observations[3], "OBSERVED", createdSame],
    [ids.itemZeroMismatchId, ids.bindingBPayoutId, observations[4], "OBSERVED", createdSame],
    [ids.itemMissingId, ids.bindingACollectionId, null, "MISSING_OBSERVATION", createdMissing],
    [ids.itemMissingId, ids.bindingAPayoutId, null, "OBSERVATION_FAILED", createdMissing],
    [ids.itemToleranceId, ids.bindingBCollectionId, observations[5], "OBSERVED", createdTolerance],
    [ids.itemToleranceId, ids.bindingBPayoutId, observations[6], "OBSERVED", createdTolerance],
    [ids.itemReviewRequiredId, ids.bindingACollectionId, observations[7], "OBSERVED", createdReviewRequired],
  ];

  await sqlScalar(`
    begin;
    set constraints all deferred;

    insert into public.supported_assets (
      id,
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals,
      mint_address,
      status,
      created_at,
      updated_at
    )
    values
      (${sqlUuid(ids.assetAId)}, ${sqlLiteral(assetACode)}, ${sqlLiteral(`${codePrefix}A`)}, 'P5C Runtime Asset A', 'NATIVE', 9, null, 'ACTIVE', ${sqlTimestamp("2026-07-30T00:00:00Z")}, ${sqlTimestamp("2026-07-30T00:00:00Z")}),
      (${sqlUuid(ids.assetBId)}, ${sqlLiteral(assetBCode)}, ${sqlLiteral(`${codePrefix}B`)}, 'P5C Runtime Asset B', 'NATIVE', 6, null, 'ACTIVE', ${sqlTimestamp("2026-07-30T00:00:00Z")}, ${sqlTimestamp("2026-07-30T00:00:00Z")});

    insert into private.custody_providers (
      id,
      provider_code,
      display_name,
      provider_type,
      supports_balance_observation,
      status,
      approved_at,
      created_at,
      updated_at
    )
    values (
      ${sqlUuid(ids.providerId)},
      ${sqlLiteral(providerCode)},
      'P5C Runtime Provider',
      'MPC_CUSTODIAN',
      true,
      'DRAFT',
      null,
      ${sqlTimestamp("2026-07-30T00:00:00Z")},
      ${sqlTimestamp("2026-07-30T00:00:00Z")}
    );

    update private.custody_providers
    set status = 'APPROVED'
    where id = ${sqlUuid(ids.providerId)};

    insert into private.custody_account_bindings (
      id,
      custody_provider_id,
      asset_id,
      binding_key,
      display_label,
      account_role,
      status,
      approved_at,
      created_at,
      updated_at
    )
    values
      ${bindingRows
        .map(
          ([id, assetId, bindingKey, label, role]) =>
            `(${sqlUuid(id)}, ${sqlUuid(ids.providerId)}, ${sqlUuid(assetId)}, ${sqlLiteral(bindingKey)}, ${sqlLiteral(label)}, ${sqlLiteral(role)}, 'DRAFT', null, ${sqlTimestamp("2026-07-30T00:00:00Z")}, ${sqlTimestamp("2026-07-30T00:00:00Z")})`,
        )
        .join(",\n      ")};

    update private.custody_account_bindings
    set status = 'APPROVED'
    where id in (
      ${bindingRows.map(([id]) => sqlUuid(id)).join(",\n      ")}
    );

    insert into private.external_balance_observations (
      id,
      custody_account_binding_id,
      asset_id,
      observer_kind,
      observation_key,
      observed_units,
      checkpoint_reference,
      observed_at,
      created_at
    )
    values
      ${observationRows
        .map(
          ([id, bindingId, assetId, observerKind, units, observedAt], index) =>
            `(${sqlUuid(id)}, ${sqlUuid(bindingId)}, ${sqlUuid(assetId)}, ${sqlLiteral(observerKind)}, ${sqlLiteral(`${safePrefix}.obs.${String(index + 1).padStart(3, "0")}`)}, ${sqlNumeric(units)}, null, ${sqlTimestamp(observedAt)}, ${sqlTimestamp(observedAt)})`,
        )
        .join(",\n      ")};

    insert into private.reconciliation_runs (
      id,
      idempotency_key,
      trigger_source,
      status,
      requested_by_profile_id,
      started_at,
      completed_at,
      failure_code,
      created_at,
      observer_kind,
      observation_cutoff_at
    )
    values
      ${runRows
        .map(
          ([
            id,
            idempotencyKey,
            triggerSource,
            status,
            startedAt,
            completedAt,
            failureCode,
            createdAt,
            observerKind,
            cutoffAt,
          ]) =>
            `(${sqlUuid(id)}, ${sqlLiteral(idempotencyKey)}, ${sqlLiteral(triggerSource)}, ${sqlLiteral(status)}, ${sqlUuid(adminUserId)}, ${sqlTimestamp(startedAt)}, ${sqlTimestamp(completedAt)}, ${sqlNullableText(failureCode)}, ${sqlTimestamp(createdAt)}, ${sqlLiteral(observerKind)}, ${sqlTimestamp(cutoffAt)})`,
        )
        .join(",\n      ")};

    insert into private.reconciliation_items (
      id,
      reconciliation_run_id,
      custody_account_binding_id,
      asset_id,
      external_balance_observation_id,
      expected_units,
      observed_units,
      difference_units,
      tolerance_units,
      classification,
      created_at,
      scope_kind
    )
    values
      ${itemRows
        .map(
          ([
            id,
            runId,
            assetId,
            expectedUnits,
            observedUnits,
            differenceUnits,
            toleranceUnits,
            classification,
            createdAt,
          ]) =>
            `(${sqlUuid(id)}, ${sqlUuid(runId)}, null, ${sqlUuid(assetId)}, null, ${sqlNumeric(expectedUnits)}, ${sqlNullableNumeric(observedUnits)}, ${sqlNullableNumeric(differenceUnits)}, ${sqlNumeric(toleranceUnits)}, ${sqlLiteral(classification)}, ${sqlTimestamp(createdAt)}, 'ASSET_AGGREGATE')`,
        )
        .join(",\n      ")};

    insert into private.reconciliation_items (
      id,
      reconciliation_run_id,
      custody_account_binding_id,
      asset_id,
      external_balance_observation_id,
      expected_units,
      observed_units,
      difference_units,
      tolerance_units,
      classification,
      created_at,
      scope_kind
    )
    values (
      ${sqlUuid(ids.itemBindingDirectId)},
      ${sqlUuid(ids.runCompletedId)},
      ${sqlUuid(ids.bindingACollectionId)},
      ${sqlUuid(ids.assetAId)},
      ${sqlUuid(observations[8])},
      50,
      52,
      2,
      5,
      'WITHIN_TOLERANCE',
      ${sqlTimestamp(createdBindingDirect)},
      'BINDING'
    );

    insert into private.reconciliation_item_binding_observations (
      reconciliation_item_id,
      custody_account_binding_id,
      external_balance_observation_id,
      membership_status,
      created_at
    )
    values
      ${memberRows
        .map(
          ([itemId, bindingId, observationId, status, createdAt]) =>
            `(${sqlUuid(itemId)}, ${sqlUuid(bindingId)}, ${sqlNullableUuid(observationId)}, ${sqlLiteral(status)}, ${sqlTimestamp(createdAt)})`,
        )
        .join(",\n      ")};

    insert into private.reconciliation_review_cases (
      id,
      reconciliation_item_id,
      status,
      version,
      opened_at,
      updated_at,
      resolved_at,
      opened_by_profile_id,
      last_actor_profile_id,
      created_at
    )
    values (
      ${sqlUuid(ids.reviewCaseId)},
      ${sqlUuid(ids.itemZeroMismatchId)},
      'IN_REVIEW',
      2,
      ${sqlTimestamp("2026-07-30T03:05:00Z")},
      ${sqlTimestamp("2026-07-30T03:06:00Z")},
      null,
      ${sqlUuid(adminUserId)},
      ${sqlUuid(adminUserId)},
      ${sqlTimestamp("2026-07-30T03:05:00Z")}
    );

    insert into private.reconciliation_review_case_events (
      id,
      reconciliation_resolution_id,
      event_version,
      idempotency_key,
      event_type,
      from_status,
      to_status,
      actor_profile_id,
      reason_code,
      created_at
    )
    values
      (${sqlUuid(eventIds[0])}, ${sqlUuid(ids.reviewCaseId)}, 1, ${sqlLiteral(`${safePrefix}.review.open`)}, 'OPENED', null, 'OPEN', ${sqlUuid(adminUserId)}, 'P5C_OPEN', ${sqlTimestamp("2026-07-30T03:05:00Z")}),
      (${sqlUuid(eventIds[1])}, ${sqlUuid(ids.reviewCaseId)}, 2, ${sqlLiteral(`${safePrefix}.review.start`)}, 'REVIEW_STARTED', 'OPEN', 'IN_REVIEW', ${sqlUuid(adminUserId)}, 'P5C_STARTED', ${sqlTimestamp("2026-07-30T03:06:00Z")});

    commit;

    select 'ok';
  `);

  const fixture = {
    tag: fixtureTag,
    cleanupMarker: safePrefix,
    assetAId: ids.assetAId,
    assetBId: ids.assetBId,
    reviewedItemId: ids.itemZeroMismatchId,
    noReviewItemId: ids.itemMissingId,
    missingItemId: ids.itemMissingId,
    hugeItemId: ids.itemHugeMatchedId,
    zeroItemId: ids.itemZeroMismatchId,
    toleranceItemId: ids.itemToleranceId,
    bindingItemId: ids.itemBindingDirectId,
    items: [
      {
        id: ids.itemHugeMatchedId,
        assetId: ids.assetAId,
        runId: ids.runCompletedId,
        itemCreatedAt: createdSame,
        runStatus: "COMPLETED",
        classification: "MATCHED",
        reviewStatus: null,
        observerKind: "BALANCE_OBSERVER",
        observationCutoffAt: "2026-07-30T03:00:00Z",
        expectedUnits: hugeUnits,
        observedUnits: hugeUnits,
        differenceUnits: "0",
        toleranceUnits: "0",
        counts: [3, 3, 0, 0],
      },
      {
        id: ids.itemZeroMismatchId,
        assetId: ids.assetBId,
        runId: ids.runCompletedId,
        itemCreatedAt: createdSame,
        runStatus: "COMPLETED",
        classification: "MISMATCH",
        reviewStatus: "IN_REVIEW",
        observerKind: "BALANCE_OBSERVER",
        observationCutoffAt: "2026-07-30T03:00:00Z",
        expectedUnits: "5",
        observedUnits: "0",
        differenceUnits: "-5",
        toleranceUnits: "0",
        counts: [2, 2, 0, 0],
      },
      {
        id: ids.itemBindingDirectId,
        assetId: ids.assetAId,
        runId: ids.runCompletedId,
        itemCreatedAt: createdBindingDirect,
        runStatus: "COMPLETED",
        classification: "WITHIN_TOLERANCE",
        reviewStatus: null,
        observerKind: "BALANCE_OBSERVER",
        observationCutoffAt: "2026-07-30T03:00:00Z",
        expectedUnits: "50",
        observedUnits: "52",
        differenceUnits: "2",
        toleranceUnits: "5",
        counts: [1, 1, 0, 0],
      },
      {
        id: ids.itemMissingId,
        assetId: ids.assetAId,
        runId: ids.runPartialId,
        itemCreatedAt: createdMissing,
        runStatus: "PARTIAL",
        classification: "OBSERVATION_FAILED",
        reviewStatus: null,
        observerKind: "ALT_BALANCE_OBSERVER",
        observationCutoffAt: "2026-07-30T02:00:00Z",
        expectedUnits: "777",
        observedUnits: null,
        differenceUnits: null,
        toleranceUnits: "0",
        counts: [2, 0, 1, 1],
      },
      {
        id: ids.itemToleranceId,
        assetId: ids.assetBId,
        runId: ids.runPartialId,
        itemCreatedAt: createdTolerance,
        runStatus: "PARTIAL",
        classification: "WITHIN_TOLERANCE",
        reviewStatus: null,
        observerKind: "ALT_BALANCE_OBSERVER",
        observationCutoffAt: "2026-07-30T02:00:00Z",
        expectedUnits: "100",
        observedUnits: "101",
        differenceUnits: "1",
        toleranceUnits: "5",
        counts: [2, 2, 0, 0],
      },
      {
        id: ids.itemReviewRequiredId,
        assetId: ids.assetAId,
        runId: ids.runFailedId,
        itemCreatedAt: createdReviewRequired,
        runStatus: "FAILED",
        classification: "REVIEW_REQUIRED",
        reviewStatus: null,
        observerKind: "BALANCE_OBSERVER",
        observationCutoffAt: "2026-07-30T01:00:00Z",
        expectedUnits: "200",
        observedUnits: "220",
        differenceUnits: "20",
        toleranceUnits: "10",
        counts: [1, 1, 0, 0],
      },
    ],
  };

  fixture.expectedOrder = fixture.items.toSorted(compareListItems).map((item) => item.id);

  console.log("ADMIN_READ_FIXTURE_TAG_RECORDED=true");
  console.log("ADMIN_READ_FIXTURE_ASSET_COUNT=2");
  console.log("ADMIN_READ_FIXTURE_RUN_COUNT=3");
  console.log("ADMIN_READ_FIXTURE_ITEM_COUNT=6");
  console.log("ADMIN_READ_FIXTURE_REVIEW_CASE_COUNT=1");
  console.log("ADMIN_READ_FIXTURE_REVIEW_EVENT_COUNT=2");
  pass("ADMIN_READ_FIXTURE_SETUP");

  return fixture;
}

function compareListItems(left, right) {
  const time = right.itemCreatedAt.localeCompare(left.itemCreatedAt);

  return time || right.id.localeCompare(left.id);
}

async function assertAuthMatrixBeforeAdminAal2({ userJar, adminJar, fixture }) {
  for (const path of readPaths(fixture)) {
    await assertJsonError(
      await appGet(path),
      401,
      "admin_authentication_required",
      "Unauthenticated read",
    );
    await assertJsonError(
      await appGet(path, { jar: userJar }),
      403,
      "admin_role_required",
      "USER AAL2 read denied",
    );
    await assertJsonError(
      await appGet(path, { jar: adminJar }),
      403,
      "admin_aal2_required",
      "ADMIN AAL1 read denied",
    );
  }

  console.log("ADMIN_READ_AUTH_UNAUTHENTICATED=PASS");
  console.log("ADMIN_READ_AUTH_USER_AAL2_DENIED=PASS");
  console.log("ADMIN_READ_AUTH_ADMIN_AAL1_DENIED=PASS");
  pass("ADMIN_READ_AUTH_MATRIX_PRE_AAL2");
}

async function assertAuthMatrixAdminAal2({ adminJar, fixture }) {
  for (const path of readPaths(fixture)) {
    const payload = await assertJsonOk(
      await appGet(path, { jar: adminJar }),
      "ADMIN AAL2 read allowed",
    );

    assertPublicPayloadSafe(payload, "ADMIN AAL2 read payload");
  }

  console.log("ADMIN_READ_AUTH_ADMIN_AAL2_ALLOWED=PASS");
  pass("ADMIN_READ_AUTH_MATRIX_ADMIN_AAL2");
}

function readPaths(fixture) {
  return [
    "/api/v1/admin/reconciliation/items",
    `/api/v1/admin/reconciliation/items/${fixture.reviewedItemId}`,
  ];
}

async function assertListHappyPath(jar, fixture) {
  const payload = await getList(jar);
  const items = payload.result.items;

  assert(items.length === 6, "default list fixture count");
  assert(payload.result.nextCursor === null, "default list cursor null");
  assertListOrder(items, fixture.expectedOrder, "default list order");
  assertListItemShape(items);
  assertNoListProvenance(items);

  const huge = findListItem(items, fixture.hugeItemId);
  const zero = findListItem(items, fixture.zeroItemId);
  const binding = findListItem(items, fixture.bindingItemId);
  const missing = findListItem(items, fixture.missingItemId);

  assert(huge.expectedUnits === fixture.items[0].expectedUnits, "huge expected units");
  assert(huge.observedUnits === fixture.items[0].observedUnits, "huge observed units");
  assert(zero.observedUnits === "0", "zero observed units string");
  assert(missing.observedUnits === null, "null observed units");
  assert(missing.differenceUnits === null, "null difference units");
  assertProvenanceCounts(huge, [3, 3, 0, 0], "huge provenance counts");
  assertProvenanceCounts(zero, [2, 2, 0, 0], "zero provenance counts");
  assertProvenanceCounts(binding, [1, 1, 0, 0], "binding provenance counts");
  assertProvenanceCounts(missing, [2, 0, 1, 1], "missing provenance counts");

  console.log("ADMIN_READ_LIST_DEFAULT=PASS");
  console.log("ADMIN_READ_NUMERIC_PRECISION=PASS");
  console.log("ADMIN_READ_NULL_ZERO_DISTINCTION=PASS");
  console.log("ADMIN_READ_PROVENANCE_COUNTS=PASS");
  pass("ADMIN_READ_LIST_HAPPY_PATH");
}

async function assertListPagination(jar, fixture) {
  const pageSize = 2;
  const pages = [];
  let cursor = null;
  let reachedLastPage = false;

  for (let index = 0; index < 10; index += 1) {
    const query = cursor
      ? `?limit=${pageSize}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=${pageSize}`;
    const page = await getList(jar, query);
    const pageItems = page.result.items;

    assert(pageItems.length > 0, "pagination page nonempty");
    assert(pageItems.length <= pageSize, "lookahead row not exposed");
    pages.push(pageItems);

    if (page.result.nextCursor === null) {
      reachedLastPage = true;
      break;
    }

    assert(typeof page.result.nextCursor === "string", "page cursor");
    assertCursorShape(page.result.nextCursor, pageItems.at(-1));
    cursor = page.result.nextCursor;
  }

  const flattened = pages.flat();
  const combined = flattened.map((item) => item.reconciliationItemId);

  assert(reachedLastPage, "pagination reached last page");
  assertListOrder(
    flattened,
    fixture.expectedOrder,
    "pagination combined order",
  );
  assert(
    new Set(combined).size === combined.length,
    "pagination duplicates absent",
  );
  assertDeepEqual(combined, fixture.expectedOrder, "pagination fixture set");

  console.log("ADMIN_READ_LIMIT_LOOKAHEAD=PASS");
  console.log("ADMIN_READ_CURSOR_PAGINATION=PASS");
  console.log("ADMIN_READ_MICROSECOND_CURSOR=PASS");
  pass("ADMIN_READ_LIST_PAGINATION");
}

function assertCursorShape(cursor, lastItem) {
  assert(/^[A-Za-z0-9_-]+$/.test(cursor), "cursor opaque base64url");
  assert(!cursor.includes(lastItem.reconciliationItemId), "cursor no raw item id");
  assert(!/actor|session|filter|secret|cookie|jwt/i.test(cursor), "cursor no unsafe text");

  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));

  assert(
    isPlainRecord(decoded) &&
      Object.keys(decoded).toSorted().join(",") === "createdAt,itemId",
    "cursor decoded shape",
  );
  assert(decoded.itemId === lastItem.reconciliationItemId, "cursor item id");
  assert(decoded.createdAt === lastItem.itemCreatedAt, "cursor created at exact");
  assert(/\.\d{4,6}(?:Z|[+-]\d{2}:\d{2})$/.test(decoded.createdAt), "cursor microsecond precision");
}

async function assertListValidation(jar) {
  const invalidCursors = [
    "",
    "not**base64",
    Buffer.from("not json").toString("base64url"),
    Buffer.from(JSON.stringify([])).toString("base64url"),
    Buffer.from("null").toString("base64url"),
    Buffer.from(JSON.stringify({ itemId: randomUUID() })).toString("base64url"),
    Buffer.from(JSON.stringify({ createdAt: "2026-07-30T00:00:00Z" })).toString("base64url"),
    Buffer.from(JSON.stringify({
      createdAt: "2026-07-30T00:00:00Z",
      itemId: randomUUID(),
      extra: "x",
    })).toString("base64url"),
    Buffer.from(JSON.stringify({
      createdAt: "not-a-date",
      itemId: randomUUID(),
    })).toString("base64url"),
    Buffer.from(JSON.stringify({
      createdAt: "2026-07-30T00:00:00Z",
      itemId: "not-a-uuid",
    })).toString("base64url"),
    Buffer.from(JSON.stringify({
      createdAt: 123,
      itemId: randomUUID(),
    })).toString("base64url"),
  ];
  const invalidQueries = [
    "?unexpected=value",
    "?limit=10&limit=20",
    "?limit=0",
    "?limit=101",
    "?limit=abc",
    "?limit=1.5",
    "?limit=",
    "?assetId=not-a-uuid",
    "?runStatus=NOT_A_STATUS",
    "?classification=NOT_A_CLASSIFICATION",
    "?reviewState=NOT_A_REVIEW_STATE",
    "?observerKind=bad",
    "?cutoffFrom=not-a-date",
    "?cutoffTo=not-a-date",
    "?cutoffFrom=2026-07-30T03:00:00Z&cutoffTo=2026-07-30T03:00:00Z",
    "?cutoffFrom=2026-07-30T04:00:00Z&cutoffTo=2026-07-30T03:00:00Z",
    ...invalidCursors.map((cursor) => `?cursor=${encodeURIComponent(cursor)}`),
  ];

  for (const query of invalidQueries) {
    await assertJsonError(
      await appGet(`/api/v1/admin/reconciliation/items${query}`, { jar }),
      400,
      "invalid_request",
      "invalid list query",
    );
  }

  console.log(`ADMIN_READ_QUERY_VALIDATION_CASES=${invalidQueries.length}`);
  console.log(`ADMIN_READ_CURSOR_INVALID_CASES=${invalidCursors.length}`);
  pass("ADMIN_READ_LIST_VALIDATION");
}

async function assertListFilters(jar, fixture) {
  await assertFilterIds(
    jar,
    `?assetId=${fixture.assetAId}`,
    fixture.items
      .filter((item) => item.assetId === fixture.assetAId)
      .toSorted(compareListItems)
      .map((item) => item.id),
    "asset filter",
  );
  await assertFilterIds(
    jar,
    "?runStatus=PARTIAL",
    fixture.items
      .filter((item) => item.runStatus === "PARTIAL")
      .toSorted(compareListItems)
      .map((item) => item.id),
    "run status filter",
  );
  await assertFilterIds(
    jar,
    "?classification=OBSERVATION_FAILED",
    [fixture.missingItemId],
    "classification filter",
  );
  await assertFilterIds(
    jar,
    "?reviewState=NONE",
    fixture.items
      .filter((item) => item.reviewStatus === null)
      .toSorted(compareListItems)
      .map((item) => item.id),
    "review none filter",
  );
  await assertFilterIds(
    jar,
    "?reviewState=IN_REVIEW",
    [fixture.reviewedItemId],
    "review status filter",
  );
  await assertFilterIds(
    jar,
    "?observerKind=ALT_BALANCE_OBSERVER",
    fixture.items
      .filter((item) => item.observerKind === "ALT_BALANCE_OBSERVER")
      .toSorted(compareListItems)
      .map((item) => item.id),
    "observer kind filter",
  );
  await assertFilterIds(
    jar,
    "?cutoffFrom=2026-07-30T02:00:00Z",
    fixture.items
      .filter((item) => Date.parse(item.observationCutoffAt) >= Date.parse("2026-07-30T02:00:00Z"))
      .toSorted(compareListItems)
      .map((item) => item.id),
    "cutoff from filter",
  );
  await assertFilterIds(
    jar,
    "?cutoffTo=2026-07-30T02:00:00Z",
    fixture.items
      .filter((item) => Date.parse(item.observationCutoffAt) < Date.parse("2026-07-30T02:00:00Z"))
      .toSorted(compareListItems)
      .map((item) => item.id),
    "cutoff to filter",
  );
  await assertFilterIds(
    jar,
    `?assetId=${fixture.assetAId}&observerKind=BALANCE_OBSERVER`,
    fixture.items
      .filter(
        (item) =>
          item.assetId === fixture.assetAId &&
          item.observerKind === "BALANCE_OBSERVER",
      )
      .toSorted(compareListItems)
      .map((item) => item.id),
    "compound filter",
  );

  console.log("ADMIN_READ_FILTER_MATRIX=PASS");
  pass("ADMIN_READ_LIST_FILTERS");
}

async function assertFilterIds(jar, query, expectedIds, label) {
  const payload = await getList(jar, query);
  const actualIds = payload.result.items.map((item) => item.reconciliationItemId);

  assertDeepEqual(actualIds, expectedIds, label);
}

async function assertDetailHappyPath(jar, fixture) {
  const reviewed = await getDetail(jar, fixture.reviewedItemId);

  assertDetailBaseShape(reviewed.result);
  assert(reviewed.result.item.id === fixture.reviewedItemId, "reviewed detail id");
  assert(reviewed.result.item.observedUnits === "0", "detail zero observed string");
  assert(reviewed.result.item.differenceUnits === "-5", "detail signed difference string");
  assert(reviewed.result.reviewCase !== null, "review case present");
  assert(reviewed.result.reviewCase.status === "IN_REVIEW", "review case status");
  assert(reviewed.result.reviewCase.version === 2, "review case version");
  assert(reviewed.result.reviewEvents.length === 2, "review event count");
  assertDeepEqual(
    reviewed.result.reviewEvents.map((event) => event.eventVersion),
    [1, 2],
    "review event order",
  );
  assertDeepEqual(
    reviewed.result.provenance.map((entry) => entry.membershipStatus),
    ["OBSERVED", "OBSERVED"],
    "reviewed provenance observed",
  );

  const noReview = await getDetail(jar, fixture.noReviewItemId);

  assertDetailBaseShape(noReview.result);
  assert(noReview.result.reviewCase === null, "review case absent");
  assert(noReview.result.reviewEvents.length === 0, "review events absent");
  assertDeepEqual(
    noReview.result.provenance.map((entry) => entry.membershipStatus).toSorted(),
    ["MISSING_OBSERVATION", "OBSERVATION_FAILED"],
    "missing provenance statuses",
  );
  assert(noReview.result.item.observedUnits === null, "detail null observed");

  console.log("ADMIN_READ_DETAIL_SHAPE=PASS");
  console.log("ADMIN_READ_DETAIL_PROVENANCE_ORDERING=PASS");
  console.log("ADMIN_READ_DETAIL_REVIEW_CASE_EVENTS=PASS");
  pass("ADMIN_READ_DETAIL_HAPPY_PATH");
}

async function assertBindingProvenanceCounts(jar, fixture) {
  const list = await getList(jar, `?classification=WITHIN_TOLERANCE`);
  const listItem = findListItem(list.result.items, fixture.bindingItemId);
  const detail = await getDetail(jar, fixture.bindingItemId);
  const detailCounts = countDetailProvenance(detail.result.provenance);

  assertProvenanceCounts(
    listItem,
    [
      detail.result.provenance.length,
      detailCounts.observed,
      detailCounts.missing,
      detailCounts.failed,
    ],
    "binding list detail provenance counts",
  );
  assert(listItem.targetBindingCount === 1, "binding target count not zero");

  console.log("ADMIN_READ_BINDING_PROVENANCE_COUNTS=PASS");
  pass("ADMIN_READ_BINDING_PROVENANCE_COUNTS");
}

function countDetailProvenance(provenance) {
  const counts = {
    observed: 0,
    missing: 0,
    failed: 0,
  };

  for (const entry of provenance) {
    if (entry.membershipStatus === "OBSERVED") {
      counts.observed += 1;
    } else if (entry.membershipStatus === "MISSING_OBSERVATION") {
      counts.missing += 1;
    } else if (entry.membershipStatus === "OBSERVATION_FAILED") {
      counts.failed += 1;
    }
  }

  return counts;
}

async function assertDetailValidation(jar, fixture) {
  await assertJsonError(
    await appGet("/api/v1/admin/reconciliation/items/not-a-uuid", { jar }),
    400,
    "invalid_request",
    "invalid detail UUID",
  );
  await assertJsonError(
    await appGet(`/api/v1/admin/reconciliation/items/${randomUUID()}`, { jar }),
    404,
    "reconciliation_item_not_found",
    "missing detail UUID",
  );
  const queryIgnored = await assertJsonOk(
    await appGet(
      `/api/v1/admin/reconciliation/items/${fixture.reviewedItemId}?unexpected=value`,
      { jar },
    ),
    "detail ignores query without leaking",
  );

  assert(
    queryIgnored.result.item.id === fixture.reviewedItemId,
    "detail query ignored item id",
  );

  console.log("ADMIN_READ_DETAIL_INVALID_UUID=PASS");
  console.log("ADMIN_READ_DETAIL_MISSING_UUID=PASS");
  console.log("ADMIN_READ_DETAIL_QUERY_IGNORED=PASS");
  pass("ADMIN_READ_DETAIL_VALIDATION");
}

async function assertMethodBoundary(jar, fixture) {
  const list = await appPost("/api/v1/admin/reconciliation/items", { jar });
  const detail = await appPost(
    `/api/v1/admin/reconciliation/items/${fixture.reviewedItemId}`,
    { jar },
  );

  await assertUnsupportedMethod(list, "POST list unsupported");
  await assertUnsupportedMethod(detail, "POST detail unsupported");
  console.log("ADMIN_READ_METHOD_BOUNDARY=PASS");
  pass("ADMIN_READ_METHOD_BOUNDARY");
}

async function assertUnsupportedMethod(responsePromise, label) {
  const { response, text } = await responsePromise;

  assert(
    response.status === 405 || response.status === 404,
    label,
    "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
  );
  assert(!text.includes('"ok":true'), `${label} no ok true`);
  assertPublicTextSafe(text, label);
}

async function getList(jar, query = "") {
  return assertJsonOk(
    await appGet(`/api/v1/admin/reconciliation/items${query}`, { jar }),
    "list read",
  );
}

async function getDetail(jar, itemId) {
  return assertJsonOk(
    await appGet(`/api/v1/admin/reconciliation/items/${itemId}`, { jar }),
    "detail read",
  );
}

function assertListOrder(items, expectedIds, label) {
  assertDeepEqual(
    items.map((item) => item.reconciliationItemId),
    expectedIds,
    label,
  );

  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    const timeOrder = previous.itemCreatedAt.localeCompare(current.itemCreatedAt);

    assert(
      timeOrder > 0 ||
        (timeOrder === 0 &&
          previous.reconciliationItemId > current.reconciliationItemId),
      `${label} stable order`,
    );
  }
}

function assertListItemShape(items) {
  for (const item of items) {
    assert(isUuid(item.reconciliationItemId), "list item id");
    assert(isUuid(item.reconciliationRunId), "list run id");
    assert(isUuid(item.assetId), "list asset id");
    assert(isPlainRecord(item.asset), "list asset object");
    assert(typeof item.asset.assetCode === "string", "list asset code");
    assert(typeof item.asset.symbol === "string", "list asset symbol");
    assert(typeof item.asset.displayName === "string", "list asset display");
    assert(Number.isSafeInteger(item.asset.decimals), "list asset decimals");
    assertAtomicString(item.expectedUnits, "list expected");
    assertNullableAtomicString(item.observedUnits, "list observed");
    assertNullableSignedAtomicString(item.differenceUnits, "list difference");
    assertAtomicString(item.toleranceUnits, "list tolerance");
    for (const count of [
      item.targetBindingCount,
      item.observedBindingCount,
      item.missingBindingCount,
      item.failedBindingCount,
    ]) {
      assert(Number.isSafeInteger(count) && count >= 0, "list count safe integer");
    }
  }
}

function assertNoListProvenance(items) {
  for (const item of items) {
    assert(!("provenance" in item), "list no full provenance");
  }
}

function assertDetailBaseShape(detail) {
  assertPublicPayloadSafe(detail, "detail payload");
  assert(isPlainRecord(detail.run), "detail run");
  assert(isPlainRecord(detail.item), "detail item");
  assert(Array.isArray(detail.provenance), "detail provenance");
  assert(Array.isArray(detail.reviewEvents), "detail review events");
  assert(isUuid(detail.run.id), "detail run id");
  assert(isUuid(detail.item.id), "detail item id");
  assertAtomicString(detail.item.expectedUnits, "detail expected");
  assertNullableAtomicString(detail.item.observedUnits, "detail observed");
  assertNullableSignedAtomicString(detail.item.differenceUnits, "detail difference");
  assertAtomicString(detail.item.toleranceUnits, "detail tolerance");

  for (const entry of detail.provenance) {
    assert(isUuid(entry.custodyAccountBindingId), "detail provenance binding id");
    assert(typeof entry.providerCode === "string", "detail provider code");
    assert(typeof entry.providerDisplayName === "string", "detail provider display");
    assert(typeof entry.bindingLabel === "string", "detail binding label");
    assert(typeof entry.bindingRole === "string", "detail binding role");
    assert(typeof entry.membershipStatus === "string", "detail membership");
    assert(
      entry.externalBalanceObservationId === null ||
        isUuid(entry.externalBalanceObservationId),
      "detail observation id",
    );
    assertNullableAtomicString(entry.observedUnits, "detail provenance observed");
  }
}

function assertProvenanceCounts(item, expected, label) {
  assertDeepEqual(
    [
      item.targetBindingCount,
      item.observedBindingCount,
      item.missingBindingCount,
      item.failedBindingCount,
    ],
    expected,
    label,
  );
}

function findListItem(items, id) {
  const item = items.find((candidate) => candidate.reconciliationItemId === id);

  assert(Boolean(item), "list fixture item present");

  return item;
}

async function assertJsonOk(responsePromise, label) {
  const { response, payload, text } = await responsePromise;

  assert(
    response.status === 200,
    `${label} HTTP 200`,
    "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
  );
  assertNoStore(response, label);
  assertPublicTextSafe(text, label);
  assert(
    payload?.ok === true && isPlainRecord(payload.result),
    `${label} ok envelope`,
    "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
  );
  assertPublicPayloadSafe(payload, label);

  return payload;
}

async function assertJsonError(responsePromise, expectedStatus, expectedCode, label) {
  const { response, payload, text } = await responsePromise;

  assert(
    response.status === expectedStatus,
    `${label} HTTP ${expectedStatus}`,
    "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
  );
  assertNoStore(response, label);
  assertPublicTextSafe(text, label);
  assert(
    payload?.ok === false &&
      isPlainRecord(payload.error) &&
      payload.error.code === expectedCode &&
      Object.keys(payload.error).length === 1,
    `${label} public code`,
    "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
  );
  assertPublicPayloadSafe(payload, label);
}

function assertNoStore(response, label) {
  assert(
    response.headers.get("cache-control")?.toLowerCase().includes("no-store"),
    `${label} no-store`,
    "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
  );
}

function assertPublicTextSafe(text, label) {
  assertOutputSafe(text, label);

  const lowered = text.toLowerCase();

  for (const marker of PUBLIC_TEXT_DENYLIST) {
    assert(
      !lowered.includes(marker.toLowerCase()),
      `${label} no ${marker}`,
      "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT",
    );
  }
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

async function appPost(path, { jar } = {}) {
  return appFetch(path, { method: "POST", jar });
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

async function assertActiveAdminRoleCount(userId, expected, label) {
  const count = await sqlScalar(`
    select count(*)::text
    from public.user_roles
    where user_id = ${sqlUuid(userId)}
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === expected, label);
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

async function readSideEffectSnapshot(fixture) {
  const raw = await sqlScalar(`
    with fixture_items as (
      select unnest(array[
        ${fixture.items.map((item) => sqlUuid(item.id)).join(", ")}
      ]::uuid[]) as id
    ),
    source_digest as (
      select coalesce(md5(string_agg(
        runs.id::text || '|' ||
        runs.idempotency_key || '|' ||
        runs.trigger_source || '|' ||
        runs.status || '|' ||
        coalesce(runs.failure_code, '') || '|' ||
        coalesce(runs.observer_kind, '') || '|' ||
        coalesce(runs.observation_cutoff_at::text, '') || '|' ||
        items.id::text || '|' ||
        items.scope_kind || '|' ||
        items.asset_id::text || '|' ||
        items.expected_units::text || '|' ||
        coalesce(items.observed_units::text, '') || '|' ||
        coalesce(items.difference_units::text, '') || '|' ||
        items.tolerance_units::text || '|' ||
        items.classification,
        ',' order by items.id::text
      )), 'empty') as digest
      from private.reconciliation_items as items
      join private.reconciliation_runs as runs
        on runs.id = items.reconciliation_run_id
      where items.id in (select id from fixture_items)
    ),
    member_digest as (
      select coalesce(md5(string_agg(
        members.reconciliation_item_id::text || '|' ||
        members.custody_account_binding_id::text || '|' ||
        coalesce(members.external_balance_observation_id::text, '') || '|' ||
        members.membership_status,
        ',' order by members.reconciliation_item_id::text, members.custody_account_binding_id::text
      )), 'empty') as digest
      from private.reconciliation_item_binding_observations as members
      where members.reconciliation_item_id in (select id from fixture_items)
    ),
    review_digest as (
      select coalesce(md5(string_agg(
        cases.id::text || '|' ||
        cases.reconciliation_item_id::text || '|' ||
        cases.status || '|' ||
        cases.version::text || '|' ||
        events.event_version::text || '|' ||
        events.event_type || '|' ||
        coalesce(events.from_status, '') || '|' ||
        events.to_status || '|' ||
        events.reason_code,
        ',' order by cases.id::text, events.event_version
      )), 'empty') as digest
      from private.reconciliation_review_cases as cases
      left join private.reconciliation_review_case_events as events
        on events.reconciliation_resolution_id = cases.id
      where cases.reconciliation_item_id in (select id from fixture_items)
    )
    select
      (select digest from source_digest) || '||' ||
      (select digest from member_digest) || '||' ||
      (select digest from review_digest) || '||' ||
      (select count(*)::text from private.reconciliation_runs) || '||' ||
      (select count(*)::text from private.reconciliation_items) || '||' ||
      (select count(*)::text from private.reconciliation_item_binding_observations) || '||' ||
      (select count(*)::text from private.reconciliation_review_cases) || '||' ||
      (select count(*)::text from private.reconciliation_review_case_events) || '||' ||
      (select count(*)::text from private.external_balance_observations) || '||' ||
      (select count(*)::text from private.external_transaction_observations) || '||' ||
      (select count(*)::text from private.observer_checkpoints) || '||' ||
      (select count(*)::text from private.ledger_accounts) || '||' ||
      (select count(*)::text from private.ledger_journals) || '||' ||
      (select count(*)::text from private.ledger_entries) || '||' ||
      (select count(*)::text from private.ledger_account_balances);
  `);

  const [
    sourceDigest,
    memberDigest,
    reviewDigest,
    runs,
    items,
    members,
    cases,
    events,
    balanceObservations,
    transactionObservations,
    observerCheckpoints,
    ledgerAccounts,
    ledgerJournals,
    ledgerEntries,
    ledgerBalances,
  ] = raw.split("||");

  return {
    sourceDigest,
    memberDigest,
    reviewDigest,
    runs,
    items,
    members,
    cases,
    events,
    balanceObservations,
    transactionObservations,
    observerCheckpoints,
    ledgerAccounts,
    ledgerJournals,
    ledgerEntries,
    ledgerBalances,
  };
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

function assertAtomicString(value, label) {
  assert(typeof value === "string" && ATOMIC_UNITS_PATTERN.test(value), label);
}

function assertNullableAtomicString(value, label) {
  assert(value === null || (typeof value === "string" && ATOMIC_UNITS_PATTERN.test(value)), label);
}

function assertNullableSignedAtomicString(value, label) {
  assert(
    value === null ||
      (typeof value === "string" && SIGNED_ATOMIC_UNITS_PATTERN.test(value)),
    label,
  );
}

function assertDeepEqual(actual, expected, label, finalStatus = "REQUIRES_ACTION") {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  assert(actualJson === expectedJson, label, finalStatus);
}

function sqlUuid(value) {
  return `${sqlLiteral(value)}::uuid`;
}

function sqlNullableUuid(value) {
  return value === null ? "null" : sqlUuid(value);
}

function sqlTimestamp(value) {
  return `${sqlLiteral(value)}::timestamptz`;
}

function sqlNumeric(value) {
  return `${sqlLiteral(value)}::numeric`;
}

function sqlNullableNumeric(value) {
  return value === null ? "null" : sqlNumeric(value);
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
