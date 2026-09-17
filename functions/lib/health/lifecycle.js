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

// How many deploy timestamps a single finding document keeps. This is a
// "still failing, N deploys later" trail, not an audit log -- 10 redeploys
// of the same unfixed bug is already well past the point of being useful
// context, so the array is capped and deploysSinceFirstSeen (uncapped) is
// the number to actually alarm on.
const DEPLOY_HISTORY_CAP = 10;

// The only finding kinds a deploy can plausibly explain -- everything else
// (cost, quota, sa-key/broad-role/api-key hygiene) has no function or
// service behind it to have redeployed. analyze.js only ever attaches
// `deployedAt` to a finding for one of these kinds, so this set exists here
// only to let computeResolvedAfterDeploy recognise which stored keys are
// entity-shaped without re-parsing analyze.js's decision.
const ENTITY_FINDING_KINDS = new Set([
  "function errors", "function silent", "function spike",
  "run errors", "run silent", "run spike",
]);

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

// --- deploy correlation (pure) --------------------------------------------
//
// A deploy NEVER resolves a finding. Resolution stays exactly what it always
// was -- "the check stopped firing" -- computed below with no reference to
// any of this. The reason is asymmetric risk: if a redeploy could mark a
// finding resolved, a redeploy that *didn't* fix the underlying bug would
// silently clear a real, still-true finding -- strictly worse than not
// correlating deploys at all, since a false "resolved" looks exactly like
// good news. Everything here only ever adds an annotation (deploys,
// deploysSinceFirstSeen, resolvedAfterDeploy) alongside a state the rest of
// this file already decided; it never feeds back into `state` itself.
//
// Phrasing note for anything user-facing built on these fields: a deploy
// lining up with a finding closing is a correlation, not proof of causation
// -- the finding could have cleared for an unrelated reason at the same
// moment. Say "correlates with" / "since the last deploy", never "fixed by".

/**
 * A finding key encodes its subject as `${project}:${kindDotEncoded}:${subject}`
 * (findingKey in analyze.js). For the entity-shaped kinds in
 * ENTITY_FINDING_KINDS, `subject` is exactly the entity name with no
 * embedded colon (function/service names don't contain one, unlike e.g.
 * sa-key's `email:keyId`), so it can be recovered without a second field on
 * every stored document. Returns null for anything else.
 */
function entityNameFromKey(existing) {
  if (!ENTITY_FINDING_KINDS.has(existing.kind)) return null;
  const kindEncoded = String(existing.kind).replace(/\s+/g, ".");
  const prefix = `${existing.project}:${kindEncoded}:`;
  return existing.key.startsWith(prefix) ? existing.key.slice(prefix.length) : null;
}

/**
 * Builds project -> (lowercased entity name -> deployedAt) from this run's
 * report, so resolution (below) can ask "did the entity behind this
 * now-absent finding deploy since it was last seen" using the *current*
 * run's fresh read, not a stale one -- the whole point of catching "fixed by
 * a deploy that landed between the last two runs".
 */
function buildDeploysByProject(report) {
  const byProject = new Map();
  for (const project of report.projects) {
    const byName = new Map();
    for (const entity of project.entities || []) {
      if (entity.deployedAt) byName.set(entity.name.toLowerCase(), entity.deployedAt);
    }
    byProject.set(project.project, byName);
  }
  return byProject;
}

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

/**
 * On resolution: the nearest deploy that falls strictly after this finding
 * was last seen and no later than the moment it resolved. That window is
 * exactly "could this deploy plausibly be why the check stopped firing" --
 * a deploy from before the finding was last observed still failing clearly
 * wasn't the fix. Candidates come from this run's fresh entity read (a
 * deploy that landed since the last run, before the entity even had a
 * chance to report again) and from the finding's own recorded trail (a
 * deploy already noticed while it was still open). Returns null when the
 * kind isn't entity-shaped, or nothing falls in the window -- correlation,
 * not a guess.
 */
function computeResolvedAfterDeploy(existing, deploysByProject, nowIso) {
  const name = entityNameFromKey(existing);
  if (!name) return null;
  const byName = deploysByProject.get(existing.project);
  const fresh = byName && byName.get(name.toLowerCase());
  const candidates = [fresh, ...(existing.deploys || [])].filter(Boolean);
  const lastSeenMs = existing.lastSeen ? new Date(existing.lastSeen).getTime() : -Infinity;
  const resolvedMs = new Date(nowIso).getTime();

  let best = null;
  for (const candidate of candidates) {
    const t = new Date(candidate).getTime();
    if (t > lastSeenMs && t <= resolvedMs && (!best || t > new Date(best).getTime())) {
      best = candidate;
    }
  }
  return best;
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
  const deploysByProject = buildDeploysByProject(report);

  const currentByKey = new Map();
  for (const project of report.projects) {
    for (const finding of project.findings) {
      currentByKey.set(finding.key, {
        project: project.project,
        level: finding.level,
        kind: finding.kind,
        text: finding.text,
        // Only set for the function/run-shaped kinds analyze.js attaches it
        // to (see ENTITY_FINDING_KINDS) -- undefined here for everything
        // else, which advanceDeployHistory treats as "nothing new".
        deployedAt: finding.deployedAt || null,
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
          deployedAt: cur.deployedAt || null,
          deploys: [],
          deploysSinceFirstSeen: 0,
          resolvedAfterDeploy: null,
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
    // Deploy trail carried through by default -- a fresh occurrence of the
    // same key (the `else` branch just below) is the one case that resets
    // it, since that's deliberately treated as an unrelated incident rather
    // than a continuation.
    let deployBase = existing;

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
        // Fresh incident, not a continuation of the old one -- stale deploy
        // history from an earlier, unrelated occurrence of this same key
        // would otherwise misreport "3 deploys later" against a clock that
        // hasn't actually been running.
        deployBase = { deployedAt: null, deploys: [] };
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

    const { deployedAt, deploys, deploysSinceFirstSeen } = advanceDeployHistory(deployBase, cur);

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
        deployedAt,
        deploys,
        deploysSinceFirstSeen,
        // Reset while open -- it's only meaningful the moment a finding
        // actually resolves (set below), and stays stale otherwise.
        resolvedAfterDeploy: null,
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
    // not stop being checked"). resolvedAfterDeploy is set here and only
    // here -- it is a note on *why* a resolution might have happened, never
    // a second, deploy-driven way to *reach* one; `state` above was already
    // decided with no reference to deploys at all.
    const resolvedAfterDeploy = computeResolvedAfterDeploy(existing, deploysByProject, nowIso);
    writes.push({
      key,
      data: { ...existing, state: "resolved", resolvedAt: nowIso, resolvedAfterDeploy },
    });
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

module.exports = {
  FINDINGS,
  docIdFor,
  planLifecycleUpdate,
  updateLifecycle,
  pruneLifecycle,
  REOPEN_WINDOW_MS,
  DEPLOY_HISTORY_CAP,
  buildDeploysByProject,
  advanceDeployHistory,
  computeResolvedAfterDeploy,
  entityNameFromKey,
};
