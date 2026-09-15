/**
 * Protocol parameters. ESTIMATE design values from DECOY's design research, 12 Sep 2026. The research notes are not part
 * of this repository.
 *
 * This file is the only definition site of these values in the TypeScript packages. A generated constants source shared
 * by circuit, contract and client does not exist yet. When it does, this file re-exports from it.
 */

/** Denomination ladder. The design research does not state the unit of a step, and the unit is not verified. */
export const DENOMINATION_LADDER = [10, 30, 100, 300, 1_000, 3_000, 10_000, 30_000, 100_000] as const;

/** Most ladder terms one deposit or withdrawal leg may use (constrained by in-circuit lookup). */
export const MAX_LADDER_TERMS_PER_LEG = 3;

/** Auto-churn: randomized exponential schedule. */
export const CHURN_SCHEDULE = {
  meanHours: 6,
  jitterPercent: 50,
} as const;

/** Full unlinkability against a clustering analyst needs k_eff at or above this; at k=1 the claim is un-copyability. */
export const K_EFF_UNLINKABLE_MIN = 5;
