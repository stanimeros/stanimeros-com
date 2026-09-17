// Everything the health sweep is configured by: which projects to check, what
// to measure, and when a number becomes a finding.
//
// The project list is explicit rather than discovered. The checker's service
// account holds only monitoring.viewer + logging.viewer, which is deliberately
// too little to enumerate projects or read billing state — and discovery would
// be the wrong default anyway: a project silently dropping out of a *monitoring*
// tool's project list is a blind spot that looks like good news. Adding a
// project here and re-running scripts/health-iam.sh are the two onboarding steps.

const PROJECTS = [
  { id: "applytics-app",         name: "Statwise",             plan: "Blaze" },
  { id: "athens-mytransfer",     name: "Athens MyTransfer",    plan: "Blaze" },
  { id: "chronal",               name: "Chronal",              plan: "Blaze" },
  { id: "deskdrop-330f6",        name: "Irisdrop",             plan: "Spark" },
  { id: "hedeos-f6e6c",          name: "Hedeos",               plan: "Spark" },
  { id: "mp-transfer",           name: "ATPro Partner",        plan: "Blaze" },
  { id: "niki-margariti-agent",  name: "Niki Margariti Labs",  plan: "Blaze" },
  { id: "nourea",                name: "Nourea",               plan: "Blaze" },
  { id: "parcels-ecdc6",         name: "Trans Hellas",         plan: "Blaze" },
  { id: "party-game-stanimeros", name: "Party",                plan: "Blaze" },
  { id: "poudra-c2e70",          name: "Ski Greece",           plan: "Blaze" },
  { id: "process-a7a0f",         name: "Process",              plan: "Spark" },
  { id: "stanimeros-dev",        name: "Stanimeros Dev",       plan: "Blaze" },
  { id: "tattoo-healer",         name: "Tattoo Healer",        plan: "Blaze" },
  { id: "veridictum",            name: "Veridictum",           plan: "Spark" },
];

const BILLING_ACCOUNT = "01F891-9E8314-AAB92D";

// `freeDaily` is the Spark daily allowance, used only to warn when a project
// with no billing attached approaches its ceiling.
const METRICS = [
  { key: "firestore.reads",   type: "firestore.googleapis.com/document/read_count",              kind: "delta", freeDaily: 50000 },
  { key: "firestore.writes",  type: "firestore.googleapis.com/document/write_count",             kind: "delta", freeDaily: 20000 },
  { key: "firestore.deletes", type: "firestore.googleapis.com/document/delete_count",            kind: "delta", freeDaily: 20000 },
  { key: "functions.calls",   type: "cloudfunctions.googleapis.com/function/execution_count",    kind: "delta", groupBy: ["metric.label.status"] },
  { key: "run.requests",      type: "run.googleapis.com/request_count",                          kind: "delta", groupBy: ["metric.label.response_code_class"] },
  { key: "hosting.egress",    type: "firebasehosting.googleapis.com/network/sent_bytes_count",   kind: "delta", unit: "bytes", freeDaily: 360 * 1024 * 1024 },
  { key: "storage.egress",    type: "storage.googleapis.com/network/sent_bytes_count",           kind: "delta", unit: "bytes" },
  { key: "storage.total",     type: "storage.googleapis.com/storage/total_bytes",                kind: "gauge", unit: "bytes" },
  { key: "rtdb.egress",       type: "firebasedatabase.googleapis.com/network/sent_bytes_count",  kind: "delta", unit: "bytes" },
  { key: "rtdb.connections",  type: "firebasedatabase.googleapis.com/network/active_connections", kind: "gauge", freeDaily: 100 },
];

// Sub-series whose label marks a failure, so an error rate can be synthesised
// from a metric that only counts executions.
const FAILURE_LABELS = {
  "functions.calls": (label) => label !== "ok" && label !== "",
  // 4xx deliberately excluded: this estate's callables reject unauthenticated
  // and unauthorized callers by design (see functions/index.js
  // assertHealthAccess and friends), and that shows up as ordinary 4xx
  // traffic in this metric -- expected bot/scanner noise, not a real
  // failure. 5xx is what actually means "the server broke".
  "run.requests": (label) => label === "5xx",
};

// Failure-rate bar for FAILURE_LABELS metrics, keyed by metric. Defaults
// below (5%/25% share, cfg.errorFloor count) apply to anything not listed.
// functions.calls needs its own, higher bar: unlike run.requests, Cloud
// Functions' execution_count metric only reports a coarse ok/error status
// with no 4xx/5xx split, so an expected auth rejection (assertHealthAccess
// and friends) can't be excluded from it the way it can from run.requests --
// it just shows up as routine "error" noise, observed running ~13% on
// stanimeros-dev's own callables on an ordinary day. Until that's split out
// at the app level (e.g. logging rejections distinctly), a higher floor and
// share keeps that noise quiet while still catching a real crash spike.
const FAILURE_THRESHOLDS = {
  "functions.calls": { errorFloor: 30, share: 0.2, criticalShare: 0.5 },
};

function failureThresholdsFor(key, cfg) {
  const override = FAILURE_THRESHOLDS[key] || {};
  return {
    errorFloor: override.errorFloor ?? cfg.errorFloor,
    share: override.share ?? 0.05,
    criticalShare: override.criticalShare ?? 0.25,
  };
}

// Per-entity breakdowns: which function broke, not just "a function did".
const BREAKDOWNS = [
  {
    kind: "function",
    type: "cloudfunctions.googleapis.com/function/execution_count",
    nameLabel: "resource.label.function_name",
    statusLabel: "metric.label.status",
    isError: (v) => v !== "ok" && v !== "",
  },
  {
    kind: "run",
    type: "run.googleapis.com/request_count",
    nameLabel: "resource.label.service_name",
    statusLabel: "metric.label.response_code_class",
    isError: (v) => v === "4xx" || v === "5xx",
  },
];

const DEFAULTS = {
  spikeRatio: 3.0,      // flag when the last full day >= ratio x baseline median
  spikeFloor: 100,      // ...and is at least this many units, so tiny numbers stay quiet
  quietFraction: 0.2,   // ...or 20% of a metric's freeDaily, if that's higher (e.g. 10k Firestore reads)
  errorFloor: 10,       // errors/window below this are never flagged on their own
  // Applies ONLY to a log line no pattern in ERROR_KINDS recognised. Anything
  // classify() can name takes its severity from LEVEL_BY_KIND instead, so a
  // credential-hygiene notice is no longer critical merely for having
  // occurred. At 1 this rule is "any unrecognised error is critical" -- which
  // is the intent (an unknown error is red, not amber), but it is also why it
  // must not be the rule for classified kinds: every signature has count >= 1,
  // so applied to everything it made the whole estate critical. A project that
  // legitimately logs routine errors can raise its own bar in OVERRIDES.
  criticalErrors: 1,    // unclassified errors/window at or above this are critical
  freeTierWarn: 0.8,    // warn at 80% of a Spark daily allowance
  baselineDays: 14,
  // A finding no longer needs to survive on the strength of this window
  // alone -- lifecycle.js persists it across runs (open until confirmed
  // cleared, deleted and recreated fresh if it comes back), so 48h of
  // padding against a missed run is no longer the safety net it used to be.
  logHours: 24,
};

// Project-level roles that turn a leaked service-account key into full
// project control. Bound to a human, these are expected; bound to a service
// account, they're usually a leftover from early setup and worth narrowing.
const BROAD_ROLES = new Set(["roles/owner", "roles/editor"]);

// Severity ordering, worst first. This is the one place "worse than" is
// defined -- worstLevel() and every findings.sort() walk this array instead
// of hard-coding a comparison, so adding a tier later (or reordering these)
// is a one-line change, not a hunt through analyze.js/index.js for every
// place that compared two levels.
const LEVEL_ORDER = ["critical", "warn", "low", "ok"];

// kind -> level, for every finding kind whose severity doesn't depend on the
// number behind it. Adding a new always-the-same-severity kind is a one-line
// addition here.
//
// A handful of kinds are deliberately *not* here because they're graduated
// by magnitude rather than flat: failures/quota/errors escalate on a share
// or count against a cfg.* threshold. spike is graduated too, but only ever
// to warn -- usage running hot, on its own, is never evidence of a real
// failure, however large the ratio; it stays out of this table only because
// analyze.js decides it next to spikeRatio, not because it can reach
// critical. Those stay computed in analyze.js, next to the threshold they
// compare against -- putting only half of a graduated decision in a table
// would be more confusing than keeping it whole.
//
// sa-key and broad-role used to graduate too (key age, and whether the
// account was GCP's own default agent) -- now flat `low` regardless, same
// reasoning as api_key_warning/service_account_warning below: a downloadable
// key or a broad role is estate hygiene worth listing, not by itself
// evidence something is currently broken, however old or however custom the
// account.
//
// Three tiers, not two: `critical` is a real failure, `warn` is something
// off but nothing failing, `low` is estate hygiene that's true but not an
// incident and often not fixable today (see health-schema.md).
const LEVEL_BY_KIND = {
  // real failures
  quota_exhausted: "critical",
  billing: "critical",
  deploy_failure: "critical",
  // Crash-shaped: something ran and died. These were classified by logging.js
  // but graded nowhere, so they fell through to the raw count rule and were
  // only ever critical by accident -- they are critical on purpose now.
  out_of_memory: "critical",
  function_crash: "critical",
  function_timeout: "critical",

  // something is off, but nothing is currently failing
  stall: "warn",
  // A denied call is a misconfiguration to fix, not something on fire -- and
  // it is by far the commonest ERROR-severity line in an audit log.
  unauthenticated: "warn",
  // An entry whose message we could not read (see logging.js's NO_MESSAGE).
  // Worth showing -- something logged an error -- but calling it critical
  // asserts a severity nothing in the entry actually supports.
  unreadable: "warn",
  // A known-benign notice a Google service happens to log at ERROR severity.
  // Nothing failed, so it belongs with the hygiene tier, not with failures.
  advisory: "low",
  "function silent": "warn",
  "run silent": "warn",
  "function spike": "warn",
  "run spike": "warn",
  missing_index: "warn",
  rules_denied: "warn",

  // hygiene: true, but not a fixable-today incident, and not shaped like
  // usage. service_account_warning sits here for the same reason
  // api_key_warning does -- both are GCP's own credential-hygiene notices,
  // not evidence anything is currently broken.
  api_key_warning: "low",
  service_account_warning: "low",
  "api-key": "low",
  "sa-key": "low",
  "broad-role": "low",
};

// Per-project threshold overrides, merged over DEFAULTS: a project that is
// legitimately spiky gets its floor or ratio raised here rather than having
// every run mail about it.
const OVERRIDES = {
  // Near-idle project: most of the 14-day window has no traffic at all, so a
  // single real day of use reads as an infinite ratio against a baseline of 1.
  // Raising the floor (not the ratio) is what actually helps here.
  nourea: { spikeFloor: 300 },
  // Naturally bimodal read volume (courier-driven) — its own baseline window
  // already contains days 3-15x higher than a typical "spike", so the default
  // 3x ratio fires on normal variance.
  "parcels-ecdc6": { spikeRatio: 5.0 },
};

// A report document must stay under Firestore's 1 MiB cap. 15 projects x
// per-function rows x error signatures is the realistic way to breach it.
const LIMITS = {
  entitiesPerProject: 25,
  topErrorsPerProject: 10,
  reportRetentionDays: 90,
};

// Second-precision ISO, the one timestamp shape everything in the sweep is
// written and compared with. `generated` and the lifecycle cutoffs are
// compared as *strings*, so a value carrying milliseconds sorts wrong against
// one that doesn't -- which is why this must stay a single definition rather
// than a regex copy-pasted at each call site.
function isoSecond(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function thresholdsFor(projectId) {
  return { ...DEFAULTS, ...(OVERRIDES[projectId] || {}) };
}

module.exports = {
  PROJECTS,
  BILLING_ACCOUNT,
  METRICS,
  FAILURE_LABELS,
  FAILURE_THRESHOLDS,
  BREAKDOWNS,
  BROAD_ROLES,
  LEVEL_ORDER,
  LEVEL_BY_KIND,
  DEFAULTS,
  OVERRIDES,
  LIMITS,
  thresholdsFor,
  failureThresholdsFor,
  isoSecond,
};
