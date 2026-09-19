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
 * One-time setup: add a Firestore TTL policy on the `_rateLimits` collection's
 * `expiresAt` field so old counter docs get garbage-collected.
 */

const admin = require("firebase-admin");
const { HttpsError } = require("firebase-functions/v2/https");

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
    request.auth?.uid || request.rawRequest?.ip || "anonymous";

  const db = admin.firestore();
  const now = Date.now();
  const entries = limitTiers.map((tier) => {
    const windowStart = Math.floor(now / 1000 / tier.windowSeconds);
    const docId = `${fnName}_${identity}_${tier.windowSeconds}_${windowStart}`;
    return { tier, windowStart, ref: db.collection("_rateLimits").doc(docId) };
  });

  await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(entries.map((e) => tx.get(e.ref)));

    snaps.forEach((snap, i) => {
      const { tier } = entries[i];
      const count = snap.exists ? snap.data().count : 0;
      if (count >= tier.maxCalls) {
        throw new HttpsError(
            "resource-exhausted",
            `Rate limit exceeded for ${fnName}. Please try again shortly.`,
        );
      }
    });

    snaps.forEach((snap, i) => {
      const { tier, windowStart, ref } = entries[i];
      const count = snap.exists ? snap.data().count : 0;
      tx.set(ref, {
        count: count + 1,
        expiresAt: admin.firestore.Timestamp.fromMillis(
            (windowStart + 1) * tier.windowSeconds * 1000,
        ),
      }, { merge: true });
    });
  });
}

module.exports = { enforceRateLimit, LIMITS, DEFAULT_LIMIT };
