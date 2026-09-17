const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeProject, worstLevel, median, formatValue, findingKey } = require("../lib/health/analyze");
const { DEFAULTS, LEVEL_ORDER, LEVEL_BY_KIND } = require("../lib/health/config");

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
    rollingBreakdowns: {},
    log: { count: null, truncated: false, kinds: {}, sources: {}, top: [] },
    cost: null,
    cfg: cfg(),
    billingAccount: "BILLING-1",
    rollingMetricData: {},
    iam: null,
    ...overrides,
  };
}

// History (baseline) data: `days` complete prior UTC days, all the same
// value, under one unlabelled sub-series.
function historySeries(baselineValue, days = 14) {
  const out = {};
  for (let i = 0; i < days; i++) {
    out[`2026-08-${String(i + 1).padStart(2, "0")}`] = baselineValue;
  }
  return { "": out };
}

// Rolling (current) data: one bucket per label, collapsed onto a single day
// key -- a real rolling-24h fetch isn't day-aligned so it may return two day
// keys for the same label, but summing is what analyzeMetric does either way
// (see the dedicated multi-day-key test below), so one key is enough here.
function rollingSeries(labelTotals) {
  return Object.fromEntries(Object.entries(labelTotals).map(([label, total]) => [label, { "2026-09-16": total }]));
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
  const history = { "firestore.reads": historySeries(50) };

  const resultSmall = analyzeProject(
    baseArgs({ metricSpecs: [spec], metricData: history, rollingMetricData: { "firestore.reads": rollingSeries({ "": 200 }) } }) // 4x
  );
  const resultBig = analyzeProject(
    baseArgs({ metricSpecs: [spec], metricData: history, rollingMetricData: { "firestore.reads": rollingSeries({ "": 2000 }) } }) // 40x
  );

  assert.equal(resultSmall.findings.length, 1);
  assert.equal(resultBig.findings.length, 1);
  assert.equal(resultSmall.findings[0].key, resultBig.findings[0].key);
  assert.equal(resultSmall.findings[0].key, "proj:spike:firestore.reads");
});

function spikeArgs(spec, baseline, latest, overrides) {
  return baseArgs({
    metricSpecs: [spec],
    metricData: { [spec.key]: historySeries(baseline) },
    rollingMetricData: { [spec.key]: rollingSeries({ "": latest }) },
    ...overrides,
  });
}

test("analyzeProject flags a spike at >= 3x baseline over the floor as a warn finding", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const result = analyzeProject(spikeArgs(spec, 100, 350)); // 3.5x baseline, floor is 100
  const finding = result.findings.find((f) => f.kind === "spike");
  assert.ok(finding, "expected a spike finding");
  assert.equal(finding.level, "warn");
});

test("analyzeProject escalates a spike to critical at >= 6x baseline", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const result = analyzeProject(spikeArgs(spec, 100, 700)); // 7x baseline
  const finding = result.findings.find((f) => f.kind === "spike");
  assert.ok(finding);
  assert.equal(finding.level, "critical");
});

test("analyzeProject reports a stall when a metric with a real baseline drops to exactly zero over the rolling 24h", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const result = analyzeProject(spikeArgs(spec, 100, 0));
  const finding = result.findings.find((f) => f.kind === "stall");
  assert.ok(finding, "expected a stall finding");
  assert.equal(finding.level, "warn");
});

test("analyzeProject stays quiet on a value below the spike floor even at a huge ratio", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  // baseline 1, latest 50: ratio is 50x but 50 < spikeFloor (100), so no finding.
  const result = analyzeProject(spikeArgs(spec, 1, 50));
  assert.equal(result.findings.length, 0);
});

test("analyzeProject sums a rolling window's total across every day key it straddles, not just the newest one", () => {
  // A real rolling-24h fetch isn't day-aligned, so it can return the same
  // label split across two UTC-date keys -- summing both is what makes the
  // total correct, e.g. 250 + 100 = 350, same as if it landed in one bucket.
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const straddled = { "": { "2026-09-15": 250, "2026-09-16": 100 } }; // 350 total
  const result = analyzeProject(
    baseArgs({
      metricSpecs: [spec],
      metricData: { "firestore.reads": historySeries(100) },
      rollingMetricData: { "firestore.reads": straddled },
    })
  );
  const finding = result.findings.find((f) => f.kind === "spike");
  assert.ok(finding, "350 vs baseline 100 is a 3.5x spike");
  assert.match(finding.text, /350/);
});

test("a metric absent from both the history and rolling windows produces no metrics entry and no findings", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const result = analyzeProject(baseArgs({ metricSpecs: [spec], metricData: {}, rollingMetricData: {} }));
  assert.equal(result.findings.length, 0);
  assert.equal("firestore.reads" in result.metrics, false);
});

test("Spark quota findings fire at >= 80% of freeDaily and turn critical at >= 100%", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta", freeDaily: 1000 };

  // Baseline close to latest to avoid also tripping a spike finding, so we
  // can assert on the quota finding specifically.
  const resultWarn = analyzeProject(spikeArgs(spec, 800, 850, { project: project({ plan: "Spark" }) })); // 85%, no spike
  const quotaWarn = resultWarn.findings.find((f) => f.kind === "quota");
  assert.ok(quotaWarn, "expected a quota finding at 85% usage");
  assert.equal(quotaWarn.level, "warn");

  const resultCritical = analyzeProject(spikeArgs(spec, 950, 1000, { project: project({ plan: "Spark" }) })); // 100%
  const quotaCritical = resultCritical.findings.find((f) => f.kind === "quota");
  assert.ok(quotaCritical, "expected a quota finding at 100% usage");
  assert.equal(quotaCritical.level, "critical");
});

test("a Blaze project with the same usage numbers produces no quota finding", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta", freeDaily: 1000 };
  const result = analyzeProject(spikeArgs(spec, 950, 1000, { project: project({ plan: "Blaze" }) })); // would be 100% on Spark
  assert.equal(result.findings.some((f) => f.kind === "quota"), false);
});

test("byte metrics use the raised 10MB floor instead of the default spikeFloor", () => {
  const spec = { key: "hosting.egress", type: "x", kind: "delta", unit: "bytes" };
  // Latest is well above the default 100-unit floor but far below 10MB, and
  // the ratio is huge (baseline 1 byte) -- must NOT trigger a spike.
  const smallResult = analyzeProject(spikeArgs(spec, 1, 500000)); // 500KB, ratio huge but under 10MB floor
  assert.equal(smallResult.findings.some((f) => f.kind === "spike"), false);

  const bigResult = analyzeProject(spikeArgs(spec, 1024, 20 * 1024 * 1024)); // 20MB, above the 10MB floor and > 3x baseline
  assert.equal(bigResult.findings.some((f) => f.kind === "spike"), true);
});

test("a metric with freeDaily floors at quietFraction of it, so a huge ratio on a tiny count stays quiet", () => {
  // Real firestore.reads shape: freeDaily 50000, so the floor is 20% of that
  // = 10000, regardless of spikeFloor (100) and regardless of plan.
  const spec = { key: "firestore.reads", type: "x", kind: "delta", freeDaily: 50000 };

  // 804 reads vs a baseline of 4 is a 201x ratio -- exactly the kind of
  // reading that used to fire a warning on a project doing basically nothing.
  const quietResult = analyzeProject(spikeArgs(spec, 4, 804));
  assert.equal(quietResult.findings.some((f) => f.kind === "spike"), false);

  // Above the 10000 floor, the same shape of ratio does fire.
  const realResult = analyzeProject(spikeArgs(spec, 40, 12000));
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

test("an entity's calls reflect the rolling last-24h window, not the newest historical day -- matching what Cloud Console's own 'last 24 hours' shows", () => {
  // A function with real historical traffic (113 calls/day) but genuinely
  // zero calls in the rolling last 24h must show calls: 0, not 113 -- the
  // exact dashboard-vs-Console mismatch this test guards against.
  const breakdowns = {
    function: { adminGetClient: { calls: { "2026-08-30": 113, "2026-08-31": 113 }, errors: {} } },
  };
  const rollingBreakdowns = {
    function: { adminGetClient: { calls: {}, errors: {} } }, // zero calls today
  };
  const result = analyzeProject(baseArgs({ breakdowns, rollingBreakdowns }));
  const entity = result.entities.find((e) => e.name === "adminGetClient");
  assert.ok(entity);
  assert.equal(entity.calls, 0);
  assert.equal(entity.callsBaseline, 113);
});

test("an entity's rolling calls sum across every day key the window straddles, same as a project metric's", () => {
  const breakdowns = { function: { fn: { calls: { "2026-08-30": 10 }, errors: {} } } };
  const rollingBreakdowns = {
    function: { fn: { calls: { "2026-09-15": 60, "2026-09-16": 40 }, errors: {} } }, // 100 total
  };
  const result = analyzeProject(baseArgs({ breakdowns, rollingBreakdowns }));
  const entity = result.entities.find((e) => e.name === "fn");
  assert.equal(entity.calls, 100);
});

// --- gen-2 function / Cloud Run entity dedup --------------------------------
//
// A gen-2 Cloud Function *is* a Cloud Run service, so BREAKDOWNS in config.js
// reports the same workload twice: once under its real function name, once
// under Cloud Run's lowercased service name. Before this dedup ran ahead of
// finding-generation, that produced two entities *and* two findings (e.g.
// "function silent" + "run silent") for one silent function.

function dayValues(value, days = 14) {
  const out = {};
  for (let i = 0; i < days; i++) out[`2026-08-${String(i + 1).padStart(2, "0")}`] = value;
  return out;
}

test("a gen-2 function's matching run entity collapses to one entity and one finding, under the function's real (camelCase) name", () => {
  const breakdowns = {
    function: { forwardEmailWebhook: { calls: dayValues(410), errors: {} } },
    run: { forwardemailwebhook: { calls: dayValues(410), errors: {} } },
  };
  const rollingBreakdowns = {
    function: { forwardEmailWebhook: { calls: {}, errors: {} } }, // silent today
    run: { forwardemailwebhook: { calls: {}, errors: {} } },
  };
  const result = analyzeProject(baseArgs({ breakdowns, rollingBreakdowns }));

  assert.equal(result.entities.length, 1, "the run shadow must not survive as its own entity");
  assert.equal(result.entities[0].name, "forwardEmailWebhook");
  assert.equal(result.entities[0].kind, "function");

  const silentFindings = result.findings.filter((f) => f.kind === "function silent" || f.kind === "run silent");
  assert.equal(silentFindings.length, 1, "must not report both a function silent and a run silent finding");
  assert.equal(silentFindings[0].kind, "function silent");
  assert.equal(silentFindings[0].key, "proj:function.silent:forwardEmailWebhook");
});

test("a standalone Cloud Run service with no matching function name still reports as kind run", () => {
  const breakdowns = { run: { standaloneApi: { calls: dayValues(410), errors: {} } } };
  const rollingBreakdowns = { run: { standaloneApi: { calls: {}, errors: {} } } };
  const result = analyzeProject(baseArgs({ breakdowns, rollingBreakdowns }));

  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].kind, "run");
  const finding = result.findings.find((f) => f.kind === "run silent");
  assert.ok(finding, "a genuine standalone Run service must still be checked");
});

test("a function with no run counterpart is unaffected by the dedup", () => {
  const breakdowns = { function: { onlyAFunction: { calls: dayValues(150), errors: {} } } };
  const rollingBreakdowns = { function: { onlyAFunction: { calls: {}, errors: {} } } };
  const result = analyzeProject(baseArgs({ breakdowns, rollingBreakdowns }));

  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].kind, "function");
  assert.ok(result.findings.some((f) => f.kind === "function silent"));
});

test("the surviving entity keeps only the function's own numbers -- the two sources are not summed", () => {
  // function/execution_count and run/request_count measure different things
  // (invocations vs. HTTP requests); if they were summed, a gen-2 function
  // with 100 calls on each side would read as 200.
  const breakdowns = {
    function: { forwardEmailWebhook: { calls: dayValues(50), errors: {} } },
    run: { forwardemailwebhook: { calls: dayValues(999), errors: {} } }, // deliberately different
  };
  const rollingBreakdowns = {
    function: { forwardEmailWebhook: { calls: { "2026-09-16": 100 }, errors: {} } },
    run: { forwardemailwebhook: { calls: { "2026-09-16": 100 }, errors: {} } },
  };
  const result = analyzeProject(baseArgs({ breakdowns, rollingBreakdowns }));

  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].calls, 100, "calls must come from the function side only, not summed to 200");
  assert.equal(result.entities[0].callsBaseline, 50, "baseline must come from the function side only, not the run side's 999");
});

test("run.requests does not double-report a gen-2 function's own spike under a second metric name", () => {
  // A fully-shadowed project: one function entity, one identically-named run
  // entity with the same rolling call count -- dropRunShadows removes the
  // run shadow entirely, so shadowedCalls equals the whole run.requests
  // total. shadowedCalls is rolling-based (entity.calls), so the shadow data
  // goes in rollingBreakdowns, not the historical breakdowns.
  const spec = { key: "run.requests", type: "x", kind: "delta" };
  const rollingBreakdowns = {
    function: { getStatistics: { calls: { "2026-09-16": 189 }, errors: {} } },
    run: { getstatistics: { calls: { "2026-09-16": 189 }, errors: {} } },
  };
  const result = analyzeProject(
    baseArgs({
      metricSpecs: [spec],
      metricData: { "run.requests": historySeries(1) },
      rollingMetricData: { "run.requests": rollingSeries({ "": 189 }) }, // 189x baseline 1 -- would spike
      rollingBreakdowns,
    })
  );
  assert.equal(result.findings.some((f) => f.kind === "spike"), false);
  assert.equal(result.metrics["run.requests"].shadowedCalls, 189);
});

test("run.requests findings are suppressed project-wide once any shadowing exists, even alongside a standalone Cloud Run service", () => {
  // A known, accepted limitation: with only one rolling window's worth of
  // shadow data (no separate per-portion breakdown), there's no reliable way
  // to subtract just the shadowed part of run.requests' total -- see
  // analyzeMetric's suppressFindings doc comment. A mixed project (some
  // shadowed function traffic + a real standalone Run service) loses
  // run.requests spike detection entirely rather than risk a wrong number;
  // functions.calls still covers the shadowed part.
  const spec = { key: "run.requests", type: "x", kind: "delta" };
  const rollingBreakdowns = {
    function: { getStatistics: { calls: { "2026-09-16": 50 }, errors: {} } },
    run: {
      getstatistics: { calls: { "2026-09-16": 50 }, errors: {} }, // shadowed, dropped
      standaloneApi: { calls: { "2026-09-16": 400 }, errors: {} }, // real, independent traffic
    },
  };
  const result = analyzeProject(
    baseArgs({
      metricSpecs: [spec],
      metricData: { "run.requests": historySeries(50) },
      rollingMetricData: { "run.requests": rollingSeries({ "": 450 }) },
      rollingBreakdowns,
    })
  );
  assert.equal(result.findings.some((f) => f.kind === "spike"), false);
  // Still shown for reference in the metrics panel, just not alerted on.
  assert.equal(result.metrics["run.requests"].latest, 450);
});

// --- log errors (no floor) --------------------------------------------------

test("a single real error log entry is critical -- no floor, unlike the Monitoring-derived checks", () => {
  const result = analyzeProject(
    baseArgs({ log: { count: 1, truncated: false, kinds: {}, sources: { "function:x": 1 }, top: [] } })
  );
  const finding = result.findings.find((f) => f.kind === "errors");
  assert.ok(finding, "a single error must not be invisible to findings/status");
  // Errors are red, warnings are amber, and a clean project is green -- an
  // error must not wear the same colour as an unrestricted API key
  // (cfg.criticalErrors, which a noisy project can raise in OVERRIDES).
  assert.equal(finding.level, "critical");
  assert.equal(result.status, "critical");
});

test("log errors escalate to critical at cfg.criticalErrors", () => {
  const result = analyzeProject(
    baseArgs({ log: { count: 100, truncated: false, kinds: {}, sources: {}, top: [] } })
  );
  const finding = result.findings.find((f) => f.kind === "errors");
  assert.equal(finding.level, "critical");
});

test("log.count: null (log read failed) produces no errors finding -- must not read as zero errors", () => {
  const result = analyzeProject(
    baseArgs({ log: { count: null, truncated: false, kinds: {}, sources: {}, top: [] } })
  );
  assert.equal(result.findings.some((f) => f.kind === "errors"), false);
});

test("a project with no findings gets status ok", () => {
  const result = analyzeProject(baseArgs());
  assert.equal(result.status, "ok");
});

test("a project with any warn finding gets status warn", () => {
  const spec = { key: "firestore.reads", type: "x", kind: "delta" };
  const result = analyzeProject(spikeArgs(spec, 100, 350)); // 3.5x -> warn spike
  assert.equal(result.status, "warn");
});

// --- failures (rolling 24h failure rate) ------------------------------------

const STORAGE_TOTAL = { key: "storage.total", type: "x", kind: "gauge", unit: "bytes" };
const FUNCTIONS_CALLS = { key: "functions.calls", type: "x", kind: "delta" };
const RUN_REQUESTS = { key: "run.requests", type: "x", kind: "delta" };

test("analyzeProject ignores a metric with no configured failure label", () => {
  const result = analyzeProject(
    baseArgs({ metricSpecs: [STORAGE_TOTAL], rollingMetricData: { "storage.total": rollingSeries({ "": 1000 }) } })
  );
  assert.equal(result.findings.some((f) => f.kind === "failures"), false);
});

test("analyzeProject stays quiet on a tiny rolling total even at 100% failure", () => {
  // functions.calls' own errorFloor (30, see FAILURE_THRESHOLDS) is what
  // gates this -- 5 failed calls never clears it, however high the share.
  const result = analyzeProject(
    baseArgs({ metricSpecs: [FUNCTIONS_CALLS], rollingMetricData: { "functions.calls": rollingSeries({ error: 5 }) } })
  );
  assert.equal(result.findings.some((f) => f.kind === "failures"), false);
});

test("analyzeProject stays quiet on functions.calls below its raised 20% share -- routine auth-rejection noise, not a crash", () => {
  // 13%, matching the routine ~13% auth-rejection rate observed on
  // stanimeros-dev's own callables -- must not fire.
  const result = analyzeProject(
    baseArgs({
      metricSpecs: [FUNCTIONS_CALLS],
      rollingMetricData: { "functions.calls": rollingSeries({ ok: 131, error: 19 }) }, // 150 total, ~13%
    })
  );
  assert.equal(result.findings.some((f) => f.kind === "failures"), false);
});

test("analyzeProject fires a warn on functions.calls at its raised >= 20% share", () => {
  const result = analyzeProject(
    baseArgs({
      metricSpecs: [FUNCTIONS_CALLS],
      rollingMetricData: { "functions.calls": rollingSeries({ ok: 160, error: 40 }) }, // 200 total, 20%
    })
  );
  const finding = result.findings.find((f) => f.kind === "failures");
  assert.ok(finding, "expected a failures finding");
  assert.equal(finding.level, "warn");
  assert.equal(finding.key, "proj:failures:functions.calls");
});

test("analyzeProject escalates functions.calls to critical at its raised >= 50% share", () => {
  const result = analyzeProject(
    baseArgs({
      metricSpecs: [FUNCTIONS_CALLS],
      rollingMetricData: { "functions.calls": rollingSeries({ ok: 100, error: 100 }) }, // 200 total, 50%
    })
  );
  const finding = result.findings.find((f) => f.kind === "failures");
  assert.ok(finding);
  assert.equal(finding.level, "critical");
});

test("analyzeProject uses the default 5%/25% bar for a metric with no override (run.requests)", () => {
  const warnResult = analyzeProject(
    baseArgs({
      metricSpecs: [RUN_REQUESTS],
      rollingMetricData: { "run.requests": rollingSeries({ "2xx": 190, "5xx": 10 }) }, // 200 total, 5%
    })
  );
  const warnFinding = warnResult.findings.find((f) => f.kind === "failures");
  assert.ok(warnFinding, "expected a failures finding at the default 5% bar");
  assert.equal(warnFinding.level, "warn");

  const criticalResult = analyzeProject(
    baseArgs({
      metricSpecs: [RUN_REQUESTS],
      rollingMetricData: { "run.requests": rollingSeries({ "2xx": 150, "5xx": 50 }) }, // 200 total, 25%
    })
  );
  assert.equal(criticalResult.findings.find((f) => f.kind === "failures").level, "critical");
});

// --- IAM / key hygiene -------------------------------------------------------

test("analyzeIam is a no-op when iam is null (e.g. the grant hasn't rolled out to this project yet)", () => {
  const result = analyzeProject(baseArgs({ iam: null }));
  assert.equal(result.findings.length, 0);
});

test("analyzeIam flags a user-managed service-account key as low (hygiene) under the age threshold", () => {
  const iam = {
    serviceAccounts: [
      { email: "sa@proj.iam.gserviceaccount.com", userManagedKeys: [{ name: "k1", validAfterTime: new Date().toISOString() }] },
    ],
    broadBindings: [],
    unrestrictedKeys: [],
  };
  const result = analyzeProject(baseArgs({ iam }));
  const finding = result.findings.find((f) => f.kind === "sa-key");
  assert.ok(finding, "expected a sa-key finding");
  assert.equal(finding.level, "low");
  assert.equal(finding.key, "proj:sa-key:sa@proj.iam.gserviceaccount.com:k1");
});

test("analyzeIam escalates a service-account key to critical once it's older than saKeyCriticalDays", () => {
  const old = new Date(Date.now() - 400 * 86400000).toISOString(); // > default 365d
  const iam = {
    serviceAccounts: [{ email: "sa@proj.iam.gserviceaccount.com", userManagedKeys: [{ name: "k1", validAfterTime: old }] }],
    broadBindings: [],
    unrestrictedKeys: [],
  };
  const result = analyzeProject(baseArgs({ iam }));
  const finding = result.findings.find((f) => f.kind === "sa-key");
  assert.equal(finding.level, "critical");
});

test("analyzeIam flags a custom service account bound to roles/owner or roles/editor as critical", () => {
  const iam = {
    serviceAccounts: [],
    broadBindings: [{ role: "roles/editor", email: "sa@proj.iam.gserviceaccount.com", isDefaultAgent: false }],
    unrestrictedKeys: [],
  };
  const result = analyzeProject(baseArgs({ iam }));
  const finding = result.findings.find((f) => f.kind === "broad-role");
  assert.ok(finding, "expected a broad-role finding");
  assert.equal(finding.key, "proj:broad-role:sa@proj.iam.gserviceaccount.com:roles/editor");
  assert.equal(finding.level, "critical");
});

test("analyzeIam flags GCP's own default agent holding a broad role as only low (hygiene, not an incident)", () => {
  const iam = {
    serviceAccounts: [],
    broadBindings: [{ role: "roles/editor", email: "proj@appspot.gserviceaccount.com", isDefaultAgent: true }],
    unrestrictedKeys: [],
  };
  const result = analyzeProject(baseArgs({ iam }));
  const finding = result.findings.find((f) => f.kind === "broad-role");
  assert.equal(finding.level, "low");
  assert.match(finding.text, /default account/);
});

test("analyzeIam flags an unrestricted API key as low", () => {
  const iam = { serviceAccounts: [], broadBindings: [], unrestrictedKeys: [{ name: "abc", displayName: "Maps key" }] };
  const result = analyzeProject(baseArgs({ iam }));
  const finding = result.findings.find((f) => f.kind === "api-key");
  assert.ok(finding, "expected an api-key finding");
  assert.equal(finding.level, "low");
  assert.match(finding.text, /Maps key/);
});

// --- three severity tiers ----------------------------------------------------

test("LEVEL_BY_KIND holds every flat-severity kind, and none of the graduated ones", () => {
  assert.equal(LEVEL_BY_KIND.quota_exhausted, "critical");
  assert.equal(LEVEL_BY_KIND.billing, "critical");
  assert.equal(LEVEL_BY_KIND.deploy_failure, "critical");
  assert.equal(LEVEL_BY_KIND.stall, "warn");
  assert.equal(LEVEL_BY_KIND.missing_index, "warn");
  assert.equal(LEVEL_BY_KIND.rules_denied, "warn");
  assert.equal(LEVEL_BY_KIND["function silent"], "warn");
  assert.equal(LEVEL_BY_KIND["run silent"], "warn");
  assert.equal(LEVEL_BY_KIND["function spike"], "warn");
  assert.equal(LEVEL_BY_KIND["run spike"], "warn");
  assert.equal(LEVEL_BY_KIND.api_key_warning, "low");
  assert.equal(LEVEL_BY_KIND.service_account_warning, "low");
  assert.equal(LEVEL_BY_KIND["api-key"], "low");
  // Graduated kinds decide their own level in analyze.js, by design -- see
  // the comment on LEVEL_BY_KIND in config.js.
  for (const kind of ["spike", "failures", "quota", "errors", "sa-key", "broad-role"]) {
    assert.equal(kind in LEVEL_BY_KIND, false, `${kind} is graduated by magnitude, not a flat lookup`);
  }
});

test("worstLevel orders critical < warn < low < ok, and no findings is the only way to reach ok", () => {
  assert.equal(worstLevel([]), "ok");
  assert.equal(worstLevel([{ level: "low" }]), "low");
  assert.equal(worstLevel([{ level: "low" }, { level: "warn" }]), "warn");
  assert.equal(worstLevel([{ level: "low" }, { level: "warn" }, { level: "critical" }]), "critical");
  assert.equal(worstLevel([{ level: "warn" }, { level: "low" }]), "warn");
  // Order of LEVEL_ORDER itself, since worstLevel walks it rather than
  // hard-coding a comparison.
  assert.deepEqual(LEVEL_ORDER, ["critical", "warn", "low", "ok"]);
});

test("a project whose only findings are low gets status low, not warn and not ok", () => {
  const iam = { serviceAccounts: [], broadBindings: [], unrestrictedKeys: [{ name: "abc", displayName: "Maps key" }] };
  const result = analyzeProject(baseArgs({ iam }));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].level, "low");
  assert.equal(result.status, "low");
});

test("a project with any critical finding gets status critical, even alongside warns", () => {
  const spec1 = { key: "firestore.reads", type: "x", kind: "delta" };
  const spec2 = { key: "firestore.writes", type: "y", kind: "delta" };
  const result = analyzeProject(
    baseArgs({
      metricSpecs: [spec1, spec2],
      metricData: { "firestore.reads": historySeries(100), "firestore.writes": historySeries(100) },
      rollingMetricData: {
        "firestore.reads": rollingSeries({ "": 350 }), // warn spike
        "firestore.writes": rollingSeries({ "": 700 }), // critical spike
      },
    })
  );
  assert.equal(result.status, "critical");
});

// --- deploy correlation ----------------------------------------------------
//
// deploys is a Cloud Run service-name -> deployedAt map (deploys.js), keyed
// lowercase because Cloud Run service names always are, while the function
// name it's matched against is camelCase -- the same case fold
// dropRunShadows already applies to pair a gen-2 function with its Cloud Run
// shadow.

test("an entity's deployedAt is matched case-insensitively against the Cloud Run service name", () => {
  const breakdowns = {
    function: { onStudioCreated: { calls: dayValues(10), errors: {} } },
  };
  const deploys = { onstudiocreated: "2026-09-15T10:00:00Z" };
  const result = analyzeProject(baseArgs({ breakdowns, deploys }));
  const entity = result.entities.find((e) => e.name === "onStudioCreated");
  assert.equal(entity.deployedAt, "2026-09-15T10:00:00Z");
});

test("an entity with no matching Cloud Run service gets deployedAt: null, not an absent field", () => {
  const breakdowns = { function: { onStudioCreated: { calls: dayValues(10), errors: {} } } };
  const result = analyzeProject(baseArgs({ breakdowns, deploys: {} }));
  const entity = result.entities.find((e) => e.name === "onStudioCreated");
  assert.equal(entity.deployedAt, null);
});

test("analyzeProject degrades cleanly when deploys is missing entirely (collector failed for this project)", () => {
  const breakdowns = { function: { onStudioCreated: { calls: dayValues(10), errors: {} } } };
  const result = analyzeProject(baseArgs({ breakdowns })); // no `deploys` key at all
  const entity = result.entities.find((e) => e.name === "onStudioCreated");
  assert.equal(entity.deployedAt, null);
});

test("a function-errors finding carries the entity's deployedAt", () => {
  const breakdowns = {
    function: { onStudioCreated: { calls: dayValues(10), errors: dayValues(0) } },
  };
  const rollingBreakdowns = {
    function: { onStudioCreated: { calls: { "2026-09-16": 20 }, errors: { "2026-09-16": 10 } } }, // 50% error rate
  };
  const deploys = { onstudiocreated: "2026-09-16T09:00:00Z" };
  const result = analyzeProject(baseArgs({ breakdowns, rollingBreakdowns, deploys }));
  const finding = result.findings.find((f) => f.kind === "function errors");
  assert.ok(finding);
  assert.equal(finding.deployedAt, "2026-09-16T09:00:00Z");
});

test("a finding for an entity with no known deploy carries no deployedAt field at all -- not an empty slot", () => {
  const breakdowns = {
    function: { onStudioCreated: { calls: dayValues(10), errors: dayValues(0) } },
  };
  const rollingBreakdowns = {
    function: { onStudioCreated: { calls: { "2026-09-16": 20 }, errors: { "2026-09-16": 10 } } },
  };
  const result = analyzeProject(baseArgs({ breakdowns, rollingBreakdowns, deploys: {} }));
  const finding = result.findings.find((f) => f.kind === "function errors");
  assert.ok(finding);
  assert.ok(!("deployedAt" in finding), "a finding with no deploy data must not carry a null/empty deployedAt slot");
});

test("a non-entity finding (sa-key) never carries deployedAt -- there is no deploy to point at", () => {
  const iam = {
    serviceAccounts: [{ email: "sa@proj.iam.gserviceaccount.com", userManagedKeys: [{ name: "k1", validAfterTime: "2026-09-01T00:00:00Z" }] }],
    broadBindings: [],
    unrestrictedKeys: [],
  };
  const result = analyzeProject(baseArgs({ iam, deploys: { onstudiocreated: "2026-09-16T09:00:00Z" } }));
  const finding = result.findings.find((f) => f.kind === "sa-key");
  assert.ok(finding);
  assert.ok(!("deployedAt" in finding));
});
