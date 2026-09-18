// Orchestrates one sweep: fetch every project, analyse, persist, notify.
//
// The sweep is deliberately fault-tolerant per project. One project that 403s
// must not lose the other fourteen — it lands in `projectErrors` and renders as
// "not checked", never as healthy, because a permission that quietly lapses
// otherwise looks exactly like good news.

const admin = require("firebase-admin");

const { PROJECTS, METRICS, BREAKDOWNS, BILLING_ACCOUNT, LIMITS, thresholdsFor, isoSecond } = require("./config");
const { getAccessToken } = require("./auth");
const { timeseries, breakdown, windowFor, rollingWindow } = require("./monitoring");
const { readErrors } = require("./logging");
const { fetchCosts, fetchOtherCost, fetchBillingTotal, fetchCostDataThrough } = require("./billing");
const { collectIam } = require("./iam");
const { collectDeploys } = require("./deploys");
const { readClientErrors } = require("./clientErrors");
const { collectCrashlytics } = require("./crashlytics");
const { analyzeProject, worstLevel } = require("./analyze");
const { notifyIfNew } = require("./notify");
const { updateLifecycle } = require("./lifecycle");

if (!admin.apps.length) admin.initializeApp();

const REPORTS = "health_reports";
const STATE = "health_state";
const HOST_PROJECT = "stanimeros-dev";

// How many projects to sweep at once. Six keeps the whole run near half a
// minute without pushing Monitoring into per-minute quota.
const CONCURRENCY = 6;

function runId(date) {
  return isoSecond(date).replace(/:/g, "-");
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
  const { start: historyStart, end: historyEnd } = windowFor(cfg.baselineDays);
  const { start: rollingStart, end: rollingEnd } = rollingWindow();

  // Both windows feed every metric check (spike/stall/quota/failures) --
  // history is the baseline, rolling is "now" -- so a failure to read either
  // one means those checks can't run at all for this project. One try/catch,
  // one stage: a project that 403s here renders as "not checked", not as a
  // silent pass, same as before.
  const metricData = {};
  const rollingMetricData = {};
  try {
    const [historySeries, rollingSeries] = await Promise.all([
      Promise.all(METRICS.map((spec) => timeseries(project.id, spec, historyStart, historyEnd, token))),
      Promise.all(METRICS.map((spec) => timeseries(project.id, spec, rollingStart, rollingEnd, token))),
    ]);
    METRICS.forEach((spec, i) => { metricData[spec.key] = historySeries[i]; });
    METRICS.forEach((spec, i) => { rollingMetricData[spec.key] = rollingSeries[i]; });
  } catch (err) {
    err.stage = "monitoring";
    throw err;
  }

  // Same history/rolling split as the metrics above, and for the same
  // reason: a per-function "now" must match what Cloud Console's own "last
  // 24 hours" shows, not whatever the newest complete UTC day happened to be.
  const breakdowns = {};
  const rollingBreakdowns = {};
  try {
    const [historyParts, rollingParts] = await Promise.all([
      Promise.all(BREAKDOWNS.map((spec) => breakdown(project.id, spec, historyStart, historyEnd, token))),
      Promise.all(BREAKDOWNS.map((spec) => breakdown(project.id, spec, rollingStart, rollingEnd, token))),
    ]);
    BREAKDOWNS.forEach((spec, i) => { breakdowns[spec.kind] = historyParts[i]; });
    BREAKDOWNS.forEach((spec, i) => { rollingBreakdowns[spec.kind] = rollingParts[i]; });
  } catch (err) {
    err.stage = "breakdown";
    throw err;
  }

  // readErrors already degrades to count:null internally rather than throwing —
  // a project whose logs can't be read must not look like one with no errors.
  const log = await readErrors(project.id, cfg.logHours, token);

  // Additive, non-core (IAM hygiene) on top of the metrics/log checks above,
  // which already work on every project's existing
  // monitoring.viewer/logging.viewer grant. collectIam degrades internally
  // per-check (see iam.js) since its own grant rolls out separately, project
  // by project -- it must not be able to take the rest of the sweep down.
  const iam = await collectIam(project.id, token);

  // Deploy correlation: one more additive, degrade-per-project read on top
  // of the checks above -- its own grant (roles/run.viewer) rolls out
  // per-project too, same as collectIam's. See deploys.js for why this is a
  // single call, and lifecycle.js for why a deploy never resolves a finding.
  const deploys = await collectDeploys(project.id, token);

  // Crashlytics: additive, degrades internally per-project (see
  // crashlytics.js) -- a project with no export configured (crashlyticsApps:
  // [], the default for all of them today) costs this call nothing but a map
  // lookup, no network round trip.
  const crashlytics = await collectCrashlytics(project.id, project.crashlyticsApps, cfg.logHours, token);

  return { metricData, rollingMetricData, breakdowns, rollingBreakdowns, log, iam, deploys, crashlytics };
}

async function buildReport({ mode = "scheduled", projects = PROJECTS } = {}) {
  const startedAt = new Date();
  const token = await getAccessToken();
  const cfg = thresholdsFor(null);

  const ids = projects.map((p) => p.id);
  const billingOpts = { token, datasetProject: HOST_PROJECT, datasetId: process.env.HEALTH_BILLING_DATASET };
  // costDataThrough has to land first: it anchors the windowed queries below
  // (asOf) instead of wall-clock now, so "last 30 days" means the 30 days
  // ending at the export's actual newest day. Without this, an export that's
  // fallen more than windowDays behind finds nothing -- every figure reads
  // as no-spend even though the data is sitting right there in BigQuery.
  const costDataThrough = await fetchCostDataThrough(billingOpts);
  const asOf = costDataThrough
    ? new Date(new Date(`${costDataThrough}T00:00:00Z`).getTime() + 86400000)
    : undefined;
  const [costs, otherCost, total] = await Promise.all([
    fetchCosts(ids, { ...billingOpts, asOf }),
    fetchOtherCost({ ...billingOpts, asOf }),
    fetchBillingTotal({ ...billingOpts, asOf }),
  ]);

  // A1: `cost: null` on its own can't tell "Spark project, normal" apart
  // from "the export died six weeks ago" -- both look identical to every
  // windowed query. costDataThrough is the newest day the export actually
  // has; costStale says whether that's still fresh enough to trust. A daily
  // export that's more than a couple of days behind isn't running, so this
  // deliberately doesn't wait for a whole missed window before saying so.
  const COST_STALE_AFTER_DAYS = 3;
  const costStale =
    costDataThrough == null ||
    Date.now() - new Date(`${costDataThrough}T00:00:00Z`).getTime() > COST_STALE_AFTER_DAYS * 86400000;

  // One read for the whole estate, same shape billing's cost fetch above
  // takes -- every project's client errors land in this project's own Cloud
  // Logging (see clientErrors.js), so there is no per-project call to make.
  const clientErrorsByProject = await readClientErrors(cfg.logHours, token, ids);

  const projectErrors = [];
  const results = await mapWithLimit(projects, CONCURRENCY, async (project) => {
    const projectCfg = thresholdsFor(project.id);
    try {
      const { metricData, rollingMetricData, breakdowns, rollingBreakdowns, log, iam, deploys, crashlytics } =
        await collect(project, token, projectCfg);
      return analyzeProject({
        project,
        metricSpecs: METRICS,
        metricData,
        rollingMetricData,
        breakdowns,
        rollingBreakdowns,
        log,
        cost: (costs && costs[project.id]) || null,
        cfg: projectCfg,
        billingAccount: BILLING_ACCOUNT,
        iam,
        deploys,
        clientErrors: clientErrorsByProject[project.id],
        crashlytics,
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
  const counts = { critical: 0, warn: 0, low: 0, ok: 0, total: projects.length };
  for (const result of checked) counts[result.status] += 1;

  return {
    runId: runId(startedAt),
    generated: isoSecond(startedAt),
    mode,
    baselineDays: cfg.baselineDays,
    logHours: cfg.logHours,
    durationMs: Date.now() - startedAt.getTime(),
    status: worstLevel(checked.flatMap((r) => r.findings)),
    counts,
    costTotal: total ? total.costTotal : null,
    costCurrency: total ? total.costCurrency : "EUR",
    costWindowDays: total ? total.costWindowDays : 30,
    // Account-level charges with no project.id at all (invoice adjustments,
    // rounding) -- counted in costTotal but excluded from every per-project
    // figure, so without this the total silently stopped reconciling with
    // the sum of projects the moment one of these showed up.
    otherCost,
    costDataThrough,
    costStale,
    projects: checked,
    projectErrors,
  };
}

async function previousState(db) {
  const snap = await db.collection(STATE).doc("latest").get();
  return snap.exists ? snap.data() : { findingKeys: [] };
}

// 90 days x 3 runs ≈ 270 documents, so a bounded batch per run is plenty —
// no need to loop until empty and risk running long.
async function pruneOldReports(db) {
  // Same second-precision shape the reports are written with — `generated` is
  // compared as a string, so a cutoff carrying milliseconds would sort wrong
  // against values that don't.
  const cutoff = isoSecond(new Date(Date.now() - LIMITS.reportRetentionDays * 86400000));
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

  // Ahead of notifyIfNew, not after: this run's ack state (what got marked
  // resolved as of right now) is what keeps a resolved finding out of an
  // alert email's context section — see notify.js's renderEmail. Unlike
  // health_state/latest below, this write always happens, manual runs
  // included — health_findings is just bookkeeping over what happened, not
  // part of the alert-arming state that "Run now" must leave alone.
  const { ackedKeys } = await updateLifecycle(db, report, new Date(report.generated));

  const { sent, keys } = await notifyIfNew(report, previous.findingKeys, {
    to: process.env.HEALTH_EMAIL_TO,
    // stanimeros-health.web.app until DNS for health.stanimeros.com is
    // pointed at the new Hosting site -- update once that's live.
    dashboardUrl: "https://stanimeros-health.web.app",
    ackedKeys,
    alerting,
  });

  const allKeys = report.projects.flatMap((p) => p.findings.map((f) => f.key));
  await db.collection(REPORTS).doc(report.runId).set(report);
  if (alerting) {
    await db.collection(STATE).doc("latest").set({
      runId: report.runId,
      generated: report.generated,
      status: report.status,
      findingKeys: allKeys,
      ...(sent
        ? { lastEmailAt: isoSecond(), lastEmailKeys: keys }
        : {}),
    }, { merge: true });
  }

  const pruned = await pruneOldReports(db);

  return {
    runId: report.runId,
    status: report.status,
    counts: report.counts,
    newFindings: keys.length,
    emailed: sent,
    alerting,
    notChecked: report.projectErrors.length,
    prunedReports: pruned,
    durationMs: report.durationMs,
  };
}

module.exports = { runHealthCheck, buildReport, REPORTS };
