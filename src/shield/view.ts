import { noteReader, type ViewTierKey } from "@decoy/protocol";
import { addressFromInteger, bytes32Of } from "../chain/abi";
import type { ClaimedEvent, DepositedEvent, PoolReader, QueuedLeaf, TransactedEvent } from "../chain/pool";
import type { Address, NoteOrigin } from "../domain/types";

/** The pool's public history, read once and shared by every epoch a scan tries. */
export interface PoolHistory {
  readonly leaves: readonly QueuedLeaf[];
  readonly absorbedCount: bigint;
  readonly deposits: readonly DepositedEvent[];
  readonly transactions: readonly TransactedEvent[];
  readonly claims: readonly ClaimedEvent[];
}

/** How a note was spent: by a transaction, which may have paid value out, or by an escape claim. */
export type NoteSpend =
  | {
      readonly kind: "transaction";
      readonly event: TransactedEvent;
      /** Whether the note was the transaction's first input, the one a withdrawal's payment is kept on. */
      readonly first: boolean;
    }
  | { readonly kind: "claim"; readonly event: ClaimedEvent };

/** One note as an epoch's key shows it. */
export interface ViewedNote {
  readonly epoch: number;
  readonly counter: number;
  readonly asset: Address;
  readonly amount: bigint;
  readonly commitment: `0x${string}`;
  readonly leafIndex: bigint;
  /** The block that queued it. */
  readonly block: bigint;
  readonly origin: NoteOrigin;
  readonly status: "pending" | "settled" | "spent";
  /** Null while it is unspent. */
  readonly spentBy: NoteSpend | null;
}

/** What one epoch's key shows. */
export interface EpochView {
  readonly epoch: number;
  readonly notes: readonly ViewedNote[];
  /**
   * Leaves whose memo opens under the key but does not describe their commitment. A holder of the key made them; none
   * of them is the owner's note, and each is reported rather than passed over.
   */
  readonly mismatched: readonly bigint[];
}

export async function readPoolHistory(pool: PoolReader): Promise<PoolHistory> {
  const [state, leaves, deposits, transactions, claims] = await Promise.all([
    pool.state(),
    pool.leaves(),
    pool.deposits(),
    pool.transactions(),
    pool.claims(),
  ]);
  return { leaves, absorbedCount: state.absorbedCount, deposits, transactions, claims };
}

/** The transaction or claim that retired `nullifier`, if the pool logged one. */
function spendOf(history: PoolHistory, nullifier: `0x${string}`): NoteSpend | null {
  const same = (candidate: `0x${string}`) => candidate.toLowerCase() === nullifier.toLowerCase();
  const transaction = history.transactions.find((event) => event.nullifiers.some(same));
  if (transaction) return { kind: "transaction", event: transaction, first: same(transaction.nullifiers[0]) };
  const claim = history.claims.find((event) => same(event.nullifier));
  return claim ? { kind: "claim", event: claim } : null;
}

function statusOf(leafIndex: bigint, spentBy: NoteSpend | null, absorbedCount: bigint): ViewedNote["status"] {
  if (spentBy) return "spent";
  return leafIndex < absorbedCount ? "settled" : "pending";
}

/**
 * Every note of the key's epoch in the pool's history, with its status and how it was spent. The key reads each leaf's
 * memo; a note counts only when its commitment is the one the memo describes.
 */
export async function viewEpoch(view: ViewTierKey, history: PoolHistory): Promise<EpochView> {
  const read = noteReader(view);
  const deposited = new Set(history.deposits.map((event) => event.index));
  const readings = await Promise.all(
    history.leaves.map(async (leaf) => {
      const reading = await read({ index: leaf.index, commitment: BigInt(leaf.commitment), memo: leaf.memo });
      return { leaf, reading };
    }),
  );
  const notes: ViewedNote[] = [];
  const mismatched: bigint[] = [];
  for (const { leaf, reading } of readings) {
    if (reading.kind === "mismatch") mismatched.push(leaf.index);
    if (reading.kind !== "note") continue;
    const { note } = reading;
    const spentBy = spendOf(history, bytes32Of(note.nullifier));
    notes.push({
      epoch: view.epoch,
      counter: note.counter,
      asset: addressFromInteger(note.asset),
      amount: note.amount,
      commitment: leaf.commitment,
      leafIndex: leaf.index,
      block: leaf.block,
      origin: deposited.has(leaf.index) ? "deposit" : "transaction",
      status: statusOf(leaf.index, spentBy, history.absorbedCount),
      spentBy,
    });
  }
  return { epoch: view.epoch, notes, mismatched };
}
