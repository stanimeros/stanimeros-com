const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planLifecycleUpdate,
  docIdFor,
  REOPEN_WINDOW_MS,
  DEPLOY_HISTORY_CAP,
  advanceDeployHistory,
  computeResolvedAfterDeploy,
  buildDeploysByProject,
} = require("../lib/health/lifecycle");

const NOW = new Date("2026-09-16T12:00:00Z");

function finding(key, overrides) {
  return { key, level: "warn", kind: "spike", text: `${key} happened`, ...overrides };
}

function report(projects, projectErrors = []) {
  return { projects, projectErrors };
}

function writesByKey(writes) {
  return new Map(writes.map((w) => [w.key, w.data]));
}

test("a brand-new finding key is written as open, firstSeen = lastSeen = now", () => {
  const projects = [{ project: "proj", findings: [finding("proj:spike:firestore.reads")] }];
  const writes = planLifecycleUpdate(report(projects), new Map(), NOW);

  assert.equal(writes.length, 1);
  const data = writes[0].data;
  assert.equal(data.state, "open");
  assert.equal(data.firstSeen, "2026-09-16T12:00:00Z");
  assert.equal(data.lastSeen, "2026-09-16T12:00:00Z");
  assert.equal(data.runsSeen, 1);
  assert.equal(data.reopenCount, 0);
  assert.equal(data.resolvedAt, null);
  assert.equal(data.ackedUntil, null);
});

test("a key present again updates lastSeen and increments runsSeen without touching firstSeen", () => {
  const key = "proj:spike:firestore.reads";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "spike", text: "old text",
      firstSeen: "2026-09-10T03:00:00Z", lastSeen: "2026-09-16T06:00:00Z",
      state: "open", resolvedAt: null, runsSeen: 5, reopenCount: 0, ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "proj", findings: [finding(key, { text: "new text" })] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open");
  assert.equal(data.firstSeen, "2026-09-10T03:00:00Z");
  assert.equal(data.lastSeen, "2026-09-16T12:00:00Z");
  assert.equal(data.runsSeen, 6);
  assert.equal(data.text, "new text");
});

test("a key absent this run, project checked cleanly, resolves and stamps resolvedAt", () => {
  const key = "proj:spike:firestore.reads";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "spike", text: "x",
      firstSeen: "2026-09-10T03:00:00Z", lastSeen: "2026-09-16T06:00:00Z",
      state: "open", resolvedAt: null, runsSeen: 5, reopenCount: 0, ackedUntil: null,
    }],
  ]);
  // The project WAS checked this run (it's in report.projects), just has no
  // findings any more.
  const projects = [{ project: "proj", findings: [] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "resolved");
  assert.equal(data.resolvedAt, "2026-09-16T12:00:00Z");
});

test("projectErrors -> unknown, never resolved -- the load-bearing rule (plan.md B2)", () => {
  const key = "nourea:spike:firestore.reads";
  const existing = new Map([
    [key, {
      key, project: "nourea", level: "warn", kind: "spike", text: "x",
      firstSeen: "2026-09-10T03:00:00Z", lastSeen: "2026-09-16T06:00:00Z",
      state: "open", resolvedAt: null, runsSeen: 5, reopenCount: 0, ackedUntil: null,
    }],
  ]);
  // nourea failed this run -- it's not in report.projects at all, and its
  // findings (all of them) vanished from the report as a result.
  const projects = [{ project: "other-project", findings: [] }];
  const rep = report(projects, [{ project: "nourea", stage: "monitoring", error: "500" }]);
  const writes = planLifecycleUpdate(rep, existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "unknown");
  assert.equal(data.resolvedAt, null, "unknown must never set resolvedAt");
});

test("an estate-wide outage (all 15 projects erroring) leaves every existing key unknown, resolving none", () => {
  const existing = new Map([
    ["a:spike:x", { key: "a:spike:x", project: "a", state: "open", firstSeen: "t", lastSeen: "t", resolvedAt: null, runsSeen: 1, reopenCount: 0, ackedUntil: null }],
    ["b:spike:x", { key: "b:spike:x", project: "b", state: "open", firstSeen: "t", lastSeen: "t", resolvedAt: null, runsSeen: 1, reopenCount: 0, ackedUntil: null }],
  ]);
  const rep = report([], [
    { project: "a", stage: "monitoring", error: "500" },
    { project: "b", stage: "monitoring", error: "500" },
  ]);
  const writes = planLifecycleUpdate(rep, existing, NOW);

  assert.equal(writes.length, 2);
  for (const w of writes) {
    assert.equal(w.data.state, "unknown");
    assert.equal(w.data.resolvedAt, null);
  }
});

test("an unknown key that reappears goes back to open without counting as a reopen", () => {
  const key = "nourea:spike:firestore.reads";
  const existing = new Map([
    [key, {
      key, project: "nourea", level: "warn", kind: "spike", text: "x",
      firstSeen: "2026-09-10T03:00:00Z", lastSeen: "2026-09-16T06:00:00Z",
      state: "unknown", resolvedAt: null, runsSeen: 5, reopenCount: 0, ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "nourea", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open");
  assert.equal(data.reopenCount, 0, "coming back from unknown is not a reopen -- it was never confirmed resolved");
});

test("a resolved key that reappears within the reopen window flaps: reopenCount += 1, firstSeen kept", () => {
  const key = "stanimeros-dev:missing_index:log";
  const resolvedAt = new Date(NOW.getTime() - REOPEN_WINDOW_MS / 2).toISOString().replace(/\.\d{3}Z$/, "Z");
  const existing = new Map([
    [key, {
      key, project: "stanimeros-dev", level: "warn", kind: "missing_index", text: "x",
      firstSeen: "2026-09-10T03:00:00Z", lastSeen: resolvedAt,
      state: "resolved", resolvedAt, runsSeen: 8, reopenCount: 1, ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "stanimeros-dev", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open");
  assert.equal(data.reopenCount, 2);
  assert.equal(data.firstSeen, "2026-09-10T03:00:00Z");
  assert.equal(data.resolvedAt, null);
});

test("a resolved key that reappears after the reopen window starts a fresh lifecycle", () => {
  const key = "proj:spike:x";
  const resolvedAt = new Date(NOW.getTime() - REOPEN_WINDOW_MS - 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "spike", text: "x",
      firstSeen: "2026-08-01T00:00:00Z", lastSeen: resolvedAt,
      state: "resolved", resolvedAt, runsSeen: 30, reopenCount: 3, ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "proj", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open");
  assert.equal(data.firstSeen, "2026-09-16T12:00:00Z");
  assert.equal(data.reopenCount, 0);
  assert.equal(data.runsSeen, 1);
});

test("an acked finding within its window stays acked and keeps ackedUntil", () => {
  const key = "proj:api_key_warning:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "api_key_warning", text: "x",
      firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
      state: "acked", resolvedAt: null, runsSeen: 10, reopenCount: 0,
      ackedUntil: "2026-10-01T00:00:00Z",
    }],
  ]);
  const projects = [{ project: "proj", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "acked");
  assert.equal(data.ackedUntil, "2026-10-01T00:00:00Z");
});

test("an acked finding un-acks itself when it escalates warn -> critical", () => {
  const key = "proj:api_key_warning:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "api_key_warning", text: "x",
      firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
      state: "acked", resolvedAt: null, runsSeen: 10, reopenCount: 0,
      ackedUntil: "2026-10-01T00:00:00Z",
    }],
  ]);
  const projects = [{ project: "proj", findings: [finding(key, { level: "critical" })] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open");
  assert.equal(data.ackedUntil, null);
});

test("an acked finding un-acks itself once ackedUntil has passed", () => {
  const key = "proj:api_key_warning:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "api_key_warning", text: "x",
      firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
      state: "acked", resolvedAt: null, runsSeen: 10, reopenCount: 0,
      ackedUntil: "2026-09-01T00:00:00Z", // already in the past relative to NOW
    }],
  ]);
  const projects = [{ project: "proj", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open");
});

test("an acked finding that clears still resolves -- acking mutes noise, it doesn't stop tracking", () => {
  const key = "proj:api_key_warning:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "api_key_warning", text: "x",
      firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
      state: "acked", resolvedAt: null, runsSeen: 10, reopenCount: 0,
      ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "proj", findings: [] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "resolved");
  assert.equal(data.resolvedAt, "2026-09-16T12:00:00Z");
});

test("an already-resolved key with no matching finding and a clean project produces no write", () => {
  const key = "proj:spike:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "spike", text: "x",
      firstSeen: "2026-08-01T00:00:00Z", lastSeen: "2026-08-20T00:00:00Z",
      state: "resolved", resolvedAt: "2026-08-20T00:00:00Z", runsSeen: 20, reopenCount: 0, ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "proj", findings: [] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  assert.equal(writes.length, 0, "a resolved key with nothing changed shouldn't be rewritten every run");
});

test("an already-unknown key whose project is still erroring produces no write", () => {
  const key = "proj:spike:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "spike", text: "x",
      firstSeen: "2026-08-01T00:00:00Z", lastSeen: "2026-08-20T00:00:00Z",
      state: "unknown", resolvedAt: null, runsSeen: 20, reopenCount: 0, ackedUntil: null,
    }],
  ]);
  const rep = report([], [{ project: "proj", stage: "monitoring", error: "500" }]);
  const writes = planLifecycleUpdate(rep, existing, NOW);

  assert.equal(writes.length, 0);
});

test("docIdFor makes a slash-bearing finding key safe as a Firestore document id", () => {
  // `broad-role` keys embed an IAM role, e.g. ...:roles/editor. Firestore
  // reads that slash as a collection separator and throws, which -- since
  // updateLifecycle runs inside runHealthCheck -- would take down the entire
  // sweep on any project with one unrestricted role.
  const key = "applytics-app:broad-role:52318509359-compute@developer.gserviceaccount.com:roles/editor";
  const id = docIdFor(key);
  assert.ok(!id.includes("/"), `document id must not contain a slash: ${id}`);
  assert.equal(id.split("/").length, 1, "must be a single path component");
  // Distinct keys must stay distinct after encoding.
  assert.notEqual(docIdFor("p:broad-role:sa:roles/editor"), docIdFor("p:broad-role:sa:roles/owner"));
  // A key with no slash is untouched, so existing documents keep their ids.
  assert.equal(docIdFor("proj:spike:firestore.reads"), "proj:spike:firestore.reads");
});

// --- deploy correlation ------------------------------------------------
//
// The load-bearing rule for this whole section: a deploy annotates a
// finding, it never decides `state`. Every test below either checks the
// annotation directly, or -- the important negative case -- checks that a
// deploy landing does nothing to `state`/`resolvedAt` on its own.

test("a new finding with a known deployedAt is written with that as its baseline, and no deploy counted yet", () => {
  const key = "proj:function.errors:onStudioCreated";
  const projects = [{
    project: "proj",
    findings: [{ key, level: "warn", kind: "function errors", text: "x", deployedAt: "2026-09-16T00:00:00Z" }],
    entities: [{ name: "onStudioCreated", kind: "function", deployedAt: "2026-09-16T00:00:00Z" }],
  }];
  const writes = planLifecycleUpdate(report(projects), new Map(), NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.deployedAt, "2026-09-16T00:00:00Z");
  assert.deepEqual(data.deploys, []);
  assert.equal(data.deploysSinceFirstSeen, 0, "the deploy already in place when first observed doesn't count as a redeploy since");
  assert.equal(data.resolvedAfterDeploy, null);
});

test("a finding whose entity redeploys with no fix bumps deploysSinceFirstSeen and appends to deploys", () => {
  const key = "proj:function.errors:onStudioCreated";
  const existing = new Map([[key, {
    key, project: "proj", level: "warn", kind: "function errors", text: "x",
    firstSeen: "2026-09-14T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
    state: "open", resolvedAt: null, runsSeen: 3, reopenCount: 0, ackedUntil: null,
    deployedAt: "2026-09-14T00:00:00Z", deploys: [], deploysSinceFirstSeen: 0,
  }]]);
  const projects = [{
    project: "proj",
    findings: [{ key, level: "warn", kind: "function errors", text: "still broken", deployedAt: "2026-09-16T00:00:00Z" }],
  }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.deploysSinceFirstSeen, 1, "still failing, one deploy later -- the whole point of this feature");
  assert.deepEqual(data.deploys, ["2026-09-16T00:00:00Z"]);
  assert.equal(data.deployedAt, "2026-09-16T00:00:00Z");
});

test("the same deployedAt reappearing (no new deploy) does not double-count", () => {
  const key = "proj:function.errors:onStudioCreated";
  const existing = new Map([[key, {
    key, project: "proj", level: "warn", kind: "function errors", text: "x",
    firstSeen: "2026-09-14T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
    state: "open", resolvedAt: null, runsSeen: 3, reopenCount: 0, ackedUntil: null,
    deployedAt: "2026-09-16T00:00:00Z", deploys: ["2026-09-16T00:00:00Z"], deploysSinceFirstSeen: 1,
  }]]);
  const projects = [{
    project: "proj",
    findings: [{ key, level: "warn", kind: "function errors", text: "still broken", deployedAt: "2026-09-16T00:00:00Z" }],
  }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.deploysSinceFirstSeen, 1);
  assert.deepEqual(data.deploys, ["2026-09-16T00:00:00Z"]);
});

test("a project-level finding (spike) never carries deployedAt through the lifecycle -- no entity to point at", () => {
  const key = "proj:spike:firestore.reads";
  const projects = [{ project: "proj", findings: [finding(key)] }]; // no deployedAt on the finding
  const writes = planLifecycleUpdate(report(projects), new Map(), NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.deployedAt, null);
  assert.deepEqual(data.deploys, []);
  assert.equal(data.deploysSinceFirstSeen, 0);
});

test("advanceDeployHistory caps the deploys array at DEPLOY_HISTORY_CAP, dropping the oldest", () => {
  let state = { deployedAt: "2026-01-01T00:00:00Z", deploys: [] };
  for (let i = 1; i <= DEPLOY_HISTORY_CAP + 3; i++) {
    const t = `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`;
    state = advanceDeployHistory(state, { deployedAt: t });
  }
  assert.equal(state.deploys.length, DEPLOY_HISTORY_CAP);
  assert.equal(state.deploysSinceFirstSeen, DEPLOY_HISTORY_CAP + 3);
  // Oldest entries fell off the front; the newest is still last.
  assert.equal(state.deploys[state.deploys.length - 1], `2026-01-${DEPLOY_HISTORY_CAP + 4}T00:00:00Z`);
});

test("advanceDeployHistory leaves the anchor and trail untouched when this run has no deploy data at all", () => {
  const state = { deployedAt: "2026-09-01T00:00:00Z", deploys: ["2026-09-01T00:00:00Z"], deploysSinceFirstSeen: 1 };
  const next = advanceDeployHistory(state, { deployedAt: null });
  assert.deepEqual(next, { deployedAt: "2026-09-01T00:00:00Z", deploys: ["2026-09-01T00:00:00Z"], deploysSinceFirstSeen: 1 });
});

test("a fresh occurrence of a resolved key (past the reopen window) resets deploy history rather than inheriting an unrelated incident's trail", () => {
  const key = "proj:spike:x";
  const resolvedAt = new Date(NOW.getTime() - REOPEN_WINDOW_MS - 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const existing = new Map([[key, {
    key, project: "proj", level: "warn", kind: "function spike", text: "x",
    firstSeen: "2026-08-01T00:00:00Z", lastSeen: resolvedAt,
    state: "resolved", resolvedAt, runsSeen: 30, reopenCount: 3, ackedUntil: null,
    deployedAt: "2026-07-15T00:00:00Z", deploys: ["2026-07-15T00:00:00Z"], deploysSinceFirstSeen: 4,
  }]]);
  const projects = [{ project: "proj", findings: [{ key, level: "warn", kind: "function spike", text: "x", deployedAt: "2026-09-16T11:00:00Z" }] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.deployedAt, "2026-09-16T11:00:00Z");
  assert.deepEqual(data.deploys, []);
  assert.equal(data.deploysSinceFirstSeen, 0);
});

test("a flapping reopen within the window carries deploy history through -- it's the same incident", () => {
  const key = "proj:function.errors:onStudioCreated";
  const resolvedAt = new Date(NOW.getTime() - REOPEN_WINDOW_MS / 2).toISOString().replace(/\.\d{3}Z$/, "Z");
  const existing = new Map([[key, {
    key, project: "proj", level: "warn", kind: "function errors", text: "x",
    firstSeen: "2026-09-10T00:00:00Z", lastSeen: resolvedAt,
    state: "resolved", resolvedAt, runsSeen: 8, reopenCount: 1, ackedUntil: null,
    deployedAt: "2026-09-15T00:00:00Z", deploys: ["2026-09-15T00:00:00Z"], deploysSinceFirstSeen: 1,
  }]]);
  const projects = [{ project: "proj", findings: [{ key, level: "warn", kind: "function errors", text: "back again", deployedAt: "2026-09-15T00:00:00Z" }] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.deploysSinceFirstSeen, 1, "reappearing on the same deploy is not itself a new deploy");
  assert.deepEqual(data.deploys, ["2026-09-15T00:00:00Z"]);
});

test("resolvedAfterDeploy is set when a fresh deploy this run falls between lastSeen and resolvedAt", () => {
  const key = "proj:function.errors:onStudioCreated";
  const existing = new Map([[key, {
    key, project: "proj", level: "warn", kind: "function errors", text: "x",
    firstSeen: "2026-09-10T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
    state: "open", resolvedAt: null, runsSeen: 5, reopenCount: 0, ackedUntil: null,
    deployedAt: "2026-09-14T00:00:00Z", deploys: [], deploysSinceFirstSeen: 0,
  }]]);
  // The finding is gone this run -- the entity is still reporting (still
  // active), and its Cloud Run service shows a deploy that landed after the
  // finding was last seen but before now.
  const projects = [{
    project: "proj",
    findings: [],
    entities: [{ name: "onStudioCreated", kind: "function", deployedAt: "2026-09-15T18:00:00Z" }],
  }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "resolved");
  assert.equal(data.resolvedAfterDeploy, "2026-09-15T18:00:00Z");
});

test("resolvedAfterDeploy stays null when the only known deploy predates lastSeen -- it can't have been the fix", () => {
  const key = "proj:function.errors:onStudioCreated";
  const existing = new Map([[key, {
    key, project: "proj", level: "warn", kind: "function errors", text: "x",
    firstSeen: "2026-09-10T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
    state: "open", resolvedAt: null, runsSeen: 5, reopenCount: 0, ackedUntil: null,
    deployedAt: "2026-09-14T00:00:00Z", deploys: [], deploysSinceFirstSeen: 0,
  }]]);
  const projects = [{
    project: "proj",
    findings: [],
    entities: [{ name: "onStudioCreated", kind: "function", deployedAt: "2026-09-14T00:00:00Z" }], // stale, before lastSeen
  }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "resolved");
  assert.equal(data.resolvedAfterDeploy, null);
});

test("resolvedAfterDeploy stays null for a non-entity finding kind (sa-key) even with deploy data around", () => {
  const key = "proj:sa-key:sa@proj.iam.gserviceaccount.com:k1";
  const existing = new Map([[key, {
    key, project: "proj", level: "low", kind: "sa-key", text: "x",
    firstSeen: "2026-09-10T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
    state: "open", resolvedAt: null, runsSeen: 5, reopenCount: 0, ackedUntil: null,
  }]]);
  const projects = [{
    project: "proj",
    findings: [],
    entities: [{ name: "sa@proj.iam.gserviceaccount.com", kind: "function", deployedAt: "2026-09-16T00:00:00Z" }],
  }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "resolved");
  assert.equal(data.resolvedAfterDeploy, null);
});

test("THE NON-NEGOTIABLE RULE: a deploy never flips a finding to resolved on its own -- resolution is state alone, deploy data changes nothing about it", () => {
  const key = "proj:function.errors:onStudioCreated";
  // Finding is still present in this run's report (still firing) alongside
  // a brand-new deploy -- if a deploy could ever resolve a finding, this is
  // exactly the input that would wrongly trigger it.
  const existing = new Map([[key, {
    key, project: "proj", level: "warn", kind: "function errors", text: "x",
    firstSeen: "2026-09-10T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
    state: "open", resolvedAt: null, runsSeen: 5, reopenCount: 0, ackedUntil: null,
    deployedAt: "2026-09-14T00:00:00Z", deploys: [], deploysSinceFirstSeen: 0,
  }]]);
  const projects = [{
    project: "proj",
    findings: [{ key, level: "warn", kind: "function errors", text: "still broken after redeploy", deployedAt: "2026-09-16T00:00:00Z" }],
  }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);
  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open", "present this run means open, full stop -- a deploy cannot override that");
  assert.equal(data.resolvedAt, null);
  assert.equal(data.deploysSinceFirstSeen, 1, "the deploy is still recorded as context, just never as a reason to resolve");
});

test("buildDeploysByProject folds entity names case-insensitively per project", () => {
  const rep = report([{
    project: "proj",
    findings: [],
    entities: [
      { name: "onStudioCreated", kind: "function", deployedAt: "2026-09-16T00:00:00Z" },
      { name: "noDeployYet", kind: "function", deployedAt: null },
    ],
  }]);
  const byProject = buildDeploysByProject(rep);
  assert.equal(byProject.get("proj").get("onstudiocreated"), "2026-09-16T00:00:00Z");
  assert.equal(byProject.get("proj").has("nodeployyet"), false, "an entity with no deployedAt contributes no entry");
});

test("computeResolvedAfterDeploy returns null for a kind that isn't function/run-shaped", () => {
  const existing = { key: "proj:api-key:mykey", project: "proj", kind: "api-key", lastSeen: "2026-09-15T00:00:00Z" };
  const byProject = new Map([["proj", new Map([["mykey", "2026-09-16T00:00:00Z"]])]]);
  assert.equal(computeResolvedAfterDeploy(existing, byProject, "2026-09-17T00:00:00Z"), null);
});
