// Maintains `health_findings/{key}`, a durable record of every finding's
// lifecycle across runs. A `health_reports/{runId}` document is a snapshot
// of one run; this collection is what turns a series of snapshots into
// "when did this start" and "has it been acked".
//
// Ack is the only lifecycle control point -- there is no "resolved" state.
// A key missing from this run's report is simply not written to here at
// all: its document (if any) is left exactly as it was. That used to be a
// deliberate diff (present -> absent = resolved, with a whole
// project-actually-read guard to keep a 403'd project from reading as a
// wave of false resolutions), but tracking that turned out to be more
// fragile than it was worth -- a partial collector failure (see auth.js's
// SCOPES history) could and did masquerade as real fixes. Simpler and more
// honest: the dashboard only ever shows what's in *this run's* findings,
// and acking is the one way a human marks something as seen.

const { isoSecond } = require("./config");

const FINDINGS = "health_findings";

// How many deploy timestamps a single finding document keeps. This is a
// "still failing, N deploys later" trail, not an audit log -- 10 redeploys
// of the same unfixed bug is already well past the point of being useful
// context, so the array is capped and deploysSinceFirstSeen (uncapped) is
// the number to actually alarm on. Kept regardless of ack/resolve state --
// it's just "how many times has this redeployed while still open".
const DEPLOY_HISTORY_CAP = 10;

/**
 * Finding key -> Firestore document id.
 *
 * A finding key is built from the thing it describes, and some of those
 * contain a slash: `broad-role` embeds an IAM role, so the key reads
 * `proj:broad-role:sa@x.iam.gserviceaccount.com:roles/editor`. Firestore
 * reads a slash in a document path as a collection separator, so passing
 * that key to .doc() throws "path does not contain an even number of
 * components" -- and because updateLifecycle runs inside runHealthCheck,
 * that throw takes down the whole sweep after the report is written. One
 * unrestricted IAM role on any project would have meant no health check at
 * all, which is exactly the kind of silent stop this tool exists to catch.
 *
 * The true key is always stored in the document's own `key` field, so this
 * only has to be stable and collision-free, not reversible. `ackFinding`
 * must encode the same way -- it addresses documents by the key the UI
 * holds, which is the unencoded one.
 */
function docIdFor(key) {
  return key.replace(/\//g, "|");
}

function isAckExpired(ackedUntil, now) {
  return !ackedUntil || new Date(ackedUntil).getTime() <= now.getTime();
}

// --- deploy trail (pure) ---------------------------------------------------
//
// Just "how many times has this redeployed while it stayed open" -- an
// annotation alongside whatever state the machine below already decided, not
// a way of deciding it. No correlation-with-resolution here any more; there
// is no resolution.

/**
 * Advances a finding's deploy trail by at most one entry per run. `cur`
 * carries this run's `deployedAt` for the finding's entity (undefined for a
 * non-entity kind, or when this run's deploy read degraded -- see
 * deploys.js). The three cases:
 *
 * - No prior anchor, a fresh one arrives: record it as the baseline. Not
 *   itself a "redeploy since first seen" -- there's no earlier deploy to
 *   compare it against, so counting it would overstate how many times a fix
 *   has been attempted.
 * - A newer deploy than the stored anchor: this is the actual signal --
 *   push it onto the (capped) trail and bump the counter.
 * - Nothing new, or nothing available this run: carry the existing anchor
 *   and trail forward untouched. A transient read failure must not erase
 *   history any more than it should erase any other finding.
 */
function advanceDeployHistory(existing, cur) {
  const prevAnchor = existing.deployedAt || null;
  const deploys = Array.isArray(existing.deploys) ? [...existing.deploys] : [];
  let deploysSinceFirstSeen = existing.deploysSinceFirstSeen || 0;
  let deployedAt = prevAnchor;

  if (cur.deployedAt && prevAnchor && new Date(cur.deployedAt).getTime() > new Date(prevAnchor).getTime()) {
    deploys.push(cur.deployedAt);
    if (deploys.length > DEPLOY_HISTORY_CAP) deploys.shift();
    deploysSinceFirstSeen += 1;
    deployedAt = cur.deployedAt;
  } else if (cur.deployedAt && !prevAnchor) {
    deployedAt = cur.deployedAt;
  }

  return { deployedAt, deploys, deploysSinceFirstSeen };
}

// --- pure state machine (no Firestore -- takes what it needs, returns what
// to write) -------------------------------------------------------------

/**
 * @param {{ projects: any[], projectErrors?: any[] }} report
 * @param {Map<string, any>} existingByKey - current `health_findings` docs, keyed by finding key
 * @param {Date} now
 * @returns {{ key: string, data: any }[]} documents that changed and need writing
 */
function planLifecycleUpdate(report, existingByKey, now) {
  const nowIso = isoSecond(now);

  const currentByKey = new Map();
  for (const project of report.projects) {
    for (const finding of project.findings) {
      currentByKey.set(finding.key, {
        project: project.project,
        level: finding.level,
        kind: finding.kind,
        text: finding.text,
        // Only set for the function/run-shaped kinds analyze.js attaches it
        // to -- undefined here for everything else, which
        // advanceDeployHistory treats as "nothing new".
        deployedAt: finding.deployedAt || null,
      });
    }
  }

  const writes = [];

  // Keys present this run: open (or stay acked), lastSeen/runsSeen always
  // move, so every present key is written every run -- a few hundred docs,
  // three times a day, well within budget. Keys absent this run are left
  // untouched entirely -- no state to update, since presence in a report is
  // no longer what this collection tracks.
  for (const [key, cur] of currentByKey) {
    const existing = existingByKey.get(key);

    if (!existing) {
      writes.push({
        key,
        data: {
          key,
          project: cur.project,
          level: cur.level,
          kind: cur.kind,
          text: cur.text,
          firstSeen: nowIso,
          lastSeen: nowIso,
          state: "open",
          runsSeen: 1,
          ackedUntil: null,
          ackedBy: null,
          deployedAt: cur.deployedAt || null,
          deploys: [],
          deploysSinceFirstSeen: 0,
        },
      });
      continue;
    }

    let state = existing.state;
    let ackedUntil = existing.ackedUntil || null;
    let ackedBy = existing.ackedBy || null;

    if (existing.state === "acked") {
      // An acked finding that gets worse un-acks itself -- acking "an
      // expected warn" must not silently swallow it turning critical.
      const escalated = existing.level === "warn" && cur.level === "critical";
      if (escalated || isAckExpired(existing.ackedUntil, now)) {
        state = "open";
        ackedUntil = null;
        ackedBy = null;
      } else {
        state = "acked";
      }
    } else {
      state = "open";
    }

    const { deployedAt, deploys, deploysSinceFirstSeen } = advanceDeployHistory(existing, cur);

    writes.push({
      key,
      data: {
        key,
        project: cur.project,
        level: cur.level,
        kind: cur.kind,
        text: cur.text,
        firstSeen: existing.firstSeen || nowIso,
        lastSeen: nowIso,
        state,
        runsSeen: (existing.runsSeen || 0) + 1,
        ackedUntil,
        ackedBy,
        deployedAt,
        deploys,
        deploysSinceFirstSeen,
      },
    });
  }

  return writes;
}

// --- I/O -----------------------------------------------------------------

/**
 * Reads the whole `health_findings` collection, runs the state machine, and
 * writes back only the documents that changed. A few hundred keys total, so
 * a full-collection read is cheap.
 */
async function updateLifecycle(db, report, now = new Date()) {
  const snap = await db.collection(FINDINGS).get();
  const existingByKey = new Map();
  // Keyed by the stored `key` field, never by doc.id -- the id is the
  // slash-encoded form (see docIdFor), and the state machine compares
  // against the real finding keys coming off the report.
  snap.docs.forEach((doc) => {
    const data = doc.data();
    existingByKey.set(data.key || doc.id, data);
  });

  const writes = planLifecycleUpdate(report, existingByKey, now);
  if (!writes.length) return { updated: 0 };

  // Firestore batches cap at 500 writes; a few hundred keys stays under that
  // today, but chunk defensively so growth in the estate doesn't silently
  // drop writes past the limit.
  for (let i = 0; i < writes.length; i += 500) {
    const batch = db.batch();
    for (const { key, data } of writes.slice(i, i + 500)) {
      batch.set(db.collection(FINDINGS).doc(docIdFor(key)), data);
    }
    await batch.commit();
  }
  return { updated: writes.length };
}

module.exports = {
  FINDINGS,
  docIdFor,
  planLifecycleUpdate,
  updateLifecycle,
  DEPLOY_HISTORY_CAP,
  advanceDeployHistory,
};
