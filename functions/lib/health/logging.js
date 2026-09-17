// Cloud Logging half of the health sweep: recent ERROR+ entries for one
// project, collapsed into signatures and tallied so a finding can name the
// thing that broke instead of just saying "there were errors".
//
// Unlike the Monitoring calls in auth.js, this needs a POST body (a log
// filter, not query params), so it has its own small fetch wrapper below
// rather than using apiGet. The access token itself still comes from
// auth.js's getAccessToken, called by whoever invokes readErrors.

const LOGGING_URL = "https://logging.googleapis.com/v2/entries:list";
const PAGE_SIZE = 1000;

// Strings that would otherwise make every occurrence of the same error look
// like a distinct one: pointer addresses, UUIDs, and any other long number
// (request ids, line numbers, byte counts...). Collapsing them to "#" is what
// lets 500 identical crashes tally into one signature instead of 500.
const NOISE = /(0x[0-9a-f]+|[0-9a-f]{8}-[0-9a-f-]{20,}|\b\d{3,}\b)/gi;

// Error shapes worth calling out by name, because each has a specific fix and
// would otherwise hide inside a generic error count. Order matters: the first
// pattern to match wins, so more specific kinds are listed before general ones.
/** @type {[string, RegExp][]} */
const ERROR_KINDS = [
  ["missing_index", /requires an index|FAILED_PRECONDITION.*index|create_composite=/i],
  ["rules_denied", /PERMISSION_DENIED|Missing or insufficient permissions|permission-denied/i],
  ["quota_exhausted", /RESOURCE_EXHAUSTED|quota exceeded|rate limit/i],
  ["function_timeout", /Function execution took \d+ ms.*timeout|timed? ?out|DEADLINE_EXCEEDED/i],
  // \b around OOM because a bare /OOM/i matches "boom", "broom", "bloomberg".
  ["out_of_memory", /memory limit|Exceeded memory|\bOOM\b|out of memory/i],
  ["function_crash", /finished with status: ?.?crash|Uncaught exception|unhandled (promise )?rejection|Process exited/i],
  ["unauthenticated", /UNAUTHENTICATED|invalid.{0,15}token|token.{0,15}expired/i],
  // GCP's own "this key/SA looks unsafe" warnings — worth surfacing on their
  // own since each points at a specific credential to go fix, not a symptom
  // of general app breakage.
  ["api_key_warning", /Unable to update key restrictions|API key.{0,30}(unrestricted|not restricted|exposed|leaked|compromised)/i],
  ["service_account_warning", /service account.{0,40}(key|disabled|deleted|compromised|unused|too many keys)|service account key.{0,20}(created|deleted|expir)/i],
  // Narrower than the bare /billing/i this was ported from: that matched any
  // app log mentioning a billing address, and this kind is both always-reported
  // and always critical, so a false positive here is an alert that can't be
  // ignored and isn't real.
  ["billing", /BILLING_DISABLED|billing[^.\n]{0,24}(disabled|not enabled|closed|suspended)|enable billing/i],
  ["deploy_failure", /deployment failed|container failed to start|Revision .* is not ready/i],
];

// Silent killers: worth surfacing even when the raw error count is low.
const ALWAYS_REPORT = new Set([
  "missing_index",
  "rules_denied",
  "quota_exhausted",
  "billing",
  "deploy_failure",
  "api_key_warning",
  "service_account_warning",
]);

// Cloud Logging resource.type values, shortened to what a human calls the thing.
const RESOURCE_SHORT = {
  cloud_function: "function",
  cloud_run_revision: "run",
  firestore_instance: "firestore",
  gcs_bucket: "storage",
  firebase_domain: "hosting",
  audited_resource: "api",
  build: "build",
};

function classify(message) {
  for (const [name, pattern] of ERROR_KINDS) {
    if (pattern.test(message)) return name;
  }
  return "other";
}

// Collapse a log entry into a stable one-line signature, so repeats of the
// same error tally together instead of appearing as distinct rows.
function signature(entry) {
  const payload = entry.jsonPayload;
  let msg = "";
  if (payload && typeof payload === "object") {
    msg = payload.message || payload.error || "";
  }
  if (!msg) msg = entry.textPayload || "";
  if (!msg) msg = (entry.protoPayload && entry.protoPayload.status && entry.protoPayload.status.message) || "";
  if (!msg) msg = entry.severity || "ERROR";
  const collapsed = String(msg).split(/\s+/).filter(Boolean).join(" ").replace(NOISE, "#");
  return collapsed.slice(0, 140);
}

// Name the specific thing that failed, e.g. "function:onStudioCreated", not
// just "a function".
function sourceOf(entry) {
  const resource = entry.resource || {};
  const labels = resource.labels || {};
  const type = resource.type || "?";
  const name = labels.function_name || labels.service_name || labels.database_id || labels.bucket_name || labels.instance_id || "";
  const short = RESOURCE_SHORT[type] || type;
  return name ? `${short}:${name}` : short;
}

// Thin JSON POST with the run's token attached, mirroring apiGet's contract:
// 403/404 means "logging isn't readable here" (API disabled, no permission on
// this particular project), which is a normal state, not a fault.
/** @returns {Promise<any>} */
async function postJson(url, token, body, { timeoutMs = 90000 } = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} for entries:list ${text.slice(0, 200)}`);
  }
  return res.json();
}

// A project whose logs can't be read must never look like a clean project, so
// every failure path returns count: null (not 0) with empty collections.
const EMPTY = { count: null, truncated: false, kinds: {}, sources: {}, top: [] };

// The sweep watches the same project it runs BigQuery billing queries from,
// so every failed billing query lands back in its own error feed as a
// BigQuery job-audit entry -- under two resource types at once
// (bigquery_resource and bigquery_project), which is why one bad query shows
// up as two findings. With criticalErrors = 1, that noise alone is enough to
// paint the host project red for a fault that isn't in any app. Nothing in
// this estate runs BigQuery except the sweep, so dropping these audit types
// costs no real signal and stops the checker from grading its own homework.
const SELF_AUDIT_TYPES = ["bigquery_resource", "bigquery_project"];

const EXCLUDE_SELF_AUDIT = SELF_AUDIT_TYPES.map((type) => ` AND resource.type!="${type}"`).join("");

async function readErrors(projectId, hours, token) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  let payload;
  try {
    payload = await postJson(LOGGING_URL, token, {
      resourceNames: [`projects/${projectId}`],
      filter: `severity>=ERROR AND timestamp>="${since}"${EXCLUDE_SELF_AUDIT}`,
      orderBy: "timestamp desc",
      pageSize: PAGE_SIZE,
    });
  } catch (err) {
    // Unlike iam.js/deploys.js, this used to fail silently -- count:null
    // correctly kept a broken read from reading as "no errors" on the
    // dashboard, but with nothing logged, a real failure here (bad scope,
    // API disabled, timeout) was indistinguishable from "genuinely nothing
    // to report" from the Cloud Functions logs alone.
    console.log(`logging: entries:list unavailable for ${projectId} -- ${String((err && err.message) || err).slice(0, 200)}`);
    return { ...EMPTY };
  }
  if (!payload) return { ...EMPTY };

  const entries = Array.isArray(payload.entries) ? payload.entries : [];

  const tally = new Map(); // "source signature" -> count
  const kinds = {};
  const sources = {};
  for (const entry of entries) {
    const source = sourceOf(entry);
    const sig = signature(entry);
    const key = `${source} ${sig}`;
    tally.set(key, (tally.get(key) || 0) + 1);
    const kind = classify(sig);
    kinds[kind] = (kinds[kind] || 0) + 1;
    sources[source] = (sources[source] || 0) + 1;
  }

  // A full page means there were probably more; say so rather than under-report.
  const truncated = entries.length >= PAGE_SIZE;

  const top = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const sep = key.indexOf(" ");
      return { source: key.slice(0, sep), message: key.slice(sep + 1), count };
    });

  return { count: entries.length, truncated, kinds, sources, top };
}

module.exports = { readErrors, classify, signature, sourceOf, ALWAYS_REPORT, SELF_AUDIT_TYPES };
