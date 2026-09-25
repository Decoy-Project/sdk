/**
 * What a client and a relayer say to each other: JSON over HTTP POST, integers as decimal strings. A relayer sends a
 * transaction for a fee taken out of the notes it spends, so the recipient needs no gas and no wallet of the user pays
 * any.
 *
 *   POST <relayer>/quote     QuoteRequest     → RelayQuote
 *   POST <relayer>/withdraw  RelayRequest     → RelayResult
 *
 * A refusal is an HTTP error status with `{ "error": "<why>" }`. Both sides parse with the functions below, so neither
 * reads a message the other did not mean to send.
 */
import type { Hex } from "../chain/transaction";
import type { Address } from "../domain/types";
import type { PoolTransaction } from "../shield/transaction";
import { MEMO_BYTES, TRANSACT_INPUTS, TRANSACT_OUTPUTS } from "@decoy/protocol";

export const RELAY_PATH = { quote: "/quote", withdraw: "/withdraw" } as const;

/** Which pool and asset a quote is for. A relayer serves one pool on one chain, and says no to anything else. */
export interface QuoteRequest {
  readonly chainId: number;
  readonly pool: Address;
  readonly asset: Address;
}

/** What a relayer charges now to send one withdrawal of `asset`. The fee is in the asset's base units. */
export interface RelayQuote {
  readonly relayer: Address;
  readonly asset: Address;
  readonly fee: bigint;
}

/** One transaction, as the pool's `transact` takes it. The proof binds every field, `chainId` and `pool` included. */
export interface RelayRequest {
  readonly chainId: number;
  readonly pool: Address;
  readonly proof: Hex;
  readonly transaction: PoolTransaction;
  /** The new notes' sealed memos, end to end. */
  readonly memos: Hex;
}

/** The mined transaction. */
export interface RelayResult {
  readonly transaction: Hex;
  readonly block: bigint;
}

/** Bytes a proof may take on the wire: well over the 8,000 a transact proof is (MEASURED 24 Sep 2026). */
const MAX_PROOF_BYTES = 16_384;

type Json = Record<string, unknown>;

function object(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${what} is not a JSON object`);
  return value as Json;
}

function address(value: unknown, name: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} is not an address`);
  return value.toLowerCase() as Address;
}

function bytes32(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} is not 32 bytes of hex`);
  return value.toLowerCase() as Hex;
}

function bytes(value: unknown, name: string, maxBytes: number): Hex {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(value)) throw new Error(`${name} is not hex bytes`);
  if ((value.length - 2) / 2 > maxBytes) throw new Error(`${name} is longer than ${maxBytes} bytes`);
  return value.toLowerCase() as Hex;
}

function integer(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,77})$/.test(value)) throw new Error(`${name} is not a decimal integer`);
  return BigInt(value);
}

function chainId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("chainId is not a chain id");
  return value;
}

/** Reads a body. `JSON.parse` throws SyntaxError on text that is not JSON; that is a malformed message. */
function parsed(text: string, what: string): Json {
  try {
    return object(JSON.parse(text), what);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${what} is not JSON`, { cause: error });
    throw error;
  }
}

export function encodeQuoteRequest(request: QuoteRequest): string {
  return JSON.stringify(request);
}

export function parseQuoteRequest(text: string): QuoteRequest {
  const body = parsed(text, "The quote request");
  return { chainId: chainId(body.chainId), pool: address(body.pool, "pool"), asset: address(body.asset, "asset") };
}

export function encodeQuote(quote: RelayQuote): string {
  return JSON.stringify({ relayer: quote.relayer, asset: quote.asset, fee: quote.fee.toString() });
}

export function parseQuote(text: string): RelayQuote {
  const body = parsed(text, "The relayer's quote");
  return { relayer: address(body.relayer, "relayer"), asset: address(body.asset, "asset"), fee: integer(body.fee, "fee") };
}

export function encodeRelayRequest(request: RelayRequest): string {
  const { transaction } = request;
  return JSON.stringify({
    ...request,
    transaction: { ...transaction, exitAmount: transaction.exitAmount.toString(), fee: transaction.fee.toString() },
  });
}

function words(value: unknown, name: string, count: number): Hex[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error(`${name} is not a list of ${count}`);
  return value.map((entry, index) => bytes32(entry, `${name}[${index}]`));
}

function transactionOf(value: unknown): PoolTransaction {
  const body = object(value, "The transaction");
  return {
    root: bytes32(body.root, "root"),
    nullifiers: words(body.nullifiers, "nullifiers", TRANSACT_INPUTS),
    commitments: words(body.commitments, "commitments", TRANSACT_OUTPUTS),
    exitAsset: address(body.exitAsset, "exitAsset"),
    exitAmount: integer(body.exitAmount, "exitAmount"),
    recipient: address(body.recipient, "recipient"),
    fee: integer(body.fee, "fee"),
  };
}

export function parseRelayRequest(text: string): RelayRequest {
  const body = parsed(text, "The transaction request");
  const memos = bytes(body.memos, "memos", MEMO_BYTES * TRANSACT_OUTPUTS);
  if ((memos.length - 2) / 2 !== MEMO_BYTES * TRANSACT_OUTPUTS) throw new Error(`memos is not ${TRANSACT_OUTPUTS} memos`);
  return {
    chainId: chainId(body.chainId),
    pool: address(body.pool, "pool"),
    proof: bytes(body.proof, "proof", MAX_PROOF_BYTES),
    transaction: transactionOf(body.transaction),
    memos,
  };
}

export function encodeRelayResult(result: RelayResult): string {
  return JSON.stringify({ transaction: result.transaction, block: result.block.toString() });
}

export function parseRelayResult(text: string): RelayResult {
  const body = parsed(text, "The relayer's answer");
  return { transaction: bytes32(body.transaction, "transaction"), block: integer(body.block, "block") };
}

export function encodeRefusal(reason: string): string {
  return JSON.stringify({ error: reason });
}

/**
 * Why a relayer said no, from the body of an error status. `JSON.parse` throws SyntaxError on a body that is not JSON;
 * that body, like one without a reason in it, is reported as giving none.
 */
export function refusalOf(status: number, text: string): string {
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const reason = typeof body === "object" && body !== null ? (body as Json).error : undefined;
  return typeof reason === "string" && reason !== "" ? reason : `HTTP ${status} with no reason given`;
}
