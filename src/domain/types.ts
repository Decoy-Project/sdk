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

/** The funding-hygiene grader's inputs for one depositing address. */
export interface FundingWallet {
  address: Address;
  label: string;
  inboundEdges: number;
  ageDays: number;
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

export type SyncStatus = "synced" | "syncing" | "offline";

export interface SyncState {
  status: SyncStatus;
  block: bigint;
}

export type EscapeHatchState = "normal" | "frozen";

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
