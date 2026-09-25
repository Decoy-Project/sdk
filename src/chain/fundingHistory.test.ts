import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { RpcEndpoint } from "../network/types";
import { ROBINHOOD_TESTNET } from "../network/networks";
import { gradeFundingWallet, gradeOf } from "../rules/grade";
import { readFundingEvidence, TRANSFER_TOPIC } from "./fundingHistory";
import { createChainReader } from "./reader";
import { createRpcClient, type RpcRequest, type RpcSend } from "./rpc";

describe("funding history", () => {
  test("the Transfer topic is the hash of the event signature", () => {
    const signature = "Transfer(address,address,uint256)";
    assert.equal(`0x${bytesToHex(keccak_256(new TextEncoder().encode(signature)))}`, TRANSFER_TOPIC);
  });
});

describe("gradeOf", () => {
  test("many sources, long ago, is A", () => assert.equal(gradeOf(5, 90), "A"));
  test("two sources a month ago is B", () => assert.equal(gradeOf(2, 30), "B"));
  test("many sources but new is C", () => assert.equal(gradeOf(9, 3), "C"));
  test("one source, long ago, is C", () => assert.equal(gradeOf(1, 400), "C"));
  test("one source and new is D", () => assert.equal(gradeOf(1, 2), "D"));
  test("a wallet the logs cannot age counts as new", () => assert.equal(gradeOf(6, null), "C"));
});

describe("gradeFundingWallet", () => {
  test("turns the evidence into the signals the deposit screen shows", () => {
    const now = new Date("2026-09-24T00:00:00Z");
    const wallet = gradeFundingWallet("0x00000000000000000000000000000000000000a1", "Main", {
      senders: 1,
      firstFundedAt: new Date("2026-09-14T00:00:00Z"),
      seesEther: false,
    }, now);
    assert.deepEqual(
      { edges: wallet.inboundEdges, age: wallet.ageDays, single: wallet.singleSourceFunding, grade: wallet.grade },
      { edges: 1, age: 10, single: true, grade: "D" },
    );
  });

  test("says nothing about age when no funding is logged", () => {
    const wallet = gradeFundingWallet("0x00000000000000000000000000000000000000a1", "New", { senders: 0, firstFundedAt: null, seesEther: false }, new Date());
    assert.equal(wallet.ageDays, null);
    assert.equal(wallet.grade, "D");
  });
});

describe("readFundingEvidence", () => {
  const WALLET = "0x00000000000000000000000000000000000000a1";
  const ALCHEMY = { id: "alchemy", url: "https://alchemy.invalid/v2/key", displayUrl: "https://alchemy.invalid/v2/***" } as const;
  const PUBLIC = { id: "public", url: "https://public.invalid", displayUrl: "https://public.invalid" } as const;

  function readerOn(endpoints: readonly RpcEndpoint[], answer: (endpoint: RpcEndpoint, request: RpcRequest) => unknown) {
    const send: RpcSend = (endpoint, request) =>
      request.method === "eth_chainId" ? Promise.resolve(`0x${ROBINHOOD_TESTNET.chainId.toString(16)}`) : Promise.resolve(answer(endpoint, request));
    const rpc = createRpcClient({ endpoints, expectedChainId: ROBINHOOD_TESTNET.chainId, send });
    return createChainReader(ROBINHOOD_TESTNET, rpc);
  }

  test("with an Alchemy endpoint, reads every page of the transfer index, ether included", async () => {
    const asked: unknown[] = [];
    const reader = readerOn([ALCHEMY, PUBLIC], (endpoint, request) => {
      assert.equal(endpoint.id, "alchemy");
      assert.equal(request.method, "alchemy_getAssetTransfers");
      const [query] = request.params as [{ pageKey?: string }];
      asked.push(query.pageKey ?? null);
      const transfer = (from: string, at: string) => ({ from, metadata: { blockTimestamp: at } });
      return query.pageKey === undefined
        ? { transfers: [transfer("0xAA", "2026-06-01T00:00:00.000Z"), transfer("0xbb", "2026-07-01T00:00:00.000Z")], pageKey: "next" }
        : { transfers: [transfer("0xaa", "2026-05-01T00:00:00.000Z")] };
    });
    const evidence = await readFundingEvidence(reader, WALLET);
    assert.deepEqual(asked, [null, "next"]);
    assert.deepEqual(evidence, { senders: 2, firstFundedAt: new Date("2026-05-01T00:00:00.000Z"), seesEther: true });
  });

  test("without one, reads token Transfer logs and says it could not see ether", async () => {
    const reader = readerOn([PUBLIC], (_endpoint, request) => {
      if (request.method === "eth_getLogs") {
        return [{ topics: [TRANSFER_TOPIC, `0x${"0".repeat(24)}${"cc".repeat(20)}`], blockNumber: "0x10" }];
      }
      return { timestamp: "0x6700000" };
    });
    const evidence = await readFundingEvidence(reader, WALLET);
    assert.equal(evidence.senders, 1);
    assert.equal(evidence.seesEther, false);
  });
});
