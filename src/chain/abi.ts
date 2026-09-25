import type { Address } from "../domain/types";
import { ChainError } from "./errors";

/**
 * The only ABI encoding this SDK does. Each selector is the first four bytes of the keccak-256 hash of the signature in
 * its comment, fixed by ERC-20 and WETH9, and `abi.test.ts` recomputes every one. Nothing here is configurable, so
 * nothing here is duplicated elsewhere. The pool's own selectors are generated from its ABI.
 */
export const ERC20_SELECTOR = {
  /** allowance(address,address) */
  allowance: "0xdd62ed3e",
  /** approve(address,uint256) */
  approve: "0x095ea7b3",
  /** balanceOf(address) */
  balanceOf: "0x70a08231",
  /** decimals() */
  decimals: "0x313ce567",
  /** name() */
  name: "0x06fdde03",
  /** symbol() */
  symbol: "0x95d89b41",
} as const;

/** The wrapped native token's own call, on top of ERC-20. */
export const WRAPPED_NATIVE_SELECTOR = {
  /** deposit() */
  deposit: "0xd0e30db0",
} as const;

const WORD_HEX = 64;
const WORD_BITS = 256n;
const ADDRESS_HEX = 40;
const ADDRESS_BITS = 160n;

/** An address as one ABI word. */
export function addressWord(address: Address): string {
  return address.slice(2).toLowerCase().padStart(WORD_HEX, "0");
}

/** An unsigned integer as one ABI word. */
export function uintWord(value: bigint): string {
  if (value < 0n || value >= 2n ** WORD_BITS) throw new Error(`${value} does not fit a uint256`);
  return value.toString(16).padStart(WORD_HEX, "0");
}

/** An unsigned integer as a `bytes32`: a field element as the pool and the verifier take it. */
export function bytes32Of(value: bigint): `0x${string}` {
  return `0x${uintWord(value)}`;
}

/** An address held as an integer, as a memo or a field element holds a token contract. */
export function addressFromInteger(value: bigint): Address {
  if (value < 0n || value >= 2n ** ADDRESS_BITS) throw new Error(`${value} does not fit an address`);
  return `0x${value.toString(16).padStart(ADDRESS_HEX, "0")}`;
}

/** A `bytes32` as one ABI word. */
export function bytes32Word(value: `0x${string}`): string {
  const hex = value.slice(2).toLowerCase();
  if (hex.length !== WORD_HEX) throw new Error(`${value} is not 32 bytes`);
  return hex;
}

/** A call whose arguments are all static words. */
export function encodeCall(selector: string, words: readonly string[] = []): `0x${string}` {
  return `${selector as `0x${string}`}${words.join("")}`;
}

/** An argument of a call that has dynamic ones: a static word, a `bytes32[]`, or `bytes`. */
export type AbiArgument =
  | { readonly word: string }
  | { readonly words: readonly string[] }
  | { readonly bytes: `0x${string}` };

const WORD_BYTES = 32;

function tailOf(argument: AbiArgument): string {
  if ("words" in argument) return uintWord(BigInt(argument.words.length)) + argument.words.join("");
  if ("bytes" in argument) {
    const hex = argument.bytes.slice(2);
    if (hex.length % 2 !== 0) throw new Error("bytes must be whole bytes");
    const padded = hex.padEnd(Math.ceil(hex.length / WORD_HEX) * WORD_HEX, "0");
    return uintWord(BigInt(hex.length / 2)) + padded;
  }
  return "";
}

/**
 * A call with dynamic arguments, in the ABI's head-and-tail layout: each static word in place, each dynamic argument as
 * an offset in the head and its length and content in the tail.
 */
export function encodeDynamicCall(selector: string, args: readonly AbiArgument[]): `0x${string}` {
  const headBytes = args.length * WORD_BYTES;
  let tail = "";
  const head = args.map((argument) => {
    if ("word" in argument) return argument.word;
    const offset = uintWord(BigInt(headBytes + tail.length / 2));
    tail += tailOf(argument);
    return offset;
  });
  return `${selector as `0x${string}`}${head.join("")}${tail}`;
}

function body(data: string): string {
  if (!data.startsWith("0x")) throw new ChainError("badResponse", `Return data is not hex: ${data}`);
  return data.slice(2);
}

/** Encodes a call that takes one address. */
export function encodeAddressCall(selector: string, argument: Address): string {
  return encodeCall(selector, [addressWord(argument)]);
}

export function decodeUint(data: string): bigint {
  const hex = body(data);
  if (hex.length !== WORD_HEX) throw new ChainError("badResponse", `Expected one 32-byte word, got ${hex.length / 2} bytes`);
  return BigInt(`0x${hex}`);
}

/** Decodes a `uint8` return, such as `decimals()`. */
export function decodeUint8(data: string): number {
  const value = decodeUint(data);
  if (value > 255n) throw new ChainError("badResponse", `Expected a uint8, got ${value}`);
  return Number(value);
}

/**
 * Decodes an ABI-encoded dynamic string: a 32-byte offset of 32, a 32-byte length, then the bytes. A token that returns
 * a `bytes32` name instead fails loudly rather than being guessed at.
 */
export function decodeString(data: string): string {
  const hex = body(data);
  if (hex.length < WORD_HEX * 2) throw new ChainError("badResponse", `String return is ${hex.length / 2} bytes, too short`);
  const offset = BigInt(`0x${hex.slice(0, WORD_HEX)}`);
  if (offset !== 32n) throw new ChainError("badResponse", `String offset is ${offset}, expected 32`);
  const length = Number(BigInt(`0x${hex.slice(WORD_HEX, WORD_HEX * 2)}`));
  const bytes = hex.slice(WORD_HEX * 2, WORD_HEX * 2 + length * 2);
  if (bytes.length !== length * 2) throw new ChainError("badResponse", `String claims ${length} bytes, carries ${bytes.length / 2}`);
  const buffer = Uint8Array.from({ length }, (_, index) => Number.parseInt(bytes.slice(index * 2, index * 2 + 2), 16));
  return new TextDecoder().decode(buffer);
}
