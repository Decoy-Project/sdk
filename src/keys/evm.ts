import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";
import type { Address } from "../domain/types";

/**
 * BIP-44's external chain for Ethereum (coin type 60). Receive address `i` sits at `${RECEIVE_PATH}/${i}`, so any
 * Ethereum wallet that imports the recovery phrase shows the same addresses.
 */
export const RECEIVE_PATH = "m/44'/60'/0'/0";

/** An EVM account the app holds the key of. */
export interface EvmKey {
  readonly address: Address;
  readonly privateKey: Uint8Array;
}

export function addressOf(privateKey: Uint8Array): Address {
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return `0x${bytesToHex(keccak_256(publicKey.slice(1)).slice(12))}`;
}

/** The key of receive address `index`. */
export function receiveKey(seed: Uint8Array, index: number): EvmKey {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error(`A receive index is a whole number, got ${index}`);
  const node = HDKey.fromMasterSeed(seed).derive(`${RECEIVE_PATH}/${index}`);
  if (!node.privateKey) throw new Error(`BIP-32 gave no private key at ${RECEIVE_PATH}/${index}`);
  return { address: addressOf(node.privateKey), privateKey: node.privateKey };
}

const PRIVATE_KEY_HEX = /^(0x)?[0-9a-fA-F]{64}$/;

/** A wallet the user already has, from its private key. Anything that is not a valid secp256k1 key throws. */
export function keyFromPrivateKey(text: string): EvmKey {
  const trimmed = text.trim();
  if (!PRIVATE_KEY_HEX.test(trimmed)) throw new Error("A private key is 64 hexadecimal characters");
  const privateKey = hexToBytes(trimmed.replace(/^0x/, ""));
  if (!secp256k1.utils.isValidSecretKey(privateKey)) throw new Error("That is not a valid secp256k1 private key");
  return { address: addressOf(privateKey), privateKey };
}
