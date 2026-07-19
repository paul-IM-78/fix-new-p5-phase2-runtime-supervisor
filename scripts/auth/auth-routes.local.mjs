import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const RECOVERY_SUBJECT = "Reset your Staking Wallet password";

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
  const email = `qa-${Date.now()}-${suffix.slice(0, 10)}@example.test`;
  const missingEmail = `missing-${Date.now()}-${suffix.slice(10, 20)}@example.test`;
  const password = `Old-${suffix.slice(0, 18)}-Password1!`;
  const newPassword = `New-${suffix.slice(8, 26)}-Password2!`;
  const unusedPassword = `Unused-${suffix.slice(4, 22)}-Password3!`;

  await assertPublicRoutes();
  await assertSameOriginRejections();

  const confirmationToken = await signUpAndConfirm(email, password);
  await assertAccountProvisioning(email);
  await assertLogoutAfterConfirmation(email, password);
  await assertResetEnumeration(email, missingEmail);

  const recoveryToken = await pollRecoveryToken(email);
  await assertRecoveryGetDoesNotConsumeToken(recoveryToken, email, password);
  await assertPasswordSessionCannotUpdate(email, password, newPassword);
  await assertOneShotPasswordUpdate(
    recoveryToken,
    email,
    password,
    newPassword,
    unusedPassword,
  );
  await assertTokenReuseBlocked(recoveryToken, email, newPassword);
  await assertAccountStatusMatrix(email, newPassword);

  await requestPasswordReset(email);
  const inactiveToken = await pollRecoveryToken(
    email,
    new Set([recoveryToken]),
  );
  await assertInactiveRecoveryBlocked(email, newPassword, inactiveToken);

  assert(confirmationToken.length >= 16, "Confirmation token shape");
  pass("Auth route integration");
}

async function assertPublicRoutes() {
  await assertStatus("/api/v1/health", 200, "Health 200");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness 200");
  await assertStatus("/auth/sign-up", 200, "Signup page 200");
  await assertStatus("/auth/sign-in", 200, "Sign-in page 200");
  await assertStatus(
    "/auth/forgot-password",
    200,
    "Forgot password page 200",
  );

  const account = await appFetch("/account", { redirect: "manual" });
  assertRedirectPath(
    account,
    "/auth/sign-in",
    "Unauthenticated account redirect",
  );
  pass("Public guard");
}

async function assertSameOriginRejections() {
  const before = await getMailpitMessageCount();
  const endpoints = [
    {
      path: "/api/v1/auth/password-reset/request",
      body: { email: "nobody@example.test" },
    },
    {
      path: "/api/v1/auth/password-reset/update",
      body: {
        token_hash: "x".repeat(32),
        type: "recovery",
        password: "BlockedPassword123!",
        password_confirm: "BlockedPassword123!",
      },
    },
  ];

  for (const endpoint of endpoints) {
    const noOrigin = await appFetch(endpoint.path, {
      method: "POST",
      body: endpoint.body,
      includeOrigin: false,
      redirect: "manual",
    });
    assertRedirectHasError(noOrigin, "request_rejected", "Origin required");

    const externalOrigin = await appFetch(endpoint.path, {
      method: "POST",
      body: endpoint.body,
      origin: "https://example.invalid",
      redirect: "manual",
    });
    assertRedirectHasError(
      externalOrigin,
      "request_rejected",
      "External origin rejected",
    );

    const badFetchSite = await appFetch(endpoint.path, {
      method: "POST",
      body: endpoint.body,
      fetchSite: "cross-site",
      redirect: "manual",
    });
    assertRedirectHasError(
      badFetchSite,
      "request_rejected",
      "Fetch site rejected",
    );
  }

  const after = await getMailpitMessageCount();
  assert(before === after, "Same-origin rejection has no email mutation");
  pass("Same-origin rejection");
}

async function signUpAndConfirm(email, password) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA User",
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

  assert(confirmationUrl.host === "localhost:3000", "Confirmation host");
  assert(confirmationUrl.pathname === "/auth/confirm", "Confirmation path");
  assert(Boolean(tokenHash), "Confirmation token present");
  assert(
    confirmationUrl.searchParams.get("type") === "email",
    "Confirmation type",
  );

  const getJar = new CookieJar();
  const getPage = await appFetch(
    `${confirmationUrl.pathname}${confirmationUrl.search}`,
    {
      jar: getJar,
      redirect: "manual",
    },
  );
  assert(getPage.status === 200, "Confirmation GET status");
  assert(!getJar.hasSessionCookie(), "Confirmation GET has no session");

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
  assertRedirectPath(confirm, "/auth/verified", "Confirmation POST redirect");

  const account = await appFetch("/account", {
    jar: confirmJar,
    redirect: "manual",
  });
  assert(account.status === 200, "Confirmed account 200");

  pass("Signup confirmation");

  return tokenHash;
}

async function assertAccountProvisioning(email) {
  const activeUserRoles = await sqlScalar(`
    select count(*)::text
    from public.user_roles as roles
    join auth.users as users on users.id = roles.user_id
    where users.email = ${sqlLiteral(email)}
      and roles.role = 'USER'
      and roles.revoked_at is null;
  `);
  const activeAdminRoles = await sqlScalar(`
    select count(*)::text
    from public.user_roles as roles
    join auth.users as users on users.id = roles.user_id
    where users.email = ${sqlLiteral(email)}
      and roles.role = 'ADMIN'
      and roles.revoked_at is null;
  `);
  const accountStatus = await sqlScalar(`
    select profiles.account_status
    from public.profiles as profiles
    join auth.users as users on users.id = profiles.id
    where users.email = ${sqlLiteral(email)};
  `);

  assert(accountStatus === "ACTIVE", "ACTIVE account status");
  assert(activeUserRoles === "1", "One USER role");
  assert(activeAdminRoles === "0", "Zero ADMIN roles");
  pass("Account provisioning");
}

async function assertLogoutAfterConfirmation(email, password) {
  const jar = await signIn(email, password);
  const logout = await appFetch("/api/v1/auth/sign-out", {
    method: "POST",
    jar,
    redirect: "manual",
  });
  assertRedirectPath(logout, "/auth/sign-in", "Logout redirect");

  const account = await appFetch("/account", {
    jar,
    redirect: "manual",
  });
  assertRedirectPath(account, "/auth/sign-in", "Logout account redirect");
  pass("Logout");
}

async function assertResetEnumeration(email, missingEmail) {
  const existing = await requestPasswordReset(email);
  const missing = await requestPasswordReset(missingEmail);

  assertRedirectPath(existing, "/auth/password-reset-sent", "Existing reset");
  assertRedirectPath(missing, "/auth/password-reset-sent", "Missing reset");
  pass("Reset enumeration");
}

async function requestPasswordReset(email) {
  return appFetch("/api/v1/auth/password-reset/request", {
    method: "POST",
    body: { email },
    redirect: "manual",
  });
}

async function pollRecoveryToken(email, excludedTokens = new Set()) {
  const recoveryLink = await pollMailpitLink(
    email,
    RECOVERY_SUBJECT,
    "/auth/recovery",
    excludedTokens,
  );
  const recoveryUrl = new URL(recoveryLink);
  const tokenHash = recoveryUrl.searchParams.get("token_hash");

  assert(recoveryUrl.host === "localhost:3000", "Recovery host");
  assert(recoveryUrl.pathname === "/auth/recovery", "Recovery path");
  assert(Boolean(tokenHash), "Recovery token present");
  assert(recoveryUrl.searchParams.get("type") === "recovery", "Recovery type");
  pass("Recovery email");

  return tokenHash;
}

async function assertRecoveryGetDoesNotConsumeToken(tokenHash, email, password) {
  const jar = new CookieJar();
  const page = await appFetch(
    `/auth/recovery?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`,
    {
      jar,
      redirect: "manual",
    },
  );
  const body = await page.text();
  const visibleText = getVisibleTextWithoutHiddenInputs(body);
  const links = extractLinks(body);

  assert(page.status === 200, "Recovery GET status");
  assert(!jar.hasSessionCookie(), "Recovery GET has no session cookie");
  assert(!visibleText.includes(tokenHash), "Recovery token not visible text");
  assert(
    !links.some((link) => link.includes(tokenHash)),
    "Recovery token not re-linked",
  );
  assert(body.includes('name="password"'), "Recovery password form");
  assert(
    body.includes('name="robots"') && body.includes("noindex"),
    "Recovery noindex",
  );
  assert(
    body.includes('name="referrer"') && body.includes("no-referrer"),
    "Recovery no-referrer",
  );

  const loginJar = await signIn(email, password);
  const logout = await appFetch("/api/v1/auth/sign-out", {
    method: "POST",
    jar: loginJar,
    redirect: "manual",
  });
  assertRedirectPath(logout, "/auth/sign-in", "Old password still valid");
  pass("Recovery GET non-consuming");
}

async function assertPasswordSessionCannotUpdate(email, password, newPassword) {
  const jar = await signIn(email, password);
  const missingToken = await appFetch("/api/v1/auth/password-reset/update", {
    method: "POST",
    jar,
    body: {
      type: "recovery",
      password: newPassword,
      password_confirm: newPassword,
    },
    redirect: "manual",
  });
  assertRedirectHasError(missingToken, "recovery_invalid", "Missing token");

  const fakeToken = await appFetch("/api/v1/auth/password-reset/update", {
    method: "POST",
    jar,
    body: {
      token_hash: "x".repeat(32),
      type: "recovery",
      password: newPassword,
      password_confirm: newPassword,
    },
    redirect: "manual",
  });
  assertRecoverySafeError(fakeToken, "Fake token");

  const wrongType = await appFetch("/api/v1/auth/password-reset/update", {
    method: "POST",
    jar,
    body: {
      token_hash: "x".repeat(32),
      type: "email",
      password: newPassword,
      password_confirm: newPassword,
    },
    redirect: "manual",
  });
  assertRedirectHasError(wrongType, "recovery_invalid", "Wrong token type");

  await appFetch("/api/v1/auth/sign-out", {
    method: "POST",
    jar,
    redirect: "manual",
  });

  await signIn(email, password);
  pass("Password session update blocked");
}

async function assertOneShotPasswordUpdate(
  tokenHash,
  email,
  oldPassword,
  newPassword,
  unusedPassword,
) {
  const shortPassword = await submitOneShotPassword(
    tokenHash,
    "A".repeat(11),
  );
  assertRedirectHasError(shortPassword, "password_policy", "Short password");

  const mismatch = await appFetch("/api/v1/auth/password-reset/update", {
    method: "POST",
    body: {
      token_hash: tokenHash,
      type: "recovery",
      password: unusedPassword,
      password_confirm: `${unusedPassword}!`,
    },
    redirect: "manual",
  });
  assertRedirectHasError(
    mismatch,
    "password_mismatch",
    "Password mismatch",
  );

  await signIn(email, oldPassword);
  const update = await submitOneShotPassword(tokenHash, newPassword);
  assertRedirectPath(update, "/auth/password-updated", "Password updated");

  const postUpdateJar = new CookieJar();
  postUpdateJar.store(update);
  const accountWithUpdateCookie = await appFetch("/account", {
    jar: postUpdateJar,
    redirect: "manual",
  });
  assertRedirectPath(
    accountWithUpdateCookie,
    "/auth/sign-in",
    "Global sign-out current cookie",
  );

  const oldLogin = await appFetch("/api/v1/auth/sign-in", {
    method: "POST",
    body: {
      email,
      password: oldPassword,
      next: "/account",
    },
    redirect: "manual",
  });
  assertRedirectHasError(oldLogin, "invalid_credentials", "Old password fails");

  const newJar = await signIn(email, newPassword);
  const account = await appFetch("/account", {
    jar: newJar,
    redirect: "manual",
  });
  assert(account.status === 200, "New password account 200");
  await appFetch("/api/v1/auth/sign-out", {
    method: "POST",
    jar: newJar,
    redirect: "manual",
  });

  pass("One-shot password update");
}

async function submitOneShotPassword(tokenHash, password) {
  return appFetch("/api/v1/auth/password-reset/update", {
    method: "POST",
    body: {
      token_hash: tokenHash,
      type: "recovery",
      password,
      password_confirm: password,
    },
    redirect: "manual",
  });
}

async function assertTokenReuseBlocked(tokenHash, email, currentPassword) {
  const reuse = await submitOneShotPassword(tokenHash, "ReusePassword123!");
  assertRecoverySafeError(reuse, "Token reuse blocked");

  await signIn(email, currentPassword);

  const reusedPasswordLogin = await appFetch("/api/v1/auth/sign-in", {
    method: "POST",
    body: {
      email,
      password: "ReusePassword123!",
      next: "/account",
    },
    redirect: "manual",
  });
  assertRedirectHasError(
    reusedPasswordLogin,
    "invalid_credentials",
    "Reuse did not change password",
  );
  pass("Token reuse blocked");
}

async function assertAccountStatusMatrix(email, password) {
  await updateAccountStatus(email, "ACTIVE");
  const activeJar = await signIn(email, password);
  const activeAccount = await appFetch("/account", {
    jar: activeJar,
    redirect: "manual",
  });
  assert(activeAccount.status === 200, "ACTIVE account");

  for (const status of ["RESTRICTED", "SUSPENDED", "WITHDRAWN"]) {
    await updateAccountStatus(email, status);
    const blocked = await appFetch("/api/v1/auth/sign-in", {
      method: "POST",
      body: {
        email,
        password,
        next: "/account",
      },
      redirect: "manual",
    });
    assertRedirectHasError(
      blocked,
      "account_restricted",
      `${status} sign-in blocked`,
    );
  }

  await updateAccountStatus(email, "ACTIVE");
  const existingJar = await signIn(email, password);
  const before = await appFetch("/account", {
    jar: existingJar,
    redirect: "manual",
  });
  assert(before.status === 200, "Existing session starts ACTIVE");

  await updateAccountStatus(email, "RESTRICTED");
  const after = await appFetch("/account", {
    jar: existingJar,
    redirect: "manual",
  });
  assertRedirectPath(after, "/auth/account-unavailable", "Status change guard");
  pass("Account status matrix");
}

async function assertInactiveRecoveryBlocked(email, password, tokenHash) {
  const blocked = await submitOneShotPassword(
    tokenHash,
    "RestrictedPassword123!",
  );
  assertRedirectHasError(blocked, "account_restricted", "Inactive recovery");

  await updateAccountStatus(email, "ACTIVE");
  await signIn(email, password);

  const blockedPassword = await appFetch("/api/v1/auth/sign-in", {
    method: "POST",
    body: {
      email,
      password: "RestrictedPassword123!",
      next: "/account",
    },
    redirect: "manual",
  });
  assertRedirectHasError(
    blockedPassword,
    "invalid_credentials",
    "Inactive recovery did not update password",
  );
  pass("Inactive recovery blocked");
}

async function signIn(email, password) {
  const jar = new CookieJar();
  const signInResponse = await appFetch("/api/v1/auth/sign-in", {
    method: "POST",
    jar,
    body: {
      email,
      password,
      next: "/account",
    },
    redirect: "manual",
  });
  assertRedirectPath(signInResponse, "/account", "Sign-in redirect");

  return jar;
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

async function getMailpitMessageCount() {
  const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
    redirect: "manual",
  });
  const payload = await response.json();

  return getMailpitMessages(payload).length;
}

async function pollMailpitLink(
  email,
  subject,
  expectedPath,
  excludedTokens = new Set(),
) {
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
          const tokenHash = url.searchParams.get("token_hash");

          return (
            url.pathname === expectedPath &&
            (!tokenHash || !excludedTokens.has(tokenHash))
          );
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

  throw new Error(`FAIL ${subject} mail`);
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

function getVisibleTextWithoutHiddenInputs(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(
      /<input\b(?=[^>]*name=["']token_hash["'])[^>]*>/gi,
      "",
    )
    .replace(/<[^>]+>/g, "");
}

async function updateAccountStatus(email, status) {
  const changed = await sqlScalar(`
    update public.profiles as profiles
    set account_status = ${sqlLiteral(status)}
    from auth.users as users
    where users.id = profiles.id
      and users.email = ${sqlLiteral(email)};

    select profiles.account_status
    from public.profiles as profiles
    join auth.users as users on users.id = profiles.id
    where users.email = ${sqlLiteral(email)};
  `);

  assert(changed === status, "Account status update");
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

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
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

function assertRedirectHasError(response, code, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const location = response.headers.get("location");
  const actual = location ? new URL(location, APP_ORIGIN) : null;
  const actualCode =
    actual?.searchParams.get("error") ?? actual?.searchParams.get("code");

  assert(Boolean(location), `${label} location`);
  assert(
    actualCode === code,
    `${label} code ${formatSafeRedirect(actual)}`,
  );
}

function assertRecoverySafeError(response, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const location = response.headers.get("location");
  const actual = location ? new URL(location, APP_ORIGIN) : null;
  const actualCode =
    actual?.searchParams.get("error") ?? actual?.searchParams.get("code");

  assert(Boolean(location), `${label} location`);
  assert(
    actualCode === "recovery_invalid" || actualCode === "recovery_expired",
    `${label} code ${formatSafeRedirect(actual)}`,
  );
}

function formatSafeRedirect(url) {
  if (!url) {
    return "missing";
  }

  const code = url.searchParams.get("error") ?? url.searchParams.get("code");

  return code ? `${url.pathname}?code=${code}` : url.pathname;
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
    console.error("FAIL auth route integration");
  }

  process.exitCode = 1;
});
