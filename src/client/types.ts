import type { Account, AccountSettings, ActivityEntry, Address, Asset, Holding, ViewKeyGrant } from "../domain/types";
import type { LadderTerm } from "../rules/ladder";

export type AccountListener = (account: Account) => void;
export type Unsubscribe = () => void;
export type SettingsPatch = Partial<AccountSettings>;

export interface DepositRequest {
  /** Address of a funding wallet on the account. */
  from: Address;
  /** Symbol of an asset that `assets()` lists. */
  asset: string;
  /** Denomination ladder steps. The deposit is their sum. */
  terms: readonly LadderTerm[];
  /** Must be `true` when the funding wallet's grade needs acknowledgement (C or D). */
  acknowledgeGrade?: boolean;
}

export interface FoldRequest {
  /** Addresses of burner wallets on the account that are not folded yet. */
  burners: readonly Address[];
}

export interface WithdrawalAmount {
  /** Symbol of an asset the account holds. */
  asset: string;
  /** Amount in base units. */
  amount: bigint;
}

export interface WithdrawRequest extends WithdrawalAmount {
  to: Address;
}

export interface WithdrawalQuote {
  holding: Holding;
  relayerFeeBps: number;
  fee: bigint;
  received: bigint;
}

export interface SetMeterReading {
  kEff: number;
  /** k_eff reaches K_EFF_UNLINKABLE_MIN. Below it the claim is un-copyability, not unlinkability. */
  unlinkable: boolean;
}

export interface ShareViewKeyRequest {
  holder: string;
}

export interface SharedViewKey {
  grant: ViewKeyGrant;
  /** The key string to give the holder. */
  key: string;
}

/**
 * What `createDecoy` runs on. Reads return the backend's local state and never block. Writes resolve once the account
 * reflects them. The client validates every request before it calls a write.
 */
export interface Backend {
  account: () => Account;
  subscribe: (listener: AccountListener) => Unsubscribe;
  assets: () => readonly Asset[];
  /** Relayer fee on withdrawals, in basis points. */
  relayerFeeBps: () => number;
  /** The Set Meter's current k_eff. */
  kEff: () => number;
  deposit: (holding: Holding, from: Address) => Promise<ActivityEntry>;
  withdraw: (holding: Holding, to: Address) => Promise<ActivityEntry>;
  fold: (burners: readonly Address[]) => Promise<ActivityEntry[]>;
  issueViewKey: (holder: string) => Promise<SharedViewKey>;
  revokeViewKey: (id: string) => Promise<ViewKeyGrant>;
  updateSettings: (patch: SettingsPatch) => Promise<AccountSettings>;
}

export interface ViewKeysApi {
  share: (request: ShareViewKeyRequest) => Promise<SharedViewKey>;
  /** Revokes the key and moves the account to the next epoch. */
  revoke: (id: string) => Promise<ViewKeyGrant>;
}

/**
 * The DECOY client. Reads are synchronous and come from local state. Writes are asynchronous and reject with a
 * DecoyError when a request breaks a rule. Every member is a plain function, safe to pass around unbound.
 */
export interface Decoy {
  account: () => Account;
  /** Calls the listener with the new account after every change. Returns a function that removes the listener. */
  subscribe: (listener: AccountListener) => Unsubscribe;
  assets: () => readonly Asset[];
  quoteWithdrawal: (request: WithdrawalAmount) => WithdrawalQuote;
  setMeter: () => SetMeterReading;
  deposit: (request: DepositRequest) => Promise<ActivityEntry>;
  fold: (request: FoldRequest) => Promise<ActivityEntry[]>;
  withdraw: (request: WithdrawRequest) => Promise<ActivityEntry>;
  viewKeys: ViewKeysApi;
  updateSettings: (patch: SettingsPatch) => Promise<AccountSettings>;
}
