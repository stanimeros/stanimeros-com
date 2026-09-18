const test = require("node:test");
const assert = require("node:assert/strict");

const { apiGet } = require("../lib/auth");

function jsonResponse(status, body) {
  return {
    status,
    statusText: `status ${status}`,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body || {}),
    json: async () => body,
  };
}

// Each test stubs global.fetch and restores it afterward, since apiGet reaches
// for the ambient fetch rather than taking it as a dependency.
function stubFetch(responses) {
  const original = global.fetch;
  let call = 0;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    calls,
    restore: () => { global.fetch = original; },
  };
}

test("apiGet returns parsed JSON on a clean 200", async () => {
  const stub = stubFetch([jsonResponse(200, { ok: true })]);
  try {
    const result = await apiGet("https://example.test/x", "token");
    assert.deepEqual(result, { ok: true });
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("apiGet returns null on 404 without retrying", async () => {
  const stub = stubFetch([jsonResponse(404, {})]);
  try {
    const result = await apiGet("https://example.test/x", "token");
    assert.equal(result, null);
    assert.equal(stub.calls.length, 1, "a 404 must not be retried");
  } finally {
    stub.restore();
  }
});

test("apiGet returns null on a 403 SERVICE_DISABLED body — the service just isn't in use here", async () => {
  const stub = stubFetch([jsonResponse(403, { error: { message: "SERVICE_DISABLED: monitoring.googleapis.com" } })]);
  try {
    const result = await apiGet("https://example.test/x", "token");
    assert.equal(result, null);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("apiGet throws on a real 403 IAM denial without retrying, so it surfaces as 'not checked' rather than healthy", async () => {
  const stub = stubFetch([jsonResponse(403, { error: { message: "Permission denied" } })]);
  try {
    await assert.rejects(() => apiGet("https://example.test/x", "token"), /403 denied/);
    assert.equal(stub.calls.length, 1, "a real denial must not be retried — it will never succeed");
  } finally {
    stub.restore();
  }
});

test("apiGet retries a transient 503 and succeeds once the API recovers", async () => {
  const stub = stubFetch([jsonResponse(503, {}), jsonResponse(200, { recovered: true })]);
  try {
    const result = await apiGet("https://example.test/x", "token");
    assert.deepEqual(result, { recovered: true });
    assert.equal(stub.calls.length, 2, "should have retried exactly once before success");
  } finally {
    stub.restore();
  }
});

test("apiGet gives up and throws after exhausting retries on a persistent 503", async () => {
  const stub = stubFetch([jsonResponse(503, {}), jsonResponse(503, {}), jsonResponse(503, {})]);
  try {
    await assert.rejects(() => apiGet("https://example.test/x", "token"), /503/);
    assert.equal(stub.calls.length, 3, "should try MAX_ATTEMPTS times, not loop forever");
  } finally {
    stub.restore();
  }
});

test("apiGet retries a network-level failure (timeout/DNS/reset) the same as a 5xx", async () => {
  const stub = stubFetch([new Error("fetch failed: ECONNRESET"), jsonResponse(200, { ok: true })]);
  try {
    const result = await apiGet("https://example.test/x", "token");
    assert.deepEqual(result, { ok: true });
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});
