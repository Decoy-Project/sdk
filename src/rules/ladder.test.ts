import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ladderAmount, largestTerms } from "./ladder";

/** 0.001 ETH in wei: the ladder unit the network config gives WETH. */
const UNIT = 10n ** 15n;
const ETH = 10n ** 18n;

describe("largestTerms", () => {
  test("keeps every term under the term cap: each term is its own note", () => {
    assert.deepEqual(largestTerms((ETH * 3n) / 10n, UNIT, ETH / 10n), [100, 100, 100]);
  });

  test("takes the largest single step that fits", () => {
    assert.deepEqual(largestTerms(ETH / 10n, UNIT, ETH), [100]);
  });

  test("adds up to three steps to get closer", () => {
    assert.deepEqual(largestTerms((ETH * 14n) / 100n, UNIT, ETH), [100, 30, 10]);
  });

  test("prefers one step over a sum worth the same", () => {
    assert.deepEqual(largestTerms((ETH * 3n) / 100n, UNIT, ETH), [30]);
  });

  test("never passes what is available", () => {
    const available = (ETH * 137n) / 1000n + 5n;
    assert.ok(ladderAmount(largestTerms(available, UNIT, ETH), UNIT) <= available);
  });

  test("is empty when not even the smallest step fits", () => {
    assert.deepEqual(largestTerms(ETH / 100n - 1n, UNIT, ETH), []);
  });
});
