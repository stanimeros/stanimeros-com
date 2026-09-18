const test = require("node:test");
const assert = require("node:assert/strict");

const { makeLimiter, allow, WINDOW_MS } = require("../lib/rateLimit");

test("allows up to the per-minute cap, then blocks", () => {
  const state = makeLimiter();
  const now = Date.now();
  for (let i = 0; i < 3; i++) {
    assert.equal(allow(state, "proj", 3, now), true);
  }
  assert.equal(allow(state, "proj", 3, now), false);
});

test("a useEffect-style tight loop stays blocked for the rest of the window", () => {
  const state = makeLimiter();
  const now = Date.now();
  for (let i = 0; i < 3; i++) allow(state, "proj", 3, now);
  for (let i = 0; i < 50; i++) {
    assert.equal(allow(state, "proj", 3, now + i), false);
  }
});

test("resets once the window elapses", () => {
  const state = makeLimiter();
  const now = Date.now();
  for (let i = 0; i < 3; i++) allow(state, "proj", 3, now);
  assert.equal(allow(state, "proj", 3, now + WINDOW_MS - 1), false);
  assert.equal(allow(state, "proj", 3, now + WINDOW_MS), true);
});

test("projects are throttled independently", () => {
  const state = makeLimiter();
  const now = Date.now();
  for (let i = 0; i < 3; i++) allow(state, "a", 3, now);
  assert.equal(allow(state, "a", 3, now), false);
  assert.equal(allow(state, "b", 3, now), true);
});
