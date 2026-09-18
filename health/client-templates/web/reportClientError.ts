// Reports uncaught client-side errors to the health dashboard's ingestion
// endpoint (reportClientError in health/functions/index.js -> Cloud
// Logging -> lib/clientErrors.js's collector -> findings on the Severity
// tabs). Works unmodified in Astro, Vite, plain React, or any other bundler
// -- it takes project/token as explicit arguments instead of reading a
// bundler-specific env var, so there is nothing here to adapt per framework.
//
// Copy this file into the app (e.g. src/lib/reportClientError.ts) and call
// initHealthReporting() once, as early as possible -- see this directory's
// README.md for exactly where, per framework.
//
// Fire-and-forget by design: a failed report must never itself throw,
// retry, or block anything a real visitor is doing.
//
// Two independent layers guard against a page stuck in a render/retry loop
// (a useEffect with a bad dependency array is the recurring real-world
// shape) turning into runaway cost:
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

const DEFAULT_ENDPOINT = "https://europe-west1-stanimeros-dev.cloudfunctions.net/reportClientError";
const DEFAULT_MAX_REPORTS_PER_SESSION = 20;

let initialized = false;

/**
 * Wires up window.onerror / unhandledrejection reporting. Safe to call more
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

  const seen = new Set<string>();
  let sent = 0;

  function report(message: string | undefined, extra: { stack?: string; level?: "error" | "warning" } = {}) {
    if (!message || sent >= maxReportsPerSession) return;
    const key = `${extra.level ?? "error"}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;

    const body = JSON.stringify({
      project,
      token,
      message,
      stack: extra.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      level: extra.level ?? "error",
    });

    try {
      // sendBeacon survives the page unloading mid-crash (a common moment
      // for an error to fire) without holding the navigation up; fall back
      // to a keepalive fetch where it isn't available. Its own failure is
      // swallowed -- there is nowhere left to report a failure to report an
      // error to.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      } else {
        fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(
          () => {}
        );
      }
    } catch {
      // Swallowed on purpose -- see above.
    }
  }

  window.addEventListener("error", (event) => {
    // A resource load failure (an <img>/<script> 404) fires "error" too,
    // but carries no `message` and no `error` -- nothing here for a report
    // to say.
    if (!event.message) return;
    report(event.message, { stack: event.error instanceof Error ? event.error.stack : undefined });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    const message = reason instanceof Error ? reason.message : String(reason);
    report(message, { stack: reason instanceof Error ? reason.stack : undefined });
  });
}
