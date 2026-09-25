import type { ActivityEntry, Asset, Holding, NoteExit, NoteStatus, ShieldedNote } from "../domain/types";
import type { NetworkConfig, TokenConfig } from "../network/types";

/**
 * Notes that hold value: a note still being sent is not counted until its deposit is found on chain, and a note on its
 * way out, by withdrawal or claim, is no longer counted.
 */
const HELD: readonly NoteStatus[] = ["pending", "settled"];

function tokenOf(network: NetworkConfig, note: ShieldedNote): TokenConfig {
  const token = network.tokens.find((candidate) => candidate.address.toLowerCase() === note.asset.toLowerCase());
  if (!token) throw new Error(`Note ${note.epoch}/${note.counter} holds ${note.asset}, which ${network.label} does not list`);
  return token;
}

/** The asset a token is shown as. Its name is its symbol until a chain read names it. */
export function assetOf(token: TokenConfig): Asset {
  return { symbol: token.symbol, name: token.symbol, kind: token.kind, decimals: token.decimals };
}

/** What the account's notes add up to, per asset. */
export function holdingsOf(notes: readonly ShieldedNote[], network: NetworkConfig): Holding[] {
  const totals = new Map<string, Holding>();
  for (const note of notes) {
    if (!HELD.includes(note.status)) continue;
    const asset = assetOf(tokenOf(network, note));
    const held = totals.get(asset.symbol);
    totals.set(asset.symbol, { asset, amount: (held?.amount ?? 0n) + note.amount });
  }
  return [...totals.values()];
}

function depositEntry(note: ShieldedNote, network: NetworkConfig): ActivityEntry {
  return {
    id: `note-${note.epoch}-${note.counter}`,
    kind: "deposit",
    holding: { asset: assetOf(tokenOf(network, note)), amount: note.amount },
    counterparty: note.from,
    at: note.at,
    status: note.status === "pending" ? "pending" : "settled",
  };
}

/**
 * A withdrawal or a claim, for what the recipient is paid, or a churn, for what its new note holds. It is pending until
 * the note is spent.
 */
function exitEntry(note: ShieldedNote, exit: NoteExit, network: NetworkConfig): ActivityEntry {
  return {
    id: `exit-${note.epoch}-${note.counter}`,
    kind: exit.kind === "churn" ? "churn" : "withdraw",
    holding: { asset: assetOf(tokenOf(network, note)), amount: exit.received },
    counterparty: exit.recipient,
    at: exit.at,
    status: note.status === "spent" ? "settled" : "pending",
  };
}

/**
 * The account's deposits, withdrawals and churns, newest first. A deposit is pending until the tree absorbs it; a note still
 * being sent has no entry until the pool has queued it. Change a transaction made is not an entry of its own.
 */
export function activityOf(notes: readonly ShieldedNote[], network: NetworkConfig): ActivityEntry[] {
  return notes
    .filter((note) => note.status !== "sending")
    .flatMap((note) => [
      ...(note.origin === "deposit" ? [depositEntry(note, network)] : []),
      ...(note.exit ? [exitEntry(note, note.exit, network)] : []),
    ])
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}
