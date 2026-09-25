import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  accountKeys,
  MEMO_BYTES,
  NoteTree,
  nullifierOf,
  openMemo,
  schnorrVerify,
  transactionMessage,
  TREE_DEPTH,
} from "@decoy/protocol";
import { bytes32Of } from "../chain/abi";
import type { PoolReader, QueuedLeaf } from "../chain/pool";
import type { ChainReader } from "../chain/reader";
import type { Address, ShieldedNote } from "../domain/types";
import { ROBINHOOD_TESTNET } from "../network/networks";
import { createTransactProver, type TransactProver } from "../prove/transactProver";
import type { RelayerClient } from "../relay/client";
import type { RelayQuote, RelayRequest } from "../relay/protocol";
import { commitmentOf, epochKeysOf, noteSecrets } from "./note";
import type { NoteStore } from "./shieldNote";
import { buildTransaction, type TransactionRequest } from "./transaction";
import { churnNotes, withdrawNotes, withdrawPayments, type WithdrawStep } from "./withdraw";

const ACCOUNT = accountKeys(new Uint8Array(64).fill(7));
const ASSET: Address = "0xd33de4d258d964b19ac83f4c80d81a0689a9d757";
const AMOUNT = 100_000_000_000_000_000n;
const RECIPIENT: Address = "0x00000000000000000000000000000000000000b2";
const FEE = 30_000_000_000_000n;
const NOTES = 8;
const CHANGE_COUNTER = NOTES;
const MINED_BLOCK = 9n;
/** The testnet WETH ladder unit: 0.001 ETH, so AMOUNT is 100 units, one step. */
const LADDER_UNIT = 1_000_000_000_000_000n;
/** An amount off the ladder, as a user may choose. */
const ANY_AMOUNT = 12_345_678_900_000_000n;
const POOL_ADDRESS = ROBINHOOD_TESTNET.contracts?.pool ?? "0x";

function noteAt(counter: number, status: ShieldedNote["status"] = "settled"): ShieldedNote {
  return {
    epoch: 0,
    counter,
    asset: ASSET,
    amount: AMOUNT,
    commitment: commitmentOf(ACCOUNT, 0, counter, ASSET, AMOUNT),
    origin: "deposit",
    from: "0x00000000000000000000000000000000000000a1",
    status,
    leafIndex: BigInt(counter),
    sentAfterBlock: 1n,
    at: new Date(0),
    exit: null,
  };
}

const NOTES_ON_CHAIN = Array.from({ length: NOTES }, (_, counter) => noteAt(counter));

function leavesOf(notes: readonly ShieldedNote[]): QueuedLeaf[] {
  return notes.map((note, index) => ({ index: BigInt(index), commitment: note.commitment, memo: new Uint8Array(MEMO_BYTES), block: 1n }));
}

function rootOf(leaves: readonly QueuedLeaf[]): `0x${string}` {
  const tree = new NoteTree(TREE_DEPTH);
  for (const leaf of leaves) tree.append(BigInt(leaf.commitment));
  return bytes32Of(tree.root());
}

interface FakePool {
  readonly pool: PoolReader;
  readonly spent: Set<string>;
  readonly queue: QueuedLeaf[];
}

/** A pool that has absorbed the first `absorbed` leaves and knows the root of exactly that tree. */
function fakePool(leaves: readonly QueuedLeaf[] = leavesOf(NOTES_ON_CHAIN), absorbed: number = leaves.length): FakePool {
  const spent = new Set<string>();
  const queue = [...leaves];
  const known = rootOf(leaves.slice(0, absorbed));
  const unused = (): never => {
    throw new Error("not read by a transaction");
  };
  const pool: PoolReader = {
    address: POOL_ADDRESS as Address,
    state: () => Promise.resolve({ queueLength: BigInt(queue.length), absorbedCount: BigInt(absorbed), root: known }),
    leaves: (fromBlock = 0n) => Promise.resolve(queue.filter((leaf) => leaf.block >= fromBlock)),
    isKnownRoot: (root) => Promise.resolve(root === known),
    isSpent: (nullifier) => Promise.resolve(spent.has(nullifier)),
    frozen: () => Promise.resolve(false),
    totals: unused,
    caps: unused,
    room: unused,
    deposits: unused,
    transactions: unused,
    claims: unused,
  };
  return { pool, spent, queue };
}

function request(pool: PoolReader, change: Partial<TransactionRequest> = {}): TransactionRequest {
  return {
    pool,
    chainId: ROBINHOOD_TESTNET.chainId,
    account: ACCOUNT,
    inputs: [NOTES_ON_CHAIN[5]],
    exitAmount: 60_000_000_000_000_000n,
    recipient: RECIPIENT,
    fee: FEE,
    changeEpoch: 0,
    changeCounter: CHANGE_COUNTER,
    ...change,
  };
}

describe("buildTransaction", () => {
  test("pays part of a note out, and brings the rest back as a note of the account", async () => {
    const { pool } = fakePool();
    const built = await buildTransaction(request(pool));
    const { publics } = built.witness;
    const changeAmount = AMOUNT - 60_000_000_000_000_000n - FEE;

    assert.equal(publics.nullifiers[0], nullifierOf(noteSecrets(ACCOUNT, 0, 5).noteNullifierKey, 5n));
    assert.equal(publics.exitAsset, BigInt(ASSET));
    assert.equal(publics.recipient, BigInt(RECIPIENT));
    assert.equal(built.change?.amount, changeAmount);
    assert.equal(built.change?.commitment, commitmentOf(ACCOUNT, 0, CHANGE_COUNTER, ASSET, changeAmount));
    assert.equal(bytes32Of(publics.commitments[0]), built.change?.commitment);
    const memo = await openMemo(epochKeysOf(ACCOUNT, 0), publics.commitments[0], built.memos.slice(0, MEMO_BYTES));
    assert.deepEqual(memo, { counter: CHANGE_COUNTER, amount: changeAmount, asset: BigInt(ASSET) });
    assert.ok(schnorrVerify(ACCOUNT.spendPublicKey, transactionMessage(publics), built.witness.signature));
  });

  test("spends two notes into one payment and leaves no change", async () => {
    const { pool } = fakePool();
    const built = await buildTransaction(
      request(pool, { inputs: [NOTES_ON_CHAIN[1], NOTES_ON_CHAIN[2]], exitAmount: 2n * AMOUNT - FEE }),
    );
    assert.equal(built.change, null);
    for (const [index, commitment] of built.witness.publics.commitments.entries()) {
      const memo = built.memos.slice(index * MEMO_BYTES, (index + 1) * MEMO_BYTES);
      assert.equal(await openMemo(epochKeysOf(ACCOUNT, 0), commitment, memo), null, "a filler memo opens for nobody");
    }
  });

  test("names no asset and no recipient when nothing leaves the pool", async () => {
    const { pool } = fakePool();
    const built = await buildTransaction(request(pool, { exitAmount: 0n, recipient: null, fee: 0n }));
    assert.equal(built.witness.publics.exitAsset, 0n);
    assert.equal(built.witness.publics.recipient, 0n);
    assert.equal(built.change?.amount, AMOUNT);
  });

  test("refuses what the pool would refuse, before anything is proved", async () => {
    const { pool } = fakePool();
    await assert.rejects(buildTransaction(request(pool, { inputs: [noteAt(1, "pending")] })), /only a settled note/);
    await assert.rejects(buildTransaction(request(pool, { exitAmount: AMOUNT })), /needs more/);
    await assert.rejects(buildTransaction(request(pool, { exitAmount: 0n })), /needs a recipient/);
    await assert.rejects(
      buildTransaction(request(pool, { inputs: [{ ...NOTES_ON_CHAIN[2], commitment: bytes32Of(9n) }] })),
      /commitments differ/,
    );
    const { pool: behind } = fakePool(leavesOf(NOTES_ON_CHAIN), 4);
    await assert.rejects(buildTransaction(request(behind)), /the tree holds 4/);
  });
});

describe("buildTransaction, proved", () => {
  const assets = fileURLToPath(new URL("../../assets/crs/", import.meta.url));
  let prover: TransactProver;
  before(async () => {
    prover = await createTransactProver({
      g1: new Uint8Array(readFileSync(`${assets}bn254_g1.dat`)),
      g2: new Uint8Array(readFileSync(`${assets}bn254_g2.dat`)),
    });
  });
  after(async () => {
    await prover.destroy();
  });

  /* noir_js runs every constraint before bb.js proves, so a witness that does not satisfy the circuit fails here. */
  test("satisfies the transact circuit, whose public inputs are what the pool is sent", async () => {
    const { pool } = fakePool();
    const built = await buildTransaction(request(pool, { inputs: [NOTES_ON_CHAIN[3], NOTES_ON_CHAIN[6]] }));
    const { publicInputs } = await prover.prove(built.witness);
    const { transaction } = built;
    assert.deepEqual(publicInputs.slice(0, 5), [transaction.root, ...transaction.nullifiers, ...transaction.commitments]);
  });
});

describe("withdrawNotes", () => {
  const reader = { network: () => ROBINHOOD_TESTNET, blockNumber: () => Promise.resolve(5n) } as unknown as ChainReader;
  const prover: TransactProver = { prove: () => Promise.resolve({ proof: "0x01", publicInputs: [] }), destroy: () => Promise.resolve() };
  const QUOTE: RelayQuote = { relayer: "0x00000000000000000000000000000000000000c3", asset: ASSET, fee: FEE };

  function memoryStore(notes: readonly ShieldedNote[]): NoteStore & { dropped: ShieldedNote[] } {
    const current = new Map(notes.map((note) => [`${note.epoch}/${note.counter}`, note]));
    const dropped: ShieldedNote[] = [];
    return {
      dropped,
      notes: () => [...current.values()],
      put: (note) => {
        current.set(`${note.epoch}/${note.counter}`, note);
        return Promise.resolve();
      },
      drop: (note) => {
        current.delete(`${note.epoch}/${note.counter}`);
        dropped.push(note);
        return Promise.resolve();
      },
    };
  }

  function relayerThat(answer: (request: RelayRequest) => Promise<{ transaction: `0x${string}`; block: bigint }>): RelayerClient {
    return { url: "http://127.0.0.1:1", quote: () => Promise.resolve(QUOTE), relay: answer };
  }

  function run(fake: FakePool, store: NoteStore, relayer: RelayerClient, steps: WithdrawStep[] = []) {
    return withdrawNotes({
      reader,
      pool: fake.pool,
      store,
      account: ACCOUNT,
      epoch: 0,
      notes: [NOTES_ON_CHAIN[2]],
      amount: 60_000_000_000_000_000n,
      recipient: RECIPIENT,
      quote: QUOTE,
      relayer,
      prover,
      onStep: (step) => steps.push(step),
    });
  }

  /** A relayer whose transaction lands: the notes are spent and the change joins the queue in `MINED_BLOCK`. */
  function landing(fake: FakePool, answer: "mined" | "lost" = "mined"): RelayerClient {
    return relayerThat((sent) => {
      for (const nullifier of sent.transaction.nullifiers) fake.spent.add(nullifier);
      fake.queue.push({ index: BigInt(fake.queue.length), commitment: sent.transaction.commitments[0], memo: new Uint8Array(MEMO_BYTES), block: MINED_BLOCK });
      return answer === "mined" ? Promise.resolve({ transaction: bytes32Of(0xabcn), block: MINED_BLOCK }) : Promise.reject(new Error("timed out"));
    });
  }

  test("saves the notes as spending before relaying, then spent, with the change queued", async () => {
    const fake = fakePool();
    const store = memoryStore(NOTES_ON_CHAIN);
    const steps: WithdrawStep[] = [];
    const withdrawal = await run(fake, store, landing(fake), steps);
    assert.deepEqual(steps, ["building", "proving", "relaying", "confirming"]);
    assert.equal(withdrawal.spent[0].status, "spent");
    assert.equal(withdrawal.spent[0].exit?.transaction, bytes32Of(0xabcn));
    assert.equal(withdrawal.change?.status, "pending");
    assert.equal(withdrawal.change?.leafIndex, BigInt(NOTES));
    assert.equal(withdrawal.change?.origin, "transaction");
  });

  test("settles the notes again and forgets the change when the relayer fails and nothing was spent", async () => {
    const fake = fakePool();
    const store = memoryStore(NOTES_ON_CHAIN);
    await assert.rejects(run(fake, store, relayerThat(() => Promise.reject(new Error("refused")))), /refused/);
    assert.deepEqual(store.notes().find((note) => note.counter === 2), NOTES_ON_CHAIN[2]);
    assert.equal(store.dropped.length, 1);
    assert.equal(store.notes().some((note) => note.counter === CHANGE_COUNTER), false);
  });

  test("saves the notes as spent, and keeps the change to be found, when the relayer fails after the transaction landed", async () => {
    const fake = fakePool();
    const store = memoryStore(NOTES_ON_CHAIN);
    await assert.rejects(run(fake, store, landing(fake, "lost")), /timed out/);
    assert.equal(store.notes().find((note) => note.counter === 2)?.status, "spent");
    assert.equal(store.notes().find((note) => note.counter === CHANGE_COUNTER)?.status, "sending");
  });

  test("churns a note into a new note of the current epoch, paying the relayer and no one else", async () => {
    const fake = fakePool();
    const store = memoryStore(NOTES_ON_CHAIN);
    const sent: RelayRequest[] = [];
    const relayer = landing(fake);
    const outcome = await churnNotes({
      reader,
      pool: fake.pool,
      store,
      account: ACCOUNT,
      epoch: 3,
      notes: [NOTES_ON_CHAIN[2]],
      quote: QUOTE,
      relayer: { ...relayer, relay: (request) => (sent.push(request), relayer.relay(request)) },
      prover,
      onStep: () => undefined,
    });
    assert.equal(sent[0].transaction.exitAmount, 0n);
    assert.equal(sent[0].transaction.recipient, "0x0000000000000000000000000000000000000000");
    assert.equal(sent[0].transaction.fee, FEE);
    assert.deepEqual(outcome.spent[0].exit, {
      kind: "churn",
      recipient: null,
      received: AMOUNT - FEE,
      fee: FEE,
      transaction: bytes32Of(0xabcn),
      at: outcome.spent[0].exit?.at,
    });
    assert.equal(outcome.change?.epoch, 3);
    assert.equal(outcome.change?.counter, 0, "the first note of epoch 3");
    assert.equal(outcome.change?.amount, AMOUNT - FEE);
  });

  test("refuses to churn notes that cannot pay the fee", async () => {
    const fake = fakePool();
    await assert.rejects(
      churnNotes({
        reader,
        pool: fake.pool,
        store: memoryStore(NOTES_ON_CHAIN),
        account: ACCOUNT,
        epoch: 3,
        notes: [NOTES_ON_CHAIN[2]],
        quote: { ...QUOTE, fee: AMOUNT },
        relayer: landing(fake),
        prover,
        onStep: () => undefined,
      }),
      /would leave nothing/,
    );
  });

  test("pays each amount in its own transaction, out of notes planned before the first goes", async () => {
    const fake = fakePool();
    const store = memoryStore(NOTES_ON_CHAIN.slice(0, 2));
    const sent: RelayRequest[] = [];
    const relayer = landing(fake);
    const steps: [number, WithdrawStep][] = [];
    const done = await withdrawPayments({
      reader,
      pool: fake.pool,
      store,
      account: ACCOUNT,
      epoch: 0,
      amounts: [30n * LADDER_UNIT, 10n * LADDER_UNIT],
      recipient: RECIPIENT,
      quote: QUOTE,
      relayer: { ...relayer, relay: (request) => (sent.push(request), relayer.relay(request)) },
      prover,
      onStep: (payment, step) => steps.push([payment, step]),
    });
    assert.equal(done.stopped, null);
    assert.deepEqual(sent.map((request) => request.transaction.exitAmount), [30n * LADDER_UNIT, 10n * LADDER_UNIT]);
    assert.notDeepEqual(sent[0].transaction.nullifiers[0], sent[1].transaction.nullifiers[0], "each payment spends its own note");
    assert.deepEqual(steps.filter(([, step]) => step === "relaying").map(([payment]) => payment), [0, 1]);
    assert.deepEqual(done.sent.map((outcome) => outcome.change?.amount), [AMOUNT - 30n * LADDER_UNIT - FEE, AMOUNT - 10n * LADDER_UNIT - FEE]);
  });

  test("pays an amount off the ladder as one payment, and refuses an empty payment or what the notes cannot all pay", async () => {
    const fake = fakePool();
    const request = {
      reader,
      pool: fake.pool,
      account: ACCOUNT,
      epoch: 0,
      recipient: RECIPIENT,
      quote: QUOTE,
      relayer: landing(fake),
      prover,
      onStep: () => undefined,
    };
    await assert.rejects(withdrawPayments({ ...request, store: memoryStore(NOTES_ON_CHAIN), amounts: [0n] }), /pays nothing/);
    await assert.rejects(
      withdrawPayments({ ...request, store: memoryStore(NOTES_ON_CHAIN.slice(0, 1)), amounts: [30n * LADDER_UNIT, 10n * LADDER_UNIT] }),
      /cannot pay these amounts/,
    );
    assert.equal(fake.spent.size, 0);
    const done = await withdrawPayments({ ...request, store: memoryStore(NOTES_ON_CHAIN), amounts: [ANY_AMOUNT] });
    assert.equal(done.sent.length, 1);
    assert.equal(done.sent[0].spent[0].exit?.received, ANY_AMOUNT);
  });

  test("says why the rest stopped when a later payment fails, and keeps the ones that went", async () => {
    const fake = fakePool();
    const lands = landing(fake);
    let calls = 0;
    const done = await withdrawPayments({
      reader,
      pool: fake.pool,
      store: memoryStore(NOTES_ON_CHAIN.slice(0, 2)),
      account: ACCOUNT,
      epoch: 0,
      amounts: [30n * LADDER_UNIT, 10n * LADDER_UNIT],
      recipient: RECIPIENT,
      quote: QUOTE,
      relayer: { ...lands, relay: (request) => (++calls === 1 ? lands.relay(request) : Promise.reject(new Error("relayer down"))) },
      prover,
      onStep: () => undefined,
    });
    assert.equal(done.sent.length, 1);
    assert.match(done.stopped ?? "", /relayer down/);
  });

  test("refuses a quote for another asset", async () => {
    const fake = fakePool();
    await assert.rejects(
      withdrawNotes({
        reader,
        pool: fake.pool,
        store: memoryStore(NOTES_ON_CHAIN),
        account: ACCOUNT,
        epoch: 0,
        notes: [NOTES_ON_CHAIN[2]],
        amount: 1n,
        recipient: RECIPIENT,
        quote: { ...QUOTE, asset: RECIPIENT },
        relayer: landing(fake),
        prover,
        onStep: () => undefined,
      }),
      /The quote is for/,
    );
  });
});

