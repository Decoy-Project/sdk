import type { AccountKeys } from "@decoy/protocol";
import { hexOf, MAX_LADDER_TERMS } from "@decoy/protocol";
import type { PoolReader } from "../chain/pool";
import type { ChainReader } from "../chain/reader";
import type { Address, NoteExit, ShieldedNote } from "../domain/types";
import type { TransactProver } from "../prove/transactProver";
import type { RelayerClient } from "../relay/client";
import type { RelayQuote } from "../relay/protocol";
import { planWithdrawal } from "./choose";
import { nextCounter } from "./note";
import type { NoteStore } from "./shieldNote";
import { buildTransaction } from "./transaction";

/** Where a transaction through the relayer is: it is built, proved, sent by the relayer, and the pool is read back. */
export type WithdrawStep = "building" | "proving" | "relaying" | "confirming";

/** A transaction the relayer sends for the account: what it spends, and who is paid for sending it. */
export interface RelayedRequest {
  readonly reader: ChainReader;
  readonly pool: PoolReader;
  readonly store: NoteStore;
  readonly account: AccountKeys;
  /** The account's current epoch: the new note is made in it. */
  readonly epoch: number;
  /** One or two settled notes of one asset, holding more than what the transaction pays. */
  readonly notes: readonly ShieldedNote[];
  /** The relayer's fee, as it quoted it. The proof binds it, so a relayer cannot take more. */
  readonly quote: RelayQuote;
  readonly relayer: RelayerClient;
  readonly prover: TransactProver;
  readonly onStep: (step: WithdrawStep) => void;
}

export interface WithdrawRequest extends RelayedRequest {
  readonly amount: bigint;
  readonly recipient: Address;
}

/** What a transaction did: the notes it spent, the first carrying its exit, and the note it made. */
export interface TransactOutcome {
  readonly spent: readonly ShieldedNote[];
  /** What was left over, back in the pool as a new note. Null when nothing was. */
  readonly change: ShieldedNote | null;
}

export interface PaymentsRequest extends Omit<RelayedRequest, "notes" | "onStep"> {
  /** One payment per amount: the amount the user chose, or the steps of the ladder they picked. */
  readonly amounts: readonly bigint[];
  readonly recipient: Address;
  /** Which payment is where, counting from 0. */
  readonly onStep: (payment: number, step: WithdrawStep) => void;
}

export interface PaymentsOutcome {
  /** The payments that went, in order. */
  readonly sent: readonly TransactOutcome[];
  /** Why the payments after `sent` did not go, or null when every one went. */
  readonly stopped: string | null;
}

/** Who a transaction pays besides the relayer. Null for a churn, which pays no one. */
type Payment = { readonly amount: bigint; readonly recipient: Address } | null;

/**
 * Sends a transaction of the account's notes through the relayer, for its quoted fee; what is not paid out comes back as
 * a new note. The notes are saved as spending, and the new note as sending, before the proof leaves the device. Once
 * the pool shows the notes spent they are saved as spent and the new note as queued. If anything fails, the pool is
 * asked whether the notes were spent anyway: if so, they are spent and the receiver finds the new note in the queue;
 * if not, the notes are settled again and the new note is forgotten.
 */
async function relay(request: RelayedRequest, payment: Payment): Promise<TransactOutcome> {
  const { pool, store, notes, quote, onStep } = request;
  if (notes.some((note) => note.asset.toLowerCase() !== quote.asset)) throw new Error(`The quote is for ${quote.asset}, not the notes' asset`);

  onStep("building");
  const chainId = request.reader.network().chainId;
  const built = await buildTransaction({
    pool,
    chainId,
    account: request.account,
    inputs: notes,
    exitAmount: payment?.amount ?? 0n,
    recipient: payment?.recipient ?? null,
    fee: quote.fee,
    changeEpoch: request.epoch,
    changeCounter: nextCounter(store.notes(), request.epoch),
  });
  const exit: NoteExit = payment
    ? { kind: "withdrawal", recipient: payment.recipient, received: payment.amount, fee: quote.fee, transaction: null, at: new Date() }
    : { kind: "churn", recipient: null, received: built.change?.amount ?? 0n, fee: quote.fee, transaction: null, at: new Date() };
  const spending = notes.map((note, index): ShieldedNote => ({ ...note, status: "spending", exit: index === 0 ? exit : null }));
  const change = built.change && { ...built.change, sentAfterBlock: await request.reader.blockNumber() };
  if (change) await store.put(change);
  for (const note of spending) await store.put(note);
  const firstNullifier = built.transaction.nullifiers[0];

  try {
    onStep("proving");
    const { proof } = await request.prover.prove(built.witness);
    onStep("relaying");
    const result = await request.relayer.relay({
      chainId,
      pool: pool.address,
      proof,
      transaction: built.transaction,
      memos: hexOf(built.memos),
    });
    onStep("confirming");
    if (!(await pool.isSpent(firstNullifier))) {
      throw new Error(`The relayer reported ${result.transaction}, but the pool shows the notes unspent`);
    }
    const spent = spending.map((note, index): ShieldedNote => ({
      ...note,
      status: "spent",
      exit: index === 0 ? { ...exit, transaction: result.transaction } : null,
    }));
    for (const note of spent) await store.put(note);
    return { spent, change: change && (await queued(pool, store, change, result.block)) };
  } catch (error) {
    if (await pool.isSpent(firstNullifier)) {
      for (const note of spending) await store.put({ ...note, status: "spent" });
    } else {
      for (const note of notes) await store.put(note);
      if (change) await store.drop(change);
    }
    throw error;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pays `amounts` to `recipient`, one transaction each, each out of notes planned for it before the first goes: a
 * payment's change is not in the tree yet, so no later payment could spend it. When the first payment fails, nothing
 * went, and the failure is thrown; when a later one fails, the ones before it went, and it says why the rest stopped.
 */
export async function withdrawPayments(request: PaymentsRequest): Promise<PaymentsOutcome> {
  const { amounts, quote } = request;
  if (amounts.length === 0 || amounts.length > MAX_LADDER_TERMS) {
    throw new Error(`A withdrawal is one to ${MAX_LADDER_TERMS} payments, not ${amounts.length}`);
  }
  const empty = amounts.find((amount) => amount <= 0n);
  if (empty !== undefined) throw new Error(`A payment of ${empty} pays nothing`);
  const plan = planWithdrawal(request.store.notes(), quote.asset, amounts, quote.fee);
  if (!plan) throw new Error("The settled notes cannot pay these amounts and a fee for each, one transaction each");

  const sent: TransactOutcome[] = [];
  for (const [payment, notes] of plan.entries()) {
    try {
      const onStep = (step: WithdrawStep) => request.onStep(payment, step);
      sent.push(await withdrawNotes({ ...request, notes, amount: amounts[payment], onStep }));
    } catch (error) {
      if (sent.length === 0) throw error;
      return { sent, stopped: messageOf(error) };
    }
  }
  return { sent, stopped: null };
}

/** Pays `amount` to `recipient` out of the account's notes; the rest comes back as a note of the current epoch. */
export function withdrawNotes(request: WithdrawRequest): Promise<TransactOutcome> {
  return relay(request, { amount: request.amount, recipient: request.recipient });
}

/**
 * Moves one or two notes into one new note of the current epoch, paying the relayer and no one else. It takes notes out
 * of an epoch whose key was revoked, and it keeps a note's age from telling when its value was deposited.
 */
export async function churnNotes(request: RelayedRequest): Promise<TransactOutcome> {
  const total = request.notes.reduce((sum, note) => sum + note.amount, 0n);
  if (total <= request.quote.fee) {
    throw new Error(`The notes hold ${total}; a churn for a fee of ${request.quote.fee} would leave nothing`);
  }
  return relay(request, null);
}

/** The new note, queued: its leaf index read from the block the relayer mined it in. */
async function queued(pool: PoolReader, store: NoteStore, change: ShieldedNote, block: bigint): Promise<ShieldedNote> {
  const leaf = (await pool.leaves(block)).find((candidate) => candidate.commitment.toLowerCase() === change.commitment.toLowerCase());
  if (!leaf) throw new Error(`Block ${block} does not queue the change note ${change.commitment}`);
  const pending: ShieldedNote = { ...change, status: "pending", leafIndex: leaf.index };
  await store.put(pending);
  return pending;
}
