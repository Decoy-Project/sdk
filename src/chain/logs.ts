import type { Address } from "../domain/types";
import { ChainError } from "./errors";
import type { ChainReader } from "./reader";
import type { RpcRequest } from "./rpc";

/** How the SDK reads event logs. */
export const LOG_POLICY = {
  /**
   * Blocks one `eth_getLogs` may span. MEASURED 24 Sep 2026: Alchemy's Robinhood Chain testnet endpoint refuses more
   * than 10,000 on a paid plan, and the public endpoint takes any range. Every read keeps to the smallest cap an
   * endpoint has, because the client may fail over from one endpoint to another in the middle of a read.
   */
  blockRange: 10_000n,
  /** Ranges read at once. ESTIMATE, 24 Sep 2026: few enough to stay under an endpoint's rate limit. */
  concurrency: 4,
} as const;

/** Which logs to read. A null topic matches any value; no address matches every contract. */
export interface LogFilter {
  readonly address?: Address;
  readonly topics: readonly (string | null)[];
}

/** One stretch of blocks, both ends included. */
export interface BlockRange {
  readonly from: bigint;
  readonly to: bigint;
}

/** `fromBlock` to `toBlock` cut into ranges no wider than `width` blocks, oldest first. Empty when `fromBlock` is later. */
export function logRanges(fromBlock: bigint, toBlock: bigint, width: bigint = LOG_POLICY.blockRange): BlockRange[] {
  if (width <= 0n) throw new Error(`A log range must span at least one block, not ${width}`);
  const ranges: BlockRange[] = [];
  for (let from = fromBlock; from <= toBlock; from += width) {
    const to = from + width - 1n;
    ranges.push({ from, to: to < toBlock ? to : toBlock });
  }
  return ranges;
}

function hexBlock(block: bigint): string {
  return `0x${block.toString(16)}`;
}

function readRange(reader: ChainReader, filter: LogFilter, range: BlockRange): Promise<readonly unknown[]> {
  const request: RpcRequest = {
    method: "eth_getLogs",
    params: [{ ...filter, fromBlock: hexBlock(range.from), toBlock: hexBlock(range.to) }],
  };
  return reader.rpc.call(request, (result) => {
    if (!Array.isArray(result)) throw new ChainError("badResponse", "eth_getLogs did not return a list");
    return result as readonly unknown[];
  });
}

/**
 * Every log matching `filter` from `fromBlock` to `toBlock`, both included, oldest first. The span is read a range at a
 * time, a few ranges at once, so no request is wider than an endpoint takes. One failed range fails the whole read: a
 * log list with a hole in it would be a wrong answer.
 */
export async function readLogs(
  reader: ChainReader,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<readonly unknown[]> {
  const ranges = logRanges(fromBlock, toBlock);
  const pages: (readonly unknown[])[] = [];
  let next = 0;
  async function work(): Promise<void> {
    while (next < ranges.length) {
      const index = next;
      next += 1;
      pages[index] = await readRange(reader, filter, ranges[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOG_POLICY.concurrency, ranges.length) }, work));
  return pages.flat();
}
