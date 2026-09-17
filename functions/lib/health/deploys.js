// Deploy correlation: when did each function/service in a project last
// deploy, so a finding can be read alongside "did a fix already ship" instead
// of in isolation.
//
// Every function in this estate is 2nd Gen, and a 2nd Gen Cloud Function *is*
// a Cloud Run service under the hood -- so one Cloud Run list call per
// project covers the whole estate; there is no separate Cloud Functions API
// to also call. See scripts/health-iam.sh's run.viewer comment.
//
// This module only ever produces a timestamp to hang off an entity. It has
// no opinion on whether a finding is fixed -- that stays a strict function of
// "did the check stop firing" (lifecycle.js). Deploys annotate; they never
// decide. See the comment on planLifecycleUpdate's deploy-history handling
// for why a redeploy must never be allowed to resolve a finding on its own.

const { apiGet } = require("./auth");

const RUN = "https://run.googleapis.com/v2";

/**
 * One project's last-deployed-at times, keyed by lowercased Cloud Run
 * service name. Cloud Run service names are always lowercase; the Cloud
 * Functions name they pair with (analyze.js's dropRunShadows, and the
 * matching this module's caller does against `entity.name`) is camelCase --
 * callers must fold case on both sides when joining, same as dropRunShadows
 * already does for the run/function shadow pairing.
 *
 * `locations/-` lists every region in one call (Cloud Run's aggregated-list
 * form), keeping this to the one-extra-API-call-per-project budget the sweep
 * runs under (CONCURRENCY = 6, ~10s total today). A project's service count
 * here is small enough that a single page always covers it; this
 * deliberately doesn't loop on nextPageToken the way iam.js's paginated
 * reads do, since doing so could turn "one call" into several on a project
 * that grows past a page.
 *
 * Uses the service's own `updateTime` rather than its latest revision's
 * `createTime`. The service resource doesn't carry that timestamp inline --
 * only a revision *name* -- so reading it would mean a second call per
 * *service*, not per project, which is exactly the budget this is meant to
 * respect. Cloud Run bumps a service's updateTime on every new revision
 * rollout, so it's the same signal at a tenth of the cost.
 */
async function collectDeploys(projectId, token) {
  let payload;
  try {
    payload = await apiGet(
      `${RUN}/projects/${encodeURIComponent(projectId)}/locations/-/services`,
      token
    );
  } catch (err) {
    // Same class of failure, and the same degradation discipline, as iam.js's
    // `safe()`: either roles/run.viewer hasn't landed on this project yet
    // (scripts/health-iam.sh rolls out per-project, separately from the
    // monitoring/logging grants the rest of the sweep runs on) or Cloud Run
    // itself had a bad moment. Either way this collector is additive on top
    // of checks that already work everywhere -- a project that can't be read
    // here must lose only its deploy annotations, never its other findings,
    // and must never throw into the sweep.
    console.log(`deploys: unavailable for ${projectId} -- ${String((err && err.message) || err).slice(0, 200)}`);
    return {};
  }
  // apiGet returns null when the Cloud Run API itself is disabled on this
  // project (auth.js's SERVICE_DISABLED case) -- nothing deployed via it.
  if (!payload) return {};

  const byName = {};
  for (const service of payload.services || []) {
    const shortName = (service.name || "").split("/").pop();
    if (!shortName) continue;
    const deployedAt = service.updateTime || service.createTime || null;
    if (deployedAt) byName[shortName.toLowerCase()] = deployedAt;
  }
  return byName;
}

module.exports = { collectDeploys };
