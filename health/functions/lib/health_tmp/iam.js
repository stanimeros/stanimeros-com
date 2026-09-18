// Estate-hygiene reads: service accounts with downloadable keys, service
// accounts bound to broad project roles, and API keys with no restrictions.
//
// Unlike the rest of the sweep this isn't "usage", it's shape -- so every
// function here degrades to an empty result rather than throwing. Metrics and
// logs already have monitoring.viewer/logging.viewer on every project; these
// three IAM/API-keys reads need their own grant (scripts/health-iam.sh), which
// rolls out gradually across 15 projects. A project that doesn't have the
// grant yet must not lose its metrics/log findings while this catches up --
// see collectIam.

const { apiGet } = require("./auth");
const { BROAD_ROLES } = require("./config");

const IAM = "https://iam.googleapis.com/v1";
const RESOURCE_MANAGER = "https://cloudresourcemanager.googleapis.com/v1";
const API_KEYS = "https://apikeys.googleapis.com/v2";

// --- pure parsers (take a raw API payload, no I/O) -------------------------

/**
 * SYSTEM_MANAGED keys are Google-rotated and never leave the platform, so
 * they're not a finding -- the endpoint is asked to only return USER_MANAGED
 * ones, which someone chose to download, to begin with.
 */
function parseUserManagedKeys(keysPayload) {
  return ((keysPayload && keysPayload.keys) || []).map((k) => ({
    name: k.name.split("/").pop(),
    validAfterTime: k.validAfterTime || null,
  }));
}

// Google-managed service agents whose role a project owner cannot change --
// GCP creates and controls these internally (infra orchestration, Firebase
// system tasks), and console/API attempts to narrow their role are rejected
// or simply don't stick. Flagging them would be permanent, unfixable noise on
// every project in the estate, so they're excluded outright rather than
// merely tagged.
const UNMANAGED_AGENT_RE = /@(cloudservices|system)\.gserviceaccount\.com$/;

// GCP's own default runtime identities: the App Engine and Compute Engine
// default service accounts. Gen-2 Cloud Functions run AS the compute one, so
// these are not leftovers to delete -- they're what the code executes under.
const DEFAULT_AGENT_RE = /^[^@]+-compute@developer\.gserviceaccount\.com$|^[^@]+@appspot\.gserviceaccount\.com$/;

/**
 * roles/editor on one of those accounts is GCP's factory setting, applied at
 * project creation unless `constraints/iam.automaticIamGrantsForDefaultServiceAccounts`
 * was already enforced (newer projects; ours predate it). So it is present on
 * every project, identical on every run, and says nothing about any specific
 * one -- 25 of this estate's 27 broad-role findings were exactly this, and
 * they buried the two that weren't: a hand-made account with roles/editor,
 * and another holding roles/owner outright.
 *
 * Excluded for the same reason as UNMANAGED_AGENT_RE above: permanent,
 * everywhere, not a per-project signal. The difference is that this one IS
 * fixable -- narrowing these grants is a real best practice -- but it's a
 * deliberate estate-wide project with genuine breakage risk (gen-2 functions
 * need run.invoker, artifactregistry.reader, storage.objectViewer,
 * logging.logWriter and whatever each function touches), not something a
 * health sweep should nag about three times a day.
 *
 * Deliberately narrow: `roles/owner` on a default agent is NOT excluded.
 * Nothing grants that automatically, so someone did it on purpose and it is
 * worth seeing. Hand-created accounts are never excluded at all.
 */
function isFactoryDefaultGrant(email, role) {
  return role === "roles/editor" && DEFAULT_AGENT_RE.test(email);
}

/**
 * Project-level bindings, filtered to service-account members holding a
 * broad role. Human owner/editor grants are expected and out of scope; a
 * *service* account with one is usually a leftover from early setup, and it
 * turns any leaked key for that account into full project control.
 * De-duped, since a conditional policy can list the same role in more than
 * one binding.
 */
function parseBroadBindings(policy) {
  const seen = new Set();
  const out = [];
  for (const binding of (policy && policy.bindings) || []) {
    if (!BROAD_ROLES.has(binding.role)) continue;
    for (const member of binding.members || []) {
      if (!member.startsWith("serviceAccount:")) continue;
      const email = member.slice("serviceAccount:".length);
      if (UNMANAGED_AGENT_RE.test(email)) continue;
      if (isFactoryDefaultGrant(email, binding.role)) continue;
      const dedupeKey = `${binding.role}:${email}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ role: binding.role, email, isDefaultAgent: DEFAULT_AGENT_RE.test(email) });
    }
  }
  return out;
}

/**
 * Keys are client-visible by design -- any browser key ships in the page
 * source -- so a key with no restriction isn't a hypothetical risk, it's
 * already usable by anyone who finds it. Soft-deleted keys (deleteTime set)
 * are excluded; they're not live.
 */
function parseUnrestrictedKeys(keysPayload) {
  const out = [];
  for (const key of (keysPayload && keysPayload.keys) || []) {
    if (key.deleteTime) continue;
    const restricted = !!(key.restrictions && Object.keys(key.restrictions).length);
    if (restricted) continue;
    out.push({ name: (key.name || "").split("/").pop(), displayName: key.displayName || "" });
  }
  return out;
}

// --- fetchers ----------------------------------------------------------

async function listServiceAccounts(projectId, token) {
  const accounts = [];
  let pageToken;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await apiGet(
      `${IAM}/projects/${encodeURIComponent(projectId)}/serviceAccounts?${params}`,
      token
    );
    if (!payload) return [];
    accounts.push(...(payload.accounts || []));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  const withKeys = await Promise.all(
    accounts.map(async (sa) => {
      const keysPayload = await apiGet(
        `${IAM}/projects/${encodeURIComponent(projectId)}/serviceAccounts/${encodeURIComponent(sa.email)}/keys?keyTypes=USER_MANAGED`,
        token
      );
      return {
        email: sa.email,
        displayName: sa.displayName || "",
        disabled: !!sa.disabled,
        userManagedKeys: parseUserManagedKeys(keysPayload),
      };
    })
  );
  return withKeys;
}

async function listBroadServiceAccountBindings(projectId, token) {
  const policy = await apiGet(
    `${RESOURCE_MANAGER}/projects/${encodeURIComponent(projectId)}:getIamPolicy`,
    token,
    { method: "POST", body: "{}" }
  );
  if (!policy) return [];
  return parseBroadBindings(policy);
}

async function listUnrestrictedApiKeys(projectId, token) {
  const payload = await apiGet(
    `${API_KEYS}/projects/${encodeURIComponent(projectId)}/locations/global/keys`,
    token
  );
  if (!payload) return [];
  return parseUnrestrictedKeys(payload);
}

// A 403 here almost always means the grant for this specific read hasn't
// landed on this project yet (scripts/health-iam.sh rolls out per-project,
// separately from monitoring.viewer/logging.viewer). Treating that the same
// as "nothing to report" -- rather than throwing, per apiGet's usual
// contract -- keeps a not-yet-granted IAM check from taking the rest of the
// project's sweep down with it.
async function safe(promise, label, projectId) {
  try {
    return await promise;
  } catch (err) {
    console.log(`iam: ${label} unavailable for ${projectId} -- ${String((err && err.message) || err).slice(0, 200)}`);
    return [];
  }
}

async function collectIam(projectId, token) {
  const [serviceAccounts, broadBindings, unrestrictedKeys] = await Promise.all([
    safe(listServiceAccounts(projectId, token), "service accounts", projectId),
    safe(listBroadServiceAccountBindings(projectId, token), "iam policy", projectId),
    safe(listUnrestrictedApiKeys(projectId, token), "api keys", projectId),
  ]);
  return { serviceAccounts, broadBindings, unrestrictedKeys };
}

module.exports = {
  parseUserManagedKeys,
  parseBroadBindings,
  parseUnrestrictedKeys,
  collectIam,
};
