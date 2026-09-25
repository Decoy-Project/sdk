import type { Account, AccountSettings } from "../domain/types";

/**
 * An account that holds nothing. This is what a client opens before the pool holds any of its notes, and it is the
 * truth rather than a placeholder: no holdings, no activity, no wallets, no view keys.
 */
export function emptyAccount(settings: AccountSettings): Account {
  return {
    epoch: 0,
    holdings: [],
    fundingWallets: [],
    burners: [],
    viewKeys: [],
    activity: [],
    sync: { status: "offline", block: 0n, endpoint: null },
    escapeHatch: "normal",
    settings,
  };
}
