// Reports uncaught client-side errors to the health dashboard's ingestion
// endpoint (health/functions/index.js's reportClientError -> Cloud Logging ->
// clientErrors.js's collector -> ordinary findings on the Severity tabs).
//
// Fire-and-forget by design: a failed report must never itself throw, retry,
// or block anything a real visitor is doing. Imported for its side effect
// only (see BaseLayout.astro) -- there is nothing here for a caller to call.

const ENDPOINT = "https://europe-west1-stanimeros-dev.cloudfunctions.net/reportClientError"
const PROJECT = "stanimeros-dev"
// Not a real secret (it ships in the client bundle) -- it only limits which
// single project's findings a leaked value could spam, per the endpoint's
// own design. Absent in a build with no PUBLIC_HEALTH_CLIENT_TOKEN set (e.g.
// a fork) -- report() below is a no-op then, not a broken fetch.
const TOKEN = import.meta.env.PUBLIC_HEALTH_CLIENT_TOKEN as string | undefined

// A session cap and a per-signature dedupe: the endpoint itself has no rate
// limit yet (see its own comment), so a page stuck in a render/retry loop
// must not turn into hundreds of requests from this tab alone.
const MAX_REPORTS_PER_SESSION = 20
const seen = new Set<string>()
let sent = 0

function report(message: string | undefined, extra: { stack?: string; level?: "error" | "warning" } = {}) {
  if (!TOKEN || !message || sent >= MAX_REPORTS_PER_SESSION) return
  const key = `${extra.level ?? "error"}:${message}`
  if (seen.has(key)) return
  seen.add(key)
  sent += 1

  const body = JSON.stringify({
    project: PROJECT,
    token: TOKEN,
    message,
    stack: extra.stack,
    url: window.location.href,
    userAgent: navigator.userAgent,
    level: extra.level ?? "error",
  })

  try {
    // sendBeacon survives the page unloading mid-crash (a common moment for
    // an error to fire) without holding the navigation up; fall back to a
    // keepalive fetch where it isn't available. Its own failure is
    // swallowed -- there is nowhere left to report a failure to report an
    // error to.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))
    } else {
      fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(
        () => {}
      )
    }
  } catch {
    // Swallowed on purpose -- see above.
  }
}

window.addEventListener("error", (event) => {
  // A resource load failure (an <img>/<script> 404) fires "error" too, but
  // carries no `message` and no `error` -- nothing here for a report to say.
  if (!event.message) return
  report(event.message, { stack: event.error instanceof Error ? event.error.stack : undefined })
})

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as unknown
  const message = reason instanceof Error ? reason.message : String(reason)
  report(message, { stack: reason instanceof Error ? reason.stack : undefined })
})
