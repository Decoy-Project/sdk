import type { Account, Address, Asset, Holding, ActivityEntry, AccountSettings } from "../domain/types";
import { nextEpoch } from "../rules/epoch";

export type AccountAction =
  | { type: "deposit"; holding: Holding; from: Address; at: Date; id: string }
  | { type: "withdraw"; holding: Holding; to: Address; at: Date; id: string }
  | { type: "fold"; addresses: Address[]; at: Date }
  | { type: "issueViewKey"; holder: string; at: Date; id: string }
  | { type: "revokeViewKey"; id: string; at: Date }
  | { type: "updateSettings"; patch: Partial<AccountSettings> };

function sameAsset(a: Asset, b: Asset): boolean {
  return a.symbol === b.symbol;
}

function addHolding(holdings: readonly Holding[], added: Holding): Holding[] {
  const existing = holdings.find((h) => sameAsset(h.asset, added.asset));
  if (!existing) return [...holdings, added];
  return holdings.map((h) => (h === existing ? { ...h, amount: h.amount + added.amount } : h));
}

function subtractHolding(holdings: readonly Holding[], removed: Holding): Holding[] {
  const existing = holdings.find((h) => sameAsset(h.asset, removed.asset));
  if (!existing || existing.amount < removed.amount) {
    throw new Error(`Insufficient ${removed.asset.symbol}: cannot remove ${removed.amount}`);
  }
  return holdings
    .map((h) => (h === existing ? { ...h, amount: h.amount - removed.amount } : h))
    .filter((h) => h.amount > 0n);
}

function prependActivity(account: Account, entry: ActivityEntry): ActivityEntry[] {
  return [entry, ...account.activity];
}

function fold(account: Account, addresses: readonly Address[], at: Date): Account {
  const selected = account.burners.filter((b) => addresses.includes(b.address) && !b.folded);
  if (selected.length !== addresses.length) throw new Error("Fold selection contains unknown or already folded burners");
  const holdings = selected.flatMap((b) => b.holdings).reduce(addHolding, account.holdings);
  const entries: ActivityEntry[] = selected.flatMap((b) =>
    b.holdings.map((h, index) => ({
      id: `fold-${b.address}-${index}-${at.getTime()}`,
      kind: "fold" as const,
      holding: h,
      counterparty: b.address,
      at,
      status: "pending" as const,
    })),
  );
  return {
    ...account,
    holdings,
    burners: account.burners.map((b) => (addresses.includes(b.address) ? { ...b, folded: true } : b)),
    activity: [...entries, ...account.activity],
  };
}

function revokeViewKey(account: Account, id: string, at: Date): Account {
  const grant = account.viewKeys.find((k) => k.id === id);
  if (!grant || grant.status === "revoked") throw new Error(`View key ${id} is unknown or already revoked`);
  const epoch = nextEpoch(account.epoch);
  return {
    ...account,
    epoch,
    viewKeys: account.viewKeys.map((k) => (k.id === id ? { ...k, status: "revoked", revokedAt: at } : k)),
    activity: [
      { id: `churn-${at.getTime()}`, kind: "churn", holding: null, counterparty: null, at, status: "pending" },
      { id: `revoke-${id}`, kind: "viewKeyRevoked", holding: null, counterparty: grant.holder, at, status: "settled" },
      ...account.activity,
    ],
  };
}

/** Pure state transitions for the mock account. Every invalid action throws. */
export function accountReducer(account: Account, action: AccountAction): Account {
  switch (action.type) {
    case "deposit":
      return {
        ...account,
        activity: prependActivity(account, {
          id: action.id, kind: "deposit", holding: action.holding, counterparty: action.from, at: action.at, status: "pending",
        }),
      };
    case "withdraw":
      return {
        ...account,
        holdings: subtractHolding(account.holdings, action.holding),
        activity: prependActivity(account, {
          id: action.id, kind: "withdraw", holding: action.holding, counterparty: action.to, at: action.at, status: "pending",
        }),
      };
    case "fold":
      return fold(account, action.addresses, action.at);
    case "issueViewKey":
      return {
        ...account,
        viewKeys: [
          { id: action.id, holder: action.holder, tier: "viewAll", epoch: account.epoch, issuedAt: action.at, status: "active", revokedAt: null },
          ...account.viewKeys,
        ],
        activity: prependActivity(account, {
          id: `issue-${action.id}`, kind: "viewKeyIssued", holding: null, counterparty: action.holder, at: action.at, status: "settled",
        }),
      };
    case "revokeViewKey":
      return revokeViewKey(account, action.id, action.at);
    case "updateSettings":
      return { ...account, settings: { ...account.settings, ...action.patch } };
  }
}
