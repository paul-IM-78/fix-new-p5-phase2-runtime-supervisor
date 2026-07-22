import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { createCookieJar } from "../lib/http-cookie-jar.mjs";

const execFileAsync = promisify(execFile);

let APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const BIG_UNITS = "9007199254740993";
const DEPOSIT_UNITS = "11";
const WITHDRAWAL_UNITS = "7";

async function main() {
  const runtime = await prepareManagedAppRuntime();
  const suffix = randomUUID().replaceAll("-", "");
  const password = `BalanceOverview-${suffix.slice(0, 16)}-Password1!`;
  const userEmail = `qa-balance-user-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const otherEmail = `qa-balance-other-${Date.now()}-${suffix.slice(8, 16)}@example.test`;

  try {
    await assertPreconditions();
    await assertAnonymousBalancesRedirect();

    const userJar = await signUpConfirmAndSignIn(
      userEmail,
      password,
      "/balances",
    );
    const otherJar = await signUpConfirmAndSignIn(
      otherEmail,
      password,
      "/balances",
    );
    const userId = await readUserIdByEmail(userEmail);
    const otherUserId = await readUserIdByEmail(otherEmail);
    const wallet = await readWalletByUserId(userId);
    const otherWallet = await readWalletByUserId(otherUserId);

    await assertEmptyBalancesPage(userJar);
    await assertSafeRedirectPath(userEmail, password);

    const fixture = await createBalanceFixture(suffix, userId, wallet);
    await assertPopulatedBalancesPage(userJar, fixture.afterReserve);
    await assertOtherUserIsolation(otherJar, fixture.assetCode);
    await assertInactiveProfilesBlocked(userJar, userId);

    await setProfileStatus(userId, "ACTIVE");
    await assertWalletStatusRead(userJar, wallet.id, "FROZEN");
    await assertWalletStatusRead(userJar, wallet.id, "CLOSED");
    await setWalletStatus(wallet.id, "ACTIVE");

    const afterConfirm = await confirmDeposit(userId, fixture.deposit);
    await assertPopulatedBalancesPage(userJar, afterConfirm);

    const afterApproval = await approveWithdrawal(userId, fixture.withdrawal);
    await assertPopulatedBalancesPage(userJar, afterApproval);

    const afterSettlement = await settleWithdrawal(userId, afterApproval);
    await assertPopulatedBalancesPage(userJar, afterSettlement);

    await assertBalanceRpcInactiveProfileBlocked(userId);
    await logout(userJar);
    await logout(otherJar);
    await setWalletStatus(otherWallet.id, "ACTIVE");

    pass("Balance overview integration");
  } finally {
    await stopManagedAppRuntime(runtime);
  }
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
  pass("Balance overview preconditions");
}

async function assertAnonymousBalancesRedirect() {
  const response = await appFetch("/balances", { redirect: "manual" });

  assertRedirectPath(response, "/auth/sign-in", "Anonymous balances");
  assertRedirectParam(response, "next", "/balances", "Anonymous balances next");
  pass("Anonymous balances redirect");
}

async function assertEmptyBalancesPage(jar) {
  const response = await appFetch("/balances", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, "Empty balances status");
  assert(body.includes("Managed wallet ledger balances"), "Balance title");
  assert(body.includes("No user ledger balance has been created yet."), "Empty state");
  assert(body.includes("Wallet status"), "Wallet status visible");
  assertNoForbiddenFinancialBody(body, "Empty balances body");
  pass("Empty balances page");
}

async function createBalanceFixture(suffix, userId, wallet) {
  await bootstrapAdminRole(userId);
  const asset = await createQaAsset(suffix);
  await postOpeningBalance(userId, wallet, asset, BIG_UNITS);

  const deposit = await createDepositRequest(
    userId,
    wallet.id,
    asset,
    DEPOSIT_UNITS,
  );
  const withdrawal = await createWithdrawalRequest(
    userId,
    wallet.id,
    asset,
    WITHDRAWAL_UNITS,
  );
  const reserved = await reserveWithdrawal(userId, withdrawal);

  return {
    assetCode: asset.assetCode,
    deposit,
    withdrawal: reserved,
    afterReserve: {
      assetCode: asset.assetCode,
      available: subtractAtomicUnits(BIG_UNITS, WITHDRAWAL_UNITS),
      locked: "0",
      pendingDeposit: DEPOSIT_UNITS,
      pendingWithdrawal: WITHDRAWAL_UNITS,
      total: addAtomicUnits(BIG_UNITS, DEPOSIT_UNITS),
      depositStatus: "REQUESTED",
      withdrawalStatus: "RESERVED",
    },
  };
}

async function assertPopulatedBalancesPage(jar, expected) {
  const response = await appFetch("/balances", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, "Populated balances status");
  assert(body.includes(expected.assetCode), "Asset code visible");
  assert(
    body.includes(formatAtomicUnits(expected.available)),
    "Available units visible",
  );
  assert(body.includes(formatAtomicUnits(expected.locked)), "Locked units visible");
  assert(
    body.includes(formatAtomicUnits(expected.pendingDeposit)),
    "Pending deposit units visible",
  );
  assert(
    body.includes(formatAtomicUnits(expected.pendingWithdrawal)),
    "Pending withdrawal units visible",
  );
  assert(body.includes(formatAtomicUnits(expected.total)), "Total units visible");
  assert(body.includes(expected.depositStatus), "Deposit status visible");
  assert(body.includes(expected.withdrawalStatus), "Withdrawal status visible");
  assertNoForbiddenFinancialBody(body, "Populated balances body");
}

async function confirmDeposit(userId, deposit) {
  const result = await runAsAal2Admin(
    userId,
    `
    select row_to_json(result)::text
    from public.confirm_user_funding_request(
      p_deposit_request_id => ${sqlLiteral(deposit.depositRequestId)}::uuid,
      p_request_expected_version => ${deposit.version},
      p_command_id => ${sqlLiteral(randomUUID())}::uuid,
      p_reason => 'local balance overview deposit confirmation'
    ) as result;
    `,
  );
  const row = parseJsonRow(result, "Confirm deposit");

  assert(row.result_code === "APPLIED", "Confirm deposit applied");

  return {
    assetCode: deposit.assetCode,
    available: addAtomicUnits(BIG_UNITS, DEPOSIT_UNITS),
    locked: "0",
    pendingDeposit: "0",
    pendingWithdrawal: WITHDRAWAL_UNITS,
    total: addAtomicUnits(BIG_UNITS, DEPOSIT_UNITS),
    depositStatus: "CONFIRMED",
    withdrawalStatus: "RESERVED",
  };
}

async function approveWithdrawal(userId, withdrawal) {
  const result = await runAsAal2Admin(
    userId,
    `
    select row_to_json(result)::text
    from public.approve_user_payout_request(
      p_withdrawal_request_id => ${sqlLiteral(withdrawal.withdrawalRequestId)}::uuid,
      p_request_expected_version => ${withdrawal.version},
      p_command_id => ${sqlLiteral(randomUUID())}::uuid,
      p_reason => 'local balance overview withdrawal approval'
    ) as result;
    `,
  );
  const row = parseJsonRow(result, "Approve withdrawal");

  assert(row.result_code === "APPLIED", "Approve withdrawal applied");

  const available = subtractAtomicUnits(
    addAtomicUnits(BIG_UNITS, DEPOSIT_UNITS),
    WITHDRAWAL_UNITS,
  );

  return {
    assetCode: withdrawal.assetCode,
    available,
    locked: "0",
    pendingDeposit: "0",
    pendingWithdrawal: "0",
    total: available,
    depositStatus: "CONFIRMED",
    withdrawalStatus: "APPROVED",
    withdrawalRequestId: withdrawal.withdrawalRequestId,
    withdrawalVersion: row.request_version,
  };
}

async function settleWithdrawal(userId, approved) {
  const start = await runAsAal2Admin(
    userId,
    `
    select row_to_json(result)::text
    from public.start_user_payout_execution(
      p_withdrawal_request_id => ${sqlLiteral(approved.withdrawalRequestId)}::uuid,
      p_request_expected_version => ${approved.withdrawalVersion},
      p_command_id => ${sqlLiteral(randomUUID())}::uuid,
      p_reason => 'local balance overview execution start',
      p_evidence_reference => ${sqlLiteral(`BAL-REF-${randomUUID().slice(0, 8).toUpperCase()}`)}
    ) as result;
    `,
  );
  const startRow = parseJsonRow(start, "Start withdrawal execution");

  assert(startRow.result_code === "APPLIED", "Start execution applied");

  const settled = await runAsAal2Admin(
    userId,
    `
    select row_to_json(result)::text
    from public.settle_user_payout_execution(
      p_withdrawal_request_id => ${sqlLiteral(approved.withdrawalRequestId)}::uuid,
      p_request_expected_version => ${startRow.request_version},
      p_execution_attempt_id => ${sqlLiteral(startRow.execution_attempt_id)}::uuid,
      p_attempt_expected_version => ${startRow.attempt_version},
      p_command_id => ${sqlLiteral(randomUUID())}::uuid,
      p_reason => 'local balance overview internal settlement'
    ) as result;
    `,
  );
  const settledRow = parseJsonRow(settled, "Settle withdrawal execution");

  assert(settledRow.result_code === "APPLIED", "Settle execution applied");

  return {
    assetCode: approved.assetCode,
    available: approved.available,
    locked: "0",
    pendingDeposit: "0",
    pendingWithdrawal: "0",
    total: approved.total,
    depositStatus: "CONFIRMED",
    withdrawalStatus: "SETTLED",
  };
}

async function assertOtherUserIsolation(jar, assetCode) {
  const response = await appFetch("/balances", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, "Other balances status");
  assert(!body.includes(assetCode), "Other user no asset");
  assert(body.includes("No user ledger balance"), "Other empty balances");
  assertNoForbiddenFinancialBody(body, "Other balances body");
  pass("Cross-user balance isolation");
}

async function assertInactiveProfilesBlocked(jar, userId) {
  for (const status of ["RESTRICTED", "SUSPENDED", "WITHDRAWN"]) {
    await setProfileStatus(userId, status);
    const response = await appFetch("/balances", { jar, redirect: "manual" });

    assertRedirectPath(response, "/auth/account-unavailable", `Inactive ${status}`);
  }

  pass("Inactive profile balances blocked");
}

async function assertWalletStatusRead(jar, walletId, status) {
  await setWalletStatus(walletId, status);

  const response = await appFetch("/balances", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, `${status} wallet readable`);
  assert(body.includes(status), `${status} wallet status visible`);
  assertNoForbiddenFinancialBody(body, `${status} wallet body`);
}

async function assertBalanceRpcInactiveProfileBlocked(userId) {
  await setProfileStatus(userId, "SUSPENDED");

  const result = await sqlScalar(`
    do $$
    begin
      perform set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
      perform set_config(
        'request.jwt.claims',
        jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal1')::text,
        false
      );
      set role authenticated;
      perform count(*) from public.list_current_user_ledger_balances();
      raise exception 'expected inactive profile denial';
    exception
      when insufficient_privilege or object_not_in_prerequisite_state then
        null;
    end;
    $$;
    select 'denied';
  `);

  assert(result === "denied", "Inactive balance RPC blocked");
  await setProfileStatus(userId, "ACTIVE");
  pass("Inactive balance RPC blocked");
}

async function assertSafeRedirectPath(email, password) {
  const jar = await signIn(email, password, "/balances");
  await logout(jar);

  const blocked = await signIn(email, password, "/admin/ledger");
  const response = await appFetch("/account", { jar: blocked, redirect: "manual" });

  assert(response.status === 200, "Blocked redirect fell back to account");
  await logout(blocked);
  pass("Balance safe redirect");
}

async function createQaAsset(suffix) {
  const assetCode = `BAL_${suffix.slice(0, 12).toUpperCase()}`;
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
        ${sqlLiteral(`B${suffix.slice(0, 5).toUpperCase()}`)},
        'Balance QA Asset',
        'NATIVE',
        0,
        null,
        'ACTIVE'
      )
      returning id, asset_code, symbol, version
    )
    select json_build_object(
      'id', id::text,
      'assetCode', asset_code,
      'symbol', symbol,
      'version', version
    )::text
    from inserted_asset;
  `);

  return parseJsonRow(payload, "QA balance asset");
}

async function postOpeningBalance(userId, wallet, asset, units) {
  const result = await runAsAal2Admin(
    userId,
    `
    select row_to_json(result)::text
    from public.post_opening_balance(
      p_wallet_account_id => ${sqlLiteral(wallet.id)}::uuid,
      p_wallet_expected_version => ${await readWalletVersion(wallet.id)},
      p_asset_id => ${sqlLiteral(asset.id)}::uuid,
      p_asset_expected_version => ${asset.version},
      p_units => ${sqlLiteral(units)},
      p_command_id => ${sqlLiteral(randomUUID())}::uuid,
      p_reason => 'local balance overview opening balance'
    ) as result;
    `,
  );
  const row = parseJsonRow(result, "Opening balance");

  assert(row.result_code === "APPLIED", "Opening balance applied");
}

async function createDepositRequest(userId, walletId, asset, units) {
  const result = await runAsUser(
    userId,
    `
    select row_to_json(result)::text
    from public.create_user_funding_request(
      p_wallet_account_id => ${sqlLiteral(walletId)}::uuid,
      p_wallet_expected_version => ${await readWalletVersion(walletId)},
      p_asset_id => ${sqlLiteral(asset.id)}::uuid,
      p_asset_expected_version => ${asset.version},
      p_units => ${sqlLiteral(units)},
      p_command_id => ${sqlLiteral(randomUUID())}::uuid
    ) as result;
    `,
  );
  const row = parseJsonRow(result, "Deposit request");

  assert(row.result_code === "APPLIED", "Deposit request applied");

  return {
    assetCode: asset.assetCode,
    depositRequestId: row.deposit_request_id,
    version: row.request_version,
  };
}

async function createWithdrawalRequest(userId, walletId, asset, units) {
  const result = await runAsUser(
    userId,
    `
    select row_to_json(result)::text
    from public.create_user_payout_request(
      p_wallet_account_id => ${sqlLiteral(walletId)}::uuid,
      p_wallet_expected_version => ${await readWalletVersion(walletId)},
      p_asset_id => ${sqlLiteral(asset.id)}::uuid,
      p_asset_expected_version => ${asset.version},
      p_units => ${sqlLiteral(units)},
      p_command_id => ${sqlLiteral(randomUUID())}::uuid
    ) as result;
    `,
  );
  const row = parseJsonRow(result, "Withdrawal request");

  assert(row.result_code === "APPLIED", "Withdrawal request applied");

  return {
    assetCode: asset.assetCode,
    withdrawalRequestId: row.withdrawal_request_id,
    version: row.request_version,
  };
}

async function reserveWithdrawal(userId, withdrawal) {
  const result = await runAsAal2Admin(
    userId,
    `
    select row_to_json(result)::text
    from public.reserve_user_payout_request(
      p_withdrawal_request_id => ${sqlLiteral(withdrawal.withdrawalRequestId)}::uuid,
      p_request_expected_version => ${withdrawal.version},
      p_command_id => ${sqlLiteral(randomUUID())}::uuid,
      p_reason => 'local balance overview withdrawal reservation'
    ) as result;
    `,
  );
  const row = parseJsonRow(result, "Reserve withdrawal");

  assert(row.result_code === "APPLIED", "Reserve withdrawal applied");

  return {
    ...withdrawal,
    version: row.request_version,
  };
}

async function bootstrapAdminRole(userId) {
  const result = await sqlScalar(`
    insert into public.user_roles (user_id, role, grant_reason)
    values (${sqlLiteral(userId)}::uuid, 'ADMIN', 'local balance overview e2e bootstrap')
    on conflict (user_id, role) where revoked_at is null do nothing;
    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(result === "1", "Bootstrap admin role");
}

async function runAsUser(userId, sql) {
  return sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal1')::text,
      false
    );
    set role authenticated;
    ${sql}
  `);
}

async function runAsAal2Admin(userId, sql) {
  return sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    ${sql}
  `);
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

async function readWalletVersion(walletId) {
  const version = await sqlScalar(`
    select version::text
    from public.wallet_accounts
    where id = ${sqlLiteral(walletId)}::uuid;
  `);

  assert(/^[1-9][0-9]*$/.test(version), "Wallet version");

  return version;
}

async function signUpConfirmAndSignIn(email, password, nextPath) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA Balance",
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
  const expectedPath = nextPath === "/balances" ? "/balances" : "/account";

  assertRedirectPath(response, expectedPath, "Sign-in redirect");
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
    const cookieHeader = jar.getHeader(requestUrl);

    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
  }

  const response = await fetch(requestUrl, {
    method,
    headers,
    body: cleanBody ? new URLSearchParams(cleanBody) : undefined,
    redirect,
  });

  if (jar) {
    jar.store(response, requestUrl);
  }

  return response;
}

async function assertStatus(path, status, label) {
  const response = await appFetch(path, { redirect: "manual" });
  const body = await response.text();

  assert(response.status === status, label);
  assertNoForbiddenFinancialBody(body, label);
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
      'version', wallet_accounts.version
    )::text
    from public.wallet_accounts
    where user_id = ${sqlLiteral(userId)}::uuid;
  `);

  return parseJsonRow(payload, "Wallet by user");
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
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    const output = stdout.trim();

    assertNoForbiddenFinancialBody(output, "SQL output");

    return output.split(/\r?\n/).at(-1)?.trim() ?? "";
  } catch {
    throw new Error("FAIL local SQL");
  }
}

async function prepareManagedAppRuntime() {
  if (process.env.APP_ORIGIN) {
    return null;
  }

  const env = {
    ...process.env,
    APP_ORIGIN,
    NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
  };
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
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });

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

      if (response.status === 200) {
        return;
      }
    } catch {
      await wait(500);
    }
  }

  throw new Error("FAIL managed Next server readiness");
}

function assertRedirectPath(response, expectedPath, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} redirect status`,
  );

  const location = response.headers.get("location");

  assert(Boolean(location), `${label} location`);

  const actual = location ? new URL(location, APP_ORIGIN) : null;

  assert(actual?.pathname === expectedPath, `${label} path`);
  assertNoSensitiveRedirectQuery(actual, label);
}

function assertRedirectParam(response, name, expected, label) {
  const location = response.headers.get("location");
  const actual = location ? new URL(location, APP_ORIGIN) : null;

  assert(actual?.searchParams.get(name) === expected, `${label} ${name}`);
}

function assertNoSensitiveRedirectQuery(url, label) {
  assert(url, `${label} redirect url`);

  for (const name of [
    "wallet_account_id",
    "user_id",
    "asset_id",
    "units",
    "evidence_reference",
    "journal_id",
    "token",
    "cookie",
  ]) {
    assert(!url.searchParams.has(name), `${label} no ${name}`);
  }
}

function assertNoForbiddenFinancialBody(body, label) {
  for (const marker of [
    "access_token",
    "refresh_token",
    "sb-access-token",
    "sb-refresh-token",
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
    "QA-REF-",
    "Evidence",
    "Digest",
    "Transaction",
    "Address",
    "Explorer",
    "APY",
    "Reward",
    "Fiat",
  ]) {
    assert(!body.includes(marker), `${label} no ${marker}`);
  }
}

function parseJsonRow(payload, label) {
  assert(Boolean(payload), label);

  return JSON.parse(payload);
}

function formatAtomicUnits(value) {
  assert(/^(0|[1-9][0-9]{0,37})$/.test(value), "Canonical unit fixture");

  let remaining = value;
  const groups = [];

  while (remaining.length > 3) {
    groups.unshift(remaining.slice(-3));
    remaining = remaining.slice(0, -3);
  }

  groups.unshift(remaining);

  return `${groups.join(",")} atomic units`;
}

function addAtomicUnits(left, right) {
  return (BigInt(left) + BigInt(right)).toString();
}

function subtractAtomicUnits(left, right) {
  const result = BigInt(left) - BigInt(right);

  assert(result >= 0n, "Non-negative unit fixture");

  return result.toString();
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
  return UUID_PATTERN.test(value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const message = error instanceof Error ? error.message : "unknown";

  console.error(redactDiagnostic(message));
  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED]");
}
