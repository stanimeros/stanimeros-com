const test = require("node:test");
const assert = require("node:assert/strict");

const { parseUserManagedKeys, parseBroadBindings, parseUnrestrictedKeys } = require("../lib/iam");

test("parseUserManagedKeys reads name and validAfterTime off each key", () => {
  const keys = parseUserManagedKeys({
    keys: [
      { name: "projects/p/serviceAccounts/sa@p.iam.gserviceaccount.com/keys/abc123", validAfterTime: "2026-01-01T00:00:00Z" },
    ],
  });
  assert.equal(keys.length, 1);
  assert.equal(keys[0].name, "abc123");
  assert.equal(keys[0].validAfterTime, "2026-01-01T00:00:00Z");
});

test("parseUserManagedKeys returns an empty array when the payload has no keys", () => {
  assert.deepEqual(parseUserManagedKeys(null), []);
  assert.deepEqual(parseUserManagedKeys({}), []);
});

test("parseBroadBindings keeps only service-account members on roles/owner or roles/editor", () => {
  const policy = {
    bindings: [
      { role: "roles/owner", members: ["serviceAccount:sa@p.iam.gserviceaccount.com", "user:someone@example.com"] },
      { role: "roles/viewer", members: ["serviceAccount:other@p.iam.gserviceaccount.com"] },
    ],
  };
  const out = parseBroadBindings(policy);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, "roles/owner");
  assert.equal(out[0].email, "sa@p.iam.gserviceaccount.com");
});

test("parseBroadBindings excludes Google-managed service agents whose role can't be changed", () => {
  const policy = {
    bindings: [
      { role: "roles/editor", members: ["serviceAccount:12345@cloudservices.gserviceaccount.com"] },
      { role: "roles/editor", members: ["serviceAccount:firebase-measurement@system.gserviceaccount.com"] },
    ],
  };
  assert.deepEqual(parseBroadBindings(policy), []);
});

test("parseBroadBindings drops roles/editor on GCP's default agents -- the factory setting, on every project, forever", () => {
  // 25 of this estate's 27 broad-role findings were exactly these two shapes,
  // and they buried the hand-created account sitting next to them.
  const policy = {
    bindings: [
      { role: "roles/editor", members: ["serviceAccount:12345-compute@developer.gserviceaccount.com"] },
      { role: "roles/editor", members: ["serviceAccount:myproj@appspot.gserviceaccount.com"] },
      { role: "roles/editor", members: ["serviceAccount:custom-deploy-bot@myproj.iam.gserviceaccount.com"] },
    ],
  };
  const out = parseBroadBindings(policy);
  assert.equal(out.length, 1, "only the hand-created account is a finding");
  assert.equal(out[0].email, "custom-deploy-bot@myproj.iam.gserviceaccount.com");
  assert.equal(out[0].isDefaultAgent, false);
});

test("parseBroadBindings keeps roles/owner on a default agent -- nothing grants that automatically", () => {
  // The exclusion is for the factory grant only. Owner on a default agent
  // means a human did it, which is exactly what this check is for.
  const policy = {
    bindings: [
      { role: "roles/owner", members: ["serviceAccount:12345-compute@developer.gserviceaccount.com"] },
      { role: "roles/owner", members: ["serviceAccount:myproj@appspot.gserviceaccount.com"] },
    ],
  };
  const out = parseBroadBindings(policy);
  assert.equal(out.length, 2);
  assert.ok(out.every((b) => b.role === "roles/owner" && b.isDefaultAgent === true));
});

test("parseBroadBindings de-dupes the same role+email appearing in more than one conditional binding", () => {
  const policy = {
    bindings: [
      { role: "roles/editor", members: ["serviceAccount:sa@p.iam.gserviceaccount.com"], condition: { title: "a" } },
      { role: "roles/editor", members: ["serviceAccount:sa@p.iam.gserviceaccount.com"], condition: { title: "b" } },
    ],
  };
  assert.equal(parseBroadBindings(policy).length, 1);
});

test("parseUnrestrictedKeys flags a key with no restrictions object and skips a restricted one", () => {
  const payload = {
    keys: [
      { name: "projects/p/locations/global/keys/open", displayName: "Open key" },
      { name: "projects/p/locations/global/keys/scoped", restrictions: { browserKeyRestrictions: { allowedReferrers: ["x"] } } },
    ],
  };
  const out = parseUnrestrictedKeys(payload);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "open");
});

test("parseUnrestrictedKeys ignores soft-deleted keys", () => {
  const payload = { keys: [{ name: "projects/p/locations/global/keys/gone", deleteTime: "2026-01-01T00:00:00Z" }] };
  assert.deepEqual(parseUnrestrictedKeys(payload), []);
});
