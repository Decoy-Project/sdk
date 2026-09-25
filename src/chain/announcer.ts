import { hexToBytes } from "@noble/hashes/utils.js";
import type { Address } from "../domain/types";
import { STEALTH_SCHEME_ID } from "../keys/stealth";
import { uintWord } from "./abi";
import { ChainError } from "./errors";
import { readLogs } from "./logs";
import type { ChainReader } from "./reader";

/**
 * topic0 of `Announcement(uint256,address,address,bytes,bytes)`, ERC-5564's one event, which indexes the scheme id, the
 * stealth address and the caller. `announcer.test.ts` recomputes it.
 */
export const ANNOUNCEMENT_TOPIC = "0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7";

const WORD_HEX = 64;

/** One stealth payment as the Announcer logged it. */
export interface Announcement {
  readonly stealthAddress: Address;
  readonly ephemeralPublicKey: Uint8Array;
  /** Byte 0 is the view tag. */
  readonly metadata: Uint8Array;
  readonly block: bigint;
}

export interface AnnouncementPage {
  readonly announcements: readonly Announcement[];
  /** The last block this page covers. The next page starts one block later. */
  readonly toBlock: bigint;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads the ABI `bytes` whose offset sits in word `index` of `data`. */
function dynamicBytes(data: string, index: number): Uint8Array {
  const hex = data.slice(2);
  const offset = Number(BigInt(`0x${hex.slice(index * WORD_HEX, (index + 1) * WORD_HEX)}`)) * 2;
  const length = Number(BigInt(`0x${hex.slice(offset, offset + WORD_HEX)}`)) * 2;
  const bytes = hex.slice(offset + WORD_HEX, offset + WORD_HEX + length);
  if (bytes.length !== length) throw new ChainError("badResponse", "An Announcement log carries truncated bytes");
  return hexToBytes(bytes);
}

function decodeAnnouncement(log: unknown): Announcement {
  if (!isObject(log) || !Array.isArray(log.topics) || typeof log.data !== "string" || typeof log.blockNumber !== "string") {
    throw new ChainError("badResponse", "eth_getLogs returned an Announcement this client cannot read");
  }
  const stealthTopic = log.topics[2];
  if (typeof stealthTopic !== "string") throw new ChainError("badResponse", "An Announcement log names no stealth address");
  return {
    stealthAddress: `0x${stealthTopic.slice(-40).toLowerCase()}`,
    ephemeralPublicKey: dynamicBytes(log.data, 0),
    metadata: dynamicBytes(log.data, 1),
    block: BigInt(log.blockNumber),
  };
}

/** Every scheme 1 announcement from `fromBlock` to the current height, read in ranges an endpoint takes. */
export async function readAnnouncements(reader: ChainReader, announcer: Address, fromBlock: bigint): Promise<AnnouncementPage> {
  const toBlock = await reader.blockNumber();
  const filter = { address: announcer, topics: [ANNOUNCEMENT_TOPIC, `0x${uintWord(STEALTH_SCHEME_ID)}`] };
  const logs = await readLogs(reader, filter, fromBlock, toBlock);
  return { announcements: logs.map(decodeAnnouncement), toBlock };
}
