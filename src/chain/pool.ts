import { TRANSACT_INPUTS } from "@decoy/protocol";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { Address } from "../domain/types";
import { POOL_EVENT_TOPIC, POOL_SELECTOR } from "../network/generated/deployments";
import type { NetworkConfig } from "../network/types";
import { decodeUint, encodeAddressCall } from "./abi";
import { ChainError } from "./errors";
import { readLogs } from "./logs";
import type { ChainReader } from "./reader";
import type { RpcRequest } from "./rpc";

/** What the pool says about itself. All of it is public: a shielded balance is private, the pool's totals are not. */
export interface PoolState {
  /** Commitments queued, by deposits and transactions, whether or not the tree has absorbed them. */
  readonly queueLength: bigint;
  /** Commitments the tree has absorbed. Never more than `queueLength`. */
  readonly absorbedCount: bigint;
  /** The newest checkpoint root. A client proves against this or a retained older one. */
  readonly root: `0x${string}`;
}

/** What deposits may put into the pool now: each note under the note cap, all together under the supply cap. */
export interface DepositRoom {
  /** The most one note may hold: the note cap, or what the supply cap leaves, if that is less. */
  readonly note: bigint;
  /** The most all of them together may hold: what the supply cap leaves. */
  readonly total: bigint;
}

export interface AssetTotals {
  readonly shielded: bigint;
  readonly pending: bigint;
}

/** The caps the pool was deployed with for one asset. They never change. */
export interface AssetCaps {
  /** The most one note may hold. Zero: the pool does not take the asset. */
  readonly noteCap: bigint;
  /** The most the pool may hold of it, shielded and pending together. */
  readonly supplyCap: bigint;
}

/** One commitment the pool queued, with its sealed memo, in queue order: its index is its leaf index. */
export interface QueuedLeaf {
  readonly index: bigint;
  readonly commitment: `0x${string}`;
  readonly memo: Uint8Array;
  readonly block: bigint;
}

/** A deposit as the pool logged it. The depositor sent its transaction; the log does not name them. */
export interface DepositedEvent {
  readonly index: bigint;
  readonly asset: Address;
  readonly amount: bigint;
  readonly block: bigint;
  readonly transaction: `0x${string}`;
}

/** A transaction as the pool logged it: the nullifiers it retired, where its new notes start, and what left the pool. */
export interface TransactedEvent {
  readonly nullifiers: readonly `0x${string}`[];
  /** The leaf index of its first new note. The others follow it. */
  readonly firstIndex: bigint;
  /** The zero address when nothing left the pool. */
  readonly exitAsset: Address;
  /** The zero address when nothing was paid out. */
  readonly recipient: Address;
  readonly exitAmount: bigint;
  readonly fee: bigint;
  readonly block: bigint;
  readonly transaction: `0x${string}`;
}

/** An escape claim as the pool logged it. */
export interface ClaimedEvent {
  readonly index: bigint;
  readonly asset: Address;
  readonly recipient: Address;
  readonly amount: bigint;
  readonly nullifier: `0x${string}`;
  readonly block: bigint;
  readonly transaction: `0x${string}`;
}

export interface PoolReader {
  readonly address: Address;
  state: () => Promise<PoolState>;
  totals: (asset: Address) => Promise<AssetTotals>;
  caps: (asset: Address) => Promise<AssetCaps>;
  /** What deposits of `asset` may put in now. */
  room: (asset: Address) => Promise<DepositRoom>;
  isSpent: (nullifier: `0x${string}`) => Promise<boolean>;
  /** Whether `root` is one the pool still takes a transaction against: the newest or one of the roots it retains. */
  isKnownRoot: (root: `0x${string}`) => Promise<boolean>;
  /** Whether the guardian has frozen the pool. A frozen pool takes nothing and pays out only by claim. */
  frozen: () => Promise<boolean>;
  /** Every commitment the pool queued from `fromBlock`, or from the pool's deployment, in queue order. */
  leaves: (fromBlock?: bigint) => Promise<readonly QueuedLeaf[]>;
  /** Every deposit from `fromBlock`, or from the pool's deployment. */
  deposits: (fromBlock?: bigint) => Promise<readonly DepositedEvent[]>;
  /** Every transaction from `fromBlock`, or from the pool's deployment. */
  transactions: (fromBlock?: bigint) => Promise<readonly TransactedEvent[]>;
  /** Every escape claim from `fromBlock`, or from the pool's deployment. */
  claims: (fromBlock?: bigint) => Promise<readonly ClaimedEvent[]>;
}

interface RawLog {
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: string;
  readonly transactionHash: string;
}

const WORD = 64;
const ADDRESS_HEX = 40;

function word(data: string, index: number): string {
  const hex = data.slice(2 + index * WORD, 2 + (index + 1) * WORD);
  if (hex.length !== WORD) throw new ChainError("badResponse", `Log data has no word at index ${index}`);
  return hex;
}

/** The ABI `bytes` whose offset sits in word `index` of `data`. */
function dynamicBytes(data: string, index: number): Uint8Array {
  const offset = Number(BigInt(`0x${word(data, index)}`)) * 2;
  const hex = data.slice(2);
  const length = Number(BigInt(`0x${hex.slice(offset, offset + WORD)}`)) * 2;
  const bytes = hex.slice(offset + WORD, offset + WORD + length);
  if (bytes.length !== length) throw new ChainError("badResponse", "A log carries truncated bytes");
  return hexToBytes(bytes);
}

function isRawLog(value: unknown): value is RawLog {
  if (typeof value !== "object" || value === null) return false;
  const log = value as Record<string, unknown>;
  return (
    Array.isArray(log.topics) &&
    typeof log.data === "string" &&
    typeof log.blockNumber === "string" &&
    typeof log.transactionHash === "string"
  );
}

/** An indexed address: the low 20 bytes of its topic. */
function topicAddress(log: RawLog, index: number): Address {
  const topic = log.topics[index];
  if (typeof topic !== "string" || topic.length !== 2 + WORD) {
    throw new ChainError("badResponse", `A pool log has no address in topic ${index}`);
  }
  return `0x${topic.slice(2 + WORD - ADDRESS_HEX)}`;
}

function topicUint(log: RawLog, index: number): bigint {
  const topic = log.topics[index];
  if (typeof topic !== "string") throw new ChainError("badResponse", `A pool log has no topic ${index}`);
  return BigInt(topic);
}

/** Where a log sits: its block and its transaction. */
function placeOf(log: RawLog): { block: bigint; transaction: `0x${string}` } {
  return { block: BigInt(log.blockNumber), transaction: log.transactionHash as `0x${string}` };
}

function decodeLog(entry: unknown): RawLog {
  if (!isRawLog(entry)) throw new ChainError("badResponse", "eth_getLogs returned a log this client cannot read");
  return entry;
}

/**
 * Reads one deployed pool. It answers only what the chain holds: totals, the root, spent nullifiers, and the deposits
 * and withdrawals the pool emitted. Which notes belong to an account is the account's own business and is not here.
 */
export function createPoolReader(network: NetworkConfig, reader: ChainReader): PoolReader {
  const contracts = network.contracts;
  if (!contracts) {
    throw new ChainError("poolNotDeployed", `No DECOY pool is deployed on ${network.label}`);
  }
  const { pool, deployedBlock } = contracts;

  /** Where a read of the pool's logs starts: no log of it is older than its deployment. */
  function startBlock(fromBlock: bigint | undefined): bigint {
    if (deployedBlock === null) {
      throw new ChainError("unknownDeploymentBlock", `The ${network.label} deployment does not record the block of its pool`);
    }
    return fromBlock === undefined || fromBlock < deployedBlock ? deployedBlock : fromBlock;
  }

  function call(data: string): RpcRequest {
    return { method: "eth_call", params: [{ to: pool, data }, "latest"] };
  }

  function readUint(selector: string): Promise<bigint> {
    return reader.rpc.call(call(selector), (result) => {
      if (typeof result !== "string") throw new ChainError("badResponse", `${selector} on the pool returned no data`);
      return decodeUint(result);
    });
  }

  async function logs(topic: string, fromBlock: bigint | undefined): Promise<readonly RawLog[]> {
    const from = startBlock(fromBlock);
    const raw = await readLogs(reader, { address: pool, topics: [topic] }, from, await reader.blockNumber());
    return raw.map(decodeLog);
  }

  function readAssetUint(selector: string, asset: Address): Promise<bigint> {
    return reader.rpc.call(call(encodeAddressCall(selector, asset)), (result) => {
      if (typeof result !== "string") throw new ChainError("badResponse", `${selector} on the pool returned no data`);
      return decodeUint(result);
    });
  }

  async function caps(asset: Address): Promise<AssetCaps> {
    const [noteCap, supplyCap] = await Promise.all([
      readAssetUint(POOL_SELECTOR.noteCap, asset),
      readAssetUint(POOL_SELECTOR.supplyCap, asset),
    ]);
    return { noteCap, supplyCap };
  }

  async function room(asset: Address): Promise<DepositRoom> {
    const [limits, shielded, pending] = await Promise.all([
      caps(asset),
      readAssetUint(POOL_SELECTOR.shieldedSupply, asset),
      readAssetUint(POOL_SELECTOR.pendingDeposits, asset),
    ]);
    const left = limits.supplyCap > shielded + pending ? limits.supplyCap - shielded - pending : 0n;
    return { note: left < limits.noteCap ? left : limits.noteCap, total: left };
  }

  return {
    address: pool,
    caps,
    room,
    state: async () => {
      const [queueLength, absorbedCount, root] = await Promise.all([
        readUint(POOL_SELECTOR.queueLength),
        readUint(POOL_SELECTOR.absorbedCount),
        reader.rpc.call(call(POOL_SELECTOR.currentRoot), (result) => {
          if (typeof result !== "string") throw new ChainError("badResponse", "currentRoot returned no data");
          return result as `0x${string}`;
        }),
      ]);
      return { queueLength, absorbedCount, root };
    },
    totals: async (asset) => {
      const [shielded, pending] = await Promise.all([
        reader.rpc.call(call(encodeAddressCall(POOL_SELECTOR.shieldedSupply, asset)), (result) =>
          decodeUint(result as string),
        ),
        reader.rpc.call(call(encodeAddressCall(POOL_SELECTOR.pendingDeposits, asset)), (result) =>
          decodeUint(result as string),
        ),
      ]);
      return { shielded, pending };
    },
    isSpent: async (nullifier) => {
      const data = `${POOL_SELECTOR.nullifierSpent}${nullifier.slice(2)}`;
      return (await reader.rpc.call(call(data), (result) => decodeUint(result as string))) === 1n;
    },
    isKnownRoot: async (root) => (await readUint(`${POOL_SELECTOR.isKnownRoot}${root.slice(2)}`)) === 1n,
    frozen: async () => (await readUint(POOL_SELECTOR.frozen)) === 1n,
    leaves: async (fromBlock) =>
      (await logs(POOL_EVENT_TOPIC.Queued, fromBlock)).map((log) => ({
        index: topicUint(log, 1),
        commitment: `0x${word(log.data, 0)}`,
        memo: dynamicBytes(log.data, 1),
        block: BigInt(log.blockNumber),
      })),
    deposits: async (fromBlock) =>
      (await logs(POOL_EVENT_TOPIC.Deposited, fromBlock)).map((log) => ({
        index: topicUint(log, 1),
        asset: topicAddress(log, 2),
        amount: BigInt(`0x${word(log.data, 0)}`),
        ...placeOf(log),
      })),
    transactions: async (fromBlock) =>
      (await logs(POOL_EVENT_TOPIC.Transacted, fromBlock)).map((log) => ({
        nullifiers: Array.from({ length: TRANSACT_INPUTS }, (_, input): `0x${string}` => `0x${word(log.data, input)}`),
        firstIndex: BigInt(`0x${word(log.data, TRANSACT_INPUTS)}`),
        exitAsset: topicAddress(log, 1),
        recipient: topicAddress(log, 2),
        exitAmount: BigInt(`0x${word(log.data, TRANSACT_INPUTS + 1)}`),
        fee: BigInt(`0x${word(log.data, TRANSACT_INPUTS + 2)}`),
        ...placeOf(log),
      })),
    claims: async (fromBlock) =>
      (await logs(POOL_EVENT_TOPIC.Claimed, fromBlock)).map((log) => ({
        index: topicUint(log, 1),
        asset: topicAddress(log, 2),
        recipient: topicAddress(log, 3),
        amount: BigInt(`0x${word(log.data, 0)}`),
        nullifier: `0x${word(log.data, 1)}`,
        ...placeOf(log),
      })),
  };
}
