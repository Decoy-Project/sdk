import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { receiveKey } from "../keys/evm";
import { ROBINHOOD_TESTNET } from "../network/networks";
import type { RpcEndpoint } from "../network/types";
import { ChainError } from "./errors";
import { createChainReader } from "./reader";
import { createRpcClient, type RpcRequest, type RpcSend } from "./rpc";
import { createSigner } from "./signer";

const ENDPOINT: RpcEndpoint = { id: "public", url: "https://testnet.invalid", displayUrl: "https://testnet.invalid" };
const KEY = receiveKey(new Uint8Array(64).fill(3), 0);
const TO = ROBINHOOD_TESTNET.tokens[0].address;
const BASE_FEE = 10_000_000n;
const ESTIMATE = 50_000n;

interface Chain {
  readonly send: RpcSend;
  readonly sent: string[];
}

/** A chain that mines whatever it is sent at block 7, reporting `status` for it. */
function chain(options: { status?: string; answerHash?: (raw: string) => string } = {}): Chain {
  const sent: string[] = [];
  let receiptAsks = 0;
  const answers: Record<string, (request: RpcRequest) => unknown> = {
    eth_chainId: () => `0x${ROBINHOOD_TESTNET.chainId.toString(16)}`,
    eth_getTransactionCount: () => "0x5",
    eth_estimateGas: () => `0x${ESTIMATE.toString(16)}`,
    eth_getBlockByNumber: () => ({ baseFeePerGas: `0x${BASE_FEE.toString(16)}` }),
    eth_maxPriorityFeePerGas: () => "0x0",
    eth_sendRawTransaction: (request) => {
      const raw = request.params[0] as string;
      sent.push(raw);
      return options.answerHash ? options.answerHash(raw) : `0x${bytesToHex(keccak_256(hexToBytes(raw.slice(2))))}`;
    },
    eth_getTransactionReceipt: (request) => {
      receiptAsks += 1;
      if (receiptAsks === 1) return null;
      return {
        transactionHash: request.params[0],
        blockNumber: "0x7",
        gasUsed: "0xc350",
        status: options.status ?? "0x1",
        logs: [{ address: TO, topics: ["0x01"], data: "0x" }],
      };
    },
  };
  return {
    sent,
    send: (_endpoint, request) => {
      const answer = answers[request.method];
      if (!answer) return Promise.reject(new Error(`unexpected ${request.method}`));
      return Promise.resolve(answer(request));
    },
  };
}

function signerOn(stub: Chain) {
  const rpc = createRpcClient({ endpoints: [ENDPOINT], expectedChainId: ROBINHOOD_TESTNET.chainId, send: stub.send });
  return createSigner(createChainReader(ROBINHOOD_TESTNET, rpc), KEY);
}

describe("createSigner", () => {
  test("bids twice the base fee plus the tip", async () => {
    assert.deepEqual(await signerOn(chain()).fees(), { maxFeePerGas: 2n * BASE_FEE, maxPriorityFeePerGas: 0n });
  });

  test("sends one signed transaction and returns its receipt once it is mined", async () => {
    const stub = chain();
    const receipt = await signerOn(stub).send({ to: TO, data: "0xd0e30db0", value: 1n });

    assert.equal(stub.sent.length, 1);
    assert.equal(receipt.block, 7n);
    assert.equal(receipt.hash, `0x${bytesToHex(keccak_256(hexToBytes(stub.sent[0].slice(2))))}`);
    assert.deepEqual(receipt.logs, [{ address: TO, topics: ["0x01"], data: "0x" }]);
  });

  test("a mined revert throws", async () => {
    await assert.rejects(signerOn(chain({ status: "0x0" })).send({ to: TO, data: "0xd0e30db0", value: 1n }), (error) => {
      assert.ok(error instanceof ChainError);
      assert.equal(error.code, "transactionReverted");
      return true;
    });
  });

  test("an endpoint that answers another hash is caught", async () => {
    const stub = chain({ answerHash: () => `0x${"ab".repeat(32)}` });
    await assert.rejects(signerOn(stub).send({ to: TO, data: "0xd0e30db0", value: 1n }), (error) => {
      assert.ok(error instanceof ChainError);
      assert.equal(error.code, "transactionHashMismatch");
      return true;
    });
  });
});
