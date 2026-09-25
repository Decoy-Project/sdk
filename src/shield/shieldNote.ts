import { MAX_LADDER_TERMS, sealMemo, type AccountKeys } from "@decoy/protocol";
import type { ChainReader } from "../chain/reader";
import { createSigner } from "../chain/signer";
import type { ShieldedNote } from "../domain/types";
import type { EvmKey } from "../keys/evm";
import { commitmentOf, epochKeysOf, nextCounter } from "./note";
import type { ShieldSetup } from "./setup";
import { depositNote, prepareShield, type ShieldParties, type ShieldStep } from "./shield";

/** Where the account's notes are kept. Nothing acts on a note that has not been saved. */
export interface NoteStore {
  notes: () => readonly ShieldedNote[];
  /** Saves `note` in place of the note with the same epoch and counter. Resolves once the save is durable. */
  put: (note: ShieldedNote) => Promise<void>;
  /** Forgets a note whose transaction was never mined. Resolves once the save is durable. */
  drop: (note: ShieldedNote) => Promise<void>;
}

export interface ShieldNotesRequest {
  readonly reader: ChainReader;
  readonly setup: ShieldSetup;
  readonly store: NoteStore;
  readonly account: AccountKeys;
  /** The epoch the new notes belong to: the account's current one. */
  readonly epoch: number;
  /** The address the value leaves from. It pays the gas. */
  readonly from: EvmKey;
  /** One note each: the amount the user chose, or the steps of the ladder they picked. */
  readonly amounts: readonly bigint[];
  readonly onStep: (step: ShieldStep) => void;
}

/** Refuses a deposit of no notes, of more notes than a leg takes, or of a note that holds nothing. */
function checkAmounts(amounts: readonly bigint[]): void {
  if (amounts.length === 0 || amounts.length > MAX_LADDER_TERMS) {
    throw new Error(`A deposit makes one to ${MAX_LADDER_TERMS} notes, not ${amounts.length}`);
  }
  const empty = amounts.find((amount) => amount <= 0n);
  if (empty !== undefined) throw new Error(`A note of ${empty} holds nothing`);
}

/** Makes the account's next note of `amount`, saves it as sending, deposits it, and saves it as pending. */
async function shieldOne(request: ShieldNotesRequest, parties: ShieldParties, amount: bigint): Promise<ShieldedNote> {
  const { reader, setup, store, account, epoch } = request;
  const counter = nextCounter(store.notes(), epoch);
  const asset = setup.token.address;
  const commitment = commitmentOf(account, epoch, counter, asset, amount);
  const memo = await sealMemo(epochKeysOf(account, epoch), BigInt(commitment), { counter, amount, asset: BigInt(asset) });
  const note: ShieldedNote = {
    epoch,
    counter,
    asset,
    amount,
    commitment,
    origin: "deposit",
    from: request.from.address,
    status: "sending",
    leafIndex: null,
    sentAfterBlock: await reader.blockNumber(),
    at: new Date(),
    exit: null,
  };
  await store.put(note);
  const result = await depositNote({ ...parties, amount, commitment, memo });
  const queued: ShieldedNote = { ...note, status: "pending", leafIndex: result.leafIndex };
  await store.put(queued);
  return queued;
}

/**
 * Shields `amounts` from `from` into one new note each: wraps and approves once for all of them, then deposits them one
 * by one. A failure after a note's first save leaves it as sending: if its deposit landed after all, the receiver's
 * next check finds it and moves it on. The notes deposited before a failure stay deposited.
 */
export async function shieldNotes(request: ShieldNotesRequest): Promise<ShieldedNote[]> {
  checkAmounts(request.amounts);
  const parties: ShieldParties = {
    reader: request.reader,
    signer: createSigner(request.reader, request.from),
    pool: request.setup.pool.address,
    token: request.setup.token,
    onStep: request.onStep,
  };
  await prepareShield(parties, request.amounts.reduce((sum, amount) => sum + amount, 0n));
  const notes: ShieldedNote[] = [];
  for (const amount of request.amounts) notes.push(await shieldOne(request, parties, amount));
  return notes;
}
