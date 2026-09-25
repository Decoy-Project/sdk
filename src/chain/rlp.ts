import { concatBytes, hexToBytes } from "@noble/hashes/utils.js";

/** An RLP item: a byte string, or a list of items. */
export type RlpItem = Uint8Array | readonly RlpItem[];

const STRING_OFFSET = 0x80;
const LIST_OFFSET = 0xc0;
/** Payloads shorter than this carry their length in the prefix byte itself. */
const SHORT_LIMIT = 56;
const SINGLE_BYTE_LIMIT = 0x80;

/** Minimal big-endian bytes of a non-negative integer. Zero is the empty string, as RLP requires. */
export function integerBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new Error(`RLP encodes non-negative integers only, got ${value}`);
  if (value === 0n) return new Uint8Array(0);
  const hex = value.toString(16);
  return hexToBytes(hex.length % 2 === 0 ? hex : `0${hex}`);
}

function prefix(length: number, offset: number): Uint8Array {
  if (length < SHORT_LIMIT) return Uint8Array.of(offset + length);
  const lengthBytes = integerBytes(BigInt(length));
  return concatBytes(Uint8Array.of(offset + SHORT_LIMIT - 1 + lengthBytes.length), lengthBytes);
}

export function rlpEncode(item: RlpItem): Uint8Array {
  if (item instanceof Uint8Array) {
    if (item.length === 1 && item[0] < SINGLE_BYTE_LIMIT) return item;
    return concatBytes(prefix(item.length, STRING_OFFSET), item);
  }
  const payload = concatBytes(...item.map(rlpEncode));
  return concatBytes(prefix(payload.length, LIST_OFFSET), payload);
}
