import type { AccountListener, Backend, SettingsPatch, SharedViewKey, Unsubscribe } from "../client/types";
import type { Account, AccountSettings, ActivityEntry, Address, Asset, Holding, ViewKeyGrant } from "../domain/types";
import { accountReducer, type AccountAction } from "../state/accountReducer";
import { mockViewKey } from "./mockViewKey";

/** What a memory backend starts from. None of it is read from a chain. */
export interface MemoryBackendState {
  account: Account;
  assets: readonly Asset[];
  /** Relayer fee on withdrawals, in basis points. */
  relayerFeeBps: number;
  /** The Set Meter reading this backend reports. */
  kEff: number;
}

function activityById(account: Account, id: string): ActivityEntry {
  const entry = account.activity.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Activity ${id} is missing after the account reducer ran`);
  return entry;
}

function grantById(account: Account, id: string): ViewKeyGrant {
  const grant = account.viewKeys.find((candidate) => candidate.id === id);
  if (!grant) throw new Error(`View key ${id} is missing after the account reducer ran`);
  return grant;
}

/** The entries of one fold: kind fold, stamped with that fold's time, counterparty among its burners. */
function foldEntries(account: Account, burners: readonly Address[], at: Date): ActivityEntry[] {
  return account.activity.filter(
    (entry) =>
      entry.kind === "fold" &&
      entry.at.getTime() === at.getTime() &&
      burners.some((address) => address === entry.counterparty),
  );
}

/**
 * A backend that holds the account in memory and changes it only through the account reducer. It serves demos, tests
 * and clients built before the DECOY contracts exist. A write changes the account and notifies listeners before its
 * promise resolves.
 */
export function memoryBackend(state: MemoryBackendState): Backend {
  let account = state.account;
  const listeners = new Set<AccountListener>();

  function commit(action: AccountAction): Account {
    account = accountReducer(account, action);
    for (const listener of listeners) listener(account);
    return account;
  }

  function subscribe(listener: AccountListener): Unsubscribe {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  async function deposit(holding: Holding, from: Address): Promise<ActivityEntry> {
    const id = crypto.randomUUID();
    return activityById(commit({ type: "deposit", holding, from, at: new Date(), id }), id);
  }

  async function withdraw(holding: Holding, to: Address): Promise<ActivityEntry> {
    const id = crypto.randomUUID();
    return activityById(commit({ type: "withdraw", holding, to, at: new Date(), id }), id);
  }

  async function fold(burners: readonly Address[]): Promise<ActivityEntry[]> {
    const at = new Date();
    return foldEntries(commit({ type: "fold", addresses: [...burners], at }), burners, at);
  }

  async function issueViewKey(holder: string): Promise<SharedViewKey> {
    const id = crypto.randomUUID();
    const next = commit({ type: "issueViewKey", holder, at: new Date(), id });
    return { grant: grantById(next, id), key: mockViewKey(id) };
  }

  async function revokeViewKey(id: string): Promise<ViewKeyGrant> {
    return grantById(commit({ type: "revokeViewKey", id, at: new Date() }), id);
  }

  async function updateSettings(patch: SettingsPatch): Promise<AccountSettings> {
    return commit({ type: "updateSettings", patch }).settings;
  }

  return {
    account: () => account,
    subscribe,
    assets: () => state.assets,
    relayerFeeBps: () => state.relayerFeeBps,
    kEff: () => state.kEff,
    deposit,
    withdraw,
    fold,
    issueViewKey,
    revokeViewKey,
    updateSettings,
  };
}
