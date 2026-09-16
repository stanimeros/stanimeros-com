// Turns raw series into findings. This is the file that decides what is worth
// waking someone up about, so every threshold here is deliberate.
//
// Output is camelCase, matching docs/health-schema.md — the engine's internal
// snake_case is converted once, here, at the boundary.

const { FAILURE_LABELS, LIMITS } = require("./config");
const { dropRunShadows } = require("./monitoring");
const { ALWAYS_REPORT } = require("./logging");

// Median, not mean: one bad day shouldn't raise the bar and hide the next one.
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatValue(value, unit) {
  if (unit === "bytes") {
    let size = Number(value);
    for (const suffix of ["B", "KB", "MB", "GB", "TB"]) {
      if (size < 1024 || suffix === "TB") {
        return suffix === "B" ? `${Math.round(size)}B` : `${size.toFixed(1)}${suffix}`;
      }
      size /= 1024;
    }
  }
  return Math.round(Number(value)).toLocaleString("en-US");
}

// A finding key must stay identical across runs for the same underlying problem —
// it is the whole basis of "email only on something new", so it may never
// contain a count, a ratio, or a timestamp.
function findingKey(projectId, kind, subject) {
  return `${projectId}:${String(kind).replace(/\s+/g, ".")}:${subject}`;
}

function worstLevel(findings) {
  if (findings.some((f) => f.level === "critical")) return "critical";
  return findings.length ? "warn" : "ok";
}

// --- metric-level findings ------------------------------------------------

function analyzeMetric(projectId, spec, data, plan, cfg, findings) {
  const totals = {};
  for (const bucket of Object.values(data)) {
    for (const [day, value] of Object.entries(bucket)) {
      totals[day] = (totals[day] || 0) + value;
    }
  }
  const days = Object.keys(totals).sort();
  if (!days.length) return null;

  const ordered = days.map((d) => totals[d]);
  const latest = ordered[ordered.length - 1];
  const history = ordered.slice(0, -1);
  const baseline = median(history);
  const unit = spec.unit || null;

  // Bytes need a far higher floor than counts — 100 bytes is not a spike.
  // A metric with a known free-tier ceiling (Firestore reads/writes/deletes,
  // hosting egress, ...) also floors at a fraction of that ceiling — this
  // project is internal-only, so a 10x ratio on 40 reads is not worth an
  // email, whatever the ratio says. Applies on every plan, not just Spark:
  // the quota check below is Spark-only, but a tiny absolute number is noise
  // on Blaze too.
  // Cloud Storage metrics (egress, total) specifically float around a lot
  // between small projects without meaning anything — nothing under 300MB is
  // worth a warning either way.
  const bytesFloor = spec.key.startsWith("storage.") ? 300 * 1024 * 1024 : 10 * 1024 * 1024;
  const floor = Math.max(
    cfg.spikeFloor,
    unit === "bytes" ? bytesFloor : 0,
    spec.freeDaily ? spec.freeDaily * cfg.quietFraction : 0
  );

  if (latest >= floor && baseline > 0 && latest / baseline >= cfg.spikeRatio) {
    const ratio = latest / baseline;
    findings.push({
      key: findingKey(projectId, "spike", spec.key),
      level: ratio >= cfg.spikeRatio * 2 ? "critical" : "warn",
      kind: "spike",
      text: `${spec.key} ${formatValue(latest, unit)} vs baseline ${formatValue(baseline, unit)} (${ratio.toFixed(1)}x)`,
    });
  } else if (latest === 0 && baseline >= floor) {
    findings.push({
      key: findingKey(projectId, "stall", spec.key),
      level: "warn",
      kind: "stall",
      text: `${spec.key} dropped to zero (baseline ${formatValue(baseline, unit)}) — possible outage`,
    });
  }

  // A failure-labelled sub-series becomes its own error signal.
  const isFailure = FAILURE_LABELS[spec.key];
  let failedLatest = 0;
  if (isFailure) {
    for (const [label, bucket] of Object.entries(data)) {
      if (!isFailure(label)) continue;
      const perDay = days.map((d) => bucket[d] || 0);
      failedLatest += perDay[perDay.length - 1];
    }
    if (failedLatest) {
      const share = latest ? failedLatest / latest : 1;
      if (failedLatest >= cfg.errorFloor && share >= 0.05) {
        findings.push({
          key: findingKey(projectId, "failures", spec.key),
          level: share >= 0.25 ? "critical" : "warn",
          kind: "failures",
          text: `${spec.key} failure rate ${Math.round(share * 100)}% (${formatValue(failedLatest)} of ${formatValue(latest)})`,
        });
      }
    }
  }

  // Spark projects have a ceiling worth warning about before it is hit.
  if (plan === "Spark" && spec.freeDaily) {
    const used = latest / spec.freeDaily;
    if (used >= cfg.freeTierWarn) {
      findings.push({
        key: findingKey(projectId, "quota", spec.key),
        level: used >= 1 ? "critical" : "warn",
        kind: "quota",
        text: `${spec.key} at ${Math.round(used * 100)}% of the free daily allowance (${formatValue(latest, unit)} / ${formatValue(spec.freeDaily, unit)})`,
      });
    }
  }

  return { latest, baseline, unit, history: ordered, days, failedLatest };
}

// --- per-entity findings --------------------------------------------------

function analyzeEntities(projectId, breakdowns, cfg, findings) {
  const entities = [];

  for (const [kind, byName] of Object.entries(breakdowns)) {
    for (const [name, data] of Object.entries(byName)) {
      const days = [...new Set([...Object.keys(data.calls), ...Object.keys(data.errors)])].sort();
      if (!days.length) continue;

      const calls = days.map((d) => data.calls[d] || 0);
      const errors = days.map((d) => data.errors[d] || 0);
      const callsNow = calls[calls.length - 1];
      const errorsNow = errors[errors.length - 1];
      const callsBaseline = calls.length > 1 ? median(calls.slice(0, -1)) : 0;
      const errorRate = callsNow ? errorsNow / callsNow : 0;

      entities.push({
        name,
        kind,
        calls: callsNow,
        callsBaseline,
        callsHistory: calls,
        errors: errorsNow,
        errorsHistory: errors,
        errorRate,
        logErrors: 0,
        days,
      });

      if (errorsNow >= 5 && errorRate >= 0.05) {
        findings.push({
          key: findingKey(projectId, `${kind} errors`, name),
          level: errorRate >= 0.25 ? "critical" : "warn",
          kind: `${kind} errors`,
          text: `${name}: ${formatValue(errorsNow)} failed of ${formatValue(callsNow)} calls (${Math.round(errorRate * 100)}%)`,
        });
      } else if (callsNow === 0 && callsBaseline >= cfg.spikeFloor) {
        findings.push({
          key: findingKey(projectId, `${kind} silent`, name),
          level: "warn",
          kind: `${kind} silent`,
          text: `${name}: no calls in the last full day (baseline ${formatValue(callsBaseline)}/day)`,
        });
      } else if (callsNow >= cfg.spikeFloor && callsBaseline > 0 && callsNow / callsBaseline >= cfg.spikeRatio) {
        findings.push({
          key: findingKey(projectId, `${kind} spike`, name),
          level: "warn",
          kind: `${kind} spike`,
          text: `${name}: ${formatValue(callsNow)} calls vs baseline ${formatValue(callsBaseline)} (${(callsNow / callsBaseline).toFixed(1)}x)`,
        });
      }
    }
  }

  const { entities: kept, shadowedCalls } = dropRunShadows(entities);
  kept.sort((a, b) => b.errors - a.errors || b.calls - a.calls);
  return { entities: kept, shadowedCalls };
}

// --- log findings ---------------------------------------------------------

function analyzeLog(projectId, log, logHours, cfg, findings) {
  if (log.count !== null && log.count >= cfg.errorFloor) {
    const more = log.truncated ? "+" : "";
    const worst = Object.entries(log.sources)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([source, n]) => `${source} (${n})`)
      .join(", ");
    findings.push({
      // Deliberately not keyed on the count: an ongoing error burst is one
      // problem, not a new one every run.
      key: findingKey(projectId, "errors", "volume"),
      level: log.count >= cfg.criticalErrors ? "critical" : "warn",
      kind: "errors",
      text: `${log.count}${more} error log entries in the last ${logHours}h${worst ? ` — worst: ${worst}` : ""}`,
    });
  }

  // These are quiet and each has one specific fix, so they report however few.
  for (const [kind, count] of Object.entries(log.kinds || {})) {
    if (!ALWAYS_REPORT.has(kind)) continue;
    findings.push({
      key: findingKey(projectId, kind, "log"),
      level: kind === "billing" || kind === "quota_exhausted" ? "critical" : "warn",
      kind,
      text: `${count}x ${kind.replace(/_/g, " ")} in the last ${logHours}h`,
    });
  }
}

// --- one project ----------------------------------------------------------

/**
 * Assemble one ProjectResult from already-fetched data. Pure: no I/O, so the
 * thresholds can be unit-tested without touching Google.
 */
function analyzeProject({ project, metricSpecs, metricData, breakdowns, log, cost, cfg, billingAccount }) {
  const findings = [];
  const metrics = {};

  for (const spec of metricSpecs) {
    const data = metricData[spec.key];
    if (!data || !Object.keys(data).length) continue;
    const summary = analyzeMetric(project.id, spec, data, project.plan, cfg, findings);
    if (!summary) continue;
    metrics[spec.key] = {
      latest: summary.latest,
      baseline: summary.baseline,
      unit: summary.unit,
      history: summary.history,
      days: summary.days,
    };
    if (summary.failedLatest) {
      metrics[`${spec.key}.failed`] = {
        latest: summary.failedLatest,
        baseline: 0,
        unit: null,
        history: [],
        days: [],
      };
    }
  }

  const { entities, shadowedCalls } = analyzeEntities(project.id, breakdowns, cfg, findings);
  if (shadowedCalls && metrics["run.requests"]) {
    metrics["run.requests"].shadowedCalls = shadowedCalls;
  }

  analyzeLog(project.id, log, cfg.logHours, cfg, findings);

  // Attach the log's per-source error count to the entity it belongs to.
  for (const entity of entities) {
    entity.logErrors = (log.sources && log.sources[`${entity.kind}:${entity.name}`]) || 0;
  }

  findings.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));

  const entitiesTotal = entities.length;
  const topErrors = (log.top || []).slice(0, LIMITS.topErrorsPerProject);

  return {
    project: project.id,
    name: project.name,
    plan: project.plan,
    status: worstLevel(findings),
    billingAccount: project.plan === "Spark" ? null : billingAccount,
    cost: cost || null,
    findings,
    metrics,
    // Capped so 15 projects can't push the report past Firestore's 1 MiB limit.
    entities: entities.slice(0, LIMITS.entitiesPerProject),
    entitiesTotal,
    errorCount: log.count,
    errorTruncated: log.truncated,
    errorKinds: log.kinds || {},
    errorSources: log.sources || {},
    topErrors,
    topErrorsTotal: (log.top || []).length,
  };
}

module.exports = { analyzeProject, median, formatValue, findingKey, worstLevel };
