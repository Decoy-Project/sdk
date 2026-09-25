import type { DepositRoom } from "../chain/pool";
import type { FeeQuote } from "../chain/signer";
import type { AmountMode } from "../domain/types";
import type { ShieldGas } from "../network/types";
import { MAX_LADDER_TERMS } from "../protocol/parameters";
import { largestTerms, termAmounts } from "../rules/ladder";

export interface ShieldPlan {
  /** One note per amount. */
  readonly amounts: readonly bigint[];
  readonly amount: bigint;
}

/** What an address holds and what the pool can take, as one check read them. */
export interface ShieldInput {
  readonly mode: AmountMode;
  readonly native: bigint;
  readonly wrapped: bigint;
  /** Native balance kept back for gas: see `gasReserve`. */
  readonly reserve: bigint;
  readonly ladderUnit: bigint;
  readonly room: DepositRoom;
}

/**
 * Native token kept back so the address can pay, at the fees quoted now, for wrapping and approving once and for a
 * deposit per note, as many as a shield may make.
 */
export function gasReserve(gas: ShieldGas, fees: FeeQuote): bigint {
  return (gas.wrap + gas.approve + BigInt(MAX_LADDER_TERMS) * gas.deposit) * fees.maxFeePerGas;
}

/** The wrapped balance, plus the native balance above the reserve, no more than the pool has room for. */
function shieldable({ native, wrapped, reserve, room }: ShieldInput): bigint {
  const spare = native > reserve ? native - reserve : 0n;
  const held = wrapped + spare;
  return held < room.total ? held : room.total;
}

/** The whole amount, as notes no larger than `noteCap`, as many as one shield may make. */
function anyAmounts(available: bigint, noteCap: bigint): bigint[] {
  const amounts: bigint[] = [];
  let left = noteCap > 0n ? available : 0n;
  while (left > 0n && amounts.length < MAX_LADDER_TERMS) {
    const amount = left < noteCap ? left : noteCap;
    amounts.push(amount);
    left -= amount;
  }
  return amounts;
}

/**
 * What an address can shield. In `any` mode, all of it, split only where a note would pass the note cap. In `ladder`
 * mode, the largest ladder amount of steps no larger than a note may hold. Null when nothing fits; what is left over
 * stays at the address, and a shield larger than one shield may make goes on at the next check.
 */
export function planShield(input: ShieldInput): ShieldPlan | null {
  const available = shieldable(input);
  const amounts =
    input.mode === "any"
      ? anyAmounts(available, input.room.note)
      : termAmounts(largestTerms(available, input.ladderUnit, input.room.note), input.ladderUnit);
  if (amounts.length === 0) return null;
  return { amounts, amount: amounts.reduce((sum, amount) => sum + amount, 0n) };
}
