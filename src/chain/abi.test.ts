import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Address } from "../domain/types";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  addressWord,
  bytes32Word,
  decodeString,
  decodeUint,
  decodeUint8,
  encodeAddressCall,
  encodeCall,
  encodeDynamicCall,
  ERC20_SELECTOR,
  uintWord,
  WRAPPED_NATIVE_SELECTOR,
} from "./abi";
import { ChainError } from "./errors";

const OWNER: Address = `0x${"a1".repeat(20)}`;

/** Return data taken from `symbol()` on USDG, MEASURED 20 Sep 2026. */
const USDG_SYMBOL_RETURN =
  "0x0000000000000000000000000000000000000000000000000000000000000020" +
  "0000000000000000000000000000000000000000000000000000000000000004" +
  "5553444700000000000000000000000000000000000000000000000000000000";

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

describe("chain ABI", () => {
  test("encodes a one-address call as the selector and a padded word", () => {
    const data = encodeAddressCall(ERC20_SELECTOR.balanceOf, OWNER);
    assert.equal(data, `${ERC20_SELECTOR.balanceOf}${"0".repeat(24)}${"a1".repeat(20)}`);
    assert.equal(data.length, 2 + 8 + 64);
  });

  test("lowercases a checksummed argument", () => {
    const data = encodeAddressCall(ERC20_SELECTOR.balanceOf, `0x${"A1".repeat(20)}`);
    assert.equal(data.endsWith("a1".repeat(20)), true);
  });

  test("decodes a uint256 and a uint8", () => {
    assert.equal(decodeUint(word(1_234_567n)), 1_234_567n);
    assert.equal(decodeUint8(word(6n)), 6);
  });

  test("decodes a dynamic string from real return data", () => {
    assert.equal(decodeString(USDG_SYMBOL_RETURN), "USDG");
  });

  test("throws on return data it cannot read instead of guessing", () => {
    const cases: readonly [string, () => unknown][] = [
      ["empty balance", () => decodeUint("0x")],
      ["short word", () => decodeUint("0x01")],
      ["uint8 out of range", () => decodeUint8(word(256n))],
      ["not hex", () => decodeString("nonsense")],
      ["bytes32 name", () => decodeString(word(1n))],
    ];
    for (const [label, run] of cases) {
      assert.throws(run, (error: unknown) => error instanceof ChainError && error.code === "badResponse", label);
    }
  });
});

describe("selectors", () => {
  const SIGNATURES: Readonly<Record<string, string>> = {
    "allowance(address,address)": ERC20_SELECTOR.allowance,
    "approve(address,uint256)": ERC20_SELECTOR.approve,
    "balanceOf(address)": ERC20_SELECTOR.balanceOf,
    "decimals()": ERC20_SELECTOR.decimals,
    "name()": ERC20_SELECTOR.name,
    "symbol()": ERC20_SELECTOR.symbol,
    "deposit()": WRAPPED_NATIVE_SELECTOR.deposit,
  };

  for (const [signature, selector] of Object.entries(SIGNATURES)) {
    test(`${signature} is ${selector}`, () => {
      assert.equal(`0x${bytesToHex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4))}`, selector);
    });
  }
});

describe("call encoding", () => {
  test("lays static words after the selector", () => {
    const data = encodeCall(ERC20_SELECTOR.approve, [addressWord(OWNER), uintWord(10n ** 16n)]);
    assert.equal(data, `0x095ea7b3${"0".repeat(24)}${"a1".repeat(20)}${"2386f26fc10000".padStart(64, "0")}`);
  });

  test("refuses a word that does not fit", () => {
    assert.throws(() => uintWord(-1n));
    assert.throws(() => uintWord(2n ** 256n));
    assert.throws(() => bytes32Word("0x1234"));
  });
});

describe("dynamic call encoding", () => {
  test("matches cast calldata for absorb(bytes32[],bytes32,bytes)", () => {
    const word = (value: bigint) => value.toString(16).padStart(64, "0");
    const data = encodeDynamicCall("0x02fed7f5", [{ words: [word(1n), word(2n)] }, { word: word(0xaan) }, { bytes: "0x0102030405" }]);
    /* `cast calldata "absorb(bytes32[],bytes32,bytes)" "[0x…01,0x…02]" 0x…aa 0x0102030405`, Foundry 1.x, 24 Sep 2026. */
    assert.equal(
      data,
      "0x02fed7f5" +
        "0000000000000000000000000000000000000000000000000000000000000060" +
        "00000000000000000000000000000000000000000000000000000000000000aa" +
        "00000000000000000000000000000000000000000000000000000000000000c0" +
        "0000000000000000000000000000000000000000000000000000000000000002" +
        "0000000000000000000000000000000000000000000000000000000000000001" +
        "0000000000000000000000000000000000000000000000000000000000000002" +
        "0000000000000000000000000000000000000000000000000000000000000005" +
        "0102030405000000000000000000000000000000000000000000000000000000",
    );
  });
});
