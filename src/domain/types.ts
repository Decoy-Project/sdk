/**
 * Domain vocabulary shared by the SDK and every DECOY client. Names follow the spec: note, epoch, view tier,
 * funding-hygiene grade.
 */

export type Address = `0x${string}`;

export type AssetKind = "stablecoin" | "crypto" | "stock";

export interface Asset {
  symbol: string;
  name: string;
  kind: AssetKind;
  decimals: number;
}

/** Amounts are integer base units, never floats. */
export interface Holding {
  asset: Asset;
  amount: bigint;
}

export type HygieneGrade = "A" | "B" | "C" | "D";

/** The funding-hygiene grader's inputs for one depositing address, and the grade it gave. */
export interface FundingWallet {
  address: Address;
  label: string;
  /** Distinct addresses that funded it, as far as the chain's logs show. */
  inboundEdges: number;
  /** Days since it was first funded, or null when the logs show no funding at all. */
  ageDays: number | null;
  singleSourceFunding: boolean;
  grade: HygieneGrade;
}

export interface BurnerWallet {
  address: Address;
  label: string;
  holdings: Holding[];
  lastActiveAt: Date;
  folded: boolean;
}

export type ViewTier = "viewAll";
export type ViewKeyStatus = "active" | "revoked";

export interface ViewKeyGrant {
  id: string;
  holder: string;
  tier: ViewTier;
  epoch: number;
  issuedAt: Date;
  status: ViewKeyStatus;
  revokedAt: Date | null;
}

export type ActivityKind = "deposit" | "withdraw" | "fold" | "churn" | "viewKeyIssued" | "viewKeyRevoked";
export type ActivityStatus = "pending" | "settled" | "failed";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  holding: Holding | null;
  counterparty: string | null;
  at: Date;
  status: ActivityStatus;
}

/** Where a note the account owns stands. */
export type NoteStatus =
  /** Written down before the transaction that queues it was sent, so a crash between the two loses nothing. */
  | "sending"
  /** Queued, and waiting for the tree to absorb it. Not spendable yet. */
  | "pending"
  /** In the tree: spendable. */
  | "settled"
  /** A transaction spending it was sent. Written down first, so a crash while it is out loses nothing. */
  | "spending"
  /** Retired, by a transaction or a claim. It holds nothing. */
  | "spent";

/** How a note came to be: shielded by a deposit, or created by a transaction, as its change. */
export type NoteOrigin = "deposit" | "transaction";

export type NoteExitKind = "withdrawal" | "claim" | "churn";

interface ExitRecord {
  /** What the recipient is paid; for a churn, what the new note holds. */
  received: bigint;
  /** What the relayer is paid. A claim pays none. */
  fee: bigint;
  /** The transaction that made it, once it is known. */
  transaction: `0x${string}` | null;
  at: Date;
}

/**
 * What spending a note did, kept on the first note a transaction spends: value paid out to a recipient, by a withdrawal
 * or a claim, or value moved into a new note of the account by a churn, which pays only the relayer.
 */
export type NoteExit =
  | (ExitRecord & { kind: "withdrawal" | "claim"; recipient: Address })
  | (ExitRecord & { kind: "churn"; /** A churn pays no one: its value stays in the pool. */ recipient: null });

/**
 * A note the account owns. Its secrets are not stored here: they are derived again from the recovery phrase, its epoch
 * and its counter, so a note can always be found from the phrase alone.
 */
export interface ShieldedNote {
  /** The key epoch it belongs to: its secrets come from that epoch's keys. */
  epoch: number;
  /** Its number within the epoch. Each counter is one note. */
  counter: number;
  asset: Address;
  amount: bigint;
  commitment: `0x${string}`;
  origin: NoteOrigin;
  /** The address a deposit came from. Null for a note a transaction created. */
  from: Address | null;
  status: NoteStatus;
  /** Its place in the pool's queue, which is its place in the tree, once the transaction that queued it is mined. */
  leafIndex: bigint | null;
  /** A block from before the transaction that queues it was sent: where a search for it starts. */
  sentAfterBlock: bigint;
  at: Date;
  /** Value paid out when this note was spent, if its spending paid any out. */
  exit: NoteExit | null;
}

export type SyncStatus = "synced" | "syncing" | "offline";

/**
 * Where an endpoint URL came from. It is domain vocabulary because a privacy client shows the user which party answered
 * its queries, and never hides a failover behind a single label.
 */
export type EndpointId = "user" | "alchemy" | "public";

export interface SyncState {
  status: SyncStatus;
  block: bigint;
  /** The endpoint that served the height. Null before the first successful read. */
  endpoint: EndpointId | null;
}

export type EscapeHatchState = "normal" | "frozen";

/**
 * How an amount becomes notes or payments: any amount, or steps of the ladder, which blend with other amounts on chain.
 * The ladder is an option (owner decision, 25 Sep 2026).
 */
export type AmountMode = "any" | "ladder";

export interface AccountSettings {
  rpcUrl: string;
  autoLockMinutes: number;
  autoChurn: boolean;
}

export interface Account {
  epoch: number;
  holdings: Holding[];
  fundingWallets: FundingWallet[];
  burners: BurnerWallet[];
  viewKeys: ViewKeyGrant[];
  activity: ActivityEntry[];
  sync: SyncState;
  escapeHatch: EscapeHatchState;
  settings: AccountSettings;
}
