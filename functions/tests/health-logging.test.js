const test = require("node:test");
const assert = require("node:assert/strict");

const { classify, signature, sourceOf, ALWAYS_REPORT } = require("../lib/health/logging");

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

test("signature falls back jsonPayload.message -> jsonPayload.error -> textPayload -> protoPayload.status.message -> severity", () => {
  assert.equal(signature({ jsonPayload: { message: "from message" } }), "from message");
  assert.equal(signature({ jsonPayload: { error: "from error" } }), "from error");
  assert.equal(signature({ textPayload: "from text" }), "from text");
  assert.equal(
    signature({ protoPayload: { status: { message: "from proto" } } }),
    "from proto"
  );
  assert.equal(signature({ severity: "ERROR" }), "ERROR");
  assert.equal(signature({}), "ERROR");
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

test("ALWAYS_REPORT contains exactly the five quiet-but-important kinds", () => {
  assert.deepEqual(
    [...ALWAYS_REPORT].sort(),
    ["billing", "deploy_failure", "missing_index", "quota_exhausted", "rules_denied"].sort()
  );
});
