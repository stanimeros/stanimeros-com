// Maintains `health_findings/{key}`, a durable record of every finding's
// lifecycle across runs -- see plan.md S1.2. A `health_reports/{runId}`
// document is a snapshot of one run; this collection is what turns a series
// of snapshots into "when did this start" and "did it actually clear".
//
// The load-bearing rule (plan.md S1.3, and a run that already happened this
// way -- see plan.md SS B2): a key missing from this run's report means
// "resolved" only when the project it belongs to was actually read this run.
// A project that 403s loses all of its findings from the report, and a naive
// diff would read that as a wave of resolutions -- exactly backwards, since
// less visibility is not good news. Those keys go to `unknown` instead, and
// `unknown` never sets `resolvedAt`.

const FINDINGS = "health_findings";

// A `resolved` key that reappears within this window is the flapping case
// (plan.md S1.3/B3) -- it's the same incident continuing, so `firstSeen`
// and `reopenCount` carry through. Reappearing later than this is treated as
// a new occurrence of the same key: fresh `firstSeen`, `reopenCount` reset.
// Three runs a day means 48h is roughly six runs of slack either side of a
// diurnal pattern -- generous enough that a "weekday only" finding doesn't
// look like a fresh lifecycle every Monday.
const REOPEN_WINDOW_MS = 48 * 60 * 60 * 1000;

function isoNow(now) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

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

// --- pure state machine (no Firestore -- takes what it needs, returns what
// to write) -------------------------------------------------------------

/**
 * @param {{ projects: any[], projectErrors?: any[] }} report
 * @param {Map<string, any>} existingByKey - current `health_findings` docs, keyed by finding key
 * @param {Date} now
 * @returns {{ key: string, data: any }[]} documents that changed and need writing
 */
function planLifecycleUpdate(report, existingByKey, now) {
  const nowIso = isoNow(now);
  const checkedProjectIds = new Set(report.projects.map((p) => p.project));

  const currentByKey = new Map();
  for (const project of report.projects) {
    for (const finding of project.findings) {
      currentByKey.set(finding.key, {
        project: project.project,
        level: finding.level,
        kind: finding.kind,
        text: finding.text,
      });
    }
  }

  const writes = [];

  // Keys present this run: open (or stay acked), lastSeen/runsSeen always
  // move, so every present key is written every run -- a few hundred docs,
  // three times a day, well within budget (plan.md S1.2).
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
          resolvedAt: null,
          runsSeen: 1,
          reopenCount: 0,
          ackedUntil: null,
          ackedBy: null,
        },
      });
      continue;
    }

    let state = existing.state;
    let firstSeen = existing.firstSeen || nowIso;
    let reopenCount = existing.reopenCount || 0;
    let runsSeen = (existing.runsSeen || 0) + 1;
    let ackedUntil = existing.ackedUntil || null;
    let ackedBy = existing.ackedBy || null;

    if (existing.state === "resolved") {
      const gapMs = existing.resolvedAt
        ? now.getTime() - new Date(existing.resolvedAt).getTime()
        : Infinity;
      if (gapMs <= REOPEN_WINDOW_MS) {
        // Same incident, back again -- flapping, not a new problem.
        reopenCount += 1;
      } else {
        firstSeen = nowIso;
        reopenCount = 0;
        runsSeen = 1;
      }
      state = "open";
    } else if (existing.state === "unknown") {
      // The project just came back into view. This was never actually
      // confirmed resolved, so reappearing is a continuation, not a reopen.
      state = "open";
    } else if (existing.state === "acked") {
      // An acked finding that gets worse un-acks itself (plan.md S1.5) --
      // acking "an expected warn" must not silently swallow it turning
      // critical.
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

    writes.push({
      key,
      data: {
        key,
        project: cur.project,
        level: cur.level,
        kind: cur.kind,
        text: cur.text,
        firstSeen,
        lastSeen: nowIso,
        state,
        resolvedAt: null,
        runsSeen,
        reopenCount,
        ackedUntil,
        ackedBy,
      },
    });
  }

  // Keys absent this run: resolved, unknown, or left alone.
  for (const [key, existing] of existingByKey) {
    if (currentByKey.has(key)) continue;
    if (existing.state === "resolved") continue; // nothing changes; pruning handles retention

    const projectWasChecked = checkedProjectIds.has(existing.project);

    if (!projectWasChecked) {
      // Either in projectErrors, or the project has dropped out of PROJECTS
      // entirely -- either way, no confirmation this cleared. Only write
      // when the state actually changes, so an estate-wide outage doesn't
      // rewrite every finding on every run it lasts.
      if (existing.state !== "unknown") {
        writes.push({ key, data: { ...existing, state: "unknown" } });
      }
      continue;
    }

    // Project was read cleanly and the key just isn't there any more --
    // that's what "resolved" means. Acked findings are not exempt: an ack
    // says "seen, expected", not "stop tracking" (plan.md S1.5 -- "they do
    // not stop being checked").
    writes.push({ key, data: { ...existing, state: "resolved", resolvedAt: nowIso } });
  }

  return writes;
}

// --- I/O -----------------------------------------------------------------

/**
 * Reads the whole `health_findings` collection, runs the state machine, and
 * writes back only the documents that changed. A few hundred keys total, so
 * a full-collection read is cheap and avoids needing a composite index to
 * find "everything not currently resolved".
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

/**
 * Retention for lifecycle docs (plan.md S1.8): `resolved` findings older
 * than `retentionDays` past `resolvedAt` are deleted; `open`/`unknown`/
 * `acked` are kept forever, since by definition they're still true. Same
 * bounded-batch shape as `pruneOldReports` in index.js.
 */
async function pruneLifecycle(db, retentionDays, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 86400000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  let snap;
  try {
    snap = await db
      .collection(FINDINGS)
      .where("state", "==", "resolved")
      .where("resolvedAt", "<", cutoff)
      .limit(50)
      .get();
  } catch (err) {
    // Same "no report yet" class of failure as isIndexNotReady in index.js:
    // this composite index (see firestore.indexes.json) may not have
    // finished building right after deploy. Pruning is best-effort -- it
    // must never take the whole sweep down.
    if (err.code === 9 || /FAILED_PRECONDITION/.test(err.message || "")) return 0;
    throw err;
  }
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
}

module.exports = { FINDINGS, docIdFor, planLifecycleUpdate, updateLifecycle, pruneLifecycle, REOPEN_WINDOW_MS };
