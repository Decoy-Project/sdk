/** Basis points in one whole. */
export const BPS_DENOMINATOR = 10_000n;

export function relayerFee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps)) / BPS_DENOMINATOR;
}
