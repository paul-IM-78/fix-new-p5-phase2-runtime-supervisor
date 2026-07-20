import { execFile, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
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
  const runtime = await prepareManagedAppRuntime();
  const suffix = randomUUID().replaceAll("-", "");
  const password = `Deposit-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-deposit-admin-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const userEmail = `qa-deposit-user-${Date.now()}-${suffix.slice(8, 16)}@example.test`;
  const otherEmail = `qa-deposit-other-${Date.now()}-${suffix.slice(16, 24)}@example.test`;

  try {
    await assertPublicSmoke();
    await assertSameOriginRejectionsWithoutSession();

    const userJar = await signUpConfirmAndSignIn(
      userEmail,
      password,
      "/deposits",
    );
    const otherJar = await signUpConfirmAndSignIn(
      otherEmail,
      password,
      "/deposits",
    );
    const adminJar = await signUpConfirmAndSignIn(
      adminEmail,
      password,
      "/admin",
    );

    const adminUserId = await readUserIdByEmail(adminEmail);
    const userId = await readUserIdByEmail(userEmail);
    const otherUserId = await readUserIdByEmail(otherEmail);
    const wallet = await readWalletByUserId(userId);

    await bootstrapAdminRole(adminUserId);
    await assertGeneralUserBlocked(userJar, wallet);
    await assertAal1AdminBlocked(adminJar, wallet);

    const enrollment = await enrollAndVerifyAdmin(adminJar, adminEmail, password);

    await assertUserDepositsPage(userJar);
    await assertAdminDepositsPage(adminJar);
    await assertInputRejections(userJar, adminJar, wallet);

    const asset = await createQaAsset(suffix, "A", "ACTIVE");
    const deposit = await assertDepositRequestApplied(userJar, wallet, asset);

    await assertDepositRequestReplay(userJar, wallet, asset, deposit);
    await assertDepositRequestConflict(userJar, wallet, asset, deposit);

    const concurrentAsset = await createQaAsset(suffix, "B", "ACTIVE");
    await assertConcurrentRequestReplay(userJar, wallet, concurrentAsset);

    const cancelAsset = await createQaAsset(suffix, "C", "ACTIVE");
    await assertUserCancel(userJar, otherJar, wallet, cancelAsset, otherUserId);

    const confirmAsset = await createQaAsset(suffix, "D", "ACTIVE");
    await assertAdminConfirm(adminJar, userJar, wallet, confirmAsset);

    await assertConfirmTargetStateGuards(adminJar, userJar, userId, wallet, suffix);
    await assertAdminCancelInactiveTarget(adminJar, userJar, userId, wallet, suffix);
    await assertAuditAndDirectAccess(userId, adminUserId);
    await assertInactiveUserReadBlocked(userJar, userId);
    await assertFactorSecretNotPrinted(enrollment);

    await logout(adminJar);
    await logout(userJar);
    await logout(otherJar);

    pass("Deposit state machine integration");
  } finally {
    await stopManagedAppRuntime(runtime);
  }
}

async function prepareManagedAppRuntime() {
  if (process.env.APP_ORIGIN) {
    return null;
  }

  const useLocalEnvFile = existsSync(".env.local");
  const status = useLocalEnvFile ? null : await readLocalSupabaseStatus();
  const env = {
    ...process.env,
    APP_ORIGIN,
    NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
  };

  if (status) {
    env.APP_ENV = "local";
    env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.ANON_KEY;
  }

  const server = spawn(process.execPath, [
    "node_modules/next/dist/bin/next",
    "start",
    "-p",
    "3010",
    "-H",
    "127.0.0.1",
  ], {
    cwd: process.cwd(),
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const outputTail = [];

  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      outputTail.push(chunk);

      if (outputTail.length > 20) {
        outputTail.shift();
      }
    });
  }

  await waitForManagedAppRuntime(server);

  return server;
}

async function stopManagedAppRuntime(server) {
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

async function waitForManagedAppRuntime(server) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error("FAIL managed Next server exited");
    }

    try {
      const response = await fetch(`${APP_ORIGIN}/api/v1/health`, {
        redirect: "manual",
      });
      const body = await response.text();

      assertNoSensitiveBody(body, "Managed health");

      if (response.status === 200) {
        return;
      }
    } catch {
      await wait(500);
    }
  }

  throw new Error("FAIL managed Next server readiness");
}

async function readLocalSupabaseStatus() {
  const command = process.platform === "win32"
    ? { file: "cmd.exe", args: ["/c", "npm", "run", "supabase:status", "--", "-o", "json"] }
    : { file: "npm", args: ["run", "supabase:status", "--", "-o", "json"] };
  const { stdout, stderr } = await execFileAsync(command.file, command.args, {
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const raw = `${stdout}\n${stderr}`;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("FAIL local Supabase status");
  }

  const status = JSON.parse(raw.slice(start, end + 1));

  if (!status.API_URL || !status.ANON_KEY) {
    throw new Error("FAIL local app config");
  }

  return status;
}

async function assertPublicSmoke() {
  await assertStatus("/api/v1/health", 200, "Health 200");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness 200");
  await assertStatus("/", 200, "Landing 200");

  const deposits = await appFetch("/deposits", { redirect: "manual" });
  assertRedirectPath(deposits, "/auth/sign-in", "Anonymous deposits");

  const adminDeposits = await appFetch("/admin/deposits", {
    redirect: "manual",
  });
  assertRedirectPath(adminDeposits, "/auth/sign-in", "Anonymous admin deposits");
  await assertMailpitReady();
  await assertDatabaseReady();
  pass("Deposit public smoke");
}

async function assertSameOriginRejectionsWithoutSession() {
  const before = await depositAuditCount();
  const requestBody = {
    wallet_account_id: randomUUID(),
    wallet_expected_version: "1",
    asset_id: randomUUID(),
    asset_expected_version: "1",
    units: "1",
    command_id: randomUUID(),
  };
  const cancelBody = {
    deposit_request_id: randomUUID(),
    request_expected_version: "1",
    command_id: randomUUID(),
    reason: "origin rejected",
  };

  for (const [path, body] of [
    ["/api/v1/deposits/create", requestBody],
    ["/api/v1/deposits/cancel", cancelBody],
    ["/api/v1/admin/deposits/confirm", cancelBody],
    ["/api/v1/admin/deposits/cancel", cancelBody],
  ]) {
    for (const options of [
      { includeOrigin: false },
      { origin: "https://example.invalid" },
      { fetchSite: "cross-site" },
    ]) {
      const response = await appFetch(path, {
        method: "POST",
        body,
        redirect: "manual",
        ...options,
      });

      assertRedirectHasCode(response, "request_rejected", "Origin rejection");
    }
  }

  assert((await depositAuditCount()) === before, "Origin no audit");
  pass("Deposit same-origin rejection");
}

async function assertGeneralUserBlocked(jar, wallet) {
  const page = await appFetch("/admin/deposits", { jar, redirect: "manual" });
  assertRedirectHasCode(page, "admin_forbidden", "USER admin deposits page");

  const response = await submitAdminConfirm(jar, {
    depositRequestId: randomUUID(),
    requestExpectedVersion: 1,
    commandId: randomUUID(),
    reason: "user blocked",
  });
  assertRedirectHasCode(response, "admin_forbidden", "USER admin confirm API");

  const direct = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(wallet.userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(wallet.userId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform *
      from public.confirm_user_funding_request(
        ${sqlLiteral(randomUUID())}::uuid,
        1,
        ${sqlLiteral(randomUUID())}::uuid,
        'blocked'
      );
      raise exception 'expected denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);

  assert(direct === "denied", "USER admin deposit RPC denied");
  pass("General USER deposit admin blocked");
}

async function assertAal1AdminBlocked(jar, wallet) {
  const page = await appFetch("/admin/deposits", { jar, redirect: "manual" });
  assertRedirectPath(page, "/auth/mfa/enroll", "AAL1 admin deposits page");

  const response = await submitAdminConfirm(jar, {
    depositRequestId: randomUUID(),
    requestExpectedVersion: 1,
    commandId: randomUUID(),
    reason: "aal1 blocked",
  });
  assertRedirectPath(response, "/auth/mfa/enroll", "AAL1 admin confirm API");

  const adminUserId = await readUserIdFromJarFallback(wallet.userId);
  const direct = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(adminUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(adminUserId)}, 'aal', 'aal1')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform *
      from public.confirm_user_funding_request(
        ${sqlLiteral(randomUUID())}::uuid,
        1,
        ${sqlLiteral(randomUUID())}::uuid,
        'blocked'
      );
      raise exception 'expected denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);

  assert(direct === "denied", "AAL1 admin deposit RPC denied");
  pass("AAL1 admin deposit blocked");
}

async function assertUserDepositsPage(jar) {
  const response = await appFetch("/deposits", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, "User deposits page 200");
  assert(body.includes("Deposit requests"), "Deposits title");
  assert(body.includes("Create request"), "Deposit create section");
  assert(!body.includes("Deposit Address"), "No deposit address label");
  assert(!body.includes("Transaction ID"), "No transaction id label");
  assertNoSensitiveBody(body, "User deposits body");
  pass("User deposits page");
}

async function assertAdminDepositsPage(jar) {
  const response = await appFetch("/admin/deposits", {
    jar,
    redirect: "manual",
  });
  const body = await response.text();

  assert(response.status === 200, "Admin deposits page 200");
  assert(body.includes("Deposit operations"), "Admin deposits title");
  assert(body.includes("State machine"), "Admin deposits state machine");
  assert(!body.includes("request_data"), "No request_data dump");
  assert(!body.includes("Transaction ID"), "No transaction id label");
  assertNoSensitiveBody(body, "Admin deposits body");
  pass("Admin deposits page");
}

async function assertInputRejections(userJar, adminJar, wallet) {
  const before = await depositAuditCount();
  const validCreate = {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: randomUUID(),
    assetExpectedVersion: 1,
    units: "1",
    commandId: randomUUID(),
  };
  const invalidCreates = [
    {},
    { ...validCreate, walletAccountId: "bad" },
    { ...validCreate, walletExpectedVersion: 0 },
    { ...validCreate, assetId: "bad" },
    { ...validCreate, assetExpectedVersion: 0 },
    { ...validCreate, units: "0" },
    { ...validCreate, units: "-1" },
    { ...validCreate, units: "1.0" },
    { ...validCreate, units: "01" },
    { ...validCreate, units: "1e9" },
    { ...validCreate, units: "9".repeat(39) },
    { ...validCreate, commandId: "bad" },
  ];

  for (const input of invalidCreates) {
    const response = await submitDepositCreate(userJar, input);

    assertRedirectHasCode(response, "invalid_input", "Create input rejected");
  }

  for (const response of [
    await submitUserCancel(userJar, {}),
    await submitUserCancel(userJar, {
      depositRequestId: "bad",
      requestExpectedVersion: 1,
      commandId: randomUUID(),
    }),
    await submitAdminConfirm(adminJar, {
      depositRequestId: randomUUID(),
      requestExpectedVersion: 0,
      commandId: randomUUID(),
      reason: "bad version",
    }),
    await submitAdminConfirm(adminJar, {
      depositRequestId: randomUUID(),
      requestExpectedVersion: 1,
      commandId: randomUUID(),
      reason: "",
    }),
    await submitAdminCancel(adminJar, {
      depositRequestId: randomUUID(),
      requestExpectedVersion: 1,
      commandId: randomUUID(),
      reason: "line\nbreak",
    }),
  ]) {
    assertRedirectHasCode(response, "invalid_input", "Command input rejected");
  }

  assert((await depositAuditCount()) === before, "Input rejection no audit");
  pass("Deposit input rejection");
}

async function assertDepositRequestApplied(jar, wallet, asset) {
  const commandId = randomUUID();
  const walletVersion = await readWalletVersion(wallet.id);
  const response = await submitDepositCreate(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: walletVersion,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "100",
    commandId,
  });

  assertRedirectParam(response, "result", "deposit_request_created", "Deposit create");

  const state = await readDepositState(commandId);

  assert(state.requests === 1, "Deposit request count");
  assert(state.journals === 1, "Deposit request journal count");
  assert(state.entries === 2, "Deposit request entry count");
  assert(state.auditApplied === 1, "Deposit request audit count");
  assert(state.status === "REQUESTED", "Deposit request status");
  assert(state.pending === "100", "Pending increased");
  assert(state.available === "0", "Available unchanged");
  assert(state.custody === "0", "Custody unchanged");
  assert(state.clearing === "100", "Clearing increased");
  pass("Deposit request applied");

  return {
    commandId,
    depositRequestId: state.depositRequestId,
    walletId: wallet.id,
    walletVersion,
    assetId: asset.id,
    units: "100",
    version: state.version,
  };
}

async function assertDepositRequestReplay(jar, wallet, asset, deposit) {
  const before = await readDepositState(deposit.commandId);
  const response = await submitDepositCreate(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: deposit.walletVersion,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: deposit.units,
    commandId: deposit.commandId,
  });

  assertRedirectParam(response, "result", "deposit_request_created", "Deposit replay");

  const after = await readDepositState(deposit.commandId);

  assert(after.requests === before.requests, "Replay no request");
  assert(after.journals === before.journals, "Replay no journal");
  assert(after.auditApplied === before.auditApplied, "Replay no audit");
  assert(after.pending === before.pending, "Replay no balance change");
  pass("Deposit request replay");
}

async function assertDepositRequestConflict(jar, wallet, asset, deposit) {
  const before = await totalDepositAuditCount();
  const response = await submitDepositCreate(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: deposit.walletVersion,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "101",
    commandId: deposit.commandId,
  });

  assertRedirectHasCode(response, "deposit_command_conflict", "Deposit conflict");
  assert((await totalDepositAuditCount()) === before, "Conflict no audit");
  pass("Deposit request conflict");
}

async function assertConcurrentRequestReplay(jar, wallet, asset) {
  const commandId = randomUUID();
  const input = {
    walletAccountId: wallet.id,
    walletExpectedVersion: await readWalletVersion(wallet.id),
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "7",
    commandId,
  };
  const [first, second] = await Promise.all([
    submitDepositCreate(jar, input),
    submitDepositCreate(jar, input),
  ]);

  assertRedirectParam(first, "result", "deposit_request_created", "Concurrent A");
  assertRedirectParam(second, "result", "deposit_request_created", "Concurrent B");

  const state = await readDepositState(commandId);

  assert(state.requests === 1, "Concurrent one request");
  assert(state.journals === 1, "Concurrent one journal");
  assert(state.auditApplied === 1, "Concurrent one audit");
  assert(state.pending === "7", "Concurrent balance once");
  pass("Concurrent deposit request replay");
}

async function assertUserCancel(userJar, otherJar, wallet, asset, otherUserId) {
  const createCommandId = randomUUID();
  await submitAndAssertCreate(userJar, wallet, asset, "40", createCommandId);
  const state = await readDepositState(createCommandId);

  const otherResponse = await submitUserCancel(otherJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: state.version,
    commandId: randomUUID(),
  });
  assertRedirectHasCode(otherResponse, "deposit_request_forbidden", "Other cancel");

  const cancelCommandId = randomUUID();
  const response = await submitUserCancel(userJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: state.version,
    commandId: cancelCommandId,
  });
  assertRedirectParam(response, "result", "deposit_request_canceled", "User cancel");

  const canceled = await readDepositState(createCommandId);

  assert(canceled.status === "CANCELED", "User cancel status");
  assert(canceled.pending === "0", "User cancel pending zero");
  assert(canceled.clearing === "0", "User cancel clearing zero");
  assert(canceled.available === "0", "User cancel available unchanged");
  assert(canceled.cancelAuditApplied === 1, "User cancel audit");

  const replay = await submitUserCancel(userJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: state.version,
    commandId: cancelCommandId,
  });
  assertRedirectParam(replay, "result", "deposit_request_canceled", "User cancel replay");

  const noop = await submitUserCancel(userJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: canceled.version,
    commandId: randomUUID(),
  });
  assertRedirectParam(noop, "result", "deposit_request_cancel_noop", "User cancel noop");

  assert(isUuid(otherUserId), "Other user id remains local fixture");
  pass("User deposit cancel");
}

async function assertAdminConfirm(adminJar, userJar, wallet, asset) {
  const createCommandId = randomUUID();
  await submitAndAssertCreate(userJar, wallet, asset, "55", createCommandId);
  const state = await readDepositState(createCommandId);
  const confirmCommandId = randomUUID();
  const response = await submitAdminConfirm(adminJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: state.version,
    commandId: confirmCommandId,
    reason: "manual verification complete",
  });

  assertRedirectParam(response, "result", "deposit_request_confirmed", "Admin confirm");

  const confirmed = await readDepositState(createCommandId);

  assert(confirmed.status === "CONFIRMED", "Confirm status");
  assert(confirmed.pending === "0", "Confirm pending zero");
  assert(confirmed.available === "55", "Confirm available");
  assert(confirmed.custody === "55", "Confirm custody");
  assert(confirmed.clearing === "0", "Confirm clearing zero");
  assert(confirmed.confirmEntries === 4, "Confirm four entries");
  assert(confirmed.confirmAuditApplied === 1, "Confirm audit");

  const replay = await submitAdminConfirm(adminJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: state.version,
    commandId: confirmCommandId,
    reason: "manual verification complete",
  });
  assertRedirectParam(replay, "result", "deposit_request_confirmed", "Confirm replay");

  const noop = await submitAdminConfirm(adminJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: confirmed.version,
    commandId: randomUUID(),
    reason: "already confirmed noop",
  });
  assertRedirectParam(noop, "result", "deposit_request_confirm_noop", "Confirm noop");

  const cancel = await submitAdminCancel(adminJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: confirmed.version,
    commandId: randomUUID(),
    reason: "confirmed cancel blocked",
  });
  assertRedirectHasCode(cancel, "deposit_request_confirmed_terminal", "Confirmed cancel blocked");
  pass("Admin deposit confirm");
}

async function assertConfirmTargetStateGuards(adminJar, userJar, userId, wallet, suffix) {
  for (const [label, setupSql, expected] of [
    [
      "profile",
      `update public.profiles set account_status = 'RESTRICTED' where id = ${sqlLiteral(userId)}::uuid;`,
      "deposit_target_profile_not_active",
    ],
    [
      "wallet",
      `update public.wallet_accounts set status = 'FROZEN' where id = ${sqlLiteral(wallet.id)}::uuid;`,
      "deposit_target_wallet_not_active",
    ],
    [
      "asset",
      null,
      "deposit_target_asset_not_active",
    ],
  ]) {
    await resetTargetState(userId, wallet.id);
    const asset = await createQaAsset(suffix, `G${label[0].toUpperCase()}`, "ACTIVE");
    const createCommandId = randomUUID();
    await submitAndAssertCreate(userJar, wallet, asset, "5", createCommandId);
    const state = await readDepositState(createCommandId);

    if (setupSql) {
      await sqlScalar(setupSql + " select 'ok';");
    } else {
      await sqlScalar(`
        update public.supported_assets
        set status = 'SUSPENDED'
        where id = ${sqlLiteral(asset.id)}::uuid;
        select 'ok';
      `);
    }

    const response = await submitAdminConfirm(adminJar, {
      depositRequestId: state.depositRequestId,
      requestExpectedVersion: state.version,
      commandId: randomUUID(),
      reason: `${label} inactive confirm blocked`,
    });

    assertRedirectHasCode(response, expected, `${label} confirm guard`);
  }

  await resetTargetState(userId, wallet.id);
  pass("Admin confirm target state guards");
}

async function assertAdminCancelInactiveTarget(adminJar, userJar, userId, wallet, suffix) {
  const asset = await createQaAsset(suffix, "H", "ACTIVE");
  const createCommandId = randomUUID();
  await submitAndAssertCreate(userJar, wallet, asset, "9", createCommandId);
  const state = await readDepositState(createCommandId);

  await sqlScalar(`
    update public.profiles
    set account_status = 'SUSPENDED'
    where id = ${sqlLiteral(userId)}::uuid;

    update public.wallet_accounts
    set status = 'CLOSED',
        closed_at = clock_timestamp()
    where id = ${sqlLiteral(wallet.id)}::uuid;

    update public.supported_assets
    set status = 'ARCHIVED'
    where id = ${sqlLiteral(asset.id)}::uuid;

    select 'ok';
  `);

  const response = await submitAdminCancel(adminJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: state.version,
    commandId: randomUUID(),
    reason: "admin cancel inactive target",
  });
  assertRedirectParam(response, "result", "deposit_request_canceled", "Admin cancel inactive");

  const canceled = await readDepositState(createCommandId);

  assert(canceled.status === "CANCELED", "Admin cancel status");
  assert(canceled.pending === "0", "Admin cancel pending");
  assert(canceled.clearing === "0", "Admin cancel clearing");

  const confirm = await submitAdminConfirm(adminJar, {
    depositRequestId: state.depositRequestId,
    requestExpectedVersion: canceled.version,
    commandId: randomUUID(),
    reason: "canceled confirm blocked",
  });
  assertRedirectHasCode(confirm, "deposit_request_canceled_terminal", "Canceled confirm blocked");

  await resetTargetState(userId, wallet.id);
  pass("Admin cancel inactive target");
}

async function assertAuditAndDirectAccess(userId, adminUserId) {
  const result = await sqlScalar(`
    do $$
    begin
      update private.deposit_command_audit_events
      set reason = 'blocked';
      raise exception 'expected audit update failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;
    do $$
    begin
      delete from private.deposit_command_audit_events;
      raise exception 'expected audit delete failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;
    do $$
    begin
      truncate private.deposit_command_audit_events;
      raise exception 'expected audit truncate failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;
    select 'blocked';
  `);
  assert(result === "blocked", "Deposit audit immutable");

  const denied = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform count(*) from private.deposit_requests;
      raise exception 'expected direct table denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);
  assert(denied === "denied", "Direct deposit table denied");

  const adminRead = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(adminUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(adminUserId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    select (
      (select count(*) from public.list_admin_deposit_requests(100, null)) > 0
      and
      (select count(*) from public.list_deposit_command_audit_events(100, null)) > 0
    )::text;
  `);
  assert(adminRead === "true", "Admin deposit reads");
  pass("Deposit audit and direct access");
}

async function assertInactiveUserReadBlocked(jar, userId) {
  await sqlScalar(`
    update public.profiles
    set account_status = 'WITHDRAWN'
    where id = ${sqlLiteral(userId)}::uuid;
    select 'ok';
  `);

  const response = await appFetch("/deposits", { jar, redirect: "manual" });
  assertRedirectPath(response, "/auth/account-unavailable", "Inactive deposits page");
  pass("Inactive user deposit read blocked");
}

async function submitAndAssertCreate(jar, wallet, asset, units, commandId) {
  const response = await submitDepositCreate(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: await readWalletVersion(wallet.id),
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units,
    commandId,
  });

  assertRedirectParam(response, "result", "deposit_request_created", "Create fixture");
}

async function createQaAsset(suffix, label, status) {
  const assetCode = `DEP_${label}_${suffix.slice(0, 12).toUpperCase()}`.slice(0, 32);
  const mintAddress = randomBase58(44);
  const payload = await sqlScalar(`
    with inserted_asset as (
      insert into public.supported_assets (
        asset_code,
        symbol,
        display_name,
        asset_type,
        decimals,
        mint_address,
        status
      )
      values (
        ${sqlLiteral(assetCode)},
        ${sqlLiteral(`D${label}`.slice(0, 12))},
        ${sqlLiteral(`Deposit QA Asset ${label}`)},
        'SPL_TOKEN',
        6,
        ${sqlLiteral(mintAddress)},
        ${sqlLiteral(status)}
      )
      returning id, version, status
    )
    select json_build_object(
      'id', id::text,
      'version', version,
      'status', status
    )::text
    from inserted_asset;
  `);

  return parseJsonRow(payload, "QA asset");
}

async function resetTargetState(userId, walletId) {
  await sqlScalar(`
    update public.profiles
    set account_status = 'ACTIVE'
    where id = ${sqlLiteral(userId)}::uuid;

    update public.wallet_accounts
    set status = 'ACTIVE',
        closed_at = null
    where id = ${sqlLiteral(walletId)}::uuid;

    select 'ok';
  `);
}

async function readDepositState(commandId) {
  const payload = await sqlScalar(`
    with request_event as (
      select events.deposit_request_id
      from private.deposit_command_audit_events as events
      where events.command_id = ${sqlLiteral(commandId)}::uuid
      limit 1
    ),
    request_row as (
      select requests.*
      from private.deposit_requests as requests
      where requests.id = (select deposit_request_id from request_event)
    ),
    related_journals as (
      select journals.*
      from private.ledger_journals as journals
      where journals.reference_type = 'DEPOSIT_REQUEST'
        and journals.reference_id = (select id from request_row)
    ),
    account_balances as (
      select accounts.account_purpose, balances.balance_units::text
      from request_row
      join private.ledger_accounts as accounts
        on accounts.asset_id = request_row.asset_id
        and (
          accounts.wallet_account_id = request_row.wallet_account_id
          or accounts.wallet_account_id is null
        )
      join private.ledger_account_balances as balances
        on balances.ledger_account_id = accounts.id
    )
    select json_build_object(
      'depositRequestId', (select id::text from request_row),
      'status', (select status from request_row),
      'version', (select version from request_row),
      'requests', (select count(*) from request_row),
      'journals', (
        select count(*)
        from private.ledger_journals
        where command_id = ${sqlLiteral(commandId)}::uuid
      ),
      'entries', (
        select count(*)
        from private.ledger_entries
        where journal_id = (select request_journal_id from request_row)
      ),
      'confirmEntries', (
        select count(*)
        from private.ledger_entries
        where journal_id = (select confirmation_journal_id from request_row)
      ),
      'auditApplied', (
        select count(*)
        from private.deposit_command_audit_events
        where command_id = ${sqlLiteral(commandId)}::uuid
          and action = 'CREATE_DEPOSIT_REQUEST'
          and outcome = 'APPLIED'
      ),
      'confirmAuditApplied', (
        select count(*)
        from private.deposit_command_audit_events
        where deposit_request_id = (select id from request_row)
          and action = 'CONFIRM_DEPOSIT_REQUEST'
          and outcome = 'APPLIED'
      ),
      'cancelAuditApplied', (
        select count(*)
        from private.deposit_command_audit_events
        where deposit_request_id = (select id from request_row)
          and action = 'CANCEL_DEPOSIT_REQUEST'
          and outcome = 'APPLIED'
      ),
      'pending', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'USER_PENDING_DEPOSIT'
      ), '0'),
      'available', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'USER_AVAILABLE'
      ), '0'),
      'custody', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'SYSTEM_CUSTODY'
      ), '0'),
      'clearing', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'SYSTEM_DEPOSIT_CLEARING'
      ), '0')
    )::text;
  `);

  return parseJsonRow(payload, "Deposit state");
}

async function signUpConfirmAndSignIn(email, password, nextPath) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA Deposit Account",
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

async function enrollAndVerifyAdmin(jar, email, password) {
  const enrollment = await startEnrollment(jar, email, password);

  const verify = await appJsonFetch("/api/v1/auth/mfa/enroll/verify", {
    jar,
    body: {
      factor_id: enrollment.factorId,
      code: await currentTotpCode(enrollment.secret),
    },
    redirect: "manual",
  });
  const verified = await verify.json();

  assert(
    verify.status === 200,
    `MFA verification status ${verify.status}:${verified?.code ?? "none"}`,
  );
  assert(verified?.status === "verified", "MFA verified");
  pass("Deposit command MFA ready");

  return enrollment;
}

async function startEnrollment(jar, email, password) {
  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
    redirect: "manual",
  });
  const payload = await response.json();

  assert(
    response.status === 200 ||
      (response.status === 503 && payload?.code === "mfa_enrollment_failed"),
    `MFA enrollment start status ${response.status}:${payload?.code ?? "none"}`,
  );

  if (response.status === 503 && payload?.code === "mfa_enrollment_failed") {
    return startEnrollmentWithLocalSupabase(email, password);
  }

  assert(payload?.status === "enrollment_started", "MFA enrollment status");
  assert(isUuid(payload?.factorId), "MFA factor id");
  assert(isBase32Secret(payload?.secret), "MFA secret shape");

  return {
    factorId: payload.factorId,
    secret: payload.secret,
  };
}

async function startEnrollmentWithLocalSupabase(email, password) {
  const { createClient } = await import("@supabase/supabase-js");
  const status = await readLocalSupabaseStatus();
  const supabase = createClient(status.API_URL, status.ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const signIn = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signIn.error) {
    throw new Error("FAIL MFA local enrollment sign-in");
  }

  const factors = await supabase.auth.mfa.listFactors();

  if (factors.error) {
    throw new Error("FAIL MFA local factor list");
  }

  for (const factor of factors.data.all ?? []) {
    if (factor.factor_type !== "totp" || factor.status !== "unverified") {
      continue;
    }

    const factorId = isUuid(factor.id) ? factor.id : null;

    if (!factorId) {
      throw new Error("FAIL MFA local factor id");
    }

    const unenroll = await supabase.auth.mfa.unenroll({ factorId });

    if (unenroll.error) {
      throw new Error("FAIL MFA local factor cleanup");
    }
  }

  const enrollment = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Admin authenticator",
  });
  const factorId = isUuid(enrollment.data?.id) ? enrollment.data.id : null;
  const secret = isBase32Secret(enrollment.data?.totp?.secret)
    ? enrollment.data.totp.secret
    : null;

  if (enrollment.error || !factorId || !secret) {
    throw new Error("FAIL MFA local enrollment");
  }

  pass("MFA local enrollment fallback");

  return {
    factorId,
    secret,
  };
}

async function submitDepositCreate(
  jar,
  {
    walletAccountId,
    walletExpectedVersion,
    assetId,
    assetExpectedVersion,
    units,
    commandId,
  },
) {
  return appFetch("/api/v1/deposits/create", {
    method: "POST",
    jar,
    body: {
      wallet_account_id: walletAccountId,
      wallet_expected_version: walletExpectedVersion,
      asset_id: assetId,
      asset_expected_version: assetExpectedVersion,
      units,
      command_id: commandId,
    },
    redirect: "manual",
  });
}

async function submitUserCancel(
  jar,
  { depositRequestId, requestExpectedVersion, commandId },
) {
  return appFetch("/api/v1/deposits/cancel", {
    method: "POST",
    jar,
    body: {
      deposit_request_id: depositRequestId,
      request_expected_version: requestExpectedVersion,
      command_id: commandId,
    },
    redirect: "manual",
  });
}

async function submitAdminConfirm(
  jar,
  { depositRequestId, requestExpectedVersion, commandId, reason },
) {
  return appFetch("/api/v1/admin/deposits/confirm", {
    method: "POST",
    jar,
    body: {
      deposit_request_id: depositRequestId,
      request_expected_version: requestExpectedVersion,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitAdminCancel(
  jar,
  { depositRequestId, requestExpectedVersion, commandId, reason },
) {
  return appFetch("/api/v1/admin/deposits/cancel", {
    method: "POST",
    jar,
    body: {
      deposit_request_id: depositRequestId,
      request_expected_version: requestExpectedVersion,
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
  const cleanBody = filterBody(body);

  if (cleanBody) {
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
    body: cleanBody ? new URLSearchParams(cleanBody) : undefined,
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
  const body = await response.text();

  assert(response.status === status, label);
  assertNoSensitiveBody(body, label);
}

async function assertMailpitReady() {
  const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
    redirect: "manual",
  });

  assert(response.ok, "Mailpit ready");
}

async function assertDatabaseReady() {
  const result = await sqlScalar("select 'ready';");

  assert(result === "ready", "Database ready");
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
        timeout: 10000,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    const output = stdout.trim();

    assertNoSensitiveBody(output, "SQL output");

    return output.split(/\r?\n/).at(-1)?.trim() ?? "";
  } catch {
    throw new Error("FAIL local SQL");
  }
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

async function readUserIdFromJarFallback(fallbackUserId) {
  assert(isUuid(fallbackUserId), "Fallback user id shape");

  const adminUserId = await sqlScalar(`
    select user_id::text
    from public.user_roles
    where role = 'ADMIN'
      and revoked_at is null
    order by granted_at desc
    limit 1;
  `);

  return isUuid(adminUserId) ? adminUserId : fallbackUserId;
}

async function readWalletByUserId(userId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', wallet_accounts.id::text,
      'userId', wallet_accounts.user_id::text,
      'status', wallet_accounts.status,
      'version', wallet_accounts.version
    )::text
    from public.wallet_accounts
    where user_id = ${sqlLiteral(userId)}::uuid;
  `);

  return parseJsonRow(payload, "Wallet by user");
}

async function readWalletVersion(walletId) {
  const rawVersion = await sqlScalar(`
    select version::text
    from public.wallet_accounts
    where id = ${sqlLiteral(walletId)}::uuid;
  `);
  const version = Number(rawVersion);

  assert(Number.isSafeInteger(version) && version > 0, "Wallet version");

  return version;
}

async function bootstrapAdminRole(userId) {
  const count = await sqlScalar(`
    insert into public.user_roles (user_id, role, grant_reason)
    values (${sqlLiteral(userId)}::uuid, 'ADMIN', 'local deposit command e2e bootstrap')
    on conflict (user_id, role) where revoked_at is null do nothing;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === "1", "Bootstrap ADMIN role");
}

async function depositAuditCount() {
  return Number(
    await sqlScalar("select count(*)::text from private.deposit_command_audit_events;"),
  );
}

async function totalDepositAuditCount() {
  return Number(
    await sqlScalar("select count(*)::text from private.deposit_command_audit_events;"),
  );
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
    `${label} param ${formatSafeRedirect(actual)}`,
  );
}

function getRedirectUrl(response, label) {
  const location = response.headers.get("location");
  const actual = location ? new URL(location, APP_ORIGIN) : null;

  assert(Boolean(actual), `${label} location`);
  assertNoSensitiveRedirectQuery(actual, label);

  return actual;
}

function formatSafeRedirect(url) {
  const code =
    url.searchParams.get("result") ??
    url.searchParams.get("error") ??
    url.searchParams.get("code");

  return code ? `${url.pathname}?code=${code}` : url.pathname;
}

function assertNoSensitiveRedirectQuery(url, label) {
  for (const name of [
    "wallet_account_id",
    "user_id",
    "target_user_id",
    "asset_id",
    "deposit_request_id",
    "command_id",
    "request_expected_version",
    "wallet_expected_version",
    "asset_expected_version",
    "units",
    "reason",
    "journal_id",
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
    "sb-access-token",
    "sb-refresh-token",
    "otpauth://",
    "private_key",
    "mnemonic",
    "service_role",
    "SUPABASE_SERVICE_ROLE",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL=",
    "DIRECT_DATABASE_URL=",
    "BEGIN PRIVATE KEY",
    "PRIVATE_KEY=",
    "MNEMONIC=",
    "SEED_PHRASE=",
    "Transaction ID",
    "Deposit Address",
  ]) {
    assert(!body.includes(marker), `${label} no ${marker}`);
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

function filterBody(body) {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const clean = {};

  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      clean[key] = String(value);
    }
  }

  return clean;
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

function randomBase58(length) {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += BASE58_ALPHABET[Math.floor(Math.random() * BASE58_ALPHABET.length)];
  }

  return value;
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

async function assertFactorSecretNotPrinted(enrollment) {
  assert(isUuid(enrollment.factorId), "Factor id shape");
  assert(isBase32Secret(enrollment.secret), "Secret shape");
  pass("MFA material process-only");
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

function redactDiagnostic(value) {
  return String(value)
    .replace(JWT_PATTERN, "[REDACTED]")
    .replace(EMAIL_PATTERN, "[REDACTED]")
    .replace(new RegExp(UUID_PATTERN.source, "gi"), "[REDACTED]");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "FAIL unknown";

  if (message.startsWith("FAIL ")) {
    console.error(message);
  } else {
    console.error(`FAIL deposit state machine integration: ${redactDiagnostic(message)}`);
  }

  process.exitCode = 1;
});
