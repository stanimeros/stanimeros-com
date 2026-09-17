// Turns raw series into findings. This is the file that decides what is worth
// waking someone up about, so every threshold here is deliberate.
//
// Output is camelCase, matching docs/health-schema.md — the engine's internal
// snake_case is converted once, here, at the boundary.

const { FAILURE_LABELS, LEVEL_ORDER, LEVEL_BY_KIND, LIMITS, failureThresholdsFor } = require("./config");
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

// "Worst wins": a project (or the whole report) is only as healthy as its
// worst finding. Walks LEVEL_ORDER (config.js) rather than hard-coding a
// comparison, so a tier added there is picked up here for free. No findings
// at all is the only way to earn "ok" -- a `low`-only project is `low`, not
// `ok`, since `ok` means the estate hygiene is clean too.
function worstLevel(findings) {
  let worst = "ok";
  for (const f of findings) {
    if (LEVEL_ORDER.indexOf(f.level) < LEVEL_ORDER.indexOf(worst)) worst = f.level;
  }
  return worst;
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
        // Unlike failures/quota/errors, a spike alone isn't evidence
        // anything is actually broken -- usage running hot is a warn
        // regardless of how hot, never critical.
        level: "warn",
        kind: "spike",
        text: `${spec.key} ${formatValue(latest, unit)} vs baseline ${formatValue(baseline, unit)} (${ratio.toFixed(1)}x)`,
      });
    } else if (latest === 0 && baseline >= floor) {
      findings.push({
        key: findingKey(projectId, "stall", spec.key),
        level: LEVEL_BY_KIND.stall,
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

// One entity's shape from its two windows, or null if it isn't active in
// either -- pulled out of the loop below so it has no opinion on findings,
// only on the numbers.
function buildEntity(name, kind, data, rollingData) {
  const days = [...new Set([...Object.keys(data.calls), ...Object.keys(data.errors)])].sort();
  const calls = days.map((d) => data.calls[d] || 0);
  const errors = days.map((d) => data.errors[d] || 0);
  const callsBaseline = calls.length ? median(calls) : 0;

  // Rolling 24h "now" -- summed across whatever day key(s) the window
  // straddles, same reasoning as analyzeMetric's rollingData handling.
  const callsNow = Object.values(rollingData.calls || {}).reduce((a, b) => a + b, 0);
  const errorsNow = Object.values(rollingData.errors || {}).reduce((a, b) => a + b, 0);

  // Nothing in either window -- this name simply isn't active.
  if (!days.length && !callsNow && !errorsNow) return null;

  return {
    name,
    kind,
    calls: callsNow,
    callsBaseline,
    callsHistory: calls,
    errors: errorsNow,
    errorsHistory: errors,
    errorRate: callsNow ? errorsNow / callsNow : 0,
    logErrors: 0,
    days,
  };
}

/**
 * Per-function/-service findings. `breakdowns` is the history (median
 * baseline, same complete-prior-UTC-days window as the project metrics);
 * `rollingBreakdowns` is the rolling-last-24h "now" -- same split as
 * analyzeMetric, and for the same reason: a Cloud Console reader comparing
 * "last 24h" against this dashboard's per-function calls must see the same
 * number, not whatever the newest complete UTC day happened to be.
 */
function analyzeEntities(projectId, breakdowns, rollingBreakdowns, cfg, findings, deploys) {
  const entities = [];
  const kinds = new Set([...Object.keys(breakdowns || {}), ...Object.keys(rollingBreakdowns || {})]);

  for (const kind of kinds) {
    const byName = (breakdowns || {})[kind] || {};
    const rollingByName = (rollingBreakdowns || {})[kind] || {};
    const names = new Set([...Object.keys(byName), ...Object.keys(rollingByName)]);

    for (const name of names) {
      const data = byName[name] || { calls: {}, errors: {} };
      const rollingData = rollingByName[name] || { calls: {}, errors: {} };
      const entity = buildEntity(name, kind, data, rollingData);
      if (entity) entities.push(entity);
    }
  }

  // A gen-2 Cloud Function *is* a Cloud Run service, so it reports into both
  // BREAKDOWNS specs in config.js: once under its real function name
  // (`getStatistics`), once under Cloud Run's lowercased service name
  // (`getstatistics`). dropRunShadows collapses that pair to the function
  // entity -- keeping the function spelling (the real deploy name the owner
  // greps for) and the function's own numbers (invocation count/errors),
  // not a sum of both: run/request_count and function/execution_count count
  // different things (HTTP requests vs. invocations), and summing would
  // double the call count for every gen-2 function in the estate. A
  // standalone Cloud Run service with no function of the same name is left
  // untouched. This has to happen *before* findings are generated below --
  // doing it only on the returned entity list (as before) still left the
  // dropped run entity's own "silent"/"spike"/"errors" finding standing,
  // since that finding was pushed in the same pass the entity was built in.
  const { entities: kept, shadowedCalls } = dropRunShadows(entities);
  kept.sort((a, b) => b.errors - a.errors || b.calls - a.calls);

  // deploys is a Cloud Run service-name -> last-deployed-at map (deploys.js),
  // keyed lowercase because Cloud Run service names always are, while a
  // paired Cloud Function's name (and this entity's `name`, post-
  // dropRunShadows) is camelCase -- same case fold dropRunShadows itself
  // uses to pair the two in the first place. Attached to the entity
  // (schema-visible) unconditionally so the dashboard can show "last
  // deployed" even when nothing is currently wrong; left off findings below
  // when there's nothing to attach, rather than a null placeholder, per
  // health-schema.md's "don't attach an empty slot" rule.
  for (const entity of kept) {
    entity.deployedAt = (deploys && deploys[entity.name.toLowerCase()]) || null;
  }

  for (const entity of kept) {
    const { name, kind, calls: callsNow, callsBaseline, errors: errorsNow, errorRate, deployedAt } = entity;
    if (errorsNow >= 5 && errorRate >= 0.05) {
      findings.push({
        key: findingKey(projectId, `${kind} errors`, name),
        level: errorRate >= 0.25 ? "critical" : "warn",
        kind: `${kind} errors`,
        text: `${name}: ${formatValue(errorsNow)} failed of ${formatValue(callsNow)} calls over the last 24h (${Math.round(errorRate * 100)}%)`,
        ...(deployedAt ? { deployedAt } : {}),
      });
    } else if (callsNow === 0 && callsBaseline >= cfg.spikeFloor) {
      findings.push({
        key: findingKey(projectId, `${kind} silent`, name),
        level: LEVEL_BY_KIND[`${kind} silent`],
        kind: `${kind} silent`,
        text: `${name}: no calls in the last 24h (baseline ${formatValue(callsBaseline)}/day)`,
        ...(deployedAt ? { deployedAt } : {}),
      });
    } else if (callsNow >= cfg.spikeFloor && callsBaseline > 0 && callsNow / callsBaseline >= cfg.spikeRatio) {
      findings.push({
        key: findingKey(projectId, `${kind} spike`, name),
        level: LEVEL_BY_KIND[`${kind} spike`],
        kind: `${kind} spike`,
        text: `${name}: ${formatValue(callsNow)} calls vs baseline ${formatValue(callsBaseline)} over the last 24h (${(callsNow / callsBaseline).toFixed(1)}x)`,
        ...(deployedAt ? { deployedAt } : {}),
      });
    }
  }

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
      // Estate hygiene, not an incident -- flat `low` regardless of age
      // (LEVEL_BY_KIND). The age still shows in the text; it just no longer
      // decides severity.
      findings.push({
        key: findingKey(projectId, "sa-key", `${sa.email}:${key.name}`),
        level: LEVEL_BY_KIND["sa-key"],
        kind: "sa-key",
        text: `${sa.email} has a downloadable key${ageText} — rotate to keyless auth (ADC/workload identity) if possible`,
      });
    }
  }

  for (const binding of iam.broadBindings || []) {
    // Estate hygiene, not an incident -- flat `low` regardless of whether
    // it's GCP's own default agent or a hand-created account (LEVEL_BY_KIND).
    // Worth a different text either way (see iam.js's DEFAULT_AGENT_RE
    // comment), just not a different severity.
    const text = binding.isDefaultAgent
      ? `${binding.email} — GCP's default account for this project — still holds ${binding.role}; narrowing it is optional but a well-known best practice`
      : `${binding.email} holds ${binding.role} on the project — this looks like a custom account with full project access, worth reviewing`;
    findings.push({
      key: findingKey(projectId, "broad-role", `${binding.email}:${binding.role}`),
      level: LEVEL_BY_KIND["broad-role"],
      kind: "broad-role",
      text,
    });
  }

  for (const apiKey of iam.unrestrictedKeys || []) {
    findings.push({
      key: findingKey(projectId, "api-key", apiKey.name),
      level: LEVEL_BY_KIND["api-key"],
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
  // One finding per distinct signature, not a single "N error log entries"
  // rollup -- the table exists to show what actually broke, and a count
  // hides that. Keyed on source+signature (not count), so an ongoing burst
  // stays the same open finding across runs instead of reopening every
  // sweep, and lifecycle (first/last seen, ack) tracks the specific error
  // instead of the estate's error volume in general.
  for (const top of log.top || []) {
    findings.push({
      key: findingKey(projectId, "errors", `${top.source}:${top.message}`),
      level: top.count >= cfg.criticalErrors ? "critical" : "warn",
      kind: "errors",
      text: `${top.source}: ${top.message}`,
      // Carried as its own field (not just baked into text) so the UI can
      // render it as a fixed, never-truncated badge instead of a suffix that
      // gets clipped along with the rest of a long message.
      count: top.count,
    });
  }

  // These are quiet and each has one specific fix, so they report however
  // few. Severity is a flat lookup for all of them (LEVEL_BY_KIND) -- unlike
  // errors/volume above, none of these kinds graduate by count.
  for (const [kind, count] of Object.entries(log.kinds || {})) {
    if (!ALWAYS_REPORT.has(kind)) continue;
    findings.push({
      key: findingKey(projectId, kind, "log"),
      level: LEVEL_BY_KIND[kind],
      kind,
      // Count used to lead this sentence ("5x missing index..."); now it's
      // its own badge in the UI (see Finding.count), so the text doesn't
      // need to repeat it.
      text: `${kind.replace(/_/g, " ")} in the last ${logHours}h`,
      count,
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
  rollingBreakdowns,
  log,
  cost,
  cfg,
  billingAccount,
  iam,
  deploys,
}) {
  const findings = [];
  const metrics = {};

  // Computed before the metrics loop so run.requests knows whether it's
  // shadowed by matching Cloud Functions (gen-2 functions get counted under
  // both metric names) before spike/stall/failure checks run on it --
  // otherwise the same real traffic produces two findings for one event. See
  // analyzeMetric's `suppressFindings`.
  const { entities, shadowedCalls } = analyzeEntities(project.id, breakdowns, rollingBreakdowns, cfg, findings, deploys);

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

  // Worst first: critical, then warn, then low. LEVEL_ORDER (config.js) is
  // the one place that ordering is defined.
  findings.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));

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
