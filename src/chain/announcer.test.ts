import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ANNOUNCEMENT_TOPIC } from "./announcer";

describe("ERC-5564 Announcer", () => {
  test("the announcement topic is the hash of the event signature", () => {
    const signature = "Announcement(uint256,address,address,bytes,bytes)";
    assert.equal(`0x${bytesToHex(keccak_256(new TextEncoder().encode(signature)))}`, ANNOUNCEMENT_TOPIC);
  });
});
