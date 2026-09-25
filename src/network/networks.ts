import { DEPLOYMENTS } from "./generated/deployments";
import type { NetworkConfig, NetworkName, ShieldGas } from "./types";

/**
 * The single definition site of every chain value, endpoint and contract address the TypeScript packages use. Nothing in
 * this file is repeated in a client, a test or a script; a consumer that needs one of these values imports it from here.
 *
 * Provenance of every value below: MEASURED 20 Sep 2026 by direct JSON-RPC call against the public endpoint —
 * `eth_chainId` for the chain id, and `symbol()`, `name()` and `decimals()` on each token contract. Re-measuring is a
 * one-line change per value.
 */

/**
 * One ladder unit of WETH: 0.001 ETH, so the ladder runs 0.01, 0.03, 0.1 … 100 ETH. ESTIMATE, 24 Sep 2026: the design
 * research never stated the ladder's unit; this one puts the smallest step at an amount a person moves.
 */
const WETH_LADDER_UNIT = 10n ** 15n;

/**
 * The ERC-5564 Announcer at its canonical address. MEASURED 24 Sep 2026: code sits there on mainnet and on the testnet,
 * with 17 and 7 announcements in the whole history of each, each history read in one `eth_getLogs` from block 0.
 */
const STEALTH_ANNOUNCER = "0x55649e01b5df198d18d95b5cc5051630cfd45564";

/**
 * MEASURED 25 Sep 2026 on the testnet itself: gas used by the testnet WETH's `deposit()` and `approve` (blocks
 * 123,729,739 and 123,729,741), and by the first deposit into the pool, which writes its empty slots and carries a
 * 57-byte memo (block 123,739,639, pool 0x69810f45…). A later deposit used 98,371. The chain adds its L1 calldata charge.
 * Re-measure when the calldata subsidy ends.
 */
const TESTNET_SHIELD_GAS: ShieldGas = { wrap: 55_655n, approve: 53_549n, deposit: 176_347n };

/**
 * MEASURED 25 Sep 2026 on the testnet itself, block 123,739,803: a transaction through the relayer that spent one note,
 * paid 0.001234 WETH to a fresh recipient and queued a change note, with a proof bb.js made in the SDK. It includes the
 * L1 calldata the chain charges. Re-measure when the calldata subsidy ends.
 */
const TESTNET_WITHDRAW_GAS = 4_092_896n;

/** Robinhood Chain mainnet. A testnet exists at chainId 46630 (research/02-rh-chain-landscape.md); its endpoint is not
 *  verified, so it is not configured here. */
export const ROBINHOOD_MAINNET: NetworkConfig = {
  name: "robinhoodMainnet",
  label: "Robinhood Chain",
  chainId: 4663,
  publicRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  /** MEASURED 20 Sep 2026: this host answers `Must be authenticated!` to an unauthenticated request, as Alchemy's
   *  other chain hosts do. No other candidate host resolved. */
  alchemyHost: "robinhood-mainnet.g.alchemy.com",
  /** The chain's gas token. REPORTED: research/02-rh-chain-landscape.md — every deployed pool on this chain denominates
   *  in ETH. `eth_getBalance` returns base units of this asset. */
  nativeAsset: { symbol: "ETH", name: "Ether", kind: "crypto", decimals: 18 },
  /**
   * Tokens DECOY reads. Not the chain's full list: the chain carries 190+ tokenized equities (research/02), and
   * enumerating all of them needs full-history log access over the stock-token registry
   * `0xe10b6f6b275de231345c20d14ab812db62151b00`, which the public endpoint rate-limits.
   *
   * MEASURED 20 Sep 2026: every ERC-20 `Transfer` log over the 3,000 blocks ending at block 67,822,891 was collected,
   * each contract was read through `symbol()`, `name()` and `decimals()`, and the twelve most transferred tokenized
   * equities in that window are listed here. `readAssets` re-checks each symbol and decimals against its contract.
   */
  stealthAnnouncer: STEALTH_ANNOUNCER,
  /** A test pool, deployed by the owner on 25 Sep 2026 with caps of 0.05 WETH a note and 0.2 WETH in all. */
  contracts: DEPLOYMENTS.robinhoodMainnet.contracts,
  /**
   * ESTIMATE, 25 Sep 2026, until the first shield on mainnet is measured. The approve is mainnet's own: `eth_estimateGas`
   * for a fresh allowance on its WETH, 54,220 at block 72,196,387. The wrap and the pool deposit are the testnet's, from
   * the same pool contract. Mainnet's WETH is a proxy: `eth_estimateGas` put its `deposit()` at 40,918 from a holder that
   * already had WETH, and a fresh receive address also writes its balance slot.
   */
  shieldGas: { ...TESTNET_SHIELD_GAS, approve: 54_220n },
  /** ESTIMATE, 25 Sep 2026: the testnet's withdrawal, from the same pool contract, until one on mainnet is measured. */
  withdrawGas: TESTNET_WITHDRAW_GAS,
  tokens: [
    { address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", decimals: 6, kind: "stablecoin" },
    /* MEASURED 24 Sep 2026: a proxy whose implementation `0xc6b81b429797e0f555440b70cd99e032d7ae947e` carries the
       `deposit()` and `withdraw(uint256)` selectors. */
    {
      address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
      symbol: "WETH",
      decimals: 18,
      kind: "crypto",
      wrapsNative: true,
      ladderUnit: WETH_LADDER_UNIT,
    },
    { address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", symbol: "AAPL", decimals: 18, kind: "stock" },
    { address: "0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e", symbol: "GLD", decimals: 18, kind: "stock" },
    { address: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", symbol: "GOOGL", decimals: 18, kind: "stock" },
    { address: "0x8005d266423c7ea827372c9c864491e5786600ea", symbol: "LLY", decimals: 18, kind: "stock" },
    { address: "0x329fcaceb9ad6f9580dd5f643fed0646900d043c", symbol: "LMT", decimals: 18, kind: "stock" },
    { address: "0xc0d6457c16cc70d6790dd43521c899c87ce02f35", symbol: "META", decimals: 18, kind: "stock" },
    { address: "0xec262a75e413fafd0df80480274532c79d42da09", symbol: "MSTR", decimals: 18, kind: "stock" },
    { address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", symbol: "NVDA", decimals: 18, kind: "stock" },
    { address: "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a", symbol: "PLTR", decimals: 18, kind: "stock" },
    { address: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea", symbol: "SPCX", decimals: 18, kind: "stock" },
    { address: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", symbol: "SPY", decimals: 18, kind: "stock" },
    { address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", symbol: "TSLA", decimals: 18, kind: "stock" },
  ],
} as const;

/**
 * A local anvil fork of the chain, with the pool deployed on it. The addresses come from `apps/protocol/deployments`,
 * written by the deploy script, so no address is typed here.
 */
export const ROBINHOOD_LOCAL: NetworkConfig = {
  name: "robinhoodLocal",
  label: "Robinhood Chain, local fork",
  chainId: DEPLOYMENTS.robinhoodLocal.chainId,
  publicRpcUrl: DEPLOYMENTS.robinhoodLocal.rpcUrl,
  alchemyHost: ROBINHOOD_MAINNET.alchemyHost,
  nativeAsset: ROBINHOOD_MAINNET.nativeAsset,
  tokens: ROBINHOOD_MAINNET.tokens,
  contracts: DEPLOYMENTS.robinhoodLocal.contracts,
} as const;

/**
 * Robinhood Chain testnet, with the pool deployed on it. MEASURED 20 Sep 2026: `rpc.testnet.chain.robinhood.com`
 * reports chainId 46630, which is the testnet id research/02-rh-chain-landscape.md recorded on 12 Sep 2026.
 *
 * Its token list is the wrapped native token only. MEASURED 24 Sep 2026: every ERC-20 `Transfer` log over the 20,000
 * blocks ending at block 123,479,885 was collected (2,696 contracts); the one whose `symbol()` is WETH and whose `name()`
 * is "Wrapped Ether (testnet)" carries `deposit()` and `withdraw(uint256)`, and its `totalSupply()` equals the ether it
 * holds. The testnet's other tokens are many unrelated deployments of the same symbols, so none is listed.
 */
export const ROBINHOOD_TESTNET: NetworkConfig = {
  name: "robinhoodTestnet",
  label: "Robinhood Chain testnet",
  chainId: DEPLOYMENTS.robinhoodTestnet.chainId,
  publicRpcUrl: DEPLOYMENTS.robinhoodTestnet.rpcUrl,
  /** MEASURED 24 Sep 2026: answers `eth_chainId` with 46630. The mainnet host answers 4663, and the client refuses it. */
  alchemyHost: "robinhood-testnet.g.alchemy.com",
  nativeAsset: ROBINHOOD_MAINNET.nativeAsset,
  tokens: [
    {
      address: "0xd33de4d258d964b19ac83f4c80d81a0689a9d757",
      symbol: "WETH",
      decimals: 18,
      kind: "crypto",
      wrapsNative: true,
      ladderUnit: WETH_LADDER_UNIT,
    },
  ],
  contracts: DEPLOYMENTS.robinhoodTestnet.contracts,
  shieldGas: TESTNET_SHIELD_GAS,
  withdrawGas: TESTNET_WITHDRAW_GAS,
  stealthAnnouncer: STEALTH_ANNOUNCER,
} as const;

export const NETWORKS: Readonly<Record<NetworkName, NetworkConfig>> = {
  robinhoodMainnet: ROBINHOOD_MAINNET,
  robinhoodTestnet: ROBINHOOD_TESTNET,
  robinhoodLocal: ROBINHOOD_LOCAL,
} as const;

/** The network every client opens by default. */
export const DEFAULT_NETWORK: NetworkName = "robinhoodMainnet";
