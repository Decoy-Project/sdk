import type { Unsubscribe } from "../client/types";
import type { SyncState } from "../domain/types";
import type { ChainReader } from "./reader";

export type SyncListener = (state: SyncState) => void;

export interface ChainSync {
  state: () => SyncState;
  /** Calls the listener after every state change. Returns a function that removes the listener. */
  subscribe: (listener: SyncListener) => Unsubscribe;
  /**
   * Reads the height once. A failed read becomes the offline state rather than a rejection: this is the one place where
   * an unreachable chain is an answer, because a poller has nowhere to throw to. Which endpoint failed, and why, stays
   * readable on `ChainReader.endpoints()`.
   */
  refresh: () => Promise<void>;
  /** Starts polling. Calling it twice does nothing the second time. */
  start: () => void;
  stop: () => void;
}

export interface ChainSyncOptions {
  readonly pollMs: number;
}

const OFFLINE: SyncState = { status: "offline", block: 0n, endpoint: null };

/** Tracks the chain height and the endpoint serving it. The only moving part between a client and a live chain. */
export function createChainSync(reader: ChainReader, options: ChainSyncOptions): ChainSync {
  let state: SyncState = OFFLINE;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  const listeners = new Set<SyncListener>();

  function publish(next: SyncState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }

  /**
   * Syncing is shown only while the client has no current height: before the first read, and after the chain was
   * offline. A routine poll of a synced client keeps it synced, so the status does not flicker at every poll.
   */
  async function refresh(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    if (state.status !== "synced") publish({ status: "syncing", block: state.block, endpoint: state.endpoint });
    try {
      const block = await reader.blockNumber();
      publish({ status: "synced", block, endpoint: reader.servedBy()?.id ?? null });
    } catch {
      publish({ status: "offline", block: state.block, endpoint: null });
    } finally {
      inFlight = false;
    }
  }

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    start: () => {
      if (timer !== null) return;
      void refresh();
      timer = setInterval(() => void refresh(), options.pollMs);
    },
    stop: () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
