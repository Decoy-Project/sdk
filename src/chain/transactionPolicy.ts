/**
 * How the SDK sends a transaction. ESTIMATE values, 24 Sep 2026: none of them is measured, and each is a trade between
 * paying for headroom and failing in front of the user.
 */
export const TRANSACTION_POLICY = {
  /** Gas added over `eth_estimateGas`, in percent, for state that moves between the estimate and the block. */
  gasMarginPercent: 20n,
  /** The fee cap covers a base fee this many times the current one, the usual EIP-1559 headroom. */
  baseFeeMultiplier: 2n,
  /** How often a sent transaction's receipt is asked for. Blocks come every ~103.5 ms (MEASURED 12 Sep 2026). */
  receiptPollMs: 500,
  /** How long a sent transaction may take to be mined before the client says it was not. */
  receiptTimeoutMs: 60_000,
} as const;
