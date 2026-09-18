const test = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultTableId,
  buildQuery,
  buildLatestDayQuery,
  buildTotalQuery,
} = require("../lib/billing");

const TABLE = { datasetProject: "stanimeros-dev", datasetId: "billing_export", tableId: "t" };

// The estate has the *detailed* export enabled, whose table carries the
// `_resource_` infix. Pointing at the standard name instead is what left the
// Cost tab empty -- every query 404'd against a table that was never created.
test("defaultTableId targets the detailed (resource-level) export table", () => {
  assert.equal(defaultTableId(), "gcp_billing_export_resource_v1_01F891_9E8314_AAB92D");
});

test("every builder fully qualifies the table it reads", () => {
  for (const build of [buildQuery, buildLatestDayQuery, buildTotalQuery]) {
    assert.match(build(TABLE), /`stanimeros-dev\.billing_export\.t`/);
  }
});

// Dataset and table can't be bound as query parameters, so they're spliced
// into the SQL string. The whitelist is the only thing standing between a
// config typo and an injected query -- assert it on every builder, not just
// the one that happened to be tested first.
test("every builder rejects an identifier that isn't a bare name", () => {
  const attacks = [
    { ...TABLE, datasetId: "billing_export`; DROP TABLE x--" },
    { ...TABLE, tableId: "t WHERE 1=1 UNION SELECT" },
    { ...TABLE, datasetProject: "a.b" },
    { ...TABLE, tableId: "" },
    { ...TABLE, tableId: null },
  ];
  for (const build of [buildQuery, buildLatestDayQuery, buildTotalQuery]) {
    for (const bad of attacks) {
      assert.throws(() => build(bad), /^Error: invalid (datasetProject|datasetId|tableId):/);
    }
  }
});

// Credits are stored negative, so net cost is gross + credits. The windowed
// per-project query and the account-wide total must not drift apart on what
// "cost" means, or the Cost tab's total won't equal the sum of its rows.
test("the windowed query and the account total use the same net-cost expression", () => {
  const credits = "SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0))";
  assert.ok(buildQuery(TABLE).includes(credits));
  assert.ok(buildTotalQuery(TABLE).includes(credits));
});

// Filtering on usage_start_time is what prunes partitions; losing it turns a
// per-day scan into a full-table scan on a table billed per byte read.
test("windowed queries filter on the partition column", () => {
  for (const build of [buildQuery, buildTotalQuery]) {
    const sql = build(TABLE);
    assert.match(sql, /WHERE usage_start_time >= @windowStart/);
    assert.match(sql, /AND usage_start_time < @windowEnd/);
  }
});

test("the latest-day probe is unwindowed, so a dead export is distinguishable from a quiet one", () => {
  const sql = buildLatestDayQuery(TABLE);
  assert.match(sql, /MAX\(DATE\(usage_start_time\)\)/);
  assert.doesNotMatch(sql, /@windowStart|project\.id/);
});
