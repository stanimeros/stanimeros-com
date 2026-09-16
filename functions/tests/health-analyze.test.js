const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeProject, median, formatValue, findingKey } = require("../lib/health/analyze");
const { DEFAULTS } = require("../lib/health/config");

function cfg(overrides) {
  return { ...DEFAULTS, ...overrides };
}

function project(overrides) {
  return { id: "proj", name: "Proj", plan: "Blaze", ...overrides };
}

// A minimal, always-safe call to analyzeProject so individual tests only need
// to override the piece they're exercising.
function baseArgs(overrides) {
  return {
    project: project(),
    metricSpecs: [],
    metricData: {},
    breakdowns: {},
    log: { count: null, truncated: false, kinds: {}, sources: {}, top: [] },
    cost: null,
    cfg: cfg(),
    billingAccount: "BILLING-1",
    ...overrides,
  };
}

test("median returns the middle value for an odd-length series", () => {
  assert.equal(median([5, 1, 3]), 3);
});

test("median averages the two middle values for an even-length series", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("median (not mean) keeps one bad day from raising the baseline and hiding the next spike", () => {
  // A single 400 among four 4s would drag a mean baseline up to 82.4, which
  // would swallow a following moderate spike. The median stays at 4.
  assert.equal(median([4, 4, 4, 4, 400]), 4);
});

test("formatValue renders byte units as human-readable sizes", () => {
  assert.equal(formatValue(500, "bytes"), "500B");
  assert.equal(formatValue(2048, "bytes"), "2.0KB");
  assert.equal(formatValue(5 * 1024 * 1024, "bytes"), "5.0MB");
});

test("formatValue renders plain counts with thousands separators", () => {
  assert.equal(formatValue(1234567, null), "1,234,567");
  assert.equal(formatValue(42), "42");
});

test("findingKey never embeds a count, ratio, or timestamp, so the same underlying problem stays keyed identically", () => {
  const key = findingKey("proj", "spike", "firestore.reads");
  assert.equal(key, "proj:spike:firestore.reads");
  assert.ok(!/\d/.test(key), `finding key must not contain digits: ${key}`);
});

test("findingKey is identical across two analyzeProject runs whose spike sizes differ", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const history = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
  const dataSmall = {
    "": Object.fromEntries([
      ...history.map((v, i) => [`2026-09-${String(i + 1).padStart(2, "0")}`, v]),
      ["2026-09-14", 200], // 4x baseline, above the spike floor
    ]),
  };
  const dataBig = {
    "": Object.fromEntries([
      ...history.map((v, i) => [`2026-09-${String(i + 1).padStart(2, "0")}`, v]),
      ["2026-09-14", 2000], // 40x baseline, above the spike floor
    ]),
  };

  const resultSmall = analyzeProject(
    baseArgs({ metricSpecs: [spec], metricData: { "firestore.reads": dataSmall } })
  );
  const resultBig = analyzeProject(
    baseArgs({ metricSpecs: [spec], metricData: { "firestore.reads": dataBig } })
  );

  assert.equal(resultSmall.findings.length, 1);
  assert.equal(resultBig.findings.length, 1);
  assert.equal(resultSmall.findings[0].key, resultBig.findings[0].key);
  assert.equal(resultSmall.findings[0].key, "proj:spike:firestore.reads");
});

function seriesWithLatest(baselineValue, latestValue, days = 14) {
  const out = {};
  for (let i = 0; i < days - 1; i++) {
    out[`2026-08-${String(i + 1).padStart(2, "0")}`] = baselineValue;
  }
  out["2026-08-31"] = latestValue;
  return { "": out };
}

test("analyzeProject flags a spike at >= 3x baseline over the floor as a warn finding", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const data = seriesWithLatest(100, 350); // 3.5x baseline, floor is 100
  const result = analyzeProject(baseArgs({ metricSpecs: [spec], metricData: { "firestore.reads": data } }));
  const finding = result.findings.find((f) => f.kind === "spike");
  assert.ok(finding, "expected a spike finding");
  assert.equal(finding.level, "warn");
});

test("analyzeProject escalates a spike to critical at >= 6x baseline", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const data = seriesWithLatest(100, 700); // 7x baseline
  const result = analyzeProject(baseArgs({ metricSpecs: [spec], metricData: { "firestore.reads": data } }));
  const finding = result.findings.find((f) => f.kind === "spike");
  assert.ok(finding);
  assert.equal(finding.level, "critical");
});

test("analyzeProject reports a stall when a metric with a real baseline drops to exactly zero", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const data = seriesWithLatest(100, 0);
  const result = analyzeProject(baseArgs({ metricSpecs: [spec], metricData: { "firestore.reads": data } }));
  const finding = result.findings.find((f) => f.kind === "stall");
  assert.ok(finding, "expected a stall finding");
  assert.equal(finding.level, "warn");
});

test("analyzeProject stays quiet on a value below the spike floor even at a huge ratio", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  // baseline 1, latest 50: ratio is 50x but 50 < spikeFloor (100), so no finding.
  const data = seriesWithLatest(1, 50);
  const result = analyzeProject(baseArgs({ metricSpecs: [spec], metricData: { "firestore.reads": data } }));
  assert.equal(result.findings.length, 0);
});

test("Spark quota findings fire at >= 80% of freeDaily and turn critical at >= 100%", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta", freeDaily: 1000 };

  const dataWarn = seriesWithLatest(10, 850); // 85% of freeDaily; baseline too small to spike-trigger normally but will since 850>=100 && 850/10>=3, so isolate quota separately
  // Use a baseline close to latest to avoid also tripping a spike finding, so we can
  // assert on the quota finding specifically.
  const dataWarnOnly = seriesWithLatest(800, 850); // 850/800 < 3 (no spike), 850 >= 100 (would need ratio>=3, not met)
  const resultWarn = analyzeProject(
    baseArgs({
      project: project({ plan: "Spark" }),
      metricSpecs: [spec],
      metricData: { "firestore.reads": dataWarnOnly },
    })
  );
  const quotaWarn = resultWarn.findings.find((f) => f.kind === "quota");
  assert.ok(quotaWarn, "expected a quota finding at 85% usage");
  assert.equal(quotaWarn.level, "warn");

  const dataCritical = seriesWithLatest(950, 1000); // 100% of freeDaily, ratio < 3 so no spike overlap
  const resultCritical = analyzeProject(
    baseArgs({
      project: project({ plan: "Spark" }),
      metricSpecs: [spec],
      metricData: { "firestore.reads": dataCritical },
    })
  );
  const quotaCritical = resultCritical.findings.find((f) => f.kind === "quota");
  assert.ok(quotaCritical, "expected a quota finding at 100% usage");
  assert.equal(quotaCritical.level, "critical");
  void dataWarn;
});

test("a Blaze project with the same usage numbers produces no quota finding", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta", freeDaily: 1000 };
  const data = seriesWithLatest(950, 1000); // would be 100% on Spark
  const result = analyzeProject(
    baseArgs({ project: project({ plan: "Blaze" }), metricSpecs: [spec], metricData: { "firestore.reads": data } })
  );
  assert.equal(result.findings.some((f) => f.kind === "quota"), false);
});

test("byte metrics use the raised 10MB floor instead of the default spikeFloor", () => {
  const spec = { key: "hosting.egress", type: "x", kind: "delta", unit: "bytes" };
  // Latest is well above the default 100-unit floor but far below 10MB, and
  // the ratio is huge (baseline 1 byte) -- must NOT trigger a spike.
  const smallData = seriesWithLatest(1, 500000); // 500KB, ratio 500000x but under 10MB floor
  const smallResult = analyzeProject(
    baseArgs({ metricSpecs: [spec], metricData: { "hosting.egress": smallData } })
  );
  assert.equal(smallResult.findings.some((f) => f.kind === "spike"), false);

  const bigData = seriesWithLatest(1024, 20 * 1024 * 1024); // 20MB, above the 10MB floor and > 3x baseline
  const bigResult = analyzeProject(baseArgs({ metricSpecs: [spec], metricData: { "hosting.egress": bigData } }));
  assert.equal(bigResult.findings.some((f) => f.kind === "spike"), true);
});

test("a metric with freeDaily floors at quietFraction of it, so a huge ratio on a tiny count stays quiet", () => {
  // Real firestore.reads shape: freeDaily 50000, so the floor is 20% of that
  // = 10000, regardless of spikeFloor (100) and regardless of plan.
  const spec = { key: "firestore.reads", type: "x", kind: "delta", freeDaily: 50000 };

  // 804 reads vs a baseline of 4 is a 201x ratio -- exactly the kind of
  // reading that used to fire a warning on a project doing basically nothing.
  const quietData = seriesWithLatest(4, 804);
  const quietResult = analyzeProject(
    baseArgs({ metricSpecs: [spec], metricData: { "firestore.reads": quietData } })
  );
  assert.equal(quietResult.findings.some((f) => f.kind === "spike"), false);

  // Above the 10000 floor, the same shape of ratio does fire.
  const realData = seriesWithLatest(40, 12000);
  const realResult = analyzeProject(
    baseArgs({ metricSpecs: [spec], metricData: { "firestore.reads": realData } })
  );
  assert.equal(realResult.findings.some((f) => f.kind === "spike"), true);
});

test("entities are capped at LIMITS.entitiesPerProject while entitiesTotal records the true count", () => {
  const breakdowns = { function: {} };
  for (let i = 0; i < 40; i++) {
    const name = `fn${i}`;
    breakdowns.function[name] = {
      calls: { "2026-08-30": 10, "2026-08-31": 10 },
      errors: { "2026-08-30": 0, "2026-08-31": 0 },
    };
  }
  const result = analyzeProject(baseArgs({ breakdowns }));
  assert.equal(result.entities.length, 25);
  assert.equal(result.entitiesTotal, 40);
});

test("a project with no findings gets status ok", () => {
  const result = analyzeProject(baseArgs());
  assert.equal(result.status, "ok");
});

test("a project with any warn finding gets status warn", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const data = seriesWithLatest(100, 350); // 3.5x -> warn spike
  const result = analyzeProject(baseArgs({ metricSpecs: [spec], metricData: { "firestore.reads": data } }));
  assert.equal(result.status, "warn");
});

test("a project with any critical finding gets status critical, even alongside warns", () => {
  const spec1 = { key: "firestore.reads", type: "x", kind: "delta" };
  const spec2 = { key: "firestore.writes", type: "y", kind: "delta" };
  const warnData = seriesWithLatest(100, 350); // warn spike
  const criticalData = seriesWithLatest(100, 700); // critical spike
  const result = analyzeProject(
    baseArgs({
      metricSpecs: [spec1, spec2],
      metricData: { "firestore.reads": warnData, "firestore.writes": criticalData },
    })
  );
  assert.equal(result.status, "critical");
});
