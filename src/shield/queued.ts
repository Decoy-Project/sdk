import { bytes32Word } from "../chain/abi";
import { ChainError } from "../chain/errors";
import type { Receipt } from "../chain/signer";
import type { Address } from "../domain/types";
import { POOL_EVENT_TOPIC } from "../network/generated/deployments";

const WORD_HEX = 64;

/** The leaf index the pool gave `commitment` in this receipt's `Queued` event. Its absence is an error, not a guess. */
export function leafIndexIn(receipt: Receipt, pool: Address, commitment: `0x${string}`): bigint {
  const wanted = bytes32Word(commitment);
  const log = receipt.logs.find(
    (entry) =>
      entry.address.toLowerCase() === pool.toLowerCase() &&
      entry.topics[0] === POOL_EVENT_TOPIC.Queued &&
      entry.data.slice(2, 2 + WORD_HEX).toLowerCase() === wanted,
  );
  if (!log || log.topics.length < 2) throw new ChainError("badResponse", `${receipt.hash} did not queue ${commitment}`);
  return BigInt(log.topics[1]);
}
