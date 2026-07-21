import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";

const DB_CONTAINER = "supabase_db_staking-wallet-web";
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const ADMIN_ID = "00000000-0000-4000-8000-0000000a0001";
const USER_ID = "00000000-0000-4000-8000-0000000a0002";
const PROJECT_ID = "00000000-0000-4000-8000-0000000a1001";
const ASSET_ID = "00000000-0000-4000-8000-0000000a2001";

async function main() {
  const runtime = await prepareManagedAppRuntime();

  try {
    await assertHttpSmoke();
    await assertStaticLifecycleUi();
    await assertSameOriginBoundaries();
    await assertDatabaseLifecycle();
    await resetLocalDatabase("Lifecycle reset");
    pass("Staking lifecycle integration");
  } finally {
    await stopManagedAppRuntime(runtime);
  }
}

async function assertHttpSmoke() {
  await assertStatus("/api/v1/health", 200, "Health smoke");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness smoke");
  await assertStatus("/", 200, "Landing smoke");

  for (const path of ["/staking", "/admin/staking-products", "/admin/staking-positions"]) {
    const response = await appFetch(path, { redirect: "manual" });
    assertRedirectPath(response, "/auth/sign-in", `${path} anonymous`);
  }

  pass("Lifecycle HTTP smoke");
}

async function assertStaticLifecycleUi() {
  const stakingPage = readFileSync("src/app/staking/page.tsx", "utf8");
  const adminPositionsPage = readFileSync(
    "src/app/admin/staking-positions/page.tsx",
    "utf8",
  );
  const adminProductsPage = readFileSync(
    "src/app/admin/staking-products/page.tsx",
    "utf8",
  );
  const navigationPages = [
    "src/app/dashboard/page.tsx",
    "src/app/account/page.tsx",
    "src/app/wallet/page.tsx",
    "src/app/balances/page.tsx",
    "src/app/deposits/page.tsx",
  ]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  for (const marker of [
    "Action Required",
    "Active Locks",
    "Asset balances",
    "Products",
    "Completed",
    "Principal atomic units",
    "Settle reward",
  ]) {
    assert(stakingPage.includes(marker), `Staking page ${marker}`);
  }

  for (const marker of [
    "Principal Unlock Queue",
    "Reward Settlement Queue",
    "OperationsSummary",
    "Inactive profiles",
    "Frozen or closed wallets",
  ]) {
    assert(adminPositionsPage.includes(marker), `Admin positions ${marker}`);
  }

  assert(
    adminProductsPage.includes("Position operations") &&
      adminProductsPage.includes("Product and position lifecycle are separate"),
    "Admin product cross-link",
  );
  assert(
    navigationPages.includes("Staking lifecycle") &&
      navigationPages.includes("Available units") &&
      navigationPages.includes("separate staking position command"),
    "User navigation staking copy",
  );

  for (const page of [stakingPage, adminPositionsPage]) {
    for (const marker of [
      'name="reward_units"',
      'name="reward_rate"',
      'name="debit_account"',
      'name="credit_account"',
      'name="ledger_side"',
      'name="journal_id"',
      "createBrowserClient",
      "localStorage",
      "sessionStorage",
      "Math.floor",
      "parseFloat",
    ]) {
      assert(!page.includes(marker), `Lifecycle UI no ${marker}`);
    }
  }

  pass("Lifecycle static UI boundary");
}

async function assertSameOriginBoundaries() {
  for (const endpoint of [
    "/api/v1/staking/positions/create",
    "/api/v1/staking/positions/unlock",
    "/api/v1/staking/positions/settle-reward",
    "/api/v1/admin/staking-positions/unlock",
    "/api/v1/admin/staking-positions/settle-reward",
  ]) {
    const response = await appFetch(endpoint, {
      method: "POST",
      body: commandRejectionBody(),
      includeOrigin: false,
      redirect: "manual",
    });

    assertRedirectHasCode(response, "request_rejected", `${endpoint} origin`);
  }

  pass("Lifecycle same-origin boundary");
}

async function assertDatabaseLifecycle() {
  await seedActorsAndCatalog();
  const product = await createAndActivateProduct();
  await postOpeningBalance("10000");
  await assertProductRead(product.productId);
  await assertActiveLock(product);
  await assertPositiveReward(product);
  await assertZeroReward(product);
  await assertAdminOperationsRead();
  await assertNoGenericRewardInputs();
  pass("Lifecycle database path");
}

async function seedActorsAndCatalog() {
  await sqlScalar(`
    insert into auth.users (
      id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values
      (
        ${sqlLiteral(ADMIN_ID)}::uuid,
        'authenticated',
        'authenticated',
        'staking-lifecycle-admin@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        ${sqlLiteral(USER_ID)}::uuid,
        'authenticated',
        'authenticated',
        'staking-lifecycle-user@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      );

    insert into public.user_roles (user_id, role, grant_reason)
    values (
      ${sqlLiteral(ADMIN_ID)}::uuid,
      'ADMIN',
      'local staking lifecycle bootstrap'
    );

    insert into public.projects (
      id, project_code, display_name, description, status
    )
    values (
      ${sqlLiteral(PROJECT_ID)}::uuid,
      'E2ELIFEPROJ',
      'E2E Lifecycle Project',
      'local staking lifecycle project',
      'ACTIVE'
    );

    insert into public.supported_assets (
      id, asset_code, symbol, display_name, asset_type, decimals,
      mint_address, status
    )
    values (
      ${sqlLiteral(ASSET_ID)}::uuid,
      'E2ELIFE1',
      'ELF',
      'E2E Lifecycle SPL',
      'SPL_TOKEN',
      6,
      '11111111111111111111111111111181',
      'ACTIVE'
    );

    insert into public.project_token_assignments (project_id, asset_id)
    values (${sqlLiteral(PROJECT_ID)}::uuid, ${sqlLiteral(ASSET_ID)}::uuid);

    select 'seeded';
  `);
  pass("Lifecycle fixtures");
}

async function createAndActivateProduct() {
  const created = await adminCommandRow(`
    select *
    from public.create_staking_product(
      ${sqlLiteral(PROJECT_ID)}::uuid,
      ${sqlLiteral(ASSET_ID)}::uuid,
      'LIFECYCLE_A',
      'Lifecycle A',
      'local lifecycle product',
      1,
      '1',
      null,
      250000,
      now() - interval '1 hour',
      now() + interval '30 days',
      '00000000-0000-4000-8000-0000000a3001',
      'create lifecycle product'
    )
  `);
  assert(created.result_code === "APPLIED", "Lifecycle product create");

  const activated = await adminCommandRow(`
    select *
    from public.transition_staking_product_status(
      ${sqlLiteral(created.staking_product_id)}::uuid,
      ${created.entity_version},
      'ACTIVE',
      '00000000-0000-4000-8000-0000000a3002',
      'activate lifecycle product'
    )
  `);
  assert(activated.result_code === "APPLIED", "Lifecycle product active");

  return {
    productId: activated.staking_product_id,
    version: activated.entity_version,
  };
}

async function postOpeningBalance(units) {
  const wallet = await readWallet();
  const opening = await adminCommandRow(`
    select *
    from public.post_opening_balance(
      ${sqlLiteral(wallet.id)}::uuid,
      ${wallet.version},
      ${sqlLiteral(ASSET_ID)}::uuid,
      1,
      ${sqlLiteral(units)},
      '00000000-0000-4000-8000-0000000a3003',
      'opening for lifecycle'
    )
  `);

  assert(opening.result_code === "APPLIED", "Lifecycle opening balance");
  pass("Lifecycle opening balance");
}

async function assertProductRead(productId) {
  const visible = await userSqlScalar(`
    select count(*)::text
    from public.list_current_staking_products(50)
    where staking_product_id = ${sqlLiteral(productId)}::uuid
      and enrollment_state = 'OPEN';
  `);

  assert(visible === "1", "Lifecycle user product read");
  pass("Lifecycle product read");
}

async function assertActiveLock(product) {
  const wallet = await readWallet();
  const before = await walletBalance(wallet.id);
  const created = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(product.productId)}::uuid,
      ${product.version},
      ${sqlLiteral(wallet.id)}::uuid,
      ${wallet.version},
      '2000',
      '00000000-0000-4000-8000-0000000a4001',
      '00000000-0000-4000-8000-0000000a3004'
    )
  `);

  assert(created.result_code === "APPLIED", "Lifecycle position create");
  const after = await walletBalance(wallet.id);
  assert(
    BigInt(after.available) === BigInt(before.available) - 2000n,
    "Lifecycle available decreases",
  );
  assert(
    BigInt(after.locked) === BigInt(before.locked) + 2000n,
    "Lifecycle locked increases",
  );
  assert(after.total === before.total, "Lifecycle total unchanged");

  const activeLock = await userSqlScalar(`
    select count(*)::text
    from public.list_current_user_staking_positions(100)
    where staking_position_id = '00000000-0000-4000-8000-0000000a4001'
      and status = 'LOCKED'
      and maturity_state = 'LOCKED'
      and reward_state = 'NOT_ELIGIBLE';
  `);

  assert(activeLock === "1", "Lifecycle active lock read");
  pass("Lifecycle active lock");
}

async function assertPositiveReward(product) {
  const fixture = await createMaturedPosition({
    product,
    positionId: "00000000-0000-4000-8000-0000000a4011",
    lockJournalId: "00000000-0000-4000-8000-0000000a4012",
    lockCommandId: "00000000-0000-4000-8000-0000000a3011",
    principalUnits: "1000",
  });
  const before = await walletBalance(fixture.walletId);
  const unlocked = await userCommandRow(`
    select *
    from public.unlock_current_user_staking_position(
      ${sqlLiteral(fixture.positionId)}::uuid,
      1,
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-0000000a3012'
    )
  `);
  assert(unlocked.result_code === "APPLIED", "Lifecycle principal unlock");

  const claimable = await userSqlScalar(`
    select count(*)::text
    from public.list_current_user_staking_positions(100)
    where staking_position_id = ${sqlLiteral(fixture.positionId)}::uuid
      and status = 'UNLOCKED'
      and reward_state = 'CLAIMABLE'
      and calculated_reward_units = '250';
  `);
  assert(claimable === "1", "Lifecycle reward claimable");

  const wallet = await readWallet();
  const settled = await userCommandRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(fixture.positionId)}::uuid,
      2,
      ${wallet.version},
      '00000000-0000-4000-8000-0000000a3013'
    )
  `);
  assert(settled.result_code === "APPLIED", "Lifecycle reward paid");
  assert(settled.reward_state === "PAID", "Lifecycle reward state paid");
  assert(settled.reward_units === "250", "Lifecycle reward units");

  const after = await walletBalance(fixture.walletId);
  assert(
    BigInt(after.available) === BigInt(before.available) + 1250n,
    "Lifecycle available after unlock and reward",
  );
  assert(
    BigInt(after.locked) === BigInt(before.locked) - 1000n,
    "Lifecycle locked decreases after unlock",
  );
  assert(
    BigInt(after.total) === BigInt(before.total) + 250n,
    "Lifecycle total reward liability",
  );
  pass("Lifecycle positive reward");
}

async function assertZeroReward(product) {
  const fixture = await createMaturedPosition({
    product,
    positionId: "00000000-0000-4000-8000-0000000a4021",
    lockJournalId: "00000000-0000-4000-8000-0000000a4022",
    lockCommandId: "00000000-0000-4000-8000-0000000a3021",
    principalUnits: "3",
  });
  const before = await rewardCounts();
  const wallet = await readWallet();
  const unlocked = await userCommandRow(`
    select *
    from public.unlock_current_user_staking_position(
      ${sqlLiteral(fixture.positionId)}::uuid,
      1,
      ${wallet.version},
      '00000000-0000-4000-8000-0000000a3022'
    )
  `);
  assert(unlocked.result_code === "APPLIED", "Lifecycle zero unlock");

  const afterUnlockWallet = await readWallet();
  const settled = await userCommandRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(fixture.positionId)}::uuid,
      2,
      ${afterUnlockWallet.version},
      '00000000-0000-4000-8000-0000000a3023'
    )
  `);
  const after = await rewardCounts();

  assert(settled.result_code === "APPLIED", "Lifecycle zero applied");
  assert(settled.reward_state === "ZERO", "Lifecycle zero state");
  assert(settled.reward_units === "0", "Lifecycle zero units");
  assert(after.settlements === before.settlements + 1, "Lifecycle zero row");
  assert(after.audit === before.audit + 1, "Lifecycle zero audit");
  assert(after.journals === before.journals, "Lifecycle zero journal");
  assert(after.entries === before.entries, "Lifecycle zero entries");
  pass("Lifecycle zero reward");
}

async function assertAdminOperationsRead() {
  const adminRows = await adminSqlScalar(`
    select
      (
        count(*) filter (
          where status = 'LOCKED' and maturity_state = 'LOCKED'
        ) >= 1
        and count(*) filter (
          where status = 'UNLOCKED' and reward_state = 'PAID'
        ) >= 1
        and count(*) filter (
          where status = 'UNLOCKED' and reward_state = 'ZERO'
        ) >= 1
      )::text
    from public.list_admin_staking_positions(100, null);
  `);
  const positionAudit = await adminSqlScalar(`
    select (count(*) >= 3)::text
    from public.list_staking_position_command_audit_events(50, null);
  `);
  const rewardAudit = await adminSqlScalar(`
    select (count(*) >= 2)::text
    from public.list_staking_reward_command_audit_events(25, null);
  `);

  assert(adminRows === "true", "Lifecycle admin position queues");
  assert(positionAudit === "true", "Lifecycle position audit");
  assert(rewardAudit === "true", "Lifecycle reward audit");
  pass("Lifecycle admin operations read");
}

async function assertNoGenericRewardInputs() {
  const names = await sqlScalar(`
    select coalesce(string_agg(procedures.proname::text, ',' order by procedures.proname), '')
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname !~* '^(list_|post_opening_balance$|reverse_opening_balance$|settle_current_user_staking_reward$|settle_staking_reward_as_admin$)'
      and procedures.proname ~* '(post_ledger|ledger_post|ledger_journal|ledger_entry|deposit|withdraw|stake|reward)';
  `);
  const privatePosting = await sqlScalar(`
    select (
      not has_function_privilege(
        'authenticated',
        'private.post_ledger_journal(uuid, uuid, text, text, uuid, text, uuid, text, jsonb)'::regprocedure,
        'execute'
      )
    )::text;
  `);

  assert(names === "", "Lifecycle generic public write block");
  assert(privatePosting === "true", "Lifecycle private posting hidden");
  pass("Lifecycle ledger boundary");
}

async function createMaturedPosition({
  product,
  positionId,
  lockJournalId,
  lockCommandId,
  principalUnits,
}) {
  const wallet = await readWallet();

  await sqlScalar(`
    do $$
    declare
      v_available_account_id uuid;
      v_locked_account_id uuid;
      v_locked_at timestamptz;
    begin
      perform private.ensure_wallet_asset_ledger_accounts(
        ${sqlLiteral(wallet.id)}::uuid,
        ${sqlLiteral(ASSET_ID)}::uuid
      );

      select
        (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_AVAILABLE'))::uuid,
        (max(accounts.id::text) filter (where accounts.account_purpose = 'USER_LOCKED'))::uuid
        into v_available_account_id, v_locked_account_id
      from private.ledger_accounts as accounts
      where accounts.account_scope = 'USER'
        and accounts.wallet_account_id = ${sqlLiteral(wallet.id)}::uuid
        and accounts.asset_id = ${sqlLiteral(ASSET_ID)}::uuid
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
        ${sqlLiteral(ASSET_ID)}::uuid,
        'USER_STAKING_POSITION_LOCKED',
        'USER',
        ${sqlLiteral(USER_ID)}::uuid,
        'STAKING_POSITION',
        ${sqlLiteral(positionId)}::uuid,
        'USER_STAKING_POSITION',
        jsonb_build_object('fixture', 'staking_lifecycle_e2e'),
        v_locked_at
      );

      insert into private.ledger_entries (
        journal_id, line_no, ledger_account_id, side, units
      )
      values
        (${sqlLiteral(lockJournalId)}::uuid, 1, v_available_account_id, 'DEBIT', ${sqlLiteral(principalUnits)}::numeric::private.positive_atomic_units),
        (${sqlLiteral(lockJournalId)}::uuid, 2, v_locked_account_id, 'CREDIT', ${sqlLiteral(principalUnits)}::numeric::private.positive_atomic_units);

      insert into private.staking_positions (
        id, staking_product_id, project_id, asset_id, wallet_account_id,
        user_id, principal_units, status, lock_journal_id,
        product_version_snapshot, lock_duration_days_snapshot,
        term_reward_rate_ppm_snapshot, reward_rounding_mode_snapshot,
        locked_at, matures_at
      )
      values (
        ${sqlLiteral(positionId)}::uuid,
        ${sqlLiteral(product.productId)}::uuid,
        ${sqlLiteral(PROJECT_ID)}::uuid,
        ${sqlLiteral(ASSET_ID)}::uuid,
        ${sqlLiteral(wallet.id)}::uuid,
        ${sqlLiteral(USER_ID)}::uuid,
        ${sqlLiteral(principalUnits)}::numeric::private.positive_atomic_units,
        'LOCKED',
        ${sqlLiteral(lockJournalId)}::uuid,
        ${product.version},
        1,
        250000,
        'FLOOR',
        v_locked_at,
        v_locked_at + interval '1 day'
      );
    end;
    $$;
    set constraints all immediate;
    set constraints all deferred;
    select 'matured';
  `);

  return {
    positionId,
    walletId: wallet.id,
    walletVersion: wallet.version,
  };
}

async function adminCommandRow(selectSql) {
  return JSON.parse(
    await adminSqlScalar(`
      select row_to_json(command_result)::text
      from (${selectSql}) as command_result;
    `),
  );
}

async function userCommandRow(selectSql) {
  return JSON.parse(
    await userSqlScalar(`
      select row_to_json(command_result)::text
      from (${selectSql}) as command_result;
    `),
  );
}

async function readWallet() {
  return JSON.parse(
    await sqlScalar(`
      select json_build_object(
        'id', wallet_accounts.id::text,
        'version', wallet_accounts.version
      )::text
      from public.wallet_accounts as wallet_accounts
      where wallet_accounts.user_id = ${sqlLiteral(USER_ID)}::uuid;
    `),
  );
}

async function walletBalance(walletId) {
  return JSON.parse(
    await sqlScalar(`
      select json_build_object(
        'available', balances.available_units::text,
        'locked', balances.locked_units::text,
        'total', balances.total_liability_units::text
      )::text
      from private.wallet_asset_ledger_balances as balances
      where balances.wallet_account_id = ${sqlLiteral(walletId)}::uuid
        and balances.asset_id = ${sqlLiteral(ASSET_ID)}::uuid;
    `),
  );
}

async function rewardCounts() {
  const result = await sqlScalar(`
    select
      (select count(*) from private.staking_position_reward_settlements)::text || ',' ||
      (select count(*) from private.staking_reward_command_audit_events)::text || ',' ||
      (
        select count(*)
        from private.ledger_journals
        where journal_type in (
          'USER_STAKING_REWARD_PAID',
          'ADMIN_STAKING_REWARD_PAID'
        )
      )::text || ',' ||
      (
        select count(*)
        from private.ledger_entries as entries
        join private.ledger_journals as journals
          on journals.id = entries.journal_id
        where journals.journal_type in (
          'USER_STAKING_REWARD_PAID',
          'ADMIN_STAKING_REWARD_PAID'
        )
      )::text;
  `);
  const [settlements, audit, journals, entries] = result
    .split(",")
    .map(Number);

  return { settlements, audit, journals, entries };
}

async function adminSqlScalar(sql) {
  return sqlScalar(adminContextSql(sql));
}

async function userSqlScalar(sql) {
  return sqlScalar(userContextSql(sql));
}

function adminContextSql(sql) {
  return `
    select set_config('request.jwt.claim.sub', ${sqlLiteral(ADMIN_ID)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(ADMIN_ID)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    ${sql}
  `;
}

function userContextSql(sql) {
  return `
    select set_config('request.jwt.claim.sub', ${sqlLiteral(USER_ID)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(USER_ID)}, 'aal', 'aal1')::text,
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

async function resetLocalDatabase(label) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    getNpmArgs("db:reset:local"),
    {
      timeout: 180000,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    },
  );

  assertOutputSafe(`${stdout}\n${stderr}`, `${label} output`);
  pass(label);
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
  const text = await response.clone().text();

  assertOutputSafe(text, `${path} body`);

  return response;
}

async function assertStatus(path, status, label) {
  const response = await appFetch(path, { redirect: "manual" });

  assert(response.status === status, label);
}

function commandRejectionBody() {
  return {
    staking_product_id: "00000000-0000-4000-8000-000000000001",
    staking_position_id: "00000000-0000-4000-8000-000000000002",
    wallet_account_id: "00000000-0000-4000-8000-000000000003",
    product_expected_version: "1",
    position_expected_version: "1",
    wallet_expected_version: "1",
    principal_units: "1",
    command_id: "00000000-0000-4000-8000-000000000004",
    reason: "origin rejection",
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
      throw new Error("FAIL lifecycle Next server exited");
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

  throw new Error("FAIL lifecycle Next server readiness");
}

function assertRedirectPath(response, expectedPath, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} redirect status`,
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
    "reward_units",
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

function getNpmArgs(scriptName) {
  const npmExecPath = process.env.npm_execpath;

  assert(Boolean(npmExecPath), "npm exec path");

  return [npmExecPath, "--silent", "run", scriptName];
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
    console.error(redactDiagnostic(`FAIL staking lifecycle ${message}`));
  }

  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]")
    .replace(UUID_PATTERN, "[REDACTED]");
}
