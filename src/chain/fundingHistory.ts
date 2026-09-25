import type { Address } from "../domain/types";
import type { FundingEvidence } from "../rules/grade";
import { addressWord } from "./abi";
import { ChainError } from "./errors";
import type { ChainReader } from "./reader";

/** topic0 of ERC-20's `Transfer(address,address,uint256)`. `fundingHistory.test.ts` recomputes it. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Transfers one `alchemy_getAssetTransfers` page holds: the most Alchemy returns, 1,000, in hex. */
const TRANSFER_PAGE_SIZE = "0x3e8";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface InboundTransfer {
  readonly from: string;
  readonly block: bigint;
}

function decodeInbound(log: unknown): InboundTransfer {
  if (!isObject(log) || !Array.isArray(log.topics) || typeof log.blockNumber !== "string") {
    throw new ChainError("badResponse", "eth_getLogs returned a Transfer this client cannot read");
  }
  const from = log.topics[1];
  if (typeof from !== "string") throw new ChainError("badResponse", "A Transfer log names no sender");
  return { from: from.toLowerCase(), block: BigInt(log.blockNumber) };
}

function decodeTimestamp(result: unknown): Date {
  if (!isObject(result) || typeof result.timestamp !== "string") {
    throw new ChainError("badResponse", "eth_getBlockByNumber returned no timestamp");
  }
  return new Date(Number(BigInt(result.timestamp)) * 1000);
}

/**
 * From every ERC-20 `Transfer` log that names the wallet as recipient, across the chain's whole history, in one read.
 * Ether sent to it leaves no log and is not seen: the evidence is a lower bound, never an overstatement. An endpoint
 * that caps the blocks one read may span refuses this, and says so.
 */
async function evidenceFromLogs(reader: ChainReader, wallet: Address): Promise<FundingEvidence> {
  const filter = { fromBlock: "0x0", toBlock: "latest", topics: [TRANSFER_TOPIC, null, `0x${addressWord(wallet)}`] };
  const inbound = await reader.rpc.call({ method: "eth_getLogs", params: [filter] }, (result) => {
    if (!Array.isArray(result)) throw new ChainError("badResponse", "eth_getLogs did not return a list");
    return result.map(decodeInbound);
  });
  if (inbound.length === 0) return { senders: 0, firstFundedAt: null, seesEther: false };
  const first = inbound.reduce((earliest, transfer) => (transfer.block < earliest ? transfer.block : earliest), inbound[0].block);
  const firstFundedAt = await reader.rpc.call(
    { method: "eth_getBlockByNumber", params: [`0x${first.toString(16)}`, false] },
    decodeTimestamp,
  );
  return { senders: new Set(inbound.map((transfer) => transfer.from)).size, firstFundedAt, seesEther: false };
}

interface IndexedTransfer {
  readonly from: string;
  readonly at: Date;
}

interface TransferPage {
  readonly transfers: readonly IndexedTransfer[];
  readonly pageKey: string | null;
}

function decodeIndexedTransfer(value: unknown): IndexedTransfer {
  if (!isObject(value) || typeof value.from !== "string" || !isObject(value.metadata)) {
    throw new ChainError("badResponse", "alchemy_getAssetTransfers returned a transfer this client cannot read");
  }
  const at = typeof value.metadata.blockTimestamp === "string" ? new Date(value.metadata.blockTimestamp) : null;
  if (at === null || Number.isNaN(at.getTime())) {
    throw new ChainError("badResponse", "alchemy_getAssetTransfers returned a transfer with no time");
  }
  return { from: value.from.toLowerCase(), at };
}

function decodeTransferPage(result: unknown): TransferPage {
  if (!isObject(result) || !Array.isArray(result.transfers)) {
    throw new ChainError("badResponse", "alchemy_getAssetTransfers did not return a page of transfers");
  }
  if (result.pageKey !== undefined && typeof result.pageKey !== "string") {
    throw new ChainError("badResponse", "alchemy_getAssetTransfers returned a page key that is not text");
  }
  return { transfers: result.transfers.map(decodeIndexedTransfer), pageKey: result.pageKey ?? null };
}

/**
 * From Alchemy's transfer index: every ether and ERC-20 transfer that reached the wallet, whole history, a page at a
 * time. It sees what logs cannot, the ether, and needs no block range, which Alchemy caps for logs.
 */
/** One page of transfers to `wallet`, from the start or from where `pageKey` says the last page stopped. */
function transferPage(reader: ChainReader, wallet: Address, pageKey: string | null): Promise<TransferPage> {
  const query = {
    fromBlock: "0x0",
    toBlock: "latest",
    toAddress: wallet,
    category: ["external", "erc20"],
    excludeZeroValue: true,
    withMetadata: true,
    maxCount: TRANSFER_PAGE_SIZE,
    ...(pageKey === null ? {} : { pageKey }),
  };
  return reader.rpc.callOn("alchemy", { method: "alchemy_getAssetTransfers", params: [query] }, decodeTransferPage);
}

async function evidenceFromTransferIndex(reader: ChainReader, wallet: Address): Promise<FundingEvidence> {
  const transfers: IndexedTransfer[] = [];
  let page = await transferPage(reader, wallet, null);
  transfers.push(...page.transfers);
  while (page.pageKey !== null) {
    page = await transferPage(reader, wallet, page.pageKey);
    transfers.push(...page.transfers);
  }
  if (transfers.length === 0) return { senders: 0, firstFundedAt: null, seesEther: true };
  const first = transfers.reduce((earliest, transfer) => (transfer.at < earliest ? transfer.at : earliest), transfers[0].at);
  return { senders: new Set(transfers.map((transfer) => transfer.from)).size, firstFundedAt: first, seesEther: true };
}

/**
 * Reads how a wallet was funded. With an Alchemy endpoint configured, from Alchemy's transfer index, which sees ether
 * too; otherwise from token `Transfer` logs. Both read the whole history; neither guesses at what it cannot see.
 */
export function readFundingEvidence(reader: ChainReader, wallet: Address): Promise<FundingEvidence> {
  const alchemy = reader.rpc.endpoints().some((report) => report.endpoint.id === "alchemy" && report.state !== "refused");
  return alchemy ? evidenceFromTransferIndex(reader, wallet) : evidenceFromLogs(reader, wallet);
}
