// Cloud Monitoring reads: daily usage per project, and per-function detail.
//
// Ported from the Python engine's timeseries()/breakdown(). Every check
// (spike/stall/quota/failures) compares two windows: a rolling last-24-hours
// (rollingWindow, "now") against a history baseline built from `days`
// complete prior UTC days (windowFor). Both windows are always full 24h
// periods, so the comparison is apples-to-apples no matter what time of day
// the sweep runs — unlike comparing against a UTC-calendar-day bucket, there
// is no "yesterday vs today so far" split to reason about, and a real spike
// or outage is visible as soon as it's real, not only after the next UTC
// midnight.

const { apiGet } = require("./auth");

const MONITORING = "https://monitoring.googleapis.com/v3";

function isoSecond(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// History baseline: `days` complete UTC days, ending at today's UTC
// midnight — i.e. not including any part of the rolling window below, so a
// metric's "typical day" isn't itself pulled toward whatever's happening
// right now.
function windowFor(days) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - days * 86400000);
  return { start, end };
}

// The "latest" window for every check: a straightforward rolling last 24
// hours, ending now.
function rollingWindow() {
  const end = new Date();
  return { start: new Date(end.getTime() - 24 * 60 * 60 * 1000), end };
}

function timeSeriesUrl(projectId, params, pageToken) {
  const qs = new URLSearchParams();
  for (const [key, value] of params) qs.append(key, value);
  if (pageToken) qs.append("pageToken", pageToken);
  return `${MONITORING}/projects/${encodeURIComponent(projectId)}/timeSeries?${qs.toString()}`;
}

// timeSeries.list paginates once a project has enough grouped series (many
// functions, many label combinations); reading only the first page silently
// drops the rest, undercounting totals and dropping entities from breakdowns.
async function fetchAllTimeSeries(projectId, params, token) {
  const series = [];
  let pageToken;
  do {
    const payload = await apiGet(timeSeriesUrl(projectId, params, pageToken), token);
    if (!payload) return pageToken ? series : null;
    series.push(...(payload.timeSeries || []));
    pageToken = payload.nextPageToken;
  } while (pageToken);
  return series;
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

  const allSeries = await fetchAllTimeSeries(projectId, params, token);
  if (!allSeries) return {};

  const out = {};
  for (const series of allSeries) {
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

  const allSeries = await fetchAllTimeSeries(projectId, params, token);
  if (!allSeries) return {};

  const nameKey = spec.nameLabel.split(".").pop();
  const statusKey = spec.statusLabel.split(".").pop();
  const out = {};

  for (const series of allSeries) {
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

module.exports = { timeseries, breakdown, dropRunShadows, windowFor, rollingWindow, isoSecond };
