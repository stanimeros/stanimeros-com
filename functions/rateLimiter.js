/**
 * Firestore-backed multi-window rate limiter for onCall (v2) Cloud Functions.
 * Copied from maintenance/templates/rate-limiter.template.js — see that file's
 * header comment for full rationale and rollout steps.
 *
 * No TTL/cleanup needed: each (function, identity, tier) gets exactly one
 * doc, keyed WITHOUT the current window index — its `windowStart` is a field,
 * reset in place each call, so the collection never grows unbounded.
 */

const admin = require("firebase-admin");
const { HttpsError } = require("firebase-functions/v2/https");

/**
 * Real client IP for an unauthenticated caller (both callables here allow
 * anonymous visitors, gated only by App Check, not sign-in). Reads
 * `x-forwarded-for` directly instead of Express's `request.rawRequest.ip`,
 * which only reflects the real client when `app.set("trust proxy", ...)` is
 * configured -- not set anywhere in this app. Cloud Functions v2/Cloud Run
 * sits behind Google's front-end proxy, which always overwrites this header
 * with the real client IP as its first entry before the request reaches
 * this function, so it can't be spoofed by the caller and needs no
 * trust-proxy config to read.
 */
function clientIp(request) {
  const xff = request.rawRequest?.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  return request.rawRequest?.ip;
}

/** 1-minute/1-hour/24-hour tiers, hourly ~10x and daily ~50x the per-minute cap. */
function tiers(perMinute, overrides = {}) {
  return [
    { maxCalls: perMinute, windowSeconds: 60 },
    { maxCalls: overrides.perHour ?? perMinute * 10, windowSeconds: 3600 },
    { maxCalls: overrides.perDay ?? perMinute * 50, windowSeconds: 86400 },
  ];
}

// callable function name -> array of tiers, all checked together.
// Both callables are public-facing (contact form / chat widget) and already
// gated by App Check (enforceAppCheck: true) — this adds per-identity
// throttling on top for a caller that gets past App Check.
const LIMITS = {
  sendEmail: tiers(5),
  geminiChat: tiers(15),
};

const DEFAULT_LIMIT = tiers(30);

/**
 * Throws HttpsError("resource-exhausted", ...) if the caller has exceeded
 * any configured tier for `fnName`; otherwise increments every tier's
 * counter and returns.
 *
 * IMPORTANT: call this BEFORE the handler's own try/catch, not inside it —
 * both handlers in this file catch everything and rethrow as a plain Error,
 * which would swallow the resource-exhausted code.
 */
async function enforceRateLimit(request, fnName) {
  const limitTiers = LIMITS[fnName] || DEFAULT_LIMIT;
  const identity = request.auth?.uid || clientIp(request) || "anonymous";

  const db = admin.firestore();
  const now = Date.now();
  const entries = limitTiers.map((tier) => {
    const windowStart = Math.floor(now / 1000 / tier.windowSeconds);
    const docId = `${fnName}_${identity}_${tier.windowSeconds}`;
    return { tier, windowStart, ref: db.collection("_rateLimits").doc(docId) };
  });

  await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(entries.map((e) => tx.get(e.ref)));

    snaps.forEach((snap, i) => {
      const { tier, windowStart } = entries[i];
      const data = snap.exists ? snap.data() : null;
      const count = data && data.windowStart === windowStart ? data.count : 0;
      if (count >= tier.maxCalls) {
        throw new HttpsError(
            "resource-exhausted",
            `Rate limit exceeded for ${fnName}. Please try again shortly.`,
        );
      }
    });

    snaps.forEach((snap, i) => {
      const { windowStart, ref } = entries[i];
      const data = snap.exists ? snap.data() : null;
      const count = data && data.windowStart === windowStart ? data.count : 0;
      tx.set(ref, { windowStart, count: count + 1 });
    });
  });
}

module.exports = { enforceRateLimit, LIMITS, DEFAULT_LIMIT };
