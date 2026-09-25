import { nullifierOf, type AccountKeys } from "@decoy/protocol";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { bytes32Of } from "../chain/abi";
import { readAnnouncements } from "../chain/announcer";
import type { ChainReader } from "../chain/reader";
import { quoteFees, type FeeQuote } from "../chain/signer";
import type { Unsubscribe } from "../client/types";
import type { Address, AmountMode, ShieldedNote } from "../domain/types";
import { receiveKey, type EvmKey } from "../keys/evm";
import { metaAddressOf, openAnnouncement, stealthKeys, type StealthKeys } from "../keys/stealth";
import { noteSecrets } from "./note";
import type { NoteLock } from "./noteLock";
import { gasReserve, planShield } from "./plan";
import { shieldSetup } from "./setup";
import type { ShieldStep } from "./shield";
import { shieldNotes, type NoteStore } from "./shieldNote";

export type ReceivePhase = "waiting" | "shielding" | "failed";

/** A fresh address is handed out by the account; a stealth address is one a sender derived from the meta-address. */
export type ReceiveKind = "fresh" | "stealth";

/** One address the receiver watches, as the last check saw it. */
export interface ReceiveAddress {
  readonly id: string;
  readonly kind: ReceiveKind;
  /** Its place among the addresses of its kind, from 0. */
  readonly index: number;
  readonly address: Address;
  /** Balances in base units at the last check. Null before the first. */
  readonly native: bigint | null;
  readonly wrapped: bigint | null;
  readonly phase: ReceivePhase;
  readonly step: ShieldStep | null;
  /** Why the last shield from this address failed. The address is not tried again until `retry`. */
  readonly problem: string | null;
}

/** A stealth payment the account's viewing key opened: enough to derive the stealth address's key again. */
export interface StealthPayment {
  readonly stealthAddress: Address;
  /** Compressed secp256k1 point, 33 bytes. */
  readonly ephemeralPublicKey: `0x${string}`;
  readonly viewTag: number;
}

/** Where the account's stealth scan stands, kept so that a new session goes on from where the last one saved. */
export interface StealthScanStore {
  /** The first block not scanned yet. Null for an account made on this device and never scanned: nothing was sent to
   *  it before it existed, so its first scan starts at the chain's head. */
  next: () => bigint | null;
  /** The payments earlier scans opened. */
  payments: () => readonly StealthPayment[];
  /** Saves that every block before `next` is scanned, with the payments opened in them. Resolves once durable. */
  record: (next: bigint, found: readonly StealthPayment[]) => Promise<void>;
}

export interface ReceiverOptions {
  readonly reader: ChainReader;
  readonly seed: Uint8Array;
  readonly account: AccountKeys;
  /** The account's current epoch: every note shielded now is made in it. */
  readonly epoch: () => number;
  /** How what arrives becomes notes, read at every check: all of it, or the largest ladder amount. */
  readonly mode: () => AmountMode;
  readonly store: NoteStore;
  readonly stealthScan: StealthScanStore;
  /** How many fresh receive addresses the account has handed out. */
  readonly issued: () => number;
  /** Shared with everything else that makes or spends notes, so a shield never takes a counter another note holds. */
  readonly lock: NoteLock;
  readonly pollMs: number;
}

/**
 * Blocks a scan may get ahead of what is saved before it saves. ESTIMATE, 24 Sep 2026: about 2.9 hours of chain at the
 * 103.5 ms block time MEASURED on 12 Sep 2026, so a new session rescans at most ten log ranges, and the vault is not
 * rewritten on every check. A found payment is saved at once.
 */
const STEALTH_SAVE_BLOCKS = 100_000n;

export interface Receiver {
  start: () => void;
  stop: () => void;
  /** Scans for stealth payments, then checks every address once and shields what it can. One check runs at a time. */
  check: () => Promise<void>;
  /** The same list until something changes, so a user interface can subscribe to it. */
  addresses: () => readonly ReceiveAddress[];
  /** The stealth meta-address to share, or null on a network without an Announcer. */
  metaAddress: () => string | null;
  /** Why the last check could not finish, or null. */
  problem: () => string | null;
  /**
   * Whether a check has finished since this receiver was made, whether or not it succeeded. Until one has, the notes'
   * statuses are as the vault saved them.
   */
  checked: () => boolean;
  /** Whether the guardian has frozen the pool, as of the last check; null before the first. A frozen pool takes nothing. */
  frozen: () => boolean | null;
  /** Lets a failed address be tried again at the next check. */
  retry: (id: string) => void;
  subscribe: (listener: () => void) => Unsubscribe;
}

interface Watched {
  readonly id: string;
  readonly kind: ReceiveKind;
  readonly index: number;
  readonly key: EvmKey;
}

/** A note's identity: its epoch and its counter within it. */
function noteId(note: ShieldedNote): string {
  return `${note.epoch}/${note.counter}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Watches the account's fresh receive addresses and the stealth addresses senders paid, and shields whatever arrives:
 * the native token is wrapped and deposited as notes of this account, all of it or, in ladder mode, the largest ladder
 * amount. Gas for the next shield stays at the address, and so does what does not fit the ladder. Nothing is shielded
 * into a frozen pool.
 */
export function createReceiver(options: ReceiverOptions): Receiver {
  const { reader, store } = options;
  const setup = shieldSetup(reader);
  const { account } = options;
  const stealth: StealthKeys = stealthKeys(options.seed);
  const freshKeys = new Map<number, EvmKey>();
  const stealthFound: Watched[] = options.stealthScan.payments().map((payment, index) => stealthEntry(payment, index));
  const states = new Map<string, ReceiveAddress>();
  const listeners = new Set<() => void>();
  /** The first block this session has not scanned, and the first the store has not saved as scanned. */
  let scanNext: bigint | null = options.stealthScan.next();
  let savedNext = scanNext;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastProblem: string | null = null;
  let checked = false;
  let poolFrozen: boolean | null = null;
  let snapshot: readonly ReceiveAddress[] = [];
  let changed = true;
  /**
   * Notes that were already spending when this receiver was made: withdrawals a closed app left behind. Only these are
   * settled against the chain here; a withdrawal started in this session settles itself.
   */
  const leftBehind = new Set(store.notes().filter((note) => note.status === "spending").map(noteId));

  /** A payment an earlier scan saved. One the account's viewing key no longer opens means the saved account is damaged. */
  function stealthEntry(payment: StealthPayment, index: number): Watched {
    const key = openAnnouncement(stealth, { ...payment, ephemeralPublicKey: hexToBytes(payment.ephemeralPublicKey.slice(2)) });
    if (!key) throw new Error(`The saved stealth payment to ${payment.stealthAddress} does not open with this account's keys`);
    return { id: `stealth:${key.address}`, kind: "stealth", index, key };
  }

  function freshAt(index: number): Watched {
    let key = freshKeys.get(index);
    if (!key) {
      key = receiveKey(options.seed, index);
      freshKeys.set(index, key);
    }
    return { id: `fresh:${index}`, kind: "fresh", index, key };
  }

  function watched(): Watched[] {
    return [...Array.from({ length: options.issued() }, (_, index) => freshAt(index)), ...stealthFound];
  }

  function notify(): void {
    changed = true;
    for (const listener of listeners) listener();
  }

  function stateOf(entry: Watched): ReceiveAddress {
    return (
      states.get(entry.id) ?? {
        id: entry.id,
        kind: entry.kind,
        index: entry.index,
        address: entry.key.address,
        native: null,
        wrapped: null,
        phase: "waiting",
        step: null,
        problem: null,
      }
    );
  }

  function update(entry: Watched, change: Partial<ReceiveAddress>): void {
    states.set(entry.id, { ...stateOf(entry), ...change });
    notify();
  }

  function addresses(): readonly ReceiveAddress[] {
    const all = watched();
    if (changed || snapshot.length !== all.length) {
      snapshot = all.map(stateOf);
      changed = false;
    }
    return snapshot;
  }

  /** Adds every stealth payment announced since the last scan that this account's viewing key opens. */
  async function scanStealth(): Promise<void> {
    if (setup.announcer === null) return;
    const from = scanNext ?? (await reader.blockNumber());
    const page = await readAnnouncements(reader, setup.announcer, from);
    const found: StealthPayment[] = [];
    for (const announcement of page.announcements) {
      const [viewTag] = announcement.metadata;
      if (viewTag === undefined) continue;
      const payment: StealthPayment = {
        stealthAddress: announcement.stealthAddress,
        ephemeralPublicKey: `0x${bytesToHex(announcement.ephemeralPublicKey)}`,
        viewTag,
      };
      const key = openAnnouncement(stealth, { ...announcement, viewTag });
      if (!key || stealthFound.some((entry) => entry.key.address === key.address)) continue;
      found.push(payment);
      stealthFound.push(stealthEntry(payment, stealthFound.length));
      notify();
    }
    scanNext = page.toBlock + 1n;
    /* A new account's first scan is saved at once: it fixes where the account's history starts. */
    if (found.length > 0 || savedNext === null || scanNext - savedNext >= STEALTH_SAVE_BLOCKS) {
      await options.stealthScan.record(scanNext, found);
      savedNext = scanNext;
    }
  }

  /** A note saved as sending whose transaction queued it after all becomes pending. */
  async function recoverSending(): Promise<void> {
    const sending = store.notes().filter((note) => note.status === "sending");
    if (sending.length === 0) return;
    const from = sending.reduce(
      (lowest, note) => (note.sentAfterBlock < lowest ? note.sentAfterBlock : lowest),
      sending[0].sentAfterBlock,
    );
    const leaves = await setup.pool.leaves(from);
    for (const note of sending) {
      const found = leaves.find((leaf) => leaf.commitment.toLowerCase() === note.commitment.toLowerCase());
      if (found) await store.put({ ...note, status: "pending", leafIndex: found.index });
    }
  }

  /**
   * A withdrawal left behind is over: the pool either shows its nullifier spent, and the note is spent, or it does not,
   * and the note is settled again, free to withdraw.
   */
  async function recoverSpending(): Promise<void> {
    for (const note of store.notes().filter((candidate) => leftBehind.has(noteId(candidate)))) {
      if (note.status === "spending" && note.leafIndex !== null) {
        const secrets = noteSecrets(account, note.epoch, note.counter);
        const nullifier = bytes32Of(nullifierOf(secrets.noteNullifierKey, note.leafIndex));
        const spent = await setup.pool.isSpent(nullifier);
        await store.put(spent ? { ...note, status: "spent" } : { ...note, status: "settled", exit: null });
      }
      leftBehind.delete(noteId(note));
    }
  }

  /** A pending note the tree has absorbed is settled: it can be spent. */
  async function settle(): Promise<void> {
    const pending = store.notes().filter((note) => note.status === "pending" && note.leafIndex !== null);
    if (pending.length === 0) return;
    const { absorbedCount } = await setup.pool.state();
    for (const note of pending) {
      if (note.leafIndex !== null && note.leafIndex < absorbedCount) await store.put({ ...note, status: "settled" });
    }
  }

  async function readBalances(entry: Watched): Promise<{ native: bigint; wrapped: bigint }> {
    const [native, wrapped] = await Promise.all([
      reader.nativeBalance(entry.key.address),
      reader.tokenBalance(setup.token.address, entry.key.address),
    ]);
    update(entry, { native, wrapped });
    return { native, wrapped };
  }

  async function shieldFrom(entry: Watched, amounts: readonly bigint[]): Promise<void> {
    update(entry, { phase: "shielding", step: null, problem: null });
    try {
      await options.lock(() =>
        shieldNotes({
          reader,
          setup,
          store,
          account,
          epoch: options.epoch(),
          from: entry.key,
          amounts,
          onStep: (step) => update(entry, { step }),
        }),
      );
      update(entry, { phase: "waiting", step: null });
      await readBalances(entry);
    } catch (error) {
      /* Shown on the address, and not retried on its own: a shield that reverted would revert again and burn gas. */
      update(entry, { phase: "failed", step: null, problem: messageOf(error) });
    }
  }

  async function checkAddress(entry: Watched, fees: FeeQuote): Promise<void> {
    const { native, wrapped } = await readBalances(entry);
    if (stateOf(entry).phase === "failed" || poolFrozen !== false) return;
    const room = await setup.pool.room(setup.token.address);
    const reserve = gasReserve(setup.gas, fees);
    const plan = planShield({ mode: options.mode(), native, wrapped, reserve, ladderUnit: setup.token.ladderUnit, room });
    if (plan) await shieldFrom(entry, plan.amounts);
  }

  async function runCheck(): Promise<void> {
    try {
      poolFrozen = await setup.pool.frozen();
      await scanStealth();
      await recoverSending();
      await recoverSpending();
      await settle();
      const fees = await quoteFees(reader);
      for (const entry of watched()) await checkAddress(entry, fees);
      lastProblem = null;
    } catch (error) {
      /* A poller has nowhere to throw to: the failed read is reported, as the sync line reports an offline chain. */
      lastProblem = messageOf(error);
    }
    checked = true;
    notify();
  }

  function check(): Promise<void> {
    running ??= runCheck().finally(() => {
      running = null;
    });
    return running;
  }

  function entryById(id: string): Watched {
    const entry = watched().find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`The receiver watches no address ${id}`);
    return entry;
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
    addresses,
    metaAddress: () => (setup.announcer === null ? null : metaAddressOf(stealth)),
    problem: () => lastProblem,
    checked: () => checked,
    frozen: () => poolFrozen,
    retry: (id) => update(entryById(id), { phase: "waiting", problem: null }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
