import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { generateStealthAddress, metaAddressOf, openAnnouncement, stealthKeys, type StealthKeys } from "./stealth";

function keysFrom(spendingHex: string, viewingHex: string): StealthKeys {
  const spendingKey = hexToBytes(spendingHex);
  const viewingKey = hexToBytes(viewingHex);
  return {
    spendingKey,
    viewingKey,
    spendingPublicKey: secp256k1.getPublicKey(spendingKey, true),
    viewingPublicKey: secp256k1.getPublicKey(viewingKey, true),
  };
}

/**
 * Computed on 24 Sep 2026 by `@scopelift/stealth-address-sdk` 1.0.0-beta.5, the ERC-5564 reference SDK, from spending
 * key 0x11…11, viewing key 0x22…22 and ephemeral key 0x33…33. A wallet built on it and this SDK must agree on all four.
 */
const REFERENCE = {
  meta: "st:eth:0x034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27",
  stealthAddress: "0xd8606ed2ecdb71fdcb8cca8fa1925ff84238f2a9",
  ephemeralPublicKey: "023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1",
  viewTag: 0x20,
  stealthKey: "32074def70f9689560d0eb1b86aa895b735ed5852c9ce187ff0dcd968e8a19d3",
} as const;

describe("ERC-5564 scheme 1", () => {
  const keys = keysFrom("11".repeat(32), "22".repeat(32));
  const ephemeral = hexToBytes("33".repeat(32));

  test("writes the meta-address the reference SDK writes", () => {
    assert.equal(metaAddressOf(keys), REFERENCE.meta);
  });

  test("a sender derives the reference one-time address, ephemeral key and view tag", () => {
    const payment = generateStealthAddress(REFERENCE.meta, ephemeral);
    assert.equal(payment.stealthAddress, REFERENCE.stealthAddress);
    assert.equal(bytesToHex(payment.ephemeralPublicKey), REFERENCE.ephemeralPublicKey);
    assert.equal(payment.viewTag, REFERENCE.viewTag);
  });

  test("the recipient opens it to the reference stealth key", () => {
    const opened = openAnnouncement(keys, generateStealthAddress(REFERENCE.meta, ephemeral));
    assert.ok(opened);
    assert.equal(bytesToHex(opened.privateKey), REFERENCE.stealthKey);
    assert.equal(opened.address, REFERENCE.stealthAddress);
  });

  test("another account does not open it", () => {
    const other = keysFrom("44".repeat(32), "55".repeat(32));
    assert.equal(openAnnouncement(other, generateStealthAddress(REFERENCE.meta, ephemeral)), null);
  });

  test("a payment announced under a wrong view tag is skipped", () => {
    const payment = generateStealthAddress(REFERENCE.meta, ephemeral);
    assert.equal(openAnnouncement(keys, { ...payment, viewTag: (payment.viewTag + 1) % 256 }), null);
  });

  test("an account's stealth keys come from its seed, the same every time and distinct from each other", () => {
    const seed = new Uint8Array(64).fill(9);
    const first = stealthKeys(seed);
    assert.deepEqual(first, stealthKeys(seed));
    assert.notEqual(bytesToHex(first.spendingKey), bytesToHex(first.viewingKey));
    assert.match(metaAddressOf(first), /^st:eth:0x0[23][0-9a-f]{64}0[23][0-9a-f]{64}$/);
  });
});
