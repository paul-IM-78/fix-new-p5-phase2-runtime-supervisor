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
  const password = `Withdrawal-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-withdrawal-admin-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const userEmail = `qa-withdrawal-user-${Date.now()}-${suffix.slice(8, 16)}@example.test`;

  try {
    await assertPublicSmoke();
    await assertSameOriginRejectionsWithoutSession();

    const userJar = await signUpConfirmAndSignIn(
      userEmail,
      password,
      "/withdrawals",
    );
    const adminJar = await signUpConfirmAndSignIn(
      adminEmail,
      password,
      "/admin",
    );

    const adminUserId = await readUserIdByEmail(adminEmail);
    const userId = await readUserIdByEmail(userEmail);
    const userWallet = await readWalletByUserId(userId);
    const adminWallet = await readWalletByUserId(adminUserId);

    await bootstrapAdminRole(adminUserId);
    await assertGeneralUserBlocked(userJar, userId);
    await assertAal1AdminBlocked(adminJar, adminUserId);

    const enrollment = await enrollAndVerifyAdmin(
      adminJar,
      adminEmail,
      password,
    );

    await assertUserWithdrawalsPage(userJar);
    await assertAdminWithdrawalsPage(adminJar);
    await assertInputRejections(userJar, adminJar, userWallet);

    const requestedAsset = await createFundedAsset(
      suffix,
      "A",
      userWallet,
      adminUserId,
    );
    const request = await assertWithdrawalRequestApplied(
      userJar,
      userWallet,
      requestedAsset,
    );

    await assertWithdrawalRequestReplay(
      userJar,
      userWallet,
      requestedAsset,
      request,
    );
    await assertWithdrawalRequestConflict(
      userJar,
      userWallet,
      requestedAsset,
      request,
    );
    await assertOpenRequestBlocked(
      userJar,
      userWallet,
      requestedAsset,
    );

    const cancelAsset = await createFundedAsset(
      suffix,
      "B",
      userWallet,
      adminUserId,
    );
    await assertUserCancel(userJar, adminJar, userWallet, cancelAsset);

    const reserveAsset = await createFundedAsset(
      suffix,
      "C",
      userWallet,
      adminUserId,
    );
    await assertAdminReserve(adminJar, userJar, userWallet, reserveAsset);

    const approveAsset = await createFundedAsset(
      suffix,
      "D",
      userWallet,
      adminUserId,
    );
    await assertAdminApprove(adminJar, userJar, userWallet, approveAsset);

    await assertAdminCancelRequested(
      adminJar,
      userJar,
      userWallet,
      await createFundedAsset(suffix, "E", userWallet, adminUserId),
    );
    await assertAdminCancelReserved(
      adminJar,
      userJar,
      userWallet,
      await createFundedAsset(suffix, "F", userWallet, adminUserId),
    );
    await assertAdminCancelApproved(
      adminJar,
      userJar,
      userWallet,
      await createFundedAsset(suffix, "G", userWallet, adminUserId),
    );

    await assertTargetStateGuards(
      adminJar,
      userJar,
      userId,
      userWallet,
      suffix,
      adminUserId,
    );
    await assertAdminCancelAllowsInactiveTarget(
      adminJar,
      userJar,
      userId,
      userWallet,
      suffix,
      adminUserId,
    );
    await assertReadRpcsAndAudit(adminUserId, userId);
    await assertInactiveUserReadBlocked(userJar, userId);
    await assertAdminOwnWalletUnaffected(adminWallet);
    await assertFactorSecretNotPrinted(enrollment);

    await logout(adminJar);
    await logout(userJar);

    pass("Withdrawal state machine integration");
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
  const command = npmStatusCommand();
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

function npmStatusCommand() {
  return process.platform === "win32"
    ? {
        file: "cmd.exe",
        args: ["/c", "npm", "run", "supabase:status", "--", "-o", "json"],
      }
    : {
        file: "npm",
        args: ["run", "supabase:status", "--", "-o", "json"],
      };
}

async function assertPublicSmoke() {
  await assertStatus("/api/v1/health", 200, "Health 200");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness 200");
  await assertStatus("/", 200, "Landing 200");

  const withdrawals = await appFetch("/withdrawals", { redirect: "manual" });
  assertRedirectPath(withdrawals, "/auth/sign-in", "Anonymous withdrawals");

  const adminWithdrawals = await appFetch("/admin/withdrawals", {
    redirect: "manual",
  });
  assertRedirectPath(
    adminWithdrawals,
    "/auth/sign-in",
    "Anonymous admin withdrawals",
  );
  await assertMailpitReady();
  await assertDatabaseReady();
  pass("Withdrawal public smoke");
}

async function assertSameOriginRejectionsWithoutSession() {
  const before = await withdrawalAuditCount();
  const createBody = {
    wallet_account_id: randomUUID(),
    wallet_expected_version: "1",
    asset_id: randomUUID(),
    asset_expected_version: "1",
    units: "1",
    command_id: randomUUID(),
  };
  const commandBody = {
    withdrawal_request_id: randomUUID(),
    request_expected_version: "1",
    command_id: randomUUID(),
    reason: "origin rejected",
  };

  for (const [path, body] of [
    ["/api/v1/withdrawals/create", createBody],
    ["/api/v1/withdrawals/cancel", commandBody],
    ["/api/v1/admin/withdrawals/reserve", commandBody],
    ["/api/v1/admin/withdrawals/approve", commandBody],
    ["/api/v1/admin/withdrawals/cancel", commandBody],
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

      assertRedirectHasCode(
        response,
        "request_rejected",
        "Origin rejection",
      );
    }
  }

  assert((await withdrawalAuditCount()) === before, "Origin no audit");
  pass("Withdrawal same-origin rejection");
}

async function assertGeneralUserBlocked(jar, userId) {
  const page = await appFetch("/admin/withdrawals", {
    jar,
    redirect: "manual",
  });
  assertRedirectHasCode(page, "admin_forbidden", "USER admin withdrawals page");

  const response = await submitAdminReserve(jar, {
    withdrawalRequestId: randomUUID(),
    requestExpectedVersion: 1,
    commandId: randomUUID(),
    reason: "user blocked",
  });
  assertRedirectHasCode(response, "admin_forbidden", "USER admin reserve API");

  const direct = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform *
      from public.reserve_user_payout_request(
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

  assert(direct === "denied", "USER admin withdrawal RPC denied");
  pass("General USER withdrawal admin blocked");
}

async function assertAal1AdminBlocked(jar, adminUserId) {
  const page = await appFetch("/admin/withdrawals", {
    jar,
    redirect: "manual",
  });
  assertRedirectPath(page, "/auth/mfa/enroll", "AAL1 admin withdrawals page");

  const response = await submitAdminReserve(jar, {
    withdrawalRequestId: randomUUID(),
    requestExpectedVersion: 1,
    commandId: randomUUID(),
    reason: "aal1 blocked",
  });
  assertRedirectPath(response, "/auth/mfa/enroll", "AAL1 admin reserve API");

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
      from public.reserve_user_payout_request(
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

  assert(direct === "denied", "AAL1 admin withdrawal RPC denied");
  pass("AAL1 admin withdrawal blocked");
}

async function assertUserWithdrawalsPage(jar) {
  const response = await appFetch("/withdrawals", {
    jar,
    redirect: "manual",
  });
  const body = await response.text();

  assert(response.status === 200, "User withdrawals page 200");
  assert(body.includes("Withdrawal requests"), "Withdrawals title");
  assert(body.includes("Available Atomic Units"), "Available units UI");
  assert(!body.includes("Withdrawal Address"), "No withdrawal address label");
  assert(!body.includes("Transaction ID"), "No transaction id label");
  assertNoSensitiveBody(body, "User withdrawals body");
  pass("User withdrawals page");
}

async function assertAdminWithdrawalsPage(jar) {
  const response = await appFetch("/admin/withdrawals", {
    jar,
    redirect: "manual",
  });
  const body = await response.text();

  assert(response.status === 200, "Admin withdrawals page 200");
  assert(body.includes("Withdrawal operations"), "Admin withdrawals title");
  assert(body.includes("State machine"), "Admin withdrawals state machine");
  assert(!body.includes("request_data"), "No request_data dump");
  assert(!body.includes("Transaction ID"), "No transaction id label");
  assertNoSensitiveBody(body, "Admin withdrawals body");
  pass("Admin withdrawals page");
}

async function assertInputRejections(userJar, adminJar, wallet) {
  const before = await withdrawalAuditCount();
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
    const response = await submitWithdrawalCreate(userJar, input);

    assertRedirectHasCode(response, "invalid_input", "Create input rejected");
  }

  for (const response of [
    await submitUserCancel(userJar, {}),
    await submitUserCancel(userJar, {
      withdrawalRequestId: "bad",
      requestExpectedVersion: 1,
      commandId: randomUUID(),
      reason: "bad id",
    }),
    await submitAdminReserve(adminJar, {
      withdrawalRequestId: randomUUID(),
      requestExpectedVersion: 0,
      commandId: randomUUID(),
      reason: "bad version",
    }),
    await submitAdminApprove(adminJar, {
      withdrawalRequestId: randomUUID(),
      requestExpectedVersion: 1,
      commandId: randomUUID(),
      reason: "",
    }),
    await submitAdminCancel(adminJar, {
      withdrawalRequestId: randomUUID(),
      requestExpectedVersion: 1,
      commandId: randomUUID(),
      reason: "line\nbreak",
    }),
  ]) {
    assertRedirectHasCode(response, "invalid_input", "Command input rejected");
  }

  assert((await withdrawalAuditCount()) === before, "Input rejection no audit");
  pass("Withdrawal input rejection");
}

async function assertWithdrawalRequestApplied(jar, wallet, asset) {
  const commandId = randomUUID();
  const walletVersion = await readWalletVersion(wallet.id);
  const response = await submitWithdrawalCreate(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: walletVersion,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "300",
    commandId,
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_created",
    "Withdrawal create",
  );

  const state = await readWithdrawalState(commandId);

  assert(state.requests === 1, "Withdrawal request count");
  assert(state.journals === 0, "Withdrawal request journal count");
  assert(state.entries === 0, "Withdrawal request entry count");
  assert(state.auditApplied === 1, "Withdrawal request audit count");
  assert(state.status === "REQUESTED", "Withdrawal request status");
  assert(state.available === "1000", "Available unchanged");
  assert(state.pending === "0", "Pending unchanged");
  assert(state.custody === "1000", "Custody unchanged");
  assert(state.clearing === "0", "Clearing unchanged");
  pass("Withdrawal request applied");

  return {
    commandId,
    withdrawalRequestId: state.withdrawalRequestId,
    walletId: wallet.id,
    walletVersion,
    assetId: asset.id,
    units: "300",
    version: state.version,
  };
}

async function assertWithdrawalRequestReplay(jar, wallet, asset, withdrawal) {
  const before = await readWithdrawalState(withdrawal.commandId);
  const response = await submitWithdrawalCreate(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: withdrawal.walletVersion,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: withdrawal.units,
    commandId: withdrawal.commandId,
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_created",
    "Withdrawal replay",
  );

  const after = await readWithdrawalState(withdrawal.commandId);

  assert(after.requests === before.requests, "Replay no request");
  assert(after.journals === before.journals, "Replay no journal");
  assert(after.auditApplied === before.auditApplied, "Replay no audit");
  assert(after.available === before.available, "Replay no balance change");
  pass("Withdrawal request replay");
}

async function assertWithdrawalRequestConflict(jar, wallet, asset, withdrawal) {
  const before = await totalWithdrawalAuditCount();
  const response = await submitWithdrawalCreate(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: withdrawal.walletVersion,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "301",
    commandId: withdrawal.commandId,
  });

  assertRedirectHasCode(
    response,
    "withdrawal_command_conflict",
    "Withdrawal conflict",
  );
  assert((await totalWithdrawalAuditCount()) === before, "Conflict no audit");
  pass("Withdrawal request conflict");
}

async function assertOpenRequestBlocked(jar, wallet, asset) {
  const before = await totalWithdrawalAuditCount();
  const response = await submitWithdrawalCreate(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: await readWalletVersion(wallet.id),
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "1",
    commandId: randomUUID(),
  });

  assertRedirectHasCode(
    response,
    "withdrawal_request_already_open",
    "Open withdrawal blocked",
  );
  assert((await totalWithdrawalAuditCount()) === before, "Open block no audit");
  pass("Withdrawal open request blocked");
}

async function assertUserCancel(userJar, adminJar, wallet, asset) {
  const createCommandId = randomUUID();
  await submitAndAssertCreate(userJar, wallet, asset, "40", createCommandId);
  const state = await readWithdrawalState(createCommandId);

  const otherResponse = await submitUserCancel(adminJar, {
    withdrawalRequestId: state.withdrawalRequestId,
    requestExpectedVersion: state.version,
    commandId: randomUUID(),
    reason: "other user cancel attempt",
  });
  assertRedirectHasCode(
    otherResponse,
    "withdrawal_request_forbidden",
    "Other cancel",
  );

  const cancelCommandId = randomUUID();
  const response = await submitUserCancel(userJar, {
    withdrawalRequestId: state.withdrawalRequestId,
    requestExpectedVersion: state.version,
    commandId: cancelCommandId,
    reason: "user requested cancellation",
  });
  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_canceled",
    "User cancel",
  );

  const canceled = await readWithdrawalState(createCommandId);

  assert(canceled.status === "CANCELED", "User cancel status");
  assert(canceled.journals === 0, "User cancel no journal");
  assert(canceled.available === "1000", "User cancel available unchanged");
  assert(canceled.pending === "0", "User cancel pending zero");
  assert(canceled.custody === "1000", "User cancel custody unchanged");
  assert(canceled.cancelAuditApplied === 1, "User cancel audit");

  const replay = await submitUserCancel(userJar, {
    withdrawalRequestId: state.withdrawalRequestId,
    requestExpectedVersion: state.version,
    commandId: cancelCommandId,
    reason: "user requested cancellation",
  });
  assertRedirectParam(
    replay,
    "result",
    "withdrawal_request_canceled",
    "User cancel replay",
  );

  const noop = await submitUserCancel(userJar, {
    withdrawalRequestId: state.withdrawalRequestId,
    requestExpectedVersion: canceled.version,
    commandId: randomUUID(),
    reason: "already canceled",
  });
  assertRedirectParam(
    noop,
    "result",
    "withdrawal_request_cancel_noop",
    "User cancel noop",
  );

  pass("User withdrawal cancel");
}

async function assertAdminReserve(adminJar, userJar, wallet, asset) {
  const withdrawal = await createRequestFixture(userJar, wallet, asset, "120");
  const reserveCommandId = randomUUID();
  const response = await submitAdminReserve(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: withdrawal.version,
    commandId: reserveCommandId,
    reason: "reserve local funds",
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_reserved",
    "Admin reserve",
  );

  const reserved = await readWithdrawalState(withdrawal.commandId);

  assert(reserved.status === "RESERVED", "Reserve status");
  assert(reserved.reserveEntries === 2, "Reserve entry count");
  assert(reserved.reserveAuditApplied === 1, "Reserve audit");
  assert(reserved.available === "880", "Reserve available down");
  assert(reserved.pending === "120", "Reserve pending up");
  assert(reserved.custody === "1000", "Reserve custody unchanged");
  assert(reserved.clearing === "0", "Reserve clearing unchanged");

  const replay = await submitAdminReserve(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: withdrawal.version,
    commandId: reserveCommandId,
    reason: "reserve local funds",
  });
  assertRedirectParam(
    replay,
    "result",
    "withdrawal_request_reserved",
    "Reserve replay",
  );

  const noop = await submitAdminReserve(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: reserved.version,
    commandId: randomUUID(),
    reason: "already reserved",
  });
  assertRedirectParam(
    noop,
    "result",
    "withdrawal_request_reserve_noop",
    "Reserve noop",
  );

  const userCancel = await submitUserCancel(userJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: reserved.version,
    commandId: randomUUID(),
    reason: "user cannot cancel reserved",
  });
  assertRedirectHasCode(
    userCancel,
    "withdrawal_request_not_user_cancelable",
    "User reserved cancel blocked",
  );

  pass("Admin withdrawal reserve");
}

async function assertAdminApprove(adminJar, userJar, wallet, asset) {
  const withdrawal = await createRequestFixture(userJar, wallet, asset, "210");
  await submitAndAssertReserve(adminJar, withdrawal, "reserve before approval");
  const reserved = await readWithdrawalState(withdrawal.commandId);

  const approveCommandId = randomUUID();
  const response = await submitAdminApprove(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: reserved.version,
    commandId: approveCommandId,
    reason: "approve local withdrawal",
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_approved",
    "Admin approve",
  );

  const approved = await readWithdrawalState(withdrawal.commandId);

  assert(approved.status === "APPROVED", "Approve status");
  assert(approved.approveEntries === 2, "Approve entry count");
  assert(approved.approveAuditApplied === 1, "Approve audit");
  assert(approved.available === "790", "Approve available retained");
  assert(approved.pending === "0", "Approve pending down");
  assert(approved.total === "790", "Approve user liability reduced");
  assert(approved.custody === "1000", "Approve custody unchanged");
  assert(approved.clearing === "-210", "Approve clearing credit");

  const replay = await submitAdminApprove(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: reserved.version,
    commandId: approveCommandId,
    reason: "approve local withdrawal",
  });
  assertRedirectParam(
    replay,
    "result",
    "withdrawal_request_approved",
    "Approve replay",
  );

  const noop = await submitAdminApprove(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: approved.version,
    commandId: randomUUID(),
    reason: "already approved",
  });
  assertRedirectParam(
    noop,
    "result",
    "withdrawal_request_approve_noop",
    "Approve noop",
  );

  const userCancel = await submitUserCancel(userJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: approved.version,
    commandId: randomUUID(),
    reason: "user cannot cancel approved",
  });
  assertRedirectHasCode(
    userCancel,
    "withdrawal_request_not_user_cancelable",
    "User approved cancel blocked",
  );

  pass("Admin withdrawal approve");
}

async function assertAdminCancelRequested(adminJar, userJar, wallet, asset) {
  const withdrawal = await createRequestFixture(userJar, wallet, asset, "50");
  const response = await submitAdminCancel(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: withdrawal.version,
    commandId: randomUUID(),
    reason: "admin cancels requested",
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_canceled",
    "Admin cancel requested",
  );

  const canceled = await readWithdrawalState(withdrawal.commandId);

  assert(canceled.status === "CANCELED", "Requested cancel status");
  assert(canceled.cancelEntries === 0, "Requested cancel no entry");
  assert(canceled.available === "1000", "Requested cancel available unchanged");
  assert(canceled.pending === "0", "Requested cancel pending zero");
  pass("Admin requested cancel");
}

async function assertAdminCancelReserved(adminJar, userJar, wallet, asset) {
  const withdrawal = await createRequestFixture(userJar, wallet, asset, "60");
  await submitAndAssertReserve(adminJar, withdrawal, "reserve before cancel");
  const reserved = await readWithdrawalState(withdrawal.commandId);
  const response = await submitAdminCancel(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: reserved.version,
    commandId: randomUUID(),
    reason: "admin cancels reserved",
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_canceled",
    "Admin cancel reserved",
  );

  const canceled = await readWithdrawalState(withdrawal.commandId);

  assert(canceled.status === "CANCELED", "Reserved cancel status");
  assert(canceled.cancelEntries === 2, "Reserved cancel entry count");
  assert(canceled.available === "1000", "Reserved cancel restores available");
  assert(canceled.pending === "0", "Reserved cancel clears pending");
  assert(canceled.clearing === "0", "Reserved cancel clearing unchanged");
  pass("Admin reserved cancel");
}

async function assertAdminCancelApproved(adminJar, userJar, wallet, asset) {
  const withdrawal = await createRequestFixture(userJar, wallet, asset, "70");
  await submitAndAssertReserve(adminJar, withdrawal, "reserve before approve");
  const reserved = await readWithdrawalState(withdrawal.commandId);
  await submitAndAssertApprove(adminJar, withdrawal.withdrawalRequestId, reserved.version);
  const approved = await readWithdrawalState(withdrawal.commandId);
  const response = await submitAdminCancel(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: approved.version,
    commandId: randomUUID(),
    reason: "admin cancels approved local state",
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_canceled",
    "Admin cancel approved",
  );

  const canceled = await readWithdrawalState(withdrawal.commandId);

  assert(canceled.status === "CANCELED", "Approved cancel status");
  assert(canceled.cancelEntries === 2, "Approved cancel entry count");
  assert(canceled.available === "1000", "Approved cancel restores available");
  assert(canceled.pending === "0", "Approved cancel pending zero");
  assert(canceled.clearing === "0", "Approved cancel reverses clearing");
  assert(canceled.custody === "1000", "Approved cancel custody unchanged");
  pass("Admin approved cancel");
}

async function assertTargetStateGuards(
  adminJar,
  userJar,
  userId,
  wallet,
  suffix,
  adminUserId,
) {
  const profileAsset = await createFundedAsset(
    suffix,
    "H",
    wallet,
    adminUserId,
  );
  const profileWithdrawal = await createRequestFixture(
    userJar,
    wallet,
    profileAsset,
    "10",
  );

  await setProfileStatus(userId, "RESTRICTED");
  await assertAdminReserveCode(
    adminJar,
    profileWithdrawal,
    "withdrawal_target_profile_not_active",
  );
  await setProfileStatus(userId, "ACTIVE");

  const walletAsset = await createFundedAsset(suffix, "I", wallet, adminUserId);
  const walletWithdrawal = await createRequestFixture(
    userJar,
    wallet,
    walletAsset,
    "10",
  );

  await setWalletStatus(wallet.id, "FROZEN");
  await assertAdminReserveCode(
    adminJar,
    walletWithdrawal,
    "withdrawal_target_wallet_not_active",
  );
  await setWalletStatus(wallet.id, "ACTIVE");

  const asset = await createFundedAsset(suffix, "J", wallet, adminUserId);
  const assetWithdrawal = await createRequestFixture(userJar, wallet, asset, "10");

  await setAssetStatus(asset.id, "SUSPENDED");
  await assertAdminReserveCode(
    adminJar,
    assetWithdrawal,
    "withdrawal_target_asset_not_active",
  );
  await setAssetStatus(asset.id, "ACTIVE");

  pass("Withdrawal target state guards");
}

async function assertAdminCancelAllowsInactiveTarget(
  adminJar,
  userJar,
  userId,
  wallet,
  suffix,
  adminUserId,
) {
  const asset = await createFundedAsset(suffix, "K", wallet, adminUserId);
  const withdrawal = await createRequestFixture(userJar, wallet, asset, "10");

  await setProfileStatus(userId, "SUSPENDED");
  const response = await submitAdminCancel(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: withdrawal.version,
    commandId: randomUUID(),
    reason: "cleanup inactive target",
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_canceled",
    "Admin cancel inactive target",
  );
  await setProfileStatus(userId, "ACTIVE");
  pass("Admin cancel inactive target allowed");
}

async function assertReadRpcsAndAudit(adminUserId, userId) {
  const userRead = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal1')::text,
      false
    );
    set role authenticated;
    select count(*)::text
    from public.list_current_user_withdrawal_requests(50);
  `);
  const adminRead = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(adminUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(adminUserId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    select count(*)::text
    from public.list_admin_withdrawal_requests(100);
  `);
  const auditRead = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(adminUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(adminUserId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    select count(*)::text
    from public.list_withdrawal_command_audit_events(50);
  `);
  const immutable = await sqlScalar(`
    do $$
    declare
      v_event_id uuid;
    begin
      select id into v_event_id
      from private.withdrawal_command_audit_events
      limit 1;

      update private.withdrawal_command_audit_events
      set reason = 'mutated'
      where id = v_event_id;

      raise exception 'expected immutability failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;
    select 'immutable';
  `);

  assert(Number(userRead) > 0, "User withdrawal read");
  assert(Number(adminRead) > 0, "Admin withdrawal read");
  assert(Number(auditRead) > 0, "Admin withdrawal audit read");
  assert(immutable === "immutable", "Withdrawal audit immutable");
  pass("Withdrawal reads and audit");
}

async function assertInactiveUserReadBlocked(jar, userId) {
  await setProfileStatus(userId, "SUSPENDED");

  const response = await appFetch("/withdrawals", {
    jar,
    redirect: "manual",
  });

  assertRedirectPath(response, "/auth/account-unavailable", "Inactive withdrawals");
  await setProfileStatus(userId, "ACTIVE");
  pass("Inactive user withdrawal read blocked");
}

async function assertAdminOwnWalletUnaffected(wallet) {
  const hasNoWithdrawalRows = await sqlScalar(`
    select count(*)::text
    from private.withdrawal_requests
    where wallet_account_id = ${sqlLiteral(wallet.id)}::uuid;
  `);

  assert(hasNoWithdrawalRows === "0", "Admin wallet unaffected");
  pass("Admin wallet untouched by target commands");
}

async function submitAndAssertCreate(jar, wallet, asset, units, commandId) {
  const response = await submitWithdrawalCreate(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: await readWalletVersion(wallet.id),
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units,
    commandId,
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_created",
    "Create fixture",
  );
}

async function createRequestFixture(jar, wallet, asset, units) {
  const commandId = randomUUID();

  await submitAndAssertCreate(jar, wallet, asset, units, commandId);

  const state = await readWithdrawalState(commandId);

  return {
    commandId,
    withdrawalRequestId: state.withdrawalRequestId,
    version: state.version,
  };
}

async function submitAndAssertReserve(adminJar, withdrawal, reason) {
  const response = await submitAdminReserve(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: withdrawal.version,
    commandId: randomUUID(),
    reason,
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_reserved",
    "Reserve fixture",
  );
}

async function submitAndAssertApprove(adminJar, withdrawalRequestId, version) {
  const response = await submitAdminApprove(adminJar, {
    withdrawalRequestId,
    requestExpectedVersion: version,
    commandId: randomUUID(),
    reason: "approve fixture",
  });

  assertRedirectParam(
    response,
    "result",
    "withdrawal_request_approved",
    "Approve fixture",
  );
}

async function assertAdminReserveCode(adminJar, withdrawal, code) {
  const response = await submitAdminReserve(adminJar, {
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    requestExpectedVersion: withdrawal.version,
    commandId: randomUUID(),
    reason: "state guard",
  });

  assertRedirectHasCode(response, code, "Reserve state guard");
}

async function createFundedAsset(suffix, label, wallet, adminUserId) {
  const asset = await createQaAsset(suffix, label, "ACTIVE");

  await postOpeningBalance(adminUserId, wallet, asset, "1000");

  return asset;
}

async function createQaAsset(suffix, label, status) {
  const assetCode = `WDR_${label}_${suffix.slice(0, 12).toUpperCase()}`.slice(0, 32);
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
        ${sqlLiteral(`W${label}`.slice(0, 12))},
        ${sqlLiteral(`Withdrawal QA Asset ${label}`)},
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

async function postOpeningBalance(adminUserId, wallet, asset, units) {
  const result = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(adminUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(adminUserId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    select result_code
    from public.post_opening_balance(
      ${sqlLiteral(wallet.id)}::uuid,
      ${await readWalletVersion(wallet.id)},
      ${sqlLiteral(asset.id)}::uuid,
      ${asset.version},
      ${sqlLiteral(units)},
      ${sqlLiteral(randomUUID())}::uuid,
      'local withdrawal e2e opening balance'
    );
  `);

  assert(result === "APPLIED", "Opening balance fixture");
}

async function readWithdrawalState(commandId) {
  const payload = await sqlScalar(`
    with request_event as (
      select events.withdrawal_request_id
      from private.withdrawal_command_audit_events as events
      where events.command_id = ${sqlLiteral(commandId)}::uuid
      limit 1
    ),
    request_row as (
      select requests.*
      from private.withdrawal_requests as requests
      where requests.id = (select withdrawal_request_id from request_event)
    ),
    related_journals as (
      select journals.*
      from private.ledger_journals as journals
      where journals.reference_type = 'WITHDRAWAL_REQUEST'
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
      left join private.ledger_account_balances as balances
        on balances.ledger_account_id = accounts.id
    )
    select json_build_object(
      'withdrawalRequestId', (select id::text from request_row),
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
        where journal_id in (select id from related_journals)
      ),
      'reserveEntries', (
        select count(*)
        from private.ledger_entries
        where journal_id = (select reservation_journal_id from request_row)
      ),
      'approveEntries', (
        select count(*)
        from private.ledger_entries
        where journal_id = (select approval_journal_id from request_row)
      ),
      'cancelEntries', (
        select count(*)
        from private.ledger_entries
        where journal_id = (select cancellation_journal_id from request_row)
      ),
      'auditApplied', (
        select count(*)
        from private.withdrawal_command_audit_events
        where command_id = ${sqlLiteral(commandId)}::uuid
          and action = 'CREATE_WITHDRAWAL_REQUEST'
          and outcome = 'APPLIED'
      ),
      'reserveAuditApplied', (
        select count(*)
        from private.withdrawal_command_audit_events
        where withdrawal_request_id = (select id from request_row)
          and action = 'RESERVE_WITHDRAWAL_REQUEST'
          and outcome = 'APPLIED'
      ),
      'approveAuditApplied', (
        select count(*)
        from private.withdrawal_command_audit_events
        where withdrawal_request_id = (select id from request_row)
          and action = 'APPROVE_WITHDRAWAL_REQUEST'
          and outcome = 'APPLIED'
      ),
      'cancelAuditApplied', (
        select count(*)
        from private.withdrawal_command_audit_events
        where withdrawal_request_id = (select id from request_row)
          and action = 'CANCEL_WITHDRAWAL_REQUEST'
          and outcome = 'APPLIED'
      ),
      'available', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'USER_AVAILABLE'
      ), '0'),
      'pending', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'USER_PENDING_WITHDRAWAL'
      ), '0'),
      'total', coalesce((
        select total_liability_units::text
        from private.wallet_asset_ledger_balances
        where wallet_account_id = (select wallet_account_id from request_row)
          and asset_id = (select asset_id from request_row)
      ), '0'),
      'custody', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'SYSTEM_CUSTODY'
      ), '0'),
      'clearing', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'SYSTEM_WITHDRAWAL_CLEARING'
      ), '0')
    )::text;
  `);

  return parseJsonRow(payload, "Withdrawal state");
}

async function signUpConfirmAndSignIn(email, password, nextPath) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA Withdrawal",
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
  pass("Withdrawal command MFA ready");

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
  const signInResult = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInResult.error) {
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

async function submitWithdrawalCreate(
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
  return appFetch("/api/v1/withdrawals/create", {
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
  { withdrawalRequestId, requestExpectedVersion, commandId, reason },
) {
  return appFetch("/api/v1/withdrawals/cancel", {
    method: "POST",
    jar,
    body: {
      withdrawal_request_id: withdrawalRequestId,
      request_expected_version: requestExpectedVersion,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitAdminReserve(
  jar,
  { withdrawalRequestId, requestExpectedVersion, commandId, reason },
) {
  return appFetch("/api/v1/admin/withdrawals/reserve", {
    method: "POST",
    jar,
    body: {
      withdrawal_request_id: withdrawalRequestId,
      request_expected_version: requestExpectedVersion,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitAdminApprove(
  jar,
  { withdrawalRequestId, requestExpectedVersion, commandId, reason },
) {
  return appFetch("/api/v1/admin/withdrawals/approve", {
    method: "POST",
    jar,
    body: {
      withdrawal_request_id: withdrawalRequestId,
      request_expected_version: requestExpectedVersion,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitAdminCancel(
  jar,
  { withdrawalRequestId, requestExpectedVersion, commandId, reason },
) {
  return appFetch("/api/v1/admin/withdrawals/cancel", {
    method: "POST",
    jar,
    body: {
      withdrawal_request_id: withdrawalRequestId,
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
    values (${sqlLiteral(userId)}::uuid, 'ADMIN', 'local withdrawal command e2e bootstrap')
    on conflict (user_id, role) where revoked_at is null do nothing;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === "1", "Bootstrap ADMIN role");
}

async function setProfileStatus(userId, status) {
  const changed = await sqlScalar(`
    update public.profiles
    set account_status = ${sqlLiteral(status)}
    where id = ${sqlLiteral(userId)}::uuid;

    select account_status
    from public.profiles
    where id = ${sqlLiteral(userId)}::uuid;
  `);

  assert(changed === status, `Profile status ${status}`);
}

async function setWalletStatus(walletId, status) {
  const changed = await sqlScalar(`
    update public.wallet_accounts
    set
      status = ${sqlLiteral(status)},
      closed_at = case
        when ${sqlLiteral(status)} = 'CLOSED' then clock_timestamp()
        else null
      end
    where id = ${sqlLiteral(walletId)}::uuid;

    select status
    from public.wallet_accounts
    where id = ${sqlLiteral(walletId)}::uuid;
  `);

  assert(changed === status, `Wallet status ${status}`);
}

async function setAssetStatus(assetId, status) {
  const changed = await sqlScalar(`
    update public.supported_assets
    set status = ${sqlLiteral(status)}
    where id = ${sqlLiteral(assetId)}::uuid;

    select status
    from public.supported_assets
    where id = ${sqlLiteral(assetId)}::uuid;
  `);

  assert(changed === status, `Asset status ${status}`);
}

async function withdrawalAuditCount() {
  return Number(
    await sqlScalar("select count(*)::text from private.withdrawal_command_audit_events;"),
  );
}

async function totalWithdrawalAuditCount() {
  return Number(
    await sqlScalar("select count(*)::text from private.withdrawal_command_audit_events;"),
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
    "withdrawal_request_id",
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
    "Withdrawal Address",
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
    console.error(redactDiagnostic(message));
  } else {
    console.error(
      `FAIL withdrawal state machine integration: ${redactDiagnostic(message)}`,
    );
  }

  process.exitCode = 1;
});
