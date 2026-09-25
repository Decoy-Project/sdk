import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import type { Address } from "../domain/types";
import { integerBytes, rlpEncode, type RlpItem } from "./rlp";

export type Hex = `0x${string}`;

/** An EIP-1559 transaction, the only kind this SDK signs. */
export interface Eip1559Transaction {
  readonly chainId: number;
  readonly nonce: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly maxFeePerGas: bigint;
  readonly gasLimit: bigint;
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
}

export interface SignedTransaction {
  /** What `eth_sendRawTransaction` takes. */
  readonly raw: Hex;
  readonly hash: Hex;
}

/** EIP-2718 type byte of an EIP-1559 transaction. */
const EIP1559_TYPE = 0x02;
/** Bytes of r and s inside a recovered signature, after its leading recovery byte. */
const SCALAR_BYTES = 32;

function bytesOf(hex: Hex): Uint8Array {
  return hexToBytes(hex.slice(2));
}

function fields(tx: Eip1559Transaction): RlpItem[] {
  return [
    integerBytes(BigInt(tx.chainId)),
    integerBytes(tx.nonce),
    integerBytes(tx.maxPriorityFeePerGas),
    integerBytes(tx.maxFeePerGas),
    integerBytes(tx.gasLimit),
    bytesOf(tx.to),
    integerBytes(tx.value),
    bytesOf(tx.data),
    [],
  ];
}

function typed(payload: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(EIP1559_TYPE), payload);
}

function scalar(bytes: Uint8Array): Uint8Array {
  return integerBytes(BigInt(`0x${bytesToHex(bytes)}`));
}

/** Signs `tx` with `privateKey`: keccak-256 of the typed payload, a low-s signature, and its recovery bit as y-parity. */
export function signTransaction(tx: Eip1559Transaction, privateKey: Uint8Array): SignedTransaction {
  const digest = keccak_256(typed(rlpEncode(fields(tx))));
  const signature = secp256k1.sign(digest, privateKey, { prehash: false, format: "recovered" });
  const yParity = integerBytes(BigInt(signature[0]));
  const r = scalar(signature.slice(1, 1 + SCALAR_BYTES));
  const s = scalar(signature.slice(1 + SCALAR_BYTES));
  const signed = typed(rlpEncode([...fields(tx), yParity, r, s]));
  return { raw: `0x${bytesToHex(signed)}`, hash: `0x${bytesToHex(keccak_256(signed))}` };
}
