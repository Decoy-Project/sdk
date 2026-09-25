/**
 * Protocol parameters. ESTIMATE design values from DECOY's design research, 12 Sep 2026. The research notes are not part
 * of this repository.
 *
 * This file is the only definition site of these values in the TypeScript packages. The values that the circuits and the
 * contracts also check come from `apps/protocol/constants/protocol.json` through `@decoy/protocol`, and are re-exported
 * here.
 */

/** The ladder is a protocol constant: the pool checks it, so it is defined in constants/protocol.json. */
export { LADDER_STEPS, MAX_LADDER_TERMS } from "@decoy/protocol";

/** Auto-churn: randomized exponential schedule. */
export const CHURN_SCHEDULE = {
  meanHours: 6,
  jitterPercent: 50,
} as const;

/** Full unlinkability against a clustering analyst needs k_eff at or above this; at k=1 the claim is un-copyability. */
export const K_EFF_UNLINKABLE_MIN = 5;

/**
 * Where the funding-hygiene grades begin. ESTIMATE, 24 Sep 2026: the research names the signals (inbound edges, age,
 * single-source funding) and not the cut-offs. A wallet the logs cannot age counts as new.
 */
export const HYGIENE_GRADE_THRESHOLDS = {
  /** A: funded from many places, long ago. */
  a: { minInboundEdges: 5, minAgeDays: 90 },
  /** B: funded from more than one place, not recently. */
  b: { minInboundEdges: 2, minAgeDays: 30 },
} as const;
