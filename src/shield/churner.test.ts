import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { accountKeys } from "@decoy/protocol";
import type { PoolReader } from "../chain/pool";
import type { ChainReader } from "../chain/reader";
import type { Address, ShieldedNote } from "../domain/types";
import { CHURN_SCHEDULE } from "../protocol/parameters";
import type { TransactProver } from "../prove/transactProver";
import type { RelayerClient } from "../relay/client";
import type { RelayQuote } from "../relay/protocol";
import { chooseChurn, createChurner } from "./churner";
import type { NoteStore } from "./shieldNote";
import { createNoteLock } from "./noteLock";
import type { RelayedRequest, TransactOutcome } from "./withdraw";

const ASSET: Address = "0xd33de4d258d964b19ac83f4c80d81a0689a9d757";
const OTHER: Address = "0x00000000000000000000000000000000000000e7";
const FEE = 80_000_000_000_000n;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 24, 12);

function note(epoch: number, counter: number, amount: bigint, change: Partial<ShieldedNote> = {}): ShieldedNote {
  return {
    epoch,
    counter,
    asset: ASSET,
    amount,
    commitment: `0x${String(epoch * 100 + counter).padStart(64, "0")}`,
    origin: "deposit",
    from: null,
    status: "settled",
    leafIndex: BigInt(epoch * 100 + counter),
    sentAfterBlock: 1n,
    at: new Date(NOW),
    exit: null,
    ...change,
  };
}

const never = () => Number.POSITIVE_INFINITY;

describe("chooseChurn", () => {
  test("takes settled notes of an older epoch first, with or without the schedule", () => {
    const notes = [note(1, 0, 5n), note(0, 0, 3n), note(0, 1, 9n), note(0, 2, 1n)];
    const chosen = chooseChurn(notes, 1, false, never, NOW);
    assert.deepEqual(chosen?.map((picked) => picked.amount), [9n, 1n], "the largest, and the smallest beside it");
  });

  test("leaves a note out until the tree holds it, and never mixes assets", () => {
    const notes = [note(0, 0, 9n, { status: "pending", leafIndex: null }), note(0, 1, 4n, { asset: OTHER }), note(0, 2, 2n)];
    assert.deepEqual(chooseChurn(notes, 1, false, never, NOW)?.map((picked) => picked.counter), [1]);
  });

  test("churns a note of the current epoch only on the schedule, once its time has come", () => {
    const notes = [note(2, 0, 5n)];
    assert.equal(chooseChurn(notes, 2, false, () => NOW - 1, NOW), null);
    assert.equal(chooseChurn(notes, 2, true, () => NOW + 1, NOW), null);
    assert.deepEqual(chooseChurn(notes, 2, true, () => NOW, NOW)?.map((picked) => picked.counter), [0]);
  });
});

function memoryStore(notes: ShieldedNote[]): NoteStore {
  let held = [...notes];
  return {
    notes: () => held,
    put: (changed) => {
      held = [...held.filter((stored) => !(stored.epoch === changed.epoch && stored.counter === changed.counter)), changed];
      return Promise.resolve();
    },
    drop: (dropped) => {
      held = held.filter((stored) => !(stored.epoch === dropped.epoch && stored.counter === dropped.counter));
      return Promise.resolve();
    },
  };
}

const QUOTE: RelayQuote = { relayer: "0x00000000000000000000000000000000000000c3", asset: ASSET, fee: FEE };
const relayer: RelayerClient = { url: "http://127.0.0.1:1", quote: () => Promise.resolve(QUOTE), relay: () => Promise.reject(new Error("not sent")) };
const prover = { prove: () => Promise.reject(new Error("not proved")), destroy: () => Promise.resolve() } as unknown as TransactProver;

function pool(frozen = false): PoolReader {
  return { frozen: () => Promise.resolve(frozen) } as unknown as PoolReader;
}

function churner(store: NoteStore, change: { relayer?: RelayerClient | null; frozen?: boolean; epoch?: number } = {}) {
  const sent: RelayedRequest[] = [];
  const instance = createChurner({
    reader: {} as ChainReader,
    pool: pool(change.frozen),
    store,
    account: accountKeys(new Uint8Array(64).fill(7)),
    epoch: () => change.epoch ?? 1,
    scheduled: () => false,
    relayer: () => (change.relayer === undefined ? relayer : change.relayer),
    prover: () => Promise.resolve(prover),
    lock: createNoteLock(),
    pollMs: HOUR,
    send: (request) => {
      sent.push(request);
      return Promise.resolve({ spent: request.notes, change: null } satisfies TransactOutcome);
    },
    random: () => 0.5,
  });
  return { instance, sent };
}

describe("createChurner", () => {
  test("sends one churn per check into the current epoch, for the fee the relayer quoted", async () => {
    const store = memoryStore([note(0, 0, 10n ** 16n), note(0, 1, 3n * 10n ** 16n), note(0, 2, 10n ** 15n)]);
    const { instance, sent } = churner(store);
    await instance.check();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].epoch, 1);
    assert.deepEqual(sent[0].quote, QUOTE);
    assert.deepEqual(sent[0].notes.map((picked) => picked.counter), [1, 2]);
    assert.equal(instance.state().behind, 3, "the fake send saves nothing, so all three are still behind");
    assert.equal(instance.state().problem, null);
  });

  test("says what blocks it: no relayer, or a frozen pool", async () => {
    const store = memoryStore([note(0, 0, 10n ** 16n)]);
    const unset = churner(store, { relayer: null });
    await unset.instance.check();
    assert.deepEqual(unset.sent, []);
    assert.deepEqual(unset.instance.state(), { behind: 1, blocked: "noRelayer", churning: false, problem: null });
    const frozen = churner(store, { frozen: true });
    await frozen.instance.check();
    assert.deepEqual(frozen.sent, []);
    assert.equal(frozen.instance.state().blocked, "frozen");
  });

  test("refuses notes that cannot pay the fee, and says so", async () => {
    const { instance, sent } = churner(memoryStore([note(0, 0, FEE)]));
    await instance.check();
    assert.deepEqual(sent, []);
    assert.match(instance.state().problem ?? "", /cannot pay a churn's fee/);
  });

  test("schedules each note of the current epoch within the jitter around the mean", async () => {
    const early = CHURN_SCHEDULE.meanHours * HOUR * (1 - CHURN_SCHEDULE.jitterPercent / 100);
    const store = memoryStore([note(1, 0, 10n ** 16n, { at: new Date(Date.now() - early - HOUR) })]);
    const sent: RelayedRequest[] = [];
    const instance = createChurner({
      reader: {} as ChainReader,
      pool: pool(),
      store,
      account: accountKeys(new Uint8Array(64).fill(7)),
      epoch: () => 1,
      scheduled: () => true,
      relayer: () => relayer,
      prover: () => Promise.resolve(prover),
      lock: createNoteLock(),
      pollMs: HOUR,
      send: (request) => {
        sent.push(request);
        return Promise.resolve({ spent: request.notes, change: null });
      },
      random: () => 0,
    });
    await instance.check();
    assert.equal(sent.length, 1, "at the earliest the jitter allows, the note is due");
  });
});
