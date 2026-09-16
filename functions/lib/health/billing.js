// Per-project cost from the GCP billing export in BigQuery.
//
// The export is a pending manual step -- as of writing, the dataset/table
// doesn't exist yet. Every function here must degrade to all-nulls rather
// than fail the run: `cost: null` is a documented normal state (see
// docs/health-schema.md), covering both Spark projects and "export not
// ready yet". The caller (the sweep) should never need a try/catch around
// this module.

const { BILLING_ACCOUNT } = require("./config");

// Identifiers that end up interpolated into SQL (dataset/table can't be bound
// as query parameters in BigQuery's REST API). Whitelisting before splicing
// them into the query string is what keeps this from being a SQL-injection
// hole.
const IDENTIFIER_RE = /^[A-Za-z0-9_-]+$/;

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) {
    throw new Error(`invalid ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}

// Standard export table naming: gcp_billing_export_v1_<billing account,
// hyphens -> underscores>. https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup
function defaultTableId() {
  return `gcp_billing_export_v1_${BILLING_ACCOUNT.replace(/-/g, "_")}`;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Runs a BigQuery SQL query via the REST API (no client-library dependency)
// and returns the row array, each row already zipped field-name -> value.
async function runQuery(query, queryParameters, { token, datasetProject, timeoutMs = 60000 }) {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(datasetProject)}/queries`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      useLegacySql: false,
      timeoutMs,
      parameterMode: "NAMED",
      queryParameters,
    }),
    signal: AbortSignal.timeout(timeoutMs + 15000),
  });

  /** @type {any} */
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = /** @type {any} */ (new Error(body?.error?.message || `${res.status} ${res.statusText}`));
    err.status = res.status;
    err.reason = body?.error?.errors?.[0]?.reason;
    throw err;
  }

  const fields = body.schema?.fields || [];
  const rows = body.rows || [];
  return rows.map((/** @type {any} */ row) =>
    Object.fromEntries(fields.map((/** @type {any} */ f, /** @type {number} */ i) => [f.name, row.f[i].v]))
  );
}

// True when the failure means "the export doesn't exist / isn't producing
// data yet" -- the expected state until the manual setup step is done.
function isExportNotReady(err) {
  if (err.status === 404) return true;
  if (err.reason === "notFound") return true;
  // BigQuery reports an absent table as an invalidQuery/"Not found: Table ...".
  if (err.reason === "invalidQuery" && /not found/i.test(err.message || "")) return true;
  return false;
}

function nullResult(projectIds) {
  const out = {};
  for (const id of projectIds) out[id] = null;
  return out;
}

// One query, all projects: grouped by project/service/day so the sweep
// doesn't run 15 separate table scans against a (billed-per-byte) export.
// Filtered on `usage_start_time`, the export's partition column -- this
// table isn't partitioned on _PARTITIONTIME (that's for legacy/ingestion-time
// tables); the standard detailed billing export is partitioned by
// usage_start_time, so filtering on it is what actually prunes partitions
// instead of scanning the whole table.
function buildQuery({ datasetProject, datasetId, tableId }) {
  assertIdentifier(datasetProject, "datasetProject");
  assertIdentifier(datasetId, "datasetId");
  assertIdentifier(tableId, "tableId");
  const table = `\`${datasetProject}.${datasetId}.${tableId}\``;
  return `
    SELECT
      project.id AS project_id,
      service.description AS service,
      DATE(usage_start_time) AS day,
      SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)) AS cost,
      ANY_VALUE(currency) AS currency
    FROM ${table}
    WHERE usage_start_time >= @windowStart
      AND usage_start_time < @windowEnd
      AND project.id IN UNNEST(@projectIds)
    GROUP BY project_id, service, day
  `;
}

// Same shape, no per-service/day breakdown, no project filter -- used for
// the report-level billing-account total.
function buildTotalQuery({ datasetProject, datasetId, tableId }) {
  assertIdentifier(datasetProject, "datasetProject");
  assertIdentifier(datasetId, "datasetId");
  assertIdentifier(tableId, "tableId");
  const table = `\`${datasetProject}.${datasetId}.${tableId}\``;
  return `
    SELECT
      SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)) AS cost,
      ANY_VALUE(currency) AS currency
    FROM ${table}
    WHERE usage_start_time >= @windowStart
      AND usage_start_time < @windowEnd
  `;
}

function dateParam(name, value) {
  return { name, parameterType: { type: "TIMESTAMP" }, parameterValue: { value } };
}

function arrayParam(name, values) {
  return {
    name,
    parameterType: { type: "ARRAY", arrayType: { type: "STRING" } },
    parameterValue: { arrayValues: values.map((v) => ({ value: v })) },
  };
}

// Sums rows into the CostObject shape for one project: last24h/7d/30d read
// off the daily series, prev30d comes from the separate 60d-back window.
function buildCostObject(dailyRows, prevRows, now) {
  const currency = dailyRows[0]?.currency || prevRows[0]?.currency || "EUR";

  const byDay = new Map(); // day -> cost
  const byService = new Map(); // service -> cost
  for (const r of dailyRows) {
    const cost = toNumber(r.cost);
    byDay.set(r.day, (byDay.get(r.day) || 0) + cost);
    byService.set(r.service, (byService.get(r.service) || 0) + cost);
  }

  const daily = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, cost]) => ({ day, cost: round2(cost) }));

  const serviceList = [...byService.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([service, cost]) => ({ service, cost: round2(cost) }));

  const last30d = daily.reduce((sum, d) => sum + d.cost, 0);
  const prev30d = prevRows.reduce((sum, r) => sum + toNumber(r.cost), 0);

  const nowMs = now.getTime();
  const last24hStart = nowMs - 24 * 60 * 60 * 1000;
  const last7dStart = nowMs - 7 * 24 * 60 * 60 * 1000;
  const last24h = daily
    .filter((d) => new Date(`${d.day}T00:00:00Z`).getTime() >= last24hStart)
    .reduce((sum, d) => sum + d.cost, 0);
  const last7d = daily
    .filter((d) => new Date(`${d.day}T00:00:00Z`).getTime() >= last7dStart)
    .reduce((sum, d) => sum + d.cost, 0);

  return {
    currency,
    last24h: round2(last24h),
    last7d: round2(last7d),
    last30d: round2(last30d),
    prev30d: round2(prev30d),
    byService: serviceList,
    daily,
  };
}

// -> { [projectId]: CostObject | null }
async function fetchCosts(projectIds, opts) {
  const {
    token,
    datasetProject,
    datasetId,
    tableId = defaultTableId(),
    windowDays = 30,
  } = opts || {};

  const result = nullResult(projectIds);
  if (!projectIds.length) return result;

  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const prevWindowEnd = windowStart;
  const prevWindowStart = new Date(now.getTime() - 2 * windowDays * 24 * 60 * 60 * 1000).toISOString();

  const queryOpts = { token, datasetProject };
  const table = { datasetProject, datasetId, tableId };

  try {
    const query = buildQuery(table);
    const [currentRows, prevRows] = await Promise.all([
      runQuery(
        query,
        [dateParam("windowStart", windowStart), dateParam("windowEnd", windowEnd), arrayParam("projectIds", projectIds)],
        queryOpts
      ),
      runQuery(
        query,
        [dateParam("windowStart", prevWindowStart), dateParam("windowEnd", prevWindowEnd), arrayParam("projectIds", projectIds)],
        queryOpts
      ),
    ]);

    const currentByProject = new Map();
    for (const row of currentRows) {
      if (!currentByProject.has(row.project_id)) currentByProject.set(row.project_id, []);
      currentByProject.get(row.project_id).push(row);
    }
    const prevByProject = new Map();
    for (const row of prevRows) {
      if (!prevByProject.has(row.project_id)) prevByProject.set(row.project_id, []);
      prevByProject.get(row.project_id).push(row);
    }

    for (const id of projectIds) {
      const rows = currentByProject.get(id);
      if (!rows || !rows.length) continue; // no spend this window -> leave null, not 0
      result[id] = buildCostObject(rows, prevByProject.get(id) || [], now);
    }
    return result;
  } catch (err) {
    if (isExportNotReady(err)) {
      console.log(`billing: export not ready (${datasetProject}.${datasetId}.${tableId}) -- returning null costs`);
    } else {
      console.error("billing: fetchCosts failed", err);
    }
    return nullResult(projectIds);
  }
}

// -> { costTotal, costCurrency, costWindowDays }
async function fetchBillingTotal(opts) {
  const {
    token,
    datasetProject,
    datasetId,
    tableId = defaultTableId(),
    windowDays = 30,
  } = opts || {};

  const fallback = { costTotal: null, costCurrency: "EUR", costWindowDays: windowDays };

  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const query = buildTotalQuery({ datasetProject, datasetId, tableId });
    const rows = await runQuery(
      query,
      [dateParam("windowStart", windowStart), dateParam("windowEnd", windowEnd)],
      { token, datasetProject }
    );
    if (!rows.length || rows[0].cost === null || rows[0].cost === undefined) return fallback;
    return {
      costTotal: round2(toNumber(rows[0].cost)),
      costCurrency: rows[0].currency || "EUR",
      costWindowDays: windowDays,
    };
  } catch (err) {
    if (isExportNotReady(err)) {
      console.log(`billing: export not ready (${datasetProject}.${datasetId}.${tableId}) -- returning null total`);
    } else {
      console.error("billing: fetchBillingTotal failed", err);
    }
    return fallback;
  }
}

module.exports = {
  fetchCosts,
  fetchBillingTotal,
  defaultTableId,
};
