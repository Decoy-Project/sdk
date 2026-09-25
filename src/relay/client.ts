import type { HttpPost } from "../chain/rpc";
import { TRANSACTION_POLICY } from "../chain/transactionPolicy";
import type { Address } from "../domain/types";
import type { NetworkConfig } from "../network/types";
import { relayerBase } from "../rules/relayerUrl";
import {
  encodeQuoteRequest,
  encodeRelayRequest,
  parseQuote,
  parseRelayResult,
  RELAY_PATH,
  refusalOf,
  type RelayQuote,
  type RelayRequest,
  type RelayResult,
} from "./protocol";

/** ESTIMATE values, 24 Sep 2026. Neither is measured. */
export const RELAY_POLICY = {
  /** A quote is a couple of chain reads on the relayer's side. */
  quoteTimeoutMs: 10_000,
  /** A relayer answers a withdrawal once it is mined, so this is its wait for a receipt, and some for the rest. */
  withdrawTimeoutMs: TRANSACTION_POLICY.receiptTimeoutMs + 30_000,
} as const;

/** One relayer, for one pool. */
export interface RelayerClient {
  readonly url: string;
  /** What the relayer charges now to send a withdrawal of `asset`. */
  quote: (asset: Address) => Promise<RelayQuote>;
  /** Hands the relayer a proved withdrawal; resolves once it is mined. A refusal or a failed send throws. */
  relay: (request: RelayRequest) => Promise<RelayResult>;
}

/** Talks to the relayer at `url` over `post`: the app's own transport, so the relayer is reached the way the chain is. */
export function createRelayerClient(url: string, network: NetworkConfig, post: HttpPost): RelayerClient {
  const base = relayerBase(url);
  if (!network.contracts) throw new Error(`No DECOY pool is deployed on ${network.label}, so no relayer serves it`);
  const { pool } = network.contracts;

  async function exchange(path: string, body: string, timeoutMs: number): Promise<string> {
    const reply = await post({ url: `${base}${path}`, body, timeoutMs });
    if (reply.status < 200 || reply.status >= 300) throw new Error(`The relayer refused: ${refusalOf(reply.status, reply.body)}`);
    return reply.body;
  }

  async function quote(asset: Address): Promise<RelayQuote> {
    const body = encodeQuoteRequest({ chainId: network.chainId, pool, asset });
    const answer = parseQuote(await exchange(RELAY_PATH.quote, body, RELAY_POLICY.quoteTimeoutMs));
    if (answer.asset !== asset.toLowerCase()) throw new Error(`Asked for a quote on ${asset}, the relayer quoted ${answer.asset}`);
    return answer;
  }

  async function relay(request: RelayRequest): Promise<RelayResult> {
    return parseRelayResult(await exchange(RELAY_PATH.withdraw, encodeRelayRequest(request), RELAY_POLICY.withdrawTimeoutMs));
  }

  return { url: base, quote, relay };
}
