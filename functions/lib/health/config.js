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
  "run.requests": (label) => label === "4xx" || label === "5xx",
};

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
  criticalErrors: 100,  // errors/window at or above this are critical
  freeTierWarn: 0.8,    // warn at 80% of a Spark daily allowance
  baselineDays: 14,
  logHours: 24,
};

// Per-project threshold overrides, merged over DEFAULTS. Phase 1 of the plan
// fills this in: a project that is legitimately spiky gets its floor or ratio
// raised here rather than having every run mail about it.
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
  reportRetentionDays: 180,
};

function thresholdsFor(projectId) {
  return { ...DEFAULTS, ...(OVERRIDES[projectId] || {}) };
}

module.exports = {
  PROJECTS,
  BILLING_ACCOUNT,
  METRICS,
  FAILURE_LABELS,
  BREAKDOWNS,
  DEFAULTS,
  OVERRIDES,
  LIMITS,
  thresholdsFor,
};
