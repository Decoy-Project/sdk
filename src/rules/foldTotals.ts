import type { BurnerWallet, Holding } from "../domain/types";

/** Sums the holdings of the given burners per asset symbol, in base units. */
export function sumBurnerHoldings(burners: readonly BurnerWallet[]): Holding[] {
  const totals = new Map<string, Holding>();
  for (const holding of burners.flatMap((burner) => burner.holdings)) {
    const current = totals.get(holding.asset.symbol);
    totals.set(holding.asset.symbol, current ? { ...current, amount: current.amount + holding.amount } : holding);
  }
  return [...totals.values()];
}
