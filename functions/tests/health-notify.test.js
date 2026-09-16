const test = require("node:test");
const assert = require("node:assert/strict");

const { newKeys, renderEmail, subjectFor } = require("../lib/health/notify");

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

test("renderEmail marks a new finding NEW and a pre-existing one ongoing", () => {
  const newFinding = finding("proj:spike:firestore.reads", { text: "reads spiked" });
  const oldFinding = finding("proj:stall:firestore.writes", { text: "writes stalled" });
  const projects = [{ project: "proj", name: "Proj", findings: [newFinding, oldFinding], errorTruncated: false }];
  const html = renderEmail(report(projects), ["proj:spike:firestore.reads"], null);

  assert.match(html, /NEW[\s\S]*reads spiked/);
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
