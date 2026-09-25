import type { Address, Asset, AssetKind, EndpointId } from "../domain/types";
import type { PoolContracts } from "./generated/deployments";

/** A network DECOY runs on. One name per chain; every value for that chain lives in `NETWORKS[name]`. */
export type NetworkName = "robinhoodMainnet" | "robinhoodTestnet" | "robinhoodLocal";

export type { EndpointId };

export interface RpcEndpoint {
  readonly id: EndpointId;
  /** The URL requests go to. It can carry an API key, so it is never shown and never written to a log. */
  readonly url: string;
  /** The same URL with any secret masked. Everything a user or an error message shows uses this one. */
  readonly displayUrl: string;
}

/**
 * A token contract on one network. The address is the only value that cannot be read from the chain; `symbol` and
 * `decimals` are the claim the reader checks against the contract, and `kind` is DECOY's own classification, which no
 * contract carries. The display name always comes from the chain.
 */
export interface TokenConfig {
  readonly address: Address;
  readonly symbol: string;
  readonly decimals: number;
  readonly kind: AssetKind;
  /** The contract wraps the native gas token one to one: `deposit()` mints for the value sent. */
  readonly wrapsNative?: boolean;
  /**
   * Base units of one denomination ladder unit. A token without one cannot be shielded: an amount off the ladder would
   * mark its note.
   */
  readonly ladderUnit?: bigint;
}

/** Gas each step of shielding the native token uses, measured against this network's pool and wrapped token. */
export interface ShieldGas {
  readonly wrap: bigint;
  readonly approve: bigint;
  readonly deposit: bigint;
}

export interface NetworkConfig {
  readonly name: NetworkName;
  /** Human-readable chain name, for copy. */
  readonly label: string;
  readonly chainId: number;
  /** Fallback endpoint. Serves only when no user or Alchemy endpoint answers. */
  readonly publicRpcUrl: string;
  /** Alchemy's host for this chain. The SDK builds the endpoint URL from this host and the user's API key. */
  readonly alchemyHost: string;
  /** Native gas token of the chain. Not an ERC-20, so it carries no address. */
  readonly nativeAsset: Asset;
  readonly tokens: readonly TokenConfig[];
  /** The deployed pool, when there is one. A network without contracts has nothing shielded to read. */
  readonly contracts?: PoolContracts;
  /** Measured where the pool is deployed. A network without it cannot plan a shield. */
  readonly shieldGas?: ShieldGas;
  /** Gas the pool's `withdraw` uses, measured where the pool is deployed. A relayer quotes its fee from it. */
  readonly withdrawGas?: bigint;
  /** The ERC-5564 Announcer, where senders publish stealth payments. A network without one has no stealth receive. */
  readonly stealthAnnouncer?: Address;
  /**
   * The relayer DECOY runs for this network. A client sends withdrawals through it until the user names another, so a
   * new user can withdraw without finding one first (owner decision, 25 Sep 2026). Absent while DECOY runs none; the
   * user then names one.
   */
  readonly defaultRelayerUrl?: string;
}
