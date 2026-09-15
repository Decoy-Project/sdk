/**
 * MOCK DATA — view key strings for the memory backend. They are invented and carry no key material. A backend that
 * derives real view keys does not use this file.
 */

const VIEW_KEY_PREFIX = "decoy_view_";
const KEY_HEX_LENGTH = 64;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX_RADIX = 16;
const WORD_HEX_CHARS = 8;

function fnv1a(text: string): number {
  let hash = FNV_OFFSET;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/** Deterministic, obviously fake key string for a grant id. */
export function mockViewKey(id: string): string {
  let hex = "";
  for (let round = 0; hex.length < KEY_HEX_LENGTH; round += 1) {
    hex += fnv1a(`${id}:${round}`).toString(HEX_RADIX).padStart(WORD_HEX_CHARS, "0");
  }
  return `${VIEW_KEY_PREFIX}${hex.slice(0, KEY_HEX_LENGTH)}`;
}
