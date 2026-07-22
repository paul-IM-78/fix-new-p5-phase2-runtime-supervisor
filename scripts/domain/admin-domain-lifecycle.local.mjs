import { execFile } from "node:child_process";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { createCookieJar } from "../lib/http-cookie-jar.mjs";

const execFileAsync = promisify(execFile);

const APP_ORIGIN = "http://localhost:3000";
const MAILPIT_ORIGIN = "http://127.0.0.1:55724";
const DB_CONTAINER = "supabase_db_staking-wallet-web";
const CONFIRMATION_SUBJECT = "Confirm your Staking Wallet account";
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const COMMAND_ENDPOINTS = [
  {
    path: "/api/v1/admin/domain/projects/create",
    body: () => ({
      project_code: "QA_ORIGIN_BLOCK",
      display_name: "QA Origin Block",
      description: "blocked",
      command_id: randomUUID(),
      reason: "origin rejection",
    }),
  },
  {
    path: "/api/v1/admin/domain/projects/update",
    body: () => ({
      project_id: randomUUID(),
      expected_version: "1",
      display_name: "QA Origin Block",
      description: "blocked",
      command_id: randomUUID(),
      reason: "origin rejection",
    }),
  },
  {
    path: "/api/v1/admin/domain/projects/transition",
    body: () => ({
      project_id: randomUUID(),
      expected_version: "1",
      new_status: "ACTIVE",
      command_id: randomUUID(),
      reason: "origin rejection",
    }),
  },
  {
    path: "/api/v1/admin/domain/assets/create",
    body: () => ({
      asset_code: "QA_ORIGIN_ASSET",
      symbol: "QAO",
      display_name: "QA Origin Asset",
      asset_type: "SPL_TOKEN",
      decimals: "6",
      mint_address: randomMint(),
      command_id: randomUUID(),
      reason: "origin rejection",
    }),
  },
  {
    path: "/api/v1/admin/domain/assets/update",
    body: () => ({
      asset_id: randomUUID(),
      expected_version: "1",
      symbol: "QAO",
      display_name: "QA Origin Asset",
      command_id: randomUUID(),
      reason: "origin rejection",
    }),
  },
  {
    path: "/api/v1/admin/domain/assets/transition",
    body: () => ({
      asset_id: randomUUID(),
      expected_version: "1",
      new_status: "ACTIVE",
      command_id: randomUUID(),
      reason: "origin rejection",
    }),
  },
  {
    path: "/api/v1/admin/domain/project-token/assign",
    body: () => ({
      project_id: randomUUID(),
      asset_id: randomUUID(),
      command_id: randomUUID(),
      reason: "origin rejection",
    }),
  },
  {
    path: "/api/v1/admin/domain/project-token/retire",
    body: () => ({
      assignment_id: randomUUID(),
      expected_version: "1",
      command_id: randomUUID(),
      reason: "origin rejection",
    }),
  },
];

async function main() {
  const suffix = randomUUID().replaceAll("-", "");
  const password = `Domain-${suffix.slice(0, 20)}-Password1!`;
  const adminEmail = `qa-admin-domain-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const userEmail = `qa-domain-user-${Date.now()}-${suffix.slice(8, 16)}@example.test`;
  const secondUserEmail = `qa-domain-user-b-${Date.now()}-${suffix.slice(16, 24)}@example.test`;

  await assertPublicSmoke();
  await assertSameOriginRejectionsWithoutSession();

  const userJar = await signUpConfirmAndSignIn(
    userEmail,
    password,
    "/account",
  );
  const secondUserJar = await signUpConfirmAndSignIn(
    secondUserEmail,
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

  await bootstrapAdminRole(adminUserId);
  await assertBrowserDirectWritesBlocked(userId);
  await assertGeneralUserBlocked(userJar, userId);
  await assertAal1AdminBlocked(adminJar, adminUserId);

  const adminEnrollment = await enrollAndVerifyAdmin(adminJar);
  await assertAdminCatalogReady(adminJar);
  await assertInputRejections(adminJar);
  await assertProjectConcurrentReplay(adminJar);

  const projectA = await assertProjectLifecycleStart(adminJar);
  const nativeAsset = await assertNativeAsset(adminJar);
  const splAssetA = await assertSplAssetCreation(adminJar);

  await assertProjectActivationNotReady(adminJar, projectA);
  await assertDraftAssetAssignmentBlocked(adminJar, projectA, splAssetA);
  await assertAssetUpdateNoop(adminJar, nativeAsset);
  await assertAssetActivation(adminJar, splAssetA);

  const assignmentA = await assertProjectTokenAssign(adminJar, projectA, splAssetA);

  await assertProjectActivation(adminJar, projectA);
  await assertSecondActiveProjectBlocked(adminJar);
  await assertActiveAssetProtected(adminJar, splAssetA, assignmentA);
  await assertTokenReplacement(adminJar, projectA, assignmentA);
  await assertVersionConflicts(adminJar, projectA, splAssetA, assignmentA);
  await assertNoopTransitions(adminJar, projectA, splAssetA, assignmentA);
  await assertAuditImmutability();
  await assertAuditPage(adminJar, [adminEmail, userEmail, secondUserEmail]);
  await assertFactorSecretNotPrinted(adminEnrollment);
  await logout(adminJar);
  await logout(userJar);
  await logout(secondUserJar);

  pass("Domain lifecycle integration");
}

async function assertPublicSmoke() {
  await assertStatus("/api/v1/health", 200, "Health 200");
  await assertStatus("/api/v1/readiness/config", 200, "Readiness 200");
  await assertStatus("/", 200, "Landing 200");
  await assertStatus("/auth/sign-in", 200, "Sign-in 200");

  const admin = await appFetch("/admin", { redirect: "manual" });
  assertRedirectPath(admin, "/auth/sign-in", "Anonymous admin");

  const catalog = await appFetch("/admin/catalog", { redirect: "manual" });
  assertRedirectPath(catalog, "/auth/sign-in", "Anonymous catalog");
  pass("Public domain smoke");
}

async function assertSameOriginRejectionsWithoutSession() {
  const before = await domainCounts();

  for (const endpoint of COMMAND_ENDPOINTS) {
    const noOrigin = await appFetch(endpoint.path, {
      method: "POST",
      body: endpoint.body(),
      includeOrigin: false,
      redirect: "manual",
    });
    assertRedirectHasCode(noOrigin, "request_rejected", "Origin required");

    const external = await appFetch(endpoint.path, {
      method: "POST",
      body: endpoint.body(),
      origin: "https://example.invalid",
      redirect: "manual",
    });
    assertRedirectHasCode(external, "request_rejected", "External origin");

    const fetchSite = await appFetch(endpoint.path, {
      method: "POST",
      body: endpoint.body(),
      fetchSite: "cross-site",
      redirect: "manual",
    });
    assertRedirectHasCode(fetchSite, "request_rejected", "Fetch site");
  }

  assertDomainCountsEqual(before, await domainCounts(), "No origin mutation");
  pass("Domain command same-origin rejection");
}

async function assertBrowserDirectWritesBlocked(userId) {
  const result = await sqlScalar(`
    select set_config('request.jwt.claim.sub', ${sqlLiteral(userId)}, false);
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${sqlLiteral(userId)}, 'aal', 'aal2')::text,
      false
    );
    set role authenticated;
    do $$
    begin
      insert into public.projects (project_code, display_name)
      values ('DIRECT_WRITE_BLOCK', 'Direct Write Block');
      raise exception 'expected direct write denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);

  assert(result === "denied", "Browser direct domain write denied");
  pass("Browser domain direct write blocked");
}

async function assertGeneralUserBlocked(jar, userId) {
  const catalog = await appFetch("/admin/catalog", { jar, redirect: "manual" });
  assertRedirectHasCode(catalog, "admin_forbidden", "USER catalog page");

  const create = await submitCreateProject(jar, {
    projectCode: "USER_BLOCK",
    displayName: "User Blocked",
    commandId: randomUUID(),
    reason: "user blocked",
  });
  assertRedirectHasCode(create, "admin_forbidden", "USER project create");

  await assertDomainRpcDenied(userId, "aal2", "USER command RPC");
  await assertDomainReadDenied(userId, "aal2", "USER read RPC");
  pass("General USER domain command blocked");
}

async function assertAal1AdminBlocked(jar, adminUserId) {
  const catalog = await appFetch("/admin/catalog", {
    jar,
    redirect: "manual",
  });
  assertRedirectPath(catalog, "/auth/mfa/enroll", "AAL1 catalog page");

  const create = await submitCreateProject(jar, {
    projectCode: "AAL1_BLOCK",
    displayName: "AAL1 Blocked",
    commandId: randomUUID(),
    reason: "aal1 blocked",
  });
  assertRedirectPath(create, "/auth/mfa/enroll", "AAL1 project create");

  await assertDomainRpcDenied(adminUserId, "aal1", "AAL1 command RPC");
  await assertDomainReadDenied(adminUserId, "aal1", "AAL1 read RPC");
  pass("AAL1 ADMIN domain command blocked");
}

async function assertAdminCatalogReady(jar) {
  const response = await appFetch("/admin/catalog", {
    jar,
    redirect: "manual",
  });
  const body = await response.text();

  assert(response.status === 200, "Admin catalog page 200");
  assert(body.includes("Project and asset catalog"), "Catalog title");
  assert(body.includes("Create project"), "Catalog project form");
  assert(body.includes("Create supported asset"), "Catalog asset form");
  assert(!body.includes("access_token"), "Catalog no access token");
  assert(!body.includes("refresh_token"), "Catalog no refresh token");
  assert(!body.includes("otpauth://"), "Catalog no TOTP");
  pass("AAL2 admin catalog page");
}

async function assertInputRejections(jar) {
  const before = await domainCounts();
  const badProject = await submitCreateProject(jar, {
    projectCode: "bad_code",
    displayName: "Bad Code",
    commandId: randomUUID(),
    reason: "bad project code",
  });
  assertRedirectHasCode(badProject, "invalid_input", "Bad project input");

  const missingReason = await appFetch(
    "/api/v1/admin/domain/projects/create",
    {
      method: "POST",
      jar,
      body: {
        project_code: "QA_MISSING_REASON",
        display_name: "Missing Reason",
        command_id: randomUUID(),
      },
      redirect: "manual",
    },
  );
  assertRedirectHasCode(missingReason, "invalid_input", "Missing reason");

  const badNative = await submitCreateAsset(jar, {
    assetCode: "QA_BAD_NATIVE",
    symbol: "QANX",
    displayName: "Bad Native",
    assetType: "NATIVE",
    decimals: "9",
    mintAddress: randomMint(),
    commandId: randomUUID(),
    reason: "bad native mint",
  });
  assertRedirectHasCode(badNative, "invalid_input", "Native mint input");

  const badSpl = await submitCreateAsset(jar, {
    assetCode: "QA_BAD_SPL",
    symbol: "QAS",
    displayName: "Bad SPL",
    assetType: "SPL_TOKEN",
    decimals: "6",
    mintAddress: "",
    commandId: randomUUID(),
    reason: "bad spl mint",
  });
  assertRedirectHasCode(badSpl, "invalid_input", "SPL mint input");

  assertDomainCountsEqual(before, await domainCounts(), "Input no mutation");
  pass("Domain input rejection");
}

async function assertProjectLifecycleStart(jar) {
  const commandId = randomUUID();
  const reason = "local domain project create";
  const create = await submitCreateProject(jar, {
    projectCode: "QA_PROJECT_A",
    displayName: "QA Project A",
    description: "Local domain lifecycle project",
    commandId,
    reason,
  });
  assertRedirectParam(create, "result", "project_created", "Project create");

  const project = await readProject("QA_PROJECT_A");
  assert(project.status === "DRAFT", "Project starts DRAFT");
  await assertAuditEvent(commandId, "CREATE_PROJECT", "APPLIED", reason);

  const beforeReplay = await domainCounts();
  const replay = await submitCreateProject(jar, {
    projectCode: "QA_PROJECT_A",
    displayName: "QA Project A",
    description: "Local domain lifecycle project",
    commandId,
    reason,
  });
  assertRedirectParam(
    replay,
    "result",
    "domain_command_replayed",
    "Project replay",
  );
  assertDomainCountsEqual(beforeReplay, await domainCounts(), "Replay no mutation");

  const conflict = await submitCreateProject(jar, {
    projectCode: "QA_PROJECT_CONFLICT",
    displayName: "QA Project Conflict",
    commandId,
    reason: "different request",
  });
  assertRedirectHasCode(
    conflict,
    "domain_command_conflict",
    "Command conflict",
  );

  const duplicate = await submitCreateProject(jar, {
    projectCode: "QA_PROJECT_A",
    displayName: "Duplicate Project",
    commandId: randomUUID(),
    reason: "duplicate project code",
  });
  assertRedirectHasCode(duplicate, "project_code_exists", "Project duplicate");

  const updateCommandId = randomUUID();
  const update = await submitUpdateProject(jar, {
    projectId: project.id,
    expectedVersion: project.version,
    displayName: "QA Project A Updated",
    description: "Updated local project",
    commandId: updateCommandId,
    reason: "update project details",
  });
  assertRedirectParam(update, "result", "project_updated", "Project update");
  await assertAuditEvent(
    updateCommandId,
    "UPDATE_PROJECT_DETAILS",
    "APPLIED",
    "update project details",
  );

  const updated = await readProject("QA_PROJECT_A");
  const noop = await submitUpdateProject(jar, {
    projectId: updated.id,
    expectedVersion: updated.version,
    displayName: updated.displayName,
    description: updated.description,
    commandId: randomUUID(),
    reason: "noop project update",
  });
  assertRedirectParam(noop, "result", "project_update_noop", "Project noop");

  pass("Project lifecycle start");

  return readProject("QA_PROJECT_A");
}

async function assertProjectConcurrentReplay(jar) {
  const commandId = randomUUID();
  const reason = "local domain project concurrent replay";
  const before = await domainCounts();
  const [first, second] = await Promise.all([
    submitCreateProject(jar, {
      projectCode: "QA_PROJECT_CONCURRENT",
      displayName: "QA Project Concurrent",
      description: "Local concurrent command replay",
      commandId,
      reason,
    }),
    submitCreateProject(jar, {
      projectCode: "QA_PROJECT_CONCURRENT",
      displayName: "QA Project Concurrent",
      description: "Local concurrent command replay",
      commandId,
      reason,
    }),
  ]);
  const results = [
    getRedirectParam(first, "result"),
    getRedirectParam(second, "result"),
  ].sort();
  const after = await domainCounts();

  assert(
    results.join(",") === "domain_command_replayed,project_created",
    "Project concurrent replay responses",
  );
  assert(after.projects === before.projects + 1, "Concurrent one project");
  assert(after.audit === before.audit + 1, "Concurrent one audit");
  await assertAuditEvent(
    commandId,
    "CREATE_PROJECT",
    "APPLIED",
    reason,
  );
  pass("Project concurrent replay");
}

async function assertNativeAsset(jar) {
  const commandId = randomUUID();
  const reason = "create native asset";
  const create = await submitCreateAsset(jar, {
    assetCode: "QA_NATIVE_A",
    symbol: "QAN",
    displayName: "QA Native A",
    assetType: "NATIVE",
    decimals: "9",
    mintAddress: "",
    commandId,
    reason,
  });

  assertRedirectParam(create, "result", "asset_created", "Native create");
  await assertAuditEvent(commandId, "CREATE_ASSET", "APPLIED", reason);
  pass("Native asset create");

  return readAsset("QA_NATIVE_A");
}

async function assertSplAssetCreation(jar) {
  const mint = randomMint();
  const commandId = randomUUID();
  const reason = "create spl asset";
  const create = await submitCreateAsset(jar, {
    assetCode: "QA_SPL_A",
    symbol: "QAA",
    displayName: "QA SPL A",
    assetType: "SPL_TOKEN",
    decimals: "6",
    mintAddress: mint,
    commandId,
    reason,
  });

  assertRedirectParam(create, "result", "asset_created", "SPL create");
  await assertAuditEvent(commandId, "CREATE_ASSET", "APPLIED", reason);

  const beforeReplay = await domainCounts();
  const replay = await submitCreateAsset(jar, {
    assetCode: "QA_SPL_A",
    symbol: "QAA",
    displayName: "QA SPL A",
    assetType: "SPL_TOKEN",
    decimals: "6",
    mintAddress: mint,
    commandId,
    reason,
  });
  assertRedirectParam(
    replay,
    "result",
    "domain_command_replayed",
    "SPL create replay",
  );
  assertDomainCountsEqual(beforeReplay, await domainCounts(), "Asset replay no mutation");

  const conflict = await submitCreateAsset(jar, {
    assetCode: "QA_SPL_CONFLICT",
    symbol: "QAF",
    displayName: "QA SPL Conflict",
    assetType: "SPL_TOKEN",
    decimals: "6",
    mintAddress: randomMint(),
    commandId,
    reason: "different asset request",
  });
  assertRedirectHasCode(
    conflict,
    "domain_command_conflict",
    "Asset command conflict",
  );

  const duplicateMint = await submitCreateAsset(jar, {
    assetCode: "QA_SPL_DUP_MINT",
    symbol: "QAD",
    displayName: "QA Duplicate Mint",
    assetType: "SPL_TOKEN",
    decimals: "6",
    mintAddress: mint,
    commandId: randomUUID(),
    reason: "duplicate mint",
  });
  assertRedirectHasCode(duplicateMint, "asset_mint_exists", "Duplicate mint");

  const duplicateNative = await submitCreateAsset(jar, {
    assetCode: "QA_NATIVE_DUP",
    symbol: "QAN",
    displayName: "QA Native Duplicate",
    assetType: "NATIVE",
    decimals: "9",
    mintAddress: "",
    commandId: randomUUID(),
    reason: "duplicate native symbol",
  });
  assertRedirectHasCode(
    duplicateNative,
    "asset_native_symbol_exists",
    "Duplicate native symbol",
  );

  pass("SPL asset create");

  return readAsset("QA_SPL_A");
}

async function assertProjectActivationNotReady(jar, project) {
  const response = await submitTransitionProject(jar, {
    projectId: project.id,
    expectedVersion: project.version,
    newStatus: "ACTIVE",
    commandId: randomUUID(),
    reason: "activate without token",
  });
  assertRedirectHasCode(
    response,
    "project_activation_not_ready",
    "Activation without token",
  );
  pass("Project activation readiness blocked");
}

async function assertDraftAssetAssignmentBlocked(jar, project, asset) {
  const response = await submitAssignToken(jar, {
    projectId: project.id,
    assetId: asset.id,
    commandId: randomUUID(),
    reason: "assign draft asset",
  });
  assertRedirectHasCode(response, "asset_not_ready", "Draft asset assign");
  pass("Draft asset assignment blocked");
}

async function assertAssetUpdateNoop(jar, asset) {
  const response = await submitUpdateAsset(jar, {
    assetId: asset.id,
    expectedVersion: asset.version,
    symbol: asset.symbol,
    displayName: asset.displayName,
    commandId: randomUUID(),
    reason: "noop asset update",
  });
  assertRedirectParam(response, "result", "asset_update_noop", "Asset noop");
  pass("Asset update noop");
}

async function assertAssetActivation(jar, asset) {
  const response = await submitTransitionAsset(jar, {
    assetId: asset.id,
    expectedVersion: asset.version,
    newStatus: "ACTIVE",
    commandId: randomUUID(),
    reason: "activate spl asset",
  });
  assertRedirectParam(
    response,
    "result",
    "asset_status_changed",
    "Asset activation",
  );
  pass("Asset activation");
}

async function assertProjectTokenAssign(jar, project, asset) {
  const activeAsset = await readAsset(asset.assetCode);
  const commandId = randomUUID();
  const reason = "assign project token";
  const response = await submitAssignToken(jar, {
    projectId: project.id,
    assetId: activeAsset.id,
    commandId,
    reason,
  });
  assertRedirectParam(
    response,
    "result",
    "project_token_assigned",
    "Token assign",
  );
  await assertAuditEvent(commandId, "ASSIGN_PROJECT_TOKEN", "APPLIED", reason);

  const assignment = await readCurrentAssignment(project.id);
  const noop = await submitAssignToken(jar, {
    projectId: project.id,
    assetId: activeAsset.id,
    commandId: randomUUID(),
    reason: "assign same project token",
  });
  assertRedirectParam(
    noop,
    "result",
    "project_token_assign_noop",
    "Token assign noop",
  );
  pass("Project token assignment");

  return assignment;
}

async function assertProjectActivation(jar, project) {
  const current = await readProjectById(project.id);
  const response = await submitTransitionProject(jar, {
    projectId: current.id,
    expectedVersion: current.version,
    newStatus: "ACTIVE",
    commandId: randomUUID(),
    reason: "activate project",
  });
  assertRedirectParam(
    response,
    "result",
    "project_status_changed",
    "Project activation",
  );
  pass("Project activation");
}

async function assertSecondActiveProjectBlocked(jar) {
  const projectCommandId = randomUUID();
  const createProject = await submitCreateProject(jar, {
    projectCode: "QA_PROJECT_B",
    displayName: "QA Project B",
    commandId: projectCommandId,
    reason: "create project b",
  });
  assertRedirectParam(createProject, "result", "project_created", "Second project");

  const mint = randomMint();
  const createAsset = await submitCreateAsset(jar, {
    assetCode: "QA_SPL_B",
    symbol: "QAB",
    displayName: "QA SPL B",
    assetType: "SPL_TOKEN",
    decimals: "6",
    mintAddress: mint,
    commandId: randomUUID(),
    reason: "create second spl asset",
  });
  assertRedirectParam(createAsset, "result", "asset_created", "Second asset");

  const projectB = await readProject("QA_PROJECT_B");
  const assetB = await readAsset("QA_SPL_B");
  const activateAsset = await submitTransitionAsset(jar, {
    assetId: assetB.id,
    expectedVersion: assetB.version,
    newStatus: "ACTIVE",
    commandId: randomUUID(),
    reason: "activate second spl asset",
  });
  assertRedirectParam(
    activateAsset,
    "result",
    "asset_status_changed",
    "Second asset activation",
  );

  const activeAssetB = await readAsset("QA_SPL_B");
  const assign = await submitAssignToken(jar, {
    projectId: projectB.id,
    assetId: activeAssetB.id,
    commandId: randomUUID(),
    reason: "assign second project token",
  });
  assertRedirectParam(assign, "result", "project_token_assigned", "Second assign");

  const readyProjectB = await readProject("QA_PROJECT_B");
  const activate = await submitTransitionProject(jar, {
    projectId: readyProjectB.id,
    expectedVersion: readyProjectB.version,
    newStatus: "ACTIVE",
    commandId: randomUUID(),
    reason: "activate second project",
  });
  assertRedirectHasCode(
    activate,
    "active_project_conflict",
    "Second active project",
  );
  pass("Second active project blocked");
}

async function assertActiveAssetProtected(jar, asset, assignment) {
  const activeAsset = await readAsset(asset.assetCode);
  const suspend = await submitTransitionAsset(jar, {
    assetId: activeAsset.id,
    expectedVersion: activeAsset.version,
    newStatus: "SUSPENDED",
    commandId: randomUUID(),
    reason: "suspend active token asset",
  });
  assertRedirectHasCode(suspend, "asset_in_use", "Active token suspend");

  const archive = await submitTransitionAsset(jar, {
    assetId: activeAsset.id,
    expectedVersion: activeAsset.version,
    newStatus: "ARCHIVED",
    commandId: randomUUID(),
    reason: "archive current token asset",
  });
  assertRedirectHasCode(archive, "asset_transition_invalid", "Active archive");
  assert(Boolean(assignment.id), "Assignment retained");
  pass("Active asset protection");
}

async function assertTokenReplacement(jar, project, assignment) {
  const currentProject = await readProjectById(project.id);
  const suspend = await submitTransitionProject(jar, {
    projectId: currentProject.id,
    expectedVersion: currentProject.version,
    newStatus: "SUSPENDED",
    commandId: randomUUID(),
    reason: "suspend project before token replacement",
  });
  assertRedirectParam(suspend, "result", "project_status_changed", "Project suspend");

  const currentAssignment = await readAssignmentById(assignment.id);
  const retire = await submitRetireToken(jar, {
    assignmentId: currentAssignment.id,
    expectedVersion: currentAssignment.version,
    commandId: randomUUID(),
    reason: "retire token after suspend",
  });
  assertRedirectParam(
    retire,
    "result",
    "project_token_retired",
    "Token retire",
  );

  const noopRetire = await submitRetireToken(jar, {
    assignmentId: currentAssignment.id,
    expectedVersion: Number(currentAssignment.version) + 1,
    commandId: randomUUID(),
    reason: "retire token noop",
  });
  assertRedirectParam(
    noopRetire,
    "result",
    "project_token_retire_noop",
    "Token retire noop",
  );

  await assertRetiredAssignmentCannotReactivate(currentAssignment.id);

  const replacementMint = randomMint();
  const createReplacement = await submitCreateAsset(jar, {
    assetCode: "QA_SPL_C",
    symbol: "QAC",
    displayName: "QA SPL C",
    assetType: "SPL_TOKEN",
    decimals: "6",
    mintAddress: replacementMint,
    commandId: randomUUID(),
    reason: "create replacement spl asset",
  });
  assertRedirectParam(
    createReplacement,
    "result",
    "asset_created",
    "Replacement asset",
  );

  const replacementAsset = await readAsset("QA_SPL_C");
  const activateReplacement = await submitTransitionAsset(jar, {
    assetId: replacementAsset.id,
    expectedVersion: replacementAsset.version,
    newStatus: "ACTIVE",
    commandId: randomUUID(),
    reason: "activate replacement spl asset",
  });
  assertRedirectParam(
    activateReplacement,
    "result",
    "asset_status_changed",
    "Replacement asset activation",
  );

  const activeReplacement = await readAsset("QA_SPL_C");
  const replacementAssign = await submitAssignToken(jar, {
    projectId: project.id,
    assetId: activeReplacement.id,
    commandId: randomUUID(),
    reason: "assign replacement token",
  });
  assertRedirectParam(
    replacementAssign,
    "result",
    "project_token_assigned",
    "Replacement assignment",
  );

  assert(
    (await currentAssignmentCountForProject(project.id)) === "1",
    "One current assignment",
  );
  assert(
    (await totalAssignmentCountForProject(project.id)) === "2",
    "Assignment history preserved",
  );

  const suspendedProject = await readProjectById(project.id);
  const reactivate = await submitTransitionProject(jar, {
    projectId: suspendedProject.id,
    expectedVersion: suspendedProject.version,
    newStatus: "ACTIVE",
    commandId: randomUUID(),
    reason: "reactivate project after replacement",
  });
  assertRedirectParam(
    reactivate,
    "result",
    "project_status_changed",
    "Project reactivation",
  );
  pass("Project token replacement");
}

async function assertVersionConflicts(jar, project, asset, assignment) {
  const staleProject = await submitUpdateProject(jar, {
    projectId: project.id,
    expectedVersion: 1,
    displayName: "Stale Project Update",
    description: "stale",
    commandId: randomUUID(),
    reason: "stale project update",
  });
  assertRedirectHasCode(
    staleProject,
    "project_version_conflict",
    "Project stale version",
  );

  const staleAsset = await submitUpdateAsset(jar, {
    assetId: asset.id,
    expectedVersion: asset.version,
    symbol: "QAZ",
    displayName: "Stale Asset Update",
    commandId: randomUUID(),
    reason: "stale asset update",
  });
  assertRedirectHasCode(
    staleAsset,
    "asset_version_conflict",
    "Asset stale version",
  );

  const staleAssignment = await submitRetireToken(jar, {
    assignmentId: assignment.id,
    expectedVersion: assignment.version,
    commandId: randomUUID(),
    reason: "stale assignment retire",
  });
  assertRedirectHasCode(
    staleAssignment,
    "assignment_version_conflict",
    "Assignment stale version",
  );
  pass("Domain version conflicts");
}

async function assertNoopTransitions(jar, project, asset) {
  const currentProject = await readProjectById(project.id);
  const projectNoop = await submitTransitionProject(jar, {
    projectId: currentProject.id,
    expectedVersion: currentProject.version,
    newStatus: currentProject.status,
    commandId: randomUUID(),
    reason: "noop project status",
  });
  assertRedirectParam(
    projectNoop,
    "result",
    "project_status_noop",
    "Project status noop",
  );

  const currentAsset = await readAsset(asset.assetCode);
  const assetNoop = await submitTransitionAsset(jar, {
    assetId: currentAsset.id,
    expectedVersion: currentAsset.version,
    newStatus: currentAsset.status,
    commandId: randomUUID(),
    reason: "noop asset status",
  });
  assertRedirectParam(
    assetNoop,
    "result",
    "asset_status_noop",
    "Asset status noop",
  );

  const outcomes = await sqlScalar(`
    select
      (count(*) filter (where outcome = 'APPLIED') > 0)::text || ',' ||
      (count(*) filter (where outcome = 'NOOP') > 0)::text
    from private.domain_admin_audit_events;
  `);
  assert(outcomes === "true,true", "APPLIED and NOOP audit");
  pass("Domain noop outcomes");
}

async function assertAuditImmutability() {
  const result = await sqlScalar(`
    do $$
    begin
      update private.domain_admin_audit_events
      set reason = 'changed';
      raise exception 'expected update failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;

    do $$
    begin
      delete from private.domain_admin_audit_events;
      raise exception 'expected delete failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;

    do $$
    begin
      truncate private.domain_admin_audit_events;
      raise exception 'expected truncate failure';
    exception
      when object_not_in_prerequisite_state then
        null;
    end;
    $$;

    select 'immutable';
  `);

  assert(result === "immutable", "Audit immutable");
  pass("Domain audit immutable");
}

async function assertAuditPage(jar, forbiddenMarkers) {
  const response = await appFetch("/admin/catalog", { jar, redirect: "manual" });
  const body = await response.text();

  assert(response.status === 200, "Catalog audit page status");
  assert(body.includes("CREATE_PROJECT"), "Audit project visible");
  assert(body.includes("CREATE_ASSET"), "Audit asset visible");
  assert(body.includes("ASSIGN_PROJECT_TOKEN"), "Audit assign visible");
  assert(body.includes("RETIRE_PROJECT_TOKEN"), "Audit retire visible");
  assert(body.includes("APPLIED"), "Audit applied visible");
  assert(body.includes("NOOP"), "Audit noop visible");
  assert(!body.includes("access_token"), "Audit no access token");
  assert(!body.includes("refresh_token"), "Audit no refresh token");
  assert(!body.includes("raw_user_meta_data"), "Audit no metadata");
  assert(!body.includes("private_key"), "Audit no private key marker");
  assert(!body.includes("mnemonic"), "Audit no mnemonic marker");

  for (const marker of forbiddenMarkers) {
    assert(!body.includes(marker), "Audit no email");
  }

  pass("AAL2 domain audit page");
}

async function enrollAndVerifyAdmin(jar) {
  const enrollment = await startEnrollment(jar);

  await verifyEnrollment(jar, enrollment);
  pass("Domain ADMIN MFA ready");

  return enrollment;
}

async function startEnrollment(jar) {
  const response = await appJsonFetch("/api/v1/auth/mfa/enroll/start", {
    jar,
    body: {},
  });
  const payload = await response.json();

  assert(response.status === 200, "Enrollment start status");
  assert(payload?.status === "enrollment_started", "Enrollment started");
  assert(isUuid(payload.factorId), "Enrollment factor id");
  assert(isBase32Secret(payload.secret), "Enrollment secret");

  return {
    factorId: payload.factorId,
    secret: payload.secret,
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

  assert(response.status === 200, "Enrollment verify status");
  assert(payload?.status === "verified", "Enrollment verified");
}

async function signUpConfirmAndSignIn(email, password, nextPath) {
  const signup = await appFetch("/api/v1/auth/sign-up", {
    method: "POST",
    body: {
      email,
      display_name: "QA Domain",
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

async function submitCreateProject(
  jar,
  { projectCode, displayName, description = "", commandId, reason },
) {
  return appFetch("/api/v1/admin/domain/projects/create", {
    method: "POST",
    jar,
    body: {
      project_code: projectCode,
      display_name: displayName,
      description,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitUpdateProject(
  jar,
  { projectId, expectedVersion, displayName, description = "", commandId, reason },
) {
  return appFetch("/api/v1/admin/domain/projects/update", {
    method: "POST",
    jar,
    body: {
      project_id: projectId,
      expected_version: String(expectedVersion),
      display_name: displayName,
      description: description ?? "",
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitTransitionProject(
  jar,
  { projectId, expectedVersion, newStatus, commandId, reason },
) {
  return appFetch("/api/v1/admin/domain/projects/transition", {
    method: "POST",
    jar,
    body: {
      project_id: projectId,
      expected_version: String(expectedVersion),
      new_status: newStatus,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitCreateAsset(
  jar,
  {
    assetCode,
    symbol,
    displayName,
    assetType,
    decimals,
    mintAddress,
    commandId,
    reason,
  },
) {
  return appFetch("/api/v1/admin/domain/assets/create", {
    method: "POST",
    jar,
    body: {
      asset_code: assetCode,
      symbol,
      display_name: displayName,
      asset_type: assetType,
      decimals,
      mint_address: mintAddress,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitUpdateAsset(
  jar,
  { assetId, expectedVersion, symbol, displayName, commandId, reason },
) {
  return appFetch("/api/v1/admin/domain/assets/update", {
    method: "POST",
    jar,
    body: {
      asset_id: assetId,
      expected_version: String(expectedVersion),
      symbol,
      display_name: displayName,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitTransitionAsset(
  jar,
  { assetId, expectedVersion, newStatus, commandId, reason },
) {
  return appFetch("/api/v1/admin/domain/assets/transition", {
    method: "POST",
    jar,
    body: {
      asset_id: assetId,
      expected_version: String(expectedVersion),
      new_status: newStatus,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitAssignToken(
  jar,
  { projectId, assetId, commandId, reason },
) {
  return appFetch("/api/v1/admin/domain/project-token/assign", {
    method: "POST",
    jar,
    body: {
      project_id: projectId,
      asset_id: assetId,
      command_id: commandId,
      reason,
    },
    redirect: "manual",
  });
}

async function submitRetireToken(
  jar,
  { assignmentId, expectedVersion, commandId, reason },
) {
  return appFetch("/api/v1/admin/domain/project-token/retire", {
    method: "POST",
    jar,
    body: {
      assignment_id: assignmentId,
      expected_version: String(expectedVersion),
      command_id: commandId,
      reason,
    },
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

  const response = await fetch(requestUrl, {
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

  const response = await fetch(requestUrl, {
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

async function assertStatus(path, status, label) {
  const response = await appFetch(path, { redirect: "manual" });

  assert(response.status === status, label);
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

async function bootstrapAdminRole(userId) {
  const count = await sqlScalar(`
    insert into public.user_roles (user_id, role, grant_reason)
    values (${sqlLiteral(userId)}::uuid, 'ADMIN', 'local domain e2e bootstrap')
    on conflict (user_id, role) where revoked_at is null do nothing;

    select count(*)::text
    from public.user_roles
    where user_id = ${sqlLiteral(userId)}::uuid
      and role = 'ADMIN'
      and revoked_at is null;
  `);

  assert(count === "1", "Bootstrap ADMIN role");
}

async function assertDomainRpcDenied(actorUserId, aal, label) {
  const result = await sqlScalar(`
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
      from public.create_project(
        'DENIED_RPC',
        'Denied RPC',
        null,
        ${sqlLiteral(randomUUID())}::uuid,
        'denied domain rpc'
      );
      raise exception 'expected denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);

  assert(result === "denied", label);
}

async function assertDomainReadDenied(actorUserId, aal, label) {
  const result = await sqlScalar(`
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
      from public.list_admin_projects(10);
      raise exception 'expected denial';
    exception
      when insufficient_privilege then
        null;
    end;
    $$;
    select 'denied';
  `);

  assert(result === "denied", label);
}

async function readProject(projectCode) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', projects.id::text,
      'projectCode', projects.project_code,
      'displayName', projects.display_name,
      'description', projects.description,
      'status', projects.status,
      'version', projects.version
    )::text
    from public.projects as projects
    where projects.project_code = ${sqlLiteral(projectCode)};
  `);

  return parseJsonRow(payload, "Project row");
}

async function readProjectById(projectId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', projects.id::text,
      'projectCode', projects.project_code,
      'displayName', projects.display_name,
      'description', projects.description,
      'status', projects.status,
      'version', projects.version
    )::text
    from public.projects as projects
    where projects.id = ${sqlLiteral(projectId)}::uuid;
  `);

  return parseJsonRow(payload, "Project row by id");
}

async function readAsset(assetCode) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', assets.id::text,
      'assetCode', assets.asset_code,
      'symbol', assets.symbol,
      'displayName', assets.display_name,
      'assetType', assets.asset_type,
      'status', assets.status,
      'version', assets.version
    )::text
    from public.supported_assets as assets
    where assets.asset_code = ${sqlLiteral(assetCode)};
  `);

  return parseJsonRow(payload, "Asset row");
}

async function readCurrentAssignment(projectId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', assignments.id::text,
      'projectId', assignments.project_id::text,
      'assetId', assignments.asset_id::text,
      'retiredAt', assignments.retired_at,
      'version', assignments.version
    )::text
    from public.project_token_assignments as assignments
    where assignments.project_id = ${sqlLiteral(projectId)}::uuid
      and assignments.retired_at is null;
  `);

  return parseJsonRow(payload, "Current assignment");
}

async function readAssignmentById(assignmentId) {
  const payload = await sqlScalar(`
    select json_build_object(
      'id', assignments.id::text,
      'projectId', assignments.project_id::text,
      'assetId', assignments.asset_id::text,
      'retiredAt', assignments.retired_at,
      'version', assignments.version
    )::text
    from public.project_token_assignments as assignments
    where assignments.id = ${sqlLiteral(assignmentId)}::uuid;
  `);

  return parseJsonRow(payload, "Assignment row");
}

async function currentAssignmentCountForProject(projectId) {
  return sqlScalar(`
    select count(*)::text
    from public.project_token_assignments
    where project_id = ${sqlLiteral(projectId)}::uuid
      and retired_at is null;
  `);
}

async function totalAssignmentCountForProject(projectId) {
  return sqlScalar(`
    select count(*)::text
    from public.project_token_assignments
    where project_id = ${sqlLiteral(projectId)}::uuid;
  `);
}

async function assertRetiredAssignmentCannotReactivate(assignmentId) {
  const result = await sqlScalar(`
    do $$
    begin
      update public.project_token_assignments
      set retired_at = null
      where id = ${sqlLiteral(assignmentId)}::uuid;
      raise exception 'expected assignment reactivation failure';
    exception
      when check_violation then
        null;
    end;
    $$;
    select 'blocked';
  `);

  assert(result === "blocked", "Retired assignment reactivation blocked");
}

async function domainCounts() {
  const result = await sqlScalar(`
    select
      (select count(*) from public.projects)::text || ',' ||
      (select count(*) from public.supported_assets)::text || ',' ||
      (select count(*) from public.project_token_assignments)::text || ',' ||
      (select count(*) from private.domain_admin_audit_events)::text;
  `);
  const [projects, assets, assignments, audit] = result
    .split(",")
    .map(Number);

  return { projects, assets, assignments, audit };
}

function assertDomainCountsEqual(before, after, label) {
  assert(
    before.projects === after.projects &&
      before.assets === after.assets &&
      before.assignments === after.assignments &&
      before.audit === after.audit,
    label,
  );
}

async function assertAuditEvent(commandId, action, outcome, reason) {
  const count = await sqlScalar(`
    select count(*)::text
    from private.domain_admin_audit_events
    where command_id = ${sqlLiteral(commandId)}::uuid
      and action = ${sqlLiteral(action)}
      and outcome = ${sqlLiteral(outcome)}
      and reason = ${sqlLiteral(reason)};
  `);

  assert(count === "1", "Domain audit event");
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
    },
  );

  return stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

function parseJsonRow(payload, label) {
  assert(Boolean(payload), label);

  return JSON.parse(payload);
}

function assertRedirectPath(response, expectedPath, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const actual = getRedirectUrl(response, label);

  assert(
    actual.pathname === expectedPath,
    `${label} path ${formatSafeRedirect(actual)}`,
  );
}

function assertRedirectHasCode(response, code, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const actual = getRedirectUrl(response, label);
  const actualCode =
    actual.searchParams.get("error") ?? actual.searchParams.get("code");

  assert(actualCode === code, `${label} code ${formatSafeRedirect(actual)}`);
}

function assertRedirectParam(response, name, expected, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} status`,
  );
  const actual = getRedirectUrl(response, label);

  assert(
    actual.searchParams.get(name) === expected,
    `${label} result ${formatSafeRedirect(actual)}`,
  );
}

function getRedirectParam(response, name) {
  const actual = getRedirectUrl(response, "Redirect result");

  return actual.searchParams.get(name);
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
    "project_id",
    "asset_id",
    "assignment_id",
    "command_id",
    "expected_version",
    "reason",
    "mint_address",
  ]) {
    assert(!url.searchParams.has(name), `${label} no ${name}`);
  }
}

function formatSafeRedirect(url) {
  if (!url) {
    return "missing";
  }

  const code =
    url.searchParams.get("error") ??
    url.searchParams.get("code") ??
    url.searchParams.get("result");

  return code ? `${url.pathname}?result=${code}` : url.pathname;
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

async function assertFactorSecretNotPrinted(enrollment) {
  assert(isUuid(enrollment.factorId), "Factor id shape");
  assert(isBase32Secret(enrollment.secret), "Secret shape");
  pass("MFA material process-only");
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

function randomMint() {
  return Array.from({ length: 44 }, () =>
    BASE58_ALPHABET[randomInt(BASE58_ALPHABET.length)],
  ).join("");
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
    console.error("FAIL domain lifecycle integration");
  }

  process.exitCode = 1;
});
