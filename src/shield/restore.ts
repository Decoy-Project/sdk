import { viewTierOf, type AccountKeys } from "@decoy/protocol";
import type { PoolReader } from "../chain/pool";
import type { ChainReader } from "../chain/reader";
import type { NoteExit, ShieldedNote } from "../domain/types";
import { readPoolHistory, viewEpoch, type EpochView, type ViewedNote } from "./view";

/**
 * How many epochs in a row a restore reads past the last one that holds a note. An epoch is left without a note only
 * when a revoke found nothing to churn into it, so this is how many revokes of an empty account in a row a restore
 * sees past. ESTIMATE, 24 Sep 2026: no account has revoked yet.
 */
export const RESTORE_POLICY = { lookaheadEpochs: 5 } as const;

export interface RestoreRequest {
  readonly reader: ChainReader;
  readonly pool: PoolReader;
  readonly account: AccountKeys;
}

export interface RestoredAccount {
  /** Every note found, in epoch and counter order, as the vault keeps them. */
  readonly notes: readonly ShieldedNote[];
  /**
   * The epoch the account continues in: the last one the restore read. Which epoch keys were handed out is not in the
   * phrase, so the account moves past every epoch a revoke of an empty account could have left, and the next restore
   * still reaches it.
   */
  readonly epoch: number;
  /** Leaves that opened under one of the account's keys without being its notes. See `EpochView.mismatched`. */
  readonly mismatched: readonly bigint[];
}

/** Reads the account's epochs in order until `lookaheadEpochs` in a row hold no note. */
async function readEpochs(account: AccountKeys, pool: PoolReader): Promise<{ views: EpochView[]; lastRead: number }> {
  const history = await readPoolHistory(pool);
  const views: EpochView[] = [];
  let lastWithNotes = -1;
  let epoch = 0;
  for (; epoch - lastWithNotes <= RESTORE_POLICY.lookaheadEpochs; epoch += 1) {
    const view = await viewEpoch(viewTierOf(account, epoch), history);
    views.push(view);
    if (view.notes.length > 0) lastWithNotes = epoch;
  }
  return { views, lastRead: epoch - 1 };
}

/** The time of each block, read once each. */
async function blockTimes(reader: ChainReader, blocks: readonly bigint[]): Promise<(block: bigint) => Date> {
  const unique = [...new Set(blocks)];
  const times = new Map(await Promise.all(unique.map(async (block) => [block, await reader.blockTime(block)] as const)));
  return (block) => {
    const time = times.get(block);
    if (!time) throw new Error(`Block ${block} was not read`);
    return time;
  };
}

/**
 * What a spend did, kept on the note as the account's own client keeps it: on the transaction's first input only. A
 * transaction that paid no one was a churn, and `received` is what its new note holds: the notes it spent, less its fee.
 */
function exitOf(note: ViewedNote, moved: (transaction: `0x${string}`) => bigint, timeOf: (block: bigint) => Date): NoteExit | null {
  const spend = note.spentBy;
  if (spend === null) return null;
  if (spend.kind === "claim") {
    const claim = spend.event;
    return {
      kind: "claim",
      recipient: claim.recipient,
      received: claim.amount,
      fee: 0n,
      transaction: claim.transaction,
      at: timeOf(claim.block),
    };
  }
  const paid = spend.event;
  if (!spend.first) return null;
  const record = { fee: paid.fee, transaction: paid.transaction, at: timeOf(paid.block) };
  if (paid.exitAmount === 0n) return { kind: "churn", recipient: null, received: moved(paid.transaction) - paid.fee, ...record };
  return { kind: "withdrawal", recipient: paid.recipient, received: paid.exitAmount, ...record };
}

/** What the account's notes put into each transaction, by transaction hash. */
function spentInto(notes: readonly ViewedNote[]): (transaction: `0x${string}`) => bigint {
  const totals = new Map<string, bigint>();
  for (const note of notes) {
    if (note.spentBy?.kind !== "transaction") continue;
    const key = note.spentBy.event.transaction.toLowerCase();
    totals.set(key, (totals.get(key) ?? 0n) + note.amount);
  }
  return (transaction) => totals.get(transaction.toLowerCase()) ?? 0n;
}

function shieldedNoteOf(
  note: ViewedNote,
  moved: (transaction: `0x${string}`) => bigint,
  timeOf: (block: bigint) => Date,
): ShieldedNote {
  return {
    epoch: note.epoch,
    counter: note.counter,
    asset: note.asset,
    amount: note.amount,
    commitment: note.commitment,
    origin: note.origin,
    from: null,
    status: note.status,
    leafIndex: note.leafIndex,
    sentAfterBlock: note.block,
    at: timeOf(note.block),
    exit: exitOf(note, moved, timeOf),
  };
}

/**
 * Finds every note of the account from its phrase alone: each epoch's key reads the memos the pool logged, and the
 * pool's logs say which notes are spent, how, and what each spend paid out.
 */
export async function restoreAccount({ reader, pool, account }: RestoreRequest): Promise<RestoredAccount> {
  const { views, lastRead } = await readEpochs(account, pool);
  const found = views.flatMap((view) => view.notes);
  const timeOf = await blockTimes(reader, [
    ...found.map((note) => note.block),
    ...found.flatMap((note) => (note.spentBy ? [note.spentBy.event.block] : [])),
  ]);
  const moved = spentInto(found);
  return {
    notes: found
      .map((note) => shieldedNoteOf(note, moved, timeOf))
      .sort((a, b) => a.epoch - b.epoch || a.counter - b.counter),
    epoch: lastRead,
    mismatched: views.flatMap((view) => view.mismatched),
  };
}
