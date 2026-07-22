import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { createCookieJar } from "../lib/http-cookie-jar.mjs";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

async function main() {
  const suffix = randomUUID().replaceAll("-", "");
  const password = `Role-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-admin-role-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const targetBEmail = `qa-target-b-${Date.now()}-${suffix.slice(8, 16)}@example.test`;
  const targetCEmail = `qa-target-c-${Date.now()}-${suffix.slice(16, 24)}@example.test`;

  await assertPublicSmoke();
  await assertSameOriginRejectionsWithoutSession();

  const targetBJar = await signUpConfirmAndSignIn(
    targetBEmail,
    password,
    "/admin",
  );
  const targetCJar = await signUpConfirmAndSignIn(
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

  await bootstrapAdminRole(adminUserId);
  await assertGeneralUserBlocked(targetBJar, targetCUserId);
  await assertAal1AdminBlocked(adminJar, targetBUserId);

  const adminEnrollment = await enrollAndVerifyAdmin(adminJar);
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
  await assertInactiveAdminRevokeAllowed(adminJar, targetCUserId);

  const revoke = await assertRevokeApplied(
    adminJar,
    adminUserId,
    targetBUserId,
    targetBJar,
  );
  await assertRevokeReplay(adminJar, targetBUserId, revoke);
  await assertRevokeNoop(adminJar, targetBUserId);
  await assertSelfRevokeBlocked(adminJar, adminUserId);
  await assertAuditPage(adminJar, [adminEmail, targetBEmail, targetCEmail]);

  await logout(adminJar);
  const aal1AdminJar = await signIn(adminEmail, password, "/admin");
  await assertAal1AdminRequiresChallenge(aal1AdminJar);
  await assertGeneralUserBlocked(targetCJar, targetBUserId);
  await assertFactorSecretNotPrinted(adminEnrollment);

  pass("Admin role command integration");
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

async function enrollAndVerifyAdmin(jar) {
  const enrollment = await startEnrollment(jar);

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

async function assertInactiveAdminRevokeAllowed(jar, targetUserId) {
  const commandId = randomUUID();
  const reason = "local admin role inactive revoke";

  await updateAccountStatusByUserId(targetUserId, "RESTRICTED");

  const response = await submitRevoke(jar, targetUserId, commandId, reason);

  assertRedirectParam(response, "revoke", "applied", "Inactive revoke");
  assert((await activeAdminRoleCount(targetUserId)) === "0", "Inactive revoke role");
  await assertAuditEvent(commandId, "REVOKE_ADMIN", "APPLIED", reason);
  await updateAccountStatusByUserId(targetUserId, "ACTIVE");
  pass("Inactive ADMIN revoke allowed");
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

async function startEnrollment(jar) {
  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
  });
  const payload = await response.json();

  assert(response.status === 200, "Enrollment start status");
  assert(payload?.status === "enrollment_started", "Enrollment started");
  assert(isUuid(payload.factorId), "Enrollment factor id");
  assert(isBase32Secret(payload.secret), "Enrollment secret");

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

  const response = await fetch(requestUrl, {
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

  const response = await fetch(requestUrl, {
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
      await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
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
        await fetch(`${MAILPIT_ORIGIN}/view/${encodeURIComponent(id)}.html`, {
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

async function totalAuditCount() {
  return sqlScalar("select count(*)::text from private.admin_role_audit_events;");
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
  const actualCode =
    actual.searchParams.get("error") ?? actual.searchParams.get("code");

  assert(actualCode === code, `${label} code ${formatSafeRedirect(actual)}`);
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
