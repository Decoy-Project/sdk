import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { accountKeys, decodeViewKey, encodeViewKey, MEMO_BYTES, nullifierOf, sealMemo, viewTierOf, type AccountKeys } from "@decoy/protocol";
import { bytes32Of } from "../chain/abi";
import type { ClaimedEvent, DepositedEvent, PoolReader, QueuedLeaf, TransactedEvent } from "../chain/pool";
import type { ChainReader } from "../chain/reader";
import type { Address } from "../domain/types";
import { commitmentOf, epochKeysOf, noteSecrets } from "./note";
import { RESTORE_POLICY, restoreAccount } from "./restore";
import { readPoolHistory, viewEpoch } from "./view";

const ACCOUNT = accountKeys(new Uint8Array(64).fill(7));
const STRANGER = accountKeys(new Uint8Array(64).fill(9));
const ASSET: Address = "0xd33de4d258d964b19ac83f4c80d81a0689a9d757";
const RECIPIENT: Address = "0x00000000000000000000000000000000000000b2";
const NOTE = 10_000_000_000_000_000n;
const PAID = 15_000_000_000_000_000n;
const FEE = 80_000_000_000_000n;
const CHANGE = 2n * NOTE - PAID - FEE;
const CHURN_FEE = 70_000_000_000_000n;
const ABSORBED = 5n;

async function leaf(account: AccountKeys, epoch: number, counter: number, amount: bigint, index: bigint): Promise<QueuedLeaf> {
  const commitment = commitmentOf(account, epoch, counter, ASSET, amount);
  const memo = await sealMemo(epochKeysOf(account, epoch), BigInt(commitment), { counter, amount, asset: BigInt(ASSET) });
  return { index, commitment, memo, block: 10n + index };
}

function nullifier(epoch: number, counter: number, index: bigint): `0x${string}` {
  return bytes32Of(nullifierOf(noteSecrets(ACCOUNT, epoch, counter).noteNullifierKey, index));
}

/**
 * The queue: the account's notes in epochs 0 and 2 and none in epoch 1, a stranger's note, a filler, and a leaf whose
 * memo opens under the account's key but describes another commitment. Epoch 0's first two notes paid a withdrawal
 * whose change is leaf 4, which a churn later moved into epoch 2 as leaf 8; epoch 2's second note was claimed. The tree
 * has absorbed the first five leaves.
 */
async function history() {
  const forged = await sealMemo(epochKeysOf(ACCOUNT, 0), 0xabcdefn, { counter: 9, amount: 10n ** 24n, asset: BigInt(ASSET) });
  const leaves: QueuedLeaf[] = [
    await leaf(ACCOUNT, 0, 0, NOTE, 0n),
    await leaf(STRANGER, 0, 0, NOTE, 1n),
    await leaf(ACCOUNT, 0, 1, NOTE, 2n),
    { index: 3n, commitment: bytes32Of(0x1234n), memo: new Uint8Array(MEMO_BYTES).fill(7), block: 13n },
    await leaf(ACCOUNT, 0, 2, CHANGE, 4n),
    await leaf(ACCOUNT, 2, 0, NOTE, 5n),
    { index: 6n, commitment: bytes32Of(0xabcdefn), memo: forged, block: 16n },
    await leaf(ACCOUNT, 2, 1, NOTE, 7n),
    await leaf(ACCOUNT, 2, 2, CHANGE - CHURN_FEE, 8n),
  ];
  const deposits: DepositedEvent[] = [0n, 1n, 2n, 5n, 6n, 7n].map((index) => ({
    index,
    asset: ASSET,
    amount: NOTE,
    block: 10n + index,
    transaction: bytes32Of(100n + index),
  }));
  const withdrawal: TransactedEvent = {
    nullifiers: [nullifier(0, 0, 0n), nullifier(0, 1, 2n)],
    firstIndex: 3n,
    exitAsset: ASSET,
    recipient: RECIPIENT,
    exitAmount: PAID,
    fee: FEE,
    block: 40n,
    transaction: bytes32Of(0x40n),
  };
  const churn: TransactedEvent = {
    nullifiers: [nullifier(0, 2, 4n), bytes32Of(0x5eedn)],
    firstIndex: 8n,
    exitAsset: ASSET,
    recipient: "0x0000000000000000000000000000000000000000",
    exitAmount: 0n,
    fee: CHURN_FEE,
    block: 60n,
    transaction: bytes32Of(0x60n),
  };
  const claim: ClaimedEvent = {
    index: 7n,
    asset: ASSET,
    recipient: RECIPIENT,
    amount: NOTE,
    nullifier: nullifier(2, 1, 7n),
    block: 50n,
    transaction: bytes32Of(0x50n),
  };
  return { leaves, deposits, transactions: [withdrawal, churn], claims: [claim], withdrawal, churn, claim };
}

async function fakePool(): Promise<PoolReader> {
  const { leaves, deposits, transactions, claims } = await history();
  const unused = (): never => {
    throw new Error("not read by a restore");
  };
  return {
    address: "0xe23a500ab29559d53a32bafa1557b554c252ec7e",
    state: () => Promise.resolve({ queueLength: BigInt(leaves.length), absorbedCount: ABSORBED, root: bytes32Of(1n) }),
    leaves: () => Promise.resolve(leaves),
    deposits: () => Promise.resolve(deposits),
    transactions: () => Promise.resolve(transactions),
    claims: () => Promise.resolve(claims),
    totals: unused,
    caps: unused,
    room: unused,
    isSpent: unused,
    isKnownRoot: unused,
    frozen: unused,
  };
}

const SECOND = 1000;
const reader = { blockTime: (block: bigint) => Promise.resolve(new Date(Number(block) * SECOND)) } as unknown as ChainReader;

describe("viewEpoch", () => {
  test("shows the epoch's notes, which are spent and how, and reports a leaf made to mislead it", async () => {
    const pool = await fakePool();
    const { withdrawal } = await history();
    const view = await viewEpoch(viewTierOf(ACCOUNT, 0), await readPoolHistory(pool));
    assert.deepEqual(
      view.notes.map((note) => [note.counter, note.leafIndex, note.amount, note.origin, note.status]),
      [
        [0, 0n, NOTE, "deposit", "spent"],
        [1, 2n, NOTE, "deposit", "spent"],
        [2, 4n, CHANGE, "transaction", "spent"],
      ],
    );
    assert.deepEqual(view.notes[0].spentBy, { kind: "transaction", event: withdrawal, first: true });
    assert.deepEqual(view.notes[1].spentBy, { kind: "transaction", event: withdrawal, first: false });
    assert.deepEqual(view.mismatched, [6n]);
  });

  test("shows a holder of the key text exactly what the owner sees", async () => {
    const poolHistory = await readPoolHistory(await fakePool());
    const shared = decodeViewKey(encodeViewKey(viewTierOf(ACCOUNT, 2)));
    assert.deepEqual(await viewEpoch(shared, poolHistory), await viewEpoch(viewTierOf(ACCOUNT, 2), poolHistory));
  });

  test("shows another account nothing of this one", async () => {
    const view = await viewEpoch(viewTierOf(STRANGER, 0), await readPoolHistory(await fakePool()));
    assert.deepEqual(view.notes.map((note) => note.leafIndex), [1n]);
    assert.deepEqual(view.mismatched, []);
  });
});

describe("restoreAccount", () => {
  test("finds every note of every epoch from the phrase, with what each spend paid out", async () => {
    const { withdrawal, churn, claim } = await history();
    const restored = await restoreAccount({ reader, pool: await fakePool(), account: ACCOUNT });
    assert.deepEqual(
      restored.notes.map((note) => [note.epoch, note.counter, note.status, note.leafIndex, note.from, note.at.getTime()]),
      [
        [0, 0, "spent", 0n, null, 10 * SECOND],
        [0, 1, "spent", 2n, null, 12 * SECOND],
        [0, 2, "spent", 4n, null, 14 * SECOND],
        [2, 0, "pending", 5n, null, 15 * SECOND],
        [2, 1, "spent", 7n, null, 17 * SECOND],
        [2, 2, "pending", 8n, null, 18 * SECOND],
      ],
    );
    assert.deepEqual(restored.notes[0].exit, {
      kind: "withdrawal",
      recipient: RECIPIENT,
      received: PAID,
      fee: FEE,
      transaction: withdrawal.transaction,
      at: new Date(Number(withdrawal.block) * SECOND),
    });
    assert.equal(restored.notes[1].exit, null, "a withdrawal's payment is kept on its first note only");
    assert.deepEqual(restored.notes[2].exit, {
      kind: "churn",
      recipient: null,
      received: CHANGE - CHURN_FEE,
      fee: CHURN_FEE,
      transaction: churn.transaction,
      at: new Date(Number(churn.block) * SECOND),
    });
    assert.deepEqual(restored.notes[4].exit, {
      kind: "claim",
      recipient: RECIPIENT,
      received: NOTE,
      fee: 0n,
      transaction: claim.transaction,
      at: new Date(Number(claim.block) * SECOND),
    });
    assert.deepEqual(restored.mismatched, [6n]);
  });

  test("continues past every epoch a revoke of an empty account could have left", async () => {
    const restored = await restoreAccount({ reader, pool: await fakePool(), account: ACCOUNT });
    assert.equal(restored.epoch, 2 + RESTORE_POLICY.lookaheadEpochs);
  });

  test("starts an account the pool has never seen in the last epoch it read", async () => {
    const restored = await restoreAccount({ reader, pool: await fakePool(), account: accountKeys(new Uint8Array(64).fill(3)) });
    assert.deepEqual(restored.notes, []);
    assert.equal(restored.epoch, RESTORE_POLICY.lookaheadEpochs - 1);
  });
});
