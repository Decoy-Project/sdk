import type { Address } from "../domain/types";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(text: string): text is Address {
  return ADDRESS_PATTERN.test(text.trim());
}

/** Addresses compare without case: checksum capitals do not make a different address. */
export function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
