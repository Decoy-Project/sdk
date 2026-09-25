import { hexOf } from "@decoy/protocol";
import { addressWord, bytes32Word, decodeUint, encodeCall, encodeDynamicCall, ERC20_SELECTOR, uintWord, WRAPPED_NATIVE_SELECTOR } from "../chain/abi";
import { ChainError } from "../chain/errors";
import type { ChainReader } from "../chain/reader";
import type { Signer } from "../chain/signer";
import type { Address } from "../domain/types";
import { POOL_SELECTOR } from "../network/generated/deployments";
import type { TokenConfig } from "../network/types";
import { leafIndexIn } from "./queued";

/** The transaction a shield is waiting on. */
export type ShieldStep = "wrapping" | "approving" | "depositing";

/** Who shields what into which pool. */
export interface ShieldParties {
  readonly reader: ChainReader;
  readonly signer: Signer;
  readonly pool: Address;
  /** The wrapped native token. */
  readonly token: TokenConfig;
  readonly onStep: (step: ShieldStep) => void;
}

export interface NoteDepositRequest extends ShieldParties {
  /** One step of the token's ladder. */
  readonly amount: bigint;
  readonly commitment: `0x${string}`;
  /** The note's sealed memo, which the pool logs beside its commitment. */
  readonly memo: Uint8Array;
}

export interface ShieldResult {
  /** The note's place in the pool's queue, which is its place in the tree. */
  readonly leafIndex: bigint;
  readonly block: bigint;
}

function allowance(parties: ShieldParties): Promise<bigint> {
  const data = encodeCall(ERC20_SELECTOR.allowance, [addressWord(parties.signer.address), addressWord(parties.pool)]);
  return parties.reader.rpc.call({ method: "eth_call", params: [{ to: parties.token.address, data }, "latest"] }, (result) => {
    if (typeof result !== "string") throw new ChainError("badResponse", "allowance returned no data");
    return decodeUint(result);
  });
}

/**
 * Readies `total` of the native token for deposits: wraps what is not wrapped yet and approves the pool for what it
 * lacks. Each step waits for its transaction to be mined, so a failure stops where it happened, and a shield started
 * again skips the steps that already landed.
 */
export async function prepareShield(parties: ShieldParties, total: bigint): Promise<void> {
  const { signer, token, pool } = parties;
  if (!token.wrapsNative) throw new Error(`${token.symbol} does not wrap the native token`);

  const wrapped = await parties.reader.tokenBalance(token.address, signer.address);
  if (wrapped < total) {
    parties.onStep("wrapping");
    await signer.send({ to: token.address, data: encodeCall(WRAPPED_NATIVE_SELECTOR.deposit), value: total - wrapped });
  }

  if ((await allowance(parties)) < total) {
    parties.onStep("approving");
    await signer.send({
      to: token.address,
      data: encodeCall(ERC20_SELECTOR.approve, [addressWord(pool), uintWord(total)]),
      value: 0n,
    });
  }
}

/** Deposits one note, and reads its leaf index from the receipt. */
export async function depositNote(request: NoteDepositRequest): Promise<ShieldResult> {
  request.onStep("depositing");
  const receipt = await request.signer.send({
    to: request.pool,
    data: encodeDynamicCall(POOL_SELECTOR.deposit, [
      { word: addressWord(request.token.address) },
      { word: uintWord(request.amount) },
      { word: bytes32Word(request.commitment) },
      { bytes: hexOf(request.memo) },
    ]),
    value: 0n,
  });
  return { leafIndex: leafIndexIn(receipt, request.pool, request.commitment), block: receipt.block };
}
