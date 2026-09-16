const test = require("node:test");
const assert = require("node:assert/strict");

const { dropRunShadows, windowFor, rollingWindow, isoSecond } = require("../lib/health/monitoring");

function entity(overrides) {
  return {
    name: "fn",
    kind: "function",
    calls: 0,
    callsBaseline: 0,
    callsHistory: [],
    errors: 0,
    errorsHistory: [],
    errorRate: 0,
    logErrors: 0,
    days: [],
    ...overrides,
  };
}

test("dropRunShadows removes a Cloud Run entity whose lowercased name matches a function entity (the gen-2 double-count)", () => {
  const entities = [
    entity({ name: "getStatistics", kind: "function", calls: 100 }),
    entity({ name: "getstatistics", kind: "run", calls: 100 }),
  ];
  const { entities: kept } = dropRunShadows(entities);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].kind, "function");
  assert.equal(kept[0].name, "getStatistics");
});

test("dropRunShadows keeps a Cloud Run service that has no matching function entity", () => {
  const entities = [
    entity({ name: "getStatistics", kind: "function", calls: 100 }),
    entity({ name: "standaloneApi", kind: "run", calls: 42 }),
  ];
  const { entities: kept, shadowedCalls } = dropRunShadows(entities);
  assert.equal(kept.length, 2);
  assert.ok(kept.some((e) => e.name === "standaloneApi" && e.kind === "run"));
  assert.equal(shadowedCalls, 0);
});

test("dropRunShadows reports the removed calls total in shadowedCalls, since without it a gen-2 project's numbers are roughly doubled", () => {
  const entities = [
    entity({ name: "getStatistics", kind: "function", calls: 100 }),
    entity({ name: "getstatistics", kind: "run", calls: 97 }),
    entity({ name: "sendEmail", kind: "function", calls: 30 }),
    entity({ name: "sendemail", kind: "run", calls: 30 }),
  ];
  const { entities: kept, shadowedCalls } = dropRunShadows(entities);
  assert.equal(kept.length, 2);
  assert.equal(shadowedCalls, 127);
});

test("windowFor returns a window ending at today's UTC midnight and starting days earlier", () => {
  const { start, end } = windowFor(14);

  const expectedEnd = new Date();
  expectedEnd.setUTCHours(0, 0, 0, 0);
  assert.equal(end.getTime(), expectedEnd.getTime());
  assert.equal(end.getUTCHours(), 0);
  assert.equal(end.getUTCMinutes(), 0);
  assert.equal(end.getUTCSeconds(), 0);
  assert.equal(end.getUTCMilliseconds(), 0);

  const expectedStart = new Date(expectedEnd.getTime() - 14 * 86400000);
  assert.equal(start.getTime(), expectedStart.getTime());
});

test("rollingWindow returns a window ending now and starting exactly 24 hours earlier", () => {
  const { start, end } = rollingWindow();
  const now = Date.now();
  // Allow a small margin for time elapsed between Date.now() above and the
  // function call inside rollingWindow().
  assert.ok(Math.abs(end.getTime() - now) < 1000, "end should be ~now");
  assert.equal(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
});

test("isoSecond emits second-precision ISO with a trailing Z and no milliseconds", () => {
  const date = new Date("2026-09-16T11:33:03.482Z");
  assert.equal(isoSecond(date), "2026-09-16T11:33:03Z");
  assert.doesNotMatch(isoSecond(date), /\.\d+Z$/);
});
