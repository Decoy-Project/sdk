import type { Unsubscribe } from "../client/types";
import type { Address, Asset } from "../domain/types";
import type { NetworkConfig, RpcEndpoint, TokenConfig } from "../network/types";
import { decodeString, decodeUint, decodeUint8, encodeAddressCall, ERC20_SELECTOR } from "./abi";
import { ChainError } from "./errors";
import type { EndpointListener, EndpointReport, RpcClient, RpcRequest } from "./rpc";

/** The block tag every read uses. DECOY reads confirmed state only, never a pending block. */
const LATEST = "latest";

export interface TokenMetadata {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

/**
 * Read-only chain access. Every method returns what the chain says, or throws. Nothing here knows about the shielded
 * pool: these are the reads that work on a chain where DECOY's contracts are not deployed.
 */
export interface ChainReader {
  network: () => NetworkConfig;
  /** The client underneath, for readers that call contracts this one does not know about. */
  rpc: RpcClient;
  endpoints: () => readonly EndpointReport[];
  servedBy: () => RpcEndpoint | null;
  subscribe: (listener: EndpointListener) => Unsubscribe;
  chainId: () => Promise<number>;
  blockNumber: () => Promise<bigint>;
  /** When block `block` was made, from its header. */
  blockTime: (block: bigint) => Promise<Date>;
  /** Balance of the native gas token, in its base units. */
  nativeBalance: (owner: Address) => Promise<bigint>;
  tokenBalance: (token: Address, owner: Address) => Promise<bigint>;
  tokenMetadata: (token: Address) => Promise<TokenMetadata>;
  /** Every configured token, read from its contract and checked against the network config. */
  readAssets: () => Promise<readonly Asset[]>;
}

function decodeQuantity(method: string): (result: unknown) => bigint {
  return (result) => {
    if (typeof result !== "string") throw new ChainError("badResponse", `${method} did not return a quantity`);
    return BigInt(result);
  };
}

function decodeData(method: string): (result: unknown) => string {
  return (result) => {
    if (typeof result !== "string") throw new ChainError("badResponse", `${method} did not return call data`);
    return result;
  };
}

const MS_PER_SECOND = 1000;

function decodeBlockTime(block: bigint): (result: unknown) => Date {
  return (result) => {
    const timestamp = typeof result === "object" && result !== null ? (result as { timestamp?: unknown }).timestamp : undefined;
    if (typeof timestamp !== "string") throw new ChainError("badResponse", `eth_getBlockByNumber returned no header for block ${block}`);
    return new Date(Number(BigInt(timestamp)) * MS_PER_SECOND);
  };
}

function ethCall(to: Address, data: string): RpcRequest {
  return { method: "eth_call", params: [{ to, data }, LATEST] };
}

export function createChainReader(network: NetworkConfig, rpc: RpcClient): ChainReader {
  async function callToken(token: Address, selector: string): Promise<string> {
    return rpc.call(ethCall(token, selector), decodeData(`eth_call ${selector} on ${token}`));
  }

  async function tokenMetadata(token: Address): Promise<TokenMetadata> {
    const [symbol, name, decimals] = await Promise.all([
      callToken(token, ERC20_SELECTOR.symbol),
      callToken(token, ERC20_SELECTOR.name),
      callToken(token, ERC20_SELECTOR.decimals),
    ]);
    return { symbol: decodeString(symbol), name: decodeString(name), decimals: decodeUint8(decimals) };
  }

  /** The config's claim about a token has to match its contract, or the asset is not used at all. */
  async function readAsset(token: TokenConfig): Promise<Asset> {
    const onChain = await tokenMetadata(token.address);
    if (onChain.symbol !== token.symbol) {
      throw new ChainError("assetMismatch", `${token.address} reports symbol ${onChain.symbol}, config says ${token.symbol}`);
    }
    if (onChain.decimals !== token.decimals) {
      throw new ChainError("assetMismatch", `${token.symbol} reports ${onChain.decimals} decimals, config says ${token.decimals}`);
    }
    return { symbol: onChain.symbol, name: onChain.name, kind: token.kind, decimals: onChain.decimals };
  }

  return {
    network: () => network,
    rpc,
    endpoints: rpc.endpoints,
    servedBy: rpc.servedBy,
    subscribe: rpc.subscribe,
    chainId: () =>
      rpc.call({ method: "eth_chainId", params: [] }, (result) => Number(decodeQuantity("eth_chainId")(result))),
    blockNumber: () => rpc.call({ method: "eth_blockNumber", params: [] }, decodeQuantity("eth_blockNumber")),
    blockTime: (block) =>
      rpc.call({ method: "eth_getBlockByNumber", params: [`0x${block.toString(16)}`, false] }, decodeBlockTime(block)),
    nativeBalance: (owner) =>
      rpc.call({ method: "eth_getBalance", params: [owner, LATEST] }, decodeQuantity("eth_getBalance")),
    tokenBalance: async (token, owner) =>
      decodeUint(await callToken(token, encodeAddressCall(ERC20_SELECTOR.balanceOf, owner))),
    tokenMetadata,
    readAssets: async () => Promise.all(network.tokens.map(readAsset)),
  };
}
