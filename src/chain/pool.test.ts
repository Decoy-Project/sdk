import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MEMO_BYTES } from "@decoy/protocol";
import type { Address } from "../domain/types";
import { POOL_EVENT_TOPIC, POOL_SELECTOR } from "../network/generated/deployments";
import { ROBINHOOD_LOCAL, ROBINHOOD_MAINNET } from "../network/networks";
import type { NetworkConfig } from "../network/types";
import { ChainError } from "./errors";
import { createPoolReader } from "./pool";
import { createChainReader } from "./reader";
import { createRpcClient, type RpcRequest, type RpcSend } from "./rpc";

const CHAIN_ID = ROBINHOOD_LOCAL.chainId;
const ENDPOINTS = [{ id: "public", url: "https://local.invalid", displayUrl: "https://local.invalid" }] as const;

/* Values taken from a real local run: eight deposits of one token, all absorbed. */
const TOKEN: Address = "0x87e8f332f34984728da4c0a008a495a5ec4e09a2";
const QUEUE_LENGTH = 8n;
const PENDING = 8_000_000n;
const ROOT = "0x27964d6f3f830a71c52dbd37d983c13e80741bf784e918eb3e95dd98977ce765";
const COMMITMENT = "0x1f7414071e2dbe2d0000000000000000000000000000000000000000000000ff";
const NULLIFIER = `0x${"22".repeat(32)}` as const;
/* A memo as the pool logs it: MEMO_BYTES bytes, which ABI encoding pads to two words. */
const MEMO = Uint8Array.from({ length: MEMO_BYTES }, (_, index) => index + 1);
const MEMO_HEX = Buffer.from(MEMO).toString("hex");

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

/* A deposit and a transaction as the testnet pool 0xe23a500a…c252ec7e logged them on 24 Sep 2026. */
const WETH: Address = "0xd33de4d258d964b19ac83f4c80d81a0689a9d757";
const PAID_TO: Address = "0x506d290f3c9fd36660bb2f4cf81028bb7449b46b";
const DEPOSITED_LOG = {
  topics: [POOL_EVENT_TOPIC.Deposited, `0x${word(0n)}`, `0x${WETH.slice(2).padStart(64, "0")}`],
  data: "0x000000000000000000000000000000000000000000000000002386f26fc10000",
  transactionHash: "0xad85da1fb862f32281ecfc2e388e2835c93b1425218647625660ea82b87343b0",
} as const;
const SPENT = [
  "0x160a7b5cb8ea022c35e72aa958891f6b8ceb153a587e24e789ea0944288065c8",
  "0x14e5f87a7a63ee7c37c7b165fbdad775277b877d8eef85429b477e8903206423",
] as const;
const TRANSACTED_LOG = {
  topics: [POOL_EVENT_TOPIC.Transacted, `0x${WETH.slice(2).padStart(64, "0")}`, `0x${PAID_TO.slice(2).padStart(64, "0")}`],
  data: `0x${SPENT[0].slice(2)}${SPENT[1].slice(2)}${word(8n)}${word(15_000_000_000_000_000n)}${word(80_021_106_000_000n)}`,
  transactionHash: "0x6295459402f0474159e23d70ed459adcf1d35771c7e40fa1fcaace51fc02f625",
} as const;
/* No claim has been made on a real pool: this one is written from the event's ABI. */
const CLAIMED_LOG = {
  topics: [POOL_EVENT_TOPIC.Claimed, `0x${word(3n)}`, `0x${WETH.slice(2).padStart(64, "0")}`, `0x${PAID_TO.slice(2).padStart(64, "0")}`],
  data: `0x${word(7n)}${NULLIFIER.slice(2)}`,
  transactionHash: `0x${"cc".repeat(32)}`,
} as const;
const LOG_BY_TOPIC: Record<string, { topics: readonly string[]; data: string; transactionHash: string }> = {
  [POOL_EVENT_TOPIC.Deposited]: DEPOSITED_LOG,
  [POOL_EVENT_TOPIC.Transacted]: TRANSACTED_LOG,
  [POOL_EVENT_TOPIC.Claimed]: CLAIMED_LOG,
};

/* The block the deposit below was logged in, and the local pool as a deployment that records where it starts. */
const DEPOSIT_BLOCK = 67_836_617n;
const HEAD = DEPOSIT_BLOCK + 25_000n;
const LOCAL = ROBINHOOD_LOCAL.contracts;
if (!LOCAL) throw new Error("The local network lists no pool");
const DEPLOYED: NetworkConfig = { ...ROBINHOOD_LOCAL, contracts: { ...LOCAL, deployedBlock: DEPOSIT_BLOCK - 12_000n } };

interface LogRequest {
  readonly topics: string[];
  readonly fromBlock: string;
  readonly toBlock: string;
}

function send(ranges: LogRequest[] = []): RpcSend {
  return (_endpoint, request: RpcRequest) => {
    if (request.method === "eth_chainId") return Promise.resolve(`0x${CHAIN_ID.toString(16)}`);
    if (request.method === "eth_blockNumber") return Promise.resolve(`0x${HEAD.toString(16)}`);
    if (request.method === "eth_getLogs") {
      const [filter] = request.params as [LogRequest];
      ranges.push(filter);
      const inRange = BigInt(filter.fromBlock) <= DEPOSIT_BLOCK && DEPOSIT_BLOCK <= BigInt(filter.toBlock);
      const block = `0x${DEPOSIT_BLOCK.toString(16)}`;
      if (filter.topics[0] === POOL_EVENT_TOPIC.Queued && inRange) {
        return Promise.resolve([
          {
            topics: [POOL_EVENT_TOPIC.Queued, `0x${word(0n)}`],
            data: `0x${COMMITMENT.slice(2)}${word(64n)}${word(BigInt(MEMO.length))}${MEMO_HEX.padEnd(128, "0")}`,
            blockNumber: block,
            transactionHash: DEPOSITED_LOG.transactionHash,
          },
        ]);
      }
      const log = LOG_BY_TOPIC[filter.topics[0]];
      return Promise.resolve(log && inRange ? [{ ...log, blockNumber: block }] : []);
    }
    if (request.method !== "eth_call") return Promise.reject(new Error(`unexpected ${request.method}`));
    const [{ data }] = request.params as [{ data: string }];
    if (data === POOL_SELECTOR.queueLength) return Promise.resolve(`0x${word(QUEUE_LENGTH)}`);
    if (data === POOL_SELECTOR.absorbedCount) return Promise.resolve(`0x${word(QUEUE_LENGTH)}`);
    if (data === POOL_SELECTOR.currentRoot) return Promise.resolve(ROOT);
    if (data.startsWith(POOL_SELECTOR.shieldedSupply)) return Promise.resolve(`0x${word(0n)}`);
    if (data.startsWith(POOL_SELECTOR.pendingDeposits)) return Promise.resolve(`0x${word(PENDING)}`);
    if (data.startsWith(POOL_SELECTOR.nullifierSpent)) return Promise.resolve(`0x${word(1n)}`);
    return Promise.reject(new Error(`unexpected call ${data}`));
  };
}

function poolReader(network: NetworkConfig = DEPLOYED, ranges: LogRequest[] = []) {
  const rpc = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send: send(ranges) });
  return createPoolReader(network, createChainReader(network, rpc));
}

describe("createPoolReader", () => {
  test("refuses a network with no pool on it", () => {
    const rpc = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send: send() });
    const noPool: NetworkConfig = { ...ROBINHOOD_MAINNET, contracts: undefined };
    assert.throws(
      () => createPoolReader(noPool, createChainReader(noPool, rpc)),
      (error: unknown) => error instanceof ChainError && error.code === "poolNotDeployed",
    );
  });

  test("reads the counts and the root the pool reports", async () => {
    const state = await poolReader().state();
    assert.deepEqual(state, { queueLength: QUEUE_LENGTH, absorbedCount: QUEUE_LENGTH, root: ROOT });
  });

  test("reads the public totals of one asset", async () => {
    assert.deepEqual(await poolReader().totals(TOKEN), { shielded: 0n, pending: PENDING });
  });

  test("reads the logs from the pool's deployment, in ranges an endpoint takes", async () => {
    const ranges: LogRequest[] = [];
    const [leaf] = await poolReader(DEPLOYED, ranges).leaves();
    assert.equal(leaf.block, DEPOSIT_BLOCK);
    assert.deepEqual(
      ranges.map((range) => [BigInt(range.fromBlock), BigInt(range.toBlock)]),
      [
        [DEPOSIT_BLOCK - 12_000n, DEPOSIT_BLOCK - 2_001n],
        [DEPOSIT_BLOCK - 2_000n, DEPOSIT_BLOCK + 7_999n],
        [DEPOSIT_BLOCK + 8_000n, DEPOSIT_BLOCK + 17_999n],
        [DEPOSIT_BLOCK + 18_000n, HEAD],
      ],
    );
  });

  test("reads nothing from before the pool's deployment", async () => {
    const ranges: LogRequest[] = [];
    await poolReader(DEPLOYED, ranges).leaves(0n);
    assert.equal(BigInt(ranges[0].fromBlock), DEPOSIT_BLOCK - 12_000n);
  });

  test("refuses to read the logs of a deployment that does not record its block", async () => {
    await assert.rejects(
      poolReader(ROBINHOOD_LOCAL).leaves(),
      (error: unknown) => error instanceof ChainError && error.code === "unknownDeploymentBlock",
    );
  });

  test("reads a queued commitment and its memo out of its log", async () => {
    const [leaf] = await poolReader().leaves();
    assert.equal(leaf.index, 0n);
    assert.equal(leaf.commitment, COMMITMENT);
    assert.deepEqual(leaf.memo, MEMO);
    assert.equal(leaf.block, DEPOSIT_BLOCK);
  });

  test("reports a spent nullifier", async () => {
    assert.equal(await poolReader().isSpent(NULLIFIER), true);
  });

  test("reads deposits, transactions and claims out of their logs", async () => {
    const reader = poolReader();
    const at = { block: DEPOSIT_BLOCK };
    assert.deepEqual(await reader.deposits(), [
      { index: 0n, asset: WETH, amount: 10_000_000_000_000_000n, ...at, transaction: DEPOSITED_LOG.transactionHash },
    ]);
    assert.deepEqual(await reader.transactions(), [
      {
        nullifiers: [...SPENT],
        firstIndex: 8n,
        exitAsset: WETH,
        recipient: PAID_TO,
        exitAmount: 15_000_000_000_000_000n,
        fee: 80_021_106_000_000n,
        ...at,
        transaction: TRANSACTED_LOG.transactionHash,
      },
    ]);
    assert.deepEqual(await reader.claims(), [
      { index: 3n, asset: WETH, recipient: PAID_TO, amount: 7n, nullifier: NULLIFIER, ...at, transaction: CLAIMED_LOG.transactionHash },
    ]);
  });

});
