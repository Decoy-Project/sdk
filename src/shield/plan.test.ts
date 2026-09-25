import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DepositRoom } from "../chain/pool";
import type { AmountMode } from "../domain/types";
import { MAX_LADDER_TERMS } from "../protocol/parameters";
import { gasReserve, planShield, type ShieldPlan } from "./plan";

const UNIT = 10n ** 15n;
const ETH = 10n ** 18n;
const RESERVE = ETH / 1000n;
const NO_LIMIT: DepositRoom = { note: 100n * ETH, total: 100n * ETH };

function plan(mode: AmountMode, native: bigint, wrapped: bigint, room: DepositRoom = NO_LIMIT): ShieldPlan | null {
  return planShield({ mode, native, wrapped, reserve: RESERVE, ladderUnit: UNIT, room });
}

describe("planShield in any mode", () => {
  test("keeps the gas reserve back and shields all of the rest as one note", () => {
    const amount = (ETH * 5n) / 100n - RESERVE;
    assert.deepEqual(plan("any", (ETH * 5n) / 100n, 0n), { amounts: [amount], amount });
  });

  test("shields an amount no ladder step fits", () => {
    assert.equal(plan("any", ETH / 100n, 0n)?.amount, ETH / 100n - RESERVE);
  });

  test("counts what is already wrapped", () => {
    assert.equal(plan("any", 0n, ETH / 10n)?.amount, ETH / 10n);
  });

  test("splits only where a note would pass the note cap", () => {
    const room = { note: ETH / 10n, total: ETH };
    assert.deepEqual(plan("any", 0n, (ETH * 25n) / 100n, room)?.amounts, [ETH / 10n, ETH / 10n, ETH / 20n]);
  });

  test("makes no more notes than one shield may, and leaves the rest for the next check", () => {
    const room = { note: ETH / 10n, total: ETH };
    assert.equal(plan("any", 10n * ETH, 0n, room)?.amounts.length, MAX_LADDER_TERMS);
  });

  test("never plans more than the supply cap leaves", () => {
    const room = { note: (ETH * 45n) / 1000n, total: (ETH * 45n) / 1000n };
    assert.deepEqual(plan("any", 10n * ETH, 0n, room)?.amounts, [(ETH * 45n) / 1000n]);
  });

  test("plans nothing when nothing is above the reserve", () => {
    assert.equal(plan("any", RESERVE, 0n), null);
  });

  test("plans nothing when the pool is full", () => {
    assert.equal(plan("any", 10n * ETH, 0n, { note: 0n, total: 0n }), null);
  });
});

describe("planShield in ladder mode", () => {
  test("keeps the gas reserve back and shields the largest ladder amount of the rest", () => {
    assert.deepEqual(plan("ladder", (ETH * 5n) / 100n, 0n), { amounts: [30n * UNIT, 10n * UNIT], amount: (ETH * 4n) / 100n });
  });

  test("counts what is already wrapped", () => {
    assert.equal(plan("ladder", 0n, ETH / 10n)?.amount, ETH / 10n);
  });

  test("never plans more than the pool has room for", () => {
    const room = { note: (ETH * 45n) / 1000n, total: (ETH * 45n) / 1000n };
    assert.deepEqual(plan("ladder", 10n * ETH, 0n, room)?.amounts, [30n * UNIT, 10n * UNIT]);
  });

  test("fills the room exactly when the ladder can", () => {
    const room = { note: (ETH * 5n) / 100n, total: (ETH * 5n) / 100n };
    assert.deepEqual(plan("ladder", 10n * ETH, 0n, room)?.amounts, [30n * UNIT, 10n * UNIT, 10n * UNIT]);
  });

  test("keeps each note under the note cap while the total uses the room the supply cap leaves", () => {
    assert.deepEqual(plan("ladder", 10n * ETH, 0n, { note: ETH / 10n, total: ETH })?.amounts, [ETH / 10n, ETH / 10n, ETH / 10n]);
  });

  test("plans nothing when the pool is full", () => {
    assert.equal(plan("ladder", 10n * ETH, 0n, { note: 0n, total: 0n }), null);
  });

  test("plans nothing when not even the smallest step fits above the reserve", () => {
    assert.equal(plan("ladder", ETH / 100n, 0n), null);
  });
});

describe("gasReserve", () => {
  test("is one wrap, one approve and a deposit per note a shield may make, at the quoted fee cap", () => {
    const reserve = gasReserve({ wrap: 1n, approve: 2n, deposit: 3n }, { maxFeePerGas: 10n, maxPriorityFeePerGas: 0n });
    assert.equal(reserve, (1n + 2n + BigInt(MAX_LADDER_TERMS) * 3n) * 10n);
  });
});
