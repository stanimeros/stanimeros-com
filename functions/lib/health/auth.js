// One access token per run, shared by every Google API call the sweep makes.
//
// The function runs as health-checker@stanimeros-dev, which holds
// monitoring.viewer + logging.viewer on all 15 projects (scripts/health-iam.sh).
// Application Default Credentials pick that identity up automatically in the
// Cloud Functions runtime, and a developer's own gcloud login locally.

const { google } = require("googleapis");

// Scope is not permission. These say what kind of API the token may address;
// what it may actually read is decided by IAM. The SA now also holds
// iam.securityReviewer, serviceusage.apiKeysViewer and run.viewer
// (scripts/health-iam.sh, added for the sa-key/broad-role/api-key hygiene
// checks and deploy correlation), so a broad scope no longer grants it
// nothing extra the way the comment below used to claim.
//
// `cloud-platform.read-only` looks like the tighter, more obvious choice and was
// the original value here — but the Monitoring API doesn't accept it, and every
// timeSeries call came back ACCESS_TOKEN_SCOPE_INSUFFICIENT while Cloud Logging,
// which does accept it, worked fine. Naming the per-API read scopes explicitly
// keeps the intent visible and avoids that trap.
const SCOPES = [
  "https://www.googleapis.com/auth/monitoring.read",
  "https://www.googleapis.com/auth/logging.read",
  "https://www.googleapis.com/auth/bigquery.readonly",
  // IAM Admin API (serviceAccounts/keys), Cloud Resource Manager
  // (getIamPolicy) and Run Admin API (deploy correlation) don't accept any
  // of the narrower scopes above -- they need cloud-platform. Without this,
  // every call iam.js/deploys.js makes 403s with "Request had insufficient
  // authentication scopes" REGARDLESS of the SA's IAM role bindings being
  // correct, which is exactly what happened here: the roles above were
  // granted but this scope list was never updated to match, so
  // sa-key/broad-role/api-key/deploy findings silently stopped reporting on
  // every project rather than erroring loudly.
  "https://www.googleapis.com/auth/cloud-platform",
];

let cached = null;

function authClient() {
  if (!cached) {
    cached = new google.auth.GoogleAuth({ scopes: SCOPES });
  }
  return cached;
}

async function getAccessToken() {
  const client = await authClient().getClient();
  const token = await client.getAccessToken();
  const value = typeof token === "string" ? token : token && token.token;
  if (!value) throw new Error("could not obtain an access token from ADC");
  return value;
}

// Transient — Google's own API had a bad moment, not a real denial. Retrying
// is right for these; retrying a 403/404 would just waste the timeout budget
// on a call that will never succeed.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thin JSON GET with the run's token attached.
 *
 * A 403 means two very different things and they must not be conflated. If the
 * API simply isn't enabled on that project, the service isn't in use and null
 * ("nothing to report") is right. If it's an IAM denial, the project was NOT
 * checked, and returning null would render it as a healthy green tile — the
 * exact blind spot this tool exists to remove. So only the first case is
 * swallowed; a real permission failure throws and surfaces in projectErrors.
 *
 * A 429/5xx or network failure gets up to MAX_ATTEMPTS tries with linear
 * backoff before it's treated as real — one bad moment on Google's side
 * (see party-game-stanimeros 503, 2026-09-16) shouldn't cost a project its
 * whole check for the run.
 *
 * @param {string} url
 * @param {string} token
 * @param {{ timeoutMs?: number, method?: string, body?: string }} [options]
 * @returns {Promise<any>} parsed JSON, or null when the service isn't in use here
 */
async function apiGet(url, token, { timeoutMs = 90000, method = "GET", body } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Network-level failure (timeout, DNS, reset) — same retry treatment as
      // a 5xx, since both mean "try again," not "this project is broken."
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw err;
    }

    if (res.status === 404) return null;

    if (res.status === 403) {
      const body = await res.text().catch(() => "");
      if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(body)) return null;
      throw new Error(`403 denied on ${new URL(url).pathname}: ${body.slice(0, 300)}`);
    }

    if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      lastErr = new Error(`${res.status} ${res.statusText} for ${new URL(url).pathname}`);
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} for ${new URL(url).pathname} ${body.slice(0, 200)}`);
    }
    return res.json();
  }
  throw lastErr;
}

module.exports = { getAccessToken, apiGet };
