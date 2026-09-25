import {
  epochKeys,
  noteBlinding,
  noteCommitment,
  noteNullifierKey,
  ownerTag,
  type AccountKeys,
  type EpochKeys,
  type Field,
} from "@decoy/protocol";
import { bytes32Of } from "../chain/abi";
import type { Address, ShieldedNote } from "../domain/types";

/** What opens one note: its blinding, its own nullifier key, and the owner tag they make with the spend public key. */
export interface NoteSecrets {
  readonly blinding: Field;
  readonly noteNullifierKey: Field;
  readonly ownerTag: Field;
}

/** Epoch keys cost a handful of HKDF calls, and every note of an epoch needs the same ones. */
const EPOCHS = new WeakMap<AccountKeys, Map<number, EpochKeys>>();

export function epochKeysOf(account: AccountKeys, epoch: number): EpochKeys {
  let byEpoch = EPOCHS.get(account);
  if (!byEpoch) {
    byEpoch = new Map();
    EPOCHS.set(account, byEpoch);
  }
  let keys = byEpoch.get(epoch);
  if (!keys) {
    keys = epochKeys(account, epoch);
    byEpoch.set(epoch, keys);
  }
  return keys;
}

/** The secrets of the account's note number `counter` in epoch `epoch`. */
export function noteSecrets(account: AccountKeys, epoch: number, counter: number): NoteSecrets {
  const keys = epochKeysOf(account, epoch);
  const nullifierKey = noteNullifierKey(keys.nullifierKey, counter);
  return {
    blinding: noteBlinding(keys.viewKey, counter),
    noteNullifierKey: nullifierKey,
    ownerTag: ownerTag(account.spendPublicKey, nullifierKey),
  };
}

/** The commitment of the account's note number `counter` in epoch `epoch`: what the pool's queue records. */
export function commitmentOf(account: AccountKeys, epoch: number, counter: number, asset: Address, amount: bigint): `0x${string}` {
  const { blinding, ownerTag: tag } = noteSecrets(account, epoch, counter);
  return bytes32Of(noteCommitment({ asset: BigInt(asset), amount, blinding, ownerTag: tag }));
}

/** The counter the epoch's next note takes: one past the highest used in it, so a counter is never used twice. */
export function nextCounter(notes: readonly ShieldedNote[], epoch: number): number {
  const counters = notes.filter((note) => note.epoch === epoch).map((note) => note.counter);
  return counters.length === 0 ? 0 : Math.max(...counters) + 1;
}
