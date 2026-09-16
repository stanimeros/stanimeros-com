// Turns raw series into findings. This is the file that decides what is worth
// waking someone up about, so every threshold here is deliberate.
//
// Output is camelCase, matching docs/health-schema.md — the engine's internal
// snake_case is converted once, here, at the boundary.

const { FAILURE_LABELS, LIMITS, failureThresholdsFor } = require("./config");
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

// Bytes need a far higher floor than counts — 100 bytes is not a spike. A
// metric with a known free-tier ceiling (Firestore reads/writes/deletes,
// hosting egress, ...) also floors at a fraction of that ceiling — this
// project is internal-only, so a 10x ratio on 40 reads is not worth an
// email, whatever the ratio says. Applies on every plan, not just Spark: the
// quota check is Spark-only, but a tiny absolute number is noise on Blaze
// too. Cloud Storage metrics (egress, total) specifically float around a lot
// between small projects without meaning anything — nothing under 300MB is
// worth a warning either way.
function spikeFloorFor(spec, cfg) {
  const unit = spec.unit || null;
  const bytesFloor = spec.key.startsWith("storage.") ? 300 * 1024 * 1024 : 10 * 1024 * 1024;
  return Math.max(cfg.spikeFloor, unit === "bytes" ? bytesFloor : 0, spec.freeDaily ? spec.freeDaily * cfg.quietFraction : 0);
}

/**
 * One metric's findings. `historyData` builds the baseline (median of `days`
 * complete prior UTC days, from monitoring.js's windowFor); `rollingData` is
 * the current reading (a rolling last-24-hours, from rollingWindow) that
 * every check -- spike, stall, quota, failure rate -- compares against it.
 * Both windows are always a full 24h, so this is one check per concern, not
 * a yesterday-only version plus a same-day one: a rolling window can't read
 * artificially low from being "partial" the way a UTC-calendar-day bucket
 * can before it's over.
 *
 * `suppressFindings` (run.requests only, when it's at least partly shadowed
 * by matching Cloud Functions -- see the caller and dropRunShadows in
 * monitoring.js) still computes latest/baseline for display in `metrics`,
 * but skips pushing spike/stall/failures findings: functions.calls already
 * covers the same underlying traffic, and there's no reliable way to
 * subtract just the shadowed portion here since the entity breakdown that
 * knows the shadow amount runs on a different (historical, day-aligned)
 * window than this rolling one -- subtracting a mismatched-window number
 * doesn't cancel out and was previously (wrongly) leaving both metrics
 * spiking on the same event with two different, still-nonzero totals.
 */
function analyzeMetric(projectId, spec, historyData, rollingData, plan, cfg, findings, suppressFindings = false) {
  const historyTotals = {};
  for (const bucket of Object.values(historyData || {})) {
    for (const [day, value] of Object.entries(bucket)) {
      historyTotals[day] = (historyTotals[day] || 0) + value;
    }
  }
  const days = Object.keys(historyTotals).sort();
  const history = days.map((d) => historyTotals[d]);
  const baseline = median(history);

  const isFailure = FAILURE_LABELS[spec.key];
  let latest = 0;
  let failedLatest = 0;
  for (const [label, bucket] of Object.entries(rollingData || {})) {
    const sum = Object.values(bucket).reduce((a, b) => a + b, 0);
    latest += sum;
    if (isFailure && isFailure(label)) failedLatest += sum;
  }

  // Nothing here or in the past -- the service simply isn't used in this
  // project. Some activity in only one of the two windows (a metric just
  // starting up, or one that stopped) is real and falls through below.
  if (!days.length && !latest) return null;

  const unit = spec.unit || null;

  if (!suppressFindings) {
    const floor = spikeFloorFor(spec, cfg);

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
        text: `${spec.key} dropped to zero over the last 24h (baseline ${formatValue(baseline, unit)}) — possible outage`,
      });
    }

    // A failure-labelled sub-series becomes its own error signal.
    if (isFailure && failedLatest) {
      const share = latest ? failedLatest / latest : 1;
      const t = failureThresholdsFor(spec.key, cfg);
      if (failedLatest >= t.errorFloor && share >= t.share) {
        findings.push({
          key: findingKey(projectId, "failures", spec.key),
          level: share >= t.criticalShare ? "critical" : "warn",
          kind: "failures",
          text: `${spec.key} failure rate ${Math.round(share * 100)}% over the last 24h (${formatValue(failedLatest)} of ${formatValue(latest)})`,
        });
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
          text: `${spec.key} at ${Math.round(used * 100)}% of the free daily allowance over the last 24h (${formatValue(latest, unit)} / ${formatValue(spec.freeDaily, unit)})`,
        });
      }
    }
  }

  return { latest, baseline, unit, history, days, failedLatest };
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

// --- IAM / key hygiene findings ---------------------------------------------

function daysSince(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

function analyzeIam(projectId, iam, cfg, findings) {
  if (!iam) return;

  for (const sa of iam.serviceAccounts || []) {
    for (const key of sa.userManagedKeys || []) {
      const age = daysSince(key.validAfterTime);
      const ageText = age === null ? "" : ` (${Math.round(age)}d old)`;
      findings.push({
        key: findingKey(projectId, "sa-key", `${sa.email}:${key.name}`),
        level: age !== null && age >= cfg.saKeyCriticalDays ? "critical" : "warn",
        kind: "sa-key",
        text: `${sa.email} has a downloadable key${ageText} — rotate to keyless auth (ADC/workload identity) if possible`,
      });
    }
  }

  for (const binding of iam.broadBindings || []) {
    const text = binding.isDefaultAgent
      ? `${binding.email} — GCP's default account for this project — still holds ${binding.role}; narrowing it is optional but a well-known best practice`
      : `${binding.email} holds ${binding.role} on the project — this looks like a custom account with full project access, worth reviewing`;
    findings.push({
      key: findingKey(projectId, "broad-role", `${binding.email}:${binding.role}`),
      level: binding.isDefaultAgent ? "warn" : "critical",
      kind: "broad-role",
      text,
    });
  }

  for (const apiKey of iam.unrestrictedKeys || []) {
    findings.push({
      key: findingKey(projectId, "api-key", apiKey.name),
      level: "warn",
      kind: "api-key",
      text: `API key "${apiKey.displayName || apiKey.name}" has no restrictions — anyone who gets it can use it from anywhere`,
    });
  }
}

// --- log findings ---------------------------------------------------------

function analyzeLog(projectId, log, logHours, cfg, findings) {
  // No floor here, unlike the Monitoring-derived checks above: those are
  // ratios/rates that need real volume to mean anything, but a real
  // ERROR-severity log entry is a real error regardless of count -- the
  // dashboard must never show a green "no findings" card next to a nonzero
  // error count, which a floor here would do for any count below it.
  if (log.count !== null && log.count > 0) {
    const more = log.truncated ? "+" : "";
    findings.push({
      // Deliberately not keyed on the count: an ongoing error burst is one
      // problem, not a new one every run.
      key: findingKey(projectId, "errors", "volume"),
      level: log.count >= cfg.criticalErrors ? "critical" : "warn",
      kind: "errors",
      text: `${log.count}${more} error log entries in the last ${logHours}h`,
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
function analyzeProject({
  project,
  metricSpecs,
  metricData,
  rollingMetricData,
  breakdowns,
  log,
  cost,
  cfg,
  billingAccount,
  iam,
}) {
  const findings = [];
  const metrics = {};

  // Computed before the metrics loop so run.requests knows whether it's
  // shadowed by matching Cloud Functions (gen-2 functions get counted under
  // both metric names) before spike/stall/failure checks run on it --
  // otherwise the same real traffic produces two findings for one event. See
  // analyzeMetric's `suppressFindings`.
  const { entities, shadowedCalls } = analyzeEntities(project.id, breakdowns, cfg, findings);

  for (const spec of metricSpecs) {
    const historyData = metricData[spec.key];
    const rollingData = (rollingMetricData || {})[spec.key];
    const suppressFindings = spec.key === "run.requests" && shadowedCalls > 0;
    const summary = analyzeMetric(project.id, spec, historyData, rollingData, project.plan, cfg, findings, suppressFindings);
    if (!summary) continue;
    metrics[spec.key] = {
      latest: summary.latest,
      baseline: summary.baseline,
      unit: summary.unit,
      history: summary.history,
      days: summary.days,
    };
    if (shadowedCalls && spec.key === "run.requests") {
      metrics[spec.key].shadowedCalls = shadowedCalls;
    }
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

  analyzeLog(project.id, log, cfg.logHours, cfg, findings);
  analyzeIam(project.id, iam, cfg, findings);

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

module.exports = {
  analyzeProject,
  analyzeIam,
  median,
  formatValue,
  findingKey,
  worstLevel,
};
