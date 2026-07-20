import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const UNITS = {
  deposit: "100",
  lock: "40",
  pendingWithdrawal: "10",
  overdraw: "51",
  one: "1",
  two: "2",
};

async function main() {
  const env = readLocalEnv();
  const suffix = randomUUID().replaceAll("-", "");
  const password = `Ledger-${suffix.slice(0, 20)}-Password1!`;
  const userEmail = `qa-ledger-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const otherEmail = `qa-ledger-other-${Date.now()}-${suffix.slice(8, 16)}@example.test`;

  await assertPreconditions();

  const userToken = await signUpConfirmAndToken(env, userEmail, password);
  const otherToken = await signUpConfirmAndToken(env, otherEmail, password);
  const userId = await readUserIdByEmail(userEmail);
  const otherUserId = await readUserIdByEmail(otherEmail);
  const wallet = await readWalletByUserId(userId);
  const asset = await createQaAsset(suffix);
  const accounts = await provisionLedgerAccounts(wallet.id, asset.id);

  await postDeposit(userId, asset.id, accounts);
  await assertBalanceRpc(env, userToken, {
    available: UNITS.deposit,
    locked: "0",
    pendingDeposit: "0",
    pendingWithdrawal: "0",
    total: UNITS.deposit,
  });

  await postUserMove(
    userId,
    asset.id,
    accounts.USER_AVAILABLE,
    accounts.USER_LOCKED,
    UNITS.lock,
    "QA_LOCK",
  );
  await assertBalanceRpc(env, userToken, {
    available: "60",
    locked: UNITS.lock,
    pendingDeposit: "0",
    pendingWithdrawal: "0",
    total: UNITS.deposit,
  });

  await postUserMove(
    userId,
    asset.id,
    accounts.USER_AVAILABLE,
    accounts.USER_PENDING_WITHDRAWAL,
    UNITS.pendingWithdrawal,
    "QA_WITHDRAWAL_PENDING",
  );
  await assertBalanceRpc(env, userToken, {
    available: "50",
    locked: UNITS.lock,
    pendingDeposit: "0",
    pendingWithdrawal: UNITS.pendingWithdrawal,
    total: UNITS.deposit,
  });

  await assertOtherUserNoBalance(env, otherToken);
  await assertBrowserDirectLedgerAccessBlocked(userId, asset.id, accounts);
  await assertNegativeBalanceBlocked(userId, asset.id, accounts);
  await assertReplayAndConflict(userId, asset.id, accounts);
  await assertCrossAssetBlocked(userId, asset.id, accounts, suffix);
  await assertUnbalancedBlocked(userId, asset.id, accounts);
  await assertJournalEntryImmutable();
  await assertInactiveProfileBlocked(env, userToken, userId);
  await assertNoQaCredentialPersistence(userId, otherUserId);

  pass("Ledger core integration");
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
  pass("Ledger core preconditions");
}

async function signUpConfirmAndToken(env, email, password) {
  const signup = await supabaseFetch(env, "/auth/v1/signup", {
    method: "POST",
    body: {
      email,
      password,
      data: {
        display_name: "QA Ledger User",
      },
    },
  });

  assert(signup.ok, "Ledger signup");

  const confirmationLink = await pollMailpitLink(
    email,
    CONFIRMATION_SUBJECT,
    "/auth/confirm",
  );
  const confirmationUrl = new URL(confirmationLink);
  const tokenHash = confirmationUrl.searchParams.get("token_hash");

  assert(Boolean(tokenHash), "Ledger confirmation token");

  const confirm = await appFetch("/api/v1/auth/confirm", {
    method: "POST",
    body: {
      token_hash: tokenHash,
      type: "email",
      next: "/account",
    },
    redirect: "manual",
  });

  assert(
    confirm.status >= 300 && confirm.status < 400,
    "Ledger confirmation redirect",
  );
  assertNoSensitiveRedirect(confirm, "Ledger confirmation redirect");

  const token = await supabaseFetch(
    env,
    "/auth/v1/token?grant_type=password",
    {
      method: "POST",
      body: {
        email,
        password,
      },
    },
  );
  const payload = await safeJson(token, "Ledger token payload", {
    allowSensitive: true,
  });

  assert(token.ok, "Ledger token status");
  assert(typeof payload?.access_token === "string", "Ledger token shape");

  return payload.access_token;
}

async function createQaAsset(suffix) {
  const assetId = randomUUID();
  const assetCode = `LEDGER_E2E_${suffix.slice(0, 8).toUpperCase()}`;
  const assetSymbol = `LE${suffix.slice(0, 4).toUpperCase()}`;
  const mint = randomBase58(44);

  const payload = await sqlScalar(
    `
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
      'Ledger E2E QA Asset',
      'SPL_TOKEN',
      6,
      ${sqlLiteral(mint)},
      'ACTIVE'
    );

    select json_build_object(
      'id', ${sqlLiteral(assetId)},
      'code', ${sqlLiteral(assetCode)}
    )::text;
    `,
    "Create ledger QA asset",
  );

  const asset = JSON.parse(payload);

  assert(isUuid(asset.id), "Ledger QA asset id");

  return asset;
}

async function provisionLedgerAccounts(walletId, assetId) {
  const payload = await sqlScalar(
    `
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
    `,
    "Provision ledger accounts",
  );
  const accounts = JSON.parse(payload);

  for (const purpose of [
    "USER_AVAILABLE",
    "USER_LOCKED",
    "USER_PENDING_DEPOSIT",
    "USER_PENDING_WITHDRAWAL",
    "SYSTEM_CUSTODY",
    "SYSTEM_DEPOSIT_CLEARING",
    "SYSTEM_WITHDRAWAL_CLEARING",
    "SYSTEM_REWARD_EXPENSE",
    "SYSTEM_TOKEN_ISSUANCE",
    "SYSTEM_SUSPENSE",
  ]) {
    assert(isUuid(accounts[purpose]), `Ledger account ${purpose}`);
  }

  pass("Ledger account provisioning");

  return accounts;
}

async function postDeposit(userId, assetId, accounts) {
  const result = await postLedgerJournal({
    commandId: "00000000-0000-4000-8000-000000020001",
    assetId,
    journalType: "QA_DEPOSIT",
    userId,
    referenceId: "00000000-0000-4000-8000-000000020101",
    reason: "ledger e2e deposit",
    lines: [
      {
        accountId: accounts.SYSTEM_CUSTODY,
        side: "DEBIT",
        units: UNITS.deposit,
      },
      {
        accountId: accounts.USER_AVAILABLE,
        side: "CREDIT",
        units: UNITS.deposit,
      },
    ],
  });

  assert(result.replayed === false, "Ledger deposit applied");
  pass("Ledger deposit posting");
}

async function postUserMove(
  userId,
  assetId,
  debitAccountId,
  creditAccountId,
  units,
  journalType,
) {
  const result = await postLedgerJournal({
    commandId: randomUUID(),
    assetId,
    journalType,
    userId,
    referenceId: randomUUID(),
    reason: "ledger e2e bucket move",
    lines: [
      {
        accountId: debitAccountId,
        side: "DEBIT",
        units,
      },
      {
        accountId: creditAccountId,
        side: "CREDIT",
        units,
      },
    ],
  });

  assert(result.replayed === false, "Ledger bucket move applied");
  pass(`Ledger ${journalType} posting`);
}

async function postLedgerJournal({
  commandId,
  assetId,
  journalType,
  userId,
  referenceId,
  reason,
  lines,
}) {
  const payload = await sqlScalar(
    `
    select json_build_object(
      'journalId', journal_id::text,
      'replayed', replayed
    )::text
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
    `,
    "Post ledger journal",
  );
  const result = JSON.parse(payload);

  assert(isUuid(result.journalId), "Ledger journal id");

  return result;
}

async function assertBalanceRpc(env, token, expected) {
  const response = await supabaseFetch(
    env,
    "/rest/v1/rpc/list_current_user_ledger_balances",
    {
      method: "POST",
      token,
      body: {},
    },
  );
  const payload = await safeJson(response, "Ledger balance payload");

  assert(response.ok, "Ledger balance rpc status");
  assert(Array.isArray(payload), "Ledger balance rpc array");
  assert(payload.length === 1, "Ledger balance rpc row count");

  const [row] = payload;

  assertUnits(row.available_units, expected.available, "Available units");
  assertUnits(row.locked_units, expected.locked, "Locked units");
  assertUnits(row.pending_deposit_units, expected.pendingDeposit, "Pending deposit units");
  assertUnits(
    row.pending_withdrawal_units,
    expected.pendingWithdrawal,
    "Pending withdrawal units",
  );
  assertUnits(row.total_liability_units, expected.total, "Total liability units");

  for (const forbidden of ["ledger_account_id", "journal_id", "entry_id"]) {
    assert(!(forbidden in row), `Balance rpc no ${forbidden}`);
  }

  pass("Ledger balance rpc");
}

async function assertOtherUserNoBalance(env, token) {
  const response = await supabaseFetch(
    env,
    "/rest/v1/rpc/list_current_user_ledger_balances",
    {
      method: "POST",
      token,
      body: {},
    },
  );
  const payload = await safeJson(response, "Other ledger balance payload");

  assert(response.ok, "Other balance rpc status");
  assert(Array.isArray(payload), "Other balance rpc array");
  assert(payload.length === 0, "Other user sees no ledger rows");
  pass("Other user ledger non-exposure");
}

async function assertBrowserDirectLedgerAccessBlocked(userId, assetId, accounts) {
  await sqlScalar(
    `
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal1')::text,
      false
    );
    set role authenticated;

    do $$
    begin
      perform count(*) from private.ledger_journals;
      raise exception 'expected private table denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;

    do $$
    begin
      perform *
      from private.post_ledger_journal(
        gen_random_uuid(),
        ${sqlLiteral(assetId)}::uuid,
        'QA_BROWSER_POST',
        'USER',
        ${sqlLiteral(userId)}::uuid,
        'QA_REFERENCE',
        gen_random_uuid(),
        'browser blocked',
        jsonb_build_array(
          jsonb_build_object('account_id', ${sqlLiteral(accounts.SYSTEM_CUSTODY)}, 'side', 'DEBIT', 'units', '1'),
          jsonb_build_object('account_id', ${sqlLiteral(accounts.USER_AVAILABLE)}, 'side', 'CREDIT', 'units', '1')
        )
      );
      raise exception 'expected private posting denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;

    reset role;
    select 'blocked';
    `,
    "Browser ledger access blocked",
  );
  pass("Browser ledger direct access blocked");
}

async function assertNegativeBalanceBlocked(userId, assetId, accounts) {
  await sqlScalar(
    `
    do $$
    begin
      perform *
      from private.post_ledger_journal(
        ${sqlLiteral(randomUUID())}::uuid,
        ${sqlLiteral(assetId)}::uuid,
        'QA_OVERDRAW',
        'USER',
        ${sqlLiteral(userId)}::uuid,
        'QA_REFERENCE',
        ${sqlLiteral(randomUUID())}::uuid,
        'ledger e2e overdraw',
        jsonb_build_array(
          jsonb_build_object('account_id', ${sqlLiteral(accounts.USER_AVAILABLE)}, 'side', 'DEBIT', 'units', ${sqlLiteral(UNITS.overdraw)}),
          jsonb_build_object('account_id', ${sqlLiteral(accounts.USER_LOCKED)}, 'side', 'CREDIT', 'units', ${sqlLiteral(UNITS.overdraw)})
        )
      );
      raise exception 'expected overdraw failure';
    exception
      when check_violation then
        null;
    end;
    $$;

    select 'blocked';
    `,
    "Negative ledger balance blocked",
  );
  pass("Negative user balance blocked");
}

async function assertReplayAndConflict(userId, assetId, accounts) {
  const replay = await postLedgerJournal({
    commandId: "00000000-0000-4000-8000-000000020001",
    assetId,
    journalType: "QA_DEPOSIT",
    userId,
    referenceId: "00000000-0000-4000-8000-000000020101",
    reason: "ledger e2e deposit",
    lines: [
      {
        accountId: accounts.USER_AVAILABLE,
        side: "CREDIT",
        units: UNITS.deposit,
      },
      {
        accountId: accounts.SYSTEM_CUSTODY,
        side: "DEBIT",
        units: UNITS.deposit,
      },
    ],
  });

  assert(replay.replayed === true, "Ledger replay flag");

  await sqlScalar(
    `
    do $$
    begin
      perform *
      from private.post_ledger_journal(
        '00000000-0000-4000-8000-000000020001',
        ${sqlLiteral(assetId)}::uuid,
        'QA_DEPOSIT',
        'USER',
        ${sqlLiteral(userId)}::uuid,
        'QA_REFERENCE',
        '00000000-0000-4000-8000-000000020101',
        'ledger e2e deposit changed',
        jsonb_build_array(
          jsonb_build_object('account_id', ${sqlLiteral(accounts.SYSTEM_CUSTODY)}, 'side', 'DEBIT', 'units', ${sqlLiteral(UNITS.deposit)}),
          jsonb_build_object('account_id', ${sqlLiteral(accounts.USER_AVAILABLE)}, 'side', 'CREDIT', 'units', ${sqlLiteral(UNITS.deposit)})
        )
      );
      raise exception 'expected command conflict';
    exception
      when unique_violation then
        null;
    end;
    $$;

    select count(*)::text
    from private.ledger_journals
    where command_id = '00000000-0000-4000-8000-000000020001';
    `,
    "Ledger replay conflict",
  );
  pass("Ledger replay and conflict");
}

async function assertCrossAssetBlocked(userId, firstAssetId, accounts, suffix) {
  const secondAsset = await createQaAsset(`${suffix.slice(8)}B`);
  const secondSystemAccounts = JSON.parse(
    await sqlScalar(
      `
      with system_accounts as (
        select *
        from private.ensure_system_ledger_accounts(
          ${sqlLiteral(secondAsset.id)}::uuid
        )
      )
      select json_object_agg(account_purpose, ledger_account_id::text)::text
      from system_accounts;
      `,
      "Provision second asset system accounts",
    ),
  );

  await sqlScalar(
    `
    do $$
    begin
      perform *
      from private.post_ledger_journal(
        ${sqlLiteral(randomUUID())}::uuid,
        ${sqlLiteral(firstAssetId)}::uuid,
        'QA_CROSS_ASSET',
        'USER',
        ${sqlLiteral(userId)}::uuid,
        'QA_REFERENCE',
        ${sqlLiteral(randomUUID())}::uuid,
        'ledger e2e cross asset',
        jsonb_build_array(
          jsonb_build_object('account_id', ${sqlLiteral(accounts.USER_AVAILABLE)}, 'side', 'DEBIT', 'units', ${sqlLiteral(UNITS.one)}),
          jsonb_build_object('account_id', ${sqlLiteral(secondSystemAccounts.SYSTEM_CUSTODY)}, 'side', 'CREDIT', 'units', ${sqlLiteral(UNITS.one)})
        )
      );
      raise exception 'expected cross asset failure';
    exception
      when check_violation then
        null;
    end;
    $$;

    select 'blocked';
    `,
    "Cross asset ledger posting blocked",
  );
  pass("Cross asset ledger posting blocked");
}

async function assertUnbalancedBlocked(userId, assetId, accounts) {
  await sqlScalar(
    `
    do $$
    begin
      perform *
      from private.post_ledger_journal(
        ${sqlLiteral(randomUUID())}::uuid,
        ${sqlLiteral(assetId)}::uuid,
        'QA_UNBALANCED',
        'USER',
        ${sqlLiteral(userId)}::uuid,
        'QA_REFERENCE',
        ${sqlLiteral(randomUUID())}::uuid,
        'ledger e2e unbalanced',
        jsonb_build_array(
          jsonb_build_object('account_id', ${sqlLiteral(accounts.SYSTEM_CUSTODY)}, 'side', 'DEBIT', 'units', ${sqlLiteral(UNITS.two)}),
          jsonb_build_object('account_id', ${sqlLiteral(accounts.USER_AVAILABLE)}, 'side', 'CREDIT', 'units', ${sqlLiteral(UNITS.one)})
        )
      );
      raise exception 'expected unbalanced failure';
    exception
      when check_violation then
        null;
    end;
    $$;

    select 'blocked';
    `,
    "Unbalanced ledger posting blocked",
  );
  pass("Unbalanced ledger posting blocked");
}

async function assertJournalEntryImmutable() {
  await sqlScalar(
    `
    do $$
    begin
      update private.ledger_journals
      set reason = 'blocked';
      raise exception 'expected journal update failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;

    do $$
    begin
      delete from private.ledger_entries;
      raise exception 'expected entry delete failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;

    select 'immutable';
    `,
    "Ledger immutability",
  );
  pass("Ledger journal and entry immutability");
}

async function assertInactiveProfileBlocked(env, token, userId) {
  for (const status of ["RESTRICTED", "SUSPENDED", "WITHDRAWN"]) {
    await setProfileStatus(userId, status);

    const response = await supabaseFetch(
      env,
      "/rest/v1/rpc/list_current_user_ledger_balances",
      {
        method: "POST",
        token,
        body: {},
      },
    );
    const body = await response.text();

    assert(response.status === 401 || response.status === 403, "Inactive balance status");
    assertNoSensitiveBody(body, "Inactive balance body");
  }

  await setProfileStatus(userId, "ACTIVE");
  pass("Inactive profile balance access blocked");
}

async function assertNoQaCredentialPersistence(userId, otherUserId) {
  const residue = await sqlScalar(
    `
    select json_build_object(
      'users',
        (
          select count(*)
          from auth.users
          where id in (
            ${sqlLiteral(userId)}::uuid,
            ${sqlLiteral(otherUserId)}::uuid
          )
        ),
      'ledger_accounts', (select count(*) from private.ledger_accounts),
      'journals', (select count(*) from private.ledger_journals),
      'entries', (select count(*) from private.ledger_entries)
    )::text;
    `,
    "Ledger QA residue check",
  );
  const payload = JSON.parse(residue);

  assert(payload.users === 2, "Ledger QA auth users in transaction");
  assert(payload.ledger_accounts >= 10, "Ledger QA accounts exist before final reset");
  assert(payload.journals >= 3, "Ledger QA journals exist before final reset");
  assert(payload.entries >= 6, "Ledger QA entries exist before final reset");
  pass("Ledger QA data is local reset-scoped");
}

async function readUserIdByEmail(email) {
  const rawUserId = await sqlScalar(
    `
    select users.id::text
    from auth.users as users
    where users.email = ${sqlLiteral(email)};
    `,
    "Read ledger user id",
  );
  const userId = rawUserId.match(UUID_PATTERN)?.[0] ?? "";

  assert(isUuid(userId), "Ledger auth user id");

  return userId;
}

async function readWalletByUserId(userId) {
  const payload = await sqlScalar(
    `
    select json_build_object(
      'id', wallet_accounts.id::text,
      'userId', wallet_accounts.user_id::text,
      'status', wallet_accounts.status
    )::text
    from public.wallet_accounts
    where user_id = ${sqlLiteral(userId)}::uuid;
    `,
    "Read ledger wallet",
  );
  const wallet = JSON.parse(payload);

  assert(isUuid(wallet.id), "Ledger wallet id");
  assert(wallet.status === "ACTIVE", "Ledger wallet active");

  return wallet;
}

async function setProfileStatus(userId, status) {
  const result = await sqlScalar(
    `
    update public.profiles
    set account_status = ${sqlLiteral(status)}
    where id = ${sqlLiteral(userId)}::uuid;

    select account_status
    from public.profiles
    where id = ${sqlLiteral(userId)}::uuid;
    `,
    "Set ledger profile status",
  );

  assert(result === status, "Ledger profile status stored");
}

async function sqlScalar(sql, label) {
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

    assertNoSensitiveBody(output, `${label} output`);

    return output.split(/\r?\n/).at(-1)?.trim() ?? "";
  } catch {
    throw new Error(`FAIL ${label}`);
  }
}

async function appFetch(
  path,
  {
    method = "GET",
    body,
    redirect = "manual",
  } = {},
) {
  const headers = new Headers();

  if (body) {
    headers.set("content-type", "application/x-www-form-urlencoded");
  }

  if (method !== "GET") {
    headers.set("origin", APP_ORIGIN);
    headers.set("sec-fetch-site", "same-origin");
  }

  return fetch(`${APP_ORIGIN}${path}`, {
    method,
    headers,
    body: body ? new URLSearchParams(body) : undefined,
    redirect,
  });
}

async function supabaseFetch(
  env,
  path,
  {
    method = "GET",
    token,
    body,
  } = {},
) {
  const headers = new Headers({
    apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (body) {
    headers.set("content-type", "application/json");
  }

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  return fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
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

  assert(response.ok, "Mailpit precondition");
}

async function assertDatabaseReady() {
  const result = await sqlScalar("select 'ready';", "Database ready");

  assert(result === "ready", "Database precondition");
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

  throw new Error("FAIL Ledger confirmation mail");
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

async function safeJson(response, label, { allowSensitive = false } = {}) {
  const text = await response.text();

  if (!allowSensitive) {
    assertNoSensitiveBody(text, label);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`FAIL ${label}`);
  }
}

function readLocalEnv() {
  const envText = readFileSync(".env.local", "utf8");
  const env = {};

  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);

    if (!match) {
      continue;
    }

    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }

  assert(
    env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://"),
    "Local Supabase URL",
  );
  assert(
    typeof env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === "string" &&
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length > 0,
    "Local Supabase publishable key",
  );

  return env;
}

function assertUnits(actual, expected, label) {
  assert(typeof actual === "string", `${label} text`);
  assert(/^(0|[1-9][0-9]*)$/.test(actual), `${label} decimal string`);
  assert(BigInt(actual) === BigInt(expected), label);
}

function assertNoSensitiveRedirect(response, label) {
  const location = response.headers.get("location") ?? "";

  assertNoSensitiveBody(location, label);
}

function assertNoSensitiveBody(body, label) {
  assert(!JWT_PATTERN.test(body), `${label} no jwt`);

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
    "otpauth://",
  ]) {
    assert(!body.includes(marker), `${label} no ${marker}`);
  }
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

function randomBase58(length) {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * BASE58_ALPHABET.length);

    value += BASE58_ALPHABET[randomIndex];
  }

  return value;
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
    console.error("FAIL ledger core integration");
  }

  process.exitCode = 1;
});
