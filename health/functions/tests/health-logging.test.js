const test = require("node:test");
const assert = require("node:assert/strict");

const {
  readErrors,
  classify,
  signature,
  sourceOf,
  ALWAYS_REPORT,
  SELF_AUDIT_TYPES,
  isSelfAuditDenial,
  NO_MESSAGE,
} = require("../lib/logging");
const { LEVEL_BY_KIND } = require("../lib/config");

test("signature collapses a UUID, a hex address, and a long number so repeated errors of the same shape produce one signature", () => {
  const a = {
    textPayload:
      "Error processing request 123456789 at 0xdeadbeef for user 550e8400-e29b-41d4-a716-446655440000",
  };
  const b = {
    textPayload:
      "Error processing request 987654321 at 0xfeedface for user 6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  };
  assert.equal(signature(a), signature(b));
});

test("signature falls back jsonPayload -> textPayload -> protoPayload before giving up", () => {
  assert.equal(signature({ jsonPayload: { message: "from message" } }), "from message");
  assert.equal(signature({ jsonPayload: { error: "from error" } }), "from error");
  assert.equal(signature({ jsonPayload: { msg: "from msg" } }), "from msg");
  assert.equal(signature({ jsonPayload: { event_message: "from event" } }), "from event");
  assert.equal(signature({ jsonPayload: { description: "from description" } }), "from description");
  assert.equal(signature({ jsonPayload: { error: { message: "from nested" } } }), "from nested");
  assert.equal(signature({ textPayload: "from text" }), "from text");
  assert.equal(
    signature({ protoPayload: { status: { message: "from proto" } } }),
    "from proto"
  );
});

test("an audit entry with no message still names the call that failed", () => {
  assert.equal(
    signature({ protoPayload: { methodName: "google.iam.admin.v1.CreateServiceAccountKey" } }),
    "google.iam.admin.v1.CreateServiceAccountKey failed"
  );
});

test("an entry with no readable message says so instead of borrowing its severity", () => {
  // The old fallback was `entry.severity`, which produced a finding whose
  // entire text was the word "ERROR" -- and, via the count rule, a critical
  // one. NO_MESSAGE classifies as `unreadable`, which LEVEL_BY_KIND grades
  // warn: something logged an error, but nothing here says it was critical.
  assert.equal(signature({ severity: "ERROR" }), NO_MESSAGE);
  assert.equal(signature({}), NO_MESSAGE);
  assert.equal(classify(signature({ severity: "ERROR" })), "unreadable");
});

test("signature prefers jsonPayload.message over jsonPayload.error when both are present", () => {
  assert.equal(
    signature({ jsonPayload: { message: "primary", error: "secondary" } }),
    "primary"
  );
});

test("classify returns missing_index for a Firestore index error", () => {
  assert.equal(classify("FAILED_PRECONDITION: The query requires an index."), "missing_index");
});

test("classify returns rules_denied for a permission-denied error", () => {
  assert.equal(classify("PERMISSION_DENIED: Missing or insufficient permissions."), "rules_denied");
});

test("classify returns quota_exhausted for a resource-exhausted error", () => {
  assert.equal(classify("RESOURCE_EXHAUSTED: quota exceeded for reads"), "quota_exhausted");
});

test("classify returns billing for a billing-disabled error", () => {
  assert.equal(classify("BILLING_DISABLED: Cloud Billing has not been enabled for this project."), "billing");
});

test("classify returns deploy_failure for a failed deployment error", () => {
  assert.equal(classify("Deployment failed: container failed to start"), "deploy_failure");
});

test("classify returns deploy_failure for a startup probe failure with no 'container failed to start' substring", () => {
  assert.equal(
    classify('Default STARTUP TCP probe failed 1 time consecutively for container "worker" on port 8080. The instance was not started.'),
    "deploy_failure"
  );
});

test("classify returns other when no known pattern matches", () => {
  assert.equal(classify("Something unrelated went wrong"), "other");
});

test("classify returns the first matching kind in ERROR_KINDS order when a message could match more than one pattern", () => {
  // "requires an index" (missing_index) is listed before the generic patterns,
  // so a message combining both keeps matching the more specific kind.
  assert.equal(classify("FAILED_PRECONDITION: The query requires an index. UNAUTHENTICATED too"), "missing_index");
});

test("sourceOf names the specific function, e.g. function:onStudioCreated", () => {
  const entry = {
    resource: { type: "cloud_function", labels: { function_name: "onStudioCreated" } },
  };
  assert.equal(sourceOf(entry), "function:onStudioCreated");
});

test("sourceOf degrades to the bare short type when no name label is present", () => {
  const entry = { resource: { type: "cloud_function", labels: {} } };
  assert.equal(sourceOf(entry), "function");
});

test("sourceOf falls back to the raw resource type when it has no short name mapping", () => {
  const entry = { resource: { type: "some_unmapped_type", labels: {} } };
  assert.equal(sourceOf(entry), "some_unmapped_type");
});

test("every ALWAYS_REPORT kind has a level, or it would report at `undefined`", () => {
  // analyzeLog reads LEVEL_BY_KIND[kind] straight into the finding for these,
  // with no fallback -- a kind listed here but missing from that table ships a
  // finding with no severity at all. out_of_memory and the other crash-shaped
  // kinds were the reverse of that bug: classified, but in neither table, so
  // they could never earn a named finding however badly something crashed.
  for (const kind of ALWAYS_REPORT) {
    assert.ok(LEVEL_BY_KIND[kind], `ALWAYS_REPORT kind "${kind}" has no LEVEL_BY_KIND entry`);
  }
});

test("ALWAYS_REPORT covers the quiet-but-important kinds, crashes included", () => {
  assert.deepEqual(
    [...ALWAYS_REPORT].sort(),
    [
      "api_key_warning",
      "billing",
      "deploy_failure",
      "function_crash",
      "function_timeout",
      "missing_index",
      "out_of_memory",
      "quota_exhausted",
      "rules_denied",
      "service_account_warning",
      "unauthenticated",
    ].sort()
  );
});

test("classify recognises the permission wording GCP audit logs actually use", () => {
  // Matching only the API-style spellings sent every real permission error to
  // "other", where the count rule graded it critical -- five projects each
  // showed an identical critical row for the sweep's own denied call.
  assert.equal(classify("The caller does not have permission"), "rules_denied");
  assert.equal(classify("INSUFFICIENT_PERMISSIONS errorConfig_gcsPrefix"), "rules_denied");
  assert.equal(classify("PERMISSION_DENIED"), "rules_denied");
  assert.equal(classify("Missing or insufficient permissions"), "rules_denied");
});

test("a Firestore advisory logged at ERROR severity is not treated as a failure", () => {
  assert.equal(
    classify("this index is not necessary, configure using single field index controls"),
    "advisory"
  );
  // Must not be claimed by missing_index, which is a real problem.
  assert.equal(classify("The query requires an index"), "missing_index");
});

test("isSelfAuditDenial drops project-scoped denials only, never a project's own permission errors", () => {
  assert.equal(isSelfAuditDenial("project", "rules_denied"), true);
  // Same denial, but from something the project itself ran -- real, stays.
  assert.equal(isSelfAuditDenial("api", "rules_denied"), false);
  assert.equal(isSelfAuditDenial("function:doThing", "rules_denied"), false);
  // Project-scoped, but not a denial -- e.g. billing disabled. Must survive.
  assert.equal(isSelfAuditDenial("project", "billing"), false);
});

test("a self-audit denial is dropped from errorCount too, not just from the list", async () => {
  // Counting it while hiding it is the worst of both: Overview paints the
  // project red and the Errors tab has nothing to explain why.
  const entries = [
    { resource: { type: "project", labels: {} }, textPayload: "The caller does not have permission" },
    { resource: { type: "cloud_function", labels: { function_name: "doThing" } }, textPayload: "boom" },
  ];
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ entries }) });
  let result;
  try {
    result = await readErrors("proj", 48, "token");
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(result.count, 1);
  assert.equal(result.top.length, 1);
  assert.equal(result.top[0].source, "function:doThing");
  assert.equal(result.sources.project, undefined);
});

test("top carries lastOccurred as the newest entry's own timestamp, not the sweep's read time", async () => {
  // entries:list is requested newest-first (orderBy: "timestamp desc"), so
  // the first of two same-signature entries here is the more recent one.
  const entries = [
    { resource: { type: "cloud_function", labels: { function_name: "doThing" } }, textPayload: "boom", timestamp: "2026-09-17T13:21:41Z" },
    { resource: { type: "cloud_function", labels: { function_name: "doThing" } }, textPayload: "boom", timestamp: "2026-09-17T12:54:32Z" },
  ];
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ entries }) });
  let result;
  try {
    result = await readErrors("proj", 24, "token");
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(result.top.length, 1);
  assert.equal(result.top[0].count, 2);
  assert.equal(result.top[0].lastOccurred, "2026-09-17T13:21:41Z");
});

test("top's lastOccurred is null when an entry carries no timestamp", async () => {
  const entries = [{ resource: { type: "cloud_function", labels: { function_name: "doThing" } }, textPayload: "boom" }];
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ entries }) });
  let result;
  try {
    result = await readErrors("proj", 24, "token");
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(result.top[0].lastOccurred, null);
});

// The sweep runs its BigQuery billing queries from the same project it
// monitors, so a failed query used to come back as an ERROR entry in that
// project's own log feed -- and with criticalErrors = 1, painted the host
// project red for a fault in the checker, not the app.
test("readErrors excludes the BigQuery job-audit types the sweep generates against itself", async () => {
  const original = globalThis.fetch;
  let sentFilter = "";
  globalThis.fetch = async (_url, init) => {
    sentFilter = JSON.parse(init.body).filter;
    return { ok: true, status: 200, json: async () => ({ entries: [] }) };
  };
  try {
    await readErrors("stanimeros-dev", 48, "token");
  } finally {
    globalThis.fetch = original;
  }

  assert.match(sentFilter, /severity>=ERROR/);
  for (const type of SELF_AUDIT_TYPES) {
    assert.ok(
      sentFilter.includes(`resource.type!="${type}"`),
      `filter should exclude ${type}, got: ${sentFilter}`
    );
  }
});

test("SELF_AUDIT_TYPES covers both resource types BigQuery logs one failed job under", () => {
  assert.deepEqual([...SELF_AUDIT_TYPES].sort(), ["bigquery_project", "bigquery_resource"]);
});
