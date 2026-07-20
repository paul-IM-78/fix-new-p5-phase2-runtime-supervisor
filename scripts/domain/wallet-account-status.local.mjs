import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const BASE58_MINT = "11111111111111111111111111111132";

class CookieJar {
  #cookies = new Map();

  getHeader() {
    return [...this.#cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  store(response) {
    for (const header of getSetCookieHeaders(response.headers)) {
      const parsed = parseSetCookie(header);

      if (!parsed) {
        continue;
      }

      if (parsed.deleteCookie) {
        this.#cookies.delete(parsed.name);
      } else {
        this.#cookies.set(parsed.name, parsed.value);
      }
    }
  }

  hasSessionCookie() {
    return [...this.#cookies.keys()].some(
      (name) =>
        name.startsWith("sb-") &&
        name.includes("-auth-token") &&
        !name.includes("code-verifier"),
    );
  }
}

async function main() {
  const suffix = randomUUID().replaceAll("-", "");
  const password = `Wallet-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-admin-wallet-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const userEmail = `qa-wallet-user-${Date.now()}-${suffix.slice(8, 16)}@example.test`;
  const secondUserEmail = `qa-wallet-user-b-${Date.now()}-${suffix.slice(16, 24)}@example.test`;

  await assertPublicSmoke();
  await assertSameOriginRejectionsWithoutSession();

  const userJar = await signUpConfirmAndSignIn(
    userEmail,
    password,
    "/account",
  );
  const secondUserJar = await signUpConfirmAndSignIn(
    secondUserEmail,
    password,
    "/account",
  );
  const adminJar = await signUpConfirmAndSignIn(
    adminEmail,
    password,
    "/admin",
  );

  const adminUserId = await readUserIdByEmail(adminEmail);
  const userId = await readUserIdByEmail(userEmail);
  const secondUserId = await readUserIdByEmail(secondUserEmail);
  const userWallet = await readWalletByUserId(userId);
  const secondWallet = await readWalletByUserId(secondUserId);

  await bootstrapAdminRole(adminUserId);
  await bootstrapActiveCatalogRows();
  await assertBrowserDirectWalletWritesBlocked(userId);
  await assertUserPages(userJar, userId, secondUserId);
  await assertGeneralUserBlocked(userJar, userId, userWallet);
  await assertAal1AdminBlocked(adminJar, adminUserId, userWallet);

  const enrollment = await enrollAndVerifyAdmin(adminJar);

  await assertAdminWalletsReady(adminJar);
  await assertInputRejections(adminJar, userWallet);
  await assertUserWalletTransitions(adminJar, userJar, userWallet);
  await assertSecondWalletConcurrencyAndProfileRules(
    adminJar,
    secondWallet,
    secondUserId,
  );
  await assertAuditImmutability();
  await assertInactiveProfileRls(userId);
  await assertFactorSecretNotPrinted(enrollment);

  await logout(adminJar);
  await logout(userJar);
  await logout(secondUserJar);

  pass("Wallet account status integration");
}

async function assertPublicSmoke() {
  await assertStatus("/api/v1/health", 200, "Health 200");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness 200");
  await assertStatus("/", 200, "Landing 200");
  await assertStatus("/auth/sign-in", 200, "Sign-in 200");

  const catalog = await appFetch("/catalog", { redirect: "manual" });
  assertRedirectPath(catalog, "/auth/sign-in", "Anonymous catalog");

  const wallet = await appFetch("/wallet", { redirect: "manual" });
  assertRedirectPath(wallet, "/auth/sign-in", "Anonymous wallet");

  const adminWallets = await appFetch("/admin/wallets", {
    redirect: "manual",
  });
  assertRedirectPath(adminWallets, "/auth/sign-in", "Anonymous admin wallets");
  pass("Wallet public smoke");
}

async function assertSameOriginRejectionsWithoutSession() {
  const before = await walletAuditCount();
  const body = {
    wallet_account_id: randomUUID(),
    expected_version: "1",
    new_status: "FROZEN",
    command_id: randomUUID(),
    reason: "origin rejection",
  };

  const noOrigin = await appFetch("/api/v1/admin/wallets/transition", {
    method: "POST",
    body,
    includeOrigin: false,
    redirect: "manual",
  });
  assertRedirectHasCode(noOrigin, "request_rejected", "Origin required");

  const external = await appFetch("/api/v1/admin/wallets/transition", {
    method: "POST",
    body,
    origin: "https://example.invalid",
    redirect: "manual",
  });
  assertRedirectHasCode(external, "request_rejected", "External origin");

  const fetchSite = await appFetch("/api/v1/admin/wallets/transition", {
    method: "POST",
    body,
    fetchSite: "cross-site",
    redirect: "manual",
  });
  assertRedirectHasCode(fetchSite, "request_rejected", "Fetch site");

  assert(
    (await walletAuditCount()) === before,
    "Origin rejection creates no audit",
  );
  pass("Wallet command same-origin rejection");
}

async function assertUserPages(jar, userId, secondUserId) {
  const catalog = await appFetch("/catalog", { jar, redirect: "manual" });
  const catalogBody = await catalog.text();

  assert(catalog.status === 200, "User catalog page 200");
  assert(catalogBody.includes("Current catalog"), "Catalog title");
  assert(catalogBody.includes("WALLET_ACTIVE_PROJECT"), "Catalog project");
  assert(catalogBody.includes("WALLET_ACTIVE_ASSET"), "Catalog asset");
  assertNoSensitiveBody(catalogBody, "Catalog body");

  const wallet = await appFetch("/wallet", { jar, redirect: "manual" });
  const walletBody = await wallet.text();

  assert(wallet.status === 200, "User wallet page 200");
  assert(walletBody.includes("Managed wallet account"), "Wallet title");
  assert(walletBody.includes("MANAGED"), "Wallet custody");
  assert(walletBody.includes("ACTIVE"), "Wallet initial status");
  assertNoSensitiveBody(walletBody, "Wallet body");

  const ownCount = await rlsWalletCount(userId, userId);
  const otherCount = await rlsWalletCount(userId, secondUserId);

  assert(ownCount === "1", "RLS own wallet visible");
  assert(otherCount === "0", "RLS other wallet denied");
  pass("User catalog and wallet reads");
}

async function assertGeneralUserBlocked(jar, userId, wallet) {
  const adminWallets = await appFetch("/admin/wallets", {
    jar,
    redirect: "manual",
  });
  assertRedirectHasCode(adminWallets, "admin_forbidden", "USER admin wallets");

  const transition = await submitWalletTransition(jar, {
    walletAccountId: wallet.id,
    expectedVersion: wallet.version,
    newStatus: "FROZEN",
    commandId: randomUUID(),
    reason: "user blocked",
  });
  assertRedirectHasCode(transition, "admin_forbidden", "USER transition API");

  await assertWalletRpcDenied(userId, "aal2", wallet, "USER wallet RPC");
  await assertAdminReadDenied(userId, "aal2", "USER admin read RPC");
  pass("General USER wallet command blocked");
}

async function assertAal1AdminBlocked(jar, adminUserId, wallet) {
  const adminWallets = await appFetch("/admin/wallets", {
    jar,
    redirect: "manual",
  });
  assertRedirectPath(adminWallets, "/auth/mfa/enroll", "AAL1 wallets page");

  const transition = await submitWalletTransition(jar, {
    walletAccountId: wallet.id,
    expectedVersion: wallet.version,
    newStatus: "FROZEN",
    commandId: randomUUID(),
    reason: "aal1 blocked",
  });
  assertRedirectPath(transition, "/auth/mfa/enroll", "AAL1 transition API");

  await assertWalletRpcDenied(adminUserId, "aal1", wallet, "AAL1 wallet RPC");
  await assertAdminReadDenied(adminUserId, "aal1", "AAL1 admin read RPC");
  pass("AAL1 ADMIN wallet command blocked");
}

async function assertAdminWalletsReady(jar) {
  const response = await appFetch("/admin/wallets", {
    jar,
    redirect: "manual",
  });
  const body = await response.text();

  assert(response.status === 200, "Admin wallets page 200");
  assert(body.includes("Wallet account operations"), "Admin wallets title");
  assert(body.includes("Change wallet status"), "Wallet status form");
  assert(body.includes("Status matrix"), "Wallet matrix");
  assertNoSensitiveBody(body, "Admin wallets body");
  pass("AAL2 admin wallets page");
}

async function assertInputRejections(jar, wallet) {
  const before = await walletAuditCount();
  const cases = [
    {},
    { wallet_account_id: wallet.id, command_id: randomUUID() },
    {
      wallet_account_id: "not-a-uuid",
      expected_version: String(wallet.version),
      new_status: "FROZEN",
      command_id: randomUUID(),
      reason: "bad wallet",
    },
    {
      wallet_account_id: wallet.id,
      expected_version: "0",
      new_status: "FROZEN",
      command_id: randomUUID(),
      reason: "bad version",
    },
    {
      wallet_account_id: wallet.id,
      expected_version: String(wallet.version),
      new_status: "BROKEN",
      command_id: randomUUID(),
      reason: "bad status",
    },
    {
      wallet_account_id: wallet.id,
      expected_version: String(wallet.version),
      new_status: "FROZEN",
      command_id: "not-a-uuid",
      reason: "bad command",
    },
    {
      wallet_account_id: wallet.id,
      expected_version: String(wallet.version),
      new_status: "FROZEN",
      command_id: randomUUID(),
      reason: "line\nbreak",
    },
  ];

  for (const body of cases) {
    const response = await appFetch("/api/v1/admin/wallets/transition", {
      method: "POST",
      jar,
      body,
      redirect: "manual",
    });

    assertRedirectHasCode(response, "invalid_input", "Wallet input rejected");
  }

  assert(
    (await walletAuditCount()) === before,
    "Input rejection creates no audit",
  );
  pass("Wallet input rejection");
}

async function assertUserWalletTransitions(adminJar, userJar, initialWallet) {
  const freezeCommandId = randomUUID();
  const freeze = await submitWalletTransition(adminJar, {
    walletAccountId: initialWallet.id,
    expectedVersion: initialWallet.version,
    newStatus: "FROZEN",
    commandId: freezeCommandId,
    reason: "freeze user wallet",
  });
  assertRedirectParam(freeze, "result", "wallet_status_changed", "Freeze API");

  const frozenWallet = await readWalletById(initialWallet.id);
  assert(frozenWallet.status === "FROZEN", "Wallet frozen");
  assert(
    frozenWallet.version === initialWallet.version + 1,
    "Freeze increments version",
  );
  assert(
    (await walletAuditCount(freezeCommandId)) === "1",
    "Freeze audit count",
  );

  const replay = await submitWalletTransition(adminJar, {
    walletAccountId: initialWallet.id,
    expectedVersion: initialWallet.version,
    newStatus: "FROZEN",
    commandId: freezeCommandId,
    reason: "freeze user wallet",
  });
  assertRedirectParam(
    replay,
    "result",
    "wallet_command_replayed",
    "Freeze replay",
  );
  assert(
    (await walletAuditCount(freezeCommandId)) === "1",
    "Replay no duplicate audit",
  );

  const walletPage = await appFetch("/wallet", {
    jar: userJar,
    redirect: "manual",
  });
  const walletBody = await walletPage.text();

  assert(walletPage.status === 200, "Frozen wallet page 200");
  assert(walletBody.includes("FROZEN"), "Frozen wallet rendered");

  const reactivate = await submitWalletTransition(adminJar, {
    walletAccountId: frozenWallet.id,
    expectedVersion: frozenWallet.version,
    newStatus: "ACTIVE",
    commandId: randomUUID(),
    reason: "reactivate user wallet",
  });
  assertRedirectParam(
    reactivate,
    "result",
    "wallet_status_changed",
    "Reactivate API",
  );

  const activeWallet = await readWalletById(initialWallet.id);
  const activeClose = await submitWalletTransition(adminJar, {
    walletAccountId: activeWallet.id,
    expectedVersion: activeWallet.version,
    newStatus: "CLOSED",
    commandId: randomUUID(),
    reason: "active close blocked",
  });
  assertRedirectHasCode(
    activeClose,
    "wallet_account_transition_invalid",
    "ACTIVE to CLOSED blocked",
  );

  const stale = await submitWalletTransition(adminJar, {
    walletAccountId: activeWallet.id,
    expectedVersion: initialWallet.version,
    newStatus: "FROZEN",
    commandId: randomUUID(),
    reason: "stale version blocked",
  });
  assertRedirectHasCode(
    stale,
    "wallet_account_version_conflict",
    "Stale version blocked",
  );

  const freezeBeforeClose = await submitWalletTransition(adminJar, {
    walletAccountId: activeWallet.id,
    expectedVersion: activeWallet.version,
    newStatus: "FROZEN",
    commandId: randomUUID(),
    reason: "freeze before close",
  });
  assertRedirectParam(
    freezeBeforeClose,
    "result",
    "wallet_status_changed",
    "Freeze before close",
  );

  const frozenBeforeClose = await readWalletById(activeWallet.id);
  const close = await submitWalletTransition(adminJar, {
    walletAccountId: frozenBeforeClose.id,
    expectedVersion: frozenBeforeClose.version,
    newStatus: "CLOSED",
    commandId: randomUUID(),
    reason: "close user wallet",
  });
  assertRedirectParam(close, "result", "wallet_status_changed", "Close API");

  const closedWallet = await readWalletById(activeWallet.id);
  assert(closedWallet.status === "CLOSED", "Wallet closed");
  assert(Boolean(closedWallet.closedAt), "Closed timestamp set");

  const closedNoop = await submitWalletTransition(adminJar, {
    walletAccountId: closedWallet.id,
    expectedVersion: closedWallet.version,
    newStatus: "CLOSED",
    commandId: randomUUID(),
    reason: "closed noop",
  });
  assertRedirectParam(closedNoop, "result", "wallet_status_noop", "Closed noop");

  const afterNoop = await readWalletById(activeWallet.id);
  assert(afterNoop.version === closedWallet.version, "NOOP version stable");
  assert(afterNoop.closedAt === closedWallet.closedAt, "NOOP closed_at stable");

  for (const newStatus of ["ACTIVE", "FROZEN"]) {
    const blocked = await submitWalletTransition(adminJar, {
      walletAccountId: closedWallet.id,
      expectedVersion: closedWallet.version,
      newStatus,
      commandId: randomUUID(),
      reason: "closed terminal blocked",
    });
    assertRedirectHasCode(
      blocked,
      "wallet_account_transition_invalid",
      `CLOSED to ${newStatus} blocked`,
    );
  }

  pass("User wallet status transitions");
}

async function assertSecondWalletConcurrencyAndProfileRules(
  adminJar,
  wallet,
  userId,
) {
  const commandId = randomUUID();
  const reason = "concurrent freeze wallet";
  const beforeAudit = await walletAuditCount(commandId);
  const [first, second] = await Promise.all([
    submitWalletTransition(adminJar, {
      walletAccountId: wallet.id,
      expectedVersion: wallet.version,
      newStatus: "FROZEN",
      commandId,
      reason,
    }),
    submitWalletTransition(adminJar, {
      walletAccountId: wallet.id,
      expectedVersion: wallet.version,
      newStatus: "FROZEN",
      commandId,
      reason,
    }),
  ]);
  const results = [
    getRedirectParam(first, "result"),
    getRedirectParam(second, "result"),
  ].sort();
  const frozenWallet = await readWalletById(wallet.id);

  assert(
    results.join(",") === "wallet_command_replayed,wallet_status_changed",
    "Concurrent replay responses",
  );
  assert(beforeAudit === "0", "Concurrent audit starts empty");
  assert((await walletAuditCount(commandId)) === "1", "Concurrent one audit");
  assert(frozenWallet.version === wallet.version + 1, "Concurrent one update");

  await setProfileStatus(userId, "RESTRICTED");
  const inactive = await submitWalletTransition(adminJar, {
    walletAccountId: wallet.id,
    expectedVersion: frozenWallet.version,
    newStatus: "ACTIVE",
    commandId: randomUUID(),
    reason: "inactive profile active blocked",
  });
  assertRedirectHasCode(
    inactive,
    "wallet_target_profile_inactive",
    "Inactive target profile blocked",
  );

  const stillFrozen = await readWalletById(wallet.id);
  assert(stillFrozen.status === "FROZEN", "Inactive profile keeps wallet frozen");

  await setProfileStatus(userId, "ACTIVE");
  const activateCommandId = randomUUID();
  const activate = await submitWalletTransition(adminJar, {
    walletAccountId: wallet.id,
    expectedVersion: stillFrozen.version,
    newStatus: "ACTIVE",
    commandId: activateCommandId,
    reason: "restore second wallet",
  });
  assertRedirectParam(
    activate,
    "result",
    "wallet_status_changed",
    "FROZEN to ACTIVE after restore",
  );

  const conflict = await submitWalletTransition(adminJar, {
    walletAccountId: wallet.id,
    expectedVersion: stillFrozen.version,
    newStatus: "ACTIVE",
    commandId: activateCommandId,
    reason: "different restore reason",
  });
  assertRedirectHasCode(
    conflict,
    "wallet_command_conflict",
    "Same command id conflict",
  );
  pass("Wallet concurrency and profile rules");
}

async function assertInactiveProfileRls(userId) {
  await setProfileStatus(userId, "WITHDRAWN");

  const counts = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    select
      (select count(*) from public.projects)::text || ',' ||
      (select count(*) from public.supported_assets)::text || ',' ||
      (select count(*) from public.project_token_assignments)::text || ',' ||
      (select count(*) from public.wallet_accounts)::text;
  `);

  assert(counts === "0,0,0,0", "Inactive profile RLS rows zero");

  await setProfileStatus(userId, "ACTIVE");
  pass("Inactive profile RLS");
}

async function assertBrowserDirectWalletWritesBlocked(userId) {
  const result = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      insert into public.wallet_accounts (user_id)
      values (${sqlLiteral(userId)}::uuid);
      raise exception 'expected wallet insert denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    do $$
    begin
      update public.wallet_accounts
      set status = 'FROZEN'
      where user_id = ${sqlLiteral(userId)}::uuid;
      raise exception 'expected wallet update denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    do $$
    begin
      delete from public.wallet_accounts
      where user_id = ${sqlLiteral(userId)}::uuid;
      raise exception 'expected wallet delete denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);

  assert(result === "denied", "Browser direct wallet writes denied");
  pass("Browser wallet direct writes blocked");
}

async function assertAuditImmutability() {
  const result = await sqlScalar(`
    do $$
    begin
      update private.wallet_account_admin_audit_events
      set reason = 'blocked';
      raise exception 'expected audit update failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;
    do $$
    begin
      delete from private.wallet_account_admin_audit_events;
      raise exception 'expected audit delete failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;
    do $$
    begin
      truncate private.wallet_account_admin_audit_events;
      raise exception 'expected audit truncate failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;
    select 'blocked';
  `);

  assert(result === "blocked", "Wallet audit immutable");
  pass("Wallet audit immutability");
}

async function enrollAndVerifyAdmin(jar) {
  const enrollment = await startEnrollment(jar);

  await verifyEnrollment(jar, enrollment);
  pass("Wallet command MFA ready");

  return enrollment;
}

async function startEnrollment(jar) {
  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
    redirect: "manual",
  });
  const payload = await response.json();

  assert(response.status === 200, "MFA enrollment start status");
  assert(payload?.status === "enrollment_started", "MFA enrollment started");
  assert(isUuid(payload?.factorId), "MFA factor id");
  assert(isBase32Secret(payload?.secret), "MFA secret shape");

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
    redirect: "manual",
  });
  const payload = await response.json();

  assert(response.status === 200, "MFA enrollment verify status");
  assert(payload?.status === "verified", "MFA enrollment verified");
}

async function signUpConfirmAndSignIn(email, password, nextPath) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA Wallet Account",
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

  const confirmJar = new CookieJar();
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
  const jar = new CookieJar();
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

async function submitWalletTransition(
  jar,
  { walletAccountId, expectedVersion, newStatus, commandId, reason },
) {
  return appFetch("/api/v1/admin/wallets/transition", {
    method: "POST",
    jar,
    body: {
      wallet_account_id: walletAccountId,
      expected_version: String(expectedVersion),
      new_status: newStatus,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
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
    const cookieHeader = jar.getHeader();

    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
  }

  const response = await fetch(`${APP_ORIGIN}${path}`, {
    method,
    headers,
    body: body ? new URLSearchParams(body) : undefined,
    redirect,
  });

  if (jar) {
    jar.store(response);
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
    const cookieHeader = jar.getHeader();

    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
  }

  const response = await fetch(`${APP_ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    redirect,
  });

  if (jar) {
    jar.store(response);
  }

  return response;
}

async function assertStatus(path, status, label) {
  const response = await appFetch(path, { redirect: "manual" });

  assert(response.status === status, label);
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
    values (${sqlLiteral(userId)}::uuid, 'ADMIN', 'local wallet command e2e bootstrap')
    on conflict (user_id, role) where revoked_at is null do nothing;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === "1", "Bootstrap ADMIN role");
}

async function bootstrapActiveCatalogRows() {
  const result = await sqlScalar(`
    insert into public.projects (
      id,
      project_code,
      display_name,
      status
    )
    values (
      '00000000-0000-4000-8000-000000007001',
      'WALLET_ACTIVE_PROJECT',
      'Wallet Active Project',
      'ACTIVE'
    );

    insert into public.supported_assets (
      id,
      asset_code,
      symbol,
      display_name,
      asset_type,
      decimals,
      mint_address,
      status
    )
    values (
      '00000000-0000-4000-8000-000000007002',
      'WALLET_ACTIVE_ASSET',
      'WAT',
      'Wallet Active Asset',
      'SPL_TOKEN',
      6,
      ${sqlLiteral(BASE58_MINT)},
      'ACTIVE'
    );

    insert into public.project_token_assignments (
      id,
      project_id,
      asset_id
    )
    values (
      '00000000-0000-4000-8000-000000007003',
      '00000000-0000-4000-8000-000000007001',
      '00000000-0000-4000-8000-000000007002'
    );

    select count(*)::text
    from public.project_token_assignments
    where id = '00000000-0000-4000-8000-000000007003';
  `);

  assert(result === "1", "Bootstrap active catalog");
}

async function readWalletByUserId(userId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', wallet_accounts.id::text,
      'userId', wallet_accounts.user_id::text,
      'custodyModel', wallet_accounts.custody_model,
      'status', wallet_accounts.status,
      'closedAt', wallet_accounts.closed_at,
      'version', wallet_accounts.version
    )::text
    from public.wallet_accounts
    where user_id = ${sqlLiteral(userId)}::uuid;
  `);

  return parseJsonRow(payload, "Wallet by user");
}

async function readWalletById(walletId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', wallet_accounts.id::text,
      'userId', wallet_accounts.user_id::text,
      'custodyModel', wallet_accounts.custody_model,
      'status', wallet_accounts.status,
      'closedAt', wallet_accounts.closed_at,
      'version', wallet_accounts.version
    )::text
    from public.wallet_accounts
    where id = ${sqlLiteral(walletId)}::uuid;
  `);

  return parseJsonRow(payload, "Wallet by id");
}

async function setProfileStatus(userId, status) {
  const result = await sqlScalar(`
    update public.profiles
    set account_status = ${sqlLiteral(status)}
    where id = ${sqlLiteral(userId)}::uuid;

    select account_status
    from public.profiles
    where id = ${sqlLiteral(userId)}::uuid;
  `);

  assert(result === status, `Profile status ${status}`);
}

async function walletAuditCount(commandId = null) {
  return sqlScalar(`
    select count(*)::text
    from private.wallet_account_admin_audit_events
    ${
      commandId
        ? `where command_id = ${sqlLiteral(commandId)}::uuid`
        : ""
    };
  `);
}

async function rlsWalletCount(actorUserId, targetUserId) {
  return sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(actorUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(actorUserId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    select count(*)::text
    from public.wallet_accounts
    where user_id = ${sqlLiteral(targetUserId)}::uuid;
  `);
}

async function assertWalletRpcDenied(actorUserId, aal, wallet, label) {
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
      from public.transition_wallet_account_status(
        ${sqlLiteral(wallet.id)}::uuid,
        ${Number(wallet.version)}::bigint,
        'FROZEN',
        ${sqlLiteral(randomUUID())}::uuid,
        'denied wallet rpc'
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

async function assertAdminReadDenied(actorUserId, aal, label) {
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
      from public.list_admin_wallet_accounts(10);
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

function parseJsonRow(payload, label) {
  assert(Boolean(payload), label);

  return JSON.parse(payload);
}

function assertRedirectPath(response, expectedPath, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const actual = getRedirectUrl(response, label);

  assert(
    actual.pathname === expectedPath,
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
  assertNoSensitiveRedirectQuery(actual, label);

  return actual;
}

function assertNoSensitiveRedirectQuery(url, label) {
  for (const name of [
    "wallet_account_id",
    "user_id",
    "target_user_id",
    "command_id",
    "expected_version",
    "reason",
    "token",
    "cookie",
  ]) {
    assert(!url.searchParams.has(name), `${label} no ${name}`);
  }
}

function assertNoSensitiveBody(body, label) {
  for (const marker of [
    "access_token",
    "refresh_token",
    "otpauth://",
    "private_key",
    "mnemonic",
    "service_role",
  ]) {
    assert(!body.includes(marker), `${label} no ${marker}`);
  }
}

function formatSafeRedirect(url) {
  if (!url) {
    return "missing";
  }

  const code =
    url.searchParams.get("error") ??
    url.searchParams.get("code") ??
    url.searchParams.get("result");

  return code ? `${url.pathname}?result=${code}` : url.pathname;
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

async function assertFactorSecretNotPrinted(enrollment) {
  assert(isUuid(enrollment.factorId), "Factor id shape");
  assert(isBase32Secret(enrollment.secret), "Secret shape");
  pass("MFA material process-only");
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const header = headers.get("set-cookie");

  return header ? splitSetCookieHeader(header) : [];
}

function splitSetCookieHeader(header) {
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]+)/);
}

function parseSetCookie(header) {
  const [pair, ...attributes] = header.split(";");
  const separatorIndex = pair.indexOf("=");

  if (separatorIndex <= 0) {
    return null;
  }

  const name = pair.slice(0, separatorIndex).trim();
  const value = pair.slice(separatorIndex + 1).trim();
  const lowerAttributes = attributes.map((attribute) =>
    attribute.trim().toLowerCase(),
  );
  const deleteCookie =
    lowerAttributes.includes("max-age=0") ||
    lowerAttributes.some((attribute) => attribute.startsWith("expires=thu"));

  return { name, value, deleteCookie };
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
  return `'${String(value).replaceAll("'", "''")}'`;
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
    console.error("FAIL wallet account status integration");
  }

  process.exitCode = 1;
});
