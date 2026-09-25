import type { Asset } from "../domain/types";
import { LADDER_STEPS, MAX_LADDER_TERMS } from "../protocol/parameters";

export type LadderTerm = number;

const LADDER: readonly number[] = LADDER_STEPS;

export function isLadderTerm(value: number): boolean {
  return LADDER.includes(value);
}

export function canAddTerm(terms: readonly LadderTerm[]): boolean {
  return terms.length < MAX_LADDER_TERMS;
}

/**
 * Total of the terms in base units. Mock: each ladder step is read as whole units of the chosen asset; the research
 * does not state the ladder's unit and it is not verified.
 */
export function termsTotal(terms: readonly LadderTerm[], asset: Asset): bigint {
  const whole = terms.reduce((sum, term) => sum + BigInt(term), 0n);
  return whole * 10n ** BigInt(asset.decimals);
}

/** Each term's amount: on the ladder, a deposit makes one note and a withdrawal one payment per term. */
export function termAmounts(terms: readonly LadderTerm[], ladderUnit: bigint): bigint[] {
  return terms.map((term) => ladderAmount([term], ladderUnit));
}

/** The amount `terms` add up to, in base units of an asset whose ladder unit is `ladderUnit`. */
export function ladderAmount(terms: readonly LadderTerm[], ladderUnit: bigint): bigint {
  return terms.reduce((sum, term) => sum + BigInt(term), 0n) * ladderUnit;
}

/** Every choice of `count` terms, repeats allowed, each list in descending order. */
function combinations(count: number, from: number = LADDER.length - 1): LadderTerm[][] {
  if (count === 0) return [[]];
  const lists: LadderTerm[][] = [];
  for (let index = from; index >= 0; index -= 1) {
    for (const rest of combinations(count - 1, index)) lists.push([LADDER[index], ...rest]);
  }
  return lists;
}

/**
 * The largest amount the ladder can make without passing `available`, as at most MAX_LADDER_TERMS terms, none above
 * `termCap`. Of two choices worth the same, the one with fewer terms wins: a single step blends with more deposits
 * than a sum does. An empty list means not even the smallest step fits.
 */
export function largestTerms(available: bigint, ladderUnit: bigint, termCap: bigint): LadderTerm[] {
  let best: LadderTerm[] = [];
  let bestAmount = 0n;
  for (let count = 1; count <= MAX_LADDER_TERMS; count += 1) {
    for (const terms of combinations(count)) {
      const amount = ladderAmount(terms, ladderUnit);
      if (terms.some((term) => ladderAmount([term], ladderUnit) > termCap)) continue;
      if (amount <= available && amount > bestAmount) {
        best = terms;
        bestAmount = amount;
      }
    }
  }
  return best;
}
