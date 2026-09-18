// Reports client-side errors to the health dashboard's ingestion endpoint
// (reportClientError in health/functions/index.js -> Cloud Logging ->
// lib/clientErrors.js's collector -> findings on the Severity tabs). Works
// unmodified in Astro, Vite, plain React, or any other bundler -- it takes
// project/token as explicit arguments instead of reading a bundler-specific
// env var, so there is nothing here to adapt per framework.
//
// Copy this file into the app (e.g. src/lib/reportClientError.ts) and call
// initHealthReporting() once, as early as possible -- see this directory's
// README.md for exactly where, per framework.
//
// initHealthReporting() alone only catches what's *uncaught*:
// window.onerror / unhandledrejection. An error the app itself catches and
// handles -- shows the user a friendly "something went wrong" toast for,
// say -- never reaches either of those, so it would otherwise be invisible
// here no matter how often it happens. Call the exported reportError()
// directly from that catch block to put it on the dashboard too:
//
//   try {
//     await save(data)
//   } catch (err) {
//     showToast("Couldn't save -- please try again")
//     reportError(err instanceof Error ? err.message : String(err))
//   }
//
// Report the underlying technical message (err.message), not the friendly
// copy shown to the user -- that's what lets 500 occurrences of two
// different real causes show up as two distinct signatures on the
// dashboard instead of one uninformative "Couldn't save" bucket.
//
// Fire-and-forget by design: a failed report must never itself throw,
// retry, or block anything a real visitor is doing.
//
// Two independent layers guard against a page stuck in a render/retry loop
// (a useEffect with a bad dependency array is the recurring real-world
// shape), or a catch block on a hot path, turning into runaway cost:
//   1. Here: a per-tab session cap and a per-signature dedupe -- a single
//      tab can never send more than maxReportsPerSession requests, ever,
//      no matter how tight the loop.
//   2. health/functions/lib/rateLimit.js: a per-project, per-minute cap on
//      the endpoint itself -- the backstop for many tabs/devices hitting it
//      at once, which layer 1 alone can't see.
// Neither substitutes for the other -- keep both when copying this out.

export interface HealthReportingOptions {
  /** This app's id in health/functions/lib/config.js's PROJECTS list. */
  project: string;
  /**
   * This app's per-project secret from HEALTH_CLIENT_TOKENS (ask for one to
   * be minted when wiring up a new project -- see health-schema.md).
   * Pass undefined/"" for a build with no token configured (e.g. a fork or
   * local dev) -- reporting silently no-ops rather than sending bad auth.
   */
  token: string | undefined;
  /** Override only for local testing against an emulator. */
  endpoint?: string;
  /** Hard per-tab cap across the page's lifetime. Default 20. */
  maxReportsPerSession?: number;
}

export interface ReportExtra {
  stack?: string;
  /**
   * "warning" for a failure the app already handled gracefully (a caught
   * error behind a friendly message); "error" (the default) for anything
   * more serious. Purely informational -- both feed the same
   * clientErrorFloor/clientErrorCriticalFloor counts in config.js, so a
   * "warning" happening 500 times a day still escalates to critical.
   */
  level?: "error" | "warning";
}

const DEFAULT_ENDPOINT = "https://europe-west1-stanimeros-dev.cloudfunctions.net/reportClientError";
const DEFAULT_MAX_REPORTS_PER_SESSION = 20;

let initialized = false;
let state: { project: string; token: string; endpoint: string; maxReportsPerSession: number } | null = null;
const seen = new Set<string>();
let sent = 0;

/**
 * Wires up window.onerror / unhandledrejection reporting and enables
 * reportError() for manually-reported (caught) errors. Safe to call more
 * than once (e.g. React StrictMode double-invoking an effect, or a hot
 * reload) -- every call after the first is a no-op, so listeners are never
 * attached twice.
 */
export function initHealthReporting(options: HealthReportingOptions): void {
  if (initialized) return;
  initialized = true;

  const {
    project,
    token,
    endpoint = DEFAULT_ENDPOINT,
    maxReportsPerSession = DEFAULT_MAX_REPORTS_PER_SESSION,
  } = options;
  if (!token) return;

  state = { project, token, endpoint, maxReportsPerSession };

  window.addEventListener("error", (event) => {
    // A resource load failure (an <img>/<script> 404) fires "error" too,
    // but carries no `message` and no `error` -- nothing here for a report
    // to say.
    if (!event.message) return;
    reportError(event.message, { stack: event.error instanceof Error ? event.error.stack : undefined });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    const message = reason instanceof Error ? reason.message : String(reason);
    reportError(message, { stack: reason instanceof Error ? reason.stack : undefined });
  });
}

/**
 * Report an error directly -- for a caught exception the app handles on its
 * own (shows a friendly message, falls back to a default, etc.) that would
 * otherwise never reach window.onerror/unhandledrejection. A no-op before
 * initHealthReporting() runs or when it no-op'd (no token configured).
 */
export function reportError(message: string | undefined, extra: ReportExtra = {}): void {
  if (!state || !message || sent >= state.maxReportsPerSession) return;
  const key = `${extra.level ?? "error"}:${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent += 1;

  const body = JSON.stringify({
    project: state.project,
    token: state.token,
    message,
    stack: extra.stack,
    url: window.location.href,
    userAgent: navigator.userAgent,
    level: extra.level ?? "error",
  });

  try {
    // sendBeacon survives the page unloading mid-crash (a common moment for
    // an error to fire) without holding the navigation up; fall back to a
    // keepalive fetch where it isn't available. Its own failure is
    // swallowed -- there is nowhere left to report a failure to report an
    // error to.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(state.endpoint, new Blob([body], { type: "application/json" }));
    } else {
      fetch(state.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Swallowed on purpose -- see above.
  }
}
