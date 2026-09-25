import type { AccountKeys } from "@decoy/protocol";
import type { PoolReader } from "../chain/pool";
import type { ChainReader } from "../chain/reader";
import type { Unsubscribe } from "../client/types";
import type { ShieldedNote } from "../domain/types";
import { CHURN_SCHEDULE } from "../protocol/parameters";
import type { TransactProver } from "../prove/transactProver";
import type { RelayerClient } from "../relay/client";
import type { NoteStore } from "./shieldNote";
import type { NoteLock } from "./noteLock";
import { churnNotes, type RelayedRequest, type TransactOutcome } from "./withdraw";

const MS_PER_HOUR = 3_600_000;
const PERCENT = 100;

export interface ChurnerOptions {
  readonly reader: ChainReader;
  readonly pool: PoolReader;
  readonly store: NoteStore;
  readonly account: AccountKeys;
  /** The account's current epoch: every churn makes its note in it. */
  readonly epoch: () => number;
  /** Whether notes of the current epoch churn on the schedule. Notes in an older epoch churn whatever this says. */
  readonly scheduled: () => boolean;
  /** The relayer churns go through, or null while none is set: nothing churns then. */
  readonly relayer: () => RelayerClient | null;
  /** Starts the prover when the first churn needs it. */
  readonly prover: () => Promise<TransactProver>;
  /** Shared with everything else that makes or spends notes, so none of them take the same counter or note. */
  readonly lock: NoteLock;
  readonly pollMs: number;
  /** Sends a churn. Tests pass their own; the account's clients leave it to `churnNotes`. */
  readonly send?: (request: RelayedRequest) => Promise<TransactOutcome>;
  /** A uniform draw in [0, 1), for each note's schedule. Tests pass their own. */
  readonly random?: () => number;
}

/** What the churner can do now. */
export interface ChurnerState {
  /** Notes held in epochs before the current one, which a revoke or a restore left behind. They churn first. */
  readonly behind: number;
  /** What stops every churn: no relayer is set, or the pool is frozen. Null when nothing does. */
  readonly blocked: "noRelayer" | "frozen" | null;
  /** Whether a churn is being sent now. */
  readonly churning: boolean;
  /** Why the last check could not churn, or null. */
  readonly problem: string | null;
}

export interface Churner {
  start: () => void;
  stop: () => void;
  /** Sends at most one churn. One check runs at a time. */
  check: () => Promise<void>;
  /** The same object until something changes, so a user interface can subscribe to it. */
  state: () => ChurnerState;
  subscribe: (listener: () => void) => Unsubscribe;
}

function noteId(note: ShieldedNote): string {
  return `${note.epoch}/${note.counter}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function held(note: ShieldedNote): boolean {
  return note.status !== "spent";
}

/**
 * The notes one churn takes, from the settled notes of one asset: the largest, and the smallest besides it when there
 * is one, so a note too small to pay a fee on its own leaves with one that can.
 */
function pairOf(candidates: readonly ShieldedNote[]): ShieldedNote[] {
  const asset = candidates[0].asset.toLowerCase();
  const same = candidates.filter((note) => note.asset.toLowerCase() === asset).sort((a, b) => Number(b.amount - a.amount));
  return same.length === 1 ? [same[0]] : [same[0], same[same.length - 1]];
}

/**
 * What to churn now, or null: settled notes of an older epoch first, whenever there are any; then, when the schedule
 * is on, settled notes of the current epoch whose time has come.
 */
export function chooseChurn(
  notes: readonly ShieldedNote[],
  epoch: number,
  scheduled: boolean,
  dueAt: (note: ShieldedNote) => number,
  now: number,
): ShieldedNote[] | null {
  const settled = notes.filter((note) => note.status === "settled" && note.leafIndex !== null);
  const behind = settled.filter((note) => note.epoch < epoch);
  if (behind.length > 0) return pairOf(behind);
  if (!scheduled) return null;
  const due = settled.filter((note) => note.epoch === epoch && dueAt(note) <= now);
  return due.length > 0 ? pairOf(due) : null;
}

/** How long a note waits before its scheduled churn: the mean, moved by up to the jitter either way. */
function delayMs(random: () => number): number {
  const jitter = CHURN_SCHEDULE.jitterPercent / PERCENT;
  return CHURN_SCHEDULE.meanHours * MS_PER_HOUR * (1 - jitter + 2 * jitter * random());
}

/** A uniform draw in [0, 1) from the platform's cryptographic source. */
function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

/**
 * Churns the account's notes through the relayer, one transaction per check: notes an older epoch still holds, so a
 * revoked key sees none of them spent into anything it can read; and, on the schedule, each note of the current epoch
 * a random while after it was made, so a withdrawal's notes do not date its deposit. Nothing churns into a frozen pool
 * or without a relayer.
 */
export function createChurner(options: ChurnerOptions): Churner {
  const { store, lock } = options;
  const send = options.send ?? churnNotes;
  const random = options.random ?? secureRandom;
  const due = new Map<string, number>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  let current: ChurnerState = { behind: 0, blocked: null, churning: false, problem: null };

  function update(change: Partial<ChurnerState>): void {
    const behind = store.notes().filter((note) => held(note) && note.epoch < options.epoch()).length;
    const next = { ...current, behind, ...change };
    if (Object.entries(next).some(([key, value]) => current[key as keyof ChurnerState] !== value)) {
      current = next;
      for (const listener of listeners) listener();
    }
  }

  /** Each note's scheduled time, drawn once per note in this session. */
  function dueAt(note: ShieldedNote): number {
    const id = noteId(note);
    let at = due.get(id);
    if (at === undefined) {
      at = note.at.getTime() + delayMs(random);
      due.set(id, at);
    }
    return at;
  }

  async function churnOnce(relayer: RelayerClient): Promise<void> {
    const chosen = chooseChurn(store.notes(), options.epoch(), options.scheduled(), dueAt, Date.now());
    if (!chosen) return;
    const quote = await relayer.quote(chosen[0].asset);
    const total = chosen.reduce((sum, note) => sum + note.amount, 0n);
    if (total <= quote.fee) throw new Error(`Notes holding ${total} cannot pay a churn's fee of ${quote.fee}`);
    update({ churning: true });
    await send({
      reader: options.reader,
      pool: options.pool,
      store,
      account: options.account,
      epoch: options.epoch(),
      notes: chosen,
      quote,
      relayer,
      prover: await options.prover(),
      onStep: () => undefined,
    });
  }

  async function runCheck(): Promise<void> {
    try {
      const relayer = options.relayer();
      const frozen = await options.pool.frozen();
      const blocked = frozen ? "frozen" : relayer === null ? "noRelayer" : null;
      update({ blocked });
      if (relayer !== null && blocked === null) await lock(() => churnOnce(relayer));
      update({ churning: false, problem: null });
    } catch (error) {
      /* A poller has nowhere to throw to: the failure is shown, and the next check tries again. */
      update({ churning: false, problem: messageOf(error) });
    }
  }

  function check(): Promise<void> {
    running ??= runCheck().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    start: () => {
      if (timer !== null) return;
      timer = setInterval(() => void check(), options.pollMs);
      void check();
    },
    stop: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    check,
    state: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
