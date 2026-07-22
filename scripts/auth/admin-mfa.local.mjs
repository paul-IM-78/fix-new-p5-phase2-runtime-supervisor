import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { createCookieJar } from "../lib/http-cookie-jar.mjs";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";

async function main() {
  const suffix = randomUUID().replaceAll("-", "");
  const userEmail = `qa-admin-user-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const adminEmail = `qa-admin-mfa-${Date.now()}-${suffix.slice(8, 16)}@example.test`;
  const password = `Admin-${suffix.slice(0, 20)}-Password1!`;

  await assertPublicAdminSmoke();
  await assertSameOriginRejectionsWithoutSession();

  const userJar = await signUpConfirmAndSignIn(userEmail, password, "/admin");
  await assertGeneralUserBlocked(userJar);

  const adminJar = await signUpConfirmAndSignIn(
    adminEmail,
    password,
    "/admin",
  );
  await grantAdminRole(adminEmail);
  await assertAdminRpcByEmail(adminEmail, "aal1", true, false);
  await assertFirstAdminAccessRequiresEnrollment(adminJar);
  await assertEnrollmentGetHasNoMutation(adminEmail, adminJar);

  const firstEnrollment = await startEnrollment(adminJar);
  await assertFactorCounts(adminEmail, {
    verified: "0",
    unverified: "1",
    total: "1",
  });

  const secondEnrollment = await startEnrollment(adminJar);
  assert(
    firstEnrollment.factorId !== secondEnrollment.factorId,
    "Enrollment restart replaces factor",
  );
  await assertFactorCounts(adminEmail, {
    verified: "0",
    unverified: "1",
    total: "1",
  });

  await assertEnrollmentVerifyInputRejections(adminJar, secondEnrollment);
  await assertEnrollmentFactorTamper(adminEmail, adminJar, secondEnrollment);
  await verifyEnrollment(adminJar, secondEnrollment);
  await assertFactorCounts(adminEmail, {
    verified: "1",
    unverified: "0",
    total: "1",
  });
  await assertAdminRpcByEmail(adminEmail, "aal2", true, true);
  await assertAdminPageReady(adminJar);

  await logout(adminJar);
  const reloginJar = await signIn(adminEmail, password, "/admin");
  await assertReloginRequiresChallenge(reloginJar);
  await assertChallengeInputRejections(reloginJar);
  await assertWrongChallengeCode(reloginJar);
  await verifyChallenge(reloginJar, secondEnrollment.secret);
  await assertAdminPageReady(reloginJar);

  await revokeAdminRole(adminEmail);
  await assertAdminForbidden(reloginJar, "Role revoke blocks admin");

  await grantAdminRole(adminEmail);
  await assertAccountStatusMatrix(adminEmail, reloginJar);

  pass("Admin MFA integration");
}

async function assertPublicAdminSmoke() {
  await assertStatus("/api/v1/health", 200, "Health 200");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness 200");
  await assertStatus("/", 200, "Landing 200");
  await assertStatus("/auth/sign-in", 200, "Sign-in 200");

  const account = await appFetch("/account", { redirect: "manual" });
  assertRedirectPath(account, "/auth/sign-in", "Anonymous account");

  const admin = await appFetch("/admin", { redirect: "manual" });
  assertRedirectPath(admin, "/auth/sign-in", "Anonymous admin");

  const enroll = await appFetch("/auth/mfa/enroll", {
    redirect: "manual",
  });
  assertRedirectPath(enroll, "/auth/sign-in", "Anonymous enroll");

  const challenge = await appFetch("/auth/mfa/challenge", {
    redirect: "manual",
  });
  assertRedirectPath(challenge, "/auth/sign-in", "Anonymous challenge");
  pass("Public admin smoke");
}

async function assertSameOriginRejectionsWithoutSession() {
  const before = await totalMfaFactorCount();
  const endpoints = [
    {
      kind: "json",
      path: "/api/v1/auth/mfa/enroll/start",
      body: {},
    },
    {
      kind: "json",
      path: "/api/v1/auth/mfa/enroll/verify",
      body: {
        factor_id: randomUUID(),
        code: "000000",
      },
    },
    {
      kind: "form",
      path: "/api/v1/auth/mfa/challenge",
      body: {
        factor_id: randomUUID(),
        code: "000000",
        next: "/admin",
      },
    },
  ];

  for (const endpoint of endpoints) {
    const noOrigin = await requestEndpoint(endpoint, {
      includeOrigin: false,
    });
    await assertRejected(noOrigin, "request_rejected", "Origin required");

    const external = await requestEndpoint(endpoint, {
      origin: "https://example.invalid",
    });
    await assertRejected(external, "request_rejected", "External origin");

    const fetchSite = await requestEndpoint(endpoint, {
      fetchSite: "cross-site",
    });
    await assertRejected(fetchSite, "request_rejected", "Fetch site");
  }

  const after = await totalMfaFactorCount();
  assert(before === after, "Same-origin rejection has no MFA mutation");
  pass("Same-origin rejection");
}

async function assertGeneralUserBlocked(jar) {
  const admin = await appFetch("/admin", { jar, redirect: "manual" });
  assertRedirectHasCode(admin, "admin_forbidden", "USER admin blocked");

  const start = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
  });
  await assertJsonCode(start, "admin_forbidden", "USER enroll blocked");

  const challenge = await appFetch("/api/v1/auth/mfa/challenge", {
    method: "POST",
    jar,
    body: {
      factor_id: randomUUID(),
      code: "000000",
      next: "/admin",
    },
    redirect: "manual",
  });
  assertRedirectHasCode(challenge, "admin_forbidden", "USER challenge");
  pass("General USER blocked");
}

async function assertFirstAdminAccessRequiresEnrollment(jar) {
  const admin = await appFetch("/admin", { jar, redirect: "manual" });
  assertRedirectPath(admin, "/auth/mfa/enroll", "AAL1 admin enroll");
  pass("Admin AAL1 requires enrollment");
}

async function assertEnrollmentGetHasNoMutation(email, jar) {
  const before = await mfaFactorCounts(email);
  const enroll = await appFetch("/auth/mfa/enroll", {
    jar,
    redirect: "manual",
  });
  const body = await enroll.text();
  const after = await mfaFactorCounts(email);

  assert(enroll.status === 200, "Enrollment GET status");
  assert(!body.includes("otpauth://"), "Enrollment GET has no secret");
  assert(before.total === after.total, "Enrollment GET no factor mutation");
  assert(before.verified === after.verified, "Enrollment GET no verify");
  assert(before.unverified === after.unverified, "Enrollment GET no enroll");
  pass("Enrollment GET non-mutating");
}

async function startEnrollment(jar) {
  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
  });
  const payload = await response.json();

  assert(
    response.status === 200,
    `Enrollment start status ${response.status}:${payload?.code ?? "none"}`,
  );
  assert(payload?.status === "enrollment_started", "Enrollment started");
  assert(isUuid(payload.factorId), "Enrollment factor id shape");
  assert(
    typeof payload.qrCode === "string" &&
      payload.qrCode.startsWith("data:image/") &&
      payload.qrCode.length < 500000,
    "Enrollment QR data",
  );
  assert(isBase32Secret(payload.secret), "Enrollment secret shape");
  pass("Enrollment start");

  return {
    factorId: payload.factorId,
    secret: payload.secret,
  };
}

async function assertEnrollmentVerifyInputRejections(jar, enrollment) {
  const cases = [
    {},
    { factor_id: "", code: "000000" },
    { factor_id: "not-a-uuid", code: "000000" },
    { factor_id: `${randomUUID()}\n`, code: "000000" },
    { factor_id: `${"a".repeat(80)}`, code: "000000" },
    { factor_id: enrollment.factorId, code: "" },
    { factor_id: enrollment.factorId, code: "12345" },
    { factor_id: enrollment.factorId, code: "1234567" },
    { factor_id: enrollment.factorId, code: "12a456" },
    { factor_id: enrollment.factorId, code: "12 456" },
    { factor_id: enrollment.factorId, code: "12345\n" },
  ];

  for (const body of cases) {
    const response = await appJsonFetch("/api/v1/auth/mfa/enroll/verify", {
      jar,
      body,
    });
    assert(response.status >= 400, "Enrollment invalid input status");
    const payload = await response.json();
    assert(
      payload?.code === "invalid_input" ||
        payload?.code === "mfa_factor_invalid",
      "Enrollment invalid input code",
    );
  }

  pass("Enrollment input rejection");
}

async function assertEnrollmentFactorTamper(email, jar, enrollment) {
  const before = await mfaFactorCounts(email);
  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/verify", {
    jar,
    body: {
      factor_id: randomUUID(),
      code: await currentTotpCode(enrollment.secret),
    },
  });
  const payload = await response.json();
  const after = await mfaFactorCounts(email);

  assert(response.status === 400, "Tampered factor status");
  assert(payload?.code === "mfa_factor_invalid", "Tampered factor code");
  assert(before.verified === after.verified, "Tamper no verified change");
  assert(before.unverified === after.unverified, "Tamper no unverified change");
  pass("Enrollment factor tamper blocked");
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
  assert(payload?.redirectTo === "/admin", "Enrollment redirect");
  pass("Enrollment verify");
}

async function assertReloginRequiresChallenge(jar) {
  const admin = await appFetch("/admin", { jar, redirect: "manual" });
  assertRedirectPath(admin, "/auth/mfa/challenge", "Relogin challenge");

  const challenge = await appFetch("/auth/mfa/challenge", {
    jar,
    redirect: "manual",
  });
  const body = await challenge.text();

  assert(challenge.status === 200, "Challenge page status");
  assert(body.includes('name="factor_id"'), "Challenge factor field");
  assert(!body.includes("otpauth://"), "Challenge no secret");
  pass("Relogin requires challenge");
}

async function assertChallengeInputRejections(jar) {
  const factorId = await readChallengeFactorId(jar);
  const cases = [
    {},
    { factor_id: "", code: "000000", next: "/admin" },
    { factor_id: "not-a-uuid", code: "000000", next: "/admin" },
    { factor_id: randomUUID(), code: "000000", next: "/admin" },
    { factor_id: factorId, code: "", next: "/admin" },
    { factor_id: factorId, code: "12345", next: "/admin" },
    { factor_id: factorId, code: "1234567", next: "/admin" },
    { factor_id: factorId, code: "12a456", next: "/admin" },
    { factor_id: factorId, code: "12 456", next: "/admin" },
    { factor_id: factorId, code: "123456", next: "https://example.invalid" },
    { factor_id: factorId, code: "123456", next: "/api/v1/health" },
  ];

  for (const body of cases) {
    const response = await appFetch("/api/v1/auth/mfa/challenge", {
      method: "POST",
      jar,
      body,
      redirect: "manual",
    });
    assert(
      response.status >= 300 && response.status < 400,
      "Challenge invalid input status",
    );
  }

  const admin = await appFetch("/admin", { jar, redirect: "manual" });
  assertRedirectPath(admin, "/auth/mfa/challenge", "Invalid input no AAL2");
  pass("Challenge input rejection");
}

async function assertWrongChallengeCode(jar) {
  const factorId = await readChallengeFactorId(jar);
  const response = await appFetch("/api/v1/auth/mfa/challenge", {
    method: "POST",
    jar,
    body: {
      factor_id: factorId,
      code: "000000",
      next: "/admin",
    },
    redirect: "manual",
  });

  assertRedirectHasCode(response, "mfa_invalid_code", "Wrong challenge");

  const admin = await appFetch("/admin", { jar, redirect: "manual" });
  assertRedirectPath(admin, "/auth/mfa/challenge", "Wrong code no AAL2");
  pass("Wrong challenge code blocked");
}

async function verifyChallenge(jar, secret) {
  const factorId = await readChallengeFactorId(jar);
  const response = await appFetch("/api/v1/auth/mfa/challenge", {
    method: "POST",
    jar,
    body: {
      factor_id: factorId,
      code: await currentTotpCode(secret),
      next: "/admin",
    },
    redirect: "manual",
  });

  assertRedirectPath(response, "/admin", "Challenge success redirect");
  pass("Challenge verify");
}

async function readChallengeFactorId(jar) {
  const response = await appFetch("/auth/mfa/challenge", {
    jar,
    redirect: "manual",
  });
  const body = await response.text();
  const match = body.match(
    /<input(?=[^>]*\bname="factor_id")(?=[^>]*\btype="hidden")(?=[^>]*\bvalue="([^"]+)")[^>]*>/,
  );

  assert(response.status === 200, "Challenge page factor read");
  assert(Boolean(match?.[1]), "Challenge factor hidden");

  return match[1];
}

async function assertAdminPageReady(jar) {
  const response = await appFetch("/admin", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, "Admin page status");
  assert(body.includes("Admin verified"), "Admin content");
  assert(!body.includes("user_roles"), "Admin no role rows");
  assert(!body.includes("Factor ID"), "Admin no factor id");
  pass("Admin AAL2 ready");
}

async function assertAdminForbidden(jar, label) {
  const response = await appFetch("/admin", { jar, redirect: "manual" });
  assertRedirectHasCode(response, "admin_forbidden", label);
  pass(label);
}

async function assertAccountStatusMatrix(email, jar) {
  for (const status of ["RESTRICTED", "SUSPENDED", "WITHDRAWN"]) {
    await updateAccountStatus(email, status);

    const admin = await appFetch("/admin", { jar, redirect: "manual" });
    assertRedirectPath(admin, "/auth/account-unavailable", `${status} admin`);

    const enroll = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
      jar,
      body: {},
    });
    const enrollPayload = await enroll.json();
    assert(
      enrollPayload?.code === "account_restricted",
      `${status} enroll blocked`,
    );

    const challenge = await appFetch("/api/v1/auth/mfa/challenge", {
      method: "POST",
      jar,
      body: {
        factor_id: randomUUID(),
        code: "000000",
        next: "/admin",
      },
      redirect: "manual",
    });
    assertRedirectHasCode(
      challenge,
      "account_restricted",
      `${status} challenge blocked`,
    );
  }

  await updateAccountStatus(email, "ACTIVE");
  pass("Account status matrix");
}

async function signUpConfirmAndSignIn(email, password, nextPath) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA Admin MFA",
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

async function grantAdminRole(email) {
  await sqlScalar(`
    insert into public.user_roles (user_id, role, grant_reason)
    select users.id, 'ADMIN', 'local admin mfa e2e'
    from auth.users as users
    where users.email = ${sqlLiteral(email)}
    on conflict (user_id, role) where revoked_at is null do nothing;

    select count(*)::text
    from public.user_roles as roles
    join auth.users as users on users.id = roles.user_id
    where users.email = ${sqlLiteral(email)}
      and roles.role = 'ADMIN'
      and roles.revoked_at is null;
  `).then((count) => {
    assert(count === "1", "Grant ADMIN role");
  });
}

async function revokeAdminRole(email) {
  await sqlScalar(`
    update public.user_roles as roles
    set revoked_at = now(),
      revoke_reason = 'local admin mfa e2e revoke'
    from auth.users as users
    where users.id = roles.user_id
      and users.email = ${sqlLiteral(email)}
      and roles.role = 'ADMIN'
      and roles.revoked_at is null;

    select count(*)::text
    from public.user_roles as roles
    join auth.users as users on users.id = roles.user_id
    where users.email = ${sqlLiteral(email)}
      and roles.role = 'ADMIN'
      and roles.revoked_at is null;
  `).then((count) => {
    assert(count === "0", "Revoke ADMIN role");
  });
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

async function assertAdminRpcByEmail(
  email,
  aal,
  expectedAdmin,
  expectedAal2,
) {
  const result = await sqlScalar(`
    select set_config('request.jwt.claim.sub', users.id::text, false)
    from auth.users as users
    where users.email = ${sqlLiteral(email)};
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'aal', ${sqlLiteral(aal)})::text,
      false
    );
    set role authenticated;
    select public.is_current_user_admin()::text || ',' || public.is_current_user_admin_aal2()::text;
  `);

  assert(
    result === `${expectedAdmin},${expectedAal2}`,
    "Admin RPC result",
  );
  pass(`Admin RPC ${aal}`);
}

async function mfaFactorCounts(email) {
  const result = await sqlScalar(`
    select
      count(*)::text || ',' ||
      count(*) filter (where factors.status = 'verified')::text || ',' ||
      count(*) filter (where factors.status = 'unverified')::text
    from auth.mfa_factors as factors
    join auth.users as users on users.id = factors.user_id
    where users.email = ${sqlLiteral(email)}
      and factors.factor_type = 'totp';
  `);
  const [total, verified, unverified] = result.split(",");

  return { total, verified, unverified };
}

async function assertFactorCounts(email, expected) {
  const actual = await mfaFactorCounts(email);

  assert(actual.total === expected.total, "MFA total count");
  assert(actual.verified === expected.verified, "MFA verified count");
  assert(actual.unverified === expected.unverified, "MFA unverified count");
}

async function totalMfaFactorCount() {
  return sqlScalar("select count(*)::text from auth.mfa_factors;");
}

async function requestEndpoint(endpoint, options) {
  return endpoint.kind === "json"
    ? appJsonFetch(endpoint.path, {
        body: endpoint.body,
        redirect: "manual",
        ...options,
      })
    : appFetch(endpoint.path, {
        method: "POST",
        body: endpoint.body,
        redirect: "manual",
        ...options,
      });
}

async function assertRejected(response, code, label) {
  if (response.headers.get("content-type")?.includes("application/json")) {
    const payload = await response.json();

    assert(response.status >= 400, `${label} status`);
    assert(payload?.code === code, `${label} code`);
    return;
  }

  assertRedirectHasCode(response, code, label);
}

async function assertJsonCode(response, code, label) {
  const payload = await response.json();

  assert(response.status >= 400, `${label} status`);
  assert(payload?.code === code, `${label} code`);
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
  const location = response.headers.get("location");
  const actual = location ? new URL(location, APP_ORIGIN) : null;
  const actualCode =
    actual?.searchParams.get("error") ?? actual?.searchParams.get("code");

  assert(Boolean(location), `${label} location`);
  assert(actualCode === code, `${label} code ${formatSafeRedirect(actual)}`);
}

function formatSafeRedirect(url) {
  if (!url) {
    return "missing";
  }

  const code = url.searchParams.get("error") ?? url.searchParams.get("code");

  return code ? `${url.pathname}?code=${code}` : url.pathname;
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
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
    console.error("FAIL admin mfa integration");
  }

  process.exitCode = 1;
});
