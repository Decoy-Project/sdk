import { LABEL } from "@decoy/protocol";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { Address } from "../domain/types";
import { addressOf, type EvmKey } from "./evm";

/**
 * ERC-5564 stealth addresses, scheme 1: secp256k1 with view tags. The arithmetic follows the reference SDK
 * (`@scopelift/stealth-address-sdk`): the shared secret is the compressed ECDH point, hashed with keccak-256; its first
 * byte is the view tag; the stealth public key is the spending key plus the hash times G.
 */

/** ERC-5564's scheme 1. */
export const STEALTH_SCHEME_ID = 1n;

/** The URI form ERC-5564 gives a meta-address: `st:<chain>:0x<spending key><viewing key>`. */
const META_ADDRESS_PREFIX = "st:eth:0x";
const COMPRESSED_KEY_HEX = 66;
/** Bytes drawn per scalar: 128 bits more than the curve order needs, so reducing them leaves no measurable bias. */
const DRAW_BYTES = 48;
const SCALAR_BYTES = 32;
const ORDER = secp256k1.Point.Fn.ORDER;

/** The account's two stealth keys. The viewing key finds payments; only the spending key can move them. */
export interface StealthKeys {
  readonly spendingKey: Uint8Array;
  readonly viewingKey: Uint8Array;
  readonly spendingPublicKey: Uint8Array;
  readonly viewingPublicKey: Uint8Array;
}

/** What a sender publishes with a stealth payment, so the recipient can find it. */
export interface StealthAnnouncement {
  readonly stealthAddress: Address;
  /** Compressed secp256k1 point, 33 bytes. */
  readonly ephemeralPublicKey: Uint8Array;
  readonly viewTag: number;
}

function toBigInt(bytes: Uint8Array): bigint {
  return bytes.length === 0 ? 0n : BigInt(`0x${bytesToHex(bytes)}`);
}

function scalarBytes(value: bigint): Uint8Array {
  return hexToBytes(value.toString(16).padStart(SCALAR_BYTES * 2, "0"));
}

/** A secret scalar in [1, n): HKDF output reduced into the range, so no draw can give the invalid key zero. */
function derive(seed: Uint8Array, label: string): Uint8Array {
  const drawn = toBigInt(hkdf(sha256, seed, undefined, new TextEncoder().encode(label), DRAW_BYTES));
  return scalarBytes((drawn % (ORDER - 1n)) + 1n);
}

export function stealthKeys(seed: Uint8Array): StealthKeys {
  const spendingKey = derive(seed, LABEL.stealthSpendingKey);
  const viewingKey = derive(seed, LABEL.stealthViewingKey);
  return {
    spendingKey,
    viewingKey,
    spendingPublicKey: secp256k1.getPublicKey(spendingKey, true),
    viewingPublicKey: secp256k1.getPublicKey(viewingKey, true),
  };
}

/** The meta-address to share: senders turn it into a new one-time address for every payment. */
export function metaAddressOf(keys: StealthKeys): string {
  return `${META_ADDRESS_PREFIX}${bytesToHex(keys.spendingPublicKey)}${bytesToHex(keys.viewingPublicKey)}`;
}

/** The hashed shared secret as a scalar, or null in the negligible case that it is not a valid one. */
function hashedSecret(sharedPoint: Uint8Array): { scalar: bigint; viewTag: number } | null {
  const hash = keccak_256(sharedPoint);
  const scalar = toBigInt(hash);
  if (scalar === 0n || scalar >= ORDER) return null;
  return { scalar, viewTag: hash[0] };
}

function stealthAddressFor(spendingPublicKey: Uint8Array, scalar: bigint): Address {
  const point = secp256k1.Point.fromBytes(spendingPublicKey).add(secp256k1.Point.BASE.multiply(scalar));
  return `0x${bytesToHex(keccak_256(point.toBytes(false).slice(1)).slice(12))}`;
}

/** Sender side: the one-time address to pay for `metaAddress`, from an ephemeral key the sender draws fresh. */
export function generateStealthAddress(metaAddress: string, ephemeralPrivateKey: Uint8Array): StealthAnnouncement {
  if (!metaAddress.startsWith(META_ADDRESS_PREFIX) || metaAddress.length !== META_ADDRESS_PREFIX.length + 2 * COMPRESSED_KEY_HEX) {
    throw new Error(`Not a scheme 1 stealth meta-address: ${metaAddress}`);
  }
  const body = metaAddress.slice(META_ADDRESS_PREFIX.length);
  const spendingPublicKey = hexToBytes(body.slice(0, COMPRESSED_KEY_HEX));
  const viewingPublicKey = hexToBytes(body.slice(COMPRESSED_KEY_HEX));
  const secret = hashedSecret(secp256k1.getSharedSecret(ephemeralPrivateKey, viewingPublicKey, true));
  if (!secret) throw new Error("This ephemeral key gives an invalid shared secret; draw another");
  return {
    stealthAddress: stealthAddressFor(spendingPublicKey, secret.scalar),
    ephemeralPublicKey: secp256k1.getPublicKey(ephemeralPrivateKey, true),
    viewTag: secret.viewTag,
  };
}

/**
 * Recipient side: the key of the one-time address an announcement names, when the payment is this account's, and null
 * when it is not. The view tag rules out 255 of every 256 other payments before any curve addition.
 */
export function openAnnouncement(keys: StealthKeys, announcement: StealthAnnouncement): EvmKey | null {
  const secret = hashedSecret(secp256k1.getSharedSecret(keys.viewingKey, announcement.ephemeralPublicKey, true));
  if (!secret || secret.viewTag !== announcement.viewTag) return null;
  if (stealthAddressFor(keys.spendingPublicKey, secret.scalar) !== announcement.stealthAddress.toLowerCase()) return null;
  const privateKey = scalarBytes((toBigInt(keys.spendingKey) + secret.scalar) % ORDER);
  return { address: addressOf(privateKey), privateKey };
}
