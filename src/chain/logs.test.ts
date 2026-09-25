import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LOG_POLICY, logRanges } from "./logs";

describe("logRanges", () => {
  test("cuts a span into ranges no wider than the policy allows, both ends included", () => {
    const ranges = logRanges(100n, 100n + LOG_POLICY.blockRange * 2n);
    assert.deepEqual(ranges, [
      { from: 100n, to: 100n + LOG_POLICY.blockRange - 1n },
      { from: 100n + LOG_POLICY.blockRange, to: 100n + LOG_POLICY.blockRange * 2n - 1n },
      { from: 100n + LOG_POLICY.blockRange * 2n, to: 100n + LOG_POLICY.blockRange * 2n },
    ]);
  });

  test("reads a single block as one range, and a span that starts later than it ends as none", () => {
    assert.deepEqual(logRanges(7n, 7n), [{ from: 7n, to: 7n }]);
    assert.deepEqual(logRanges(8n, 7n), []);
  });

  test("refuses a width that spans nothing", () => {
    assert.throws(() => logRanges(0n, 10n, 0n), /at least one block/);
  });
});
