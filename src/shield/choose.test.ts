import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Address, ShieldedNote } from "../domain/types";
import { chooseNotes, largestPayment } from "./choose";

const ASSET: Address = "0xd33de4d258d964b19ac83f4c80d81a0689a9d757";
const OTHER: Address = "0x00000000000000000000000000000000000000a2";

function note(counter: number, amount: bigint, status: ShieldedNote["status"] = "settled", asset: Address = ASSET): ShieldedNote {
  return {
    epoch: 0,
    counter,
    asset,
    amount,
    commitment: "0x00",
    origin: "deposit",
    from: null,
    status,
    leafIndex: BigInt(counter),
    sentAfterBlock: 0n,
    at: new Date(0),
    exit: null,
  };
}

const NOTES = [note(0, 100n), note(1, 30n), note(2, 10n), note(3, 300n, "pending"), note(4, 1_000n, "settled", OTHER)];

describe("chooseNotes", () => {
  test("takes the one note that covers the payment with the least left over", () => {
    assert.deepEqual(chooseNotes(NOTES, ASSET, 25n)?.map((n) => n.counter), [1]);
    assert.deepEqual(chooseNotes(NOTES, ASSET, 31n)?.map((n) => n.counter), [0]);
  });

  test("takes a pair when no one note is enough", () => {
    assert.deepEqual(chooseNotes(NOTES, ASSET, 125n)?.map((n) => n.counter), [0, 1]);
  });

  test("spends only settled notes of the asset, and says when two are not enough", () => {
    assert.equal(chooseNotes(NOTES, ASSET, 131n), null);
    assert.equal(chooseNotes(NOTES, OTHER, 1_001n), null);
  });
});

describe("largestPayment", () => {
  test("is what the two largest settled notes of the asset hold", () => {
    assert.equal(largestPayment(NOTES, ASSET), 130n);
  });
});
