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
  // First, so an entry we couldn't read a message out of is never pattern-
  // matched on the placeholder text itself. See NO_MESSAGE / signature().
  ["unreadable", /^\(no readable message\)$/],
  // Firestore logs its "you could tidy this config" notices at ERROR
  // severity, so they arrive here looking exactly like a failure. Kept
  // deliberately narrow -- this is a specific known-benign notice, not a
  // licence to downgrade anything that sounds advisory. Must precede
  // missing_index, whose pattern would otherwise claim it.
  ["advisory", /index is not necessary/i],
  ["missing_index", /requires an index|FAILED_PRECONDITION.*index|create_composite=/i],
  // "The caller does not have permission" and "INSUFFICIENT_PERMISSIONS" are
  // what GCP's audit logs actually say; matching only the API-style
  // PERMISSION_DENIED spellings sent every real permission error to "other",
  // where the count threshold graded it critical.
  ["rules_denied", /PERMISSION_DENIED|INSUFFICIENT_PERMISSIONS|Missing or insufficient permissions|permission-denied|caller does not have permission|does not have [a-z.]+ permission/i],
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
//
// The crash-shaped kinds below (out_of_memory, function_crash,
// function_timeout, unauthenticated) were classified but listed neither here
// nor in LEVEL_BY_KIND, so the most actionable failures an estate can have
// never earned a named finding -- a real OOM showed up as anonymous `errors`
// text while a three-day-old service-account key got its own kind.
const ALWAYS_REPORT = new Set([
  "missing_index",
  "rules_denied",
  "quota_exhausted",
  "billing",
  "deploy_failure",
  "api_key_warning",
  "service_account_warning",
  "out_of_memory",
  "function_crash",
  "function_timeout",
  "unauthenticated",
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
  cloud_scheduler_job: "scheduler",
  datastore_database: "firestore",
  consumed_api: "api",
};

function classify(message) {
  for (const [name, pattern] of ERROR_KINDS) {
    if (pattern.test(message)) return name;
  }
  return "other";
}

// Collapse a log entry into a stable one-line signature, so repeats of the
// same error tally together instead of appearing as distinct rows.
//
// The fallback used to be `entry.severity`, which produced findings whose
// entire text was the word "ERROR" -- a critical row that said nothing at
// all. The extraction below is wider (several services put their message
// under a different key, and an audit entry often carries only a method
// name), and what survives all of it is labelled honestly rather than
// disguised as a message: NO_MESSAGE classifies as `unreadable`, which
// LEVEL_BY_KIND grades warn, because an entry we cannot read is not evidence
// of a critical failure.
const NO_MESSAGE = "(no readable message)";

// Only a non-empty string is a message. Guarding on truthiness alone is how
// `{ error: { message: "..." } }` used to yield the string "[object Object]"
// as a finding's entire text: the object is truthy, so it won the `||` chain
// before anything could unwrap it.
function text(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

function signature(entry) {
  const payload = entry.jsonPayload;
  const proto = entry.protoPayload;
  let msg = "";
  if (payload && typeof payload === "object") {
    msg =
      text(payload.message) ||
      text(payload.error) ||
      text(payload.msg) ||
      text(payload.event_message) ||
      text(payload.description) ||
      // A nested error object ({ error: { message } }) is common enough to be
      // worth one level of unwrapping.
      (payload.error && typeof payload.error === "object" ? text(payload.error.message) : "");
  }
  if (!msg) msg = text(entry.textPayload);
  if (!msg && proto && typeof proto === "object") {
    msg = proto.status ? text(proto.status.message) : "";
    // An audit entry with a status code but no message still names the call
    // that failed, which is the useful half.
    if (!msg) msg = text(proto.methodName) ? `${proto.methodName} failed` : "";
  }
  if (!msg) msg = NO_MESSAGE;
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

/**
 * The same "stop grading your own homework" rule as SELF_AUDIT_TYPES, for the
 * case that can't be expressed as a log filter.
 *
 * The sweep calls Resource Manager / Service Usage on every project it knows
 * about. Where it lacks a role, the denial lands in *that project's* audit log
 * as a project-scoped PERMISSION_DENIED -- so five projects the sweep can't
 * fully read each showed an identical critical "The caller does not have
 * permission", describing the checker's own access rather than anything wrong
 * with the project.
 *
 * Deliberately narrow: only project-scoped denials. A permission error from
 * any other source is the project's own code failing and stays reported. The
 * sweep's access problems already surface honestly elsewhere -- `projectErrors`
 * ("N projects not checked") and a null errorCount ("Log read failed for") --
 * which is where they belong.
 */
function isSelfAuditDenial(source, kind) {
  return source === "project" && kind === "rules_denied";
}

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
  let kept = 0;
  for (const entry of entries) {
    const source = sourceOf(entry);
    const sig = signature(entry);
    const kind = classify(sig);
    // Dropped before it is counted, not just before it is listed -- these are
    // the sweep's own denials, so leaving them in errorCount would still paint
    // the project red on Overview with nothing on the Errors tab to explain it.
    if (isSelfAuditDenial(source, kind)) continue;
    kept += 1;
    const key = `${source} ${sig}`;
    tally.set(key, (tally.get(key) || 0) + 1);
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

  return { count: kept, truncated, kinds, sources, top };
}

module.exports = {
  readErrors,
  classify,
  signature,
  sourceOf,
  ALWAYS_REPORT,
  SELF_AUDIT_TYPES,
  isSelfAuditDenial,
  NO_MESSAGE,
};
