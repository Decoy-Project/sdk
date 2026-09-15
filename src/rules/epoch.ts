/** Revoking a view key moves the account to the next epoch. The revoked key keeps only what it already saw. */
export function nextEpoch(epoch: number): number {
  return epoch + 1;
}
