import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { poolErrorIn } from "./poolErrors";

describe("poolErrorIn", () => {
  test("names the pool error whose selector a revert carries", () => {
    assert.equal(poolErrorIn("eth_estimateGas: execution reverted (3) [data 0xb115d857]"), "NullifierAlreadySpent");
    assert.equal(poolErrorIn("execution reverted: custom error 0xFD4851E9"), "PoolFrozen");
  });

  test("names nothing where no pool selector stands on its own", () => {
    assert.equal(poolErrorIn("execution reverted (3)"), null);
    assert.equal(poolErrorIn("[data 0xb115d85700]"), null);
  });
});
