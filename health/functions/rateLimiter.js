/**
 * Firestore-backed multi-window rate limiter for onCall (v2) Cloud Functions.
 * Copied from maintenance/templates/rate-limiter.template.js — see that file's
 * header comment for full rationale and rollout steps.
 *
 * NOTE: `lib/rateLimit.js` already covers `reportClientError` with a
 * deliberately in-memory limiter (see its own header comment for why —
 * that endpoint IS the hot abuse path, so a Firestore transaction per call
 * would be counterproductive there). This file is only for admin-triggered
 * onCall functions like `runHealthCheckNow`, where a Firestore transaction
 * per call is negligible and cross-instance accuracy matters more.
 *
 * No TTL/cleanup needed: each (function, identity, tier) gets exactly one
 * doc, keyed WITHOUT the current window index — its `windowStart` is a field,
 * reset in place each call, so the collection never grows unbounded.
 */

const admin = require("firebase-admin");
const { HttpsError } = require("firebase-functions/v2/https");

/**
 * Real client IP for an unauthenticated caller. Reads `x-forwarded-for`
 * directly instead of Express's `request.rawRequest.ip`, which only reflects
 * the real client when `app.set("trust proxy", ...)` is configured (most
 * Cloud Functions v2 apps never set this). Cloud Functions v2/Cloud Run sits
 * behind Google's front-end proxy, which always overwrites this header with
 * the real client IP as its first entry before the request reaches the
 * function, so it can't be spoofed by the caller.
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
const LIMITS = {
  runHealthCheckNow: tiers(10),
};

const DEFAULT_LIMIT = tiers(30);

/**
 * Throws HttpsError("resource-exhausted", ...) if the caller has exceeded
 * any configured tier for `fnName`; otherwise increments every tier's
 * counter and returns.
 */
async function enforceRateLimit(request, fnName) {
  const limitTiers = LIMITS[fnName] || DEFAULT_LIMIT;
  const identity =
    request.auth?.uid || clientIp(request) || "anonymous";

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
