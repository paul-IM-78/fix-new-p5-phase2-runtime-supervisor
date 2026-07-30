import { execFile, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { createCookieJar } from "./lib/http-cookie-jar.mjs";
import {
  assertOutputSafe,
  localFetch,
  readLocalHttpStatus,
  wait,
} from "./lib/local-http-harness.mjs";
import { waitForLocalAuthHandoffReady } from "./lib/local-auth-handoff.mjs";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const PROJECT_LABEL = "staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const DIRECT_MANAGED_APP_HOST = "127.0.0.1";
const DIRECT_MANAGED_APP_PORT = "3000";
const DIRECT_RUNTIME_READY_TIMEOUT_MS = 45000;
const DIRECT_RUNTIME_EXIT_TIMEOUT_MS = 5000;
const DIRECT_RUNTIME_PORT_RELEASE_TIMEOUT_MS = 15000;
const DIRECT_RUNTIME_CLEAN_SAMPLE_COUNT = 3;
const DIRECT_RUNTIME_CLEAN_SAMPLE_INTERVAL_MS = 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PUBLIC_RESPONSE_DENYLIST = [
  "access_token",
  "refresh_token",
  "sb-access-token",
  "sb-refresh-token",
  "authorization",
  "set-cookie",
  "cookie",
  "jwt",
  "database_url",
  "direct_database_url",
  "service_role",
  "supabase_service_role",
  "private key",
  "mnemonic",
  "seed phrase",
  "sql",
  "constraint",
  "stack",
  "expected_units",
  "observed_units",
  "difference_units",
  "custody_account_binding",
  "wallet",
  "provider",
];

async function main() {
  const suffix = randomUUID().replaceAll("-", "");
  const runMarker = `P5_T02_RUNTIME_${suffix.slice(0, 12).toUpperCase()}`;
  const safePrefix = `p5rt.${suffix.slice(0, 16).toLowerCase()}`;
  const password = `P5Runtime-${suffix.slice(0, 18)}-Pass1!`;
  const adminEmail = `qa-p5rt-admin-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const userEmail = `qa-p5rt-user-${Date.now()}-${suffix.slice(8, 16)}@example.test`;

  await withSelfOwnedRuntime(async () => {
    await assertPublicSmoke();

    const userJar = await signUpConfirmAndSignIn(
      userEmail,
      password,
      "/account",
      "QA Runtime User",
    );
    const userId = await readUserIdByEmail(userEmail);

    const adminJar = await signUpConfirmAndSignIn(
      adminEmail,
      password,
      "/admin",
      "QA Runtime Admin",
    );
    const adminUserId = await readUserIdByEmail(adminEmail);

    await bootstrapAdminRole(userId, "local reconciliation runtime temporary user aal2 bootstrap");
    await enrollAndVerifyMfa(userJar, userId, "USER");
    await revokeTemporaryAdminRole(userId);
    await assertActiveAdminRoleCount(userId, "0", "USER AAL2 temporary ADMIN revoked");

    console.log("RECON_RUNTIME_STAGE=ADMIN_BOOTSTRAP");
    await bootstrapAdminRole(adminUserId);

    console.log("RECON_RUNTIME_STAGE=RECON_FIXTURE_SETUP");
    const fixture = await createRuntimeReconciliationFixture({
      adminUserId,
      runMarker,
      safePrefix,
    });
    const beforeSideEffects = await readSideEffectSnapshot(fixture.itemId);

    await assertUnauthenticatedDenied(fixture);
    await assertUserAal2Denied(userJar, fixture);
    await assertAdminAal1Denied(adminJar, fixture);

    await enrollAndVerifyMfa(adminJar, adminUserId, "ADMIN");
    await assertAdminAal2ReviewLifecycle({
      adminJar,
      adminUserId,
      fixture,
      beforeSideEffects,
      safePrefix,
    });
    await assertLowLevelPrivatePrivilegeBlocked();

    console.log("P5_T02_DB_WRITE_PATH_COMPLETE=true");
    console.log("P5_T02_APPLICATION_MUTATION_BOUNDARY_COMPLETE=true");
    console.log("P5_T02_HTTP_RUNTIME_VERIFIED=true");
    console.log("P5_T02_ADMIN_READ_MODEL=DEFERRED");
    console.log("P5_T02_ADMIN_UI=DEFERRED");
    console.log("P5_T02_PROVIDER_NETWORK=DEFERRED");
    console.log("P5_T02_SCHEDULER=DEFERRED");
    console.log("FINAL_STATUS=PASS_P5_T02_RUNTIME_CLOSEOUT_READY");
  });
}

async function withSelfOwnedRuntime(action) {
  let server = null;
  let supabaseStarted = false;
  let taskkillFallbackCount = 0;
  let fixtureCleanupReset = false;

  try {
    emitRuntimeHarnessPattern();
    await assertSelfOwnedRuntimeCleanPrecondition();
    await runNpmScriptSensitive(
      "supabase:start",
      "RECON_RUNTIME_SUPABASE_START",
      120000,
    );
    supabaseStarted = true;

    await runNpmScriptSensitive(
      "db:reset:local",
      "RECON_RUNTIME_DB_RESET_START",
      180000,
    );

    const status = await readLocalSupabaseStatus();

    server = await startSelfOwnedNextRuntime(status);
    await waitForLocalAuthHandoffReady("Reconciliation review auth handoff");

    return await action();
  } finally {
    if (server) {
      taskkillFallbackCount = await stopSelfOwnedNextRuntime(server);
    }

    if (supabaseStarted) {
      await runNpmScriptSensitive(
        "db:reset:local",
        "RECON_RUNTIME_FIXTURE_CLEANUP_DB_RESET",
        180000,
      );
      fixtureCleanupReset = true;

      await runNpmScriptSensitive(
        "supabase:stop",
        "RECON_RUNTIME_SUPABASE_STOP",
        120000,
      );
    }

    console.log(`RECON_RUNTIME_TASKKILL_FALLBACK_COUNT=${taskkillFallbackCount}`);
    console.log(`RECON_RUNTIME_FIXTURE_CLEANUP_DB_RESET=${fixtureCleanupReset}`);
    console.log("RUNTIME_FIXTURE_CLEANUP=PASS");
    await assertSelfOwnedRuntimeCleanPostcondition();
  }
}

function emitRuntimeHarnessPattern() {
  console.log("RUNTIME_HARNESS_PATTERN=self_owned_supabase_reset_next_start");
  console.log("AUTH_FIXTURE_PATTERN=mailpit_confirmed_local_signup");
  console.log("AAL2_SESSION_PATTERN=get_preflight_then_mfa_start_verify");
  console.log("HTTP_COOKIE_PATTERN=shared_cookie_jar_json_post");
  console.log("DB_FIXTURE_PATTERN=local_postgres_test_only_private_functions");
  console.log("CLEANUP_PATTERN=db_reset_then_owned_runtime_stop");
  console.log("SERVICE_ROLE_PRODUCTION_USAGE=0");
}

async function assertSelfOwnedRuntimeCleanPrecondition() {
  assert(
    !existsSync(".env.local") && !existsSync(".env.local.phase2-supervisor"),
    "Reconciliation runtime env precondition",
  );
  assert(
    (await readProjectContainerCount()) === 0,
    "Reconciliation runtime project container precondition",
  );
  assert(
    (await readPortListenerCount(3000)) === 0,
    "Reconciliation runtime port 3000 precondition",
  );
  assert(
    (await readPortListenerCount(3010)) === 0,
    "Reconciliation runtime port 3010 precondition",
  );
  assert(
    (await readPortListenerCount(55721)) === 0,
    "Reconciliation runtime port 55721 precondition",
  );
  assert(
    (await readPortListenerCount(55722)) === 0,
    "Reconciliation runtime port 55722 precondition",
  );
  assert(
    (await readPortListenerCount(55723)) === 0,
    "Reconciliation runtime port 55723 precondition",
  );
  assert(
    (await readPortListenerCount(55724)) === 0,
    "Reconciliation runtime port 55724 precondition",
  );
  pass("RECON_RUNTIME_CLEAN_PRECONDITION");
}

async function assertSelfOwnedRuntimeCleanPostcondition() {
  for (let index = 1; index <= DIRECT_RUNTIME_CLEAN_SAMPLE_COUNT; index += 1) {
    assert(
      (await readProjectContainerCount()) === 0,
      "Reconciliation runtime project container cleanup",
    );
    assert(
      (await readPortListenerCount(3000)) === 0,
      "Reconciliation runtime port 3000 cleanup",
    );
    assert(
      (await readPortListenerCount(3010)) === 0,
      "Reconciliation runtime port 3010 cleanup",
    );
    assert(
      (await readPortListenerCount(55721)) === 0,
      "Reconciliation runtime port 55721 cleanup",
    );
    assert(
      (await readPortListenerCount(55722)) === 0,
      "Reconciliation runtime port 55722 cleanup",
    );
    assert(
      (await readPortListenerCount(55723)) === 0,
      "Reconciliation runtime port 55723 cleanup",
    );
    assert(
      (await readPortListenerCount(55724)) === 0,
      "Reconciliation runtime port 55724 cleanup",
    );
    assert(
      !existsSync(".env.local") && !existsSync(".env.local.phase2-supervisor"),
      "Reconciliation runtime env cleanup",
    );
    console.log(`RECON_RUNTIME_CLEAN_SAMPLE=${index}`);
    await wait(DIRECT_RUNTIME_CLEAN_SAMPLE_INTERVAL_MS);
  }

  pass("RECON_RUNTIME_CLEANUP");
}

async function startSelfOwnedNextRuntime(status) {
  assert(existsSync(".next/BUILD_ID"), "Reconciliation Next build artifact");

  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      DIRECT_MANAGED_APP_PORT,
      "-H",
      DIRECT_MANAGED_APP_HOST,
    ],
    {
      env: {
        ...process.env,
        APP_ENV: "local",
        APP_ORIGIN,
        NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
        NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      },
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    },
  );

  await waitForSelfOwnedNextRuntime(server);

  return server;
}

async function waitForSelfOwnedNextRuntime(server) {
  const deadline = Date.now() + DIRECT_RUNTIME_READY_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error("FAIL Reconciliation Next runtime exited");
    }

    const health = await readLocalHttpStatus(`${APP_ORIGIN}/api/v1/health`, {
      timeoutMs: 2000,
      readBody: true,
      label: "Reconciliation runtime health",
    });
    const readiness = await readLocalHttpStatus(
      `${APP_ORIGIN}/api/v1/readiness/config`,
      {
        timeoutMs: 2000,
        readBody: true,
        label: "Reconciliation runtime readiness",
      },
    );

    if (health.status === 200 && readiness.status === 200) {
      pass("RECON_RUNTIME_NEXT_READY");
      return;
    }

    await wait(500);
  }

  throw new Error("FAIL Reconciliation Next runtime readiness");
}

async function stopSelfOwnedNextRuntime(server) {
  let fallbackCount = 0;

  if (server.exitCode === null && server.signalCode === null) {
    server.kill();
  }

  await Promise.race([
    onceChildEvent(server, "close"),
    wait(DIRECT_RUNTIME_EXIT_TIMEOUT_MS),
  ]);

  if (
    server.exitCode === null &&
    server.signalCode === null &&
    process.platform === "win32"
  ) {
    fallbackCount += 1;
    await execFileAsync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      timeout: 10000,
      windowsHide: true,
    }).catch(() => undefined);
    await Promise.race([
      onceChildEvent(server, "close"),
      wait(DIRECT_RUNTIME_EXIT_TIMEOUT_MS),
    ]);
  }

  await waitForSelfOwnedPortRelease();
  pass("RECON_RUNTIME_NEXT_CLEANUP");

  return fallbackCount;
}

async function waitForSelfOwnedPortRelease() {
  const deadline = Date.now() + DIRECT_RUNTIME_PORT_RELEASE_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    if ((await readPortListenerCount(3000)) === 0) {
      return;
    }

    await wait(250);
  }

  throw new Error("FAIL Reconciliation runtime port cleanup");
}

async function assertPublicSmoke() {
  await assertHttpStatus(`${APP_ORIGIN}/api/v1/health`, 200, "health smoke");
  await assertHttpStatus(
    `${APP_ORIGIN}/api/v1/readiness/config`,
    200,
    "readiness smoke",
  );
  pass("RECON_RUNTIME_PUBLIC_SMOKE");
}

async function createRuntimeReconciliationFixture({
  adminUserId,
  runMarker,
  safePrefix,
}) {
  const ids = {
    assetId: randomUUID(),
    providerId: randomUUID(),
    bindingId: randomUUID(),
    journalCommandId: randomUUID(),
  };
  const observerKind = "BALANCE_OBSERVER";
  const observationKey = `${safePrefix}.observation.0001`;
  const runKey = `${safePrefix}.run.0001`;
  const assetCode = `P5RT_${safePrefix.slice(5, 17).toUpperCase()}`;
  const symbol = `P5R${safePrefix.slice(5, 9).toUpperCase()}`;
  const providerCode = `P5RT-${safePrefix.slice(5, 17).toUpperCase()}`;
  const bindingKey = `p5rt_${safePrefix.slice(5, 17)}_collection`;
  const cutoff = "2026-07-30 00:10:00+00";

  const raw = await sqlScalar(`
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
      ${sqlLiteral(ids.assetId)}::uuid,
      ${sqlLiteral(assetCode)},
      ${sqlLiteral(symbol)},
      'P5 Runtime Reconciliation Asset',
      'NATIVE',
      9,
      null,
      'ACTIVE'
    );

    insert into private.custody_providers (
      id,
      provider_code,
      display_name,
      provider_type,
      supports_balance_observation
    )
    values (
      ${sqlLiteral(ids.providerId)}::uuid,
      ${sqlLiteral(providerCode)},
      'P5 Runtime Provider',
      'MPC_CUSTODIAN',
      true
    );

    update private.custody_providers
    set
      status = 'APPROVED',
      approved_at = now(),
      version = version + 1
    where id = ${sqlLiteral(ids.providerId)}::uuid;

    insert into private.custody_account_bindings (
      id,
      custody_provider_id,
      asset_id,
      binding_key,
      display_label,
      account_role
    )
    values (
      ${sqlLiteral(ids.bindingId)}::uuid,
      ${sqlLiteral(ids.providerId)}::uuid,
      ${sqlLiteral(ids.assetId)}::uuid,
      ${sqlLiteral(bindingKey)},
      'P5 Runtime Collection',
      'COLLECTION'
    );

    update private.custody_account_bindings
    set
      status = 'APPROVED',
      approved_at = now(),
      version = version + 1
    where id = ${sqlLiteral(ids.bindingId)}::uuid;

    create temporary table p5rt_system_accounts as
    select *
    from private.ensure_system_ledger_accounts(${sqlLiteral(ids.assetId)}::uuid);

    create temporary table p5rt_post as
    select *
    from private.post_ledger_journal(
      ${sqlLiteral(ids.journalCommandId)}::uuid,
      ${sqlLiteral(ids.assetId)}::uuid,
      'P5_RUNTIME_EXPECTED',
      'SYSTEM',
      null,
      null,
      null,
      'p5 runtime reconciliation expected fixture',
      jsonb_build_array(
        jsonb_build_object(
          'account_id',
          (
            select ledger_account_id::text
            from p5rt_system_accounts
            where account_purpose = 'SYSTEM_CUSTODY'
          ),
          'side',
          'DEBIT',
          'units',
          '100'
        ),
        jsonb_build_object(
          'account_id',
          (
            select ledger_account_id::text
            from p5rt_system_accounts
            where account_purpose = 'SYSTEM_TOKEN_ISSUANCE'
          ),
          'side',
          'CREDIT',
          'units',
          '100'
        )
      )
    );

    create temporary table p5rt_observation as
    select *
    from private.record_external_balance_observation(
      ${sqlLiteral(ids.bindingId)}::uuid,
      ${sqlLiteral(observerKind)},
      ${sqlLiteral(observationKey)},
      108,
      '2026-07-30 00:00:00+00'::timestamptz,
      ${sqlLiteral(`${safePrefix}.checkpoint.0001`)}
    );

    create temporary table p5rt_run as
    select *
    from private.create_asset_reconciliation_run(
      ${sqlLiteral(runKey)},
      ${sqlLiteral(ids.assetId)}::uuid,
      ${sqlLiteral(observerKind)},
      ${sqlLiteral(cutoff)}::timestamptz,
      5,
      'MANUAL',
      ${sqlLiteral(adminUserId)}::uuid
    );

    select
      (select external_balance_observation_id::text from p5rt_observation) || '|' ||
      (select reconciliation_run_id::text from p5rt_run) || '|' ||
      (select reconciliation_item_id::text from p5rt_run) || '|' ||
      (select item_classification from p5rt_run) || '|' ||
      (select expected_atomic_units::text from p5rt_run) || '|' ||
      (select observed_atomic_units::text from p5rt_run) || '|' ||
      (select difference_atomic_units::text from p5rt_run) || '|' ||
      (select target_binding_count::text from p5rt_run) || '|' ||
      (select observed_binding_count::text from p5rt_run) || '|' ||
      (select missing_binding_count::text from p5rt_run);
  `);
  const [
    observationId,
    runId,
    itemId,
    classification,
    expected,
    observed,
    difference,
    targetBindings,
    observedBindings,
    missingBindings,
  ] = raw.split("|");

  assert(isUuid(observationId), "Runtime observation id");
  assert(isUuid(runId), "Runtime run id");
  assert(isUuid(itemId), "Runtime item id");
  assert(classification === "MISMATCH", "Runtime item mismatch");
  assert(expected === "100", "Runtime expected units");
  assert(observed === "108", "Runtime observed units");
  assert(difference === "8", "Runtime difference units");
  assert(targetBindings === "1", "Runtime target binding count");
  assert(observedBindings === "1", "Runtime observed binding count");
  assert(missingBindings === "0", "Runtime missing binding count");
  console.log(`RECON_RUNTIME_FIXTURE_MARKER=${runMarker}`);
  pass("RECON_RUNTIME_FIXTURE_SETUP");

  return {
    ...ids,
    observationId,
    runId,
    itemId,
    observerKind,
    runKey,
  };
}

async function assertUnauthenticatedDenied(fixture) {
  const before = await readReviewCounts(fixture.itemId);
  const open = await postOpen(undefined, {
    reconciliationItemId: fixture.itemId,
    idempotencyKey: "p5rt.unauth.open.0001",
    reasonCode: "RUNTIME_OPEN",
  });
  await assertJsonError(open, 401, "admin_authentication_required");

  const transition = await postTransition(undefined, {
    reviewCaseId: randomUUID(),
    expectedVersion: 1,
    targetStatus: "IN_REVIEW",
    idempotencyKey: "p5rt.unauth.transition.0001",
    reasonCode: "RUNTIME_STARTED",
  });
  await assertJsonError(transition, 401, "admin_authentication_required");
  const after = await readReviewCounts(fixture.itemId);

  assertSameReviewCounts(before, after, "Unauthenticated mutation");
  console.log("RUNTIME_HTTP_UNAUTHENTICATED=PASS");
}

async function assertUserAal2Denied(jar, fixture) {
  const before = await readReviewCounts(fixture.itemId);
  const open = await postOpen(jar, {
    reconciliationItemId: fixture.itemId,
    idempotencyKey: "p5rt.user.open.0001",
    reasonCode: "RUNTIME_OPEN",
  });
  await assertJsonError(open, 403, "admin_role_required");

  const transition = await postTransition(jar, {
    reviewCaseId: randomUUID(),
    expectedVersion: 1,
    targetStatus: "IN_REVIEW",
    idempotencyKey: "p5rt.user.transition.0001",
    reasonCode: "RUNTIME_STARTED",
  });
  await assertJsonError(transition, 403, "admin_role_required");
  const after = await readReviewCounts(fixture.itemId);

  assertSameReviewCounts(before, after, "USER AAL2 mutation");
  console.log("RUNTIME_HTTP_USER_AAL2_DENIED=PASS");
}

async function assertAdminAal1Denied(jar, fixture) {
  const before = await readReviewCounts(fixture.itemId);
  const open = await postOpen(jar, {
    reconciliationItemId: fixture.itemId,
    idempotencyKey: "p5rt.adminaal1.open.0001",
    reasonCode: "RUNTIME_OPEN",
  });
  await assertJsonError(open, 403, "admin_aal2_required");

  const transition = await postTransition(jar, {
    reviewCaseId: randomUUID(),
    expectedVersion: 1,
    targetStatus: "IN_REVIEW",
    idempotencyKey: "p5rt.adminaal1.transition.0001",
    reasonCode: "RUNTIME_STARTED",
  });
  await assertJsonError(transition, 403, "admin_aal2_required");
  const after = await readReviewCounts(fixture.itemId);

  assertSameReviewCounts(before, after, "ADMIN AAL1 mutation");
  console.log("RUNTIME_HTTP_ADMIN_AAL1_DENIED=PASS");
}

async function assertAdminAal2ReviewLifecycle({
  adminJar,
  adminUserId,
  fixture,
  beforeSideEffects,
  safePrefix,
}) {
  const beforeOpen = await readReviewCounts(fixture.itemId);
  const openPayload = {
    reconciliationItemId: fixture.itemId,
    idempotencyKey: `${safePrefix}.open.admin.0001`,
    reasonCode: "RUNTIME_OPEN",
  };
  const open = await postOpen(adminJar, openPayload);
  const openResult = await assertJsonSuccess(open, {
    created: true,
    status: "OPEN",
    version: 1,
  });
  const afterOpen = await readReviewCounts(fixture.itemId);

  assert(afterOpen.cases === beforeOpen.cases + 1, "Open case increment");
  assert(afterOpen.events === beforeOpen.events + 1, "Open event increment");
  console.log("RUNTIME_HTTP_ADMIN_AAL2_OPEN=PASS");

  await assertActorDerived({
    reviewCaseId: openResult.reviewCaseId,
    eventId: openResult.eventId,
    adminUserId,
  });

  const spoofBefore = await readReviewCounts(fixture.itemId);
  const spoof = await postOpen(adminJar, {
    reconciliationItemId: fixture.itemId,
    idempotencyKey: `${safePrefix}.open.spoof.0001`,
    reasonCode: "RUNTIME_OPEN",
    actorProfileId: randomUUID(),
  });
  await assertJsonError(spoof, 400, "invalid_request");
  const spoofAfter = await readReviewCounts(fixture.itemId);

  assertSameReviewCounts(spoofBefore, spoofAfter, "Actor spoof mutation");
  console.log("RUNTIME_HTTP_ACTOR_SPOOF_BLOCKED=PASS");

  const replay = await postOpen(adminJar, openPayload);
  const replayResult = await assertJsonSuccess(replay, {
    created: false,
    status: "OPEN",
    version: 1,
  });
  assert(
    replayResult.reviewCaseId === openResult.reviewCaseId &&
      replayResult.eventId === openResult.eventId,
    "Open replay identity",
  );
  assertSameReviewCounts(afterOpen, await readReviewCounts(fixture.itemId), "Open replay mutation");
  console.log("RUNTIME_HTTP_OPEN_REPLAY=PASS");

  const conflict = await postOpen(adminJar, {
    ...openPayload,
    reasonCode: "RUNTIME_OTHER",
  });
  await assertJsonError(
    conflict,
    409,
    "reconciliation_review_idempotency_conflict",
  );
  assertSameReviewCounts(afterOpen, await readReviewCounts(fixture.itemId), "Open conflict mutation");
  console.log("RUNTIME_HTTP_OPEN_CONFLICT=PASS");

  await assertTransitionValidation(adminJar, openResult.reviewCaseId, afterOpen);

  const transitionPayload = {
    reviewCaseId: openResult.reviewCaseId,
    expectedVersion: 1,
    targetStatus: "IN_REVIEW",
    idempotencyKey: `${safePrefix}.transition.inreview.0001`,
    reasonCode: "RUNTIME_STARTED",
  };
  const transition = await postTransition(adminJar, transitionPayload);
  const transitionResult = await assertJsonSuccess(transition, {
    created: true,
    status: "IN_REVIEW",
    version: 2,
  });
  await assertLatestEvent({
    eventId: transitionResult.eventId,
    adminUserId,
    fromStatus: "OPEN",
    toStatus: "IN_REVIEW",
    eventType: "REVIEW_STARTED",
    reasonCode: "RUNTIME_STARTED",
  });
  console.log("RUNTIME_HTTP_TRANSITION=PASS");

  const afterTransition = await readReviewCounts(fixture.itemId);
  assert(
    afterTransition.cases === afterOpen.cases &&
      afterTransition.events === afterOpen.events + 1,
    "Transition event increment",
  );

  const transitionReplay = await postTransition(adminJar, transitionPayload);
  const transitionReplayResult = await assertJsonSuccess(transitionReplay, {
    created: false,
    status: "IN_REVIEW",
    version: 2,
  });
  assert(
    transitionReplayResult.reviewCaseId === transitionResult.reviewCaseId &&
      transitionReplayResult.eventId === transitionResult.eventId,
    "Transition replay identity",
  );
  assertSameReviewCounts(
    afterTransition,
    await readReviewCounts(fixture.itemId),
    "Transition replay mutation",
  );
  console.log("RUNTIME_HTTP_TRANSITION_REPLAY=PASS");

  await assertVersionConflictTransportBoundary({
    adminUserId,
    reviewCaseId: openResult.reviewCaseId,
    safePrefix,
    unchangedCounts: afterTransition,
  });

  console.log("RECON_RUNTIME_STAGE=VERSION_CONFLICT");
  const versionConflict = await postTransition(adminJar, {
    reviewCaseId: openResult.reviewCaseId,
    expectedVersion: 1,
    targetStatus: "RESOLVED",
    idempotencyKey: `${safePrefix}.transition.version.0001`,
    reasonCode: "RUNTIME_VERSION",
  });
  await assertJsonError(
    versionConflict,
    409,
    "reconciliation_review_version_conflict",
  );
  assertSameReviewCounts(
    afterTransition,
    await readReviewCounts(fixture.itemId),
    "Version conflict mutation",
  );
  console.log("RUNTIME_HTTP_VERSION_CONFLICT=PASS");

  const resolved = await postTransition(adminJar, {
    reviewCaseId: openResult.reviewCaseId,
    expectedVersion: 2,
    targetStatus: "RESOLVED",
    idempotencyKey: `${safePrefix}.transition.resolved.0001`,
    reasonCode: "RUNTIME_RESOLVED",
  });
  const resolvedResult = await assertJsonSuccess(resolved, {
    created: true,
    status: "RESOLVED",
    version: 3,
  });
  assert(isUuid(resolvedResult.eventId), "Resolved event id");
  await assertTerminalTimestamp(openResult.reviewCaseId);
  const afterResolved = await readReviewCounts(fixture.itemId);

  const terminal = await postTransition(adminJar, {
    reviewCaseId: openResult.reviewCaseId,
    expectedVersion: 3,
    targetStatus: "IGNORED",
    idempotencyKey: `${safePrefix}.transition.terminal.0001`,
    reasonCode: "RUNTIME_TERMINAL",
  });
  await assertJsonError(terminal, 409, "reconciliation_review_terminal");
  assertSameReviewCounts(
    afterResolved,
    await readReviewCounts(fixture.itemId),
    "Terminal mutation",
  );
  console.log("RUNTIME_HTTP_TERMINAL_PROTECTION=PASS");

  await assertSourceRowsUnchanged(fixture, beforeSideEffects);
}

async function assertVersionConflictTransportBoundary({
  adminUserId,
  reviewCaseId,
  safePrefix,
  unchangedCounts,
}) {
  const privateResult = await readPrivateVersionConflictDiagnostic({
    adminUserId,
    reviewCaseId,
    safePrefix,
  });

  console.log(
    `PRIVATE_VERSION_CONFLICT_DURATION_MS=${privateResult.durationMs}`,
  );
  console.log("PRIVATE_VERSION_CONFLICT_RESULT=IMMEDIATE_DOMAIN_ERROR");
  console.log(`PRIVATE_VERSION_CONFLICT_SQLSTATE=${privateResult.sqlstate}`);
  console.log(`PRIVATE_VERSION_CONFLICT_MESSAGE=${privateResult.message}`);

  assert(privateResult.sqlstate === "40001", "Private version SQLSTATE");
  assert(
    privateResult.message === "reconciliation_resolution_version_conflict",
    "Private version message",
  );

  const publicRpcResult = await readPublicRpcVersionConflictDiagnostic({
    adminUserId,
    reviewCaseId,
    safePrefix,
  });

  console.log(
    `PUBLIC_RPC_VERSION_CONFLICT_DURATION_MS=${publicRpcResult.durationMs}`,
  );
  console.log(
    `PUBLIC_RPC_VERSION_CONFLICT_HTTP_STATUS=${publicRpcResult.status}`,
  );
  console.log(
    `PUBLIC_RPC_VERSION_CONFLICT_ERROR_CODE=${publicRpcResult.errorCode}`,
  );
  console.log(
    `PUBLIC_RPC_VERSION_CONFLICT_MESSAGE_CLASS=${publicRpcResult.messageClass}`,
  );

  assert(publicRpcResult.status === 409, "Public RPC version status");
  assert(publicRpcResult.errorCode === "PT409", "Public RPC transport code");
  assert(
    publicRpcResult.messageClass === "canonical_version_conflict",
    "Public RPC version message",
  );

  const lockSummary = await readVersionConflictLockSummary();

  console.log(
    `VERSION_CONFLICT_BLOCKED_SESSION_COUNT=${lockSummary.blocked}`,
  );
  console.log(
    `VERSION_CONFLICT_BLOCKING_SESSION_COUNT=${lockSummary.blocking}`,
  );
  console.log(`VERSION_CONFLICT_WAIT_CLASS=${lockSummary.waitClass}`);
  console.log(`OPEN_TRANSACTION_RESIDUE=${lockSummary.openTransactions}`);
  console.log("POSTGREST_REQUEST_COMPLETED=true");
  console.log("POSTGREST_ERROR_CLASS=transport_safe_domain_error");
  console.log("KONG_UPSTREAM_TIMEOUT=false");
  console.log("SQLSTATE_40001_TRANSPORT_HYPOTHESIS=CONFIRMED");

  assert(lockSummary.blocked === 0, "Version conflict blocked sessions");
  assert(lockSummary.blocking === 0, "Version conflict blocking sessions");
  assert(
    lockSummary.openTransactions === 0,
    "Version conflict transaction residue",
  );
  assertSameReviewCounts(
    unchangedCounts,
    await readReviewCountsByCaseId(reviewCaseId),
    "Version conflict transport diagnostics",
  );
}

async function readPrivateVersionConflictDiagnostic({
  adminUserId,
  reviewCaseId,
  safePrefix,
}) {
  const started = performance.now();
  const raw = await sqlScalar(`
    create temporary table p5rt_version_conflict_private_diag (
      result text
    ) on commit drop;

    do $$
    begin
      begin
        perform *
        from private.transition_reconciliation_resolution(
          ${sqlLiteral(reviewCaseId)}::uuid,
          1,
          'RESOLVED',
          ${sqlLiteral(`${safePrefix}.diag.private.version.0001`)},
          ${sqlLiteral(adminUserId)}::uuid,
          'RUNTIME_VERSION'
        );

        insert into p5rt_version_conflict_private_diag
        values ('unexpected_success|none');
      exception
        when others then
          insert into p5rt_version_conflict_private_diag
          values (SQLSTATE || '|' || SQLERRM);
      end;
    end;
    $$;

    select result from p5rt_version_conflict_private_diag;
  `);
  const durationMs = Math.round(performance.now() - started);
  const [sqlstate, message] = raw.split("|");

  return { durationMs, sqlstate, message };
}

async function readPublicRpcVersionConflictDiagnostic({
  adminUserId,
  reviewCaseId,
  safePrefix,
}) {
  const started = performance.now();
  const raw = await sqlScalar(`
    create temporary table p5rt_version_conflict_public_diag (
      result text
    ) on commit drop;

    select set_config(
      'request.jwt.claim.sub',
      ${sqlLiteral(adminUserId)},
      false
    );

    select set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub',
        ${sqlLiteral(adminUserId)},
        'aal',
        'aal2'
      )::text,
      false
    );

    select set_config('request.method', 'POST', false);

    do $$
    begin
      begin
        perform *
        from public.admin_transition_review_case(
          ${sqlLiteral(reviewCaseId)}::uuid,
          1::bigint,
          'RESOLVED'::text,
          ${sqlLiteral(`${safePrefix}.diag.public.version.0001`)}::text,
          'RUNTIME_VERSION'::text
        );

        insert into p5rt_version_conflict_public_diag
        values ('200|unexpected_success|other');
      exception
        when others then
          insert into p5rt_version_conflict_public_diag
          values (
            case SQLSTATE
              when 'PT409' then '409'
              else '500'
            end || '|' ||
            SQLSTATE || '|' ||
            case SQLERRM
              when 'reconciliation_resolution_version_conflict'
                then 'canonical_version_conflict'
              else 'other'
            end
          );
      end;
    end;
    $$;

    select result from p5rt_version_conflict_public_diag;
  `);
  const durationMs = Math.round(performance.now() - started);
  const [status, errorCode, messageClass] = raw.split("|");

  return {
    durationMs,
    status: Number.parseInt(status, 10),
    errorCode,
    messageClass,
  };
}

async function readVersionConflictLockSummary() {
  const raw = await sqlScalar(`
    with activities as (
      select *
      from pg_catalog.pg_stat_activity
      where datname = pg_catalog.current_database()
        and pid <> pg_catalog.pg_backend_pid()
    ),
    lock_waits as (
      select count(*)::bigint as blocked
      from activities
      where wait_event_type = 'Lock'
    ),
    blockers as (
      select count(distinct blocking.pid)::bigint as blocking
      from pg_catalog.pg_locks as blocked
      join pg_catalog.pg_locks as blocking
        on blocking.locktype = blocked.locktype
        and blocking.database is not distinct from blocked.database
        and blocking.relation is not distinct from blocked.relation
        and blocking.page is not distinct from blocked.page
        and blocking.tuple is not distinct from blocked.tuple
        and blocking.virtualxid is not distinct from blocked.virtualxid
        and blocking.transactionid is not distinct from blocked.transactionid
        and blocking.classid is not distinct from blocked.classid
        and blocking.objid is not distinct from blocked.objid
        and blocking.objsubid is not distinct from blocked.objsubid
        and blocking.pid <> blocked.pid
      where not blocked.granted
        and blocking.granted
    ),
    open_transactions as (
      select count(*)::bigint as open_count
      from activities
      where xact_start is not null
        and state <> 'idle'
    )
    select
      (select blocked::text from lock_waits) || '|' ||
      (select blocking::text from blockers) || '|' ||
      coalesce(
        (
          select wait_event_type
          from activities
          where wait_event_type is not null
          order by wait_event_type
          limit 1
        ),
        'none'
      ) || '|' ||
      (select open_count::text from open_transactions);
  `);
  const [blocked, blocking, waitClass, openTransactions] = raw.split("|");

  return {
    blocked: Number.parseInt(blocked, 10),
    blocking: Number.parseInt(blocking, 10),
    waitClass,
    openTransactions: Number.parseInt(openTransactions, 10),
  };
}

async function assertActorDerived({ reviewCaseId, eventId, adminUserId }) {
  const raw = await sqlScalar(`
    select
      (
        cases.opened_by_profile_id = ${sqlLiteral(adminUserId)}::uuid
        and cases.last_actor_profile_id = ${sqlLiteral(adminUserId)}::uuid
        and events.actor_profile_id = ${sqlLiteral(adminUserId)}::uuid
        and events.id = ${sqlLiteral(eventId)}::uuid
        and events.event_type = 'OPENED'
        and events.to_status = 'OPEN'
      )::text
    from private.reconciliation_review_cases as cases
    join private.reconciliation_review_case_events as events
      on events.reconciliation_resolution_id = cases.id
    where cases.id = ${sqlLiteral(reviewCaseId)}::uuid;
  `);

  assert(raw === "true", "Actor derivation");
  console.log("RUNTIME_HTTP_ACTOR_DERIVATION=PASS");
}

async function assertLatestEvent({
  eventId,
  adminUserId,
  fromStatus,
  toStatus,
  eventType,
  reasonCode,
}) {
  const raw = await sqlScalar(`
    select (
      events.id = ${sqlLiteral(eventId)}::uuid
      and events.actor_profile_id = ${sqlLiteral(adminUserId)}::uuid
      and events.from_status is not distinct from ${sqlLiteral(fromStatus)}
      and events.to_status = ${sqlLiteral(toStatus)}
      and events.event_type = ${sqlLiteral(eventType)}
      and events.reason_code = ${sqlLiteral(reasonCode)}
    )::text
    from private.reconciliation_review_case_events as events
    where events.id = ${sqlLiteral(eventId)}::uuid;
  `);

  assert(raw === "true", "Transition event actor");
}

async function assertTransitionValidation(jar, reviewCaseId, unchangedCounts) {
  const invalidCases = [
    {
      reviewCaseId,
      expectedVersion: 1,
      targetStatus: "OPEN",
      idempotencyKey: "p5rt.validation.open.0001",
      reasonCode: "RUNTIME_BAD_OPEN",
    },
    {
      reviewCaseId,
      expectedVersion: 0,
      targetStatus: "IN_REVIEW",
      idempotencyKey: "p5rt.validation.version0.0001",
      reasonCode: "RUNTIME_BAD_VERSION",
    },
    {
      reviewCaseId,
      expectedVersion: 1.5,
      targetStatus: "IN_REVIEW",
      idempotencyKey: "p5rt.validation.fraction.0001",
      reasonCode: "RUNTIME_BAD_VERSION",
    },
    {
      reviewCaseId,
      expectedVersion: 1,
      targetStatus: "IN_REVIEW",
      idempotencyKey: "p5rt.validation.actor.0001",
      reasonCode: "RUNTIME_BAD_ACTOR",
      userId: randomUUID(),
    },
    {
      reviewCaseId: "not-a-uuid",
      expectedVersion: 1,
      targetStatus: "IN_REVIEW",
      idempotencyKey: "p5rt.validation.uuid.0001",
      reasonCode: "RUNTIME_BAD_UUID",
    },
    {
      reviewCaseId,
      expectedVersion: 1,
      targetStatus: "IN_REVIEW",
      idempotencyKey: "p5rt.validation.reason.0001",
      reasonCode: "bad-reason",
    },
  ];

  for (const body of invalidCases) {
    const response = await postTransition(jar, body);

    await assertJsonError(response, 400, "invalid_request");
    assertSameReviewCounts(
      unchangedCounts,
      await readReviewCountsByCaseId(reviewCaseId),
      "Transition validation mutation",
    );
  }

  console.log("RUNTIME_HTTP_TRANSITION_VALIDATION=PASS");
}

async function assertSourceRowsUnchanged(fixture, beforeSideEffects) {
  const after = await readSideEffectSnapshot(fixture.itemId);

  assert(
    beforeSideEffects.sourceDigest === after.sourceDigest,
    "Source row digest unchanged",
  );
  assert(
    beforeSideEffects.balanceObservations === after.balanceObservations,
    "Balance observations unchanged",
  );
  assert(
    beforeSideEffects.transactionObservations === after.transactionObservations,
    "Transaction observations unchanged",
  );
  assert(
    beforeSideEffects.observerCheckpoints === after.observerCheckpoints,
    "Observer checkpoints unchanged",
  );
  assert(beforeSideEffects.ledgerAccounts === after.ledgerAccounts, "Ledger accounts unchanged");
  assert(beforeSideEffects.ledgerJournals === after.ledgerJournals, "Ledger journals unchanged");
  assert(beforeSideEffects.ledgerEntries === after.ledgerEntries, "Ledger entries unchanged");
  console.log("RUNTIME_HTTP_SIDE_EFFECT_BOUNDARY=PASS");
  console.log("RUNTIME_SAFE_RESPONSE=PASS");
}

async function assertLowLevelPrivatePrivilegeBlocked() {
  const raw = await sqlScalar(`
    select
      (
        not has_function_privilege(
          'authenticated',
          'private.open_reconciliation_resolution(uuid,text,uuid,text)',
          'execute'
        )
        and not has_function_privilege(
          'authenticated',
          'private.transition_reconciliation_resolution(uuid,bigint,text,text,uuid,text)',
          'execute'
        )
      )::text;
  `);

  assert(raw === "true", "Private review functions not granted");
  console.log("RUNTIME_LOW_LEVEL_PRIVILEGE_BLOCKED=PASS");
}

async function postOpen(jar, body) {
  return appJsonFetch("/api/v1/admin/reconciliation/reviews/open", {
    jar,
    body,
  });
}

async function postTransition(jar, body) {
  return appJsonFetch("/api/v1/admin/reconciliation/reviews/transition", {
    jar,
    body,
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

  if (body) {
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

  const response = await localFetch(requestUrl, {
    method,
    headers,
    body: body ? new URLSearchParams(body) : undefined,
    redirect,
  });

  if (jar) {
    jar.store(response, requestUrl);
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
  const requestUrl = new URL(path, APP_ORIGIN);
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
    const cookieHeader = jar.getHeader(requestUrl);

    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
  }

  const response = await localFetch(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    redirect,
  });

  if (jar) {
    jar.store(response, requestUrl);
  }

  return response;
}

async function assertJsonSuccess(response, expectation) {
  const payload = await readJsonResponse(response);

  assert(response.status === 200, `JSON success status ${response.status}`);
  assert(payload?.ok === true, "JSON success ok");
  assertOnlyKeys(payload, ["ok", "result"], "Success response");
  assertOnlyKeys(
    payload.result,
    ["reviewCaseId", "eventId", "created", "status", "version"],
    "Success result",
  );
  assert(isUuid(payload.result.reviewCaseId), "Success review case id");
  assert(isUuid(payload.result.eventId), "Success event id");
  assert(payload.result.created === expectation.created, "Success created");
  assert(payload.result.status === expectation.status, "Success status");
  assert(payload.result.version === expectation.version, "Success version");
  assertNoStore(response);
  assertSafeResponseBody(payload);

  return payload.result;
}

async function assertJsonError(response, expectedStatus, expectedCode) {
  const payload = await readJsonResponse(response);
  const actualCode =
    typeof payload?.error?.code === "string" ? payload.error.code : "none";

  console.log(
    `RECON_RUNTIME_ERROR_STATUS=${response.status};CODE=${actualCode}`,
  );

  assert(response.status === expectedStatus, `JSON error status ${response.status}`);
  assert(payload?.ok === false, "JSON error ok");
  assertOnlyKeys(payload, ["ok", "error"], "Error response");
  assertOnlyKeys(payload.error, ["code"], "Error result");
  assert(payload.error.code === expectedCode, "JSON error code");
  assertNoStore(response);
  assertSafeResponseBody(payload);
}

async function readJsonResponse(response) {
  const text = await response.text();

  assertOutputSafe(text, "Reconciliation route response");
  assert(!containsForbiddenResponseMarker(text), "Reconciliation safe response");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("FAIL Reconciliation response JSON");
  }
}

function assertNoStore(response) {
  const cacheControl = response.headers.get("cache-control") ?? "";

  assert(cacheControl.toLowerCase().includes("no-store"), "Route no-store");
}

function assertSafeResponseBody(payload) {
  const text = JSON.stringify(payload);

  assert(!containsForbiddenResponseMarker(text), "Safe response denylist");
}

function containsForbiddenResponseMarker(value) {
  const normalized = String(value ?? "").toLowerCase();

  return SAFE_PUBLIC_RESPONSE_DENYLIST.some((marker) =>
    normalized.includes(marker),
  );
}

function assertOnlyKeys(value, expectedKeys, label) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} object`,
  );

  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();

  assert(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    `${label} keys`,
  );
}

async function readReviewCounts(itemId) {
  const raw = await sqlScalar(`
    select
      count(distinct cases.id)::text || '|' ||
      count(events.id)::text
    from private.reconciliation_review_cases as cases
    left join private.reconciliation_review_case_events as events
      on events.reconciliation_resolution_id = cases.id
    where cases.reconciliation_item_id = ${sqlLiteral(itemId)}::uuid;
  `);
  const [cases, events] = raw.split("|").map((value) =>
    Number.parseInt(value, 10),
  );

  return { cases, events };
}

async function readReviewCountsByCaseId(reviewCaseId) {
  const raw = await sqlScalar(`
    select
      count(distinct cases.id)::text || '|' ||
      count(events.id)::text
    from private.reconciliation_review_cases as cases
    left join private.reconciliation_review_case_events as events
      on events.reconciliation_resolution_id = cases.id
    where cases.id = ${sqlLiteral(reviewCaseId)}::uuid;
  `);
  const [cases, events] = raw.split("|").map((value) =>
    Number.parseInt(value, 10),
  );

  return { cases, events };
}

function assertSameReviewCounts(before, after, label) {
  assert(before.cases === after.cases, `${label} cases`);
  assert(before.events === after.events, `${label} events`);
}

async function readSideEffectSnapshot(itemId) {
  const raw = await sqlScalar(`
    with source_digest as (
      select
        runs.id::text || '|' ||
        runs.idempotency_key || '|' ||
        runs.trigger_source || '|' ||
        runs.status || '|' ||
        coalesce(runs.observer_kind, '') || '|' ||
        coalesce(runs.observation_cutoff_at::text, '') || '|' ||
        items.id::text || '|' ||
        items.scope_kind || '|' ||
        coalesce(items.custody_account_binding_id::text, '') || '|' ||
        coalesce(items.external_balance_observation_id::text, '') || '|' ||
        items.expected_units::text || '|' ||
        coalesce(items.observed_units::text, '') || '|' ||
        coalesce(items.difference_units::text, '') || '|' ||
        items.tolerance_units::text || '|' ||
        items.classification || '|' ||
        coalesce(string_agg(
          members.custody_account_binding_id::text || ':' ||
          coalesce(members.external_balance_observation_id::text, '') || ':' ||
          members.membership_status,
          ','
          order by members.custody_account_binding_id::text
        ), '')
          as digest
      from private.reconciliation_items as items
      join private.reconciliation_runs as runs
        on runs.id = items.reconciliation_run_id
      left join private.reconciliation_item_binding_observations as members
        on members.reconciliation_item_id = items.id
      where items.id = ${sqlLiteral(itemId)}::uuid
      group by runs.id, items.id
    )
    select
      (select digest from source_digest) || '||' ||
      (select count(*)::text from private.external_balance_observations) || '||' ||
      (select count(*)::text from private.external_transaction_observations) || '||' ||
      (select count(*)::text from private.observer_checkpoints) || '||' ||
      (select count(*)::text from private.ledger_accounts) || '||' ||
      (select count(*)::text from private.ledger_journals) || '||' ||
      (select count(*)::text from private.ledger_entries);
  `);
  const [
    sourceDigest,
    balanceObservations,
    transactionObservations,
    observerCheckpoints,
    ledgerAccounts,
    ledgerJournals,
    ledgerEntries,
  ] = raw.split("||");

  assert(Boolean(sourceDigest), "Source digest");

  return {
    sourceDigest,
    balanceObservations,
    transactionObservations,
    observerCheckpoints,
    ledgerAccounts,
    ledgerJournals,
    ledgerEntries,
  };
}

async function assertTerminalTimestamp(reviewCaseId) {
  const raw = await sqlScalar(`
    select (
      status = 'RESOLVED'
      and version = 3
      and resolved_at is not null
    )::text
    from private.reconciliation_review_cases
    where id = ${sqlLiteral(reviewCaseId)}::uuid;
  `);

  assert(raw === "true", "Terminal timestamp");
}

async function enrollAndVerifyMfa(jar, userId, label) {
  const enrollment = await startEnrollment(jar, { userId, label });

  await verifyEnrollment(jar, enrollment);
  pass(`RECON_RUNTIME_${label}_AAL2_READY`);
}

async function startEnrollment(jar, { userId, label }) {
  await assertMfaEnrollmentPreflight(userId, jar, label);

  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
  });
  const payload = await response.json().catch(() => null);

  assert(response.status === 200, `${label} enrollment start status`);
  assert(payload?.status === "enrollment_started", `${label} enrollment started`);
  assert(isUuid(payload.factorId), `${label} enrollment factor id`);
  assert(
    typeof payload.qrCode === "string" &&
      payload.qrCode.startsWith("data:image/") &&
      payload.qrCode.length < 500000,
    `${label} enrollment QR data`,
  );
  assert(isBase32Secret(payload.secret), `${label} enrollment secret shape`);

  return {
    factorId: payload.factorId,
    secret: payload.secret,
  };
}

async function assertMfaEnrollmentPreflight(userId, jar, label) {
  assert(userId, `${label} MFA preflight current user`);

  const requestUrl = new URL("/auth/mfa/enroll", APP_ORIGIN);
  const beforeHasSession = jar.hasSessionCookie(requestUrl);
  const beforeFactors = await mfaFactorCountsByUserId(userId);
  const response = await appFetch("/auth/mfa/enroll", {
    jar,
    redirect: "manual",
  });
  const body = await response.text();
  const afterFactors = await mfaFactorCountsByUserId(userId);

  assert(beforeHasSession, `${label} MFA preflight session before`);
  assert(jar.hasSessionCookie(requestUrl), `${label} MFA preflight session after`);
  assert(response.status === 200, `${label} MFA preflight status`);
  assert(!body.includes("otpauth://"), `${label} MFA preflight no secret`);
  assert(beforeFactors.total === afterFactors.total, `${label} MFA preflight no factor mutation`);
  assert(beforeFactors.verified === afterFactors.verified, `${label} MFA preflight no verification`);
  assert(beforeFactors.unverified === afterFactors.unverified, `${label} MFA preflight no unverified factor`);
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

  assert(response.status === 200, "Enrollment verify status");
  assert(payload?.status === "verified", "Enrollment verified");
}

async function signUpConfirmAndSignIn(email, password, nextPath, displayName) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: displayName,
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

async function pollMailpitLink(email, subject, expectedPath) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const payload = await (
      await localFetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
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
        await localFetch(`${MAILPIT_ORIGIN}/view/${encodeURIComponent(id)}.html`, {
          redirect: "manual",
        })
      ).text();
      const link = extractLinks(html).find((candidate) => {
        try {
          const url = new URL(candidate);

          return url.pathname === expectedPath;
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

async function readUserIdByEmail(email) {
  const rawUserId = await sqlScalar(`
    select users.id::text
    from auth.users as users
    where users.email = ${sqlLiteral(email)};
  `);

  assert(isUuid(rawUserId), "Auth user id");

  return rawUserId;
}

async function bootstrapAdminRole(
  userId,
  reason = "local reconciliation runtime bootstrap",
) {
  const count = await sqlScalar(`
    insert into public.user_roles (user_id, role, grant_reason)
    values (${sqlLiteral(userId)}::uuid, 'ADMIN', ${sqlLiteral(reason)})
    on conflict (user_id, role) where revoked_at is null do nothing;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === "1", "Bootstrap ADMIN role");
}

async function revokeTemporaryAdminRole(userId) {
  const count = await sqlScalar(`
    update public.user_roles
    set
      revoked_at = now(),
      revoke_reason = 'local reconciliation runtime temporary role revoked',
      version = version + 1
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === "0", "Temporary ADMIN role revoked");
}

async function assertActiveAdminRoleCount(userId, expected, label) {
  const count = await sqlScalar(`
    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === expected, label);
}

async function mfaFactorCountsByUserId(userId) {
  const result = await sqlScalar(`
    select
      count(*)::text || ',' ||
      count(*) filter (where factors.status = 'verified')::text || ',' ||
      count(*) filter (where factors.status = 'unverified')::text
    from auth.mfa_factors as factors
    where factors.user_id = ${sqlLiteral(userId)}::uuid
      and factors.factor_type = 'totp';
  `);
  const [total, verified, unverified] = result.split(",");

  return { total, verified, unverified };
}

async function readLocalSupabaseStatus() {
  const command = getNpmCommand("supabase:status", ["--", "-o", "json"]);
  const { stdout, stderr } = await execFileAsync(command.file, command.args, {
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const raw = `${stdout}\n${stderr}`;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  assert(start >= 0 && end > start, "Local Supabase status JSON");

  const status = JSON.parse(raw.slice(start, end + 1));

  assert(Boolean(status.API_URL), "Local Supabase URL");
  assert(Boolean(status.ANON_KEY), "Local Supabase key");

  return status;
}

async function runNpmScriptSensitive(scriptName, label, timeoutMs) {
  const command = getNpmCommand(scriptName);

  try {
    await execFileAsync(command.file, command.args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 12,
    });
    pass(label);
  } catch {
    throw new Error(`FAIL ${label}`);
  }
}

function getNpmCommand(scriptName, extraArgs = []) {
  if (process.env.npm_execpath) {
    return {
      file: process.execPath,
      args: [process.env.npm_execpath, "--silent", "run", scriptName, ...extraArgs],
    };
  }

  if (process.platform === "win32") {
    return {
      file: "cmd.exe",
      args: ["/c", "npm", "--silent", "run", scriptName, ...extraArgs],
    };
  }

  return {
    file: "npm",
    args: ["--silent", "run", scriptName, ...extraArgs],
  };
}

async function assertHttpStatus(url, expectedStatus, label) {
  const response = await readLocalHttpStatus(url, {
    timeoutMs: 2000,
    readBody: true,
    label,
  });

  assert(response.status === expectedStatus, label);
}

async function readProjectContainerCount() {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "ps",
      "--format",
      "{{.Label \"com.supabase.cli.project\"}}\t{{.Label \"com.docker.compose.project\"}}",
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
    .filter((line) => {
      const [supabaseProject, composeProject] = line.split("\t");

      return supabaseProject === PROJECT_LABEL || composeProject === PROJECT_LABEL;
    }).length;
}

async function readPortListenerCount(port) {
  if (process.platform !== "win32") {
    return 0;
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$connections = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; @($connections).Count`,
    ],
    {
      timeout: 10000,
      windowsHide: true,
    },
  );
  const count = Number.parseInt(stdout.trim(), 10);

  return Number.isInteger(count) ? count : 0;
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
        maxBuffer: 1024 * 1024,
      },
    );

    return stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  } catch {
    throw new Error("FAIL Reconciliation runtime SQL");
  }
}

function assertRedirectPath(response, expectedPath, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const location = response.headers.get("location");
  const actual = location ? new URL(location, APP_ORIGIN) : null;

  assert(Boolean(location), `${label} location`);
  assert(
    actual?.pathname === expectedPath,
    `${label} path ${formatSafeRedirect(actual)}`,
  );
}

function formatSafeRedirect(url) {
  if (!url) {
    return "missing";
  }

  const code =
    url.searchParams.get("error") ??
    url.searchParams.get("code") ??
    url.searchParams.get("grant") ??
    url.searchParams.get("revoke");

  return code ? `${url.pathname}?result=${code}` : url.pathname;
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
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isBase32Secret(value) {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 128 &&
    /^[A-Z2-7]+=*$/i.test(value)
  );
}

function onceChildEvent(child, event) {
  return new Promise((resolve) => {
    child.once(event, resolve);
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
    console.error(`RECON_RUNTIME_FAILURE_CLASS=${classifyFailureMessage(message)}`);
    console.error("FAIL reconciliation review runtime closeout");
  }

  process.exitCode = 1;
});

function classifyFailureMessage(message) {
  if (message.includes("relation") && message.includes("does not exist")) {
    return "sql_relation_missing";
  }

  if (message.includes("syntax error")) {
    return "sql_syntax";
  }

  if (message.includes("permission denied")) {
    return "sql_permission";
  }

  if (message.includes("is not defined")) {
    return "javascript_reference";
  }

  return "unclassified";
}
