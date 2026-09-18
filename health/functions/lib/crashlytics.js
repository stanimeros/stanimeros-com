// Flutter/mobile crash findings, from Crashlytics' BigQuery export.
//
// There is no Crashlytics REST API worth reading from a server sweep --
// export-to-BigQuery is the supported way to query crash data outside the
// Firebase console (https://firebase.google.com/docs/crashlytics/bigquery-export).
// That's an opt-in, per-app toggle in each project's console, and unlike the
// billing export (one dataset, this project, always the same table name),
// the export dataset/table live in the *app's own* project and are named
// after its dataset id/app id -- there's nothing to discover, so config.js's
// PROJECTS entries carry an explicit `crashlyticsApps: [{ dataset, table }]`
// list, empty until someone turns the export on and fills it in.
//
// Same contract as billing.js throughout: every function here degrades to
// null/empty rather than throwing, so a project with the export not (yet)
// enabled -- which today is all of them -- looks identical to "checked, no
// crashes", not to a fault the sweep needs to report.

const IDENTIFIER_RE = /^[A-Za-z0-9_-]+$/;

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) {
    throw new Error(`invalid ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}

function tableRef({ projectId, dataset, table }) {
  assertIdentifier(projectId, "projectId");
  assertIdentifier(dataset, "dataset");
  assertIdentifier(table, "table");
  return `\`${projectId}.${dataset}.${table}\``;
}

// Runs a BigQuery SQL query via the REST API, no client-library dependency --
// same minimal wrapper as billing.js's runQuery, querying the *app's own*
// project (billing.js always queries the host project's export instead).
async function runQuery(query, queryParameters, { token, projectId, timeoutMs = 60000 }) {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, useLegacySql: false, timeoutMs, parameterMode: "NAMED", queryParameters }),
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

// Same "export doesn't exist / no access yet" test as billing.js's
// isExportNotReady -- a 403 is folded in here too (billing.js never sees one
// because it queries its own project; this module queries 14 others whose
// checker grant may simply not have been extended here yet, the expected
// state until that's done -- see config.js's PROJECTS comment).
function isNotConfigured(err) {
  if (err.status === 403 || err.status === 404) return true;
  if (err.reason === "notFound" || err.reason === "accessDenied") return true;
  if (err.reason === "invalidQuery" && /not found/i.test(err.message || "")) return true;
  return false;
}

function dateParam(name, value) {
  return { name, parameterType: { type: "TIMESTAMP" }, parameterValue: { value } };
}

// Crashlytics' exported schema: one row per crash event, `issue_id` groups
// events into the same crash signature, `issue_title` is the human-readable
// exception/class name. https://firebase.google.com/docs/crashlytics/bigquery-export
function buildQuery(table_) {
  const table = tableRef(table_);
  return `
    SELECT
      issue_id,
      ANY_VALUE(issue_title) AS title,
      COUNT(*) AS events
    FROM ${table}
    WHERE event_timestamp >= @since
      AND is_fatal = TRUE
    GROUP BY issue_id
    ORDER BY events DESC
    LIMIT 20
  `;
}

/**
 * -> { configured: boolean, count: number|null, issues: [{ issueId, title, events }] }
 *
 * `apps` is one project's `crashlyticsApps` from config.js. `configured:
 * false` (apps.length === 0, the default for every project today) skips the
 * network call entirely -- there is nothing to ask BigQuery about a project
 * that hasn't turned the export on, so this must not spend a query (or log a
 * "not ready" line) finding that out.
 */
async function collectCrashlytics(projectId, apps, hours, token) {
  if (!apps || !apps.length) return { configured: false, count: null, issues: [] };

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const totals = new Map(); // issue_id -> { title, events }
  let anyReady = false;

  for (const app of apps) {
    try {
      const rows = await runQuery(
        buildQuery({ projectId, dataset: app.dataset, table: app.table }),
        [dateParam("since", since)],
        { token, projectId }
      );
      anyReady = true;
      for (const row of rows) {
        const events = Number(row.events) || 0;
        const existing = totals.get(row.issue_id);
        if (existing) existing.events += events;
        else totals.set(row.issue_id, { title: row.title || row.issue_id, events });
      }
    } catch (err) {
      if (isNotConfigured(err)) {
        console.log(`crashlytics: export not ready (${projectId}.${app.dataset}.${app.table})`);
      } else {
        console.error(`crashlytics: query failed for ${projectId}.${app.dataset}.${app.table}`, err);
      }
    }
  }

  // Configured (apps.length > 0) but every table 403/404'd -- the export
  // exists on paper (someone added a config.js entry) but isn't actually
  // readable yet, same "don't know" as billing's cost:null, not "zero
  // crashes".
  if (!anyReady) return { configured: true, count: null, issues: [] };

  const issues = [...totals.entries()]
    .map(([issueId, v]) => ({ issueId, title: v.title, events: v.events }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 10);
  const count = issues.reduce((sum, i) => sum + i.events, 0);

  return { configured: true, count, issues };
}

module.exports = { collectCrashlytics, buildQuery, isNotConfigured };
