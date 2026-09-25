import {
  bigintOf,
  contextOf,
  FIELD_MODULUS,
  MEMO_BYTES,
  memoHashOf,
  NoteTree,
  noteCommitment,
  nullifierOf,
  sealMemo,
  schnorrSign,
  transactionMessage,
  TRANSACT_INPUTS,
  TRANSACT_OUTPUTS,
  TREE_DEPTH,
  type AccountKeys,
  type CreatedNote,
  type Field,
  type SpentNote,
  type TransactionPublics,
  type TransactWitness,
} from "@decoy/protocol";
import { addressWord, bytes32Of, bytes32Word, encodeDynamicCall, uintWord } from "../chain/abi";
import type { PoolReader, QueuedLeaf } from "../chain/pool";
import type { Hex } from "../chain/transaction";
import type { Address, ShieldedNote } from "../domain/types";
import { POOL_SELECTOR } from "../network/generated/deployments";
import { epochKeysOf, noteSecrets } from "./note";

/** A transaction as the pool's `transact` takes it: every field the proof binds. */
export interface PoolTransaction {
  readonly root: Hex;
  readonly nullifiers: readonly Hex[];
  readonly commitments: readonly Hex[];
  /** The zero address when nothing leaves the pool. */
  readonly exitAsset: Address;
  readonly exitAmount: bigint;
  /** The zero address when nothing is paid out. */
  readonly recipient: Address;
  readonly fee: bigint;
}

/** What a transaction spends and what leaves the pool. What is left over comes back to the account as change. */
export interface TransactionRequest {
  readonly pool: PoolReader;
  readonly chainId: number;
  readonly account: AccountKeys;
  /** One or two settled notes of one asset. */
  readonly inputs: readonly ShieldedNote[];
  /** Paid to `recipient`. Zero pays nothing out, as a churn does. */
  readonly exitAmount: bigint;
  /** Null when nothing is paid out. */
  readonly recipient: Address | null;
  /** Paid to the relayer that sends the transaction. */
  readonly fee: bigint;
  /** The epoch and counter the change note takes. */
  readonly changeEpoch: number;
  readonly changeCounter: number;
}

/** A transaction ready to prove and send. */
export interface BuiltTransaction {
  readonly witness: TransactWitness;
  readonly transaction: PoolTransaction;
  /** The new notes' sealed memos, end to end, as `transact` takes them. */
  readonly memos: Uint8Array;
  /** The change, as a note of the account to save before sending. Null when nothing is left over. */
  readonly change: ShieldedNote | null;
}

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const DRAW_BYTES = 48;

/** A uniformly random field element: a placeholder's secrets and a filler note's contents, which nobody ever opens. */
function randomField(): Field {
  return bigintOf(crypto.getRandomValues(new Uint8Array(DRAW_BYTES))) % FIELD_MODULUS;
}

/** The absorbed prefix of the queue, which must run 0, 1, 2… without a gap. */
function absorbedLeaves(leaves: readonly QueuedLeaf[], count: bigint): readonly QueuedLeaf[] {
  if (BigInt(leaves.length) < count) throw new Error(`The queue log shows ${leaves.length} leaves; the pool has absorbed ${count}`);
  const prefix = leaves.slice(0, Number(count));
  prefix.forEach((leaf, position) => {
    if (leaf.index !== BigInt(position)) throw new Error(`The queue log skips from ${position - 1} to ${leaf.index}`);
  });
  return prefix;
}

/** A note's place in the tree, once it is shown to be a settled note. */
function leafOf(note: ShieldedNote): bigint {
  if (note.status !== "settled" || note.leafIndex === null) {
    throw new Error(`Note ${note.epoch}/${note.counter} is ${note.status}; only a settled note can be spent`);
  }
  return note.leafIndex;
}

function checkInputs(request: TransactionRequest): { asset: Address; total: bigint } {
  const { inputs, exitAmount, fee, recipient } = request;
  if (inputs.length === 0 || inputs.length > TRANSACT_INPUTS) {
    throw new Error(`A transaction spends one to ${TRANSACT_INPUTS} notes, not ${inputs.length}`);
  }
  inputs.forEach(leafOf);
  const asset = inputs[0].asset;
  if (inputs.some((note) => note.asset.toLowerCase() !== asset.toLowerCase())) throw new Error("A transaction spends notes of one asset");
  const total = inputs.reduce((sum, note) => sum + note.amount, 0n);
  if (exitAmount < 0n || fee < 0n || exitAmount + fee > total) {
    throw new Error(`The notes hold ${total}; paying out ${exitAmount} and a fee of ${fee} needs more`);
  }
  if ((exitAmount > 0n) !== (recipient !== null)) throw new Error("A payment out needs a recipient, and only a payment out has one");
  return { asset, total };
}

/** A note that holds nothing and that nobody can open: it keeps every transaction the same shape. */
function fillerOutput(asset: Address): { created: CreatedNote; commitment: Field; memo: Uint8Array } {
  const created: CreatedNote = { amount: 0n, blinding: randomField(), ownerTag: randomField() };
  const commitment = noteCommitment({ asset: BigInt(asset), ...created });
  return { created, commitment, memo: crypto.getRandomValues(new Uint8Array(MEMO_BYTES)) };
}

/** A placeholder input: nothing is spent, and its nullifier is as random as any other. */
function placeholderInput(): { spent: SpentNote; nullifier: Field } {
  const noteNullifierKey = randomField();
  const spent: SpentNote = {
    amount: 0n,
    blinding: randomField(),
    noteNullifierKey,
    indexBits: Array<boolean>(TREE_DEPTH).fill(false),
    siblings: Array<Field>(TREE_DEPTH).fill(0n),
  };
  return { spent, nullifier: nullifierOf(noteNullifierKey, 0n) };
}

/**
 * Builds a transaction of the account's notes: the tree is rebuilt from the pool's queue as far as the pool has
 * absorbed, and its root must be one the pool still takes; each note must sit where the queue put it. What is left
 * over after the payment and the fee becomes a change note of the account, sealed with the epoch's memo key. The
 * account's spend key signs every public input.
 */
export async function buildTransaction(request: TransactionRequest): Promise<BuiltTransaction> {
  const { pool, account, inputs, exitAmount, fee } = request;
  const { asset, total } = checkInputs(request);

  const { absorbedCount } = await pool.state();
  const absorbed = absorbedLeaves(await pool.leaves(), absorbedCount);
  const tree = new NoteTree(TREE_DEPTH);
  for (const leaf of absorbed) tree.append(BigInt(leaf.commitment));
  const root = tree.root();
  if (!(await pool.isKnownRoot(bytes32Of(root)))) throw new Error(`The rebuilt tree's root ${bytes32Of(root)} is not one the pool knows`);

  const spent: SpentNote[] = [];
  const nullifiers: Field[] = [];
  for (const note of inputs) {
    const index = leafOf(note);
    if (index >= absorbedCount) throw new Error(`Note ${note.epoch}/${note.counter} is leaf ${index}; the tree holds ${absorbedCount}`);
    if (absorbed[Number(index)].commitment.toLowerCase() !== note.commitment.toLowerCase()) {
      throw new Error(`Leaf ${index} is not note ${note.epoch}/${note.counter}: their commitments differ`);
    }
    const secrets = noteSecrets(account, note.epoch, note.counter);
    spent.push({ amount: note.amount, blinding: secrets.blinding, noteNullifierKey: secrets.noteNullifierKey, ...tree.path(Number(index)) });
    nullifiers.push(nullifierOf(secrets.noteNullifierKey, index));
  }
  while (spent.length < TRANSACT_INPUTS) {
    const placeholder = placeholderInput();
    spent.push(placeholder.spent);
    nullifiers.push(placeholder.nullifier);
  }

  const changeAmount = total - exitAmount - fee;
  const outputs: { created: CreatedNote; commitment: Field; memo: Uint8Array }[] = [];
  let change: ShieldedNote | null = null;
  if (changeAmount > 0n) {
    const secrets = noteSecrets(account, request.changeEpoch, request.changeCounter);
    const created: CreatedNote = { amount: changeAmount, blinding: secrets.blinding, ownerTag: secrets.ownerTag };
    const commitment = noteCommitment({ asset: BigInt(asset), ...created });
    const memo = await sealMemo(epochKeysOf(account, request.changeEpoch), commitment, {
      counter: request.changeCounter,
      amount: changeAmount,
      asset: BigInt(asset),
    });
    outputs.push({ created, commitment, memo });
    change = {
      epoch: request.changeEpoch,
      counter: request.changeCounter,
      asset,
      amount: changeAmount,
      commitment: bytes32Of(commitment),
      origin: "transaction",
      from: null,
      status: "sending",
      leafIndex: null,
      sentAfterBlock: 0n,
      at: new Date(),
      exit: null,
    };
  }
  while (outputs.length < TRANSACT_OUTPUTS) outputs.push(fillerOutput(asset));

  const memoList = outputs.map((output) => output.memo);
  const paysOut = exitAmount + fee > 0n;
  const recipient = request.recipient ?? ZERO_ADDRESS;
  const publics: TransactionPublics = {
    root,
    nullifiers,
    commitments: outputs.map((output) => output.commitment),
    exitAsset: paysOut ? BigInt(asset) : 0n,
    exitAmount,
    recipient: BigInt(recipient),
    fee,
    memoHash: memoHashOf(memoList),
    context: contextOf(BigInt(request.chainId), BigInt(pool.address)),
  };
  const witness: TransactWitness = {
    publics,
    owner: account.spendPublicKey,
    signature: schnorrSign(account.spendKey, transactionMessage(publics)),
    asset: BigInt(asset),
    inputs: spent,
    outputs: outputs.map((output) => output.created),
  };
  return {
    witness,
    transaction: {
      root: bytes32Of(root),
      nullifiers: nullifiers.map(bytes32Of),
      commitments: publics.commitments.map(bytes32Of),
      exitAsset: paysOut ? asset : ZERO_ADDRESS,
      exitAmount,
      recipient,
      fee,
    },
    memos: new Uint8Array(memoList.flatMap((memo) => [...memo])),
    change,
  };
}

/** The pool's `transact` call for a proved transaction. */
export function transactCalldata(transaction: PoolTransaction, memos: Hex, proof: Hex): Hex {
  return encodeDynamicCall(POOL_SELECTOR.transact, [
    { word: bytes32Word(transaction.root) },
    ...transaction.nullifiers.map((nullifier) => ({ word: bytes32Word(nullifier) })),
    ...transaction.commitments.map((commitment) => ({ word: bytes32Word(commitment) })),
    { word: addressWord(transaction.exitAsset) },
    { word: uintWord(transaction.exitAmount) },
    { word: addressWord(transaction.recipient) },
    { word: uintWord(transaction.fee) },
    { bytes: memos },
    { bytes: proof },
  ]);
}

