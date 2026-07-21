import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";

const DB_CONTAINER = "supabase_db_staking-wallet-web";
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const REWARD_COMMAND_ENDPOINTS = [
  "/api/v1/staking/positions/settle-reward",
  "/api/v1/admin/staking-positions/settle-reward",
];

const ADMIN_ID = "00000000-0000-4000-8000-000000090001";
const USER_ID = "00000000-0000-4000-8000-000000090002";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000090003";
const PROJECT_ID = "00000000-0000-4000-8000-000000091001";
const ASSET_ID = "00000000-0000-4000-8000-000000092001";

async function main() {
  const runtime = await prepareManagedAppRuntime();

  try {
    await assertHttpSmoke();
    await assertSameOriginRejections();
    await assertDatabaseStateMachine();
    await assertStaticRewardBoundaries();
    pass("Staking reward integration");
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
  pass("Staking reward HTTP smoke");
}

async function assertSameOriginRejections() {
  const before = await rewardCounts();

  for (const endpoint of REWARD_COMMAND_ENDPOINTS) {
    const noOrigin = await appFetch(endpoint, {
      method: "POST",
      body: rewardRejectionBody(),
      includeOrigin: false,
      redirect: "manual",
    });
    assertRedirectHasCode(noOrigin, "request_rejected", "Origin required");

    const external = await appFetch(endpoint, {
      method: "POST",
      body: rewardRejectionBody(),
      origin: "https://example.invalid",
      redirect: "manual",
    });
    assertRedirectHasCode(external, "request_rejected", "External origin");

    const fetchSite = await appFetch(endpoint, {
      method: "POST",
      body: rewardRejectionBody(),
      fetchSite: "cross-site",
      redirect: "manual",
    });
    assertRedirectHasCode(fetchSite, "request_rejected", "Fetch site");
  }

  assertRewardCountsEqual(
    before,
    await rewardCounts(),
    "Origin rejection mutation",
  );
  pass("Staking reward same-origin rejection");
}

async function assertDatabaseStateMachine() {
  await seedActorsAndCatalog();
  const product = await createAndActivateProduct();
  await postOpeningBalance("10000000000000000000");

  await assertUserPositiveReward(product);
  await assertUserZeroReward(product);
  await assertSafeIntegerReward(product);
  await assertLockedRewardBlocked(product);
  await assertUserRewardReadBoundary();
  await assertUserInactiveWalletBlockedAndAdminReward(product);
  await assertReadAndAuditBoundaries();
  await assertImmutability();
  pass("Staking reward database state machine");
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
        'staking-reward-e2e-admin@example.test',
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
        'staking-reward-e2e-user@example.test',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        ${sqlLiteral(OTHER_USER_ID)}::uuid,
        'authenticated',
        'authenticated',
        'staking-reward-e2e-other@example.test',
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
      'local staking reward e2e bootstrap'
    );

    insert into public.projects (
      id, project_code, display_name, description, status
    )
    values (
      ${sqlLiteral(PROJECT_ID)}::uuid,
      'E2EREWARDPROJ',
      'E2E Reward Project',
      'local staking reward e2e project',
      'ACTIVE'
    );

    insert into public.supported_assets (
      id, asset_code, symbol, display_name, asset_type, decimals,
      mint_address, status
    )
    values (
      ${sqlLiteral(ASSET_ID)}::uuid,
      'E2ERWD1',
      'ERW',
      'E2E Reward SPL',
      'SPL_TOKEN',
      6,
      '11111111111111111111111111111191',
      'ACTIVE'
    );

    insert into public.project_token_assignments (project_id, asset_id)
    values (${sqlLiteral(PROJECT_ID)}::uuid, ${sqlLiteral(ASSET_ID)}::uuid);

    select 'seeded';
  `);
  pass("Staking reward fixtures");
}

async function createAndActivateProduct() {
  const created = await adminCommandRow(`
    select *
    from public.create_staking_product(
      ${sqlLiteral(PROJECT_ID)}::uuid,
      ${sqlLiteral(ASSET_ID)}::uuid,
      'REWARD_E2E_A',
      'Reward E2E A',
      'local staking reward product',
      1,
      '1',
      null,
      250000,
      now() - interval '1 hour',
      now() + interval '30 days',
      '00000000-0000-4000-8000-000000093001',
      'create staking reward product'
    )
  `);
  assert(created.result_code === "APPLIED", "Create reward product");

  const activated = await adminCommandRow(`
    select *
    from public.transition_staking_product_status(
      ${sqlLiteral(created.staking_product_id)}::uuid,
      ${created.entity_version},
      'ACTIVE',
      '00000000-0000-4000-8000-000000093002',
      'activate staking reward product'
    )
  `);
  assert(activated.result_code === "APPLIED", "Activate reward product");

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
      '00000000-0000-4000-8000-000000093003',
      'opening for staking reward e2e'
    )
  `);

  assert(opening.result_code === "APPLIED", "Opening balance");
  pass("Staking reward opening balance");
}

async function assertUserPositiveReward(product) {
  const fixture = await createUnlockedPosition({
    product,
    positionId: "00000000-0000-4000-8000-000000094001",
    lockJournalId: "00000000-0000-4000-8000-000000094002",
    lockCommandId: "00000000-0000-4000-8000-000000093004",
    unlockCommandId: "00000000-0000-4000-8000-000000093005",
    principalUnits: "2000",
  });

  const before = await walletBalance(fixture.walletId);
  const settled = await userRewardRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(fixture.positionId)}::uuid,
      ${fixture.positionVersion},
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-000000093006'
    )
  `);

  assert(settled.result_code === "APPLIED", "User reward applied");
  assert(settled.reward_state === "PAID", "User reward state paid");
  assert(settled.settlement_outcome === "PAID", "User reward outcome paid");
  assert(settled.reward_units === "500", "User reward units");

  const after = await walletBalance(fixture.walletId);
  assert(
    BigInt(after.available) === BigInt(before.available) + 500n,
    "Reward available increased",
  );
  assert(after.locked === before.locked, "Reward locked unchanged");
  assert(
    BigInt(after.total) === BigInt(before.total) + 500n,
    "Reward liability increased",
  );

  const replayed = await userRewardRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(fixture.positionId)}::uuid,
      ${fixture.positionVersion},
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-000000093006'
    )
  `);
  assert(replayed.replayed === true, "User reward replay");

  const noop = await userRewardRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(fixture.positionId)}::uuid,
      ${fixture.positionVersion},
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-000000093007'
    )
  `);
  assert(noop.result_code === "NOOP", "User reward noop");

  const conflict = await userRewardRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(fixture.positionId)}::uuid,
      ${fixture.positionVersion},
      ${fixture.walletVersion + 1},
      '00000000-0000-4000-8000-000000093006'
    )
  `);
  assert(
    conflict.result_code === "STAKING_REWARD_COMMAND_ID_CONFLICT",
    "User reward command conflict",
  );

  pass("User positive reward settlement");
}

async function assertUserZeroReward(product) {
  const fixture = await createUnlockedPosition({
    product,
    positionId: "00000000-0000-4000-8000-000000094011",
    lockJournalId: "00000000-0000-4000-8000-000000094012",
    lockCommandId: "00000000-0000-4000-8000-000000093011",
    unlockCommandId: "00000000-0000-4000-8000-000000093012",
    principalUnits: "3",
  });
  const before = await rewardCounts();
  const settled = await userRewardRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(fixture.positionId)}::uuid,
      ${fixture.positionVersion},
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-000000093013'
    )
  `);
  const after = await rewardCounts();

  assert(settled.result_code === "APPLIED", "User zero reward applied");
  assert(settled.reward_state === "ZERO", "User zero reward state");
  assert(settled.settlement_outcome === "ZERO", "User zero reward outcome");
  assert(settled.reward_units === "0", "User zero reward units");
  assert(after.settlements === before.settlements + 1, "Zero settlement row");
  assert(after.audit === before.audit + 1, "Zero audit row");
  assert(after.journals === before.journals, "Zero reward journal count");
  assert(after.entries === before.entries, "Zero reward entry count");
  pass("User zero reward settlement");
}

async function assertSafeIntegerReward(product) {
  const fixture = await createUnlockedPosition({
    product,
    positionId: "00000000-0000-4000-8000-000000094021",
    lockJournalId: "00000000-0000-4000-8000-000000094022",
    lockCommandId: "00000000-0000-4000-8000-000000093021",
    unlockCommandId: "00000000-0000-4000-8000-000000093022",
    principalUnits: "9007199254740993",
  });
  const settled = await userRewardRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(fixture.positionId)}::uuid,
      ${fixture.positionVersion},
      ${fixture.walletVersion},
      '00000000-0000-4000-8000-000000093023'
    )
  `);

  assert(settled.result_code === "APPLIED", "Safe integer reward applied");
  assert(settled.reward_units === "2251799813685248", "Safe integer reward");
  pass("Safe integer reward settlement");
}

async function assertLockedRewardBlocked(product) {
  const locked = await createLockedPosition({
    product,
    positionId: "00000000-0000-4000-8000-000000094031",
    lockJournalId: "00000000-0000-4000-8000-000000094032",
    lockCommandId: "00000000-0000-4000-8000-000000093031",
    principalUnits: "1000",
  });
  const result = await userRewardRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(locked.positionId)}::uuid,
      1,
      ${locked.walletVersion},
      '00000000-0000-4000-8000-000000093032'
    )
  `);

  assert(
    result.result_code === "STAKING_REWARD_POSITION_NOT_UNLOCKED",
    "Locked reward blocked",
  );

  const collision = await userRewardRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(locked.positionId)}::uuid,
      1,
      ${locked.walletVersion},
      '00000000-0000-4000-8000-000000093031'
    )
  `);
  assert(
    collision.result_code === "STAKING_REWARD_COMMAND_ID_CONFLICT",
    "Position command id collision",
  );
  pass("Locked reward boundary");
}

async function assertUserInactiveWalletBlockedAndAdminReward(product) {
  const fixture = await createUnlockedPosition({
    product,
    positionId: "00000000-0000-4000-8000-000000094041",
    lockJournalId: "00000000-0000-4000-8000-000000094042",
    lockCommandId: "00000000-0000-4000-8000-000000093041",
    unlockCommandId: "00000000-0000-4000-8000-000000093042",
    principalUnits: "1000",
  });

  await sqlScalar(`
    update public.wallet_accounts
    set status = 'FROZEN'
    where id = ${sqlLiteral(fixture.walletId)}::uuid;

    select 'wallet frozen';
  `);
  const frozenWallet = await readWallet();

  const userBlocked = await userRewardRow(`
    select *
    from public.settle_current_user_staking_reward(
      ${sqlLiteral(fixture.positionId)}::uuid,
      ${fixture.positionVersion},
      ${frozenWallet.version},
      '00000000-0000-4000-8000-000000093043'
    )
  `);
  assert(
    userBlocked.result_code === "STAKING_REWARD_WALLET_NOT_ACTIVE",
    "User frozen wallet blocked",
  );

  const aal1Blocked = await expectSqlError(
    adminAal1ContextSql(`
      select *
      from public.settle_staking_reward_as_admin(
        ${sqlLiteral(fixture.positionId)}::uuid,
        ${fixture.positionVersion},
        '00000000-0000-4000-8000-000000093044',
        'admin aal1 reward blocked'
      );
    `),
  );
  assert(aal1Blocked, "Admin AAL1 reward blocked");

  await makeTargetOperationallyInactive(product);

  const adminSettled = await adminRewardRow(`
    select *
    from public.settle_staking_reward_as_admin(
      ${sqlLiteral(fixture.positionId)}::uuid,
      ${fixture.positionVersion},
      '00000000-0000-4000-8000-000000093045',
      'admin settled inactive target reward'
    )
  `);
  assert(adminSettled.result_code === "APPLIED", "Admin reward applied");
  assert(adminSettled.reward_state === "PAID", "Admin reward state paid");
  assert(adminSettled.reward_units === "250", "Admin reward units");

  const [firstReplay, secondReplay] = await Promise.all([
    adminRewardRow(`
      select *
      from public.settle_staking_reward_as_admin(
        ${sqlLiteral(fixture.positionId)}::uuid,
        ${fixture.positionVersion},
        '00000000-0000-4000-8000-000000093046',
        'admin concurrent reward replay'
      )
    `),
    adminRewardRow(`
      select *
      from public.settle_staking_reward_as_admin(
        ${sqlLiteral(fixture.positionId)}::uuid,
        ${fixture.positionVersion},
        '00000000-0000-4000-8000-000000093046',
        'admin concurrent reward replay'
      )
    `),
  ]);
  assert(
    [firstReplay.result_code, secondReplay.result_code].every(
      (code) => code === "NOOP",
    ) || firstReplay.replayed === true || secondReplay.replayed === true,
    "Concurrent reward replay",
  );

  pass("Admin inactive target reward settlement");
}

async function makeTargetOperationallyInactive(product) {
  const suspended = await adminCommandRow(`
    select *
    from public.transition_staking_product_status(
      ${sqlLiteral(product.productId)}::uuid,
      ${product.version},
      'SUSPENDED',
      '00000000-0000-4000-8000-000000093047',
      'suspend after reward fixtures'
    )
  `);
  assert(suspended.result_code === "APPLIED", "Suspend reward product");

  await sqlScalar(`
    update public.profiles
    set account_status = 'SUSPENDED'
    where id = ${sqlLiteral(USER_ID)}::uuid;

    update public.projects
    set status = 'SUSPENDED'
    where id = ${sqlLiteral(PROJECT_ID)}::uuid;

    update public.supported_assets
    set status = 'SUSPENDED'
    where id = ${sqlLiteral(ASSET_ID)}::uuid;

    select 'inactive target';
  `);
}

async function createUnlockedPosition({
  product,
  positionId,
  lockJournalId,
  lockCommandId,
  unlockCommandId,
  principalUnits,
}) {
  const locked = await createLockedPosition({
    product,
    positionId,
    lockJournalId,
    lockCommandId,
    principalUnits,
  });
  const unlocked = await userCommandRow(`
    select *
    from public.unlock_current_user_staking_position(
      ${sqlLiteral(positionId)}::uuid,
      1,
      ${locked.walletVersion},
      ${sqlLiteral(unlockCommandId)}::uuid
    )
  `);
  assert(unlocked.result_code === "APPLIED", "Unlock reward fixture");

  const wallet = await readWallet();
  const positionVersion = await readPositionVersion(positionId);

  return {
    positionId,
    walletId: locked.walletId,
    walletVersion: wallet.version,
    positionVersion,
  };
}

async function createLockedPosition({
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
        jsonb_build_object('fixture', 'staking_reward_e2e'),
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
    select 'position';
  `);

  return {
    positionId,
    walletId: wallet.id,
    walletVersion: wallet.version,
  };
}

async function assertReadAndAuditBoundaries() {
  const adminRead = await adminSqlScalar(`
    select count(*)::text
    from public.list_admin_staking_positions(100, null)
    where reward_state in ('CLAIMABLE', 'PAID', 'ZERO')
      and calculated_reward_units ~ '^(0|[1-9][0-9]*)$';
  `);
  assert(Number(adminRead) >= 4, "Admin reward read boundary");

  const rewardAudit = await adminSqlScalar(`
    select count(*)::text
    from public.list_staking_reward_command_audit_events(25, null)
    where action = 'SETTLE_STAKING_REWARD'
      and outcome in ('APPLIED', 'NOOP')
      and settlement_outcome in ('PAID', 'ZERO');
  `);
  assert(Number(rewardAudit) >= 5, "Admin reward audit read");
  pass("Staking reward read and audit boundary");
}

async function assertUserRewardReadBoundary() {
  const userRead = await userSqlScalar(`
    select count(*)::text
    from public.list_current_user_staking_positions(100)
    where reward_state in ('CLAIMABLE', 'PAID', 'ZERO')
      and calculated_reward_units ~ '^(0|[1-9][0-9]*)$';
  `);
  assert(Number(userRead) >= 3, "User reward read boundary");

  const userReadSignature = await sqlScalar(`
    select (
      pg_get_function_result(
        'public.list_current_user_staking_positions(integer)'::regprocedure
      ) !~* '(reward_settlement_id|reward_journal_id|settled_by)'
    )::text;
  `);
  assert(userReadSignature === "true", "User reward ids hidden");
  pass("User staking reward read boundary");
}

async function assertImmutability() {
  const settlementUpdate = await expectSqlError(`
    update private.staking_position_reward_settlements
    set outcome = outcome;
  `);
  assert(settlementUpdate, "Reward settlement update immutable");

  const settlementDelete = await expectSqlError(`
    delete from private.staking_position_reward_settlements;
  `);
  assert(settlementDelete, "Reward settlement delete immutable");

  const settlementTruncate = await expectSqlError(`
    truncate table private.staking_position_reward_settlements;
  `);
  assert(settlementTruncate, "Reward settlement truncate immutable");

  const auditUpdate = await expectSqlError(`
    update private.staking_reward_command_audit_events
    set outcome = outcome;
  `);
  assert(auditUpdate, "Reward audit update immutable");

  const auditDelete = await expectSqlError(`
    delete from private.staking_reward_command_audit_events;
  `);
  assert(auditDelete, "Reward audit delete immutable");

  const auditTruncate = await expectSqlError(`
    truncate table private.staking_reward_command_audit_events;
  `);
  assert(auditTruncate, "Reward audit truncate immutable");
  pass("Staking reward immutability");
}

async function assertStaticRewardBoundaries() {
  const stakingPage = readFileSync("src/app/staking/page.tsx", "utf8");
  const adminPage = readFileSync(
    "src/app/admin/staking-positions/page.tsx",
    "utf8",
  );
  const userRoute = readFileSync(
    "src/app/api/v1/staking/positions/settle-reward/route.ts",
    "utf8",
  );
  const adminRoute = readFileSync(
    "src/app/api/v1/admin/staking-positions/settle-reward/route.ts",
    "utf8",
  );

  for (const marker of [
    "APY",
    "APR",
    "reward_amount",
    "reward_units\"",
    "reward_rate",
    "createBrowserClient",
    "service_role",
    "Transaction ID",
    "Wallet address",
  ]) {
    assert(!stakingPage.includes(marker), `Staking page no ${marker}`);
    assert(!adminPage.includes(marker), `Admin page no ${marker}`);
  }

  assert(
    !userRoute.includes("reward_units") &&
      !adminRoute.includes("reward_units"),
    "Reward routes no amount input",
  );
  assert(
    userRoute.includes("isSameOriginRequest(request)") &&
      adminRoute.includes("isSameOriginRequest(request)"),
    "Reward routes same-origin",
  );
  pass("Staking reward static boundary");
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

async function adminRewardRow(selectSql) {
  return adminCommandRow(selectSql);
}

async function userRewardRow(selectSql) {
  return userCommandRow(selectSql);
}

async function readWallet() {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', wallet_accounts.id::text,
      'version', wallet_accounts.version
    )::text
    from public.wallet_accounts as wallet_accounts
    where wallet_accounts.user_id = ${sqlLiteral(USER_ID)}::uuid;
  `);

  assert(Boolean(payload), "Wallet row");

  return JSON.parse(payload);
}

async function readPositionVersion(positionId) {
  return Number(
    await sqlScalar(`
      select positions.version::text
      from private.staking_positions as positions
      where positions.id = ${sqlLiteral(positionId)}::uuid;
    `),
  );
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
      and balances.asset_id = ${sqlLiteral(ASSET_ID)}::uuid;
  `);

  return JSON.parse(payload);
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

function assertRewardCountsEqual(before, after, label) {
  assert(
    before.settlements === after.settlements &&
      before.audit === after.audit &&
      before.journals === after.journals &&
      before.entries === after.entries,
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

function adminAal1ContextSql(sql) {
  return `
    select set_config('request.jwt.claim.sub', ${sqlLiteral(ADMIN_ID)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(ADMIN_ID)}, 'aal', 'aal1')::text,
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

function rewardRejectionBody() {
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
    console.error(redactDiagnostic(`FAIL staking reward integration ${message}`));
  }

  process.exitCode = 1;
});

function redactDiagnostic(value) {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED]")
    .replace(UUID_PATTERN, "[REDACTED]");
}
