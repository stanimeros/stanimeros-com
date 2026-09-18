// Per-project request throttling for reportClientError (functions/index.js).
//
// The payload-size caps already there (MAX_FIELD_LENGTHS) bound what a
// single call can cost; this bounds how many calls a minute one project can
// make, so a client stuck in a tight retry loop -- a useEffect with a bad
// dependency array re-firing on every render is the recurring real-world
// shape of this -- can't multiply that cost without limit.
//
// Deliberately in-memory, not Firestore-backed: a cross-instance-accurate
// limiter would cost a transaction per request -- itself billed, and on the
// hot path of the exact abuse this exists to cap. An in-memory bucket only
// throttles per instance, but combined with maxInstances (index.js) that
// still puts a hard ceiling on worst-case sustained volume. A cold start
// resets to a fresh, empty bucket -- fail toward "allow a bit more", never
// toward "wedge the endpoint shut" for a legitimate burst that happens to
// land on a fresh instance.

const WINDOW_MS = 60_000;

function makeLimiter() {
  return new Map(); // projectId -> { windowStart, count }
}

/**
 * @returns {boolean} true if this call is within budget and should proceed;
 * false once the project has used up its per-minute allowance on this
 * instance, for the rest of the current window.
 */
function allow(state, projectId, perMinute, now = Date.now()) {
  const entry = state.get(projectId);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    state.set(projectId, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= perMinute) return false;
  entry.count += 1;
  return true;
}

module.exports = { makeLimiter, allow, WINDOW_MS };
