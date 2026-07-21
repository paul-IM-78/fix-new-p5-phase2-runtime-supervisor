import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";

const DB_CONTAINER = "supabase_db_staking-wallet-web";
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const POSITION_UNLOCK_ENDPOINTS = [
  "/api/v1/staking/positions/unlock",
  "/api/v1/admin/staking-positions/unlock",
];

async function main() {
  const runtime = await prepareManagedAppRuntime();

  try {
    await assertHttpSmoke();
    await assertSameOriginRejections();
    await assertDatabaseStateMachine();
    pass("Staking position unlock integration");
  } finally {
    await stopManagedAppRuntime(runtime);
  }
}

async function assertHttpSmoke() {
  await assertStatus("/api/v1/health", 200, "Health smoke");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness smoke");
  await assertStatus("/", 200, "Landing smoke");

  const staking = await appFetch("/staking", { redirect: "manual" });
  assertRedirectPath(staking, "/auth/sign-in", "Anonymous staking");
  assertRedirectQuery(staking, "next", "/staking", "Anonymous staking next");

  const admin = await appFetch("/admin/staking-positions", {
    redirect: "manual",
  });
  assertRedirectPath(admin, "/auth/sign-in", "Anonymous admin positions");
  pass("Staking unlock HTTP smoke");
}

async function assertSameOriginRejections() {
  const before = await unlockCounts();

  for (const endpoint of POSITION_UNLOCK_ENDPOINTS) {
    const noOrigin = await appFetch(endpoint, {
      method: "POST",
      body: unlockRejectionBody(),
      includeOrigin: false,
      redirect: "manual",
    });
    assertRedirectHasCode(noOrigin, "request_rejected", "Origin required");

    const external = await appFetch(endpoint, {
      method: "POST",
      body: unlockRejectionBody(),
      origin: "https://example.invalid",
      redirect: "manual",
    });
    assertRedirectHasCode(external, "request_rejected", "External origin");

    const fetchSite = await appFetch(endpoint, {
      method: "POST",
      body: unlockRejectionBody(),
      fetchSite: "cross-site",
      redirect: "manual",
    });
    assertRedirectHasCode(fetchSite, "request_rejected", "Fetch site");
  }

  assertCountsEqual(before, await unlockCounts(), "Origin rejection mutation");
  pass("Staking unlock same-origin rejection");
}

async function assertDatabaseStateMachine() {
  await seedActorsAndCatalog();
  const fixture = await createMaturedPosition(
    "00000000-0000-4000-8000-000000084001",
    "00000000-0000-4000-8000-000000083004",
    "00000000-0000-4000-8000-000000083005",
    "2000",
  );

  const early = await createEarlyPosition();
  const earlyUnlock = await userCommandRow(`
    select *
    from public.unlock_current_user_staking_position(
      ${sqlLiteral(early.positionId)}::uuid,
      1,
      ${early.walletVersion},
      '00000000-0000-4000-8000-000000083006'
    )
  `);
  assert(
    earlyUnlock.result_code === "STAKING_POSITION_NOT_MATURED",
    "Early user unlock blocked",
  );

  const before = await walletBalance(fixture.walletId);
  const unlocked = await userCommandRow(`
    select *
    from public.unlock_current_user_staking_position(
      ${sqlLiteral(fixture.positionId)}::uuid,
      1,
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-000000083007'
    )
  `);
  assert(unlocked.result_code === "APPLIED", "User unlock applied");
  assert(unlocked.position_status === "UNLOCKED", "User unlock status");
  assert(unlocked.maturity_state === "UNLOCKED", "User unlock maturity");

  const after = await walletBalance(fixture.walletId);
  assert(
    BigInt(after.available) === BigInt(before.available) + 2000n,
    "Available balance increased",
  );
  assert(
    BigInt(after.locked) === BigInt(before.locked) - 2000n,
    "Locked balance decreased",
  );
  assert(after.total === before.total, "Total liability unchanged");

  const replayed = await userCommandRow(`
    select *
    from public.unlock_current_user_staking_position(
      ${sqlLiteral(fixture.positionId)}::uuid,
      1,
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-000000083007'
    )
  `);
  assert(replayed.replayed === true, "User unlock replay");

  const noop = await userCommandRow(`
    select *
    from public.unlock_current_user_staking_position(
      ${sqlLiteral(fixture.positionId)}::uuid,
      2,
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-000000083008'
    )
  `);
  assert(noop.result_code === "NOOP", "User unlock noop");

  const conflict = await userCommandRow(`
    select *
    from public.unlock_current_user_staking_position(
      ${sqlLiteral(fixture.positionId)}::uuid,
      2,
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-000000083007'
    )
  `);
  assert(
    conflict.result_code === "STAKING_POSITION_COMMAND_ID_CONFLICT",
    "User unlock command conflict",
  );

  const adminFixture = await createMaturedPosition(
    "00000000-0000-4000-8000-000000084002",
    "00000000-0000-4000-8000-000000083009",
    "00000000-0000-4000-8000-000000083010",
    "1000",
  );
  await makeTargetOperationallyInactive();

  const adminAal1 = await expectSqlError(
    adminAal1ContextSql(`
      select *
      from public.unlock_staking_position_as_admin(
        ${sqlLiteral(adminFixture.positionId)}::uuid,
        1,
        '00000000-0000-4000-8000-000000083011',
        'admin aal1 blocked'
      );
    `),
  );
  assert(adminAal1, "Admin AAL1 unlock blocked");

  const adminUnlocked = await adminCommandRow(`
    select *
    from public.unlock_staking_position_as_admin(
      ${sqlLiteral(adminFixture.positionId)}::uuid,
      1,
      '00000000-0000-4000-8000-000000083012',
      'admin matured target cleanup'
    )
  `);
  assert(adminUnlocked.result_code === "APPLIED", "Admin unlock applied");

  const adminNoop = await adminCommandRow(`
    select *
    from public.unlock_staking_position_as_admin(
      ${sqlLiteral(adminFixture.positionId)}::uuid,
      2,
      '00000000-0000-4000-8000-000000083013',
      'admin matured target cleanup noop'
    )
  `);
  assert(adminNoop.result_code === "NOOP", "Admin unlock noop");

  await assertReadAndAuditBoundaries();
  await assertImmutableAndNoRewardBoundary();
  pass("Staking unlock database state machine");
}

async function seedActorsAndCatalog() {
  await sqlScalar(`
    insert into auth.users (
      id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values
      (
        '00000000-0000-4000-8000-000000080001',
        'authenticated',
        'authenticated',
        'staking-unlock-e2e-admin@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '00000000-0000-4000-8000-000000080002',
        'authenticated',
        'authenticated',
        'staking-unlock-e2e-user@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      );

    insert into public.user_roles (user_id, role, grant_reason)
    values (
      '00000000-0000-4000-8000-000000080001',
      'ADMIN',
      'local staking unlock e2e bootstrap'
    );

    insert into public.projects (
      id, project_code, display_name, description, status
    )
    values (
      '00000000-0000-4000-8000-000000081001',
      'E2EUNLOCKPROJ',
      'E2E Unlock Project',
      'local staking unlock e2e project',
      'ACTIVE'
    );

    insert into public.supported_assets (
      id, asset_code, symbol, display_name, asset_type, decimals,
      mint_address, status
    )
    values (
      '00000000-0000-4000-8000-000000082001',
      'E2EULK1',
      'EUL',
      'E2E Unlock SPL',
      'SPL_TOKEN',
      6,
      '11111111111111111111111111111181',
      'ACTIVE'
    );

    insert into public.project_token_assignments (project_id, asset_id)
    values (
      '00000000-0000-4000-8000-000000081001',
      '00000000-0000-4000-8000-000000082001'
    );
  `);

  const created = await adminCommandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000081001',
      '00000000-0000-4000-8000-000000082001',
      'UNLOCK_E2E_A',
      'Unlock E2E A',
      'local staking unlock product',
      1,
      '1000',
      '9000',
      25000,
      now() - interval '1 hour',
      now() + interval '30 days',
      '00000000-0000-4000-8000-000000083001',
      'create staking unlock product'
    )
  `);
  assert(created.result_code === "APPLIED", "Create unlock product");

  const activated = await adminCommandRow(`
    select *
    from public.transition_staking_product_status(
      ${sqlLiteral(created.staking_product_id)}::uuid,
      ${created.entity_version},
      'ACTIVE',
      '00000000-0000-4000-8000-000000083002',
      'activate staking unlock product'
    )
  `);
  assert(activated.result_code === "APPLIED", "Activate unlock product");

  const wallet = await readWallet();
  const opening = await adminCommandRow(`
    select *
    from public.post_opening_balance(
      ${sqlLiteral(wallet.id)}::uuid,
      ${wallet.version},
      '00000000-0000-4000-8000-000000082001',
      1,
      '10000',
      '00000000-0000-4000-8000-000000083003',
      'opening for staking unlock e2e'
    )
  `);
  assert(opening.result_code === "APPLIED", "Opening balance");
  pass("Staking unlock fixtures");
}

async function createMaturedPosition(
  positionId,
  lockJournalId,
  lockCommandId,
  units,
) {
  const wallet = await readWallet();
  const product = await readProduct();

  await sqlScalar(`
    do $$
    declare
      v_available_account_id uuid;
      v_locked_account_id uuid;
      v_locked_at timestamptz;
    begin
      perform private.ensure_wallet_asset_ledger_accounts(
        ${sqlLiteral(wallet.id)}::uuid,
        '00000000-0000-4000-8000-000000082001'
      );

      select
        (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
        (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_LOCKED'))::uuid
        into v_available_account_id, v_locked_account_id
      from private.ledger_accounts as accounts
      where accounts.account_scope = 'USER'
        and accounts.wallet_account_id = ${sqlLiteral(wallet.id)}::uuid
        and accounts.asset_id = '00000000-0000-4000-8000-000000082001'
        and accounts.account_purpose in ('USER_AVAILABLE', 'USER_LOCKED');

      v_locked_at := clock_timestamp() - interval '2 days';

      insert into private.ledger_journals (
        id, command_id, asset_id, journal_type, initiator_type,
        initiator_user_id, reference_type, reference_id, reason,
        request_data, posted_at
      )
      values (
        ${sqlLiteral(lockJournalId)}::uuid,
        ${sqlLiteral(lockCommandId)}::uuid,
        '00000000-0000-4000-8000-000000082001',
        'USER_STAKING_POSITION_LOCKED',
        'USER',
        '00000000-0000-4000-8000-000000080002',
        'STAKING_POSITION',
        ${sqlLiteral(positionId)}::uuid,
        'USER_STAKING_POSITION',
        jsonb_build_object('fixture', 'staking_position_unlock_e2e'),
        v_locked_at
      );

      insert into private.ledger_entries (
        journal_id, line_no, ledger_account_id, side, units
      )
      values
        (${sqlLiteral(lockJournalId)}::uuid, 1, v_available_account_id, 'DEBIT', ${sqlLiteral(units)}::numeric::private.positive_atomic_units),
        (${sqlLiteral(lockJournalId)}::uuid, 2, v_locked_account_id, 'CREDIT', ${sqlLiteral(units)}::numeric::private.positive_atomic_units);

      insert into private.staking_positions (
        id, staking_product_id, project_id, asset_id, wallet_account_id,
        user_id, principal_units, status, lock_journal_id,
        product_version_snapshot, lock_duration_days_snapshot,
        term_reward_rate_ppm_snapshot, reward_rounding_mode_snapshot,
        locked_at, matures_at
      )
      values (
        ${sqlLiteral(positionId)}::uuid,
        ${sqlLiteral(product.id)}::uuid,
        '00000000-0000-4000-8000-000000081001',
        '00000000-0000-4000-8000-000000082001',
        ${sqlLiteral(wallet.id)}::uuid,
        '00000000-0000-4000-8000-000000080002',
        ${sqlLiteral(units)}::numeric::private.positive_atomic_units,
        'LOCKED',
        ${sqlLiteral(lockJournalId)}::uuid,
        ${product.version},
        1,
        25000,
        'FLOOR',
        v_locked_at,
        v_locked_at + interval '1 day'
      );
    end;
    $$;
    set constraints all immediate;
    set constraints all deferred;
    select 'position';
  `);

  return {
    positionId,
    walletId: wallet.id,
    walletVersion: wallet.version,
  };
}

async function createEarlyPosition() {
  const wallet = await readWallet();
  const product = await readProduct();
  const result = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(product.id)}::uuid,
      ${product.version},
      ${sqlLiteral(wallet.id)}::uuid,
      ${wallet.version},
      '1000',
      '00000000-0000-4000-8000-000000084099',
      '00000000-0000-4000-8000-000000083099'
    )
  `);
  assert(result.result_code === "APPLIED", "Create early position");

  return {
    positionId: result.staking_position_id,
    walletVersion: wallet.version,
  };
}

async function makeTargetOperationallyInactive() {
  await sqlScalar(`
    update public.profiles
    set account_status = 'SUSPENDED'
    where id = '00000000-0000-4000-8000-000000080002';

    update public.wallet_accounts
    set status = 'FROZEN'
    where user_id = '00000000-0000-4000-8000-000000080002';

    select 'inactive';
  `);
}

async function assertReadAndAuditBoundaries() {
  const adminRead = await adminSqlScalar(`
    select count(*)::text
    from public.list_admin_staking_positions(100, 'UNLOCKED')
    where maturity_state = 'UNLOCKED'
      and unlock_actor_type in ('USER', 'ADMIN')
      and unlocked_at is not null;
  `);
  assert(Number(adminRead) >= 2, "Admin unlock read");

  const auditRead = await adminSqlScalar(`
    select count(*)::text
    from public.list_staking_position_command_audit_events(100, null)
    where action = 'UNLOCK_STAKING_POSITION'
      and outcome in ('APPLIED', 'NOOP')
      and resulting_journal_id is not null
      and previous_status in ('LOCKED', 'UNLOCKED');
  `);
  assert(Number(auditRead) >= 3, "Admin unlock audit read");
}

async function assertImmutableAndNoRewardBoundary() {
  const immutable = await expectSqlError(`
    update private.staking_positions
    set status = 'LOCKED'
    where id = '00000000-0000-4000-8000-000000084002';
  `);
  assert(immutable, "Unlocked position immutable");

  const rewardExpenseEntries = await sqlScalar(`
    select count(*)::text
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where accounts.account_purpose = 'SYSTEM_REWARD_EXPENSE';
  `);
  assert(Number(rewardExpenseEntries) === 0, "Reward posting remains zero");
}

async function adminCommandRow(selectSql) {
  const payload = await adminSqlScalar(`
    select row_to_json(command_result)::text
    from (${selectSql}) as command_result;
  `);

  return JSON.parse(payload);
}

async function userCommandRow(selectSql) {
  const payload = await userSqlScalar(`
    select row_to_json(command_result)::text
    from (${selectSql}) as command_result;
  `);

  return JSON.parse(payload);
}

async function readProduct() {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', products.id::text,
      'version', products.version
    )::text
    from private.staking_products as products
    where products.product_code = 'UNLOCK_E2E_A';
  `);

  assert(Boolean(payload), "Product row");

  return JSON.parse(payload);
}

async function readWallet() {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', wallet_accounts.id::text,
      'version', wallet_accounts.version
    )::text
    from public.wallet_accounts as wallet_accounts
    where wallet_accounts.user_id = '00000000-0000-4000-8000-000000080002';
  `);

  assert(Boolean(payload), "Wallet row");

  return JSON.parse(payload);
}

async function walletBalance(walletId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'available', balances.available_units::text,
      'locked', balances.locked_units::text,
      'total', balances.total_liability_units::text
    )::text
    from private.wallet_asset_ledger_balances as balances
    where balances.wallet_account_id = ${sqlLiteral(walletId)}::uuid
      and balances.asset_id = '00000000-0000-4000-8000-000000082001';
  `);

  return JSON.parse(payload);
}

async function unlockCounts() {
  const result = await sqlScalar(`
    select
      (select count(*) from private.staking_positions)::text || ',' ||
      (
        select count(*)
        from private.staking_position_command_audit_events
        where action = 'UNLOCK_STAKING_POSITION'
      )::text || ',' ||
      (
        select count(*)
        from private.ledger_journals
        where journal_type in (
          'USER_STAKING_POSITION_UNLOCKED',
          'ADMIN_STAKING_POSITION_UNLOCKED'
        )
      )::text;
  `);
  const [positions, audit, journals] = result.split(",").map(Number);

  return { positions, audit, journals };
}

function assertCountsEqual(before, after, label) {
  assert(
    before.positions === after.positions &&
      before.audit === after.audit &&
      before.journals === after.journals,
    label,
  );
}

async function adminSqlScalar(sql) {
  return sqlScalar(adminContextSql(sql));
}

async function userSqlScalar(sql) {
  return sqlScalar(userContextSql(sql));
}

function adminContextSql(sql) {
  return `
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000080001', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000080001', 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    ${sql}
  `;
}

function adminAal1ContextSql(sql) {
  return `
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000080001', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000080001', 'aal', 'aal1')::text,
      false
    );
    set role authenticated;
    ${sql}
  `;
}

function userContextSql(sql) {
  return `
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000080002', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000080002', 'aal', 'aal1')::text,
      false
    );
    set role authenticated;
    ${sql}
  `;
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

  assertOutputSafe(stdout, "SQL output");

  return stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

async function expectSqlError(sql) {
  try {
    await sqlScalar(sql);

    return false;
  } catch (error) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;

    assertOutputSafe(output, "Expected SQL error output");

    return true;
  }
}

async function appFetch(
  path,
  {
    method = "GET",
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

  const response = await fetch(`${APP_ORIGIN}${path}`, {
    method,
    headers,
    body: body ? new URLSearchParams(body) : undefined,
    redirect,
  });
  const clone = response.clone();
  const text = await clone.text();

  assertOutputSafe(text, `${path} body`);

  return response;
}

async function assertStatus(path, status, label) {
  const response = await appFetch(path, { redirect: "manual" });

  assert(response.status === status, label);
}

function unlockRejectionBody() {
  return {
    staking_position_id: "00000000-0000-4000-8000-000000000001",
    position_expected_version: "1",
    wallet_expected_version: "1",
    command_id: "00000000-0000-4000-8000-000000000002",
    reason: "same origin rejection",
  };
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
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      "3010",
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: process.cwd(),
      env,
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    },
  );

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
  const actual = getRedirectUrl(response, label);

  assert(actual.pathname === expectedPath, `${label} path`);
}

function assertRedirectQuery(response, name, expected, label) {
  const actual = getRedirectUrl(response, label);

  assert(actual.searchParams.get(name) === expected, `${label} query`);
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
  assertNoSensitiveRedirectQuery(actual, label);
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
    "staking_position_id",
    "wallet_account_id",
    "command_id",
    "position_expected_version",
    "wallet_expected_version",
    "principal_units",
    "reason",
    "journal_id",
    "balance",
    "token",
    "access_token",
    "refresh_token",
  ]) {
    assert(!url.searchParams.has(name), `${label} no ${name}`);
  }
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
    "otpauth://",
  ]) {
    assert(!output.includes(marker), `${label} no ${marker}`);
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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
    console.error(redactDiagnostic(message));
  } else {
    console.error(redactDiagnostic(`FAIL staking unlock integration ${message}`));
  }

  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value
    .replace(JWT_PATTERN, "[REDACTED]")
    .replace(UUID_PATTERN, "[REDACTED]");
}
