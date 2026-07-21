import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";

const DB_CONTAINER = "supabase_db_staking-wallet-web";
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const POSITION_COMMAND_ENDPOINTS = ["/api/v1/staking/positions/create"];

async function main() {
  const runtime = await prepareManagedAppRuntime();

  try {
    await assertHttpSmoke();
    await assertSameOriginRejections();
    await assertDatabaseStateMachine();
    pass("Staking position integration");
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
  assertRedirectQuery(
    admin,
    "next",
    "/admin",
    "Anonymous admin positions next",
  );
  pass("Staking position HTTP smoke");
}

async function assertSameOriginRejections() {
  const before = await positionCounts();

  for (const endpoint of POSITION_COMMAND_ENDPOINTS) {
    const noOrigin = await appFetch(endpoint, {
      method: "POST",
      body: rejectionBody(),
      includeOrigin: false,
      redirect: "manual",
    });
    assertRedirectHasCode(noOrigin, "request_rejected", "Origin required");

    const external = await appFetch(endpoint, {
      method: "POST",
      body: rejectionBody(),
      origin: "https://example.invalid",
      redirect: "manual",
    });
    assertRedirectHasCode(external, "request_rejected", "External origin");

    const fetchSite = await appFetch(endpoint, {
      method: "POST",
      body: rejectionBody(),
      fetchSite: "cross-site",
      redirect: "manual",
    });
    assertRedirectHasCode(fetchSite, "request_rejected", "Fetch site");
  }

  assertCountsEqual(before, await positionCounts(), "Origin rejection mutation");
  pass("Staking position same-origin rejection");
}

async function assertDatabaseStateMachine() {
  await seedActorsAndCatalog();
  await assertUserBalanceFixture();

  const userWallet = await readWallet("00000000-0000-4000-8000-000000060002");

  const createdProduct = await createAndActivateProduct(
    "POSITION_E2E_A",
    "00000000-0000-4000-8000-000000063001",
    "00000000-0000-4000-8000-000000063002",
    "Position E2E A",
    "1000",
    "9000",
    30,
  );

  const createdPosition = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(createdProduct.productId)}::uuid,
      ${createdProduct.version},
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '2000',
      '00000000-0000-4000-8000-000000064001',
      '00000000-0000-4000-8000-000000063003'
    )
  `);
  assert(createdPosition.result_code === "APPLIED", "Create position");
  assert(createdPosition.replayed === false, "Create position not replayed");

  const replayed = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(createdProduct.productId)}::uuid,
      ${createdProduct.version},
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '2000',
      '00000000-0000-4000-8000-000000064001',
      '00000000-0000-4000-8000-000000063003'
    )
  `);
  assert(replayed.replayed === true, "Position command replay");

  const conflict = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(createdProduct.productId)}::uuid,
      ${createdProduct.version},
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '3000',
      '00000000-0000-4000-8000-000000064002',
      '00000000-0000-4000-8000-000000063003'
    )
  `);
  assert(
    conflict.result_code === "STAKING_POSITION_COMMAND_ID_CONFLICT",
    "Position command conflict",
  );

  const secondPosition = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(createdProduct.productId)}::uuid,
      ${createdProduct.version},
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '3000',
      '00000000-0000-4000-8000-000000064003',
      '00000000-0000-4000-8000-000000063004'
    )
  `);
  assert(secondPosition.result_code === "APPLIED", "Second position");

  await assertCommandBoundaries(createdProduct, userWallet);
  await assertProductEnrollmentBoundaries(userWallet);
  await assertPositionLedgerAndReads(userWallet.id);
  await assertPositionImmutability();
  await assertNoRewardOrOnChainState();
  pass("Staking position database state machine");
}

async function seedActorsAndCatalog() {
  await sqlScalar(`
    insert into auth.users (
      id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values
      (
        '00000000-0000-4000-8000-000000060001',
        'authenticated',
        'authenticated',
        'staking-position-e2e-admin@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '00000000-0000-4000-8000-000000060002',
        'authenticated',
        'authenticated',
        'staking-position-e2e-user@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '00000000-0000-4000-8000-000000060003',
        'authenticated',
        'authenticated',
        'staking-position-e2e-other@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      );

    insert into public.user_roles (user_id, role, grant_reason)
    values (
      '00000000-0000-4000-8000-000000060001',
      'ADMIN',
      'local staking position e2e bootstrap'
    );

    insert into public.projects (
      id, project_code, display_name, description, status
    )
    values (
      '00000000-0000-4000-8000-000000061001',
      'E2EPOSPROJ',
      'E2E Position Project',
      'local staking position e2e project',
      'ACTIVE'
    );

    insert into public.supported_assets (
      id, asset_code, symbol, display_name, asset_type, decimals,
      mint_address, status
    )
    values
      (
        '00000000-0000-4000-8000-000000062001',
        'E2EPOS1',
        'EP1',
        'E2E Position SPL One',
        'SPL_TOKEN',
        6,
        '11111111111111111111111111111161',
        'ACTIVE'
      ),
      (
        '00000000-0000-4000-8000-000000062002',
        'E2EPOS2',
        'EP2',
        'E2E Position SPL Two',
        'SPL_TOKEN',
        6,
        '11111111111111111111111111111162',
        'ACTIVE'
      );

    insert into public.project_token_assignments (project_id, asset_id)
    values (
      '00000000-0000-4000-8000-000000061001',
      '00000000-0000-4000-8000-000000062001'
    );

    select 'seeded';
  `);
  pass("Staking position fixtures");
}

async function assertUserBalanceFixture() {
  const wallet = await readWallet("00000000-0000-4000-8000-000000060002");
  const opening = await adminCommandRow(`
    select *
    from public.post_opening_balance(
      ${sqlLiteral(wallet.id)}::uuid,
      ${wallet.version},
      '00000000-0000-4000-8000-000000062001',
      1,
      '10000',
      '00000000-0000-4000-8000-000000063000',
      'opening for staking position e2e'
    )
  `);

  assert(opening.result_code === "APPLIED", "Opening balance");
  pass("Staking position user balance fixture");
}

async function createAndActivateProduct(
  productCode,
  createCommandId,
  activateCommandId,
  displayName,
  minStakeUnits,
  maxStakeUnits,
  lockDurationDays,
) {
  const created = await adminCommandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000061001',
      '00000000-0000-4000-8000-000000062001',
      ${sqlLiteral(productCode)},
      ${sqlLiteral(displayName)},
      'local staking position product',
      ${lockDurationDays},
      ${sqlLiteral(minStakeUnits)},
      ${maxStakeUnits ? sqlLiteral(maxStakeUnits) : "null"},
      25000,
      now() - interval '1 hour',
      now() + interval '30 days',
      ${sqlLiteral(createCommandId)}::uuid,
      'create staking position product'
    )
  `);
  assert(created.result_code === "APPLIED", "Create active position product");

  const activated = await adminCommandRow(`
    select *
    from public.transition_staking_product_status(
      ${sqlLiteral(created.staking_product_id)}::uuid,
      ${created.entity_version},
      'ACTIVE',
      ${sqlLiteral(activateCommandId)}::uuid,
      'activate staking position product'
    )
  `);
  assert(
    activated.result_code === "APPLIED",
    "Activate active position product",
  );

  return {
    productId: activated.staking_product_id,
    version: activated.entity_version,
  };
}

async function assertCommandBoundaries(product, userWallet) {
  const belowMinimum = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(product.productId)}::uuid,
      ${product.version},
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '999',
      '00000000-0000-4000-8000-000000064004',
      '00000000-0000-4000-8000-000000063005'
    )
  `);
  assert(
    belowMinimum.result_code === "STAKING_POSITION_BELOW_MINIMUM",
    "Position minimum",
  );

  const aboveMaximum = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(product.productId)}::uuid,
      ${product.version},
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '9500',
      '00000000-0000-4000-8000-000000064005',
      '00000000-0000-4000-8000-000000063006'
    )
  `);
  assert(
    aboveMaximum.result_code === "STAKING_POSITION_ABOVE_MAXIMUM",
    "Position maximum",
  );

  const insufficient = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(product.productId)}::uuid,
      ${product.version},
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '6000',
      '00000000-0000-4000-8000-000000064006',
      '00000000-0000-4000-8000-000000063007'
    )
  `);
  assert(
    insufficient.result_code === "STAKING_POSITION_INSUFFICIENT_AVAILABLE",
    "Position available balance",
  );

  const productVersion = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(product.productId)}::uuid,
      999,
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '1000',
      '00000000-0000-4000-8000-000000064007',
      '00000000-0000-4000-8000-000000063008'
    )
  `);
  assert(
    productVersion.result_code === "STAKING_PRODUCT_VERSION_CONFLICT",
    "Product expected version",
  );

  const walletVersion = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(product.productId)}::uuid,
      ${product.version},
      ${sqlLiteral(userWallet.id)}::uuid,
      999,
      '1000',
      '00000000-0000-4000-8000-000000064008',
      '00000000-0000-4000-8000-000000063009'
    )
  `);
  assert(
    walletVersion.result_code === "STAKING_WALLET_VERSION_CONFLICT",
    "Wallet expected version",
  );

  const otherWallet = await readWallet("00000000-0000-4000-8000-000000060003");
  const forbiddenWallet = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(product.productId)}::uuid,
      ${product.version},
      ${sqlLiteral(otherWallet.id)}::uuid,
      ${otherWallet.version},
      '1000',
      '00000000-0000-4000-8000-000000064009',
      '00000000-0000-4000-8000-000000063010'
    )
  `);
  assert(
    forbiddenWallet.result_code === "STAKING_WALLET_FORBIDDEN",
    "Wallet ownership",
  );

  pass("Staking position command boundaries");
}

async function assertProductEnrollmentBoundaries(userWallet) {
  const activeProduct = await readProduct("POSITION_E2E_A");
  const suspended = await adminCommandRow(`
    select *
    from public.transition_staking_product_status(
      ${sqlLiteral(activeProduct.id)}::uuid,
      ${activeProduct.version},
      'SUSPENDED',
      '00000000-0000-4000-8000-000000063011',
      'suspend staking position product'
    )
  `);
  assert(suspended.result_code === "APPLIED", "Suspend active product");

  const notActive = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(activeProduct.id)}::uuid,
      ${suspended.entity_version},
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '1000',
      '00000000-0000-4000-8000-000000064010',
      '00000000-0000-4000-8000-000000063012'
    )
  `);
  assert(
    notActive.result_code === "STAKING_PRODUCT_NOT_ACTIVE",
    "Suspended product",
  );

  const upcomingCreated = await adminCommandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000061001',
      '00000000-0000-4000-8000-000000062001',
      'POSITION_E2E_UPCOMING',
      'Position E2E Upcoming',
      null,
      45,
      '1000',
      null,
      15000,
      now() + interval '1 day',
      now() + interval '45 days',
      '00000000-0000-4000-8000-000000063013',
      'create upcoming staking position product'
    )
  `);
  assert(upcomingCreated.result_code === "APPLIED", "Create upcoming product");

  const upcomingActive = await adminCommandRow(`
    select *
    from public.transition_staking_product_status(
      ${sqlLiteral(upcomingCreated.staking_product_id)}::uuid,
      ${upcomingCreated.entity_version},
      'ACTIVE',
      '00000000-0000-4000-8000-000000063014',
      'activate upcoming staking position product'
    )
  `);
  assert(upcomingActive.result_code === "APPLIED", "Activate upcoming product");

  const notOpen = await userCommandRow(`
    select *
    from public.create_user_staking_position(
      ${sqlLiteral(upcomingCreated.staking_product_id)}::uuid,
      ${upcomingActive.entity_version},
      ${sqlLiteral(userWallet.id)}::uuid,
      ${userWallet.version},
      '1000',
      '00000000-0000-4000-8000-000000064011',
      '00000000-0000-4000-8000-000000063015'
    )
  `);
  assert(
    notOpen.result_code === "STAKING_ENROLLMENT_NOT_OPEN",
    "Upcoming enrollment",
  );

  pass("Staking position product enrollment boundaries");
}

async function assertPositionLedgerAndReads(walletId) {
  const balance = await sqlScalar(`
    select json_build_object(
      'available', balances.available_units::text,
      'locked', balances.locked_units::text,
      'total', balances.total_liability_units::text
    )::text
    from private.wallet_asset_ledger_balances as balances
    where balances.wallet_account_id = ${sqlLiteral(walletId)}::uuid
      and balances.asset_id = '00000000-0000-4000-8000-000000062001';
  `);
  const parsedBalance = JSON.parse(balance);

  assert(parsedBalance.available === "5000", "Available balance moved");
  assert(parsedBalance.locked === "5000", "Locked balance moved");
  assert(parsedBalance.total === "10000", "Total liability unchanged");

  const privateCounts = await positionCounts();
  assert(privateCounts.positions === 2, "Position count");
  assert(privateCounts.audit === 2, "Position audit count");
  assert(privateCounts.positionJournals === 2, "Position journal count");
  assert(privateCounts.systemEntries === 0, "No system entries");

  const userReadCount = await userSqlScalar(`
    select count(*)::text
    from public.list_current_user_staking_positions(100);
  `);
  assert(Number(userReadCount) === 2, "Current user position read");

  const otherReadCount = await otherUserSqlScalar(`
    select count(*)::text
    from public.list_current_user_staking_positions(100);
  `);
  assert(Number(otherReadCount) === 0, "Other user position read");

  const adminReadCount = await adminSqlScalar(`
    select count(*)::text
    from public.list_admin_staking_positions(100, 'LOCKED');
  `);
  assert(Number(adminReadCount) === 2, "Admin position read");

  const adminAuditCount = await adminSqlScalar(`
    select count(*)::text
    from public.list_staking_position_command_audit_events(100, null);
  `);
  assert(Number(adminAuditCount) === 2, "Admin position audit read");

  pass("Staking position ledger and reads");
}

async function assertPositionImmutability() {
  const positionUpdate = await sqlScalar(`
    do $$
    begin
      update private.staking_positions
      set status = 'LOCKED'
      where id = '00000000-0000-4000-8000-000000064001';
      raise exception 'expected position update block';
    exception
      when check_violation then
        null;
    end;
    $$;
    select 'blocked';
  `);
  assert(positionUpdate === "blocked", "Position update immutability");

  const positionDelete = await sqlScalar(`
    do $$
    begin
      delete from private.staking_positions
      where id = '00000000-0000-4000-8000-000000064001';
      raise exception 'expected position delete block';
    exception
      when check_violation then
        null;
    end;
    $$;
    select 'blocked';
  `);
  assert(positionDelete === "blocked", "Position delete immutability");

  const auditUpdate = await sqlScalar(`
    do $$
    begin
      update private.staking_position_command_audit_events
      set outcome = 'APPLIED';
      raise exception 'expected audit update block';
    exception
      when check_violation then
        null;
    end;
    $$;
    select 'blocked';
  `);
  assert(auditUpdate === "blocked", "Position audit update immutability");

  const auditDelete = await sqlScalar(`
    do $$
    begin
      delete from private.staking_position_command_audit_events;
      raise exception 'expected audit delete block';
    exception
      when check_violation then
        null;
    end;
    $$;
    select 'blocked';
  `);
  assert(auditDelete === "blocked", "Position audit delete immutability");

  pass("Staking position immutability");
}

async function assertNoRewardOrOnChainState() {
  const rewardExpenseEntries = await sqlScalar(`
    select count(*)::text
    from private.ledger_entries as entries
    join private.ledger_accounts as accounts
      on accounts.id = entries.ledger_account_id
    where accounts.account_purpose = 'SYSTEM_REWARD_EXPENSE';
  `);
  assert(Number(rewardExpenseEntries) === 0, "Reward expense remains zero");

  const externalEvidence = await sqlScalar(`
    select count(*)::text
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'staking_positions'
      and column_name in ('transaction_signature', 'signature', 'tx_hash');
  `);
  assert(Number(externalEvidence) === 0, "No on-chain evidence columns");
  pass("Staking position reward and on-chain boundary");
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

async function readProduct(productCode) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', products.id::text,
      'version', products.version
    )::text
    from private.staking_products as products
    where products.product_code = ${sqlLiteral(productCode)};
  `);

  assert(Boolean(payload), "Product row");

  return JSON.parse(payload);
}

async function readWallet(userId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', wallet_accounts.id::text,
      'version', wallet_accounts.version
    )::text
    from public.wallet_accounts as wallet_accounts
    where wallet_accounts.user_id = ${sqlLiteral(userId)}::uuid;
  `);

  assert(Boolean(payload), "Wallet row");

  return JSON.parse(payload);
}

async function positionCounts() {
  const result = await sqlScalar(`
    select
      (select count(*) from private.staking_positions)::text || ',' ||
      (select count(*) from private.staking_position_command_audit_events)::text || ',' ||
      (
        select count(*)
        from private.ledger_journals
        where journal_type = 'USER_STAKING_POSITION_LOCKED'
      )::text || ',' ||
      (
        select count(*)
        from private.ledger_entries as entries
        join private.ledger_accounts as accounts
          on accounts.id = entries.ledger_account_id
        join private.ledger_journals as journals
          on journals.id = entries.journal_id
        where journals.journal_type = 'USER_STAKING_POSITION_LOCKED'
          and accounts.account_scope = 'SYSTEM'
      )::text;
  `);
  const [positions, audit, positionJournals, systemEntries] =
    result.split(",").map(Number);

  return { positions, audit, positionJournals, systemEntries };
}

function assertCountsEqual(before, after, label) {
  assert(
    before.positions === after.positions &&
      before.audit === after.audit &&
      before.positionJournals === after.positionJournals &&
      before.systemEntries === after.systemEntries,
    label,
  );
}

async function adminSqlScalar(sql) {
  return sqlScalar(adminContextSql(sql));
}

async function userSqlScalar(sql) {
  return sqlScalar(userContextSql(sql));
}

async function otherUserSqlScalar(sql) {
  return sqlScalar(`
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000060003', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000060003', 'aal', 'aal1')::text,
      false
    );
    set role authenticated;
    ${sql}
  `);
}

function adminContextSql(sql) {
  return `
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000060001', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000060001', 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    ${sql}
  `;
}

function userContextSql(sql) {
  return `
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000060002', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000060002', 'aal', 'aal1')::text,
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

function rejectionBody() {
  return {
    staking_product_id: "00000000-0000-4000-8000-000000000001",
    product_expected_version: "1",
    wallet_account_id: "00000000-0000-4000-8000-000000000002",
    wallet_expected_version: "1",
    principal_units: "1000",
    position_id: "00000000-0000-4000-8000-000000000003",
    command_id: "00000000-0000-4000-8000-000000000004",
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
    "staking_product_id",
    "wallet_account_id",
    "command_id",
    "position_id",
    "product_expected_version",
    "wallet_expected_version",
    "principal_units",
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
    console.error(
      redactDiagnostic(`FAIL staking position integration ${message}`),
    );
  }

  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]");
}
