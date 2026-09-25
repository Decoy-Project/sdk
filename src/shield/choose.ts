import { TRANSACT_INPUTS } from "@decoy/protocol";
import type { Address, ShieldedNote } from "../domain/types";

/**
 * The notes a payment of `needed` (the amount and the fee) spends: the one settled note of `asset` that covers it with
 * the least left over, or else the pair that does. Null when no transaction of at most `TRANSACT_INPUTS` notes covers
 * it: the notes must be merged first, or the payment made in parts.
 */
export function chooseNotes(notes: readonly ShieldedNote[], asset: Address, needed: bigint): readonly ShieldedNote[] | null {
  const spendable = notes.filter(
    (note) => note.status === "settled" && note.amount > 0n && note.asset.toLowerCase() === asset.toLowerCase(),
  );
  let best: readonly ShieldedNote[] | null = null;
  let bestLeft: bigint | null = null;
  const consider = (candidate: readonly ShieldedNote[]) => {
    const left = candidate.reduce((sum, note) => sum + note.amount, 0n) - needed;
    if (left < 0n) return;
    if (bestLeft === null || candidate.length < (best?.length ?? Infinity) || (candidate.length === best?.length && left < bestLeft)) {
      best = candidate;
      bestLeft = left;
    }
  };
  for (const note of spendable) consider([note]);
  if (best === null && TRANSACT_INPUTS >= 2) {
    for (let i = 0; i < spendable.length; i += 1) {
      for (let j = i + 1; j < spendable.length; j += 1) consider([spendable[i], spendable[j]]);
    }
  }
  return best;
}

/** The most one transaction can pay out of the account's settled notes of `asset`, before the fee. */
export function largestPayment(notes: readonly ShieldedNote[], asset: Address): bigint {
  const amounts = notes
    .filter((note) => note.status === "settled" && note.asset.toLowerCase() === asset.toLowerCase())
    .map((note) => note.amount)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return amounts.slice(0, TRANSACT_INPUTS).reduce((sum, amount) => sum + amount, 0n);
}

/**
 * The notes each payment of a withdrawal spends, one transaction per ladder step: for each step, the notes
 * `chooseNotes` picks to cover it and its fee, out of those no other step took. The largest step is planned first, so
 * it gets the closest fit. Null when some step finds no notes: the withdrawal must be smaller, or wait for change to
 * settle.
 */
export function planWithdrawal(
  notes: readonly ShieldedNote[],
  asset: Address,
  amounts: readonly bigint[],
  fee: bigint,
): (readonly ShieldedNote[])[] | null {
  const order = amounts.map((amount, index) => ({ amount, index })).sort((a, b) => Number(b.amount - a.amount));
  const plan: (readonly ShieldedNote[])[] = [];
  let free = notes;
  for (const { amount, index } of order) {
    const chosen = chooseNotes(free, asset, amount + fee);
    if (!chosen) return null;
    plan[index] = chosen;
    free = free.filter((note) => !chosen.includes(note));
  }
  return plan;
}
