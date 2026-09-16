// Cloud Monitoring reads: daily usage per project, and per-function detail.
//
// Ported from the Python engine's timeseries()/breakdown(). Everything is
// bucketed into whole UTC days, which is why the newest bucket is always
// *yesterday* — a spike surfaces the morning after it happens.

const { apiGet } = require("./auth");

const MONITORING = "https://monitoring.googleapis.com/v3";

function isoSecond(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// The window: `days` complete days ending at today's UTC midnight. The extra
// day on the start covers the alignment boundary so the oldest bucket is whole.
function windowFor(days) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (days + 1) * 86400000);
  return { start, end };
}

function timeSeriesUrl(projectId, params) {
  const qs = new URLSearchParams();
  for (const [key, value] of params) qs.append(key, value);
  return `${MONITORING}/projects/${encodeURIComponent(projectId)}/timeSeries?${qs.toString()}`;
}

function pointValue(point) {
  const value = point.value || {};
  const raw = value.int64Value !== undefined ? value.int64Value : value.doubleValue;
  return Number(raw || 0);
}

function dayOf(point) {
  return point.interval.endTime.slice(0, 10);
}

/**
 * Daily totals for one metric, split by whatever labels it was grouped on.
 * Returns { [seriesLabel]: { [day]: value } }, or {} when the service isn't in
 * use here — an absent metric means "not used", which the UI renders as nothing
 * rather than as a zero.
 */
async function timeseries(projectId, spec, start, end, token) {
  const params = [
    ["filter", `metric.type="${spec.type}"`],
    ["interval.startTime", isoSecond(start)],
    ["interval.endTime", isoSecond(end)],
    ["aggregation.alignmentPeriod", "86400s"],
    ["aggregation.perSeriesAligner", spec.kind === "delta" ? "ALIGN_SUM" : "ALIGN_MAX"],
    ["aggregation.crossSeriesReducer", spec.kind === "delta" ? "REDUCE_SUM" : "REDUCE_MAX"],
  ];
  for (const field of spec.groupBy || []) params.push(["aggregation.groupByFields", field]);

  const payload = await apiGet(timeSeriesUrl(projectId, params), token);
  if (!payload) return {};

  const out = {};
  for (const series of payload.timeSeries || []) {
    const labels = (series.metric && series.metric.labels) || {};
    const keys = Object.keys(labels);
    const label = keys.length ? keys.map((k) => String(labels[k])).join("|") : "";
    const bucket = (out[label] = out[label] || {});
    for (const point of series.points || []) {
      const day = dayOf(point);
      bucket[day] = (bucket[day] || 0) + pointValue(point);
    }
  }
  return out;
}

/**
 * Per-entity daily calls and errors: { [name]: { calls: {day: n}, errors: {day: n} } }.
 * This is what lets a finding say which function is broken instead of just
 * "functions are failing".
 */
async function breakdown(projectId, spec, start, end, token) {
  const params = [
    ["filter", `metric.type="${spec.type}"`],
    ["interval.startTime", isoSecond(start)],
    ["interval.endTime", isoSecond(end)],
    ["aggregation.alignmentPeriod", "86400s"],
    ["aggregation.perSeriesAligner", "ALIGN_SUM"],
    ["aggregation.crossSeriesReducer", "REDUCE_SUM"],
    ["aggregation.groupByFields", spec.nameLabel],
    ["aggregation.groupByFields", spec.statusLabel],
  ];

  const payload = await apiGet(timeSeriesUrl(projectId, params), token);
  if (!payload) return {};

  const nameKey = spec.nameLabel.split(".").pop();
  const statusKey = spec.statusLabel.split(".").pop();
  const out = {};

  for (const series of payload.timeSeries || []) {
    const resourceLabels = (series.resource && series.resource.labels) || {};
    const metricLabels = (series.metric && series.metric.labels) || {};
    const name = resourceLabels[nameKey] || metricLabels[nameKey];
    if (!name) continue;

    const status = metricLabels[statusKey] || "";
    const entry = (out[name] = out[name] || { calls: {}, errors: {} });
    const failed = spec.isError(status);

    for (const point of series.points || []) {
      const day = dayOf(point);
      const value = pointValue(point);
      entry.calls[day] = (entry.calls[day] || 0) + value;
      if (failed) entry.errors[day] = (entry.errors[day] || 0) + value;
    }
  }
  return out;
}

/**
 * A gen-2 function is reported twice: once as a Cloud Function (`getStatistics`)
 * and again as the lowercased Cloud Run service backing it (`getstatistics`).
 * Keep the function, drop the Run shadow — without this every gen-2 project's
 * call counts read as roughly double.
 *
 * Returns { entities, shadowedCalls } so the caller can note how many calls were
 * removed rather than silently losing them.
 */
function dropRunShadows(entities) {
  const functionNames = new Set(
    entities.filter((e) => e.kind === "function").map((e) => e.name.toLowerCase())
  );
  const kept = [];
  let shadowedCalls = 0;
  for (const entity of entities) {
    if (entity.kind === "run" && functionNames.has(entity.name.toLowerCase())) {
      shadowedCalls += entity.calls;
      continue;
    }
    kept.push(entity);
  }
  return { entities: kept, shadowedCalls };
}

module.exports = { timeseries, breakdown, dropRunShadows, windowFor, isoSecond };
