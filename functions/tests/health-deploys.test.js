const test = require("node:test");
const assert = require("node:assert/strict");

// deploys.js calls auth.js's apiGet directly (no injectable client), same
// as iam.js -- these tests stub global fetch, matching health-iam.test.js's
// sibling health-auth.test.js approach for exercising apiGet's own 403/404
// handling. Here we only need to prove collectDeploys wires that contract
// correctly, since apiGet's retry/403 semantics are already covered there.

function mockFetchOnce(response) {
  global.fetch = async () => response;
}

function jsonResponse(status, body) {
  return {
    status,
    statusText: "",
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let collectDeploys;
test.before(() => {
  ({ collectDeploys } = require("../lib/health/deploys"));
});

test("collectDeploys maps each Cloud Run service to its updateTime, lowercased by name", async () => {
  mockFetchOnce(
    jsonResponse(200, {
      services: [
        { name: "projects/p/locations/us-central1/services/onstudiocreated", updateTime: "2026-09-15T10:00:00Z" },
        { name: "projects/p/locations/us-central1/services/getStatistics", updateTime: "2026-09-14T08:00:00Z" },
      ],
    })
  );
  const out = await collectDeploys("p", "token");
  assert.equal(out.onstudiocreated, "2026-09-15T10:00:00Z");
  // Cloud Run names are already lowercase in practice, but the map key
  // itself is still lowercased defensively -- the caller (analyze.js) folds
  // case on its own side of the join too.
  assert.equal(out.getstatistics, "2026-09-14T08:00:00Z");
});

test("collectDeploys falls back to createTime when a service has no updateTime", async () => {
  mockFetchOnce(
    jsonResponse(200, {
      services: [{ name: "projects/p/locations/us-central1/services/svc", createTime: "2026-01-01T00:00:00Z" }],
    })
  );
  const out = await collectDeploys("p", "token");
  assert.equal(out.svc, "2026-01-01T00:00:00Z");
});

test("collectDeploys returns {} when the Cloud Run API is disabled on this project (404/SERVICE_DISABLED)", async () => {
  mockFetchOnce(jsonResponse(404, {}));
  const out = await collectDeploys("p", "token");
  assert.deepEqual(out, {});
});

test("collectDeploys returns {} on a real 403 (run.viewer not landed yet) instead of throwing into the sweep", async () => {
  mockFetchOnce(jsonResponse(403, { error: { message: "Permission denied" } }));
  const out = await collectDeploys("p", "token");
  assert.deepEqual(out, {}, "a missing grant must degrade this collector only, never take the project's other findings down");
});

test("collectDeploys returns {} for a project with no Cloud Run services at all", async () => {
  mockFetchOnce(jsonResponse(200, { services: [] }));
  const out = await collectDeploys("p", "token");
  assert.deepEqual(out, {});
});

test("collectDeploys returns {} for a service payload missing the services array entirely", async () => {
  mockFetchOnce(jsonResponse(200, {}));
  const out = await collectDeploys("p", "token");
  assert.deepEqual(out, {});
});
