import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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
  await assertPreconditions();
  await runExistingRegressionScripts();
  await resetLocalDatabase("dashboard-e2e-reset");
  await assertDashboardE2e();
  await assertStaticDashboardBoundary();
  pass("Phase 2 closeout integration");
}

async function assertPreconditions() {
  assert(existsSync(".env.local"), ".env.local precondition");
  await assertStatus("/api/v1/health", 200, "Health precondition");
  await assertStatus(
    "/api/v1/readiness/config",
    200,
    "Readiness precondition",
  );
  await assertMailpitReady();
  await assertDatabaseReady();
  pass("Phase 2 closeout preconditions");
}

async function runExistingRegressionScripts() {
  const scripts = [
    ["test:auth:routes:local", "Auth route E2E"],
    ["test:auth:admin-mfa:local", "ADMIN MFA E2E"],
    ["test:auth:admin-roles:local", "ADMIN role command E2E"],
    ["test:domain:admin-lifecycle:local", "Domain lifecycle E2E"],
    ["test:domain:wallet-status:local", "Wallet status E2E"],
  ];

  for (const [scriptName, label] of scripts) {
    await resetLocalDatabase(`${label} reset`);
    await runNpmScript(scriptName, label);
  }
}

async function runNpmScript(scriptName, label) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      getNpmArgs(scriptName),
      {
        timeout: 180000,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
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

async function resetLocalDatabase(label) {
  await runNpmScriptWithoutReset("db:reset:local", label);
  await waitForLocalSupabaseReadiness(`${label} readiness`);
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

async function runNpmScriptWithoutReset(scriptName, label) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      getNpmArgs(scriptName),
      {
        timeout: 120000,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
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

async function assertDashboardE2e() {
  const suffix = randomUUID().replaceAll("-", "");
  const password = `Dashboard-${suffix.slice(0, 20)}-Password1!`;
  const email = `qa-dashboard-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const mint = randomBase58(44);

  await assertPublicDashboardRoutes();

  const jar = await signUpConfirmAndSignIn(email, password, "/dashboard");
  const userId = await readUserIdByEmail(email);
  let wallet = await readWalletByUserId(userId);

  await assertSafeRedirectRejections(email, password);
  await assertEmptyDashboard(jar);

  const fixture = await bootstrapDashboardCatalogRows(mint);
  await assertPopulatedDashboard(jar, fixture);

  await bootstrapAdminRole(userId);
  wallet = await transitionWalletStatusAsAdmin(
    userId,
    wallet,
    "FROZEN",
  );
  await assertWalletDashboardStatus(jar, "FROZEN");

  await transitionWalletStatusAsAdmin(userId, wallet, "CLOSED");
  await assertWalletDashboardStatus(jar, "CLOSED");

  await assertInactiveProfileAccess(jar, userId);
  await logout(jar);
  pass("Dashboard E2E");
}

async function assertPublicDashboardRoutes() {
  await assertStatus("/", 200, "Landing 200");
  await assertStatus("/auth/sign-in", 200, "Sign-in 200");
  await assertAuthRedirect("/dashboard", "/dashboard", "Dashboard redirect");
  await assertAuthRedirect("/catalog", "/catalog", "Catalog redirect");
  await assertAuthRedirect("/wallet", "/wallet", "Wallet redirect");
  pass("Dashboard public and anonymous routes");
}

async function assertSafeRedirectRejections(email, password) {
  const rejectedNextPaths = [
    "//evil.example",
    "https://evil.example",
    "\\evil",
    "/api/v1/health",
    "/admin/catalog",
    "/dashboard?next=https://evil.example",
  ];

  for (const nextPath of rejectedNextPaths) {
    const response = await signInRaw(email, password, nextPath);

    assertRedirectPath(response, "/account", "Unsafe next fallback");
  }

  pass("Safe redirect negative cases");
}

async function assertEmptyDashboard(jar) {
  const body = await readPageBody("/dashboard", jar, "Empty dashboard");

  assert(body.includes("Dashboard"), "Dashboard title");
  assert(body.includes("Profile status"), "Profile state");
  assert(body.includes("ACTIVE"), "Active profile and wallet");
  assert(body.includes("Managed wallet account"), "Managed wallet copy");
  assert(
    body.includes("현재 활성 프로젝트가 없습니다."),
    "Empty project state",
  );
  assert(
    body.includes("현재 프로젝트 토큰이 배정되지 않았습니다."),
    "Empty assignment state",
  );
  assert(!body.includes("DASH_ACTIVE_PROJECT"), "No fake project row");
  assert(!body.includes("DASH_ACTIVE_ASSET"), "No fake asset row");
  assertNoForbiddenFinancialUi(body, "Empty dashboard");
  assertNoSensitiveBody(body, "Empty dashboard");
  pass("Dashboard empty state");
}

async function assertPopulatedDashboard(jar, fixture) {
  const body = await readPageBody("/dashboard", jar, "Populated dashboard");

  assert(body.includes(fixture.projectCode), "Dashboard project code");
  assert(body.includes(fixture.projectName), "Dashboard project name");
  assert(body.includes(fixture.assetCode), "Dashboard asset code");
  assert(body.includes(fixture.assetSymbol), "Dashboard asset symbol");
  assert(body.includes(fixture.nativeAssetCode), "Dashboard native asset");
  assert(body.includes("Native asset"), "Dashboard native mint copy");
  assert(body.includes("Current project token"), "Current token section");
  assert(!body.includes(fixture.retiredAssetSymbol), "Retired hidden");
  assert(!body.includes(fixture.projectId), "Project UUID hidden");
  assert(!body.includes(fixture.assetId), "Asset UUID hidden");
  assert(!body.includes(fixture.assignmentId), "Assignment UUID hidden");
  assert(!body.includes(fixture.mint), "Full mint hidden");
  assertNoForbiddenFinancialUi(body, "Populated dashboard");
  assertNoSensitiveBody(body, "Populated dashboard");
  pass("Dashboard populated state");
}

async function assertWalletDashboardStatus(jar, status) {
  const body = await readPageBody("/dashboard", jar, `Dashboard ${status}`);

  assert(body.includes(status), `Dashboard ${status} status`);

  if (status === "FROZEN") {
    assert(body.includes("operational freeze"), "Frozen copy");
  }

  if (status === "CLOSED") {
    assert(body.includes("terminal"), "Closed terminal copy");
    assert(!body.toLowerCase().includes("reopen"), "No reopening copy");
  }

  assertNoForbiddenFinancialUi(body, `Dashboard ${status}`);
  assertNoSensitiveBody(body, `Dashboard ${status}`);
  pass(`Dashboard wallet ${status}`);
}

async function assertInactiveProfileAccess(jar, userId) {
  for (const status of ["RESTRICTED", "SUSPENDED", "WITHDRAWN"]) {
    await setProfileStatus(userId, status);
    await assertRedirectPathFromJar(
      "/dashboard",
      jar,
      "/auth/account-unavailable",
      `${status} dashboard`,
    );
    await assertRedirectPathFromJar(
      "/catalog",
      jar,
      "/auth/account-unavailable",
      `${status} catalog`,
    );
    await assertRedirectPathFromJar(
      "/wallet",
      jar,
      "/auth/account-unavailable",
      `${status} wallet`,
    );
    const rlsCounts = await readInactiveRlsCounts(userId);

    assert(rlsCounts.projects === 0, `${status} project RLS`);
    assert(rlsCounts.assets === 0, `${status} asset RLS`);
    assert(rlsCounts.assignments === 0, `${status} assignment RLS`);
    assert(rlsCounts.wallets === 0, `${status} wallet RLS`);
  }

  pass("Dashboard inactive profile blocking");
}

async function assertStaticDashboardBoundary() {
  const helper = readFileSync(
    "src/server/dashboard/current-dashboard.ts",
    "utf8",
  );
  const page = readFileSync("src/app/dashboard/page.tsx", "utf8");

  for (const forbidden of [
    "getSession(",
    "user_roles",
    "list_admin",
    "mfa",
    "aal",
    "service_role",
    "createBrowserClient",
  ]) {
    assert(!helper.includes(forbidden), `Dashboard helper no ${forbidden}`);
  }

  assert(
    helper.includes("inspectAccountAccess(supabase)"),
    "Dashboard helper account guard",
  );
  assert(
    helper.includes("!projectById.has") && helper.includes("!assetById.has"),
    "Dashboard helper relation fail closed",
  );
  assert(
    page.includes('redirect("/auth/sign-in?next=/dashboard")'),
    "Dashboard safe redirect",
  );
  assertNoForbiddenFinancialUi(page, "Dashboard source");
  pass("Dashboard static security boundary");
}

async function signUpConfirmAndSignIn(email, password, nextPath) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA Dashboard User",
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
      next: nextPath,
    },
    redirect: "manual",
  });

  assertRedirectPath(confirm, "/auth/verified", "Confirmation redirect");
  assertRedirectParam(confirm, "next", nextPath, "Confirmation next");
  await logout(confirmJar);

  return signIn(email, password, nextPath);
}

async function signIn(email, password, nextPath) {
  const response = await signInRaw(email, password, nextPath);

  assertRedirectPath(response, nextPath, "Sign-in redirect");
  assert(response.jar.hasSessionCookie(), "Sign-in session cookie");

  return response.jar;
}

async function signInRaw(email, password, nextPath) {
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

  response.jar = jar;

  return response;
}

async function logout(jar) {
  await appFetch("/api/v1/auth/sign-out", {
    method: "POST",
    jar,
    redirect: "manual",
  });
}

async function readPageBody(path, jar, label) {
  const response = await appFetch(path, { jar, redirect: "manual" });

  assert(response.status === 200, `${label} status`);

  return response.text();
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

async function pollMailpitLink(email, subject, expectedPath) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
      redirect: "manual",
    });
    const payload = await response.json();

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
          return new URL(candidate).pathname === expectedPath;
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

async function bootstrapDashboardCatalogRows(mint) {
  const projectId = randomUUID();
  const assetId = randomUUID();
  const nativeAssetId = randomUUID();
  const retiredAssetId = randomUUID();
  const assignmentId = randomUUID();
  const retiredAssignmentId = randomUUID();
  const projectCode = "DASH_ACTIVE_PROJECT";
  const projectName = "Dashboard Active Project";
  const assetCode = "DASH_ACTIVE_ASSET";
  const assetSymbol = "DQA";
  const nativeAssetCode = "DASH_NATIVE_ASSET";
  const retiredAssetSymbol = "DRT";

  const result = await sqlScalar(`
    insert into public.projects (
      id,
      project_code,
      display_name,
      description,
      status
    )
    values (
      ${sqlLiteral(projectId)}::uuid,
      ${sqlLiteral(projectCode)},
      ${sqlLiteral(projectName)},
      'Dashboard QA active project',
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
    values
      (
        ${sqlLiteral(assetId)}::uuid,
        ${sqlLiteral(assetCode)},
        ${sqlLiteral(assetSymbol)},
        'Dashboard QA Token',
        'SPL_TOKEN',
        6,
        ${sqlLiteral(mint)},
        'ACTIVE'
      ),
      (
        ${sqlLiteral(nativeAssetId)}::uuid,
        ${sqlLiteral(nativeAssetCode)},
        'DNT',
        'Dashboard Native QA Asset',
        'NATIVE',
        9,
        null,
        'ACTIVE'
      ),
      (
        ${sqlLiteral(retiredAssetId)}::uuid,
        'DASH_RETIRED_ASSET',
        ${sqlLiteral(retiredAssetSymbol)},
        'Dashboard Retired QA Token',
        'SPL_TOKEN',
        6,
        ${sqlLiteral(randomBase58(44))},
        'ACTIVE'
      );

    insert into public.project_token_assignments (
      id,
      project_id,
      asset_id
    )
    values (
      ${sqlLiteral(assignmentId)}::uuid,
      ${sqlLiteral(projectId)}::uuid,
      ${sqlLiteral(assetId)}::uuid
    );

    insert into public.project_token_assignments (
      id,
      project_id,
      asset_id,
      retired_at
    )
    values (
      ${sqlLiteral(retiredAssignmentId)}::uuid,
      ${sqlLiteral(projectId)}::uuid,
      ${sqlLiteral(retiredAssetId)}::uuid,
      clock_timestamp()
    );

    update public.supported_assets
    set status = 'ARCHIVED'
    where id = ${sqlLiteral(retiredAssetId)}::uuid;

    select count(*)::text
    from public.project_token_assignments
    where id = ${sqlLiteral(assignmentId)}::uuid
      and retired_at is null;
  `);

  assert(result === "1", "Dashboard catalog fixture");

  return {
    projectId,
    projectCode,
    projectName,
    assetId,
    assetCode,
    assetSymbol,
    nativeAssetCode,
    assignmentId,
    retiredAssetSymbol,
    mint,
  };
}

async function bootstrapAdminRole(userId) {
  const result = await sqlScalar(`
    insert into public.user_roles (user_id, role, grant_reason)
    values (${sqlLiteral(userId)}::uuid, 'ADMIN', 'local dashboard e2e')
    on conflict (user_id, role) where revoked_at is null do nothing;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(result === "1", "Dashboard admin bootstrap");
}

async function transitionWalletStatusAsAdmin(actorUserId, wallet, newStatus) {
  const payload = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(actorUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(actorUserId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;

    select json_build_object(
      'resultCode',
      result_code,
      'walletId',
      wallet_account_id::text,
      'targetUserId',
      target_user_id::text,
      'version',
      entity_version
    )::text
    from public.transition_wallet_account_status(
      ${sqlLiteral(wallet.id)}::uuid,
      ${Number(wallet.version)}::bigint,
      ${sqlLiteral(newStatus)},
      ${sqlLiteral(randomUUID())}::uuid,
      ${sqlLiteral(`dashboard ${newStatus.toLowerCase()}`)}
    );
  `);
  const result = parseJsonRow(payload, "Wallet transition result");

  assert(result.resultCode === "APPLIED", `Wallet ${newStatus} applied`);
  assert(result.walletId === wallet.id, `Wallet ${newStatus} id`);

  return readWalletByUserId(result.targetUserId);
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

async function readWalletByUserId(userId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', wallet_accounts.id::text,
      'userId', wallet_accounts.user_id::text,
      'status', wallet_accounts.status,
      'closedAt', wallet_accounts.closed_at,
      'version', wallet_accounts.version
    )::text
    from public.wallet_accounts
    where user_id = ${sqlLiteral(userId)}::uuid;
  `);

  return parseJsonRow(payload, "Wallet by user");
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

  assert(result === status, `Profile ${status}`);
}

async function readInactiveRlsCounts(userId) {
  const payload = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal1')::text,
      false
    );
    set role authenticated;

    select json_build_object(
      'projects', (select count(*) from public.projects),
      'assets', (select count(*) from public.supported_assets),
      'assignments', (select count(*) from public.project_token_assignments),
      'wallets', (select count(*) from public.wallet_accounts)
    )::text;
  `);

  return parseJsonRow(payload, "Inactive RLS counts");
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

  return stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

async function assertStatus(path, status, label) {
  const response = await appFetch(path, { redirect: "manual" });
  const body = await response.text();

  assert(response.status === status, label);
  assertNoSensitiveBody(body, label);
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

function isKongUpstreamReady(status) {
  return status >= 200 && status < 500;
}

async function assertAuthRedirect(path, nextPath, label) {
  const response = await appFetch(path, { redirect: "manual" });

  assertRedirectPath(response, "/auth/sign-in", label);
  assertRedirectParam(response, "next", nextPath, label);
}

async function assertRedirectPathFromJar(path, jar, expectedPath, label) {
  const response = await appFetch(path, { jar, redirect: "manual" });

  assertRedirectPath(response, expectedPath, label);
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

function assertRedirectParam(response, name, expected, label) {
  const actual = getRedirectUrl(response, label);

  assert(
    actual.searchParams.get(name) === expected,
    `${label} ${name} ${formatSafeRedirect(actual)}`,
  );
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

async function assertMailpitReady() {
  const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
    redirect: "manual",
  });

  assert(response.ok, "Mailpit precondition");
}

async function assertDatabaseReady() {
  const result = await sqlScalar("select 'ready';");

  assert(result === "ready", "Database precondition");
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

function getNpmArgs(scriptName) {
  assert(Boolean(NPM_EXEC_PATH), "npm exec path");

  return [NPM_EXEC_PATH, "--silent", "run", scriptName];
}

function assertNoSensitiveBody(body, label) {
  assert(!UUID_PATTERN.test(body), `${label} no uuid`);
  assert(!JWT_PATTERN.test(body), `${label} no jwt`);

  for (const marker of [
    "access_token",
    "refresh_token",
    "service_role",
    "private_key",
    "mnemonic",
    "seed phrase",
    "cookie",
    "auth metadata",
  ]) {
    assert(!body.toLowerCase().includes(marker), `${label} no ${marker}`);
  }
}

function assertNoForbiddenFinancialUi(body, label) {
  const lower = body.toLowerCase();

  for (const marker of [
    "available balance",
    "locked balance",
    "pending balance",
    "apy",
    "reward amount",
    "deposit address",
    "withdrawal address",
    "private key",
    "mnemonic",
    "seed phrase",
    "wallet connect",
    "phantom",
    "0 sol",
    "0%",
    "총 자산 0",
    "잔액 0",
    "예상 보상",
    "입금 가능",
    "출금 가능",
    "스테이킹 가능",
  ]) {
    assert(!lower.includes(marker), `${label} no ${marker}`);
  }
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

function parseJsonRow(payload, label) {
  assert(Boolean(payload), label);

  return JSON.parse(payload);
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

function formatSafeRedirect(url) {
  if (!url) {
    return "missing";
  }

  const code =
    url.searchParams.get("error") ??
    url.searchParams.get("code") ??
    url.searchParams.get("next");

  return code ? `${url.pathname}?result=${code}` : url.pathname;
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    new RegExp(`^${UUID_PATTERN.source}$`, "i").test(value)
  );
}

function randomBase58(length) {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * BASE58_ALPHABET.length);

    value += BASE58_ALPHABET[randomIndex];
  }

  return value;
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
    console.error("FAIL phase 2 closeout");
  }

  process.exitCode = 1;
});
