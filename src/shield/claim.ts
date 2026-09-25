import { claimMessage, contextOf, schnorrSign, type AccountKeys } from "@decoy/protocol";
import { addressWord, encodeCall, uintWord } from "../chain/abi";
import type { PoolReader } from "../chain/pool";
import type { ChainReader } from "../chain/reader";
import { createSigner } from "../chain/signer";
import type { Address, NoteStatus, ShieldedNote } from "../domain/types";
import type { EvmKey } from "../keys/evm";
import { POOL_SELECTOR } from "../network/generated/deployments";
import { noteSecrets } from "./note";
import type { NoteStore } from "./shieldNote";

/** Statuses a claim can be made from: the note is queued, absorbed or not, and nothing has retired it. */
const CLAIMABLE: readonly NoteStatus[] = ["pending", "settled"];

export interface ClaimRequest {
  readonly reader: ChainReader;
  readonly pool: PoolReader;
  readonly store: NoteStore;
  readonly account: AccountKeys;
  readonly note: ShieldedNote;
  readonly recipient: Address;
  /** Pays the gas. A claim shows the note's place and its recipient, so the payer gives away nothing more. */
  readonly payer: EvmKey;
}

export function canClaim(note: ShieldedNote): boolean {
  return CLAIMABLE.includes(note.status) && note.leafIndex !== null && note.amount > 0n;
}

/**
 * The escape hatch, for a frozen pool: opens `note` in the clear, with the spend key's signature on paying it to
 * `recipient`, and has the pool pay it. One transaction; a copy of it cannot pay anyone else.
 */
export async function claimNote(request: ClaimRequest): Promise<ShieldedNote> {
  const { pool, note, recipient } = request;
  if (!canClaim(note) || note.leafIndex === null) throw new Error(`Note ${note.epoch}/${note.counter} is ${note.status} and cannot be claimed`);
  if (!(await pool.frozen())) throw new Error("The pool is not frozen: a note leaves it by withdrawal");
  const context = contextOf(BigInt(request.reader.network().chainId), BigInt(pool.address));
  const signature = schnorrSign(request.account.spendKey, claimMessage(note.leafIndex, BigInt(recipient), context));
  const secrets = noteSecrets(request.account, note.epoch, note.counter);
  const owner = request.account.spendPublicKey;
  const data = encodeCall(POOL_SELECTOR.claim, [
    uintWord(note.leafIndex),
    addressWord(note.asset),
    uintWord(note.amount),
    uintWord(secrets.blinding),
    uintWord(owner.x),
    uintWord(owner.y),
    uintWord(secrets.noteNullifierKey),
    addressWord(recipient),
    uintWord(signature.r.x),
    uintWord(signature.r.y),
    uintWord(signature.s),
  ]);
  const receipt = await createSigner(request.reader, request.payer).send({ to: pool.address, data, value: 0n });
  const spent: ShieldedNote = {
    ...note,
    status: "spent",
    exit: { kind: "claim", recipient, received: note.amount, fee: 0n, transaction: receipt.hash, at: new Date() },
  };
  await request.store.put(spent);
  return spent;
}
