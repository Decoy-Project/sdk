import type { Asset } from "../domain/types";
import { DENOMINATION_LADDER, MAX_LADDER_TERMS_PER_LEG } from "../protocol/parameters";

export type LadderTerm = number;

const LADDER: readonly number[] = DENOMINATION_LADDER;

export function isLadderTerm(value: number): boolean {
  return LADDER.includes(value);
}

export function canAddTerm(terms: readonly LadderTerm[]): boolean {
  return terms.length < MAX_LADDER_TERMS_PER_LEG;
}

/**
 * Total of the terms in base units. Mock: each ladder step is read as whole units of the chosen asset; the research
 * does not state the ladder's unit and it is not verified.
 */
export function termsTotal(terms: readonly LadderTerm[], asset: Asset): bigint {
  const whole = terms.reduce((sum, term) => sum + BigInt(term), 0n);
  return whole * 10n ** BigInt(asset.decimals);
}
