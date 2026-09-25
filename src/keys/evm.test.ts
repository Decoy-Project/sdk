import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addressOf, keyFromPrivateKey, receiveKey } from "./evm";
import { seedFromPhrase } from "./seed";

/** The phrase Foundry and Hardhat ship with. Its first two addresses are known to every Ethereum tool. */
const TOOLING_PHRASE = "test test test test test test test test test test test junk".split(" ");

describe("receiveKey", () => {
  const seed = seedFromPhrase(TOOLING_PHRASE);

  test("derives the addresses every Ethereum wallet derives from the same phrase", () => {
    assert.equal(receiveKey(seed, 0).address, "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    assert.equal(receiveKey(seed, 1).address, "0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  });

  test("the key it returns signs for the address it returns", () => {
    const key = receiveKey(seed, 2);
    assert.equal(addressOf(key.privateKey), key.address);
  });

  test("refuses an index that is not a whole number", () => {
    assert.throws(() => receiveKey(seed, -1));
    assert.throws(() => receiveKey(seed, 0.5));
  });
});

describe("keyFromPrivateKey", () => {
  test("opens a known key to its address, with or without 0x", () => {
    const hex = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    assert.equal(keyFromPrivateKey(`0x${hex}`).address, "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    assert.equal(keyFromPrivateKey(hex).address, "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
  });

  test("refuses what is not a key", () => {
    assert.throws(() => keyFromPrivateKey("0x1234"));
    assert.throws(() => keyFromPrivateKey("00".repeat(32)));
  });
});
