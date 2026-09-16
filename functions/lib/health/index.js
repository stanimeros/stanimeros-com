// Orchestrates one sweep: fetch every project, analyse, persist, notify.
//
// The sweep is deliberately fault-tolerant per project. One project that 403s
// must not lose the other fourteen — it lands in `projectErrors` and renders as
// "not checked", never as healthy, because a permission that quietly lapses
// otherwise looks exactly like good news.

const admin = require("firebase-admin");

const { PROJECTS, METRICS, BREAKDOWNS, BILLING_ACCOUNT, FAILURE_LABELS, LIMITS, thresholdsFor } = require("./config");
const { getAccessToken } = require("./auth");
const { timeseries, breakdown, windowFor, todayWindow } = require("./monitoring");
const { readErrors } = require("./logging");
const { fetchCosts, fetchBillingTotal } = require("./billing");
const { collectIam } = require("./iam");
const { analyzeProject, worstLevel } = require("./analyze");
const { notifyIfNew, newKeys } = require("./notify");

// The only metrics a same-day failure-rate check needs -- see
// analyze.js's analyzeLiveFailures. Fetching just these two, not all of
// METRICS, keeps the extra same-day query cheap.
const LIVE_METRICS = METRICS.filter((spec) => FAILURE_LABELS[spec.key]);

if (!admin.apps.length) admin.initializeApp();

const REPORTS = "health_reports";
const STATE = "health_state";
const HOST_PROJECT = "stanimeros-dev";

// How many projects to sweep at once. Six keeps the whole run near half a
// minute without pushing Monitoring into per-minute quota.
const CONCURRENCY = 6;

function runId(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// Fetch everything one project needs. Throws with a `stage` so a failure can
// say which half of the sweep broke.
async function collect(project, token, cfg) {
  const { start, end } = windowFor(cfg.baselineDays);

  const metricData = {};
  try {
    const series = await Promise.all(
      METRICS.map((spec) => timeseries(project.id, spec, start, end, token))
    );
    METRICS.forEach((spec, i) => { metricData[spec.key] = series[i]; });
  } catch (err) {
    err.stage = "monitoring";
    throw err;
  }

  const breakdowns = {};
  try {
    const parts = await Promise.all(
      BREAKDOWNS.map((spec) => breakdown(project.id, spec, start, end, token))
    );
    BREAKDOWNS.forEach((spec, i) => { breakdowns[spec.kind] = parts[i]; });
  } catch (err) {
    err.stage = "breakdown";
    throw err;
  }

  // readErrors already degrades to count:null internally rather than throwing —
  // a project whose logs can't be read must not look like one with no errors.
  const log = await readErrors(project.id, cfg.logHours, token);

  // Both of these are additive, non-core checks (same-day failure rate; IAM
  // hygiene) layered on top of the metrics/log checks above, which already
  // work on every project's existing monitoring.viewer/logging.viewer grant.
  // Neither should be able to take the rest of the project's sweep down —
  // the live window degrades quietly to {} on failure, and collectIam
  // degrades internally per-check (see iam.js) since its grant rolls out
  // separately, project by project.
  let liveMetricData = {};
  try {
    const { start: liveStart, end: liveEnd } = todayWindow();
    const series = await Promise.all(
      LIVE_METRICS.map((spec) => timeseries(project.id, spec, liveStart, liveEnd, token))
    );
    LIVE_METRICS.forEach((spec, i) => { liveMetricData[spec.key] = series[i]; });
  } catch (err) {
    console.log(`live metrics unavailable for ${project.id} -- ${String(err.message || err).slice(0, 200)}`);
  }

  const iam = await collectIam(project.id, token);

  return { metricData, breakdowns, log, liveMetricData, iam };
}

async function buildReport({ mode = "scheduled", projects = PROJECTS } = {}) {
  const startedAt = new Date();
  const token = await getAccessToken();
  const cfg = thresholdsFor(null);

  const ids = projects.map((p) => p.id);
  const [costs, total] = await Promise.all([
    fetchCosts(ids, { token, datasetProject: HOST_PROJECT, datasetId: process.env.HEALTH_BILLING_DATASET }),
    fetchBillingTotal({ token, datasetProject: HOST_PROJECT, datasetId: process.env.HEALTH_BILLING_DATASET }),
  ]);

  const projectErrors = [];
  const results = await mapWithLimit(projects, CONCURRENCY, async (project) => {
    const projectCfg = thresholdsFor(project.id);
    try {
      const { metricData, breakdowns, log, liveMetricData, iam } = await collect(project, token, projectCfg);
      return analyzeProject({
        project,
        metricSpecs: METRICS,
        metricData,
        breakdowns,
        log,
        cost: (costs && costs[project.id]) || null,
        cfg: projectCfg,
        billingAccount: BILLING_ACCOUNT,
        liveMetricData,
        iam,
      });
    } catch (err) {
      projectErrors.push({
        project: project.id,
        stage: err.stage || "unknown",
        error: String(err.message || err).slice(0, 300),
      });
      return null;
    }
  });

  const checked = results.filter(Boolean);
  const counts = { critical: 0, warn: 0, ok: 0, total: projects.length };
  for (const result of checked) counts[result.status] += 1;

  return {
    runId: runId(startedAt),
    generated: startedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    mode,
    baselineDays: cfg.baselineDays,
    logHours: cfg.logHours,
    durationMs: Date.now() - startedAt.getTime(),
    status: worstLevel(checked.flatMap((r) => r.findings)),
    counts,
    costTotal: total ? total.costTotal : null,
    costCurrency: total ? total.costCurrency : "EUR",
    costWindowDays: total ? total.costWindowDays : 30,
    newFindingKeys: [],
    projects: checked,
    projectErrors,
  };
}

async function previousState(db) {
  const snap = await db.collection(STATE).doc("latest").get();
  return snap.exists ? snap.data() : { findingKeys: [] };
}

// 180 days x 3 runs ≈ 540 documents, so a bounded batch per run is plenty —
// no need to loop until empty and risk running long.
async function pruneOldReports(db) {
  // Same second-precision shape the reports are written with — `generated` is
  // compared as a string, so a cutoff carrying milliseconds would sort wrong
  // against values that don't.
  const cutoff = new Date(Date.now() - LIMITS.reportRetentionDays * 86400000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const snap = await db
    .collection(REPORTS)
    .where("generated", "<", cutoff)
    .limit(50)
    .get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
}

/**
 * The whole job: sweep, persist, diff, mail. Returns a small summary rather
 * than the report itself, so a callable can await it cheaply.
 */
async function runHealthCheck({ mode = "scheduled" } = {}) {
  const db = admin.firestore();
  const report = await buildReport({ mode });
  const previous = await previousState(db);

  // A manual run is someone sitting in front of the dashboard, so mailing them
  // what they are already looking at is noise. It must also leave the alert
  // state alone: recording its findings as "seen" would mean the next scheduled
  // run treats them as old news and never sends the alert at all — clicking
  // "Run now" would silently disarm the thing the tool exists to do.
  const alerting = mode !== "manual";

  const { sent, keys } = alerting
    ? await notifyIfNew(report, previous.findingKeys, {
        to: process.env.HEALTH_EMAIL_TO,
        dashboardUrl: "https://stanimeros.com/health",
      })
    : { sent: false, keys: [] };

  // Still worth showing on the page which findings are new relative to the last
  // run — the diff is useful information even when it isn't mailed.
  report.newFindingKeys = alerting ? keys : newKeys(report, previous.findingKeys);

  const allKeys = report.projects.flatMap((p) => p.findings.map((f) => f.key));
  await db.collection(REPORTS).doc(report.runId).set(report);
  if (alerting) {
    await db.collection(STATE).doc("latest").set({
      runId: report.runId,
      generated: report.generated,
      status: report.status,
      findingKeys: allKeys,
      ...(sent
        ? { lastEmailAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), lastEmailKeys: keys }
        : {}),
    }, { merge: true });
  }

  const pruned = await pruneOldReports(db);

  return {
    runId: report.runId,
    status: report.status,
    counts: report.counts,
    newFindings: report.newFindingKeys.length,
    emailed: sent,
    alerting,
    notChecked: report.projectErrors.length,
    prunedReports: pruned,
    durationMs: report.durationMs,
  };
}

module.exports = { runHealthCheck, buildReport, mapWithLimit, runId, REPORTS, STATE };
