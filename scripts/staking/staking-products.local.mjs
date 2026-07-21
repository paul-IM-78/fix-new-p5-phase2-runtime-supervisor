import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";

const DB_CONTAINER = "supabase_db_staking-wallet-web";
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const COMMAND_ENDPOINTS = [
  "/api/v1/admin/staking-products/create",
  "/api/v1/admin/staking-products/update-draft",
  "/api/v1/admin/staking-products/transition",
];

async function main() {
  const runtime = await prepareManagedAppRuntime();

  try {
    await assertHttpSmoke();
    await assertSameOriginRejections();
    await assertDatabaseStateMachine();
    pass("Staking product integration");
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

  const admin = await appFetch("/admin/staking-products", {
    redirect: "manual",
  });
  assertRedirectPath(admin, "/auth/sign-in", "Anonymous admin staking");
  pass("Staking product HTTP smoke");
}

async function assertSameOriginRejections() {
  const before = await stakingCounts();

  for (const endpoint of COMMAND_ENDPOINTS) {
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

  assertCountsEqual(before, await stakingCounts(), "Origin rejection mutation");
  pass("Staking product same-origin rejection");
}

async function assertDatabaseStateMachine() {
  await seedActorsAndCatalog();
  await assertUserAndAal1Blocked();

  const created = await commandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042001',
      'E2E_STAKE_A',
      'E2E Stake A',
      'local e2e staking product',
      30,
      '1000',
      '9000',
      25000,
      now() + interval '1 day',
      now() + interval '30 days',
      '00000000-0000-4000-8000-000000043010',
      'create e2e staking product'
    )
  `);
  assert(created.result_code === "APPLIED", "Create staking product");

  const createdProduct = await readProduct("E2E_STAKE_A");
  const replayed = await commandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042001',
      'E2E_STAKE_A',
      'E2E Stake A',
      'local e2e staking product',
      30,
      '1000',
      '9000',
      25000,
      ${sqlLiteral(createdProduct.enrollmentStartsAt)}::timestamptz,
      ${sqlLiteral(createdProduct.enrollmentEndsAt)}::timestamptz,
      '00000000-0000-4000-8000-000000043010',
      'create e2e staking product'
    )
  `);
  assert(replayed.replayed === true, "Create replay");

  const conflict = await commandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042001',
      'E2E_STAKE_CONFLICT',
      'E2E Stake Conflict',
      null,
      31,
      '1000',
      null,
      25000,
      now() + interval '1 day',
      now() + interval '31 days',
      '00000000-0000-4000-8000-000000043010',
      'different e2e staking request'
    )
  `);
  assert(
    conflict.result_code === "STAKING_PRODUCT_COMMAND_ID_CONFLICT",
    "Command conflict",
  );

  await assertConcurrentReplay();

  const product = await readProduct("E2E_STAKE_A");
  const updated = await commandRow(`
    select *
    from public.update_staking_product_draft(
      ${sqlLiteral(product.id)}::uuid,
      ${product.version},
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042001',
      'E2E Stake A Updated',
      'updated e2e staking product',
      31,
      '1100',
      '9900',
      26000,
      now() + interval '2 days',
      now() + interval '32 days',
      '00000000-0000-4000-8000-000000043020',
      'update e2e staking product'
    )
  `);
  assert(updated.result_code === "APPLIED", "Draft update");

  const active = await transitionByCode(
    "E2E_STAKE_A",
    "ACTIVE",
    "00000000-0000-4000-8000-000000043021",
    "activate e2e staking product",
  );
  assert(active.result_code === "APPLIED", "Activate product");

  const updateLocked = await commandRow(`
    select *
    from public.update_staking_product_draft(
      ${sqlLiteral(active.staking_product_id)}::uuid,
      ${active.entity_version},
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042001',
      'Should Not Update',
      null,
      31,
      '1100',
      null,
      26000,
      now() + interval '2 days',
      now() + interval '32 days',
      '00000000-0000-4000-8000-000000043022',
      'blocked activated update'
    )
  `);
  assert(
    updateLocked.result_code === "STAKING_PRODUCT_NOT_DRAFT",
    "Activated draft update blocked",
  );

  await assertDirectTermFreeze();

  const noop = await transitionByCode(
    "E2E_STAKE_A",
    "ACTIVE",
    "00000000-0000-4000-8000-000000043023",
    "same status noop",
  );
  assert(noop.result_code === "NOOP", "Same status noop");

  const invalid = await transitionByCode(
    "E2E_STAKE_A",
    "ARCHIVED",
    "00000000-0000-4000-8000-000000043024",
    "active archive invalid",
  );
  assert(
    invalid.result_code === "STAKING_PRODUCT_TRANSITION_INVALID",
    "Invalid transition",
  );

  assert(
    (await transitionByCode(
      "E2E_STAKE_A",
      "SUSPENDED",
      "00000000-0000-4000-8000-000000043025",
      "suspend e2e staking product",
    )).result_code === "APPLIED",
    "Suspend product",
  );
  assert(
    (await transitionByCode(
      "E2E_STAKE_A",
      "ACTIVE",
      "00000000-0000-4000-8000-000000043026",
      "resume e2e staking product",
    )).result_code === "APPLIED",
    "Resume product",
  );
  assert(
    (await transitionByCode(
      "E2E_STAKE_A",
      "SUSPENDED",
      "00000000-0000-4000-8000-000000043027",
      "suspend before archive",
    )).result_code === "APPLIED",
    "Suspend before archive",
  );
  assert(
    (await transitionByCode(
      "E2E_STAKE_A",
      "ARCHIVED",
      "00000000-0000-4000-8000-000000043028",
      "archive e2e staking product",
    )).result_code === "APPLIED",
    "Archive product",
  );

  await assertArchivedTerminal();
  await assertActivationBoundaries();
  await assertPublicAndAdminReads();
  await assertAuditImmutability();

  const counts = await ledgerCounts();
  assert(counts.journals === 0 && counts.entries === 0, "Ledger changes zero");
  pass("Staking product database state machine");
}

async function seedActorsAndCatalog() {
  await sqlScalar(`
    insert into auth.users (
      id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values
      (
        '00000000-0000-4000-8000-000000040001',
        'authenticated',
        'authenticated',
        'staking-e2e-admin@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '00000000-0000-4000-8000-000000040002',
        'authenticated',
        'authenticated',
        'staking-e2e-user@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      );

    insert into public.user_roles (user_id, role, grant_reason)
    values (
      '00000000-0000-4000-8000-000000040001',
      'ADMIN',
      'local staking product e2e bootstrap'
    );

    insert into public.projects (
      id, project_code, display_name, description, status
    )
    values (
      '00000000-0000-4000-8000-000000041001',
      'E2ESTAKEP',
      'E2E Staking Project',
      'local staking e2e project',
      'ACTIVE'
    );

    insert into public.supported_assets (
      id, asset_code, symbol, display_name, asset_type, decimals,
      mint_address, status
    )
    values
      (
        '00000000-0000-4000-8000-000000042001',
        'E2ESPL1',
        'ES1',
        'E2E SPL One',
        'SPL_TOKEN',
        6,
        '11111111111111111111111111111141',
        'ACTIVE'
      ),
      (
        '00000000-0000-4000-8000-000000042002',
        'E2ESPL2',
        'ES2',
        'E2E SPL Two',
        'SPL_TOKEN',
        6,
        '11111111111111111111111111111142',
        'ACTIVE'
      ),
      (
        '00000000-0000-4000-8000-000000042003',
        'E2ENAT',
        'ENAT',
        'E2E Native',
        'NATIVE',
        9,
        null,
        'ACTIVE'
      );

    insert into public.project_token_assignments (project_id, asset_id)
    values (
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042001'
    );

    select 'seeded';
  `);
  pass("Staking product fixtures");
}

async function assertUserAndAal1Blocked() {
  const userResult = await sqlScalar(`
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000040002', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000040002', 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform *
      from public.create_staking_product(
        '00000000-0000-4000-8000-000000041001',
        '00000000-0000-4000-8000-000000042001',
        'USER_STAKE_BLOCK',
        'User Stake Block',
        null,
        20,
        '1000',
        null,
        1000,
        now() + interval '1 day',
        now() + interval '20 days',
        '00000000-0000-4000-8000-000000043001',
        'blocked user staking command'
      );
      raise exception 'expected denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);
  assert(userResult === "denied", "USER command blocked");

  const aal1Result = await sqlScalar(`
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000040001', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000040001', 'aal', 'aal1')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform *
      from public.create_staking_product(
        '00000000-0000-4000-8000-000000041001',
        '00000000-0000-4000-8000-000000042001',
        'AAL1_STAKE_BLOCK',
        'AAL1 Stake Block',
        null,
        21,
        '1000',
        null,
        1000,
        now() + interval '1 day',
        now() + interval '21 days',
        '00000000-0000-4000-8000-000000043002',
        'blocked aal1 staking command'
      );
      raise exception 'expected denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);
  assert(aal1Result === "denied", "AAL1 admin command blocked");
  pass("Staking product authorization blocks");
}

async function assertConcurrentReplay() {
  const commandId = "00000000-0000-4000-8000-000000043030";
  const enrollmentStartsAt = "2026-08-01T00:00:00Z";
  const enrollmentEndsAt = "2026-09-14T00:00:00Z";
  const sql = `
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042001',
      'E2E_STAKE_CONCURRENT',
      'E2E Stake Concurrent',
      null,
      44,
      '1000',
      null,
      22000,
      ${sqlLiteral(enrollmentStartsAt)}::timestamptz,
      ${sqlLiteral(enrollmentEndsAt)}::timestamptz,
      '${commandId}',
      'concurrent staking replay'
    )
  `;
  const [first, second] = await Promise.all([commandRow(sql), commandRow(sql)]);
  const replayCount = [first, second].filter((row) => row.replayed).length;

  assert(
    first.result_code === "APPLIED" && second.result_code === "APPLIED",
    "Concurrent command outcomes",
  );
  assert(replayCount === 1, "Concurrent replay marked once");
  pass("Staking product concurrent replay");
}

async function assertDirectTermFreeze() {
  const result = await sqlScalar(`
    do $$
    begin
      update private.staking_products
      set display_name = 'Direct Freeze Mutation'
      where product_code = 'E2E_STAKE_A';
      raise exception 'expected term freeze';
    exception
      when check_violation then
        null;
    end;
    $$;
    select 'blocked';
  `);

  assert(result === "blocked", "Direct term freeze");
}

async function assertArchivedTerminal() {
  const result = await sqlScalar(`
    do $$
    begin
      update private.staking_products
      set status = 'ACTIVE'
      where product_code = 'E2E_STAKE_A';
      raise exception 'expected archived terminal';
    exception
      when check_violation then
        null;
    end;
    $$;
    select 'blocked';
  `);

  assert(result === "blocked", "Archived terminal");
}

async function assertActivationBoundaries() {
  const native = await commandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042003',
      'E2E_STAKE_NATIVE',
      'E2E Native',
      null,
      45,
      '1000',
      null,
      20000,
      now() + interval '1 day',
      now() + interval '45 days',
      '00000000-0000-4000-8000-000000043040',
      'create native staking product'
    )
  `);
  assert(native.result_code === "APPLIED", "Native product create");
  assert(
    (await transitionById(
      native.staking_product_id,
      native.entity_version,
      "ACTIVE",
      "00000000-0000-4000-8000-000000043041",
      "activate native product",
    )).result_code === "STAKING_ASSET_NOT_PROJECT_TOKEN",
    "Native activation blocked",
  );

  const nonProject = await commandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042002',
      'E2E_STAKE_OTHER_SPL',
      'E2E Other SPL',
      null,
      46,
      '1000',
      null,
      20000,
      now() + interval '1 day',
      now() + interval '46 days',
      '00000000-0000-4000-8000-000000043042',
      'create non project staking product'
    )
  `);
  assert(nonProject.result_code === "APPLIED", "Non-project product create");
  assert(
    (await transitionById(
      nonProject.staking_product_id,
      nonProject.entity_version,
      "ACTIVE",
      "00000000-0000-4000-8000-000000043043",
      "activate non project token product",
    )).result_code === "STAKING_ASSET_NOT_PROJECT_TOKEN",
    "Non-project token activation blocked",
  );

  const expired = await commandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042001',
      'E2E_STAKE_EXPIRED',
      'E2E Expired',
      null,
      47,
      '1000',
      null,
      20000,
      now() - interval '10 days',
      now() - interval '1 day',
      '00000000-0000-4000-8000-000000043044',
      'create expired staking product'
    )
  `);
  assert(expired.result_code === "APPLIED", "Expired product create");
  assert(
    (await transitionById(
      expired.staking_product_id,
      expired.entity_version,
      "ACTIVE",
      "00000000-0000-4000-8000-000000043045",
      "activate expired product",
    )).result_code === "STAKING_ENROLLMENT_EXPIRED",
    "Expired activation blocked",
  );

  const activeRead = await commandRow(`
    select *
    from public.create_staking_product(
      '00000000-0000-4000-8000-000000041001',
      '00000000-0000-4000-8000-000000042001',
      'E2E_STAKE_PUBLIC',
      'E2E Public Product',
      null,
      48,
      '1000',
      null,
      20000,
      now() + interval '1 day',
      now() + interval '48 days',
      '00000000-0000-4000-8000-000000043046',
      'create public read product'
    )
  `);
  assert(activeRead.result_code === "APPLIED", "Public product create");
  assert(
    (await transitionById(
      activeRead.staking_product_id,
      activeRead.entity_version,
      "ACTIVE",
      "00000000-0000-4000-8000-000000043047",
      "activate public read product",
    )).result_code === "APPLIED",
    "Public product activation",
  );
  pass("Staking product activation boundaries");
}

async function assertPublicAndAdminReads() {
  const userReadCount = await sqlScalar(`
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000040002', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000040002', 'aal', 'aal1')::text,
      false
    );
    set role authenticated;
    select count(*)::text
    from public.list_current_staking_products(100);
  `);
  assert(Number(userReadCount) >= 1, "Current user staking read");

  const adminReadCount = await adminSqlScalar(`
    select count(*)::text
    from public.list_admin_staking_products(100, null);
  `);
  const auditReadCount = await adminSqlScalar(`
    select count(*)::text
    from public.list_staking_product_admin_audit_events(50, null);
  `);

  assert(Number(adminReadCount) >= 1, "Admin staking product read");
  assert(Number(auditReadCount) >= 1, "Admin staking audit read");
  pass("Staking product read RPCs");
}

async function assertAuditImmutability() {
  const result = await sqlScalar(`
    do $$
    begin
      update private.staking_product_admin_audit_events
      set reason = 'changed';
      raise exception 'expected audit immutability';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;
    select 'blocked';
  `);

  assert(result === "blocked", "Audit immutability");
  pass("Staking product audit immutability");
}

async function transitionByCode(productCode, status, commandId, reason) {
  const product = await readProduct(productCode);

  return transitionById(product.id, product.version, status, commandId, reason);
}

async function transitionById(productId, version, status, commandId, reason) {
  return commandRow(`
    select *
    from public.transition_staking_product_status(
      ${sqlLiteral(productId)}::uuid,
      ${version},
      ${sqlLiteral(status)},
      ${sqlLiteral(commandId)}::uuid,
      ${sqlLiteral(reason)}
    )
  `);
}

async function commandRow(selectSql) {
  const payload = await adminSqlScalar(`
    select row_to_json(command_result)::text
    from (${selectSql}) as command_result;
  `);

  return JSON.parse(payload);
}

async function readProduct(productCode) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', products.id::text,
      'status', products.status,
      'version', products.version,
      'enrollmentStartsAt', products.enrollment_starts_at,
      'enrollmentEndsAt', products.enrollment_ends_at
    )::text
    from private.staking_products as products
    where products.product_code = ${sqlLiteral(productCode)};
  `);

  assert(Boolean(payload), "Product row");

  return JSON.parse(payload);
}

async function stakingCounts() {
  const result = await sqlScalar(`
    select
      (select count(*) from private.staking_products)::text || ',' ||
      (select count(*) from private.staking_product_admin_audit_events)::text;
  `);
  const [products, audit] = result.split(",").map(Number);

  return { products, audit };
}

async function ledgerCounts() {
  const result = await sqlScalar(`
    select
      (select count(*) from private.ledger_journals)::text || ',' ||
      (select count(*) from private.ledger_entries)::text;
  `);
  const [journals, entries] = result.split(",").map(Number);

  return { journals, entries };
}

function assertCountsEqual(before, after, label) {
  assert(
    before.products === after.products && before.audit === after.audit,
    label,
  );
}

async function adminSqlScalar(sql) {
  return sqlScalar(`
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000040001', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000040001', 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    ${sql}
  `);
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
    expected_version: "1",
    project_id: "00000000-0000-4000-8000-000000000002",
    asset_id: "00000000-0000-4000-8000-000000000003",
    product_code: "REJECTED_STAKE",
    display_name: "Rejected Stake",
    lock_duration_days: "30",
    min_stake_units: "1000",
    term_reward_rate_ppm: "1000",
    enrollment_starts_at: "2026-07-21T00:00:00Z",
    enrollment_ends_at: "2026-08-21T00:00:00Z",
    new_status: "ACTIVE",
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
    "project_id",
    "asset_id",
    "command_id",
    "expected_version",
    "reason",
    "min_stake_units",
    "max_stake_units",
    "term_reward_rate_ppm",
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
      redactDiagnostic(`FAIL staking product integration ${message}`),
    );
  }

  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]");
}
