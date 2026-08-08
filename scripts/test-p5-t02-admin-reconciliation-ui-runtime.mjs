import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(".");
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3010";
const ADMIN_READ_RUNTIME_PATH = join(
  REPO_ROOT,
  "scripts/test-p5-t02-admin-reconciliation-read-runtime.mjs",
);
const HTML_PUBLIC_DENYLIST = [
  "idempotencyKey",
  "idempotency_key",
  "profileId",
  "profile_id",
  "actorProfileId",
  "actor_profile_id",
  "requestedByProfileId",
  "requested_by_profile_id",
  "openedByProfileId",
  "opened_by_profile_id",
  "lastActorProfileId",
  "last_actor_profile_id",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "jwt",
  "service_role",
  "rawPayload",
  "raw_payload",
  "checkpointCursor",
  "private.reconciliation",
  "SQLSTATE",
  "PostgrestError",
  "stack trace",
];
const REVIEW_ACTION_REASON_CODES = [
  "BALANCE_MISMATCH_REVIEW_OPENED",
  "OBSERVATION_FAILURE_REVIEW_OPENED",
  "MANUAL_REVIEW_STARTED",
  "REVIEW_ASSESSMENT_COMPLETED",
  "NO_FURTHER_REVIEW_REQUIRED",
];
const REVIEW_ACTION_LABELS = [
  "Open Review",
  "Start Review",
  "Resolve",
  "Ignore",
];
const REVIEW_CONFIRMATION_LABELS = [
  "Confirm Resolve",
  "Confirm Ignore",
  "Cancel",
];
const LIST_MUTATION_LABEL_DENYLIST = [
  "Open review",
  "Open Review",
  "Transition review",
  "Resolve",
  "Ignore",
  "Start review",
  "Start Review",
  "Confirm Resolve",
  "Confirm Ignore",
];
const MUTATION_FIELD_DENYLIST = [
  "idempotencyKey",
  "idempotency_key",
  "actorProfileId",
  "actor_profile_id",
];

let uiPassCount = 0;
let reviewActionPassCount = 0;
let reviewApiMutationCaseCount = 0;

async function main() {
  const runtime = await loadAdminReadRuntimeModule();
  const suffix = randomUUID().replaceAll("-", "").toLowerCase();
  const fixtureTag = `P5-T02-12C-${Date.now()}-${suffix.slice(0, 10)}`;
  const safePrefix = `p5ui.${suffix.slice(0, 18)}`;
  const codePrefix = `P5UI${suffix.slice(0, 9).toUpperCase()}`;
  const sharedCredential = `Ui-${suffix.slice(0, 20)}-Pass1!`;
  const adminEmail = `qa-p5ui-admin-${Date.now()}-${suffix.slice(0, 8)}@example.test`;
  const userEmail = `qa-p5ui-user-${Date.now()}-${suffix.slice(8, 16)}@example.test`;
  let cleanupMarker = null;

  await runtime.withQuarantinedEnv(async () => {
    await runtime.withSelfOwnedRuntime(async () => {
      await runtime.assertPublicSmoke();

      const userJar = await runtime.signUpConfirmAndSignIn(
        userEmail,
        sharedCredential,
        "/account",
        "QA Admin UI Runtime User",
      );
      const userId = await runtime.readUserIdByEmail(userEmail);

      const adminJar = await runtime.signUpConfirmAndSignIn(
        adminEmail,
        sharedCredential,
        "/admin",
        "QA Admin UI Runtime Admin",
      );
      const adminUserId = await runtime.readUserIdByEmail(adminEmail);

      await runtime.bootstrapAdminRole(
        userId,
        "local admin UI runtime temporary user aal2 bootstrap",
      );
      await runtime.enrollAndVerifyMfa(userJar, userId, "USER");
      await runtime.revokeTemporaryAdminRole(userId);
      await runtime.assertActiveAdminRoleCount(
        userId,
        "0",
        "USER AAL2 temporary ADMIN revoked",
      );

      await runtime.bootstrapAdminRole(adminUserId);

      const fixture = await runtime.createAdminReadFixture({
        adminUserId,
        safePrefix,
        codePrefix,
        fixtureTag,
      });
      cleanupMarker = fixture.cleanupMarker;
      await extendFixtureForReviewActionUi(runtime, fixture);
      const beforeSideEffects = await runtime.readSideEffectSnapshot(fixture);

      await runtime.assertAuthMatrixBeforeAdminAal2({
        userJar,
        adminJar,
        fixture,
      });
      await assertUiAuthMatrixBeforeAdminAal2(runtime, {
        userJar,
        adminJar,
        fixture,
      });

      await runtime.enrollAndVerifyMfa(adminJar, adminUserId, "ADMIN");
      await runtime.assertAuthMatrixAdminAal2({ adminJar, fixture });

      const apiList = await runtime.getList(adminJar);

      await assertAdminHomeNavigation(runtime, adminJar);
      await assertListBaseRender(runtime, adminJar, fixture, apiList.result.items);
      await assertFilterForm(runtime, adminJar);
      await assertFilterRuntimeMatrix(runtime, adminJar, fixture);
      await assertInvalidQueryUi(runtime, adminJar);
      await assertCursorPagination(runtime, adminJar, fixture);
      await assertDetailRender(runtime, adminJar, fixture);
      await assertReviewActionSourceContract();
      await assertReviewActionFixtureMatrix(runtime, adminJar, fixture);
      await assertReviewActionMutationFlows(runtime, adminJar, fixture);
      await assertInvalidAndMissingDetail(runtime, adminJar);
      await assertReadOnlyBoundary(runtime, adminJar, fixture);
      await assertPageMethodBoundary(runtime, adminJar, fixture);

      const afterSideEffects = await runtime.readSideEffectSnapshot(fixture);
      assertReviewOnlySideEffects(
        beforeSideEffects,
        afterSideEffects,
        {
          caseDelta: 2,
          eventDelta: 5,
          label: "ADMIN UI review action final side-effect snapshot",
        },
      );
      pass("ADMIN_UI_SIDE_EFFECT_SNAPSHOT");
    }, () => cleanupMarker);
  });

  const importedPassCount = runtime.readAdminReadRuntimePassCountForUi();
  const readRegressionCaseCount =
    importedPassCount + uiPassCount - reviewActionPassCount;

  console.log(`ADMIN_UI_READ_REGRESSION_CASE_COUNT=${readRegressionCaseCount}`);
  console.log(`ADMIN_UI_REVIEW_ACTION_RUNTIME_CASE_COUNT=${reviewActionPassCount}`);
  console.log(`ADMIN_UI_REUSED_REVIEW_API_CASE_COUNT=${reviewApiMutationCaseCount}`);
  console.log(`ADMIN_UI_RUNTIME_TEST_CASE_COUNT=${uiPassCount}`);
  console.log(`ADMIN_UI_RUNTIME_REUSED_READ_CASE_COUNT=${importedPassCount}`);
  console.log(`ADMIN_UI_RUNTIME_TOTAL_CASE_COUNT=${uiPassCount + importedPassCount}`);
  console.log("FINAL_STATUS=PASS_ADMIN_RECONCILIATION_REVIEW_ACTION_UI_RUNTIME_READY");
}

async function loadAdminReadRuntimeModule() {
  const source = readFileSync(ADMIN_READ_RUNTIME_PATH, "utf8");
  const transformed = patchAdminReadRuntimeSource(source);
  const encoded = encodeURIComponent(transformed);

  return import(`data:text/javascript;charset=utf-8,${encoded}`);
}

function patchAdminReadRuntimeSource(source) {
  const cookieJarUrl = pathToFileURL(
    join(REPO_ROOT, "scripts/lib/http-cookie-jar.mjs"),
  ).href;
  const localHttpUrl = pathToFileURL(
    join(REPO_ROOT, "scripts/lib/local-http-harness.mjs"),
  ).href;
  const exportBlock = `
function readAdminReadRuntimePassCountForUi() {
  return passCount;
}

export {
  withQuarantinedEnv,
  withSelfOwnedRuntime,
  assertPublicSmoke,
  signUpConfirmAndSignIn,
  readUserIdByEmail,
  bootstrapAdminRole,
  enrollAndVerifyMfa,
  revokeTemporaryAdminRole,
  assertActiveAdminRoleCount,
  createAdminReadFixture,
  readSideEffectSnapshot,
  assertAuthMatrixBeforeAdminAal2,
  assertAuthMatrixAdminAal2,
  getList,
  getDetail,
  appGet,
  appPost,
  appJsonPost,
  appFetch,
  sqlScalar,
  assertPublicTextSafe,
  readAdminReadRuntimePassCountForUi,
};

function classifyFailureMessage`;

  const withoutMain = source.replace(
    /main\(\)\.catch\(\(error\) => \{[\s\S]*?\n\}\);\r?\n\r?\nfunction classifyFailureMessage/,
    exportBlock,
  );

  assert(
    withoutMain !== source,
    "admin read runtime main export patch",
    "REQUIRES_ACTION",
  );

  return withoutMain
    .replace(
      'from "./lib/http-cookie-jar.mjs";',
      `from ${JSON.stringify(cookieJarUrl)};`,
    )
    .replace(
      'from "./lib/local-http-harness.mjs";',
      `from ${JSON.stringify(localHttpUrl)};`,
    );
}

async function assertUiAuthMatrixBeforeAdminAal2(
  runtime,
  { userJar, adminJar, fixture },
) {
  const paths = uiPaths(fixture);

  for (const path of paths) {
    const unauthenticated = await getHtml(runtime, path);

    assertRedirectTo(
      unauthenticated.response,
      "/auth/sign-in",
      "Unauthenticated UI redirect",
    );
    assertNoFixtureLeak(
      unauthenticated.text,
      fixture,
      "Unauthenticated UI body",
      allowedRouteMarkers(path, fixture),
    );

    const userAal2 = await getHtml(runtime, path, { jar: userJar });

    assertRedirectTo(
      userAal2.response,
      "/auth/error",
      "USER AAL2 UI redirect",
    );
    assertNoFixtureLeak(
      userAal2.text,
      fixture,
      "USER AAL2 UI body",
      allowedRouteMarkers(path, fixture),
    );

    const adminAal1 = await getHtml(runtime, path, { jar: adminJar });

    assertRedirectToAny(
      adminAal1.response,
      ["/auth/mfa/enroll", "/auth/mfa/challenge"],
      "ADMIN AAL1 UI redirect",
    );
    assertNoFixtureLeak(
      adminAal1.text,
      fixture,
      "ADMIN AAL1 UI body",
      allowedRouteMarkers(path, fixture),
    );
  }

  pass("ADMIN_UI_ACCESS_MATRIX_PRE_AAL2");
}

async function assertAdminHomeNavigation(runtime, adminJar) {
  const { response, text } = await getHtml(runtime, "/admin", { jar: adminJar });
  const normalized = normalizeText(text);
  const links = extractLinks(text);

  assert(response.status === 200, "admin home HTTP 200");
  assertIncludes(normalized, "Admin", "admin home heading");
  assertIncludes(normalized, "Admin verified", "admin home verified copy");
  assertIncludes(normalized, "AAL2 required", "admin home AAL2 copy");
  assertIncludes(
    normalized,
    "Reconciliation item reads are a separate read-only AAL2 surface.",
    "admin home reconciliation copy",
  );
  assert(
    links.some(
      (link) =>
        link.href === "/admin/reconciliation" &&
        normalizeWhitespace(link.text) === "Reconciliation reads",
    ),
    "admin reconciliation navigation link",
  );
  assert(
    !links.some((link) => link.href.startsWith("http")),
    "admin navigation no external link",
  );
  assert(
    !hasPostFormAction(text, "/admin/reconciliation"),
    "admin reconciliation link not mutation form",
  );

  pass("ADMIN_UI_HOME_NAVIGATION");
}

async function assertListBaseRender(runtime, adminJar, fixture, apiItems) {
  const { response, text } = await getHtml(runtime, "/admin/reconciliation", {
    jar: adminJar,
  });
  const normalized = normalizeText(text);

  assert(response.status === 200, "list page HTTP 200");
  assertIncludes(normalized, "Reconciliation", "list heading");
  assertIncludes(normalized, "Read-only ADMIN+AAL2", "list read-only copy");
  assertIncludes(normalized, "Filters", "list filters heading");
  assertIncludes(normalized, "Reconciliation items", "list section");
  assertIncludes(normalized, "Results", "list result count label");
  assertIncludes(normalized, "6", "list result count value");

  for (const label of [
    "Asset",
    "Run status",
    "Scope",
    "Classification",
    "Review",
    "Observer",
    "Cutoff",
    "Expected",
    "Observed",
    "Difference",
    "Tolerance",
    "Provenance counts",
    "Created",
    "Detail",
  ]) {
    assertIncludes(normalized, label, `list table ${label}`);
  }

  assertUiListMatchesApi(text, apiItems, fixture, "default list render");
  assert(
    !normalized.includes("Provider") &&
      !normalized.includes("Binding label") &&
      !normalized.includes("P5C Runtime Provider"),
    "list excludes full provenance",
  );
  assertHtmlDetailLinks(text, apiItems, "default list detail links");
  assertNumericRender(normalized, "list numeric render");

  pass("ADMIN_UI_LIST_RENDER");
}

async function assertFilterForm(runtime, adminJar) {
  const { text } = await getHtml(runtime, "/admin/reconciliation", {
    jar: adminJar,
  });
  const forms = extractForms(text);
  const filterForm = forms.find((form) => form.action === "/admin/reconciliation");

  assert(Boolean(filterForm), "filter form present");
  assert(filterForm.method === "get", "filter form method GET");

  for (const name of [
    "assetId",
    "runStatus",
    "classification",
    "reviewState",
    "observerKind",
    "cutoffFrom",
    "cutoffTo",
    "limit",
  ]) {
    assert(
      hasFormControl(text, name),
      `filter form control ${name}`,
      "REQUIRES_ACTION_ADMIN_UI_RUNTIME_DEFECT",
    );
  }

  assertIncludes(text, "2026-07-30T03:00:00.123456Z", "cutoff placeholder");
  assertIncludes(text, "Search", "filter submit label");
  assertIncludes(text, "Reset filters", "filter reset link");
  assertNoMutationForms(text, "filter form read-only");

  pass("ADMIN_UI_FILTER_FORM");
}

async function assertFilterRuntimeMatrix(runtime, adminJar, fixture) {
  const cases = [
    ["assetId", `?assetId=${fixture.assetAId}`],
    ["runStatus", "?runStatus=PARTIAL"],
    ["classification", "?classification=OBSERVATION_FAILED"],
    ["reviewStateNone", "?reviewState=NONE"],
    ["reviewStateActual", "?reviewState=IN_REVIEW"],
    ["observerKind", "?observerKind=ALT_BALANCE_OBSERVER"],
    ["cutoffFrom", "?cutoffFrom=2026-07-30T02:00:00Z"],
    ["cutoffTo", "?cutoffTo=2026-07-30T02:00:00Z"],
    [
      "compound",
      `?assetId=${fixture.assetAId}&observerKind=BALANCE_OBSERVER`,
    ],
    ["limit", "?limit=2"],
  ];

  for (const [label, query] of cases) {
    await assertListQueryMatchesApi(runtime, adminJar, fixture, query, label);
  }

  pass("ADMIN_UI_FILTER_RUNTIME_MATRIX");
}

async function assertInvalidQueryUi(runtime, adminJar) {
  const invalidQueries = [
    "?unexpected=value",
    "?limit=10&limit=20",
    "?limit=0",
    "?limit=abc",
    "?assetId=not-a-uuid",
    "?runStatus=NOT_A_STATUS",
    "?classification=NOT_A_CLASSIFICATION",
    "?reviewState=NOT_A_REVIEW_STATE",
    "?observerKind=bad",
    "?cursor=not**base64",
    "?cutoffFrom=not-a-date",
    "?cutoffFrom=2026-07-30T04:00:00Z&cutoffTo=2026-07-30T03:00:00Z",
    "?cutoffFrom=2026-07-30T03:00:00Z&cutoffTo=2026-07-30T03:00:00Z",
  ];

  for (const query of invalidQueries) {
    const { response, text } = await getHtml(
      runtime,
      `/admin/reconciliation${query}`,
      { jar: adminJar },
    );
    const normalized = normalizeText(text);

    assert(response.status === 200, `invalid query UI HTTP 200 ${query}`);
    assertIncludes(
      normalized,
      "Check the reconciliation read request values.",
      `invalid query safe message ${query}`,
    );
    assertIncludes(normalized, "Reset filters", `invalid query reset ${query}`);
    assert(
      !normalized.includes("Reconciliation items"),
      `invalid query no result table ${query}`,
    );
    assertHtmlPublicSafe(text, `invalid query ${query}`);
  }

  const validMicrosecond = await getHtml(
    runtime,
    "/admin/reconciliation?cutoffFrom=2026-07-30T03:00:00.123456Z&cutoffTo=2026-07-30T03:00:00.123457Z",
    { jar: adminJar },
  );

  assert(validMicrosecond.response.status === 200, "valid microsecond UI status");
  assert(
    !normalizeText(validMicrosecond.text).includes(
      "Check the reconciliation read request values.",
    ),
    "valid microsecond range not invalid",
  );

  const validOffset = await getHtml(
    runtime,
    "/admin/reconciliation?cutoffFrom=2026-07-30T03:00:00.123456%2B00:00&cutoffTo=2026-07-30T03:00:00.123457Z",
    { jar: adminJar },
  );

  assert(validOffset.response.status === 200, "valid offset UI status");
  assert(
    !normalizeText(validOffset.text).includes(
      "Check the reconciliation read request values.",
    ),
    "valid offset range not invalid",
  );

  pass("ADMIN_UI_INVALID_QUERY");
}

async function assertCursorPagination(runtime, adminJar, fixture) {
  const visitedIds = [];
  let path = "/admin/reconciliation?limit=2";
  let sawNext = false;

  for (let index = 0; index < 10; index += 1) {
    const { response, text } = await getHtml(runtime, path, { jar: adminJar });
    const links = extractLinks(text);
    const pageApi = await runtime.getList(
      adminJar,
      path.slice("/admin/reconciliation".length),
    );
    const pageItems = pageApi.result.items;

    assert(response.status === 200, "pagination UI HTTP 200");
    assert(pageItems.length > 0 && pageItems.length <= 2, "pagination page size");
    assertUiListMatchesApi(text, pageItems, fixture, `pagination page ${index + 1}`);
    visitedIds.push(...pageItems.map((item) => item.reconciliationItemId));

    const next = links.find((link) => normalizeWhitespace(link.text) === "Next");

    if (!next) {
      assert(pageApi.result.nextCursor === null, "last page has no cursor");
      break;
    }

    sawNext = true;
    assert(pageApi.result.nextCursor !== null, "Next link has API cursor");
    assert(next.href.startsWith("/admin/reconciliation?"), "Next href route");

    const nextUrl = new URL(next.href, APP_ORIGIN);

    assert(nextUrl.searchParams.get("limit") === "2", "Next preserves limit");
    assert(Boolean(nextUrl.searchParams.get("cursor")), "Next has cursor");
    assert(
      !normalizeText(text).includes(nextUrl.searchParams.get("cursor") ?? ""),
      "cursor not rendered as visible text",
    );
    assertIncludes(
      normalizeText(text),
      "Use the browser Back button for the previous page.",
      "previous UX copy",
    );

    path = `${nextUrl.pathname}${nextUrl.search}`;
  }

  assert(sawNext, "pagination saw Next");
  assertDeepEqual(
    visitedIds,
    fixture.expectedOrder,
    "pagination full fixture order",
    "REQUIRES_ACTION_ADMIN_UI_RUNTIME_DEFECT",
  );
  assert(new Set(visitedIds).size === visitedIds.length, "pagination duplicate 0");

  const secondPage = await getHtml(
    runtime,
    "/admin/reconciliation?limit=2&cursor=" +
      encodeURIComponent(
        Buffer.from(
          JSON.stringify({
            createdAt: fixture.items
              .toSorted(compareFixtureItems)
              .slice(0, 2)
              .at(-1).itemCreatedAt,
            itemId: fixture.items.toSorted(compareFixtureItems).slice(0, 2).at(-1).id,
          }),
        ).toString("base64url"),
      ),
    { jar: adminJar },
  );

  assertIncludes(normalizeText(secondPage.text), "First page", "first page link");
  pass("ADMIN_UI_CURSOR_PAGINATION");
}

async function extendFixtureForReviewActionUi(runtime, fixture) {
  const itemId = randomUUID();
  const runId = randomUUID();
  const sourceMismatch = fixture.items.find(
    (item) => item.id === fixture.reviewedItemId,
  );

  assert(sourceMismatch, "review action source mismatch fixture");
  const createdAt = "2026-07-30T03:00:00.123050Z";

  await runtime.sqlScalar(`
    begin;
    set constraints all deferred;

    insert into private.reconciliation_runs (
      id,
      idempotency_key,
      trigger_source,
      status,
      requested_by_profile_id,
      started_at,
      completed_at,
      failure_code,
      created_at,
      observer_kind,
      observation_cutoff_at
    )
    values (
      ${sqlUuid(runId)},
      ${sqlLiteral(`${fixture.cleanupMarker}.ui.review.action`)},
      'MANUAL',
      'COMPLETED',
      null,
      ${sqlTimestamp("2026-07-30T03:00:00Z")},
      ${sqlTimestamp("2026-07-30T03:01:00Z")},
      null,
      ${sqlTimestamp("2026-07-30T03:00:00Z")},
      'BALANCE_OBSERVER',
      ${sqlTimestamp("2026-07-30T03:00:00Z")}
    );

    insert into private.reconciliation_items (
      id,
      reconciliation_run_id,
      custody_account_binding_id,
      asset_id,
      external_balance_observation_id,
      expected_units,
      observed_units,
      difference_units,
      tolerance_units,
      classification,
      created_at,
      scope_kind
    )
    values (
      ${sqlUuid(itemId)},
      ${sqlUuid(runId)},
      null,
      ${sqlUuid(fixture.assetBId)},
      null,
      ${sqlNumeric("25")},
      ${sqlNumeric("20")},
      ${sqlNumeric("-5")},
      ${sqlNumeric("0")},
      'MISMATCH',
      ${sqlTimestamp(createdAt)},
      'ASSET_AGGREGATE'
    );

    insert into private.reconciliation_item_binding_observations (
      reconciliation_item_id,
      custody_account_binding_id,
      external_balance_observation_id,
      membership_status,
      created_at
    )
    select
      ${sqlUuid(itemId)},
      members.custody_account_binding_id,
      members.external_balance_observation_id,
      members.membership_status,
      ${sqlTimestamp(createdAt)}
    from private.reconciliation_item_binding_observations as members
    where members.reconciliation_item_id = ${sqlUuid(fixture.reviewedItemId)};

    commit;

    select 'ok';
  `);

  fixture.reviewActionMismatchItemId = itemId;
  fixture.items.push({
    id: itemId,
    assetId: fixture.assetBId,
    runId,
    itemCreatedAt: createdAt,
    runStatus: "COMPLETED",
    classification: "MISMATCH",
    reviewStatus: null,
    observerKind: "BALANCE_OBSERVER",
    observationCutoffAt: "2026-07-30T03:00:00Z",
    expectedUnits: "25",
    observedUnits: "20",
    differenceUnits: "-5",
    toleranceUnits: "0",
    counts: [2, 2, 0, 0],
  });
  fixture.expectedOrder = fixture.items
    .toSorted(compareFixtureItems)
    .map((item) => item.id);

  passReviewAction("ADMIN_UI_REVIEW_ACTION_FIXTURE_SETUP");
}

async function assertDetailRender(runtime, adminJar, fixture) {
  await assertDetailPage(runtime, adminJar, fixture.reviewedItemId, {
    expectedText: [
      "reconciliation item",
      "Run",
      "Item",
      "Provenance",
      "Review case",
      "Review event timeline",
      "IN_REVIEW",
      "REVIEW_STARTED",
      "P5C_STARTED",
      "0 atomic units",
      "-5 atomic units",
    ],
    absentText: ["No review case exists for this item."],
    label: "reviewed detail",
  });

  await assertDetailPage(runtime, adminJar, fixture.noReviewItemId, {
    expectedText: [
      "No review case exists for this item.",
      "No review events exist for this item.",
      "MISSING_OBSERVATION",
      "OBSERVATION_FAILED",
      "--",
    ],
    absentText: ["Review case ID", "P5C_STARTED"],
    label: "no-review detail",
  });

  await assertDetailPage(runtime, adminJar, fixture.bindingItemId, {
    expectedText: ["BINDING", "P5C A Collection", "COLLECTION", "52 atomic units"],
    absentText: ["No binding provenance is available for this item."],
    label: "binding detail",
  });

  await assertDetailPage(runtime, adminJar, fixture.missingItemId, {
    expectedText: ["ALT_BALANCE_OBSERVER", "MISSING_OBSERVATION", "OBSERVATION_FAILED"],
    absentText: [],
    label: "observation failure detail",
  });

  pass("ADMIN_UI_DETAIL_RENDER");
}

async function assertDetailPage(
  runtime,
  adminJar,
  itemId,
  { expectedText, absentText, label },
) {
  const detail = await runtime.getDetail(adminJar, itemId);
  const { response, text } = await getHtml(
    runtime,
    `/admin/reconciliation/items/${itemId}`,
    { jar: adminJar },
  );
  const normalized = normalizeText(text);

  assert(response.status === 200, `${label} HTTP 200`);
  assertIncludes(normalized, itemId, `${label} item id`);
  assertIncludes(normalized, detail.result.run.id, `${label} run id`);
  assertIncludes(normalized, detail.result.item.asset.id, `${label} asset id`);
  assertIncludes(normalized, detail.result.item.asset.assetCode, `${label} asset code`);
  assertIncludes(normalized, detail.result.item.asset.symbol, `${label} symbol`);
  assertNumericRender(normalized, `${label} numeric render`);

  for (const entry of detail.result.provenance) {
    assertIncludes(normalized, entry.providerCode, `${label} provider code`);
    assertIncludes(normalized, entry.bindingLabel, `${label} binding label`);
    assertIncludes(normalized, entry.bindingRole, `${label} binding role`);
    assertIncludes(normalized, entry.custodyAccountBindingId, `${label} binding id`);
  }

  if (detail.result.reviewCase) {
    assertIncludes(
      normalized,
      detail.result.reviewCase.id,
      `${label} review case id`,
    );
  }

  for (const event of detail.result.reviewEvents) {
    assertIncludes(normalized, String(event.eventVersion), `${label} event version`);
    assertIncludes(normalized, event.eventType, `${label} event type`);
    assertIncludes(normalized, event.reasonCode, `${label} event reason`);
  }

  for (const expected of expectedText) {
    assertIncludes(normalized, expected, `${label} expected ${expected}`);
  }

  for (const absent of absentText) {
    assert(!normalized.includes(absent), `${label} absent ${absent}`);
  }

  assertNoUnsafeMutationForms(text, `${label} review action form boundary`);
}

async function assertInvalidAndMissingDetail(runtime, adminJar) {
  const invalid = await getHtml(
    runtime,
    "/admin/reconciliation/items/not-a-uuid",
    { jar: adminJar },
  );
  const missingId = randomUUID();
  const missing = await getHtml(
    runtime,
    `/admin/reconciliation/items/${missingId}`,
    { jar: adminJar },
  );

  for (const [label, result] of [
    ["invalid UUID detail", invalid],
    ["missing UUID detail", missing],
  ]) {
    const normalized = normalizeText(result.text);

    assert(
      result.response.status === 200 || result.response.status === 404,
      `${label} safe status`,
    );
    assertIncludes(normalized, "Reconciliation item not found", label);
    assertIncludes(normalized, "Reconciliation item was not found.", label);
    assertHtmlPublicSafe(result.text, label);
  }

  pass("ADMIN_UI_INVALID_MISSING_DETAIL");
}

async function assertReviewActionSourceContract() {
  const helperSource = readFileSync(
    join(REPO_ROOT, "src/lib/reconciliation/review-actions.ts"),
    "utf8",
  );
  const componentSource = readFileSync(
    join(
      REPO_ROOT,
      "src/app/admin/reconciliation/items/[reconciliationItemId]/_review-actions.tsx",
    ),
    "utf8",
  );

  for (const [index, reasonCode] of REVIEW_ACTION_REASON_CODES.entries()) {
    assertIncludes(helperSource, reasonCode, `reason code source ${index + 1}`);
  }

  assertIncludes(helperSource, "SYSTEM_DERIVED", "system-derived source");
  assertIncludes(componentSource, "crypto.randomUUID()", "idempotency source");
  assertIncludes(componentSource, "router.refresh()", "success refresh source");
  assertIncludes(
    componentSource,
    "Confirm terminal review action",
    "terminal confirmation source",
  );
  assertIncludes(
    componentSource,
    "Confirm {confirmingAction.label}",
    "action-specific confirmation label source",
  );
  assertIncludes(componentSource, "aria-busy", "aria busy source");
  assertIncludes(componentSource, "aria-live", "live region source");
  assertIncludes(componentSource, "<button", "button source");
  assert(!componentSource.includes("window.confirm"), "no window confirm");
  assert(!componentSource.includes("localStorage"), "no localStorage");
  assert(!componentSource.includes("sessionStorage"), "no sessionStorage");
  assert(!componentSource.includes("document.cookie"), "no document cookie");
  assert(!componentSource.includes("console."), "no client log output");
  assert(!/<textarea\b/i.test(componentSource), "no reason textarea source");
  assert(!/<select\b/i.test(componentSource), "no reason selector source");
  assert(!/<form\b/i.test(componentSource), "no Server Action form source");
  assert(
    !/(actorProfileId|actor_profile_id|userId|user_id|authUid|session|auth token)/i.test(
      componentSource,
    ),
    "no caller actor/session source",
  );

  passReviewAction("ADMIN_UI_REVIEW_ACTION_SOURCE_CONTRACT");
}

async function assertReviewActionFixtureMatrix(runtime, adminJar, fixture) {
  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: ["Start Review", "Resolve", "Ignore"],
    itemId: fixture.reviewActionMismatchItemId,
    label: "MISMATCH no-case action matrix",
    present: ["Open Review"],
  });
  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: ["Start Review", "Resolve", "Ignore"],
    itemId: fixture.noReviewItemId,
    label: "OBSERVATION_FAILED no-case action matrix",
    present: ["Open Review"],
  });
  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: REVIEW_ACTION_LABELS,
    itemId: fixture.hugeItemId,
    label: "MATCHED no-case action matrix",
    present: [],
  });
  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: REVIEW_ACTION_LABELS,
    itemId: fixture.bindingItemId,
    label: "WITHIN_TOLERANCE no-case action matrix",
    present: [],
  });
  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: ["Open Review", "Start Review"],
    itemId: fixture.reviewedItemId,
    label: "IN_REVIEW action matrix",
    present: ["Resolve", "Ignore"],
  });

  passReviewAction("ADMIN_UI_REVIEW_ACTION_FIXTURE_MATRIX");
}

async function assertReviewActionMutationFlows(runtime, adminJar, fixture) {
  await assertVersionConflict(runtime, adminJar, fixture);
  await assertOpenStartResolveFlow(runtime, adminJar, fixture);
  await assertOpenIgnoreFlow(runtime, adminJar, fixture);
  passReviewAction("ADMIN_UI_REVIEW_ACTION_MUTATION_FLOWS");
}

async function assertVersionConflict(runtime, adminJar, fixture) {
  const before = await runtime.readSideEffectSnapshot(fixture);
  const detail = await runtime.getDetail(adminJar, fixture.reviewedItemId);
  const reviewCase = detail.result.reviewCase;

  assert(reviewCase?.status === "IN_REVIEW", "version conflict fixture IN_REVIEW");

  const result = await postReviewTransitionExpectError(runtime, adminJar, {
    expectedCode: "reconciliation_review_version_conflict",
    expectedStatus: 409,
    expectedVersion: reviewCase.version - 1,
    reasonCode: "REVIEW_ASSESSMENT_COMPLETED",
    reviewCaseId: reviewCase.id,
    targetStatus: "RESOLVED",
  });
  const after = await runtime.readSideEffectSnapshot(fixture);

  assert(result.payload?.ok === false, "version conflict error envelope");
  assertDeepEqual(
    before,
    after,
    "version conflict side-effect zero",
    "REQUIRES_ACTION_REVIEW_ACTION_UI_DEFECT",
  );
  passReviewAction("ADMIN_UI_REVIEW_ACTION_VERSION_CONFLICT");
}

async function assertOpenStartResolveFlow(runtime, adminJar, fixture) {
  const itemId = fixture.reviewActionMismatchItemId;

  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: ["Start Review", "Resolve", "Ignore"],
    itemId,
    label: "flow1 initial MISMATCH",
    present: ["Open Review"],
  });

  const beforeOpen = await runtime.readSideEffectSnapshot(fixture);
  const openBody = createOpenReviewBody(
    itemId,
    "BALANCE_MISMATCH_REVIEW_OPENED",
  );
  const open = await postReviewOpen(runtime, adminJar, openBody, "flow1 open");
  const afterOpen = await runtime.readSideEffectSnapshot(fixture);

  assert(open.status === "OPEN", "flow1 open status");
  assert(open.version === 1, "flow1 open version");
  assertReviewOnlySideEffects(beforeOpen, afterOpen, {
    caseDelta: 1,
    eventDelta: 1,
    label: "flow1 open side effects",
  });

  const replayOpen = await postReviewOpen(runtime, adminJar, openBody, "flow1 open replay");

  assert(replayOpen.created === false, "flow1 open replay created false");
  assertDeepEqual(
    afterOpen,
    await runtime.readSideEffectSnapshot(fixture),
    "flow1 open replay side-effect zero",
    "REQUIRES_ACTION_REVIEW_ACTION_UI_DEFECT",
  );

  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: ["Open Review"],
    itemId,
    label: "flow1 OPEN matrix",
    present: ["Start Review", "Resolve", "Ignore"],
  });

  const beforeStart = await runtime.readSideEffectSnapshot(fixture);
  const startBody = createTransitionReviewBody({
    expectedVersion: 1,
    reasonCode: "MANUAL_REVIEW_STARTED",
    reviewCaseId: open.reviewCaseId,
    targetStatus: "IN_REVIEW",
  });
  const started = await postReviewTransition(
    runtime,
    adminJar,
    startBody,
    "flow1 start",
  );
  const afterStart = await runtime.readSideEffectSnapshot(fixture);

  assert(started.status === "IN_REVIEW", "flow1 start status");
  assert(started.version === 2, "flow1 start version");
  assertReviewOnlySideEffects(beforeStart, afterStart, {
    caseDelta: 0,
    eventDelta: 1,
    label: "flow1 start side effects",
  });

  const replayStart = await postReviewTransition(
    runtime,
    adminJar,
    startBody,
    "flow1 start replay",
  );

  assert(replayStart.created === false, "flow1 start replay created false");
  assertDeepEqual(
    afterStart,
    await runtime.readSideEffectSnapshot(fixture),
    "flow1 start replay side-effect zero",
    "REQUIRES_ACTION_REVIEW_ACTION_UI_DEFECT",
  );

  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: ["Open Review", "Start Review"],
    itemId,
    label: "flow1 IN_REVIEW matrix",
    present: ["Resolve", "Ignore"],
  });

  const beforeResolve = await runtime.readSideEffectSnapshot(fixture);
  const resolved = await postReviewTransition(
    runtime,
    adminJar,
    createTransitionReviewBody({
      expectedVersion: 2,
      reasonCode: "REVIEW_ASSESSMENT_COMPLETED",
      reviewCaseId: open.reviewCaseId,
      targetStatus: "RESOLVED",
    }),
    "flow1 resolve",
  );
  const afterResolve = await runtime.readSideEffectSnapshot(fixture);

  assert(resolved.status === "RESOLVED", "flow1 resolved status");
  assert(resolved.version === 3, "flow1 resolved version");
  assertReviewOnlySideEffects(beforeResolve, afterResolve, {
    caseDelta: 0,
    eventDelta: 1,
    label: "flow1 resolve side effects",
  });

  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: REVIEW_ACTION_LABELS,
    itemId,
    label: "flow1 RESOLVED matrix",
    present: [],
    terminalText: "This review case is terminal.",
  });

  passReviewAction("ADMIN_UI_REVIEW_ACTION_OPEN_START_RESOLVE_FLOW");
}

async function assertOpenIgnoreFlow(runtime, adminJar, fixture) {
  const itemId = fixture.noReviewItemId;
  const beforeOpen = await runtime.readSideEffectSnapshot(fixture);
  const opened = await postReviewOpen(
    runtime,
    adminJar,
    createOpenReviewBody(itemId, "OBSERVATION_FAILURE_REVIEW_OPENED"),
    "flow2 open",
  );
  const afterOpen = await runtime.readSideEffectSnapshot(fixture);

  assert(opened.status === "OPEN", "flow2 open status");
  assertReviewOnlySideEffects(beforeOpen, afterOpen, {
    caseDelta: 1,
    eventDelta: 1,
    label: "flow2 open side effects",
  });

  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: ["Open Review"],
    itemId,
    label: "flow2 OPEN matrix",
    present: ["Start Review", "Resolve", "Ignore"],
  });

  const beforeIgnore = await runtime.readSideEffectSnapshot(fixture);
  const ignored = await postReviewTransition(
    runtime,
    adminJar,
    createTransitionReviewBody({
      expectedVersion: 1,
      reasonCode: "NO_FURTHER_REVIEW_REQUIRED",
      reviewCaseId: opened.reviewCaseId,
      targetStatus: "IGNORED",
    }),
    "flow2 ignore",
  );
  const afterIgnore = await runtime.readSideEffectSnapshot(fixture);

  assert(ignored.status === "IGNORED", "flow2 ignored status");
  assertReviewOnlySideEffects(beforeIgnore, afterIgnore, {
    caseDelta: 0,
    eventDelta: 1,
    label: "flow2 ignore side effects",
  });

  await assertReviewActionDetailMatrix(runtime, adminJar, {
    absent: REVIEW_ACTION_LABELS,
    itemId,
    label: "flow2 IGNORED matrix",
    present: [],
    terminalText: "This review case is terminal.",
  });

  passReviewAction("ADMIN_UI_REVIEW_ACTION_OPEN_IGNORE_FLOW");
}

async function assertReviewActionDetailMatrix(
  runtime,
  adminJar,
  { absent, itemId, label, present, terminalText = null },
) {
  const path = `/admin/reconciliation/items/${itemId}`;
  const { text } = await getHtml(runtime, path, { jar: adminJar });

  assertNoUnsafeMutationForms(text, `${label} unsafe mutation form boundary`);
  assertReviewActionLabels(text, { absent, label, present, terminalText });
  assertHtmlPublicSafe(text, `${label} public safe`);
}

function assertReviewActionLabels(
  html,
  { absent, label, present, terminalText = null },
) {
  const buttons = extractButtons(html).map((text) => normalizeWhitespace(text));
  const normalized = normalizeText(html);

  for (const expected of present) {
    assert(buttons.includes(expected), `${label} button ${expected}`);
  }

  for (const marker of absent) {
    assert(!buttons.includes(marker), `${label} no button ${marker}`);
  }

  for (const marker of REVIEW_CONFIRMATION_LABELS) {
    assert(!buttons.includes(marker), `${label} no initial confirmation ${marker}`);
  }

  if (terminalText) {
    assertIncludes(normalized, terminalText, `${label} terminal text`);
  }

  assert(
    !/\bname=["'][^"']*reason[^"']*["']/i.test(html),
    `${label} no reason field`,
  );
  assert(!/<textarea\b/i.test(html), `${label} no textarea`);
  assert(!/<select\b/i.test(html), `${label} no selector`);
  assert(
    !/\b(action|formaction)=["'][^"']*\/api\/v1\/admin\/reconciliation\/reviews/i.test(
      html,
    ),
    `${label} no review API form action`,
  );
}

function assertNoUnsafeMutationForms(html, label) {
  const forms = extractForms(html);

  for (const form of forms) {
    assert(
      form.method === "get" && form.action === "/admin/reconciliation",
      `${label} form ${form.method} ${form.action}`,
    );
  }

  for (const marker of MUTATION_FIELD_DENYLIST) {
    assert(!html.includes(marker), `${label} no ${marker}`);
  }

  for (const marker of [
    "ledger correction",
    "balance correction",
    "observation overwrite",
    "reconciliation rerun",
    "financial posting",
    "provider action",
    "wallet signing",
  ]) {
    assert(
      !normalizeText(html).toLowerCase().includes(marker),
      `${label} no ${marker}`,
    );
  }

  assert(!/<textarea\b/i.test(html), `${label} no textarea`);
  assert(!/<select\b/i.test(html), `${label} no selector`);
  assert(
    !/\b(action|formaction)=["'][^"']*\/api\/v1\/admin\/reconciliation\/reviews/i.test(
      html,
    ),
    `${label} no review API form action`,
  );
  assert(
    !/\bname=["'](?:actorProfileId|actor_profile_id|idempotencyKey|idempotency_key|expectedVersion|expected_version|targetStatus|target_status|status|version)["']/i.test(
      html,
    ),
    `${label} no caller/raw mutation input`,
  );
}

async function postReviewOpen(runtime, adminJar, body, label) {
  const result = await runtime.appJsonPost(
    "/api/v1/admin/reconciliation/reviews/open",
    { jar: adminJar, body },
  );

  return assertReviewApiOk(result, label);
}

async function postReviewTransition(runtime, adminJar, body, label) {
  const result = await runtime.appJsonPost(
    "/api/v1/admin/reconciliation/reviews/transition",
    { jar: adminJar, body },
  );

  return assertReviewApiOk(result, label);
}

async function postReviewTransitionExpectError(
  runtime,
  adminJar,
  { expectedCode, expectedStatus, expectedVersion, reasonCode, reviewCaseId, targetStatus },
) {
  const result = await runtime.appJsonPost(
    "/api/v1/admin/reconciliation/reviews/transition",
    {
      jar: adminJar,
      body: createTransitionReviewBody({
        expectedVersion,
        reasonCode,
        reviewCaseId,
        targetStatus,
      }),
    },
  );

  assertReviewApiError(result, {
    expectedCode,
    expectedStatus,
    label: "review transition expected error",
  });

  return result;
}

function assertReviewApiOk({ response, payload }, label) {
  reviewApiMutationCaseCount += 1;

  assert(response.status === 200, `${label} HTTP 200`);
  assertNoStoreJsonResponse(response, label);
  assert(isPlainRecord(payload), `${label} JSON payload`);
  assert(payload.ok === true, `${label} ok true`);
  assert(isPlainRecord(payload.result), `${label} result object`);

  const result = payload.result;

  assert(isUuid(result.reviewCaseId), `${label} review case id`);
  assert(isUuid(result.eventId), `${label} event id`);
  assert(typeof result.created === "boolean", `${label} created boolean`);
  assert(typeof result.status === "string", `${label} status string`);
  assert(Number.isInteger(result.version), `${label} version integer`);

  return result;
}

function assertReviewApiError(
  { response, payload },
  { expectedCode, expectedStatus, label },
) {
  reviewApiMutationCaseCount += 1;

  assert(response.status === expectedStatus, `${label} HTTP ${expectedStatus}`);
  assertNoStoreJsonResponse(response, label);
  assert(isPlainRecord(payload), `${label} JSON payload`);
  assert(payload.ok === false, `${label} ok false`);
  assert(isPlainRecord(payload.error), `${label} error object`);
  assert(payload.error.code === expectedCode, `${label} public code`);
  assert(Object.keys(payload.error).length === 1, `${label} public error only`);
}

function assertNoStoreJsonResponse(response, label) {
  const cacheControl = response.headers.get("cache-control") ?? "";

  assert(readContentTypeMediaType(response) === "application/json", `${label} JSON`);
  assert(cacheControl.toLowerCase().includes("no-store"), `${label} no-store`);
}

function createOpenReviewBody(reconciliationItemId, reasonCode) {
  return {
    idempotencyKey: randomUUID(),
    reasonCode,
    reconciliationItemId,
  };
}

function createTransitionReviewBody({
  expectedVersion,
  reasonCode,
  reviewCaseId,
  targetStatus,
}) {
  return {
    expectedVersion,
    idempotencyKey: randomUUID(),
    reasonCode,
    reviewCaseId,
    targetStatus,
  };
}

function assertReviewOnlySideEffects(
  before,
  after,
  { caseDelta, eventDelta, label },
) {
  for (const key of [
    "sourceDigest",
    "memberDigest",
    "runs",
    "items",
    "members",
    "balanceObservations",
    "transactionObservations",
    "observerCheckpoints",
    "ledgerAccounts",
    "ledgerJournals",
    "ledgerEntries",
    "ledgerBalances",
  ]) {
    assert(after[key] === before[key], `${label} ${key} unchanged`);
  }

  assert(
    Number(after.cases) === Number(before.cases) + caseDelta,
    `${label} review case delta`,
  );
  assert(
    Number(after.events) === Number(before.events) + eventDelta,
    `${label} review event delta`,
  );

  if (caseDelta === 0 && eventDelta === 0) {
    assert(after.reviewDigest === before.reviewDigest, `${label} review unchanged`);
  }
}

async function assertReadOnlyBoundary(runtime, adminJar, fixture) {
  const list = await getHtml(runtime, "/admin/reconciliation", { jar: adminJar });

  assertNoMutationForms(list.text, "/admin/reconciliation read-only boundary");
  assertHtmlPublicSafe(list.text, "/admin/reconciliation public safe");

  const detailPath = `/admin/reconciliation/items/${fixture.reviewedItemId}`;
  const detail = await getHtml(runtime, detailPath, { jar: adminJar });

  assertNoUnsafeMutationForms(detail.text, `${detailPath} review action boundary`);
  assertReviewActionLabels(detail.text, {
    absent: ["Open Review", "Start Review"],
    label: `${detailPath} review action boundary`,
    present: ["Resolve", "Ignore"],
  });
  assertHtmlPublicSafe(detail.text, `${detailPath} public safe`);

  pass("ADMIN_UI_READ_ONLY_BOUNDARY");
}

async function assertPageMethodBoundary(runtime, adminJar, fixture) {
  for (const path of [
    "/admin/reconciliation",
    `/admin/reconciliation/items/${fixture.reviewedItemId}`,
  ]) {
    const marker = `P5UI_POST_BODY_PROBE_${randomUUID().replaceAll("-", "")}`;
    const before = await runtime.readSideEffectSnapshot(fixture);
    const result = await runtime.appFetch(path, {
      jar: adminJar,
      method: "POST",
      body: {
        adminUiPostProbe: marker,
      },
    });
    const after = await runtime.readSideEffectSnapshot(fixture);
    const sideEffectZero = JSON.stringify(before) === JSON.stringify(after);
    const safety = evaluatePostMethodBoundary(path, result, marker);

    emitPostMethodBoundaryDiagnostics(path, result, {
      readOnlySafe: safety.ok,
      sideEffectZero,
    });

    if (!safety.ok) {
      throw safety.error;
    }

    assert(
      sideEffectZero,
      `${path} POST side-effect zero`,
      "REQUIRES_ACTION_ADMIN_UI_RUNTIME_DEFECT",
    );
  }

  pass("ADMIN_UI_METHOD_BOUNDARY");
}

function evaluatePostMethodBoundary(path, result, marker) {
  try {
    assertPostMethodBoundary(path, result, marker);

    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

function assertPostMethodBoundary(path, { response, text }, marker) {
  const status = response.status;

  assertHtmlPublicSafe(text, `${path} POST public safe`);
  assert(!text.includes("ok\":true"), `${path} POST no ok true`);

  if (status === 200) {
    assertPostReadOnlyHtml(path, response, text, marker);
    return;
  }

  if ([303, 307, 308].includes(status)) {
    assertPostSafeRedirect(path, response);
    return;
  }

  if ([404, 405].includes(status)) {
    return;
  }

  assert(false, `${path} POST unsupported status ${status}`);
}

function assertPostReadOnlyHtml(path, response, text, marker) {
  const finalPath = safeUrlPath(response.url);
  const normalized = normalizeText(text);

  assert(
    !response.redirected || finalPath === path,
    `${path} POST 200 redirect boundary`,
  );
  assert(finalPath === path, `${path} POST 200 final path`);
  assert(readContentTypeMediaType(response) === "text/html", `${path} POST 200 html`);
  assert(classifyResponseBody(text, response) === "HTML", `${path} POST 200 body html`);
  assert(!text.includes(marker), `${path} POST body not reflected`);
  if (path === "/admin/reconciliation") {
    assertNoMutationForms(text, `${path} POST read-only forms`);
  } else {
    assertNoUnsafeMutationForms(text, `${path} POST review action form boundary`);
  }
  assertNoMutationSuccessText(normalized, `${path} POST no mutation success`);

  if (path === "/admin/reconciliation") {
    assertIncludes(normalized, "Reconciliation", `${path} POST list title`);
    assertIncludes(normalized, "Filters", `${path} POST list filters`);
    assertIncludes(
      normalized,
      "Reconciliation items",
      `${path} POST list table`,
    );
    return;
  }

  assert(
    normalized.toLowerCase().includes("reconciliation item"),
    `${path} POST detail title`,
  );
  assertIncludes(normalized, "Run", `${path} POST detail run`);
  assertIncludes(normalized, "Item", `${path} POST detail item`);
  assertIncludes(normalized, "Provenance", `${path} POST detail provenance`);
  assertIncludes(normalized, "Review", `${path} POST detail review`);
}

function assertPostSafeRedirect(path, response) {
  const location = response.headers.get("location");

  assert(location, `${path} POST redirect location`);

  const locationUrl = new URL(location, APP_ORIGIN);

  assert(locationUrl.origin === APP_ORIGIN, `${path} POST redirect same-origin`);
  assert(
    locationUrl.pathname === path ||
      locationUrl.pathname === "/admin" ||
      locationUrl.pathname.startsWith("/admin/reconciliation"),
    `${path} POST redirect safe route`,
  );
}

function assertNoMutationSuccessText(text, label) {
  for (const marker of [
    "Review opened",
    "Review transitioned",
    "Review resolved",
    "Review ignored",
    "Ledger updated",
    "Mutation complete",
  ]) {
    assert(!text.includes(marker), `${label} ${marker}`);
  }
}

function emitPostMethodBoundaryDiagnostics(
  path,
  { response, text },
  { readOnlySafe, sideEffectZero },
) {
  console.log(`ADMIN_UI_POST_PATH=${path}`);
  console.log(`ADMIN_UI_POST_STATUS=${response.status}`);
  console.log(`ADMIN_UI_POST_REDIRECTED=${response.redirected ? "true" : "false"}`);
  console.log(`ADMIN_UI_POST_FINAL_PATH=${safeUrlPath(response.url)}`);
  console.log(
    `ADMIN_UI_POST_LOCATION_PATH=${safeHeaderLocationPath(
      response.headers.get("location"),
    )}`,
  );
  console.log(
    `ADMIN_UI_POST_CONTENT_TYPE=${readContentTypeMediaType(response)}`,
  );
  console.log(`ADMIN_UI_POST_BODY_KIND=${classifyResponseBody(text, response)}`);
  console.log(`ADMIN_UI_POST_READ_ONLY_SAFE=${readOnlySafe ? "true" : "false"}`);
  console.log(`ADMIN_UI_POST_SIDE_EFFECT_ZERO=${sideEffectZero ? "true" : "false"}`);
}

function safeUrlPath(value) {
  try {
    return new URL(value, APP_ORIGIN).pathname;
  } catch {
    return "NONE";
  }
}

function safeHeaderLocationPath(value) {
  if (!value) {
    return "NONE";
  }

  return safeUrlPath(value);
}

function readContentTypeMediaType(response) {
  const contentType = response.headers.get("content-type");
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();

  return mediaType || "OTHER";
}

function classifyResponseBody(text, response) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "EMPTY";
  }

  const mediaType = readContentTypeMediaType(response);

  if (
    mediaType === "application/json" ||
    mediaType.endsWith("+json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    return "JSON";
  }

  if (
    mediaType === "text/html" ||
    /^<!doctype html/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed)
  ) {
    return "HTML";
  }

  return "OTHER";
}

async function assertListQueryMatchesApi(runtime, adminJar, fixture, query, label) {
  const apiPayload = await runtime.getList(adminJar, query);
  const { response, text } = await getHtml(
    runtime,
    `/admin/reconciliation${query}`,
    { jar: adminJar },
  );

  assert(response.status === 200, `${label} filter HTTP 200`);
  assertUiListMatchesApi(text, apiPayload.result.items, fixture, label);

  const queryParams = new URLSearchParams(query);

  for (const [key, value] of queryParams.entries()) {
    if (key !== "cursor") {
      assert(
        text.includes(escapeHtmlAttribute(value)) || normalizeText(text).includes(value),
        `${label} filter value retained ${key}`,
      );
    }
  }
}

function assertUiListMatchesApi(text, apiItems, fixture, label) {
  const normalized = normalizeText(text);
  const expectedIds = apiItems.map((item) => item.reconciliationItemId);

  for (const item of apiItems) {
    assertIncludes(
      text,
      `/admin/reconciliation/items/${item.reconciliationItemId}`,
      `${label} detail href ${item.reconciliationItemId}`,
    );
    assertIncludes(normalized, item.asset.assetCode, `${label} asset code`);
    assertIncludes(normalized, item.asset.symbol, `${label} symbol`);
    assertIncludes(normalized, item.runStatus, `${label} run status`);
    assertIncludes(normalized, item.scopeKind, `${label} scope`);
    assertIncludes(normalized, item.classification, `${label} classification`);
    assertIncludes(
      normalized,
      item.reviewStatus ?? "NONE",
      `${label} review status`,
    );
    assertIncludes(
      normalized,
      `${item.targetBindingCount} / ${item.observedBindingCount} / ${item.missingBindingCount} / ${item.failedBindingCount}`,
      `${label} provenance count`,
    );
  }

  for (const id of fixture.expectedOrder) {
    if (!expectedIds.includes(id)) {
      assert(
        !text.includes(`/admin/reconciliation/items/${id}`),
        `${label} excludes ${id}`,
      );
    }
  }
}

function assertHtmlDetailLinks(text, apiItems, label) {
  const links = extractLinks(text);

  for (const item of apiItems) {
    assert(
      links.some(
        (link) =>
          link.href === `/admin/reconciliation/items/${item.reconciliationItemId}` &&
          normalizeWhitespace(link.text) === "Open",
      ),
      `${label} link ${item.reconciliationItemId}`,
    );
  }
}

async function getHtml(runtime, path, { jar } = {}) {
  const result = await runtime.appGet(path, { jar });

  assertHtmlPublicSafe(result.text, path);

  return result;
}

function uiPaths(fixture) {
  return [
    "/admin",
    "/admin/reconciliation",
    `/admin/reconciliation/items/${fixture.reviewedItemId}`,
  ];
}

function assertRedirectTo(response, expectedPath, label) {
  assertRedirectToAny(response, [expectedPath], label);
}

function assertRedirectToAny(response, expectedPaths, label) {
  assert(
    [303, 307, 308].includes(response.status),
    `${label} status`,
    "REQUIRES_ACTION_ADMIN_AUTH_RUNTIME_DEFECT",
  );

  const location = response.headers.get("location");

  assert(location, `${label} location`, "REQUIRES_ACTION_ADMIN_AUTH_RUNTIME_DEFECT");

  const locationPath = new URL(location, APP_ORIGIN).pathname;

  assert(
    expectedPaths.includes(locationPath),
    `${label} path`,
    "REQUIRES_ACTION_ADMIN_AUTH_RUNTIME_DEFECT",
  );
}

function allowedRouteMarkers(path, fixture) {
  return path.includes(fixture.reviewedItemId) ? [fixture.reviewedItemId] : [];
}

function assertNoFixtureLeak(text, fixture, label, allowedMarkers = []) {
  const fixtureMarkers = [
    fixture.reviewedItemId,
    fixture.noReviewItemId,
    fixture.bindingItemId,
    fixture.assetAId,
    fixture.assetBId,
  ];

  for (const marker of fixtureMarkers) {
    if (allowedMarkers.includes(marker)) {
      continue;
    }

    assert(!text.includes(marker), `${label} no fixture marker`);
  }
}

function assertNoMutationForms(html, label) {
  const forms = extractForms(html);

  for (const form of forms) {
    assert(
      form.method === "get" && form.action === "/admin/reconciliation",
      `${label} form ${form.method} ${form.action}`,
    );
  }

  const interactiveLabels = [
    ...extractLinks(html).map((link) => link.text),
    ...extractButtons(html),
  ];

  for (const marker of LIST_MUTATION_LABEL_DENYLIST) {
    assert(
      !interactiveLabels.some((text) => normalizeWhitespace(text) === marker),
      `${label} no ${marker}`,
    );
  }

  for (const marker of MUTATION_FIELD_DENYLIST) {
    assert(!html.includes(marker), `${label} no ${marker}`);
  }

  assert(
    !/action=["'][^"']*\/api\/v1\/admin\/reconciliation\/reviews/i.test(html),
    `${label} no review API action`,
  );
  assert(
    !/name=["'](?:actorProfileId|actor_profile_id|idempotencyKey|idempotency_key)["']/i.test(
      html,
    ),
    `${label} no hidden actor/idempotency field`,
  );
}

function assertHtmlPublicSafe(html, label) {
  const lowered = html.toLowerCase();

  for (const marker of HTML_PUBLIC_DENYLIST) {
    assert(
      !lowered.includes(marker.toLowerCase()),
      `${label} no ${marker}`,
      "REQUIRES_ACTION_ADMIN_UI_RUNTIME_DEFECT",
    );
  }
}

function assertNumericRender(text, label) {
  assertIncludes(text, "atomic units", `${label} atomic label`);
  assert(!text.includes("1.2345678901234568e"), `${label} no scientific notation`);
  assert(!text.includes("NaN"), `${label} no NaN`);
  assert(!text.includes("Infinity"), `${label} no Infinity`);
  assert(!text.includes("[object Object]"), `${label} no object string`);
}

function extractLinks(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => {
    const attrs = readAttributes(match[1]);

    return {
      href: decodeHtmlEntities(attrs.href ?? ""),
      text: normalizeText(match[2]),
    };
  });
}

function extractForms(html) {
  return [...html.matchAll(/<form\b([^>]*)>/gi)].map((match) => {
    const attrs = readAttributes(match[1]);

    return {
      action: decodeHtmlEntities(attrs.action ?? ""),
      method: (attrs.method ?? "get").toLowerCase(),
    };
  });
}

function extractButtons(html) {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map(
    (match) => normalizeText(match[1]),
  );
}

function hasFormControl(html, name) {
  const escaped = escapeRegExp(name);

  return new RegExp(`\\bname=["']${escaped}["']`, "i").test(html);
}

function hasPostFormAction(html, action) {
  return extractForms(html).some(
    (form) => form.method === "post" && form.action === action,
  );
}

function readAttributes(rawAttributes) {
  const attrs = {};

  for (const match of rawAttributes.matchAll(
    /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
  )) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? "");
  }

  return attrs;
}

function normalizeText(html) {
  const withoutScripts = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");

  return normalizeWhitespace(decodeHtmlEntities(withoutTags));
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sqlUuid(value) {
  return `${sqlLiteral(value)}::uuid`;
}

function sqlNumeric(value) {
  return `${sqlLiteral(value)}::numeric`;
}

function sqlTimestamp(value) {
  return `${sqlLiteral(value)}::timestamptz`;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function isPlainRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value),
  );
}

function compareFixtureItems(left, right) {
  const time = right.itemCreatedAt.localeCompare(left.itemCreatedAt);

  return time || right.id.localeCompare(left.id);
}

function assertIncludes(text, expected, label) {
  assert(String(text).includes(expected), label);
}

function assertDeepEqual(actual, expected, label, finalStatus) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  assert(actualJson === expectedJson, label, finalStatus);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assert(condition, label, finalStatus = "REQUIRES_ACTION_ADMIN_UI_RUNTIME_DEFECT") {
  if (!condition) {
    throw finalError(finalStatus, label);
  }
}

function pass(label) {
  uiPassCount += 1;
  console.log(`PASS ${label}`);
}

function passReviewAction(label) {
  reviewActionPassCount += 1;
  pass(label);
}

function finalError(finalStatus, label) {
  const error = new Error(`FAIL ${label}`);

  error.finalStatus = finalStatus;

  return error;
}

function readFinalStatus(error) {
  const status = typeof error?.finalStatus === "string"
    ? error.finalStatus
    : "REQUIRES_ACTION";

  if (status === "BLOCKED_RUNTIME_PORT_IN_USE") {
    return "BLOCKED_ADMIN_UI_RUNTIME_PORT_IN_USE";
  }

  if (status === "REQUIRES_ACTION_RUNTIME_CLEANUP_FAILED") {
    return "REQUIRES_ACTION_ADMIN_UI_RUNTIME_CLEANUP_FAILED";
  }

  if (status === "REQUIRES_ACTION_APPLICATION_READ_RUNTIME_DEFECT") {
    return "REQUIRES_ACTION_ADMIN_READ_RUNTIME_DEFECT";
  }

  return status;
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
      "[REDACTED_UUID]",
    )
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(
      /(access_token|refresh_token|cookie|set-cookie|secret|key|password)\s*[:=]\s*[^,\s]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 300);
}

main().catch((error) => {
  const finalStatus = readFinalStatus(error);
  const message = error instanceof Error ? error.message : "FAIL unknown";

  if (message.startsWith("FAIL ")) {
    console.error(redactSensitiveText(message));
  } else {
    console.error(`ADMIN_UI_RUNTIME_FAILURE_MESSAGE=${redactSensitiveText(message)}`);
    console.error("FAIL admin reconciliation UI runtime");
  }

  console.error(`FINAL_STATUS=${finalStatus}`);
  process.exitCode = 1;
});
