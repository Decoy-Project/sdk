/** Generated from apps/protocol by constants/generate-sdk.mts. Do not edit. */
import type { Address } from "../../domain/types";

export interface PoolContracts {
  readonly pool: Address;
  readonly transactVerifier: Address;
  readonly insertVerifier: Address;
  /**
   * The block the pool was deployed in: no log of it is older, so every read of its logs starts here. Null for a
   * deployment written before the deploy script recorded it, whose logs cannot be read.
   */
  readonly deployedBlock: bigint | null;
}

export interface Deployment {
  readonly chainId: number;
  readonly rpcUrl: string;
  /** The root of an empty tree, which the pool was deployed with. */
  readonly emptyRoot: `0x${string}`;
  readonly contracts: PoolContracts;
}

export const DEPLOYMENTS = {
  robinhoodLocal: {
    chainId: 4663,
    rpcUrl: "http://127.0.0.1:8545",
    emptyRoot: "0x1c8c3ca0b3a3d75850fcd4dc7bf1e3445cd0cfff3ca510630fd90b47e8a24755",
    contracts: {
      pool: "0x4d1338fa46ca6060f1472b70599cc635ad275eda",
      transactVerifier: "0x8659df1c638cda8e475cd3c6481730c2b4f85873",
      insertVerifier: "0x1f9c84b161b2c7ffb540bc5354543108cce37df1",
      deployedBlock: null,
    },
  },
  robinhoodMainnet: {
    chainId: 4663,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    emptyRoot: "0x1c8c3ca0b3a3d75850fcd4dc7bf1e3445cd0cfff3ca510630fd90b47e8a24755",
    contracts: {
      pool: "0xe0ebe2910f41b1c7916b7d8ea39129fa4ea68310",
      transactVerifier: "0x03c528d098cf530d7b0a0507ab0e7d8fb66cb6b3",
      insertVerifier: "0x60a02b5dcd0b8874934e712b2855544c0c3b9c6c",
      deployedBlock: 72268970n,
    },
  },
  robinhoodTestnet: {
    chainId: 46630,
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    emptyRoot: "0x1c8c3ca0b3a3d75850fcd4dc7bf1e3445cd0cfff3ca510630fd90b47e8a24755",
    contracts: {
      pool: "0x69810f455f17df50fd00a92cf5bdfede5fa6ab92",
      transactVerifier: "0x566ac2a7cc2d0d8f5be77e9e171a11665110a4c4",
      insertVerifier: "0xeda82dfb0e3ed44035319dd742c6ff36bb7078ce",
      deployedBlock: 123739421n,
    },
  },
} as const satisfies Record<string, Deployment>;

/** topic0 of each pool event, from the compiled ABI. */
export const POOL_EVENT_TOPIC = {
  Absorbed: "0xfe17d87bb4b57ebff7c1089d3841d7822785308e39afd62d829da4787b96be6b",
  Claimed: "0x3d59181182c132af5e90bd1fc54520f013caa8445af7a084b97f0b722edec070",
  Deposited: "0x1599c0fcf897af5babc2bfcf707f5dc050f841b044d97c3251ecec35b9abf80b",
  Frozen: "0x4d69b51fee53c28bd8b61fe008151577ca65160b5248f6225e74d64fd4cf7328",
  Queued: "0xda9a6a711266c9a6d63d6d8717035b7281de3417de2a32d22f878823d2e48914",
  Transacted: "0x838b99f1da1bf47ea4f138ece09d3ba350a4fe12d0c344f57097589c2ea1923a",
} as const;

/** The first four bytes of each pool function the client calls. */
export const POOL_SELECTOR = {
  absorb: "0x02fed7f5",
  absorbedCount: "0xe9c245b9",
  claim: "0x92f68116",
  context: "0xd0496d6a",
  currentRoot: "0xfdab463d",
  deposit: "0x17c224e8",
  frozen: "0x054f7d9c",
  isKnownRoot: "0x6d9833e3",
  noteCap: "0xdfbcebf1",
  nullifierSpent: "0x38c86911",
  pendingDeposits: "0xeb3349b9",
  queueLength: "0xab91c7b0",
  shieldedSupply: "0x2c907208",
  supplyCap: "0x05d79c14",
  transact: "0x8f7831ff",
} as const;

/** The first four bytes of each error the pool reverts with, so a revert can be named. */
export const POOL_ERROR = {
  AboveNoteCap: "0x82be6e2e",
  AbovePoolCap: "0x38b5c421",
  AmountOutOfRange: "0xc64200e9",
  AssetNotAccepted: "0xd57588cf",
  CapsMisconfigured: "0xa09d0597",
  CommitmentIsZero: "0x1af0bc32",
  GuardianIsZero: "0xb775316f",
  InverseFailed: "0xb897e2cc",
  LeafCountWrong: "0xb3781ee8",
  LeavesDoNotMatchChain: "0x8b052eeb",
  MemoWrongSize: "0x2662bfac",
  NotAFieldElement: "0xeac0b3d9",
  NotGuardian: "0xef6d0f02",
  NotSigned: "0xa72952d8",
  NotThisNote: "0x6a020721",
  NothingToAbsorb: "0x1a0632fe",
  NullifierAlreadySpent: "0xb115d857",
  PoolFrozen: "0xfd4851e9",
  PoolNotFrozen: "0xae5330fb",
  PoolWouldBeInsolvent: "0x69249458",
  ProofRejected: "0xc3b0d8cd",
  TransferFailed: "0x90b8ec18",
  UnknownRoot: "0x8c520116",
} as const;
