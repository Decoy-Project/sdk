import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SyncState } from "../domain/types";
import type { RpcEndpoint } from "../network/types";
import { createChainSync } from "./chainSync";
import type { ChainReader } from "./reader";

const PUBLIC_ENDPOINT: RpcEndpoint = { id: "public", url: "https://public.invalid", displayUrl: "https://public.invalid" };
const HEIGHT = 67_827_647n;
/** Only `start()` reads this, and no test here starts the poller. */
const POLL_MS = 1_000;

function unusedInThisTest(name: string): () => never {
  return () => {
    throw new Error(`${name} is not part of this test`);
  };
}

/** A reader that answers `blockNumber` from a queue of outcomes and nothing else. */
function stubReader(outcomes: readonly (bigint | Error)[]): ChainReader {
  let index = 0;
  return {
    network: unusedInThisTest("network"),
    rpc: {
      call: unusedInThisTest("rpc.call"),
      callOn: unusedInThisTest("rpc.callOn"),
      endpoints: () => [],
      servedBy: () => PUBLIC_ENDPOINT,
      subscribe: () => () => undefined,
    },
    endpoints: () => [],
    servedBy: () => PUBLIC_ENDPOINT,
    subscribe: () => () => undefined,
    chainId: unusedInThisTest("chainId"),
    blockNumber: () => {
      const outcome = outcomes[Math.min(index, outcomes.length - 1)];
      index += 1;
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
    blockTime: unusedInThisTest("blockTime"),
    nativeBalance: unusedInThisTest("nativeBalance"),
    tokenBalance: unusedInThisTest("tokenBalance"),
    tokenMetadata: unusedInThisTest("tokenMetadata"),
    readAssets: unusedInThisTest("readAssets"),
  };
}

describe("createChainSync", () => {
  test("starts offline at block zero, because nothing has been read", () => {
    const sync = createChainSync(stubReader([HEIGHT]), { pollMs: POLL_MS });
    assert.deepEqual(sync.state(), { status: "offline", block: 0n, endpoint: null });
  });

  test("reports the height and the endpoint that served it", async () => {
    const sync = createChainSync(stubReader([HEIGHT]), { pollMs: POLL_MS });
    await sync.refresh();
    assert.deepEqual(sync.state(), { status: "synced", block: HEIGHT, endpoint: "public" });
  });

  test("passes through syncing on the way to synced", async () => {
    const sync = createChainSync(stubReader([HEIGHT]), { pollMs: POLL_MS });
    const seen: SyncState[] = [];
    sync.subscribe((state) => seen.push(state));
    await sync.refresh();
    assert.deepEqual(
      seen.map((state) => state.status),
      ["syncing", "synced"],
    );
  });

  test("stays synced through a routine poll, so the status does not flicker", async () => {
    const sync = createChainSync(stubReader([HEIGHT, HEIGHT + 1n]), { pollMs: POLL_MS });
    await sync.refresh();
    const seen: SyncState[] = [];
    sync.subscribe((state) => seen.push(state));
    await sync.refresh();
    assert.deepEqual(seen, [{ status: "synced", block: HEIGHT + 1n, endpoint: "public" }]);
  });

  test("passes through syncing again when it recovers from offline", async () => {
    const sync = createChainSync(stubReader([new Error("offline"), HEIGHT]), { pollMs: POLL_MS });
    await sync.refresh();
    const seen: SyncState[] = [];
    sync.subscribe((state) => seen.push(state));
    await sync.refresh();
    assert.deepEqual(
      seen.map((state) => state.status),
      ["syncing", "synced"],
    );
  });

  test("goes offline when the chain cannot be read, keeping the last height", async () => {
    const sync = createChainSync(stubReader([HEIGHT, new Error("every endpoint failed")]), { pollMs: POLL_MS });
    await sync.refresh();
    await sync.refresh();
    assert.deepEqual(sync.state(), { status: "offline", block: HEIGHT, endpoint: null });
  });

  test("recovers to synced after the chain answers again", async () => {
    const sync = createChainSync(stubReader([new Error("offline"), HEIGHT]), { pollMs: POLL_MS });
    await sync.refresh();
    await sync.refresh();
    assert.equal(sync.state().status, "synced");
    assert.equal(sync.state().block, HEIGHT);
  });

  test("a removed listener stops hearing about the chain", async () => {
    const sync = createChainSync(stubReader([HEIGHT]), { pollMs: POLL_MS });
    let heard = 0;
    sync.subscribe(() => (heard += 1))();
    await sync.refresh();
    assert.equal(heard, 0);
  });
});
