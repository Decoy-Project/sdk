import type { Address } from "../domain/types";
import type { EvmKey } from "../keys/evm";
import { ChainError } from "./errors";
import type { ChainReader } from "./reader";
import { signTransaction, type Hex } from "./transaction";
import { TRANSACTION_POLICY } from "./transactionPolicy";

export interface CallRequest {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
}

export interface TransactionLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface Receipt {
  readonly hash: Hex;
  readonly block: bigint;
  readonly gasUsed: bigint;
  readonly logs: readonly TransactionLog[];
}

export interface FeeQuote {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

/** Sends transactions from one key the app holds. */
export interface Signer {
  readonly address: Address;
  /** What a transaction sent now bids per gas. */
  fees: () => Promise<FeeQuote>;
  /** Signs `request`, sends it and waits until it is mined. A revert, or a wait past the policy, throws. */
  send: (request: CallRequest) => Promise<Receipt>;
}

interface MinedReceipt extends Receipt {
  readonly succeeded: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && value.startsWith("0x");
}

function quantity(method: string): (result: unknown) => bigint {
  return (result) => {
    if (!isHex(result)) throw new ChainError("badResponse", `${method} did not return a quantity`);
    return BigInt(result);
  };
}

function hexQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

function decodeBaseFee(result: unknown): bigint {
  if (!isObject(result) || !isHex(result.baseFeePerGas)) {
    throw new ChainError("badResponse", "eth_getBlockByNumber returned no base fee: the chain is not on EIP-1559");
  }
  return BigInt(result.baseFeePerGas);
}

function decodeHash(result: unknown): Hex {
  if (!isHex(result)) throw new ChainError("badResponse", "eth_sendRawTransaction did not return a hash");
  return result;
}

function decodeLog(value: unknown): TransactionLog {
  if (!isObject(value) || !isHex(value.address) || !isHex(value.data) || !Array.isArray(value.topics)) {
    throw new ChainError("badResponse", "A receipt holds a log this client cannot read");
  }
  const topics = value.topics.map((topic) => {
    if (!isHex(topic)) throw new ChainError("badResponse", "A receipt log holds a topic that is not hex");
    return topic;
  });
  return { address: value.address, topics, data: value.data };
}

/** Null while the transaction is not mined. A revert is a receipt too: what it means is the caller's to decide. */
function decodeReceipt(result: unknown): MinedReceipt | null {
  if (result === null) return null;
  if (!isObject(result) || !isHex(result.transactionHash) || !isHex(result.blockNumber) || !isHex(result.gasUsed)) {
    throw new ChainError("badResponse", "eth_getTransactionReceipt returned a receipt this client cannot read");
  }
  if (!isHex(result.status) || !Array.isArray(result.logs)) {
    throw new ChainError("badResponse", "eth_getTransactionReceipt returned a receipt without status or logs");
  }
  return {
    hash: result.transactionHash,
    block: BigInt(result.blockNumber),
    gasUsed: BigInt(result.gasUsed),
    logs: result.logs.map(decodeLog),
    succeeded: BigInt(result.status) === 1n,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What a transaction sent now bids per gas: the tip the chain asks for, over twice the current base fee. */
export async function quoteFees(reader: ChainReader): Promise<FeeQuote> {
  const [baseFee, tip] = await Promise.all([
    reader.rpc.call({ method: "eth_getBlockByNumber", params: ["latest", false] }, decodeBaseFee),
    reader.rpc.call({ method: "eth_maxPriorityFeePerGas", params: [] }, quantity("eth_maxPriorityFeePerGas")),
  ]);
  return { maxPriorityFeePerGas: tip, maxFeePerGas: baseFee * TRANSACTION_POLICY.baseFeeMultiplier + tip };
}

export function createSigner(reader: ChainReader, key: EvmKey): Signer {
  const { rpc } = reader;
  const chainId = reader.network().chainId;
  const fees = () => quoteFees(reader);

  async function gasLimit(request: CallRequest): Promise<bigint> {
    const call = { from: key.address, to: request.to, data: request.data, value: hexQuantity(request.value) };
    const estimate = await rpc.call({ method: "eth_estimateGas", params: [call] }, quantity("eth_estimateGas"));
    return (estimate * (100n + TRANSACTION_POLICY.gasMarginPercent)) / 100n;
  }

  async function mined(hash: Hex): Promise<Receipt> {
    const deadline = Date.now() + TRANSACTION_POLICY.receiptTimeoutMs;
    for (;;) {
      const receipt = await rpc.call({ method: "eth_getTransactionReceipt", params: [hash] }, decodeReceipt);
      if (receipt !== null) {
        if (!receipt.succeeded) throw new ChainError("transactionReverted", `${hash} reverted in block ${receipt.block}`);
        return receipt;
      }
      if (Date.now() > deadline) {
        throw new ChainError("transactionNotMined", `${hash} was not mined within ${TRANSACTION_POLICY.receiptTimeoutMs} ms`);
      }
      await sleep(TRANSACTION_POLICY.receiptPollMs);
    }
  }

  async function send(request: CallRequest): Promise<Receipt> {
    const [nonce, limit, quote] = await Promise.all([
      rpc.call({ method: "eth_getTransactionCount", params: [key.address, "pending"] }, quantity("eth_getTransactionCount")),
      gasLimit(request),
      fees(),
    ]);
    const signed = signTransaction(
      { chainId, nonce, gasLimit: limit, ...quote, to: request.to, value: request.value, data: request.data },
      key.privateKey,
    );
    const answered = await rpc.call({ method: "eth_sendRawTransaction", params: [signed.raw] }, decodeHash);
    if (answered.toLowerCase() !== signed.hash) {
      throw new ChainError("transactionHashMismatch", `Signed ${signed.hash}, the endpoint answered ${answered}`);
    }
    return mined(signed.hash);
  }

  return { address: key.address, fees, send };
}
