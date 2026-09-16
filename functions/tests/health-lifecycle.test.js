const test = require("node:test");
const assert = require("node:assert/strict");

const { planLifecycleUpdate, docIdFor, REOPEN_WINDOW_MS } = require("../lib/health/lifecycle");

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
