const test = require("node:test");
const assert = require("node:assert/strict");

const { newKeys, renderEmail, subjectFor, hasAlertableFinding, notifyIfNew } = require("../lib/notify");

function finding(key, overrides) {
  return { key, level: "warn", kind: "spike", text: `${key} happened`, ...overrides };
}

function report(projects, overrides) {
  const findings = projects.flatMap((p) => p.findings);
  const counts = {
    critical: findings.filter((f) => f.level === "critical").length,
    warn: findings.filter((f) => f.level === "warn").length,
    ok: 0,
    total: projects.length,
  };
  return {
    generated: "2026-09-16T11:33:03Z",
    status: findings.some((f) => f.level === "critical") ? "critical" : findings.length ? "warn" : "ok",
    counts,
    projects,
    projectErrors: [],
    ...overrides,
  };
}

test("newKeys returns [] when every finding in the report already appeared in the previous run", () => {
  const projects = [
    { project: "proj", name: "Proj", findings: [finding("proj:spike:firestore.reads")] },
  ];
  const result = newKeys(report(projects), ["proj:spike:firestore.reads"]);
  assert.deepEqual(result, []);
});

test("newKeys returns exactly the keys absent from previousKeys, excluding ones already known", () => {
  const projects = [
    {
      project: "proj",
      name: "Proj",
      findings: [finding("proj:spike:firestore.reads"), finding("proj:stall:firestore.writes")],
    },
  ];
  const result = newKeys(report(projects), ["proj:spike:firestore.reads"]);
  assert.deepEqual(result, ["proj:stall:firestore.writes"]);
});

test("newKeys treats an empty or missing previousKeys as nothing seen before", () => {
  const projects = [{ project: "proj", name: "Proj", findings: [finding("proj:spike:firestore.reads")] }];
  assert.deepEqual(newKeys(report(projects), []), ["proj:spike:firestore.reads"]);
  assert.deepEqual(newKeys(report(projects), undefined), ["proj:spike:firestore.reads"]);
});

test("renderEmail marks a pre-existing finding ongoing and leaves new ones untagged", () => {
  const newFinding = finding("proj:spike:firestore.reads", { text: "reads spiked" });
  const oldFinding = finding("proj:stall:firestore.writes", { text: "writes stalled" });
  const projects = [{ project: "proj", name: "Proj", findings: [newFinding, oldFinding], errorTruncated: false }];
  const html = renderEmail(report(projects), ["proj:spike:firestore.reads"], null);

  assert.ok(!html.includes("NEW"), "a new finding must not be tagged NEW");
  assert.match(html, /ongoing[\s\S]*writes stalled/);
});

test("renderEmail escapes HTML in project names, since a project's error text originates from untrusted log content", () => {
  const dangerousFinding = finding("proj:errors:volume", {
    text: `<img src=x onerror="steal()"> saw <script>alert(1)</script>`,
  });
  const projects = [
    { project: "proj", name: `<script>alert('pwn')</script>`, findings: [dangerousFinding], errorTruncated: false },
  ];
  const html = renderEmail(report(projects), ["proj:errors:volume"], null);

  assert.ok(!html.includes("<script>alert('pwn')</script>"), "project name script tag must be escaped");
  assert.ok(!html.includes(`<img src=x onerror="steal()">`), "finding text markup must be escaped");
  assert.match(html, /&lt;script&gt;alert\(&#39;pwn&#39;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;steal\(\)&quot;&gt;/);
});

test("subjectFor names the single affected project when only one project has new findings", () => {
  const projects = [
    { project: "proj", name: "Proj One", findings: [finding("proj:spike:firestore.reads")] },
    { project: "other", name: "Other", findings: [] },
  ];
  const keys = ["proj:spike:firestore.reads"];
  const subject = subjectFor(report(projects), keys);
  assert.match(subject, /^\[Warning\] Proj One — 1 new finding$/);
});

test("subjectFor uses a project count when several projects are affected", () => {
  const projects = [
    { project: "proj1", name: "Proj One", findings: [finding("proj1:spike:firestore.reads")] },
    { project: "proj2", name: "Proj Two", findings: [finding("proj2:spike:firestore.writes", { level: "critical" })] },
  ];
  const keys = ["proj1:spike:firestore.reads", "proj2:spike:firestore.writes"];
  const subject = subjectFor(report(projects, { status: "critical" }), keys);
  assert.match(subject, /^\[CRITICAL\] 2 projects — 2 new findings$/);
});

// --- `low` findings never trigger an email on their own ---------------------

test("hasAlertableFinding is false when every new key is a low finding", () => {
  const projects = [
    { project: "proj", name: "Proj", findings: [finding("proj:api-key:abc", { level: "low", kind: "api-key" })] },
  ];
  const keys = ["proj:api-key:abc"];
  assert.equal(hasAlertableFinding(report(projects), keys), false);
});

test("hasAlertableFinding is true once at least one new key is warn or critical", () => {
  const projects = [
    {
      project: "proj",
      name: "Proj",
      findings: [
        finding("proj:api-key:abc", { level: "low", kind: "api-key" }),
        finding("proj:spike:firestore.reads", { level: "warn" }),
      ],
    },
  ];
  const keys = ["proj:api-key:abc", "proj:spike:firestore.reads"];
  assert.equal(hasAlertableFinding(report(projects), keys), true);
});

test("notifyIfNew sends nothing for a run whose only new findings are low, but still returns the keys for the dashboard's diff", async () => {
  const projects = [
    { project: "proj", name: "Proj", findings: [finding("proj:api-key:abc", { level: "low", kind: "api-key" })] },
  ];
  const result = await notifyIfNew(report(projects), [], { to: "owner@example.com" });
  assert.equal(result.sent, false);
  assert.deepEqual(result.keys, ["proj:api-key:abc"]);
});

test("notifyIfNew is a no-op (sent: false, keys: []) when nothing is new at all", async () => {
  const projects = [{ project: "proj", name: "Proj", findings: [finding("proj:spike:firestore.reads")] }];
  const result = await notifyIfNew(report(projects), ["proj:spike:firestore.reads"], {});
  assert.equal(result.sent, false);
  assert.deepEqual(result.keys, []);
});

test("renderEmail leaves an already-resolved finding out of a project's context list entirely", () => {
  const newFinding = finding("proj:spike:firestore.reads", { text: "reads spiked" });
  const resolvedFinding = finding("proj:api_key_warning:x", { text: "unrestricted key", level: "low" });
  const projects = [{ project: "proj", name: "Proj", findings: [newFinding, resolvedFinding], errorTruncated: false }];
  const html = renderEmail(report(projects), ["proj:spike:firestore.reads"], null, ["proj:api_key_warning:x"]);

  assert.match(html, /reads spiked/);
  assert.ok(!html.includes("unrestricted key"), "a finding already marked resolved must not appear as context");
});

test("notifyIfNew with alerting: false never sends, but still returns the new keys", async () => {
  const projects = [{ project: "proj", name: "Proj", findings: [finding("proj:spike:firestore.reads")] }];
  const result = await notifyIfNew(report(projects), [], { to: "owner@example.com", alerting: false });
  assert.equal(result.sent, false);
  assert.deepEqual(result.keys, ["proj:spike:firestore.reads"]);
});

test("renderEmail leaves low findings out of the list entirely, even as context alongside a real one", () => {
  const warnFinding = finding("proj:spike:firestore.reads", { text: "reads spiked" });
  const lowFinding = finding("proj:api-key:abc", { level: "low", kind: "api-key", text: "unrestricted key" });
  const projects = [{ project: "proj", name: "Proj", findings: [warnFinding, lowFinding], errorTruncated: false }];
  const html = renderEmail(report(projects), ["proj:spike:firestore.reads"], null);
  assert.ok(!html.includes("unrestricted key"), "a low finding must not appear in the email body");
});
