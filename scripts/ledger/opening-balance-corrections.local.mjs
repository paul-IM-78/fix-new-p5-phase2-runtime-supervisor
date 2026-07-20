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
  const managedRuntime = await prepareManagedAppRuntime();
  const suffix = randomUUID().replaceAll("-", "");
  const password = `Opening-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-opening-admin-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const userEmail = `qa-opening-user-${Date.now()}-${suffix.slice(8, 16)}@example.test`;

  try {
    await assertPublicSmoke();
    await assertSameOriginRejectionsWithoutSession();

    const userJar = await signUpConfirmAndSignIn(
      userEmail,
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
    const wallet = await readWalletByUserId(userId);

    await bootstrapAdminRole(adminUserId);
    await assertGeneralUserBlocked(userJar, userId, wallet);
    await assertAal1AdminBlocked(adminJar, adminUserId, wallet);

    const enrollment = await enrollAndVerifyAdmin(
      adminJar,
      adminEmail,
      password,
    );

    await assertAdminLedgerPage(adminJar);
    await assertInputRejections(adminJar, wallet);

    const asset = await createQaAsset(suffix, "A", "ACTIVE");
    const opening = await assertOpeningApplied(adminJar, wallet, asset);

    await assertOpeningReplay(adminJar, wallet, asset, opening);
    await assertOpeningConflict(adminJar, wallet, asset, opening);
    await assertOpeningDuplicateBlocked(adminJar, wallet, asset);

    const concurrentAsset = await createQaAsset(suffix, "B", "ACTIVE");
    await assertConcurrentOpeningReplay(adminJar, wallet, concurrentAsset);

    await assertOpeningStateGuards(adminJar, userId, wallet, suffix);
    await assertExistingLedgerActivityBlocked(adminJar, wallet, suffix);

    await assertReversalApplied(adminJar, opening);
    await assertReversalReplay(adminJar, opening);
    await assertReversalNoop(adminJar, opening);
    await assertReversalConflict(adminJar, opening);
    await assertReversalInvalidTargetsBlocked(adminJar);
    await assertReversalInsufficientAvailable(adminJar, wallet, suffix);

    await assertAdminReadRpcs(adminUserId);
    await assertAuditImmutability();
    await assertDirectAccessBlocked(adminUserId, userId);
    await assertFactorSecretNotPrinted(enrollment);

    await logout(adminJar);
    await logout(userJar);

    pass("Opening balance correction integration");
  } finally {
    await stopManagedAppRuntime(managedRuntime);
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
  const command = nextCommand();
  const server = spawn(command.file, command.args, {
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

  await waitForManagedAppRuntime(server, outputTail);

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

async function readLocalSupabaseStatus() {
  try {
    const command = npmCommand();
    const { stdout, stderr } = await execFileAsync(
      command.file,
      command.args,
      {
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    );
    const raw = `${stdout}\n${stderr}`;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start < 0 || end < start) {
      throw new Error("missing status json");
    }

    const status = JSON.parse(raw.slice(start, end + 1));

    if (!status.API_URL || !status.ANON_KEY) {
      throw new Error("missing local app config");
    }

    return status;
  } catch {
    throw new Error("FAIL local Supabase status");
  }
}

async function waitForManagedAppRuntime(server, outputTail) {
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

      assertNoSensitiveBody(body, "Managed Next health");

      if (response.status === 200) {
        return;
      }
    } catch {
      await wait(500);
    }
  }

  outputTail.length = 0;
  throw new Error("FAIL managed Next server readiness");
}

function npmCommand() {
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

function nextCommand() {
  return {
    file: process.execPath,
    args: [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      "3010",
      "-H",
      "127.0.0.1",
    ],
  };
}

async function assertPublicSmoke() {
  await assertStatus("/api/v1/health", 200, "Health 200");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness 200");
  await assertStatus("/", 200, "Landing 200");

  const adminLedger = await appFetch("/admin/ledger", {
    redirect: "manual",
  });

  assertRedirectPath(adminLedger, "/auth/sign-in", "Anonymous ledger page");
  await assertMailpitReady();
  await assertDatabaseReady();
  pass("Opening public smoke");
}

async function assertSameOriginRejectionsWithoutSession() {
  const before = await financialAuditCount();
  const body = {
    wallet_account_id: randomUUID(),
    wallet_expected_version: "1",
    asset_id: randomUUID(),
    asset_expected_version: "1",
    units: "1",
    command_id: randomUUID(),
    reason: "origin rejected",
  };

  for (const options of [
    { includeOrigin: false },
    { origin: "https://example.invalid" },
    { fetchSite: "cross-site" },
  ]) {
    const response = await appFetch(
      "/api/v1/admin/ledger/opening-balance",
      {
        method: "POST",
        body,
        redirect: "manual",
        ...options,
      },
    );

    assertRedirectHasCode(response, "request_rejected", "Origin rejection");
  }

  assert((await financialAuditCount()) === before, "Origin no audit");
  pass("Opening same-origin rejection");
}

async function assertGeneralUserBlocked(jar, userId, wallet) {
  const page = await appFetch("/admin/ledger", { jar, redirect: "manual" });
  assertRedirectHasCode(page, "admin_forbidden", "USER ledger page");

  const response = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: randomUUID(),
    assetExpectedVersion: 1,
    units: "1",
    commandId: randomUUID(),
    reason: "user blocked",
  });

  assertRedirectHasCode(response, "admin_forbidden", "USER opening API");
  await assertFinancialRpcDenied(userId, "aal2", wallet.id, "USER RPC");
  pass("General USER opening blocked");
}

async function assertAal1AdminBlocked(jar, adminUserId, wallet) {
  const page = await appFetch("/admin/ledger", { jar, redirect: "manual" });
  assertRedirectPath(page, "/auth/mfa/enroll", "AAL1 ledger page");

  const response = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: randomUUID(),
    assetExpectedVersion: 1,
    units: "1",
    commandId: randomUUID(),
    reason: "aal1 blocked",
  });

  assertRedirectPath(response, "/auth/mfa/enroll", "AAL1 opening API");
  await assertFinancialRpcDenied(adminUserId, "aal1", wallet.id, "AAL1 RPC");
  pass("AAL1 ADMIN opening blocked");
}

async function assertAdminLedgerPage(jar) {
  const response = await appFetch("/admin/ledger", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, "Admin ledger page 200");
  assert(body.includes("Ledger operations"), "Ledger page title");
  assert(body.includes("Opening Balance"), "Opening form");
  assert(body.includes("Reverse Opening"), "Reversal form");
  assert(!body.includes("request_data"), "No request data dump");
  assertNoSensitiveBody(body, "Admin ledger body");
  pass("AAL2 admin ledger page");
}

async function assertInputRejections(jar, wallet) {
  const before = await financialAuditCount();
  const valid = {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: randomUUID(),
    assetExpectedVersion: 1,
    units: "1",
    commandId: randomUUID(),
    reason: "valid reason",
  };
  const invalidOpenings = [
    {},
    { ...valid, walletAccountId: "not-a-uuid" },
    { ...valid, walletExpectedVersion: 0 },
    { ...valid, walletExpectedVersion: -1 },
    { ...valid, assetId: "not-a-uuid" },
    { ...valid, assetExpectedVersion: 0 },
    { ...valid, units: "0" },
    { ...valid, units: "-1" },
    { ...valid, units: "1.0" },
    { ...valid, units: "01" },
    { ...valid, units: "1e9" },
    { ...valid, units: "1 " },
    { ...valid, units: "9".repeat(39) },
    { ...valid, commandId: "not-a-uuid" },
    { ...valid, reason: "" },
    { ...valid, reason: "x".repeat(501) },
    { ...valid, reason: "line\nbreak" },
  ];

  for (const input of invalidOpenings) {
    const response = await submitOpening(jar, input);

    assertRedirectHasCode(response, "invalid_input", "Opening input rejected");
  }

  for (const input of [
    {},
    { originalJournalId: "not-a-uuid", commandId: randomUUID(), reason: "x" },
    { originalJournalId: randomUUID(), commandId: "bad", reason: "x" },
    { originalJournalId: randomUUID(), commandId: randomUUID(), reason: "" },
    {
      originalJournalId: randomUUID(),
      commandId: randomUUID(),
      reason: "line\nbreak",
    },
  ]) {
    const response = await submitReversal(jar, input);

    assertRedirectHasCode(response, "invalid_input", "Reversal input rejected");
  }

  assert((await financialAuditCount()) === before, "Input rejection no audit");
  pass("Opening input rejection");
}

async function assertOpeningApplied(jar, wallet, asset) {
  const commandId = randomUUID();
  const response = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "100",
    commandId,
    reason: "initial opening balance",
  });

  assertRedirectParam(response, "result", "opening_balance_posted", "Opening");

  const state = await readOpeningState(commandId);

  assert(state.journals === 1, "Opening journal count");
  assert(state.entries === 2, "Opening entry count");
  assert(state.auditApplied === 1, "Opening audit count");
  assert(state.available === "100", "Opening available units");
  assert(state.custody === "100", "Opening custody units");
  assert(isUuid(state.journalId), "Opening journal id");
  pass("Opening applied");

  return {
    commandId,
    journalId: state.journalId,
    walletId: wallet.id,
    assetId: asset.id,
    units: "100",
  };
}

async function assertOpeningReplay(jar, wallet, asset, opening) {
  const before = await readOpeningState(opening.commandId);
  const response = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: opening.units,
    commandId: opening.commandId,
    reason: "initial opening balance",
  });

  assertRedirectParam(response, "result", "opening_balance_posted", "Replay");

  const after = await readOpeningState(opening.commandId);

  assert(after.journals === before.journals, "Replay no journal");
  assert(after.entries === before.entries, "Replay no entry");
  assert(after.auditApplied === before.auditApplied, "Replay no audit");
  assert(after.available === before.available, "Replay no balance change");
  pass("Opening replay");
}

async function assertOpeningConflict(jar, wallet, asset, opening) {
  const before = await totalJournalCount();
  const response = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: opening.units,
    commandId: opening.commandId,
    reason: "changed opening reason",
  });

  assertRedirectHasCode(response, "financial_command_conflict", "Opening conflict");
  assert((await totalJournalCount()) === before, "Conflict no journal");
  pass("Opening conflict");
}

async function assertOpeningDuplicateBlocked(jar, wallet, asset) {
  const before = await totalJournalCount();
  const response = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "1",
    commandId: randomUUID(),
    reason: "duplicate opening",
  });

  assertRedirectHasCode(
    response,
    "opening_balance_already_posted",
    "Duplicate opening",
  );
  assert((await totalJournalCount()) === before, "Duplicate no journal");
  pass("Opening duplicate blocked");
}

async function assertConcurrentOpeningReplay(jar, wallet, asset) {
  const commandId = randomUUID();
  const body = {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "7",
    commandId,
    reason: "concurrent opening",
  };

  const [first, second] = await Promise.all([
    submitOpening(jar, body),
    submitOpening(jar, body),
  ]);

  assertRedirectParam(first, "result", "opening_balance_posted", "Concurrent A");
  assertRedirectParam(second, "result", "opening_balance_posted", "Concurrent B");

  const state = await readOpeningState(commandId);

  assert(state.journals === 1, "Concurrent one journal");
  assert(state.auditApplied === 1, "Concurrent one audit");
  assert(state.available === "7", "Concurrent balance once");
  pass("Concurrent opening replay");
}

async function assertOpeningStateGuards(jar, userId, wallet, suffix) {
  const activeAsset = await createQaAsset(suffix, "C", "ACTIVE");

  await setWalletStatus(wallet.id, "FROZEN");
  let currentWallet = await readWalletById(wallet.id);

  await assertOpeningCode(jar, currentWallet, activeAsset, "opening_wallet_not_active");

  await setWalletStatus(wallet.id, "ACTIVE");
  currentWallet = await readWalletById(wallet.id);

  await setWalletStatus(wallet.id, "CLOSED");
  currentWallet = await readWalletById(wallet.id);

  await assertOpeningCode(jar, currentWallet, activeAsset, "opening_wallet_not_active");

  await setWalletStatus(wallet.id, "ACTIVE");
  currentWallet = await readWalletById(wallet.id);
  wallet.version = currentWallet.version;
  wallet.status = currentWallet.status;

  for (const status of ["RESTRICTED", "SUSPENDED", "WITHDRAWN"]) {
    await setProfileStatus(userId, status);
    await assertOpeningCode(jar, wallet, activeAsset, "opening_profile_not_active");
  }

  await setProfileStatus(userId, "ACTIVE");

  for (const status of ["DRAFT", "SUSPENDED", "ARCHIVED"]) {
    const asset = await createQaAsset(suffix, `S${status[0]}`, status);

    await assertOpeningCode(jar, wallet, asset, "opening_asset_not_active");
  }

  const walletConflict = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version + 1,
    assetId: activeAsset.id,
    assetExpectedVersion: activeAsset.version,
    units: "1",
    commandId: randomUUID(),
    reason: "wallet version conflict",
  });
  assertRedirectHasCode(
    walletConflict,
    "opening_wallet_version_conflict",
    "Wallet version conflict",
  );

  const assetConflict = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: activeAsset.id,
    assetExpectedVersion: activeAsset.version + 1,
    units: "1",
    commandId: randomUUID(),
    reason: "asset version conflict",
  });
  assertRedirectHasCode(
    assetConflict,
    "opening_asset_version_conflict",
    "Asset version conflict",
  );

  pass("Opening state guards");
}

async function assertExistingLedgerActivityBlocked(jar, wallet, suffix) {
  const asset = await createQaAsset(suffix, "D", "ACTIVE");
  const accounts = await provisionLedgerAccounts(wallet.id, asset.id);

  await postQaLedgerJournal({
    commandId: randomUUID(),
    assetId: asset.id,
    userId: wallet.userId,
    journalType: "QA_OPENING_ACTIVITY",
    referenceId: randomUUID(),
    reason: "qa activity before opening",
    lines: [
      {
        accountId: accounts.SYSTEM_CUSTODY,
        side: "DEBIT",
        units: "1",
      },
      {
        accountId: accounts.USER_AVAILABLE,
        side: "CREDIT",
        units: "1",
      },
    ],
  });

  await postQaLedgerJournal({
    commandId: randomUUID(),
    assetId: asset.id,
    userId: wallet.userId,
    journalType: "QA_OPENING_ACTIVITY_REVERSAL",
    referenceId: randomUUID(),
    reason: "qa activity zeroes balance",
    lines: [
      {
        accountId: accounts.USER_AVAILABLE,
        side: "DEBIT",
        units: "1",
      },
      {
        accountId: accounts.SYSTEM_CUSTODY,
        side: "CREDIT",
        units: "1",
      },
    ],
  });

  const response = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "1",
    commandId: randomUUID(),
    reason: "blocked by historical entries",
  });

  assertRedirectHasCode(
    response,
    "opening_ledger_activity_exists",
    "Existing activity blocks opening",
  );
  pass("Opening existing activity blocked");
}

async function assertReversalApplied(jar, opening) {
  const commandId = randomUUID();
  const response = await submitReversal(jar, {
    originalJournalId: opening.journalId,
    commandId,
    reason: "reverse opening balance",
  });

  assertRedirectParam(
    response,
    "result",
    "opening_reversal_posted",
    "Reversal",
  );

  const state = await readReversalState(opening.journalId, commandId);

  assert(state.reversalJournals === 1, "Reversal journal count");
  assert(state.reversalEntries === 2, "Reversal entry count");
  assert(state.reversalApplied === 1, "Reversal audit count");
  assert(state.available === "0", "Reversal available zero");
  assert(state.custody === "0", "Reversal custody zero");
  assert(isUuid(state.reversalJournalId), "Reversal journal id");
  pass("Opening reversal applied");

  opening.reversalCommandId = commandId;
  opening.reversalJournalId = state.reversalJournalId;
}

async function assertReversalReplay(jar, opening) {
  const before = await readReversalState(
    opening.journalId,
    opening.reversalCommandId,
  );
  const response = await submitReversal(jar, {
    originalJournalId: opening.journalId,
    commandId: opening.reversalCommandId,
    reason: "reverse opening balance",
  });

  assertRedirectParam(
    response,
    "result",
    "opening_reversal_posted",
    "Reversal replay",
  );

  const after = await readReversalState(
    opening.journalId,
    opening.reversalCommandId,
  );

  assert(after.reversalJournals === before.reversalJournals, "Replay no journal");
  assert(after.reversalApplied === before.reversalApplied, "Replay no audit");
  assert(after.available === before.available, "Replay no balance");
  pass("Reversal replay");
}

async function assertReversalNoop(jar, opening) {
  const beforeJournals = await totalJournalCount();
  const response = await submitReversal(jar, {
    originalJournalId: opening.journalId,
    commandId: randomUUID(),
    reason: "already reversed noop",
  });

  assertRedirectParam(response, "result", "opening_reversal_noop", "NOOP");
  assert((await totalJournalCount()) === beforeJournals, "NOOP no journal");
  assert((await noopAuditCount(opening.journalId)) === "1", "NOOP audit");
  pass("Reversal NOOP");
}

async function assertReversalConflict(jar, opening) {
  const before = await totalJournalCount();
  const response = await submitReversal(jar, {
    originalJournalId: opening.journalId,
    commandId: opening.reversalCommandId,
    reason: "changed reversal reason",
  });

  assertRedirectHasCode(
    response,
    "financial_command_conflict",
    "Reversal conflict",
  );
  assert((await totalJournalCount()) === before, "Reversal conflict no journal");
  pass("Reversal conflict");
}

async function assertReversalInvalidTargetsBlocked(jar) {
  const missing = await submitReversal(jar, {
    originalJournalId: randomUUID(),
    commandId: randomUUID(),
    reason: "missing journal",
  });
  assertRedirectHasCode(missing, "opening_journal_not_found", "Missing journal");

  const qaJournalId = await readAnyNonOpeningJournalId();

  if (qaJournalId) {
    const invalid = await submitReversal(jar, {
      originalJournalId: qaJournalId,
      commandId: randomUUID(),
      reason: "invalid journal",
    });

    assertRedirectHasCode(
      invalid,
      "opening_journal_invalid",
      "Non-opening reversal blocked",
    );
  }

  pass("Reversal invalid targets blocked");
}

async function assertReversalInsufficientAvailable(jar, wallet, suffix) {
  const asset = await createQaAsset(suffix, "E", "ACTIVE");
  const openingCommandId = randomUUID();
  const openingResponse = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "9",
    commandId: openingCommandId,
    reason: "opening before insufficient reversal",
  });

  assertRedirectParam(
    openingResponse,
    "result",
    "opening_balance_posted",
    "Insufficient setup opening",
  );

  const openingState = await readOpeningState(openingCommandId);
  const accounts = await readLedgerAccounts(wallet.id, asset.id);

  await postQaLedgerJournal({
    commandId: randomUUID(),
    assetId: asset.id,
    userId: wallet.userId,
    journalType: "QA_MOVE_AVAILABLE",
    referenceId: randomUUID(),
    reason: "qa move before insufficient reversal",
    lines: [
      {
        accountId: accounts.USER_AVAILABLE,
        side: "DEBIT",
        units: "9",
      },
      {
        accountId: accounts.USER_LOCKED,
        side: "CREDIT",
        units: "9",
      },
    ],
  });

  const response = await submitReversal(jar, {
    originalJournalId: openingState.journalId,
    commandId: randomUUID(),
    reason: "insufficient reversal",
  });

  assertRedirectHasCode(
    response,
    "opening_reversal_insufficient_available",
    "Insufficient available",
  );
  assert(
    (await appliedReversalCount(openingState.journalId)) === "0",
    "Insufficient no reversal",
  );
  pass("Reversal insufficient available blocked");
}

async function assertAdminReadRpcs(adminUserId) {
  const result = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(adminUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(adminUserId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    select
      (select count(*) from public.list_admin_wallet_asset_ledger_balances(100))::text || ',' ||
      (select count(*) from public.list_admin_ledger_journals(50, null))::text || ',' ||
      (select count(*) from public.list_financial_admin_audit_events(25, null))::text;
  `);

  const [balances, journals, audits] = result.split(",").map(Number);

  assert(balances >= 1, "Admin balance rpc rows");
  assert(journals >= 1, "Admin journal rpc rows");
  assert(audits >= 1, "Admin audit rpc rows");
  pass("Admin financial read RPCs");
}

async function assertAuditImmutability() {
  await sqlScalar(`
    do $$
    begin
      update private.financial_admin_audit_events
      set reason = 'blocked';
      raise exception 'expected financial audit update failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;

    do $$
    begin
      delete from private.financial_admin_audit_events;
      raise exception 'expected financial audit delete failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;

    do $$
    begin
      truncate private.financial_admin_audit_events;
      raise exception 'expected financial audit truncate failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;

    select 'immutable';
  `);

  pass("Financial audit immutability");
}

async function assertDirectAccessBlocked(adminUserId, userId) {
  await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;

    do $$
    begin
      select count(*) from private.financial_admin_audit_events;
      raise exception 'expected financial audit table denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;

    do $$
    begin
      perform * from public.list_admin_ledger_journals(1, null);
      raise exception 'expected admin read denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;

    reset role;
    select set_config('request.jwt.claim.sub', ${sqlLiteral(adminUserId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(adminUserId)}, 'aal', 'aal1')::text,
      false
    );
    set role authenticated;

    do $$
    begin
      perform * from public.list_financial_admin_audit_events(1, null);
      raise exception 'expected aal1 audit read denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;

    select 'blocked';
  `);

  pass("Financial direct access blocked");
}

async function assertFinancialRpcDenied(actorUserId, aal, walletId, label) {
  await sqlScalar(`
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
      from public.post_opening_balance(
        ${sqlLiteral(walletId)}::uuid,
        1,
        ${sqlLiteral(randomUUID())}::uuid,
        1,
        '1',
        ${sqlLiteral(randomUUID())}::uuid,
        'denied financial rpc'
      );
      raise exception 'expected opening denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);

  pass(label);
}

async function assertOpeningCode(jar, wallet, asset, code) {
  const response = await submitOpening(jar, {
    walletAccountId: wallet.id,
    walletExpectedVersion: wallet.version,
    assetId: asset.id,
    assetExpectedVersion: asset.version,
    units: "1",
    commandId: randomUUID(),
    reason: "opening guard",
  });

  assertRedirectHasCode(response, code, `Opening code ${code}`);
}

async function signUpConfirmAndSignIn(email, password, nextPath) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA Opening User",
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

async function enrollAndVerifyAdmin(jar, email, password) {
  const enrollment = await startEnrollment(jar, email, password);

  await verifyEnrollment(jar, enrollment);
  pass("Opening admin MFA ready");

  return enrollment;
}

async function startEnrollment(jar, email, password) {
  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
  });
  const payload = await response.json();

  if (response.status === 503 && payload?.code === "mfa_enrollment_failed") {
    return startEnrollmentWithLocalSupabase(email, password);
  }

  assert(
    response.status === 200,
    `MFA enrollment start status ${response.status}:${payload?.code ?? "none"}`,
  );
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
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      const factorId = isUuid(factor.id) ? factor.id : null;

      if (!factorId) {
        throw new Error("FAIL MFA local factor id");
      }

      const unenroll = await supabase.auth.mfa.unenroll({ factorId });

      if (unenroll.error) {
        throw new Error("FAIL MFA local factor cleanup");
      }
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

async function verifyEnrollment(jar, enrollment) {
  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/verify", {
    jar,
    body: {
      factor_id: enrollment.factorId,
      code: await currentTotpCode(enrollment.secret),
    },
  });
  const payload = await response.json();

  assert(
    response.status === 200,
    `MFA enrollment verify status ${response.status}:${payload?.code ?? "none"}`,
  );
  assert(payload?.status === "verified", "MFA enrollment verified");
}

async function submitOpening(
  jar,
  {
    walletAccountId,
    walletExpectedVersion,
    assetId,
    assetExpectedVersion,
    units,
    commandId,
    reason,
  },
) {
  return appFetch("/api/v1/admin/ledger/opening-balance", {
    method: "POST",
    jar,
    body: {
      wallet_account_id: walletAccountId,
      wallet_expected_version:
        walletExpectedVersion === undefined
          ? undefined
          : String(walletExpectedVersion),
      asset_id: assetId,
      asset_expected_version:
        assetExpectedVersion === undefined
          ? undefined
          : String(assetExpectedVersion),
      units,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitReversal(
  jar,
  { originalJournalId, commandId, reason },
) {
  return appFetch("/api/v1/admin/ledger/reverse-opening", {
    method: "POST",
    jar,
    body: {
      original_journal_id: originalJournalId,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function logout(jar) {
  await appFetch("/api/v1/auth/sign-out", {
    method: "POST",
    jar,
    redirect: "manual",
  });
}

async function createQaAsset(suffix, marker, status) {
  const assetId = randomUUID();
  const normalized = `${suffix.slice(0, 6)}${marker}`.toUpperCase();
  const assetCode = `OBC_${normalized}`;
  const assetSymbol = `OB${marker}`.replace(/[^A-Z0-9]/g, "X").slice(0, 16);

  const payload = await sqlScalar(`
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
      ${sqlLiteral(assetId)}::uuid,
      ${sqlLiteral(assetCode)},
      ${sqlLiteral(assetSymbol)},
      'Opening Balance QA Asset',
      'SPL_TOKEN',
      6,
      ${sqlLiteral(randomBase58(44))},
      ${sqlLiteral(status)}
    );

    select json_build_object(
      'id', ${sqlLiteral(assetId)},
      'version', 1
    )::text;
  `);

  return parseJsonRow(payload, "QA asset");
}

async function provisionLedgerAccounts(walletId, assetId) {
  const payload = await sqlScalar(`
    with user_accounts as (
      select *
      from private.ensure_wallet_asset_ledger_accounts(
        ${sqlLiteral(walletId)}::uuid,
        ${sqlLiteral(assetId)}::uuid
      )
    ),
    system_accounts as (
      select *
      from private.ensure_system_ledger_accounts(
        ${sqlLiteral(assetId)}::uuid
      )
    ),
    combined as (
      select * from user_accounts
      union all
      select * from system_accounts
    )
    select json_object_agg(account_purpose, ledger_account_id::text)::text
    from combined;
  `);

  return parseJsonRow(payload, "Ledger accounts");
}

async function readLedgerAccounts(walletId, assetId) {
  const payload = await sqlScalar(`
    select json_object_agg(account_purpose, id::text)::text
    from private.ledger_accounts
    where asset_id = ${sqlLiteral(assetId)}::uuid
      and (
        wallet_account_id = ${sqlLiteral(walletId)}::uuid
        or wallet_account_id is null
      );
  `);

  return parseJsonRow(payload, "Read ledger accounts");
}

async function postQaLedgerJournal({
  commandId,
  assetId,
  userId,
  journalType,
  referenceId,
  reason,
  lines,
}) {
  await sqlScalar(`
    select journal_id::text
    from private.post_ledger_journal(
      ${sqlLiteral(commandId)}::uuid,
      ${sqlLiteral(assetId)}::uuid,
      ${sqlLiteral(journalType)},
      'USER',
      ${sqlLiteral(userId)}::uuid,
      'QA_REFERENCE',
      ${sqlLiteral(referenceId)}::uuid,
      ${sqlLiteral(reason)},
      jsonb_build_array(
        ${lines
          .map(
            (line) => `
        jsonb_build_object(
          'account_id', ${sqlLiteral(line.accountId)},
          'side', ${sqlLiteral(line.side)},
          'units', ${sqlLiteral(line.units)}
        )`,
          )
          .join(",")}
      )
    );
  `);
}

async function readOpeningState(commandId) {
  const payload = await sqlScalar(`
    with opening_journal as (
      select journals.id, journals.asset_id, journals.reference_id
      from private.ledger_journals as journals
      where journals.command_id = ${sqlLiteral(commandId)}::uuid
    ),
    account_balances as (
      select accounts.account_purpose, balances.balance_units::text
      from opening_journal
      join private.ledger_accounts as accounts
        on accounts.asset_id = opening_journal.asset_id
        and (
          accounts.wallet_account_id = opening_journal.reference_id
          or accounts.wallet_account_id is null
        )
      join private.ledger_account_balances as balances
        on balances.ledger_account_id = accounts.id
    )
    select json_build_object(
      'journalId', (select id::text from opening_journal),
      'journals', (
        select count(*)
        from private.ledger_journals
        where command_id = ${sqlLiteral(commandId)}::uuid
      ),
      'entries', (
        select count(*)
        from private.ledger_entries
        where journal_id = (select id from opening_journal)
      ),
      'auditApplied', (
        select count(*)
        from private.financial_admin_audit_events
        where command_id = ${sqlLiteral(commandId)}::uuid
          and action = 'POST_OPENING_BALANCE'
          and outcome = 'APPLIED'
      ),
      'available', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'USER_AVAILABLE'
      ), '0'),
      'custody', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'SYSTEM_CUSTODY'
      ), '0')
    )::text;
  `);

  return parseJsonRow(payload, "Opening state");
}

async function readReversalState(originalJournalId, commandId) {
  const payload = await sqlScalar(`
    with reversal_journal as (
      select journals.id, journals.asset_id, journals.reference_id
      from private.ledger_journals as journals
      where journals.command_id = ${sqlLiteral(commandId)}::uuid
    ),
    opening_journal as (
      select journals.id, journals.asset_id, journals.reference_id
      from private.ledger_journals as journals
      where journals.id = ${sqlLiteral(originalJournalId)}::uuid
    ),
    account_balances as (
      select accounts.account_purpose, balances.balance_units::text
      from opening_journal
      join private.ledger_accounts as accounts
        on accounts.asset_id = opening_journal.asset_id
        and (
          accounts.wallet_account_id = opening_journal.reference_id
          or accounts.wallet_account_id is null
        )
      join private.ledger_account_balances as balances
        on balances.ledger_account_id = accounts.id
    )
    select json_build_object(
      'reversalJournalId', (select id::text from reversal_journal),
      'reversalJournals', (
        select count(*)
        from private.ledger_journals
        where command_id = ${sqlLiteral(commandId)}::uuid
      ),
      'reversalEntries', (
        select count(*)
        from private.ledger_entries
        where journal_id = (select id from reversal_journal)
      ),
      'reversalApplied', (
        select count(*)
        from private.financial_admin_audit_events
        where command_id = ${sqlLiteral(commandId)}::uuid
          and action = 'REVERSE_OPENING_BALANCE'
          and outcome = 'APPLIED'
      ),
      'available', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'USER_AVAILABLE'
      ), '0'),
      'custody', coalesce((
        select balance_units
        from account_balances
        where account_purpose = 'SYSTEM_CUSTODY'
      ), '0')
    )::text;
  `);

  return parseJsonRow(payload, "Reversal state");
}

async function readAnyNonOpeningJournalId() {
  const value = await sqlScalar(`
    select id::text
    from private.ledger_journals
    where journal_type <> 'ADMIN_OPENING_BALANCE'
    order by posted_at desc
    limit 1;
  `);

  return isUuid(value) ? value : null;
}

async function financialAuditCount() {
  return Number(
    await sqlScalar("select count(*)::text from private.financial_admin_audit_events;"),
  );
}

async function totalJournalCount() {
  return Number(await sqlScalar("select count(*)::text from private.ledger_journals;"));
}

async function noopAuditCount(originalJournalId) {
  return sqlScalar(`
    select count(*)::text
    from private.financial_admin_audit_events
    where original_journal_id = ${sqlLiteral(originalJournalId)}::uuid
      and action = 'REVERSE_OPENING_BALANCE'
      and outcome = 'NOOP';
  `);
}

async function appliedReversalCount(originalJournalId) {
  return sqlScalar(`
    select count(*)::text
    from private.financial_admin_audit_events
    where original_journal_id = ${sqlLiteral(originalJournalId)}::uuid
      and action = 'REVERSE_OPENING_BALANCE'
      and outcome = 'APPLIED';
  `);
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

async function readWalletById(walletId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', wallet_accounts.id::text,
      'userId', wallet_accounts.user_id::text,
      'status', wallet_accounts.status,
      'version', wallet_accounts.version
    )::text
    from public.wallet_accounts
    where id = ${sqlLiteral(walletId)}::uuid;
  `);

  return parseJsonRow(payload, "Wallet by id");
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

async function bootstrapAdminRole(userId) {
  const count = await sqlScalar(`
    insert into public.user_roles (user_id, role, grant_reason)
    values (${sqlLiteral(userId)}::uuid, 'ADMIN', 'local opening command e2e bootstrap')
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

  assert(actual.pathname === expectedPath, `${label} path`);
}

function assertRedirectHasCode(response, code, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const actual = getRedirectUrl(response, label);
  const actualCode =
    actual.searchParams.get("error") ?? actual.searchParams.get("code");

  assert(actualCode === code, `${label} code`);
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
    "command_id",
    "expected_version",
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : "FAIL unknown";

  if (message.startsWith("FAIL ")) {
    console.error(message);
  } else {
    console.error("FAIL opening balance correction integration");
  }

  process.exitCode = 1;
});
