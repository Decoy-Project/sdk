import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RpcEndpoint } from "../network/types";
import { ChainError } from "./errors";
import {
  createHttpSend,
  createRpcClient,
  type EndpointReport,
  type HttpPost,
  type HttpPostReply,
  type HttpPostRequest,
  type RpcRequest,
  type RpcSend,
} from "./rpc";

const CHAIN_ID = 4663;
const OTHER_CHAIN_ID = 42_161;

const KEY = "placeholder-key-not-real";
const PREFERRED: RpcEndpoint = {
  id: "alchemy",
  url: `https://example.invalid/v2/${KEY}`,
  displayUrl: "https://example.invalid/v2/***",
};
const BACKUP: RpcEndpoint = { id: "public", url: "https://public.invalid", displayUrl: "https://public.invalid" };
const ENDPOINTS = [PREFERRED, BACKUP] as const;

const BLOCK_NUMBER: RpcRequest = { method: "eth_blockNumber", params: [] };

type Answer = (request: RpcRequest) => unknown;

interface Recorder {
  readonly send: RpcSend;
  readonly calls: { endpoint: string; method: string }[];
}

/** A transport that answers from a table, so no test touches the network. */
function recorder(answers: Partial<Record<string, Answer>>): Recorder {
  const calls: { endpoint: string; method: string }[] = [];
  const send: RpcSend = (endpoint, request) => {
    calls.push({ endpoint: endpoint.id, method: request.method });
    const answer = answers[endpoint.id];
    if (!answer) return Promise.reject(new Error(`${endpoint.id} is unreachable`));
    return Promise.resolve(answer(request));
  };
  return { send, calls };
}

function chainOf(chainId: number, block = "0x10"): Answer {
  return (request) => (request.method === "eth_chainId" ? `0x${chainId.toString(16)}` : block);
}

const identity = (result: unknown): unknown => result;

function rejectsWith(code: string, pattern: RegExp) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof ChainError);
    assert.equal(error.code, code);
    assert.match(error.message, pattern);
    return true;
  };
}

function stateOf(reports: readonly EndpointReport[], id: string): EndpointReport | undefined {
  return reports.find((report) => report.endpoint.id === id);
}

describe("createRpcClient", () => {
  test("serves from the preferred endpoint and names it", async () => {
    const { send, calls } = recorder({ alchemy: chainOf(CHAIN_ID), public: chainOf(CHAIN_ID) });
    const client = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send });

    assert.equal(await client.call(BLOCK_NUMBER, identity), "0x10");
    assert.equal(client.servedBy()?.id, "alchemy");
    assert.equal(stateOf(client.endpoints(), "alchemy")?.state, "serving");
    assert.equal(stateOf(client.endpoints(), "public")?.state, "untried");
    assert.deepEqual(
      calls.map((call) => call.endpoint),
      ["alchemy", "alchemy"],
    );
  });

  test("verifies the chain id once per endpoint", async () => {
    const { send, calls } = recorder({ alchemy: chainOf(CHAIN_ID) });
    const client = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send });

    await client.call(BLOCK_NUMBER, identity);
    await client.call(BLOCK_NUMBER, identity);

    assert.equal(calls.filter((call) => call.method === "eth_chainId").length, 1);
  });

  test("falls back to the backup and keeps the failure visible", async () => {
    const { send } = recorder({ public: chainOf(CHAIN_ID) });
    const client = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send });
    const seen: EndpointReport[][] = [];
    client.subscribe((reports) => seen.push([...reports]));

    assert.equal(await client.call(BLOCK_NUMBER, identity), "0x10");
    assert.equal(client.servedBy()?.id, "public");

    const failed = stateOf(client.endpoints(), "alchemy");
    assert.equal(failed?.state, "failed");
    assert.equal(failed?.problem, "alchemy is unreachable");
    assert.equal(seen.length, 2, "the listener sees the failure and the endpoint that took over");
  });

  test("refuses an endpoint that answers for another chain, and never asks it again", async () => {
    const { send, calls } = recorder({ alchemy: chainOf(OTHER_CHAIN_ID), public: chainOf(CHAIN_ID) });
    const client = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send });

    await client.call(BLOCK_NUMBER, identity);
    await client.call(BLOCK_NUMBER, identity);

    const refused = stateOf(client.endpoints(), "alchemy");
    assert.equal(refused?.state, "refused");
    assert.equal(refused?.problem, `reports chainId ${OTHER_CHAIN_ID}, expected ${CHAIN_ID}`);
    assert.equal(calls.filter((call) => call.endpoint === "alchemy").length, 1);
  });

  test("throws when no endpoint answers, listing what each one did", async () => {
    const { send } = recorder({ alchemy: chainOf(OTHER_CHAIN_ID) });
    const client = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send });

    await assert.rejects(client.call(BLOCK_NUMBER, identity), (error: unknown) => {
      assert.ok(error instanceof ChainError);
      assert.equal(error.code, "noEndpointAnswered");
      assert.match(error.message, /alchemy: /);
      assert.match(error.message, /public: /);
      return true;
    });
    assert.equal(client.servedBy(), null);
  });

  test("uses an endpoint that appears while it runs, and verifies it", async () => {
    const { send, calls } = recorder({ alchemy: chainOf(CHAIN_ID), public: chainOf(CHAIN_ID) });
    let endpoints: readonly RpcEndpoint[] = [BACKUP];
    const client = createRpcClient({ endpoints: () => endpoints, expectedChainId: CHAIN_ID, send });

    await client.call(BLOCK_NUMBER, identity);
    assert.equal(client.servedBy()?.id, "public");

    endpoints = ENDPOINTS;
    await client.call(BLOCK_NUMBER, identity);

    assert.equal(client.servedBy()?.id, "alchemy");
    assert.equal(calls.filter((call) => call.endpoint === "alchemy" && call.method === "eth_chainId").length, 1);
  });

  test("verifies an endpoint again when its URL changes", async () => {
    const { send, calls } = recorder({ alchemy: chainOf(CHAIN_ID) });
    let endpoints: readonly RpcEndpoint[] = [PREFERRED];
    const client = createRpcClient({ endpoints: () => endpoints, expectedChainId: CHAIN_ID, send });

    await client.call(BLOCK_NUMBER, identity);
    endpoints = [{ ...PREFERRED, url: `${PREFERRED.url}-second-key` }];
    await client.call(BLOCK_NUMBER, identity);

    assert.equal(calls.filter((call) => call.method === "eth_chainId").length, 2);
  });

  test("keeps an API key out of the problem it reports", async () => {
    const send: RpcSend = (endpoint) => Promise.reject(new Error(`connect ECONNREFUSED ${endpoint.url}`));
    const client = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send });

    await assert.rejects(client.call(BLOCK_NUMBER, identity), (error: unknown) => {
      assert.ok(error instanceof ChainError);
      assert.equal(error.message.includes(KEY), false);
      assert.match(error.message, /example\.invalid\/v2\/\*\*\*/);
      return true;
    });
    assert.equal(stateOf(client.endpoints(), "alchemy")?.problem?.includes(KEY), false);
  });

  test("sends a provider's own method to that provider alone, and never falls back", async () => {
    const { send, calls } = recorder({ alchemy: chainOf(CHAIN_ID, "0xa1"), public: chainOf(CHAIN_ID, "0xb2") });
    const client = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send });
    assert.equal(await client.callOn("alchemy", BLOCK_NUMBER, identity), "0xa1");
    assert.deepEqual(calls.map((call) => call.endpoint), ["alchemy", "alchemy"]);

    const down = recorder({ public: chainOf(CHAIN_ID) });
    const failing = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send: down.send });
    await assert.rejects(failing.callOn("alchemy", BLOCK_NUMBER, identity), rejectsWith("noEndpointAnswered", /failed on alchemy/));
    assert.deepEqual(down.calls.map((call) => call.endpoint), ["alchemy"]);
  });

  test("refuses to send a provider's method when that provider is not configured", async () => {
    const { send } = recorder({ public: chainOf(CHAIN_ID) });
    const client = createRpcClient({ endpoints: [BACKUP], expectedChainId: CHAIN_ID, send });
    await assert.rejects(client.callOn("alchemy", BLOCK_NUMBER, identity), rejectsWith("noEndpointAnswered", /none is configured/));
  });

  test("a removed listener stops hearing about endpoints", async () => {
    const { send } = recorder({ public: chainOf(CHAIN_ID) });
    const client = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send });
    let heard = 0;
    const unsubscribe = client.subscribe(() => (heard += 1));
    unsubscribe();

    await client.call(BLOCK_NUMBER, identity);

    assert.equal(heard, 0);
  });
});

describe("createHttpSend", () => {
  const CHAIN_ID_REQUEST: RpcRequest = { method: "eth_chainId", params: [] };
  const TIMEOUT_MS = 1_234;

  /** A POST that records what it was asked to move and answers with one reply. */
  function replying(reply: HttpPostReply): { post: HttpPost; seen: HttpPostRequest[] } {
    const seen: HttpPostRequest[] = [];
    const post: HttpPost = (request) => {
      seen.push(request);
      return Promise.resolve(reply);
    };
    return { post, seen };
  }


  test("posts one JSON-RPC request to the endpoint URL and returns its result", async () => {
    const { post, seen } = replying({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1237" }) });

    assert.equal(await createHttpSend(post, TIMEOUT_MS)(BACKUP, CHAIN_ID_REQUEST), "0x1237");
    assert.deepEqual(seen, [
      {
        url: BACKUP.url,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        timeoutMs: TIMEOUT_MS,
      },
    ]);
  });

  test("an HTTP error status is an RPC error that names the endpoint", async () => {
    const { post } = replying({ status: 429, body: "Too Many Requests" });

    await assert.rejects(createHttpSend(post)(BACKUP, CHAIN_ID_REQUEST), rejectsWith("rpcError", /HTTP 429 from public/));
  });

  test("a body that is not JSON is a bad response", async () => {
    const { post } = replying({ status: 200, body: "<html>" });

    await assert.rejects(createHttpSend(post)(BACKUP, CHAIN_ID_REQUEST), rejectsWith("badResponse", /not JSON/));
  });

  test("a JSON-RPC error object is an RPC error", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32_000, message: "header not found" } });
    const { post } = replying({ status: 200, body });

    await assert.rejects(createHttpSend(post)(BACKUP, CHAIN_ID_REQUEST), rejectsWith("rpcError", /header not found/));
  });

  test("a revert's return data is kept in the error, where a node put it outside the message", async () => {
    const error = { code: 3, message: "execution reverted", data: "0xb115d857" };
    const { post } = replying({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: 1, error }) });

    await assert.rejects(createHttpSend(post)(BACKUP, CHAIN_ID_REQUEST), rejectsWith("rpcError", /execution reverted \(3\) \[data 0xb115d857\]/));
  });

  test("a transport failure reaches the caller unchanged", async () => {
    const failure = new Error("operation timed out");
    const post: HttpPost = () => Promise.reject(failure);

    await assert.rejects(createHttpSend(post)(BACKUP, CHAIN_ID_REQUEST), (error: unknown) => error === failure);
  });
});
