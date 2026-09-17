const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planLifecycleUpdate,
  docIdFor,
  DEPLOY_HISTORY_CAP,
  advanceDeployHistory,
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
  assert.equal(data.ackedUntil, null);
});

test("a key present again updates lastSeen and increments runsSeen without touching firstSeen", () => {
  const key = "proj:spike:firestore.reads";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "spike", text: "old text",
      firstSeen: "2026-09-10T03:00:00Z", lastSeen: "2026-09-16T06:00:00Z",
      state: "open", runsSeen: 5, ackedUntil: null,
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

test("a key absent this run, on a project this run actually checked, is deleted -- a confirmed clear", () => {
  const key = "proj:spike:firestore.reads";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "spike", text: "x",
      firstSeen: "2026-09-10T03:00:00Z", lastSeen: "2026-09-16T06:00:00Z",
      state: "open", runsSeen: 5, ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "proj", findings: [] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { key, op: "delete" });
});

test("an absent key's document is untouched even when its project errored this run", () => {
  const key = "nourea:spike:firestore.reads";
  const existing = new Map([
    [key, {
      key, project: "nourea", level: "warn", kind: "spike", text: "x",
      firstSeen: "2026-09-10T03:00:00Z", lastSeen: "2026-09-16T06:00:00Z",
      state: "open", runsSeen: 5, ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "other-project", findings: [] }];
  const rep = report(projects, [{ project: "nourea", stage: "monitoring", error: "500" }]);
  const writes = planLifecycleUpdate(rep, existing, NOW);

  assert.equal(writes.length, 0);
});

test("a key present again this very run is a plain continuation -- no reopen bookkeeping, firstSeen kept", () => {
  // Note: this existing doc was never actually absent from a *checked* run in
  // between -- if it had been, the doc would have been deleted already (see
  // the confirmed-clear test above) and this would instead be a brand-new
  // document. This test is about a doc simply persisting run to run.
  const key = "proj:spike:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "spike", text: "x",
      firstSeen: "2026-08-01T00:00:00Z", lastSeen: "2026-08-20T00:00:00Z",
      state: "open", runsSeen: 20, ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "proj", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open");
  assert.equal(data.firstSeen, "2026-08-01T00:00:00Z");
  assert.equal(data.runsSeen, 21);
});

test("a key that reappears after being confirmed cleared starts a brand-new document -- fresh firstSeen, open", () => {
  // This is the mechanism behind "ack it, and if it comes back later, treat
  // it as new again": the prior doc was deleted the run it went quiet (see
  // the confirmed-clear test above), so existingByKey has nothing for this
  // key by the time it fires again -- same code path as any first-ever sighting.
  const key = "proj:spike:x";
  const projects = [{ project: "proj", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), new Map(), NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open");
  assert.equal(data.firstSeen, "2026-09-16T12:00:00Z");
  assert.equal(data.runsSeen, 1);
});

test("an acked finding within its window stays acked and keeps ackedUntil", () => {
  const key = "proj:api_key_warning:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "api_key_warning", text: "x",
      firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
      state: "acked", runsSeen: 10,
      ackedUntil: "2026-10-01T00:00:00Z",
    }],
  ]);
  const projects = [{ project: "proj", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "acked");
  assert.equal(data.ackedUntil, "2026-10-01T00:00:00Z");
});

test("an ack with no expiry survives the next sweep -- null ackedUntil is indefinite, not already-expired", () => {
  // The dashboard's Acknowledge button sends no `until`, so this is what
  // every ack made from the UI looks like. Reading null as expired made a
  // suppressed finding reappear on the very next run.
  const key = "proj:api_key_warning:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "api_key_warning", text: "x",
      firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
      state: "acked", runsSeen: 10,
      ackedUntil: null,
      ackedBy: "uid-1",
    }],
  ]);
  const projects = [{ project: "proj", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "acked");
  assert.equal(data.ackedUntil, null);
  assert.equal(data.ackedBy, "uid-1");
});

test("an acked finding un-acks itself when it escalates warn -> critical", () => {
  const key = "proj:api_key_warning:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "api_key_warning", text: "x",
      firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
      state: "acked", runsSeen: 10,
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
      state: "acked", runsSeen: 10,
      ackedUntil: "2026-09-01T00:00:00Z", // already in the past relative to NOW
    }],
  ]);
  const projects = [{ project: "proj", findings: [finding(key)] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  const data = writesByKey(writes).get(key);
  assert.equal(data.state, "open");
});

test("an acked finding that stops appearing on a checked project is deleted, acked or not -- there's nothing left to suppress", () => {
  const key = "proj:api_key_warning:x";
  const existing = new Map([
    [key, {
      key, project: "proj", level: "warn", kind: "api_key_warning", text: "x",
      firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
      state: "acked", runsSeen: 10,
      ackedUntil: null,
    }],
  ]);
  const projects = [{ project: "proj", findings: [] }];
  const writes = planLifecycleUpdate(report(projects), existing, NOW);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { key, op: "delete" });
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

// --- deploy trail --------------------------------------------------------
//
// Purely additive annotation now: it rides along with whatever `state` the
// machine above already decided and never influences it.

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
});

test("a finding whose entity redeploys with no fix bumps deploysSinceFirstSeen and appends to deploys", () => {
  const key = "proj:function.errors:onStudioCreated";
  const existing = new Map([[key, {
    key, project: "proj", level: "warn", kind: "function errors", text: "x",
    firstSeen: "2026-09-14T00:00:00Z", lastSeen: "2026-09-15T00:00:00Z",
    state: "open", runsSeen: 3, ackedUntil: null,
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
    state: "open", runsSeen: 3, ackedUntil: null,
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

