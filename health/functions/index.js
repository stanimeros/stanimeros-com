const { setGlobalOptions } = require("firebase-functions");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

const { runHealthCheck, buildReport } = require("./lib");
const { PROJECTS, thresholdsFor } = require("./lib/config");
const { makeLimiter, allow: withinRateLimit } = require("./lib/rateLimit");
const { enforceRateLimit } = require("./rateLimiter");

setGlobalOptions({ maxInstances: 10, region: "europe-west1" });

// --------------------------------------------------------------------------
// System health checker — see lib/health-schema.md
// --------------------------------------------------------------------------

// Only this UID may read health data. Kept server-side rather than in
// firestore.rules so the ruleset stays deny-all with no exception, and the
// allowlist itself is never shipped to the browser.
const HEALTH_UIDS = (process.env.HEALTH_ALLOWED_UIDS || "")
  .split(",")
  .map((uid) => uid.trim())
  .filter(Boolean);

function assertHealthAccess(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!HEALTH_UIDS.includes(uid)) throw new HttpsError("permission-denied", "Not allowed.");
  return uid;
}

// Runs as health-checker@stanimeros-dev, which holds monitoring.viewer +
// logging.viewer across the estate. Retries are off on purpose: a retried run
// would re-send the alert mail. maxInstances 1 keeps two sweeps from racing to
// write the same state document.
const HEALTH_OPTIONS = {
  serviceAccount: "health-checker@stanimeros-dev.iam.gserviceaccount.com",
  timeoutSeconds: 540,
  memory: /** @type {import("firebase-functions/v2/options").MemoryOption} */ ("512MiB"),
  maxInstances: 1,
};

// Three times through the working day (8am/1pm/6pm Athens), not once a
// day and not overnight: the baseline every metric/entity check compares
// against is a multi-day median (cfg.baselineDays, see monitoring.js
// windowFor) that only moves day to day, so a same-day rerun wouldn't
// change what a spike or stall check is scored against. But the
// rolling-24h "now" window those same checks (including the failure-rate
// check inside analyze.js analyzeMetric / analyzeEntities) are scored
// from, and the log scan's rolling logHours (24h, see config.js) window,
// both shift with every run -- so three sweeps a day catch a live
// incident well before a 24h-old one would age out unseen, without paging
// anyone with a 3am-generated alert. "Run now" on the dashboard still
// covers anything more urgent than a 6h cadence, or anything overnight.
// 8am Athens is the anchor: it gives the UTC day (ends 00:00 UTC = 03:00
// Athens) time to settle in Monitoring before the first sweep reads it.
exports.healthCheck = onSchedule(
  {
    ...HEALTH_OPTIONS,
    schedule: "0 8,13,18 * * *",
    timeZone: "Europe/Athens",
    retryCount: 0,
  },
  async () => {
    const summary = await runHealthCheck({ mode: "scheduled" });
    logger.info("Health sweep complete", summary);
  }
);

// On-demand run from the dashboard.
exports.runHealthCheckNow = onCall(
  { ...HEALTH_OPTIONS, enforceAppCheck: true },
  async (request) => {
    assertHealthAccess(request);
    await enforceRateLimit(request, "runHealthCheckNow");
    return runHealthCheck({ mode: "manual" });
  }
);

// getHealthReport, getHealthFindings, ackFinding, markHealthSeen and
// getHealthSeen used to live here as callables. firestore.rules now gates
// health_reports/health_findings/health_seen directly on request.auth.uid
// (the single admin account), so the dashboard reads/writes Firestore
// straight from the client (health/src/lib/firebase.ts) instead.

// --------------------------------------------------------------------------
// Client-side (browser/app) error ingestion — see lib/clientErrors.js
// --------------------------------------------------------------------------

// "id:token,id:token,..." -- one random secret per monitored project
// (lib/config.js PROJECTS), set in .env. Not Firebase Auth: the callers are
// anonymous visitors in other apps' browsers/devices, not signed-in health
// dashboard users, so this is the only gate available -- a leaked token lets
// someone spam findings onto that one project, never any other, and never
// read anything back.
const CLIENT_ERROR_TOKENS = new Map(
  (process.env.HEALTH_CLIENT_TOKENS || "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(":");
      return [pair.slice(0, i), pair.slice(i + 1)];
    })
);

const KNOWN_PROJECT_IDS = new Set(PROJECTS.map((p) => p.id));

// Shared across invocations on the same warm instance -- see rateLimit.js's
// module doc for why per-instance (not Firestore-backed) is the right
// tradeoff here.
const clientErrorLimiter = makeLimiter();

// Production origins only -- deliberately no localhost/staging/preview
// entries. This is a browser-side gate, not a real access-control boundary
// (a non-browser client sets its own Origin header and CORS never sees it),
// but combined with the per-project token above it closes the cheap abuse
// path: a stolen token embedded in a script on some other live site. Grows
// by one line each time another app is wired up to this endpoint.
const ALLOWED_ORIGINS = [
  "https://stanimeros.com",
  "https://stanimeros-dev.web.app",
  "https://stanimeros-health.web.app",
  "https://athens-mytransfer.com",
  "https://athens-mytransfer.web.app",
  "https://ai.nikimargariti.gr",
  "https://niki-margariti-agent.web.app",
  "https://nourea-dashboard.web.app",
  "https://process-a7a0f.web.app",
  "https://thr.topaketo.de",
  "https://parcels-ecdc6.web.app",
  "https://veridictum.ai",
  "https://veridictum.web.app",
  "https://admin.tattoo-healer.com",
  "https://tattoo-healer.web.app",
  "https://hedeos.gr",
  "https://hedeos-f6e6c.web.app",
  "https://ski-greece.gr",
  "https://poudra-c2e70.web.app",
];

// Hard caps on what a single report can cost this function's own log volume
// -- an attacker (or a genuinely broken page in a tight retry loop) with a
// valid token can still spam, but not with unbounded-size payloads.
const MAX_FIELD_LENGTHS = { message: 500, stack: 2000, url: 500, userAgent: 300 };

function truncated(value, max) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

// Public HTTPS endpoint (no Firebase Auth, no App Check -- a third-party
// app's own domain can't mint either) that an app's `window.onerror` /
// `unhandledrejection` handler or a React/Flutter error boundary calls
// directly. It does no analysis itself: it just writes a structured log
// line into *this* project's Cloud Logging, tagged with which app it came
// from, for clientErrors.js to read back out on the next sweep. See
// clientErrors.js's module doc for why the finding lives here instead of in
// the reporting app's own project.
exports.reportClientError = onRequest(
  { region: "europe-west1", cors: ALLOWED_ORIGINS, maxInstances: 20 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "method not allowed" });
      return;
    }

    const body = (typeof req.body === "object" && req.body) || {};
    const project = typeof body.project === "string" ? body.project : "";
    const token = typeof body.token === "string" ? body.token : "";

    if (!KNOWN_PROJECT_IDS.has(project)) {
      res.status(400).json({ error: "unknown project" });
      return;
    }
    const expected = CLIENT_ERROR_TOKENS.get(project);
    // No expected token at all (HEALTH_CLIENT_TOKENS not set for this
    // project) fails the same way as a wrong one -- there is no "open"
    // state for this endpoint.
    if (!expected || token !== expected) {
      res.status(401).json({ error: "invalid token" });
      return;
    }

    // Gate on frequency before doing anything else -- a client stuck in a
    // retry loop (broken useEffect, most often) is now known-legitimate
    // (right project, right token), so this is the one place left to stop
    // it from turning into unbounded log-ingestion / invocation cost. No
    // logger call on the 429 path itself, for the same reason.
    if (!withinRateLimit(clientErrorLimiter, project, thresholdsFor(project).clientErrorPerMinute)) {
      res.status(429).json({ error: "rate limited" });
      return;
    }

    const message = truncated(body.message, MAX_FIELD_LENGTHS.message);
    if (!message) {
      res.status(400).json({ error: "missing message" });
      return;
    }

    // jsonPayload.kind is the one field clientErrors.js's log filter keys
    // on -- every other field is free-form and optional. Deliberately NOT
    // called `message`: firebase-functions' logger.error builds its own
    // `out.message` (a formatted/stack-wrapped string) from the log call's
    // string args and writes it *after* spreading this data object in, so a
    // field literally named `message` here is silently overwritten by that
    // -- see entryFromArgs in firebase-functions/lib/logger/index.js.
    //
    // logger.warn, not .error: this function's own Cloud Run logs live in
    // *this* project (stanimeros-dev), so an ERROR-severity entry here would
    // also be picked up by the ordinary per-project log scan (logging.js's
    // readErrors, severity>=ERROR) and misattributed as stanimeros-dev's own
    // error -- grading its own homework a second time, the same class of bug
    // SELF_AUDIT_TYPES/isSelfAuditDenial in logging.js exist to prevent.
    // WARNING sits below that filter's threshold; clientErrors.js finds this
    // entry independently via jsonPayload.kind, never by severity.
    logger.warn("client error", {
      kind: "client-error",
      project,
      errorMessage: message,
      errorStack: truncated(body.stack, MAX_FIELD_LENGTHS.stack),
      url: truncated(body.url, MAX_FIELD_LENGTHS.url),
      userAgent: truncated(body.userAgent, MAX_FIELD_LENGTHS.userAgent),
      level: body.level === "warning" ? "warning" : "error",
    });

    res.status(204).send();
  }
);

// Pure helpers, exported for unit testing only — not part of the deployed
// function surface (Firebase only deploys the `exports.<name>` onCall/
// onSchedule/onRequest entries above).
exports._internal = { assertHealthAccess, buildReport };
