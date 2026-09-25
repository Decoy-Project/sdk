import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Address } from "../domain/types";
import type { NetworkConfig } from "../network/types";
import { ERC20_SELECTOR } from "./abi";
import { ChainError } from "./errors";
import { createChainReader } from "./reader";
import { createRpcClient, type RpcRequest, type RpcSend } from "./rpc";

const CHAIN_ID = 4663;
const ENDPOINTS = [{ id: "public", url: "https://public.invalid", displayUrl: "https://public.invalid" }] as const;

/* Invented fixture contract and owner. No real address is needed to test decoding. */
const TOKEN: Address = `0x${"11".repeat(20)}`;
const OWNER: Address = `0x${"a1".repeat(20)}`;
const BLOCK = 67_821_517n;
const NATIVE_BALANCE = 123_456_789n;
const TOKEN_BALANCE = 1_240_000_000n;

const NETWORK: NetworkConfig = {
  name: "robinhoodMainnet",
  label: "Fixture Chain",
  chainId: CHAIN_ID,
  publicRpcUrl: ENDPOINTS[0].url,
  alchemyHost: "example.invalid",
  nativeAsset: { symbol: "ETH", name: "Ether", kind: "crypto", decimals: 18 },
  tokens: [{ address: TOKEN, symbol: "USDG", decimals: 6, kind: "stablecoin" }],
};

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function abiString(text: string): string {
  const bytes = [...new TextEncoder().encode(text)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${(32n).toString(16).padStart(64, "0")}${BigInt(text.length).toString(16).padStart(64, "0")}${bytes.padEnd(64, "0")}`;
}

interface TokenFixture {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: bigint;
}

const USDG_ON_CHAIN: TokenFixture = { symbol: "USDG", name: "Global Dollar", decimals: 6n };

function sendWith(token: TokenFixture): RpcSend {
  return (_endpoint, request: RpcRequest) => {
    if (request.method === "eth_chainId") return Promise.resolve(`0x${CHAIN_ID.toString(16)}`);
    if (request.method === "eth_blockNumber") return Promise.resolve(word(BLOCK));
    if (request.method === "eth_getBalance") return Promise.resolve(word(NATIVE_BALANCE));
    if (request.method !== "eth_call") return Promise.reject(new Error(`unexpected method ${request.method}`));
    const { data } = request.params[0] as { to: Address; data: string };
    if (data === ERC20_SELECTOR.symbol) return Promise.resolve(abiString(token.symbol));
    if (data === ERC20_SELECTOR.name) return Promise.resolve(abiString(token.name));
    if (data === ERC20_SELECTOR.decimals) return Promise.resolve(word(token.decimals));
    if (data.startsWith(ERC20_SELECTOR.balanceOf)) return Promise.resolve(word(TOKEN_BALANCE));
    return Promise.reject(new Error(`unexpected call data ${data}`));
  };
}

function readerWith(token: TokenFixture = USDG_ON_CHAIN) {
  const rpc = createRpcClient({ endpoints: ENDPOINTS, expectedChainId: CHAIN_ID, send: sendWith(token) });
  return createChainReader(NETWORK, rpc);
}

describe("createChainReader", () => {
  test("reads the chain id, the block height and a native balance", async () => {
    const reader = readerWith();
    assert.equal(await reader.chainId(), CHAIN_ID);
    assert.equal(await reader.blockNumber(), BLOCK);
    assert.equal(await reader.nativeBalance(OWNER), NATIVE_BALANCE);
  });

  test("reads a token balance through balanceOf", async () => {
    assert.equal(await readerWith().tokenBalance(TOKEN, OWNER), TOKEN_BALANCE);
  });

  test("reads token metadata from the contract", async () => {
    assert.deepEqual(await readerWith().tokenMetadata(TOKEN), { symbol: "USDG", name: "Global Dollar", decimals: 6 });
  });

  test("takes the name and decimals from the chain and the kind from the config", async () => {
    assert.deepEqual(await readerWith().readAssets(), [
      { symbol: "USDG", name: "Global Dollar", kind: "stablecoin", decimals: 6 },
    ]);
  });

  test("refuses an asset whose contract disagrees with the config", async () => {
    for (const token of [
      { ...USDG_ON_CHAIN, symbol: "USDC" },
      { ...USDG_ON_CHAIN, decimals: 18n },
    ]) {
      await assert.rejects(
        readerWith(token).readAssets(),
        (error: unknown) => error instanceof ChainError && error.code === "assetMismatch",
      );
    }
  });

  test("exposes the endpoint that served the read", async () => {
    const reader = readerWith();
    await reader.blockNumber();
    assert.equal(reader.servedBy()?.id, "public");
    assert.equal(reader.network().chainId, CHAIN_ID);
  });
});
