import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";

const DB_CONTAINER = "supabase_db_staking-wallet-web";
const LOCAL_SUPABASE_API_ORIGIN = "http://127.0.0.1:55721";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const PROJECT_LABEL = "staking-wallet-web";
const NPM_EXEC_PATH = process.env.npm_execpath;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const READINESS_ATTEMPTS = 18;
const LOCAL_AUTH_STABILITY_DELAY_MS = 8000;
const COMMAND_ENDPOINTS = [
  "/api/v1/admin/custody/providers/upsert-draft",
  "/api/v1/admin/custody/providers/transition",
  "/api/v1/admin/custody/bindings/upsert-draft",
  "/api/v1/admin/custody/bindings/transition",
];

let externalFetchCount = 0;
const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );

  if (!isAllowedLocalUrl(url)) {
    externalFetchCount += 1;
  }

  return originalFetch(input, init);
};

async function main() {
  let server = null;

  try {
    await assertProjectScope();
    await runNpmScriptSensitive("supabase:start", "Supabase start", 120000);
    await waitForLocalSupabaseReadiness("Initial Supabase readiness");
    await runNpmScript("db:reset:local", "Initial DB reset", 180000);
    await waitForLocalSupabaseReadiness("Post-reset readiness");
    await wait(LOCAL_AUTH_STABILITY_DELAY_MS);

    server = await prepareManagedAppRuntime();

    await assertHttpSmoke();
    await assertSameOriginRejections();
    await assertDatabaseStateMachine();
    await assertNoSensitiveSchemaMarkers();
    assert(externalFetchCount === 0, "External network calls zero");

    await stopManagedAppRuntime(server);
    server = null;
    await runNpmScript("db:reset:local", "Final DB reset", 180000);
    await runNpmScriptSensitive("supabase:stop", "Supabase stop", 120000);
    await assertProcessCleanup();

    pass("Custody boundary integration");
    console.log("CUSTODY_BOUNDARY_PASS");
  } catch (error) {
    if (server) {
      await stopManagedAppRuntime(server).catch(() => undefined);
    }

    await runNpmScript("db:reset:local", "Failure DB reset", 180000)
      .catch(() => undefined);
    await runNpmScriptSensitive("supabase:stop", "Supabase stop", 120000)
      .catch(() => undefined);

    throw error;
  }
}

async function assertHttpSmoke() {
  await assertStatus("/api/v1/health", 200, "Health smoke");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness smoke");
  await assertStatus("/", 200, "Landing smoke");

  const admin = await appFetch("/admin/custody", {
    redirect: "manual",
  });
  assertRedirectPath(admin, "/auth/sign-in", "Anonymous admin custody");
  assertRedirectQuery(admin, "next", "/admin", "Anonymous admin next");
  pass("Custody HTTP smoke");
}

async function assertSameOriginRejections() {
  const before = await custodyCounts();

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

  assertCountsEqual(before, await custodyCounts(), "Origin rejection mutation");
  pass("Custody same-origin rejection");
}

async function assertDatabaseStateMachine() {
  await seedActorsAndCatalog();
  await assertUserAndAal1Blocked();

  const providerNoCapability = await adminCommandRow(`
    select *
    from public.upsert_custody_provider_draft(
      null,
      null,
      'E2E_CUSTODY_A',
      'E2E Custody A',
      'MPC_CUSTODIAN',
      false,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000073010',
      'create e2e custody provider'
    )
  `);
  assert(providerNoCapability.result_code === "APPLIED", "Create provider");

  const provider = await readProvider("E2E_CUSTODY_A");
  assert(
    (
      await adminCommandRow(`
        select *
        from public.transition_custody_provider_status(
          ${sqlLiteral(provider.id)}::uuid,
          ${provider.version},
          'APPROVED',
          '00000000-0000-4000-8000-000000073011',
          'approve without capabilities'
        )
      `)
    ).result_code === "CUSTODY_PROVIDER_CAPABILITY_REQUIRED",
    "Provider capability required",
  );

  const updatedProvider = await adminCommandRow(`
    select *
    from public.upsert_custody_provider_draft(
      ${sqlLiteral(provider.id)}::uuid,
      ${provider.version},
      'E2E_CUSTODY_A',
      'E2E Custody A Updated',
      'MPC_CUSTODIAN',
      true,
      true,
      true,
      false,
      false,
      '00000000-0000-4000-8000-000000073012',
      'update provider capabilities'
    )
  `);
  assert(updatedProvider.result_code === "APPLIED", "Update provider");

  const approvedProvider = await transitionProviderByCode(
    "E2E_CUSTODY_A",
    "APPROVED",
    "00000000-0000-4000-8000-000000073013",
    "approve provider",
  );
  assert(approvedProvider.result_code === "APPLIED", "Approve provider");

  const replayedProvider = await adminCommandRow(`
    select *
    from public.upsert_custody_provider_draft(
      null,
      null,
      'E2E_CUSTODY_A',
      'E2E Custody A',
      'MPC_CUSTODIAN',
      false,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000073010',
      'create e2e custody provider'
    )
  `);
  assert(replayedProvider.replayed === true, "Provider replay");

  const conflict = await adminCommandRow(`
    select *
    from public.upsert_custody_provider_draft(
      null,
      null,
      'E2E_CUSTODY_CONFLICT',
      'E2E Custody Conflict',
      'MPC_CUSTODIAN',
      true,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000073010',
      'different custody provider request'
    )
  `);
  assert(
    conflict.result_code === "CUSTODY_CONFIG_COMMAND_ID_CONFLICT",
    "Provider command conflict",
  );

  await assertConcurrentReplay();

  const splBinding = await adminCommandRow(`
    select *
    from public.upsert_custody_account_binding_draft(
      null,
      null,
      ${sqlLiteral(approvedProvider.custody_provider_id)}::uuid,
      '00000000-0000-4000-8000-000000072001',
      'e2e_collection_spl',
      'E2E Collection SPL',
      'COLLECTION',
      '00000000-0000-4000-8000-000000073020',
      'create spl binding'
    )
  `);
  assert(splBinding.result_code === "APPLIED", "Create SPL binding");

  const duplicate = await adminCommandRow(`
    select *
    from public.upsert_custody_account_binding_draft(
      null,
      null,
      ${sqlLiteral(approvedProvider.custody_provider_id)}::uuid,
      '00000000-0000-4000-8000-000000072001',
      'e2e_collection_spl_duplicate',
      'E2E Duplicate Collection',
      'COLLECTION',
      '00000000-0000-4000-8000-000000073021',
      'duplicate provider asset role'
    )
  `);
  assert(
    duplicate.result_code === "CUSTODY_BINDING_DUPLICATE_ACTIVE_ROLE",
    "Duplicate binding blocked",
  );

  const inactiveBinding = await adminCommandRow(`
    select *
    from public.upsert_custody_account_binding_draft(
      null,
      null,
      ${sqlLiteral(approvedProvider.custody_provider_id)}::uuid,
      '00000000-0000-4000-8000-000000072003',
      'e2e_inactive_spl',
      'E2E Inactive SPL',
      'TREASURY',
      '00000000-0000-4000-8000-000000073022',
      'create inactive asset binding'
    )
  `);
  assert(
    inactiveBinding.result_code === "APPLIED",
    "Create inactive asset binding",
  );

  assert(
    (
      await transitionBindingByKey(
        "e2e_inactive_spl",
        "APPROVED",
        "00000000-0000-4000-8000-000000073023",
        "approve inactive binding",
      )
    ).result_code === "CUSTODY_BINDING_ASSET_NOT_READY",
    "Inactive asset blocks binding approval",
  );

  assert(
    (
      await transitionBindingByKey(
        "e2e_collection_spl",
        "APPROVED",
        "00000000-0000-4000-8000-000000073024",
        "approve spl binding",
      )
    ).result_code === "APPLIED",
    "SPL binding approval",
  );

  const nativeBinding = await adminCommandRow(`
    select *
    from public.upsert_custody_account_binding_draft(
      null,
      null,
      ${sqlLiteral(approvedProvider.custody_provider_id)}::uuid,
      '00000000-0000-4000-8000-000000072002',
      'e2e_treasury_native',
      'E2E Treasury Native',
      'TREASURY',
      '00000000-0000-4000-8000-000000073025',
      'create native binding'
    )
  `);
  assert(nativeBinding.result_code === "APPLIED", "Create native binding");
  assert(
    (
      await transitionBindingByKey(
        "e2e_treasury_native",
        "APPROVED",
        "00000000-0000-4000-8000-000000073026",
        "approve native binding",
      )
    ).result_code === "APPLIED",
    "NATIVE binding approval",
  );

  await transitionBindingByKey(
    "e2e_collection_spl",
    "SUSPENDED",
    "00000000-0000-4000-8000-000000073027",
    "suspend spl binding",
  );
  await transitionBindingByKey(
    "e2e_collection_spl",
    "RETIRED",
    "00000000-0000-4000-8000-000000073028",
    "retire spl binding",
  );

  assert(
    (
      await adminCommandRow(`
        select *
        from public.upsert_custody_account_binding_draft(
          null,
          null,
          ${sqlLiteral(approvedProvider.custody_provider_id)}::uuid,
          '00000000-0000-4000-8000-000000072001',
          'e2e_collection_spl_replacement',
          'E2E Collection Replacement',
          'COLLECTION',
          '00000000-0000-4000-8000-000000073029',
          'create replacement binding'
        )
      `)
    ).result_code === "APPLIED",
    "Replacement after retire",
  );

  await assertUnsupportedNetworkBoundary();
  await assertPublicReads();
  await assertAuditImmutabilityAndSafety();

  const ledger = await ledgerCounts();
  assert(ledger.journals === 0 && ledger.entries === 0, "Ledger changes zero");
  pass("Custody database state machine");
}

async function seedActorsAndCatalog() {
  await sqlScalar(`
    insert into auth.users (
      id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values
      (
        '00000000-0000-4000-8000-000000070001',
        'authenticated',
        'authenticated',
        'custody-e2e-admin@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '00000000-0000-4000-8000-000000070002',
        'authenticated',
        'authenticated',
        'custody-e2e-user@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      );

    insert into public.user_roles (user_id, role, grant_reason)
    values (
      '00000000-0000-4000-8000-000000070001',
      'ADMIN',
      'local custody e2e bootstrap'
    );

    insert into public.supported_assets (
      id, asset_code, symbol, display_name, asset_type, decimals,
      mint_address, status
    )
    values
      (
        '00000000-0000-4000-8000-000000072001',
        'E2ECUS1',
        'EC1',
        'E2E Custody SPL',
        'SPL_TOKEN',
        6,
        '11111111111111111111111111111171',
        'ACTIVE'
      ),
      (
        '00000000-0000-4000-8000-000000072002',
        'E2ECUS2',
        'SOLC',
        'E2E Custody Native',
        'NATIVE',
        9,
        null,
        'ACTIVE'
      ),
      (
        '00000000-0000-4000-8000-000000072003',
        'E2ECUS3',
        'EC3',
        'E2E Custody Suspended',
        'SPL_TOKEN',
        6,
        '11111111111111111111111111111172',
        'SUSPENDED'
      );

    select 'seeded';
  `);
  pass("Custody fixtures");
}

async function assertUserAndAal1Blocked() {
  const userResult = await sqlScalar(`
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000070002', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000070002', 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform *
      from public.upsert_custody_provider_draft(
        null, null, 'USER_CUSTODY', 'User Custody', 'MPC_CUSTODIAN',
        true, false, false, false, false,
        '00000000-0000-4000-8000-000000073001',
        'blocked user custody command'
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
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000070001', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000070001', 'aal', 'aal1')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      perform *
      from public.upsert_custody_provider_draft(
        null, null, 'AAL1_CUSTODY', 'AAL1 Custody', 'MPC_CUSTODIAN',
        true, false, false, false, false,
        '00000000-0000-4000-8000-000000073002',
        'blocked aal1 custody command'
      );
      raise exception 'expected denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);
  assert(aal1Result === "denied", "AAL1 command blocked");
  pass("Custody authorization blocks");
}

async function assertConcurrentReplay() {
  const sql = `
    select *
    from public.upsert_custody_provider_draft(
      null,
      null,
      'E2E_CUSTODY_CONCURRENT',
      'E2E Custody Concurrent',
      'QUALIFIED_CUSTODIAN',
      true,
      false,
      false,
      false,
      false,
      '00000000-0000-4000-8000-000000073030',
      'concurrent custody replay'
    )
  `;
  const [first, second] = await Promise.all([
    adminCommandRow(sql),
    adminCommandRow(sql),
  ]);
  const replayCount = [first, second].filter((row) => row.replayed).length;

  assert(
    first.result_code === "APPLIED" && second.result_code === "APPLIED",
    "Concurrent custody outcomes",
  );
  assert(replayCount === 1, "Concurrent custody replay marked once");
  pass("Custody concurrent replay");
}

async function assertUnsupportedNetworkBoundary() {
  const result = await sqlScalar(`
    do $$
    begin
      insert into public.supported_assets (
        asset_code, symbol, display_name, network, asset_type,
        decimals, mint_address, status
      )
      values (
        'E2EETH1',
        'EET',
        'E2E Unsupported Network',
        'ETHEREUM',
        'SPL_TOKEN',
        6,
        '11111111111111111111111111111173',
        'ACTIVE'
      );
      raise exception 'expected unsupported network';
    exception
      when check_violation then
        null;
    end;
    $$;
    select 'blocked';
  `);

  assert(result === "blocked", "Unsupported network blocked");
  pass("Custody unsupported network boundary");
}

async function assertPublicReads() {
  const providers = await adminSqlScalar(`
    select count(*)::text
    from public.list_admin_custody_providers(100, null);
  `);
  const bindings = await adminSqlScalar(`
    select count(*)::text
    from public.list_admin_custody_account_bindings(100, null);
  `);
  const audit = await adminSqlScalar(`
    select count(*)::text
    from public.list_custody_config_audit_events(50, null);
  `);

  assert(Number(providers) >= 1, "Provider read");
  assert(Number(bindings) >= 1, "Binding read");
  assert(Number(audit) >= 1, "Audit read");
  pass("Custody read RPCs");
}

async function assertAuditImmutabilityAndSafety() {
  const result = await sqlScalar(`
    do $$
    begin
      update private.custody_config_audit_events
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

  const markerCount = await sqlScalar(`
    select count(*)::text
    from private.custody_config_audit_events
    where request_data::text ~* '(api[[:space:]_-]*key|api[[:space:]_-]*secret|private[[:space:]_-]*key|mnemonic|seed[[:space:]_-]*phrase|bearer|access[[:space:]_-]*token|refresh[[:space:]_-]*token|service[[:space:]_-]*role|database[[:space:]_-]*url|provider[[:space:]_-]*account|deposit[[:space:]_-]*address|wallet[[:space:]_-]*address|signature|transaction[[:space:]_-]*(id|hash|signature)|tx[[:space:]_-]*(id|hash|signature)|https?://|rpc)';
  `);
  assert(markerCount === "0", "Audit request data safe");
  pass("Custody audit safety");
}

async function assertNoSensitiveSchemaMarkers() {
  const markerCount = await sqlScalar(`
    select count(*)::text
    from information_schema.columns
    where table_schema in ('public', 'private')
      and table_name in (
        'custody_providers',
        'custody_account_bindings',
        'custody_config_audit_events'
      )
      and lower(column_name) in (
        'balance',
        'available_balance',
        'locked_balance',
        'provider_account_id',
        'external_account_id',
        'deposit_address',
        'withdrawal_address',
        'wallet_address',
        'blockchain_address',
        'private_key',
        'mnemonic',
        'seed_phrase',
        'transaction_id',
        'transaction_hash',
        'tx_hash',
        'signature',
        'rpc_url',
        'api_key',
        'api_secret'
      );
  `);

  assert(markerCount === "0", "Custody schema sensitive markers zero");
  pass("Custody schema marker scan");
}

async function transitionProviderByCode(providerCode, status, commandId, reason) {
  const provider = await readProvider(providerCode);

  return adminCommandRow(`
    select *
    from public.transition_custody_provider_status(
      ${sqlLiteral(provider.id)}::uuid,
      ${provider.version},
      ${sqlLiteral(status)},
      ${sqlLiteral(commandId)}::uuid,
      ${sqlLiteral(reason)}
    )
  `);
}

async function transitionBindingByKey(bindingKey, status, commandId, reason) {
  const binding = await readBinding(bindingKey);

  return adminCommandRow(`
    select *
    from public.transition_custody_account_binding_status(
      ${sqlLiteral(binding.id)}::uuid,
      ${binding.version},
      ${sqlLiteral(status)},
      ${sqlLiteral(commandId)}::uuid,
      ${sqlLiteral(reason)}
    )
  `);
}

async function readProvider(providerCode) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', providers.id::text,
      'status', providers.status,
      'version', providers.version
    )::text
    from private.custody_providers as providers
    where providers.provider_code = ${sqlLiteral(providerCode)};
  `);

  assert(Boolean(payload), "Provider row");

  return JSON.parse(payload);
}

async function readBinding(bindingKey) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', bindings.id::text,
      'status', bindings.status,
      'version', bindings.version
    )::text
    from private.custody_account_bindings as bindings
    where bindings.binding_key = ${sqlLiteral(bindingKey)};
  `);

  assert(Boolean(payload), "Binding row");

  return JSON.parse(payload);
}

async function adminCommandRow(selectSql) {
  const payload = await adminSqlScalar(`
    select row_to_json(command_result)::text
    from (${selectSql}) as command_result;
  `);

  return JSON.parse(payload);
}

async function adminSqlScalar(sql) {
  return sqlScalar(`
    select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000070001', false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '00000000-0000-4000-8000-000000070001', 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    ${sql}
  `);
}

async function custodyCounts() {
  const result = await sqlScalar(`
    select
      (select count(*) from private.custody_providers)::text || ',' ||
      (select count(*) from private.custody_account_bindings)::text || ',' ||
      (select count(*) from private.custody_config_audit_events)::text;
  `);
  const [providers, bindings, audit] = result.split(",").map(Number);

  return { providers, bindings, audit };
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
    before.providers === after.providers &&
      before.bindings === after.bindings &&
      before.audit === after.audit,
    label,
  );
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
    custody_provider_id: "00000000-0000-4000-8000-000000000001",
    custody_account_binding_id: "00000000-0000-4000-8000-000000000002",
    asset_id: "00000000-0000-4000-8000-000000000003",
    expected_version: "1",
    provider_code: "REJECTED_CUSTODY",
    display_name: "Rejected Custody",
    provider_type: "MPC_CUSTODIAN",
    binding_key: "rejected_binding",
    display_label: "Rejected Binding",
    account_role: "COLLECTION",
    new_status: "APPROVED",
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

async function waitForLocalSupabaseReadiness(label) {
  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    const ready =
      (await fetchStatus(`${LOCAL_SUPABASE_API_ORIGIN}/auth/v1/health`)) >=
        200 &&
      (await fetchStatus(`${LOCAL_SUPABASE_API_ORIGIN}/rest/v1/`)) >= 200 &&
      (await fetchStatus(`${MAILPIT_ORIGIN}/api/v1/messages`)) === 200 &&
      (await readDatabaseReady());

    if (ready) {
      pass(label);
      return;
    }

    await wait(Math.min(500 + attempt * 250, 2500));
  }

  throw new Error(`FAIL ${label}`);
}

async function readDatabaseReady() {
  try {
    return (await sqlScalar("select 'ready';")) === "ready";
  } catch {
    return false;
  }
}

async function fetchStatus(url) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });

    return response.status;
  } catch {
    return 0;
  }
}

async function assertProjectScope() {
  const containers = await readProjectContainers();

  for (const container of containers) {
    assert(
      container.supabaseProject === PROJECT_LABEL ||
        container.composeProject === PROJECT_LABEL,
      "Project container scope",
    );
  }
}

async function assertProcessCleanup() {
  const portOutput = await execText("netstat", ["-ano"], 10000);
  const blockedPorts = [":3000", ":3010", ":55721", ":55722", ":55723", ":55724"];
  const listenerLines = portOutput
    .split(/\r?\n/)
    .filter((line) => line.includes("LISTENING"))
    .filter((line) => blockedPorts.some((port) => line.includes(port)));
  const listening = [];

  for (const line of listenerLines) {
    const processId = line.trim().split(/\s+/).at(-1) ?? "";
    const processName = await readProcessName(processId).catch(() => "");

    if (
      line.includes(":3000") &&
      (processName === "com.docker.backend.exe" ||
        processName === "wslrelay.exe")
    ) {
      continue;
    }

    listening.push(line);
  }

  const containers = await readProjectContainers();

  assert(listening.length === 0, "Port listener cleanup");
  assert(containers.length === 0, "Supabase container cleanup");
  pass("Process cleanup");
}

async function readProjectContainers() {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "ps",
      "--format",
      "{{.Names}}\t{{.Label \"com.supabase.cli.project\"}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Label \"com.docker.compose.service\"}}",
    ],
    {
      timeout: 10000,
      windowsHide: true,
    },
  );

  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, supabaseProject, composeProject, composeService] =
        line.split("\t");

      return {
        name,
        supabaseProject,
        composeProject,
        composeService,
      };
    })
    .filter(
      (container) =>
        container.supabaseProject === PROJECT_LABEL ||
        container.composeProject === PROJECT_LABEL ||
        container.name.endsWith(`_${PROJECT_LABEL}`),
    );
}

async function readProcessName(processId) {
  const output = await execText(
    "tasklist",
    ["/FI", `PID eq ${processId}`, "/FO", "CSV", "/NH"],
    10000,
  );
  const firstLine = output.trim().split(/\r?\n/)[0] ?? "";
  const match = firstLine.match(/^"([^"]+)"/);

  return match?.[1] ?? "";
}

async function runNpmScript(scriptName, label, timeout) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      getNpmArgs(scriptName),
      {
        env: {
          ...process.env,
          APP_ORIGIN,
          NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
        },
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 20,
      },
    );
    const output = `${stdout}\n${stderr}`;

    assertOutputSafe(output, `${label} output`);
    pass(label);

    return output;
  } catch (error) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;

    assertOutputSafe(output, `${label} failure output`);
    throw new Error(`FAIL ${label}`);
  }
}

async function runNpmScriptSensitive(scriptName, label, timeout) {
  await execFileAsync(process.execPath, getNpmArgs(scriptName), {
    env: {
      ...process.env,
      APP_ORIGIN,
      NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
    },
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
  });
  pass(label);
}

async function execText(command, args, timeout) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
  });
  const output = `${stdout}${stderr}`;

  assertOutputSafe(output, `${command} output`);

  return output;
}

function getNpmArgs(scriptName) {
  assert(Boolean(NPM_EXEC_PATH), "npm exec path");

  return [NPM_EXEC_PATH, "--silent", "run", scriptName];
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
    "custody_provider_id",
    "custody_account_binding_id",
    "asset_id",
    "provider_code",
    "binding_key",
    "command_id",
    "expected_version",
    "reason",
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

function isAllowedLocalUrl(url) {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  );
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
    console.error(redactDiagnostic(`FAIL custody boundary ${message}`));
  }

  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]");
}
